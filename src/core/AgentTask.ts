/**
 * AgentTask - The Conversation Loop
 *
 * Adapted from Kilo Code's src/core/task/Task.ts (strongly simplified).
 *
 * Handles the agentic loop:
 * 1. Send user message to LLM
 * 2. Stream response (text + tool calls)
 * 3. Execute tool calls via ToolExecutionPipeline
 * 4. Add tool results back to conversation
 * 5. Loop until no more tool calls (end_turn)
 */

import type { ApiHandler, MessageParam, ContentBlock } from '../api/types';
import type { ToolRegistry } from './tools/ToolRegistry';
import type { ToolCallbacks, ToolName, ToolUse, ToolDefinition } from './tools/types';
import { ToolExecutionPipeline } from './tool-execution/ToolExecutionPipeline';
import { ToolRepetitionDetector } from './tool-execution/ToolRepetitionDetector';
import { summarizeForLedger } from './tool-execution/summarizeForLedger';
import { buildSystemPromptForMode, splitSystemPromptAtCacheBreakpoint } from './systemPrompt';
import { hashForTelemetry, type RequestTelemetryEntry, type RoutingMode } from './telemetry/TaskTelemetry';
import type { ModeService } from './modes/ModeService';
import type { ModeConfig, CustomModel } from '../types/settings';
import type { McpClient } from './mcp/McpClient';
import { BUILT_IN_MODES } from './modes/builtinModes';
import { TOOL_METADATA } from './tools/toolMetadata';
import { PROGRESSIVE_DISCLOSURE_META_TOOLS } from './tools/toolEffects';
import { sanitizeAndLog } from './utils/sanitizeHistoryForApi';
import { logInputBreakdown } from './utils/logInputBreakdown';
import { microcompactToolResults, shouldDeferMicrocompact } from './context/MicroCompactor';
import { computeAggregateBudgetChars, shrinkLargestHistoryToolResult } from './agent/toolResultBudget';
import { FileDossier } from './context/FileDossier';
import { MessageLog } from './history/MessageLog';
import { InflightStore } from './agent/InflightStore';
import { TokenEstimator } from './context/TokenEstimator';
import { stripPrunedForCondense } from './context/stripPrunedForCondense';
import { filterShadowedBuiltins } from './tools/shadowedByPlugin';
import { isDeferredTool } from './tools/toolMetadata';
import { getSubagentProfile } from './agent/subagent-profiles';
import { decideLoopErrorAction } from './agent/loopErrorPolicy';
import {
    appendUsageRecord,
    bookUsage,
    cloneLoopState,
    initLoopStateForRun,
    ledgerDivergence,
    longContextRequestModelIds,
    usageByModelFromLedger,
    type AgentLoopState,
    type UsageOrigin,
    type UsageRecord,
    type UsageTotals,
} from './agent/LoopState';
import { AgentLoopEngine, type CondensePorts } from './agent/AgentLoopEngine';
import { TodoAnchorInterceptor } from './agent/interceptors/TodoAnchorInterceptor';
import { RouterEscalationInterceptor } from './agent/interceptors/RouterEscalationInterceptor';
import { FastPathInterceptor } from './agent/interceptors/FastPathInterceptor';
import { PowerSteeringInterceptor } from './agent/interceptors/PowerSteeringInterceptor';
import { AdvisorReminderInterceptor } from './agent/interceptors/AdvisorReminderInterceptor';
import { abortableDelay, parseOutputCapLimit } from '../api/retry';
import { resolveOutputBudget, getModelContextWindow as registryContextWindow, computeReadBudgetChars } from '../types/model-registry';
import { learnOutputCap, learnEffortToolsUnsupported } from './agent/LearnedCapsStore';
import { requestRateLimiter } from '../api/RequestRateLimiter';
import { getHelperApi } from './helper-api';
import type { UsageByModel } from './pricing/ModelPricing';
import { shouldRunTaskRouter } from './routing/TaskRouter';
import { resolveLeanFlags } from './prompts/leanFlags';
import { buildApiHandlerForModel } from '../api';
import { getModelKey } from '../types/settings';
import { expandProviderConfigsToCustomModels } from './settings/expandProviderConfigs';
import { CompositionStackService } from './skills/CompositionStackService';
import { getPerformanceMarks } from './observability/PerformanceMarks';
import {
    DEFAULT_CONDENSING_ENABLED,
    DEFAULT_CONDENSING_THRESHOLD,
    DEFAULT_MICROCOMPACTION_ENABLED,
    DEFAULT_ROLLING_SUMMARY_THRESHOLD,
    MICROCOMPACT_MIN_FREED_TOKENS,
    MICROCOMPACT_PRESSURE_CEILING,
    MICROCOMPACT_MIN_HEADROOM_FRACTION,
} from './condensingDefaults';

/** FEAT-29-10: max composition-stack depth (skill -> skill / mcp chains). */
const COMPOSITION_MAX_DEPTH = 5;

/**
 * FIX-COMPACT-07: structured event emitted once per condense pass.
 * Receivers (TaskMonitor in the sidebar, offline analytics) persist these
 * to a JSONL so the threshold can be tuned against empirical data.
 */
export interface CondenseTelemetryEvent {
    /** Wall-clock start, ISO8601, of the helper-api call. */
    startedAt: string;
    /** ms from start to the success/failure decision. */
    durationMs: number;
    /** True when the splice ran; false on early-skip or helper-api failure. */
    success: boolean;
    /** Estimated history tokens BEFORE the splice (always recorded). */
    prevTokens: number;
    /** Estimated history tokens AFTER the splice (only meaningful on success). */
    newTokens: number;
    /** prevTokens - newTokens. Negative not possible (rounded to 0 on quirks). */
    savedTokens: number;
    /** True when getHelperApi returned a non-fallback handler. */
    helperModelUsed: boolean;
    /** Model id of the API that actually served the condense call (main or helper). */
    modelId: string;
    /** Tail size budget used for this pass (10k default, halved by retry loop). */
    maxTailTokens: number;
    /** When success=false, the truncated error message. */
    errorMessage?: string;
}

export interface AgentTaskCallbacks {
    /** Called at the start of each agentic loop iteration (0 = first/user message, 1+ = after tools) */
    onIterationStart?: (iteration: number) => void;
    /** Called for each streamed text chunk */
    onText: (text: string) => void;
    /** Called for each streaming reasoning/thinking chunk (extended thinking models) */
    onThinking?: (text: string) => void;
    /** Called when a tool is about to be executed */
    onToolStart: (name: string, input: Record<string, unknown>) => void;
    /** Called when a tool has finished executing */
    onToolResult: (name: string, content: string, isError: boolean) => void;
    /** Called with intermediate progress messages from long-running tools (e.g. ingest_template phase banners) */
    onToolProgress?: (name: string, content: string) => void;
    /**
     * Called with cumulative token usage just before onComplete (Feature 6).
     *
     * EPIC-26 / FEAT-26-01 / ADR-120: optional `routingMode` tags WHY this
     * call ran on the reported `modelId`. FIX-24-11-02 moved the union and its
     * four meanings to `RoutingMode` in telemetry/TaskTelemetry, so the callback,
     * the request row and the task row cannot drift apart.
     */
    onUsage?: (
        inputTokens: number,
        outputTokens: number,
        cacheReadTokens?: number,
        cacheCreationTokens?: number,
        modelId?: string,
        routingMode?: RoutingMode,
        /**
         * FIX-24-05-05: per-model breakdown of the reported totals. Mixed
         * tasks (advisor, subagents, escalation, helper condensing) carry
         * one bucket per model so consumers can price per model instead of
         * billing the whole sum at `modelId` rates.
         */
        usageByModel?: UsageByModel,
        /**
         * AUDIT-2026-08-27 I-5: models with at least one request that a
         * long-context tier bills above the base rate.
         *
         * The buckets above are sums, so a consumer pricing them gets the base
         * rate for every token, which is below the invoice for those requests.
         * Only the run's ledger still knows the request boundary, so the answer
         * travels with the numbers. It is a disclosure, not a re-pricing: a
         * tier-aware total is a separate read over the ledger (backlog
         * IMP-SEC-27-02) and would replace this argument.
         */
        longContextRequestModelIds?: string[],
    ) => void;
    /**
     * Live progress tally, fired after EVERY usage chunk (roughly once per API
     * turn) with the run's cumulative totals so far. Purely informational: it
     * exists so the UI can count tokens up while a run is in flight.
     *
     * Deliberately separate from `onUsage`, which stays the single
     * authoritative end-of-run report that drives cost, the footer and
     * telemetry. Those must not be recomputed per turn, and the totals here
     * exclude auxiliary usage (condensing, FastPath) that is merged in only at
     * the end -- so these numbers are a live lower bound, not a final bill.
     */
    onUsageProgress?: (
        inputTokens: number,
        outputTokens: number,
        cacheReadTokens: number,
        cacheCreationTokens: number,
    ) => void;
    /** Called when the task is complete (attempt_completion or natural end) */
    onComplete: () => void;
    /** Called when attempt_completion fires — triggers todo auto-complete */
    onAttemptCompletion?: () => void;
    /** Called when ask_followup_question is invoked — pauses loop until resolved */
    onQuestion?: (question: string, options: string[] | undefined, resolve: (answer: string) => void) => void;
    /** Called when a write tool needs user approval — pauses loop until user decides */
    onApprovalRequired?: (
        toolName: string,
        input: Record<string, unknown>,
        preview?: import('./tools/editPreview').EditPreview,
        batch?: import('./tools/editPreview').BatchEditPreview,
        // Content-hash grant (M-1 follow-up): set only for an unverified sandbox
        // script; carries the narrow hash key + script names the card banks.
        sandboxGrant?: import('./tool-execution/ToolExecutionPipeline').SandboxScriptGrantContext,
    ) => Promise<import('./tool-execution/ToolExecutionPipeline').ApprovalResult>;
    /**
     * Called when a tool needs an optional asset (office bundle, pdfjs
     * bundle, reranker WASM, ...) that is not installed. Renders an
     * in-chat install card and resolves once the user decides.
     * Obsidian policy: downloads only run behind an explicit user click.
     */
    onOptionalAssetRequired?: (
        spec: import('./assets/OptionalAssetManager').AssetSpec,
        toolName: string,
    ) => Promise<import('./tool-execution/ToolExecutionPipeline').OptionalAssetInstallResult>;
    /** Called when update_todo_list publishes a new todo plan */
    onTodoUpdate?: (items: import('./tools/agent/UpdateTodoListTool').TodoItem[]) => void;
    /** Called when switch_mode changes the active mode */
    onModeSwitch?: (newModeSlug: string) => void;
    /**
     * FEAT-24-08 / ADR-114 Steering-Hook: drained at the start of every
     * iteration. Returns user-typed mid-run messages that should be appended
     * to the conversation history before the next assistant turn. Each entry
     * becomes its own user-role message so message order is preserved.
     * Empty array means no steering pending.
     *
     * The iteration index is passed in so the UI can show the user which
     * iteration actually picked up their correction (pending -> delivered
     * state flip on the steering bubble).
     */
    consumeSteeringMessages?: (iteration: number) => string[];
    /** Called when the conversation history was condensed (context summarized) - includes token counts before/after */
    onContextCondensed?: (prevTokens?: number, newTokens?: number) => void;
    /**
     * FIX-COMPACT-02: fires when a condensing pass failed (helper API
     * threw, returned empty text, etc.). History is left untouched. The
     * UI can surface this so the user sees that condensing did NOT run
     * instead of silently looping into the same over-threshold state.
     */
    onContextCondenseFailed?: (error: Error) => void;
    /**
     * FIX-COMPACT-07: structured telemetry event for every condense pass
     * (success and failure). Receivers typically persist to a JSONL file
     * for offline tuning of the threshold and helper-model selection.
     */
    onCondenseTelemetry?: (event: CondenseTelemetryEvent) => void;
    /** Called when a checkpoint is saved before a write tool */
    onCheckpoint?: (checkpoint: import('./checkpoints/GitCheckpointService').CheckpointInfo) => void;
    /**
     * FIX-44-44: called when a write tool ran successfully WITHOUT an
     * individual diff approval (settings-auto, run-scope grant, or a
     * name-only card for a tool without previewEdit). The sidebar tracks
     * this per task to decide whether the post-task review must open.
     */
    onUnreviewedWrite?: (toolName: string) => void;
    /**
     * Called once per task in the finally-block with the complete episode
     * payload (ADR-133). The callback fires for every exit path
     * (success, iteration-cap, abort, error) so RecipePromotion sees the
     * full picture. Fields:
     *   - toolSequence / toolLedger: existing ADR-018 payload.
     *   - success: true when `turnOutcome === 'accept'` AND
     *     `mistakesEncountered === 0` AND (`attemptCompletionFired` OR
     *     the turn was a clean natural exit -- streamed text, used at
     *     least one tool, no errors, no iteration-cap hit). The natural-
     *     exit branch covers read-only / question tasks where the prompt
     *     deliberately steers the model away from attempt_completion.
     *   - mistakesEncountered: total tool errors during the loop.
     *   - attemptCompletionFired: whether the model called attempt_completion.
     *   - fastPathFired: whether the ADR-061 FastPath block ran successfully.
     *   - recipeWinner: RecipeStore id of the recipe FastPath executed this
     *     turn, or null. Feeds the recipe-win gate in RecipePromotionService
     *     (success-count bump instead of duplicate promotion).
     */
    onEpisodeData?: (data: {
        toolSequence: string[];
        toolLedger: string;
        success: boolean;
        mistakesEncountered: number;
        attemptCompletionFired: boolean;
        fastPathFired: boolean;
        recipeWinner: string | null;
    }) => void;
    /** Called before context condensing to flush important facts to memory (Phase 5) */
    onPreCompactionFlush?: (history: MessageParam[]) => Promise<void>;
    /** Called when an unrecoverable error occurs */
    onError: (error: Error) => void;
    /**
     * ADR-090 Lever 10: Telemetry hook fired exactly once per task at the very
     * end with all aggregated stats (tokens, tool sequence, outcome). The
     * receiver decides where to persist (typically TaskTelemetry.record).
     */
    onTaskTelemetry?: (data: {
        /**
         * FIX-24-11-01: the run's id, from AgentTaskRunConfig.taskId, i.e. the
         * same value emitRequestTelemetry stamps on every request row. This is
         * what makes tasks.jsonl and requests.jsonl joinable.
         */
        taskId: string;
        /**
         * FIX-24-11-02: why this run's model was chosen, from the same binding
         * the request rows get it from. The receiver forwards it into the task
         * record; before this, the record said which model ran and never why.
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
    }) => void;
    /**
     * FEAT-24-11: fires once per main-loop API request with that request's
     * own token numbers and what could have moved the cached prefix in the
     * turn (prompt-part hashes, prunes, condense, steering). Optional; the
     * receiver persists (TaskMonitor -> requests.jsonl).
     */
    onRequestTelemetry?: (data: RequestTelemetryData) => void;
}

/** FEAT-24-11: payload of onRequestTelemetry. Same shape as the persisted line. */
export type RequestTelemetryData = RequestTelemetryEntry;

/**
 * Configuration for AgentTask.run().
 * Replaces 15+ positional parameters with a structured config object.
 */
export interface AgentTaskRunConfig {
    userMessage: string | ContentBlock[];
    taskId: string;
    initialMode: string | ModeConfig;
    history: MessageParam[];
    abortSignal?: AbortSignal;
    globalCustomInstructions?: string;
    includeTime?: boolean;
    rulesContent?: string;
    /**
     * FEAT-24-09 / ADR-116: stable SKILLS directory for the cached
     * system-prompt prefix (name + description per skill, plus inventory
     * lines for self-authored skills). Replaces the per-message-classified
     * `skillsSection` and the dynamic `selfAuthoredSkillsSection`. The
     * model loads a skill body on demand via the `read_skill` tool.
     */
    skillDirectorySection?: string;
    mcpClient?: McpClient;
    allowedMcpServers?: string[];
    memoryContext?: string;
    pluginSkillsSection?: string;
    recipesSection?: string;
    configDir?: string;
    /** Active conversation ID for chat-linking frontmatter stamping (ADR-022) */
    conversationId?: string;
    /**
     * FEAT-55-02 (ADR-170): run-scoped chat-attachment texts for this run.
     * The sidebar passes the consumed full-doc texts here instead of setting
     * them on the shared read_document / ingest_document tool singletons, so
     * two parallel chats cannot share or wipe each other's attachments.
     */
    attachmentTexts?: string[];
    /**
     * IMP-41-03-01: resume a task from an inflight snapshot. The loop
     * continues with the NEXT iteration after the snapshot (budgets,
     * mistake counters and usage totals carry over). The caller passes the
     * snapshot's history as `history` and a short resume note as
     * `userMessage`.
     */
    resumeState?: import('./agent/LoopState').AgentLoopState;
    /**
     * FEAT-24-04 / ADR-113: when set, this subagent runs with a profile
     * roleDefinition that REPLACES `mode.roleDefinition` in the system
     * prompt. Used only by spawnSubtask when `new_task` was called with
     * `profile='...'`.
     */
    subagentRoleOverride?: string;
    /**
     * FEAT-24-04 / ADR-113: when set, this subagent's tool list is
     * restricted to these names (subset of the parent's mode tool set).
     * Used only by spawnSubtask when `new_task` was called with `profile='...'`.
     */
    subagentAllowedTools?: ToolName[];
    /**
     * FEAT-44-02: the parent run's approved-effects set, shared so "for the rest
     * of this run" survives into a subtask / invoked skill. The child pipeline
     * adopts this exact Set; alwaysAsk effects can never be in it.
     */
    parentRunApprovedEffects?: import('./tool-execution/ToolExecutionPipeline').RunGrantStore;
    /**
     * FEAT-32-01 PR 1.3 / ADR-131: pre-computed recipe matches for the user
     * message. When set, AgentTask uses these instead of calling
     * `recipeMatchingService.match()` itself, so the Sidebar and the
     * AgentTask see the SAME match (no embedding-lookup drift between
     * `recipesSection` build and FastPath gate). Optional: subagent paths
     * pass `undefined` and AgentTask falls back to an inline match.
     */
    recipeMatches?: import('./mastery/RecipeMatchingService').RecipeMatchResult[];

    // -- EPIC-33 / ADR-138 PR-1.3 Override-Felder ----------------------
    /**
     * EPIC-33 ADR-138 PR-1.3: per-turn model override. When set the
     * Runner/AgentTask uses this model id instead of the main-chat
     * default. Used by FEAT-33-10 Per-Action-Pin and by the Sidebar
     * model-switcher to push the override through the same config
     * layer all callers share.
     *
     * Currently informational on the config path; the actual override
     * is still resolved via buildApiHandlerForModel(model) BEFORE the
     * AgentTask is constructed. This field exists so future callers
     * (Inline-Actions, headless CLI) can declare intent in one place.
     */
    modelOverride?: string;
    /**
     * EPIC-33 ADR-138 PR-1.3: per-turn thinking-mode override (extended
     * thinking on/off, budget tokens). Informational on the config
     * path -- providers honour this via the API-Handler config.
     */
    thinkingOverride?: { enabled: boolean; budgetTokens?: number };
    /**
     * EPIC-33 ADR-138 PR-1.3: per-turn reasoning-effort override
     * (low/medium/high/auto). Informational on the config path.
     */
    effortOverride?: 'low' | 'medium' | 'high' | 'auto';
}

/**
 * FIX-24-05-03: only the root task (depth 0) forwards subtask usage
 * reports upward -- there the receiver is the UI, which renders but does
 * not accumulate. Intermediate tasks must NOT forward: their own final
 * report already contains the accumulated child tokens, so forwarding as
 * well counted grandchild tokens twice in the root totals.
 */
export function shouldForwardSubtaskUsage(depth: number): boolean {
    return depth === 0;
}

/**
 * FIX-24-11-02: the label on a forwarded child usage report, i.e. why that
 * report names a model the main loop is not running.
 *
 * `ranOnItsOwnModel` is the fact that matters and it is not derivable from the
 * profile: `new_task` with an explicit `model_key` (Issue #54.4.1) builds its own
 * handler without any profile, and a profile whose tier slot is unconfigured
 * falls back to the parent's handler. The old expression looked at the profile
 * alone, so the model_key case reported no mode and the cost line printed
 * `mode=auto` beside a foreign model id, which reads as a mid-run model switch
 * in the main loop.
 *
 * `undefined` stays meaningful: a child that inherited the parent's handler spent
 * the parent's model at the parent's rate, so it needs no separate explanation.
 */
export function spawnRoutingMode(
    profileName: string | undefined,
    ranOnItsOwnModel: boolean,
): 'advisor' | 'subagent' | undefined {
    if (profileName === 'advisor') return 'advisor';
    if (profileName !== undefined || ranOnItsOwnModel) return 'subagent';
    return undefined;
}

/**
 * FEAT-24-13 (D4): the child's report as ledger records for the parent.
 *
 * The child reports twice over: its token counts and its own per-model split.
 * The split is the better source, because a child that ran several models is
 * only priceable per model, but it can be absent (a hand-built handler, an
 * intermediate level that reported nothing) or empty. It used to be chosen by
 * `if (childUsageByModel)`, which is true for `{}`, so the else-branch never
 * ran: an empty split meant the tokens reached the parent's counts and never
 * reached the split that prices them.
 *
 * Choosing by how many records the split actually yields removes that class of
 * mistake. Whatever the input, the returned records sum to `scalars`.
 */
export function subtaskUsageRecords(
    scalars: UsageTotals,
    childUsageByModel: UsageByModel | undefined,
    reportedModelId: string | undefined,
    iteration: number,
): UsageRecord[] {
    const records: UsageRecord[] = Object.entries(childUsageByModel ?? {}).map(([modelId, u]) => ({
        modelId,
        input: u.input,
        output: u.output,
        cacheRead: u.cacheRead,
        cacheCreation: u.cacheCreation,
        source: 'subtask' as const,
        iteration,
    }));
    if (records.length > 0) return records;
    return [{
        modelId: reportedModelId ?? '',
        input: scalars.input,
        output: scalars.output,
        cacheRead: scalars.cacheRead,
        cacheCreation: scalars.cacheCreation,
        source: 'subtask',
        iteration,
    }];
}

export class AgentTask {
    private api: ApiHandler;
    private toolRegistry: ToolRegistry;
    private taskCallbacks: AgentTaskCallbacks;
    private modeService?: ModeService;
    /** Stop after this many consecutive tool errors (0 = disabled). */
    private consecutiveMistakeLimit: number;
    /** Minimum ms to wait between iterations (0 = disabled). */
    private rateLimitMs: number;
    /** Enable automatic conversation condensing when context fills up. */
    private condensingEnabled: boolean;
    /** Trigger condensing when estimated tokens exceed this % of the model's context window. */
    private condensingThreshold: number;
    /**
     * Power Steering: inject a mode-reminder user message every N iterations (0 = disabled).
     * Helps the model stay on task during very long agentic loops.
     */
    private powerSteeringFrequency: number;
    /** Maximum iterations per message (prevents runaway loops). */
    private maxIterations: number;
    /** Current nesting depth (0 = root task, 1 = first child, etc.). */
    private depth: number;
    /** Maximum allowed sub-agent nesting depth. Children at this depth cannot spawn further. */
    private maxSubtaskDepth: number;
    /**
     * FIX-24-05-04: spend by auxiliary LLM calls (context condensing, FastPath
     * planner, FIX-24-05-09: tool-made calls) that stream outside the main
     * loop. Drained into the run's ledger at the exit, so footer and telemetry
     * include them.
     *
     * FEAT-24-13: one buffer of records instead of a scalar quadruple plus a
     * bucket map. Condensing is reachable outside run() (the emergency pass and
     * the focused tests call the method directly), so the aux channel cannot
     * write straight into the loop state; it buffers here and reportFinalUsage
     * books it. Both halves therefore still move at the same instant, which is
     * what kept them consistent before and what keeps them consistent now.
     */
    private auxRecords: UsageRecord[] = [];

    /**
     * FIX-24-05-09 (D10): the single fold for every auxiliary LLM call of this
     * run -- condensing, the FastPath planner, and anything a tool reports
     * through `ToolExecutionContext.reportAuxUsage`.
     *
     * FEAT-24-13: it books ONE record. There used to be two accumulators to
     * keep in step (the scalar totals the footer counts and the per-model
     * buckets that price them), so every new aux path was a fresh chance to
     * update one and forget the other. A record carries both halves at once.
     *
     * `iteration` is -1 when no numbered main-loop iteration is in scope, which
     * is the case for condensing (a method, callable outside run()).
     */
    private foldAuxUsage(
        u: {
            modelId: string;
            inputTokens: number;
            outputTokens: number;
            cacheReadTokens: number;
            cacheCreationTokens: number;
        },
        source: UsageOrigin = 'tool',
        iteration = -1,
    ): void {
        this.auxRecords.push({
            modelId: u.modelId,
            input: u.inputTokens,
            output: u.outputTokens,
            cacheRead: u.cacheReadTokens,
            cacheCreation: u.cacheCreationTokens,
            source,
            iteration,
        });
    }

    /**
     * IMP-41-01-04 / ADR-148: per-task calibrated chars-per-token factor.
     * Fed by every usage chunk; consumed by estimateMessageTokens so the
     * condensing trigger and output-budget clamping track real token rates.
     */
    private tokenEstimator = new TokenEstimator();

    /**
     * IMP-41-02-01b / ADR-145: engine owning the stream-consume phase.
     * Stateless between turns; further loop phases migrate here in stages.
     */
    private loopEngine = new AgentLoopEngine();

    /**
     * IMP-41-03-06: per-file dossier surviving condense cycles. Fed by the
     * MicroCompactor at prune time, rendered into every condense summary.
     */
    private fileDossier = new FileDossier();

    /**
     * IMP-41-03-04 (shadow mode): pre/post-condense history snapshots,
     * bounded to 3 generations. Makes a mis-condensed session
     * reconstructable — the previously impossible diagnosis case.
     *
     * FULL log ownership of the live history is DEFERRED (decision
     * 2026-07-04, safe subset shipped instead). Preconditions before the
     * switchover can happen:
     *  1. the sidebar gets a single read/write boundary (PLAN-42 PR-1.2
     *     SidebarMessageRenderer) — today it aliases config.history and
     *     persists it by reference, including mid-run via onClose(),
     *  2. run() gets a final-history channel (return value or an
     *     onHistoryRewritten callback) — the aliased array is currently
     *     the ONLY way the final transcript reaches persistence,
     *  3. MicroCompactor reroutes through a log API instead of mutating
     *     tool_result contents in place.
     * Then: an attached-live mode (MessageLog.attach(live)) as bridge
     * generation before full copy-isolation.
     */
    private condenseForensics = new MessageLog();

    /** Diagnostic surface (read_agent_logs): the retained pre/post-condense generations. */
    getCondenseTimeline(): ReturnType<MessageLog['dumpTimeline']> {
        return this.condenseForensics.dumpTimeline();
    }

    /**
     * IMP-41-03-01: optional inflight snapshot store. When set (foreground
     * tasks via the Runner), every turn boundary persists { state, history }
     * so a crash mid-run leaves recoverable data instead of losing the turn.
     */
    private inflightStore: InflightStore | null = null;

    setInflightStore(store: InflightStore | null): void {
        this.inflightStore = store;
    }

    /** FIX-24-05-04: hand out the collected auxiliary usage exactly once. */
    private drainAuxUsage(): UsageRecord[] {
        const records = this.auxRecords;
        this.auxRecords = [];
        return records;
    }

    /**
     * FEAT-24-13: the invariant that replaces the six parallel running totals.
     *
     * The ledger and the scalars are two views of the same spend, so their sums
     * are equal or one of the booking sites is broken. Checked at every exit, on
     * the run's own numbers, before anything is displayed. It warns rather than
     * throws: a wrong cost display is not worth losing a finished run over, and
     * the test suite asserts the same predicate (ledgerDivergence) so a
     * regression fails there instead of only in a log.
     */
    private checkUsageLedger(loopState: AgentLoopState, exit: string): void {
        const drift = ledgerDivergence(loopState);
        if (!drift) return;
        console.warn(
            `[AgentTask] usage ledger disagrees with the totals at the ${exit} exit `
            + `(scalars minus ledger: in=${drift.input} out=${drift.output} `
            + `cacheR=${drift.cacheRead} cacheW=${drift.cacheCreation}). `
            + 'The per-model split prices less (or more) than the token counts show.',
        );
    }

    /**
     * FIX-24-11-02: why THIS run's model was chosen. The single source for all
     * three channels that state it (the usage report, every request row, every
     * task row), so a reader cannot find two answers for one run.
     *
     * Only the two main-loop labels can come out of here. `advisor` and
     * `subagent` describe a spawned child and are attached where the child's
     * usage is forwarded, not to the run's own decision.
     */
    private routingModeForRun(): RoutingMode {
        // EPIC-26 / FEAT-26-05: an explicit chat-header pin switches the tier
        // resolver off, which is exactly the difference the label carries.
        return this.modelOverrideActive ? 'override' : 'auto';
    }

    /**
     * FIX-24-05-06: the single writer of the cost line, called at EVERY exit
     * of run() -- success, abort, error, and the abort during a retry wait.
     * Before this, abort and error exits reported only telemetry, so the
     * footer kept whatever was reported last (typically an inner subagent's
     * tokens under that subagent's model name) and the persisted record kept
     * that model id too.
     *
     * The auxiliary usage (helper-model condensing, FastPath planner, tool
     * calls) is booked into the run's ledger HERE, before the report. Every
     * consumer after this call -- footer and telemetry line alike -- then reads
     * the same numbers off loopState, so the two can no longer disagree about
     * which half of the run they describe.
     *
     * Two of the four callers sit inside the catch block, where the run still
     * owes the UI an onError / onComplete. A throwing cost display must not
     * take that teardown down with it, so the hook is guarded the same way
     * onEpisodeData is.
     */
    private reportFinalUsage(loopState: AgentLoopState, exit = 'success'): void {
        // FEAT-24-13: one call books both halves, so the drained records cannot
        // reach the totals without reaching the per-model split too.
        for (const record of this.drainAuxUsage()) bookUsage(loopState, record);
        this.checkUsageLedger(loopState, exit);
        if (loopState.totalInputTokens <= 0 && loopState.totalOutputTokens <= 0) return;
        try {
            this.taskCallbacks.onUsage?.(
                loopState.totalInputTokens,
                loopState.totalOutputTokens,
                loopState.totalCacheReadTokens > 0 ? loopState.totalCacheReadTokens : undefined,
                loopState.totalCacheCreationTokens > 0 ? loopState.totalCacheCreationTokens : undefined,
                // v2.10.2: the model id from the api that actually served this
                // task, so the footer prices the call correctly even when
                // TaskRouter routed it onto the helper model.
                this.api.getModel().id,
                // EPIC-26 / FEAT-26-05: cost-log mode-tag at the root-task
                // boundary. Subtask onUsage already tags advisor/subagent calls
                // separately; here we mark whether the main loop ran on the
                // chat-override path or the default tier-resolved path.
                // FIX-24-11-02: one producer for it, shared with both logs.
                this.routingModeForRun(),
                // FIX-24-05-05: per-model breakdown for correct pricing of
                // mixed-model tasks.
                // FEAT-24-13: derived from the ledger, not accumulated beside
                // it. A resumed run's earlier legs are in the ledger, so they
                // are in the split the footer prices (D2).
                usageByModelFromLedger(loopState.usage),
                // AUDIT-2026-08-27 I-5: and what those sums cannot express. Read
                // from the same ledger, so the disclosure and the number it
                // qualifies can never describe different halves of the run.
                longContextRequestModelIds(loopState.usage),
            );
        } catch (e) {
            console.warn('[AgentTask] onUsage hook failed (non-fatal):', e);
        }
    }

    /**
     * FEAT-24-02 (ADR-12 amendment): prune old tool_result contents to skeletons
     * at turn boundaries. Additive to the keep-first-last full condensing.
     */
    private microcompactionEnabled: boolean;
    /**
     * FEAT-24-11: what happened to the cached prefix since the previous API
     * request. Read and reset when the per-request telemetry record is
     * emitted, so each line says what could have caused ITS cache writes.
     */
    private prunedBlocksSinceLastRequest = 0;
    private condensedSinceLastRequest = false;
    private steeringSinceLastRequest = false;
    /**
     * FEAT-24-02: fold the oldest part of the conversation into a running summary
     * once the estimated tokens exceed this % of the context window — earlier and
     * gentler than the keep-first-last full condensing (`condensingThreshold`).
     * Effective only when below `condensingThreshold`. Generous default so short
     * sessions are never touched.
     */
    private rollingSummaryThreshold: number;
    /**
     * EPIC-26 / FEAT-26-05 / ADR-120: per-turn user override active.
     * When true, the loop runs on an explicitly-chosen chat model
     * (not the tier-resolved default) AND `consult_flagship` is filtered
     * out of the tool schema for this task. Cost-log mode-tag becomes
     * `override`.
     */
    private modelOverrideActive: boolean;
    /**
     * FEAT-29-10 Composability: shared cycle + depth tracker for
     * invoke_skill / invoke_mcp_server. The top-level task creates a
     * new instance; spawned subtasks inherit the parent's stack by
     * reference so the chain is visible across hops.
     */
    private compositionStack: CompositionStackService;

    constructor(
        api: ApiHandler,
        toolRegistry: ToolRegistry,
        taskCallbacks: AgentTaskCallbacks,
        modeService?: ModeService,
        consecutiveMistakeLimit = 0,
        rateLimitMs = 0,
        condensingEnabled = DEFAULT_CONDENSING_ENABLED,
        condensingThreshold = DEFAULT_CONDENSING_THRESHOLD,
        powerSteeringFrequency = 0,
        maxIterations = 25,
        depth = 0,
        maxSubtaskDepth = 2,
        microcompactionEnabled = DEFAULT_MICROCOMPACTION_ENABLED,
        rollingSummaryThreshold = DEFAULT_ROLLING_SUMMARY_THRESHOLD,
        modelOverrideActive = false,
        compositionStack?: CompositionStackService,
    ) {
        this.api = api;
        this.toolRegistry = toolRegistry;
        this.taskCallbacks = taskCallbacks;
        this.modeService = modeService;
        this.consecutiveMistakeLimit = consecutiveMistakeLimit;
        this.rateLimitMs = rateLimitMs;
        this.condensingEnabled = condensingEnabled;
        this.condensingThreshold = condensingThreshold;
        this.powerSteeringFrequency = powerSteeringFrequency;
        this.maxIterations = maxIterations;
        this.depth = depth;
        this.maxSubtaskDepth = maxSubtaskDepth;
        this.microcompactionEnabled = microcompactionEnabled;
        this.rollingSummaryThreshold = rollingSummaryThreshold;
        this.modelOverrideActive = modelOverrideActive;
        this.compositionStack = compositionStack ?? new CompositionStackService(COMPOSITION_MAX_DEPTH);
    }

    /**
     * FEAT-24-02: at a turn boundary, prune old tool_result contents to skeletons.
     * Idempotent and cheap (no LLM call). Logs when it actually freed something.
     */
    /**
     * FIX-24-03-05 / ADR-157 defence line 2: make sure the projected
     * request fits the model window BEFORE it is sent. Ladder: (1)
     * microcompact skeleton-prune, (2) full condense, (3) shrink the
     * largest history tool_result in place (offset hint for vault
     * reads). Tail-protection constants are untouched -- stage 3 targets
     * one block surgically instead of loosening the global guards. The
     * emergency path after a provider 400 stays as the final net.
     */
    private async ensureRequestFitsWindow(
        history: MessageParam[],
        overheadChars: number,
        condense: () => Promise<boolean>,
    ): Promise<void> {
        const window = this.getModelContextWindow();
        if (window <= 0) return;
        const overheadTokens = this.tokenEstimator.tokensForChars(overheadChars);
        const projected = () => this.estimateTokens(history) + overheadTokens;
        if (projected() < window) return;

        console.debug(
            `[AgentTask] pre-request gate: projected ${projected()} tokens >= window ${window} -- compacting proactively`,
        );
        this.microcompact(history);
        if (projected() < window) return;
        await condense();
        // Stage 3: shrink the largest results until it fits or nothing
        // shrinkable is left (each call frees >0 or returns 0 -- bounded).
        while (projected() >= window) {
            const excessChars = (projected() - window + 1_000) * 4;
            if (shrinkLargestHistoryToolResult(history, excessChars) === 0) break;
        }
    }

    /**
     * FEAT-24-11: build the per-request telemetry line from this request's
     * token delta and the prefix-moving events since the previous request,
     * then reset those counters. Pure bookkeeping; never throws into the loop.
     */
    private emitRequestTelemetry(args: {
        taskId: string;
        iteration: number;
        systemPrompt: string;
        historyMessages: number;
        toolsSent: number;
        delta: { input: number; output: number; cacheRead: number; cacheCreation: number };
    }): void {
        const hook = this.taskCallbacks.onRequestTelemetry;
        const pruned = this.prunedBlocksSinceLastRequest;
        const condensed = this.condensedSinceLastRequest;
        const steering = this.steeringSinceLastRequest;
        this.prunedBlocksSinceLastRequest = 0;
        this.condensedSinceLastRequest = false;
        this.steeringSinceLastRequest = false;
        if (!hook) return;
        try {
            const { stable, volatile } = splitSystemPromptAtCacheBreakpoint(args.systemPrompt);
            hook({
                at: new Date().toISOString(),
                taskId: args.taskId,
                iteration: args.iteration,
                modelId: this.api.getModel().id,
                // FIX-24-11-02: which model served this request was already
                // here; why it did was not, so the per-request table could not
                // tell a pinned model from a resolved one.
                routingMode: this.routingModeForRun(),
                inputTokens: args.delta.input,
                outputTokens: args.delta.output,
                cacheReadTokens: args.delta.cacheRead,
                cacheCreationTokens: args.delta.cacheCreation,
                historyMessages: args.historyMessages,
                toolsSent: args.toolsSent,
                prunedBlocksThisTurn: pruned,
                condensedThisTurn: condensed,
                steeringInjected: steering,
                stableSystemHash: hashForTelemetry(stable),
                volatileTailHash: hashForTelemetry(volatile),
            });
        } catch (e) {
            console.warn('[AgentTask] request telemetry failed (non-fatal):', e);
        }
    }

    private microcompact(history: MessageParam[]): void {
        if (!this.microcompactionEnabled) return;
        // FIX-COMPACT-09 (extended 2026-07-05): a prune rewrites history before
        // the stable cache breakpoint and invalidates the prompt-cache prefix.
        // Probe first and run the economy guard at ALL sub-ceiling pressures --
        // the old code only probed below a 0.60 floor and pruned unconditionally
        // above it, busting the cache every turn exactly where the rebuild is
        // most expensive (the 0.80 EUR daily-briefing driver).
        const pressure = this.estimateTokens(history) / this.getModelContextWindow();
        const probe = microcompactToolResults(history, { dryRun: true });
        const wouldFree = this.tokenEstimator.tokensForChars(probe.freedCharsApprox);
        if (shouldDeferMicrocompact({
            pressure,
            wouldFreeTokens: wouldFree,
            pressureCeiling: MICROCOMPACT_PRESSURE_CEILING,
            minFreedTokens: MICROCOMPACT_MIN_FREED_TOKENS,
            minHeadroomFraction: MICROCOMPACT_MIN_HEADROOM_FRACTION,
        })) {
            if (probe.prunedBlocks > 0) {
                console.debug(
                    `[Microcompact] deferred: would free only ~${wouldFree} tokens ` +
                    `at ${(pressure * 100).toFixed(0)}% context (cache-prefix protection)`,
                );
            }
            return;
        }
        // IMP-41-03-06: pruning feeds the per-file dossier -- the durable
        // memory the flat condense summary lacks.
        const { prunedBlocks, freedCharsApprox } = microcompactToolResults(history, { dossier: this.fileDossier });
        // FEAT-24-11: a prune rewrites history before the cache breakpoint;
        // the next request's telemetry line must be able to say so.
        this.prunedBlocksSinceLastRequest += prunedBlocks;
        if (prunedBlocks > 0) {
            console.debug(
                `[Microcompact] pruned ${prunedBlocks} tool_result block(s), ` +
                `freed ~${Math.round(freedCharsApprox / 4)} tokens`,
            );
        }
    }

    /**
     * FEAT-24-02 second stage: when the history sits between the rolling-summary
     * mark and the full-condensing threshold, fold the oldest part into a summary
     * once (no retry loop — that's the keep-first-last path's job). Returns true
     * if a rolling summary ran.
     */
    private async maybeRollingSummary(
        history: MessageParam[],
        systemPrompt: string,
        estimatedTokens: number,
        threshold: number,
        contextWindow: number,
        abortSignal: AbortSignal | undefined,
        toolCallLedger: string | undefined,
    ): Promise<boolean> {
        if (!this.microcompactionEnabled || history.length < 7) return false;
        const rollingMark = Math.floor(contextWindow * (Math.min(this.rollingSummaryThreshold, this.condensingThreshold) / 100));
        if (estimatedTokens <= rollingMark || estimatedTokens > threshold) return false;
        await this.taskCallbacks.onPreCompactionFlush?.(history).catch((e) =>
            console.warn('[AgentTask] Pre-compaction flush (rolling) failed (non-fatal):', e)
        );
        console.debug(`[AgentTask] Rolling summary at ~${estimatedTokens}t (mark ${rollingMark}t, full threshold ${threshold}t)`);
        return await this.condenseHistory(history, systemPrompt, abortSignal, toolCallLedger);
    }

    /**
     * Run the agentic conversation loop.
     * Adapted from Kilo Code's Task.ts attemptApiRequest() and main loop.
     *
     * Accepts an AgentTaskRunConfig object for clean parameter passing.
     */
    async run(config: AgentTaskRunConfig): Promise<void> {
        const {
            userMessage,
            taskId,
            initialMode,
            history,
            abortSignal,
            globalCustomInstructions,
            includeTime,
            rulesContent,
            skillDirectorySection,
            mcpClient,
            allowedMcpServers,
            memoryContext,
            pluginSkillsSection,
            recipesSection,
            configDir,
            conversationId,
            attachmentTexts,
            subagentRoleOverride,
            subagentAllowedTools,
        } = config;
        // MEAS-01: span around the entire agent turn. Label includes
        // taskId so concurrent sub-agent runs do not collide on the
        // active-spans map.
        const perfMarks = getPerformanceMarks();
        const turnLabel = `agent.run:${taskId}`;
        perfMarks.start(turnLabel);
        // Resolve mode to ModeConfig
        let activeMode: ModeConfig = this.resolveMode(initialMode);

        // Create per-task pipeline instance (like Kilo Code creates per-task context)
        const pipeline = new ToolExecutionPipeline(
            this.toolRegistry.plugin,
            this.toolRegistry,
            taskId,
            activeMode.slug,
            this.api,
        );
        // AUDIT-034 H-3: bind the subagent allowlist (if any) so the
        // pipeline rejects hallucinated dispatches outside the profile.
        // Top-level tasks pass undefined and keep the legacy behaviour.
        pipeline.setSubagentAllowedTools(subagentAllowedTools);
        // FIX-44-29: bind the mode service so the AUDIT-034 M-9 runtime mode gate
        // actually runs. Without this it was dead (only tests ever set it), so a
        // restricted Custom Agent could still call any tool. The default 'agent'
        // mode includes every group, so unrestricted runs are unaffected; dynamic
        // custom_* skill tools are exempted inside the gate.
        if (this.modeService) pipeline.setModeService(this.modeService);
        // FEAT-44-02: adopt the parent run's approved-effects set so a
        // "for this run" grant is honoured inside subtasks and invoked skills.
        if (config.parentRunApprovedEffects) {
            pipeline.setRunApprovedEffects(config.parentRunApprovedEffects);
        }

        // FIX-H/I (ADR-090 follow-up): set of files read during this task.
        // Declared early so FastPath (which runs before the main loop) can
        // contribute to it. Pipeline mutates on each successful read.
        const readFiles = new Set<string>();

        // IMP-41-02-01a / ADR-145: explicit serializable loop state replaces
        // the ~20 closure variables this function previously accumulated.
        // AUDIT-2026-08-27 L-6: the loop bound goes in, so a resume that would
        // start at or past it is clamped instead of running zero iterations and
        // reporting a completed run. The sidebar has already consumed the
        // snapshot by the time we get here, so there is nothing left to refuse
        // in favour of.
        const loopState = initLoopStateForRun(config.resumeState, this.maxIterations);

        // FEAT-32-02 PR 2.2: hoisted detector so FastPath can feed it via
        // `recordForEpisodeOnly` BEFORE the main loop opens. Originally
        // declared in the main-loop-prep block ~150 lines below.
        const repetitionDetector = new ToolRepetitionDetector();

        // v2.10.0: TaskRouter, since contract v2 as an interceptor. Only
        // runs for the top-level task (subtasks inherit the parent's api);
        // falls back to the main api when disabled, no helper model is
        // configured, or classification is not 'simple'. The >= 2 error
        // escalation fires via onToolResult inside the engine's batch
        // dispatch. Dynamic TaskRouter / helper-api imports live in the
        // ports so the interceptor stays dependency-light.
        const mainApi = this.api;
        const escalateToMain = () => {
            if (this.api !== mainApi) {
                console.debug('[TaskRouter] Escalating to main model after consecutive errors.');
                this.api = mainApi;
            }
        };
        const routerEscalation = new RouterEscalationInterceptor({
            shouldRun: () => shouldRunTaskRouter(this.depth, this.modelOverrideActive),
            manualOverrideActive: () => this.depth === 0 && this.modelOverrideActive,
            isEnabled: () => this.toolRegistry.plugin.settings.autoTaskRouter?.enabled ?? true,
            helperModelName: () => this.toolRegistry.plugin.getHelperModel()?.name ?? null,
            classify: async (promptText) => {
                const { TaskRouter } = await import('./routing/TaskRouter');
                return new TaskRouter().classifyByRegex(promptText);
            },
            switchToHelper: async () => {
                const { getHelperApi } = await import('./helper-api');
                this.api = getHelperApi(this.toolRegistry.plugin, this.api);
            },
            mainModelId: () => this.api.getModel().id,
            escalateToMain,
        });
        await routerEscalation.onRunStart({
            history,
            userMessageText: typeof userMessage === 'string'
                ? userMessage
                : userMessage
                    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
                    .map(b => b.text)
                    .join(' '),
            abortSignal,
        });

        // ADR-061: Fast Path, since contract v2 as an interceptor — if a
        // recipe matches with high confidence, execute tool steps as a
        // batch before entering the normal loop. The loop then handles
        // presentation/completion in 1-2 iterations. The interceptor owns
        // gates + entry collection; planner prompt, tool definitions,
        // executor construction and episodic recording stay in the ports.
        const fastPathInterceptor = new FastPathInterceptor({
            enabled: () => Boolean(recipesSection) && this.depth === 0,
            getUserText: () => (typeof userMessage === 'string' ? userMessage : ''),
            getRecipeMatches: () => config.recipeMatches
                ?? this.toolRegistry.plugin.recipeMatchingService?.match(
                    typeof userMessage === 'string' ? userMessage : '', activeMode.slug,
                ),
            executeRecipe: async (match, msgText, signal) => {
                const { FastPathExecutor } = await import('./FastPathExecutor');
                // Build system prompt for planner (same params as normal loop)
                const fpWebEnabled = this.modeService?.isWebEnabled() ?? false;
                const fpPrompt = buildSystemPromptForMode({
                    mode: activeMode, globalCustomInstructions, includeTime, rulesContent,
                    skillDirectorySection, mcpClient, allowedMcpServers, memoryContext, pluginSkillsSection,
                    isSubtask: false, webEnabled: fpWebEnabled, recipesSection,
                    configDir: configDir ?? this.toolRegistry.plugin.app.vault.configDir,
                });
                const fpTools = this.modeService
                    ? this.modeService.getToolDefinitions(activeMode)
                    : this.toolRegistry.getToolDefinitions();

                // FIX-24-05-04: collect planner-call usage so it lands
                // in the task totals (footer + telemetry).
                const fastPath = new FastPathExecutor(this.api, pipeline, (i, o, cr, cc, servingModelId) => {
                    // FIX-24-05-05: the planner may run on the helper model.
                    this.foldAuxUsage({
                        // FIX-24-05-09: one fold for every auxiliary call.
                        modelId: servingModelId ?? this.api.getModel().id,
                        inputTokens: i, outputTokens: o,
                        cacheReadTokens: cr ?? 0, cacheCreationTokens: cc ?? 0,
                        // FEAT-24-13: the ledger says which part of the run
                        // spent this. FastPath runs before the loop's first
                        // iteration, so the iteration is the one it will start
                        // with (0, or the resumed one).
                    }, 'fastpath', loopState.iteration);
                });
                const fpCallbacks = {
                    pushToolResult: () => {},
                    pushProgress: () => {},
                    handleError: (tool: string, error: unknown) => {
                        console.warn(`[FastPath] Tool error in ${tool}:`, error);
                    },
                    log: (msg: string) => console.debug(`[FastPath] ${msg}`),
                };

                return fastPath.execute(
                    match.recipe,
                    msgText,
                    fpPrompt,
                    fpCallbacks,
                    signal,
                    fpTools,
                    readFiles,
                    // FEAT-32-02 PR 2.2 / ADR-133: feed FastPath dispatches
                    // into the episodic detector so the toolSequence is
                    // complete. Iteration 0 marks pre-loop dispatches.
                    (tool, input, summary) =>
                        repetitionDetector.recordForEpisodeOnly(tool, input, summary, 0),
                    // FIX-44-33: forward the approval + checkpoint callbacks so a
                    // recipe step that is not auto-approved asks the user instead
                    // of being silently denied.
                    {
                        onApprovalRequired: this.taskCallbacks.onApprovalRequired,
                        onCheckpoint: this.taskCallbacks.onCheckpoint,
                        // FIX-44-44: FastPath writes count toward the
                        // post-task-review decision like model writes.
                        onUnreviewedWrite: this.taskCallbacks.onUnreviewedWrite,
                    },
                    // FEAT-55-02 (ADR-170): run-scoped attachments for recipe steps.
                    attachmentTexts,
                );
            },
        });
        await fastPathInterceptor.onRunStart({
            history,
            userMessageText: typeof userMessage === 'string' ? userMessage : '',
            abortSignal,
        });

        // Push the user message first, then the FastPath history entries
        // (assistant + tool_results + hint). This order keeps the Anthropic
        // alternation contract and the cached system-prompt-prefix invariant
        // (ADR-062).
        history.push({ role: 'user', content: userMessage });
        for (const entry of fastPathInterceptor.getHistoryEntries()) {
            history.push(entry);
        }
        // FEAT-32-02 PR 2.2 / ADR-133: episode-recording closure counters.
        // All closure-local (not `this.*`) so a subagent re-entry of run()
        // does NOT inherit the parent's snapshot. Consumed in the finally
        // block at the end of run().
        loopState.fastPathFired = loopState.fastPathFired || fastPathInterceptor.fired();

        const MAX_ITERATIONS = this.maxIterations;
        // AUDIT-2026-08-27 L-6: telemetryIterations is cumulative across resumes,
        // so "did THIS run do anything" needs the value it started with. The
        // success exit uses it to tell a finished run from an empty one.
        const iterationsBeforeRun = loopState.telemetryIterations;

        // Tools that are safe to execute in parallel (pure reads, no side-effects).
        // Write tools and control-flow tools always run sequentially.
        const PARALLEL_SAFE = new Set([
            'read_file', 'list_files', 'search_files', 'get_frontmatter',
            'get_linked_notes', 'search_by_tag', 'get_vault_stats', 'get_daily_note',
            'web_fetch', 'web_search',
            'semantic_search', 'query_base', 'open_note',
        ]);

        // Feature 6: token usage accumulates in loopState -- the four scalars
        // and, since FEAT-24-13, the ledger they sum from. There is nothing to
        // reset here any more: the per-model breakdown used to be a task field
        // that this line cleared on entry, which is precisely how a resumed run
        // ended up displaying the whole conversation's tokens while pricing the
        // last leg only (D2). initLoopStateForRun owns what carries over.
        // attempt_completion signal
        // Track whether the model streamed any text across all iterations.
        // Used to decide if the completion result should be rendered as fallback.
        // Safety net: retry once if tools ran but model produced no visible response
        // switch_mode signal (checked at end of each iteration)
        // Phase B: consecutive error tracking
        // FEAT-32-02 PR 2.2: `repetitionDetector` was hoisted up above so
        // FastPath can feed it via `recordForEpisodeOnly`; declaration kept
        // out of this block to avoid TDZ for FastPath.
        // ADR-090 Lever 10: count loop iterations for telemetry.

        // Wire up context extensions for agent-control tools
        const askQuestion = this.taskCallbacks.onQuestion
            ? (question: string, options?: string[]): Promise<string> => {
                return new Promise<string>((resolve) => {
                    this.taskCallbacks.onQuestion!(question, options, resolve);
                });
            }
            : undefined;

        const signalCompletion = (result: string) => {
            loopState.completionResult = result;
            // FEAT-32-02 PR 2.2 / ADR-133: track for the episode `success`
            // flag in the finally block.
            loopState.attemptCompletionFired = true;
        };

        const switchMode = (slug: string) => {
            loopState.pendingModeSwitch = slug;
        };

        // new_task: spawn a child AgentTask that runs in a fresh history and returns its result.
        // Depth-guard: children at maxSubtaskDepth get spawnSubtask = undefined (cannot nest further).
        const childDepth = this.depth + 1;
        const childCanSpawn = childDepth < this.maxSubtaskDepth;

        const spawnSubtask = async (
            childMode: string,
            childMessage: string,
            profileName?: string,
            overrides?: import('./tools/types').SubtaskSpawnOverrides,
        ): Promise<string> => {
            const childHistory: MessageParam[] = [];
            let childText = '';

            // FEAT-24-04 / ADR-113: optional subagent profile path. When a
            // profile is set, the subagent gets a lean role + reduced tool
            // allowlist and the parent's rules / mcp / plugin-skills set is
            // dropped (the profile is the explicit scope).
            const profile = profileName ? getSubagentProfile(profileName) : undefined;

            // FEAT-29-10 follow-up: per-spawn caps. `maxIterations` shortens
            // the child loop; `allowedTools` further narrows the child's tool
            // schema. Overrides win over profile defaults.
            const effectiveMaxIterations = overrides?.maxIterations ?? this.maxIterations;
            const effectiveAllowedTools = overrides?.allowedTools ?? profile?.allowedTools;

            // EPIC-26 / ADR-120: tier override + output cap. When the profile
            // pins a tier (research=fast, advisor=flagship), build a fresh
            // api handler from the active provider's tier slot. When the
            // active provider has no model for that tier (or no provider is
            // configured yet), fall back to the parent's api handler so the
            // pre-migration code path keeps working unchanged.
            let childApi: ApiHandler = this.api;
            // FIX-24-11-02: did the child end up on a model of its own? Only the
            // branches that actually built a handler set this, because an
            // unresolvable key or an unconfigured tier slot leaves the child on
            // the parent's model, and the label has to say what happened rather
            // than what was asked for.
            let childRanOnItsOwnModel = false;
            if (overrides?.modelKey) {
                // Issue #54.4.1: an explicit per-spawn model wins over the
                // profile tier. The key is validated in NewTaskTool.execute;
                // an unknown key here just falls back to the parent api.
                const configured = expandProviderConfigsToCustomModels(
                    this.toolRegistry.plugin.settings.providerConfigs ?? [],
                );
                const picked = configured.find((m) => getModelKey(m) === overrides.modelKey);
                if (picked) {
                    childApi = buildApiHandlerForModel(picked);
                    childRanOnItsOwnModel = true;
                }
            } else if (profile?.tierOverride) {
                const pluginAny = this.toolRegistry.plugin as unknown as {
                    getTierModel?: (t: 'fast' | 'mid' | 'flagship') => CustomModel | null;
                };
                const tierModel = pluginAny.getTierModel?.(profile.tierOverride) ?? null;
                if (tierModel) {
                    const capped = profile.maxOutputTokens !== undefined
                        ? { ...tierModel, maxTokens: profile.maxOutputTokens }
                        : tierModel;
                    childApi = buildApiHandlerForModel(capped);
                    childRanOnItsOwnModel = true;
                }
            }

            const childTask = new AgentTask(
                childApi,
                this.toolRegistry,
                {
                    onText: (chunk) => { childText += chunk; },
                    onToolStart: (name, input) => {
                        this.taskCallbacks.onToolStart(`[subtask] ${name}`, input);
                    },
                    onToolResult: (name, content, isError) => {
                        this.taskCallbacks.onToolResult(`[subtask] ${name}`, content, isError);
                    },
                    onComplete: () => { /* handled via Promise resolution */ },
                    onError: (err) => { throw err; },
                    onUsage: (i, o, cr, cc, mid, _rm, childUsageByModel, childLongContextIds) => {
                        // FEAT-24-13: the child's spend enters the parent's
                        // ledger, which is what the parent's totals sum from --
                        // one booking, both halves. The old shape added the
                        // scalars here and merged the split under a
                        // `if (childUsageByModel)` guard whose else-branch was
                        // dead code, because `{}` is truthy: a child that
                        // reported an empty split added tokens to the count and
                        // nothing to the split that prices them (D4).
                        for (const record of subtaskUsageRecords(
                            { input: i, output: o, cacheRead: cr ?? 0, cacheCreation: cc ?? 0 },
                            childUsageByModel, mid, loopState.iteration,
                        )) {
                            bookUsage(loopState, record);
                        }
                        // EPIC-26: tag the forwarded usage so the parent's
                        // cost log shows WHY this call ran on the reported
                        // model. `advisor` for the consult_flagship profile,
                        // `subagent` for every other child that ran on a model
                        // of its own. A child that inherited the parent api is
                        // accounted as part of the main loop's own mode.
                        // FIX-24-11-02: the decision moved into a named
                        // function, because it now depends on the handler that
                        // was actually built and not on the profile alone.
                        const routingMode = spawnRoutingMode(profile?.name, childRanOnItsOwnModel);
                        // FIX-24-05-03: forward only at the root, where the
                        // receiver is the UI (renders, does not accumulate).
                        // Intermediate levels would double-count: their own
                        // final report already includes these tokens.
                        if (shouldForwardSubtaskUsage(this.depth)) {
                            // AUDIT-2026-08-27 I-5: the child's crossings travel
                            // with the child's numbers. The parent books this
                            // report as ONE aggregate record, so its own ledger
                            // cannot rediscover them, and a task that delegates
                            // its long request would show an undisclosed total.
                            this.taskCallbacks.onUsage?.(
                                i, o, cr, cc, mid, routingMode, childUsageByModel, childLongContextIds,
                            );
                        }
                    },
                    // K-1: Forward parent approval callback so subtask write ops are not
                    // auto-rejected by the fail-closed fallback in ToolExecutionPipeline.
                    // AUDIT-034 M-37: wrap the forwarded callback so a parent that
                    // throws / returns undefined cannot crash the subtask runner;
                    // we fail-closed (rejected) instead of letting the exception
                    // bubble through the pipeline.
                    onApprovalRequired: this.taskCallbacks.onApprovalRequired === undefined
                        ? undefined
                        : async (toolName, input, preview, batch) => {
                            try {
                                // FEAT-44-10: the diff must survive the hop into a
                                // subtask, otherwise a skill's edits are approved
                                // blind while the parent's are not. FEAT-44-02b:
                                // same for the batch preview.
                                const result = await this.taskCallbacks.onApprovalRequired!(toolName, input, preview, batch);
                                return result ?? { decision: 'rejected' };
                            } catch (e) {
                                console.warn('[AgentTask] subtask approval callback threw, failing closed:', e);
                                return { decision: 'rejected' };
                            }
                        },
                    // FIX-24-08-03 steering gap: while invoke_skill/new_task
                    // parks the parent in `await spawnSubtask`, the parent
                    // preamble never drains the steering queue. Forwarding
                    // the consumer lets the child deliver mid-run
                    // corrections at ITS iteration boundaries.
                    consumeSteeringMessages: this.taskCallbacks.consumeSteeringMessages,
                },
                this.modeService,
                this.consecutiveMistakeLimit,
                this.rateLimitMs,
                // Subtasks don't condense or power-steer (keep child loops lean)
                false, 80, 0, effectiveMaxIterations,
                childDepth,             // propagate nesting depth
                this.maxSubtaskDepth,   // propagate limit
                this.microcompactionEnabled, // FEAT-24-02: cheap tool_result pruning still applies
                this.rollingSummaryThreshold, // unused while condensing is off, kept for completeness
                false, // modelOverrideActive: subtasks inherit, override flag is per-turn
                this.compositionStack, // FEAT-29-10: share stack by reference
            );

            await childTask.run({
                userMessage: childMessage,
                taskId: `${taskId}-sub-${Date.now()}`,
                initialMode: profile ? 'agent' : childMode,
                history: childHistory,
                abortSignal,
                globalCustomInstructions,
                includeTime,
                // Profile spawn: drop the parent's rules/mcp/plugin-skills set
                // entirely. The profile's roleDefinition + allowedTools is the
                // full scope.
                rulesContent: profile ? undefined : rulesContent,
                skillDirectorySection, // subtask-gated to '' inside buildSystemPromptForMode -- pass-through anyway
                mcpClient: profile ? undefined : mcpClient,
                allowedMcpServers: profile ? undefined : allowedMcpServers,
                pluginSkillsSection: profile ? undefined : pluginSkillsSection,
                subagentRoleOverride: profile?.roleDefinition,
                subagentAllowedTools: effectiveAllowedTools,
                // FEAT-44-02: share the parent's run-scope grants with the child.
                parentRunApprovedEffects: pipeline.getRunApprovedEffects(),
                configDir,
            });
            return childText;
        };

        // Cache system prompt + tool definitions — rebuilt only when the mode changes
        // or when settings that affect tool availability change (e.g. webTools.enabled).
        let cachedPromptMode = '';
        let cachedSystemPrompt = '';
        let cachedTools: ToolDefinition[] = [];
        // FEATURE-1600 (Deferred Tool Loading): tools that the LLM activated
        // via find_tool during this session. Injected into the prompt cache
        // until the task ends.
        const activatedDeferredTools = new Set<string>();

        // EPIC-26 / FEAT-26-01 / ADR-120: reminder is rebuilt as part of the
        // prompt cache. The closure captures the current value of
        // `loopState.consecutiveMistakes` (defined above) so a transition into
        // mistakes>=2 produces the hint, and a reset drops it again.
        const rebuildPromptCache = () => {
            const webEnabled = this.modeService?.isWebEnabled() ?? false;
            const advisorAvailable = !!(this.toolRegistry.plugin as unknown as {
                getAdvisorModel?: () => unknown;
            }).getAdvisorModel?.();
            cachedSystemPrompt = buildSystemPromptForMode({
                mode: activeMode,
                globalCustomInstructions,
                includeTime,
                rulesContent,
                skillDirectorySection,
                mcpClient,
                allowedMcpServers,
                memoryContext,
                pluginSkillsSection,
                isSubtask: this.depth > 0,
                webEnabled,
                recipesSection,
                configDir: configDir ?? this.toolRegistry.plugin.app.vault.configDir,
                // FEAT-24-04 / ADR-113: profile-spawn overrides; undefined on non-profile spawns.
                subagentRoleOverride,
                subagentAllowedTools,
                consultFlagshipReminderActive: loopState.consecutiveMistakes >= 2,
                consultFlagshipAvailable: advisorAvailable,
                // EPIC-26 / FEAT-26-06: prompt-slim. Lean cost-heuristics when
                // running on auto-mode (no override active). Lean plugin-skills
                // until a skill-group tool is actually invoked. Subtasks always
                // see lean cost-heuristics (their prompts are small anyway).
                // The "Lean system prompt" setting (#44) ORs into both
                // decisions to force the compact variants.
                ...resolveLeanFlags(
                    this.toolRegistry.plugin.settings.leanSystemPrompt ?? false,
                    this.modelOverrideActive,
                    loopState.recentPluginSkillUsage,
                ),
            });
            let baseTools = this.modeService
                ? this.modeService.getToolDefinitions(activeMode)
                : this.toolRegistry.getToolDefinitions();

            // FEAT-24-04 / ADR-113: subagent profile restricts the tool
            // schemas to the profile allowlist. Applied BEFORE the deferred-
            // tool and shadowed-builtin filters so the profile's small surface
            // wins regardless of the other policies.
            if (subagentAllowedTools && subagentAllowedTools.length > 0) {
                const allowSet = new Set<string>(subagentAllowedTools);
                baseTools = baseTools.filter((t) => allowSet.has(t.name));
            }

            // FEATURE-1600: by default hide deferred tools from the prompt.
            // The LLM can activate them via find_tool, which adds them to
            // activatedDeferredTools and invalidates the cache.
            cachedTools = baseTools.filter((t) => !isDeferredTool(t.name));

            // Inject activated deferred tools (if any were unlocked via find_tool).
            for (const name of activatedDeferredTools) {
                const extra = baseTools.find((t) => t.name === name);
                if (extra && !cachedTools.includes(extra)) {
                    cachedTools.push(extra);
                }
            }

            // REF-04 (2026-06-21): always-on meta-tools. find_tool (FEATURE-1600
            // discovery) and read_skill (FEAT-24-09 / ADR-116 "always-available")
            // were historically marked INTENTIONALLY_NOT_REACHABLE -- they only
            // hit by hallucination. FIX-29-99-01 added them to TOOL_GROUP_MAP.agent
            // so they ride through baseTools automatically when the active agent
            // includes the `agent` group. The injection below pulls them in even
            // for custom agents whose group list excludes 'agent' (or for subagent
            // profiles that restrict the surface): without this safety net,
            // disabling the meta-tools would silently disable progressive
            // disclosure for the whole task.
            const allFromRegistry = this.toolRegistry.getToolDefinitions();
            for (const name of PROGRESSIVE_DISCLOSURE_META_TOOLS) {
                if (cachedTools.some((t) => t.name === name)) continue;
                const def = allFromRegistry.find((t) => t.name === name);
                if (!def) continue;
                // Respect subagent profile allowlists explicitly: if the profile
                // chose to exclude a meta-tool, do not override.
                if (subagentAllowedTools && subagentAllowedTools.length > 0
                    && !subagentAllowedTools.includes(name as ToolName)) continue;
                cachedTools.push(def);
            }

            // BUG-018 Wave 2: hard tool-filter for plugin-shadowed built-ins.
            // If e.g. the Excalidraw community plugin is active, create_excalidraw
            // disappears from the schema entirely — the LLM cannot accidentally
            // pick it over the richer plugin route.
            const enabledPluginIds = (this.toolRegistry.plugin.app as unknown as {
                plugins?: { enabledPlugins?: Set<string> };
            }).plugins?.enabledPlugins ?? new Set<string>();
            cachedTools = filterShadowedBuiltins(cachedTools, enabledPluginIds);

            // EPIC-26 / FEAT-26-01 / ADR-120: hide `consult_flagship` from the
            // schema when no flagship-tier model is configured on the active
            // provider. The tool itself defends against this too (Task 7), but
            // dropping it here keeps the prompt clean and stops the model from
            // even considering it on pre-migration installs.
            // EPIC-26 / FEAT-26-05 extension: also hide when the chat-header
            // override is active (the user is explicitly running on a different
            // model for this turn, advisor pattern off by design).
            const pluginAny = this.toolRegistry.plugin as unknown as {
                getAdvisorModel?: () => unknown;
            };
            if (this.modelOverrideActive || !pluginAny.getAdvisorModel?.()) {
                cachedTools = cachedTools.filter((t) => t.name !== 'consult_flagship');
            }

            cachedPromptMode = activeMode.slug;
            loopState.cacheInvalidated = false;
        };

        /** FEATURE-1600: activate a deferred tool for the rest of this task. */
        const activateDeferredTool = (toolName: string) => {
            if (!isDeferredTool(toolName)) return;
            if (activatedDeferredTools.has(toolName)) return;
            activatedDeferredTools.add(toolName);
            loopState.cacheInvalidated = true;
        };

        /** Called by UpdateSettingsTool when settings that affect tool availability change */
        const invalidateToolCache = () => { loopState.cacheInvalidated = true; };

        // Emergency condensing retry: if the API rejects with context overflow,
        // condense and retry the entire loop once instead of aborting.
        // ADR-061: Todo list as recency anchor (Manus Context Engineering).
        // Track current todo items so we can inject them at the end of context
        // before each LLM call, keeping task focus via recency bias.
        // IMP-41-02-01c: the todo anchor is an interceptor now. The caller's
        // callback object is never mutated; tools feed updates through
        // todoUpdateForTools below (wired into the runTool extensions).
        const todoAnchor = new TodoAnchorInterceptor();
        const todoUpdateForTools: AgentTaskCallbacks['onTodoUpdate'] = (items) => {
            this.taskCallbacks.onTodoUpdate?.(items);
            todoAnchor.noteTodoUpdate(items);
        };
        const powerSteering = new PowerSteeringInterceptor(this.powerSteeringFrequency);
        // IMP-41-02-01c: loop interceptors in execution order. The engine
        // dispatches onIterationStart in the preamble and onToolResult in
        // the batch phase (only RouterEscalation implements the latter).
        const loopInterceptors = [powerSteering, new AdvisorReminderInterceptor(), routerEscalation];


        // EPIC-26 / FEAT-26-01 / ADR-120: per-task advisor budget. Hard cap
        // of 3 consult_flagship calls; the 4th gets a tool_error so the
        // loop falls back to the current tier instead of stacking advisor
        // costs. Counter resets per task (each spawn of AgentTask runs its
        // own loop).
        const ADVISOR_LIMIT = 3;


        // EPIC-26 / FEAT-26-06: plugin-skill usage tracking. Starts false,
        // flips true on first invocation of a skill-group tool or when the
        // initial user message carries an @-plugin-mention. Once true, the
        // system prompt switches from lean to full plugin-skills section.
        const SKILL_GROUP_TOOLS = new Set<string>([
            'execute_command', 'execute_recipe', 'call_plugin_api',
            'resolve_capability_gap', 'enable_plugin',
        ]);
        // Heuristic: detect @plugin-id mentions in the FIRST user message.
        // Conservative regex; the lean->full flip is fail-safe (false neg
        // just keeps the lean section longer).
        const firstUserMessage = history.find((m) => m.role === 'user')?.content;
        if (typeof firstUserMessage === 'string' && /@[a-z][a-z0-9-]{2,}/i.test(firstUserMessage)) {
            loopState.recentPluginSkillUsage = true;
        }
        const consumeAdvisorSlot = () => {
            if (loopState.advisorCallsUsed >= ADVISOR_LIMIT) {
                return { ok: false, used: loopState.advisorCallsUsed, limit: ADVISOR_LIMIT };
            }
            loopState.advisorCallsUsed++;
            return { ok: true, used: loopState.advisorCallsUsed, limit: ADVISOR_LIMIT };
        };

        // Rate limit retry: auto-retry on 429 errors with exponential backoff.
        // Max 3 retries with 30s, 60s, 120s waits.
        const RATE_LIMIT_MAX_RETRIES = 3;
        const RATE_LIMIT_BASE_WAIT_MS = 30_000;

        try {
        while (true) {
        try {
            for (let iteration = loopState.iteration; iteration < MAX_ITERATIONS; iteration++) {
                // Mirror the loop counter into the serializable state so a
                // (W3) resume snapshot knows where the task stood.
                loopState.iteration = iteration;
                loopState.phase = 'preamble';
                // ADR-063: Sync iteration counter for deterministic externalization file names
                pipeline.getExternalizer()?.nextIteration();

                // Early exit if task was cancelled between iterations
                // (checked BEFORE the mode switch so a stopped task never
                // switches modes; the engine preamble re-checks defensively).
                if (abortSignal?.aborted) {
                    console.debug('[AgentTask] Abort signal detected at iteration start');
                    break;
                }

                // Apply any pending mode switch at the start of each iteration
                if (loopState.pendingModeSwitch !== null) {
                    const newMode = this.resolveMode(loopState.pendingModeSwitch);
                    if (newMode) {
                        activeMode = newMode;
                        if (this.modeService) {
                            this.modeService.switchMode(loopState.pendingModeSwitch);
                        }
                        this.taskCallbacks.onModeSwitch?.(loopState.pendingModeSwitch);
                    }
                    // FIX-COMPACT-04: do NOT reset the repetition detector.
                    // Resetting let Code -> Architect -> Code loops bypass
                    // both the exact-repetition block and the "already
                    // failed" surface in the post-condense summarizer.
                    // The mistake counter still resets -- a mode switch is
                    // a user correction and should not count old errors
                    // against the new mode's tolerance budget.
                    repetitionDetector.markModeSwitch(loopState.pendingModeSwitch);
                    loopState.pendingModeSwitch = null;
                    loopState.consecutiveMistakes = 0;
                }

                this.taskCallbacks.onIterationStart?.(iteration);

                // Phase B: rate limiting (IMP-41-02-03). Configured per
                // iteration because TaskRouter escalation can swap this.api
                // (and thus the bucket key) mid-task.
                if (this.rateLimitMs > 0) {
                    requestRateLimiter.configure(
                        this.api.providerType ?? 'unknown',
                        this.api.getModel().id,
                        Math.max(1, Math.round(60_000 / this.rateLimitMs)),
                    );
                }

                // IMP-41-02-01 stage 2: generic preamble lives in the engine —
                // interceptor dispatch (power steering FIX-PERF-24, advisor
                // reminder ADR-120 cache trigger), soft-limit nudge, ADR-114
                // steering drain.
                // FEAT-24-11: anything the preamble appends (steering text,
                // the soft-limit nudge) sits in the history ahead of this
                // request; the telemetry line should be able to say so.
                const historyBeforePreamble = history.length;
                const preambleOutcome = this.loopEngine.runIterationPreamble(
                    loopState, history, activeMode,
                    {
                        isAborted: () => abortSignal?.aborted === true,
                        maxIterations: MAX_ITERATIONS,
                        consumeSteeringMessages: this.taskCallbacks.consumeSteeringMessages,
                    },
                    loopInterceptors,
                );
                if (history.length > historyBeforePreamble) this.steeringSinceLastRequest = true;
                if (preambleOutcome === 'abort') break;

                // Rebuild system prompt + tool list when mode or tool availability changed
                if (activeMode.slug !== cachedPromptMode || loopState.cacheInvalidated) {
                    rebuildPromptCache();
                }
                const systemPrompt = cachedSystemPrompt;
                const tools = cachedTools;

                // IMP-41-02-01 stage 3b: host services for the engine's
                // condense triggers. Recreated per iteration so the ports
                // close over THIS iteration's system prompt; the tool-call
                // ledger is fetched lazily per call (FIX-COMPACT-01 -- a
                // retry must see the current ledger, never a stale copy).
                const condensePorts: CondensePorts = {
                    condensingEnabled: this.condensingEnabled,
                    thresholdPercent: this.condensingThreshold,
                    estimateTokens: (h) => this.estimateTokens(h),
                    getContextWindow: () => this.getModelContextWindow(),
                    microcompact: (h) => this.microcompact(h),
                    preCompactionFlush: async (h) => { await this.taskCallbacks.onPreCompactionFlush?.(h); },
                    condense: (h, maxTail) => this.condenseHistory(
                        h, systemPrompt, abortSignal, repetitionDetector.getLedger(), maxTail,
                    ),
                    rollingSummary: (h, est, thr, win) => this.maybeRollingSummary(
                        h, systemPrompt, est, thr, win, abortSignal, repetitionDetector.getLedger(),
                    ),
                    cacheAwareDeferEnabled: () => {
                        const advancedApi = (this.toolRegistry.plugin.settings as unknown as { advancedApi?: { cacheAwareCondensing?: boolean } }).advancedApi;
                        return advancedApi?.cacheAwareCondensing === true;
                    },
                };

                // ADR-061 / FIX-PERF-22: Todo list as recency anchor.
                // Previously this mutated `history` in place and then
                // restored it after the stream finished. The mutation
                // looked safe but the restore relied on `endsWith()`
                // matching the exact todo text, which broke when the
                // stream errored mid-flight (todo stayed glued onto the
                // history). Now we build the anchored version inside
                // safeHistory below and never touch the live history.

                // FIX-24-03-05 / ADR-157 defence line 2: pre-request budget
                // gate. Happy path is pure arithmetic (estimator only); the
                // compaction ladder runs ONLY when the projection would
                // exceed the window -- the case that today ends in a
                // provider 400 plus emergency retry.
                const toolsJsonChars = JSON.stringify(tools).length;
                await this.ensureRequestFitsWindow(
                    history,
                    systemPrompt.length + toolsJsonChars,
                    () => this.condenseHistory(
                        history, systemPrompt, abortSignal, repetitionDetector.getLedger(),
                    ),
                );

                // Stream the LLM response (pass abort signal for cancellation)
                // BUG-017: drop orphan tool_use / tool_result blocks before send.
                // Anthropic returns 400 if any tool_use has no matching tool_result
                // and Claude-via-Copilot inherits the same constraint.
                // Defence line 3 (reload poisoning): cap any single persisted
                // result at the read-budget ceiling for the ACTIVE model.
                let safeHistory = sanitizeAndLog(
                    history, 'main-loop',
                    computeReadBudgetChars(this.getModelContextWindow()) + 4_000,
                );
                // FIX-PERF-22: append the todo anchor to the LAST user
                // message of the sanitized history only. The live history
                // stays unmutated, so a mid-stream throw no longer leaves
                // the todo glued onto the persisted transcript.
                safeHistory = this.loopEngine.transformRequestHistory(
                    safeHistory,
                    { state: loopState, history, activeMode },
                    [todoAnchor],
                );
                logInputBreakdown('main-loop', systemPrompt, safeHistory, tools);
                // IMP-41-01-04 / ADR-148: char volume of THIS request, so the
                // usage chunk below can calibrate the chars-per-token factor
                // against the provider-reported real prompt size.
                const requestChars = systemPrompt.length
                    + TokenEstimator.sumChars(safeHistory)
                    + toolsJsonChars;
                // ADR-148: one-shot count_tokens seed before the FIRST request
                // of a large task, where the estimator is still uncalibrated
                // and a mis-estimate hurts most (output budget, condense gate).
                if (iteration === 0 && typeof this.api.countTokens === 'function') {
                    const uncalibrated = this.tokenEstimator.tokensForChars(requestChars);
                    if (uncalibrated > 50_000) {
                        const exact = await this.api.countTokens(systemPrompt, safeHistory, tools, abortSignal);
                        if (exact) this.tokenEstimator.seed(requestChars, exact);
                    }
                }
                // MEAS-02: only the very first iteration of a fresh turn is
                // the one the user clicked Send for. Subsequent iterations
                // are tool-result follow-ups and have a different shape.
                const isFirstTurnIteration = iteration === 0;
                if (isFirstTurnIteration) {
                    perfMarks.end('send.firstTurn.host', { log: true });
                    perfMarks.start('send.firstTurn.provider');
                }
                // IMP-41-02-01b / ADR-145: the engine owns chunk classification.
                // The wrapper generator keeps the MEAS-02 first-token marks;
                // usage-chunk side effects (estimator calibration, per-model
                // billing at chunk time, FIX-24-05-05) live in the port.
                // FEAT-24-11: totals before the stream, so the per-request
                // record can carry this request's own delta.
                const usageBefore = {
                    input: loopState.totalInputTokens,
                    output: loopState.totalOutputTokens,
                    cacheRead: loopState.totalCacheReadTokens,
                    cacheCreation: loopState.totalCacheCreationTokens,
                };
                const rawStream = this.api.createMessage(systemPrompt, safeHistory, tools, abortSignal);
                const markedStream = (async function* (): AsyncIterable<import('../api/types').ApiStreamChunk> {
                    let sawFirstChunk = false;
                    for await (const chunk of rawStream) {
                        if (isFirstTurnIteration && !sawFirstChunk) {
                            sawFirstChunk = true;
                            perfMarks.end('send.firstTurn.provider', { log: true });
                            perfMarks.point('send.firstToken', { log: true });
                        }
                        yield chunk;
                    }
                })();
                const streamResult = await this.loopEngine.consumeStream(markedStream, loopState, {
                    onText: (text) => this.taskCallbacks.onText(text),
                    onThinking: (text) => this.taskCallbacks.onThinking?.(text),
                    onToolStart: (name, input) => this.taskCallbacks.onToolStart(name, input),
                    onToolResult: (name, content, isError) => this.taskCallbacks.onToolResult(name, content, isError),
                    onUsage: (inputTokens, outputTokens, cacheRead, cacheCreation, servingModelId) => {
                        // IMP-41-01-04: calibrate chars-per-token from the real
                        // prompt size (input + cache segments = full prompt).
                        this.tokenEstimator.recordUsage(requestChars, inputTokens + cacheRead + cacheCreation);
                        // FIX-24-05-05: attribute at chunk time -- TaskRouter
                        // escalation swaps this.api mid-loop, so the model
                        // serving THIS iteration is the one to bill.
                        // FIX-24-05-08: the chunk itself names that model now
                        // (withUsageAttribution stamps it at the producer).
                        // this.api is the fallback for a hand-built handler that
                        // does not go through buildApiHandler.
                        // FEAT-24-13: the ledger only -- the engine has already
                        // added this chunk to the scalars (see below), so
                        // bookUsage here would count it twice.
                        appendUsageRecord(loopState, {
                            modelId: servingModelId ?? this.api.getModel().id,
                            input: inputTokens,
                            output: outputTokens,
                            cacheRead,
                            cacheCreation,
                            source: 'main',
                            iteration,
                        });
                        // Live tally for the UI. The engine has already folded
                        // this chunk into loopState (AgentLoopEngine updates the
                        // state totals before invoking this port), so these are
                        // the run's cumulative numbers, not this chunk's delta.
                        this.taskCallbacks.onUsageProgress?.(
                            loopState.totalInputTokens,
                            loopState.totalOutputTokens,
                            loopState.totalCacheReadTokens,
                            loopState.totalCacheCreationTokens,
                        );
                    },
                });
                const { textParts, toolUses, toolErrors, thinking: thinkingCollector } = streamResult;
                // FEAT-24-11: one telemetry line per request.
                this.emitRequestTelemetry({
                    // FIX-24-11-01: the same binding the task record uses, so
                    // the two logs cannot drift onto two different ids.
                    taskId,
                    iteration,
                    systemPrompt,
                    historyMessages: safeHistory.length,
                    toolsSent: tools.length,
                    delta: {
                        input: loopState.totalInputTokens - usageBefore.input,
                        output: loopState.totalOutputTokens - usageBefore.output,
                        cacheRead: loopState.totalCacheReadTokens - usageBefore.cacheRead,
                        cacheCreation: loopState.totalCacheCreationTokens - usageBefore.cacheCreation,
                    },
                });

                // FIX-PERF-22: todo restore block intentionally removed.
                // The anchor was applied to safeHistory (a clone), not
                // to live history, so there is nothing to restore.

                // Build the assistant message content. Thinking first (mirrors
                // the order the model produced: CoT before answer/tool), then
                // visible text, then tool_use blocks.
                //
                // AUDIT-037 L-1: the wire-side MAX_REASONING_CONTENT_CHARS cap
                // only trims what is RE-SENT to the API. Without a turn-side
                // cap the assistant history grew linearly with reasoning depth
                // until condensing kicked in at 70%. The collector caps the
                // UNSIGNED remainder at PER_TURN_THINKING_CAP; signed segments
                // stay verbatim (IMP-41-01-05 — the signature validates the
                // exact text, a capped signed block would 400 on passback).
                const assistantContent: ContentBlock[] = [];
                if (thinkingCollector.hasContent()) {
                    const PER_TURN_THINKING_CAP = 50_000;
                    assistantContent.push(...thinkingCollector.finalize(PER_TURN_THINKING_CAP));
                }
                if (textParts.length > 0) {
                    assistantContent.push({ type: 'text', text: textParts.join('') });
                }
                assistantContent.push(...toolUses);
                // Loop-economy FIX C1: a max_tokens truncation mid-reasoning
                // can leave neither text nor tool_use (Bedrock reasoning
                // deltas are not collected for passback). An empty content
                // array is a hard 400 on the next request; the empty-response
                // nudge below needs an assistant turn between two user turns.
                if (assistantContent.length === 0) {
                    assistantContent.push({
                        type: 'text',
                        text: '[Response truncated: output-token limit reached during reasoning; no visible output was produced.]',
                    });
                }
                history.push({ role: 'assistant', content: assistantContent });

                // If no tool calls, the LLM is done — run condensing on text-only turns
                if (toolUses.length === 0) {
                    // Safety net: if tools ran but model produced no visible response, retry once
                    if (iteration > 0 && textParts.length === 0 && !loopState.hasRetriedEmpty) {
                        loopState.hasRetriedEmpty = true;
                        history.push({
                            role: 'user',
                            content: '[System] You executed tools but produced no visible response. '
                                + 'You MUST respond to the user. Explain what you did, what happened, '
                                + 'and suggest next steps. If a plugin command opens a dialog, '
                                + 'tell the user what to do in the dialog.',
                        });
                        continue;
                    }
                    // IMP-41-02-01 stage 3b: text-final condense trigger
                    // (microcompact, FIX-PERF-20 cache-aware defer, condense
                    // with retries) lives in the engine. Condensing is
                    // housekeeping for future messages — the model already
                    // delivered its text answer, so we're done either way.
                    await this.loopEngine.maybeCondenseAtTextFinal(loopState, history, condensePorts);
                    break;
                }

                const validToolUses = toolUses.filter(
                    (t): t is ContentBlock & { type: 'tool_use' } =>
                        t.type === 'tool_use' && !toolErrors.has(t.id)
                );

                // Helper: run a single tool through the pipeline and return its result.
                // Does NOT call onToolResult — caller is responsible for ordering.
                const runTool = async (toolUse: ContentBlock & { type: 'tool_use' }) => {
                    // Detect repetitive tool loops before execution (recoverable — no signalCompletion)
                    const repCheck = repetitionDetector.check(toolUse.name, toolUse.input);
                    if (repCheck.blocked) {
                        return { content: `<error>${repCheck.reason}</error>`, is_error: true as const };
                    }
                    // FIX-24-06-01: deferred-tool execution guard. The schema-side
                    // filter (rebuildPromptCache) hides deferred tools from the
                    // model. Without this guard, the model can still call them by
                    // hallucinating the name from training data or recipe text,
                    // and the call would run without schema-guided arguments,
                    // wasting budget on wrong-path retries.
                    if (isDeferredTool(toolUse.name) && !activatedDeferredTools.has(toolUse.name)) {
                        const msg =
                            `Tool "${toolUse.name}" is deferred and must be activated before use. ` +
                            `Call find_tool({ query: "<what you want to do>" }) first to discover and activate it.`;
                        return { content: `<error>${msg}</error>`, is_error: true as const };
                    }
                    const toolCallbacks: ToolCallbacks = {
                        pushToolResult: (content) => {
                            // Final result also updates the live progress display.
                            if (typeof content === 'string') {
                                this.taskCallbacks.onToolProgress?.(toolUse.name, content);
                            }
                        },
                        pushProgress: (content) => {
                            // Intermediate progress: UI-only, not in conversation history.
                            this.taskCallbacks.onToolProgress?.(toolUse.name, content);
                        },
                        handleError: (toolName, error) => {
                            console.error(`[AgentTask] Tool error in ${toolName}:`, error);
                        },
                        log: (message) => { console.debug(`[AgentTask] ${message}`); },
                    };
                    const toolCall: ToolUse = {
                        type: 'tool_use',
                        id: toolUse.id,
                        name: toolUse.name as ToolName,
                        input: toolUse.input,
                    };
                    const result = await pipeline.executeTool(toolCall, toolCallbacks, {
                        abortSignal,
                        askQuestion,
                        signalCompletion,
                        switchMode,
                        // Depth-guard: only wire spawnSubtask if this child is allowed to spawn
                        spawnSubtask: childCanSpawn ? spawnSubtask : undefined,
                        // FEAT-29-10: composability stack shared across the chain.
                        compositionStack: this.compositionStack,
                        consumeAdvisorSlot,
                        onApprovalRequired: this.taskCallbacks.onApprovalRequired,
                        onOptionalAssetRequired: this.taskCallbacks.onOptionalAssetRequired,
                        // FIX-24-05-09 (D10): a tool's own LLM call lands in
                        // this run's totals instead of nowhere.
                        reportAuxUsage: (u) => this.foldAuxUsage(u, 'tool', loopState.iteration),
                        updateTodos: todoUpdateForTools,
                        onCheckpoint: this.taskCallbacks.onCheckpoint,
                        onUnreviewedWrite: this.taskCallbacks.onUnreviewedWrite,
                        invalidateToolCache,
                        activateDeferredTool,
                        conversationId,
                        readFiles,
                        attachmentTexts,
                    });
                    // FIX-COMPACT-01: record both outcomes in the ledger so the
                    // post-condense agent sees failures explicitly instead of
                    // re-attempting an approach the summarizer paraphrased away.
                    // FIX-COMPACT-08: per-tool result summary (read_file -> "L1-L420
                    // of <path>", search_files -> "query -> N hits") gives the
                    // summarizer a tighter signal than the blind 200-char prefix.
                    repetitionDetector.record(
                        toolUse.name,
                        toolUse.input,
                        summarizeForLedger(toolUse.name, toolUse.input, result.content),
                        iteration,
                        result.is_error ? 'failed' : 'success',
                    );
                    // EPIC-26 / FEAT-26-06: flip plugin-skills lean -> full
                    // the first time a skill-group tool is invoked in this
                    // task. The next rebuildPromptCache picks up the change.
                    if (!loopState.recentPluginSkillUsage && SKILL_GROUP_TOOLS.has(toolUse.name)) {
                        loopState.recentPluginSkillUsage = true;
                        loopState.cacheInvalidated = true;
                    }
                    return result;
                };

                // IMP-41-02-01 stage 3a: batch execution (tool_error blocks,
                // parallel-prefix dispatch, mistake breakers, result push,
                // inflight snapshot) lives in the engine. The facade provides
                // host services via ports; runTool keeps the pipeline wiring.
                await this.loopEngine.executeToolBatch(validToolUses, toolErrors, loopState, history, {
                    isAborted: () => abortSignal?.aborted ?? false,
                    executeTool: runTool,
                    onToolResult: (name, content, isError) =>
                        this.taskCallbacks.onToolResult(name, content, isError),
                    qualityGateFor: (toolName) => TOOL_METADATA[toolName]?.qualityGateChecklist,
                    consecutiveMistakeLimit: this.consecutiveMistakeLimit,
                    parallelSafe: PARALLEL_SAFE,
                    // FIX-24-03-05 defence line 1: aggregate budget for this
                    // turn's results, live window + live history estimate.
                    getResultBudgetChars: () => computeAggregateBudgetChars(
                        this.getModelContextWindow(),
                        this.estimateTokens(history),
                    ),
                    saveInflightSnapshot: this.inflightStore
                        ? () => {
                            void this.inflightStore?.saveSnapshot({
                                taskId,
                                conversationId: conversationId ?? '',
                                mode: activeMode.slug,
                                savedAt: Date.now(),
                                // AUDIT-2026-08-27 L-3: the store serialises this
                                // object up to two seconds later, so it has to
                                // stop tracking the live run now -- ledger
                                // included. A spread copies the token scalars by
                                // value and shares the ledger array, which put a
                                // booking made after this line into the persisted
                                // ledger while the persisted scalars stayed
                                // behind; the resumed run then priced more tokens
                                // than it displayed. Same reason the history is
                                // copied on the next line.
                                state: cloneLoopState(loopState),
                                history: JSON.parse(JSON.stringify(history)) as typeof history,
                            });
                        }
                        : undefined,
                }, { interceptors: loopInterceptors, activeMode });

                // Issue 3 Wave A: bail before the post-batch condense trigger
                // when Stop already landed. maybeCondenseAfterToolBatch can
                // fire a condensing LLM call, which would keep a stopped run
                // visibly working after the user pressed Stop. The loop-top
                // check at iteration start also breaks, but that is AFTER this
                // await -- so guard here too. History is already consistent
                // (the engine pushed the tool_results above), so breaking now
                // is clean.
                if (abortSignal?.aborted) {
                    console.debug('[AgentTask] Abort detected after tool batch -- skipping condense and breaking');
                    break;
                }
                // IMP-41-02-01 stage 3b: post-batch condense trigger
                // (microcompact, threshold condense with retries, else the
                // gentler rolling summary) runs in the engine — only after
                // history is fully consistent (assistant tool_calls +
                // tool_results both present, no orphaned calls).
                await this.loopEngine.maybeCondenseAfterToolBatch(loopState, history, condensePorts);

                // Break loop if attempt_completion was signaled.
                // The result field is an internal log entry — when the model
                // already streamed its answer as text (the intended flow), a
                // short summary result stays silent. FIX-41-03-01: the old
                // binary hasStreamedText gate was task-global, so a single
                // early narration chunk discarded an answer that lived ONLY
                // in the result param (2026-07-07 incident: 325 chars of
                // narration streamed, the whole deliverable suppressed).
                // Render the result whenever it carries more substance than
                // everything the run streamed; also keep the last-resort
                // fallback for models that skip text streaming entirely.
                if (loopState.completionResult !== null) {
                    this.taskCallbacks.onAttemptCompletion?.();
                    const resultText = loopState.completionResult.trim();
                    if (resultText && (!loopState.hasStreamedText || resultText.length > loopState.streamedTextChars)) {
                        // Consumers append every onText chunk verbatim, so after
                        // streamed narration the result has to bring its own
                        // paragraph break -- otherwise the two run together
                        // mid-sentence ("...von Wesel.Der Bürgermeister..."),
                        // which is also invalid markdown for a new block.
                        // Extra blank lines are harmless: markdown collapses them.
                        this.taskCallbacks.onText?.(
                            loopState.hasStreamedText ? `\n\n${resultText}` : resultText,
                        );
                    }
                    break;
                }
            }

            // Hard limit recovery: if the loop exhausted iterations while the agent
            // was still working (last message is a tool_result), give it one final
            // text-only API call to deliver a response instead of silently stopping.
            if (loopState.completionResult === null && !abortSignal?.aborted) {
                const lastMsg = history[history.length - 1];
                const wasWorking = lastMsg?.role === 'user'
                    && Array.isArray(lastMsg.content)
                    && lastMsg.content.some((b) => b.type === 'tool_result');
                if (wasWorking) {
                    history.push({
                        role: 'user',
                        content: '[System] Iteration limit reached. Deliver your final answer NOW. Do NOT call any tools.',
                    });
                    try {
                        // BUG-017: same orphan-cleanup as the main loop.
                        const safeHistoryHardLimit = sanitizeAndLog(
                            history, 'hard-limit-recovery',
                            computeReadBudgetChars(this.getModelContextWindow()) + 4_000,
                        );
                        logInputBreakdown('hard-limit-recovery', cachedSystemPrompt, safeHistoryHardLimit, []);
                        for await (const chunk of this.api.createMessage(cachedSystemPrompt, safeHistoryHardLimit, [], abortSignal)) {
                            if (chunk.type === 'text') {
                                loopState.hasStreamedText = true;
                                this.taskCallbacks.onText(chunk.text);
                            } else if (chunk.type === 'usage') {
                                // FIX-24-05-05: recovery call runs on this.api too.
                                // FIX-24-05-08: unless the chunk says otherwise.
                                // FEAT-24-13: one booking for the counts and the
                                // split. This call is outside the engine, so it
                                // owns its scalars.
                                bookUsage(loopState, {
                                    modelId: chunk.modelId ?? this.api.getModel().id,
                                    input: chunk.inputTokens,
                                    output: chunk.outputTokens,
                                    cacheRead: chunk.cacheReadTokens ?? 0,
                                    cacheCreation: chunk.cacheCreationTokens ?? 0,
                                    source: 'recovery',
                                    iteration: loopState.iteration,
                                });
                            }
                        }
                    } catch (e) {
                        console.warn('[AgentTask] Hard limit recovery call failed (non-fatal):', e);
                    }
                }
            }

            // Feature 6: Report total token usage before completing.
            // FIX-24-05-04: the auxiliary usage (condensing, FastPath) is
            // folded into the totals inside reportFinalUsage, so the
            // telemetry literal below sees the same numbers as the footer.
            this.reportFinalUsage(loopState);

            // FEAT-32-02 PR 2.2 / ADR-133: episode recording moved into the
            // finally block at the end of run() so iteration-cap and error
            // exits also produce an episode (telemetry-complete). The
            // ADR-018 contract (toolSequence + toolLedger) is preserved.

            // ADR-063: Clean up externalized temp files after task completion.
            // Issue 3 Wave A: fire-and-forget instead of awaited. Cleanup does
            // retry-heavy FS ops that stall on iCloud during sync windows;
            // awaiting it here gated onComplete() (and thus the UI unlock after
            // Stop) on that stall. ResultExternalizer.cleanupOrphaned sweeps
            // anything left behind on the next plugin start, so backgrounding
            // it loses nothing.
            void pipeline.cleanupExternalized();

            // AUDIT-2026-08-27 L-6: a run that executed no iteration completed
            // nothing, and this exit is the one that files it. A user Stop at the
            // loop boundary also runs zero iterations and leaves through here
            // (the check is signal-based, same as the snapshot keep-decision in
            // the finally), and that is a stop, not a failure -- so it stays out.
            // What is left is a loop that could not start: a resume with no room
            // that the clamp did not catch, or an iteration limit of zero, which
            // the settings file and update_settings accept even though the
            // slider does not offer it.
            const ranNoIteration = loopState.telemetryIterations <= iterationsBeforeRun
                && abortSignal?.aborted !== true;
            // ADR-090 Lever 10: emit telemetry before completing
            this.taskCallbacks.onTaskTelemetry?.({
                taskId,
                // FIX-24-11-02: the same producer the request rows read, so the
                // two files cannot state two reasons for one run.
                routingMode: this.routingModeForRun(),
                inputTokens: loopState.totalInputTokens,
                outputTokens: loopState.totalOutputTokens,
                cacheReadTokens: loopState.totalCacheReadTokens,
                cacheCreationTokens: loopState.totalCacheCreationTokens,
                toolSequence: repetitionDetector.getToolSequence(),
                iterations: loopState.telemetryIterations,
                outcome: ranNoIteration ? 'error' : 'completed',
                ...(ranNoIteration
                    ? {
                        errorMessage: 'no iteration ran: the loop opened at iteration '
                            + `${loopState.iteration} against a limit of ${MAX_ITERATIONS}`,
                    }
                    : {}),
            });
            if (ranNoIteration) {
                console.warn(
                    `[AgentTask] run ${taskId} executed no iteration (opened at ${loopState.iteration}, `
                    + `limit ${MAX_ITERATIONS}); reported as an error rather than as a completed run.`,
                );
            }

            // Episode grading at the normal success-exit (ADR-133 / ADR-058):
            // binary grading.
            // - clean attempt_completion -> accept.
            // - clean natural exit (model streamed visible text, used at
            //   least one tool, no tool errors, didn't hit the iteration
            //   cap) -> accept. This is the read-only / question shape
            //   the prompt explicitly steers the model into; reaching it
            //   IS a successful turn from the user's POV.
            // - everything else at the success-exit (iteration cap hit,
            //   hard-limit recovery firing) -> abandon.
            const hitIterationCap = loopState.telemetryIterations >= MAX_ITERATIONS;
            const productiveToolWork = repetitionDetector.getToolSequence().length > 0;
            loopState.cleanNaturalExit =
                loopState.completionResult === null
                && loopState.hasStreamedText
                && productiveToolWork
                && loopState.totalToolErrors === 0
                && loopState.consecutiveMistakes === 0
                && !hitIterationCap;
            loopState.turnOutcome =
                (loopState.completionResult !== null || loopState.cleanNaturalExit)
                    ? 'accept'
                    : 'abandon';

            this.taskCallbacks.onComplete();
            return;  // Success — exit the emergency retry loop
        } catch (error) {
            // AbortError is expected when user cancels — not a real error.
            // Also: when the abort signal is already triggered, ANY error
            // (including TypeError: Failed to fetch) is a cancellation side-effect.
            const isAbort = error instanceof Error && error.name === 'AbortError';
            const isAbortedSignal = abortSignal?.aborted === true;
            if (isAbort || isAbortedSignal) {
                console.debug('[AgentTask] Task cancelled by user');
                // FIX-24-05-06: a stopped run reports its OWN numbers and its
                // own model. The aux fold happens inside reportFinalUsage, so
                // the telemetry entry below reads the same totals.
                this.reportFinalUsage(loopState, 'abort');
                this.taskCallbacks.onTaskTelemetry?.({
                    taskId,
                    // FIX-24-11-02: a stopped run still had a routing decision.
                    routingMode: this.routingModeForRun(),
                    inputTokens: loopState.totalInputTokens,
                    outputTokens: loopState.totalOutputTokens,
                    cacheReadTokens: loopState.totalCacheReadTokens,
                    cacheCreationTokens: loopState.totalCacheCreationTokens,
                    toolSequence: repetitionDetector.getToolSequence(),
                    iterations: loopState.telemetryIterations,
                    outcome: 'aborted',
                });
                // Abort is negative evidence for the episode grading.
                loopState.turnOutcome = 'abandon';
                // IMP-24-08-04: mark the exit so telemetry/forensics can
                // distinguish a user stop from a clean end. The snapshot
                // keep-decision in the finally is signal-based (covers the
                // loop-boundary abort break too), this is documentation.
                loopState.phase = 'aborted';
                this.taskCallbacks.onComplete();
                return;
            }

            // Remove orphaned assistant tool_call messages from history.
            // These arise when an error occurs after the assistant message was pushed
            // but before tool results were added. Leaving them causes OpenAI 400 errors
            // ("assistant message with tool_calls must be followed by tool messages")
            // on the next user message in the same conversation.
            while (history.length > 0) {
                const last = history[history.length - 1];
                const isOrphaned = last.role === 'assistant'
                    && Array.isArray(last.content)
                    && last.content.some((b) => b.type === 'tool_use');
                if (isOrphaned) {
                    history.pop();
                } else {
                    break;
                }
            }

            const err = error instanceof Error ? error : new Error(String(error));

            // IMP-41-01-01 / ADR-146: structured error classification replaces
            // the two message-regex checks. The policy is a pure function in
            // loopErrorPolicy.ts; this catch block only executes its verdict.
            const errorAction = decideLoopErrorAction(error, {
                retriesUsed: loopState.rateLimitRetries,
                maxRetries: RATE_LIMIT_MAX_RETRIES,
                emergencyRetried: loopState.emergencyRetried,
                outputCapRetried: loopState.outputCapRetried,
                effortToolsRetried: loopState.effortToolsRetried,
                historyLength: history.length,
                rateLimitBaseWaitMs: RATE_LIMIT_BASE_WAIT_MS,
            });

            // ADR-148: the provider rejected our max_tokens as above the
            // model's real output limit (new/unregistered model running on
            // the optimistic default). Learn the cap — persisted and injected
            // into resolveOutputBudget, so every later request (this task and
            // future ones) is clamped — then retry once.
            if (errorAction.action === 'corrective-retry') {
                // FIX-54-10: the provider rejected function tools combined
                // with reasoning_effort (gpt-5.6 platform generation on
                // chat/completions). Learn the per-model flag (persisted and
                // injected into the registry, so the OpenAI request builder
                // forces reasoning_effort 'none' with tools from now on),
                // then retry once. The provider names 'none' as the accepted
                // escape; omitting the field is NOT equivalent (reasoning
                // models default to a non-none effort server-side).
                if (errorAction.cls === 'effort-tools-unsupported') {
                    loopState.effortToolsRetried = true;
                    const effortModelId = this.api.getModel().id;
                    await learnEffortToolsUnsupported(effortModelId);
                    console.warn(
                        `[EffortTools] ${effortModelId}: provider rejected reasoning_effort combined with `
                        + `function tools; learned effortWithToolsUnsupported -- retrying with effort 'none'`,
                    );
                    this.taskCallbacks.onText(
                        `\n\n*${effortModelId} does not support reasoning effort together with tools -- `
                        + `automatically retrying with effort 'none'...*\n\n`,
                    );
                    continue;
                }
                loopState.outputCapRetried = true;
                const capModelId = this.api.getModel().id;
                const parsed = parseOutputCapLimit(error);
                const fallback = Math.max(4_096, Math.floor(resolveOutputBudget(capModelId, undefined).maxTokens / 2));
                const cap = await learnOutputCap(capModelId, parsed ?? fallback);
                console.warn(
                    `[OutputCap] ${capModelId}: provider rejected max_tokens; `
                    + `learned cap ${cap} tokens (${parsed !== null ? 'parsed from error' : 'halved fallback'}) — retrying`,
                );
                continue;
            }

            // Emergency condensing on context overflow (400 "prompt too long" etc.)
            // Instead of failing, condense the history and let the user retry.
            if (errorAction.action === 'emergency-condense') {
                console.warn('[AgentTask] Context overflow detected — attempting emergency condensing');
                try {
                    // 6B: Pre-compaction memory flush before emergency condensing
                    await this.taskCallbacks.onPreCompactionFlush?.(history).catch((e) =>
                        console.warn('[AgentTask] Pre-compaction flush failed (non-fatal):', e)
                    );
                    // FIX-COMPACT-02: only mark emergency consumed when the
                    // inner condense actually succeeded. Otherwise the next
                    // overflow falls straight through to onError without a
                    // second graceful attempt, even though no useful work
                    // was done on this one.
                    const condensed = await this.condenseHistory(history, cachedSystemPrompt, abortSignal);
                    if (condensed) {
                        loopState.emergencyRetried = true;
                        console.debug('[AgentTask] Emergency condensing succeeded — retrying agent loop');
                        continue;  // 6A: Retry the agent loop with condensed history
                    }
                    console.warn('[AgentTask] Emergency condensing produced no result — propagating original error');
                } catch (e) {
                    // condenseHistory now catches helper-api errors itself;
                    // anything reaching here is from the pre-flush hook or
                    // unexpected. Fall through to normal error handling.
                    console.warn('[AgentTask] Emergency condensing threw unexpectedly:', e);
                }
            }

            // Transient-error retry (IMP-41-01-01): rate-limit keeps the
            // conservative 30s base when the provider sends no Retry-After;
            // overloaded/5xx/network use the short 2s curve. The wait itself
            // is abort-aware (no lingering sleep after Stop).
            if (errorAction.action === 'retry') {
                loopState.rateLimitRetries = errorAction.retryNumber;
                // IMP-41-02-03: a classified 429 halves the shared bucket
                // rate for a cooldown so parallel call sites back off too.
                if (errorAction.cls === 'rate-limit') {
                    requestRateLimiter.reportRateLimited(
                        this.api.providerType ?? 'unknown',
                        this.api.getModel().id,
                    );
                }
                const waitMs = errorAction.waitMs;
                const waitSec = Math.round(waitMs / 1000);
                const label = errorAction.cls === 'rate-limit' ? 'Rate limit reached' : 'Temporary provider error';
                console.warn(`[AgentTask] ${errorAction.cls} — retry ${loopState.rateLimitRetries}/${RATE_LIMIT_MAX_RETRIES} in ${waitSec}s`);
                this.taskCallbacks.onText(`\n\n*${label} -- automatically retrying in ${waitSec} seconds (${loopState.rateLimitRetries}/${RATE_LIMIT_MAX_RETRIES})...*\n\n`);
                try {
                    await abortableDelay(waitMs, abortSignal);
                } catch {
                    console.debug('[AgentTask] Abort signal detected during retry wait');
                    // FIX-24-05-06: this exit is a stop like any other -- it
                    // must not leave the footer on the last inner report.
                    this.reportFinalUsage(loopState, 'retry-wait abort');
                    this.taskCallbacks.onComplete();
                    return;
                }
                continue;  // Retry the agent loop
            }

            // FIX-24-05-06: a failed run has already spent its tokens, so it
            // reports them before the error surfaces. The aux fold happens
            // inside reportFinalUsage.
            this.reportFinalUsage(loopState, 'error');
            // ADR-090 Lever 10: telemetry for error outcomes too
            this.taskCallbacks.onTaskTelemetry?.({
                taskId,
                // FIX-24-11-02: so does a failed one.
                routingMode: this.routingModeForRun(),
                inputTokens: loopState.totalInputTokens,
                outputTokens: loopState.totalOutputTokens,
                cacheReadTokens: loopState.totalCacheReadTokens,
                cacheCreationTokens: loopState.totalCacheCreationTokens,
                toolSequence: repetitionDetector.getToolSequence(),
                iterations: loopState.telemetryIterations,
                outcome: 'error',
                errorMessage: err.message,
            });

            // Network errors (e.g. "Failed to fetch") get a friendlier message
            const isNetworkError = err instanceof TypeError
                && /failed to fetch|network|econnrefused/i.test(err.message);
            if (isNetworkError) {
                console.warn('[AgentTask] Network error:', err.message);
                this.taskCallbacks.onError(new Error(
                    'Connection to the API failed. Check your network and API key, then try again.',
                ));
            } else {
                console.error('[AgentTask] Task failed:', err);
                loopState.phase = 'failed';
            this.taskCallbacks.onError(err);
            }
            // Thrown error (parse failure, circuit-breaker trip from
            // consecutive tool errors, API/network failure after retries)
            // is negative evidence for the episode grading.
            loopState.turnOutcome = 'abandon';
            return;  // Error — exit the emergency retry loop
        }
        } // while (true) — emergency condensing retry loop
        } finally {
            // IMP-41-03-01: clean exits clear the inflight snapshot. On a
            // FAILED run the snapshot stays as recovery/forensic data until
            // the 24h sweep; on a hard crash this finally never runs and
            // the snapshot survives too.
            // IMP-24-08-04 (stop=pause): an ABORTED run also keeps its
            // snapshot -- the sidebar offers a Resume card so the user can
            // continue from the last turn boundary. The pending debounced
            // write is flushed so the card sees the freshest state. The
            // check is signal-based because an abort at the loop boundary
            // exits through the success path, not the catch.
            if (this.inflightStore && loopState.phase !== 'failed' && !abortSignal?.aborted) {
                void this.inflightStore.clear(taskId);
            } else if (this.inflightStore && abortSignal?.aborted) {
                void this.inflightStore.flushNow();
            }

            // ADR-133: episode recording (single source of truth for the
            // episode payload). Fires for every exit path -- success,
            // iteration-cap, abort, error -- so RecipePromotion sees the
            // complete picture. `success` is derived from the
            // already-graded loopState.turnOutcome plus the closure counters.
            try {
                const toolSeq = repetitionDetector.getToolSequence();
                if (toolSeq.length > 0) {
                    // A clean natural exit counts as success for
                    // episode-recording too, not just an explicit
                    // attempt_completion, so RecipePromotion (ADR-058
                    // organic 3-similar) is not starved on the read-only /
                    // question task shape the prompt explicitly steers into.
                    const episodeSuccess =
                        loopState.turnOutcome === 'accept'
                        && loopState.totalToolErrors === 0
                        && (loopState.attemptCompletionFired || loopState.cleanNaturalExit);
                    this.taskCallbacks.onEpisodeData?.({
                        toolSequence: toolSeq,
                        toolLedger: repetitionDetector.getLedger(),
                        success: episodeSuccess,
                        mistakesEncountered: loopState.totalToolErrors,
                        attemptCompletionFired: loopState.attemptCompletionFired,
                        fastPathFired: loopState.fastPathFired,
                        recipeWinner: fastPathInterceptor.getRecipeWinnerId(),
                    });
                }
            } catch (e) {
                console.warn('[AgentTask] onEpisodeData hook failed (non-fatal):', e);
            }
        }
        perfMarks.end(turnLabel, { log: true });
    }

    // -------------------------------------------------------------------------
    // Context Condensing helpers
    // -------------------------------------------------------------------------

    /**
     * Improved token estimate that accounts for structured content blocks.
     * ~4 chars/token for text, +150 for tool_use overhead, +50 for tool_result overhead.
     */
    /**
     * FIX-PERF-19: per-message token estimator. The original
     * estimateTokens(messages: MessageParam[]) is now a thin wrapper.
     * Hot paths (condense tail walk, per-iteration token math) call
     * this directly to avoid allocating single-element arrays.
     */
    private estimateMessageTokens(m: MessageParam): number {
        // IMP-41-01-04: char-based counts run through the calibrated
        // chars-per-token factor (default 4.0 = legacy parity); structural
        // surcharges (tool_use plumbing, images) stay fixed.
        const toTokens = (chars: number): number => this.tokenEstimator.tokensForChars(chars);
        let count = 0;
        if (Array.isArray(m.content)) {
            for (const block of m.content) {
                if (block.type === 'text' && 'text' in block && typeof block.text === 'string') {
                    count += toTokens(block.text.length);
                } else if (block.type === 'thinking' && 'text' in block && typeof block.text === 'string') {
                    count += toTokens(block.text.length);
                } else if (block.type === 'tool_use') {
                    count += 150;
                    if ('input' in block && block.input) {
                        count += toTokens(JSON.stringify(block.input).length);
                    }
                } else if (block.type === 'tool_result') {
                    count += 50;
                    if ('content' in block) {
                        if (typeof block.content === 'string') {
                            count += toTokens(block.content.length);
                        } else if (Array.isArray(block.content)) {
                            for (const sub of block.content) {
                                if (sub.type === 'text') count += toTokens(sub.text.length);
                                else if (sub.type === 'image') count += 1000;
                            }
                        }
                    }
                } else if (block.type === 'image') {
                    count += 1000;
                }
            }
        } else if (typeof m.content === 'string') {
            count += toTokens(m.content.length);
        }
        return count;
    }

    private estimateTokens(messages: MessageParam[]): number {
        let count = 0;
        for (const m of messages) {
            count += this.estimateMessageTokens(m);
        }
        return count;
    }

    /** Approximate context window for the active model (tokens). */
    private getModelContextWindow(): number {
        const model = this.api.getModel();
        // getModel() returns { id: string; info: ModelInfo } — extract the id string
        const modelId: string = typeof model === 'string' ? model : (model?.id ?? '');
        // Use the provider-reported context window when available. Providers now
        // resolve this through the registry, so this branch is the normal path.
        if (model?.info?.contextWindow) return model.info.contextWindow;
        // Fallback for a provider that returns no window: consult the same
        // registry (with normalization + Claude family-floor inference) rather
        // than the old flat claude=200k/gpt=128k ladder, which capped 1M models.
        return registryContextWindow(modelId);
    }

    /**
     * Condense history in-place using a separate LLM summarization call.
     * Keeps the first message (original task) + last 4 messages intact;
     * replaces everything in between with a single summary block.
     */
    /**
     * FIX-COMPACT-02: returns true on a successful condense pass (history
     * was spliced), false on any non-fatal skip (history too short, summary
     * empty) or failure (helper-api threw). Callers that retry or fall
     * back (emergency condensing, retry loop) MUST check this value.
     *
     * FIX-COMPACT-06: `maxTailTokens` override lets the retry loop shrink
     * the tail each pass (10k -> 5k -> 2.5k) instead of repeating an
     * identical call. Default 10k preserves the historical behaviour.
     */
    private async condenseHistory(
        history: MessageParam[],
        systemPrompt: string,
        abortSignal?: AbortSignal,
        toolCallLedger?: string,
        maxTailTokens: number = 10_000,
    ): Promise<boolean> {
        // Need at least first + 4 tail + some middle to condense
        if (history.length < 7) return false;

        // FIX-COMPACT-07: telemetry start. The event fires from a single
        // `emit()` helper at every exit path so we cannot forget a branch.
        const telemetryStartedAt = new Date().toISOString();
        const telemetryStartMs = Date.now();
        const telemetryPrevTokens = this.estimateTokens(history);

        const firstMsg = history[0];

        // Smart tail: collect messages from end until maxTailTokens tokens or min 2 messages.
        // IMPORTANT: We must never split a tool_use / tool_result pair across the
        // condensing boundary — Anthropic requires every tool_use block to be
        // immediately followed by a tool_result in the next message.
        const MAX_TAIL_TOKENS = Math.max(1_000, maxTailTokens);
        const MIN_TAIL_MESSAGES = 2;
        const tail: MessageParam[] = [];
        let tailTokens = 0;

        for (let i = history.length - 1; i >= 0; i--) {
            const msg = history[i];
            const msgTokens = this.estimateMessageTokens(msg);

            if (tail.length >= MIN_TAIL_MESSAGES && tailTokens + msgTokens > MAX_TAIL_TOKENS) {
                break;
            }

            tail.unshift(msg);  // Prepend to maintain order
            tailTokens += msgTokens;
        }

        // Guarantee min 2 messages (last user+assistant pair)
        if (tail.length < MIN_TAIL_MESSAGES && history.length >= MIN_TAIL_MESSAGES) {
            const fallbackTail = history.slice(-MIN_TAIL_MESSAGES);
            tail.splice(0, tail.length, ...fallbackTail);
        }

        // Fix tool_use / tool_result boundary: Anthropic requires every assistant
        // tool_use block to be immediately followed by a user tool_result message.
        // The tail boundary must never split such a pair. We also need to ensure
        // that toSummarize (sent to the condensing API) doesn't end with an
        // orphaned tool_use or tool_result.
        const tailStartIdx = history.length - tail.length;
        if (tailStartIdx > 0 && tail.length > 0) {
            const firstTailMsg = tail[0];
            const contentArr = Array.isArray(firstTailMsg.content) ? firstTailMsg.content : [];

            if (firstTailMsg.role === 'user'
                && contentArr.some((b: ContentBlock) => b.type === 'tool_result')) {
                // Case 1: Tail starts with tool_result — pull preceding assistant(tool_use) in
                const prevMsg = history[tailStartIdx - 1];
                tail.unshift(prevMsg);
                tailTokens += this.estimateMessageTokens(prevMsg);
            }
        }

        // After adjusting for Case 1, recompute the split point
        const toSummarize = history.slice(0, history.length - tail.length);

        // Case 2: toSummarize ends with assistant(tool_use) — the condensing API
        // call would receive tool_use without tool_result, causing a 400 error.
        // Move the trailing tool_use assistant + its tool_result user into the tail.
        while (toSummarize.length > 1) {
            const lastSumMsg = toSummarize[toSummarize.length - 1];
            const lastContent = Array.isArray(lastSumMsg.content) ? lastSumMsg.content : [];
            const endsWithToolUse = lastSumMsg.role === 'assistant'
                && lastContent.some((b: ContentBlock) => b.type === 'tool_use');

            if (!endsWithToolUse) break;

            // Move the assistant(tool_use) and its following user(tool_result) to the tail
            const moved = toSummarize.splice(-1, 1);
            tail.unshift(...moved);
            // If tail now starts with assistant(tool_use), the tool_result should
            // already be the next element in the original tail — no further action needed.

            // Re-check: the new last element might also be a user(tool_result) whose
            // assistant(tool_use) was already moved, creating another orphan. Loop handles this.
        }

        // Case 3: toSummarize ends with user(tool_result) — the condensing API
        // would have tool_result without the preceding tool_use, causing a 400.
        while (toSummarize.length > 1) {
            const lastSumMsg = toSummarize[toSummarize.length - 1];
            const lastContent = Array.isArray(lastSumMsg.content) ? lastSumMsg.content : [];
            const endsWithToolResult = lastSumMsg.role === 'user'
                && lastContent.some((b: ContentBlock) => b.type === 'tool_result');

            if (!endsWithToolResult) break;

            // Move this tool_result and the preceding assistant(tool_use) to the tail
            const movedResult = toSummarize.splice(-1, 1);
            tail.unshift(...movedResult);
            // Also move the preceding assistant message (should contain tool_use)
            if (toSummarize.length > 1) {
                const movedAssistant = toSummarize.splice(-1, 1);
                tail.unshift(...movedAssistant);
            }
        }

        // After boundary adjustments, toSummarize might be too small to condense
        if (toSummarize.length < 3) {
            console.debug('[AgentTask] toSummarize too small after boundary fix — skipping condensing');
            this.condensedSinceLastRequest = true; // FEAT-24-11
            this.taskCallbacks.onCondenseTelemetry?.({
                startedAt: telemetryStartedAt,
                durationMs: Date.now() - telemetryStartMs,
                success: false,
                prevTokens: telemetryPrevTokens,
                newTokens: telemetryPrevTokens,
                savedTokens: 0,
                helperModelUsed: false,
                modelId: this.api.getModel().id,
                maxTailTokens,
                errorMessage: 'toSummarize too small after boundary fix',
            });
            return false;
        }

        // Pre-condensing logging
        const preMessageCount = history.length;
        const preTokens = this.estimateTokens(history);
        console.debug(
            `[AgentTask] Context condensing triggered:\n` +
            `  Messages: ${preMessageCount}\n` +
            `  Estimated tokens: ${preTokens}\n` +
            `  Threshold: ${Math.floor(this.getModelContextWindow() * (this.condensingThreshold / 100))} (${this.condensingThreshold}%)`
        );

        const condensingInstruction =
            'Summarize this conversation compactly. Preserve:\n' +
            '- The original task and goal\n' +
            '- Key decisions made\n' +
            // IMP-41-03-06: per-file detail lives in the deterministic FILE
            // DOSSIER appended after the summary -- the narrative should focus
            // on decisions and open steps instead of re-listing file contents.
            (this.fileDossier.render()
                ? '- Files: a deterministic FILE DOSSIER is appended separately; do NOT re-list per-file contents, focus on decisions and next steps\n'
                : '- Files read, created, or modified (include exact paths)\n') +
            '- Important findings, code snippets, or facts discovered\n' +
            '- ALL tool calls that were executed and their outcomes\n' +
            '- Search queries performed and their result summaries\n' +
            '- Errors encountered and how they were resolved\n\n' +
            (toolCallLedger ? toolCallLedger + '\n\n' : '') +
            'IMPORTANT: After condensing, the agent MUST NOT repeat tool calls listed above.\n\n' +
            'Output only the summary — no preamble or meta-commentary.';

        // Build the message list for the condensing API call.
        // Ensure proper role alternation: if toSummarize ends with a user message,
        // merge the condensing instruction into it instead of appending a second user message.
        const condensingMessages = [...toSummarize];
        const lastMsg = condensingMessages[condensingMessages.length - 1];
        if (lastMsg.role === 'user') {
            // Merge: append instruction to existing user message
            const existingContent = typeof lastMsg.content === 'string'
                ? lastMsg.content
                : lastMsg.content.filter(b => b.type === 'text').map(b => 'text' in b ? b.text : '').join('\n');
            condensingMessages[condensingMessages.length - 1] = {
                role: 'user',
                content: existingContent + '\n\n---\n\n' + condensingInstruction,
            };
        } else {
            // toSummarize ends with assistant — safe to append a user message
            condensingMessages.push({ role: 'user', content: condensingInstruction });
        }

        let summary = '';
        let helperModelUsed = false;
        let condensingModelId = this.api.getModel().id;
        try {
            // FIX-COMPACT-05: replace MicroCompactor skeletons with a short
            // placeholder so the helper LLM does not paraphrase the skeleton
            // text ("[context-pruned] read_file result (5000 chars)...") into
            // the summary. Pairing is preserved -- tool_use_id stays intact.
            const strippedCondensingMessages = stripPrunedForCondense(condensingMessages);
            // BUG-017: condensing has its own pairing-fix higher up, but apply
            // the generic sanitize as well so any new edge case is caught.
            const safeCondensingMessages = sanitizeAndLog(strippedCondensingMessages, 'condensing');
            logInputBreakdown('condensing', systemPrompt, safeCondensingMessages, []);
            // FEAT-24-07 / ADR-115: route condensing through the optional helper model.
            const condensingApi = getHelperApi(this.toolRegistry.plugin, this.api);
            helperModelUsed = condensingApi !== this.api;
            condensingModelId = condensingApi.getModel().id;
            for await (const chunk of condensingApi.createMessage(
                systemPrompt,
                safeCondensingMessages,
                [],
                abortSignal,
            )) {
                if (chunk.type === 'text') summary += chunk.text;
                // FIX-24-05-04: condensing tokens cost money too -- collect
                // them so the run() totals (footer + telemetry) include them.
                else if (chunk.type === 'usage') {
                    // FIX-24-05-05: condensing may run on the helper model --
                    // attribute to the model that actually served it.
                    // FIX-24-05-08: the chunk's own id wins; condensingModelId
                    // is the fallback for a handler built outside the factory.
                    this.foldAuxUsage({
                        modelId: chunk.modelId ?? condensingModelId,
                        inputTokens: chunk.inputTokens,
                        outputTokens: chunk.outputTokens,
                        cacheReadTokens: chunk.cacheReadTokens ?? 0,
                        cacheCreationTokens: chunk.cacheCreationTokens ?? 0,
                        // FEAT-24-13: no numbered iteration is in scope here --
                        // condenseHistory is a method and the emergency pass
                        // runs between iterations.
                    }, 'condense');
                }
            }
        } catch (e) {
            // FIX-COMPACT-02: never swallow silently. The previous empty
            // catch meant rate-limit / 5xx errors looped the agent into
            // the same over-threshold state, and emergencyRetried got
            // flipped even when the inner condense did nothing.
            const err = e instanceof Error ? e : new Error(String(e));
            console.warn('[AgentTask] Context condensing failed (history unchanged):', err.message);
            this.taskCallbacks.onContextCondenseFailed?.(err);
            this.condensedSinceLastRequest = true; // FEAT-24-11
            this.taskCallbacks.onCondenseTelemetry?.({
                startedAt: telemetryStartedAt,
                durationMs: Date.now() - telemetryStartMs,
                success: false,
                prevTokens: telemetryPrevTokens,
                newTokens: telemetryPrevTokens,
                savedTokens: 0,
                helperModelUsed,
                modelId: condensingModelId,
                maxTailTokens,
                errorMessage: err.message.slice(0, 500),
            });
            return false;
        }

        if (!summary.trim()) {
            console.warn('[AgentTask] Context condensing produced empty summary; history unchanged');
            this.taskCallbacks.onContextCondenseFailed?.(new Error('empty summary from helper API'));
            this.condensedSinceLastRequest = true; // FEAT-24-11
            this.taskCallbacks.onCondenseTelemetry?.({
                startedAt: telemetryStartedAt,
                durationMs: Date.now() - telemetryStartMs,
                success: false,
                prevTokens: telemetryPrevTokens,
                newTokens: telemetryPrevTokens,
                savedTokens: 0,
                helperModelUsed,
                modelId: condensingModelId,
                maxTailTokens,
                errorMessage: 'empty summary from helper API',
            });
            return false;
        }

        // IMP-41-03-04: forensic snapshot of the history as it looked BEFORE
        // the rewrite (bounded 3 generations, deep-copied).
        this.condenseForensics.recordGeneration(
            `pre-condense ${new Date().toISOString()} (${preMessageCount} msgs, ~${preTokens}t)`,
            history,
        );

        // Splice history in-place
        history.splice(
            0,
            history.length,
            firstMsg,
            {
                role: 'assistant',
                // IMP-41-03-06: two-level summary -- the LLM narrative plus the
                // DETERMINISTIC per-file dossier (no hallucination risk), so the
                // model stops re-reading files the flat summary paraphrased away.
                content: [{
                    type: 'text',
                    text: `[Conversation Summary]\n\n${summary.trim()}`
                        + (this.fileDossier.render() ? `\n\n${this.fileDossier.render()}` : ''),
                }],
            },
            {
                role: 'user',
                content: '[Context condensed to save space. Continue the task from here.]',
            },
            ...tail,
        );

        // Post-condensing logging
        const postMessageCount = history.length;
        const postTokens = this.estimateTokens(history);
        // IMP-41-03-04 safe subset: pair the pre-condense snapshot with the
        // post-splice state so getCondenseTimeline() shows before/after
        // pairs (the "what did condensing eat?" diagnosis ADR-149 targets).
        this.condenseForensics.recordGeneration(
            `post-condense ${new Date().toISOString()} (${postMessageCount} msgs, ~${postTokens}t)`,
            history,
        );
        const contextWindow = this.getModelContextWindow();
        const threshold = Math.floor(contextWindow * (this.condensingThreshold / 100));
        const percentUsed = contextWindow > 0 ? Math.round((postTokens / contextWindow) * 100) : 0;

        console.debug(
            `[AgentTask] Context condensed:\n` +
            `  Before: ${preMessageCount} msgs, ~${preTokens} tokens\n` +
            `  After:  ${postMessageCount} msgs, ~${postTokens} tokens\n` +
            `  Saved:  ~${preTokens - postTokens} tokens (${Math.round(((preTokens - postTokens) / preTokens) * 100)}%)\n` +
            `  Threshold: ${threshold} tokens (${this.condensingThreshold}%)\n` +
            `  Status: ${percentUsed}% of context window used`
        );

        // Notify callback with token counts
        this.taskCallbacks.onContextCondensed?.(preTokens, postTokens);
        // FIX-COMPACT-07: structured telemetry event for the successful pass.
        this.condensedSinceLastRequest = true; // FEAT-24-11
            this.taskCallbacks.onCondenseTelemetry?.({
            startedAt: telemetryStartedAt,
            durationMs: Date.now() - telemetryStartMs,
            success: true,
            prevTokens: preTokens,
            newTokens: postTokens,
            savedTokens: Math.max(0, preTokens - postTokens),
            helperModelUsed,
            modelId: condensingModelId,
            maxTailTokens,
        });
        return true;
    }

    /** Resolve a mode slug or ModeConfig to a ModeConfig */
    private resolveMode(mode: string | ModeConfig): ModeConfig {
        if (typeof mode !== 'string') return mode;

        if (this.modeService) {
            return this.modeService.getMode(mode) ?? this.modeService.getActiveMode();
        }

        // Fallback: use builtinModes directly
        return BUILT_IN_MODES.find((m: ModeConfig) => m.slug === mode)
            ?? BUILT_IN_MODES[0];
    }
}
