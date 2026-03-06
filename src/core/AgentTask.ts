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
import { buildSystemPromptForMode } from './systemPrompt';
import type { ModeService } from './modes/ModeService';
import type { ModeConfig } from '../types/settings';
import type { McpClient } from './mcp/McpClient';
import { BUILT_IN_MODES } from './modes/builtinModes';

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
    /** Called with cumulative token usage just before onComplete (Feature 6) */
    onUsage?: (inputTokens: number, outputTokens: number, cacheReadTokens?: number, cacheCreationTokens?: number) => void;
    /** Called when the task is complete (attempt_completion or natural end) */
    onComplete: () => void;
    /** Called when attempt_completion fires — triggers todo auto-complete */
    onAttemptCompletion?: () => void;
    /** Called when ask_followup_question is invoked — pauses loop until resolved */
    onQuestion?: (question: string, options: string[] | undefined, resolve: (answer: string) => void, allowMultiple?: boolean) => void;
    /** Called when a write tool needs user approval — pauses loop until user decides */
    onApprovalRequired?: (toolName: string, input: Record<string, unknown>) => Promise<import('./tool-execution/ToolExecutionPipeline').ApprovalResult>;
    /** Called when update_todo_list publishes a new todo plan */
    onTodoUpdate?: (items: import('./tools/agent/UpdateTodoListTool').TodoItem[]) => void;
    /** Called when switch_mode changes the active mode */
    onModeSwitch?: (newModeSlug: string) => void;
    /** Called when the conversation history was condensed (context summarized) - includes token counts before/after */
    onContextCondensed?: (prevTokens?: number, newTokens?: number) => void;
    /** Called when a checkpoint is saved before a write tool */
    onCheckpoint?: (checkpoint: import('./checkpoints/GitCheckpointService').CheckpointInfo) => void;
    /** Called just before onComplete with tool execution data for episodic memory (ADR-018) */
    onEpisodeData?: (data: { toolSequence: string[], toolLedger: string }) => void;
    /** Called before context condensing to flush important facts to memory (Phase 5) */
    onPreCompactionFlush?: (history: MessageParam[]) => Promise<void>;
    /** Called when an unrecoverable error occurs */
    onError: (error: Error) => void;
}

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
    skillsSection?: string;
    mcpClient?: McpClient;
    allowedMcpServers?: string[];
    memoryContext?: string;
    pluginSkillsSection?: string;
    recipesSection?: string;
    selfAuthoredSkillsSection?: string;
    configDir?: string;
    /** Active conversation ID for chat-linking frontmatter stamping (ADR-022) */
    conversationId?: string;
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

    constructor(
        api: ApiHandler,
        toolRegistry: ToolRegistry,
        taskCallbacks: AgentTaskCallbacks,
        modeService?: ModeService,
        consecutiveMistakeLimit = 0,
        rateLimitMs = 0,
        condensingEnabled = true,
        condensingThreshold = 70,
        powerSteeringFrequency = 0,
        maxIterations = 25,
        depth = 0,
        maxSubtaskDepth = 2,
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
            skillsSection,
            mcpClient,
            allowedMcpServers,
            memoryContext,
            pluginSkillsSection,
            recipesSection,
            selfAuthoredSkillsSection,
            configDir,
            conversationId,
        } = config;
        // Resolve mode to ModeConfig
        let activeMode: ModeConfig = this.resolveMode(initialMode);

        // Create per-task pipeline instance (like Kilo Code creates per-task context)
        const pipeline = new ToolExecutionPipeline(
            this.toolRegistry.plugin,
            this.toolRegistry,
            taskId,
            activeMode.slug,
        );

        // Add user message to the shared history
        history.push({ role: 'user', content: userMessage });

        const MAX_ITERATIONS = this.maxIterations;
        // Feature 6: Accumulate token usage across all iterations
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let totalCacheReadTokens = 0;
        let totalCacheCreationTokens = 0;
        // attempt_completion signal
        let completionResult: string | null = null;
        // Track whether the model streamed any text across all iterations.
        // Used to decide if the completion result should be rendered as fallback.
        let hasStreamedText = false;
        // Safety net: retry once if tools ran but model produced no visible response
        let hasRetriedEmpty = false;
        // switch_mode signal (checked at end of each iteration)
        let pendingModeSwitch: string | null = null;
        // Phase B: consecutive error tracking
        let consecutiveMistakes = 0;
        const repetitionDetector = new ToolRepetitionDetector();

        // Wire up context extensions for agent-control tools
        const askQuestion = this.taskCallbacks.onQuestion
            ? (question: string, options?: string[], allowMultiple?: boolean): Promise<string> => {
                return new Promise<string>((resolve) => {
                    this.taskCallbacks.onQuestion!(question, options, resolve, allowMultiple);
                });
            }
            : undefined;

        const signalCompletion = (result: string) => {
            completionResult = result;
        };

        const switchMode = (slug: string) => {
            pendingModeSwitch = slug;
        };

        // new_task: spawn a child AgentTask that runs in a fresh history and returns its result.
        // Depth-guard: children at maxSubtaskDepth get spawnSubtask = undefined (cannot nest further).
        const childDepth = this.depth + 1;
        const childCanSpawn = childDepth < this.maxSubtaskDepth;

        const spawnSubtask = async (childMode: string, childMessage: string): Promise<string> => {
            const childHistory: MessageParam[] = [];
            let childText = '';

            const childTask = new AgentTask(
                this.api,
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
                    onUsage: (i, o, cr, cc) => {
                        // Akkumuliere Subtask-Tokens in Parent-Totals
                        totalInputTokens += i;
                        totalOutputTokens += o;
                        totalCacheReadTokens += cr ?? 0;
                        totalCacheCreationTokens += cc ?? 0;
                        // Forward für UI-Update (wird später vom Parent-Final-Call überschrieben)
                        this.taskCallbacks.onUsage?.(i, o, cr, cc);
                    },
                    // K-1: Forward parent approval callback so subtask write ops are not
                    // auto-rejected by the fail-closed fallback in ToolExecutionPipeline.
                    onApprovalRequired: this.taskCallbacks.onApprovalRequired,
                },
                this.modeService,
                this.consecutiveMistakeLimit,
                this.rateLimitMs,
                // Subtasks don't condense or power-steer (keep child loops lean)
                false, 80, 0, this.maxIterations,
                childDepth,             // propagate nesting depth
                this.maxSubtaskDepth,   // propagate limit
            );

            await childTask.run({
                userMessage: childMessage,
                taskId: `${taskId}-sub-${Date.now()}`,
                initialMode: childMode,
                history: childHistory,
                abortSignal,
                globalCustomInstructions,
                includeTime,
                rulesContent,
                skillsSection,
                mcpClient,
                allowedMcpServers,
                pluginSkillsSection,
                selfAuthoredSkillsSection,
                configDir,
            });
            return childText;
        };

        // Cache system prompt + tool definitions — rebuilt only when the mode changes
        // or when settings that affect tool availability change (e.g. webTools.enabled).
        let cachedPromptMode = '';
        let cachedSystemPrompt = '';
        let cachedTools: ToolDefinition[] = [];
        let cacheInvalidated = false;

        const rebuildPromptCache = () => {
            const webEnabled = this.modeService?.isWebEnabled() ?? false;
            cachedSystemPrompt = buildSystemPromptForMode({
                mode: activeMode,
                globalCustomInstructions,
                includeTime,
                rulesContent,
                skillsSection,
                mcpClient,
                allowedMcpServers,
                memoryContext,
                pluginSkillsSection,
                isSubtask: this.depth > 0,
                webEnabled,
                recipesSection,
                selfAuthoredSkillsSection,
                configDir: configDir ?? this.toolRegistry.plugin.app.vault.configDir,
            });
            cachedTools = this.modeService
                ? this.modeService.getToolDefinitions(activeMode)
                : this.toolRegistry.getToolDefinitions();
            cachedPromptMode = activeMode.slug;
            cacheInvalidated = false;
        };

        /** Called by UpdateSettingsTool when settings that affect tool availability change */
        const invalidateToolCache = () => { cacheInvalidated = true; };

        // Emergency condensing retry: if the API rejects with context overflow,
        // condense and retry the entire loop once instead of aborting.
        let emergencyRetried = false;

        // eslint-disable-next-line no-constant-condition -- emergency condensing retry loop
        while (true) {
        try {
            for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
                // Early exit if task was cancelled between iterations
                if (abortSignal?.aborted) {
                    console.debug('[AgentTask] Abort signal detected at iteration start');
                    break;
                }

                // Apply any pending mode switch at the start of each iteration
                if (pendingModeSwitch !== null) {
                    const newMode = this.resolveMode(pendingModeSwitch);
                    if (newMode) {
                        activeMode = newMode;
                        if (this.modeService) {
                            void this.modeService.switchMode(pendingModeSwitch);
                        }
                        this.taskCallbacks.onModeSwitch?.(pendingModeSwitch);
                    }
                    pendingModeSwitch = null;
                    repetitionDetector.reset();
                }

                this.taskCallbacks.onIterationStart?.(iteration);

                // Phase B: rate limiting — pause between iterations (skip on first)
                if (iteration > 0 && this.rateLimitMs > 0) {
                    await new Promise<void>((r) => setTimeout(r, this.rateLimitMs));
                }

                // Power Steering: inject a mode-role reminder on every Nth iteration
                if (
                    this.powerSteeringFrequency > 0
                    && iteration > 0
                    && iteration % this.powerSteeringFrequency === 0
                ) {
                    history.push({
                        role: 'user',
                        content: `[Power Steering Reminder]\n\nYou are operating in **${activeMode.name}** mode.\n\n${activeMode.roleDefinition}\n\nContinue the task.`,
                    });
                }

                // Soft limit: nudge the agent to wrap up at 60% of max iterations
                const SOFT_LIMIT = Math.floor(MAX_ITERATIONS * 0.6);
                if (iteration === SOFT_LIMIT) {
                    history.push({
                        role: 'user',
                        content: '[System] You have used ' + iteration + ' of ' + MAX_ITERATIONS +
                            ' iterations. Wrap up now: deliver your final answer or call attempt_completion.',
                    });
                }

                // Rebuild system prompt + tool list when mode or tool availability changed
                if (activeMode.slug !== cachedPromptMode || cacheInvalidated) {
                    rebuildPromptCache();
                }
                const systemPrompt = cachedSystemPrompt;
                const tools = cachedTools;

                const toolUses: ContentBlock[] = [];
                const textParts: string[] = [];
                const toolErrorIds = new Set<string>();

                // Stream the LLM response (pass abort signal for cancellation)
                for await (const chunk of this.api.createMessage(systemPrompt, history, tools, abortSignal)) {
                    if (chunk.type === 'thinking') {
                        this.taskCallbacks.onThinking?.(chunk.text);
                    } else if (chunk.type === 'text') {
                        hasStreamedText = true;
                        textParts.push(chunk.text);
                        this.taskCallbacks.onText(chunk.text);
                    } else if (chunk.type === 'tool_use') {
                        toolUses.push({
                            type: 'tool_use',
                            id: chunk.id,
                            name: chunk.name,
                            input: chunk.input,
                        });
                        // Notify UI that a tool is starting
                        this.taskCallbacks.onToolStart(chunk.name, chunk.input);
                    } else if (chunk.type === 'tool_error') {
                        // BUG-3: unparseable tool JSON — record in history but skip execution
                        toolErrorIds.add(chunk.id);
                        toolUses.push({ type: 'tool_use', id: chunk.id, name: chunk.name, input: {} });
                        this.taskCallbacks.onToolStart(chunk.name, {});
                        this.taskCallbacks.onToolResult(chunk.name, chunk.error, true);
                    } else if (chunk.type === 'usage') {
                        // Feature 6: Accumulate tokens across all agentic iterations
                        totalInputTokens += chunk.inputTokens;
                        totalOutputTokens += chunk.outputTokens;
                        totalCacheReadTokens += chunk.cacheReadTokens ?? 0;
                        totalCacheCreationTokens += chunk.cacheCreationTokens ?? 0;
                    }
                }

                // Build the assistant message content
                const assistantContent: ContentBlock[] = [];
                if (textParts.length > 0) {
                    assistantContent.push({ type: 'text', text: textParts.join('') });
                }
                assistantContent.push(...toolUses);
                history.push({ role: 'assistant', content: assistantContent });

                // If no tool calls, the LLM is done — run condensing on text-only turns
                if (toolUses.length === 0) {
                    // Safety net: if tools ran but model produced no visible response, retry once
                    if (iteration > 0 && textParts.length === 0 && !hasRetriedEmpty) {
                        hasRetriedEmpty = true;
                        history.push({
                            role: 'user',
                            content: '[System] You executed tools but produced no visible response. '
                                + 'You MUST respond to the user. Explain what you did, what happened, '
                                + 'and suggest next steps. If a plugin command opens a dialog, '
                                + 'tell the user what to do in the dialog.',
                        });
                        continue;
                    }
                    if (iteration > 0 && this.condensingEnabled) {
                        const estimatedTokens = this.estimateTokens(history);
                        const contextWindow = this.getModelContextWindow();
                        const threshold = Math.floor(contextWindow * (this.condensingThreshold / 100));
                        if (estimatedTokens > threshold) {
                            // Pre-Compaction Memory Flush (Phase 5): extract important
                            // facts before they are compressed into a summary
                            await this.taskCallbacks.onPreCompactionFlush?.(history).catch((e) =>
                                console.warn('[AgentTask] Pre-compaction flush failed (non-fatal):', e)
                            );
                            await this.condenseHistory(history, systemPrompt, abortSignal, repetitionDetector.getLedger());
                            // onContextCondensed is called inside condenseHistory with token counts

                            // Validierung: Falls immer noch über Threshold, zweite Runde
                            let condensingRetries = 0;
                            const MAX_CONDENSING_RETRIES = 2;

                            while (condensingRetries < MAX_CONDENSING_RETRIES) {
                                const postTokens = this.estimateTokens(history);
                                if (postTokens <= threshold) break;

                                console.warn(
                                    `[AgentTask] Still over threshold after condensing (${postTokens} > ${threshold}). ` +
                                    `Retry ${condensingRetries + 1}/${MAX_CONDENSING_RETRIES}`
                                );

                                await this.condenseHistory(history, systemPrompt, abortSignal, repetitionDetector.getLedger());
                                // onContextCondensed is called inside condenseHistory with token counts
                                condensingRetries++;
                            }

                            if (condensingRetries > 0) {
                                console.debug(`[AgentTask] Required ${condensingRetries + 1} condensing passes to stay under threshold`);
                            }

                            // CHANGE: Continue loop after condensing instead of breaking
                            continue;
                        }
                    }
                    break;  // Only break if NO condensing was needed
                }

                // Tools that are safe to execute in parallel (pure reads, no side-effects).
                // Write tools and control-flow tools always run sequentially.
                const PARALLEL_SAFE = new Set([
                    'read_file', 'list_files', 'search_files', 'get_frontmatter',
                    'get_linked_notes', 'search_by_tag', 'get_vault_stats', 'get_daily_note',
                    'web_fetch', 'web_search',
                    'semantic_search', 'query_base', 'open_note',
                ]);

                const validToolUses = toolUses.filter(
                    (t): t is ContentBlock & { type: 'tool_use' } =>
                        t.type === 'tool_use' && !toolErrorIds.has(t.id)
                );

                // Helper: run a single tool through the pipeline and return its result.
                // Does NOT call onToolResult — caller is responsible for ordering.
                const runTool = async (toolUse: ContentBlock & { type: 'tool_use' }) => {
                    // Detect repetitive tool loops before execution (recoverable — no signalCompletion)
                    const repCheck = repetitionDetector.check(toolUse.name, toolUse.input);
                    if (repCheck.blocked) {
                        return { content: `<error>${repCheck.reason}</error>`, is_error: true as const };
                    }
                    const toolCallbacks: ToolCallbacks = {
                        pushToolResult: () => {},
                        handleError: async (toolName, error) => {
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
                        askQuestion,
                        signalCompletion,
                        switchMode,
                        // Depth-guard: only wire spawnSubtask if this child is allowed to spawn
                        spawnSubtask: childCanSpawn ? spawnSubtask : undefined,
                        onApprovalRequired: this.taskCallbacks.onApprovalRequired,
                        updateTodos: this.taskCallbacks.onTodoUpdate,
                        onCheckpoint: this.taskCallbacks.onCheckpoint,
                        invalidateToolCache,
                        conversationId,
                    });
                    // Record successful calls in the ledger (for condensing preservation)
                    if (!result.is_error) {
                        repetitionDetector.record(
                            toolUse.name,
                            toolUse.input,
                            result.content.slice(0, 200),
                            iteration,
                        );
                    }
                    return result;
                };

                const allParallelSafe = validToolUses.length > 1
                    && validToolUses.every(t => PARALLEL_SAFE.has(t.name));

                const toolResultBlocks: ContentBlock[] = [];

                // BUG-3: add error results for tools with unparseable JSON input
                for (const errId of toolErrorIds) {
                    toolResultBlocks.push({
                        type: 'tool_result',
                        tool_use_id: errId,
                        content: 'Tool input could not be parsed. Please retry with valid JSON.',
                        is_error: true,
                    });
                }

                if (allParallelSafe) {
                    // Execute all read tools in parallel; collect results in original order.
                    // onToolResult is called sequentially after all finish so the FIFO
                    // queue in AgentSidebarView assigns results to the correct UI elements.
                    const results = await Promise.all(validToolUses.map(runTool));

                    for (let i = 0; i < validToolUses.length; i++) {
                        const toolUse = validToolUses[i];
                        const result = results[i];

                        this.taskCallbacks.onToolResult(toolUse.name, result.content, result.is_error ?? false);

                        if (result.is_error) { consecutiveMistakes++; } else { consecutiveMistakes = 0; }
                        if (this.consecutiveMistakeLimit > 0 && consecutiveMistakes >= this.consecutiveMistakeLimit) {
                            throw new Error(
                                `Agent stopped after ${consecutiveMistakes} consecutive errors. ` +
                                `Check the tool results above or raise the limit in Settings → Advanced.`,
                            );
                        }

                        toolResultBlocks.push({
                            type: 'tool_result',
                            tool_use_id: toolUse.id,
                            content: result.content,
                            is_error: result.is_error,
                        });
                    }
                } else {
                    // Sequential execution: required for writes, control-flow, and mixed batches.
                    for (const toolUse of validToolUses) {
                        const result = await runTool(toolUse);

                        this.taskCallbacks.onToolResult(toolUse.name, result.content, result.is_error ?? false);

                        if (result.is_error) { consecutiveMistakes++; } else { consecutiveMistakes = 0; }
                        if (this.consecutiveMistakeLimit > 0 && consecutiveMistakes >= this.consecutiveMistakeLimit) {
                            throw new Error(
                                `Agent stopped after ${consecutiveMistakes} consecutive errors. ` +
                                `Check the tool results above or raise the limit in Settings → Advanced.`,
                            );
                        }

                        toolResultBlocks.push({
                            type: 'tool_result',
                            tool_use_id: toolUse.id,
                            content: result.content,
                            is_error: result.is_error,
                        });

                        if (completionResult !== null) break;
                    }
                }

                // Add tool results as the next user message
                // IMPORTANT: condensing runs AFTER this push so history is always consistent
                // (every assistant tool_call has a matching tool_result before condensing)
                history.push({ role: 'user', content: toolResultBlocks });

                // Context Condensing: check only after history is fully consistent
                // (assistant tool_calls + tool_results both present, no orphaned calls)
                if (iteration > 0 && this.condensingEnabled && completionResult === null) {
                    const estimatedTokens = this.estimateTokens(history);
                    const contextWindow = this.getModelContextWindow();
                    const threshold = Math.floor(contextWindow * (this.condensingThreshold / 100));
                    if (estimatedTokens > threshold) {
                        // Pre-Compaction Memory Flush (Phase 5)
                        await this.taskCallbacks.onPreCompactionFlush?.(history).catch((e) =>
                            console.warn('[AgentTask] Pre-compaction flush failed (non-fatal):', e)
                        );
                        await this.condenseHistory(history, systemPrompt, abortSignal, repetitionDetector.getLedger());
                        // onContextCondensed is called inside condenseHistory with token counts

                        // Validierung: Falls immer noch über Threshold, zweite Runde
                        let condensingRetries = 0;
                        const MAX_CONDENSING_RETRIES = 2;

                        while (condensingRetries < MAX_CONDENSING_RETRIES) {
                            const postTokens = this.estimateTokens(history);
                            if (postTokens <= threshold) break;

                            console.warn(
                                `[AgentTask] Still over threshold after condensing (${postTokens} > ${threshold}). ` +
                                `Retry ${condensingRetries + 1}/${MAX_CONDENSING_RETRIES}`
                            );

                            await this.condenseHistory(history, systemPrompt, abortSignal, repetitionDetector.getLedger());
                            // onContextCondensed is called inside condenseHistory with token counts
                            condensingRetries++;
                        }

                        if (condensingRetries > 0) {
                            console.debug(`[AgentTask] Required ${condensingRetries + 1} condensing passes to stay under threshold`);
                        }
                    }
                }

                // Break loop if attempt_completion was signaled.
                // The result field is an internal log entry — NEVER render it
                // when the model already streamed its answer as text (which is
                // the intended flow). Only render as last-resort fallback for
                // models that skip text streaming entirely (e.g. GPT-5-mini).
                if (completionResult !== null) {
                    this.taskCallbacks.onAttemptCompletion?.();
                    if (!hasStreamedText) {
                        const resultText = completionResult as string;
                        if (resultText.trim()) {
                            this.taskCallbacks.onText?.(resultText);
                        }
                    }
                    break;
                }
            }

            // Hard limit recovery: if the loop exhausted iterations while the agent
            // was still working (last message is a tool_result), give it one final
            // text-only API call to deliver a response instead of silently stopping.
            if (completionResult === null && !abortSignal?.aborted) {
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
                        for await (const chunk of this.api.createMessage(cachedSystemPrompt, history, [], abortSignal)) {
                            if (chunk.type === 'text') {
                                hasStreamedText = true;
                                this.taskCallbacks.onText(chunk.text);
                            } else if (chunk.type === 'usage') {
                                totalInputTokens += chunk.inputTokens;
                                totalOutputTokens += chunk.outputTokens;
                                totalCacheReadTokens += chunk.cacheReadTokens ?? 0;
                                totalCacheCreationTokens += chunk.cacheCreationTokens ?? 0;
                            }
                        }
                    } catch (e) {
                        console.warn('[AgentTask] Hard limit recovery call failed (non-fatal):', e);
                    }
                }
            }

            // Feature 6: Report total token usage before completing
            if (totalInputTokens > 0 || totalOutputTokens > 0) {
                this.taskCallbacks.onUsage?.(
                    totalInputTokens,
                    totalOutputTokens,
                    totalCacheReadTokens > 0 ? totalCacheReadTokens : undefined,
                    totalCacheCreationTokens > 0 ? totalCacheCreationTokens : undefined,
                );
            }

            // Episodic memory: provide tool execution data for recording (ADR-018)
            const toolSeq = repetitionDetector.getToolSequence();
            if (toolSeq.length > 0) {
                this.taskCallbacks.onEpisodeData?.({
                    toolSequence: toolSeq,
                    toolLedger: repetitionDetector.getLedger(),
                });
            }

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

            // Emergency condensing on context overflow (400 "prompt too long" etc.)
            // Instead of failing, condense the history and let the user retry.
            const isContextOverflow =
                /context.?length|too.?long|too.?many.?tokens|max.?tokens|token.?limit|prompt.?too|content.?size|request.?too.?large/i
                    .test(err.message);
            if (isContextOverflow && history.length >= 7 && !emergencyRetried) {
                console.warn('[AgentTask] Context overflow detected — attempting emergency condensing');
                try {
                    // 6B: Pre-compaction memory flush before emergency condensing
                    await this.taskCallbacks.onPreCompactionFlush?.(history).catch((e) =>
                        console.warn('[AgentTask] Pre-compaction flush failed (non-fatal):', e)
                    );
                    await this.condenseHistory(history, cachedSystemPrompt, abortSignal);
                    // onContextCondensed is called inside condenseHistory with token counts
                    emergencyRetried = true;
                    console.debug('[AgentTask] Emergency condensing succeeded — retrying agent loop');
                    continue;  // 6A: Retry the agent loop with condensed history
                } catch {
                    // Condensing itself failed — fall through to normal error handling
                    console.warn('[AgentTask] Emergency condensing failed');
                }
            }

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
                this.taskCallbacks.onError(err);
            }
            return;  // Error — exit the emergency retry loop
        }
        } // while (true) — emergency condensing retry loop
    }

    // -------------------------------------------------------------------------
    // Context Condensing helpers
    // -------------------------------------------------------------------------

    /**
     * Improved token estimate that accounts for structured content blocks.
     * ~4 chars/token for text, +150 for tool_use overhead, +50 for tool_result overhead.
     */
    private estimateTokens(messages: MessageParam[]): number {
        let count = 0;
        for (const m of messages) {
            if (Array.isArray(m.content)) {
                for (const block of m.content) {
                    if (block.type === 'text' && 'text' in block && typeof block.text === 'string') {
                        count += Math.ceil(block.text.length / 4);
                    } else if (block.type === 'tool_use') {
                        // tool_use overhead: id, name, type fields ~150 tokens
                        count += 150;
                        // input JSON payload
                        if ('input' in block && block.input) {
                            count += Math.ceil(JSON.stringify(block.input).length / 4);
                        }
                    } else if (block.type === 'tool_result') {
                        // tool_result overhead: tool_use_id, type, is_error ~50 tokens
                        count += 50;
                        // content payload
                        if ('content' in block && typeof block.content === 'string') {
                            count += Math.ceil(block.content.length / 4);
                        }
                    } else if (block.type === 'image') {
                        // Image tokens (flat estimate)
                        count += 1000;
                    }
                }
            } else if (typeof m.content === 'string') {
                count += Math.ceil(m.content.length / 4);
            }
        }
        return count;
    }

    /** Approximate context window for the active model (tokens). */
    private getModelContextWindow(): number {
        const model = this.api.getModel();
        // getModel() returns { id: string; info: ModelInfo } — extract the id string
        const modelId: string = typeof model === 'string' ? model : (model?.id ?? '');
        // Use the provider-reported context window when available
        if (model?.info?.contextWindow) return model.info.contextWindow;
        if (modelId.includes('claude')) return 200_000;
        if (modelId.includes('gpt-4') || modelId.includes('gpt-5')) return 128_000;
        return 128_000;
    }

    /**
     * Condense history in-place using a separate LLM summarization call.
     * Keeps the first message (original task) + last 4 messages intact;
     * replaces everything in between with a single summary block.
     */
    private async condenseHistory(
        history: MessageParam[],
        systemPrompt: string,
        abortSignal?: AbortSignal,
        toolCallLedger?: string,
    ): Promise<void> {
        // Need at least first + 4 tail + some middle to condense
        if (history.length < 7) return;

        const firstMsg = history[0];

        // Smart tail: collect messages from end until 10k tokens or min 2 messages
        const MAX_TAIL_TOKENS = 10_000;
        const MIN_TAIL_MESSAGES = 2;
        const tail: MessageParam[] = [];
        let tailTokens = 0;

        for (let i = history.length - 1; i >= 0; i--) {
            const msg = history[i];
            const msgTokens = this.estimateTokens([msg]);

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

        const toSummarize = history.slice(0, history.length - tail.length);

        // Pre-condensing logging
        const preMessageCount = history.length;
        const preTokens = this.estimateTokens(history);
        console.debug(
            `[AgentTask] Context condensing triggered:\n` +
            `  Messages: ${preMessageCount}\n` +
            `  Estimated tokens: ${preTokens}\n` +
            `  Threshold: ${Math.floor(this.getModelContextWindow() * (this.condensingThreshold / 100))} (${this.condensingThreshold}%)`
        );

        const condensingPrompt: MessageParam = {
            role: 'user',
            content:
                'Summarize this conversation compactly. Preserve:\n' +
                '- The original task and goal\n' +
                '- Key decisions made\n' +
                '- Files read, created, or modified (include exact paths)\n' +
                '- Important findings, code snippets, or facts discovered\n' +
                '- ALL tool calls that were executed and their outcomes\n' +
                '- Search queries performed and their result summaries\n' +
                '- Errors encountered and how they were resolved\n\n' +
                (toolCallLedger ? toolCallLedger + '\n\n' : '') +
                'IMPORTANT: After condensing, the agent MUST NOT repeat tool calls listed above.\n\n' +
                'Output only the summary — no preamble or meta-commentary.',
        };

        let summary = '';
        try {
            for await (const chunk of this.api.createMessage(
                systemPrompt,
                [...toSummarize, condensingPrompt],
                [],
                abortSignal,
            )) {
                if (chunk.type === 'text') summary += chunk.text;
            }
        } catch {
            // Condensing failure is non-fatal — keep history unchanged
            return;
        }

        if (!summary.trim()) return;

        // Splice history in-place
        history.splice(
            0,
            history.length,
            firstMsg,
            {
                role: 'assistant',
                content: [{ type: 'text', text: `[Conversation Summary]\n\n${summary.trim()}` }],
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
