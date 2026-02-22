/**
 * Tool Decision Guidelines Section
 *
 * Strategic guidance for choosing the right tool. Prevents redundant
 * tool calls and enforces the RAG pattern for vault queries.
 */

export function getToolDecisionGuidelinesSection(): string {
    return `Tool decision guidelines:
1. PLUGIN SKILLS FIRST — MANDATORY. When the user mentions a plugin by name (e.g., "DB Folder", "Dataview", "Templater", "OneDrive"), ALWAYS use that plugin via execute_command -- NEVER substitute a built-in tool. "DB Folder" is NOT the same as create_base. "Dataview" is NOT the same as query_base. Read the plugin's .skill.md first to learn its commands AND current configuration. If the plugin is DISABLED: call enable_plugin(plugin_id) yourself — do NOT ask the user to enable it manually, do NOT fall back to a built-in tool. After enabling, read .skill.md, then use execute_command. If the plugin needs setup, guide the user through configuration. If unsure whether a plugin exists, use resolve_capability_gap.
2. CHECK CONTEXT FIRST. The <vault_context> block shows the vault's top-level structure. Use it before calling list_files or get_vault_stats — it often already has what you need.
3. NO REDUNDANT READS. Only call read_file for files whose content is NOT already in the conversation. Never re-read a file unless verifying changes you made.
4. BATCH INDEPENDENT CALLS. When you need multiple pieces of information that don't depend on each other, call all relevant tools in one step. Examples: Need 3 files? Call read_file for all 3 in one response (parallel execution). Need to search AND read a known file? Call both tools together. Need web info AND vault info? Call web_search + semantic_search together. Only sequence calls when one result determines the next call's parameters.
5. INTENTIONAL TOOL USE. Only call a tool when you genuinely need its result.
6. RAG PATTERN — For vault content questions: call semantic_search ALONE first. Answer directly from the returned excerpts. Only use search_files as fallback if semantic_search returns 0 results. Only call read_file when modifying a file or one is explicitly requested.
7. CITE WITH WIKILINKS. When referencing notes, use [[Note Name]] format.`;
}
