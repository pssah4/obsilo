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
import type { ToolCallbacks, ToolUse } from './tools/types';
import { ToolExecutionPipeline } from './tool-execution/ToolExecutionPipeline';
import { buildSystemPromptForMode } from './systemPrompt';
import type { ModeService } from './modes/ModeService';
import type { ModeConfig } from '../types/settings';

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
    /** Called when attempt_completion signals a result — shows completion card */
    onAttemptCompletion?: (result: string) => void;
    /** Called when ask_followup_question is invoked — pauses loop until resolved */
    onQuestion?: (question: string, options: string[] | undefined, resolve: (answer: string) => void) => void;
    /** Called when a write tool needs user approval — pauses loop until user decides */
    onApprovalRequired?: (toolName: string, input: Record<string, any>) => Promise<'auto' | 'approved' | 'rejected'>;
    /** Called when update_todo_list publishes a new todo plan */
    onTodoUpdate?: (items: import('./tools/agent/UpdateTodoListTool').TodoItem[]) => void;
    /** Called when switch_mode changes the active mode */
    onModeSwitch?: (newModeSlug: string) => void;
    /** Called when an unrecoverable error occurs */
    onError: (error: Error) => void;
}

export class AgentTask {
    private api: ApiHandler;
    private toolRegistry: ToolRegistry;
    private taskCallbacks: AgentTaskCallbacks;
    private modeService?: ModeService;

    constructor(
        api: ApiHandler,
        toolRegistry: ToolRegistry,
        taskCallbacks: AgentTaskCallbacks,
        modeService?: ModeService,
    ) {
        this.api = api;
        this.toolRegistry = toolRegistry;
        this.taskCallbacks = taskCallbacks;
        this.modeService = modeService;
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

        const MAX_ITERATIONS = 10; // Prevent runaway loops
        // Feature 6: Accumulate token usage across all iterations
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        // attempt_completion signal
        let completionResult: string | null = null;
        // switch_mode signal (checked at end of each iteration)
        let pendingModeSwitch: string | null = null;

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
                }

                this.taskCallbacks.onIterationStart?.(iteration);

                // Build system prompt and tools for current mode
                const systemPrompt = buildSystemPromptForMode(activeMode);
                const tools = this.modeService
                    ? this.modeService.getToolDefinitions(activeMode)
                    : this.toolRegistry.getToolDefinitions();

                const toolUses: ContentBlock[] = [];
                const textParts: string[] = [];

                // Stream the LLM response (pass abort signal for cancellation)
                for await (const chunk of this.api.createMessage(systemPrompt, history, tools, abortSignal)) {
                    if (chunk.type === 'thinking') {
                        this.taskCallbacks.onThinking?.(chunk.text);
                    } else if (chunk.type === 'text') {
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

                // If no tool calls, the LLM is done
                if (toolUses.length === 0) {
                    break;
                }

                // Execute each tool call (sequential, like Kilo Code's default behavior)
                const toolResultBlocks: ContentBlock[] = [];

                for (const toolUse of toolUses) {
                    if (toolUse.type !== 'tool_use') continue;

                    // Create callbacks for this tool execution
                    const toolCallbacks: ToolCallbacks = {
                        pushToolResult: () => {}, // Results collected from pipeline return value
                        handleError: async (toolName, error) => {
                            console.error(`[AgentTask] Tool error in ${toolName}:`, error);
                        },
                        log: (message) => {
                            console.log(`[AgentTask] ${message}`);
                        },
                    };

                    const toolCall: ToolUse = {
                        type: 'tool_use',
                        id: toolUse.id,
                        name: toolUse.name as any,
                        input: toolUse.input,
                    };

                    const result = await pipeline.executeTool(toolCall, toolCallbacks, {
                        askQuestion,
                        signalCompletion,
                        switchMode,
                        onApprovalRequired: this.taskCallbacks.onApprovalRequired,
                        updateTodos: this.taskCallbacks.onTodoUpdate,
                    });

                    // Notify UI of tool result
                    this.taskCallbacks.onToolResult(
                        toolUse.name,
                        result.content,
                        result.is_error ?? false,
                    );

                    // Add tool result for next LLM message
                    // (Anthropic protocol: tool_result blocks in a user message)
                    toolResultBlocks.push({
                        type: 'tool_result',
                        tool_use_id: toolUse.id,
                        content: result.content,
                        is_error: result.is_error,
                    });

                    // If attempt_completion was called, stop processing further tools
                    if (completionResult !== null) break;
                }

                // Add tool results as the next user message
                history.push({ role: 'user', content: toolResultBlocks });

                // Break loop if attempt_completion was signaled
                if (completionResult !== null) {
                    this.taskCallbacks.onAttemptCompletion?.(completionResult);
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
            const err = error instanceof Error ? error : new Error(String(error));
            console.error('[AgentTask] Task failed:', err);
            this.taskCallbacks.onError(err);
        }
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
            ?? BUILT_IN_MODES.find((m: ModeConfig) => m.slug === 'librarian')
            ?? BUILT_IN_MODES[0];
    }
}
