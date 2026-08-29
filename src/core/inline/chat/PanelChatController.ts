/**
 * PanelChatController -- Sidebar-style chat session driver for the InlineChatPanel (EPIC-33).
 *
 * Drives the SAME agent loop the Sidebar uses, just from the inline
 * panel surface. Per user spec: "es ist der SELBE LOOP, nur aus einer
 * anderen Stelle / UI angesprochen."
 *
 * Parity bundle (wired through buildAgentRuntimeContext):
 *   - rulesContent, skillDirectorySection, pluginSkillsSection,
 *     memoryContext (Memory v2 ContextComposer + SoulView + sessions
 *     + onboarding prompt), recipesSection + recipeMatches.
 *   - configDir, globalCustomInstructions, includeTime, mcpClient.
 *   - Per-panel ModeService instance so per-mode role-definitions,
 *     mode-specific tool sets, and switch_mode all work identically.
 *   - Steering: live steeringQueue drained at every iteration start
 *     so mid-run user typing reaches the model.
 *   - AbortSignal for the panel's stop button.
 *
 * The selection is prepended to the FIRST user turn as a `<context>`
 * block so the model knows what the user is referring to. Follow-up
 * turns send raw user input.
 *
 * Related: AgentRuntimeContext (shared engine), composerExpansion
 *          (shared slash/prompt/workflow expansion),
 *          AgentSidebarView.handleSendMessage (the original loop).
 */

import type { MessageParam, ContentBlock } from '../../../api/types';
import type { AgentTaskCallbacks } from '../../AgentTask';
import { AgentTaskRunner } from '../../agent/AgentTaskRunner';
import { ModeService } from '../../modes/ModeService';
import { buildAgentRuntimeContext } from '../../agent/AgentRuntimeContext';
import type { ConversationStore, UiMessage } from '../../history/ConversationStore';
import { getModelKey, modelToLLMProvider } from '../../../types/settings';
import { resolveActiveProvider, resolveTierModel } from '../../routing/tierResolution';
import { buildApiHandler, buildApiHandlerForModel } from '../../../api/index';
import { buildPinnedCustomModel } from '../../../ui/sidebar/chatModelDropdown';
import { TaskMonitor } from '../../../ui/sidebar/TaskMonitor';
import { isExplicitThinkingOverride, resolveEffectiveThinkingEnabled } from '../../../ui/sidebar/thinkingOverride';
import { t } from '../../../i18n';
import { Notice } from 'obsidian';
import type ObsidianAgentPlugin from '../../../main';
import type { InlineTriggerContext } from '../InlineTriggerContext';
import type { InlinePanelHandle } from './InlineChatPanel';
import { applyForcedWorkflow, shouldApplyForcedWorkflow } from '../../../ui/sidebar/forcedWorkflow';

/**
 * Hard cap on inline-chat turns per ADR-143 ("maximal 20 Turns").
 * Reached when the conversation has accumulated 20 user/assistant pairs
 * inside one panel session. Beyond that the panel emits a Notice and
 * refuses further turns so the inline-chat block in the note stays
 * readable and token-cost stays bounded. Audit ref: AUDIT-EPIC-33 M-04.
 */
export const INLINE_TURN_CAP = 20;

export interface PanelChatControllerOptions {
    plugin: ObsidianAgentPlugin;
    ctx: InlineTriggerContext;
    /**
     * Optional access to the panel's AttachmentHandler -- when set, the
     * controller pulls pending attachments at send time and clears them
     * after dispatch (sidebar pattern).
     */
    getAttachments?: () => { pending: Array<{ block: ContentBlock }>; clear: () => void } | null;
    /**
     * FIX-30-07-05: per-panel model pin state (model id + thinking +
     * effort) from the active PanelSurface. Without it the inline pin was
     * cosmetic: the picker stored the choice, but the runner always got
     * the global plugin.apiHandler.
     */
    getModelPin?: () => {
        modelOverride: string | null;
        thinkingOverride: import('../../../ui/sidebar/thinkingOverride').ThinkingOverride;
        effortOverride: import('../../../ui/sidebar/effortOverride').EffortOverride;
    } | null;
    /**
     * Hook the AgentTask checkpoint-pipeline emits into. Every write-
     * tool snapshot (write_file, edit_file, append_to_file, etc.)
     * fires once per checkpoint. The orchestrator turns the payload
     * into an inline checkpoint marker so the panel mirrors the
     * sidebar's live-marker behaviour during free-chat turns.
     */
    onCheckpoint?: (
        checkpoint: import('../../checkpoints/GitCheckpointService').CheckpointInfo,
        handle: import('./InlineChatPanel').InlinePanelHandle,
    ) => void;
}

export class PanelChatController {
    private readonly plugin: ObsidianAgentPlugin;
    private readonly ctx: InlineTriggerContext;
    private readonly modeService: ModeService;
    private readonly getAttachments?: () => { pending: Array<{ block: ContentBlock }>; clear: () => void } | null;
    private readonly getModelPin?: PanelChatControllerOptions['getModelPin'];
    private readonly onCheckpointHook?: (
        checkpoint: import('../../checkpoints/GitCheckpointService').CheckpointInfo,
        handle: import('./InlineChatPanel').InlinePanelHandle,
    ) => void;
    /**
     * In-memory chat history reused across turns (AgentTask mutates
     * in place). Mirrors AgentSidebarView.conversationHistory.
     */
    private readonly history: MessageParam[] = [];
    /** UI-message log (mirrors AgentSidebarView.uiMessages). */
    private readonly uiMessages: UiMessage[] = [];
    /** ConversationStore id assigned on first turn -- panel chats appear in main history. */
    private activeConversationId: string | null = null;
    /** Mid-run user-typed messages, drained at the next iteration. */
    private readonly steeringQueue: string[] = [];
    private abortController: AbortController | null = null;
    private turnCounter = 0;
    private running = false;
    private modeServiceReady: Promise<void> | null = null;
    /** Forced-workflow slugs already warned about being inapplicable, so the notice fires once per slug (mirrors the sidebar, FEAT-02-12). */
    private readonly forcedWorkflowWarned = new Set<string>();
    /**
     * Session-scoped taskId for every checkpoint created during this
     * panel lifetime. Generated ONCE upfront and never rewritten --
     * any later re-key would orphan all checkpoints stamped before
     * the switch. The same id is used by:
     *   - openReviewAndApply (quick-action Rewrite/Translate checkpoints)
     *   - runner.execute taskId (free-chat agent checkpoints)
     *   - persisted UiMessage.taskId (so sidebar history rehydrate
     *     re-renders the markers when the conversation is reopened)
     */
    private readonly sessionTaskId: string;

    constructor(options: PanelChatControllerOptions) {
        this.plugin = options.plugin;
        this.ctx = options.ctx;
        this.getModelPin = options.getModelPin;
        // Own ModeService instance per controller. ModeService is
        // plugin-stateless (lazy toolRegistry access) so a fresh
        // instance is safe and the sidebar's instance stays unchanged.
        this.modeService = new ModeService(options.plugin);
        this.getAttachments = options.getAttachments;
        this.onCheckpointHook = options.onCheckpoint;
        this.sessionTaskId = `inline-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffff).toString(16)}`;
    }

    /**
     * Stable task id for every checkpoint snapshotted during this
     * panel session. Used by InlineChatOrchestrator when calling
     * checkpointService.snapshot, and stamped onto the persisted
     * assistant UiMessage so the sidebar's history-rehydrate path can
     * surface the same checkpoints when the conversation is reopened.
     */
    getInlineTaskId(): string {
        return this.sessionTaskId;
    }

    get isRunning(): boolean { return this.running; }
    get isModeReady(): boolean { return this.modeServiceReady !== null; }

    /**
     * The mode slug this panel's turns actually run under: currentMode resolved
     * through the ModeService fallback (a deleted or invalid slug resolves to
     * 'agent'). The forced-workflow pin, chip, and send path all key on this so
     * they cannot diverge (FEAT-02-12 review fix).
     */
    getActiveModeSlug(): string {
        return this.modeService.getActiveMode().slug;
    }

    /**
     * The panel's ModeService, guaranteed initialized (global modes loaded).
     * Shared by the send path and the inline tool picker (IMP-02-12-02) --
     * handing out an uninitialized instance would make the picker's
     * unknown-mode fallback overwrite currentMode for global custom modes.
     */
    async getReadyModeService(): Promise<ModeService> {
        if (this.modeServiceReady === null) {
            this.modeServiceReady = this.modeService.initialize();
        }
        await this.modeServiceReady;
        return this.modeService;
    }

    /**
     * FEAT-33-12: snapshot the running conversation for hand-off to the
     * Sidebar. Returns the same shapes the Sidebar already uses
     * (conversationHistory + uiMessages + activeConversationId) so the
     * importConversation path can reuse its load/render flow without
     * any translation layer.
     *
     * Callers MUST guard via isRunning before calling: importing a
     * conversation while the agent loop is mid-stream would leave two
     * live writers on the same UI message list.
     */
    getTransferState(): {
        conversationId: string | null;
        history: MessageParam[];
        uiMessages: UiMessage[];
        sessionTaskId: string;
    } {
        return {
            conversationId: this.activeConversationId,
            // Defensive copies so the sidebar can mutate freely after takeover.
            history: this.history.map((m) => ({ ...m })),
            uiMessages: this.uiMessages.map((m) => ({ ...m })),
            sessionTaskId: this.sessionTaskId,
        };
    }

    /**
     * Returns true when the conversation has reached the per-block
     * turn cap. The orchestrator queries this before dispatching a new
     * quick-action or sendTurn so the user sees a single explanatory
     * Notice instead of a silently failing call.
     */
    isAtTurnCap(): boolean {
        const turns = Math.floor(this.uiMessages.length / 2);
        return turns >= INLINE_TURN_CAP;
    }

    /**
     * Drop a steering message onto the queue. AgentTask drains via
     * the consumeSteeringMessages callback at every iteration start.
     * Returns false if no turn is currently running -- caller should
     * either treat the input as a normal send or queue it for later.
     */
    pushSteering(text: string): boolean {
        if (this.running !== true) return false;
        const trimmed = text.trim();
        if (trimmed.length === 0) return false;
        this.steeringQueue.push(trimmed);
        return true;
    }

    async sendTurn(args: {
        userInput: string;
        handle: InlinePanelHandle;
        assistantBubbleId: string;
    }): Promise<void> {
        if (this.running === true) {
            args.handle.setStatus('Already running -- wait for the current turn to finish.', 'error');
            return;
        }
        if (this.isAtTurnCap() === true) {
            args.handle.setStatus(`Inline chat reached ${INLINE_TURN_CAP}-turn cap. Open the sidebar to continue this thread.`, 'error');
            new Notice(t('notice.inlineChat.turnCapReached', { cap: INLINE_TURN_CAP }));
            return;
        }
        this.running = true;
        this.abortController = new AbortController();
        this.turnCounter += 1;

        // Lazy ModeService init (idempotent).
        await this.getReadyModeService();

        // Slash/prompt/workflow expansion (shared with sidebar).
        const expansionMod = await import('./composerExpansion');
        const activeFile = this.plugin.app.workspace.getActiveFile?.();
        const expanded = await expansionMod.expandComposerPrefix(this.plugin, {
            text: args.userInput,
            activeFilePath: activeFile?.path,
            activeFileName: activeFile?.name,
        });
        const effectiveInput = expanded ?? args.userInput;

        let userMessage = this.buildUserMessage(effectiveInput);

        // FEAT-02-12: apply this agent's forced workflow (if any) on the inline
        // send path too, via the same pure helpers as the sidebar. Prepend to the
        // built message so the #/§ expansion and vault context survive; a user
        // /#§ command stands back; a deleted workflow warns once instead of
        // silently sending plain text. Keyed on the RESOLVED mode slug (not raw
        // currentMode) so the workflow matches the mode the turn actually runs
        // under -- a deleted mode falls back to 'agent' in both places.
        const forcedSlug = this.plugin.settings.forcedWorkflow?.[this.getActiveModeSlug()] ?? '';
        if (shouldApplyForcedWorkflow(args.userInput, forcedSlug)) {
            const loader = this.plugin.workflowLoader;
            const instructions = loader
                ? await loader.loadInstructions(forcedSlug, this.plugin.settings.workflowToggles ?? {})
                : null;
            if (instructions !== null) {
                userMessage = applyForcedWorkflow(userMessage, instructions);
                this.forcedWorkflowWarned.delete(forcedSlug);
            } else if (!this.forcedWorkflowWarned.has(forcedSlug)) {
                this.forcedWorkflowWarned.add(forcedSlug);
                new Notice(t('notice.forcedWorkflowUnavailable', { slug: forcedSlug }));
            }
        }

        if (this.plugin.apiHandler === null) {
            args.handle.setStatus('No API handler configured. Open Settings and set up a provider.', 'error');
            this.running = false;
            this.abortController = null;
            return;
        }

        // Build runtime context (shared engine -- identical to sidebar).
        const mode = this.modeService.getActiveMode();
        const isFirstMessage = this.history.length === 0;
        // EPIC-33 history-parity: create a ConversationStore entry on the
        // first turn so the inline panel chat appears in Vault Operator's
        // main history list alongside sidebar chats. The conversation id
        // is reused across all subsequent turns of this panel session.
        // BUGFIX 2026-06-22: ConversationStore is declared `null` (not
        // undefined) on the plugin -- the earlier undefined-only check
        // dispatched into the null path and create() crashed silently,
        // so the activeConversationId stayed null and save() bailed.
        // EPIC-33 history-parity: direct typed access (no cast).
        const convStore: ConversationStore | null = (this.plugin as { conversationStore?: ConversationStore | null }).conversationStore ?? null;
        if (this.activeConversationId === null) {
            if (convStore === null) {
                console.warn('[PanelChatController] plugin.conversationStore is null -- chat will NOT persist. Likely plugin not fully loaded.');
                new Notice(t('notice.inlineChat.historyStoreNotReady'));
            } else {
                try {
                    const modelDisplay = this.resolveConversationModelDisplay();
                    this.activeConversationId = await convStore.create(mode.slug, modelDisplay);
                    console.debug(`[PanelChatController] conversation created: ${this.activeConversationId} (mode=${mode.slug}, model=${modelDisplay})`);
                } catch (e) {
                    console.error('[PanelChatController] conversationStore.create FAILED:', e);
                    new Notice(t('notice.inlineChat.historyCreateFailed', { error: e instanceof Error ? e.message : String(e) }));
                }
            }
        }
        // Track UI message (parallel to history so the store can rehydrate).
        this.uiMessages.push({ role: 'user', text: args.userInput, ts: new Date().toISOString() });

        const runtime = await buildAgentRuntimeContext(this.plugin, {
            userText: args.userInput,
            mode,
            isFirstMessage,
            activeConversationId: this.activeConversationId ?? undefined,
        });

        // FIX-30-07-05: honour the panel's model pin exactly like the
        // sidebar does. buildPinnedCustomModel is the shared resolver, so
        // thinking + pin-only effort semantics stay identical on both
        // surfaces; on any build failure we fall back to the global handler.
        let resolvedApiHandler = this.plugin.apiHandler;
        let modelOverrideActive = false;
        const pin = this.getModelPin?.() ?? null;
        if (pin?.modelOverride) {
            const pinnedModel = buildPinnedCustomModel(
                resolveActiveProvider(this.plugin.settings),
                pin.modelOverride,
                pin.thinkingOverride,
                pin.effortOverride,
            );
            if (pinnedModel) {
                try {
                    resolvedApiHandler = buildApiHandlerForModel(pinnedModel);
                    modelOverrideActive = true;
                } catch (e) {
                    console.warn('[PanelChatController] pinned-model handler build failed, using default:', e);
                    resolvedApiHandler = this.plugin.apiHandler;
                }
            }
        }
        // Review-Finding: ein explizites Thinking-On/Off darf nicht verworfen
        // werden, wenn KEIN Modell gepinnt ist ODER der Pin nicht mehr
        // aufloesbar ist (buildPinnedCustomModel = null). Spiegel des
        // Sidebar-Default-Active-Pfads: Handler aus dem Default-Modell mit
        // angewandtem Thinking-Override neu bauen. Effort bleibt pin-only.
        if (!modelOverrideActive && pin && isExplicitThinkingOverride(pin.thinkingOverride)) {
            const defaultTier = this.plugin.settings.defaultMainModelTier ?? 'mid';
            const defaultModel = this.plugin.getTierModel(defaultTier) ?? this.plugin.getActiveModel();
            if (defaultModel) {
                try {
                    resolvedApiHandler = buildApiHandler(modelToLLMProvider({
                        ...defaultModel,
                        thinkingEnabled: resolveEffectiveThinkingEnabled(
                            pin.thinkingOverride,
                            defaultModel.thinkingEnabled,
                        ),
                    }));
                } catch (e) {
                    console.warn('[PanelChatController] thinking-override handler build failed, using default:', e);
                    resolvedApiHandler = this.plugin.apiHandler;
                }
            }
        }

        // FIX-24-05-09 (D10): built here, not above the pin resolution, because
        // the monitor has to see the handler the run actually uses. Moved down
        // from before the apiHandler null-check, where it was built from a
        // handler this turn might not run on; nothing read it in between.
        const callbacks = this.buildCallbacks(
            args.handle, args.assistantBubbleId, mode.slug, resolvedApiHandler, args.userInput,
        );

        try {
            const runner = new AgentTaskRunner({
                api: resolvedApiHandler,
                modelOverrideActive,
                toolRegistry: this.plugin.toolRegistry,
                callbacks,
                modeService: this.modeService,
                consecutiveMistakeLimit: this.plugin.settings.advancedApi?.consecutiveMistakeLimit ?? 0,
                rateLimitMs: this.plugin.settings.advancedApi?.rateLimitMs ?? 0,
                condensingEnabled: this.plugin.settings.advancedApi?.condensingEnabled ?? true,
                condensingThreshold: this.plugin.settings.advancedApi?.condensingThreshold ?? 80,
                powerSteeringFrequency: this.plugin.settings.advancedApi?.powerSteeringFrequency ?? 0,
                maxIterations: this.plugin.settings.advancedApi?.maxIterations ?? 25,
                maxSubtaskDepth: this.plugin.settings.advancedApi?.maxSubtaskDepth ?? 2,
                microcompactionEnabled: this.plugin.settings.advancedApi?.microcompactionEnabled ?? true,
                rollingSummaryThreshold: this.plugin.settings.advancedApi?.rollingSummaryThreshold ?? 50,
            });

            await runner.execute({
                userMessage,
                // Stable session taskId so every checkpoint snapshotted
                // during this panel session shares one bucket -- the
                // same id is stamped onto the persisted UiMessage so
                // sidebar history rehydrate can rebuild the markers.
                taskId: this.sessionTaskId,
                initialMode: mode,
                history: this.history,
                abortSignal: this.abortController.signal,
                globalCustomInstructions: this.plugin.settings.globalCustomInstructions || undefined,
                includeTime: this.plugin.settings.includeCurrentTimeInContext ?? false,
                rulesContent: runtime.rulesContent,
                skillDirectorySection: runtime.skillDirectorySection,
                mcpClient: (this.plugin as unknown as { mcpClient?: import('../../mcp/McpClient').McpClient }).mcpClient,
                allowedMcpServers: runtime.allowedMcpServers,
                memoryContext: runtime.memoryContext,
                pluginSkillsSection: runtime.pluginSkillsSection,
                recipesSection: runtime.recipesSection,
                recipeMatches: runtime.recipeMatches,
                configDir: this.plugin.app.vault.configDir,
                conversationId: this.activeConversationId ?? undefined,
            });
            // Persist the turn (assistant message taken from history tail).
            const tail = this.history[this.history.length - 1];
            if (tail !== undefined && tail.role === 'assistant') {
                const tailText = typeof tail.content === 'string'
                    ? tail.content
                    : Array.isArray(tail.content)
                        ? tail.content.map(c => (c as { type?: string; text?: string }).type === 'text' ? (c as { text?: string }).text ?? '' : '').join('')
                        : '';
                this.uiMessages.push({
                    role: 'assistant',
                    text: tailText,
                    ts: new Date().toISOString(),
                    taskId: this.sessionTaskId,
                });
            }
            await this.persistConversation(convStore);
            // Fire a workspace event so an open Sidebar / HistoryPanel
            // refreshes its conversation list immediately (the user
            // would otherwise have to close + reopen to see the new
            // inline-chat entry).
            try {
                const evt = new CustomEvent('vault-operator:conversation-list-changed', {
                    detail: { id: this.activeConversationId, source: 'inline-panel' },
                });
                this.plugin.app.workspace.containerEl.dispatchEvent(evt);
            } catch (e) {
                console.debug('[PanelChatController] dispatch refresh event failed:', e);
            }
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            args.handle.setStatus(`Error: ${err.message}`, 'error');
        } finally {
            this.running = false;
            this.abortController = null;
        }
    }

    /** Abort an in-flight turn (Stop button click, panel close, Esc). */
    abort(): void {
        if (this.abortController !== null) {
            this.abortController.abort();
            this.abortController = null;
        }
        this.steeringQueue.length = 0;
        this.running = false;
    }

    dispose(): void { this.abort(); }

    /**
     * Persist a quick-action turn (Lookup / Translate / Summarize /
     * Rewrite / Find-Action-Items) to the same ConversationStore the
     * free-chat path uses. Quick-actions bypass the AgentTaskRunner
     * loop (they run via a single InlineLLMCaller stream in the
     * orchestrator), so they would otherwise never reach the history
     * list. This entry-point gives them parity: same store entry,
     * same history index, same conversation-id continuity across
     * subsequent free-chat turns within the panel session.
     */
    async recordQuickAction(args: {
        actionLabel: string;
        userText: string;
        assistantText: string;
    }): Promise<void> {
        if (this.isAtTurnCap() === true) {
            console.debug(`[PanelChatController] quick-action dropped: ${INLINE_TURN_CAP}-turn cap reached`);
            new Notice(t('notice.inlineChat.turnCapQuickAction', { cap: INLINE_TURN_CAP }));
            return;
        }
        const convStore: ConversationStore | null = (this.plugin as { conversationStore?: ConversationStore | null }).conversationStore ?? null;
        if (convStore === null) {
            console.warn('[PanelChatController] recordQuickAction: no conversationStore');
            return;
        }
        const mode = this.modeService.getActiveMode();
        if (this.activeConversationId === null) {
            try {
                const modelDisplay = this.resolveConversationModelDisplay();
                this.activeConversationId = await convStore.create(mode.slug, modelDisplay);
                console.debug(`[PanelChatController] quick-action conversation created: ${this.activeConversationId}`);
            } catch (e) {
                console.error('[PanelChatController] recordQuickAction create FAILED:', e);
                new Notice(t('notice.inlineChat.historyCreateFailed', { error: e instanceof Error ? e.message : String(e) }));
                return;
            }
        }
        // Append-only: each quick-action becomes one user + one
        // assistant message pair in the same conversation. The user
        // bubble carries the action label + the selection so the
        // history reader sees WHAT was asked, not just the answer.
        const sel = this.ctx.selectionText.trim();
        const userBody = sel.length > 0
            ? `[${args.actionLabel}] ${args.userText.trim().length > 0 ? args.userText + '\n\n' : ''}Selection:\n${sel}`
            : `[${args.actionLabel}] ${args.userText}`;
        const ts = new Date().toISOString();
        this.uiMessages.push({ role: 'user', text: userBody, ts });
        this.uiMessages.push({ role: 'assistant', text: args.assistantText, ts, taskId: this.sessionTaskId });
        // Mirror into MessageParam[] so the LLM history is consistent
        // when the user follows up via the sidebar. Simple text-only
        // blocks -- no tool_use round-trips for quick-actions.
        this.history.push({ role: 'user', content: userBody });
        this.history.push({ role: 'assistant', content: args.assistantText });
        await this.persistConversation(convStore);
        try {
            const evt = new CustomEvent('vault-operator:conversation-list-changed', {
                detail: { id: this.activeConversationId, source: 'inline-panel-quick' },
            });
            this.plugin.app.workspace.containerEl.dispatchEvent(evt);
        } catch (e) {
            console.debug('[PanelChatController] dispatch quick-action refresh event failed:', e);
        }
    }

    /**
     * Resolve the model display name stamped on a new ConversationStore
     * entry. Review finding B1 (2026-07-14): the canonical providerConfigs[]
     * store is read first (same tier slot initApiHandler uses), the legacy
     * activeModels[] lookup stays as fallback for not-yet-migrated setups.
     * The first-run wizard writes only providerConfigs[] (FIX-26-99-03);
     * reading activeModels alone stamped 'inline-chat' after a wizard install.
     */
    private resolveConversationModelDisplay(): string {
        const settings = this.plugin.settings;
        const canonical = resolveTierModel(settings, settings.defaultMainModelTier ?? 'mid');
        if (canonical) return canonical.displayName ?? canonical.name;
        const modelKey = settings.activeModelKey;
        const model = settings.activeModels.find(m => getModelKey(m) === modelKey);
        return model?.displayName ?? model?.name ?? modelKey ?? 'inline-chat';
    }

    private async persistConversation(
        convStore: ConversationStore | null,
    ): Promise<void> {
        if (convStore === null) {
            console.warn('[PanelChatController] persistConversation: no store');
            return;
        }
        if (this.activeConversationId === null) {
            console.warn('[PanelChatController] persistConversation: no activeConversationId');
            return;
        }
        if (this.uiMessages.length === 0) {
            console.warn('[PanelChatController] persistConversation: no uiMessages');
            return;
        }
        try {
            const snapshot = [...this.uiMessages];
            await convStore.save(this.activeConversationId, this.history, this.uiMessages);
            console.debug(`[PanelChatController] saved conversation ${this.activeConversationId} (${this.uiMessages.length} ui-msgs, ${this.history.length} history)`);
            const indexer = (this.plugin as unknown as { historyIndexer?: { onConversationSaved: (id: string, msgs: UiMessage[]) => Promise<void> | void } }).historyIndexer;
            if (indexer !== undefined) {
                void indexer.onConversationSaved(this.activeConversationId, snapshot);
            }
        } catch (e) {
            console.error('[PanelChatController] persistConversation FAILED:', e);
            new Notice(t('notice.inlineChat.saveFailed', { error: e instanceof Error ? e.message : String(e) }));
        }
    }

    private buildUserMessage(userInput: string): string | ContentBlock[] {
        const isFirstTurn = this.history.length === 0;
        const sel = this.ctx.selectionText.trim();
        const noteRef = this.ctx.notePath !== '' ? ` (from note: ${this.ctx.notePath})` : '';
        const baseText = (isFirstTurn === true && sel.length > 0)
            ? `<context>Selected text${noteRef}:\n${sel}</context>\n\n${userInput}`
            : userInput;

        const attHandler = this.getAttachments?.();
        const pending = attHandler?.pending ?? [];
        if (pending.length === 0) return baseText;

        // Sidebar pattern: images first, text + then text-file attachments.
        const blocks: ContentBlock[] = [];
        for (const a of pending) { if (a.block.type === 'image') blocks.push(a.block); }
        blocks.push({ type: 'text', text: baseText });
        for (const a of pending) { if (a.block.type === 'text') blocks.push(a.block); }
        // Clear pending so the next turn starts fresh.
        try { attHandler!.clear(); } catch { /* swallow */ }
        return blocks;
    }

    private buildCallbacks(
        handle: InlinePanelHandle,
        assistantBubbleId: string,
        modeSlug: string,
        api: import('../../../api/types').ApiHandler,
        userInput: string,
    ): AgentTaskCallbacks {
        // FIX-24-05-09 (D10): the panel drives the same loop as the sidebar but
        // reported none of its cost. No footer element is passed on purpose: the
        // handle's only text surface is setStatus, which onComplete overwrites
        // with 'Done', so a cost line written there would be wiped by the very
        // event it belongs to. Without a footer the monitor still produces the
        // priced [Cost] line and the two JSONL records, which is what makes the
        // spend auditable; a real cost line needs its own DOM node in
        // InlineChatPanel plus a persistence path, i.e. a UI feature, not a
        // capture fix.
        const monitor = new TaskMonitor({
            plugin: this.plugin,
            app: this.plugin.app,
            apiHandler: api,
            getEffectiveModelKey: () => this.plugin.settings.activeModelKey ?? '',
            promptPreview: userInput.slice(0, 200),
            mode: modeSlug,
        });
        return {
            onIterationStart: () => {},
            onText: (chunk) => handle.appendStreamChunk(assistantBubbleId, chunk),
            onThinking: () => {},
            onToolStart: (name) => { handle.setStatus(`Calling ${name}...`); },
            onToolResult: () => {},
            onComplete: () => { handle.setStatus('Done'); },
            onAttemptCompletion: () => {},
            onError: (err) => { handle.setStatus(`Error: ${err.message}`, 'error'); },
            // FIX-24-05-09 (D10): the three reporting hooks the sidebar has.
            onUsage: (i, o, cr, cc, modelId, routingMode, usageByModel, longContextIds) => {
                monitor.onUsage(i, o, cr, cc, modelId, routingMode, usageByModel, longContextIds);
            },
            onTaskTelemetry: (data) => { monitor.onTaskTelemetry(data); },
            onRequestTelemetry: (data) => { monitor.onRequestTelemetry(data); },
            onCondenseTelemetry: (event) => { monitor.onCondenseTelemetry(event); },
            onCheckpoint: (cp) => {
                // Mirror AgentSidebarView.onCheckpoint: every snapshot
                // taken by the write-tool pipeline becomes an inline
                // checkpoint marker (Diff / Undo this / Undo from here
                // / More menu). The orchestrator owns the surface
                // because Restore/Diff need plugin-level services.
                try { this.onCheckpointHook?.(cp, handle); }
                catch (e) { console.debug('[PanelChatController] onCheckpoint hook threw:', e); }
            },
            // Drain queued steering messages so AgentTask appends them
            // as user-role messages at the start of the next iteration.
            consumeSteeringMessages: (_iteration) => {
                if (this.steeringQueue.length === 0) return [];
                const drained = this.steeringQueue.slice();
                this.steeringQueue.length = 0;
                return drained;
            },
        };
    }
}
