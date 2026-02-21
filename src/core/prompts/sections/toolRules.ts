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
3. ACT, DON'T NARRATE. Never describe what you are about to do — just do it. The user sees tool calls in real-time. Your text output should contain results, not process descriptions like "Let me search for..." or "I'll start by reading...".
4. READ BEFORE EDITING. Always use read_file before edit_file or write_file on an existing file.
5. PREFER edit_file OVER write_file for changes to existing files.
6. USE EXACT STRINGS. The old_str in edit_file must exactly match the file content (whitespace, newlines included). Include surrounding context to make it unique.
7. COMPLETE FILES. write_file replaces the entire file — always include the full content.
8. attempt_completion is ONLY for multi-step tasks that used tools. After your final tool call, write a summary as text, then call attempt_completion with a brief log. For simple questions: never call attempt_completion — just respond.
9. USE ask_followup_question ONLY when you genuinely need a decision from the user to proceed. Do NOT use it to suggest follow-up actions or next steps — write those as text instead.
10. USE update_todo_list ONLY for complex tasks with 3+ distinct steps.`;
}
