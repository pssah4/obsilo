/**
 * Tool Decision Guidelines Section
 *
 * Strategic guidance for choosing the right tool. Prevents redundant
 * tool calls and enforces the RAG pattern for vault queries.
 */

export function getToolDecisionGuidelinesSection(): string {
    return `Tool decision guidelines:
1. PLUGIN SKILLS FIRST — MANDATORY. When the user asks for something a plugin can do (export, convert, template, sync, etc.), ALWAYS use the plugin via execute_command. Read the plugin's .skill.md and .readme.md, configure data.json, then execute. If the plugin is DISABLED: call enable_plugin(plugin_id) yourself. If unsure whether a plugin exists, use resolve_capability_gap.
1b. PLUGIN CONFIGURATION — Configure plugins by writing their data.json directly:
   (a) Read .readme.md to understand the plugin's settings schema.
   (b) Read data.json — if it doesn't exist, create it. The plugin just uses defaults.
   (c) Write the config with the values needed for the current task.
   (d) Check dependencies (e.g. Pandoc) — enable/install what's needed.
   (e) Execute the command via execute_command.
   Config paths: Community: .obsidian/plugins/{id}/data.json | Core: .obsidian/{id}.json
   NEVER ask the user to configure via Settings UI. Write data.json yourself.
1c. NEVER CREATE FAKE OUTPUT — When the user asks to export/convert a file (PDF, DOCX, etc.), use execute_recipe or the plugin's execute_command. NEVER write content to a .pdf/.docx file yourself. If the command opens a dialog, execute it and briefly tell the user what to click. If no plugin exists, tell the user which to install.
1d. PLUGIN API — When you need structured data from a plugin (Dataview queries, Omnisearch results, MetaEdit properties), use call_plugin_api instead of execute_command. It returns actual data. Check the PLUGIN SKILLS section for available API methods per plugin.
1e. RECIPES FOR EXTERNAL TOOLS — For file conversion (PDF, DOCX), use execute_recipe with the appropriate recipe (pandoc-pdf, pandoc-docx, pandoc-convert). Use check-dependency first to verify the program is installed. Recipes run without shell — parameters are validated and safe.
2. CHECK CONTEXT FIRST. The <vault_context> block shows the vault's top-level structure. Use it before calling list_files or get_vault_stats.
3. NO REDUNDANT READS. Only call read_file for files whose content is NOT already in the conversation.
4. BATCH INDEPENDENT CALLS. Call multiple independent tools in one step (parallel execution).
5. INTENTIONAL TOOL USE. Only call a tool when you genuinely need its result.
6. RAG PATTERN — For vault content questions: call semantic_search ALONE first. Answer directly from returned excerpts. Only use search_files as fallback. Only call read_file when modifying a file or one is explicitly requested.
7. CITE WITH WIKILINKS. When referencing notes, use [[Note Name]] format.`;
}
