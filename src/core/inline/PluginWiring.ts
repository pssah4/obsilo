/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/require-await, @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-expressions -- File-level disable: this module wires Obsidian-API probes, plugin-internal services and conditional require()s where the surface contracts are intentionally untyped. Inputs are validated via type guards at use-sites (instanceof TFile, instanceof MarkdownView, null-checks in adapters). */

/**
 * PluginWiring -- live Obsidian-API adapters for the Inline-Editor-AI layer (EPIC-33).
 *
 * Centralises every adapter that connects the Inline modules to the
 * Obsidian Plugin API so main.ts only needs a single call:
 *
 *   plugin.inlineActionService = wireInlineActions(plugin);
 *
 * Each adapter is small and intentionally defensive. When a probe
 * cannot resolve (no active editor, sidebar leaf missing, ...) it
 * returns null instead of throwing so the InlineActionService can
 * silently no-op.
 *
 * Related: ADR-138 (Sidebar-Independence wiring), PLAN-42 main.ts
 * wiring step.
 */

import { Component, MarkdownRenderer, MarkdownView, Menu, TFile, setIcon, type App } from 'obsidian';
import { t } from '../../i18n';
import { refreshOpenMarkdownViewsFor } from '../utils/refreshMarkdownView';
import { getModelKey } from '../../types/settings';
import { resolveActiveProvider } from '../routing/tierResolution';
import { runMeteredCall } from '../pricing/meteredCall';
import { AutocompleteHandler } from '../../ui/sidebar/AutocompleteHandler';
import { CommandPicker, type CommandPickerItem } from '../../ui/sidebar/CommandPicker';
import { VaultFilePicker } from '../../ui/sidebar/VaultFilePicker';
import { AttachmentHandler } from '../../ui/sidebar/AttachmentHandler';
import { ChatModelPickerPopover } from '../../ui/sidebar/ChatModelPickerPopover';
import { autoModelLabel } from '../../ui/sidebar/autoModelLabel';
import { ToolPickerPopover } from '../../ui/sidebar/ToolPickerPopover';
import { nextForcedWorkflow } from '../../ui/sidebar/forcedWorkflow';
import type ObsidianAgentPlugin from '../../main';
import { InlineActionRegistry } from './InlineActionRegistry';
import { InlineTriggerResolver } from './InlineTriggerResolver';
import { InlineFloatingMenu } from './InlineFloatingMenu';
import { InlineActionService, type EditorSelectionProbe } from './InlineActionService';
import type { ChatSidebarController } from './actions/SendToMainChatAction';
import { SendToMainChatAction } from './actions/SendToMainChatAction';
import { LookupAction, type VaultRagPipeline } from './actions/LookupAction';
import { RewriteAction } from './actions/RewriteAction';
import { TranslateAction } from './actions/TranslateAction';
import { SummarizeAction } from './actions/SummarizeAction';
import { FindActionItemsAction } from './actions/FindActionItemsAction';
// InlineChatAction + NoteWriter retired per EPIC-33 audit (wd39z8ehx) --
// the panel is now the only conversation surface, free-chat drives a real
// AgentTaskRunner loop in PanelChatController. No more fence writes to notes.
import { DefaultVaultRagPipeline, type SemanticIndexProbe } from './lookup/VaultRagPipeline';
import { EmbeddingCache } from './lookup/EmbeddingCache';
import { LookupEdgeAggregator } from './lookup/LookupEdgeAggregator';
import { InlineWebLookup } from './lookup/InlineWebLookup';
import { resolveInlineActionsSettings, resolveInlineModelSnapshot } from './inlineSettings';
import type { InlineLLMCaller, InlineLLMStreamArgs, InlineLLMStreamCallbacks } from './InlineLLMCaller';
import type { InlineSettingsSnapshot } from './InlineTriggerContext';
import { VIEW_TYPE_AGENT_SIDEBAR } from '../../ui/viewTypes';
import { neutraliseRemoteResources } from '../../ui/sidebar/neutraliseRemoteResources';
// SelectionWatcher: re-enabled 2026-06-24, but gated behind the
// `floatingMenuEnabled` setting which defaults to FALSE. The 2026-06-22
// regression (blocking copy/read flows) only triggered when auto-open
// was ON by default; the watcher itself stays opt-in.
import { SelectionWatcher } from './SelectionWatcher';
import { inlineDiffExtension } from './diff/CodeMirrorDiffAdapter';
import { InlineChatOrchestrator, type EditorChatProbe } from './chat/InlineChatOrchestrator';
import { CodeMirrorBlockMount, inlineChatBlockExtension } from './chat/mount/CodeMirrorBlockMount';
import { OverlayPopoverMount } from './chat/mount/OverlayPopoverMount';
import { InlineToSidebarTransferService } from './chat/InlineToSidebarTransferService';
import { InlineActionPill } from './chat/InlineActionPill';

/**
 * Live editor probe. Reads MarkdownView -> editor.getSelection() and
 * computes the absolute char offset of the cursor.
 */
function buildEditorProbe(plugin: ObsidianAgentPlugin): EditorSelectionProbe {
    const app: App = plugin.app;
    return {
        probe: () => {
            const view = app.workspace.getActiveViewOfType(MarkdownView);
            if (view === null) return null;
            const editor = view.editor;
            const selection = editor.getSelection();
            const cursor = editor.getCursor();
            // Convert {line, ch} into absolute char offset.
            const cursorPos = editor.posToOffset(cursor);
            // FIX-33-DV-01 (2026-06-22): editor.getCursor() returns the HEAD,
            // which for a forward selection is the END. The InlineEditApplier
            // writeBackToSelection needs the actual selection range, not
            // head+length. Read getCursor('from')/('to') explicitly.
            const fromPos = editor.getCursor('from');
            const toPos = editor.getCursor('to');
            const selectionFrom = editor.posToOffset(fromPos);
            const selectionTo = editor.posToOffset(toPos);
            // Determine editor mode: 'source' / 'live-preview' / 'reading'.
            // Obsidian's MarkdownView.getMode() returns 'source' (incl. live-preview)
            // or 'preview'. We map 'preview' -> 'reading'.
            const obsMode = view.getMode();
            const editorMode = obsMode === 'preview'
                ? 'reading'
                // EDITORIAL: differentiate source vs live-preview via state if available.
                : (view.getState() as { source?: boolean } | undefined)?.source === true ? 'source' : 'live-preview';
            const notePath = view.file?.path ?? '';
            return {
                selectionText: selection ?? '',
                editorMode,
                cursorPos,
                selectionFrom,
                selectionTo,
                notePath,
            };
        },
        getMenuContainer: () => {
            const view = app.workspace.getActiveViewOfType(MarkdownView);
            return view?.contentEl ?? null;
        },
        getMenuPosition: () => {
            // Best-effort: cursor-coords would require querying CodeMirror.
            // For Welle 1 we open near the view's content origin; the
            // floating-menu clamps to viewport so this stays usable.
            const view = app.workspace.getActiveViewOfType(MarkdownView);
            const rect = view?.contentEl.getBoundingClientRect();
            if (rect === undefined) return { x: 100, y: 100 };
            return { x: rect.left + 40, y: rect.top + 40 };
        },
    };
}

function buildChatSidebarController(plugin: ObsidianAgentPlugin): ChatSidebarController {
    return {
        isOpen: () => plugin.app.workspace.getLeavesOfType(VIEW_TYPE_AGENT_SIDEBAR).length > 0,
        open: async () => {
            await plugin.activateView();
        },
        insertContextChip: async ({ text, notePath }) => {
            // FEAT-55-01 (ADR-169): route to the last-focused chat leaf via
            // the plugin's typed prepopulate method. Replaces the old
            // CustomEvent dispatch that had NO listener (dead path) and
            // hard-resolved leaves[0]. The plugin method resolves the active
            // chat and calls prepopulateComposerWithContext, so no hard
            // import of AgentSidebarView is needed here.
            plugin.prepopulateActiveSidebarComposer({ text, notePath });
        },
    };
}

/**
 * Builds an InlineLLMCaller backed by the plugin's active provider.
 * Defensive: returns onError when no apiHandler exists.
 */
function buildLLMCaller(plugin: ObsidianAgentPlugin): InlineLLMCaller {
    return {
        stream: async (args: InlineLLMStreamArgs, callbacks: InlineLLMStreamCallbacks): Promise<void> => {
            try {
                const api = plugin.apiHandler;
                if (api === null || api === undefined) {
                    callbacks.onError(new Error('No active provider'));
                    return;
                }
                const messages = [{ role: 'user' as const, content: args.userMessage }];
                // FIX-24-05-09 (D10): every inline quick action (rewrite,
                // translate, summarize, lookup) runs through here, and none of
                // them was counted anywhere. There is no chat footer on this
                // surface, so the ledger and the console line are the report.
                for await (const chunk of runMeteredCall(api, 'inline-quick-action', {
                    systemPrompt: args.systemPrompt,
                    messages,
                })) {
                    if (chunk.type === 'text' && typeof chunk.text === 'string') {
                        callbacks.onText(chunk.text);
                    }
                }
                callbacks.onComplete();
            } catch (e) {
                const err = e instanceof Error ? e : new Error(String(e));
                callbacks.onError(err);
            }
        },
    };
}

function buildSemanticIndexProbe(plugin: ObsidianAgentPlugin): SemanticIndexProbe | null {
    // Live wiring over SemanticIndexService.embedTexts + VectorStore.searchUniqueFiles.
    // Returns null when either dependency is not initialised so LookupAction
    // falls back to LLM-only.
    interface SiHost {
        semanticIndex?: { embedTexts?: (texts: string[]) => Promise<Float32Array[]> } | null;
        vectorStore?: {
            searchUniqueFiles?: (q: Float32Array, topK: number, pathPrefix?: string) => Array<{ path: string; text: string; score: number }>;
        } | null;
    }
    const host = plugin as unknown as SiHost;
    const semantic = host.semanticIndex;
    const vectorStore = host.vectorStore;
    if (semantic === undefined || semantic === null) return null;
    if (vectorStore === undefined || vectorStore === null) return null;
    return {
        embedText: async (text: string) => {
            const fn = semantic.embedTexts;
            if (typeof fn !== 'function') return [];
            try {
                const [vec] = await fn.call(semantic, [text]);
                if (vec instanceof Float32Array) return Array.from(vec);
                return [];
            } catch (e) {
                console.debug('[inline-rag] embedText failed (LLM-only fallback):', e);
                return [];
            }
        },
        queryNoteVectors: async ({ embedding, topN }) => {
            const fn = vectorStore.searchUniqueFiles;
            if (typeof fn !== 'function' || embedding.length === 0) return [];
            try {
                const query = new Float32Array(embedding);
                const raw = fn.call(vectorStore, query, topN) as Array<{ path: string; text?: string; score?: number }>;
                return raw.map((r) => ({
                    notePath: r.path,
                    excerpt: r.text?.slice(0, 200),
                    cosineSimilarity: typeof r.score === 'number' ? r.score : 0,
                }));
            } catch (e) {
                console.debug('[inline-rag] queryNoteVectors failed (LLM-only fallback):', e);
                return [];
            }
        },
        // Multi-chunk probe (EPIC-33 Lookup-Enhancement). Bypasses
        // searchUniqueFiles (which dedupes per file) and reads the raw
        // chunk list directly so the pipeline can group + tier multiple
        // chunks per file with FULL chunk text (no 200-char slice).
        queryNoteChunks: async ({ embedding, topK }) => {
            const fnRaw = (vectorStore as { search?: (q: Float32Array, k: number) => Array<{ path: string; text?: string; score?: number; chunkIndex?: number }> }).search;
            if (typeof fnRaw !== 'function' || embedding.length === 0) return [];
            try {
                const query = new Float32Array(embedding);
                const raw = fnRaw.call(vectorStore, query, topK) as Array<{ path: string; text?: string; score?: number; chunkIndex?: number }>;
                return raw
                    .filter((r: { path: string }) => typeof r.path === 'string' && r.path.length > 0)
                    .map((r: { path: string; text?: string; score?: number; chunkIndex?: number }, idx: number) => ({
                        notePath: r.path,
                        chunkIndex: typeof r.chunkIndex === 'number' ? r.chunkIndex : idx,
                        text: typeof r.text === 'string' ? r.text : '',
                        cosineSimilarity: typeof r.score === 'number' ? r.score : 0,
                    }));
            } catch (e) {
                console.debug('[inline-rag] queryNoteChunks failed:', e);
                return [];
            }
        },
    };
}

/**
 * Wire internal-link click handlers on a freshly-rendered markdown
 * container so wikilinks navigate via workspace.openLinkText instead
 * of falling through as inert anchors. Mirrors the Sidebar pattern
 * (AgentSidebarView.wireInternalLinks).
 *
 * Special-case obsidian://vault-operator-chat?id=X URLs (chat-deep-
 * links from recall_memory / search_history) so the click routes
 * through plugin.openChatById -- otherwise the ":" in the protocol
 * scheme triggers a createFolder error in openLinkText.
 */
function wireInternalLinks(plugin: ObsidianAgentPlugin, containerEl: HTMLElement): void {
    containerEl.querySelectorAll('a').forEach((anchor) => {
        const href = anchor.getAttribute('href') ?? '';
        if (href.startsWith('obsidian://vault-operator-chat') || href.startsWith('obsidian://obsilo-chat')) {
            anchor.addEventListener('click', (e) => {
                e.preventDefault();
                const match = /[?&]id=([^&]+)/.exec(href);
                if (match) {
                    const id = decodeURIComponent(match[1]);
                    const opener = (plugin as unknown as { openChatById?: (id: string) => Promise<void> }).openChatById;
                    if (typeof opener === 'function') void opener.call(plugin, id);
                }
            });
            return;
        }
        if (href.length === 0) return;
        if (href.startsWith('http') === true || href.startsWith('mailto') === true) return;
        anchor.addEventListener('click', (e) => {
            e.preventDefault();
            const linkText = anchor.getAttribute('data-href') ?? href;
            void plugin.app.workspace.openLinkText(linkText, '', false);
        });
    });
}

/**
 * FEAT-33-12 follow-up: portal the @-mention autocomplete dropdown out
 * of the inline composer so it can grow to its full 7-row size without
 * being clipped by the CM6 block widget. AutocompleteHandler creates a
 * `.autocomplete-dropdown` child in the inputArea on first render; we
 * observe that and re-parent it into `workspace.containerEl` with a
 * fixed-position anchor pointing at the composer's current rect.
 *
 * The observer also watches for hide() removing the dropdown so it can
 * release its listeners. Reattaches the dropdown back into the composer
 * area if the user typed a new query (AutocompleteHandler re-uses the
 * same element, so we only have to re-position it).
 */
function installAutocompletePortal(plugin: ObsidianAgentPlugin, composerContainer: HTMLElement): void {
    const portalTarget = plugin.app.workspace.containerEl;
    const win = composerContainer.ownerDocument.defaultView ?? window;
    const updatePosition = (dropdown: HTMLElement): void => {
        const rect = composerContainer.getBoundingClientRect();
        // Bottom-anchored above the composer with a small breathing gap.
        // Width = composer width minus its 12px horizontal padding (matches
        // the dropdown's intrinsic left/right:0 sizing in the sidebar).
        dropdown.setCssStyles({
            position: 'fixed',
            left: `${rect.left + 12}px`,
            right: `${(win.innerWidth - rect.right) + 12}px`,
            bottom: `${(win.innerHeight - rect.top) + 4}px`,
            top: 'auto',
            zIndex: '10000',
        });
    };
    let disposed = false;
    const dispose = (): void => {
        if (disposed === true) return;
        disposed = true;
        observer.disconnect();
        win.removeEventListener('resize', reflow);
        plugin.app.workspace.containerEl.removeEventListener('scroll', reflow, true);
        const dropdown = portalTarget.querySelector(':scope > .autocomplete-dropdown');
        if (dropdown !== null) dropdown.remove();
    };
    const observer = new MutationObserver(() => {
        // The composer was unmounted (panel closed) -- release everything.
        if (composerContainer.isConnected !== true) { dispose(); return; }
        const dropdown = composerContainer.querySelector('.autocomplete-dropdown') as HTMLElement | null;
        if (dropdown !== null) {
            if (dropdown.parentElement !== portalTarget) {
                portalTarget.appendChild(dropdown);
            }
            updatePosition(dropdown);
        }
    });
    observer.observe(composerContainer, { childList: true, subtree: true });
    // Re-position on scroll / resize so the dropdown keeps tracking the
    // composer when the editor pane reflows.
    const reflow = (): void => {
        if (composerContainer.isConnected !== true) { dispose(); return; }
        const dropdown = portalTarget.querySelector(':scope > .autocomplete-dropdown') as HTMLElement | null;
        if (dropdown !== null) updatePosition(dropdown);
    };
    win.addEventListener('resize', reflow);
    plugin.app.workspace.containerEl.addEventListener('scroll', reflow, true);
    // Final safety net on plugin teardown.
    plugin.register(dispose);
}

/**
 * Per-panel surface: holds Sidebar-style picker instances + per-turn
 * override state so the inline panel can reuse the same pickers the
 * sidebar does. activePanelSurface is set by the orchestrator on
 * panel-open via setActivePanelSurface() (exported below).
 */
interface PanelSurface {
    panelRoot: HTMLElement;
    attachments: AttachmentHandler;
    vaultFilePicker: VaultFilePicker;
    modelPicker: ChatModelPickerPopover;
    /** Per-turn chat model pin (mirrors AgentSidebarView.chatModelOverride). */
    chatModelOverride: string | null;
    chatThinkingOverride: import('../../ui/sidebar/thinkingOverride').ThinkingOverride;
    chatEffortOverride: import('../../ui/sidebar/effortOverride').EffortOverride;
    /** Lazy: created on first "Select tools" click (IMP-02-12-02). */
    toolPicker?: ToolPickerPopover;
}

let activePanelSurface: PanelSurface | null = null;

/** Called from the orchestrator on panel-open / close to scope the picker instances. */
export function setActivePanelSurface(surface: PanelSurface | null): void {
    // The tool picker renders into document.body; close it with its surface
    // so it cannot outlive the panel (IMP-02-12-02).
    if (activePanelSurface !== surface) activePanelSurface?.toolPicker?.close();
    activePanelSurface = surface;
}

/** Build a per-panel surface bundle. */
export function buildPanelSurface(plugin: ObsidianAgentPlugin, panelRoot: HTMLElement, chipBar: HTMLElement): PanelSurface {
    const attachments = new AttachmentHandler(plugin.app.vault, chipBar, plugin);
    const vaultFilePicker = new VaultFilePicker(
        plugin.app,
        async (files) => { for (const f of files) await attachments.addVaultFile(f); },
    );
    const modelPicker = new ChatModelPickerPopover();
    return {
        panelRoot,
        attachments,
        vaultFilePicker,
        modelPicker,
        chatModelOverride: null,
        chatThinkingOverride: 'follow',
        chatEffortOverride: 'auto',
    };
}

/**
 * Build CommandPicker items for the inline panel's plus-menu. Mirrors
 * AgentSidebarView.collectCommandItems (sidebar:686-732).
 */
async function buildCommandItems(
    plugin: ObsidianAgentPlugin,
    category: 'skills' | 'prompts' | 'workflows',
    handle: import('./chat/InlineChatPanel').InlinePanelHandle,
    getModeSlug: () => string,
): Promise<CommandPickerItem[]> {
    if (category === 'skills') {
        const skills = (plugin as unknown as { selfAuthoredSkillLoader?: { getAllSkills: () => Array<{ name: string; description: string }> } }).selfAuthoredSkillLoader?.getAllSkills() ?? [];
        return skills.map((skill) => {
            const slug = AutocompleteHandler.slugifySkillName(skill.name);
            return {
                label: skill.name,
                sub: `/${slug}`,
                tag: t('ui.inline.tagSkill'),
                icon: 'sparkles',
                searchable: skill.description,
                onSelect: () => handle.insertIntoComposer(`/${slug}`, 'prepend'),
            };
        });
    }
    if (category === 'prompts') {
        // FEAT-55-02 (ADR-170): use the passed per-panel mode getter (as the
        // rest of this function already does at 433/455/464), not the global
        // settings.currentMode scalar -- keeps the inline panel's prompt
        // filter on its own mode.
        const activeMode = getModeSlug();
        const prompts = (plugin.settings.customPrompts ?? []).filter(
            (p) => p.enabled !== false && (p.mode === undefined || p.mode === '' || p.mode === activeMode),
        );
        return prompts.map((prompt) => ({
            label: prompt.name,
            sub: `#${prompt.slug}`,
            tag: t('ui.inline.tagPrompt'),
            icon: 'message-square-quote',
            searchable: prompt.content,
            onSelect: () => handle.insertIntoComposer(`#${prompt.slug}`, 'prepend'),
        }));
    }
    // Workflows.
    const workflowLoader = (plugin as unknown as { workflowLoader?: { discoverWorkflows: () => Promise<Array<{ path: string; slug: string; displayName: string }>> } }).workflowLoader;
    if (workflowLoader === undefined) return [];
    const workflows = await workflowLoader.discoverWorkflows();
    const toggles = (plugin.settings as { workflowToggles?: Record<string, boolean> }).workflowToggles ?? {};
    const toggleForced = (slug: string) => {
        const modeSlug = getModeSlug();
        if (!plugin.settings.forcedWorkflow) plugin.settings.forcedWorkflow = {};
        plugin.settings.forcedWorkflow[modeSlug] = nextForcedWorkflow(
            plugin.settings.forcedWorkflow[modeSlug] ?? '', slug,
        );
        void plugin.saveSettings();
        // Hub notify reaches BOTH surfaces' chips, incl. this panel's own
        // subscription (IMP-02-12-01).
        plugin.forcedWorkflowHub.notify();
    };
    const items: CommandPickerItem[] = workflows
        .filter((w) => toggles[w.path] !== false)
        .map((wf) => ({
            label: wf.displayName,
            sub: `§${wf.slug}`,
            tag: t('ui.inline.tagWorkflow'),
            icon: 'workflow',
            onSelect: () => handle.insertIntoComposer(`§${wf.slug}`, 'prepend'),
            // The pin forces the workflow on every message in this agent, the
            // same control the sidebar shows (FEAT-02-12). The picker re-renders
            // the pin state itself after the toggle.
            pin: {
                isActive: () => (plugin.settings.forcedWorkflow?.[getModeSlug()] ?? '') === wf.slug,
                labelOff: t('ui.commandPicker.forceWorkflowOff'),
                labelOn: t('ui.commandPicker.forceWorkflowOn'),
                onToggle: () => toggleForced(wf.slug),
            },
        }));
    // A forced workflow whose file was deleted or disabled would otherwise have
    // no unpin control anywhere (the chip is not interactive). Render it as a
    // synthetic row so the pin stays reachable (FEAT-02-12 review fix).
    const forcedSlug = plugin.settings.forcedWorkflow?.[getModeSlug()] ?? '';
    if (forcedSlug !== '' && !items.some((i) => i.sub === `§${forcedSlug}`)) {
        items.push({
            label: t('ui.commandPicker.forcedWorkflowMissing', { slug: forcedSlug }),
            sub: `§${forcedSlug}`,
            tag: t('ui.inline.tagWorkflow'),
            icon: 'workflow',
            onSelect: () => handle.insertIntoComposer(`§${forcedSlug}`, 'prepend'),
            pin: {
                isActive: () => (plugin.settings.forcedWorkflow?.[getModeSlug()] ?? '') === forcedSlug,
                labelOff: t('ui.commandPicker.forceWorkflowOff'),
                labelOn: t('ui.commandPicker.forceWorkflowOn'),
                onToggle: () => toggleForced(forcedSlug),
            },
        });
    }
    return items;
}

async function openCommandPicker(
    plugin: ObsidianAgentPlugin,
    category: 'skills' | 'prompts' | 'workflows',
    anchor: HTMLElement,
    panelRoot: HTMLElement,
    handle: import('./chat/InlineChatPanel').InlinePanelHandle,
    getModeSlug: () => string,
): Promise<void> {
    const items = await buildCommandItems(plugin, category, handle, getModeSlug);
    const title = category === 'skills' ? t('ui.inline.searchSkills')
        : category === 'prompts' ? t('ui.inline.searchPrompts')
        : t('ui.inline.searchWorkflows');
    const empty = category === 'skills' ? t('ui.inline.noSkillsInstalled')
        : category === 'prompts' ? t('ui.inline.noCustomPrompts')
        : t('ui.inline.noWorkflowsAvailable');
    const picker = new CommandPicker(items, title, empty);
    picker.show(anchor, panelRoot);
}

/** Short-label helper for the model button (mirrors sidebar:933-940). */
function shortenModelId(id: string): string {
    let s = id;
    if (s.includes('/')) s = s.split('/').pop() ?? s;
    const m = s.match(/(?:^|\.)(?:anthropic|amazon|meta|mistral|cohere|ai21|stability|deepseek|writer|qwen)\.(.+)$/i);
    if (m !== null) s = m[1];
    s = s.replace(/-v\d+(?::\d+)?$/i, '').replace(/:\d+$/, '');
    return s;
}

/**
 * Edge probe over Obsidian metadataCache + ImplicitConnectionService.
 * All four methods are sync per Obsidian-API; the EdgeProbe interface
 * uses sync signatures.
 */
function buildEdgeProbe(plugin: ObsidianAgentPlugin): import('./lookup/LookupEdgeAggregator').EdgeProbe {
    const app = plugin.app;
    const resolveFile = (path: string): import('obsidian').TFile | null => {
        const f = app.vault.getAbstractFileByPath(path);
        return f instanceof (require('obsidian').TFile) ? f as import('obsidian').TFile : null;
    };
    return {
        getOutgoing: (notePath) => {
            const file = resolveFile(notePath);
            if (file === null) return [];
            const cache = app.metadataCache.getFileCache(file);
            if (cache === null || cache === undefined) return [];
            const out: { targetPath: string }[] = [];
            const linkRefs = [...(cache.links ?? []), ...(cache.embeds ?? [])];
            for (const lc of linkRefs) {
                const resolved = app.metadataCache.getFirstLinkpathDest(lc.link, notePath);
                if (resolved !== null) {
                    out.push({ targetPath: resolved.path });
                }
            }
            return out;
        },
        getBacklinks: (notePath) => {
            const file = resolveFile(notePath);
            if (file === null) return [];
            const api = (app.metadataCache as unknown as { getBacklinksForFile?: (f: import('obsidian').TFile) => { data: Record<string, unknown[]> } }).getBacklinksForFile;
            if (typeof api !== 'function') return [];
            try {
                const bl = api.call(app.metadataCache, file);
                if (bl === undefined || bl === null) return [];
                return Object.keys(bl.data).map(sourcePath => ({ sourcePath }));
            } catch (e) {
                console.debug('[inline-edges] getBacklinks failed:', e);
                return [];
            }
        },
        getTags: (notePath) => {
            const file = resolveFile(notePath);
            if (file === null) return [];
            const cache = app.metadataCache.getFileCache(file);
            if (cache === null || cache === undefined) return [];
            const out: string[] = [];
            for (const t of cache.tags ?? []) {
                if (typeof t.tag === 'string') out.push(t.tag);
            }
            const fmTags = cache.frontmatter?.tags;
            if (Array.isArray(fmTags)) {
                for (const t of fmTags) if (typeof t === 'string') out.push(t);
            } else if (typeof fmTags === 'string') {
                out.push(fmTags);
            }
            return out;
        },
        getImplicitNeighbors: (notePath, limit) => {
            const svc = (plugin as unknown as { implicitConnectionService?: { getImplicitNeighbors?: (p: string, l: number) => { path: string; similarity: number }[] } }).implicitConnectionService;
            if (svc === undefined || svc === null) return [];
            const fn = svc.getImplicitNeighbors;
            if (typeof fn !== 'function') return [];
            try {
                return fn.call(svc, notePath, limit);
            } catch (e) {
                console.debug('[inline-edges] getImplicitNeighbors failed:', e);
                return [];
            }
        },
    };
}

function buildSettingsSnapshotProvider(plugin: ObsidianAgentPlugin): () => InlineSettingsSnapshot {
    return () => {
        // Review finding B1 (2026-07-14): canonical providerConfigs[] store
        // first, legacy activeModels[] as fallback. The first-run wizard
        // writes only providerConfigs[] (FIX-26-99-03); reading activeModels
        // alone left this snapshot model-blind after a wizard install.
        const resolved = resolveInlineModelSnapshot(plugin.settings);
        return {
            modelId: resolved.modelId,
            provider: resolved.provider,
            skillIds: [],
            customPromptIds: [],
        };
    };
}

/**
 * Build action-aware callbacks for the legacy InlineActionService
 * trigger path (kept for /coding test wiring + command-palette dispatch
 * shortcuts that bypass the chat panel). The hot path goes through
 * InlineChatOrchestrator.openReviewAndApply which owns the new
 * EditReviewModal flow (EPIC-33 Diff-UX-refresh 2026-06-22). This
 * legacy factory keeps a no-op surface so action.execute() does not
 * crash when no panel handle is present.
 */
function buildActionAwareCallbacks(
    _plugin: ObsidianAgentPlugin,
    actionId: string,
    _ctx: import('./InlineTriggerContext').InlineTriggerContext,
): import('../AgentTask').AgentTaskCallbacks {
    return {
        onText: () => {},
        onToolStart: () => {},
        onToolResult: () => {},
        onComplete: () => {},
        onError: (err) => {
            console.warn(`[inline-action ${actionId}] error:`, err);
        },
    };
}

export interface InlineWiringResult {
    service: InlineActionService;
    orchestrator: InlineChatOrchestrator;
    dispose: () => void;
}

/**
 * One-shot wiring entry. Call from main.ts onload AFTER plugin.settings
 * and plugin.apiHandler have been initialised.
 */
export function wireInlineActions(plugin: ObsidianAgentPlugin): InlineWiringResult {
    const registry = new InlineActionRegistry();
    const resolver = new InlineTriggerResolver({
        getSettingsSnapshot: buildSettingsSnapshotProvider(plugin),
    });
    const editorProbe = buildEditorProbe(plugin);
    const sidebarCtl = buildChatSidebarController(plugin);
    const llmCaller = buildLLMCaller(plugin);
    const semProbe = buildSemanticIndexProbe(plugin);

    // Default action set. Translate / Summarize-length variants are
    // registered as multiple instances so the floating menu lists
    // each one explicitly (matches Notion AI sub-menu shape).
    registry.register(new SendToMainChatAction({ controller: sidebarCtl }));

    // EPIC-33 Lookup-Enhancement: per-panel-session embedding cache,
    // multi-chunk RAG with tier-based scoring, edge-aggregator over
    // metadataCache + ImplicitConnectionService, web-fallback via
    // WebSearchProvider (respects settings.webTools privacy gates).
    const embeddingCache = new EmbeddingCache({ capacity: 16 });
    const vaultRag: VaultRagPipeline | undefined = semProbe !== null
        ? new DefaultVaultRagPipeline({ probe: semProbe, embeddingCache })
        : undefined;
    const edgeAggregator = new LookupEdgeAggregator({ probe: buildEdgeProbe(plugin) });
    const webLookup = new InlineWebLookup({
        getWebSettings: () => {
            const w = plugin.settings.webTools;
            return {
                enabled: w?.enabled === true,
                provider: (w?.provider ?? 'none') as 'brave' | 'tavily' | 'none',
                braveApiKey: w?.braveApiKey ?? '',
                tavilyApiKey: w?.tavilyApiKey ?? '',
            };
        },
    });
    registry.register(new LookupAction({
        caller: llmCaller,
        vaultRagPipeline: vaultRag,
        edgeAggregator,
        webLookup,
        getRagSettings: () => {
            const r = resolveInlineActionsSettings(plugin.settings.inlineActions);
            return {
                enabled: r.vaultRagInLookup,
                confidenceThreshold: r.vaultRagConfidenceThreshold,
                topN: 5,
                webFallbackEnabled: true,
            };
        },
    }));
    registry.register(new RewriteAction({ caller: llmCaller }));
    registry.register(new TranslateAction({ caller: llmCaller, targetLanguage: 'English' }));
    registry.register(new TranslateAction({ caller: llmCaller, targetLanguage: 'German' }));
    registry.register(new SummarizeAction({ caller: llmCaller, length: 'short' }));
    registry.register(new SummarizeAction({ caller: llmCaller, length: 'medium' }));
    registry.register(new FindActionItemsAction({ caller: llmCaller }));
    // free-chat / inline-chat: handled by PanelChatController (not the registry).

    // FEAT-30-07: FEAT-33-08-Skill-Wiring entfernt (InlineSkillFilter/
    // InlineSkillAction bedienten nur den unerreichbaren Legacy-
    // Floating-Menu-Pfad; der Invoker war ein Stub).

    const service = new InlineActionService({
        editorProbe,
        registry,
        resolver,
        menuFactory: (onPick) => new InlineFloatingMenu({
            containerEl: editorProbe.getMenuContainer() ?? plugin.app.workspace.containerEl,
            registry,
            onPick,
        }),
        isEnabled: () => resolveInlineActionsSettings(plugin.settings.inlineActions).enabled,
        buildActionCallbacks: (action, ctx) => buildActionAwareCallbacks(plugin, action.id, ctx),
    });

    // FEAT-33-03: register CodeMirror Diff-Decoration-Extension so
    // Rewrite-Action streams land as inline diff with Accept/Reject.
    try {
        plugin.registerEditorExtension(inlineDiffExtension());
    } catch (e) {
        console.debug('[inline-actions] inline-diff-extension registration failed (non-fatal):', e);
    }

    // FEAT-33-12: register CodeMirror block-widget extension so the inline
    // chat can mount as a real CM6 block decoration. The extension only
    // becomes active when CodeMirrorBlockMount.mount() dispatches its
    // open-effect; idle extensions cost nothing.
    try {
        plugin.registerEditorExtension(inlineChatBlockExtension());
    } catch (e) {
        console.debug('[inline-actions] inline-chat-block-extension registration failed (non-fatal):', e);
    }

    // Mount-adapter singletons. Adapter selection happens per trigger via
    // chooseMountAdapter, so the user's settings choice takes effect
    // without a plugin reload.
    const blockMount = new CodeMirrorBlockMount();
    const popoverMount = new OverlayPopoverMount();

    // FEAT-33-12: live hand-off of inline conversations into the Sidebar.
    // The service is shared across all panels because it is pure-routing
    // (no per-panel state). Each transfer() call snapshots whatever
    // controller is currently active.
    const transferService = new InlineToSidebarTransferService({ plugin });

    // EPIC-33 UX-refresh: trigger opens the InlineChatPanel directly.
    // The legacy InlineActionService.triggerMenu remains available via
    // wiring.service but is no longer the default surface -- panel
    // chat replaces the floating-menu + Notice-toast flow.
    const chatProbe: EditorChatProbe = {
        probe: () => editorProbe.probe(),
        getActiveMarkdownView: () => plugin.app.workspace.getActiveViewOfType(MarkdownView),
        writeBackToSelection: async ({ notePath, from, to, content }) => {
            // EPIC-33 Diff-UX-refresh (2026-06-23): the apply path used to
            // call getActiveViewOfType(MarkdownView) which returns null
            // while the EditReviewModal owns focus -- the edit silently
            // dropped and the note only updated after a vault reload. Now
            // we (1) search ALL open MarkdownView leaves for one showing
            // this note path, (2) fall back to vault.modify + the
            // refreshOpenMarkdownViewsFor helper so the CodeMirror buffer
            // is updated even when no MarkdownView is currently mounted.
            try {
                const leaves = plugin.app.workspace.getLeavesOfType('markdown');
                for (const leaf of leaves) {
                    const view = leaf.view;
                    if (view instanceof MarkdownView && view.file?.path === notePath) {
                        const editor = view.editor;
                        const fromPos = editor.offsetToPos(from);
                        const toPos = editor.offsetToPos(to);
                        editor.replaceRange(content, fromPos, toPos);
                        return true;
                    }
                }
                // Fallback: no open view -- patch the file on disk.
                const file = plugin.app.vault.getAbstractFileByPath(notePath);
                if (file instanceof TFile) {
                    const raw = await plugin.app.vault.read(file);
                    const patched = raw.slice(0, from) + content + raw.slice(to);
                    await plugin.app.vault.modify(file, patched);
                    await refreshOpenMarkdownViewsFor(plugin.app, file, patched);
                    return true;
                }
                return false;
            } catch (e) {
                console.warn('[inline-wiring] writeBackToSelection failed:', e);
                return false;
            }
        },
    };
    const orchestrator = new InlineChatOrchestrator({
        plugin,
        editorProbe: chatProbe,
        registry,
        resolver,
        isEnabled: () => resolveInlineActionsSettings(plugin.settings.inlineActions).enabled,
        chooseMountAdapter: (view) => {
            // AUDIT-FEAT-33-12 #2 fix: in reading view CodeMirror is not
            // active, so the block widget cannot mount. Auto-fall back
            // to popover instead of throwing a notice. Source +
            // live-preview honour the user choice as before.
            //
            // Defensive exception fallback (final-verify sweep): if
            // getMode() or settings access throws (e.g. unusual view
            // shape, plugin onload race), bias toward popoverMount --
            // it works in every mode and avoids stranding the user
            // with a generic "unavailable" notice when block-widget
            // canMount would fail downstream.
            try {
                const mode = view.getMode();
                if (mode === 'preview') return popoverMount;
                const choice = resolveInlineActionsSettings(plugin.settings.inlineActions).inlineChatDisplay;
                return choice === 'popover-overlay' ? popoverMount : blockMount;
            } catch (e) {
                console.debug('[inline-actions] chooseMountAdapter fell back to popover after exception:', e);
                return popoverMount;
            }
        },
        transferService,
        setIcon: (el, name) => setIcon(el, name),
        buildSurface: (panelRoot, chipBar) => buildPanelSurface(plugin, panelRoot, chipBar),
        setActiveSurface: (s) => setActivePanelSurface(s as never),
        // Markdown rendering bridge: replaces the plain-text bubble with
        // rendered Obsidian markdown once the stream completes. Wikilinks
        // are wired through app.workspace.openLinkText so they navigate
        // to the target note in the active leaf instead of falling through
        // as inert anchors. Same pattern as AgentSidebarView.wireInternalLinks.
        renderMarkdown: async (containerEl, markdown) => {
            const sourcePath = plugin.app.workspace.getActiveFile()?.path ?? '';
            const component = new Component();
            try {
                // AUDIT-2026-08-14 H-1: same egress guard the sidebar has run
                // since AUDIT 2026-07-26 H-5. Everything rendered into a chat
                // is untrusted here -- LLM output, tool results carrying vault
                // notes, fetched web pages, MCP responses -- and markdown image
                // syntax turns that into a zero-click outbound request with
                // vault content in the query string. The inline chat arrived
                // after the sidebar fix and never received it, which silently
                // falsified the sidebar's "single chokepoint" claim.
                // It must run on the STRING: an <img> starts fetching the
                // moment its src is set, so a post-render sweep is too late.
                const safeMarkdown = neutraliseRemoteResources(markdown);
                await MarkdownRenderer.render(plugin.app, safeMarkdown, containerEl, sourcePath, component);
                wireInternalLinks(plugin, containerEl);
            } finally {
                component.unload();
            }
        },
        showMoreMenu: (anchor, _ctx, _handle, dispatch) => {
            // Obsidian Menu with the secondary actions. Lookup is on
            // the toolbar (magnifier) so it does NOT appear here again.
            const menu = new Menu();
            menu.addItem(item => item
                .setTitle(t('ui.inline.menuRewrite'))
                .setIcon('pencil')
                .onClick(() => dispatch('rewrite')));
            menu.addItem(item => item
                .setTitle(t('ui.inline.menuTranslateSelection'))
                .setIcon('languages')
                .onClick(() => dispatch('translate')));
            menu.addItem(item => item
                .setTitle(t('ui.inline.menuSummarizeMedium'))
                .setIcon('file-text')
                .onClick(() => dispatch('summarize')));
            menu.addItem(item => item
                .setTitle(t('ui.inline.menuFindActionItems'))
                .setIcon('check-square')
                .onClick(() => dispatch('find-action-items')));
            // 'Send selection to main chat' retired 2026-06-22 per user
            // feedback -- the panel IS the chat surface now, there is
            // nowhere meaningful to forward to. The registered action
            // stays available for callers that need it programmatically.
            menu.showAtMouseEvent({
                clientX: anchor.getBoundingClientRect().left,
                clientY: anchor.getBoundingClientRect().bottom,
            } as MouseEvent);
        },
        // Plus menu mirrors the sidebar: attach file, add vault file,
        // insert skill/prompt/workflow via the searchable CommandPicker,
        // and the shared tools & MCP picker (ToolPickerPopover,
        // IMP-02-12-02). Per-panel state lives in panelSurface (built at
        // panel-open and threaded through the dispatch callbacks).
        showPlusMenu: (anchor, _ctx, handle) => {
            const surface = activePanelSurface;
            if (surface === null) return;
            const menu = new Menu();
            menu.addItem(item => item
                .setTitle(t('ui.sidebar.attachFile'))
                .setIcon('paperclip')
                .onClick(() => surface.attachments.openFilePicker()));
            menu.addItem(item => item
                .setTitle(t('ui.sidebar.addVaultFile'))
                .setIcon('at-sign')
                .onClick(() => surface.vaultFilePicker.show(anchor, surface.panelRoot)));
            menu.addSeparator();
            menu.addItem(item => item
                .setTitle(t('ui.inline.insertSkill'))
                .setIcon('sparkles')
                .onClick(() => void openCommandPicker(plugin, 'skills', anchor, surface.panelRoot, handle, () => orchestrator.getActiveModeSlug())));
            menu.addItem(item => item
                .setTitle(t('ui.inline.insertPrompt'))
                .setIcon('message-square-quote')
                .onClick(() => void openCommandPicker(plugin, 'prompts', anchor, surface.panelRoot, handle, () => orchestrator.getActiveModeSlug())));
            menu.addItem(item => item
                .setTitle(t('ui.inline.insertWorkflow'))
                .setIcon('workflow')
                .onClick(() => void openCommandPicker(plugin, 'workflows', anchor, surface.panelRoot, handle, () => orchestrator.getActiveModeSlug())));
            // IMP-02-12-02: restore the MCP/tool access the deleted
            // McpServerPopover used to provide -- same picker as the sidebar.
            menu.addSeparator();
            menu.addItem(item => item
                .setTitle(t('ui.sidebar.selectTools'))
                .setIcon('pocket-knife')
                .onClick((evt) => { void (async () => {
                    const ms = await orchestrator.getReadyModeService();
                    if (ms === null) return;
                    surface.toolPicker ??= new ToolPickerPopover(plugin, ms);
                    surface.toolPicker.show(evt as MouseEvent, anchor, surface.panelRoot);
                })(); }));
            menu.showAtMouseEvent({
                clientX: anchor.getBoundingClientRect().left,
                clientY: anchor.getBoundingClientRect().bottom,
            } as MouseEvent);
        },
        showModelMenu: (anchor, _ctx, handle) => {
            // Mirrors AgentSidebarView.showModelMenu (sidebar:862-924).
            // EPIC-26 provider-architecture: when an active provider is
            // resolved, open the searchable ChatModelPickerPopover.
            // Legacy activeModels[] is the fallback for pre-migration users.
            const surface = activePanelSurface;
            if (surface === null) return;
            const activeProvider = resolveActiveProvider(plugin.settings);
            if (activeProvider !== null) {
                const popover = surface.modelPicker;
                if (popover.isOpen()) { popover.close(); return; }
                popover.show(
                    { clientX: anchor.getBoundingClientRect().left, clientY: anchor.getBoundingClientRect().bottom } as MouseEvent,
                    anchor,
                    surface.panelRoot,
                    activeProvider,
                    {
                        getCurrent: () => surface.chatModelOverride,
                        onSelect: (overrideId: string | null) => {
                            surface.chatModelOverride = overrideId;
                            // FIX-24-05-08 (D7): Auto names the model the tier
                            // router picked, not just the word "Auto". Same
                            // helper as the sidebar pill, so the two surfaces
                            // cannot disagree about what is running.
                            const label = overrideId === null
                                ? autoModelLabel(plugin.settings).label
                                : shortenModelId(overrideId);
                            handle.setModelLabel(label, overrideId ?? t('ui.inline.modelAutoTooltip'));
                        },
                        getThinking: () => surface.chatThinkingOverride,
                        onThinkingChange: (override) => {
                            surface.chatThinkingOverride = override;
                        },
                        getEffort: () => surface.chatEffortOverride,
                        onEffortChange: (override) => {
                            surface.chatEffortOverride = override;
                        },
                        getEffortLevels: () => [],
                    },
                );
                return;
            }
            // Legacy fallback.
            const enabled = plugin.settings.activeModels.filter(m => m.enabled !== false);
            const menu = new Menu();
            if (enabled.length === 0) {
                menu.addItem(item => item
                    .setTitle(t('ui.sidebar.noModelsEnabled'))
                    .setIcon('settings')
                    .onClick(() => {
                        plugin.app.setting?.open();
                    }));
            } else {
                const currentKey = plugin.settings.activeModelKey;
                enabled.forEach(model => {
                    const key = getModelKey(model);
                    const label = model.displayName ?? model.name;
                    menu.addItem(item => item
                        .setTitle(label)
                        .setChecked(currentKey === key)
                        .onClick(async () => {
                            plugin.settings.activeModelKey = key;
                            await plugin.saveSettings();
                            handle.setModelLabel(label, label);
                        }));
                });
            }
            menu.showAtMouseEvent({
                clientX: anchor.getBoundingClientRect().left,
                clientY: anchor.getBoundingClientRect().bottom,
            } as MouseEvent);
        },
        getInitialModelLabel: () => {
            // EPIC-26: when a provider is active, the panel mirrors the
            // sidebar pattern "Auto" (default) or the user's pinned
            // override id.
            const activeProvider = resolveActiveProvider(plugin.settings);
            if (activeProvider !== null) {
                // FIX-24-05-08 (D7): resolved model in the label, and the
                // click-hint tooltip stays, because that hint is what the panel
                // pill needs first.
                return {
                    label: autoModelLabel(plugin.settings).label,
                    tooltip: t('ui.inline.modelAutoPickTooltip'),
                };
            }
            const key = plugin.settings.activeModelKey;
            const model = plugin.settings.activeModels.find(m => getModelKey(m) === key);
            if (model !== undefined) {
                const label = model.displayName ?? model.name;
                return { label, tooltip: label };
            }
            // FIX-24-05-08: nothing is selected on the legacy path, so the pill
            // said "Auto" for a router that is not even running. Name the state.
            return { label: t('ui.sidebar.noModel'), tooltip: t('ui.inline.noModelSelectedTooltip') };
        },
        // EPIC-33: per-panel AutocompleteHandler. addVaultFile resolves
        // the active panel surface so '@'-mention picks land in the
        // panel's attachment chip bar (real attachments, not stubs).
        //
        // Portal fix (user feedback 2026-06-24): the inline block widget
        // lives inside CM6's editor layout, which clips the dropdown to
        // ~1-2 rows. Sidebar shows the full 7-row dropdown because no
        // ancestor clips. We replicate the sidebar behaviour by moving
        // the dropdown DOM node OUT of the composer into the workspace
        // root the moment AutocompleteHandler creates it, and positioning
        // it `fixed` anchored to the composer's bounding rect. Pure DOM
        // operation -- AutocompleteHandler is unchanged.
        autocompleteFactory: (textarea, inputArea) => {
            const handler = new AutocompleteHandler(
                plugin,
                plugin.app,
                () => textarea,
                () => inputArea,
                async (file) => {
                    if (activePanelSurface !== null) {
                        await activePanelSurface.attachments.addVaultFile(file);
                    }
                },
                // FEAT-02-11: folder-mention manifest.
                async (folder, opts) => {
                    if (activePanelSurface !== null) {
                        await activePanelSurface.attachments.addVaultFolder(folder, opts);
                    }
                },
            );
            installAutocompletePortal(plugin, inputArea);
            return handler;
        },
    });

    // Selection-affordance pill: opt-in via inlineActions.floatingMenuEnabled
    // (default OFF). On settled selection a small slash-square icon
    // appears next to the selection; click opens the inline chat via
    // orchestrator.triggerPanel(). The pill does NOT steal focus, the
    // selection stays alive, so Cmd+C / Cmd+B / the live-preview format
    // toolbar all keep working in parallel. User feedback 2026-06-24:
    // the previous auto-open behaviour hijacked native selection actions.
    const selectionPill = new InlineActionPill({
        target: plugin.app.workspace.containerEl,
        onClick: () => orchestrator.triggerPanel(),
    });
    const selectionWatcher = new SelectionWatcher({
        target: plugin.app.workspace.containerEl,
        onSettled: () => selectionPill.show(),
        isEnabled: () => {
            const s = resolveInlineActionsSettings(plugin.settings.inlineActions);
            return s.enabled === true && s.floatingMenuEnabled === true;
        },
    });
    selectionWatcher.start();

    return {
        service,
        orchestrator,
        dispose: () => {
            selectionWatcher.dispose();
            selectionPill.dispose();
            orchestrator.dispose();
            service.dispose();
            // AUDIT-EPIC-33 L-05: drop cached embeddings from RAM on
            // plugin unload so the in-process LRU does not outlive the
            // session.
            embeddingCache.clear();
        },
    };
}
/* eslint-enable -- end of file-level disable for the Obsidian-API wiring layer */
