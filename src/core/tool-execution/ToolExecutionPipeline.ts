/**
 * ToolExecutionPipeline - Central execution and governance layer
 *
 * ⭐ CRITICAL COMPONENT (ASR-02)
 *
 * ALL tool executions (internal and MCP) MUST flow through this pipeline.
 * Ensures:
 * - Ignore/protected path validation (IgnoreService)
 * - Auto-approval or user-approval for write operations
 * - Checkpoint creation before writes (Sprint 1.4)
 * - Persistent operation logging (OperationLogger)
 * - Error handling
 */

import type ObsidianAgentPlugin from '../../main';
import type { ToolRegistry } from '../tools/ToolRegistry';
import type {
    ToolUse,
    ToolResult,
    ToolCallbacks,
    ToolExecutionContext,
    ValidationResult,
} from '../tools/types';
import type { IgnoreService } from '../governance/IgnoreService';
import type { OperationLogger } from '../governance/OperationLogger';

/** Tool group classification for auto-approval checks */
type ToolGroup = 'read' | 'write' | 'web' | 'agent' | 'mcp';

const TOOL_GROUPS: Record<string, ToolGroup> = {
    read_file: 'read',
    list_files: 'read',
    search_files: 'read',
    get_frontmatter: 'read',
    get_linked_notes: 'read',
    get_vault_stats: 'read',
    search_by_tag: 'read',
    get_daily_note: 'read',
    query_base: 'read',
    write_file: 'write',
    edit_file: 'write',
    append_to_file: 'write',
    create_folder: 'write',
    delete_file: 'write',
    move_file: 'write',
    update_frontmatter: 'write',
    generate_canvas: 'write',
    create_base: 'write',
    update_base: 'write',
    web_fetch: 'web',
    web_search: 'web',
    ask_followup_question: 'agent',
    attempt_completion: 'agent',
    switch_mode: 'agent',
    new_task: 'agent',
    update_todo_list: 'agent',
    open_note: 'agent',
    use_mcp_tool: 'mcp',
};

/** Extra context injected by AgentTask for agent-control tools */
export interface ContextExtensions {
    askQuestion?: (question: string, options?: string[]) => Promise<string>;
    signalCompletion?: (result: string) => void;
    /**
     * Request user approval for a tool call.
     * Returns: 'auto' = already approved by settings, 'approved' = user clicked approve,
     *          'rejected' = user denied or timed out
     */
    onApprovalRequired?: (toolName: string, input: Record<string, any>) => Promise<'auto' | 'approved' | 'rejected'>;
    /** Publish the current todo list to the UI */
    updateTodos?: (items: import('../tools/agent/UpdateTodoListTool').TodoItem[]) => void;
    /** Switch the active mode (called by switch_mode tool) */
    switchMode?: (slug: string) => void;
}

export class ToolExecutionPipeline {
    private plugin: ObsidianAgentPlugin;
    private toolRegistry: ToolRegistry;
    private taskId: string;
    private mode: string;
    /** Paths already snapshotted for this task — each file is captured once before its first write */
    private snapshotedPaths = new Set<string>();

    constructor(
        plugin: ObsidianAgentPlugin,
        toolRegistry: ToolRegistry,
        taskId: string,
        mode: string
    ) {
        this.plugin = plugin;
        this.toolRegistry = toolRegistry;
        this.taskId = taskId;
        this.mode = mode;
    }

    /**
     * CENTRAL EXECUTION METHOD — all tools MUST flow through here.
     */
    async executeTool(
        toolCall: ToolUse,
        callbacks: ToolCallbacks,
        extensions?: ContextExtensions,
    ): Promise<ToolResult> {
        const startTime = Date.now();

        try {
            // 1. Validate tool exists
            const tool = this.toolRegistry.getTool(toolCall.name);
            if (!tool) {
                const msg = `Unknown tool: ${toolCall.name}`;
                return this.errorResult(toolCall.id, msg);
            }

            // 2. Governance: ignore / protected path check
            const validation = this.validatePaths(toolCall, tool.isWriteOperation);
            if (!validation.allowed) {
                return this.errorResult(toolCall.id, validation.reason ?? 'Operation denied');
            }

            // 3. Auto-approve or request approval for write/web/mcp operations
            if (tool.isWriteOperation || TOOL_GROUPS[toolCall.name] === 'web' || TOOL_GROUPS[toolCall.name] === 'mcp') {
                const decision = await this.checkApproval(toolCall, extensions);
                if (decision === 'rejected') {
                    return this.errorResult(toolCall.id, 'Operation denied by user');
                }
            }

            // 4. Checkpoint before each write — snapshot the file BEFORE it is modified.
            //    Each vault path is snapshotted at most once per task so we always
            //    capture the true pre-task state even when the agent touches many files.
            if (tool.isWriteOperation && (this.plugin.settings.enableCheckpoints ?? true)) {
                const path: string | undefined = toolCall.input?.path;
                if (path && !this.snapshotedPaths.has(path)) {
                    this.snapshotedPaths.add(path); // mark before async call to avoid races
                    this.plugin.checkpointService?.snapshot(this.taskId, [path]).catch((e) =>
                        console.warn('[Pipeline] Checkpoint snapshot failed (non-fatal):', e)
                    );
                }
            }

            // 5. Execute the tool
            const collectedContent: string[] = [];
            let executionHadError = false;

            const wrappedCallbacks: ToolCallbacks = {
                pushToolResult: (content: string) => {
                    collectedContent.push(content);
                    if (content.startsWith('<error>')) executionHadError = true;
                    callbacks.pushToolResult(content);
                },
                handleError: callbacks.handleError,
                log: callbacks.log,
            };

            const context: ToolExecutionContext = {
                taskId: this.taskId,
                mode: this.mode,
                callbacks: wrappedCallbacks,
                askQuestion: extensions?.askQuestion,
                signalCompletion: extensions?.signalCompletion,
                updateTodos: extensions?.updateTodos,
                switchMode: extensions?.switchMode,
            };

            await tool.execute(toolCall.input, context);

            // 6. Persistent operation log
            const durationMs = Date.now() - startTime;
            await this.logOperation(toolCall, !executionHadError, durationMs);

            const content = collectedContent.join('\n');
            return {
                type: 'tool_result',
                tool_use_id: toolCall.id,
                content,
                is_error: executionHadError,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[Pipeline] Tool execution failed: ${toolCall.name}`, error);
            await callbacks.handleError(toolCall.name, error);
            await this.logOperation(toolCall, false, Date.now() - startTime, errorMessage);
            return this.errorResult(toolCall.id, errorMessage);
        }
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    /**
     * Check ignore/protected rules for file-path tools.
     */
    private validatePaths(toolCall: ToolUse, isWrite: boolean): ValidationResult {
        const ignoreService: IgnoreService | undefined = (this.plugin as any).ignoreService;
        if (!ignoreService) return { allowed: true };

        const path: string | undefined = toolCall.input?.path;
        if (!path) return { allowed: true };

        if (ignoreService.isIgnored(path)) {
            return { allowed: false, reason: ignoreService.getDenialReason(path) };
        }

        if (isWrite && ignoreService.isProtected(path)) {
            return { allowed: false, reason: ignoreService.getDenialReason(path) };
        }

        return { allowed: true };
    }

    /**
     * Determine if this tool call needs approval and whether it's already granted.
     * Returns 'auto' if settings allow without prompting, 'approved' if user approved,
     * 'rejected' if denied.
     */
    private async checkApproval(
        toolCall: ToolUse,
        extensions?: ContextExtensions,
    ): Promise<'auto' | 'approved' | 'rejected'> {
        const cfg = this.plugin.settings.autoApproval;
        const group = TOOL_GROUPS[toolCall.name] ?? 'write';

        // Check if auto-approved by settings
        if (cfg.enabled) {
            if (group === 'write' && cfg.write) return 'auto';
            if (group === 'web' && cfg.web) return 'auto';
            if (group === 'mcp' && cfg.mcp) return 'auto';
        }

        // Agent tools (question, todo, completion) are always auto-approved
        if (group === 'agent') return 'auto';

        // No auto-approve config AND no approval callback — default allow
        // (avoids blocking when UI hasn't wired up approval yet)
        if (!extensions?.onApprovalRequired) {
            console.log(`[Pipeline] No approval callback — auto-allowing ${toolCall.name}`);
            return 'auto';
        }

        // Ask for user approval
        return await extensions.onApprovalRequired(toolCall.name, toolCall.input);
    }

    /**
     * Write a log entry via OperationLogger (if available).
     */
    private async logOperation(
        toolCall: ToolUse,
        success: boolean,
        durationMs: number,
        errorMessage?: string,
    ): Promise<void> {
        const logger: OperationLogger | undefined = (this.plugin as any).operationLogger;
        if (logger) {
            await logger.log({
                timestamp: new Date().toISOString(),
                taskId: this.taskId,
                mode: this.mode,
                tool: toolCall.name,
                params: toolCall.input,
                success,
                durationMs,
                error: errorMessage,
            });
        } else {
            // Fallback: console only
            if (this.plugin.settings.debugMode) {
                console.log(`[Pipeline] ${toolCall.name} — ${success ? 'ok' : 'error'} (${durationMs}ms)`);
            }
        }
    }

    private errorResult(toolUseId: string, message: string): ToolResult {
        return {
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: `<error>${message}</error>`,
            is_error: true,
        };
    }
}
