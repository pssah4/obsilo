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
    /** Concrete example call with realistic parameters (shown in system prompt) */
    example?: string;
    /** When to prefer this tool over alternatives */
    whenToUse?: string;
    /** Frequent LLM mistakes to avoid */
    commonMistakes?: string;
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
        example: 'read_file("Projects/meeting-2024-01-15.md")',
        whenToUse: 'Before any edit, or when user asks to see content. NOT needed if content already in conversation.',
        commonMistakes: 'Re-reading a file whose content was already returned by a previous tool call.',
    },
    list_files: {
        group: 'read', label: 'List Files', icon: 'folder-open',
        signature: 'list_files(path, recursive?)',
        description: 'List files and folders in a directory. Use "/" for the vault root.',
        example: 'list_files("Projects/", true)',
        whenToUse: 'To discover folder structure. Check vault_context first — it may already show what you need.',
        commonMistakes: 'Using this to find files by content — use search_files or semantic_search instead.',
    },
    search_files: {
        group: 'read', label: 'Search Files', icon: 'search',
        signature: 'search_files(path, pattern, file_pattern?)',
        description: 'Search for text or regex across files. Returns matching lines with line numbers.',
        example: 'search_files("/", "meeting.*agenda", "*.md")',
        whenToUse: 'For exact text or regex matching. Use semantic_search for meaning-based queries.',
        commonMistakes: 'Using broad patterns that return too many results. Be specific with file_pattern.',
    },

    // ── Vault Intelligence ────────────────────────────────────────────────
    get_vault_stats: {
        group: 'vault', label: 'Vault Stats', icon: 'bar-chart-2',
        signature: 'get_vault_stats()',
        description: 'Overview of the vault — note count, folder structure, top tags, recently modified files. Use when you need a broad picture of the vault that isn\'t already in the context block.',
        whenToUse: 'Only when vault_context block is insufficient. Rarely needed.',
        commonMistakes: 'Calling this routinely — vault_context already provides the structure.',
    },
    get_frontmatter: {
        group: 'vault', label: 'Frontmatter', icon: 'tag',
        signature: 'get_frontmatter(path)',
        description: 'Read all YAML frontmatter fields of a note (tags, aliases, dates, status, custom properties).',
        example: 'get_frontmatter("Projects/active-project.md")',
        whenToUse: 'To check tags, status, dates, or custom properties before updating them.',
        commonMistakes: 'Reading the full file just to check frontmatter — this is faster and cleaner.',
    },
    search_by_tag: {
        group: 'vault', label: 'Search by Tag', icon: 'hash',
        signature: 'search_by_tag(tags[], match?)',
        description: 'Find all notes with given tags. match="any" (OR, default) or match="all" (AND). Tags with or without # both work.',
        example: 'search_by_tag(["meeting", "2024"], "all")',
        whenToUse: 'For tag/category filtering. Use match="all" for AND, match="any" for OR.',
        commonMistakes: 'Using search_files to grep for tags — this handles nested tags and tag inheritance.',
    },
    get_linked_notes: {
        group: 'vault', label: 'Linked Notes', icon: 'link',
        signature: 'get_linked_notes(path, direction?)',
        description: 'Get forward links and backlinks for a note. direction="both" (default), "forward", or "backlinks".',
        example: 'get_linked_notes("Projects/main-project.md", "both")',
        whenToUse: 'To understand note relationships and graph connections.',
        commonMistakes: 'Calling this when you only need to read a linked file — just use read_file directly.',
    },
    get_daily_note: {
        group: 'vault', label: 'Daily Note', icon: 'calendar',
        signature: 'get_daily_note(offset?, create?)',
        description: 'Read the daily note. offset=0 today (default), -1 yesterday, 1 tomorrow. create=true creates it if missing.',
        example: 'get_daily_note(0, true)',
        whenToUse: 'To read or create today\'s daily note. Use offset=-1 for yesterday.',
        commonMistakes: 'Creating a daily note (create=true) when the user only asked to read it.',
    },
    open_note: {
        group: 'vault', label: 'Open Note', icon: 'external-link',
        signature: 'open_note(path, newLeaf?)',
        description: 'Open a note in the Obsidian editor. Use after creating or editing a note to bring it into focus.',
        example: 'open_note("Projects/new-note.md", true)',
        whenToUse: 'After creating or editing — so the user can see the result immediately.',
        commonMistakes: 'Opening every file you touch — only open when the user should see it.',
    },
    semantic_search: {
        group: 'vault', label: 'Semantic Search', icon: 'brain',
        signature: 'semantic_search(query, top_k?)',
        description: 'Find notes by meaning (semantic similarity). Returns the most relevant excerpts for a natural-language query. Requires the Semantic Index to be built in Settings.',
        example: 'semantic_search("project planning methodology", 5)',
        whenToUse: 'For meaning-based queries about vault content ("What do I know about X?").',
        commonMistakes: 'Using this for exact text search — use search_files for literal matches.',
    },
    query_base: {
        group: 'vault', label: 'Query Base', icon: 'database',
        signature: 'query_base(path, view_name?, limit?)',
        description: 'Query an Obsidian Bases file and return the notes that match its filter conditions.',
        example: 'query_base("Databases/meetings.base", "This Week")',
        whenToUse: 'To query structured data from a .base file. Returns filtered, sorted results.',
        commonMistakes: 'Using search_files to query Base contents — this returns structured results directly.',
    },

    // ── Edit ──────────────────────────────────────────────────────────────
    write_file: {
        group: 'edit', label: 'Write File', icon: 'file-plus',
        signature: 'write_file(path, content)',
        description: 'Create a new file or completely replace an existing file\'s content. Use for new files or full rewrites.',
        example: 'write_file("Projects/summary.md", "# Summary\\n\\nKey findings...")',
        whenToUse: 'For new files or complete rewrites. For targeted edits, prefer edit_file.',
        commonMistakes: 'Overwriting an existing file without reading it first — always read_file before replacing.',
    },
    edit_file: {
        group: 'edit', label: 'Edit File', icon: 'file-pen',
        signature: 'edit_file(path, old_str, new_str, expected_replacements?)',
        description: 'Replace a specific string in an existing file. Preferred for targeted edits — preserves surrounding content. old_str must exactly match the file content.',
        example: 'edit_file("note.md", "## Old Heading", "## New Heading")',
        whenToUse: 'For targeted edits that preserve surrounding content. Always read_file first to get exact text.',
        commonMistakes: 'Guessing file content for old_str instead of using the exact text from read_file.',
    },
    append_to_file: {
        group: 'edit', label: 'Append', icon: 'plus-circle',
        signature: 'append_to_file(path, content, separator?)',
        description: 'Append content to the end of a file. Ideal for daily notes, logs, and additive entries.',
        example: 'append_to_file("Journal/daily.md", "## New Entry\\n\\nContent...")',
        whenToUse: 'For daily notes, logs, and additive entries. Avoids the read-edit cycle.',
        commonMistakes: 'Using write_file for append operations — that would overwrite existing content.',
    },
    update_frontmatter: {
        group: 'edit', label: 'Update Frontmatter', icon: 'tag',
        signature: 'update_frontmatter(path, updates, remove?)',
        description: 'Set or update frontmatter fields without touching note content.',
        example: 'update_frontmatter("note.md", {"status": "done", "tags": ["review"]}, ["draft"])',
        whenToUse: 'To set/update YAML frontmatter cleanly without touching note body.',
        commonMistakes: 'Using edit_file on YAML frontmatter — this is safer and handles formatting correctly.',
    },
    create_folder: {
        group: 'edit', label: 'Create Folder', icon: 'folder-plus',
        signature: 'create_folder(path)',
        description: 'Create a new folder (including parent folders).',
        example: 'create_folder("Projects/2024/Q1")',
        whenToUse: 'Before writing files to a new location. Creates parent folders automatically.',
    },
    delete_file: {
        group: 'edit', label: 'Delete File', icon: 'trash-2',
        signature: 'delete_file(path)',
        description: 'Move a file or empty folder to the trash (safe — recoverable).',
        example: 'delete_file("Archive/old-note.md")',
        whenToUse: 'When user explicitly asks to delete. Moves to system trash (recoverable).',
        commonMistakes: 'Deleting without user confirmation — always confirm destructive actions first.',
    },
    move_file: {
        group: 'edit', label: 'Move File', icon: 'move',
        signature: 'move_file(source, destination)',
        description: 'Move or rename a file or folder.',
        example: 'move_file("Inbox/note.md", "Projects/note.md")',
        whenToUse: 'To reorganize vault structure. Obsidian automatically updates wikilinks.',
        commonMistakes: 'Moving to a non-existent folder — create it first with create_folder.',
    },
    generate_canvas: {
        group: 'edit', label: 'Canvas', icon: 'layout-dashboard',
        signature: 'generate_canvas(output_path, mode, source?, files?, max_notes?, draw_edges?)',
        description: 'Create an Obsidian Canvas (.canvas) file visualizing notes and their wikilink connections. mode: "folder" | "tag" | "backlinks" | "files".',
        example: 'generate_canvas("Maps/project-map.canvas", "folder", "Projects/", undefined, 20, true)',
        whenToUse: 'To visualize note relationships. Use "files" mode with specific paths for custom selections.',
        commonMistakes: 'Omitting max_notes — large folders create unreadable canvases. Set a reasonable limit.',
    },
    create_excalidraw: {
        group: 'edit', label: 'Excalidraw', icon: 'pencil',
        signature: 'create_excalidraw(output_path, elements, title?, layout?)',
        description: 'Create an Excalidraw drawing (.excalidraw.md) with labeled boxes. Format is handled automatically — never use write_file for .excalidraw.md files.',
        example: 'create_excalidraw("Drawings/overview.excalidraw.md", [{"label":"Topic 1","color":"blue"},{"label":"Topic 2","color":"green"}], "Project Overview")',
        whenToUse: 'To create any Excalidraw visualization. Always prefer this over write_file for .excalidraw.md files.',
        commonMistakes: 'Using write_file for .excalidraw.md — always use create_excalidraw instead.',
    },
    create_base: {
        group: 'edit', label: 'Create Base', icon: 'table-2',
        signature: 'create_base(path, view_name, filter_property?, filter_values?, columns?, sort_property?, sort_direction?, exclude_templates?)',
        description: 'Create an Obsidian Bases (.base) database view file.',
        example: 'create_base("Databases/tasks.base", "Active", "status", ["active", "in-progress"], ["title", "status", "due"], "due", "asc")',
        whenToUse: 'To create a structured database view from vault notes filtered by frontmatter.',
        commonMistakes: 'Using non-existent frontmatter properties — check with get_frontmatter first.',
    },
    update_base: {
        group: 'edit', label: 'Update Base', icon: 'table-properties',
        signature: 'update_base(path, view_name, filter_property?, filter_values?, columns?, sort_property?, sort_direction?)',
        description: 'Add or replace a view in an existing Bases file.',
        example: 'update_base("Databases/tasks.base", "Completed", "status", ["done"], ["title", "completed"], "completed", "desc")',
        whenToUse: 'To add or modify a view in an existing .base file.',
        commonMistakes: 'Creating a new base when you should update an existing one — check if it exists first.',
    },

    // ── Web ───────────────────────────────────────────────────────────────
    web_fetch: {
        group: 'web', label: 'Fetch URL', icon: 'globe',
        signature: 'web_fetch(url, maxLength?, startIndex?)',
        description: 'Fetch a URL and return its content as Markdown. Use for reading documentation, articles, or any public page. maxLength defaults to 20000 chars; use startIndex to paginate.',
        example: 'web_fetch("https://docs.example.com/api", 5000)',
        whenToUse: 'To read a specific URL. Follow up from web_search results or user-provided links.',
        commonMistakes: 'Fetching vault files via URL — use read_file for local files.',
    },
    web_search: {
        group: 'web', label: 'Web Search', icon: 'search',
        signature: 'web_search(query, numResults?)',
        description: 'Search the web and return titles, URLs, and snippets. Follow up with web_fetch to read a full page. Only available when Web Tools are enabled in settings.',
        example: 'web_search("obsidian plugin dataview API", 5)',
        whenToUse: 'For external/current information ("latest", "aktuell", "im Internet"). NOT for vault content.',
        commonMistakes: 'Searching the web when the answer is in the vault — check vault tools first.',
    },

    // ── Agent Control ─────────────────────────────────────────────────────
    ask_followup_question: {
        group: 'agent', label: 'Ask User', icon: 'message-circle',
        signature: 'ask_followup_question(question, options?)',
        description: 'Ask the user a clarifying question when the request is ambiguous. Provide optional answer choices. Use sparingly — only when genuinely needed.',
        example: 'ask_followup_question("Which format do you prefer?", ["Markdown table", "Bullet list", "Canvas"])',
        whenToUse: 'Only when genuinely ambiguous. Do not ask if you can infer from context.',
        commonMistakes: 'Asking unnecessary questions — act on clear instructions directly.',
    },
    attempt_completion: {
        group: 'agent', label: 'Complete Task', icon: 'check-circle',
        signature: 'attempt_completion(result)',
        description: 'End the task loop after a multi-step tool workflow. Only use this after tool calls — never for simple text responses. The result is a brief internal log entry (e.g. "Created summary note"), not the user-facing answer.',
        example: 'attempt_completion("Created summary note at Projects/summary.md")',
        whenToUse: 'After a multi-step tool workflow to signal completion. NOT for simple text responses.',
        commonMistakes: 'Using this for every response — only use after tool-based work with 2+ tool calls.',
    },
    update_todo_list: {
        group: 'agent', label: 'Update Plan', icon: 'list-checks',
        signature: 'update_todo_list(todos)',
        description: 'Publish your task plan as a visible checklist. Use ONLY for complex tasks with 3+ distinct steps. For simple tasks, execute directly — no plan needed. Format: one item per line with - [ ] (pending), - [~] (in progress), - [x] (done).',
        example: 'update_todo_list("- [x] Read source files\\n- [~] Creating summary\\n- [ ] Open note for user")',
        whenToUse: 'Only for complex tasks with 3+ distinct steps. Not for simple operations.',
        commonMistakes: 'Creating plans for simple 1-2 step tasks — just execute them directly.',
    },
    new_task: {
        group: 'agent', label: 'Sub-agent', icon: 'git-fork',
        signature: 'new_task(mode, message)',
        description: 'Spawn a sub-agent in the specified mode ("agent" or "ask"). The sub-agent runs with a fresh conversation and returns its result. Use for agentic workflows: prompt chaining, orchestrator-worker, evaluator-optimizer, or routing. Only available in Agent mode.',
        example: 'new_task("agent", "Research all notes tagged #project and create a summary")',
        whenToUse: 'Only for 5+ step tasks that benefit from context isolation or parallel processing.',
        commonMistakes: 'Delegating simple 1-4 step tasks — do those yourself with your own tools.',
    },

    // ── MCP ───────────────────────────────────────────────────────────────
    use_mcp_tool: {
        group: 'mcp', label: 'MCP Tool', icon: 'plug-2',
        signature: 'use_mcp_tool(server_name, tool_name, arguments)',
        description: 'Call a tool on an MCP server configured in settings.',
        example: 'use_mcp_tool("my-server", "get_data", {"query": "test"})',
        whenToUse: 'For tools provided by configured MCP servers. Check Connected servers list first.',
    },

    // ── Plugin Skills (PAS-1) ──────────────────────────────────────────
    execute_command: {
        group: 'skill', label: 'Execute Command', icon: 'terminal',
        signature: 'execute_command(command_id)',
        description: 'Execute an Obsidian command by its ID. Use this to trigger plugin functionality. Check PLUGIN SKILLS in your context for available commands.',
        example: 'execute_command("daily-notes:open")',
        whenToUse: 'For Obsidian-native plugin commands (templates, daily notes, note organization). Check .skill.md for command IDs.',
        commonMistakes: 'Calling without checking if the plugin is enabled. Read PLUGIN SKILLS section first.',
    },
    resolve_capability_gap: {
        group: 'skill', label: 'Resolve Gap', icon: 'search',
        signature: 'resolve_capability_gap(capability, context?)',
        description: 'When no tool or skill matches a task, check if a disabled or previously installed Obsidian plugin could help.',
        example: 'resolve_capability_gap("create mindmap visualization")',
        whenToUse: 'When no existing tool or skill matches the task. Discovers disabled/uninstalled plugins.',
        commonMistakes: 'Using this for tasks you can already handle with existing tools.',
    },
    enable_plugin: {
        group: 'skill', label: 'Enable Plugin', icon: 'plug',
        signature: 'enable_plugin(plugin_id, enable?)',
        description: 'Enable or disable an installed Obsidian community plugin. Use when a disabled plugin could help with the task and the user agrees to activate it.',
        example: 'enable_plugin("obsidian-excalidraw-plugin", true)',
        whenToUse: 'When a disabled plugin is needed. Ask the user before enabling.',
        commonMistakes: 'Enabling without checking if installed — use resolve_capability_gap first.',
    },
    call_plugin_api: {
        group: 'skill', label: 'Plugin API', icon: 'code',
        signature: 'call_plugin_api(plugin_id, method, args?)',
        description: 'Call a JavaScript API method on a plugin instance. Use for Dataview queries, Omnisearch searches, MetaEdit updates, and any plugin with a JS API.',
        example: 'call_plugin_api("dataview", "pages", {"query": "#meeting AND -#archived"})',
        whenToUse: 'For structured data from plugins (Dataview, Omnisearch, MetaEdit). Returns data, not UI.',
        commonMistakes: 'Using execute_command when you need data — commands produce UI actions, not data.',
    },
    execute_recipe: {
        group: 'skill', label: 'Recipe', icon: 'chef-hat',
        signature: 'execute_recipe(recipe_id, params)',
        description: 'Execute a pre-defined recipe for external tools (Pandoc PDF/DOCX export). No arbitrary shell — only validated recipes.',
        example: 'execute_recipe("pandoc-pdf", {"input": "note.md", "output": "note.pdf"})',
        whenToUse: 'For CLI tool integrations (Pandoc, LaTeX). Check dependency availability first.',
        commonMistakes: 'Writing fake .pdf/.docx content instead of using the proper export recipe.',
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
 *
 * @param groups - Tool groups to include
 * @param includeExamples - When true, emit example/whenToUse/commonMistakes lines (default true).
 *                          Set to false for subtask prompts to save tokens.
 */
export function buildToolPromptSection(groups: ToolGroup[], includeExamples = true): string {
    const parts: string[] = [];
    for (const group of GROUP_ORDER) {
        if (!groups.includes(group)) continue;
        const header = GROUP_PROMPT_HEADERS[group];
        const tools = getToolsForGroup(group);
        if (tools.length === 0) continue;
        const lines = tools.map(([, meta]) => {
            let line = `- ${meta.signature}: ${meta.description}`;
            if (includeExamples) {
                if (meta.example)        line += `\n  Example: ${meta.example}`;
                if (meta.whenToUse)      line += `\n  Best for: ${meta.whenToUse}`;
                if (meta.commonMistakes) line += `\n  Avoid: ${meta.commonMistakes}`;
            }
            return line;
        });
        parts.push(`${header}\n${lines.join('\n')}`);
        parts.push('');
    }
    return parts.join('\n');
}
