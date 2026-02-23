/**
 * Tool Metadata — Single Source of Truth
 *
 * Central registry for tool display names, descriptions, icons,
 * and group assignments. Consumed by:
 *   - systemPrompt.ts  → generates TOOLS section for LLM
 *   - ToolPickerPopover → labels, descriptions, icons in UI
 *
 * The API-level tool schema (input_schema, detailed description)
 * stays in each Tool's getDefinition() method — it serves a
 * different purpose (function calling) and needs parameter details.
 */

import type { ToolName } from './types';
import type { ToolGroup } from '../../types/settings';

export interface ToolMeta {
    /** Which tool group this belongs to */
    group: ToolGroup;
    /** Display label in the UI (e.g., "Read File") */
    label: string;
    /** Short description — used in system prompt AND UI popover */
    description: string;
    /** Lucide icon name for the UI */
    icon: string;
    /** Prompt signature — e.g., "read_file(path)" for system prompt */
    signature: string;
}

/**
 * Group display metadata — labels and icons for tool group headers.
 */
export const GROUP_META: Record<string, { label: string; icon: string }> = {
    read:  { label: 'Read Files',          icon: 'file-text' },
    vault: { label: 'Vault Intelligence',  icon: 'brain' },
    edit:  { label: 'Edit Files',          icon: 'file-pen' },
    web:   { label: 'Web Access',          icon: 'globe' },
    agent: { label: 'Agent Control',       icon: 'list-checks' },
    mcp:   { label: 'MCP Tools',           icon: 'plug-2' },
    skill: { label: 'Plugin Skills',      icon: 'puzzle' },
};

/**
 * Group prompt headers — section titles used in the system prompt.
 */
export const GROUP_PROMPT_HEADERS: Record<string, string> = {
    read:  '**Reading & Searching:**',
    vault: '**Obsidian Intelligence:**',
    edit:  '**Writing & Editing:**',
    web:   '**Web:**',
    agent: '**Agent Control:**',
    mcp:   '**MCP Tools:**',
    skill: '**Plugin Skills:**',
};

/**
 * Ordered list of groups for consistent rendering.
 */
export const GROUP_ORDER: ToolGroup[] = ['read', 'vault', 'edit', 'web', 'agent', 'mcp', 'skill'];

/**
 * Central tool metadata registry.
 */
export const TOOL_METADATA: Record<string, ToolMeta> = {
    // ── Read ──────────────────────────────────────────────────────────────
    read_file: {
        group: 'read', label: 'Read File', icon: 'file-text',
        signature: 'read_file(path)',
        description: 'Read the complete content of a file. Use this before modifying any file.',
    },
    list_files: {
        group: 'read', label: 'List Files', icon: 'folder-open',
        signature: 'list_files(path, recursive?)',
        description: 'List files and folders in a directory. Use "/" for the vault root.',
    },
    search_files: {
        group: 'read', label: 'Search Files', icon: 'search',
        signature: 'search_files(path, pattern, file_pattern?)',
        description: 'Search for text or regex across files. Returns matching lines with line numbers.',
    },

    // ── Vault Intelligence ────────────────────────────────────────────────
    get_vault_stats: {
        group: 'vault', label: 'Vault Stats', icon: 'bar-chart-2',
        signature: 'get_vault_stats()',
        description: 'Overview of the vault — note count, folder structure, top tags, recently modified files. Use when you need a broad picture of the vault that isn\'t already in the context block.',
    },
    get_frontmatter: {
        group: 'vault', label: 'Frontmatter', icon: 'tag',
        signature: 'get_frontmatter(path)',
        description: 'Read all YAML frontmatter fields of a note (tags, aliases, dates, status, custom properties).',
    },
    search_by_tag: {
        group: 'vault', label: 'Search by Tag', icon: 'hash',
        signature: 'search_by_tag(tags[], match?)',
        description: 'Find all notes with given tags. match="any" (OR, default) or match="all" (AND). Tags with or without # both work.',
    },
    get_linked_notes: {
        group: 'vault', label: 'Linked Notes', icon: 'link',
        signature: 'get_linked_notes(path, direction?)',
        description: 'Get forward links and backlinks for a note. direction="both" (default), "forward", or "backlinks".',
    },
    get_daily_note: {
        group: 'vault', label: 'Daily Note', icon: 'calendar',
        signature: 'get_daily_note(offset?, create?)',
        description: 'Read the daily note. offset=0 today (default), -1 yesterday, 1 tomorrow. create=true creates it if missing.',
    },
    open_note: {
        group: 'vault', label: 'Open Note', icon: 'external-link',
        signature: 'open_note(path, newLeaf?)',
        description: 'Open a note in the Obsidian editor. Use after creating or editing a note to bring it into focus.',
    },
    semantic_search: {
        group: 'vault', label: 'Semantic Search', icon: 'brain',
        signature: 'semantic_search(query, top_k?)',
        description: 'Find notes by meaning (semantic similarity). Returns the most relevant excerpts for a natural-language query. Requires the Semantic Index to be built in Settings.',
    },
    query_base: {
        group: 'vault', label: 'Query Base', icon: 'database',
        signature: 'query_base(path, view_name?, limit?)',
        description: 'Query an Obsidian Bases file and return the notes that match its filter conditions.',
    },

    // ── Edit ──────────────────────────────────────────────────────────────
    write_file: {
        group: 'edit', label: 'Write File', icon: 'file-plus',
        signature: 'write_file(path, content)',
        description: 'Create a new file or completely replace an existing file\'s content. Use for new files or full rewrites.',
    },
    edit_file: {
        group: 'edit', label: 'Edit File', icon: 'file-pen',
        signature: 'edit_file(path, old_str, new_str, expected_replacements?)',
        description: 'Replace a specific string in an existing file. Preferred for targeted edits — preserves surrounding content. old_str must exactly match the file content.',
    },
    append_to_file: {
        group: 'edit', label: 'Append', icon: 'plus-circle',
        signature: 'append_to_file(path, content, separator?)',
        description: 'Append content to the end of a file. Ideal for daily notes, logs, and additive entries.',
    },
    update_frontmatter: {
        group: 'edit', label: 'Update Frontmatter', icon: 'tag',
        signature: 'update_frontmatter(path, updates, remove?)',
        description: 'Set or update frontmatter fields without touching note content.',
    },
    create_folder: {
        group: 'edit', label: 'Create Folder', icon: 'folder-plus',
        signature: 'create_folder(path)',
        description: 'Create a new folder (including parent folders).',
    },
    delete_file: {
        group: 'edit', label: 'Delete File', icon: 'trash-2',
        signature: 'delete_file(path)',
        description: 'Move a file or empty folder to the trash (safe — recoverable).',
    },
    move_file: {
        group: 'edit', label: 'Move File', icon: 'move',
        signature: 'move_file(source, destination)',
        description: 'Move or rename a file or folder.',
    },
    generate_canvas: {
        group: 'edit', label: 'Canvas', icon: 'layout-dashboard',
        signature: 'generate_canvas(output_path, mode, source?, files?, max_notes?, draw_edges?)',
        description: 'Create an Obsidian Canvas (.canvas) file visualizing notes and their wikilink connections. mode: "folder" | "tag" | "backlinks" | "files".',
    },
    create_base: {
        group: 'edit', label: 'Create Base', icon: 'table-2',
        signature: 'create_base(path, view_name, filter_property?, filter_values?, columns?, sort_property?, sort_direction?, exclude_templates?)',
        description: 'Create an Obsidian Bases (.base) database view file.',
    },
    update_base: {
        group: 'edit', label: 'Update Base', icon: 'table-properties',
        signature: 'update_base(path, view_name, filter_property?, filter_values?, columns?, sort_property?, sort_direction?)',
        description: 'Add or replace a view in an existing Bases file.',
    },

    // ── Web ───────────────────────────────────────────────────────────────
    web_fetch: {
        group: 'web', label: 'Fetch URL', icon: 'globe',
        signature: 'web_fetch(url, maxLength?, startIndex?)',
        description: 'Fetch a URL and return its content as Markdown. Use for reading documentation, articles, or any public page. maxLength defaults to 20000 chars; use startIndex to paginate.',
    },
    web_search: {
        group: 'web', label: 'Web Search', icon: 'search',
        signature: 'web_search(query, numResults?)',
        description: 'Search the web and return titles, URLs, and snippets. Follow up with web_fetch to read a full page. Only available when Web Tools are enabled in settings.',
    },

    // ── Agent Control ─────────────────────────────────────────────────────
    ask_followup_question: {
        group: 'agent', label: 'Ask User', icon: 'message-circle',
        signature: 'ask_followup_question(question, options?)',
        description: 'Ask the user a clarifying question when the request is ambiguous. Provide optional answer choices. Use sparingly — only when genuinely needed.',
    },
    attempt_completion: {
        group: 'agent', label: 'Complete Task', icon: 'check-circle',
        signature: 'attempt_completion(result)',
        description: 'End the task loop after a multi-step tool workflow. Only use this after tool calls — never for simple text responses. The result is a brief internal log entry (e.g. "Created summary note"), not the user-facing answer.',
    },
    update_todo_list: {
        group: 'agent', label: 'Update Plan', icon: 'list-checks',
        signature: 'update_todo_list(todos)',
        description: 'Publish your task plan as a visible checklist. Use ONLY for complex tasks with 3+ distinct steps. For simple tasks, execute directly — no plan needed. Format: one item per line with - [ ] (pending), - [~] (in progress), - [x] (done).',
    },
    new_task: {
        group: 'agent', label: 'Sub-agent', icon: 'git-fork',
        signature: 'new_task(mode, message)',
        description: 'Spawn a sub-agent in the specified mode ("agent" or "ask"). The sub-agent runs with a fresh conversation and returns its result. Use for agentic workflows: prompt chaining, orchestrator-worker, evaluator-optimizer, or routing. Only available in Agent mode.',
    },

    // ── MCP ───────────────────────────────────────────────────────────────
    use_mcp_tool: {
        group: 'mcp', label: 'MCP Tool', icon: 'plug-2',
        signature: 'use_mcp_tool(server_name, tool_name, arguments)',
        description: 'Call a tool on an MCP server configured in settings.',
    },

    // ── Plugin Skills (PAS-1) ──────────────────────────────────────────
    execute_command: {
        group: 'skill', label: 'Execute Command', icon: 'terminal',
        signature: 'execute_command(command_id)',
        description: 'Execute an Obsidian command by its ID. Use this to trigger plugin functionality. Check PLUGIN SKILLS in your context for available commands.',
    },
    resolve_capability_gap: {
        group: 'skill', label: 'Resolve Gap', icon: 'search',
        signature: 'resolve_capability_gap(capability, context?)',
        description: 'When no tool or skill matches a task, check if a disabled or previously installed Obsidian plugin could help.',
    },
    enable_plugin: {
        group: 'skill', label: 'Enable Plugin', icon: 'plug',
        signature: 'enable_plugin(plugin_id, enable?)',
        description: 'Enable or disable an installed Obsidian community plugin. Use when a disabled plugin could help with the task and the user agrees to activate it.',
    },
    call_plugin_api: {
        group: 'skill', label: 'Plugin API', icon: 'code',
        signature: 'call_plugin_api(plugin_id, method, args?)',
        description: 'Call a JavaScript API method on a plugin instance. Use for Dataview queries, Omnisearch searches, MetaEdit updates, and any plugin with a JS API.',
    },
    execute_recipe: {
        group: 'skill', label: 'Recipe', icon: 'chef-hat',
        signature: 'execute_recipe(recipe_id, params)',
        description: 'Execute a pre-defined recipe for external tools (Pandoc PDF/DOCX export). No arbitrary shell — only validated recipes.',
    },
};

/**
 * Get tools for a specific group.
 */
export function getToolsForGroup(group: ToolGroup): Array<[string, ToolMeta]> {
    return Object.entries(TOOL_METADATA).filter(([, meta]) => meta.group === group);
}

/**
 * Build the system prompt tool section for the given groups.
 * Generates the same format as the previous hardcoded TOOL_SECTIONS.
 */
export function buildToolPromptSection(groups: ToolGroup[]): string {
    const parts: string[] = [];
    for (const group of GROUP_ORDER) {
        if (!groups.includes(group)) continue;
        const header = GROUP_PROMPT_HEADERS[group];
        const tools = getToolsForGroup(group);
        if (tools.length === 0) continue;
        const lines = tools.map(([, meta]) => `- ${meta.signature}: ${meta.description}`);
        parts.push(`${header}\n${lines.join('\n')}`);
        parts.push('');
    }
    return parts.join('\n');
}
