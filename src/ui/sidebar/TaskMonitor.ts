/**
 * TaskMonitor -- per-task cost display + telemetry persistence.
 *
 * Encapsulates the two pieces of behaviour that AgentSidebarView would
 * otherwise inline as 50+ lines of bookkeeping inside its callback hash:
 *
 *   1. onUsage -> compute EUR cost, render the footer.
 *   2. onTaskTelemetry -> persist a JSON-Lines entry for offline analysis.
 *
 * The view stays a view; this service knows the model lookup, pricing,
 * subscription detection, and telemetry I/O.
 *
 * FEATURE-1804 / ADR-090.
 */

import type { App } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import type { ApiHandler } from '../../api/types';
import { getModelKey } from '../../types/settings';
import { computeCost, computeCostForBuckets, unpricedBreakdown, type UsageByModel } from '../../core/pricing/ModelPricing';
import { TaskTelemetry, formatTelemetryFooter, type RequestTelemetryEntry, type RoutingMode } from '../../core/telemetry/TaskTelemetry';
import { VaultDataFileAdapter } from '../../core/storage/VaultDataFileAdapter';
import { getAgentDataDir } from '../../core/utils/agentFolder';

export interface TaskMonitorOptions {
    plugin: ObsidianAgentPlugin;
    app: App;
    /** Resolved API handler for the current task. Provides the actual model id. */
    apiHandler: ApiHandler | null;
    /**
     * Footer element rendered next to the chat input.
     *
     * FIX-19-06-01: prefer `getFooterEl`. The view can swap in a fresh message
     * element mid-task (e.g. after an agent question round), and onUsage fires
     * once at the very end -- so the monitor must resolve the footer lazily at
     * write time rather than binding a snapshot here. `footerEl` stays as a
     * backward-compatible fallback for callers that never reassign it.
     */
    footerEl?: HTMLElement;
    /** Lazily resolves the CURRENT footer element at write time. Wins over footerEl. */
    getFooterEl?: () => HTMLElement;
    /** Function returning the currently effective model key, used for provider detection. */
    getEffectiveModelKey: () => string;
    /** First 200 chars of the user message, captured at task start. */
    promptPreview: string;
    /** Mode slug the task is running in (ask / agent / ...). */
    mode: string;
    /** Optional context tracker hook -- forwarded usage updates so condensing logic stays accurate. */
    contextTracker?: { updateUsage: (input: number, output: number) => void };
}

export interface TaskTelemetryData {
    /**
     * FIX-24-11-01: the run's id as the loop reported it, forwarded unchanged
     * into the persisted record. The monitor must not mint one of its own: the
     * request rows already carry the loop's id, and a second source would make
     * the two files look joinable while joining nothing.
     */
    taskId: string;
    /**
     * FIX-24-11-02: why the run's model was chosen, as the loop decided it. The
     * monitor forwards it unchanged and does NOT read it off the last usage
     * report: the final report is the run's own, but an exit that never reported
     * usage has none, and a fallback would have to invent a mode.
     */
    routingMode: RoutingMode;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    toolSequence: string[];
    iterations: number;
    outcome: 'completed' | 'aborted' | 'error';
    errorMessage?: string;
}

const SUBSCRIPTION_PROVIDERS = new Set(['github-copilot', 'chatgpt-oauth']);

/**
 * FIX-24-05-07: providers that serve from the user's own machine. There is no
 * per-token bill for these, so the footer shows a marker instead of an amount
 * (it used to price them at cloud Sonnet rates).
 */
const LOCAL_PROVIDERS = new Set(['ollama', 'lmstudio']);

/**
 * FIX-24-05-06: the cost line's own element inside `.message-footer`.
 *
 * The footer is shared DOM: the view writes the condensation feedback and the
 * condense badges into it while the run is going, and the monitor writes the
 * cost line at the end. The monitor used to `setText` the whole footer, which
 * dropped every sibling the view had put there. Now the cost line owns one
 * child and touches nothing else. Exported so the view can read exactly this
 * child back when it persists the line onto the UiMessage.
 */
export const COST_LINE_CLASS = 'vo-cost-line';

/**
 * FEAT-24-13: what the persist path remembers of the last usage report.
 *
 * One object, written in one statement. It used to be two fields with two
 * different write guards -- the model id updated whenever an id was reported,
 * the split only when the split was non-empty -- so a later report without a
 * split left the record naming one model and pricing another one's tokens.
 * A report is remembered as a whole or not at all.
 */
interface RememberedUsageReport {
    /** The model the reporting task ran on (FIX-24-05-02: the routed one). */
    modelId: string;
    /**
     * FIX-24-05-05: that report's per-model split, when it carried one. Since
     * FEAT-24-13 the task derives it from its usage ledger, so for a run that
     * spent anything it is present and complete.
     */
    models?: UsageByModel;
}

export class TaskMonitor {
    private lastReport?: RememberedUsageReport;

    /**
     * AUDIT-2026-08-27 I-5: every model this TASK sent a long-context request to.
     *
     * A union across reports, not the last report's list, because the footer
     * describes the whole task and a task reports more than once: a forwarded
     * child report first, then the run's own final word. The parent books the
     * child's spend as one aggregate record, so the final report's ledger cannot
     * rediscover the child's long request, and taking only the last list would
     * drop the disclosure for every task that delegates. One monitor per task, so
     * the union cannot outlive what it describes.
     */
    private readonly longContextModelIds = new Set<string>();

    /**
     * FEAT-24-11: task start, captured when the monitor is created (one
     * monitor per task). TaskTelemetry is constructed at persist time, so
     * its own start stamp would be the write time and every record would
     * read 0 ms.
     */
    private readonly startedAt = Date.now();

    constructor(private opts: TaskMonitorOptions) {}

    /**
     * FEAT-24-11: telemetry lives under the agent data root
     * (.vault-operator/data/telemetry), not the legacy .obsidian-agent
     * folder. One place to compute it so all three JSONL files agree.
     */
    private telemetryDir(): string {
        return `${getAgentDataDir(this.opts.plugin)}/telemetry`;
    }

    private makeTelemetry(): TaskTelemetry {
        const fs = new VaultDataFileAdapter(this.opts.app.vault.adapter);
        return new TaskTelemetry(fs, { dir: this.telemetryDir() });
    }

    /**
     * FEAT-24-11: one line per API request. Appended as it arrives; the
     * file is trimmed once when the task record is written.
     */
    onRequestTelemetry(entry: RequestTelemetryEntry): void {
        void (async () => {
            await this.makeTelemetry().recordRequest(entry);
        })().catch((e) => console.warn('[Telemetry] request record failed (non-fatal):', e));
    }

    /**
     * FIX-19-06-01: the footer to write into, resolved at call time. The
     * getter (if given) reflects any mid-task element swap; otherwise the
     * static footerEl is used.
     */
    private footerEl(): HTMLElement | undefined {
        return this.opts.getFooterEl ? this.opts.getFooterEl() : this.opts.footerEl;
    }

    /**
     * FIX-24-05-06: the cost line's own child of the footer, created on first
     * write and reused afterwards, so repeated reports replace the line
     * instead of stacking copies of it.
     */
    private costLineEl(footerEl: HTMLElement): HTMLElement {
        return footerEl.querySelector<HTMLElement>(`.${COST_LINE_CLASS}`)
            ?? footerEl.createDiv(COST_LINE_CLASS);
    }

    /**
     * Live usage update -- compute cost, render footer. Called per turn.
     *
     * v2.10.2: the optional `actualModelId` argument lets the caller report
     * the model that *actually* served the call. Without it we fall back
     * to the configured main-model id, which is wrong when TaskRouter has
     * routed the task onto the helper model and the call actually ran on
     * Haiku or Sonnet. The footer now prices the call on the correct
     * model and resolves provider / subscription state from the same id.
     */
    onUsage(
        inputTokens: number,
        outputTokens: number,
        cacheReadTokens?: number,
        cacheCreationTokens?: number,
        actualModelId?: string,
        routingMode?: RoutingMode,
        usageByModel?: UsageByModel,
        longContextRequestModelIds?: string[],
    ): void {
        for (const id of longContextRequestModelIds ?? []) this.longContextModelIds.add(id);
        const cR = cacheReadTokens ?? 0;
        const cW = cacheCreationTokens ?? 0;
        const modelId = actualModelId ?? this.modelIdForCost();
        const provider = this.providerFor(modelId);
        const hasBuckets = usageByModel !== undefined && Object.keys(usageByModel).length > 0;
        // FEAT-24-13: remember this report as one thing, so the persisted record
        // cannot describe two of them. A report with neither an id nor a split
        // says nothing worth remembering, and overwriting a real report with it
        // would lose the run's attribution.
        if (modelId || hasBuckets) {
            this.lastReport = { modelId, models: hasBuckets ? usageByModel : undefined };
        }
        const isSubscription = provider !== undefined && SUBSCRIPTION_PROVIDERS.has(provider);
        // FIX-24-05-07 review: which ids ran on the user's machine. Pricing
        // cannot know this, and a local id can match a hosted rate
        // ('llama-3.2-3b-instruct' hits the 'llama-3' key at a word boundary),
        // so the amount, the warn class and tasks.jsonl all used to book a free
        // run as cloud spend. The provider is the only source of truth here.
        const localModelIds = hasBuckets
            ? Object.keys(usageByModel).filter((id) => this.isLocalModel(id))
            : (modelId && this.isLocalModel(modelId) ? [modelId] : []);
        // Entirely local: nothing to bill, so the footer drops the amount.
        const allLocal = localModelIds.length > 0
            && localModelIds.length === (hasBuckets ? Object.keys(usageByModel).length : 1);
        // FIX-24-05-05: mixed-model tasks are priced as the sum of
        // per-model costs; without a breakdown fall back to single-id.
        const cost = hasBuckets
            ? computeCostForBuckets(usageByModel, (id) => localModelIds.includes(id))
            : allLocal
                ? unpricedBreakdown([modelId])
                : computeCost(modelId, inputTokens, outputTokens, cR, cW);
        // FIX-24-05-07 (D7): the footer names the model. A single-model report
        // carries no buckets, so build the one-entry map the formatter needs.
        const footerModels: UsageByModel | undefined = hasBuckets
            ? usageByModel
            : (modelId
                ? { [modelId]: { input: inputTokens, output: outputTokens, cacheRead: cR, cacheCreation: cW } }
                : undefined);
        // EPIC-26 / FEAT-26-01 / ADR-120: tag the [Cost] line with the
        // routing mode so it is easy to scan for advisor/subagent calls
        // when validating Welle 1 cost numbers.
        const modeTag = routingMode ?? 'auto';

        // FIX-24-05-05: surface the per-model split in the cost log so
        // mixed-model tasks are auditable from the console.
        const mixedModels = usageByModel ? Object.keys(usageByModel) : [];
        const mixedTag = mixedModels.length > 1 ? ` models=[${mixedModels.join(', ')}]` : '';
        // FIX-24-05-07: log the price tier too. A 0,00 line is now either a
        // local model or an unpriced id, and the console has to say which.
        const unpricedTag = cost.unpricedModelIds.length > 0
            ? ` unpriced=[${cost.unpricedModelIds.join(', ')}]`
            : '';
        const localTag = localModelIds.length > 0 ? ` local=[${localModelIds.join(', ')}]` : '';
        console.debug(
            `[Cost] model="${modelId}" provider=${provider ?? '?'} mode=${modeTag}${mixedTag} ` +
            `in=${inputTokens} out=${outputTokens} cacheR=${cR} cacheW=${cW} ` +
            `usd=${cost.totalUsd.toFixed(4)} eur=${cost.totalEur.toFixed(4)} ` +
            `priceSource=${cost.priceSource}${unpricedTag}${localTag} subscription=${isSubscription}`,
        );

        // FIX-19-06-01: resolve the CURRENT footer, so a mid-task element swap
        // (question round) does not send the cost line to an orphaned bubble.
        const footerEl = this.footerEl();
        if (!footerEl) return;
        // FIX-24-05-06: write into the cost line's own child. A setText on the
        // footer itself would drop the condensation feedback and the condense
        // badges the view wrote there during the run.
        this.costLineEl(footerEl).setText(formatTelemetryFooter({
            inputTokens,
            outputTokens,
            cacheReadTokens: cR,
            cacheCreationTokens: cW,
            costEur: cost.totalEur,
            isSubscription,
            // FIX-24-05-07: model attribution (D7) and price provenance (D6).
            models: footerModels,
            pricing: {
                priceSource: cost.priceSource,
                unpricedModelIds: cost.unpricedModelIds,
                isLocal: allLocal,
                localModelIds,
                // AUDIT-2026-08-27 I-5: the amount above is a sum of buckets, so
                // it was priced at base rates even for the requests the vendor
                // charged a long-context premium for. The line says so instead of
                // presenting a floor as the total.
                longContextRequestModelIds: [...this.longContextModelIds],
            },
        }));
        footerEl.classList.remove('agent-u-hidden');

        // FEAT-24-05: visible signal when the task's running cost crosses the
        // warn threshold (the would-be API spend is worth flagging even on
        // subscription providers). 0 disables the warning.
        const warnEur = this.opts.plugin.settings.advancedApi.costWarnThresholdEur ?? 0;
        footerEl.classList.toggle('agent-cost-warn', warnEur > 0 && cost.totalEur >= warnEur);

        if (this.opts.contextTracker) {
            this.opts.contextTracker.updateUsage(inputTokens, outputTokens);
        }
    }

    /**
     * Persist one telemetry entry for the completed task. Best-effort,
     * never throws; failures are logged at warn level.
     */
    onTaskTelemetry(data: TaskTelemetryData): void {
        // Run in background -- the view should not wait on filesystem.
        void this.persist(data).catch((e) =>
            console.warn('[Telemetry] record failed (non-fatal):', e),
        );
    }

    /**
     * FIX-COMPACT-07: persist a per-condense-pass telemetry event.
     * Best-effort, never throws.
     */
    onCondenseTelemetry(event: import('../../core/telemetry/TaskTelemetry').CondenseTelemetryEntry): void {
        void (async () => {
            await this.makeTelemetry().recordCondense(event);
        })().catch((e) => console.warn('[Telemetry] condense record failed (non-fatal):', e));
    }

    private async persist(data: TaskTelemetryData): Promise<void> {
        const telemetry = this.makeTelemetry();
        // AUDIT-013 M-2: promptPreview is opt-in. Vault sync may share the
        // telemetry file, so user prompts only land on disk if the user
        // explicitly enables the flag.
        const recordPreview = this.opts.plugin.settings.advancedApi.telemetryRecordPromptPreview ?? false;
        await telemetry.record({
            promptPreview: recordPreview ? this.opts.promptPreview : '',
            // FIX-24-11-01: the join key, straight from the loop. requests.jsonl
            // has carried it since FEAT-24-11; the task row did not, so the two
            // files could not be paired at all.
            taskId: data.taskId,
            // FIX-24-11-02: and why that model ran, straight from the loop. The
            // console cost line was the only consumer of this until now.
            routingMode: data.routingMode,
            // FIX-24-05-02: prefer the model that actually served the task.
            modelId: this.lastReport?.modelId || this.modelIdForCost(),
            mode: this.opts.mode,
            inputTokens: data.inputTokens,
            outputTokens: data.outputTokens,
            cacheReadTokens: data.cacheReadTokens,
            cacheCreationTokens: data.cacheCreationTokens,
            outcome: data.outcome,
            errorMessage: data.errorMessage,
            // FIX-24-05-05: per-model breakdown for correct mixed-model pricing.
            // FEAT-24-13: from the same report as the modelId above.
            usageByModel: this.lastReport?.models,
            // FIX-24-05-07 review: keep the local ids out of the persisted cost.
            localModelIds: this.localModelIdsForRecord(),
            // FEAT-24-11: the task facts the loop reported. Before this they
            // were dropped here and every record read iterations 0.
            iterations: data.iterations,
            toolSequence: data.toolSequence,
            startedAt: this.startedAt,
        });
        // FEAT-24-11: keep the per-request log bounded, once per task.
        await telemetry.trimRequestLog();
    }

    private modelIdForCost(): string {
        return this.opts.apiHandler?.getModel().id ?? '';
    }

    /**
     * FIX-24-05-07 review: does this id run on the user's own machine? Locality
     * is a property of the configured provider, never of the model id: an
     * LM Studio id like 'llama-3.2-3b-instruct' matches the hosted 'llama-3'
     * rate, so a free run was reported as cloud spend until the provider got
     * the last word.
     */
    private isLocalModel(modelId: string): boolean {
        const provider = this.providerFor(modelId);
        return provider !== undefined && LOCAL_PROVIDERS.has(provider);
    }

    /**
     * The local ids of the run being persisted. Re-derived rather than cached
     * from onUsage, because the abort and error exits can persist a record for
     * a run that never reported usage.
     */
    private localModelIdsForRecord(): string[] | undefined {
        const report = this.lastReport;
        const ids = report?.models
            ? Object.keys(report.models)
            : [report?.modelId || this.modelIdForCost()];
        const local = ids.filter((id) => id.length > 0 && this.isLocalModel(id));
        return local.length > 0 ? local : undefined;
    }

    /**
     * Resolve provider from a model id. v2.10.2: looks the model up by its
     * concrete id (the `id` field on CustomModel, after normalisation)
     * rather than via getEffectiveModelKey(). When TaskRouter has routed
     * to the helper model, the model id we see at usage-report time
     * belongs to the helper, not to the user-selected main model.
     *
     * v2.10.4 (AUDIT-026 L-1): prefer exact match, then by descending name
     * length, so an entry called "claude" cannot shadow "claude-haiku-4.5"
     * for the lookup of `"claude-haiku-4.5"`. Without this ordering the
     * first overlapping substring match wins, which mislabels the
     * provider and breaks the isSubscription flag.
     */
    private providerFor(modelId: string): string | undefined {
        if (!modelId) {
            return this.opts.plugin.settings.activeModels.find(
                (m) => getModelKey(m) === this.opts.getEffectiveModelKey(),
            )?.provider;
        }
        const idLower = modelId.toLowerCase();

        // Exact match wins.
        const exact = this.opts.plugin.settings.activeModels.find(
            (m) => (m.name || '').toLowerCase() === idLower,
        );
        if (exact) return exact.provider;

        // Then by descending name-length so the most specific overlap wins.
        const candidates = [...this.opts.plugin.settings.activeModels]
            .filter((m) => (m.name || '').length > 0)
            .sort((a, b) => (b.name || '').length - (a.name || '').length);
        const match = candidates.find((m) => {
            const candidate = (m.name || '').toLowerCase();
            return idLower.endsWith(candidate) ||
                candidate.endsWith(idLower) ||
                idLower.includes(candidate);
        });
        return match?.provider;
    }
}
