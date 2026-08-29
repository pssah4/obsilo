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
    | 'read_document'
    | 'list_files'
    | 'search_files'
    | 'compute_plaud_delta'
    // Vault: write
    | 'write_file'
    | 'edit_file'
    | 'append_to_file'
    | 'build_meeting_note_from_sink'
    | 'set_block_anchors'
    | 'create_folder'
    | 'delete_file'
    | 'move_file'
    | 'extract_zip'
    // Vault: checkpoints (IMP-01-07-01)
    | 'list_checkpoints'
    | 'read_checkpoint'
    | 'diff_checkpoint'
    | 'restore_checkpoint'
    // Vault: structured
    | 'create_base'
    | 'update_base'
    | 'query_base'
    | 'get_frontmatter'
    | 'update_frontmatter'
    | 'get_linked_notes'
    | 'get_vault_stats'
    | 'vault_health_check'
    | 'search_by_tag'
    | 'find_notes_by_type'
    | 'get_daily_note'
    | 'open_note'
    | 'generate_canvas'
    | 'create_excalidraw'
    | 'create_drawio'
    // Vault: presentation planning
    | 'plan_presentation'
    // Vault: office document creation
    | 'create_pptx'
    | 'create_docx'
    | 'create_xlsx'
    // Vault: document ingest
    | 'ingest_document'
    // Vault: BA-25 Karpathy-Wiki-Pattern (FEAT-19-12, ADR-98)
    | 'ingest_triage'
    // Vault: BA-25 Deep-Ingest-Pipeline (FEAT-19-22/23/24/26/30 + 19-13 Caller)
    | 'ingest_deep'
    // Vault: BA-25 Anti-Echo Web-Search-Suche (FEAT-19-14)
    | 'anti_echo_search'
    // Vault: FEAT-03-25 / ADR-109 Vault-zu-Memory-Bruecke
    | 'mark_note_as_memory_source'
    | 'unmark_note_as_memory_source'
    | 'list_memory_source_notes'
    // IMP-24-06-02: pendant to list_memory_source_notes for pinned chats
    | 'list_pinned_conversations'
    // Web
    | 'web_fetch'
    | 'web_search'
    // Web: archive a page (full text + images) into the vault, like the Web Clipper
    | 'clip_web_page'
    // Semantic
    | 'semantic_search'
    // Agent control
    | 'ask_followup_question'
    | 'attempt_completion'
    | 'switch_agent'
    | 'new_task'
    // FEAT-24-10 / ADR-159: dedicated research delegation with source anchors.
    | 'investigate'
    | 'run_in_background'
    // EPIC-26 / FEAT-26-01 / ADR-120: on-demand flagship escalation.
    | 'consult_flagship'
    | 'find_tool'
    // FEAT-24-09 / ADR-116: load a SKILL.md body on demand.
    | 'read_skill'
    // Revise an existing skill by name (write counterpart of read_skill).
    | 'write_skill'
    | 'update_todo_list'
    // MCP
    | 'use_mcp_tool'
    // FEAT-24-06 / ADR-118: read the full description + input-schema summary
    // of a single MCP tool on demand (companion to the truncated MCP listing
    // in the system prompt).
    | 'read_mcp_tool'
    // Skill (PAS-1)
    | 'execute_command'
    | 'resolve_capability_gap'
    | 'enable_plugin'
    // FEAT-29-03 / ADR-124: live probe of a plugin's commands and API methods
    | 'probe_plugin'
    // FEAT-29-06 / ADR-126: generic skill-script executor (replaces code_modules)
    | 'run_skill_script'
    // Plugin API + Recipe Shell (PAS-1.5)
    | 'call_plugin_api'
    | 'execute_recipe'
    // Settings & Model configuration (Onboarding)
    | 'update_settings'
    | 'configure_model'
    // Self-Development (Phase 1: Foundation)
    | 'read_agent_logs'
    | 'manage_mcp_server'
    // FEAT-29-10: composability tools (skill-to-skill, skill-to-mcp).
    | 'invoke_skill'
    | 'invoke_mcp_server'
    // Self-Development (Phase 3: Expression evaluation)
    | 'evaluate_expression'
    // Self-Development (Phase 4: Core Self-Modification)
    | 'manage_source'
    // Memory v2 (Phase 3 / FEATURE-0317): cold-memory recall for the agent.
    | 'recall_memory'
    // Memory v2 (Phase 4 / FEATURE-0318): user-triggered manual extraction.
    | 'mark_for_memory'
    // Memory v2 (Phase 4.5 / FEATURE-0319b): agent-self layer.
    | 'update_soul'
    | 'inspect_self'
    // Memory v2 (Phase 6 / FEATURE-0320): history search.
    | 'search_history'
    // Memory v2 internal -- Engine-only tool schemas, never registered with
    // the agent ToolRegistry. Carried in ToolName so ApiHandler.createMessage
    // type-checks across the same ToolDefinition surface.
    | '_memory_atomize'
    | '_memory_single_call';

/**
 * Tool use request from LLM
 */
export interface ToolUse {
    type: 'tool_use';
    id: string;
    name: ToolName;
    input: Record<string, unknown>;
}

/**
 * Tool result response.
 * content is normally a string. Tools that return multimodal data (e.g. rendered
 * slide images) may return an array of ToolResultContentBlock instead.
 */
export interface ToolResult {
    type: 'tool_result';
    tool_use_id: string;
    content: string | import('../../api/types').ToolResultContentBlock[];
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
        properties: Record<string, unknown>;
        required?: string[];
    };
}

/**
 * Tool callbacks for communicating results
 */
export interface ToolCallbacks {
    /**
     * Push the FINAL result to be sent back to the LLM (goes into conversation history).
     * Pass a ToolResultContentBlock[] for multimodal results (text + images).
     * Use pushProgress for intermediate status messages.
     */
    pushToolResult(content: string | import('../../api/types').ToolResultContentBlock[]): void;

    /**
     * Push an intermediate progress/status message to the UI.
     * Does NOT go into conversation history — keeps the LLM context lean.
     * Use this for phase banners, heartbeats, batch progress etc.
     */
    pushProgress?(content: string): void;

    /**
     * Handle an error during tool execution
     */
    handleError(toolName: string, error: unknown): void | Promise<void>;

    /**
     * Log a message (for debugging)
     */
    log(message: string): void;
}

/**
 * FEAT-29-10 follow-up: per-spawn caps that invoke_skill / new_task may
 * attach to a subtask. Plain object so the AgentTask doesn't grow a
 * "profile lookup or n-th positional arg" mess.
 */
export interface SubtaskSpawnOverrides {
    /** Cap the child's loop budget. */
    maxIterations?: number;
    /** Restrict the child's tool schema to this allowlist. */
    allowedTools?: ToolName[];
    /**
     * Issue #54.4.1: run the child on a specific configured model, given as a
     * model key "name|provider". Resolved against providerConfigs; wins over a
     * profile tier override. Ignored (parent api) when the key is unknown.
     */
    modelKey?: string;
}

/**
 * Tool execution context
 */
export interface ToolExecutionContext {
    /**
     * The API handler used by the current AgentTask.
     * Tools should use this instead of building their own handler from plugin.getActiveModel(),
     * because the AgentTask may be using a mode-specific model that differs from the global setting.
     */
    apiHandler?: import('../../api/types').ApiHandler;

    /**
     * FIX-24-05-09 (D10): report an LLM call the tool made itself.
     *
     * Three tools spend tokens of their own (plan_presentation's deck planner,
     * semantic_search's HyDE rewrite, configure_model's connectivity probe) and
     * until now had no way to say so, so the footer and tasks.jsonl booked them
     * as free. The owning task folds what arrives here into the same totals the
     * condensing pass and the FastPath planner feed.
     *
     * Undefined on the headless surfaces (MCP execute_vault_op, the editor
     * quick-action dispatch), where no task owns the call. runMeteredCall then
     * still counts it in the usage ledger, so it is unattributed, not invisible.
     */
    reportAuxUsage?: import('../pricing/meteredCall').UsageSink;

    /**
     * Current task ID
     */
    taskId: string;

    /**
     * Current mode
     */
    mode: string;

    /**
     * Abort signal for the currently running agent task.
     * Long-running tools should observe this and stop promptly when aborted.
     */
    abortSignal?: AbortSignal;

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
     * Ask the user (in-chat card) to install a missing optional asset
     * before the tool can proceed. Tools that require an optional bundle
     * (office, pdfjs, reranker, ...) call this INSTEAD of pushing a
     * "not installed, please open Settings" error -- the card is shown
     * inline in the chat, and if the user confirms, the download runs
     * behind their click (Obsidian policy compliant).
     *
     * Resolves to:
     * - `installed`: asset is now on disk. Tool should retry loading it.
     * - `skipped` / `failed`: tool should surface the normal error path.
     */
    onOptionalAssetRequired?: (
        spec: import('../assets/OptionalAssetManager').AssetSpec,
        toolName: string,
    ) => Promise<import('../tool-execution/ToolExecutionPipeline').OptionalAssetInstallResult>;

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
     * FIX-H (ADR-090 follow-up): Return the set of file paths the agent has
     * read in the current task (via read_file / read_document / FastPath stage 2).
     * UpdateTodoListTool uses this to detect done items that reference unread
     * files -- prevents the "I marked it done but never opened the file"
     * hallucination pattern.
     */
    getReadFiles?: () => Set<string>;

    /**
     * FEAT-55-02 (ADR-170): run-scoped chat-attachment texts for
     * read_document / ingest_document. Replaces the per-instance
     * setAttachmentTexts on the shared tool singletons so two parallel
     * chats never share (or wipe) each other's attachments. Returns the
     * attachments belonging to THIS run; empty array when none.
     */
    getAttachmentTexts?: () => string[];

    /**
     * Switch the active agent (formerly "mode"). Used by switch_agent tool.
     * The new agent's roleDefinition + toolGroups take effect from the next
     * AgentTask iteration. The underlying slug `currentMode` is preserved
     * for back-compat with stored settings.
     */
    switchMode?: (slug: string) => void;

    /**
     * Spawn a child task and return its accumulated response text.
     * Used by new_task tool for multi-agent delegation.
     *
     * FEAT-24-04 / ADR-113: optional `profileName` selects a lean subagent
     * profile (see src/core/agent/subagent-profiles.ts). When set, the
     * subagent runs with the profile's roleDefinition + allowedTools
     * instead of inheriting the parent's mode/rules/skills set.
     *
     * FEAT-29-10 follow-up: `overrides` carries ad-hoc per-spawn caps.
     * `maxIterations` shortens the child's loop budget (default = parent's,
     * usually 25). `allowedTools` is a tool-name allowlist that further
     * narrows the child's tool schema (e.g. an invoke_skill sub-skill that
     * declares `allowedTools` in its frontmatter). Overrides win over the
     * profile defaults so a profile-spawn can still be tightened.
     */
    spawnSubtask?: (
        mode: string,
        message: string,
        profileName?: string,
        overrides?: SubtaskSpawnOverrides,
    ) => Promise<string>;

    /**
     * FEAT-29-10 Composability: shared stack-tracker for invoke_skill /
     * invoke_mcp_server calls. Owned by the top-level AgentTask, passed
     * by reference to every spawned subtask so cycle-detection and
     * depth-limit work across the whole composition chain.
     */
    compositionStack?: import('../skills/CompositionStackService').CompositionStackService;

    /**
     * EPIC-26 / FEAT-26-01 / ADR-120: try to acquire one of the per-task
     * advisor slots (default limit: 3). Returns `{ ok: true, used, limit }`
     * when the slot was granted; the tool then proceeds with the spawn.
     * Returns `{ ok: false, used, limit }` when the budget is exhausted;
     * the tool reports a tool_error and the loop continues without the
     * advisor result.
     */
    consumeAdvisorSlot?: () => { ok: boolean; used: number; limit: number };

    /**
     * Invalidate the cached system prompt and tool definitions.
     * Called when settings that affect tool availability change (e.g. webTools.enabled).
     */
    invalidateToolCache?: () => void;

    /**
     * FEATURE-1600: add a deferred tool to the active set for the rest of the
     * session. Called by the `find_tool` meta-tool after it matches a deferred
     * tool. The AgentTask injects the activated tool's schema into the next
     * rebuildPromptCache. No-op if the tool is already active or not deferred.
     */
    activateDeferredTool?: (toolName: string) => void;

    /**
     * FEAT-44-02b: the batch preview paths the user approved. After a batch
     * gate this is always set (FIX-44-56): the remaining subset when entries
     * were skipped, otherwise the FULL planned entry set -- the scope is
     * pinned at gate time, so a tool that re-selects its targets at execute
     * time cannot write files the card never showed. `undefined` means no
     * batch gate was shown (plain card, auto-approval, headless policy).
     * Tools that implement `previewBatch` (editPreview.ts) MUST honour this
     * set: any planned write whose path is not in it is skipped and reported
     * as skipped.
     */
    approvedBatchPaths?: ReadonlySet<string>;
    /**
     * Content-hash grant (M-1 follow-up) TOCTOU pin: the SHA-256 of the exact
     * sandbox-script bytes the approval covered. Set only for an approved
     * run_skill_script call; RunSkillScriptTool re-hashes the file it reads at
     * execute time and refuses to run if it no longer matches, so a concurrent
     * write cannot swap approved bytes for other ones between gate and run.
     */
    approvedSandboxHash?: string;
}

/**
 * Validation result for tool operations
 */
export interface ValidationResult {
    allowed: boolean;
    reason?: string;
    requiresExplicitApproval?: boolean;
}
