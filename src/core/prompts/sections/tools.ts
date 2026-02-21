/**
 * Tools Section
 *
 * Generates tool descriptions filtered by the active mode's tool groups.
 * MCP tools are dynamically listed from connected servers when available.
 */

import type { ToolGroup } from '../../../types/settings';
import type { McpClient } from '../../mcp/McpClient';

const TOOL_SECTIONS: Record<ToolGroup, string> = {
    read: `**Reading & Searching:**
- read_file(path): Read the complete content of a file. Use this before modifying any file.
- list_files(path, recursive?): List files and folders in a directory. Use "/" for the vault root.
- search_files(path, pattern, file_pattern?): Search for text or regex across files. Returns matching lines with line numbers.`,

    vault: `**Obsidian Intelligence:**
- get_vault_stats(): Overview of the vault — note count, folder structure, top tags, recently modified files. Use when you need a broad picture of the vault that isn't already in the context block.
- get_frontmatter(path): Read all YAML frontmatter fields of a note (tags, aliases, dates, status, custom properties).
- update_frontmatter(path, updates, remove?): Set or update frontmatter fields. Preserves existing fields. Creates frontmatter block if none exists.
- search_by_tag(tags[], match?): Find all notes with given tags. match="any" (OR, default) or match="all" (AND). Tags with or without # both work.
- get_linked_notes(path, direction?): Get forward links and backlinks for a note. direction="both" (default), "forward", or "backlinks".
- open_note(path, newLeaf?): Open a note in the Obsidian editor. Use after creating or editing a note to bring it into focus.
- get_daily_note(offset?, create?): Read the daily note. offset=0 today (default), -1 yesterday, 1 tomorrow. create=true creates it if missing.
- semantic_search(query, top_k?): Find notes by meaning (semantic similarity). Returns the most relevant excerpts for a natural-language query. Requires the Semantic Index to be built in Settings.
- query_base(path, view_name?, limit?): Query an Obsidian Bases file and return the notes that match its filter conditions.`,

    edit: `**Writing & Editing:**
- write_file(path, content): Create a new file or completely replace an existing file's content. Use for new files or full rewrites.
- edit_file(path, old_str, new_str, expected_replacements?): Replace a specific string in an existing file. Preferred for targeted edits — preserves surrounding content. old_str must exactly match the file content.
- append_to_file(path, content, separator?): Append content to the end of a file. Ideal for daily notes, logs, and additive entries.
- update_frontmatter(path, updates, remove?): Set or update frontmatter fields without touching note content.
- create_folder(path): Create a new folder (including parent folders).
- delete_file(path): Move a file or empty folder to the trash (safe — recoverable).
- move_file(source, destination): Move or rename a file or folder.
- generate_canvas(output_path, mode, source?, files?, max_notes?, draw_edges?): Create an Obsidian Canvas (.canvas) file visualizing notes and their wikilink connections. mode: "folder" | "tag" | "backlinks" | "files".
- create_base(path, view_name, filter_property?, filter_values?, columns?, sort_property?, sort_direction?, exclude_templates?): Create an Obsidian Bases (.base) database view file.
- update_base(path, view_name, filter_property?, filter_values?, columns?, sort_property?, sort_direction?): Add or replace a view in an existing Bases file.`,

    web: `**Web:**
- web_fetch(url, maxLength?, startIndex?): Fetch a URL and return its content as Markdown. Use for reading documentation, articles, or any public page. maxLength defaults to 20000 chars; use startIndex to paginate.
- web_search(query, numResults?): Search the web and return titles, URLs, and snippets. Follow up with web_fetch to read a full page. Only available when Web Tools are enabled in settings.`,

    agent: `**Agent Control:**
- update_todo_list(todos): Publish your task plan as a visible checklist. Use ONLY for complex tasks with 3+ distinct steps. For simple tasks, execute directly — no plan needed. Format: one item per line with - [ ] (pending), - [~] (in progress), - [x] (done).
- ask_followup_question(question, options?): Ask the user a clarifying question when the request is ambiguous. Provide optional answer choices. Use sparingly — only when genuinely needed.
- attempt_completion(result): End the task loop after a multi-step tool workflow. Only use this after tool calls — never for simple text responses. The result is a brief internal log entry (e.g. "Created summary note"), not the user-facing answer.
- new_task(mode, message): Spawn a sub-agent in the specified mode ("agent" or "ask"). The sub-agent runs with a fresh conversation and returns its result. Use for agentic workflows: prompt chaining, orchestrator-worker, evaluator-optimizer, or routing. Only available in Agent mode.`,

    mcp: `**MCP Tools:**
- use_mcp_tool(server_name, tool_name, arguments): Call a tool on an MCP server configured in settings.`,
};

const GROUP_ORDER: ToolGroup[] = ['read', 'vault', 'edit', 'web', 'agent', 'mcp'];

export function getToolsSection(
    toolGroups: ToolGroup[],
    mcpClient?: McpClient,
    allowedMcpServers?: string[],
): string {
    const parts: string[] = [
        '====', '', 'TOOLS', '',
        'You have access to these tools. Use them proactively — do not guess at file contents or vault structure.', '',
    ];

    for (const group of GROUP_ORDER) {
        if (!toolGroups.includes(group)) continue;
        if (group === 'mcp' && mcpClient) {
            const rawMcpTools = mcpClient.getAllTools();
            const allMcpTools = (allowedMcpServers && allowedMcpServers.length > 0)
                ? rawMcpTools.filter(({ serverName }) => allowedMcpServers.includes(serverName))
                : rawMcpTools;
            if (allMcpTools.length > 0) {
                const toolLines = allMcpTools.map(({ serverName, tool }) =>
                    `  - ${serverName}: ${tool.name}${tool.description ? ' — ' + tool.description : ''}`
                ).join('\n');
                parts.push(
                    `**MCP Tools (via use_mcp_tool):**\n` +
                    `- use_mcp_tool(server_name, tool_name, arguments): Call a tool on a connected MCP server.\n\n` +
                    `Connected servers and their tools:\n${toolLines}`
                );
            } else {
                parts.push(TOOL_SECTIONS[group]);
            }
        } else {
            parts.push(TOOL_SECTIONS[group]);
        }
        parts.push('');
    }

    return parts.join('\n');
}
