/**
 * Tool Types and Interfaces
 *
 * Defines the core types for the tool system, adapted from Kilo Code's architecture.
 */

/**
 * Tool names (will expand as we add more tools)
 */
export type ToolName =
    // Vault: read
    | 'read_file'
    | 'list_files'
    | 'search_files'
    // Vault: write
    | 'write_file'
    | 'edit_file'
    | 'append_to_file'
    | 'create_folder'
    | 'delete_file'
    | 'move_file'
    // Vault: structured
    | 'create_canvas'
    | 'create_base'
    | 'update_base'
    | 'query_base'
    | 'get_frontmatter'
    | 'update_frontmatter'
    | 'get_linked_notes'
    | 'get_vault_stats'
    | 'search_by_tag'
    | 'get_daily_note'
    | 'open_note'
    | 'generate_canvas'
    // Web
    | 'web_fetch'
    | 'web_search'
    // Semantic
    | 'semantic_search'
    // Agent control
    | 'ask_followup_question'
    | 'attempt_completion'
    | 'switch_mode'
    | 'new_task'
    | 'update_todo_list'
    // MCP
    | 'use_mcp_tool'
    // Skill (PAS-1)
    | 'execute_command'
    | 'resolve_capability_gap'
    | 'enable_plugin'
    // Plugin API + Recipe Shell (PAS-1.5)
    | 'call_plugin_api'
    | 'execute_recipe';

/**
 * Tool use request from LLM
 */
export interface ToolUse {
    type: 'tool_use';
    id: string;
    name: ToolName;
    input: Record<string, any>;
}

/**
 * Tool result response
 */
export interface ToolResult {
    type: 'tool_result';
    tool_use_id: string;
    content: string;
    is_error?: boolean;
}

/**
 * Tool definition (schema) for LLM
 */
export interface ToolDefinition {
    name: ToolName;
    description: string;
    input_schema: {
        type: 'object';
        properties: Record<string, any>;
        required?: string[];
    };
}

/**
 * Tool callbacks for communicating results
 */
export interface ToolCallbacks {
    /**
     * Push a result to be sent back to the LLM
     */
    pushToolResult(content: string): void;

    /**
     * Handle an error during tool execution
     */
    handleError(toolName: string, error: unknown): Promise<void>;

    /**
     * Log a message (for debugging)
     */
    log(message: string): void;
}

/**
 * Tool execution context
 */
export interface ToolExecutionContext {
    /**
     * Current task ID
     */
    taskId: string;

    /**
     * Current mode
     */
    mode: string;

    /**
     * Callbacks for results
     */
    callbacks: ToolCallbacks;

    /**
     * Ask the user a followup question and wait for their answer.
     * Used by ask_followup_question tool.
     */
    askQuestion?: (question: string, options?: string[]) => Promise<string>;

    /**
     * Signal that the task is complete with a result summary.
     * Used by attempt_completion tool.
     */
    signalCompletion?: (result: string) => void;

    /**
     * Publish the current todo list to the UI.
     * Used by update_todo_list tool.
     */
    updateTodos?: (items: import('../tools/agent/UpdateTodoListTool').TodoItem[]) => void;

    /**
     * Switch the active mode. Used by switch_mode tool.
     * The new mode takes effect from the next AgentTask iteration.
     */
    switchMode?: (slug: string) => void;

    /**
     * Spawn a child task and return its accumulated response text.
     * Used by new_task tool for multi-agent delegation.
     */
    spawnSubtask?: (mode: string, message: string) => Promise<string>;
}

/**
 * Validation result for tool operations
 */
export interface ValidationResult {
    allowed: boolean;
    reason?: string;
    requiresExplicitApproval?: boolean;
}

/**
 * Approval decision
 */
export type ApprovalDecision = 'approve' | 'deny' | 'ask' | 'timeout';

/**
 * Approval result
 */
export interface ApprovalResult {
    decision: ApprovalDecision;
    timeout?: number;
    fn?: () => any;
}
