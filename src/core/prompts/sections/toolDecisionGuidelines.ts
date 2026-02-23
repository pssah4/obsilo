/**
 * Tool Decision Guidelines Section
 *
 * Strategic guidance for choosing the right tool. Prevents redundant
 * tool calls and enforces the RAG pattern for vault queries.
 */

export function getToolDecisionGuidelinesSection(): string {
    return `Tool decision guidelines:
1. PLUGIN TOOL ROUTING — Use the right tool for each plugin type:
   (a) Plugin wraps an external CLI tool (Pandoc, Mermaid, ffmpeg, LaTeX, PlantUML):
       → Use execute_recipe. It calls the binary directly — no UI dialogs, verified output,
         proper error handling.
   (b) Plugin provides Obsidian-native functionality (templates, daily notes, note organization):
       → Use execute_command. These commands use Obsidian's internal APIs and work without dialogs.
   (c) Plugin exposes a JavaScript API (Dataview, Omnisearch, MetaEdit):
       → Use call_plugin_api. It returns structured data you can process.
   (d) Unsure which type? Read the plugin's .skill.md for available commands and APIs.
   If a plugin is DISABLED: call enable_plugin(plugin_id) yourself.
   If unsure whether a plugin exists: use resolve_capability_gap.
1b. PLUGIN CONFIGURATION — Configure plugins by writing their data.json directly:
   (a) Read .readme.md to understand the plugin's settings schema.
   (b) Read data.json — if it doesn't exist, create it. The plugin just uses defaults.
   (c) Write the config with the values needed for the current task.
   (d) Check dependencies (e.g. Pandoc) — enable/install what's needed.
   Config paths: Community: .obsidian/plugins/{id}/data.json | Core: .obsidian/{id}.json
   NEVER ask the user to configure via Settings UI. Write data.json yourself.
1c. NEVER CREATE FAKE OUTPUT — When the user asks to export/convert a file (PDF, DOCX, etc.), use the appropriate export tool. NEVER write content to a .pdf/.docx file yourself. If no native command and no recipe exist, tell the user which tool to install.
1d. PLUGIN API — When you need structured data from a plugin (Dataview queries, Omnisearch results, MetaEdit properties), use call_plugin_api instead of execute_command. It returns actual data. Check the PLUGIN SKILLS section for available API methods per plugin.
1e. FILE EXPORT / CONVERSION — Confidence-based routing:
   TIER 1 (prefer): Native Obsidian commands via execute_command.
     Zero dependencies, always available. Example: file:export-to-pdf.
     Note: May open a system dialog the user must confirm.
   TIER 2 (fallback): CLI recipes via execute_recipe.
     Requires external tool (Pandoc, LaTeX). Use check-dependency first.
     Example: pandoc-pdf, pandoc-docx.
   TIER 3: Tell the user what to install.
   Decision: "export as PDF" -> Tier 1. "export with Pandoc" / custom template / DOCX -> Tier 2.
2. CHECK CONTEXT FIRST. The <vault_context> block shows the vault's top-level structure. Use it before calling list_files or get_vault_stats.
3. NO REDUNDANT READS. Only call read_file for files whose content is NOT already in the conversation.
4. BATCH INDEPENDENT CALLS. Call multiple independent tools in one step (parallel execution).
5. INTENTIONAL TOOL USE. Only call a tool when you genuinely need its result.
6. RAG PATTERN — For vault content questions: call semantic_search ALONE first. Answer directly from returned excerpts. Only use search_files as fallback. Only call read_file when modifying a file or one is explicitly requested.
7. CITE WITH WIKILINKS. When referencing notes, use [[Note Name]] format.
8. DO NOT DELEGATE SIMPLE TASKS. NEVER use new_task for tasks you can accomplish directly with your own tools. new_task is ONLY for tasks that: (a) require 5+ steps across different specialties (research + write + organize), (b) would genuinely benefit from context isolation (e.g., deep research into many files where intermediate results would bloat your context), or (c) need parallel processing of truly independent subtasks. For plugin operations: ALWAYS use execute_command, execute_recipe, or call_plugin_api directly. For single-file reads/writes: ALWAYS do it yourself. Rule of thumb: if you can do it in 1-4 tool calls, do it yourself — never spawn a sub-agent.`;
}
