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
import type { ToolCallbacks, ToolUse, ToolDefinition } from './tools/types';
import { ToolExecutionPipeline } from './tool-execution/ToolExecutionPipeline';
import { ToolRepetitionDetector } from './tool-execution/ToolRepetitionDetector';
import { buildSystemPromptForMode } from './systemPrompt';
import type { ModeService } from './modes/ModeService';
import type { ModeConfig } from '../types/settings';
import type { McpClient } from './mcp/McpClient';

export interface AgentTaskCallbacks {
    /** Called at the start of each agentic loop iteration (0 = first/user message, 1+ = after tools) */
    onIterationStart?: (iteration: number) => void;
    /** Called for each streamed text chunk */
    onText: (text: string) => void;
    /** Called for each streaming reasoning/thinking chunk (extended thinking models) */
    onThinking?: (text: string) => void;
    /** Called when a tool is about to be executed */
    onToolStart: (name: string, input: Record<string, any>) => void;
    /** Called when a tool has finished executing */
    onToolResult: (name: string, content: string, isError: boolean) => void;
    /** Called with cumulative token usage just before onComplete (Feature 6) */
    onUsage?: (inputTokens: number, outputTokens: number) => void;
    /** Called when the task is complete (attempt_completion or natural end) */
    onComplete: () => void;
    /** Called when attempt_completion fires — triggers todo auto-complete */
    onAttemptCompletion?: () => void;
    /** Called when ask_followup_question is invoked — pauses loop until resolved */
    onQuestion?: (question: string, options: string[] | undefined, resolve: (answer: string) => void) => void;
    /** Called when a write tool needs user approval — pauses loop until user decides */
    onApprovalRequired?: (toolName: string, input: Record<string, any>) => Promise<import('./tool-execution/ToolExecutionPipeline').ApprovalResult>;
    /** Called when update_todo_list publishes a new todo plan */
    onTodoUpdate?: (items: import('./tools/agent/UpdateTodoListTool').TodoItem[]) => void;
    /** Called when switch_mode changes the active mode */
    onModeSwitch?: (newModeSlug: string) => void;
    /** Called when the conversation history was condensed (context summarized) */
    onContextCondensed?: () => void;
    /** Called when a checkpoint is saved before a write tool */
    onCheckpoint?: (checkpoint: import('./checkpoints/GitCheckpointService').CheckpointInfo) => void;
    /** Called when an unrecoverable error occurs */
    onError: (error: Error) => void;
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
        condensingEnabled = false,
        condensingThreshold = 80,
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
     * @param userMessage - The new user message
     * @param taskId - Unique task ID
     * @param initialMode - Starting mode slug or ModeConfig
     * @param history - Existing conversation history (mutated in-place to persist across calls)
     * @param abortSignal - Optional signal to cancel the request
     */
    async run(
        userMessage: string | ContentBlock[],
        taskId: string,
        initialMode: string | ModeConfig,
        history: MessageParam[],
        abortSignal?: AbortSignal,
        globalCustomInstructions?: string,
        includeTime?: boolean,
        rulesContent?: string,
        skillsSection?: string,
        mcpClient?: McpClient,
        /** Session-only tool override: list of enabled tool names for this task only */
        sessionToolOverride?: string[],
        /** Per-mode MCP server whitelist — undefined = all servers allowed */
        allowedMcpServers?: string[],
        /** Pre-built memory context for system prompt injection */
        memoryContext?: string,
        /** Compact plugin skills list from VaultDNA (PAS-1) */
        pluginSkillsSection?: string,
    ): Promise<void> {
        // Resolve mode to ModeConfig
        let activeMode: ModeConfig = this.resolveMode(initialMode);

        // Create per-task pipeline instance (like Kilo Code creates per-task context)
        const pipeline = new ToolExecutionPipeline(
            (this.toolRegistry as any).plugin,
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
            ? (question: string, options?: string[]): Promise<string> => {
                return new Promise<string>((resolve) => {
                    this.taskCallbacks.onQuestion!(question, options, resolve);
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
                    onUsage: (i, o) => {
                        // Forward subtask token usage to parent for accurate cost tracking
                        this.taskCallbacks.onUsage?.(i, o);
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

            await childTask.run(
                childMessage,
                `${taskId}-sub-${Date.now()}`,
                childMode,
                childHistory,
                abortSignal,
                globalCustomInstructions,
                includeTime,
                rulesContent,
                skillsSection,
                mcpClient,
                undefined,          // no per-session tool override for subtasks
                allowedMcpServers,
                undefined,          // no per-subtask memory context
                pluginSkillsSection,
            );
            return childText;
        };

        // Cache system prompt + tool definitions — rebuilt only when the mode changes.
        // Without this, buildSystemPromptForMode() and getToolDefinitions() are called
        // on every agentic loop iteration even though nothing has changed.
        let cachedPromptMode = '';
        let cachedSystemPrompt = '';
        let cachedTools: ToolDefinition[] = [];

        const rebuildPromptCache = () => {
            const allModes = this.modeService?.getAllModes();
            cachedSystemPrompt = buildSystemPromptForMode(activeMode, allModes, globalCustomInstructions, includeTime, rulesContent, skillsSection, mcpClient, allowedMcpServers, memoryContext, pluginSkillsSection, this.depth > 0);
            cachedTools = this.modeService
                ? this.modeService.getToolDefinitions(activeMode, sessionToolOverride)
                : this.toolRegistry.getToolDefinitions();
            cachedPromptMode = activeMode.slug;
        };

        try {
            for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
                // Apply any pending mode switch at the start of each iteration
                if (pendingModeSwitch !== null) {
                    const newMode = this.resolveMode(pendingModeSwitch);
                    if (newMode) {
                        activeMode = newMode;
                        if (this.modeService) {
                            this.modeService.switchMode(pendingModeSwitch);
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

                // Rebuild system prompt + tool list only when mode has changed
                if (activeMode.slug !== cachedPromptMode) {
                    rebuildPromptCache();
                }
                const systemPrompt = cachedSystemPrompt;
                const tools = cachedTools;

                const toolUses: ContentBlock[] = [];
                const textParts: string[] = [];

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
                    } else if (chunk.type === 'usage') {
                        // Feature 6: Accumulate tokens across all agentic iterations
                        totalInputTokens += chunk.inputTokens;
                        totalOutputTokens += chunk.outputTokens;
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
                            await this.condenseHistory(history, systemPrompt, abortSignal);
                            this.taskCallbacks.onContextCondensed?.();
                        }
                    }
                    break;
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
                    (t): t is ContentBlock & { type: 'tool_use' } => t.type === 'tool_use'
                );

                // Helper: run a single tool through the pipeline and return its result.
                // Does NOT call onToolResult — caller is responsible for ordering.
                const runTool = async (toolUse: ContentBlock & { type: 'tool_use' }) => {
                    // Detect repetitive tool loops before execution
                    if (repetitionDetector.check(toolUse.name, toolUse.input as Record<string, unknown>)) {
                        const errorContent =
                            `<error>Tool loop detected: "${toolUse.name}" was called with identical input ` +
                            `${3} times in a row. Try a different approach or use attempt_completion.</error>`;
                        signalCompletion('aborted: tool repetition loop');
                        return { content: errorContent, is_error: true as const };
                    }
                    const toolCallbacks: ToolCallbacks = {
                        pushToolResult: () => {},
                        handleError: async (toolName, error) => {
                            console.error(`[AgentTask] Tool error in ${toolName}:`, error);
                        },
                        log: (message) => { console.log(`[AgentTask] ${message}`); },
                    };
                    const toolCall: ToolUse = {
                        type: 'tool_use',
                        id: toolUse.id,
                        name: toolUse.name as any,
                        input: toolUse.input,
                    };
                    return pipeline.executeTool(toolCall, toolCallbacks, {
                        askQuestion,
                        signalCompletion,
                        switchMode,
                        // Depth-guard: only wire spawnSubtask if this child is allowed to spawn
                        spawnSubtask: childCanSpawn ? spawnSubtask : undefined,
                        onApprovalRequired: this.taskCallbacks.onApprovalRequired,
                        updateTodos: this.taskCallbacks.onTodoUpdate,
                        onCheckpoint: this.taskCallbacks.onCheckpoint,
                    });
                };

                const allParallelSafe = validToolUses.length > 1
                    && validToolUses.every(t => PARALLEL_SAFE.has(t.name));

                const toolResultBlocks: ContentBlock[] = [];

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
                        await this.condenseHistory(history, systemPrompt, abortSignal);
                        this.taskCallbacks.onContextCondensed?.();
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

            // Feature 6: Report total token usage before completing
            if (totalInputTokens > 0 || totalOutputTokens > 0) {
                this.taskCallbacks.onUsage?.(totalInputTokens, totalOutputTokens);
            }
            this.taskCallbacks.onComplete();
        } catch (error) {
            // AbortError is expected when user cancels — not a real error
            if (error instanceof Error && error.name === 'AbortError') {
                console.log('[AgentTask] Task cancelled by user');
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
                    && (last.content as ContentBlock[]).some((b) => (b as any).type === 'tool_use');
                if (isOrphaned) {
                    history.pop();
                } else {
                    break;
                }
            }

            const err = error instanceof Error ? error : new Error(String(error));
            console.error('[AgentTask] Task failed:', err);
            this.taskCallbacks.onError(err);
        }
    }

    // -------------------------------------------------------------------------
    // Context Condensing helpers
    // -------------------------------------------------------------------------

    /** Rough token estimate: ~4 chars per token (adequate for threshold checks). */
    private estimateTokens(messages: MessageParam[]): number {
        let count = 0;
        for (const m of messages) {
            const content = Array.isArray(m.content)
                ? m.content.map((b) => {
                    const block = b as any;
                    if (typeof block.text === 'string') return block.text;
                    if (typeof block.content === 'string') return block.content;
                    return '';
                }).join('')
                : typeof m.content === 'string' ? m.content : '';
            count += Math.ceil(content.length / 4);
        }
        return count;
    }

    /** Approximate context window for the active model (tokens). */
    private getModelContextWindow(): number {
        const model = (this.api as any).getModel?.();
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
    ): Promise<void> {
        // Need at least first + 4 tail + some middle to condense
        if (history.length < 7) return;

        const firstMsg = history[0];
        const tail = history.slice(-4);
        const toSummarize = history.slice(0, -4);

        const condensingPrompt: MessageParam = {
            role: 'user',
            content:
                'Summarize this conversation compactly. Preserve:\n' +
                '- The original task and goal\n' +
                '- Key decisions made\n' +
                '- Files read, created, or modified (include exact paths)\n' +
                '- Important findings, code snippets, or facts discovered\n' +
                '- Errors encountered and how they were resolved\n\n' +
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

        console.log(`[AgentTask] Context condensed: ${history.length} messages remain.`);
    }

    /** Resolve a mode slug or ModeConfig to a ModeConfig */
    private resolveMode(mode: string | ModeConfig): ModeConfig {
        if (typeof mode !== 'string') return mode;

        if (this.modeService) {
            return this.modeService.getMode(mode) ?? this.modeService.getActiveMode();
        }

        // Fallback: use builtinModes directly
        const { BUILT_IN_MODES } = require('./modes/builtinModes');
        return BUILT_IN_MODES.find((m: ModeConfig) => m.slug === mode)
            ?? BUILT_IN_MODES[0];
    }
}
