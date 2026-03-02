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
import { findAllowedMethod } from '../tools/agent/pluginApiAllowlist';

/**
 * Approval group classification — determines how a tool call gets approved.
 *
 * NOT the same as the mode-level ToolGroup in settings.ts (which controls
 * tool availability per mode). This type controls the approval/governance path.
 */
type ApprovalGroup = 'read' | 'note-edit' | 'vault-change' | 'web' | 'agent' | 'subtask' | 'mcp' | 'skill' | 'plugin-api' | 'recipe' | 'sandbox' | 'self-modify';

const TOOL_GROUPS: Record<string, ApprovalGroup> = {
    // Read-only vault tools
    read_file: 'read',
    list_files: 'read',
    search_files: 'read',
    get_frontmatter: 'read',
    get_linked_notes: 'read',
    get_vault_stats: 'read',
    search_by_tag: 'read',
    get_daily_note: 'read',
    query_base: 'read',
    semantic_search: 'read',
    // Note content edits (write_file, edit_file, append_to_file, update_frontmatter)
    write_file: 'note-edit',
    edit_file: 'note-edit',
    append_to_file: 'note-edit',
    update_frontmatter: 'note-edit',
    // Vault structural changes (create_folder, delete_file, move_file)
    create_folder: 'vault-change',
    delete_file: 'vault-change',
    move_file: 'vault-change',
    generate_canvas: 'vault-change',
    create_base: 'vault-change',
    update_base: 'vault-change',
    // Web
    web_fetch: 'web',
    web_search: 'web',
    // Agent control (always auto-approved)
    ask_followup_question: 'agent',
    attempt_completion: 'agent',
    update_todo_list: 'agent',
    open_note: 'agent',
    // Mode switching (always auto-approved, agent-internal)
    switch_mode: 'agent',
    // Subtask spawning (respects autoApproval.subtasks)
    new_task: 'subtask',
    // MCP
    use_mcp_tool: 'mcp',
    // Plugin Skills (PAS-1)
    execute_command: 'skill',
    resolve_capability_gap: 'skill',
    enable_plugin: 'skill',
    // Plugin API + Recipe Shell (PAS-1.5)
    call_plugin_api: 'plugin-api',
    execute_recipe: 'recipe',
    // Settings & Model configuration (Onboarding)
    update_settings: 'agent',
    configure_model: 'agent',
    // Self-Development (Phase 1)
    read_agent_logs: 'agent',
    manage_mcp_server: 'agent',
    // Self-Development (Phase 2+3) — sandbox: always requires approval by default
    evaluate_expression: 'sandbox',
    // M-7: Self-modification tools always require human approval
    manage_skill: 'self-modify',
    manage_source: 'self-modify',
};

/** Result of an approval check — may include user-edited content */
export interface ApprovalResult {
    decision: 'auto' | 'approved' | 'rejected';
    /** User-edited final content (only for note-edit approvals via DiffReviewModal) */
    finalContent?: string;
}

/** Extra context injected by AgentTask for agent-control tools */
export interface ContextExtensions {
    askQuestion?: (question: string, options?: string[], allowMultiple?: boolean) => Promise<string>;
    signalCompletion?: (result: string) => void;
    /**
     * Request user approval for a tool call.
     * Returns an ApprovalResult with decision and optional edited content.
     */
    onApprovalRequired?: (toolName: string, input: Record<string, unknown>) => Promise<ApprovalResult>;
    /** Publish the current todo list to the UI */
    updateTodos?: (items: import('../tools/agent/UpdateTodoListTool').TodoItem[]) => void;
    /** Switch the active mode (called by switch_mode tool) */
    switchMode?: (slug: string) => void;
    /** Spawn a child task (called by new_task tool) */
    spawnSubtask?: (mode: string, message: string) => Promise<string>;
    /** Notify UI about a new checkpoint after a write operation */
    onCheckpoint?: (checkpoint: import('../checkpoints/GitCheckpointService').CheckpointInfo) => void;
    /** Invalidate cached tool definitions (e.g. after webTools.enabled changes) */
    invalidateToolCache?: () => void;
}

export class ToolExecutionPipeline {
    private plugin: ObsidianAgentPlugin;
    private toolRegistry: ToolRegistry;
    private taskId: string;
    private mode: string;

    /** Per-task result cache for read-only tools. Key = tool:sortedJSON(input). */
    private resultCache = new Map<string, string>();

    /** Tools eligible for result caching (read-only, deterministic within a task). */
    private static readonly CACHEABLE = new Set([
        'read_file', 'list_files', 'search_files', 'get_frontmatter',
        'get_linked_notes', 'search_by_tag', 'get_vault_stats',
        'semantic_search', 'query_base',
    ]);

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

    /** Stable cache key: tool name + sorted JSON of input parameters. */
    private cacheKey(name: string, input: Record<string, unknown>): string {
        const sortedKeys = Object.keys(input ?? {}).sort();
        return `${name}:${JSON.stringify(input, sortedKeys)}`;
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

            // 2b. Result cache: return cached content for identical read-only calls
            if (ToolExecutionPipeline.CACHEABLE.has(toolCall.name)) {
                const cKey = this.cacheKey(toolCall.name, toolCall.input);
                const cached = this.resultCache.get(cKey);
                if (cached !== undefined) {
                    callbacks.log(`[Cache HIT] ${toolCall.name}`);
                    await this.logOperation(toolCall, true, 0, undefined, '[cached]');
                    return { type: 'tool_result', tool_use_id: toolCall.id, content: cached, is_error: false };
                }
            }

            // 3. Auto-approve or request approval for write/mcp/mode/subtask operations
            // Web tools are always auto-approved when webTools.enabled is true (the only way they appear).
            const toolGroup = TOOL_GROUPS[toolCall.name];
            if (tool.isWriteOperation || toolGroup === 'mcp' || toolGroup === 'subtask' || toolGroup === 'sandbox') {
                const approval = await this.checkApproval(toolCall, extensions);
                if (approval.decision === 'rejected') {
                    return this.errorResult(toolCall.id, 'Operation denied by user');
                }
            }

            // 3b. Cache invalidation: write tools invalidate cached reads for affected paths
            if (tool.isWriteOperation) {
                const affectedPath = toolCall.input?.path as string | undefined;
                if (affectedPath) {
                    const pathJson = JSON.stringify(affectedPath);
                    for (const [key] of this.resultCache) {
                        if (key.includes(pathJson)) this.resultCache.delete(key);
                    }
                }
            }

            // 4. Checkpoint before each write — snapshot the file BEFORE it is modified.
            //    Every write gets its own checkpoint for granular restore (Kilo Code pattern).
            if (tool.isWriteOperation && (this.plugin.settings.enableCheckpoints ?? true)) {
                const path = toolCall.input?.path as string | undefined;
                if (path) {
                    try {
                        const cp = await this.plugin.checkpointService?.snapshot(
                            this.taskId, [path], toolCall.name
                        );
                        if (cp && cp.commitOid !== 'empty' && extensions?.onCheckpoint) {
                            extensions.onCheckpoint(cp);
                        }
                    } catch (e) {
                        console.warn('[Pipeline] Checkpoint failed (non-fatal):', e);
                    }
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
                handleError: (tool: string, error: unknown) => callbacks.handleError(tool, error),
                log: (msg: string) => callbacks.log(msg),
            };

            const context: ToolExecutionContext = {
                taskId: this.taskId,
                mode: this.mode,
                callbacks: wrappedCallbacks,
                askQuestion: extensions?.askQuestion,
                signalCompletion: extensions?.signalCompletion,
                updateTodos: extensions?.updateTodos,
                switchMode: extensions?.switchMode,
                spawnSubtask: extensions?.spawnSubtask,
                invalidateToolCache: extensions?.invalidateToolCache,
            };

            await tool.execute(toolCall.input, context);

            // 6. Persistent operation log + cache write
            const durationMs = Date.now() - startTime;
            const content = collectedContent.join('\n');
            await this.logOperation(toolCall, !executionHadError, durationMs, undefined, content);

            // Cache successful read-only results for deduplication
            if (!executionHadError && ToolExecutionPipeline.CACHEABLE.has(toolCall.name)) {
                this.resultCache.set(this.cacheKey(toolCall.name, toolCall.input), content);
            }

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
            await this.logOperation(toolCall, false, Date.now() - startTime, errorMessage, undefined);
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
        const ignoreService: IgnoreService | undefined = this.plugin.ignoreService;
        if (!ignoreService) return { allowed: true };

        const path = toolCall.input?.path as string | undefined;
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
     * Returns an ApprovalResult with the decision and optional edited content.
     */
    private async checkApproval(
        toolCall: ToolUse,
        extensions?: ContextExtensions,
    ): Promise<ApprovalResult> {
        const cfg = this.plugin.settings.autoApproval;
        const group = TOOL_GROUPS[toolCall.name] ?? 'note-edit';

        // Agent tools (question, todo, completion, open_note) are always auto-approved
        if (group === 'agent') return { decision: 'auto' };

        // Sandbox code execution (evaluate_expression) — requires explicit opt-in.
        // Default off because sandboxed code runs arbitrary JS/TS which could be
        // injected via prompt injection. User approval is the primary defense.
        if (group === 'sandbox') {
            if (cfg.enabled && cfg.sandbox) return { decision: 'auto' };
            if (!extensions?.onApprovalRequired) {
                console.warn(`[Pipeline] Sandbox tool ${toolCall.name} — denying (requires approval)`);
                return { decision: 'rejected' };
            }
            return await extensions.onApprovalRequired(toolCall.name, toolCall.input);
        }

        // M-7: Self-modification tools (manage_source, manage_skill) ALWAYS require
        // human approval — no auto-approve bypass possible
        if (group === 'self-modify') {
            if (!extensions?.onApprovalRequired) {
                console.warn(`[Pipeline] Self-modify tool ${toolCall.name} — denying (always requires approval)`);
                return { decision: 'rejected' };
            }
            return await extensions.onApprovalRequired(toolCall.name, toolCall.input);
        }

        // Check if auto-approved by settings
        if (cfg.enabled) {
            if (group === 'read' && cfg.read) return { decision: 'auto' };
            if (group === 'note-edit' && cfg.noteEdits) return { decision: 'auto' };
            if (group === 'vault-change' && cfg.vaultChanges) return { decision: 'auto' };
            if (group === 'web' && cfg.web) return { decision: 'auto' };
            if (group === 'mcp' && cfg.mcp) return { decision: 'auto' };
            if (group === 'subtask' && cfg.subtasks) return { decision: 'auto' };
            if (group === 'skill' && cfg.skills) return { decision: 'auto' };
            if (group === 'plugin-api') {
                // Differentiate read vs write for plugin API calls
                const isWriteCall = this.isPluginApiWriteCall(toolCall);
                if (!isWriteCall && cfg.pluginApiRead) return { decision: 'auto' };
                if (isWriteCall && cfg.pluginApiWrite) return { decision: 'auto' };
            }
            if (group === 'recipe' && cfg.recipes) return { decision: 'auto' };
        }

        // No auto-approve config AND no approval callback — fail-closed.
        // Silently auto-approving writes when no callback is wired (e.g. subtasks) is a
        // security risk. Deny by default to prevent unauthorized vault changes.
        if (!extensions?.onApprovalRequired) {
            console.warn(`[Pipeline] No approval callback for ${toolCall.name} — denying (fail-closed)`);
            return { decision: 'rejected' };
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
        resultContent?: string,
    ): Promise<void> {
        const logger: OperationLogger | undefined = this.plugin.operationLogger;
        if (logger) {
            await logger.log({
                timestamp: new Date().toISOString(),
                taskId: this.taskId,
                mode: this.mode,
                tool: toolCall.name,
                params: toolCall.input,
                result: resultContent,
                success,
                durationMs,
                error: errorMessage,
            });
        } else {
            // Fallback: console only
            if (this.plugin.settings.debugMode) {
                console.debug(`[Pipeline] ${toolCall.name} — ${success ? 'ok' : 'error'} (${durationMs}ms)`);
            }
        }
    }

    /**
     * Determine if a call_plugin_api invocation is a write operation.
     * Built-in allowlist: use isWrite flag. Dynamic discovery: always write
     * unless user marked as safe.
     */
    private isPluginApiWriteCall(toolCall: ToolUse): boolean {
        const pluginId = (toolCall.input?.plugin_id as string ?? '').trim();
        const method = (toolCall.input?.method as string ?? '').trim();

        // Check built-in allowlist first
        const entry = findAllowedMethod(pluginId, method);
        if (entry) return entry.isWrite;

        // Dynamic discovery: check user overrides
        const overrideKey = `${pluginId}:${method}`;
        const overrides = this.plugin.settings.pluginApi?.safeMethodOverrides ?? {};
        if (overrides[overrideKey]) return false; // User marked as safe read

        return true; // Default: treat as write
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
