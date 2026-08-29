/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/restrict-template-expressions, @typescript-eslint/unbound-method -- File-level disable: interacts with external SDK / JSON / Obsidian internals where untyped 'any' values are unavoidable. Inputs are validated at boundaries via type guards or schema checks where security-relevant. */
import { ItemView, WorkspaceLeaf, setIcon, Menu, MarkdownRenderer, MarkdownView, Notice, TFile, TFolder } from 'obsidian';
import { isDeniedPath, keepVisible } from '../core/tools/vault/denyZoneFilter';
import type ObsidianAgentPlugin from '../main';
import { AgentTaskRunner } from '../core/agent/AgentTaskRunner';
import {
    DEFAULT_CONDENSING_ENABLED,
    DEFAULT_CONDENSING_THRESHOLD,
    DEFAULT_MICROCOMPACTION_ENABLED,
    DEFAULT_ROLLING_SUMMARY_THRESHOLD,
} from '../core/condensingDefaults';
import { ModeService } from '../core/modes/ModeService';
// ADR-153: the approval card consumes the same effect registry as the Pipeline.
// No second, drifting copy of the group mapping.
import { EFFECT_POLICY, resolveToolEffect, type ToolEffect } from '../core/tools/toolEffects';
import { resolveAllowedMcpServers } from '../core/mcp/mcpActivation';
import { sanitizeHistoryForApi } from '../core/utils/sanitizeHistoryForApi';
import { sanitizeDirectoryEntry } from '../core/tools/BaseTool';
import { SKILL_DESCRIPTION_PROMPT_CAP } from '../core/skills/descriptionCaps';
import { MAX_BATCH_DIFF_ENTRIES } from '../core/tools/editPreview';
import { grantAutoApproval, scopeGrantNeedsConfirm } from '../core/tools/autoApprovalGrant';
import { isPluginApiWriteCall } from '../core/tools/agent/pluginApiAdaptive';
import { confirmModal } from './modals/PromptModal';
// FIX-44-12: checkpoint markers persist into the conversation and rehydrate live.
import {
    planCheckpointMarkerRehydration,
    toPersistedCheckpointMarker,
    type PersistedCheckpointMarker,
} from './checkpointMarkerRehydration';
// FIX-44-44: testable gate for the undo bar / post-task review surfaces.
import { decidePostTaskSurfaces } from './postTaskReviewGate';
import { isInsufficientPermissionsAuthError } from './errorTitleClassifier';
import type { MessageParam, ContentBlock } from '../api/types';
import { getModelKey, getFirstEnabledModelKey, modelToLLMProvider } from '../types/settings';
import type { CustomModel } from '../types/settings';
import { buildApiHandler, buildApiHandlerForModel } from '../api/index';
import { ToolPickerPopover } from './sidebar/ToolPickerPopover';
import { ChatOptionsPopover } from './sidebar/ChatOptionsPopover';
import { applyForcedWorkflow, nextForcedWorkflow, shouldApplyForcedWorkflow } from './sidebar/forcedWorkflow';
import { ChatModelPickerPopover, type ChatProviderNav } from './sidebar/ChatModelPickerPopover';
import { buildPinnedCustomModel, resolveEffortLevelsForPin, resolveStickyChatModel } from './sidebar/chatModelDropdown';
import { autoModelLabel } from './sidebar/autoModelLabel';
import { shouldSendOnEnter } from './sidebar/composerKeymap';
import {
    DEFAULT_THINKING_OVERRIDE,
    isExplicitThinkingOverride,
    resolveEffectiveThinkingEnabled,
    type ThinkingOverride,
} from './sidebar/thinkingOverride';
import {
    DEFAULT_EFFORT_OVERRIDE,
    thinkingSwitchIsOn,
    type EffortOverride,
} from './sidebar/effortOverride';
import type { EffortLevel } from '../types/model-registry';
import { resolveActiveProvider } from '../core/routing/tierResolution';
import { runMeteredCall } from '../core/pricing/meteredCall';
import { TOOL_METADATA } from '../core/tools/toolMetadata';
import { AttachmentHandler } from './sidebar/AttachmentHandler';
import { wireApprovalTimeout } from './sidebar/approvalTimeout';
import { scheduleRecurring, type RecurringHandle } from '../util/scheduleRecurring';
import { resolveSourceTarget, openExternalUrl } from './sidebar/sourceLinks';
import { resolveRunStateButtons } from './sidebar/runStateButtons';
import type { AttachmentItem } from './sidebar/AttachmentHandler';
import { AutocompleteHandler } from './sidebar/AutocompleteHandler';
import { resolveSlashEntry, findShadowedFor } from './sidebar/slashRegistry';
import { VaultFilePicker } from './sidebar/VaultFilePicker';
import { CommandPicker, type CommandPickerItem } from './sidebar/CommandPicker';
import { resolveObsidianDraggedFiles, resolveObsidianDraggedFolders } from './sidebar/dragManagerBridge';
import { HistoryPanel } from './sidebar/HistoryPanel';
import type { UiMessage } from '../core/history/ConversationStore';
import { LazyConversationId } from '../core/history/LazyConversationId';
import { MemoryRetriever } from '../core/memory/MemoryRetriever';
import { OnboardingService } from '../core/memory/OnboardingService';
import { isActiveOnboardingFlow } from '../core/onboarding-status';
import { ContextTracker } from '../core/context/ContextTracker';
import { loadableSkills } from '../core/context/SkillsManager';
import { stampProvenance } from '../core/governance/permissionInventory';
import { allowHost, hostKeyOf } from '../core/governance/webHostGrants';
import { MAX_SANDBOX_SCRIPT_GRANTS } from '../core/governance/sandboxScriptGrant';
import { enabledSelfAuthoredNames } from '../core/skills/skillToggleGate';
import { TaskMonitor, COST_LINE_CLASS } from './sidebar/TaskMonitor';
import { CondensationFeedback } from './sidebar/CondensationFeedback';
import { SuggestionBanner } from './sidebar/SuggestionBanner';
import { OnboardingFlow } from './sidebar/OnboardingFlow';
import { scan as scanTasks } from '../core/tasks/TaskExtractor';
import { TaskNoteCreator } from '../core/tasks/TaskNoteCreator';
import { TaskNotesAdapter } from '../core/tasks/TaskNotesAdapter';
import { TaskSelectionModal } from './TaskSelectionModal';
import { t, getActiveLocale } from '../i18n';
import DOMPurify from 'dompurify';
import { getPerformanceMarks } from '../core/observability/PerformanceMarks';
import { buildHealthCheckOptions } from '../core/knowledge/VaultHealthService';
import { generateShortId } from '../core/utils/generateShortId';
import { findRelatedConversations } from '../core/history/relatedConversations';
import { selectResumeSnapshot } from './sidebar/selectResumeSnapshot';
import { pickTabTitle, TITLE_SETTLES_AFTER } from './sidebar/deriveTabTitle';
import { isUnnamedTitle } from '../core/history/ConversationStore';
import { resolveSkillChatTitle } from '../core/skills/resolveSkillChatTitle';
import { buildExplicitSkillInstructions } from '../core/skills/skillInventoryRenderer';
import { resolveRunTeardown } from './sidebar/runOwnership';
import { repairUiMessages } from '../core/history/repairUiMessages';
import { computeEditResendCut } from '../core/history/editResendCut';
import { neutraliseRemoteResources } from './sidebar/neutraliseRemoteResources';
import { ChatSession } from './sidebar/ChatSession';

// IMP-19-01-03: Konstante lebt in viewTypes.ts; Import fuer den eigenen
// Gebrauch, Re-Export haelt alle bestehenden Importe stabil.
import { VIEW_TYPE_AGENT_SIDEBAR } from './viewTypes';
export { VIEW_TYPE_AGENT_SIDEBAR };

/**
 * AUDIT-034 M-4: Defensive sanitization for rehydrated tool-step HTML.
 *
 * stepsBlockEl.outerHTML is persisted into the conversation JSON on every
 * assistant turn and re-parsed on chat reload. All current writers are
 * first-party safe (setText / createEl / createSpan), but if an attacker
 * gains write access to the conversation JSON (untrusted sync, hostile MCP
 * flow), the stored string would round-trip to the live Electron renderer
 * unchecked. DOMPurify strips script / iframe / object / embed / link / meta
 * tags plus event-handler attributes plus javascript: URLs before we ever
 * touch the live DOM.
 *
 * RETURN_DOM_FRAGMENT gives back a sanitized DocumentFragment we can append
 * via importNode + appendChild, matching the existing rehydration shape.
 */
const TOOL_STEPS_SANITIZE_CONFIG = {
    RETURN_DOM_FRAGMENT: true as const,
    // AUDIT 2026-07-22 L-1: also forbid media/resource-loading tags. Tool-step
    // HTML is only tool names + status text -- it never legitimately carries
    // external media. Without this, a persisted <img src="https://attacker/">
    // in a tampered conversation JSON (untrusted sync / hostile MCP write)
    // fires a remote request (beacon / deanonymisation) on chat reload. Add
    // `src` to FORBID_ATTR as belt-and-suspenders for any allowed tag.
    FORBID_TAGS: [
        'script', 'iframe', 'object', 'embed', 'link', 'meta', 'base',
        'form', 'frame', 'frameset',
        'img', 'svg', 'audio', 'video', 'source', 'track', 'picture', 'input', 'style',
    ],
    FORBID_ATTR: ['srcdoc', 'srcset', 'src', 'formaction', 'action', 'background', 'poster', 'ping'],
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
};

/**
 * Agent Sidebar View
 *
 * Matches Kilo Code's UI/UX patterns:
 * - Clean header with title + New Chat button
 * - Scrollable messages area with Markdown rendering
 * - Chat input with integrated toolbar (mode, settings, send/stop)
 * - Persistent conversation history across messages
 * - Cancel running requests
 */
export class AgentSidebarView extends ItemView {
    plugin: ObsidianAgentPlugin;
    private modeService!: ModeService;
    // Phase A: the messages container is per-session (each tab has its own).
    // Accessor delegates to the active ChatSession (declared below).
    private get chatContainer(): HTMLElement | null { return this.activeSession.chatContainer; }
    private set chatContainer(v: HTMLElement | null) { this.activeSession.chatContainer = v; }
    /** FEAT-55-01 Phase C: parent of all per-session chat-messages containers. */
    private chatWrapper: HTMLElement | null = null;
    private inputArea: HTMLElement | null = null;
    private textarea: HTMLTextAreaElement | null = null;
    // Coalesces auto-resize into one rAF so a burst of input events measures
    // once, after the DOM value change has been laid out (fixes Shift+Enter
    // lag where a newline only grew the box on the 2nd/3rd press).
    private textareaResizePending = false;
    // Note: modeButton was removed in FEAT-26-05; chat-header has no mode UI anymore.
    private modelButton: HTMLButtonElement | null = null;
    /**
     * FEAT-55-01 in-view-tabs (Phase A): the per-chat state lives on a
     * ChatSession instance. With one session today this is behaviour-neutral
     * (activeSession is constant); Phase B swaps which session is active. The
     * getter/setter pairs below keep the ~143 `this.<field>` call sites
     * unchanged while the STORAGE moves into the session -- and binding a run
     * to a session INSTANCE (not this.activeSession) is what lets a
     * background run keep writing into its own tab (FIX-01-01-02 avoidance).
     *
     * Phase B: several sessions coexist as in-view tabs. `sessions` holds
     * them, `activeSessionIndex` selects the visible one, and `activeSession`
     * resolves to it so the field accessors above still work. The tab strip
     * (buildTabStrip) switches the index; a background run keeps writing into
     * its own ChatSession even while another tab is active.
     */
    private sessions: ChatSession[] = [new ChatSession()];
    private activeSessionIndex = 0;
    private tabStripEl: HTMLElement | null = null;
    private get activeSession(): ChatSession { return this.sessions[this.activeSessionIndex]; }

    /** History hardening A3: conversation ids currently open in a tab. The
     *  boot repair job skips these -- their RAM copy is already load-repaired
     *  and persists with the next regular save. */
    getOpenConversationIds(): string[] {
        return this.sessions
            .map((s) => s.activeConversationId)
            .filter((id): id is string => id !== null);
    }

    /** History hardening A3: repaint the History list after the boot repair
     *  corrected messageCounts (no-op while the panel is closed). */
    refreshHistoryPanel(): void {
        this.historyPanel?.refresh();
    }

    // EPIC-26 / FEAT-26-05: per-turn chat-header override (null -> Auto).
    private get chatModelOverride(): string | null { return this.activeSession.chatModelOverride; }
    private set chatModelOverride(v: string | null) { this.activeSession.chatModelOverride = v; }
    // Per-conversation extended-thinking override (issue #44).
    private get chatThinkingOverride(): ThinkingOverride { return this.activeSession.chatThinkingOverride; }
    private set chatThinkingOverride(v: ThinkingOverride) { this.activeSession.chatThinkingOverride = v; }
    // Per-conversation reasoning-effort override.
    private get chatEffortOverride(): EffortOverride { return this.activeSession.chatEffortOverride; }
    private set chatEffortOverride(v: EffortOverride) { this.activeSession.chatEffortOverride = v; }
    /** EPIC-26 / FEAT-26-05: searchable popover for picking the chat-header model. */
    private chatModelPicker: ChatModelPickerPopover | null = null;
    private sendButton: HTMLElement | null = null;
    private stopButton: HTMLElement | null = null;
    private contextBadgeContainer: HTMLElement | null = null;

    // Feature 1: Persistent conversation history (survives across messages).
    // Phase A: storage on the active ChatSession (see activeSession above).
    private get conversationHistory(): MessageParam[] { return this.activeSession.conversationHistory; }
    private set conversationHistory(v: MessageParam[]) { this.activeSession.conversationHistory = v; }
    // IMP-41-03-01: inflight snapshot armed for the next send by the Resume card.
    private get pendingResume(): import('../core/agent/InflightStore').InflightSnapshot | null { return this.activeSession.pendingResume; }
    private set pendingResume(v: import('../core/agent/InflightStore').InflightSnapshot | null) { this.activeSession.pendingResume = v; }
    // Chat History: active conversation tracking + UI messages for persistence.
    private get activeConversationId(): string | null { return this.activeSession.activeConversationId; }
    private set activeConversationId(v: string | null) { this.activeSession.activeConversationId = v; }
    /** FIX-03-20-01: race-free lazy id creation; delegates to the session. */
    private get lazyConversationId(): LazyConversationId { return this.activeSession.lazyConversationId; }
    private get uiMessages(): UiMessage[] { return this.activeSession.uiMessages; }
    private set uiMessages(v: UiMessage[]) { this.activeSession.uiMessages = v; }
    private historyPanel: HistoryPanel | null = null;

    // Feature 3: AbortController for cancelling in-flight requests.
    // Phase A: run-state storage on the active ChatSession. Binding a run to
    // the session INSTANCE (not this.activeSession, which shifts on tab
    // switch) is the Phase-C mechanism that keeps a background run writing
    // into its own tab -- the FIX-01-01-02 data-loss guard.
    private get currentAbortController(): AbortController | null { return this.activeSession.currentAbortController; }
    private set currentAbortController(v: AbortController | null) { this.activeSession.currentAbortController = v; }
    // FIX-24-08-03: signal of the most recently started run (not nulled by Stop).
    private get lastRunAbortSignal(): AbortSignal | null { return this.activeSession.lastRunAbortSignal; }
    private set lastRunAbortSignal(v: AbortSignal | null) { this.activeSession.lastRunAbortSignal = v; }
    // IMP-24-08-04: per-run hook swapping the Working spinner for "Stopping".
    private get currentStopFeedback(): (() => void) | null { return this.activeSession.currentStopFeedback; }
    private set currentStopFeedback(v: (() => void) | null) { this.activeSession.currentStopFeedback = v; }
    // GUARD-L1: true between Stop and the aborted loop's onComplete/onError.
    private get taskDraining(): boolean { return this.activeSession.taskDraining; }
    private set taskDraining(v: boolean) { this.activeSession.taskDraining = v; }
    private get taskDrainingTimer(): number { return this.activeSession.taskDrainingTimer; }
    private set taskDrainingTimer(v: number) { this.activeSession.taskDrainingTimer = v; }
    // Issue 3 Wave B: teardown-ownership token for a stopped, draining run.
    // Distinguishes "Stop then wait -> Resume" from "Stop then send" and
    // prevents a late onComplete writing into a newer conversation (FIX-01-01-02).
    private get drainingController(): AbortController | null { return this.activeSession.drainingController; }
    private set drainingController(v: AbortController | null) { this.activeSession.drainingController = v; }
    // Issue 1: routes the next typed text to an open ask_followup_question.
    private get pendingQuestionResolve(): ((answer: string) => void) | null { return this.activeSession.pendingQuestionResolve; }
    private set pendingQuestionResolve(v: ((answer: string) => void) | null) { this.activeSession.pendingQuestionResolve = v; }
    // FEAT-24-08 / ADR-114 Steering-Hook: mid-run user messages queued for the
    // next loop iteration (consumed via consumeSteeringMessages).
    private get steeringQueue(): Array<{ text: string; bubbleEl: HTMLElement }> { return this.activeSession.steeringQueue; }
    private set steeringQueue(v: Array<{ text: string; bubbleEl: HTMLElement }>) { this.activeSession.steeringQueue = v; }

    // Context: tracks whether user dismissed the auto-injected file for this turn
    private userDismissedContext = false;
    /** Forced-workflow slugs we have already warned about being inapplicable, so the notice fires once per slug (FIX-02-02-01, defect a). */
    private forcedWorkflowWarned = new Set<string>();
    private forcedWorkflowHubUnsub: (() => void) | null = null;
    // Session-local flag: the Frontmatter Operator recommendation toast is
    // shown at most once per sidebar-view lifetime (in addition to the
    // persistent frontmatterOperatorHintDismissed setting).
    private frontmatterOperatorHintShownThisSession = false;
    // Last user message text, used by "Regenerate" action (per session).
    private get lastUserMessage(): string { return this.activeSession.lastUserMessage; }
    private set lastUserMessage(v: string) { this.activeSession.lastUserMessage = v; }
    // Last known active MarkdownView, tracked because clicking the sidebar loses
    // getActiveViewOfType. View-level (about the editor, not the chat session).
    private lastMarkdownView: MarkdownView | null = null;
    // Hidden message flag: skip the user bubble but still send to the LLM.
    private get nextMessageHidden(): boolean { return this.activeSession.nextMessageHidden; }
    private set nextMessageHidden(v: boolean) { this.activeSession.nextMessageHidden = v; }
    // Onboarding key-setup state machine (chat-based flow, no LLM needed)
    private onboarding: OnboardingFlow | null = null;

    // Health badge (FEATURE-1901)
    private healthBadge: HTMLElement | null = null;
    // Browser-style chat navigation: linear stack of conversation IDs the user
    // visited via arrow nav (per session, so each tab keeps its own history).
    // null sentinel = "new/empty chat".
    private get navStack(): Array<string | null> { return this.activeSession.navStack; }
    private set navStack(v: Array<string | null>) { this.activeSession.navStack = v; }
    private get navIndex(): number { return this.activeSession.navIndex; }
    private set navIndex(v: number) { this.activeSession.navIndex = v; }
    private navBackBtn: HTMLButtonElement | null = null;
    private navForwardBtn: HTMLButtonElement | null = null;
    // Tool picker (pocket-knife button)
    private toolPickerButton: HTMLElement | null = null;
    // Web search toggle button (globe icon)
    private webToggleButton: HTMLElement | null = null;
    /** Manages tool/skill/workflow picker */
    private toolPicker!: ToolPickerPopover;
    /** The chat "..." options popover (real toggles + actions, FEAT-02-12). */
    private readonly chatOptionsPopover = new ChatOptionsPopover();
    /** Manages pending attachments and chip bar UI */
    private attachments!: AttachmentHandler;
    /** Manages / and @ autocomplete dropdown */
    private autocomplete!: AutocompleteHandler;
    /** Vault file picker popover (@ button) */
    private vaultFilePicker!: VaultFilePicker;
    /** Context tracking for condensing */
    private contextTracker: ContextTracker | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: ObsidianAgentPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.modeService = new ModeService(plugin);
        this.toolPicker = new ToolPickerPopover(plugin, this.modeService);

        // FIX-26-99-03 hook: settings ModesTab + NewModeModal need access to
        // the same ModeService instance the sidebar uses, otherwise they
        // edit a fresh detached copy whose state never reaches the agent
        // loop. AgentSettingsTab.findActiveModeService() looks for this
        // method on the open sidebar leaf.
        // (Declared inline to avoid a class field ordering hazard with
        // the property initializer ordering of the file's eslint-disable
        // file header.)
        (this as unknown as { getModeServiceOrNull(): ModeService | null }).getModeServiceOrNull = () => this.modeService ?? null;
        this.vaultFilePicker = new VaultFilePicker(
            this.app,
            async (files) => { for (const f of files) await this.attachments.addVaultFile(f); },
        );
    }

    getViewType(): string {
        return VIEW_TYPE_AGENT_SIDEBAR;
    }

    getDisplayText(): string {
        return t('ui.sidebar.title');
    }

    getIcon(): string {
        return 'square-slash';
    }

    /**
     * FEAT-55-01 (ADR-169): persist this leaf's active conversation into the
     * workspace layout so a chat tab reopens with its content after a
     * restart. Obsidian serializes the returned object and hands it back to
     * setState on the next layout restore.
     */
    getState(): Record<string, unknown> {
        const base = super.getState();
        // USER 2026-07-26: "beim reload oder restart einen frischen zeigen,
        // alte chats kann man sich ueber die history holen."
        //
        // FEAT-55-01 Phase D persisted every open tab, so a restart came back
        // with however many tabs happened to be open -- three, in practice,
        // with no way to tell why. Tabs are for the work in front of you;
        // History is the archive, and it is one click away. Nothing is lost by
        // starting clean, and the previous behaviour made the restart feel like
        // it had a memory nobody asked for.
        //
        // The key is deliberately omitted rather than written as an empty list,
        // so an older layout that still carries tab ids also opens fresh.
        return {
            ...base,
            sessionConversationIds: undefined,
            activeSessionIndex: undefined,
            conversationId: undefined,
        };
    }

    async setState(state: unknown, result: unknown): Promise<void> {
        await super.setState(state, result as never);
        // USER 2026-07-26: a restart opens a fresh chat. The saved layout is
        // read but deliberately not acted on -- a vault that still carries tab
        // ids from before this change must also open clean, and deleting the
        // keys from getState alone would not achieve that. Old chats are one
        // click away in History, which is where an archive belongs.
        //
        // Deep links are unaffected: obsidian://vault-operator-chat goes through
        // openChatById, not through setState.
    }

    async onOpen(): Promise<void> {
        // MEAS-01: time from view-instantiation to first render-done. This
        // is the TTI a user actually perceives, so it is intentionally
        // wrapped around the readiness-await too.
        const perfMarks = getPerformanceMarks();
        perfMarks.start('sidebar.onOpen');

        // BUG-026 (2026-04-19): wait for plugin.doLoad() to finish before
        // reading settings / mode service. Obsidian instantiates this view
        // the moment registerView runs (layout restore), which during a
        // BRAT hot reload is before settings exist. Without this guard
        // the view threw "Cannot read properties of undefined (reading
        // 'currentMode')" and the whole sidebar stayed broken.
        //
        // FIX-PERF-28: prefer shellReady (settings + ModeService) over
        // the full readyPromise so the sidebar paints its input shell
        // while KnowledgeDB / Memory / Semantic / MCP are still booting
        // in the background. Fall back to readyPromise on older plugin
        // builds that have not introduced shellReady yet.
        const pluginAsAny = this.plugin as unknown as {
            shellReady?: Promise<void>;
            readyPromise?: Promise<void>;
        };
        const readiness = pluginAsAny.shellReady ?? pluginAsAny.readyPromise;
        if (readiness) {
            try { await readiness; } catch { /* doLoad errors are surfaced elsewhere; keep rendering */ }
        }

        // Initialize ModeService — loads global modes from ~/.obsidian-agent/modes.json
        await this.modeService.initialize();

        // IMP-02-12-01: re-render the forced-workflow chip whenever any
        // surface changes the pin or the active agent.
        this.forcedWorkflowHubUnsub?.();
        this.forcedWorkflowHubUnsub = this.plugin.forcedWorkflowHub.subscribe(() => this.updateContextBadge());

        const container = this.containerEl.children[1];
        if (!(container != null && container.instanceOf(HTMLElement))) return;
        container.empty();
        container.addClass('obsidian-agent-sidebar');

        // Initialize context tracker with current model's context window
        try {
            const currentModeSlug = this.modeService.getActiveMode().slug;
            const modeModelKey = this.resolveEnabledModelKey(currentModeSlug);
            const resolvedModel = this.plugin.settings.activeModels.find((m) => getModelKey(m) === modeModelKey);

            if (resolvedModel) {
                const apiHandler = buildApiHandlerForModel(resolvedModel);
                const model = apiHandler.getModel();
                const contextWindow = model?.info?.contextWindow ?? 200_000;
                const maxTokens = resolvedModel?.maxTokens;
                this.contextTracker = new ContextTracker(contextWindow, maxTokens);
            } else {
                // Fallback if no model is configured
                this.contextTracker = new ContextTracker(200_000, 8192);
            }
        } catch (e) {
            console.debug('[AgentSidebarView] Failed to initialize context tracker:', e);
            this.contextTracker = new ContextTracker(200_000, 8192);
        }

        this.buildHeader(container);
        this.buildTabStrip(container);
        this.buildChatContainer(container);
        this.buildSuggestionBanner(container);
        this.buildChatInput(container);
        this.buildAiDisclaimer(container);

        // Feature 4: Update context badge when user switches files; reset dismiss on new file
        // Also track last active MarkdownView so "Insert at cursor" works from sidebar
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', (leaf) => {
                this.userDismissedContext = false;
                this.updateContextBadge();
                if (leaf?.view instanceof MarkdownView) {
                    this.lastMarkdownView = leaf.view;
                }
            })
        );
        this.registerEvent(
            this.app.workspace.on('file-open', () => {
                this.userDismissedContext = false;
                this.updateContextBadge();
            })
        );

        // EPIC-33: refresh the history panel when the inline panel
        // saves a new conversation, so the entry appears immediately
        // (otherwise the user has to close+reopen the sidebar).
        const onInlineSaved = (): void => {
            this.historyPanel?.refresh();
        };
        this.app.workspace.containerEl.addEventListener(
            'vault-operator:conversation-list-changed',
            onInlineSaved,
        );
        this.register(() => {
            this.app.workspace.containerEl.removeEventListener(
                'vault-operator:conversation-list-changed',
                onInlineSaved,
            );
        });

        // FEAT-55-01 (ADR-169): per-leaf conversation persistence. On layout
        // restore Obsidian calls setState with this leaf's saved
        // conversationId; reload it so a chat tab survives a restart with its
        // content instead of opening empty. Falls back to the welcome message
        // when there is nothing to restore (or the id is stale).
        this.showWelcomeMessage();
        // FEAT-55-01 (ADR-169, user decision 2026-07-25): a fresh chat no
        // longer shows a global "a task was interrupted" resume card. Resume
        // belongs to the SPECIFIC conversation: it surfaces inside that chat
        // when the user opens it from History (loadConversation), not as an
        // info banner in a new/empty chat.
        // Language-pack install-prompt: renders the same consent card as
        // tool-triggered asset installs, so a non-English user gets a
        // visible chat card instead of a small notice that is easy to
        // miss. Non-blocking; skips silently when English or already
        // installed. Obsidian policy: download only on explicit click.
        void this.maybeOfferLocalePackCard();
        perfMarks.end('sidebar.onOpen', { log: true });
    }

    /**
     * IMP-41-03-01: boot recovery banner. When a fresh inflight snapshot
     * exists, render a card offering Resume (arms pendingResume, loads the
     * conversation, sends a resume note through the normal send path) or
     * Discard (clears the snapshot). Fail-closed: any error only logs.
     */
    private async maybeOfferInflightResume(
        conversationId?: string,
        // FEAT-55-01 (isolation fix): render the resume card into the run's
        // own container when a background run offers it post-abort. History /
        // boot callers default to the active tab.
        container?: HTMLElement | null,
    ): Promise<void> {
        try {
            const store = this.plugin.inflightStore;
            const target = container ?? this.chatContainer;
            if (!store || !target) return;
            const recoverable = await store.listRecoverable();
            // FEAT-55-01 (ADR-169, user decision 2026-07-25): resume is
            // conversation-scoped. With a conversationId (from loadConversation
            // / History, or the post-Stop active chat) only that chat's
            // snapshot is offered -- never a global banner in an unrelated/new
            // chat. selectResumeSnapshot also honours the per-taskId claim guard.
            const snapshot = selectResumeSnapshot(recoverable, conversationId, this.plugin.inflightResumeClaims);
            if (!snapshot) return;

            const row = target.createDiv('tool-approval-row');
            const iconSpan = row.createSpan('tool-approval-icon');
            setIcon(iconSpan, 'history');
            row.createSpan('tool-approval-text').setText(
                t('ui.resume.interrupted', {
                    time: new Date(snapshot.savedAt).toLocaleTimeString(),
                    messages: String(snapshot.history.length),
                }),
            );
            const actions = row.createDiv('tool-approval-actions');
            const resumeBtn = actions.createEl('button', {
                cls: 'tool-approval-btn approval-allow-once',
                text: t('ui.resume.resume'),
            });
            const discardBtn = actions.createEl('button', {
                cls: 'tool-approval-btn approval-deny-small',
                text: t('ui.resume.discard'),
            });

            resumeBtn.addEventListener('click', () => {
                void (async () => {
                    row.remove();
                    // IMP-24-08-04: the card now also appears right after
                    // Stop, in the conversation that is already active --
                    // reloading it would repaint the chat mid-view.
                    if (snapshot.conversationId && snapshot.conversationId !== this.activeConversationId) {
                        await this.loadConversation(snapshot.conversationId, { skipNavPush: true })
                            .catch(() => { /* stale id: resume still works from the snapshot history */ });
                    }
                    this.pendingResume = snapshot;
                    await store.clear(snapshot.taskId);
                    // FEAT-55-01: resumed -> the snapshot is consumed, drop the tag.
                    void this.plugin.refreshInterruptedConversations();
                    if (this.textarea) {
                        this.textarea.value = '[System] The previous task was interrupted. '
                            + 'Resume from where you left off using the conversation so far; '
                            + 'do not redo work that is already done.';
                        await this.handleSendMessage();
                    }
                })();
            });
            discardBtn.addEventListener('click', () => {
                row.remove();
                void store.clear(snapshot.taskId).then(() => {
                    // FEAT-55-01: the snapshot is gone -> drop the History tag.
                    void this.plugin.refreshInterruptedConversations();
                });
            });
        } catch (e) {
            console.warn('[InflightResume] banner failed (non-fatal):', e instanceof Error ? e.message : e);
        }
    }

    /**
     * Fallback for a conversation whose store file is missing but that still
     * has an interrupted-task snapshot (live bug 2026-07-25). The store index
     * lists the id, but store.load returned null -- the task was interrupted
     * around the first save. Rather than dead-ending with "Could not load
     * conversation", adopt the id on the active tab and surface its resume
     * card, so the boot notice / History click still reaches the resume the
     * user was after. The snapshot history is only replayed into the loop on
     * Resume (via pendingResume), so the empty chat is expected until then.
     *
     * Returns true when a resume card was offered, false otherwise (caller
     * then shows the load-failed notice).
     */
    private async tryOfferResumeForMissingConversation(id: string): Promise<boolean> {
        try {
            const inflight = this.plugin.inflightStore;
            if (!inflight || !this.chatContainer) return false;
            const recoverable = await inflight.listRecoverable();
            const snapshot = selectResumeSnapshot(recoverable, id, this.plugin.inflightResumeClaims);
            if (!snapshot) return false;

            // Re-check after the awaits (DELTA-0707B-L1): a run started from the
            // composer meanwhile must not have its history swapped underneath it.
            if (this.refuseWhileTaskRuns()) return true;

            // Adopt the id on the active tab with an empty history (the file is
            // gone; the snapshot fills the loop's history on Resume). Save the
            // outgoing conversation first, exactly like loadConversation does.
            this.saveCurrentConversation();
            this.conversationHistory = [];
            this.uiMessages = [];
            this.activeConversationId = id;
            this.lazyConversationId.reset();
            this.activeSession.tabTitle = null;
        // The session-held tab title belongs to the OUTGOING chat.
        this.activeSession.tabTitle = null;
            this.attachments.clear();
            void this.attachments.consumeFullDocTexts();
            this.chatContainer.empty();
            this.historyPanel?.setActiveId(id);
            this.updateContextBadge();

            await this.maybeOfferInflightResume(id);
            return true;
        } catch (e) {
            console.warn('[InflightResume] missing-file fallback failed (non-fatal):',
                e instanceof Error ? e.message : e);
            return false;
        }
    }

    onClose(): Promise<void> {
        // FEAT-55-01 (post-merge verification 2026-07-25): the view holds N
        // tabs, not one. This used to abort and save only the ACTIVE session, so
        // closing the sidebar with several tabs open left every background run
        // going and every background conversation unsaved. Walk them all.
        // Guard every call: onClose may run before onOpen completed if plugin
        // init failed upstream.
        // History hardening phase B: snapshot BEFORE aborting. The save
        // snapshots synchronously; aborting first gains nothing and made the
        // intent ambiguous. A run's late onComplete still enqueues a richer
        // save behind this one (FIFO per-file queue). App-quit stays
        // fire-and-forget (Electron limit) -- the incremental send-time saves
        // shrink that window to at most the currently streaming answer.
        for (const session of this.sessions) {
            try { this.saveCurrentConversation(session); } catch { /* non-fatal */ }
            try { session.currentAbortController?.abort(); } catch { /* non-fatal */ }
            try { this.enqueueMemoryExtraction(session); } catch { /* non-fatal */ }
        }
        this.attachments?.clear();
        // The popovers render into document.body and hold window-level
        // listeners; without this they outlive the view (leak + floating
        // popover in the popout case). FEAT-02-12 review fix + IMP-02-12-03
        // (ToolPickerPopover had the same gap).
        this.chatOptionsPopover.hide();
        this.toolPicker?.close();
        this.forcedWorkflowHubUnsub?.();
        this.forcedWorkflowHubUnsub = null;
        return Promise.resolve();
    }

    private buildHeader(container: HTMLElement): void {
        const header = container.createDiv('agent-header');

        const titleRow = header.createDiv('agent-title');
        // Brand mark: the coloured square-slash from the community listing. The
        // gradient rounded square and the slash are drawn in CSS (no icon-font
        // dependency, no innerHTML), so the mark renders identically on every
        // theme. The old monospace "/ Vault Operator" wordmark carried the
        // slash in text; now the glyph owns it and the wordmark is just the name.
        titleRow.createSpan({
            cls: 'agent-brand-glyph',
            attr: { 'aria-hidden': 'true' },
        });
        titleRow.createSpan({
            cls: 'agent-brand-name',
            text: 'Vault Operator', // i18n-ignore: brand wordmark
        });

        const headerRight = header.createDiv('agent-header-right');

        // FEATURE-1901 / BUG-025 (2026-04-19): vault-health indicator moved from
        // next-to-title to left-of-settings in the header-right group, and the
        // severity dot replaced with a `stethoscope` lucide icon. Hidden unless
        // at least one finding exists. Colour comes from the severity-* class
        // via styles.css.
        this.healthBadge = headerRight.createEl('button', {
            cls: 'header-button health-badge',
            attr: { 'aria-label': t('ui.sidebar.vaultHealth') },
        });
        setIcon(this.healthBadge.createSpan('toolbar-icon'), 'stethoscope');
        this.healthBadge.classList.add('agent-u-hidden');
        this.healthBadge.addEventListener('click', () => {
            this.openHealthModal();
        });
        // Sync from the plugin in case the health check already ran before the
        // view mounted (common after a BRAT hot-reload or leaf rebuild).
        this.syncHealthBadge();

        // Settings button — moved here from toolbar
        const settingsBtn = headerRight.createEl('button', {
            cls: 'header-button',
            attr: { 'aria-label': t('ui.sidebar.settings') },
        });
        setIcon(settingsBtn.createSpan('toolbar-icon'), 'settings');
        settingsBtn.addEventListener('click', () => {
            this.app.setting?.open();
            // Navigate to plugin tab after modal is rendered (200ms is robust for most machines)
            window.setTimeout(() => this.app.setting?.openTabById(this.plugin.manifest.id), 200);
        });

        // History button — opens conversation history panel
        const historyBtn = headerRight.createEl('button', {
            cls: 'header-button',
            attr: { 'aria-label': t('ui.sidebar.chatHistory') },
        });
        setIcon(historyBtn.createSpan('toolbar-icon'), 'history');
        historyBtn.addEventListener('click', () => {
            this.ensureHistoryPanel();
            this.historyPanel?.toggle();
        });

        // FEATURE-0318: Save-to-memory is exposed via the chat input "..." menu
        // (Save conversation to memory) and via the per-row star in the
        // history panel. The header had a duplicate star toggle that confused
        // the visual language of "filled = in memory" -- removed.

        // New Chat button (FEAT-55-01): opens a NEW in-view chat tab inside
        // this sidebar (openInViewTab), so the user can start a second chat
        // while a task runs in the current one. Previously it cleared the
        // session and refused while a task ran; now it always opens a parallel
        // tab. User decision 2026-07-25: tabs live inside the sidebar.
        const newChatBtn = headerRight.createEl('button', {
            cls: 'header-button',
            attr: { 'aria-label': t('ui.sidebar.newChat') },
        });
        setIcon(newChatBtn.createSpan('toolbar-icon'), 'message-square-plus');
        newChatBtn.addEventListener('click', () => { this.openInViewTab(); });

        // Browser-style back/forward through recently opened chats. Sit on
        // the far right of the header so the arrow cluster doesn't compete
        // with the primary controls. Triangles (chevron-left/right) read
        // better than full arrows in the narrow sidebar.
        this.navBackBtn = headerRight.createEl('button', {
            cls: 'header-button header-button--nav',
            attr: { 'aria-label': t('ui.sidebar.previousChat') },
        });
        setIcon(this.navBackBtn.createSpan('toolbar-icon'), 'chevron-left');
        this.navBackBtn.addEventListener('click', () => { void this.navBack(); });

        this.navForwardBtn = headerRight.createEl('button', {
            cls: 'header-button header-button--nav',
            attr: { 'aria-label': t('ui.sidebar.nextChat') },
        });
        setIcon(this.navForwardBtn.createSpan('toolbar-icon'), 'chevron-right');
        this.navForwardBtn.addEventListener('click', () => { void this.navForward(); });

        this.updateNavButtons();
    }

    // =====================================================================
    // FEAT-55-01 in-view tabs (Phase B): a tab strip INSIDE the sidebar view
    // switching between ChatSessions. New chat = new tab; x closes a tab.
    // Only the active session's messages are rendered; a background run keeps
    // writing into its own session and its tab shows a running indicator.
    // =====================================================================

    /** Build the tab strip container (between header and chat), then render it. */
    private buildTabStrip(container: HTMLElement): void {
        this.tabStripEl = container.createDiv('vo-tab-strip');
        this.renderTabStrip();
    }

    /** (Re)render the tab buttons from the current sessions + active index. */
    private renderTabStrip(): void {
        const strip = this.tabStripEl;
        if (!strip) return;
        // PERF 2026-07-25: record what this paint covers so the run-state path
        // (which fires on every keystroke) can skip a redundant rebuild.
        this.lastTabStripSignature = this.tabStripSignature();
        strip.empty();
        // User decision 2026-07-25: the strip shows from the FIRST chat on.
        // Hiding it at one chat made a second tab pop out of nowhere on New
        // Chat, which read as "suddenly 2 tabs".
        strip.removeClass('agent-u-hidden');

        this.sessions.forEach((session, i) => {
            const isActive = i === this.activeSessionIndex;
            const tab = strip.createDiv(`vo-tab${isActive ? ' vo-tab-active' : ''}`);
            // Running indicator: a dot when this session has an in-flight run.
            if (session.isBusy) tab.createSpan('vo-tab-running-dot');
            const title = this.sessionTabTitle(session, i);
            tab.createSpan({ cls: 'vo-tab-title', text: title, attr: { title } });
            tab.addEventListener('click', () => this.switchToSession(i));
            // Close button (x). Guarded when the session has a running task.
            const close = tab.createSpan({ cls: 'vo-tab-close', attr: { 'aria-label': t('ui.tab.close') } });
            setIcon(close, 'x');
            close.addEventListener('click', (e) => {
                e.stopPropagation(); // do not also switch to the tab
                void this.closeSession(i);
            });
        });

        // "+" new-tab button.
        const add = strip.createDiv({ cls: 'vo-tab-add', attr: { 'aria-label': t('plugin.commandNewChat') } });
        setIcon(add, 'plus');
        add.addEventListener('click', () => this.openInViewTab());
    }

    /**
     * A short tab label: a truncated form of the active conversation's title,
     * else "New conversation". User feedback 2026-07-25: fresh tabs read
     * "New conversation" (not "New chat {N}"); the real title shows up
     * truncated once it exists. index is unused now but kept so callers that
     * pass the tab position stay stable.
     */
    /**
     * USER 2026-07-26: "sobald der Intent klar ist, soll der Intent als
     * Tab-Titel angezeigt werden."
     *
     * Precedence, and the order matters:
     *   1. a REAL store title -- the semantic (LLM) name, or a rename. This
     *      upgrades the intent line once the run has produced something better.
     *   2. the intent derived from the first message, held on the session so it
     *      appears the moment the user hits send. A fresh tab has no
     *      conversation id yet, so a store-only lookup showed the placeholder
     *      for the whole first exchange.
     *   3. the placeholder.
     */
    private sessionTabTitle(session: ChatSession, _index: number): string {
        if (session.activeConversationId) {
            const meta = this.plugin.conversationStore?.list().find((c) => c.id === session.activeConversationId);
            if (meta?.title && !isUnnamedTitle(meta.title)) return this.truncateTabTitle(meta.title);
        }
        if (session.tabTitle) return this.truncateTabTitle(session.tabTitle);
        return t('ui.sidebar.newChat');
    }

    /**
     * FEAT-55-01: give the chat a name the moment the first message is sent.
     *
     * Only fills the untouched default, so it never clobbers a fallback already
     * laid down, the semantic (titleSource 'auto') title, or a user rename. The
     * task-end block and finalizeConversation still run and still upgrade this
     * to the LLM title; this only closes the window in which a tab had no name
     * at all -- including runs that are stopped or fail, which never reach the
     * task-end path.
     */
    private nameChatFromFirstMessage(session: ChatSession): void {
        // USER 2026-07-26: the opening messages may still change the title. A
        // first message is often a throwaway ("moin", "kurze frage") and the
        // real intent lands in the next one. pickTabTitle owns that rule; here
        // we only stop asking once the chat has settled, so a long
        // conversation never renames itself under the user.
        const userTexts = session.uiMessages
            .filter((m) => m.role === 'user')
            .map((m) => m.text ?? '');
        if (userTexts.length > TITLE_SETTLES_AFTER) return;

        const title = pickTabTitle(userTexts);
        if (!title || title === session.tabTitle) return;

        // The session gets it immediately. This used to require an existing
        // conversation id, which a fresh tab does not have -- the id is minted
        // lazily during this very send -- so the tab kept showing the
        // placeholder through the whole first exchange.
        session.tabTitle = title;
        this.renderTabStrip();

        // And the store gets it too, when there is something to write to, so
        // History and a later reload agree with the tab.
        const store = this.plugin.conversationStore;
        const convId = session.activeConversationId;
        if (store && convId) {
            const meta = store.list().find((c) => c.id === convId);
            // A real title (semantic, or a rename) is never overwritten.
            if (meta && !isUnnamedTitle(meta.title)) return;
            void store.updateMeta(convId, { title }).catch(() => { /* naming is best effort */ });
            this.historyPanel?.refresh();
        }
    }

    /** Clip a conversation title to a tab-sized label (word-boundary aware). */
    private truncateTabTitle(title: string): string {
        const MAX = 24;
        const trimmed = title.trim();
        if (trimmed.length <= MAX) return trimmed;
        const cut = trimmed.slice(0, MAX);
        const lastSpace = cut.lastIndexOf(' ');
        const base = lastSpace > MAX / 2 ? cut.slice(0, lastSpace) : cut;
        return base.trimEnd() + '…';
    }

    /**
     * FEAT-55-01: open a new in-view chat tab (fresh session) and switch to
     * it. This is what the New Chat button and the new-chat command call now.
     */
    openInViewTab(): void {
        const session = new ChatSession();
        this.sessions.push(session);
        this.activeSessionIndex = this.sessions.length - 1;
        this.renderTabStrip();
        // The fresh session gets its own (empty) container, shown by
        // showActiveSessionContainer below.
        this.ensureSessionContainer(this.activeSession);
        this.showActiveSessionContainer();
        this.showWelcomeMessage();
        this.updateContextBadge();
        this.updateNavButtons();
        this.textarea?.focus();
    }

    /**
     * FEAT-55-01 Phase C: lazily create a session's own chat-messages
     * container inside chatWrapper. Each session keeps its DOM, so a
     * background run keeps streaming into its (hidden) container and is
     * intact when the user returns -- no empty+rebuild that would drop a
     * mid-stream element.
     */
    private ensureSessionContainer(session: ChatSession): HTMLElement | null {
        if (session.chatContainer) return session.chatContainer;
        if (!this.chatWrapper) return null;
        const el = this.chatWrapper.createDiv('chat-messages');
        // Keeps the pinned-question bar in sync while this tab scrolls --
        // including the rAF autoscroll during streaming, which dispatches
        // scroll events like any user scroll. Passive: the handler never
        // preventDefaults. The listener dies with the element (closeSession
        // removes the container), so no explicit teardown is needed.
        el.addEventListener('scroll', this.schedulePinnedQuestionUpdate, { passive: true });
        session.chatContainer = el;
        return el;
    }

    /** Show the active session's container, hide the others. */
    private showActiveSessionContainer(): void {
        for (const s of this.sessions) {
            if (!s.chatContainer) continue;
            s.chatContainer.toggleClass('agent-u-hidden', s !== this.activeSession);
        }
        // Defence in depth (live bug 2026-07-25): a `.chat-messages` child of
        // the wrapper that no session owns is dead DOM from a replaced session
        // list. Because each container is height:100% in an overflow-hidden
        // wrapper, one visible orphan pushes every real container below the
        // fold (the "empty window" failure). Sweep them out.
        if (this.chatWrapper) {
            const owned = new Set(this.sessions.map((s) => s.chatContainer));
            for (const el of Array.from(this.chatWrapper.querySelectorAll(':scope > .chat-messages'))) {
                if (!owned.has(el as HTMLElement)) el.remove();
            }
        }
        // Every visibility change routes through here (tab switch, new tab,
        // close), and a display:none toggle fires no scroll event -- so this
        // is the one place that re-targets the pinned-question bar at the tab
        // that just became visible.
        this.schedulePinnedQuestionUpdate();
    }

    // ── Pinned question bar (see buildChatContainer for the DOM) ──────────

    private pinnedQuestionBar: HTMLElement | null = null;
    private pinnedQuestionRafPending = false;

    /** rAF-throttled: scroll events arrive per frame during streaming. */
    private schedulePinnedQuestionUpdate = (): void => {
        if (this.pinnedQuestionRafPending) return;
        this.pinnedQuestionRafPending = true;
        window.requestAnimationFrame(() => {
            this.pinnedQuestionRafPending = false;
            this.updatePinnedQuestion();
        });
    };

    /**
     * Show the bar iff the ACTIVE tab's latest real question (steering bubbles
     * excluded -- a mid-run correction is not the task being answered) is
     * scrolled fully above the viewport. Text is re-read every time, so the
     * bar always mirrors the newest question without bookkeeping per send
     * path; whitespace is collapsed because the collapsed bar is one line.
     */
    private updatePinnedQuestion(): void {
        const bar = this.pinnedQuestionBar;
        if (!bar) return;
        const hide = (): void => {
            bar.classList.add('agent-u-hidden');
            bar.classList.remove('vo-pinned-question-expanded');
        };
        const container = this.chatContainer;
        if (!container || container.classList.contains('agent-u-hidden')) { hide(); return; }
        const questions = container.querySelectorAll<HTMLElement>(':scope > .user-message:not(.chat-message-steering)');
        const last = questions.length > 0 ? questions[questions.length - 1] : null;
        if (!last) { hide(); return; }
        // Rect comparison rather than offsetTop: the container has no
        // `position`, so offsets would resolve against .chat-wrapper and pick
        // up any overlay quirks; rects are layout truth either way.
        const out = last.getBoundingClientRect().bottom <= container.getBoundingClientRect().top + 2;
        if (!out) { hide(); return; }
        const text = (last.querySelector<HTMLElement>('.message-content')?.textContent ?? '')
            .replace(/\s+/g, ' ')
            .trim();
        if (!text) { hide(); return; }
        const textEl = bar.querySelector<HTMLElement>('.vo-pinned-question-text');
        // setText only on change so text selection inside the expanded bar is
        // not destroyed by every scroll tick.
        if (textEl && textEl.getText() !== text) textEl.setText(text);
        bar.classList.remove('agent-u-hidden');
    }

    /** Switch the visible tab to session `index` (show/hide, no rebuild). */
    private switchToSession(index: number): void {
        if (index === this.activeSessionIndex || index < 0 || index >= this.sessions.length) return;
        this.activeSessionIndex = index;
        this.ensureSessionContainer(this.activeSession);
        this.showActiveSessionContainer();
        // A never-shown session still needs its initial paint (welcome or
        // reloaded messages) done once.
        this.paintSessionIfEmpty(this.activeSession);
        this.renderTabStrip();
        this.updateContextBadge();
        this.updateNavButtons();
    }

    /** First-paint a session's container from its uiMessages (once). */
    private paintSessionIfEmpty(session: ChatSession): void {
        const el = session.chatContainer;
        if (!el || el.childElementCount > 0) return;
        if (session.uiMessages.length === 0) {
            this.showWelcomeMessage();
            return;
        }
        const assistantPairs: { msg: UiMessage; el: HTMLElement }[] = [];
        for (const msg of session.uiMessages) {
            if (msg.role === 'user') {
                this.addUserMessage(msg.text);
            } else {
                const mel = this.renderMarkdownMessage(msg.text, 'assistant', msg.toolStepsHtml, msg.reasoningText, msg.usageFooter);
                if (mel) assistantPairs.push({ msg, el: mel });
            }
        }
        void this.rehydrateCheckpointMarkers(assistantPairs);
    }

    /**
     * Close the tab at `index`. A running session is not force-killed: the
     * user is asked whether to stop it first (the run otherwise keeps going
     * in the background and closing would orphan it). The last remaining tab
     * is never closed -- it is cleared to a fresh chat instead.
     */
    private async closeSession(index: number): Promise<void> {
        const session = this.sessions[index];
        if (!session) return;
        if (session.isBusy) {
            const stop = await confirmModal(this.app, {
                title: t('ui.tab.closeRunningTitle'),
                message: t('ui.tab.closeRunningBody'),
                confirmLabel: t('ui.tab.closeRunningStop'),
                destructive: true,
            });
            if (!stop) return;
            // History hardening phase B (R12): snapshot before aborting, same
            // rule as onClose -- the save below captures the pre-abort state.
            this.saveCurrentConversation(session);
            session.currentAbortController?.abort();
        }
        // FEAT-55-01 (post-merge verification 2026-07-25): closing a tab ENDS
        // that conversation, so it gets the same teardown any other conversation
        // end gets. Before this, closeSession just dropped the session: the
        // pending chat-frontmatter links were lost (finalizeConversation step 2
        // is their only in-session writer, ADR-022), no semantic title was ever
        // generated for that chat, and its memory extraction never ran. The old
        // single-view code reached all of this via clearConversation /
        // loadConversation; the tab paths bypassed it.
        this.saveCurrentConversation(session);
        try { this.enqueueMemoryExtraction(session); } catch { /* non-fatal */ }
        if (session.activeConversationId) {
            const msgs = [...session.uiMessages];
            void this.finalizeConversation(session.activeConversationId, msgs);
        }

        // Remove this session's DOM container from the wrapper.
        session.chatContainer?.remove();
        session.chatContainer = null;
        if (this.sessions.length === 1) {
            // Never leave zero tabs: reset the sole tab to a fresh chat.
            this.sessions[0] = new ChatSession();
            this.activeSessionIndex = 0;
            this.ensureSessionContainer(this.activeSession);
            this.showActiveSessionContainer();
            this.showWelcomeMessage();
            this.renderTabStrip();
            this.updateContextBadge();
            this.updateNavButtons();
            return;
        }
        this.sessions.splice(index, 1);
        // Keep the active index valid and pointing at a sensible neighbour.
        if (this.activeSessionIndex >= this.sessions.length) {
            this.activeSessionIndex = this.sessions.length - 1;
        } else if (index < this.activeSessionIndex) {
            this.activeSessionIndex--;
        }
        this.ensureSessionContainer(this.activeSession);
        this.showActiveSessionContainer();
        this.paintSessionIfEmpty(this.activeSession);
        this.renderTabStrip();
        this.updateContextBadge();
        this.updateNavButtons();
    }

    private buildChatContainer(container: HTMLElement): void {
        // Chat container is wrapped in a relative parent so the history panel can overlay it
        const chatWrapper = container.createDiv('chat-wrapper');
        this.chatWrapper = chatWrapper;

        // Pinned question bar: floats over the top of the chat while the
        // active tab's current question is scrolled out of view, one line with
        // ellipsis; click toggles the full text. An overlay (not position:
        // sticky on the bubble) on purpose -- sticky was defeated in the field
        // by another plugin's unscoped `.message{position:relative}` rule, and
        // flat sticky siblings would pile up at top:0 anyway. Visibility is
        // recomputed from scroll position (see updatePinnedQuestion).
        this.pinnedQuestionBar = chatWrapper.createDiv('vo-pinned-question agent-u-hidden');
        this.pinnedQuestionBar.createDiv('vo-pinned-question-text');
        this.registerDomEvent(this.pinnedQuestionBar, 'click', () => {
            this.pinnedQuestionBar?.classList.toggle('vo-pinned-question-expanded');
        });

        // FEAT-55-01 Phase C: one chat-messages container PER session, all
        // children of chatWrapper. Switching tabs shows/hides containers
        // instead of empty+rebuild, so a background run keeps streaming live
        // into its own (hidden) container and is intact on return.
        this.ensureSessionContainer(this.activeSession);

        // History panel (absolute overlay inside the wrapper)
        const store = this.plugin.conversationStore;
        if (store) {
            this.historyPanel = new HistoryPanel(
                store,
                (id) => { void this.openConversationInTab(id); },
                (id) => { void this.deleteConversation(id); },
                (convId, title) => { void this.stampChatLinkToActiveFile(convId, title); },
                this.activeConversationId,
                (id, title) => this.saveHistoryConversationToMemory(id, title),
                (id, title) => this.removeHistoryConversationFromMemory(id, title),
                (id) => this.plugin.countMemoryFactsForConversation(id) > 0,
                (id, currentTitle) => this.renameHistoryConversation(id, currentTitle),
                (id, title) => this.confirmPendingConversation(id, title),
                // FEAT-55-01: tag interrupted conversations in History.
                (id) => this.plugin.interruptedConversationIds.has(id),
            );
            this.historyPanel.mount(chatWrapper);
        }
    }

    /**
     * Lazy-initialize the history panel. Needed because onOpen() may run before
     * doLoad() finishes (Obsidian restores the sidebar layout synchronously),
     * so conversationStore can be null when buildChatContainer() first runs.
     */
    private ensureHistoryPanel(): void {
        if (this.historyPanel) return;
        const store = this.plugin.conversationStore;
        const chatWrapper = this.chatContainer?.parentElement;
        if (!store || !chatWrapper) return;
        this.historyPanel = new HistoryPanel(
            store,
            (id) => { void this.openConversationInTab(id); },
            (id) => { void this.deleteConversation(id); },
            (convId, title) => { void this.stampChatLinkToActiveFile(convId, title); },
            this.activeConversationId,
            (id, title) => this.saveHistoryConversationToMemory(id, title),
            (id, title) => this.removeHistoryConversationFromMemory(id, title),
            (id) => this.plugin.countMemoryFactsForConversation(id) > 0,
            (id, currentTitle) => this.renameHistoryConversation(id, currentTitle),
            undefined,
            // FEAT-55-01: tag interrupted conversations in History.
            (id) => this.plugin.interruptedConversationIds.has(id),
        );
        this.historyPanel.mount(chatWrapper);
    }

    private suggestionBanner: SuggestionBanner | null = null;

    /** Mount the suggestion banner (delegates to SuggestionBanner module). */
    private buildSuggestionBanner(container: HTMLElement): void {
        this.suggestionBanner = new SuggestionBanner(this.plugin, this.app);
        this.suggestionBanner.mount(container, (fn) => this.register(fn));
    }

    /**
     * IMP-41-03-05: compact status tile for the single background research
     * task. Subscribes to the runner and unsubscribes on view unload.
     */
    private buildBackgroundTaskTile(container: HTMLElement): void {
        const runner = this.plugin.backgroundTaskRunner;
        if (!runner) return;
        const tile = container.createDiv('background-task-tile');
        tile.hide();
        const icon = tile.createSpan('background-task-tile-icon');
        setIcon(icon, 'satellite');
        const label = tile.createSpan('background-task-tile-label');
        const stopBtn = tile.createEl('button', {
            cls: 'background-task-tile-stop',
            text: t('ui.backgroundTask.stop'),
        });
        stopBtn.addEventListener('click', () => runner.stop());

        const render = (): void => {
            const status = runner.getStatus();
            if (status) {
                label.setText(t('ui.backgroundTask.running', { title: status.title }));
                tile.show();
            } else {
                tile.hide();
            }
        };
        render();
        this.register(runner.onChange(() => render()));
    }

    private buildAiDisclaimer(container: HTMLElement): void {
        const disclaimer = container.createDiv({ cls: 'chat-ai-disclaimer' });
        disclaimer.setText(t('ui.sidebar.aiDisclaimer'));
    }

    private buildChatInput(container: HTMLElement): void {
        this.inputArea = container.createDiv('chat-input-container');
        // IMP-41-03-05: background-task status tile above the input. Hidden
        // by default; the runner's onChange subscription toggles it.
        this.buildBackgroundTaskTile(this.inputArea);
        const inputWrapper = this.inputArea.createDiv('chat-input-wrapper');

        // Context chips at the top of the input wrapper (like Kilo Code)
        this.contextBadgeContainer = inputWrapper.createDiv('chat-context-chips');
        this.updateContextBadge();

        // Attachment chip bar (below context chips, above textarea)
        const chipBar = inputWrapper.createDiv('chat-attachment-chips');
        this.attachments = new AttachmentHandler(this.app.vault, chipBar, this.plugin);

        this.textarea = inputWrapper.createEl('textarea', {
            cls: 'chat-textarea',
            attr: { placeholder: t('ui.sidebar.placeholder'), rows: '3' },
        });

        // Initialize autocomplete handler after textarea is created
        this.autocomplete = new AutocompleteHandler(
            this.plugin,
            this.app,
            () => this.textarea,
            () => this.inputArea,
            (file) => this.attachments.addVaultFile(file),
            // FEAT-02-11: folder-mention. Manifest attachment (path list),
            // lazy-read via read_file / read_document.
            (folder, opts) => this.attachments.addVaultFolder(folder, opts),
            // FEAT-55-02 (ADR-170): per-view active mode for slash-source filtering.
            () => this.modeService.getActiveModeSlug(),
        );

        this.textarea.addEventListener('input', () => {
            this.autoResizeTextarea();
            void this.autocomplete.handleInput();
            // FEAT-24-08 Steering: toggle Stop -> Send when user starts typing
            // mid-run (and back to Stop when textarea is cleared).
            this.refreshRunStateButtons();
        });

        this.textarea.addEventListener('keydown', (e: KeyboardEvent) => {
            // Autocomplete navigation takes priority
            if (this.autocomplete.handleKeyDown(e)) return;

            // FIX-24-08-03: Escape always stops a running task, independent
            // of textarea content (the button alone was unreachable while
            // steering text sat in the field).
            if (e.key === 'Escape' && this.currentAbortController) {
                e.preventDefault();
                this.handleStop();
                return;
            }

            // Issue #54.1: shared send-decision. Ctrl/Cmd+Enter always sends
            // (universal accelerator, fixes Windows where it was a no-op),
            // plain Enter sends only when sendWithEnter is on; Shift+Enter and
            // IME composition insert a newline.
            const sendWithEnter = this.plugin.settings.sendWithEnter ?? true;
            if (shouldSendOnEnter(e, sendWithEnter)) {
                e.preventDefault();
                this.autocomplete.hide(); // close any open dropdown after a modifier-send
                void this.handleSendMessage();
            }
        });

        // Paste handler — capture images pasted from clipboard (e.g. screenshots)
        this.textarea.addEventListener('paste', (e: ClipboardEvent) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            for (const item of Array.from(items)) {
                if (item.kind === 'file') {
                    e.preventDefault();
                    const file = item.getAsFile();
                    if (file) void this.attachments.processFile(file);
                }
            }
        });

        // Drag-and-drop handler on the input wrapper. BUG-019: stopPropagation
        // is required on both events so the workspace doesn't steal the drop
        // and open the file in a new tab. The drop payload is resolved in
        // priority order: external OS files, Obsidian's internal drag manager,
        // finally a plain-text path fallback for older Obsidian builds.
        inputWrapper.addEventListener('dragover', (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            inputWrapper.addClass('drag-over');
        });
        inputWrapper.addEventListener('dragleave', () => inputWrapper.removeClass('drag-over'));
        inputWrapper.addEventListener('drop', (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            inputWrapper.removeClass('drag-over');

            // OS file drop (external drag from Finder/Explorer/GNOME-Files)
            const files = e.dataTransfer?.files;
            if (files && files.length > 0) {
                for (const file of Array.from(files)) void this.attachments.processFile(file);
                return;
            }

            // BUG-019: Obsidian's internal drag populates app.dragManager.draggable
            // instead of dataTransfer.files. This is undocumented but stable across
            // Obsidian 1.4+ and widely used by community plugins. Guarded by a
            // null-check so a future API change silently falls through to the
            // text/plain path.
            //
            // FEAT-02-11: probe folders BEFORE files -- a folder-drag from the
            // file explorer is a distinct payload (`{ type: 'folder', file: TFolder }`)
            // and the folder path carries semantic meaning that a flattened
            // file list would lose. Default recursive, same as the @-mention
            // recursive row.
            const draggedFolders = resolveObsidianDraggedFolders(this.app);
            if (draggedFolders.length > 0) {
                for (const folder of draggedFolders) {
                    void this.attachments.addVaultFolder(folder, { recursive: true });
                }
                return;
            }
            const draggedFiles = resolveObsidianDraggedFiles(this.app);
            if (draggedFiles.length > 0) {
                for (const file of draggedFiles) void this.attachments.addVaultFile(file);
                return;
            }

            // Last-resort fallback: plain-text vault-relative path.
            const textData = e.dataTransfer?.getData('text/plain');
            if (textData) {
                const vaultFile = this.app.vault.getAbstractFileByPath(textData);
                if (vaultFile instanceof TFile) {
                    void this.attachments.addVaultFile(vaultFile);
                } else if (vaultFile instanceof TFolder) {
                    void this.attachments.addVaultFolder(vaultFile, { recursive: true });
                }
            }
        });

        const toolbar = inputWrapper.createDiv('chat-toolbar');
        const toolbarLeft = toolbar.createDiv('chat-toolbar-left');
        const toolbarRight = toolbar.createDiv('chat-toolbar-right');

        // EPIC-26 / FEAT-26-05: Mode switcher removed from the chat header.
        // 2026-05-18: the Agent/Mode-Button in the chat header is gone
        // (FEAT-26-05). Agent management lives in Settings -> Agents.
        // The mode backend stays functional: `currentMode` setting,
        // ModeService, `switch_agent` tool are unchanged.

        // Model button (left, after mode)
        this.modelButton = toolbarLeft.createEl('button', {
            cls: 'toolbar-button model-button',
            attr: { 'aria-label': t('ui.sidebar.selectModel') },
        });
        this.restoreChatModelOverride(); // Issue #54.3: sticky model on view open
        this.updateModelButton();
        this.modelButton.addEventListener('click', (e) => this.showModelMenu(e));

        // "+" button — context menu for adding files/notes (FEATURE-1907)
        const plusBtn = toolbarLeft.createEl('button', {
            cls: 'toolbar-button toolbar-ghost plus-button',
            attr: { 'aria-label': t('ui.sidebar.addContext') },
        });
        setIcon(plusBtn.createSpan('toolbar-icon'), 'plus');
        plusBtn.addEventListener('click', (e) => {
            this.showPlusMenu(e, plusBtn);
        });

        // "..." button — tools, skills, web search (FEATURE-1907)
        const ellipsisBtn = toolbarLeft.createEl('button', {
            cls: 'toolbar-button toolbar-ghost ellipsis-button',
            attr: { 'aria-label': t('ui.sidebar.moreOptions') },
        });
        setIcon(ellipsisBtn.createSpan('toolbar-icon'), 'ellipsis');
        ellipsisBtn.addEventListener('click', (e) => {
            this.showChatOptions(e, ellipsisBtn);
        });

        // Keep references for backward compat (hidden, managed via "..." menu now)
        this.toolPickerButton = ellipsisBtn;
        this.webToggleButton = ellipsisBtn;

        // Feature 3: Stop button (hidden by default, shown when task is running)
        this.stopButton = toolbarRight.createEl('button', {
            cls: 'toolbar-button stop-button',
            attr: { 'aria-label': t('ui.sidebar.stop') },
        });
        setIcon(this.stopButton.createSpan('toolbar-icon'), 'square');
        this.stopButton.classList.add('agent-u-hidden');
        this.stopButton.addEventListener('click', () => this.handleStop());

        // Send button
        this.sendButton = toolbarRight.createEl('button', {
            cls: 'toolbar-button send-button',
            attr: { 'aria-label': t('ui.sidebar.send') },
        });
        setIcon(this.sendButton.createSpan('toolbar-icon'), 'send-horizontal');
        this.sendButton.addEventListener('click', () => { void this.handleSendMessage(); });

        // FIX-PERF-28c: when the sidebar opened on shellReady (before
        // servicesReady), disable the send button until services finish
        // booting. The button re-enables itself as soon as servicesReady
        // resolves. Existing aria-label is preserved.
        const pluginAny = this.plugin as unknown as { servicesReady?: Promise<void>; readyPromise?: Promise<void> };
        const services = pluginAny.servicesReady ?? pluginAny.readyPromise;
        if (services) {
            const sendEl = this.sendButton as HTMLButtonElement;
            sendEl.disabled = true;
            sendEl.classList.add('send-button-preparing');
            sendEl.setAttribute('title', t('ui.sidebar.preparingServices'));
            services.then(() => {
                sendEl.disabled = false;
                sendEl.classList.remove('send-button-preparing');
                sendEl.removeAttribute('title');
            }).catch(() => {
                // doLoad errors are surfaced elsewhere; still enable the button.
                sendEl.disabled = false;
                sendEl.classList.remove('send-button-preparing');
            });
        }
    }

    /**
     * `+` menu (FEATURE-2207 / 2208): attachments, skills, prompts, workflows.
     * Picking a skill/prompt/workflow prefixes the textarea with the right
     * trigger and focuses the input so the user can add free text.
     */
    private showPlusMenu(e: MouseEvent, anchor: HTMLElement): void {
        const menu = new Menu();
        menu.addItem(item => item
            .setTitle(t('ui.sidebar.attachFile'))
            .setIcon('paperclip')
            .onClick(() => this.attachments.openFilePicker()));
        menu.addItem(item => item
            .setTitle(t('ui.sidebar.addVaultFile'))
            .setIcon('at-sign')
            .onClick(() => this.vaultFilePicker.show(anchor, this.containerEl)));
        menu.addSeparator();
        menu.addItem(item => item
            .setTitle(t('ui.sidebar.insertSkill'))
            .setIcon('sparkles')
            .onClick(() => this.openCommandPicker('skills', anchor)));
        menu.addItem(item => item
            .setTitle(t('ui.sidebar.insertPrompt'))
            .setIcon('message-square-quote')
            .onClick(() => this.openCommandPicker('prompts', anchor)));
        menu.addItem(item => item
            .setTitle(t('ui.sidebar.insertWorkflow'))
            .setIcon('workflow')
            .onClick(() => this.openCommandPicker('workflows', anchor)));
        menu.showAtMouseEvent(e);
    }

    private async openCommandPicker(
        category: 'skills' | 'prompts' | 'workflows',
        anchor: HTMLElement,
    ): Promise<void> {
        const items = await this.collectCommandItems(category);
        const title = category === 'skills'
            ? t('ui.commandPicker.searchSkills')
            : category === 'prompts'
                ? t('ui.commandPicker.searchPrompts')
                : t('ui.commandPicker.searchWorkflows');
        const empty = category === 'skills'
            ? t('ui.commandPicker.emptySkills')
            : category === 'prompts'
                ? t('ui.commandPicker.emptyPrompts')
                : t('ui.commandPicker.emptyWorkflows');
        const picker = new CommandPicker(items, title, empty);
        picker.show(anchor, this.containerEl);
    }

    private async collectCommandItems(
        category: 'skills' | 'prompts' | 'workflows',
    ): Promise<CommandPickerItem[]> {
        if (category === 'skills') {
            const skills = this.plugin.selfAuthoredSkillLoader?.getAllSkills() ?? [];
            return skills.map((skill) => {
                const slug = AutocompleteHandler.slugifySkillName(skill.name);
                return {
                    label: skill.name,
                    sub: `/${slug}`,
                    tag: 'Skill',
                    icon: 'sparkles',
                    searchable: skill.description,
                    onSelect: () => this.insertPrefixedCommand(slug),
                };
            });
        }

        if (category === 'prompts') {
            const activeMode = this.modeService.getActiveModeSlug();
            const prompts = (this.plugin.settings.customPrompts ?? []).filter(
                (p) => p.enabled !== false && (!p.mode || p.mode === activeMode),
            );
            return prompts.map((prompt) => ({
                label: prompt.name,
                sub: `/${prompt.slug}`,
                tag: 'Prompt',
                icon: 'message-square-quote',
                searchable: prompt.content,
                onSelect: () => this.insertPrefixedCommand(prompt.slug),
            }));
        }

        const workflowLoader = this.plugin.workflowLoader;
        if (!workflowLoader) return [];
        const workflows = await workflowLoader.discoverWorkflows();
        const toggles = this.plugin.settings.workflowToggles ?? {};
        const activeSlug = this.modeService.getActiveMode().slug;
        const items = workflows
            .filter((w) => toggles[w.path] !== false)
            .map((wf) => ({
                label: wf.displayName,
                sub: `/${wf.slug}`,
                tag: 'Workflow',
                icon: 'workflow',
                onSelect: () => this.insertPrefixedCommand(wf.slug),
                // The pin forces the workflow on every message in this agent,
                // separate from the click that inserts it once (FEAT-02-12).
                pin: {
                    isActive: () => (this.plugin.settings.forcedWorkflow?.[this.modeService.getActiveMode().slug] ?? '') === wf.slug,
                    labelOff: t('ui.commandPicker.forceWorkflowOff'),
                    labelOn: t('ui.commandPicker.forceWorkflowOn'),
                    onToggle: () => this.toggleForcedWorkflow(wf.slug),
                },
            }));
        // A forced workflow whose file was deleted or disabled would otherwise
        // have no unpin control anywhere (the chip is not interactive). Render
        // it as a synthetic row so the pin stays reachable (FEAT-02-12 review fix).
        const forcedSlug = this.plugin.settings.forcedWorkflow?.[activeSlug] ?? '';
        if (forcedSlug !== '' && !items.some((i) => i.sub === `/${forcedSlug}`)) {
            items.push({
                label: t('ui.commandPicker.forcedWorkflowMissing', { slug: forcedSlug }),
                sub: `/${forcedSlug}`,
                tag: 'Workflow',
                icon: 'workflow',
                onSelect: () => this.insertPrefixedCommand(forcedSlug),
                pin: {
                    isActive: () => (this.plugin.settings.forcedWorkflow?.[this.modeService.getActiveMode().slug] ?? '') === forcedSlug,
                    labelOff: t('ui.commandPicker.forceWorkflowOff'),
                    labelOn: t('ui.commandPicker.forceWorkflowOn'),
                    onToggle: () => this.toggleForcedWorkflow(forcedSlug),
                },
            });
        }
        return items;
    }

    /**
     * Force the given workflow for the current agent, or clear it if it was
     * already forced (toggle). Persists and refreshes the indicator chip.
     */
    private toggleForcedWorkflow(slug: string): void {
        // Resolved slug (deleted mode -> 'agent') so pin, chip, and send path
        // all key on the same agent (FEAT-02-12 review fix).
        const modeSlug = this.modeService.getActiveMode().slug;
        if (!this.plugin.settings.forcedWorkflow) this.plugin.settings.forcedWorkflow = {};
        const current = this.plugin.settings.forcedWorkflow[modeSlug] ?? '';
        this.plugin.settings.forcedWorkflow[modeSlug] = nextForcedWorkflow(current, slug);
        void this.plugin.saveSettings();
        // Both surfaces re-render their chip via the hub (IMP-02-12-01);
        // this view's own subscription covers the local badge.
        this.plugin.forcedWorkflowHub.notify();
    }

    private insertPrefixedCommand(slug: string): void {
        if (!this.inputArea) return;
        const textarea = this.inputArea.querySelector('textarea');
        if (!(textarea instanceof HTMLTextAreaElement)) return;
        const existing = textarea.value;
        // FEAT-02-13: '#' und '\u00a7' sind abgeschafft, werden hier aber weiter
        // als fuehrendes Zeichen erkannt. Sonst bliebe ein alter Praefix aus
        // einem halb getippten Kommando stehen und das Ergebnis waere '#/slug'.
        const leadsWithPrefix = /^[/#\u00a7]/.test(existing);
        const body = leadsWithPrefix ? existing.split(/\s+/).slice(1).join(' ') : existing;
        textarea.value = `/${slug}${body ? ' ' + body : ' '}`;
        textarea.focus();
        const pos = textarea.value.length;
        textarea.setSelectionRange(pos, pos);
    }

    private updateContextBadge(): void {
        if (!this.contextBadgeContainer) return;
        this.contextBadgeContainer.empty();

        // Forced-workflow chip first, so it stays visible even when the
        // active-file context toggle is off (IMP-02-02-01). Without this the
        // forced workflow is invisible outside the tool picker, which is what
        // made Issue #57 so hard to diagnose.
        this.renderForcedWorkflowChip();

        if (!this.plugin.settings.autoAddActiveFileContext) return;

        const activeFile = this.userDismissedContext ? null : this.app.workspace.getActiveFile();
        if (activeFile) {
            const chip = this.contextBadgeContainer.createDiv('chat-context-chip');
            chip.title = activeFile.path;
            setIcon(chip.createSpan('context-chip-icon'), 'file-text');
            chip.createSpan('context-chip-label').setText(activeFile.basename);
            const removeBtn = chip.createSpan('context-chip-remove');
            setIcon(removeBtn, 'x');
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.userDismissedContext = true;
                this.updateContextBadge();
            });
        }
    }

    /**
     * Render a plain status chip for the forced workflow of the current agent,
     * so its presence stays visible without adding a control above the chat. It
     * is not interactive; turning the workflow off happens on its pin in the
     * "+" menu workflow picker (Issue #57, IMP-02-02-01, FEAT-02-12).
     */
    private renderForcedWorkflowChip(): void {
        if (!this.contextBadgeContainer) return;
        const modeSlug = this.modeService.getActiveMode().slug;
        const wfSlug = this.plugin.settings.forcedWorkflow?.[modeSlug] ?? '';
        if (!wfSlug) return;

        const chip = this.contextBadgeContainer.createDiv('chat-context-chip chat-forced-workflow-chip');
        chip.title = t('ui.sidebar.forcedWorkflowChipTooltip', { slug: wfSlug });
        setIcon(chip.createSpan('context-chip-icon'), 'git-branch');
        chip.createSpan('context-chip-label').setText(t('ui.sidebar.forcedWorkflowChipLabel', { slug: wfSlug }));
    }

    /** Resolve a model key for a mode, skipping disabled models: mode override → global → first enabled */
    private resolveEnabledModelKey(modeSlug: string): string {
        const models = this.plugin.settings.activeModels;

        // Check mode override — skip if model is disabled
        const modeOverrideKey = this.plugin.settings.modeModelKeys?.[modeSlug];
        if (modeOverrideKey) {
            const m = models.find((m) => getModelKey(m) === modeOverrideKey);
            if (m?.enabled) return modeOverrideKey;
        }

        // Check global default — skip if model is disabled
        const globalKey = this.plugin.settings.activeModelKey;
        if (globalKey) {
            const m = models.find((m) => getModelKey(m) === globalKey);
            if (m?.enabled) return globalKey;
        }

        // Fallback: first enabled model
        return getFirstEnabledModelKey(models);
    }

    /** Returns the effective model key for the current mode (mode override → global fallback) */
    private getEffectiveModelKey(): string {
        return this.resolveEnabledModelKey(this.modeService.getActiveModeSlug());
    }

    private updateModelButton(): void {
        if (!this.modelButton) return;
        this.modelButton.empty();
        // EPIC-26 / FEAT-26-05: when a provider is active, the button
        // shows either "Auto" (default) or the explicit override id.
        const activeProvider = resolveActiveProvider(this.plugin.settings);
        let label: string;
        let title: string;
        if (activeProvider) {
            if (this.chatModelOverride === null) {
                // FIX-24-05-08 (D7): "Auto" alone named the routing rule, not
                // the model the run bills. autoModelLabel resolves the rule
                // through the same cascade initApiHandler uses, so the pill and
                // the cost footer of the same run name one model.
                const resolved = autoModelLabel(this.plugin.settings);
                label = resolved.label;
                title = resolved.tooltip;
            } else {
                // Chat-header always renders the bare core model id, not the
                // provider-supplied displayName. Bedrock cross-region profiles
                // expand into long strings like "EU Anthropic Claude Opus 4.8
                // [Cross-Region Profile]" that push the composer row off-screen.
                // shortenModelId collapses the underlying id to its core form
                // ("eu.anthropic.claude-opus-4-8-v1:0" -> "claude-opus-4-8");
                // the full id and the descriptive displayName stay in the
                // tooltip and inside the picker popover.
                label = this.shortenModelId(this.chatModelOverride);
                title = t('ui.sidebar.modelOverrideTitle', { label: this.chatModelOverride });
            }
        } else {
            // Legacy / pre-migration path: read the flat activeModels[] selection.
            const effectiveKey = this.getEffectiveModelKey();
            const model = this.plugin.settings.activeModels.find((m) => getModelKey(m) === effectiveKey);
            label = model ? (model.displayName ?? model.name) : t('ui.sidebar.noModel');
            const hasModeOverride = !!this.plugin.settings.modeModelKeys?.[this.modeService.getActiveModeSlug()];
            title = hasModeOverride ? t('ui.sidebar.modeOverride', { label }) : label;
        }
        this.modelButton.createSpan('model-label').setText(label);
        // The thinking state stays visible inside the picker popover
        // (chat-model-picker-thinking-switch); the chat composer pill row only
        // shows the model identity, so a thinking deviation is conveyed via the
        // tooltip without a second chip cluttering the row.
        if (isExplicitThinkingOverride(this.chatThinkingOverride)) {
            const thinkingOn = thinkingSwitchIsOn(this.chatThinkingOverride);
            title = thinkingOn
                ? t('ui.sidebar.thinkingOverrideTitleOn', { label: title })
                : t('ui.sidebar.thinkingOverrideTitleOff', { label: title });
        }
        setIcon(this.modelButton.createSpan('mode-chevron'), 'chevron-down');
        this.modelButton.title = title;
        // Use the effective key for context-tracker logic below.
        const effectiveKey = this.getEffectiveModelKey();
        const model = this.plugin.settings.activeModels.find((m) => getModelKey(m) === effectiveKey);

        // Update context tracker when model changes
        if (this.contextTracker && model) {
            try {
                const apiHandler = buildApiHandlerForModel(model);
                const modelInfo = apiHandler?.getModel().info;
                if (modelInfo?.contextWindow) {
                    this.contextTracker.updateContextWindow(
                        modelInfo.contextWindow,
                        model.maxTokens
                    );
                }
            } catch (e) {
                console.debug('[AgentSidebarView] Failed to update context window for model change:', e);
            }
        }
    }

    private showModelMenu(event: MouseEvent): void {
        // EPIC-26 / FEAT-26-05: when a provider is active, show Auto + the
        // provider's discovered models. Otherwise (pre-migration / fresh
        // install) fall back to the legacy flat model list.
        const activeProvider = resolveActiveProvider(this.plugin.settings);
        if (activeProvider) {
            this.showProviderModelMenu(event, activeProvider);
            return;
        }

        const enabled = this.plugin.settings.activeModels.filter((m) => m.enabled);
        const menu = new Menu();
        const modeSlug = this.modeService.getActiveModeSlug();
        const modeOverrideKey = this.plugin.settings.modeModelKeys?.[modeSlug] ?? '';
        const globalKey = this.plugin.settings.activeModelKey;
        const effectiveKey = modeOverrideKey || globalKey;

        if (enabled.length === 0) {
            menu.addItem((item) =>
                item.setTitle(t('ui.sidebar.noModelsEnabled')).setIcon('settings').onClick(() => {
                    this.app.setting?.open();
                    window.setTimeout(() => this.app.setting?.openTabById(this.plugin.manifest.id), 50);
                }),
            );
        } else {
            // Option to clear mode override (use global default)
            if (modeOverrideKey) {
                const globalModel = this.plugin.settings.activeModels.find((m) => getModelKey(m) === globalKey);
                const globalLabel = globalModel ? (globalModel.displayName ?? globalModel.name) : t('ui.sidebar.globalDefault');
                menu.addItem((item) =>
                    item
                        .setTitle(t('ui.sidebar.useGlobalDefault', { label: globalLabel }))
                        .setIcon('rotate-ccw')
                        .onClick(async () => {
                            if (this.plugin.settings.modeModelKeys) {
                                delete this.plugin.settings.modeModelKeys[modeSlug];
                            }
                            await this.plugin.saveSettings();
                            this.updateModelButton();
                        }),
                );
                menu.addSeparator();
            }

            enabled.forEach((model) => {
                const key = getModelKey(model);
                menu.addItem((item) =>
                    item
                        .setTitle(model.displayName ?? model.name)
                        .setChecked(effectiveKey === key)
                        .onClick(async () => {
                            // Set as mode-specific override (not global default)
                            if (!this.plugin.settings.modeModelKeys) this.plugin.settings.modeModelKeys = {};
                            this.plugin.settings.modeModelKeys[modeSlug] = key;
                            await this.plugin.saveSettings();
                            this.updateModelButton();
                        }),
                );
            });
        }

        menu.showAtMouseEvent(event);
    }

    /**
     * EPIC-26 / FEAT-26-05: short-label helper for the chat-header model
     * button. Strips OpenRouter vendor prefix ("anthropic/...") and
     * Bedrock region + vendor + version wrappers so the button stays
     * narrow. Display name is preferred upstream of this helper; this
     * runs as a last-resort fallback.
     */
    private shortenModelId(id: string): string {
        let s = id;
        if (s.includes('/')) s = s.split('/').pop() ?? s;
        const m = s.match(/(?:^|\.)(?:anthropic|amazon|meta|mistral|cohere|ai21|stability|deepseek|writer|qwen)\.(.+)$/i);
        if (m) s = m[1];
        s = s.replace(/-v\d+(?::\d+)?$/i, '').replace(/:\d+$/, '');
        return s;
    }

    /**
     * Issue #54.3: persist the chat-header model override for the active
     * provider so it survives restarts and new chats. No-op when
     * persistChatModel is off; null (Auto) clears the stored entry.
     */
    private async persistChatModelOverride(overrideId: string | null): Promise<void> {
        if (!this.plugin.settings.persistChatModel) return;
        const pid = this.plugin.settings.activeProviderId;
        if (!pid) return;
        const map = this.plugin.settings.lastChatModelByProvider ?? {};
        if (overrideId === null) delete map[pid];
        else map[pid] = overrideId;
        this.plugin.settings.lastChatModelByProvider = map;
        await this.plugin.saveSettings();
    }

    /**
     * Issue #54.3: restore the sticky chat-header model for the active provider.
     * Falls back to Auto (null) when persistence is off, no provider is active,
     * or the saved model no longer exists on the provider.
     */
    private restoreChatModelOverride(): void {
        this.chatModelOverride = resolveStickyChatModel(
            resolveActiveProvider(this.plugin.settings),
            this.plugin.settings.lastChatModelByProvider,
            this.plugin.settings.activeProviderId,
            this.plugin.settings.persistChatModel,
        );
    }

    /**
     * EPIC-26 / FEAT-26-05: searchable popover when a provider is active.
     * Bedrock and OpenRouter routinely list 50+ models -- a plain Menu
     * was not scrollable enough; ChatModelPickerPopover adds a filter
     * input matching the ToolPicker pattern.
     */
    private showProviderModelMenu(event: MouseEvent, provider: import('../types/settings').ProviderConfig): void {
        if (!this.modelButton) return;
        if (!this.chatModelPicker) this.chatModelPicker = new ChatModelPickerPopover();
        if (this.chatModelPicker.isOpen()) {
            this.chatModelPicker.close();
            return;
        }
        this.chatModelPicker.show(event, this.modelButton, this.containerEl, provider, {
            getCurrent: () => this.chatModelOverride,
            onSelect: (overrideId) => {
                this.chatModelOverride = overrideId;
                // Effort is a pin-only control. Unpinning (back to Auto) clears
                // any chosen effort so Auto mode falls back to the model's own
                // vendor default; a stale level must not leak onto the router.
                if (overrideId === null) {
                    this.chatEffortOverride = DEFAULT_EFFORT_OVERRIDE;
                }
                void this.persistChatModelOverride(overrideId); // Issue #54.3
                this.updateModelButton();
            },
            getThinking: () => this.chatThinkingOverride,
            onThinkingChange: (override) => {
                this.chatThinkingOverride = override;
                this.updateModelButton();
            },
            getEffort: () => this.chatEffortOverride,
            onEffortChange: (override) => {
                this.chatEffortOverride = override;
                this.updateModelButton();
            },
            getEffortLevels: () => this.resolveEffortLevelsForPinnedModel(provider),
        }, this.buildChatProviderNav(event));
    }

    /**
     * Issue #48.5: provider-switcher wiring for the chat model picker. Lets the
     * user switch the active provider (a global settings change) from the chat
     * without opening Settings > Providers. Only enabled providers are offered;
     * the picker itself hides the row when fewer than two are enabled.
     */
    private buildChatProviderNav(event: MouseEvent): ChatProviderNav {
        const enabled = (this.plugin.settings.providerConfigs ?? []).filter((p) => p.enabled);
        return {
            items: enabled.map((p) => ({ id: p.id, label: p.displayName ?? p.type })),
            activeId: this.plugin.settings.activeProviderId,
            onSelect: (id) => {
                void (async () => {
                    if (id === this.plugin.settings.activeProviderId) return;
                    this.plugin.settings.activeProviderId = id;
                    // Issue #54.3: load the newly active provider's sticky model
                    // (or Auto). A pinned id from the previous provider must never
                    // reach the new one, so resolve against the new provider.
                    this.restoreChatModelOverride();
                    this.chatEffortOverride = DEFAULT_EFFORT_OVERRIDE;
                    await this.plugin.saveSettings();
                    this.updateModelButton();
                    // Re-open the picker on the newly active provider's models.
                    const next = resolveActiveProvider(this.plugin.settings);
                    this.chatModelPicker?.close();
                    if (next) this.showProviderModelMenu(event, next);
                })();
            },
        };
    }

    /**
     * Native effort levels for the PINNED chat-header model, or [] when nothing
     * is pinned. Effort is a pin-only control: in Auto mode the tier router
     * already picks the model for the task, so no effort dial is offered and the
     * model keeps its own vendor default (the provider layer sends no effort
     * field). The empty array hides the effort slider, which is how Auto mode and
     * effort-incapable models (Gemini, local) both end up with no control.
     *
     * IMP-54-05b: delegates to the pure resolveEffortLevelsForPin helper,
     * which applies the provider's per-model effort opt-in (custom /
     * OpenAI-compatible endpoints) before the static registry families.
     */
    private resolveEffortLevelsForPinnedModel(
        provider: import('../types/settings').ProviderConfig,
    ): EffortLevel[] {
        return resolveEffortLevelsForPin(provider, this.chatModelOverride);
    }

    /**
     * 2026-05-18: legacy mode-button + popover removed (FEAT-26-05).
     * Tool-Picker stays in the chat toolbar; with "Ask" gone there is
     * no mode that hides it, so we always show.
     */
    private updateToolPickerButton(): void {
        if (!this.toolPickerButton) return;
        this.toolPickerButton.classList.remove('agent-u-hidden');
        this.updateWebToggleButton();
    }

    /**
     * Manual memory save (FEATURE-0318): always available, bypasses both
     * autoExtractSessions and the message-count threshold. Calls the same
     * Single-Call pipeline the auto-path uses, just with bypassThrottle=true.
     */
    private async handleSaveToMemory(): Promise<void> {
        const mem = this.plugin.settings.memory;
        if (!mem.enabled) {
            new Notice(t('notice.memoryDisabled'));
            return;
        }
        const queue = this.plugin.extractionQueue;
        const snapshot = this.snapshotForMemory();
        if (!queue || !snapshot) {
            new Notice(t('notice.memoryNoActiveConversation'));
            return;
        }
        try {
            await queue.enqueueImmediate(snapshot);
            new Notice(t('notice.memorySaveQueued'));
            void this.pollMemoryStarUntilReady(snapshot.conversationId);
        } catch (e) {
            console.warn('[Memory] Manual save failed:', e);
            new Notice(t('notice.memorySaveFailed'));
        }
    }

    /**
     * After enqueueImmediate, the LLM extraction runs in the background
     * and only THEN do facts land in the DB. Poll for up to 90s so the
     * history panel star eventually reflects the saved state without
     * the user having to reopen the panel.
     */
    private async pollMemoryStarUntilReady(conversationId: string): Promise<void> {
        const startedAt = Date.now();
        const TIMEOUT_MS = 90_000;
        const INTERVAL_MS = 2_000;
        while (Date.now() - startedAt < TIMEOUT_MS) {
            await new Promise(resolve => window.setTimeout(resolve, INTERVAL_MS));
            if (this.plugin.countMemoryFactsForConversation(conversationId) > 0) {
                this.historyPanel?.refresh();
                return;
            }
        }
        this.historyPanel?.refresh();
    }

    /**
     * Save a HISTORY conversation (not the currently active one) to memory.
     * Loads the persisted UiMessages from ConversationStore and enqueues
     * them with bypassThrottle=true. Used by the Star button in HistoryPanel.
     */
    /** Rename a history conversation via prompt modal. */
    private async renameHistoryConversation(id: string, currentTitle: string): Promise<void> {
        const store = this.plugin.conversationStore;
        if (!store) return;
        const { promptModal } = await import('./modals/PromptModal');
        const next = await promptModal(this.app, {
            title: t('ui.history.renameTitle'),
            message: t('ui.history.renameMessage'),
            placeholder: currentTitle,
            defaultValue: currentTitle,
            submitLabel: t('ui.history.renameSubmit'),
        });
        if (next === null) return;
        const trimmed = next.trim();
        if (!trimmed || trimmed === currentTitle) return;
        // issue #45 quirk 2: titleSource='user' lockt den Title gegen
        // spaetere Auto-Writer (LLM-Titler in finalizeConversation,
        // onComplete-Fallback, MCP-Sync). Der Guard sitzt zentral in
        // ConversationStore.updateMeta.
        await store.updateMeta(id, { title: trimmed, titleSource: 'user' });
    }

    /** Un-pin: deprecate all facts that came from this conversation. */
    private async removeHistoryConversationFromMemory(id: string, title: string): Promise<void> {
        const mem = this.plugin.settings.memory;
        if (!mem.enabled) {
            new Notice(t('notice.memoryDisabled'));
            return;
        }
        try {
            const removed = await this.plugin.unpinMemoryFactsForConversation(id);
            new Notice(t('notice.memoryRemoved', { count: removed, title }));
        } catch (e) {
            console.warn('[Memory] Remove failed:', e);
            new Notice(t('notice.memorySaveFailed'));
        }
    }

    private async saveHistoryConversationToMemory(id: string, title: string): Promise<void> {
        const mem = this.plugin.settings.memory;
        if (!mem.enabled) {
            new Notice(t('notice.memoryDisabled'));
            return;
        }
        const queue = this.plugin.extractionQueue;
        const store = this.plugin.conversationStore;
        if (!queue || !store) {
            new Notice(t('notice.memoryNoActiveConversation'));
            return;
        }
        try {
            const data = await store.load(id);
            if (!data || data.uiMessages.length === 0) {
                new Notice(t('notice.memoryNoActiveConversation'));
                return;
            }
            const messages = data.uiMessages.map((m) => ({ role: m.role, text: m.text }));
            await queue.enqueueImmediate({
                conversationId: id,
                messages,
                title,
                queuedAt: new Date().toISOString(),
            });
            new Notice(t('notice.memorySaveQueued'));
            void this.pollMemoryStarUntilReady(id);
        } catch (e) {
            console.warn('[Memory] Save history conversation failed:', e);
            new Notice(t('notice.memorySaveFailed'));
        }
    }

    /**
     * BA-26 / FEAT-23-04: confirm a pending external conversation.
     * Flips syncState 'pending' -> 'confirmed' and enqueues the
     * conversation for memory extraction with shared thresholds.
     */
    private async confirmPendingConversation(id: string, title: string): Promise<void> {
        const store = this.plugin.conversationStore;
        const queue = this.plugin.extractionQueue;
        if (!store) {
            new Notice(t('notice.memoryNoActiveConversation'));
            return;
        }
        try {
            const flipped = await store.confirm(id);
            if (!flipped) {
                new Notice(t('notice.memory.alreadyConfirmed'));
                return;
            }
            // Trigger memory extraction (auto-sync would have done this on save).
            if (this.plugin.settings.memory.enabled && queue) {
                const data = await store.load(id);
                if (data && data.uiMessages.length > 0) {
                    const messages = data.uiMessages.map((m) => ({ role: m.role, text: m.text }));
                    await queue.enqueueImmediate({
                        conversationId: id,
                        messages,
                        title,
                        queuedAt: new Date().toISOString(),
                    });
                }
            }
            new Notice(t('notice.memory.confirmed', { title }));
        } catch (e) {
            console.warn('[Memory] Confirm pending failed:', e);
            new Notice(t('notice.memorySaveFailed'));
        }
    }

    private async toggleWebSearch(): Promise<void> {
        const isEnabled = this.plugin.settings.webTools?.enabled ?? false;
        const newState = !isEnabled;
        if (!this.plugin.settings.webTools) {
            this.plugin.settings.webTools = { enabled: false, provider: 'none', braveApiKey: '', tavilyApiKey: '' };
        }
        this.plugin.settings.webTools.enabled = newState;
        await this.plugin.saveSettings();
        this.updateWebToggleButton();

        // Check for missing provider/API key and show notice
        if (newState) {
            const provider = this.plugin.settings.webTools.provider;
            if (!provider || provider === 'none') {
                new Notice(t('notice.webSearchEnabled'));
            }
        }
    }

    private updateWebToggleButton(): void {
        if (!this.webToggleButton) return;
        // Only show when the active mode supports web tools
        const mode = this.modeService.getActiveMode();
        const modeHasWeb = mode?.toolGroups?.includes('web') ?? false;
        this.webToggleButton.classList.toggle('agent-u-hidden', !modeHasWeb);
        // Visual state: active (highlighted) or inactive (ghost)
        const isEnabled = this.plugin.settings.webTools?.enabled ?? false;
        this.webToggleButton.classList.toggle('web-toggle-active', isEnabled);
    }

    // 2026-05-18: showModeMenu + getModeIcon removed (dead since the
    // chat-header Mode-button was retired in FEAT-26-05). Agent-switching
    // now lives entirely in Settings -> Agents. getModeDisplayName stays
    // because the mode-switched Notice still uses it.

    private getModeDisplayName(modeSlug: string): string {
        return this.modeService.getMode(modeSlug)?.name ?? modeSlug;
    }

    // ---------------------------------------------------------------------------

    /**
     * Build the skills section for the system prompt.
     * Combines keyword-matched skills with any forced skills from the tool picker.
     */
    /**
     * Build a compact vault-structure snapshot injected into every user message.
     * Gives the model immediate orientation (top-level folders, note count, recent files)
     * so it doesn't need to call list_files or get_vault_stats just to orient itself.
     * Mirrors the <environment_details> pattern used by Kilo Code and Craft Agents.
     */
    private buildVaultContext(): string {
        // FIX-PERF-33: cache the rendered context string. Previously a
        // 3,653-file vault sorted the full list by mtime on every send-
        // click. The cache is invalidated by vault.on('create' | 'delete'
        // | 'rename' | 'modify') -- see ensureVaultContextWatcher() below.
        // AUDIT 2026-07-26 M-7: the cache is invalidated by vault events, but
        // .obsidian-agentignore is a dotfile and is NOT in Obsidian's file
        // index, so editing the deny rules fires nothing. A cached context built
        // before a rule was added would keep leaking for the rest of the
        // session. Key the cache on the ruleset generation as well.
        const rulesetGeneration = this.plugin.ignoreService.getGeneration();
        if (this.vaultContextCacheGeneration !== rulesetGeneration) {
            this.vaultContextCache = null;
            this.vaultContextCacheGeneration = rulesetGeneration;
        }
        if (this.vaultContextCache !== null) return this.vaultContextCache;
        this.ensureVaultContextWatcher();
        try {
            const root = this.app.vault.getRoot();
            const folders: string[] = [];
            const rootFiles: string[] = [];

            for (const child of root.children) {
                // AUDIT 2026-07-26 M-7: this block goes into every user message,
                // so it was the widest of the enumeration leaks. `startsWith('.')`
                // hides dotfolders, not the user's deny zone.
                if (isDeniedPath(this.plugin, child.path)) continue;
                if ('children' in child) {
                    // It's a folder, skip hidden/system dirs
                    const name = child.name;
                    if (!name.startsWith('.')) folders.push(name);
                } else {
                    rootFiles.push(child.name);
                }
            }

            const allMd = keepVisible(this.plugin, this.app.vault.getMarkdownFiles(), (f) => f.path);
            const noteCount = allMd.length;

            // 5 most recently modified notes (path only)
            const recent = [...allMd]
                .sort((a, b) => b.stat.mtime - a.stat.mtime)
                .slice(0, 5)
                .map((f) => f.path);

            // AUDIT 2026-07-26 M-6: folder, file and note names are vault bytes
            // and this block goes into EVERY user message. `vault_context` is one
            // of the boundary tags the security prompt names as untrusted, so a
            // note called `x</vault_context>...` used to escape the envelope on
            // every turn -- and the result is cached, so one bad name persisted.
            // sanitizeDirectoryEntry defangs and flattens to one row, which also
            // stops a newline in a name forging an extra line.
            const clean = (v: string): string => sanitizeDirectoryEntry(v, 200);
            const lines: string[] = ['<vault_context>'];
            lines.push(`Notes: ${noteCount}`);
            if (folders.length > 0) lines.push(`Top-level folders: ${folders.map(clean).join(', ')}`);
            if (rootFiles.length > 0) lines.push(`Root files: ${rootFiles.map(clean).join(', ')}`);
            if (recent.length > 0) lines.push(`Recently modified: ${recent.map(clean).join(', ')}`);
            lines.push('</vault_context>');
            const out = lines.join('\n');
            this.vaultContextCache = out;
            return out;
        } catch {
            return '';
        }
    }

    private vaultContextCache: string | null = null;
    private vaultContextCacheGeneration = -1;
    private vaultContextWatcherInstalled = false;
    private ensureVaultContextWatcher(): void {
        if (this.vaultContextWatcherInstalled) return;
        this.vaultContextWatcherInstalled = true;
        const invalidate = (): void => { this.vaultContextCache = null; };
        // FIX-PERF-33: rebuild on any vault mutation. modify is included
        // because the recent-modified list depends on mtime.
        this.registerEvent(this.app.vault.on('create', invalidate));
        this.registerEvent(this.app.vault.on('delete', invalidate));
        this.registerEvent(this.app.vault.on('rename', invalidate));
        this.registerEvent(this.app.vault.on('modify', invalidate));
    }

    /**
     * Build the SKILLS directory for the stable system-prompt prefix
     * (FEAT-24-09 / ADR-116). Lists every installed skill (name + description,
     * plus inventory lines for self-authored skills) -- the LLM picks a skill
     * itself based on the directory and loads its body via the read_skill
     * tool. Replaces the previous classifier-driven body injection.
     *
     * Honours the manual skill toggles so the directory matches what the
     * user actually exposes.
     */
    private async buildSkillDirectory(): Promise<string | undefined> {
        const skillsManager = this.plugin.skillsManager;
        const selfLoader = this.plugin.selfAuthoredSkillLoader;

        const toggles = this.plugin.settings.manualSkillToggles ?? {};
        // FIX-29-05-03: see main.buildSkillDirectoryForMode -- a skill that
        // fails hard validation must not enter <available_skills>, because
        // invoke_skill resolves against the loader and would not find it.
        const userSkills = skillsManager ? loadableSkills(await skillsManager.discoverSkills()) : [];
        const filteredUserSkills = Object.keys(toggles).length > 0
            ? userSkills.filter(s => toggles[s.path] !== false)
            : userSkills;

        // AUDIT 2026-07-26 M-17: see skillToggleGate -- the self-authored block
        // bypassed the switches entirely (different key than `s.path`).
        const selfSkills = selfLoader?.getAllSkills() ?? [];
        const selfAuthoredBlock = selfLoader?.getMetadataSummary(
            enabledSelfAuthoredNames(toggles, selfSkills),
        ) ?? '';
        const selfAuthoredNames = new Set(selfSkills.map(s => s.name));

        const userLines = filteredUserSkills
            .filter(s => !selfAuthoredNames.has(s.name))
            // AUDIT 2026-07-14 (Codex) M-1: user/imported skill names and
            // descriptions are untrusted; sanitise before they enter the cached
            // <available_skills> prompt block (defang boundary tags + one line).
            .map(s => `- ${sanitizeDirectoryEntry(s.name, 80)}: ${sanitizeDirectoryEntry(s.description, SKILL_DESCRIPTION_PROMPT_CAP)}`);

        const blocks = [selfAuthoredBlock, userLines.join('\n')].filter(Boolean);
        if (blocks.length === 0) return undefined;

        const directory = blocks.join('\n');
        console.debug(`[buildSkillDirectory] ${selfAuthoredNames.size} self-authored + ${userLines.length} user skill(s)`);
        return directory;
    }

    private autoResizeTextarea(): void {
        if (!this.textarea) return;
        // The height is measured from scrollHeight. Reading it synchronously in
        // the input handler samples the layout from BEFORE the just-typed
        // character (notably a Shift+Enter newline) has been laid out, so the
        // box grew only on the 2nd/3rd press. Defer the measure to the next
        // frame -- by then the value change is committed and reflowed -- and
        // coalesce a burst of input events into a single measure.
        if (this.textareaResizePending) return;
        this.textareaResizePending = true;
        window.requestAnimationFrame(() => {
            this.textareaResizePending = false;
            if (!this.textarea) return;
            this.textarea.setCssProps({ '--agent-textarea-h': 'auto' });
            this.textarea.setCssProps({ '--agent-textarea-h': Math.min(this.textarea.scrollHeight, 15 * 24) + 'px' });
        });
    }

    /**
     * Show the onboarding welcome message (first activation only).
     * Chat-based flow: scripted assistant bubbles + buttons, no LLM needed.
     * User pastes API key in the normal chat textarea.
     */
    /** Show the welcome message (delegates to OnboardingFlow module). */
    private showWelcomeMessage(): void {
        if (!this.chatContainer) return;
        const ob = this.plugin.settings.onboarding;

        // Phase 2.3: if the FirstRun wizard is still owed to the user
        // (not completed, not dismissed, not yet shown three times),
        // open the wizard instead of the legacy in-chat provider-picker.
        //
        // FIX (2026-06-15): when the user manually restarts the setup from
        // Settings -> Interface / Memory and then cancels the wizard, the
        // pure modalCompleted check would re-open the wizard on every
        // reload even though the user already has a provider configured.
        // `isActiveOnboardingFlow` resolves the ambiguity: any provider in
        // providerConfigs[] OR any legacy entry in activeModels[] means the
        // user is no longer in the first-time wizard.
        const shown = ob?.firstRunModalShownCount ?? 0;
        const wizardPending = ob
            && !ob.modalCompleted
            && !ob.dontShowFirstRunAgain
            && shown < 3
            && isActiveOnboardingFlow(this.plugin.settings);
        if (wizardPending) {
            void this.openFirstRunWizard();
            return;
        }

        // Memory + Soul chat: auto-start once after the modal has been
        // completed, never again. `startedAt` is set the first time
        // startOnboardingChat runs, so a subsequent sidebar restore
        // does not re-trigger the conversation.
        if (ob?.modalCompleted && !ob.completed && !ob.startedAt) {
            this.startOnboardingChat();
            return;
        }

        // Fallback for users who reset their onboarding state and have
        // already dismissed the wizard. OnboardingFlow.showWelcomeMessage
        // self-guards against re-running, so this is safe to call.
        this.onboarding = new OnboardingFlow(this.plugin, this.app);
        this.onboarding.showWelcomeMessage(this.chatContainer, this, this.getOnboardingCallbacks());
    }

    private async openFirstRunWizard(): Promise<void> {
        try {
            const ob = this.plugin.settings.onboarding;
            ob.firstRunModalShownCount = (ob.firstRunModalShownCount ?? 0) + 1;
            await this.plugin.saveSettings();
            const { FirstRunWizardModal } = await import('./modals/FirstRunWizardModal');
            new FirstRunWizardModal(this.app, this.plugin).open();
        } catch (e) {
            console.error('[Plugin] Failed to open FirstRunWizardModal:', e);
        }
    }

    /** Show setup message when no model is configured (delegates to OnboardingFlow). */
    private showNoModelSetupMessage(): void {
        if (!this.chatContainer) return;
        if (!this.onboarding) this.onboarding = new OnboardingFlow(this.plugin, this.app);
        this.onboarding.showNoModelSetupMessage(this.chatContainer, this, this.getOnboardingCallbacks());
    }

    /** Build callbacks for OnboardingFlow to communicate back to the View. */
    private getOnboardingCallbacks() {
        return {
            addAssistantMessage: (md: string) => this.addAssistantMessage(md),
            updateModelButton: () => this.updateModelButton(),
            startOnboardingChat: () => this.startOnboardingChat(),
            openSettings: () => {
                // FIX-26-99-02: route the onboarding "Setup" button straight
                // to the providers tab so the user lands on the
                // providerConfigs[] surface (post-EPIC-26 canonical store),
                // not on whichever tab was last open.
                this.plugin.openSettingsAt('providers');
            },
        };
    }

    /**
     * Start the LLM-driven onboarding conversation.
     * Sends a hidden trigger message; the onboarding system prompt guides the LLM.
     * Called from the welcome card, settings buttons, or programmatically.
     */
    startOnboardingChat(): void {
        this.onboarding?.reset();
        // Mark as started (prevents re-trigger on reload)
        this.plugin.settings.onboarding.startedAt = new Date().toISOString();
        void this.plugin.saveSettings();
        // Clear welcome card, send hidden trigger
        if (this.chatContainer) this.chatContainer.empty();
        this.sendProgrammaticMessage(t('onboarding.trigger'), true);
    }

    /**
     * Programmatically send a message as if the user typed it.
     * Used by Settings buttons (e.g. "Start setup") to trigger agent actions.
     * When hidden=true, the user bubble is not rendered (the agent speaks first).
     */
    sendProgrammaticMessage(text: string, hidden = false): void {
        if (!this.textarea) return;
        this.nextMessageHidden = hidden;
        this.textarea.value = text;
        void this.handleSendMessage();
    }

    /** Open the vault health repair modal with discuss callback. */
    private openHealthModal(): void {
        const findings = this.plugin.vaultHealthService?.getFindings() ?? [];
        if (findings.length === 0) return;
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- dynamic import for modal
        const { VaultHealthRepairModal } = require('./modals/VaultHealthRepairModal') as typeof import('./modals/VaultHealthRepairModal');
        const modal = new VaultHealthRepairModal(this.plugin, findings, (prompt) => {
            this.clearConversation();
            this.sendProgrammaticMessage(prompt, false);
        });
        // FIX-19-05-02: kein Auto-Apply-Bypass mehr. Der Icon-Klick oeffnet
        // immer die Uebersicht; alle reparierbaren Befunde sind darin
        // vorangehakt, ein Klick auf "Apply selected fixes" wendet sie an.
        modal.open();
    }

    /** Update the health-pulse icon. Called from main.ts after health check. */
    updateHealthBadge(findingCount: number, maxSeverity: 'high' | 'medium' | 'low' | null): void {
        if (!this.healthBadge) return;
        if (findingCount === 0 || !maxSeverity) {
            this.healthBadge.classList.add('agent-u-hidden');
            return;
        }
        this.healthBadge.classList.remove('agent-u-hidden');
        // Rebuild the className deterministically: keep the base classes, add
        // one severity marker. Avoid clobbering by using classList operations.
        this.healthBadge.classList.remove('severity-high', 'severity-medium', 'severity-low');
        this.healthBadge.classList.add(`severity-${maxSeverity}`);
        this.healthBadge.setAttribute(
            'aria-label',
            `${t('ui.sidebar.vaultHealth')} (${findingCount})`,
        );
    }

    /**
     * Pull the current findings from the plugin and update the badge. Used
     * when the view mounts after the health check already ran (BRAT hot
     * reload, leaf rebuild, etc.).
     */
    private syncHealthBadge(): void {
        const svc = this.plugin.vaultHealthService;
        if (!svc) return;
        const findings = svc.getFindings();
        if (findings.length === 0) {
            this.updateHealthBadge(0, null);
            return;
        }
        const hasHigh = findings.some((f) => f.severity === 'high');
        const hasMedium = findings.some((f) => f.severity === 'medium');
        const severity = hasHigh ? 'high' : (hasMedium ? 'medium' : 'low');
        this.updateHealthBadge(findings.length, severity);
    }

    /** Send vault health findings to the chat. Batch mode for many findings, interactive for few. */
    private sendHealthFindings(): void {
        const healthService = this.plugin.vaultHealthService;
        if (!healthService || healthService.getFindingCount() === 0) return;

        const count = healthService.getFindingCount();
        const BATCH_THRESHOLD = 10;

        if (count >= BATCH_THRESHOLD) {
            this.sendProgrammaticMessage(
                `Vault health: ${count} findings. Run vault_health_check, then work through ` +
                `findings autonomously in batches. Follow the vault-health-batch skill. ` +
                `Ask me only for real decisions, not for each fix.`,
            );
        } else {
            this.sendProgrammaticMessage(
                `Vault health: ${count} findings. Run vault_health_check and suggest fixes.`,
            );
        }
    }

    /**
     * Feature 1+3: Handle sending a message with persistent history and cancellation
     */
    /**
     * History hardening phase D (FIX-03-20-07): thin wrapper so the
     * send-in-flight window flag can never stick. The busy gate only becomes
     * real when the run controller exists (~400 lines and 3 awaits after the
     * early checks); two quick sends both passed it and started parallel runs
     * on one session. The inner body sets sendInFlight after the early-return
     * branches; this finally clears it on EVERY exit, including throws from
     * the pre-run awaits.
     */
    private async handleSendMessage(): Promise<void> {
        // Deliberately NOT named mySession: the run-binding pin
        // (sendPathSessionBinding.test.ts) guards the single mySession const
        // inside the inner body; this outer binding only scopes the flag.
        const sendSession = this.activeSession;
        // Review F2: a unique token per invocation. Only the invocation that
        // actually armed the flag (in the inner body, past the early returns)
        // may clear it. Clearing unconditionally let a refused second send drop
        // an in-flight first send's flag, reopening the parallel-run window.
        const sendToken = {};
        try {
            await this.handleSendMessageInner(sendToken);
        } finally {
            if (sendSession.sendInFlightOwner === sendToken) {
                sendSession.sendInFlight = false;
                sendSession.sendInFlightOwner = null;
            }
        }
    }

    private async handleSendMessageInner(sendToken: object): Promise<void> {
        if (!this.textarea) return;

        const text = this.textarea.value.trim();
        if (!text && this.attachments.pending.length === 0) return;

        // Issue 1: an ask_followup_question card is open and the loop is
        // paused on its resolver. A Send from the main input answers THAT
        // question (this is how a "+"-composed multi-part answer is submitted)
        // instead of being queued as a steering message below. wrappedResolve
        // renders the answer as a user bubble and resumes the loop.
        if (this.pendingQuestionResolve && text) {
            const resolveQuestion = this.pendingQuestionResolve;
            this.pendingQuestionResolve = null;
            this.textarea.value = '';
            this.autoResizeTextarea();
            resolveQuestion(text);
            return;
        }

        // FEAT-24-08 / ADR-114 Steering-Hook: if a task is already running,
        // queue the text as a mid-run steering message instead of trying to
        // start a new turn. Attachments are not supported in steering mode
        // (corrections are short text-only nudges); they stay queued for the
        // next real turn.
        // History hardening phase D (FIX-03-20-07): a second send while the
        // first is still between its early checks and its run controller
        // would pass the busy gate and start a parallel run on this session
        // (its steering entry would then be silently discarded at run start).
        // Refuse it visibly instead.
        if (!this.currentAbortController && this.activeSession.sendInFlight) {
            new Notice(t('notice.sendPreparing'));
            return;
        }
        if (this.currentAbortController) {
            if (!text) return;
            // Render the steering bubble in "pending" state and keep a
            // reference so consumeSteeringMessages can flip it to
            // "delivered at iteration N" when AgentTask actually drains it.
            const bubbleEl = this.addSteeringMessage(text);
            this.steeringQueue.push({ text, bubbleEl });
            this.uiMessages.push({ role: 'user', text, ts: new Date().toISOString() });
            // History hardening phase B: every uiMessages push gets a save
            // point. Before, only task end persisted -- a crash/reload during
            // the run lost every steering bubble.
            this.saveCurrentConversation();
            this.textarea.value = '';
            this.autoResizeTextarea();
            this.refreshRunStateButtons();
            return;
        }

        // Issue 3 Wave B: a stopped task may still be draining to its next
        // abort checkpoint. Instead of refusing the new send (the old
        // "taskStillStopping" notice), DECOUPLE the draining run so the input
        // is instantly usable. Two independent barriers keep the old run from
        // writing into this new conversation (the FIX-01-01-02 data-loss
        // class):
        //   1. Physically fork conversationHistory. It is passed BY REFERENCE
        //      into the old AgentTask, which keeps mutating message objects
        //      IN PLACE after Stop (MicroCompactor, toolResultBudget) until it
        //      hits an abort checkpoint. A shallow copy shares those objects,
        //      so we DEEP-clone. sanitizeHistoryForApi then trims any orphaned
        //      tool_use tail at the fork point (a partial tool batch), so the
        //      new run's first request and the persisted transcript are clean.
        //   2. Detach teardown ownership (drainingController = null) so the old
        //      run's late onComplete/onError matches neither controller and
        //      touches no shared view state (gated below).
        // Runs BEFORE the first await and before any push, so the old run
        // draining across later awaits already sees the detached old array.
        // History hardening phase D (FIX-03-20-07): the busy window opens
        // here -- past every early return, before the first await. Review F2:
        // record the owning token too, so only THIS invocation's wrapper
        // finally clears the flag (a refused later send must not clear it).
        this.activeSession.sendInFlight = true;
        this.activeSession.sendInFlightOwner = sendToken;

        if (this.taskDraining) {
            this.conversationHistory = sanitizeHistoryForApi(
                JSON.parse(JSON.stringify(this.conversationHistory)) as MessageParam[],
            ).history;
            this.drainingController = null;
        }

        // MEAS-02: TTFT split. point captures the send click; the
        // span runs until AgentTask hands off to the provider, then
        // the provider-span runs until the first stream chunk arrives.
        // Placed after the steering early-return so it only fires for
        // real turn starts.
        const perfMarks = getPerformanceMarks();
        perfMarks.point('send.click', { log: true });
        perfMarks.start('send.firstTurn.host');

        const isHidden = this.nextMessageHidden;
        this.nextMessageHidden = false;

        // FEAT-55-01 (Fix 2, 2026-07-25): bind this send to the session it
        // started in, BEFORE the first await. The pre-run assembly awaits
        // (conversation create, slash resolution, skill directory, embedding)
        // give the user time to switch tabs; the `this.` accessors delegate to
        // this.activeSession, which SHIFTS on a tab switch. Pinning mySession
        // (and its DOM container) here and routing every per-session read/write
        // through it keeps the user message, the conversation id, the run
        // controller, and the execute() config on the ORIGINATING chat instead
        // of leaking into whatever tab is active when an await resolves.
        const mySession = this.activeSession;
        const myContainer = mySession.chatContainer;

        mySession.lastUserMessage = text;

        // Create a new conversation on first message (if history enabled)
        // FIX-03-20-01: routed through the lazy ensurer so save paths that
        // run before/after this share the same memoized create.
        if (!mySession.activeConversationId && this.plugin.conversationStore) {
            const ensured = this.ensureConversationId(mySession);
            if (ensured) await ensured;
            // If the nav stack top is the "fresh-chat" sentinel (null), upgrade
            // it to this just-created conversation id. That keeps back/forward
            // consistent: visiting a fresh chat counts as one stack entry,
            // not two ("empty" plus its concrete id).
            if (
                mySession.navStack.length > 0
                && mySession.navIndex === mySession.navStack.length - 1
                && mySession.navStack[mySession.navIndex] === null
            ) {
                mySession.navStack[mySession.navIndex] = mySession.activeConversationId;
                this.updateNavButtons();
            }
        }

        // Track user UI message for history persistence (skip for hidden messages)
        if (!isHidden) {
            mySession.uiMessages.push({ role: 'user', text, ts: new Date().toISOString() });
            // FEAT-55-01 (user request 2026-07-25): name the tab from the FIRST
            // message, NOW, instead of waiting for the task to end. Naming only
            // at task end left the tab reading "New conversation" for the whole
            // run -- and permanently when the run was stopped or failed, which
            // is exactly when several open tabs are hardest to tell apart. The
            // semantic (LLM) title still replaces this later.
            this.nameChatFromFirstMessage(mySession);
            // History hardening phase B: persist the prompt at send time. The
            // run may take minutes; before, a reload in that window lost the
            // whole exchange (only task end saved).
            this.saveCurrentConversation(mySession);
        }

        // Snapshot attachments, clear the chip bar, render user bubble with previews
        const attachments = [...this.attachments.pending];
        this.attachments.clear();
        if (!isHidden) {
            const activeFileForBubble = (this.plugin.settings.autoAddActiveFileContext && !this.userDismissedContext)
                ? this.app.workspace.getActiveFile()
                : null;
            this.addUserMessage(text, attachments, activeFileForBubble, myContainer);
        }
        this.textarea.value = '';
        this.autoResizeTextarea();

        // Feature 4: Inject active file context into the message sent to LLM
        // Only if setting is on and user hasn't dismissed the context for this turn
        const activeFile = (this.plugin.settings.autoAddActiveFileContext && !this.userDismissedContext)
            ? this.app.workspace.getActiveFile()
            : null;
        const vaultCtx = this.buildVaultContext();
        const textWithContext = text
            + (activeFile ? `\n\n<context>\nActive file in editor: ${activeFile.path}\n</context>` : '')
            + (vaultCtx ? `\n\n${vaultCtx}` : '');

        // FEAT-02-13: ein Praefix fuer Skills, Prompts und Workflows.
        // Frueher entschied das Zeichen den Typ ('/', '#', '\u00a7'); jetzt
        // loest der gemeinsame Registry-Resolver den Slug auf. Praezedenz
        // bei Namensgleichheit: Skill > Prompt > Workflow -- exakt dieselbe
        // Reihenfolge, die auch die Dropdown-Liste sortiert und verdeckte
        // Eintraege markiert. Liefe das hier auseinander, waehlte der Nutzer
        // eine Zeile und bekaeme beim Senden etwas anderes ausgefuehrt.
        //
        // Aufgeloest VOR dem Attachment-Block-Bau, damit der expandierte
        // Body im Text-Block landet, wenn der Nutzer ein PDF/Bild in den
        // Chat gezogen hat. Frueher lief die Expansion nur im String-Zweig:
        // mit Attachment blieb "/ingest-deep" literal stehen, der Agent fiel
        // auf invoke_skill zurueck (scheitert bei Chat-Attachments) und der
        // Parent improvisierte den Workflow.
        let expandedText: string | null = null;
        if (text.startsWith('/')) {
            const spaceIdx = text.indexOf(' ');
            const slug = spaceIdx === -1 ? text.slice(1) : text.slice(1, spaceIdx);
            const rest = spaceIdx === -1 ? '' : text.slice(spaceIdx + 1).trim();
            const activeFileTail = activeFile
                ? `\n\n<context>\nActive file in editor: ${activeFile.path}\n</context>`
                : '';

            const sources = await this.autocomplete.collectSlashSources();
            const entry = resolveSlashEntry(sources, slug);

            // SEC M-1: mehrdeutiger Slug im gemeinsamen Namensraum. Wortlos das
            // hoeher priorisierte Element auszufuehren waere genau der Fall, in
            // dem ein installierter Skill einen selbst angelegten Prompt kapert.
            if (entry) {
                const shadowed = findShadowedFor(sources, slug);
                if (shadowed.length > 0) {
                    new Notice(t('notice.slashAmbiguous', {
                        slug,
                        kind: entry.kind,
                        other: shadowed.map((e) => e.kind).join(', '),
                    }), 8000);
                }
            }

            if (entry?.kind === 'skill') {
                const matchedSkill = this.plugin.selfAuthoredSkillLoader?.getAllSkills().find(
                    (sk) => AutocompleteHandler.slugifySkillName(sk.name) === slug,
                );
                if (matchedSkill) {
                    // IMP-29-03-01: derselbe Renderer wie im Inline-Composer
                    // und derselbe Wortlaut wie bei read_skill. Vorher stand
                    // hier nur der Body, also fielen scripts/ und references/
                    // unter den Tisch und der Agent erfand den Weg neu.
                    expandedText = buildExplicitSkillInstructions(matchedSkill, rest) + activeFileTail;
                    // FIX-03-20-02: a skill may declare a deterministic chat
                    // title (chatTitle frontmatter, e.g. "Plaud {date}"). Set it
                    // NOW, not at task end: the task-end title block reads
                    // mySession.activeConversationId synchronously, but on a fresh
                    // chat that id is still being minted async (ensureConversationId
                    // adopts it in a .then), so the whole block -- and the title --
                    // was skipped on the first long run. Setting it here shows the
                    // tab at once and persists as an 'auto' title as soon as the id
                    // resolves, which also stops the task-end LLM titler from
                    // overwriting it. Identical-intent skill runs (e.g. /plaud-...)
                    // stay distinguishable in History.
                    if (matchedSkill.chatTitle) {
                        const skillTitle = resolveSkillChatTitle(matchedSkill.chatTitle, new Date());
                        mySession.tabTitle = skillTitle;
                        this.renderTabStrip();
                        const ensured = this.ensureConversationId(mySession);
                        if (ensured) {
                            void ensured
                                .then((convId) => this.plugin.conversationStore?.updateMeta(
                                    convId, { title: skillTitle, titleSource: 'auto' },
                                ))
                                .then(() => {
                                    this.historyPanel?.refresh();
                                    // The conversation id + store title landed async,
                                    // after the send-time strip paint. Once
                                    // activeConversationId is set, sessionTabTitle reads
                                    // the store title, so the strip must be repainted or
                                    // the tab only catches up on the next tab switch
                                    // (exactly the "title appears when I switch tabs"
                                    // report). renderTabStrip has no signature guard.
                                    this.renderTabStrip();
                                })
                                .catch(() => { /* naming is best effort */ });
                        }
                    }
                }
            } else if (entry?.kind === 'prompt') {
                const prompt = (this.plugin.settings.customPrompts ?? []).find(
                    (pr) => pr.slug === slug && pr.enabled !== false,
                );
                if (prompt) {
                    const activeFileName = activeFile?.name;
                    const { resolvePromptContent } = await import('../core/context/SupportPrompts');
                    const resolved = resolvePromptContent(prompt.content, {
                        userInput: rest,
                        activeFile: activeFileName,
                    });
                    expandedText = resolved + activeFileTail;
                }
            } else if (entry?.kind === 'workflow') {
                const workflowLoader = this.plugin.workflowLoader;
                if (workflowLoader) {
                    const reshaped = `/${slug}${rest ? ' ' + rest : ''}`;
                    const workflowText = await workflowLoader.processSlashCommand(
                        reshaped,
                        this.plugin.settings.workflowToggles ?? {},
                    );
                    if (workflowText !== reshaped) {
                        expandedText = workflowText + activeFileTail;
                    }
                }
            }
        }

        const finalUserText = expandedText ?? textWithContext;

        // Build ContentBlock[] when there are attachments, plain string otherwise
        let messageToSend: string | ContentBlock[];
        if (attachments.length > 0) {
            const blocks: ContentBlock[] = [];
            // Images first (Anthropic convention)
            for (const att of attachments) {
                if (att.block.type === 'image') blocks.push(att.block);
            }
            // User text (with slash command already expanded if applicable)
            blocks.push({ type: 'text', text: finalUserText });
            // Text file blocks after
            for (const att of attachments) {
                if (att.block.type === 'text') blocks.push(att.block);
            }
            messageToSend = blocks;
        } else {
            messageToSend = finalUserText;
        }

        // EPIC-26 / FEAT-26-05: per-turn override -- when the chat-header
        // dropdown has an explicit model picked, build a fresh api handler
        // for it. Falls through to the legacy mode-model resolution when
        // override is null (Auto).
        // Issue #44: a per-conversation thinking override may also force
        // thinking on/off. When it does, a fresh handler is built even for
        // the default-active model so the override takes effect.
        const activeProvider = resolveActiveProvider(this.plugin.settings);
        // The effort control is pin-only and only revealed while thinking is On,
        // so a contradictory Thinking=Off + Effort pair can no longer be
        // expressed and no coherence collapse is needed: the thinking override
        // passes through untouched. The thinking resolution itself is unchanged.
        const effectiveThinkingOverride = mySession.chatThinkingOverride;
        const thinkingIsExplicit = isExplicitThinkingOverride(effectiveThinkingOverride);
        // Apply the per-conversation thinking override to a model before it is
        // built. In 'follow' mode the model's own value is kept unchanged.
        const applyThinkingOverride = (model: CustomModel): CustomModel => {
            if (!thinkingIsExplicit) return model;
            return {
                ...model,
                thinkingEnabled: resolveEffectiveThinkingEnabled(
                    effectiveThinkingOverride,
                    model.thinkingEnabled,
                ),
            };
        };
        // FIX-30-07-05: the pin-only effort application lives in
        // buildPinnedCustomModel (shared with the inline panel).
        let resolvedApiHandler = this.plugin.apiHandler;
        // modelOverrideActive means the user pinned a specific model via the
        // chat dropdown: it suppresses TaskRouter and the lean cost-heuristics
        // (#44). handlerResolved is the separate "a handler was already built"
        // signal so the default-active thinking rebuild below does not clobber
        // a mode-specific handler. A mode model is NOT a manual override, so it
        // sets handlerResolved only, keeping its pre-#44 routing behavior.
        let modelOverrideActive = false;
        let handlerResolved = false;
        // FIX-30-07-05: pin resolution shared with the inline panel via
        // buildPinnedCustomModel, so both surfaces run the turn on exactly
        // the same resolved model (thinking + pin-only effort included).
        const pinnedModel = buildPinnedCustomModel(
            activeProvider,
            mySession.chatModelOverride,
            effectiveThinkingOverride,
            mySession.chatEffortOverride,
        );
        if (pinnedModel) {
            try {
                resolvedApiHandler = buildApiHandlerForModel(pinnedModel);
                modelOverrideActive = true;
                handlerResolved = true;
            } catch {
                resolvedApiHandler = this.plugin.apiHandler;
            }
        }

        // Legacy mode-specific model resolution (only when no chat override).
        const currentModeSlug = this.modeService.getActiveMode().slug;
        const modeModelKey = this.resolveEnabledModelKey(currentModeSlug);
        const resolvedModel = this.plugin.settings.activeModels.find((m) => getModelKey(m) === modeModelKey);

        if (!handlerResolved && resolvedModel && modeModelKey !== this.plugin.settings.activeModelKey) {
            // Mode has a different model, so build a fresh handler for it.
            // Effort is pin-only, so a mode model carries only the thinking
            // override; its own effort/default is left untouched.
            try {
                resolvedApiHandler = buildApiHandler(
                    modelToLLMProvider(applyThinkingOverride(resolvedModel)),
                );
                handlerResolved = true;
            } catch {
                resolvedApiHandler = this.plugin.apiHandler;
            }
        }

        // Issue #44: default-active model path. When neither a chat-model
        // override nor a mode-specific model rebuilt the handler, but the user
        // forced thinking for this conversation, rebuild from the same default
        // model main.ts uses so the thinking override applies. Effort is NOT
        // threaded here: it is pin-only, so in Auto mode the default model keeps
        // its own vendor effort default.
        if (!handlerResolved && thinkingIsExplicit) {
            const defaultTier = this.plugin.settings.defaultMainModelTier ?? 'mid';
            const defaultModel = this.plugin.getTierModel(defaultTier) ?? this.plugin.getActiveModel();
            if (defaultModel) {
                try {
                    resolvedApiHandler = buildApiHandler(
                        modelToLLMProvider(applyThinkingOverride(defaultModel)),
                    );
                } catch {
                    resolvedApiHandler = this.plugin.apiHandler;
                }
            }
        }

        if (!resolvedApiHandler) {
            // Post-reload race: onload() runs initApiHandler() near the end,
            // but the sidebar view may still be open from before the reload
            // and the user can hit "send" before initApiHandler completes.
            // If a provider is actually configured, recover silently by
            // rebuilding the handler here instead of showing a misleading
            // "no model configured" screen. Only if the recovery attempt
            // still yields null do we surface the setup guidance.
            const hasProvidersConfigured =
                (this.plugin.settings.providerConfigs ?? []).length > 0
                || this.plugin.settings.activeModels.length > 0;
            if (hasProvidersConfigured) {
                console.debug('[Sidebar] apiHandler null on send with providers configured -- retrying initApiHandler once');
                this.plugin.initApiHandler();
                resolvedApiHandler = this.plugin.apiHandler;
                if (!resolvedApiHandler) {
                    // AUDIT-FEAT-14-07 L-3: emit a visible signal when the
                    // retry did not recover a handler. The next branch will
                    // show the setup message; this line makes the underlying
                    // config problem discoverable in the console.
                    console.warn('[Sidebar] apiHandler still null after retry -- provider configuration appears broken');
                }
            }
        }

        if (!resolvedApiHandler) {
            const activeKey = this.plugin.settings.activeModelKey;
            const activeModel = this.plugin.settings.activeModels.find((m) => getModelKey(m) === activeKey);

            if (activeModel?.provider === 'ollama') {
                this.addAssistantMessage(
                    t('ui.error.ollamaNotRunning', { model: activeModel.displayName ?? activeModel.name }),
                );
            } else {
                // No model or no API key — show setup guidance
                this.showNoModelSetupMessage();
            }
            return;
        }

        // Feature 3: Create AbortController, show stop button.
        // FIX-24-08-03: `myController` pins this run's identity -- the
        // completion closures below may fire LATE (after Stop + a newer
        // run's start) and must only clean up their own controller.
        // `lastRunAbortSignal` survives handleStop's nulling so approval
        // cards created by a draining task still bind an (aborted) signal
        // instead of undefined.
        // FEAT-55-01 (Fix 2): the controller lives on the run's OWN session
        // (mySession, pinned before the first await), not this.activeSession
        // -- the pre-run awaits above may have shifted the active tab, and the
        // completion closures must clean up the originating chat's controller
        // regardless of which tab is active when they fire.
        mySession.currentAbortController = new AbortController();
        const myController = mySession.currentAbortController;
        mySession.lastRunAbortSignal = myController.signal;
        // FEAT-24-08 Steering: clear any stale entries before a new task
        // starts so leftover mid-run messages from a previous run cannot
        // leak into a fresh conversation. Any pending bubbles that never
        // got drained (e.g. typed during the very last iteration before
        // attempt_completion fired) are flipped to "discarded" so the user
        // can see they were not applied.
        for (const entry of mySession.steeringQueue) {
            this.markSteeringDiscarded(entry.bubbleEl);
        }
        mySession.steeringQueue = [];
        this.setRunningState(true);

        // Prepare streaming message elements (thinking → tools → response text → footer)
        // `let` so onQuestion can create fresh elements for each onboarding turn.
        let { messageEl, thinkingEl, toolsEl, contentEl, footerEl } = this.createStreamingMessageEl(myContainer);
        let accumulatedText = '';       // text accumulated during/after tool phase
        let accumulatedToolContent = '';  // content written by file-writing tools (for task extraction)
        let accumulatedThinking = '';   // full thinking text for collapse/expand
        let hasTools = false;           // have any tools been called in this task?
        let isThinking = false;         // thinking is currently active
        let activityActionCount = 0;    // number of completed tool calls (for activity badge)

        // Streaming text container: during Q&A streaming we append raw text chunks
        // directly into this element (O(1) per chunk, zero re-parses).
        // On completion a single MarkdownRenderer.render() replaces it with the
        // formatted result.  This gives instant first-character display and avoids
        // the previous 80 ms delay before the user saw anything.
        let streamingPara: HTMLElement | null = null;

        // The turn's single status line, pinned at the TOP of the assistant
        // message: [spinning brand mark] <current activity> <N> Tokens.
        // It replaces the two rows that used to say nearly the same thing in
        // two places (a static "working" row and the "analyzing" row).
        //
        // It is refreshed on a timer rather than on stream chunks, because
        // onText/onThinking only fire while the provider stream is open: during
        // tool execution -- routinely 30s+ per call -- no callback arrives at
        // all. The token count legitimately stands still there (nothing is
        // being generated); the spinning mark is what shows the run is alive.
        const LIVE_CHARS_PER_TOKEN = 4;
        // Real cumulative output tokens, refreshed after every API turn via
        // onUsageProgress. Between turns the counter is topped up with a
        // character-based estimate of the text streamed SINCE that last real
        // number, so it climbs smoothly while the model writes and then snaps
        // onto the truth instead of drifting. `liveTokenCharsBase` is the
        // watermark that keeps the two from double-counting the same text.
        let liveTokensReal = 0;
        let liveTokenCharsBase = 0;
        let liveActivityLabel = t('ui.sidebar.working');
        const updateLiveMeter = (): void => {
            if (!messageEl || !messageEl.isConnected) return;
            let meter = messageEl.querySelector<HTMLElement>(':scope > .vo-live-meter');
            if (!meter) {
                meter = createDiv('vo-live-meter');
                // The spinner IS the brand mark with a rotating slash (CSS), not
                // a generic lucide loader.
                meter.createSpan({ cls: 'vo-live-meter-icon vo-brand-mark', attr: { 'aria-hidden': 'true' } });
                meter.createSpan('vo-live-meter-label');
                meter.createSpan('vo-live-meter-tokens');
                // First child: the status belongs above the work it describes,
                // and staying first keeps it from sliding around as a plan panel
                // or tool block appears.
                messageEl.insertBefore(meter, messageEl.firstChild);
                // Supersedes the static "working" row created at turn start --
                // same word, now with live numbers. Only that node is removed,
                // not via removeLoading(), which would also clear the tool rows.
                contentEl.querySelector('.message-loading')?.remove();
                contentEl.classList.remove('has-loading');
            }
            meter.querySelector<HTMLElement>('.vo-live-meter-label')?.setText(liveActivityLabel);
            const streamedSinceReal = Math.max(
                0,
                accumulatedText.length + accumulatedThinking.length - liveTokenCharsBase,
            );
            const tokens = liveTokensReal + Math.ceil(streamedSinceReal / LIVE_CHARS_PER_TOKEN);
            meter.querySelector<HTMLElement>('.vo-live-meter-tokens')
                // "Tokens" is a technical term and stays English in every
                // locale, so this needs no i18n key.
                ?.setText(tokens > 0 ? `${this.formatTokens(tokens)} Tokens` : '');
            meter.classList.remove('agent-u-hidden');
        };
        // Hide EVERY meter in this run's container, not just the current
        // bubble's: a question round swaps in a fresh messageEl, and the
        // previous bubble's chip would otherwise stay frozen on screen.
        const hideLiveMeter = (): void => {
            const scope = myContainer ?? messageEl;
            scope?.querySelectorAll('.vo-live-meter')
                .forEach((el) => { el.classList.add('agent-u-hidden'); });
        };
        // The cost line only existed as runtime DOM (TaskMonitor writes it at
        // run end), so every bubble rebuilt from history lost it on plugin
        // reload. Captured verbatim at persist time and stored on the
        // UiMessage, mirroring toolStepsHtml. Hidden footer = no usage was
        // reported for this turn; persist nothing rather than an empty line.
        const captureUsageFooter = (): string | undefined => {
            if (!footerEl || footerEl.classList.contains('agent-u-hidden')) return undefined;
            // FIX-24-05-06: TaskMonitor owns one child of the footer for the
            // cost line. Read that child, so the condense badges sitting
            // beside it are not persisted as part of the usage line. Without
            // a cost line (usage never reported, footer shows only the
            // timestamp) the whole footer is still the best we have.
            const costLine = footerEl.querySelector<HTMLElement>(`.${COST_LINE_CLASS}`);
            const text = (costLine ?? footerEl).getText().trim();
            return text.length > 0 ? text : undefined;
        };
        // FIX-PERF-44 convention: scheduleRecurring, never setInterval -- the
        // post-build rename in esbuild.config.mjs breaks literal setInterval at
        // runtime, and a source-level test fails on it. The tick self-cancels
        // once the bubble loses `message-streaming` (removed on complete, error
        // and question-swap), so the timer cannot outlive its run even if an
        // exit path is ever added that forgets to stop it.
        const elapsedTimer: RecurringHandle = scheduleRecurring(() => {
            if (!messageEl || !messageEl.isConnected || !messageEl.hasClass('message-streaming')) {
                elapsedTimer.stop();
                return;
            }
            updateLiveMeter();
        }, 1000);

        // rAF-throttled scroll: collapses many per-chunk scrollTo() calls into one
        // paint-cycle scroll, eliminating repeated forced reflows.
        let scrollPending = false;
        const scheduleScroll = () => {
            if (scrollPending) return;
            scrollPending = true;
            // FEAT-55-01 (Fix 2): scroll the run's own container, not the
            // active one -- a background run streaming into a hidden tab must
            // not yank the visible tab's scroll position.
            window.requestAnimationFrame(() => { scrollPending = false; myContainer?.scrollTo({ top: myContainer.scrollHeight }); });
        };

        // Issue #48.3: incremental Q&A markdown render. Previously Q&A text was
        // appended as RAW characters into a <p class="streaming-para"> sized at
        // the editor font, then replaced by a single Markdown pass in onComplete
        // — the user saw large raw markdown syntax that "lingered then
        // reformatted". Now the accumulated text is rendered as Markdown at a
        // throttled cadence (leading edge for instant first paint, then at most
        // every QA_RENDER_INTERVAL_MS), so formatted text grows in place at the
        // final bubble size with no raw->formatted swap. onComplete still does
        // the authoritative pass (sources/followups parsing). Throttling keeps
        // re-parses bounded, preserving the perf goal of the old raw-append path.
        const QA_RENDER_INTERVAL_MS = 120;
        let qaLastRenderAt = 0;
        let qaTrailingTimer = 0;
        const renderQaNow = (): void => {
            if (hasTools) return; // switched to agentic mode; onComplete owns the render
            qaLastRenderAt = Date.now();
            contentEl.empty();
            void this.renderMarkdownAndWire(accumulatedText, contentEl);
            scheduleScroll();
        };
        const scheduleQaRender = (): void => {
            const sinceLast = Date.now() - qaLastRenderAt;
            if (sinceLast >= QA_RENDER_INTERVAL_MS) {
                renderQaNow();
            } else if (qaTrailingTimer === 0) {
                qaTrailingTimer = window.setTimeout(() => { qaTrailingTimer = 0; renderQaNow(); }, QA_RENDER_INTERVAL_MS - sinceLast);
            }
        };
        const cancelQaRender = (): void => {
            if (qaTrailingTimer !== 0) { window.clearTimeout(qaTrailingTimer); qaTrailingTimer = 0; }
        };

        // FIX-PERF-03: coalesce per-chunk tool-progress renders. Previously
        // onToolProgress called MarkdownRenderer.render() for every chunk
        // - on a 20-tool turn that meant 40+ synchronous parser passes per
        // turn. The pending map stores the latest content per output
        // element; a single rAF tick renders the most recent value.
        const toolProgressPending = new WeakMap<HTMLElement, string>();
        let toolProgressFrame = 0;
        const scheduleToolProgressRender = (outputEl: HTMLElement, content: string): void => {
            toolProgressPending.set(outputEl, content);
            if (toolProgressFrame !== 0) return;
            toolProgressFrame = window.requestAnimationFrame(() => {
                toolProgressFrame = 0;
                // Drain every pending output element. The map only retains
                // entries for elements still in the DOM (WeakMap GC).
                // We cannot iterate WeakMap directly; track keys via
                // outputEl identity captured at insert time.
                // For simplicity, the closure renders only the element
                // most recently updated, which matches the only call site.
                const latest = toolProgressPending.get(outputEl);
                if (latest === undefined) return;
                toolProgressPending.delete(outputEl);
                outputEl.empty();
                void this.renderMarkdownAndWire(latest, outputEl);
            });
        };

        // Debounced tool group label updates: batches rapid DOM updates during
        // parallel tool execution to reduce flicker and reflows.
        let groupUpdatePending = false;
        const pendingGroupUpdates = new Set<{ nameEl: HTMLElement; name: string; count: number }>();
        const scheduleGroupUpdate = (group: { nameEl: HTMLElement; name: string; count: number }) => {
            pendingGroupUpdates.add(group);
            if (groupUpdatePending) return;
            groupUpdatePending = true;
            window.requestAnimationFrame(() => {
                groupUpdatePending = false;
                for (const g of pendingGroupUpdates) {
                    g.nameEl.setText(this.formatGroupedLabel(g.name, g.count));
                }
                pendingGroupUpdates.clear();
            });
        };

        // Map for O(1) tool-element lookup in onToolResult.
        // For groupable tools the values are item divs; for others they are details elements.
        const toolElsByName = new Map<string, HTMLElement[]>();

        // ── Agent steps block ─────────────────────────────────────────────────
        // All tool calls are wrapped in a single collapsible block with a thin
        // left border instead of individual boxes. Collapsed by default; the
        // summary line shows a live-updating action count + final status.
        let stepsBlockEl: HTMLDetailsElement | null = null;
        let stepsBodyEl: HTMLElement | null = null;
        let stepsSummaryIconEl: HTMLElement | null = null;
        let stepsSummaryLabelEl: HTMLElement | null = null;
        let stepsTotal = 0;
        let stepsCompleted = 0;
        let stepsHasError = false;

        const ensureStepsBlock = () => {
            if (stepsBlockEl) return;
            stepsBlockEl = toolsEl.createEl('details', { cls: 'agent-steps-block' });
            const summaryEl = stepsBlockEl.createEl('summary', { cls: 'agent-steps-summary' });
            stepsSummaryIconEl = summaryEl.createSpan('steps-icon');
            setIcon(stepsSummaryIconEl, 'loader');
            stepsSummaryLabelEl = summaryEl.createSpan('steps-label');
            // Left empty on purpose. This label's job is the action count, which
            // updateStepsSummary fills as soon as the first step lands. It used
            // to be seeded with the current phase ("working"), which now reads
            // as a duplicate of the turn's status line directly above.
            stepsBodyEl = stepsBlockEl.createDiv('agent-steps-body');
        };

        const updateStepsSummary = (allDone: boolean) => {
            if (!stepsSummaryLabelEl || !stepsSummaryIconEl) return;
            const n = stepsTotal;
            const label = n === 1 ? t('ui.sidebar.actionSingular') : t('ui.sidebar.actionPlural', { count: n });
            if (allDone) {
                stepsSummaryLabelEl.setText(label);
                setIcon(stepsSummaryIconEl, stepsHasError ? 'x' : 'check');
                stepsSummaryIconEl.removeClass('steps-icon-spinning');
            } else {
                stepsSummaryLabelEl.setText(label);
            }
        };

        // Tools that are safe to group visually — consecutive same-type calls collapse into one row.
        // Write tools are intentionally excluded so each destructive action stays visible individually.
        const GROUPABLE_TOOLS = new Set([
            'read_file', 'list_files', 'search_files', 'get_frontmatter',
            'get_linked_notes', 'search_by_tag', 'get_vault_stats', 'get_daily_note',
            'web_fetch', 'web_search', 'semantic_search',
        ]);

        // Active tool group — tracks the open <details> container for consecutive same-type tools.
        let activeToolGroup: {
            name: string;
            detailsEl: HTMLDetailsElement;
            nameEl: HTMLElement;
            statusEl: HTMLElement;
            bodyEl: HTMLElement;
            count: number;
        } | null = null;
        // Remove the "Working…" loading indicator and any "Analyzing…" row on first real content
        let loadingRemoved = false;
        const removeLoading = () => {
            if (!loadingRemoved) {
                loadingRemoved = true;
                contentEl.querySelector('.message-loading')?.remove();
                contentEl.classList.remove('has-loading');
            }
            // Also remove any "analyzing" row between iterations (lives inside stepsBodyEl)
            (stepsBodyEl ?? toolsEl).querySelector('.tool-computing-row')?.remove();
            if (stepsSummaryLabelEl && stepsTotal > 0) {
                const n = stepsTotal;
                stepsSummaryLabelEl.setText(n === 1 ? t('ui.sidebar.actionSingular') : t('ui.sidebar.actionPlural', { count: n }));
            }
        };

        // FEAT-55-03 (ADR-171): collision-free run id. `task-${Date.now()}`
        // collided when two chats started a run in the same millisecond, and
        // this id keys the inflight store, checkpoint list, and newfiles marker.
        const taskId = generateShortId('task');
        let taskWriteCount = 0;
        let hasRenderedCheckpoints = false;
        // FIX-44-44: true once any write landed WITHOUT an individual diff
        // approval (settings-auto, run-scope grant, name-only card). Decides
        // whether the post-task review opens; see showPostTaskReview.
        let taskHadUnreviewedWrites = false;
        // FIX-44-12: checkpoints of the CURRENT assistant turn. Persisted into
        // the UiMessage (uiMessages.push sites) so a reloaded conversation can
        // re-render live markers; reset with the rest of the per-turn state.
        let turnCheckpoints: import('../core/checkpoints/GitCheckpointService').CheckpointInfo[] = [];

        // IMP-24-08-04: immediate Stop feedback. handleStop swaps the
        // Working spinner for a Stopping row; the drain-end removeLoading
        // (which always clears .tool-computing-row) cleans it up again.
        // FEAT-55-01 (isolation fix): store on the run's OWN session, not the
        // active-tab accessor -- a tab switch during the pre-run awaits could
        // otherwise assign this run's stop-feedback to the wrong session
        // (the onComplete clear already uses mySession, so this closes the
        // assign/clear asymmetry).
        mySession.currentStopFeedback = () => {
            removeLoading();
            const host = stepsBodyEl ?? toolsEl;
            host.querySelector('.tool-computing-row')?.remove();
            const row = host.createDiv('tool-computing-row');
            setIcon(row.createSpan('tool-computing-icon'), 'loader');
            // FEAT-55-01 (user decision 2026-07-25): say WHAT the stop is
            // waiting on. The drain runs to the next abort checkpoint (a
            // running tool/step), so the row explains the gap instead of a
            // bare "Stopping" that looks stuck. The row stays until the
            // drain-end removeLoading clears it and the Resume card appears.
            row.createSpan('tool-computing-text').setText(t('ui.sidebar.stoppingWaiting'));
        };
        let lastTodoItems: import('../core/tools/agent/UpdateTodoListTool').TodoItem[] = [];

        // Initialize context tracker for this conversation turn (only if not exists)
        const model = resolvedApiHandler.getModel();
        const contextWindow = model?.info?.contextWindow ?? 200_000;
        const maxTokens = resolvedModel?.maxTokens;

        if (!this.contextTracker) {
            this.contextTracker = new ContextTracker(contextWindow, maxTokens);
        } else {
            // Update existing tracker with current model's context window
            this.contextTracker.updateContextWindow(contextWindow, maxTokens);
        }

        // FEAT-55-02 (ADR-170): full (un-truncated) document texts travel
        // run-scoped through the task's RunConfig (attachmentTexts below),
        // NOT via setAttachmentTexts on the shared tool singletons. This
        // stops a parallel chat's send (also with []) from wiping this run's
        // attachments mid-read. Consumed once here; empty when none, which
        // keeps the tools' one-turn-lifetime error. ADR-112 / FIX-19-28-05.
        let runAttachmentTexts: string[] = [];
        try {
            runAttachmentTexts = this.attachments.consumeFullDocTexts();
        } catch { /* non-critical -- tools will fall back to source_path */ }

        // ADR-090 / FEATURE-1804: cost display + telemetry persistence run
        // through TaskMonitor instead of being inlined into the callback hash.
        const taskMonitor = new TaskMonitor({
            plugin: this.plugin,
            app: this.app,
            apiHandler: resolvedApiHandler,
            // FIX-19-06-01: resolve the CURRENT footer lazily. A question round
            // swaps `footerEl` to a fresh message element (see onQuestion), and
            // onUsage fires once at task end -- a static reference would send
            // the cost line to the orphaned first bubble and leave the visible
            // one with only a timestamp.
            getFooterEl: () => footerEl,
            getEffectiveModelKey: () => this.getEffectiveModelKey(),
            promptPreview: typeof messageToSend === 'string' ? messageToSend.slice(0, 200) : '<multimodal>',
            mode: this.modeService.getActiveModeSlug(),
            contextTracker: this.contextTracker ?? undefined,
        });

        // EPIC-33 / ADR-138 PR-1.2: Sidebar drives the agent loop via
        // AgentTaskRunner. Encapsulates the 16-positional-parameter
        // constructor in a named options object. Behaviour identical
        // to the prior `new AgentTask(...)` -- callbacks unchanged,
        // closures over view-local mutables preserved.
        const task = new AgentTaskRunner({
            api: resolvedApiHandler,
            toolRegistry: this.plugin.toolRegistry,
            // IMP-41-03-01: foreground tasks snapshot their state per turn
            // so a crash mid-run leaves recoverable data.
            inflightStore: this.plugin.inflightStore ?? undefined,
            callbacks: {
                onIterationStart: (iteration) => {
                    // Show the steps block immediately so the user can expand it from the start.
                    ensureStepsBlock();
                    if (iteration > 0) {
                        // Between iterations — add "Analyzing…" row inside stepsBodyEl (visible when expanded)
                        // and update the summary label so collapsed users also see the state.
                        (stepsBodyEl ?? toolsEl).querySelector('.tool-computing-row')?.remove();
                        const row = (stepsBodyEl ?? toolsEl).createDiv('tool-computing-row');
                        setIcon(row.createSpan('tool-computing-icon'), 'loader');
                        row.createSpan('tool-computing-text').setText(t('ui.sidebar.analyzing'));
                        // The phase goes to the turn's status line only. It used
                        // to ALSO overwrite the steps summary label so a user
                        // with the block collapsed could see the state; that
                        // reason is gone now the status line is always visible,
                        // and writing it in both places printed "Analyzing" twice
                        // while robbing the summary of its action count.
                        liveActivityLabel = t('ui.sidebar.analyzing');
                        updateLiveMeter();
                        scheduleScroll();
                    }
                },
                onThinking: (chunk) => {
                    removeLoading();
                    accumulatedThinking += chunk;
                    updateLiveMeter();
                    if (!isThinking) {
                        // First thinking chunk — build the collapsible section
                        isThinking = true;
                        thinkingEl.classList.remove('agent-u-hidden');
                        thinkingEl.empty();
                        const header = thinkingEl.createDiv('thinking-header');
                        setIcon(header.createSpan('thinking-spinner'), 'loader');
                        header.createSpan('thinking-label').setText(t('ui.sidebar.reasoning'));
                        thinkingEl.createDiv('thinking-content');
                        header.addEventListener('click', () => {
                            const body = thinkingEl.querySelector<HTMLElement>('.thinking-content');
                            if (body) body.classList.toggle('agent-u-hidden');
                        });
                    }
                    // FIX-PERF-02: append the chunk instead of rewriting the
                    // full textContent every time. Previously a 50 KB
                    // reasoning stream rewrote the same text on every
                    // chunk - O(N^2) and visible as freeze. Now append is
                    // O(1) per chunk.
                    const body = thinkingEl.querySelector<HTMLElement>('.thinking-content');
                    if (body) body.insertAdjacentText('beforeend', chunk);
                    scheduleScroll();
                },
                onText: (chunk) => {
                    removeLoading();
                    // When text starts after thinking, collapse the thinking section
                    if (isThinking) {
                        isThinking = false;
                        const header = thinkingEl.querySelector('.thinking-header');
                        const spinner = thinkingEl.querySelector('.thinking-spinner');
                        const label = thinkingEl.querySelector('.thinking-label');
                        if (spinner != null && spinner.instanceOf(HTMLElement)) setIcon(spinner, 'chevron-right');
                        if (label != null && label.instanceOf(HTMLElement)) label.setText(t('ui.sidebar.reasoningCollapsed'));
                        const body = thinkingEl.querySelector<HTMLElement>('.thinking-content');
                        if (body) body.classList.add('agent-u-hidden');
                        if (header != null && header.instanceOf(HTMLElement)) header.addEventListener('click', () => {
                            if (body) body.classList.toggle('agent-u-hidden');
                        }, { once: true });
                    }
                    accumulatedText += chunk;
                    updateLiveMeter();
                    if (!hasTools) {
                        // Q&A streaming: render Markdown incrementally (throttled) so the
                        // user sees formatted text grow at the final bubble size — no raw
                        // markdown syntax, no raw->formatted swap at the end (issue #48.3).
                        if (!streamingPara) {
                            contentEl.empty();
                            streamingPara = contentEl; // sentinel: Q&A stream is active
                        }
                        scheduleQaRender();
                    }
                    // Agentic mode: text is buffered and rendered once in onComplete.
                },
                onToolStart: (name, input) => {
                    removeLoading();
                    if (!hasTools) {
                        hasTools = true;
                        if (name !== 'attempt_completion') {
                            // Hide + clear the streaming UI — text will be re-rendered as
                            // Markdown in onQuestion/onComplete. Hide first to avoid the
                            // flash of raw streaming text disappearing.
                            cancelQaRender();
                            contentEl.classList.add('agent-u-visibility-hidden');
                            contentEl.empty();
                            streamingPara = null;
                        }
                    }

                    // Ensure the outer steps block exists and track this tool call
                    ensureStepsBlock();
                    stepsTotal++;
                    updateStepsSummary(false);

                    const brief = this.getToolBriefParam(input);
                    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    // Tool calls render into the steps block body, not directly into toolsEl
                    const renderTarget = stepsBodyEl!;

                    if (GROUPABLE_TOOLS.has(name)) {
                        // ── Grouped tool ──────────────────────────────────────────────
                        // Break existing group when a different tool type arrives
                        if (activeToolGroup && activeToolGroup.name !== name) {
                            activeToolGroup = null;
                        }

                        if (!activeToolGroup) {
                            // Create new group container inside the steps block
                            const details = renderTarget.createEl('details', { cls: 'tool-call-details' });
                            const summary = details.createEl('summary', { cls: 'tool-call-summary' });
                            setIcon(summary.createSpan('tool-icon'), this.getToolIcon(name));
                            const nameEl = summary.createSpan('tool-name');
                            nameEl.setText(this.formatGroupedLabel(name, 1));
                            summary.createSpan('tool-time').setText(time);
                            const statusEl = summary.createSpan({ cls: 'tool-status tool-running' });
                            const bodyEl = details.createDiv('tool-group-body');
                            activeToolGroup = { name, detailsEl: details, nameEl, statusEl, bodyEl, count: 1 };
                        } else {
                            // Group already exists — update count and reset status
                            activeToolGroup.count++;
                            scheduleGroupUpdate(activeToolGroup);
                            activeToolGroup.statusEl.removeClass('tool-done', 'tool-error');
                            activeToolGroup.statusEl.addClass('tool-running');
                            activeToolGroup.statusEl.setText('');
                        }

                        // Add compact item row to group body
                        const itemEl = activeToolGroup.bodyEl.createDiv('tool-group-item');
                        setIcon(itemEl.createSpan('tool-item-icon'), 'loader');
                        itemEl.createSpan('tool-item-brief').setText(brief || '...');

                        const queue = toolElsByName.get(name) ?? [];
                        queue.push(itemEl);
                        toolElsByName.set(name, queue);

                    } else {
                        // ── Standalone tool ───────────────────────────────────────────
                        // Any non-groupable tool breaks the active group
                        activeToolGroup = null;

                        const details = renderTarget.createEl('details', { cls: 'tool-call-details' });
                        const summary = details.createEl('summary', { cls: 'tool-call-summary' });
                        setIcon(summary.createSpan('tool-icon'), this.getToolIcon(name));
                        summary.createSpan('tool-name').setText(this.formatToolLabel(name));
                        if (brief) summary.createSpan('tool-brief-param').setText(brief);
                        summary.createSpan('tool-time').setText(time);
                        summary.createSpan('tool-status tool-running');

                        if (name !== 'attempt_completion') {
                            const inputEl = details.createDiv('tool-call-input');
                            inputEl.createEl('pre').setText(JSON.stringify(input, null, 2));
                            details.createDiv('tool-call-output');
                            details.open = true;
                        }

                        const pendingEls = toolElsByName.get(name) ?? [];
                        pendingEls.push(details);
                        toolElsByName.set(name, pendingEls);
                    }

                    const writeOps = ['write_file', 'edit_file', 'append_to_file', 'create_folder', 'delete_file', 'move_file'];
                    if (writeOps.includes(name)) taskWriteCount++;

                    // Collect content from file-writing tools for task extraction (ADR-026)
                    const taskRelevantOps = ['write_file', 'append_to_file', 'edit_file'];
                    if (taskRelevantOps.includes(name) && input) {
                        if (typeof input['content'] === 'string') {
                            accumulatedToolContent += '\n' + input['content'];
                        }
                        if (typeof input['new_str'] === 'string') {
                            accumulatedToolContent += '\n' + input['new_str'];
                        }
                    }

                    scheduleScroll();
                },
                onToolResult: (name, content, isError) => {
                    const queue = toolElsByName.get(name);
                    const el = queue?.shift() ?? null;
                    if (!el) return;

                    if (el.classList.contains('tool-group-item')) {
                        // ── Grouped item result ───────────────────────────────────────
                        const iconEl = el.querySelector<HTMLElement>('.tool-item-icon');
                        if (iconEl) {
                            iconEl.empty();
                            setIcon(iconEl, isError ? 'x' : 'check');
                        }
                        el.classList.add(isError ? 'item-error' : 'item-done');

                        // When all items in the group are settled, update the group header
                        const bodyEl = el.parentElement;
                        const detailsEl = bodyEl?.parentElement;
                        if (bodyEl && detailsEl != null && detailsEl.instanceOf(HTMLDetailsElement)) {
                            const stillRunning = bodyEl.querySelectorAll(
                                '.tool-group-item:not(.item-done):not(.item-error)'
                            ).length;
                            if (stillRunning === 0) {
                                const groupStatus = detailsEl.querySelector<HTMLElement>('.tool-status');
                                if (groupStatus) {
                                    groupStatus.removeClass('tool-running');
                                    const anyError = bodyEl.querySelectorAll('.item-error').length > 0;
                                    groupStatus.addClass(anyError ? 'tool-error' : 'tool-done');
                                    groupStatus.setText(anyError ? '✗' : '✓');
                                }
                                // Keep group open so the user can see which files were processed.
                                // Only collapse on error so the user can inspect failures.
                                if (isError) detailsEl.open = false;
                            }
                        }

                    } else if (el != null && el.instanceOf(HTMLDetailsElement)) {
                        // ── Standalone tool result ────────────────────────────────────
                        const details = el;

                        // Parse and strip <diff_stats added="X" removed="Y"/> tag
                        let displayContent = content;
                        const diffMatch = content.match(/<diff_stats added="(\d+)" removed="(\d+)"\/>/);
                        if (diffMatch && !isError) {
                            const diffAdded = parseInt(diffMatch[1], 10);
                            const diffRemoved = parseInt(diffMatch[2], 10);
                            displayContent = content.replace(/\n?<diff_stats[^/]*\/>/g, '');
                            if (diffAdded > 0 || diffRemoved > 0) {
                                const summary = details.querySelector('summary');
                                if (summary) {
                                    const badge = summary.createSpan('tool-diff-badge');
                                    const parts: string[] = [];
                                    if (diffAdded > 0) parts.push(`+${diffAdded}`);
                                    if (diffRemoved > 0) parts.push(`-${diffRemoved}`);
                                    badge.setText(parts.join(' / '));
                                }
                            }
                        }

                        const statusEl = details.querySelector('.tool-status');
                        if (statusEl) {
                            statusEl.removeClass('tool-running');
                            statusEl.addClass(isError ? 'tool-error' : 'tool-done');
                            statusEl.setText(isError ? '✗' : '✓');
                        }
                        const outputEl = details.querySelector('.tool-call-output');
                        if (outputEl && displayContent) {
                            const truncated = displayContent.length > 2000
                                ? displayContent.slice(0, 2000) + '\n…(truncated)'
                                : displayContent;
                            // FIX-19-31-02: clear any <pre> left by onToolProgress so the
                            // final result replaces the live-preview instead of being appended.
                            outputEl.empty();
                            // FIX-19-99-04: render tool output as markdown so [[wikilinks]]
                            // and [text](url) become clickable. Errors are swallowed because
                            // a malformed tool output should not break the chat surface.
                            void this.renderMarkdownAndWire(truncated, outputEl as HTMLElement);
                        }
                        details.open = isError;
                    }
                    // Fire the Frontmatter Operator recommendation toast once
                    // per session on the first successful update_frontmatter
                    // call, only when the plugin is not already active. The
                    // method itself gates on session flag + persistent
                    // dismiss flag + active-plugin check, so calling it
                    // unconditionally on the happy path is safe.
                    if (!isError && name === 'update_frontmatter') {
                        this.showFrontmatterOperatorRecommendation();
                    }

                    // Track step completion and update outer block summary
                    stepsCompleted++;
                    if (isError) stepsHasError = true;
                    updateStepsSummary(stepsCompleted === stepsTotal);

                    // Update activity badge in plan box (only if a plan is active).
                    // Use closest('.assistant-message') so the lookup works both before
                    // and after the DOM-move (toolsEl.parentElement changes on move).
                    activityActionCount++;
                    const actBadge = toolsEl.closest('.assistant-message')?.querySelector<HTMLElement>('.todo-activity-badge') ?? null;
                    if (actBadge) actBadge.setText(t('ui.sidebar.activityCount', { count: activityActionCount }));
                    if (isError) {
                        const actDetails = toolsEl.closest<HTMLDetailsElement>('.todo-activity-log');
                        if (actDetails) actDetails.open = true;
                    }
                },
                onToolProgress: (name, content) => {
                    // Update the live output area of the currently-running standalone tool.
                    const queue = toolElsByName.get(name);
                    const el = queue?.[0] ?? null; // peek without consuming
                    if (!el || el.classList.contains('tool-group-item')) return;
                    const outputEl = el.querySelector<HTMLElement>('.tool-call-output');
                    if (!outputEl) return;
                    // FIX-PERF-03: coalesce into one rAF tick so a 20-tool
                    // turn does not trigger 40+ synchronous parser passes.
                    // FIX-19-99-04 contract preserved: progress is rendered
                    // as markdown so partial wikilinks/links are clickable.
                    scheduleToolProgressRender(outputEl, content);
                },
                onUsage: (
                    inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens,
                    modelId, routingMode, usageByModel, longContextRequestModelIds,
                ) => {
                    // ADR-090 / FEATURE-1804: see TaskMonitor.onUsage
                    // FIX-24-05-02: modelId + routingMode must reach the
                    // monitor, otherwise TaskRouter-routed tasks are priced
                    // on the configured main model.
                    // FIX-24-05-05: usageByModel carries the per-model
                    // breakdown for correct mixed-model pricing.
                    // AUDIT-2026-08-27 I-5: longContextRequestModelIds carries
                    // what those sums cannot express, so the footer can mark the
                    // total as a floor instead of showing it as exact.
                    taskMonitor.onUsage(
                        inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens,
                        modelId, routingMode, usageByModel, longContextRequestModelIds,
                    );
                    // Deliberately NOT hiding the run meter here. onUsage is
                    // the root run's final tally, but a subtask can forward its
                    // usage mid-run, which would blank the "still working"
                    // indicator while the run is very much alive. The meter is
                    // retired by onComplete / onError instead.
                },
                onUsageProgress: (_inputTokens, outputTokens) => {
                    // Snap the live counter onto the real cumulative output and
                    // move the estimate watermark to "everything streamed so
                    // far", so the next tick estimates only the text that comes
                    // after this point.
                    liveTokensReal = outputTokens;
                    liveTokenCharsBase = accumulatedText.length + accumulatedThinking.length;
                    updateLiveMeter();
                },
                onTodoUpdate: (items) => {
                    lastTodoItems = items;
                    this.renderTodoBox(toolsEl, items, myContainer);
                },
                onContextCondensed: (prevTokens?: number, newTokens?: number) => {
                    // Show condensation feedback with token reduction
                    if (footerEl && prevTokens !== undefined && newTokens !== undefined) {
                        const feedback = new CondensationFeedback();
                        feedback.show(footerEl, {
                            prevTokens,
                            newTokens,
                        });
                        footerEl.classList.remove('agent-u-hidden');
                    } else if (footerEl) {
                        // Fallback: show simple badge if token counts not available
                        const badge = footerEl.createSpan('context-condensed-badge');
                        badge.setText(t('ui.sidebar.contextCondensed'));
                        footerEl.classList.remove('agent-u-hidden');
                    }

                    // Update context tracker with new token count after condensing
                    if (this.contextTracker && newTokens !== undefined) {
                        this.contextTracker.setTotalTokens(newTokens);
                    }
                },
                onContextCondenseFailed: (error: Error) => {
                    // FIX-COMPACT-02: surface failed condensing so the user
                    // sees that the helper-API call did NOT run, instead of
                    // silently letting the loop re-enter the same over-
                    // threshold state. Renders as a badge in the same footer.
                    if (footerEl) {
                        const badge = footerEl.createSpan('context-condense-failed-badge');
                        badge.setText(t('ui.sidebar.condenseFailed', { error: error.message }));
                        footerEl.classList.remove('agent-u-hidden');
                    }
                    console.warn('[Sidebar] Context condense failed:', error.message);
                },
                // FEAT-24-08 / ADR-114 Steering-Hook: drain the queue and
                // hand mid-run steering messages to AgentTask. Called by
                // AgentTask once per iteration. Order preserved. Each
                // drained bubble is flipped to "delivered at iteration N"
                // so the user can see exactly when their correction landed
                // in the conversation history.
                consumeSteeringMessages: (iteration: number) => {
                    // FEAT-55-01 (isolation fix): drain THIS run's own queue,
                    // not this.steeringQueue (the active tab's). AgentLoopEngine
                    // pushes the returned texts straight into the calling run's
                    // history, so reading the active tab would inject a steering
                    // message typed for another chat into this run's transcript
                    // (cross-tab write, FIX-01-01-02 class). mySession is pinned
                    // in this closure before the first await.
                    if (mySession.steeringQueue.length === 0) return [];
                    const drained = mySession.steeringQueue;
                    mySession.steeringQueue = [];
                    const texts: string[] = [];
                    for (const entry of drained) {
                        texts.push(entry.text);
                        this.markSteeringDelivered(entry.bubbleEl, iteration);
                    }
                    return texts;
                },
                onModeSwitch: (newModeSlug) => {
                    // FEAT-55-02 (ADR-170): the mid-loop switch_mode already
                    // updated THIS view's ModeService (AgentTask calls
                    // this.modeService.switchMode before this callback). We no
                    // longer write plugin.settings.currentMode here -- that
                    // global write was the cross-chat bleed: it changed every
                    // other chat's mode. This callback is now UI-only.
                    new Notice(t('notice.modeSwitched', { mode: this.getModeDisplayName(newModeSlug) }));
                    // Forced workflow is keyed per agent, so switching agents
                    // may change which one is active -- refresh the chip (IMP-02-02-01).
                    this.updateContextBadge();
                    // Auto-index on mode switch if configured
                    if (this.plugin.settings.semanticAutoIndex === 'mode-switch' && this.plugin.semanticIndex) {
                        this.plugin.semanticIndex.buildIndex().catch((e) =>
                            console.warn('[AgentSidebarView] Auto-index on mode switch failed:', e)
                        );
                    }
                },
                onCheckpoint: (checkpoint) => {
                    this.renderCheckpointMarker(toolsEl, checkpoint);
                    hasRenderedCheckpoints = true;
                    // FIX-44-12: remember for persistence into the UiMessage.
                    turnCheckpoints.push(checkpoint);
                    scheduleScroll();
                },
                // FIX-44-44: the pipeline reports every write that landed
                // without an individual diff approval; one is enough to owe
                // the user a post-task review.
                onUnreviewedWrite: () => {
                    taskHadUnreviewedWrites = true;
                },
                onQuestion: (question, options, resolve) => {
                    // Render any accumulated text before the question card.
                    // This is critical for multi-turn flows like onboarding where
                    // onComplete only fires at the very end — the greeting text
                    // would otherwise stay invisible until the entire task finishes.
                    if (accumulatedText.trim()) {
                        // Hide during re-render to avoid flash of raw → markdown transition
                        contentEl.classList.add('agent-u-visibility-hidden');
                        contentEl.empty();
                        void this.renderMarkdownAndWire(accumulatedText, contentEl);
                        window.requestAnimationFrame(() => { contentEl.classList.remove('agent-u-visibility-hidden'); });
                    }
                    // Wrap resolve: after the user answers, show their answer as a
                    // chat bubble and create a fresh message element for the next
                    // agent response. This turns multi-turn flows (onboarding) into
                    // a real back-and-forth conversation in the UI.
                    const wrappedResolve = (answer: string) => {
                        // Finalize current assistant message
                        messageEl.removeClass('message-streaming');
                        if (accumulatedText) {
                            // FEAT-55-01 Phase C: run-bound session, not this.active.
                            mySession.uiMessages.push({
                                role: 'assistant',
                                text: accumulatedText,
                                ts: new Date().toISOString(),
                                toolStepsHtml: stepsBlockEl?.outerHTML,
                                taskId,
                                reasoningText: accumulatedThinking || undefined,
                                // Mid-run question round: usually still hidden
                                // (usage reports at run end), but a subtask
                                // forward may already have written it.
                                usageFooter: captureUsageFooter(),
                                // FIX-44-12: persist this turn's markers so they
                                // rehydrate live after a reload.
                                checkpoints: turnCheckpoints.length > 0
                                    ? turnCheckpoints.map(toPersistedCheckpointMarker)
                                    : undefined,
                            });
                            // FIX-44-12: markers of the finalized turn were
                            // just persisted; the next turn starts empty.
                            turnCheckpoints = [];
                        }
                        // Render user answer as a regular chat message into the
                        // run's own container (isolation fix), not the active tab.
                        this.addUserMessage(answer, [], null, myContainer);
                        // Review F4: mark this bubble as a followup answer, not
                        // an independent send. It enters the API history as a
                        // tool_result, so computeEditResendCut must not count it
                        // as a real user turn (otherwise edit+resend stays
                        // disabled for every conversation that used a followup).
                        mySession.uiMessages.push({ role: 'user', text: answer, ts: new Date().toISOString(), isFollowupAnswer: true });
                        // History hardening phase B: one save point covers both
                        // pushes of this exchange (question flush + typed
                        // answer). Long skill runs with followups used to lose
                        // everything up to here on reload.
                        this.saveCurrentConversation(mySession);
                        // Create fresh assistant message element for the next response
                        ({ messageEl, thinkingEl, toolsEl, contentEl, footerEl } = this.createStreamingMessageEl(myContainer));
                        // Reset per-turn state
                        accumulatedText = '';
                        accumulatedThinking = '';
                        accumulatedToolContent = '';
                        hasTools = false;
                        cancelQaRender();
                        qaLastRenderAt = 0;
                        streamingPara = null;
                        stepsBlockEl = null;
                        stepsBodyEl = null;
                        stepsSummaryIconEl = null;
                        stepsSummaryLabelEl = null;
                        stepsTotal = 0;
                        stepsCompleted = 0;
                        stepsHasError = false;
                        loadingRemoved = false;
                        activeToolGroup = null;
                        // FIX-44-12 (review follow-up): turnCheckpoints is
                        // deliberately NOT reset here. When the turn had no
                        // assistant text, nothing was persisted above -- the
                        // markers ride along and persist with the NEXT push
                        // instead of vanishing on reload. The reset lives
                        // inside the `if (accumulatedText)` block.
                        // Scroll and continue agent loop
                        scheduleScroll();
                        resolve(answer);
                    };
                    this.showQuestionCard(question, options, wrappedResolve, myContainer, mySession);
                },
                onApprovalRequired: async (toolName, input, preview, batch, sandboxGrant) => {
                    return this.showApprovalCard(toolName, input, preview, batch, myContainer, mySession, sandboxGrant);
                },
                onOptionalAssetRequired: async (spec, toolName) => {
                    return this.showInstallPromptCard(spec, toolName, myContainer);
                },
                onAttemptCompletion: () => {
                    // Auto-complete any unfinished todo items — agent often skips
                    // a final update_todo_list call before attempt_completion
                    if (lastTodoItems.length > 0) {
                        const allDone = lastTodoItems.map((i) => ({ ...i, status: 'done' as const }));
                        this.renderTodoBox(toolsEl, allDone, myContainer);
                    }
                    scheduleScroll();
                },
                onEpisodeData: (data) => {
                    // Episodic memory: record task outcome (ADR-018).
                    // Payload includes success, mistakesEncountered,
                    // attemptCompletionFired, fastPathFired. Fires for ALL exit
                    // paths (success, iteration-cap, abort, error). Fire-and-forget.
                    if (this.plugin.episodicExtractor && this.plugin.settings.mastery.enabled) {
                        const resultSummary = data.success
                            ? accumulatedText.slice(0, 300)
                            : (data.attemptCompletionFired ? 'partial' : 'incomplete');
                        const episode = {
                            userMessage: text,
                            mode: activeMode.slug,
                            toolSequence: data.toolSequence,
                            toolLedger: data.toolLedger,
                            success: data.success,
                            resultSummary,
                        };
                        this.plugin.episodicExtractor.recordEpisode(episode).then((ep) => {
                            if (ep && this.plugin.recipePromotionService) {
                                // ADR-058: check for semantic recipe promotion.
                                // recipeWinner routes a FastPath recipe win to a
                                // success-count bump instead of a duplicate promotion.
                                this.plugin.recipePromotionService.checkForPromotion(ep, data.recipeWinner).catch((e) =>
                                    console.warn('[Mastery] Promotion check failed:', e)
                                );
                            }
                        }).catch((e) => console.warn('[Mastery] Episode recording failed:', e));
                    }
                },
                onComplete: () => {
                    // Always clear the loading spinner — covers cases where no text was streamed.
                    removeLoading();
                    elapsedTimer.stop();
                    hideLiveMeter();
                    // Auto-complete todos on natural task end (mirrors onAttemptCompletion)
                    if (lastTodoItems.length > 0) {
                        const allDone = lastTodoItems.map((i) => ({ ...i, status: 'done' as const }));
                        this.renderTodoBox(toolsEl, allDone, myContainer);
                    }
                    // Finalize the steps block: remove any trailing "Analyzing…" row,
                    // ensure the summary shows the final count + status icon, and
                    // remove open state from individual tool-call details so the block
                    // is tidy when the user expands it.
                    if (stepsBlockEl) {
                        if (stepsTotal === 0) {
                            // No tools were called — remove the empty block so it doesn't clutter the UI.
                            stepsBlockEl.remove();
                            stepsBlockEl = null;
                        } else {
                            stepsBodyEl?.querySelector('.tool-computing-row')?.remove();
                            updateStepsSummary(true);
                            // Collapse individual tool <details> that were left open during streaming
                            stepsBodyEl?.querySelectorAll('details.tool-call-details').forEach((d) => {
                                if (d != null && d.instanceOf(HTMLDetailsElement)) d.open = false;
                            });
                        }
                    }

                    // Replace the streamed Markdown with the authoritative pass (sources /
                    // followups parsed). Cancel any pending throttled Q&A render first so a
                    // late trailing tick cannot re-render the unparsed text over this one.
                    cancelQaRender();
                    streamingPara = null;
                    // Parse [sources] and [followups] blocks before rendering
                    let renderText = accumulatedText;
                    let parsedSources: { num: number; note: string; context: string }[] = [];
                    let parsedFollowups: string[] = [];
                    let followupHeading = '';
                    if (accumulatedText) {
                        const srcParsed = this.parseSources(accumulatedText);
                        renderText = srcParsed.cleanText;
                        parsedSources = srcParsed.sources;
                        const fuParsed = this.parseFollowups(renderText);
                        renderText = fuParsed.cleanText;
                        followupHeading = fuParsed.heading;
                        parsedFollowups = fuParsed.followups;
                    }
                    if (renderText) {
                        contentEl.empty();
                        void this.renderMarkdownAndWire(renderText, contentEl);
                        contentEl.classList.remove('agent-u-visibility-hidden');
                    } else if (hasTools) {
                        // Tools ran but the model returned no text — show a neutral placeholder
                        // so the user doesn't stare at an empty message bubble.
                        contentEl.empty();
                        contentEl.createEl('p', { cls: 'message-empty-response', text: t('ui.sidebar.emptyResponse') });
                    }
                    // Show timestamp in footer even without token usage
                    if (footerEl.classList.contains('agent-u-hidden')) {
                        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        footerEl.setText(time);
                        footerEl.classList.remove('agent-u-hidden');
                    }
                    // Link wiring now happens inside renderMarkdownAndWire above.
                    // Convert inline [N] to clickable citation badges
                    this.wireCitationBadges(contentEl, parsedSources);
                    // Add response action bar (with sources indicator)
                    this.addResponseActions(messageEl, accumulatedText, parsedSources);
                    // Render follow-up suggestions (parsed from [followups] block)
                    if (parsedFollowups.length > 0) {
                        const followupList = messageEl.createDiv('followup-list');
                        if (followupHeading) {
                            followupList.createDiv({ cls: 'followup-heading', text: followupHeading });
                        }
                        for (const raw of parsedFollowups) {
                            // Clean [[wikilinks]] → display name only (no folder prefix)
                            const displayText = raw.replace(/\[\[([^\]]+)\]\]/g, (_m, link: string) => {
                                const name = link.contains('|') ? link.split('|').pop()! : link;
                                return name.contains('/') ? name.split('/').pop()! : name;
                            });
                            const itemRow = followupList.createDiv('followup-item-row');
                            // Main button: send immediately (existing behavior)
                            const item = itemRow.createEl('button', { cls: 'followup-item', text: displayText });
                            item.addEventListener('click', () => {
                                if (this.textarea) {
                                    this.textarea.value = displayText;
                                    void this.handleSendMessage();
                                }
                            });
                            // "+" button: append text to textarea without sending (inside item, right-aligned, hover-only)
                            const appendBtn = item.createSpan({ cls: 'followup-append-btn', text: '+' });
                            appendBtn.setAttribute('aria-label', t('ui.sidebar.addToInput'));
                            appendBtn.addEventListener('click', (ev) => {
                                ev.stopPropagation();
                                ev.preventDefault();
                                if (this.textarea) {
                                    const sep = this.textarea.value.trim() ? '\n' : '';
                                    this.textarea.value = this.textarea.value + sep + displayText;
                                    this.textarea.focus();
                                    this.textarea.dispatchEvent(new Event('input'));
                                }
                            });
                        }
                    }
                    messageEl.removeClass('message-streaming');
                    // FIX-24-08-03: only clean up when this is still OUR
                    // controller. A late onComplete of a stopped, drained
                    // run must not clobber a newer run's controller (which
                    // would make that run unstoppable).
                    // FEAT-55-01 (Fix 2): compare against mySession, not the
                    // active session -- a background run completing while a
                    // different tab is active would otherwise never null its
                    // own controller (stuck tab dot) and skip its save.
                    // FIX-03-20-02: resolve ownership from the PRE-cleanup
                    // controller state. The gate below used to be computed
                    // AFTER this block nulled currentAbortController, so its
                    // live-run disjunct was dead and EVERY cleanly finishing
                    // run skipped the assistant-uiMessage push + save + title
                    // (files kept the full API history but only the user
                    // prompts in uiMessages). handleStop already follows this
                    // rule ("record teardown ownership BEFORE nulling").
                    const teardown = resolveRunTeardown(
                        mySession.currentAbortController, mySession.drainingController, myController,
                    );
                    if (teardown.wasLiveRun) {
                        mySession.currentAbortController = null;
                        mySession.currentStopFeedback = null;
                        this.setRunningState(false);
                    }
                    // Issue 3 Wave B: drain-owner gate. A run owns the shared
                    // view state (drain-end, Resume card, uiMessages, save,
                    // post-task surfaces, title) only if it is the live run OR
                    // the still-draining stopped run that no new send has
                    // superseded. A superseded old run matches neither and
                    // does ONLY the local DOM cleanup above/below -- it never
                    // writes into the newer conversation (FIX-01-01-02).
                    const drainOwner = teardown.drainOwner;
                    if (drainOwner) {
                        this.endTaskDraining(mySession); // GUARD-L1
                        // IMP-24-08-04 (stop=pause): a stopped run kept its
                        // inflight snapshot -- offer the Resume card now that
                        // the drain is over and sends are unblocked. Scoped to
                        // THIS chat's conversation (FEAT-55-01) so it shows the
                        // snapshot of the chat the user stopped, not a global one.
                        if (myController.signal.aborted) {
                            void this.maybeOfferInflightResume(mySession.activeConversationId ?? undefined, myContainer);
                        }
                    }
                    scheduleScroll();
                    if (!drainOwner) {
                        // Superseded stopped run: local DOM is already tidied,
                        // touch no shared state and skip all persistence.
                        return;
                    }
                    // Post-task surfaces (extracted for testability, see
                    // postTaskReviewGate.ts). The review is gated on writes
                    // that never had a diff surface (regardless of the
                    // auto-approval master toggle), NOT on the toggle itself
                    // and NOT on the legacy six-tool write count: tools like
                    // update_frontmatter or set_block_anchors write without
                    // ever incrementing taskWriteCount (FIX-44-44). When
                    // every write was individually diff-approved at the gate,
                    // the review stays closed -- a second, weaker-looking
                    // approval is what misled users (FIX-44-16).
                    const surfaces = decidePostTaskSurfaces({
                        taskWriteCount,
                        taskHadUnreviewedWrites,
                        enableCheckpoints: this.plugin.settings.enableCheckpoints ?? true,
                        hasRenderedCheckpoints,
                    });
                    if (surfaces.showUndoBar) {
                        this.showUndoBar(taskId, taskWriteCount, myContainer);
                    }
                    if (surfaces.showPostTaskReview) {
                        void this.showPostTaskReview(taskId, mySession);
                    }
                    // Notify when the finished run is NOT the one the user is
                    // looking at. FEAT-55-01 (user decision 2026-07-25): with
                    // several tabs this must be tab-based, not focus-based --
                    // fire when the sidebar is unfocused OR the finished chat is
                    // a background tab, and name the chat so the user knows
                    // WHICH one completed. Suppressed only when this exact chat
                    // is both the active tab and the focused view.
                    const sidebarFocused = this.app.workspace.getMostRecentLeaf()?.view === this;
                    const runIsActiveTab = mySession === this.activeSession;
                    if (!sidebarFocused || !runIsActiveTab) {
                        const chatName = this.sessionTabTitle(mySession, this.sessions.indexOf(mySession));
                        new Notice(t('notice.taskCompleteInChat', { chat: chatName }), 3000);
                    }
                    // Track assistant UI message for history persistence,
                    // including a snapshot of the collapsed steps block so
                    // tool actions remain inspectable after a chat reload.
                    if (accumulatedText) {
                        // FEAT-55-01 Phase C: push into the RUN's session, not
                        // this.activeSession (a tab switch mid-run must not
                        // move the assistant reply to the now-active tab).
                        mySession.uiMessages.push({
                            role: 'assistant',
                            text: accumulatedText,
                            ts: new Date().toISOString(),
                            toolStepsHtml: stepsBlockEl?.outerHTML,
                            taskId,
                            reasoningText: accumulatedThinking || undefined,
                            usageFooter: captureUsageFooter(),
                            // FIX-44-12: persist this turn's markers so they
                            // rehydrate live after a reload.
                            checkpoints: turnCheckpoints.length > 0
                                ? turnCheckpoints.map(toPersistedCheckpointMarker)
                                : undefined,
                        });
                    }
                    // Auto-save conversation to ConversationStore (run's session).
                    this.saveCurrentConversation(mySession);

                    // Task Extraction Post-Processing (ADR-026, FEATURE-100)
                    const taskScanText = (accumulatedText + accumulatedToolContent).trim();
                    if (this.plugin.settings.taskExtraction?.enabled && taskScanText) {
                        void this.maybeExtractTasks(taskScanText);
                    }

                    // Auto-title at task end, not only when the conversation is
                    // closed (ADR-022). Two steps: an immediate fallback (first
                    // user message) so the tab shows something at once, then the
                    // semantic title async, which replaces it. The old `<= 2`
                    // message guard skipped exactly the long, multi-tool skill
                    // runs -- that is why those tabs stayed "New Conversation".
                    //
                    // MERGE 2026-07-25 (fix/plaud-dedup-at-write-point x EPIC-55):
                    // the titling logic is taken from the skill branch, but bound
                    // to mySession instead of the active-tab accessors. A
                    // background run finishing while another tab is active must
                    // title ITS OWN chat, never the visible one (the cross-tab
                    // write class FIX-01-01-02 / the in-view-tab isolation fix).
                    if (mySession.activeConversationId && this.plugin.conversationStore) {
                        const convId = mySession.activeConversationId;
                        const store = this.plugin.conversationStore;
                        const meta = store.list().find((c) => c.id === convId);
                        // Only lay down the fallback while the title is still the
                        // untouched default; never clobber a fallback/auto/user title.
                        if (!meta || isUnnamedTitle(meta.title)) {
                            const firstUserMsg = mySession.uiMessages.find((m) => m.role === 'user');
                            if (firstUserMsg) {
                                const fallback = firstUserMsg.text.slice(0, 60).replace(/\n/g, ' ').trim() || t('ui.sidebar.newChat');
                                void store.updateMeta(convId, { title: fallback }).catch(() => {});
                                this.historyPanel?.refresh();
                                // FEAT-55-01: the tab label is read from the store
                                // title, and the run-state re-render already fired
                                // before this title existed -- repaint the strip so
                                // the tab actually shows the new name.
                                this.renderTabStrip();
                            }
                        }
                        // Semantic title: idempotent, no-op if one already exists
                        // (incl. a skill-declared 'auto' title from send time) or
                        // no titling model is configured.
                        const msgs = [...mySession.uiMessages];
                        void this.maybeGenerateSemanticTitle(convId, msgs).catch(() => {});
                    }
                },
                // Feature 5: Error display inside steps dialog
                onError: (error) => {
                    // Clean up spinner and computing row
                    removeLoading();
                    elapsedTimer.stop();
                    hideLiveMeter();

                    // Show error inside the steps block (not as a separate red banner)
                    ensureStepsBlock();
                    const errorRow = (stepsBodyEl ?? toolsEl).createDiv('tool-step-row tool-step-error');
                    const iconEl = errorRow.createSpan('tool-step-icon');
                    setIcon(iconEl, 'x-circle');
                    const textEl = errorRow.createDiv('tool-step-text');
                    textEl.createDiv('error-title').setText(this.getErrorTitle(error));
                    textEl.createDiv('error-detail').setText(error.message);

                    // Update steps summary to error state
                    stepsHasError = true;
                    updateStepsSummary(true);
                    if (stepsBlockEl) stepsBlockEl.open = true;

                    // Clean up streaming/running state
                    messageEl.removeClass('message-streaming');
                    // FIX-24-08-03: identity check, see onComplete.
                    // FEAT-55-01 (Fix 2): compare against mySession, see onComplete.
                    // FIX-03-20-02: same dead-disjunct as onComplete -- resolve
                    // ownership BEFORE nulling, or an erroring live run never
                    // ends its own drain.
                    const errTeardown = resolveRunTeardown(
                        mySession.currentAbortController, mySession.drainingController, myController,
                    );
                    if (errTeardown.wasLiveRun) {
                        mySession.currentAbortController = null;
                        this.setRunningState(false);
                    }
                    // Issue 3 Wave B: only the drain owner (live run or the
                    // still-draining stopped run not yet superseded) ends the
                    // drain. A superseded old run erroring out must not clear
                    // the lock the new run's lifecycle owns.
                    if (errTeardown.drainOwner) {
                        this.endTaskDraining(mySession); // GUARD-L1
                    }
                },
                onTaskTelemetry: (data) => {
                    // ADR-090 / FEATURE-1804: see TaskMonitor.onTaskTelemetry
                    taskMonitor.onTaskTelemetry(data);
                },
                onRequestTelemetry: (data) => {
                    // FEAT-24-11: per-request cache picture -> requests.jsonl
                    taskMonitor.onRequestTelemetry(data);
                },
                onCondenseTelemetry: (event) => {
                    // FIX-COMPACT-07: per-condense JSONL for threshold tuning
                    taskMonitor.onCondenseTelemetry(event);
                },
            },
            modeService: this.modeService,
            consecutiveMistakeLimit: this.plugin.settings.advancedApi.consecutiveMistakeLimit,
            rateLimitMs: this.plugin.settings.advancedApi.rateLimitMs,
            // FIX-COMPACT-03: shared defaults so the sidebar fallback can
            // never drift from the settings schema and the Runner. The
            // previous `false` fallback silently disabled condensing for
            // any user whose settings.advancedApi was undefined.
            condensingEnabled: this.plugin.settings.advancedApi.condensingEnabled ?? DEFAULT_CONDENSING_ENABLED,
            condensingThreshold: this.plugin.settings.advancedApi.condensingThreshold ?? DEFAULT_CONDENSING_THRESHOLD,
            powerSteeringFrequency: this.plugin.settings.advancedApi.powerSteeringFrequency ?? 0,
            maxIterations: this.plugin.settings.advancedApi.maxIterations ?? 25,
            depth: 0,  // root task starts at 0
            maxSubtaskDepth: this.plugin.settings.advancedApi.maxSubtaskDepth ?? 2,
            microcompactionEnabled: this.plugin.settings.advancedApi.microcompactionEnabled ?? DEFAULT_MICROCOMPACTION_ENABLED,
            rollingSummaryThreshold: this.plugin.settings.advancedApi.rollingSummaryThreshold ?? DEFAULT_ROLLING_SUMMARY_THRESHOLD,
            modelOverrideActive,
        });

        // Load enabled rules for this task (Sprint 3.2)
        const rulesLoader = this.plugin.rulesLoader;
        const rulesContent = rulesLoader
            ? await rulesLoader.loadEnabledRules(this.plugin.settings.rulesToggles ?? {})
            : undefined;

        // Feature 1: Pass the shared history — it accumulates across messages
        // Feature 4: Pass messageToSend (with active file context) instead of raw text
        const activeMode = this.modeService.getActiveMode();

        // FEAT-24-09 / ADR-116: build the stable SKILLS directory for the
        // cached system-prompt prefix. The model loads a skill body on demand
        // via the read_skill tool -- no per-message LLM classifier any more.
        // Skip only during the active first-time onboarding wizard, not for
        // users who abandoned it but use the plugin productively (FIX-24-09-01).
        const isOnboarding = isActiveOnboardingFlow(this.plugin.settings);
        let skillDirectorySection: string | undefined;
        if (!isOnboarding) {
            skillDirectorySection = await this.buildSkillDirectory();
        }

        // Apply forced workflow from the tool picker. Prepends the workflow's
        // instructions to the message the agent receives, on every message in
        // this agent, unless the user typed an explicit /#§ command themselves.
        // Prepending onto the already-built messageToSend keeps any #/§
        // expansion and the full vault context (FIX-02-02-01, defects c/d) and
        // works for attachments too (defect b). When the workflow can no longer
        // be applied we warn once instead of silently sending plain text
        // (defect a).
        const forcedWorkflowSlug = this.plugin.settings.forcedWorkflow?.[activeMode.slug] ?? '';
        if (shouldApplyForcedWorkflow(text, forcedWorkflowSlug)) {
            const workflowLoader = this.plugin.workflowLoader;
            const instructions = workflowLoader
                ? await workflowLoader.loadInstructions(
                    forcedWorkflowSlug,
                    this.plugin.settings.workflowToggles ?? {},
                )
                : null;
            if (instructions !== null) {
                messageToSend = applyForcedWorkflow(messageToSend, instructions);
                this.forcedWorkflowWarned.delete(forcedWorkflowSlug);
            } else if (!this.forcedWorkflowWarned.has(forcedWorkflowSlug)) {
                this.forcedWorkflowWarned.add(forcedWorkflowSlug);
                new Notice(t('notice.forcedWorkflowUnavailable', { slug: forcedWorkflowSlug }));
            }
        }

        // Build plugin skills section from VaultDNA (PAS-1) — skip during onboarding
        const pluginSkillsSection = isOnboarding ? undefined
            : this.plugin.skillRegistry?.getPluginSkillsPromptSection();

        // The chat-header pocket knife toggles MCP activation globally. Resolve
        // it to the prompt tool-catalogue filter so the advertised MCP tools
        // match what the gates allow: undefined = all (default), [] = MCP off,
        // subset = narrowed (IMP-04-10-02).
        const allowedMcpServers: string[] | undefined = resolveAllowedMcpServers(this.plugin.settings, activeMode.slug);

        // Memory v2 is the only path. The legacy v1 MD-file pipeline was
        // removed once the upgrade orchestrator landed -- existing users
        // are taken through the upgrade modal on first load, fresh users
        // start on v2 from minute one. ContextComposer renders an empty
        // block until the user has facts; no fallback to v1.
        let memoryContext: string | undefined;
        const isFirstMessage = mySession.conversationHistory.length === 0;

        if (
            this.plugin.settings.memory.enabled
            && this.plugin.memoryDB?.isOpen()
            && this.plugin.embeddingService?.isReady()
        ) {
            try {
                const { TopicInference } = await import('../core/memory/TopicInference');
                const { UserProfileView } = await import('../core/memory/UserProfileView');
                const { ContextComposer } = await import('../core/memory/ContextComposer');
                const inference = new TopicInference(this.plugin.memoryDB);
                const profileView = new UserProfileView(this.plugin.memoryDB);
                // FIX-32-03-01: the composer renders a stable pause-notice
                // trailer when TokenBudgetGuard has blocked further writes.
                // dayKey comes from the same snapshot the guard uses so the
                // line flips deterministically at the daily reset.
                const composer = new ContextComposer(
                    this.plugin.memoryDB,
                    inference,
                    profileView,
                    this.plugin.driftBus,
                    () => {
                        const guard = this.plugin.tokenBudget;
                        if (!guard) return null;
                        const reason = guard.blockReason();
                        if (!reason) return null;
                        return { reason, dayKey: guard.snapshot().day };
                    },
                );
                // FEAT-03-26 (BA-25): Top-Hub-Block (Vault-Karte) optional
                // im stabilen Prompt-Prefix. Default off, Setting-gated.
                const topHubBlock = this.plugin.settings.vaultIngest?.topHubBlock?.enabled
                    ? this.plugin.topHubBlockMarkdown
                    : undefined;
                // FIX-03-19b-01: Soul-Block (embedding-frei, FEATURE-0319b) und
                // Query-Embedding werden UNABHAENGIG zusammengesetzt. Vorher
                // teilten embed() und der SoulView-Render einen try/catch, sodass
                // ein 8s-Embedding-Timeout (Budget aus f1bc6154) den ganzen Block
                // riss und der Agent seine Identitaet verlor (siezte). Jetzt
                // degradiert ein Embedding-Fehler nur das Recall auf Recency
                // (compose() behandelt userEmbedding=null als "Lock behalten").
                const { SoulView } = await import('../core/memory/SoulView');
                const { assembleMemoryContext } = await import('../core/memory/assembleMemoryContext');
                const embeddingService = this.plugin.embeddingService;
                memoryContext = await assembleMemoryContext({
                    renderSoul: () => {
                        const memoryDB = this.plugin.memoryDB;
                        return memoryDB ? new SoulView(memoryDB).renderMarkdown() : '';
                    },
                    embedQuery: async () => {
                        if (!text.trim() || !embeddingService) return null;
                        const vectors = await embeddingService.embed([text]);
                        return vectors[0] ?? null;
                    },
                    composeContext: (userEmbedding) => composer.compose({
                        sessionId: mySession.activeConversationId ?? 'transient',
                        userMessageEmbedding: userEmbedding,
                        topHubBlockMarkdown: topHubBlock,
                    }),
                });
            } catch (e) {
                console.warn('[Memory] ContextComposer failed:', e);
            }
        }

        // Session retrieval + onboarding: independent of v1/v2 memory engine.
        // Session summaries live in the same memory.db.sessions table either
        // way; onboarding prompts are still surfaced through MemoryService
        // until OnboardingService gets re-homed onto the v2 stores
        // (FEATURE-0323).
        if (this.plugin.settings.memory.enabled && this.plugin.memoryService) {
            try {
                const parts: string[] = memoryContext ? [memoryContext] : [];

                // Onboarding: inject step-specific setup instructions when setup is incomplete
                const onboarding = new OnboardingService(this.plugin.memoryService, this.plugin);
                const onboardingPrompt = onboarding.getOnboardingPrompt(getActiveLocale());
                if (onboardingPrompt) parts.unshift(onboardingPrompt);

                // Session retrieval — only on first message, using raw user text
                // (not userMessageText which includes <context> and <vault_context> blocks).
                // Skipped entirely when no sessions exist to avoid a wasted embedding API call.
                if (isFirstMessage && text.trim()) {
                    const stats = await this.plugin.memoryService.getStats();
                    if (stats.sessionCount > 0) {
                        const retriever = new MemoryRetriever(
                            this.plugin.globalFs,
                            this.plugin.memoryService,
                            () => this.plugin.semanticIndex,
                            this.plugin.memoryDB,
                        );
                        const sessionContext = await retriever.retrieveSessionContext(text);
                        if (sessionContext) parts.push(sessionContext);
                    }
                }

                if (parts.length > 0) memoryContext = parts.join('\n\n');
            } catch (e) {
                console.warn('[Memory] Session retrieval failed:', e);
            }
        }

        // Recipe matching (ADR-017) — find procedural recipes before starting the task
        let recipesSection: string | undefined;
        // Capture the matches so we can pass
        // them into AgentTask.run via `recipeMatches`. Without this the
        // FastPath gate inside AgentTask would re-run `match()` and could
        // diverge from the Sidebar's `recipesSection` source.
        let recipeMatchesForRun: import('../core/mastery/RecipeMatchingService').RecipeMatchResult[] | undefined;
        if (this.plugin.settings.mastery.enabled && this.plugin.recipeMatchingService) {
            try {
                const matches = this.plugin.recipeMatchingService.match(text, activeMode.slug);
                console.debug(`[Mastery] Recipe matching: ${matches.length} match(es) for mode "${activeMode.slug}"`, matches.map(m => `${m.recipe.id} (${m.score.toFixed(2)})`));
                recipeMatchesForRun = matches;
                if (matches.length > 0) {
                    recipesSection = this.plugin.recipeMatchingService.buildPromptSection(matches);
                    console.debug(`[Mastery] Recipe section injected (${recipesSection.length} chars)`);
                }
            } catch (e) {
                console.warn('[Mastery] Recipe matching failed (non-fatal):', e);
            }
        } else {
            console.debug(`[Mastery] Skipped: enabled=${this.plugin.settings.mastery.enabled}, service=${!!this.plugin.recipeMatchingService}`);
        }

        // IMP-41-03-01: an armed resume snapshot replaces the working history
        // with the (more complete) inflight copy and hands the loop its
        // persisted state. One-shot: consumed here, cleared immediately.
        const resumeSnapshot = mySession.pendingResume;
        mySession.pendingResume = null;
        if (resumeSnapshot) {
            mySession.conversationHistory = [...resumeSnapshot.history];
        }

        await task.execute({
            userMessage: messageToSend,
            taskId,
            initialMode: activeMode,
            history: mySession.conversationHistory,
            resumeState: resumeSnapshot?.state,
            // FIX-24-08-03: bind the pinned controller, not the mutable
            // field -- awaits between controller creation and this call
            // could otherwise hand this run a different run's signal.
            abortSignal: myController.signal,
            globalCustomInstructions: this.plugin.settings.globalCustomInstructions || undefined,
            includeTime: this.plugin.settings.includeCurrentTimeInContext ?? false,
            rulesContent: rulesContent || undefined,
            // FEAT-24-09 / ADR-116: SKILLS directory for the cached prefix.
            skillDirectorySection: skillDirectorySection || undefined,
            mcpClient: this.plugin.mcpClient,
            allowedMcpServers,
            memoryContext,
            pluginSkillsSection: pluginSkillsSection || undefined,
            recipesSection,
            // Hand the SAME matches to AgentTask so the FastPath gate
            // sees what `recipesSection` was built from.
            recipeMatches: recipeMatchesForRun,
            configDir: this.app.vault.configDir,
            conversationId: mySession.activeConversationId ?? undefined,
            // FEAT-55-02 (ADR-170): run-scoped chat attachments for this send.
            attachmentTexts: runAttachmentTexts,
        });
    }

    /**
     * Trigger manual context condensing
     */
    private triggerManualCondensing(): void {
        if (!this.contextTracker) {
            new Notice(t('notice.context.trackerNotInitialized'));
            return;
        }

        const usage = this.contextTracker.getContextUsage();
        const percentage = usage.maxTokens > 0 ? (usage.tokensUsed / usage.maxTokens) * 100 : 0;

        if (percentage < 60) {
            new Notice(t('notice.context.condenseBelowThreshold'));
            return;
        }

        new Notice(t('notice.context.manualCondenseNotImplemented'));
        // TODO: Implement manual condensing trigger
        // This requires either:
        // 1. Storing reference to current AgentTask
        // 2. Implementing condensing via separate API call
        // 3. Using event system to trigger condensing
        //
        // For now, automatic condensing at 65% threshold is active.
    }

    /**
     * Feature 3: Cancel the running request
     */
    private handleStop(): void {
        if (this.currentAbortController) {
            this.beginTaskDraining(); // GUARD-L1
            // Issue 3 Wave B: record teardown ownership BEFORE nulling the
            // controller, so the stopped run's late onComplete/onError can
            // tell it still owns the view (Resume card, partial save) -- until
            // a new send transfers ownership away by nulling this token.
            this.drainingController = this.currentAbortController;
        }
        this.currentAbortController?.abort();
        this.currentAbortController = null;
        // IMP-24-08-04: swap the Working spinner for a Stopping row NOW --
        // the run drains to its next abort checkpoint in the background
        // and offers a Resume card when it ends.
        this.currentStopFeedback?.();
        this.currentStopFeedback = null;
        // FEAT-24-08 Steering: pending bubbles never reached the agent --
        // flip them to "discarded" so the user knows the correction was
        // never applied.
        for (const entry of this.steeringQueue) {
            this.markSteeringDiscarded(entry.bubbleEl);
        }
        this.steeringQueue = [];
        this.setRunningState(false);
    }

    /**
     * Toggle between send and stop button states.
     *
     * FEAT-24-08 / ADR-114 Steering-Hook: when a task is running and the
     * textarea has content, show Send (Claude-Code-style: typing morphs
     * Stop -> Send so Enter sends a steering message instead of stopping).
     * Empty textarea while running keeps Stop visible.
     * Textarea stays enabled so the user can type mid-run.
     */
    private setRunningState(running: boolean): void {
        if (this.modelButton) this.modelButton.disabled = running;
        // Textarea is no longer disabled when running -- needed for steering.
        if (this.textarea) this.textarea.disabled = false;
        this.refreshRunStateButtons();
    }

    /**
     * Pick the correct primary action button (Send vs Stop) based on running
     * state + textarea content. Called on running-state changes and on every
     * textarea input event.
     */
    private refreshRunStateButtons(): void {
        const running = this.currentAbortController !== null;
        const hasText = (this.textarea?.value.trim().length ?? 0) > 0;
        // FIX-24-08-03: Stop stays visible for the whole task lifetime;
        // Send appears NEXT TO it in steering mode. The old morph replaced
        // Stop with Send at the same position, making a running task
        // unstoppable as soon as text sat in the textarea.
        const { showSend, showStop } = resolveRunStateButtons(running, hasText);
        if (this.sendButton) this.sendButton.classList.toggle('agent-u-hidden', !showSend);
        if (this.stopButton) this.stopButton.classList.toggle('agent-u-hidden', !showStop);
        // FEAT-55-01 (Phase C): keep the tab strip's per-session running dot in
        // sync as runs start/stop.
        //
        // PERF 2026-07-25: this used to repaint unconditionally. The comment
        // claimed the method "fires on every run-state change" -- it also fires
        // from the textarea input handler, so the whole strip was rebuilt on
        // EVERY KEYSTROKE, and each tab label does a conversationStore.list()
        // lookup. Repaint only when what the strip actually shows has changed.
        if (this.tabStripSignature() !== this.lastTabStripSignature) {
            this.renderTabStrip();
        }
    }

    /**
     * Busy dots + active tab + tab count: everything about the strip that the
     * run-state path can change. Titles are NOT in here -- they are repainted
     * by their own writers, which call renderTabStrip directly.
     */
    private tabStripSignature(): string {
        // USER 2026-07-26: the titles are part of what is painted, so they are
        // part of what "unchanged" means. Without them a caller that guards on
        // this signature would skip the repaint that shows a new intent line --
        // the strip would only catch up on the next unrelated change, which
        // reads as "the title appears when I switch tabs".
        return this.sessions.map((s, i) => `${s.isBusy ? '1' : '0'}${this.sessionTabTitle(s, i)}`).join('\u0000')
            + `|${this.activeSessionIndex}|${this.sessions.length}`;
    }

    /** What renderTabStrip last painted; kept in sync by renderTabStrip itself. */
    private lastTabStripSignature = '';

    /**
     * FIX-01-01-02: while a task runs, the loop holds THE reference to
     * this.conversationHistory and pushes into it. Reassigning the array
     * mid-task (load/clear/import/delete-active) decouples the running task
     * from what gets persisted: saves then freeze the api history mid-task
     * (orphaned tool_use tails) while onComplete pushes the final answer
     * into the NEW uiMessages array -- the divergence behind two documented
     * data-loss incidents. Conversation switches are therefore refused
     * until the task finishes or the user stops it.
     */
    private refuseWhileTaskRuns(): boolean {
        // GUARD-L1 (audit 2026-07-07): after Stop the controller is nulled
        // immediately, but the aborted loop keeps draining until its next
        // abort checkpoint (a running tool call or approval wait can hold it
        // for seconds to minutes) and then still fires onComplete. Switching
        // conversations inside that window would let the late onComplete
        // closure push the stopped task's text into the WRONG conversation,
        // so the guard also holds while a stopped task drains. A timeout
        // fallback keeps a wedged task from locking the user out forever.
        if (!this.currentAbortController && !this.taskDraining) return false;
        // FEAT-55-01 (user decision 2026-07-25): name the chat that is still
        // running so the user knows which tab to attend to. The guard fires on
        // the active session's own run/drain state, so that IS the running chat.
        const chatName = this.sessionTabTitle(this.activeSession, this.activeSessionIndex);
        new Notice(t('ui.sidebar.taskRunningNoSwitchNamed', { chat: chatName }), 6000);
        return true;
    }

    /** GUARD-L1: hold the switch guard while a stopped task drains.
     *
     *  History hardening phase D (R3): the session is CAPTURED -- the old
     *  timeout wrote through `this.` accessors and cleared whichever tab was
     *  active 30s later. And the timeout releases ONLY the switch guard:
     *  drainingController stays, because a legitimately slow drain (approval
     *  wait, long tool call) must keep its ownership token or its late
     *  onComplete skips the uiMessages push + save -- the exact loss class
     *  FIX-03-20-02 closed. */
    private beginTaskDraining(session: ChatSession = this.activeSession): void {
        session.taskDraining = true;
        if (session.taskDrainingTimer) window.clearTimeout(session.taskDrainingTimer);
        session.taskDrainingTimer = window.setTimeout(() => {
            session.taskDraining = false;
            session.taskDrainingTimer = 0;
        }, 30_000);
    }

    private endTaskDraining(session: ChatSession = this.activeSession): void {
        session.taskDraining = false;
        // Issue 3 Wave B: the drain is over, so the ownership token must not
        // linger and match a future run by identity accident.
        session.drainingController = null;
        if (session.taskDrainingTimer) {
            window.clearTimeout(session.taskDrainingTimer);
            session.taskDrainingTimer = 0;
        }
    }

    /**
     * Clear conversation history and chat UI (New Chat)
     */
    private clearConversation(opts: { skipNavPush?: boolean } = {}): void {
        if (this.refuseWhileTaskRuns()) return;
        // Save current conversation before clearing (if there is one)
        this.saveCurrentConversation();
        // Enqueue memory extraction (fire-and-forget, threshold-gated)
        this.enqueueMemoryExtraction();
        // Finalize outgoing conversation: semantic title + frontmatter links (ADR-022)
        // Capture messages before clearing -- finalizeConversation runs async
        if (this.activeConversationId) {
            const msgs = [...this.uiMessages];
            void this.finalizeConversation(this.activeConversationId, msgs);
        }
        this.activeConversationId = null;
        this.lazyConversationId.reset();
        // The session-held tab title belongs to the OUTGOING chat.
        this.activeSession.tabTitle = null; // FIX-03-20-01: fresh chat, fresh memo
        this.uiMessages = [];
        this.conversationHistory = [];
        this.userDismissedContext = false;
        // Issue #54.3: the model override is sticky (survives a fresh chat);
        // thinking + effort stay per-conversation and reset here.
        this.restoreChatModelOverride();
        this.chatThinkingOverride = DEFAULT_THINKING_OVERRIDE;
        this.chatEffortOverride = DEFAULT_EFFORT_OVERRIDE;
        this.updateModelButton();
        this.onboarding?.reset();
        this.attachments.clear();
        // Conversation reset drops any pending fullDocTexts too (FIX-19-28-05 audit).
        void this.attachments.consumeFullDocTexts();
        if (this.chatContainer) {
            this.chatContainer.empty();
        }
        this.showWelcomeMessage();
        this.updateContextBadge();
        this.historyPanel?.setActiveId(null);

        if (!opts.skipNavPush) {
            this.pushNav(null);
        } else {
            this.updateNavButtons();
        }
    }

    /**
     * FIX-03-20-01: create the conversation id as soon as the store allows.
     * Returns null while no store exists (nothing to save against).
     */
    private ensureConversationId(session: ChatSession = this.activeSession): Promise<string> | null {
        // FEAT-55-01 Phase C: operate on the run''s own session, so a save
        // triggered after a tab switch resolves/adopts the id on the right chat.
        return session.lazyConversationId.ensure(
            session.activeConversationId,
            this.plugin.conversationStore,
            () => {
                const mode = this.modeService.getActiveMode().slug;
                const modelKey = this.resolveEnabledModelKey(mode);
                const model = this.plugin.settings.activeModels.find((m) => getModelKey(m) === modelKey);
                return { mode, model: model?.displayName ?? model?.name ?? modelKey };
            },
            (id) => {
                // Only adopt the id if the session still has none -- the user
                // may have switched/loaded a conversation meanwhile.
                if (!session.activeConversationId) session.activeConversationId = id;
            },
        );
    }

    /** Save the current conversation to ConversationStore (non-blocking). */
    private saveCurrentConversation(session: ChatSession = this.activeSession): void {
        const store = this.plugin.conversationStore;
        if (!store || session.uiMessages.length === 0) return;
        // FIX-03-20-01: a send during boot may predate store init. Create
        // the id lazily now instead of silently skipping the save (this
        // was how a completed chat could vanish from history entirely).
        const ensured = this.ensureConversationId(session);
        if (!ensured) return;
        // AUDIT-2026-07-02 L-2 + FEAT-55-01 Phase C: snapshot BOTH arrays at
        // call time, from the SESSION the run belongs to (not this.activeSession,
        // which shifts on tab switch). Binds the payload to the right chat.
        const messagesSnapshot = [...session.uiMessages];
        const historySnapshot = [...session.conversationHistory];
        // History hardening phase C: a deliberate truncation (pencil edit,
        // checkpoint delete) flags the session; the flag travels as
        // allowShrink and is cleared once the shrink was actually written.
        const allowShrink = session.historyTruncated;
        ensured.then(async (convId) => {
            const { written } = await store.save(convId, historySnapshot, messagesSnapshot, { allowShrink });
            if (!written) {
                // Refused shrink: nothing landed on disk, so the search index
                // must not see this snapshot either (it would index content
                // that does not exist in the file).
                console.warn(`[History] save(${convId}) refused by shrink guard; snapshot not indexed`);
                return;
            }
            if (allowShrink) session.historyTruncated = false;
            // FEATURE-0320 Phase 6: re-index history_chunks after every save.
            void this.plugin.historyIndexer?.onConversationSaved(convId, messagesSnapshot);
        }).catch((e) => console.warn('[History] Save failed:', e));
    }

    /**
     * Post-processing hook: scan agent response for `- [ ]` items and show selection modal.
     * ADR-026: Fire-and-forget (void-prefixed), does not block onComplete.
     */
    private maybeExtractTasks(text: string): void {
        try {
            const items = scanTasks(text);
            if (items.length === 0) return;

            const sourceNote = this.app.workspace.getActiveFile()?.basename ?? '';
            const settings = this.plugin.settings.taskExtraction;

            const taskNotesActive = this.isTaskNotesActive();
            const useTaskNotes = taskNotesActive && (settings.preferTaskNotesPlugin ?? true);

            // Show recommendation if TaskNotes is not active and hint not dismissed
            if (!taskNotesActive && !(settings.taskNotesHintDismissed ?? false)) {
                this.showTaskNotesRecommendation();
            }

            new TaskSelectionModal(
                this.app,
                items,
                useTaskNotes,
                async (selected) => {
                    try {
                        const creator = useTaskNotes
                            ? new TaskNotesAdapter(this.app)
                            : new TaskNoteCreator(this.app, {
                                categoryProperty: this.plugin.settings.categoryProperty,
                                summaryProperty: this.plugin.settings.summaryProperty,
                                backlinksProperty: this.plugin.settings.backlinksProperty,
                            });
                        const created = await creator.createNotes(selected, settings, sourceNote);
                        if (created.length > 0) {
                            const format = useTaskNotes ? t('notice.taskNotesCreatedFormatSuffix') : '';
                            new Notice(t('notice.taskNotesCreated', { count: created.length, format }));
                        }
                    } catch (err) {
                        console.warn('[TaskExtraction] Failed to create task notes:', err);
                        new Notice(t('notice.taskNotesError'));
                    }
                },
            ).open();
        } catch (err) {
            console.error('[TaskExtraction] Scan failed:', err);
            new Notice(t('notice.taskExtractionError', { error: err instanceof Error ? err.message : String(err) }));
        }
    }

    /** Checks whether the TaskNotes community plugin is currently enabled */
    private isTaskNotesActive(): boolean {
        const plugins = (this.app as unknown as { plugins?: { enabledPlugins?: Set<string> } }).plugins;
        return plugins?.enabledPlugins?.has('tasknotes') ?? false;
    }

    /** Shows a non-blocking recommendation notice for the TaskNotes plugin */
    private showTaskNotesRecommendation(): void {
        const plugins = (this.app as unknown as { plugins?: { manifests?: Record<string, unknown> } }).plugins;
        const isInstalled = !!plugins?.manifests?.['tasknotes'];

        const message = isInstalled
            ? t('notice.taskNotes.hintDisabled')
            : t('notice.taskNotes.hintNotInstalled');

        const fragment = createFragment((frag) => {
            frag.createSpan({ text: message });
            const dismissLink = frag.createEl('a', {
                text: t('ui.sidebar.doNotShowAgain'),
                cls: 'agent-u-task-hint-dismiss',
            });
            dismissLink.addClass('agent-u-task-hint-dismiss-link');
            dismissLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.plugin.settings.taskExtraction = {
                    ...this.plugin.settings.taskExtraction,
                    taskNotesHintDismissed: true,
                };
                void this.plugin.saveSettings();
                notice.hide();
            });
        });
        const notice = new Notice(fragment, 12000);
    }

    /** Checks whether the Frontmatter Operator community plugin is currently enabled */
    private isFrontmatterOperatorActive(): boolean {
        const plugins = (this.app as unknown as { plugins?: { enabledPlugins?: Set<string> } }).plugins;
        return plugins?.enabledPlugins?.has('frontmatter-operator') ?? false;
    }

    /**
     * Non-blocking recommendation notice for the Frontmatter Operator plugin.
     * Fires at most once per sidebar-view session and never again after the
     * user clicks "Do not show again" (persisted via
     * settings.frontmatterOperatorHintDismissed). English UI language per
     * feedback_ui_language_and_naming.
     */
    private showFrontmatterOperatorRecommendation(): void {
        if (this.frontmatterOperatorHintShownThisSession) return;
        if (this.plugin.settings.frontmatterOperatorHintDismissed) return;
        if (this.isFrontmatterOperatorActive()) return;
        this.frontmatterOperatorHintShownThisSession = true;

        const plugins = (this.app as unknown as { plugins?: { manifests?: Record<string, unknown> } }).plugins;
        const isInstalled = !!plugins?.manifests?.['frontmatter-operator'];

        const message = isInstalled
            ? t('notice.frontmatterOperator.hintDisabled')
            : t('notice.frontmatterOperator.hintNotInstalled');

        const fragment = createFragment((frag) => {
            frag.createSpan({ text: message + ' ' });
            const dismissLink = frag.createEl('a', {
                text: t('ui.sidebar.doNotShowAgain'),
                cls: 'agent-u-task-hint-dismiss',
            });
            dismissLink.addClass('agent-u-task-hint-dismiss-link');
            dismissLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.plugin.settings.frontmatterOperatorHintDismissed = true;
                void this.plugin.saveSettings();
                notice.hide();
            });
        });
        const notice = new Notice(fragment, 12000);
    }

    /** Enqueue memory extraction if the conversation meets the threshold. Fire-and-forget. */
    private enqueueMemoryExtraction(session: ChatSession = this.activeSession): void {
        const mem = this.plugin.settings.memory;
        const queue = this.plugin.extractionQueue;
        if (!mem.enabled || !mem.autoExtractSessions || !queue) return;
        if (!session.activeConversationId) return;

        // Pinned conversations (already have facts in memory) get a
        // lower threshold of 1 -- the user explicitly opted into memory
        // for them, every new message is potentially relevant. Fresh
        // conversations still wait for the configured threshold so
        // smalltalk doesn't trigger an extraction.
        const isPinned = this.plugin.countMemoryFactsForConversation(session.activeConversationId) > 0;
        const threshold = isPinned ? 1 : mem.extractionThreshold;
        if (session.uiMessages.length < threshold) return;

        const snapshot = this.snapshotForMemory(session);
        if (!snapshot) return;
        queue.enqueue(snapshot).catch((e) => console.warn('[Memory] Enqueue failed:', e));
    }

    /**
     * Public snapshot of the active conversation in the shape ExtractionQueue
     * needs. Returns null when nothing is queueable. Used by the manual paths
     * (Star button, mark_for_memory tool) which always run regardless of the
     * autoExtractSessions toggle and the message-threshold.
     */
    snapshotForMemory(
        // FEAT-55-01: snapshot a SPECIFIC chat. onClose has to walk every open
        // tab, not just the visible one.
        session: ChatSession = this.activeSession,
    ): { conversationId: string; messages: Array<{ role: 'user' | 'assistant'; text: string }>; title: string; queuedAt: string } | null {
        if (!session.activeConversationId || session.uiMessages.length === 0) return null;
        const messages = session.uiMessages.map((m) => ({ role: m.role, text: m.text }));
        const title = session.uiMessages.find((m) => m.role === 'user')?.text.slice(0, 60).replace(/\n/g, ' ').trim()
            || t('ui.sidebar.conversation');
        return {
            conversationId: session.activeConversationId,
            messages,
            title,
            queuedAt: new Date().toISOString(),
        };
    }

    /**
     * Finalize a conversation on end (clear/switch/unload): generate semantic title,
     * stamp frontmatter links, clean up pending paths. (ADR-022)
     * Fire-and-forget caller — errors are caught internally.
     */
    /** Stamp a chat link into the currently active file's frontmatter. */
    private async stampChatLinkToActiveFile(conversationId: string, title: string): Promise<void> {
        const file = this.app.workspace.getActiveFile();
        if (!(file instanceof TFile) || file.extension !== 'md') {
            new Notice(t('ui.history.noActiveNote'));
            return;
        }
        const uri = `obsidian://vault-operator-chat?id=${encodeURIComponent(conversationId)}`;
        const link = `[${title}](${uri})`;
        try {
            await this.app.fileManager.processFrontMatter(file, (fm) => {
                // Side finding (2026-08-14): this wrote 'Chats' while the
                // automatic path (main.ts) writes 'chats'. Obsidian keeps the
                // original YAML key, so a note touched by both carried the
                // SAME link twice under two properties, and the duplicate
                // check never saw across the divide. 'chats' wins because it
                // is the key registered with metadataTypeManager as multitext.
                // Read both, fold the legacy key in, write only the canonical
                // one, so an existing 'Chats' is migrated on the next stamp.
                const legacy: string[] = Array.isArray(fm['Chats']) ? fm['Chats'] : [];
                const current: string[] = Array.isArray(fm['chats']) ? fm['chats'] : [];
                const links: string[] = [...current];
                for (const l of legacy) if (!links.includes(l)) links.push(l);

                if (links.some((l: string) => l.includes(conversationId))) {
                    // Still migrate the key even when the link is already there.
                    if (legacy.length > 0) {
                        fm['chats'] = links;
                        delete fm['Chats'];
                    }
                    new Notice(t('ui.history.linkAlreadyExists'));
                    return;
                }
                links.push(link);
                fm['chats'] = links;
                if (legacy.length > 0) delete fm['Chats'];
            });
            new Notice(t('ui.history.linkAdded'));
        } catch (e) {
            console.warn('[ChatLink] Failed to stamp active file:', e);
            new Notice(t('ui.history.linkAddFailed'));
        }
    }

    /**
     * Finalize a conversation: generate semantic title, stamp frontmatter links.
     * Messages are passed in because this.uiMessages may already be cleared when this runs.
     */
    /**
     * Generate a semantic conversation title, once. Idempotent: skips if the
     * user renamed it (titleSource 'user') or an auto-title already exists
     * (titleSource 'auto'). Marks the result 'auto' so it is generated exactly
     * once and a later finalize does not re-run the model. Callable both at
     * task end (so the tab gets a name immediately, not only when the
     * conversation is closed) and from finalizeConversation.
     */
    private async maybeGenerateSemanticTitle(
        conversationId: string,
        messages: Array<{ role: string; text: string }>,
    ): Promise<void> {
        const store = this.plugin.conversationStore;
        if (!store) return;

        const meta = store.list().find((c) => c.id === conversationId);
        // Already has a deliberate title (auto or user) -> leave it.
        if (meta && (meta.titleSource === 'auto' || meta.titleSource === 'user')) return;

        // FEAT-24-08 Welle A: resolver falls back to active-provider fast-tier
        // when no explicit key is set, so titling stays alive after the EPIC-26
        // migration to provider-only config.
        const model = this.plugin.getTitlingModel();
        if (!model) return;

        const userMsg = messages.find((m) => m.role === 'user')?.text ?? '';
        const assistantMsg = messages.find((m) => m.role === 'assistant')?.text ?? '';
        if (!userMsg) return;

        try {
            const api = buildApiHandlerForModel(model);
            // FIX-24-05-09 (D10): once per conversation, on the titling model,
            // and never reported. Deliberately NOT folded into the task that
            // just finished: this call happens after that run's final usage
            // report, so adding it there would rewrite a number the user has
            // already seen. It goes to the ledger instead.
            const stream = runMeteredCall(api, 'chat-title', {
                systemPrompt: 'Create a very short title (1 to 3 words, a crisp keyword label) '
                    + 'for this conversation. Capture the essence, do not summarize. '
                    + 'Output ONLY the title. No quotes, no prefix, no explanation. '
                    + 'Same language as the user.',
                messages: [{ role: 'user', content: `User: ${userMsg.slice(0, 300)}\nAssistant: ${assistantMsg.slice(0, 300)}` }],
            });
            let title = '';
            for await (const chunk of stream) {
                if (chunk.type === 'text') title += chunk.text;
            }
            title = title.trim().replace(/^["']|["']$/g, '').replace(/\n.*/s, '');
            if (title.length > 60) title = title.slice(0, 57) + '...';
            if (title) {
                console.debug(`[ChatLink] Semantic title: "${title}"`);
                await store.updateMeta(conversationId, { title, titleSource: 'auto' });
                this.historyPanel?.refresh();
                // FEAT-55-01: the semantic title lands asynchronously, long after
                // the last tab-strip render, so repaint the strip -- otherwise the
                // tab keeps showing the first-user-message fallback.
                this.renderTabStrip();
            }
        } catch (e) {
            console.warn('[ChatLink] Semantic title generation failed (non-fatal):', e);
        }
    }

    private async finalizeConversation(
        conversationId: string,
        messages: Array<{ role: string; text: string }>,
    ): Promise<void> {
        const settings = this.plugin.settings;
        const store = this.plugin.conversationStore;
        if (!store) return;

        // 1. Semantic titling (once, if model resolvable). Usually already done
        // at task end; this covers conversations that ended before a task
        // completed a full turn.
        await this.maybeGenerateSemanticTitle(conversationId, messages);

        // 2. Stamp frontmatter links with final title
        if (settings.chatLinking?.enabled) {
            await this.plugin.flushPendingChatLinks(conversationId);
            this.plugin.clearPendingChatLinks(conversationId);
        }

        this.historyPanel?.refresh();
    }

    /** Public entry point for deep-link protocol handler (ADR-022, FEATURE-300). */
    loadConversationById(id: string): Promise<void> {
        return this.openConversationInTab(id);
    }

    /**
     * FEAT-55-01: open a conversation in a tab, browser-tab style. History
     * clicks and deep-links route through here so each conversation lands in
     * its OWN tab instead of clobbering whatever tab is active.
     *
     * Live bug 2026-07-25: loadConversation() has no session routing -- it
     * always overwrites this.activeSession. With two tabs open, clicking
     * either History row loaded that conversation into the active tab, so
     * both rows appeared to point at the same (latest) chat. This entry point
     * fixes that by choosing the right tab first, then loading in-place:
     *   1. already open in some tab  -> switch to it (no reload, no clobber)
     *   2. active tab is pristine    -> reuse it (empty + idle + no id)
     *   3. otherwise                 -> open a fresh tab and load there
     */
    async openConversationInTab(id: string): Promise<void> {
        // (1) Already open somewhere -> just surface that tab.
        const openIdx = this.sessions.findIndex((s) => s.activeConversationId === id);
        if (openIdx >= 0) {
            this.switchToSession(openIdx);
            return;
        }
        // (2) Reuse a pristine active tab (fresh, idle, nothing to lose);
        // (3) else open a new tab. Either way loadConversation then fills the
        // now-active tab, which is exactly the one we want it to write into.
        const active = this.activeSession;
        const pristine = !active.activeConversationId
            && active.uiMessages.length === 0
            && !active.isBusy
            && !active.taskDraining;
        if (!pristine) this.openInViewTab();
        await this.loadConversation(id);
    }

    /**
     * Push the next conversation onto the nav stack and truncate forward
     * history -- standard browser semantics. Called from loadConversation
     * for "fresh" navigations (deep-links, history-panel clicks); skipped
     * when the navigation itself comes from the back/forward arrows.
     */
    private pushNav(id: string | null): void {
        // Drop any "forward" entries beyond the current cursor.
        if (this.navIndex < this.navStack.length - 1) {
            this.navStack = this.navStack.slice(0, this.navIndex + 1);
        }
        // Don't stack consecutive duplicates (e.g. re-loading the same chat).
        const top = this.navStack[this.navStack.length - 1];
        if (top !== id) {
            this.navStack.push(id);
            this.navIndex = this.navStack.length - 1;
        }
        // Soft cap at 50 entries so a long session doesn't grow unbounded.
        if (this.navStack.length > 50) {
            const overflow = this.navStack.length - 50;
            this.navStack = this.navStack.slice(overflow);
            this.navIndex = Math.max(0, this.navIndex - overflow);
        }
        this.updateNavButtons();
    }

    private async navBack(): Promise<void> {
        if (this.navIndex <= 0) return;
        this.navIndex -= 1;
        const target = this.navStack[this.navIndex];
        await this.loadConversation(target ?? null, { skipNavPush: true });
    }

    private async navForward(): Promise<void> {
        if (this.navIndex >= this.navStack.length - 1) return;
        this.navIndex += 1;
        const target = this.navStack[this.navIndex];
        await this.loadConversation(target ?? null, { skipNavPush: true });
    }

    private updateNavButtons(): void {
        if (this.navBackBtn) {
            const canBack = this.navIndex > 0;
            this.navBackBtn.disabled = !canBack;
            this.navBackBtn.classList.toggle('agent-u-hidden', this.navStack.length < 2);
        }
        if (this.navForwardBtn) {
            const canForward = this.navIndex < this.navStack.length - 1;
            this.navForwardBtn.disabled = !canForward;
            this.navForwardBtn.classList.toggle('agent-u-hidden', this.navStack.length < 2);
        }
    }

    /** Load a conversation from history and restore it in the chat panel. */
    private async loadConversation(
        id: string | null,
        opts: { skipNavPush?: boolean } = {},
    ): Promise<void> {
        if (id === null) {
            // Back-arrow target was an "empty chat" sentinel -- clear without
            // re-pushing it onto the stack. clearConversation reads navStack
            // state via the same skipNavPush flag.
            this.clearConversation({ skipNavPush: true });
            return;
        }
        if (this.refuseWhileTaskRuns()) return; // FIX-01-01-02
        const store = this.plugin.conversationStore;
        if (!store) return;

        const data = await store.load(id);
        if (!data) {
            // Live bug 2026-07-25: the store index lists this id but its file
            // is missing/corrupt -- the task was interrupted around the first
            // save. Before failing, try the interrupted-task snapshot for this
            // id so the user can still resume (what the boot notice / History
            // click is really after) instead of dead-ending here.
            const offered = await this.tryOfferResumeForMissingConversation(id);
            if (!offered) new Notice(t('notice.loadConversationFailed'));
            return;
        }
        // DELTA-0707B-L1: re-check after the await -- a task started from
        // the composer while the file was loading would otherwise get its
        // history arrays swapped mid-run (the exact decoupling this guard
        // exists to prevent). The loaded data is simply discarded.
        if (this.refuseWhileTaskRuns()) return;

        // Save current conversation before switching
        this.saveCurrentConversation();
        // Finalize outgoing conversation: semantic title + frontmatter links (ADR-022)
        // Capture messages before switching -- finalizeConversation runs async
        if (this.activeConversationId) {
            const msgs = [...this.uiMessages];
            void this.finalizeConversation(this.activeConversationId, msgs);
        }

        // Reset state
        // Phase A2 (history hardening): a crash-/onClose-save can leave the
        // stored API history ending in an open tool_use tail (question card
        // pending, run mid-tools). Sending that verbatim 400s at the API, so
        // sanitize on load -- same helper the drain-fork uses. uiMessages are
        // untouched (display only).
        this.conversationHistory = sanitizeHistoryForApi(
            JSON.parse(JSON.stringify(data.messages)) as MessageParam[],
        ).history;
        // FIX-03-20-02 rescue: conversations saved while the drain-owner gate
        // was broken carry the full API history but only the user prompts in
        // uiMessages -- reconstruct the missing assistant answers for display.
        // No-op for healthy conversations; the repaired trace persists with
        // the next regular save.
        const repairedUi = repairUiMessages(data.messages, data.uiMessages);
        this.uiMessages = repairedUi;
        this.activeConversationId = id;
        this.lazyConversationId.reset();
        // The session-held tab title belongs to the OUTGOING chat.
        this.activeSession.tabTitle = null; // FIX-03-20-01: drop any in-flight create
        this.userDismissedContext = false;
        this.attachments.clear();
        // Conversation switch drops any pending fullDocTexts too (FIX-19-28-05 audit).
        void this.attachments.consumeFullDocTexts();

        // Re-render chat. Collect (uiMessage, DOM) pairs so the checkpoint
        // rehydrate step below can attach live markers per assistant turn.
        const assistantPairs: { msg: UiMessage; el: HTMLElement }[] = [];
        if (this.chatContainer) {
            this.chatContainer.empty();
            // Phase A1 (history hardening): render the REPAIRED list. The
            // first rescue deploy assigned repairUiMessages to the session but
            // kept rendering data.uiMessages -- reconstructed answers stayed
            // invisible and DOM<->array indices diverged for the checkpoint
            // delete path.
            for (const msg of repairedUi) {
                if (msg.role === 'user') {
                    this.addUserMessage(msg.text);
                } else {
                    const el = this.renderMarkdownMessage(msg.text, 'assistant', msg.toolStepsHtml, msg.reasoningText, msg.usageFooter);
                    if (el) assistantPairs.push({ msg, el });
                }
            }
        }
        this.historyPanel?.setActiveId(id);
        this.updateContextBadge();

        // FIX-01-07-02 / FIX-44-12: rebuild checkpoint markers inline at the
        // assistant message they belong to. Markers never survive into
        // toolStepsHtml (they render as siblings of the steps block), so this
        // step re-renders them from UiMessage.checkpoints (verified live, or
        // expired) with the legacy shadow-repo scan as fallback for older
        // conversations.
        void this.rehydrateCheckpointMarkers(assistantPairs);

        if (!opts.skipNavPush) {
            this.pushNav(id);
        } else {
            this.updateNavButtons();
        }

        // FEAT-55-06: read-only cross-session topic awareness. Offer earlier
        // conversations on the same topic so the user can pick up prior work.
        this.maybeOfferRelatedConversations(id);

        // FEAT-55-01 (user decision 2026-07-25): if THIS conversation has an
        // interrupted-task snapshot, offer resume HERE, inside the concrete
        // chat opened from History -- not as a banner in a new/empty chat.
        void this.maybeOfferInflightResume(id);
    }

    /**
     * FEAT-55-06 (EPIC-55): surface earlier conversations that share this
     * chat's topic, as a dismissible read-only suggestion. Never mutates any
     * conversation and never injects into a running loop -- it only offers a
     * one-click jump. Uses the local title-overlap ranker (no embeddings /
     * no API); a later iteration can swap in the semantic index.
     */
    private maybeOfferRelatedConversations(currentId: string): void {
        try {
            if (!this.chatContainer) return;
            const store = this.plugin.conversationStore;
            if (!store) return;
            const meta = store.list().find((c) => c.id === currentId);
            if (!meta?.title) return;
            const related = findRelatedConversations(meta.title, store.list(), { currentId, limit: 3 });
            if (related.length === 0) return;

            const row = this.chatContainer.createDiv('related-conversations-row');
            const label = row.createSpan('related-conversations-label');
            setIcon(label.createSpan('related-conversations-icon'), 'link');
            label.appendText(t('ui.related.prompt'));
            for (const rc of related) {
                const btn = row.createEl('button', {
                    cls: 'related-conversations-item',
                    text: rc.title,
                });
                btn.addEventListener('click', () => {
                    row.remove();
                    // FEAT-55-01: open the related conversation in its own tab
                    // (or switch if already open) rather than clobbering this one.
                    void this.openConversationInTab(rc.id);
                });
            }
            const dismiss = row.createEl('button', {
                cls: 'related-conversations-dismiss',
                text: t('ui.related.dismiss'),
            });
            dismiss.addEventListener('click', () => { row.remove(); });
        } catch (e) {
            console.debug('[Related] suggestion failed (non-fatal):', e);
        }
    }

    /**
     * FEAT-33-12: live probe for the InlineToSidebarTransferService.
     * Returns true while a request is in flight (stream + tool loop).
     * Used by the inline-chat "Send to sidebar" button to decide
     * between save-and-foreground (idle) and the busy fallback modal.
     */
    public get isBusy(): boolean {
        return this.currentAbortController !== null;
    }

    /**
     * FEAT-33-12: take over a conversation that was started in the inline
     * chat. Mirrors the read-side of loadConversation() but takes the
     * state directly instead of pulling it from disk -- the inline panel
     * has the live MessageParam[] + UiMessage[] already in memory.
     *
     * Contract:
     *   - The caller (InlineToSidebarTransferService) is responsible for
     *     gating on isBusy. importConversation does NOT abort an in-flight
     *     turn; calling it mid-stream is undefined.
     *   - The outgoing sidebar conversation (if any) is saved + finalized
     *     just like a History click would do.
     *   - After import the composer is focused so the user can keep typing.
     */
    // eslint-disable-next-line @typescript-eslint/require-await -- public transfer API keeps its Promise signature for callers; the body is synchronous by design
    public async importConversation(state: {
        conversationId: string | null;
        history: MessageParam[];
        uiMessages: UiMessage[];
    }): Promise<boolean> {
        // GUARD-I1: a refusal must be distinguishable from success -- the
        // inline-transfer caller closes its panel on ok.
        if (this.refuseWhileTaskRuns()) return false; // FIX-01-01-02
        // Save current conversation before switching (same as loadConversation).
        this.saveCurrentConversation();
        if (this.activeConversationId) {
            const msgs = [...this.uiMessages];
            void this.finalizeConversation(this.activeConversationId, msgs);
        }

        // Reset state to the transferred conversation.
        this.conversationHistory = [...state.history];
        this.uiMessages = [...state.uiMessages];
        this.activeConversationId = state.conversationId;
        this.lazyConversationId.reset();
        // The session-held tab title belongs to the OUTGOING chat.
        this.activeSession.tabTitle = null; // FIX-03-20-01: drop any in-flight create
        this.userDismissedContext = false;
        this.attachments.clear();
        void this.attachments.consumeFullDocTexts();

        // Re-render chat exactly like loadConversation.
        const assistantPairs: { msg: UiMessage; el: HTMLElement }[] = [];
        if (this.chatContainer) {
            this.chatContainer.empty();
            for (const msg of state.uiMessages) {
                if (msg.role === 'user') {
                    this.addUserMessage(msg.text);
                } else {
                    const el = this.renderMarkdownMessage(msg.text, 'assistant', msg.toolStepsHtml, msg.reasoningText, msg.usageFooter);
                    if (el) assistantPairs.push({ msg, el });
                }
            }
        }
        this.historyPanel?.setActiveId(state.conversationId);
        this.updateContextBadge();
        void this.rehydrateCheckpointMarkers(assistantPairs);

        if (state.conversationId !== null) this.pushNav(state.conversationId);
        try { this.textarea?.focus(); } catch { /* noop in test stubs */ }
        return true;
    }

    /**
     * User feedback 2026-06-24: editor-menu + Ctrl+i+i hotkey hand the
     * current editor selection to the sidebar chat instead of opening
     * the inline panel. We prepend a <context>...</context> block (same
     * shape the inline panel uses on its first turn) so the LLM sees a
     * consistent boundary, then place the cursor below the block so the
     * user can type their question immediately.
     *
     * Idempotent: re-invoking with the same (text, notePath) does not
     * double-insert the block, it just refocuses the composer.
     */
    public prepopulateComposerWithContext(args: { text: string; notePath: string }): void {
        const trimmed = args.text.trim();
        if (trimmed.length === 0) return;
        if (this.textarea === null) return;
        const block = `<context>Selected text (from note: ${args.notePath}): ${trimmed}</context>\n\n`;
        const existing = this.textarea.value;
        if (!existing.startsWith(block)) {
            this.textarea.value = block + existing;
            this.autoResizeTextarea();
            this.refreshRunStateButtons();
        }
        const caret = this.textarea.value.length;
        this.textarea.selectionStart = caret;
        this.textarea.selectionEnd = caret;
        try { this.textarea.focus(); } catch { /* noop in test stubs */ }
    }

    /** Delete a conversation from history. */
    private async deleteConversation(id: string): Promise<void> {
        // FIX-01-01-02: deleting the ACTIVE conversation mid-task would
        // reassign the shared history arrays under the running loop.
        if (this.activeConversationId === id && this.refuseWhileTaskRuns()) return;
        const store = this.plugin.conversationStore;
        if (!store) return;
        // Cascade: remove derived memory artefacts (facts, session summary,
        // thread-delta) before the conversation file itself is gone, so the
        // user expectation "delete the chat = delete its memory" holds.
        await this.plugin.deleteMemoryForConversationCascade(id).catch((e) =>
            console.warn('[Memory] cascade delete failed (non-fatal):', e),
        );
        await store.delete(id);
        // If the deleted conversation is the active one, clear the chat
        if (this.activeConversationId === id) {
            // DELTA-0707B-L1: re-check after the awaits above. If a task
            // started meanwhile, keep the in-memory arrays under the running
            // loop; its next save recreates the conversation file.
            if (this.refuseWhileTaskRuns()) return;
            this.activeConversationId = null;
            this.lazyConversationId.reset();
            this.activeSession.tabTitle = null;
        // The session-held tab title belongs to the OUTGOING chat.
        this.activeSession.tabTitle = null; // FIX-03-20-01: fresh chat, fresh memo
            this.uiMessages = [];
            this.conversationHistory = [];
            if (this.chatContainer) {
                this.chatContainer.empty();
            }
            this.showWelcomeMessage();
        }
        this.historyPanel?.refresh();
    }

    /**
     * Create the streaming message container.
     * Structure: thinkingEl → toolsEl → contentEl → footerEl
     */
    private createStreamingMessageEl(container?: HTMLElement | null): {
        messageEl: HTMLElement;
        thinkingEl: HTMLElement;
        toolsEl: HTMLElement;
        contentEl: HTMLElement;
        footerEl: HTMLElement;
    } {
        // FEAT-55-01 (Fix 2): a run passes its own session's container so a
        // mid-await tab switch cannot stream into the newly active tab. Other
        // callers fall back to the visible chat container.
        const target = container ?? this.chatContainer;
        if (!target) throw new Error('Chat container not initialized');
        const messageEl = target.createDiv('message assistant-message message-streaming');
        // Reasoning/thinking section (hidden until thinking chunks arrive)
        const thinkingEl = messageEl.createDiv('thinking-block');
        thinkingEl.classList.add('agent-u-hidden');
        // Tool calls area (populated by onToolStart)
        const toolsEl = messageEl.createDiv('message-tools');
        // Text response (streamed directly for Q&A, rendered on complete for agentic)
        const contentEl = messageEl.createDiv('message-content');
        // v2.10.4: also flag the content element so CSS can suppress the
        // streaming-cursor ::after without using :has(.message-loading)
        // (review-bot warns about :has() invalidation cost).
        contentEl.classList.add('has-loading');
        // Show a loading indicator immediately so the user sees something right away
        const loadingEl = contentEl.createDiv('message-loading');
        setIcon(loadingEl.createSpan('message-loading-icon'), 'loader');
        loadingEl.createSpan('message-loading-text').setText(t('ui.sidebar.working'));
        // Token usage + timestamp footer
        const footerEl = messageEl.createDiv('message-footer');
        footerEl.classList.add('agent-u-hidden');
        target.scrollTo({ top: target.scrollHeight });
        return { messageEl, thinkingEl, toolsEl, contentEl, footerEl };
    }

    /**
     * Feature 5: Map API error to a friendly title
     */
    private getErrorTitle(error: Error): string {
        const msg = error.message.toLowerCase();
        const status = (error as Error & { status?: number; statusCode?: number }).status ?? (error as Error & { statusCode?: number }).statusCode;
        // FIX-54-11: a scope/model-access 401 is NOT an invalid key. OpenAI
        // project keys with model restrictions answer "You have insufficient
        // permissions for this operation." while the key itself is valid;
        // sending the user to re-check the key wastes their time.
        if (isInsufficientPermissionsAuthError(error.message, status)) {
            return t('ui.error.insufficientPermissions');
        }
        if (status === 401 || msg.includes('api key') || msg.includes('authentication')) {
            return t('ui.error.invalidKey');
        }
        if (status === 404 || msg.includes('not found')) {
            return t('ui.error.modelNotFound');
        }
        if (status === 429 || msg.includes('rate limit')) {
            return t('ui.error.rateLimit');
        }
        if (status === 529 || msg.includes('overload')) {
            return t('ui.error.overloaded');
        }
        if (msg.includes('network') || msg.includes('fetch') || msg.includes('econnrefused')) {
            return t('ui.error.network');
        }
        return t('ui.error.generic');
    }

    /**
     * Feature 2: Render markdown into a new assistant message (for static messages)
     */
    private renderMarkdownMessage(
        markdown: string,
        role: 'assistant' | 'user',
        toolStepsHtml?: string,
        reasoningText?: string,
        usageFooter?: string,
    ): HTMLElement | null {
        if (!this.chatContainer) return null;
        const msgEl = this.chatContainer.createDiv(`message ${role}-message`);
        // FIX-04-03-07: re-inject captured reasoning text as a collapsed
        // "Reasoning..." bubble (same class names + behavior as the live
        // stream block so the existing CSS applies). Above tool steps and
        // markdown content -- mirrors the order the model produced.
        if (role === 'assistant' && reasoningText && reasoningText.length > 0) {
            const thinkingEl = msgEl.createDiv('thinking-block');
            const header = thinkingEl.createDiv('thinking-header');
            setIcon(header.createSpan('thinking-spinner'), 'chevron-right');
            header.createSpan('thinking-label').setText(t('ui.sidebar.reasoningCollapsed'));
            const body = thinkingEl.createDiv('thinking-content');
            body.classList.add('agent-u-hidden');
            body.setText(reasoningText);
            header.addEventListener('click', () => {
                body.classList.toggle('agent-u-hidden');
            });
        }
        // Re-inject the collapsed agent steps block above the markdown so
        // the user can still expand "what did the agent do?" after a chat
        // reload. Parsed via DOMPurify (AUDIT-034 M-4) so persisted HTML
        // cannot smuggle script / iframe / event handlers / javascript:
        // URLs into the live renderer if the conversation JSON was tampered
        // with on disk.
        if (role === 'assistant' && toolStepsHtml) {
            const toolsEl = msgEl.createDiv('message-tools');
            try {
                const fragment = DOMPurify.sanitize(toolStepsHtml, TOOL_STEPS_SANITIZE_CONFIG);
                // RETURN_DOM_FRAGMENT yields a DocumentFragment whose first
                // element is the sanitized <details> root from stepsBlockEl.
                // Import it into the live document before append so the node
                // is owned by the right document.
                const root = fragment.firstElementChild;
                if (root) {
                    toolsEl.appendChild(activeDocument.importNode(root, true));
                    // Always start collapsed on rehydration so the chat
                    // doesn't visually explode when an old turn is reopened.
                    toolsEl.querySelectorAll('details').forEach((d) => {
                        if (d != null && d.instanceOf(HTMLDetailsElement)) d.open = false;
                    });
                }
            } catch (e) {
                console.warn('[AgentSidebar] Failed to rehydrate tool steps block:', e);
            }
        }
        const contentEl = msgEl.createDiv('message-content');
        void this.renderMarkdownAndWire(markdown, contentEl);
        // Restore the persisted usage/cost line. Placed between content and
        // the action bar, matching the live-stream scaffold order.
        if (role === 'assistant' && usageFooter) {
            msgEl.createDiv('message-footer').setText(usageFooter);
        }
        // Restore action buttons for history messages
        if (role === 'assistant') {
            this.addResponseActions(msgEl, markdown);
        } else {
            this.addUserMessageActions(msgEl, markdown);
        }
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
        return msgEl;
    }

    /**
     * FEAT-24-08 / ADR-114 Steering-Hook: render a mid-run user correction
     * as a distinct bubble. Three lifecycle states tracked via CSS classes:
     *
     *   - `steering-pending`    queued, waiting for next iteration
     *   - `steering-delivered`  picked up by AgentTask at iteration N
     *   - `steering-discarded`  task ended (Stop or completion) before drain
     *
     * Returns the bubble element so the queue can update its state later.
     */
    private addSteeringMessage(text: string): HTMLElement {
        const msgEl = this.chatContainer!.createDiv('message user-message chat-message-steering steering-pending');
        // Marker row above the content: small arrow icon + "Steering" label
        const markerRow = msgEl.createDiv('steering-marker');
        setIcon(markerRow.createSpan('steering-marker-icon'), 'corner-down-right');
        markerRow.createSpan('steering-marker-label').setText(t('ui.sidebar.steeringLabel'));
        // Bubble content
        msgEl.createDiv('message-content').setText(text);
        // Status footer (pending now, will be replaced on delivery / discard)
        const footer = msgEl.createDiv('steering-footer');
        setIcon(footer.createSpan('steering-footer-icon'), 'clock');
        footer.createSpan('steering-footer-text').setText(t('ui.sidebar.steeringQueued'));
        this.chatContainer!.scrollTop = this.chatContainer!.scrollHeight;
        return msgEl;
    }

    /**
     * Flip a steering bubble to "delivered" state once AgentTask has
     * consumed it. Updates icon (clock -> check) and footer label
     * ("queued" -> "delivered at iteration N").
     */
    private markSteeringDelivered(bubbleEl: HTMLElement, iteration: number): void {
        bubbleEl.classList.remove('steering-pending');
        bubbleEl.classList.add('steering-delivered');
        const footer = bubbleEl.querySelector<HTMLElement>('.steering-footer');
        if (!footer) return;
        footer.empty();
        setIcon(footer.createSpan('steering-footer-icon'), 'check');
        footer.createSpan('steering-footer-text').setText(
            t('ui.sidebar.steeringDelivered', { iteration: String(iteration) }),
        );
    }

    /**
     * Flip a steering bubble to "discarded" state when the task ended
     * (Stop or natural completion) before the queue entry was drained.
     * Updates icon (clock -> x) and footer label ("queued" -> "not delivered").
     */
    private markSteeringDiscarded(bubbleEl: HTMLElement): void {
        bubbleEl.classList.remove('steering-pending');
        bubbleEl.classList.add('steering-discarded');
        const footer = bubbleEl.querySelector<HTMLElement>('.steering-footer');
        if (!footer) return;
        footer.empty();
        setIcon(footer.createSpan('steering-footer-icon'), 'x');
        footer.createSpan('steering-footer-text').setText(t('ui.sidebar.steeringDiscarded'));
    }

    private addUserMessage(
        text: string,
        attachments: AttachmentItem[] = [],
        activeFile?: TFile | null,
        // FEAT-55-01 (Fix 2): render into an explicit container when a run has
        // pinned its own session's container. Falls back to the active one for
        // callers that render into the visible chat (History reload, Q&A answer).
        container?: HTMLElement | null,
    ): void {
        const target = container ?? this.chatContainer;
        if (!target) return;
        const msgEl = target.createDiv('message user-message');
        // Render attachment previews above the text bubble
        const hasAttachments = attachments.length > 0 || !!activeFile;
        if (hasAttachments) {
            const previewRow = msgEl.createDiv('message-attachment-previews');
            // "Current" chip for the auto-injected active file
            if (activeFile) {
                const chip = previewRow.createDiv('message-attachment-chip');
                setIcon(chip.createSpan('attachment-chip-icon'), 'file-text');
                chip.createSpan('attachment-chip-name').setText(activeFile.basename);
                chip.createSpan('attachment-current-badge').setText(t('ui.sidebar.currentFile'));
            }
            for (const att of attachments) {
                const chip = previewRow.createDiv('message-attachment-chip');
                if (att.objectUrl) {
                    const img = chip.createEl('img', { cls: 'attachment-chip-thumb' });
                    img.src = att.objectUrl;
                    img.alt = att.name;
                } else if (att.folderMeta) {
                    // FEAT-02-11: folder-manifest chip.
                    const icon = att.folderMeta.recursive ? 'folder-tree' : 'folder';
                    setIcon(chip.createSpan('attachment-chip-icon'), icon);
                    const label = `${att.folderMeta.path || att.name}/ (${att.folderMeta.fileCount})`;
                    chip.createSpan('attachment-chip-name').setText(label);
                } else {
                    setIcon(chip.createSpan('attachment-chip-icon'), 'file-text');
                    chip.createSpan('attachment-chip-name').setText(att.name);
                }
            }
        }
        if (text) {
            // FIX-19-07-01: render the user message as Markdown (same pass as
            // assistant bubbles) instead of setText(). setText() collapsed
            // blank lines, paragraphs, bold and headings into one run, losing
            // the structure the user typed. The RAW text is still what gets
            // copied, edited/resent and persisted (addUserMessageActions and
            // uiMessages both keep `text`), so only the DISPLAY gains structure;
            // the prompt sent to the agent is unchanged.
            const contentEl = msgEl.createDiv('message-content');
            void this.renderMarkdownAndWire(text, contentEl);
        }
        // Action bar: copy + edit/resend
        this.addUserMessageActions(msgEl, text);
        target.scrollTop = target.scrollHeight;
        // The scrollTop write fires a scroll event only when the position
        // actually changes; a not-yet-overflowing chat stays silent, so the
        // bar state is recomputed explicitly for the new question.
        this.schedulePinnedQuestionUpdate();
    }

    /** Add copy and edit+resend action buttons below a user message bubble. */
    private addUserMessageActions(msgEl: HTMLElement, text: string): void {
        const bar = msgEl.createDiv('user-message-actions');
        const makeBtn = (icon: string, tooltip: string, onClick: () => void) => {
            const btn = bar.createEl('button', { cls: 'message-action-btn', attr: { 'aria-label': tooltip } });
            setIcon(btn, icon);
            btn.title = tooltip;
            btn.addEventListener('click', onClick);
        };

        // Copy message text
        makeBtn('copy', t('ui.sidebar.copy'), () => {
            void navigator.clipboard.writeText(text);
            new Notice(t('notice.copied'));
        });

        // Edit and resend: put text back in textarea, remove this message + all following
        makeBtn('pencil', t('ui.sidebar.editResend'), () => {
            if (!this.textarea || !this.chatContainer) return;
            // History hardening phase D (FIX-03-20-03): editing mid-run used
            // to splice the LIVE arrays the running task appends to.
            if (this.refuseWhileTaskRuns()) return;
            this.textarea.value = text;
            this.autoResizeTextarea();
            this.textarea.focus();
            const allMessages = Array.from(this.chatContainer.querySelectorAll('.message'));
            const idx = allMessages.indexOf(msgEl);
            if (idx < 0) return;
            const userBubblesBefore = allMessages.slice(0, idx).filter(el => el.classList.contains('user-message')).length;
            // Compute the cut BEFORE touching the DOM: the old inline logic
            // counted every role==='user' history entry (tool_result batches
            // included) and cut finished turns at the first tool_result. The
            // pure helper anchors on real user text messages and refuses when
            // DOM and arrays disagree -- then nothing is removed, which beats
            // a silently corrupted conversation.
            const cut = computeEditResendCut(this.conversationHistory, this.uiMessages, userBubblesBefore);
            if (!cut) {
                new Notice(t('notice.editResendMisaligned'));
                return;
            }
            for (let i = allMessages.length - 1; i >= idx; i--) {
                allMessages[i].remove();
            }
            this.uiMessages.splice(cut.uiCutIndex);
            this.conversationHistory.splice(cut.historyCutIndex);
            // Deliberate truncation: flag it so the store's shrink guard lets
            // the very next save through, and persist immediately instead of
            // waiting for a coincidental later save.
            this.activeSession.historyTruncated = true;
            this.saveCurrentConversation();
        });
    }

    private addAssistantMessage(markdown: string): void {
        this.renderMarkdownMessage(markdown, 'assistant');
    }

    private switchMode(modeSlug: string): void {
        this.modeService.switchMode(modeSlug);
        this.updateModelButton(); // model may differ per agent
    }



    // ── Chat options popover (FEAT-02-12) ─────────────────────────────────────

    /**
     * Open the chat "..." options as a custom popover: real toggles for the
     * boolean settings (web search, add open note, auto-accept edits), then the
     * one-shot actions below. Replaces the old native Menu, whose booleans could
     * only render a checkmark, not a switch.
     */
    private showChatOptions(e: MouseEvent, anchor: HTMLElement): void {
        const settings = this.plugin.settings;
        this.chatOptionsPopover.show(anchor, this.containerEl, {
            toggles: [
                {
                    icon: 'globe',
                    label: t('ui.sidebar.webSearch'),
                    isOn: () => settings.webTools?.enabled ?? false,
                    // The switch value is the target state (audit I-1): only flip
                    // when it differs, so a stale popover cannot invert the intent.
                    onToggle: (v) => {
                        if ((settings.webTools?.enabled ?? false) !== v) void this.toggleWebSearch();
                    },
                },
                {
                    icon: 'file-text',
                    label: t('ui.menu.addOpenNote'),
                    isOn: () => settings.autoAddActiveFileContext,
                    onToggle: (v) => { void (async () => {
                        settings.autoAddActiveFileContext = v;
                        await this.plugin.saveSettings();
                        this.updateContextBadge();
                    })(); },
                },
                {
                    icon: 'pencil',
                    label: t('ui.menu.autoAcceptEdits'),
                    // FIX-44-03c: derive from the master too, so the switch cannot
                    // read "on" while every edit still prompts.
                    isOn: () => {
                        const cfg = settings.autoApproval;
                        return cfg.enabled && cfg.noteEdits && cfg.vaultChanges;
                    },
                    // The switch value is the target state (audit I-1), not a
                    // re-derivation from settings that may have moved meanwhile.
                    onToggle: (v) => { void (async () => {
                        const cfg = settings.autoApproval;
                        const flags = cfg as unknown as Record<string, unknown>;
                        if (v) {
                            // Turning on: flip the master (clearing dormant flags,
                            // FIX-44-03b) and grant both edit categories.
                            grantAutoApproval(flags, 'noteEdits');
                            flags.vaultChanges = true;
                        } else {
                            // Turning off: drop just these two; leave the master
                            // and any other grants as they are.
                            flags.noteEdits = false;
                            flags.vaultChanges = false;
                        }
                        await this.plugin.saveSettings();
                        new Notice(t('notice.autoAcceptEdits', { value: v ? 'on' : 'off' }));
                    })(); },
                },
            ],
            actions: [
                {
                    icon: 'pocket-knife',
                    label: t('ui.sidebar.selectTools'),
                    onClick: () => this.toolPicker.show(e, anchor, this.containerEl),
                },
                {
                    icon: 'star',
                    label: t('ui.sidebar.saveToMemory'),
                    onClick: () => { void this.handleSaveToMemory(); },
                },
                {
                    icon: 'refresh-cw',
                    label: t('ui.menu.refreshIndex'),
                    onClick: () => { void (async () => {
                        const activeFile = this.app.workspace.getActiveFile();
                        if (!activeFile) { new Notice(t('notice.noActiveFile')); return; }
                        if (!this.plugin.semanticIndex) { new Notice(t('notice.semanticDisabled')); return; }
                        // FIX-15-01-02: force. An explicit "Refresh index" must rebuild
                        // even when the bytes are unchanged, otherwise the
                        // content gate would make the menu item a no-op.
                        await this.plugin.semanticIndex.updateFile(activeFile.path, { force: true });
                        new Notice(t('notice.indexRefreshed'));
                    })(); },
                },
                {
                    icon: 'database',
                    label: t('ui.menu.forceReindex'),
                    onClick: () => {
                        if (!this.plugin.semanticIndex) { new Notice(t('notice.semanticDisabled')); return; }
                        if (this.plugin.semanticIndex.building) { new Notice(t('notice.indexingInProgress')); return; }
                        new Notice(t('notice.reindexingVault'));
                        // FIX-15-01-03 (Issue #68): buildIndex never rejects on
                        // embedding failures -- it counts them per file and
                        // resolves. Reporting unconditional success here is how
                        // a completely broken provider showed up as "Vault
                        // index rebuilt" while nothing had been indexed.
                        this.plugin.semanticIndex.buildIndex(undefined, true).then((res) => {
                            if (res.aborted || (res.indexed === 0 && res.errors > 0)) {
                                new Notice(t('notice.reindexFailed', {
                                    error: res.lastError ?? t('notice.indexNoFilesIndexed'),
                                }), 10_000);
                            } else if (res.errors > 0) {
                                new Notice(t('notice.vaultIndexRebuiltWithErrors', {
                                    indexed: res.indexed, errors: res.errors,
                                }), 8_000);
                            } else {
                                new Notice(t('notice.vaultIndexRebuilt'));
                            }
                        }).catch((err: Error) => new Notice(t('notice.reindexFailed', { error: err.message })));
                    },
                },
                {
                    icon: 'stethoscope',
                    label: t('modal.vaultHealth.title'),
                    onClick: () => { void (async () => {
                        if (!this.plugin.vaultHealthService) {
                            new Notice(t('notice.vaultHealth.serviceUnavailable'));
                            return;
                        }
                        new Notice(t('notice.vaultHealth.checkRunning'));
                        await this.plugin.vaultHealthService.runChecks(undefined, buildHealthCheckOptions(this.plugin.settings));
                        if (this.plugin.vaultHealthService.getFindings().length === 0) {
                            new Notice(t('notice.vaultHealth.noIssues'));
                            return;
                        }
                        this.openHealthModal();
                    })(); },
                },
                {
                    icon: 'x-circle',
                    label: t('ui.menu.cancelIndexing'),
                    isVisible: () => this.plugin.semanticIndex?.building ?? false,
                    onClick: () => {
                        this.plugin.semanticIndex?.cancelBuild();
                        new Notice(t('notice.indexingCancelled'));
                    },
                },
            ],
        });
    }


    // -------------------------------------------------------------------------
    // Tool display helpers (Kilo Code style)
    // -------------------------------------------------------------------------

    private getToolIcon(toolName: string): string {
        return TOOL_METADATA[toolName]?.icon ?? 'terminal';
    }

    private formatToolLabel(toolName: string): string {
        return TOOL_METADATA[toolName]?.label ?? toolName;
    }

    private getToolBriefParam(input: Record<string, unknown>): string {
        return (input?.path ?? input?.url ?? input?.query ?? input?.question ?? '') as string;
    }

    /**
     * Label for grouped tool calls — shows singular or plural form with count.
     * Used when consecutive same-type groupable tool calls are collapsed into one row.
     */
    private formatGroupedLabel(name: string, count: number): string {
        const labels: Record<string, [string, string]> = {
            read_file:        [t('ui.toolActivity.readFile'),       t('ui.toolActivity.readFiles')],
            list_files:       [t('ui.toolActivity.listFiles'),      t('ui.toolActivity.listFiles')],
            search_files:     [t('ui.toolActivity.searching'),      t('ui.toolActivity.searching')],
            get_frontmatter:  [t('ui.toolActivity.readingMetadata'),t('ui.toolActivity.readingMetadata')],
            get_linked_notes: [t('ui.toolActivity.findingLinks'),   t('ui.toolActivity.findingLinks')],
            search_by_tag:    [t('ui.toolActivity.searchingByTag'), t('ui.toolActivity.searchingByTag')],
            get_vault_stats:  [t('ui.toolActivity.vaultOverview'),  t('ui.toolActivity.vaultOverview')],
            get_daily_note:   [t('ui.toolActivity.readingDailyNote'),t('ui.toolActivity.readingDailyNotes')],
            web_fetch:        [t('ui.toolActivity.fetchingPage'),   t('ui.toolActivity.fetchingPages')],
            web_search:       [t('ui.toolActivity.searchingWeb'),   t('ui.toolActivity.searchingWeb')],
            semantic_search:  [t('ui.toolActivity.semanticSearch'), t('ui.toolActivity.semanticSearches')],
        };
        const [singular, plural] = labels[name] ?? [name, name];
        return count === 1 ? singular : `${plural} (${count})`;
    }

    // -------------------------------------------------------------------------
    // Response action bar + link wiring
    // -------------------------------------------------------------------------

    /**
     * Render markdown into `containerEl` and wire any internal/wikilink
     * anchors so they navigate via `openLinkText`. Awaits the render so
     * the link wiring runs after Obsidian has actually inserted the
     * anchors -- a sync `void MarkdownRenderer.render(...)` followed by
     * `wireInternalLinks` races against post-processors and leaves
     * freshly created anchors unwired (the bug behind unclickable
     * [[wikilinks]] in chat responses, tool output and history reloads).
     *
     * Uses the active file as `sourcePath` so wikilink resolution has a
     * context to fall back on -- matches the inline chat bridge in
     * `PluginWiring.ts`.
     */
    /** DOM-D1: newest render generation per container; stale passes skip link wiring. */
    private renderGenerations = new WeakMap<HTMLElement, number>();

    private async renderMarkdownAndWire(markdown: string, containerEl: HTMLElement): Promise<void> {
        // AUDIT 2026-07-07 DOM-D1: overlapping passes into the same container
        // (throttled Q&A streaming render vs. the next tick or onComplete's
        // authoritative render) stacked duplicate click handlers -- the stale
        // pass resolved after a newer pass had emptied and re-rendered the
        // container, then wired the newer pass's anchors a second time. Only
        // the newest pass per container may wire links.
        const gen = (this.renderGenerations.get(containerEl) ?? 0) + 1;
        this.renderGenerations.set(containerEl, gen);
        const sourcePath = this.app.workspace.getActiveFile()?.path ?? '';
        // AUDIT 2026-07-26 H-5: neutralise auto-loading remote references BEFORE
        // rendering. Everything that reaches this method is untrusted by the
        // project's own threat model (tool results carry vault notes, fetched
        // pages and MCP responses; LLM output is untrusted too), and markdown
        // image syntax turns that text into a zero-click outbound request with
        // vault content in the query string. It has to happen on the string:
        // an <img> starts fetching the moment its src is set, so a post-render
        // DOM sweep would remove the element only after the request left.
        // This is the single chokepoint -- all chat rendering goes through here.
        const safeMarkdown = neutraliseRemoteResources(markdown);
        await MarkdownRenderer.render(this.app, safeMarkdown, containerEl, sourcePath, this);
        if (this.renderGenerations.get(containerEl) !== gen) return;
        this.wireInternalLinks(containerEl);
    }

    /**
     * Make internal [[wikilinks]] and note links in the rendered markdown clickable.
     * MarkdownRenderer handles most links, but we intercept to ensure sidebar context.
     *
     * Special-case obsidian://obsilo-chat?id=X URLs (used by recall_memory and
     * search_history outputs): route through the plugin's deep-link handler
     * directly. Without this they'd fall through to openLinkText() and the
     * ":" in the protocol scheme triggers a createFolder error.
     */
    private wireInternalLinks(contentEl: HTMLElement): void {
        contentEl.querySelectorAll('a').forEach((anchor) => {
            const href = anchor.getAttribute('href') ?? '';
            if (href.startsWith('obsidian://vault-operator-chat') || href.startsWith('obsidian://obsilo-chat')) {
                anchor.addEventListener('click', (e) => {
                    e.preventDefault();
                    const match = /[?&]id=([^&]+)/.exec(href);
                    if (match) {
                        const id = decodeURIComponent(match[1]);
                        void this.plugin.openChatById(id);
                    }
                });
                return;
            }
            // Internal links: [[Note]] renders as data-href or href without http
            if (!href.startsWith('http') && !href.startsWith('mailto')) {
                anchor.addEventListener('click', (e) => {
                    e.preventDefault();
                    const linkText = anchor.getAttribute('data-href') ?? href;
                    // A URL rendered as an internal link (e.g. [[https://...]]) would
                    // otherwise reach openLinkText, which throws on the ":" / "/".
                    this.openSourceTarget(resolveSourceTarget(linkText));
                });
            }
        });
    }

    /**
     * Open a resolved source/link target: external URLs go to the browser,
     * vault links go through openLinkText (which throws on a URL's ":" / "/").
     */
    private openSourceTarget(target: ReturnType<typeof resolveSourceTarget>): void {
        if (target.kind === 'external') {
            openExternalUrl(target.url);
        } else {
            void this.app.workspace.openLinkText(target.linkText, '', false);
        }
    }

    // -------------------------------------------------------------------------
    // Perplexity-style inline citations
    // -------------------------------------------------------------------------

    /**
     * Parse and extract [sources]...[/sources] block from the model's response.
     * Returns cleaned text (without the block) and an array of parsed sources.
     */
    private parseSources(text: string): { cleanText: string; sources: { num: number; note: string; context: string }[] } {
        const match = text.match(/\[sources\]\s*\n?([\s\S]*?)\[\/sources\]/);
        if (!match) return { cleanText: text, sources: [] };

        const cleanText = text.replace(/\[sources\]\s*\n?[\s\S]*?\[\/sources\]/, '').trimEnd();
        const sources: { num: number; note: string; context: string }[] = [];

        for (const line of match[1].split('\n')) {
            const lineMatch = line.trim().match(/^(\d+)\.\s+(.+?)(?:\s+[—-]+\s+(.+))?$/);
            if (lineMatch) {
                sources.push({
                    num: parseInt(lineMatch[1]),
                    note: lineMatch[2].trim(),
                    context: lineMatch[3]?.trim() ?? '',
                });
            }
        }

        return { cleanText, sources };
    }

    /**
     * Parse and extract [followups]...[/followups] block from the model's response.
     * Returns cleaned text and an array of follow-up action strings.
     */
    private parseFollowups(text: string): { cleanText: string; heading: string; followups: string[] } {
        const match = text.match(/\[followups(?:\s+heading="([^"]*)")?\]\s*\n?([\s\S]*?)\[\/followups\]/);
        if (!match) return { cleanText: text, heading: '', followups: [] };

        const cleanText = text.replace(/\[followups(?:\s+heading="[^"]*")?\]\s*\n?[\s\S]*?\[\/followups\]/, '').trimEnd();
        const heading = match[1] || '';
        const followups = match[2].split('\n')
            .map(line => line.replace(/^[-*]\s*/, '').trim())
            .filter(line => line.length > 0);

        return { cleanText, heading, followups };
    }

    /**
     * Convert inline [N] references in rendered HTML to clickable citation badges.
     * Only converts numbers that match a parsed source.
     */
    private wireCitationBadges(contentEl: HTMLElement, sources: { num: number; note: string; context: string }[]): void {
        if (sources.length === 0) return;

        const sourceNums = new Set(sources.map(s => s.num));
        const walker = activeDocument.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT);
        const replacements: { node: Text; text: string }[] = [];

        while (walker.nextNode()) {
            const textNode = walker.currentNode as Text;
            // Skip text inside code blocks
            if (textNode.parentElement?.closest('code, pre')) continue;
            const text = textNode.textContent ?? '';
            if (/\[\d+\]/.test(text)) {
                replacements.push({ node: textNode, text });
            }
        }

        for (const { node, text } of replacements) {
            const fragment = createFragment();
            let lastIndex = 0;
            let replaced = false;

            for (const m of text.matchAll(/\[(\d+)\]/g)) {
                const num = parseInt(m[1]);
                if (!sourceNums.has(num)) continue;
                const matchIndex = m.index ?? 0;

                const source = sources.find(s => s.num === num);
                if (!source) continue;

                // Text before this match
                if (matchIndex > lastIndex) {
                    fragment.appendChild(activeDocument.createTextNode(text.slice(lastIndex, matchIndex)));
                }

                // Citation badge
                const badge = createSpan();
                badge.className = 'source-badge';
                badge.textContent = String(num);
                badge.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.showSourcePopup(badge, source);
                });
                fragment.appendChild(badge);

                lastIndex = matchIndex + m[0].length;
                replaced = true;
            }

            if (replaced) {
                // Remaining text after last match
                if (lastIndex < text.length) {
                    fragment.appendChild(activeDocument.createTextNode(text.slice(lastIndex)));
                }
                node.parentNode?.replaceChild(fragment, node);
            }
        }
    }

    /**
     * Clamp a fixed-position popup to the visible viewport.
     * Call after appending to activeDocument.body so dimensions are known.
     */
    private clampPopupToViewport(popup: HTMLElement): void {
        window.requestAnimationFrame(() => {
            const r = popup.getBoundingClientRect();
            const pad = 8;
            if (r.right > window.innerWidth) {
                popup.setCssProps({ '--popup-left': `${window.innerWidth - r.width - pad}px` });
            }
            if (r.left < 0) {
                popup.setCssProps({ '--popup-left': `${pad}px` });
            }
            if (r.bottom > window.innerHeight) {
                popup.setCssProps({ '--popup-top': `${window.innerHeight - r.height - pad}px`, '--popup-bottom': '' });
            }
            if (r.top < 0) {
                popup.setCssProps({ '--popup-top': `${pad}px`, '--popup-bottom': '' });
            }
        });
    }

    /**
     * Attach a click-outside close handler to a popup.
     */
    private attachPopupCloseHandler(popup: HTMLElement, anchor: HTMLElement): void {
        const close = (e: MouseEvent) => {
            if (!popup.contains(e.target as Node) && e.target !== anchor) {
                popup.remove();
                activeDocument.removeEventListener('click', close);
            }
        };
        window.setTimeout(() => activeDocument.addEventListener('click', close), 10);
    }

    /**
     * Show a popup card for a single source (badge click).
     */
    private showSourcePopup(anchor: HTMLElement, source: { num: number; note: string; context: string }): void {
        activeDocument.querySelectorAll('.source-popup').forEach(el => el.remove());

        const popup = createDiv();
        popup.className = 'source-popup';

        const titleEl = createDiv();
        titleEl.className = 'source-popup-title';
        const target = resolveSourceTarget(source.note);
        titleEl.textContent = target.display;
        titleEl.addEventListener('click', () => {
            this.openSourceTarget(target);
            popup.remove();
        });
        popup.appendChild(titleEl);

        if (source.context) {
            const ctxEl = createDiv();
            ctxEl.className = 'source-popup-context';
            ctxEl.textContent = source.context;
            popup.appendChild(ctxEl);
        }

        const rect = anchor.getBoundingClientRect();
        popup.setCssProps({ '--popup-top': `${rect.bottom + 4}px`, '--popup-left': `${Math.max(4, rect.left - 40)}px` });

        activeDocument.body.appendChild(popup);
        this.clampPopupToViewport(popup);
        this.attachPopupCloseHandler(popup, anchor);
    }

    /**
     * Show a panel listing all sources (sources indicator click).
     */
    private showSourcesPanel(anchor: HTMLElement, sources: { num: number; note: string; context: string }[]): void {
        activeDocument.querySelectorAll('.source-popup').forEach(el => el.remove());

        const popup = createDiv();
        popup.className = 'source-popup sources-panel';

        for (const source of sources) {
            const row = createDiv();
            row.className = 'source-panel-row';

            const numEl = createSpan();
            numEl.className = 'source-badge';
            numEl.textContent = String(source.num);
            row.appendChild(numEl);

            const titleEl = createSpan();
            titleEl.className = 'source-panel-title';
            const target = resolveSourceTarget(source.note);
            titleEl.textContent = target.display;
            titleEl.addEventListener('click', () => {
                this.openSourceTarget(target);
                popup.remove();
            });
            row.appendChild(titleEl);

            if (source.context) {
                const ctxEl = createDiv();
                ctxEl.className = 'source-panel-context';
                ctxEl.textContent = source.context;
                row.appendChild(ctxEl);
            }

            popup.appendChild(row);
        }

        const rect = anchor.getBoundingClientRect();
        popup.setCssProps({ '--popup-bottom': `${window.innerHeight - rect.top + 4}px`, '--popup-left': `${rect.left}px` });

        activeDocument.body.appendChild(popup);
        this.clampPopupToViewport(popup);
        this.attachPopupCloseHandler(popup, anchor);
    }

    /**
     * Add the response action icon bar below a completed assistant message.
     */
    private addResponseActions(messageEl: HTMLElement, responseText: string, sources?: { num: number; note: string; context: string }[]): void {
        const bar = messageEl.createDiv('message-actions');

        // Sources indicator (left-aligned, before action buttons)
        if (sources && sources.length > 0) {
            const indicator = bar.createSpan({ cls: 'sources-indicator' });
            const iconEl = indicator.createSpan('sources-indicator-icon');
            setIcon(iconEl, 'book-open');
            indicator.createSpan({ text: t('ui.sidebar.sources', { count: sources.length }) });
            indicator.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showSourcesPanel(indicator, sources);
            });
        }

        const makeBtn = (icon: string, tooltip: string, onClick: () => void) => {
            const btn = bar.createEl('button', { cls: 'message-action-btn', attr: { 'aria-label': tooltip } });
            setIcon(btn, icon);
            btn.title = tooltip;
            btn.addEventListener('click', onClick);
        };

        // Insert at cursor in active note
        // iterateAllLeaves with instanceof is the most reliable way to find a markdown editor
        // because getActiveViewOfType returns null when the sidebar has focus
        makeBtn('text-cursor-input', t('ui.sidebar.insertAtCursor'), () => {
            let view: MarkdownView | null =
                this.app.workspace.getActiveViewOfType(MarkdownView) ?? this.lastMarkdownView;
            if (!view) {
                this.app.workspace.iterateAllLeaves((leaf) => {
                    if (!view && leaf.view instanceof MarkdownView) {
                        view = leaf.view;
                    }
                });
            }
            if (view?.editor) {
                view.editor.replaceSelection(responseText);
                new Notice(t('notice.insertedAtCursor'));
            } else {
                new Notice(t('notice.noOpenNote'));
            }
        });

        // Create new note from response — open in a new leaf (not in sidebar)
        makeBtn('file-plus', t('ui.sidebar.createNote'), () => {
            void (async () => {
                const now = new Date();
                // Colons are forbidden in filenames on macOS/Windows — use dashes for HH-MM
                const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
                const fileName = `Agent response ${ts}.md`;
                try {
                    const file = await this.app.vault.create(fileName, responseText);
                    // getLeaf(true) always creates a new leaf in the main content area
                    const leaf = this.app.workspace.getLeaf(true);
                    await leaf.openFile(file);
                } catch (e) {
                    new Notice(t('notice.createNoteFailed', { error: (e as Error).message }));
                }
            })();
        });

        // Synthesis note: Agent summarizes the chat and creates a connected note
        if (this.plugin.settings.enableSynthesisButton !== false) {
            makeBtn('notebook-pen', t('ui.sidebar.synthesisZettel'), () => {
                this.sendProgrammaticMessage(
                    'Erstelle eine Synthese-Note aus diesem Chat. ' +
                    'Fasse die wichtigsten Erkenntnisse, Entscheidungen und Ergebnisse zusammen. ' +
                    'Erstelle die Note mit vollstaendigem Frontmatter (Zusammenfassung, Themen, Konzepte, Tags, Kategorie: Zettel) ' +
                    'und vernetze sie mit bestehenden Notes im Vault. ' +
                    'Speichere die Note in Inbox/. Oeffne die Note nach dem Erstellen.',
                    true, // hidden: user bubble not shown
                );
            });
        }

        // Copy to clipboard
        makeBtn('copy', t('ui.sidebar.copyResponse'), () => {
            void navigator.clipboard.writeText(responseText).then(() => {
                new Notice(t('notice.copiedToClipboard'));
            });
        });

        // Regenerate
        makeBtn('refresh-cw', t('ui.sidebar.regenerate'), () => {
            // Remove this message and re-run
            messageEl.remove();
            // Remove last two history entries (assistant + tool_results if any)
            // and re-send the last user message
            if (this.lastUserMessage) {
                if (this.textarea) this.textarea.value = this.lastUserMessage;
                void this.handleSendMessage();
            }
        });

        // Delete message
        makeBtn('trash-2', t('ui.sidebar.deleteResponse'), () => {
            messageEl.remove();
        });
    }

    // -------------------------------------------------------------------------
    // Completion, Question, Approval cards
    // -------------------------------------------------------------------------

    /**
     * Render (or update) the Plan box for a streaming message.
     *
     * First call: creates the plan box BEFORE toolsEl in the message, then
     * DOM-moves toolsEl (with any already-rendered tool calls) into a collapsed
     * <details> inside the plan box — making tool calls hidden by default.
     *
     * Subsequent calls: updates the todo items list and badge in place.
     */
    private renderTodoBox(
        toolsEl: HTMLElement,
        items: import('../core/tools/agent/UpdateTodoListTool').TodoItem[],
        // FEAT-55-01 (isolation fix): scroll the run's own container, not the
        // active tab's. Non-run callers default to the active tab.
        container?: HTMLElement | null,
    ): void {
        const messageEl = toolsEl.closest<HTMLElement>('.assistant-message');
        if (!messageEl) return;

        let planBoxEl = messageEl.querySelector<HTMLElement>(':scope > .agent-todo-box');
        let planListEl: HTMLElement;

        if (!planBoxEl) {
            // First call — build the plan box and move toolsEl into it
            planBoxEl = createDiv();
            planBoxEl.className = 'agent-todo-box';
            // Insert before toolsEl (direct child of messageEl on first call)
            messageEl.insertBefore(planBoxEl, toolsEl);

            const header = planBoxEl.createDiv('todo-box-header');
            // The brand mark stands in for the old `list-checks` icon: it gives
            // the agent a face INSIDE the panel, which is why the panel no
            // longer needs a floating marker in the message gutter (that one
            // could not avoid colliding with the panel's own top-left corner).
            // Drawn in CSS, so DOMPurify stripping <svg> on rehydration cannot
            // erase it the way it erases setIcon output.
            header.createSpan({ cls: 'todo-box-icon vo-brand-mark', attr: { 'aria-hidden': 'true' } });
            header.createSpan('todo-box-title').setText(t('ui.sidebar.plan'));
            header.createSpan('todo-activity-badge');

            planListEl = planBoxEl.createDiv('todo-box-list');

            const activityDetails = planBoxEl.createEl('details', { cls: 'todo-activity-log' });
            activityDetails.createEl('summary', { cls: 'todo-activity-summary', text: t('ui.sidebar.activity') });
            // DOM-move: relocate toolsEl (with any already-rendered tool calls) into collapsed details
            activityDetails.appendChild(toolsEl);
        } else {
            planListEl = planBoxEl.querySelector<HTMLElement>('.todo-box-list')!;
            planBoxEl.querySelector<HTMLElement>('.todo-activity-badge');
        }

        // Update the todo items list
        planListEl.empty();
        for (const item of items) {
            const row = planListEl.createDiv('todo-item');
            const icon = row.createSpan('todo-item-icon');
            if (item.status === 'done') {
                setIcon(icon, 'check-circle-2');
                row.addClass('todo-done');
            } else if (item.status === 'in_progress') {
                setIcon(icon, 'loader-2');
                row.addClass('todo-in-progress');
            } else {
                setIcon(icon, 'circle');
                row.addClass('todo-pending');
            }
            row.createSpan('todo-item-text').setText(item.text);
        }

        const scrollTarget = container ?? this.chatContainer;
        scrollTarget?.scrollTo({ top: scrollTarget.scrollHeight });
    }

    private showQuestionCard(
        question: string,
        options: string[] | undefined,
        resolve: (answer: string) => void,
        // FEAT-55-01 (isolation fix): a run passes its own container + session
        // so the question card renders in the run's tab and the pending-resolve
        // registration lives on the run's session (a Send in the run's tab
        // answers ITS question). Non-run callers keep the active-tab defaults.
        container?: HTMLElement | null,
        session: ChatSession = this.activeSession,
    ): void {
        const target = container ?? this.chatContainer;
        if (!target) { resolve(''); return; }

        const card = target.createDiv('followup-list');
        card.createDiv('followup-heading').setText(question);
        // A resolver that answers the question exactly once, then tidies up.
        // Declared before cleanup references it; cleanup only runs later, so
        // the forward reference is safe.
        const answer = (value: string) => {
            cleanup();
            resolve(value);
        };
        // Issue 1: cleanup also clears the pending-resolve registration so a
        // later Send from the main input can no longer target a dismissed card.
        const cleanup = () => {
            card.remove();
            if (session.pendingQuestionResolve === answer) session.pendingQuestionResolve = null;
        };
        // Register so a Send from the main chat input resolves THIS question
        // (combining answers via "+") instead of being queued as steering.
        session.pendingQuestionResolve = answer;

        if (options && options.length > 0) {
            // Mirror the [followups] prose surface: each option sends
            // immediately on click; a hover-revealed "+" copies the option
            // into the main chat input WITHOUT sending, so several options can
            // be composed into one combined answer. Multi-answer is now
            // inherent -- no agent-set allow_multiple flag, no checkbox mode.
            options.forEach((opt) => {
                const itemRow = card.createDiv('followup-item-row');
                const item = itemRow.createEl('button', { cls: 'followup-item', text: opt });
                item.addEventListener('click', () => { answer(opt); });
                // "+" button: append to the textarea, do NOT resolve.
                const appendBtn = item.createSpan({ cls: 'followup-append-btn', text: '+' });
                appendBtn.setAttribute('aria-label', t('ui.sidebar.addToInput'));
                appendBtn.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    ev.preventDefault();
                    if (this.textarea) {
                        const sep = this.textarea.value.trim() ? '\n' : '';
                        this.textarea.value = this.textarea.value + sep + opt;
                        this.textarea.focus();
                        this.textarea.dispatchEvent(new Event('input'));
                    }
                });
            });
        }

        // Free-text row on the card itself stays as an alternative to typing in
        // the main input. Both paths funnel through answer() -> resolve().
        const inputRow = card.createDiv('question-input-row');
        const input = inputRow.createEl('input', {
            cls: 'question-input',
            attr: { type: 'text', placeholder: t('ui.question.placeholder') },
        });
        const submitBtn = inputRow.createEl('button', { cls: 'question-submit-btn', text: t('ui.question.answer') });
        const submit = () => {
            const val = input.value.trim();
            if (!val) return;
            answer(val);
        };
        submitBtn.addEventListener('click', submit);
        input.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Enter') submit(); });
        target.scrollTo({ top: target.scrollHeight });
    }

    /**
     * Build a human-readable explanation for a tool call.
     * Returns { text, target? } where text is the explanation sentence
     * and target is the highlighted value (path, URL, query etc.).
     */
    private buildHumanReadableExplanation(
        toolName: string,
        input: Record<string, unknown>,
    ): { text: string; target?: string } {
        const str = (key: string): string => { const v = input[key]; return typeof v === 'string' ? v : ''; };

        switch (toolName) {
            case 'write_file':
                return { text: t('ui.approval.explain.writeFile'), target: str('path') };
            case 'edit_file':
                return { text: t('ui.approval.explain.editFile'), target: str('path') };
            case 'append_to_file':
                return { text: t('ui.approval.explain.appendFile'), target: str('path') };
            case 'update_frontmatter':
                return { text: t('ui.approval.explain.frontmatter'), target: str('path') };
            case 'delete_file':
                return { text: t('ui.approval.explain.deleteFile'), target: str('path') };
            case 'move_file': {
                const from = str('source');
                const to = str('destination');
                return { text: t('ui.approval.explain.moveFile'), target: to ? `${from} ${t('ui.approval.explain.moveFileTo')} ${to}` : from };
            }
            case 'create_folder':
                return { text: t('ui.approval.explain.createFolder'), target: str('path') };
            case 'generate_canvas':
                return { text: t('ui.approval.explain.canvas'), target: str('output_path') };
            case 'create_excalidraw':
                return { text: t('ui.approval.explain.excalidraw'), target: str('output_path') };
            case 'evaluate_expression':
                return { text: t('ui.approval.explain.sandbox') };
            case 'web_fetch':
                return { text: t('ui.approval.explain.webFetch'), target: str('url') };
            case 'web_search':
                return { text: t('ui.approval.explain.webSearch'), target: str('query') };
            case 'new_task':
                return { text: t('ui.approval.explain.newTask') };
            case 'use_mcp_tool': {
                const server = str('server_name');
                const tool = str('tool_name');
                return { text: t('ui.approval.explain.mcpTool'), target: tool ? `${tool} (${server})` : server };
            }
            case 'call_plugin_api':
                return { text: t('ui.approval.explain.pluginApi'), target: str('plugin_id') };
            case 'execute_command':
                return { text: t('ui.approval.explain.command'), target: str('command_id') };
            case 'execute_recipe':
                return { text: t('ui.approval.explain.recipe'), target: str('recipe_id') };
            case 'switch_agent':
                return { text: t('ui.approval.explain.switchMode') };
            case 'manage_source':
                return { text: t('ui.approval.explain.selfModify') };
            default:
                return { text: t('ui.approval.explain.fallback'), target: this.formatToolLabel(toolName) };
        }
    }

    /**
     * Truncate a string to maxLen characters, appending "..." if truncated.
     */
    private truncateForApproval(value: string, maxLen: number): string {
        if (value.length <= maxLen) return value;
        return value.slice(0, maxLen) + '...';
    }

    /**
     * Selector-carrying Frontmatter Operator API methods. Bulk-write ops
     * that accept a NoteSelector under `select` can be previewed via the
     * auto-approvable read method `getMatchingPaths`. Methods without a
     * selector (undoLast, restoreSnapshot, cleanupRefusalTags with vault-
     * wide default, dedupeWikilinks) render no preview.
     */
    private readonly FO_SELECTOR_METHODS = new Set([
        'setProperty',
        'deleteProperties',
        'renameProperty',
        'renameValues',
        'copyProperty',
        'mergeProperties',
    ]);

    /**
     * Render an "Affects N note(s)" preview line in the approval card for
     * Frontmatter Operator selector-based bulk writes. Returns a Promise
     * that resolves once the preview has settled (success or failure) so
     * the caller can gate the Allow-button on it (AUDIT-FEAT-14-07 L-5).
     * Returns `null` when no preview is applicable to the current tool
     * call -- the caller keeps normal button behaviour in that case.
     *
     * Reads only (getMatchingPaths is Tier-1 auto-approvable), so the
     * preview itself does not trigger another approval prompt.
     */
    private maybeRenderFrontmatterOperatorPreview(
        toolName: string,
        input: Record<string, unknown>,
        row: HTMLElement,
    ): Promise<void> | null {
        if (toolName !== 'call_plugin_api') return null;
        if (input['plugin_id'] !== 'frontmatter-operator') return null;
        const method = typeof input['method'] === 'string' ? input['method'] : '';
        if (!this.FO_SELECTOR_METHODS.has(method)) return null;

        // args on call_plugin_api is an ordered array; FO opts sit in args[0].
        const args = Array.isArray(input['args']) ? input['args'] : [];
        const opts = (args[0] ?? {}) as Record<string, unknown>;
        const selector = opts['select'];
        if (!selector || typeof selector !== 'object') return null;

        const plugins = (this.app as unknown as {
            plugins?: { plugins?: Record<string, { api?: Record<string, unknown> }> };
        }).plugins;
        const foInstance = plugins?.plugins?.['frontmatter-operator'];
        const getMatchingPaths = foInstance?.api?.['getMatchingPaths'];
        if (typeof getMatchingPaths !== 'function') return null;

        // Insert placeholder immediately so it appears above the details toggle.
        const previewEl = row.createDiv('tool-approval-fo-preview');
        previewEl.setText(t('ui.sidebar.resolvingAffectedNotes'));

        // Async resolution. Failures silently remove the placeholder.
        // AUDIT-FEAT-14-07 L-2: guard every DOM mutation with an isConnected
        // check. When the user resolves the approval before getMatchingPaths
        // returns, `row` has already been removed and previewEl is detached.
        // Continuing to mutate a detached node wastes CPU and keeps a stale
        // reference on `row`.
        return (async () => {
            try {
                const result = await (getMatchingPaths as (s: unknown) => Promise<unknown>)(selector);
                if (!previewEl.isConnected) return;
                if (!result || typeof result !== 'object') {
                    previewEl.remove();
                    return;
                }
                const typed = result as { count?: unknown; paths?: unknown };
                const count = typeof typed.count === 'number' ? typed.count : NaN;
                const paths = Array.isArray(typed.paths) ? typed.paths.filter((p): p is string => typeof p === 'string') : [];
                if (Number.isNaN(count)) {
                    previewEl.remove();
                    return;
                }
                previewEl.empty();
                const label = count === 1 ? 'Affects 1 note.' : `Affects ${count} notes.`;
                previewEl.createSpan({ text: label });
                if (paths.length > 0) {
                    const sample = paths.slice(0, 5).join(', ');
                    const suffix = paths.length > 5 ? `, ... (+${count - 5} more)` : '';
                    previewEl.createSpan('tool-approval-fo-preview-sample').setText(` ${sample}${suffix}`);
                }
            } catch {
                if (previewEl.isConnected) previewEl.remove();
            }
        })();
    }

    /**
     * Format the raw tool input as a readable string for the details section.
     */
    private formatInputForDetails(input: Record<string, unknown>): string {
        const MAX_VALUE_LEN = 500;
        const lines: string[] = [];
        for (const [key, value] of Object.entries(input)) {
            const strVal = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
            lines.push(`${key}: ${this.truncateForApproval(strVal, MAX_VALUE_LEN)}`);
        }
        return lines.join('\n');
    }

    /**
     * FEAT-44-10: approve a note edit on its DIFF, before it is written.
     *
     * The post-task review that used to be the only diff in the product opens
     * after every write has landed, and its "reject" only declines the user's own
     * manual edits -- the agent's version stays on disk. That is a gate in
     * appearance only. When the Pipeline hands us a preview, we put the real diff
     * in front of the write: Apply approves (with whatever the user typed),
     * discard rejects and nothing is written.
     */
    private async showEditApprovalGate(
        toolName: string,
        preview: import('../core/tools/editPreview').EditPreview,
    ): Promise<import('../core/tool-execution/ToolExecutionPipeline').ApprovalResult> {
        const { showEditReviewModal } = await import('./edit-review/EditReviewModal');
        const result = await showEditReviewModal({
            app: this.app,
            source: this.formatToolLabel(toolName),
            title: preview.isDeleted ? t('ui.approval.gateTitleDelete') : t('ui.approval.gateTitle'),
            entries: [{
                path: preview.path,
                before: preview.before,
                after: preview.after,
                isNew: preview.isNew,
                isDeleted: preview.isDeleted,
            }],
            // FEAT-44-02: one approval for the whole run is impossible -- the agent
            // only decides its next tool call after seeing this one's result, so
            // there is nothing to preview yet. Offering to REMEMBER the answer is
            // the honest version of what the user actually wants.
            // FEAT-44-07: not while paranoid mode is on -- a scope grant would not
            // take effect, so the buttons are not offered.
            allowRememberForRun: this.plugin.settings.paranoidMode !== true,
        });

        // Discarded, or the single file was skipped: nothing happens.
        const decision = result.decisions?.[0];
        if (!result.decisions || !decision || decision.skipped) {
            return { decision: 'rejected', reason: 'Rejected by user in the diff view.' };
        }

        const rememberForRun = result.rememberForRun === true;
        const rememberForSession = result.rememberForSession === true;

        // A deletion has no meaningful "edited after-state" -- the only real
        // choices are let it go or keep it. Whatever the textarea says, we do not
        // turn a delete into a write behind the user's back.
        if (preview.isDeleted) {
            return { decision: 'approved', rememberForRun, rememberForSession };
        }

        // Approved as proposed -- let the tool do its own write.
        if (decision.finalContent === preview.after) {
            return { decision: 'approved', rememberForRun, rememberForSession };
        }

        // The user rewrote it in the diff. Their content wins; the Pipeline
        // writes it instead of re-running the tool.
        //
        // Say so out loud. The note is usually not open yet at this point (skills
        // call open_note at the END of a run), so the write lands silently and the
        // user is left wondering whether their edit survived. It did.
        new Notice(t('ui.approval.editApplied', { path: preview.path }));
        return { decision: 'approved', finalContent: decision.finalContent, rememberForRun, rememberForSession };
    }

    private async showBatchEditApprovalGate(
        toolName: string,
        batch: import('../core/tools/editPreview').BatchEditPreview,
    ): Promise<import('../core/tool-execution/ToolExecutionPipeline').ApprovalResult> {
        const { showEditReviewModal } = await import('./edit-review/EditReviewModal');
        const { decideBatchApproval } = await import('./edit-review/batchApprovalDecision');
        const result = await showEditReviewModal({
            app: this.app,
            source: `${this.formatToolLabel(toolName)}: ${batch.summary}`,
            title: t('ui.approval.gateTitleBatch'),
            entries: batch.entries.map((e) => ({
                path: e.path,
                before: e.before,
                after: e.after,
                isNew: e.isNew,
                isDeleted: e.isDeleted,
            })),
            // The batch gate is read-only: the tool writes internally, a
            // user edit inside one entry could not be honoured honestly.
            readonlyContent: true,
            // FEAT-44-07: no scope buttons while paranoid mode is on.
            allowRememberForRun: this.plugin.settings.paranoidMode !== true,
        });
        return decideBatchApproval(result);
    }

    private async showApprovalCard(
        toolName: string,
        input: Record<string, unknown>,
        preview?: import('../core/tools/editPreview').EditPreview,
        batch?: import('../core/tools/editPreview').BatchEditPreview,
        // FEAT-55-01 (isolation fix): a run passes its own container + session
        // so the approval card renders in the run's tab and binds the run's
        // abort signal, not the active tab's. Non-run callers keep the defaults.
        container?: HTMLElement | null,
        session: ChatSession = this.activeSession,
        // Content-hash grant (M-1 follow-up): present only for an unverified
        // sandbox script. The card then offers per-script grants that bank the
        // narrow hash key (never the `sandbox` category) and names the script.
        sandboxGrant?: import('../core/tool-execution/ToolExecutionPipeline').SandboxScriptGrantContext,
    ): Promise<import('../core/tool-execution/ToolExecutionPipeline').ApprovalResult> {
        // FEAT-44-02b: a multi-file operation with real per-file diffs gets
        // the multi-entry review as its gate. Scope-only batches fall through
        // to the card below, which then shows the planned file list instead
        // of a bare tool name.
        //
        // FIX-44-54: the entry-count guard mirrors the Pipeline's own cap
        // (MAX_BATCH_DIFF_ENTRIES in editPreview.ts, the shared contract
        // constant). The Pipeline downgrades oversized batches to scopeOnly
        // BEFORE they reach this callback, so the guard here is defence in
        // depth only -- it must never be the sole place the cap lives,
        // because the Pipeline decides diffReviewed from what was offered.
        if (batch && batch.scopeOnly !== true && batch.entries.length <= MAX_BATCH_DIFF_ENTRIES) {
            return await this.showBatchEditApprovalGate(toolName, batch);
        }
        // FEAT-44-10: a note edit with a computable diff gets the real gate.
        if (preview) {
            return await this.showEditApprovalGate(toolName, preview);
        }
        // Everything else uses the inline card. Rendered in chatContainer (not
        // toolsEl) so it stays visible even when .agent-steps-block is collapsed.
        const cardTarget = container ?? this.chatContainer;
        return new Promise((resolve) => {
            // FIX-44-28: fail CLOSED, not open. If there is no chat container to
            // show the card in, we cannot have obtained consent -- approving
            // anyway would run an unconfirmed CUD action. Deny instead.
            if (!cardTarget) {
                resolve({ decision: 'rejected', reason: 'Approval UI unavailable; operation denied.' });
                return;
            }

            const group = this.getToolEffect(toolName, input);
            const groupLabels: Record<string, string> = {
                'note-edit': t('ui.approval.noteEdits'), 'vault-change': t('ui.approval.vaultChanges'),
                web: t('ui.approval.web'), mcp: t('ui.approval.mcp'), read: t('ui.approval.read'),
                ui: t('ui.approval.agentControl'), subtask: t('ui.approval.subAgents'),
                skill: t('ui.approval.pluginSkills'),
                'plugin-api': t('ui.approval.pluginApi'), recipe: t('ui.approval.recipes'),
                sandbox: t('ui.approval.sandbox'),
                config: t('ui.approval.config'),
                'self-modify': t('ui.approval.selfModify'),
                unclassified: t('ui.approval.unclassified'),
            };

            // Always render in the run's container (like Question-Cards)
            const row = cardTarget.createDiv('tool-approval-row');
            const iconSpan = row.createSpan('tool-approval-icon');
            setIcon(iconSpan, 'shield-alert');
            row.createSpan('tool-approval-text').setText(
                t('ui.approval.notEnabled', { tool: this.formatToolLabel(toolName), group: groupLabels[group] ?? group })
            );

            // Human-readable explanation
            const { text: explanationText, target } = this.buildHumanReadableExplanation(toolName, input);
            const explanationEl = row.createDiv('tool-approval-explanation');
            explanationEl.createSpan().setText(explanationText);
            if (target) {
                explanationEl.createSpan('tool-approval-target').setText(target);
            }

            // Content-hash grant (M-1 follow-up): name the script and make the
            // pinned scope explicit, so the user knows "always allow" here means
            // exactly these bytes, not all sandbox code.
            if (sandboxGrant) {
                row.createDiv('tool-approval-sandbox-script').setText(
                    t('ui.approval.sandboxScript.pinned', { skill: sandboxGrant.skill, script: sandboxGrant.script }),
                );
            }

            // FEAT-44-02b: scope-only batch -- the card names the operation's
            // planned file list instead of just the tool. Rendered rows are
            // capped (no unbounded DOM); the full list sits in the details
            // <pre> below as one text node.
            const SCOPE_LIST_CAP = 20;
            if (batch) {
                const scope = row.createDiv('tool-approval-scope');
                scope.createDiv('tool-approval-scope-summary').setText(batch.summary);
                scope.createDiv('tool-approval-scope-heading').setText(
                    t('ui.approval.scopeHeading', { count: batch.entries.length }),
                );
                const list = scope.createEl('ul', { cls: 'tool-approval-scope-list' });
                for (const entry of batch.entries.slice(0, SCOPE_LIST_CAP)) {
                    const li = list.createEl('li');
                    li.setText(entry.isDeleted === true ? `− ${entry.path}` : entry.isNew === true ? `+ ${entry.path}` : entry.path);
                }
                if (batch.entries.length > SCOPE_LIST_CAP) {
                    scope.createDiv('tool-approval-scope-more').setText(
                        t('ui.approval.scopeMore', { count: batch.entries.length - SCOPE_LIST_CAP }),
                    );
                }
            }

            // For sandbox: show code preview (first 3 lines)
            if (toolName === 'evaluate_expression' && typeof input['expression'] === 'string') {
                const expr = input['expression'];
                const previewLines = expr.split('\n').slice(0, 3);
                const preview = previewLines.join('\n') + (expr.split('\n').length > 3 ? '\n...' : '');
                const codePreview = row.createDiv('tool-approval-code-preview');
                codePreview.createEl('code').setText(preview);
            }

            // For Frontmatter Operator bulk writes: preview how many notes
            // the selector matches BEFORE the user approves. Uses the
            // auto-approvable read method getMatchingPaths, so the preview
            // itself does not trigger another approval prompt.
            const previewPromise = this.maybeRenderFrontmatterOperatorPreview(toolName, input, row);

            // Collapsible details for power users
            const detailsToggle = row.createSpan({
                cls: 'tool-approval-details-toggle',
                text: t('ui.approval.explain.showDetails'),
            });
            const detailsContainer = row.createDiv('tool-approval-details');
            // FEAT-44-02b: the details carry the FULL planned file list (the
            // visible scope list above is capped) as one text node.
            const detailsText = this.formatInputForDetails(input)
                + (batch
                    ? '\n\n' + t('ui.approval.scopeDetailsHeading', { count: batch.entries.length })
                        + '\n' + batch.entries.map((e) => e.path).join('\n')
                    : '');
            detailsContainer.createEl('pre', { cls: 'tool-approval-details-content' })
                .setText(detailsText);

            detailsToggle.addEventListener('click', () => {
                const isVisible = detailsContainer.hasClass('is-visible');
                if (isVisible) {
                    detailsContainer.removeClass('is-visible');
                    detailsToggle.setText(t('ui.approval.explain.showDetails'));
                } else {
                    detailsContainer.addClass('is-visible');
                    detailsToggle.setText(t('ui.approval.explain.hideDetails'));
                }
            });

            // Shai Hulud Mitigation: warn when writing to configDir (plugins/themes/settings)
            const inputPath = typeof input['path'] === 'string' ? input['path'] : '';
            const cfgDir = this.plugin.app.vault.configDir;
            if (inputPath && (inputPath.startsWith(`${cfgDir}/`) || inputPath === cfgDir)) {
                const warning = row.createDiv('tool-approval-config-warning');
                const warnIcon = warning.createSpan('tool-approval-warning-icon');
                setIcon(warnIcon, 'alert-triangle');
                warning.createSpan('tool-approval-warning-text').setText(
                    t('ui.approval.configDirWarning', { path: inputPath })
                );
            }

            const actions = row.createDiv('tool-approval-actions');
            const allowBtn = actions.createEl('button', { cls: 'tool-approval-btn approval-allow-once', text: t('ui.approval.allowOnce') });
            // ADR-153: only offer "Always allow" when a settings flag actually
            // backs it. config and self-modify (alwaysAsk) have none -- a button
            // promising a permanent grant that never takes effect would be a lie,
            // and it would set an unrelated permission instead.
            // FEAT-44-07: while paranoid mode is on, no scope or standing grant
            // takes effect -- so none is offered. A button whose grant would not
            // bite (or would silently arm once paranoid is turned off) is a lie.
            const paranoid = this.plugin.settings.paranoidMode === true;
            const permKey = paranoid ? null : this.effectToPermKey(group, input);
            // FEAT-44-02: a run-scoped grant is offered for the same effects that
            // can be remembered (not alwaysAsk). It applies to the rest of THIS
            // run only, dies with the task, and cannot buy off config/self-modify.
            // FEAT-44-02a: same for the session scope (until plugin reload).
            const runBtn = permKey
                ? actions.createEl('button', { cls: 'tool-approval-btn approval-allow-run', text: t('ui.approval.allowForRun') })
                : null;
            const sessionBtn = permKey
                ? actions.createEl('button', { cls: 'tool-approval-btn approval-allow-session', text: t('ui.approval.allowForSession') })
                : null;
            const enableBtn = permKey
                ? actions.createEl('button', {
                    cls: 'tool-approval-btn approval-enable',
                    // Content-hash grant: the standing "always allow" is per-script
                    // (pinned to the bytes), not the sandbox category.
                    text: sandboxGrant ? t('ui.approval.sandboxScript.alwaysAllow') : t('ui.approval.enableInSettings'),
                })
                : null;
            const denyBtn = actions.createEl('button', { cls: 'tool-approval-btn approval-deny-small', text: '✕' });

            // AUDIT-FEAT-14-07 L-5: gate the Allow-button on the preview
            // for Frontmatter Operator bulk writes so the user cannot
            // approve before seeing the affected-note count. The Deny-
            // button stays enabled so the user can always bail out. A 2s
            // hard timeout re-enables Allow even if the plugin call hangs.
            // Adversarial review 2026-07-14: the run and session buttons
            // grant MORE than the one-shot Allow, so the "see the count
            // first" rationale applies to them with more force -- same gate.
            if (previewPromise) {
                const gatedButtons = [allowBtn, runBtn, sessionBtn, enableBtn];
                const setGated = (disabled: boolean) => {
                    for (const btn of gatedButtons) {
                        if (btn) btn.disabled = disabled;
                    }
                };
                setGated(true);
                const releaseTimeout = window.setTimeout(() => setGated(false), 2000);
                void previewPromise.finally(() => {
                    window.clearTimeout(releaseTimeout);
                    setGated(false);
                });
            }

            // IMP-41-01-02: wall-clock timeout + abort coupling. Without this
            // the loop parks forever on a walked-away user, and Stop during an
            // open card still required a second click on the card itself.
            const timeoutMinutes = this.plugin.settings.advancedApi?.approvalTimeoutMinutes ?? 10;
            const countdownEl = timeoutMinutes > 0 ? actions.createSpan('tool-approval-countdown') : null;
            // Declared before wireApprovalTimeout: an ALREADY-aborted signal
            // fires onAbort synchronously inside the call.
            let timeoutHandle: import('./sidebar/approvalTimeout').ApprovalTimeoutHandle | null = null;
            const cleanup = () => { timeoutHandle?.dispose(); row.remove(); };
            timeoutHandle = wireApprovalTimeout({
                timeoutMs: timeoutMinutes * 60_000,
                // FIX-24-08-03: bind the run's signal, not the mutable
                // controller field. handleStop nulls the field immediately,
                // so a card surfacing from a still-draining tool would bind
                // undefined and hang until the wall-clock timeout. The
                // already-aborted signal fires onAbort synchronously inside
                // wireApprovalTimeout instead.
                // FEAT-55-01 (isolation fix): the run's OWN session signal, so
                // a background run's approval card aborts with its run, not the
                // active tab's.
                abortSignal: session.lastRunAbortSignal ?? undefined,
                onExpire: () => {
                    cleanup();
                    resolve({
                        decision: 'rejected',
                        reason: `Approval timed out after ${timeoutMinutes} minute(s); operation denied.`,
                    });
                },
                onAbort: () => {
                    cleanup();
                    resolve({ decision: 'rejected', reason: 'Task was stopped while approval was pending.' });
                },
                onCountdownTick: (remainingSec) => {
                    countdownEl?.setText(t('ui.approval.expiresIn', { seconds: String(remainingSec) }));
                },
            });

            allowBtn.addEventListener('click', () => { cleanup(); resolve({ decision: 'approved' }); });
            runBtn?.addEventListener('click', () => { cleanup(); resolve({ decision: 'approved', rememberForRun: true }); });
            sessionBtn?.addEventListener('click', () => {
                void (async () => {
                    // Adversarial review 2026-07-14 (FEAT-44-02a): a session
                    // grant for the sandbox effect auto-approves ALL agent-
                    // authored code execution until the plugin reloads --
                    // functionally close to the standing grant, which
                    // FIX-44-03b gates behind an explicit confirm on both
                    // surfaces. Same friction here; the run scope stays one
                    // click because it dies with the task.
                    //
                    // Content-hash grant: NOT the category. A per-script session
                    // grant covers exactly one byte-state of one script, so the
                    // broad-code warning would be false -- it stays one click.
                    if (!sandboxGrant && scopeGrantNeedsConfirm(permKey, 'session')) {
                        const ok = await confirmModal(this.app, {
                            title: t('ui.approval.sandbox'),
                            message: t('ui.approval.sandboxGrantWarning'),
                            confirmLabel: t('ui.approval.allowForSession'),
                            destructive: true,
                        });
                        if (!ok) return; // leave the card open, grant nothing
                    }
                    cleanup();
                    resolve({ decision: 'approved', rememberForSession: true });
                })();
            });
            denyBtn.addEventListener('click', () => { cleanup(); resolve({ decision: 'rejected' }); });
            if (enableBtn && permKey) {
                enableBtn.addEventListener('click', () => {
                    void (async () => {
                        const cfg = this.plugin.settings.autoApproval;
                        const flags = cfg as unknown as Record<string, boolean>;

                        // Content-hash grant (M-1 follow-up): "always allow this
                        // script" banks the NARROW hash key on autoApproval
                        // .sandboxScriptGrants, never the `sandbox` category flag
                        // (which by design never covers unverified code). Mirrors
                        // how the web-host "always allow" writes its own list.
                        // Idempotent (replace any entry with the same key) and
                        // capped oldest-first, so the list cannot grow unbounded.
                        if (sandboxGrant) {
                            const existing = Array.isArray(cfg.sandboxScriptGrants) ? cfg.sandboxScriptGrants : [];
                            const deduped = existing.filter((g) => g.key !== sandboxGrant.key);
                            deduped.push({
                                key: sandboxGrant.key,
                                skill: sandboxGrant.skill,
                                script: sandboxGrant.script,
                                grantedAt: new Date().toISOString(),
                            });
                            cfg.sandboxScriptGrants = deduped.slice(-MAX_SANDBOX_SCRIPT_GRANTS);
                            await this.plugin.saveSettings();
                            cleanup();
                            resolve({ decision: 'approved' });
                            return;
                        }

                        // FIX-44-03b: sandbox auto-approval means arbitrary
                        // agent-authored code writes the vault without a further
                        // prompt. Require an explicit confirm, as the Settings tab
                        // does -- a single card click must not arm it silently.
                        if (scopeGrantNeedsConfirm(permKey, 'standing')) {
                            const ok = await confirmModal(this.app, {
                                title: t('ui.approval.sandbox'),
                                message: t('ui.approval.sandboxGrantWarning'),
                                confirmLabel: t('ui.approval.enableInSettings'),
                                destructive: true,
                            });
                            if (!ok) return; // leave the card open, grant nothing
                        }

                        // AUDIT 2026-07-26 M-5: for a web_fetch, "Always allow"
                        // remembers THIS HOST instead of handing over the whole
                        // web. The blanket `web` flag was the only persistent
                        // yes on offer, so a user who wanted the agent to read
                        // one documentation site had to grant every site.
                        if (toolName === 'web_fetch' && typeof input['url'] === 'string') {
                            const grantedHost = hostKeyOf(input['url']);
                            const next = allowHost(this.plugin.settings.webFetchAllowedHosts, input['url']);
                            if (next !== null && grantedHost !== null) {
                                this.plugin.settings.webFetchAllowedHosts = next;
                                // The list is sorted, so the new host is NOT the
                                // last element -- stamp the resolved key.
                                stampProvenance(
                                    this.plugin.settings,
                                    `webHost:${grantedHost}`,
                                    { origin: 'card', at: Date.now() },
                                );
                                await this.plugin.saveSettings();
                                cleanup();
                                resolve({ decision: 'approved' });
                                return;
                            }
                            // Unusable URL: fall through to the category grant
                            // rather than silently granting nothing.
                        }

                        // FIX-44-03b: flipping the master ON must not silently
                        // re-arm category flags left true by a past permissive
                        // session. grantAutoApproval clears them first.
                        grantAutoApproval(flags, permKey);
                        // AUDIT 2026-07-26 M-18: record that THIS grant came
                        // from a card, and when. Without it the Permissions list
                        // shows a switch that is on with no hint that the user
                        // is the reason -- which is why "Always allow" felt
                        // irreversible: it was reversible, just unattributable.
                        stampProvenance(this.plugin.settings, `autoApproval:${permKey}`, {
                            origin: 'card',
                            at: Date.now(),
                        });
                        await this.plugin.saveSettings();
                        cleanup();
                        resolve({ decision: 'approved' });
                    })();
                });
            }

            cardTarget.scrollTo({ top: cardTarget.scrollHeight });
        });
    }

    /**
     * Offer the missing language pack as a visible in-chat card at
     * sidebar open. Reuses `showInstallPromptCard` so the visual is
     * identical to tool-triggered asset installs. Skips silently on
     * English, when the pack is already installed, or when the pack
     * offer for this locale was previously handled (persisted via
     * settings.localePackPromptedFor). Fire-and-forget.
     */
    private async maybeOfferLocalePackCard(): Promise<void> {
        try {
            // FEAT-55-04 (ADR-171): show at most once per boot across all
            // chat leaves; N restored leaves must not each render the card.
            if (this.plugin.localePackCardShownThisBoot) return;
            const { activeLocaleSpec, LOCALE_LABELS } = await import('../i18n/localePacks');
            const { needsLocalePack, getActiveLocale } = await import('../i18n');
            if (!needsLocalePack()) return;
            this.plugin.localePackCardShownThisBoot = true;
            const spec = activeLocaleSpec(this.plugin);
            if (!spec) return;
            const { OptionalAssetManager } = await import('../core/assets/OptionalAssetManager');
            const manager = new OptionalAssetManager(this.plugin);
            const snap = await manager.snapshot(spec);
            if (snap.status === 'installed') return;
            const outcome = await this.showInstallPromptCard(spec, 'language-pack');
            if (outcome.decision === 'installed') {
                const locale = getActiveLocale();
                const label = (LOCALE_LABELS as Record<string, string>)[locale] ?? locale;
                new Notice(t('notice.localePack.installedReload', { language: label }), 10_000);
            }
        } catch (e) {
            console.debug('[i18n] locale pack card skipped:', e);
        }
    }

    /**
     * Inline install-prompt card. Rendered when a tool needs an optional
     * asset (office bundle, pdfjs bundle, reranker WASM, ...) that is not
     * yet installed. Obsidian community policy requires network fetches
     * to be triggered by an explicit user click -- this card IS that
     * click. Resolves to `installed` once download+SHA verification
     * succeeded (tool retries its asset load), `skipped` if the user
     * dismisses, `failed` on download/verification error.
     */
    private async showInstallPromptCard(
        spec: import('../core/assets/OptionalAssetManager').AssetSpec,
        toolName: string,
        // FEAT-55-01 (isolation fix): a run passes its own container so the
        // install card renders in the run's tab. Boot/locale callers default
        // to the active tab.
        container?: HTMLElement | null,
    ): Promise<import('../core/tool-execution/ToolExecutionPipeline').OptionalAssetInstallResult> {
        const target = container ?? this.chatContainer;
        return new Promise((resolve) => {
            if (!target) { resolve({ decision: 'skipped' }); return; }

            const row = target.createDiv('tool-approval-row install-prompt-row');

            const iconSpan = row.createSpan('tool-approval-icon');
            setIcon(iconSpan, 'download-cloud');

            const toolLabel = toolName === 'language-pack'
                ? t('ui.installPrompt.languagePackToolLabel')
                : this.formatToolLabel(toolName);
            const title = t('ui.installPrompt.title', {
                tool: toolLabel,
                asset: spec.label,
            });
            row.createSpan('tool-approval-text').setText(title);

            const explanation = row.createDiv('tool-approval-explanation');
            explanation.createSpan().setText(t('ui.installPrompt.body', {
                asset: spec.label,
                sizeMb: String(spec.sizeMb),
            }));

            const detailsToggle = row.createSpan({
                cls: 'tool-approval-details-toggle',
                text: t('ui.installPrompt.whatHappens'),
            });
            const detailsContainer = row.createDiv('tool-approval-details');
            const details = detailsContainer.createEl('pre', { cls: 'tool-approval-details-content' });
            details.setText(t('ui.installPrompt.details', {
                filename: spec.filename,
                sizeMb: String(spec.sizeMb),
                sha: spec.expectedSha256.slice(0, 16) + '...',
                url: spec.downloadUrl,
            }));
            detailsToggle.addEventListener('click', () => {
                const visible = detailsContainer.hasClass('is-visible');
                if (visible) {
                    detailsContainer.removeClass('is-visible');
                    detailsToggle.setText(t('ui.installPrompt.whatHappens'));
                } else {
                    detailsContainer.addClass('is-visible');
                    detailsToggle.setText(t('ui.installPrompt.hideDetails'));
                }
            });

            const statusEl = row.createDiv('tool-approval-explanation is-hidden');
            const actions = row.createDiv('tool-approval-actions');
            const installBtn = actions.createEl('button', {
                cls: 'tool-approval-btn approval-allow-once',
                text: t('ui.installPrompt.installNow', { sizeMb: String(spec.sizeMb) }),
            });
            const skipBtn = actions.createEl('button', {
                cls: 'tool-approval-btn approval-deny-small',
                text: '✕',
            });
            skipBtn.setAttr('title', t('ui.installPrompt.skipTooltip'));

            let done = false;
            const cleanup = () => { done = true; row.remove(); };

            installBtn.addEventListener('click', () => {
                void (async () => {
                    if (done) return;
                    installBtn.disabled = true;
                    skipBtn.disabled = true;
                    installBtn.setText(t('ui.installPrompt.downloading', { asset: spec.label }));
                    statusEl.removeClass('is-hidden');
                    statusEl.setText(t('ui.installPrompt.downloadingStatus'));
                    try {
                        const { OptionalAssetManager } = await import('../core/assets/OptionalAssetManager');
                        const manager = new OptionalAssetManager(this.plugin);
                        await manager.install(spec);
                        new Notice(t('notice.assets.installed', { label: spec.label }));
                        cleanup();
                        resolve({ decision: 'installed' });
                    } catch (e) {
                        const msg = e instanceof Error ? e.message : String(e);
                        installBtn.disabled = false;
                        skipBtn.disabled = false;
                        installBtn.setText(t('ui.installPrompt.retry'));
                        statusEl.setText(t('ui.installPrompt.failed', { error: msg }));
                        // Do not cleanup -- user can retry or skip.
                        // We only resolve on skip after a failed try so the
                        // model sees the error message via the tool's fallback.
                        skipBtn.onclick = () => {
                            cleanup();
                            resolve({ decision: 'failed', error: msg });
                        };
                    }
                })();
            });

            skipBtn.addEventListener('click', () => {
                cleanup();
                resolve({ decision: 'skipped' });
            });

            target.scrollTo({ top: target.scrollHeight });
        });
    }

    /**
     * ADR-153: the effect class comes from the central registry, not from a
     * local copy.
     *
     * A hand-maintained list used to sit here that had drifted from the
     * Pipeline: anything unknown fell back to 'note-edit'. Clicking "Always
     * allow" on e.g. a restore_checkpoint card therefore wrote
     * `autoApproval.noteEdits` -- a DIFFERENT permission from the one displayed
     * -- and did not even suppress the next prompt for the tool that was
     * clicked.
     */
    private getToolEffect(toolName: string, input: Record<string, unknown>): ToolEffect | 'unclassified' {
        return resolveToolEffect(toolName, input) ?? 'unclassified';
    }

    /**
     * The settings flag that "Always allow" would set for this effect.
     *
     * `null` means there is nothing to grant permanently, so the button is not
     * rendered at all. That covers `config` and `self-modify` (alwaysAsk --
     * otherwise the agent could unlock itself) and unclassified tools.
     */
    private effectToPermKey(
        effect: ToolEffect | 'unclassified',
        input?: Record<string, unknown>,
    ): string | null {
        if (effect === 'unclassified') return null;
        const policy = EFFECT_POLICY[effect];
        if (policy.alwaysAsk) return null;
        // FIX-44-03a: plugin-api read vs write hangs off the INPUT, exactly as
        // the gate resolves it. Granting the write flag for a read card (the old
        // hardcoded 'pluginApiWrite') handed the user a permission the card never
        // showed. Mirror the gate via the shared helper.
        if (effect === 'plugin-api') {
            return isPluginApiWriteCall(input, this.plugin.settings.pluginApi)
                ? 'pluginApiWrite'
                : 'pluginApiRead';
        }
        return policy.key;
    }

    // -------------------------------------------------------------------------
    // Checkpoint markers (Kilo Code pattern: CheckpointSaved.tsx)
    // -------------------------------------------------------------------------

    private renderCheckpointMarker(
        container: HTMLElement,
        checkpoint: import('../core/checkpoints/GitCheckpointService').CheckpointInfo,
    ): void {
        const marker = container.createDiv('checkpoint-marker');

        const iconEl = marker.createSpan('checkpoint-icon');
        setIcon(iconEl, 'git-commit-vertical');

        const label = marker.createSpan('checkpoint-label');
        const files = checkpoint.filesChanged.map((f) => f.split('/').pop()).join(', ');
        const newFileNames = checkpoint.newFiles?.map((f) => f.split('/').pop()).join(', ');
        const allFiles = [files, newFileNames].filter(Boolean).join(', ');
        // Locale-neutral like every other timestamp in this file (EPIC-42
        // ships a 9-locale UI; a hardcoded 'de-DE' leaked in here once).
        const time = new Date(checkpoint.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
        });
        label.setText(t('ui.checkpoint.label', { files: allFiles, time }));

        // Action buttons -- always visible, ghost-style, Lucide icons + Obsidian
        // tooltip via aria-label. Pattern adapted from Kilo Code's CheckpointMenu
        // (forked-kilocode/webview-ui/src/components/chat/checkpoints/CheckpointMenu.tsx):
        // three primary icon buttons inline, plus a "more" overflow with the
        // less common option (delete chat from here).
        const actions = marker.createDiv('checkpoint-actions');

        const diffBtn = this.makeCheckpointActionBtn(actions, 'file-diff', t('ui.checkpoint.action.diff'));
        diffBtn.addEventListener('click', () => {
            void this.showCheckpointDiff(checkpoint);
        });

        const undoThisBtn = this.makeCheckpointActionBtn(actions, 'undo-2', t('ui.checkpoint.undoThis'));
        undoThisBtn.addEventListener('click', () => {
            void this.restoreCheckpoint(checkpoint, marker, actions, false);
        });

        const undoFromHereBtn = this.makeCheckpointActionBtn(actions, 'rotate-ccw', t('ui.checkpoint.undoFromHere'));
        undoFromHereBtn.addEventListener('click', () => {
            void this.restoreCheckpointsForward(checkpoint, marker, actions);
        });

        const moreBtn = this.makeCheckpointActionBtn(actions, 'more-vertical', t('ui.checkpoint.action.more'));
        moreBtn.addEventListener('click', (ev) => {
            const menu = new Menu();
            menu.addItem((item) => {
                item.setTitle(t('ui.checkpoint.deleteFromHere'));
                item.setIcon('trash-2');
                item.onClick(() => {
                    void this.restoreCheckpoint(checkpoint, marker, actions, true);
                });
            });
            menu.showAtMouseEvent(ev);
        });
    }

    /**
     * Make a ghost icon button for the checkpoint marker action row. The
     * button has no border by default; styling lives on `.checkpoint-action-btn`.
     * The aria-label is what Obsidian renders as the tooltip on hover.
     */
    private makeCheckpointActionBtn(parent: HTMLElement, icon: string, tooltip: string): HTMLButtonElement {
        const btn = parent.createEl('button', { cls: 'checkpoint-action-btn' });
        btn.setAttribute('aria-label', tooltip);
        setIcon(btn, icon);
        return btn;
    }

    /**
     * "Undo all changes from here": restore the given checkpoint AND every
     * checkpoint that came after it in the same task. Equivalent to walking
     * the task's snapshot history forward from this point and rolling each
     * write back. Files are restored in reverse-chronological order so the
     * oldest (= pre-CP) content wins when multiple checkpoints touch the
     * same path.
     *
     * Takes a pre-restore snapshot of the union of affected files first so
     * the multi-step rollback can itself be undone via the next checkpoint
     * marker.
     */
    private async restoreCheckpointsForward(
        startCp: import('../core/checkpoints/GitCheckpointService').CheckpointInfo,
        marker: HTMLElement,
        optionsEl: HTMLElement,
    ): Promise<void> {
        // History hardening phase D (R10): a restore mid-run pushes [System]
        // messages into the live history the task is appending to.
        if (this.refuseWhileTaskRuns()) return;
        optionsEl.querySelectorAll('button').forEach((b) => (b.disabled = true));
        optionsEl.empty();
        optionsEl.setText(t('ui.checkpoint.restoring'));

        const service = this.plugin.checkpointService;
        if (!service) {
            optionsEl.setText(t('ui.checkpoint.error'));
            return;
        }

        try {
            const all = await service.loadCheckpointsForTask(startCp.taskId);
            const startIdx = all.findIndex((c) => c.commitOid === startCp.commitOid);
            if (startIdx < 0) {
                // Fall back to single-CP restore if we somehow can't locate the start
                console.warn('[Checkpoint] undoFromHere: start oid not in task list, falling back to single restore');
                await this.restoreCheckpoint(startCp, marker, optionsEl, false);
                return;
            }
            const tail = all.slice(startIdx);

            // Pre-restore snapshot: union of every file the multi-step rollback
            // will touch. Lets the user undo the undo via the next checkpoint
            // marker in the chat (the per-tool pipeline snapshot only covers
            // toolCall.input.path, which is irrelevant for a UI-triggered batch).
            const affected = new Set<string>();
            for (const cp of tail) {
                for (const f of cp.filesChanged) affected.add(f);
                for (const f of cp.newFiles ?? []) affected.add(f);
            }
            try {
                await service.snapshot(`restore-${Date.now()}`, [...affected], 'undo_from_here');
            } catch (e) {
                console.warn('[Checkpoint] Pre-restore snapshot failed (non-fatal):', e);
            }

            // Reverse chronological so older content overwrites newer for the
            // same path (later CPs hold the in-between state, the start CP
            // holds the original pre-task content for its files).
            const allRestored: string[] = [];
            const allErrors: string[] = [];
            for (const cp of [...tail].reverse()) {
                const result = await service.restore(cp);
                allRestored.push(...result.restored);
                allErrors.push(...result.errors);
            }

            optionsEl.remove();
            const successEl = marker.createSpan('checkpoint-restored');
            const unique = new Set(allRestored).size;
            successEl.setText(t('ui.checkpoint.restored', { count: unique }));

            if (unique > 0) {
                const restoredFiles = [...new Set(allRestored)].join(', ');
                this.conversationHistory.push({
                    role: 'user',
                    content: `[System] Multi-checkpoint undo: ${tail.length} checkpoint(s) rolled back from ${startCp.commitOid.slice(0, 8)} forward. Files: ${restoredFiles}. ${allErrors.length} error(s). Vault state changed.`,
                });
                this.saveCurrentConversation();
            }
        } catch (e) {
            console.error('[Checkpoint] undoFromHere failed:', e);
            optionsEl.setText(t('ui.checkpoint.failed'));
        }
    }

    /**
     * Execute a checkpoint restore with either "keep chat" or "delete chat from here".
     */
    private async restoreCheckpoint(
        checkpoint: import('../core/checkpoints/GitCheckpointService').CheckpointInfo,
        marker: HTMLElement,
        optionsEl: HTMLElement,
        deleteChatFromHere: boolean,
    ): Promise<void> {
        // History hardening phase D (R10): see restoreCheckpointsForward.
        if (this.refuseWhileTaskRuns()) return;
        optionsEl.querySelectorAll('button').forEach((b) => (b.disabled = true));
        optionsEl.empty();
        optionsEl.setText(t('ui.checkpoint.restoring'));

        try {
            console.debug('[Checkpoint] Restoring:', JSON.stringify(checkpoint, null, 2));
            const result = await this.plugin.checkpointService?.restore(checkpoint);
            console.debug('[Checkpoint] Result:', JSON.stringify(result, null, 2));
            if (!result || result.restored.length === 0) {
                optionsEl.setText(result?.errors?.length ? t('ui.checkpoint.error') : t('ui.checkpoint.nothingToRestore'));
                return;
            }

            optionsEl.remove();
            const successEl = marker.createSpan('checkpoint-restored');
            successEl.setText(t('ui.checkpoint.restored', { count: result.restored.length }));

            if (deleteChatFromHere) {
                this.deleteChatFromCheckpoint(marker);
            } else {
                const restoredFiles = result.restored.join(', ');
                const deletedNote = checkpoint.newFiles?.length
                    ? ` Deleted: ${checkpoint.newFiles.join(', ')}.`
                    : '';
                this.conversationHistory.push({
                    role: 'user',
                    content: `[System] Checkpoint restored. Files: ${restoredFiles}.${deletedNote} Vault state changed.`,
                });
            }

            this.saveCurrentConversation();
        } catch (e) {
            console.error('[Checkpoint] Restore failed:', e);
            optionsEl.setText(t('ui.checkpoint.failed'));
        }
    }

    /**
     * Remove the assistant message containing this checkpoint and all subsequent
     * messages from the DOM, uiMessages, and conversationHistory.
     */
    private deleteChatFromCheckpoint(marker: HTMLElement): void {
        if (!this.chatContainer) return;
        // History hardening phase D (FIX-03-20-04): truncating the live
        // arrays mid-run corrupted the running task's history.
        if (this.refuseWhileTaskRuns()) return;

        const assistantMsg = marker.closest('.assistant-message') ?? marker.closest('.message');
        if (!assistantMsg) return;

        const allMessages = Array.from(this.chatContainer.querySelectorAll('.message'));
        const idx = allMessages.indexOf(assistantMsg);
        if (idx < 0) return;

        // Count assistant bubbles before this one (for array truncation)
        const assistantBubblesBefore = allMessages
            .slice(0, idx)
            .filter((el) => el.classList.contains('assistant-message')).length;

        // Remove messages from DOM (this one + all after)
        for (let i = allMessages.length - 1; i >= idx; i--) {
            allMessages[i].remove();
        }

        // Truncate uiMessages at the corresponding assistant index
        const assistantIndices: number[] = [];
        this.uiMessages.forEach((m, i) => { if (m.role === 'assistant') assistantIndices.push(i); });
        const uiIdx = assistantIndices[assistantBubblesBefore];
        if (uiIdx !== undefined) {
            this.uiMessages.splice(uiIdx);
        }

        // Truncate conversationHistory at the corresponding assistant position
        let assistantCount = 0;
        for (let i = 0; i < this.conversationHistory.length; i++) {
            if (this.conversationHistory[i].role === 'assistant') {
                if (assistantCount === assistantBubblesBefore) {
                    this.conversationHistory.splice(i);
                    break;
                }
                assistantCount++;
            }
        }

        // Deliberate truncation: flag it AFTER the early returns (matching the
        // pencil path) so a bailed-out delete never leaves the flag set for an
        // unrelated later save to consume as a shrink-guard bypass (review F5).
        this.activeSession.historyTruncated = true;
        this.saveCurrentConversation();
    }

    /**
     * Open the EditReviewModal in checkpoint-mode for a single checkpoint
     * (read-only side-by-side + Restore button). EPIC-33 Diff-UX-refresh
     * (2026-06-22) replaced the section-accordion DiffReviewModal here so
     * inline + sidebar use one consistent surface.
     */
    private async showCheckpointDiff(
        checkpoint: import('../core/checkpoints/GitCheckpointService').CheckpointInfo,
    ): Promise<void> {
        const service = this.plugin.checkpointService;
        if (!service) return;

        const { showCheckpointReviewModal } = await import('./edit-review/EditReviewModal');
        const entries: import('./edit-review/EditReviewPanel').EditReviewEntry[] = [];

        for (const filePath of checkpoint.filesChanged) {
            const before = await service.getSnapshotContent(checkpoint, filePath);
            if (before === null) continue;

            let after = '';
            try {
                const file = this.app.vault.getFileByPath(filePath);
                if (file) after = await this.app.vault.read(file);
            } catch { /* file deleted */ }

            entries.push({ path: filePath, before, after });
        }

        if (entries.length === 0) return;

        showCheckpointReviewModal({
            app: this.app,
            entries,
            source: `Checkpoint ${new Date(checkpoint.timestamp).toLocaleString()}`,
            title: 'Checkpoint anzeigen',
            onRestore: async () => {
                // History hardening phase D (R10): no [System] pushes into a
                // history a live run is appending to.
                if (this.refuseWhileTaskRuns()) return;
                const result = await service.restore(checkpoint);
                if (result && result.restored.length > 0) {
                    const restoredFiles = result.restored.join(', ');
                    const deletedNote = checkpoint.newFiles?.length
                        ? ` Deleted: ${checkpoint.newFiles.join(', ')}.`
                        : '';
                    this.conversationHistory.push({
                        role: 'user',
                        content: `[System] Checkpoint restored. Files: ${restoredFiles}.${deletedNote} Vault state changed.`,
                    });
                }
            },
        });
    }

    // -------------------------------------------------------------------------
    // Checkpoint markers: rehydrate undo bars after chat history reload
    // -------------------------------------------------------------------------

    /**
     * FIX-01-07-02 / FIX-44-12: after loadConversation rebuilds the chat DOM,
     * rehydrate the checkpoint markers inline at the assistant message they
     * belong to. Markers are never part of toolStepsHtml (they render as
     * siblings of the steps block), so without this step a reloaded chat has
     * no markers at all.
     *
     * FIX-44-12: messages that persisted their markers (UiMessage.checkpoints)
     * get them back at their own bubble -- LIVE (verified against the shadow
     * repo, full Diff/Undo buttons) or EXPIRED (dimmed, tooltip) when the repo
     * no longer holds the snapshot (REF_RETENTION_DAYS pruning). Older
     * conversations without the field keep the legacy behavior: every loaded
     * checkpoint of a task at its last assistant bubble. The planning logic
     * lives in checkpointMarkerRehydration.ts (pure, tested).
     */
    private async rehydrateCheckpointMarkers(
        pairs: { msg: UiMessage; el: HTMLElement }[],
    ): Promise<void> {
        if (!(this.plugin.settings.enableCheckpoints ?? true)) return;
        const service = this.plugin.checkpointService;
        if (!service) return;

        try {
            const plan = await planCheckpointMarkerRehydration(
                pairs.map((p) => p.msg),
                (taskId) => service.loadCheckpointsForTask(taskId),
            );

            for (const [index, items] of plan) {
                const messageEl = pairs[index]?.el;
                if (!messageEl) continue;

                // Defensive: never render the same marker twice if rehydration
                // runs again over the same DOM.
                messageEl.querySelectorAll('.checkpoint-marker').forEach((el) => el.remove());

                const toolsEl = messageEl.querySelector<HTMLElement>('.message-tools') ?? messageEl;
                for (const item of items) {
                    if (item.kind === 'live') {
                        this.renderCheckpointMarker(toolsEl, item.checkpoint);
                    } else {
                        this.renderExpiredCheckpointMarker(toolsEl, item.marker);
                    }
                }
            }
        } catch (e) {
            console.warn('[Checkpoints] rehydrate failed:', e);
        }
    }

    /**
     * FIX-44-12: a persisted marker whose snapshot the shadow repo no longer
     * holds (pruned after REF_RETENTION_DAYS, deleted repo). Rendered dimmed,
     * without action buttons, with a tooltip saying why -- the honest version
     * of "this existed, but its undo data is gone". Dropping it silently made
     * users hunt for buttons that could never come back.
     */
    private renderExpiredCheckpointMarker(
        container: HTMLElement,
        marker: PersistedCheckpointMarker,
    ): void {
        const el = container.createDiv('checkpoint-marker checkpoint-marker-expired');
        el.setAttribute('aria-label', t('ui.checkpoint.snapshotExpired'));

        const iconEl = el.createSpan('checkpoint-icon');
        setIcon(iconEl, 'git-commit-vertical');

        const label = el.createSpan('checkpoint-label');
        const files = [...marker.filesChanged, ...(marker.newFiles ?? [])]
            .map((f) => f.split('/').pop())
            .filter(Boolean)
            .join(', ');
        // Locale-neutral, matching renderCheckpointMarker and the rest of
        // the file's timestamps.
        const time = new Date(marker.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
        });
        label.setText(t('ui.checkpoint.label', { files, time }));
    }

    // -------------------------------------------------------------------------
    // Post-task review: show all changes for review/undo after agent finishes
    // -------------------------------------------------------------------------

    private async showPostTaskReview(
        taskId: string,
        // FEAT-55-01 (isolation fix): the review's "[System] ... edited N
        // files" note must land in the RUN's conversation history, not the
        // active tab's. Non-run callers default to the active session.
        session: ChatSession = this.activeSession,
    ): Promise<void> {
        const service = this.plugin.checkpointService;
        if (!service) return;

        // FIX-44-16: the diff belongs BEFORE the write, not after it. A write the
        // user individually approved on its real diff must not be re-approved
        // here -- a second, weaker-looking approval is what misled a user into
        // thinking the POST-task modal was the gate.
        //
        // FIX-44-44: but "the user saw the diff at the gate" only holds for tools
        // with previewEdit. Name-only card approvals, settings-auto and run-scope
        // grants land with no diff surface at all, and they exist with the master
        // toggle OFF too. The caller therefore gates this method on the
        // pipeline's onUnreviewedWrite signal (taskHadUnreviewedWrites), not on
        // `autoApproval.enabled`. For those writes this review is the last line
        // of defence, and its explicit revert really does take the changes back.

        const checkpoints = service.getCheckpointsForTask(taskId);
        if (checkpoints.length === 0) return;

        // Collect the earliest checkpoint content per file (pre-task state)
        const fileOldContent = new Map<string, string>();
        for (const cp of checkpoints) {
            for (const filePath of cp.filesChanged) {
                if (!fileOldContent.has(filePath)) {
                    const content = await service.getSnapshotContent(cp, filePath);
                    if (content !== null) {
                        fileOldContent.set(filePath, content);
                    }
                }
            }
        }

        // Build entries: before = earliest checkpoint, after = current disk
        // state. EPIC-33 Diff-UX-refresh (2026-06-22) replaced the
        // section-accordion DiffReviewModal with the unified EditReviewModal
        // so inline + sidebar share a single review surface.
        // FIX-01-07-04: the after-state MUST come from an index-independent
        // read. vault.getFileByPath returns null for dot-paths (.obsidian/,
        // agent folder), which made the review show after='' and Apply then
        // zeroed the file through a raw adapter.write.
        const { readCurrentContent, applyReviewDecisions, revertReviewedFiles } = await import('./edit-review/postTaskReviewIO');
        const { showEditReviewModal } = await import('./edit-review/EditReviewModal');
        const entries: import('./edit-review/EditReviewPanel').EditReviewEntry[] = [];

        for (const [filePath, before] of fileOldContent) {
            const after = (await readCurrentContent(this.app, filePath)) ?? '';
            if (before === after) continue;
            entries.push({ path: filePath, before, after });
        }

        const newFiles = new Set<string>();
        for (const cp of checkpoints) {
            if (cp.newFiles) {
                for (const f of cp.newFiles) newFiles.add(f);
            }
        }
        for (const filePath of newFiles) {
            const after = await readCurrentContent(this.app, filePath);
            if (after) {
                entries.push({ path: filePath, before: '', after, isNew: true });
            }
        }

        if (entries.length === 0) return;

        const result = await showEditReviewModal({
            app: this.app,
            entries,
            title: t('ui.editReview.titleReview'),
            source: t('ui.editReview.sourceTask', { taskId }),
            // FIX-44-16: in a POST-task review the writes have already landed, so
            // "discard" cannot mean "do not write" -- it has to mean "take it
            // back". The label says so, and the handler below does so.
            discardLabel: t('ui.editReview.revertAll'),
        });

        // FIX-44-38: Esc / X / backdrop is NOT "Revert all". A user who merely
        // closes the review keeps every file exactly as the agent left it.
        if (result.outcome === 'dismissed') return;

        if (result.outcome === 'discarded') {
            // FIX-44-16: this used to be a bare `return`. The user pressed the
            // button that says the changes go away, and the changes stayed. The
            // pre-task content is right here in `entries`, so give it back.
            // FIX-44-38: only the EXPLICIT revert button lands here, and since it
            // destroys the agent's finished work it gets a confirm step.
            const ok = await confirmModal(this.app, {
                title: t('ui.editReview.confirmRevertTitle'),
                message: t('ui.editReview.confirmRevertBody', { count: entries.length }),
                confirmLabel: t('ui.editReview.revertAll'),
                destructive: true,
            });
            if (!ok) return; // keep everything
            const undone = await revertReviewedFiles(this.app, entries);
            if (undone.reverted.length > 0) {
                new Notice(t('ui.editReview.reverted', { count: undone.reverted.length }));
            }
            if (undone.failed.length > 0) {
                new Notice(t('ui.editReview.revertFailed', { paths: undone.failed.join(', ') }));
            }
            return;
        }
        if (result.decisions === null) return; // defensive: applied always carries decisions

        // FIX-01-07-04: only decisions the user actually changed are written,
        // through the atomic + empty-guarded path. An unchanged Apply is a
        // no-op instead of a rewrite of the displayed after-state.
        const reviewedAfter = new Map(entries.map(e => [e.path, e.after]));
        const outcome = await applyReviewDecisions(this.app, result.decisions, reviewedAfter);
        if (outcome.written.length > 0) {
            session.conversationHistory.push({
                role: 'user',
                content: `[System] Post-task review: User edited ${outcome.written.length} file(s): ${outcome.written.join(', ')}.`,
            });
        }
        // AUDIT 2026-07-07 PTR-2: guarded/failed decisions previously died in
        // the console -- the user edited, clicked Apply, the modal closed,
        // and the change was silently gone. Surface them.
        const notApplied = [...outcome.guarded, ...outcome.failed];
        if (notApplied.length > 0) {
            new Notice(t('ui.editReview.applyIncomplete', {
                count: notApplied.length,
                paths: notApplied.join(', '),
            }), 10000);
        }
    }

    // -------------------------------------------------------------------------
    // Undo bar (fallback when no checkpoint markers rendered)
    // -------------------------------------------------------------------------

    private showUndoBar(
        taskId: string,
        writeCount: number,
        // FEAT-55-01 (isolation fix): render the undo bar into the run's own
        // container. Non-run callers default to the active tab.
        container?: HTMLElement | null,
    ): void {
        const target = container ?? this.chatContainer;
        if (!target) return;
        const bar = target.createDiv('undo-bar');
        bar.createSpan('undo-label').setText(
            t('ui.undo.modified', { count: writeCount })
        );
        const undoBtn = bar.createEl('button', { cls: 'undo-btn', text: t('ui.undo.undoAll') });
        undoBtn.addEventListener('click', () => {
            void (async () => {
                undoBtn.disabled = true;
                undoBtn.setText(t('ui.undo.restoring'));
                console.debug(`[Undo] Attempting restore for taskId=${taskId} hasService=${!!this.plugin.checkpointService}`);
                try {
                    const result = await this.plugin.checkpointService?.restoreLatestForTask(taskId);
                    console.debug('[Undo] Restore result:', result);
                    bar.empty();
                    if (result && result.restored.length > 0) {
                        bar.createSpan('undo-success').setText(
                            t('ui.undo.restored', { count: result.restored.length })
                        );
                    } else {
                        bar.createSpan('undo-error').setText(t('ui.undo.noCheckpoint'));
                    }
                } catch {
                    bar.empty();
                    bar.createSpan('undo-error').setText(t('ui.undo.restoreFailed'));
                }
            })();
        });
        target.scrollTo({ top: target.scrollHeight });
    }

    /**
     * Format token count for display (e.g., 1500 → 1.5k, 1500000 → 1.5M)
     */
    private formatTokens(num: number): string {
        if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
        if (num >= 1_000) return (num / 1_000).toFixed(1) + 'k';
        return num.toString();
    }
}


/* eslint-enable -- end of file-level disable for boundary code (SDK/JSON/Obsidian internals) */
