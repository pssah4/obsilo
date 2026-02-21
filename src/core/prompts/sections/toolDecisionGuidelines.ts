/**
 * Tool Decision Guidelines Section
 *
 * Strategic guidance for choosing the right tool. Prevents redundant
 * tool calls and enforces the RAG pattern for vault queries.
 */

export function getToolDecisionGuidelinesSection(): string {
    return `Tool decision guidelines:
1. The <vault_context> block in the user message tells you the vault's top-level structure. Use this before deciding whether to call list_files or get_vault_stats — in many cases it already contains what you need.
2. Only call read_file for a file whose content is NOT already in the conversation. If you already read a file earlier in this session, do not read it again unless you need to verify changes.
3. One tool at a time for exploration. Start with the single most appropriate tool. Evaluate its result before deciding whether more tools are needed. Do not "spray" multiple search strategies in parallel — semantic_search + list_files + search_files for the same question is always redundant.
4. Do not call tools "just in case". Only call a tool when you genuinely need its result to continue.
5. Batch reads. When you need to read multiple SPECIFIC files you already know the paths of, call read_file for all of them in one step — they execute in parallel.
6. RAG PATTERN — For questions about vault content: call semantic_search ALONE first. Write your answer directly from the returned excerpts without any follow-up tool calls (no list_files, no search_files, no read_file). The excerpts already contain the relevant content. Only use search_files as a fallback if semantic_search returns 0 results. Only call read_file when you need to modify a file or a specific file is explicitly requested.
7. CITE WITH WIKILINKS. When referencing notes in your answer, use [[Note Name]] format so the user can navigate to them directly.`;
}
