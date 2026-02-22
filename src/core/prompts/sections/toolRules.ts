/**
 * Tool Rules Section
 *
 * Core rules governing when and how the agent should use tools.
 * Always included when tools are available.
 */

export function getToolRulesSection(): string {
    return `Tool usage rules:
1. RESPOND DIRECTLY when you already have enough information. For conversational questions, greetings, general knowledge, or tasks where the vault context already tells you what you need — just write your answer as text. Do NOT call any tools.
2. PARALLEL BY DEFAULT. When you need multiple independent pieces of information, call all relevant tools in a single response. They execute in parallel. Only sequence tool calls when one result is needed as input for the next.
3. ACT, DON'T NARRATE. Your text output IS the answer the user reads. Never write process descriptions like "Let me search for...", "I'll start by reading...", "Synthesized results into...", or "Found N notes about...". The user sees tool calls in real-time — they know what you did. Your text MUST contain the actual substantive answer, not a summary of what you did to get there.
4. READ BEFORE EDITING. Always use read_file before edit_file or write_file on an existing file.
5. PREFER edit_file OVER write_file for changes to existing files.
6. USE EXACT STRINGS. The old_str in edit_file must exactly match the file content (whitespace, newlines included). Include surrounding context to make it unique.
7. COMPLETE FILES. write_file replaces the entire file — always include the full content.
8. attempt_completion is ONLY for multi-step WRITE tasks (create/edit files). After your final tool call, write the answer as text, then call attempt_completion with a brief internal log. For questions, searches, and read-only tasks: NEVER call attempt_completion — just write your answer as text and the loop ends automatically.
9. USE ask_followup_question SPARINGLY — only when you truly cannot proceed without user input (e.g., ambiguous target note). NEVER ask "which method/tool/format?" when one clearly works. Make the decision yourself and execute. For follow-up suggestions after completion, use the [followups] text block instead.
10. USE update_todo_list ONLY for complex tasks with 3+ distinct steps.`;
}
