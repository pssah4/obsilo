/**
 * REF-12: extract Stufe-3 hook construction out of main.ts.
 *
 * The four closures that the Stufe-3 Periodic Job needs -- a pre-filter
 * classifier, a web-update pass, a notification sink, a budget-exceeded
 * sink -- used to live as 120+ lines of inline lambdas in main.ts.
 * Lambda-wiring at that scale is hard to follow and impossible to unit
 * test in isolation. This module accepts a thin "host" interface and
 * returns the four hooks ready to pass to `new Stufe3PeriodicJob(...)`.
 *
 * The host abstraction stays narrow: only the four fields and one helper
 * Stufe-3 actually reads. Everything else stays in main.ts so the
 * extraction does not turn into a god-object refactor.
 */

import { Notice } from 'obsidian';
import { t } from '../../i18n';
import type { ApiHandler } from '../../api/types';
import type { ClusterMetadataRecord } from '../knowledge/ClusterMetadataStore';
import type { FreshnessOrchestrator } from './FreshnessOrchestrator';
import type { UpdateFinding } from './Stufe3PeriodicJob';
import type { NoteVerdict } from './types';
import type { ToolCallbacks, ToolExecutionContext } from '../tools/types';
import type { BaseTool } from '../tools/BaseTool';

export interface Stufe3HostMinimal {
    /**
     * Live getter for the active API handler (nullable when no provider is
     * configured). FEAT-30-07 review finding: the hooks are wired in
     * doLoad() BEFORE initApiHandler() runs, so a by-value snapshot froze
     * `null` forever and preFilter answered 'no' for every cluster.
     */
    getApiHandler(): ApiHandler | null;
    /** Returns the web_search tool when registered, otherwise null. */
    getWebSearchTool(): BaseTool | null;
    /** Plugin instance for the ToolExecutionContext shim. */
    plugin: unknown;
}

export interface Stufe3Hooks {
    preFilter: (cluster: ClusterMetadataRecord) =>
        Promise<{ decision: 'yes' | 'no' | 'unsure'; tokensUsed: number }>;
    webUpdatePass: (cluster: ClusterMetadataRecord) =>
        Promise<{ findings: UpdateFinding[]; tokensUsed: number }>;
    notificationSink: (findings: UpdateFinding[]) => void;
    budgetExceededSink: (info: { spentUsd: number; budgetUsd: number }) => void;
}

/** Extract HTTP(S) URLs from a free-form text. Re-exported by main.ts (REF-12). */
export function extractUrlsFromText(text: string): string[] {
    const matches = text.match(/https?:\/\/[^\s)\]<>"']+/g) ?? [];
    return Array.from(new Set(matches));
}

/**
 * How many independent domains a text cites, on an eTLD+1 surrogate (the two
 * trailing labels). Re-exported by main.ts (REF-12).
 */
export function countIndependentDomains(urls: string[]): number {
    const domains = new Set<string>();
    for (const u of urls) {
        try {
            const host = new URL(u).hostname;
            const parts = host.toLowerCase().split('.');
            // A counting key, deliberately not a hostname: the pair of trailing
            // labels joined by a character that cannot occur inside one, so the
            // value can never be mistaken for a domain and reused as one. Only
            // domains.size is ever read.
            const key = parts.length >= 2
                ? `${parts[parts.length - 2]}|${parts[parts.length - 1]}`
                : host.toLowerCase();
            domains.add(key);
        } catch {
            // unparseable URLs do not contribute to the signal
        }
    }
    return domains.size;
}

export function buildStufe3Hooks(
    host: Stufe3HostMinimal,
    /**
     * ADR-163 / FEAT-30-07: Factory statt Boot-Instanz. Der Orchestrator
     * wird pro Aufruf gebaut, damit Freshness- und Web-Settings zum
     * Aufrufzeitpunkt gelten (die alten Konstruktor-Snapshots wirkten
     * erst nach Plugin-Reload).
     */
    getOrchestrator: () => FreshnessOrchestrator | null,
): Stufe3Hooks {
    const preFilter = async (cluster: ClusterMetadataRecord) => {
        const apiHandler = host.getApiHandler();
        if (!apiHandler?.classifyText) return { decision: 'no' as const, tokensUsed: 0 };
        const prompt =
            `Cluster "${cluster.cluster}" wurde zuletzt am ${cluster.lastExternalCheck ?? 'nie'} extern verifiziert. ` +
            `Halbwertszeit: ${cluster.halfLifeDays} Tage. Lohnt sich JETZT eine Web-Suche ` +
            `nach Updates? Antworte ausschliesslich mit "yes", "no" oder "unsure".`;
        try {
            const reply = (await apiHandler.classifyText(prompt)).toLowerCase().trim();
            const decision: 'yes' | 'no' | 'unsure' = reply.startsWith('yes') ? 'yes'
                : reply.startsWith('unsure') ? 'unsure' : 'no';
            return { decision, tokensUsed: prompt.length / 4 + 5 };
        } catch (e) {
            console.debug('[Stufe3] preFilter classify failed:', e);
            return { decision: 'no' as const, tokensUsed: 0 };
        }
    };

    const webUpdatePass = async (cluster: ClusterMetadataRecord) => {
        const tool = host.getWebSearchTool();
        if (!tool) return { findings: [], tokensUsed: 0 };
        const captured: string[] = [];
        const ctx = {
            plugin: host.plugin,
            callbacks: {
                pushToolResult: (r: string) => { captured.push(r); },
                say: () => Promise.resolve(),
                ask: () => Promise.resolve({ response: 'noButtonClicked' as const }),
                isParallelExecution: false,
                shouldUseImmediateApproval: () => false,
            } as unknown as ToolCallbacks,
        } as unknown as ToolExecutionContext;
        try {
            await tool.execute({
                query: `${cluster.cluster} latest update news`,
                max_results: 5,
            }, ctx);
        } catch (e) {
            console.debug('[Stufe3] webUpdatePass failed:', e);
            return { findings: [], tokensUsed: 0 };
        }
        const text = captured.join('\n');
        if (!text.trim()) return { findings: [], tokensUsed: 0 };

        let noteVerdicts: NoteVerdict[] = [];
        let verifierTokens = 0;
        try {
            // FIX-19-16-07: die bezahlten Cluster-Treffer reisen als Seeds in
            // den Verifier, statt nur das Finding-Summary zu fuellen
            // (FEAT-19-03-01 offener Punkt: Doppel-Websuche).
            const seeds = extractUrlsFromText(text).slice(0, 5);
            const orchestrated = await getOrchestrator()?.runForCluster(cluster.cluster, seeds);
            noteVerdicts = orchestrated?.verdicts ?? [];
            verifierTokens = orchestrated?.tokensUsed ?? 0;
        } catch (e) {
            console.debug('[Stufe3] verifier-pass failed:', e);
        }

        return {
            findings: [{
                cluster: cluster.cluster,
                title: `Updates fuer ${cluster.cluster}`,
                summary: text.slice(0, 600),
                sources: extractUrlsFromText(text).slice(0, 5),
                detectedAt: new Date().toISOString(),
                strongSignal: countIndependentDomains(extractUrlsFromText(text)) >= 3,
                ...(noteVerdicts.length ? { notes: noteVerdicts } : {}),
            }],
            tokensUsed: text.length / 4 + verifierTokens,
        };
    };

    const notificationSink = (findings: UpdateFinding[]) => {
        if (!findings.length) return;
        new Notice(t('notice.stufe3.updates', { count: findings.length }), 6_000);
        for (const f of findings) console.debug(`[Stufe3] ${f.cluster}: ${f.title}`);
    };

    const budgetExceededSink = (info: { spentUsd: number; budgetUsd: number }) => {
        new Notice(t('notice.stufe3.budget', { percent: (info.spentUsd / info.budgetUsd * 100).toFixed(0) }), 5_000);
    };

    return { preFilter, webUpdatePass, notificationSink, budgetExceededSink };
}
