/**
 * Tool Rules Section
 *
 * Core rules governing when and how the agent should use tools.
 * Always included when tools are available.
 */

export function getToolRulesSection(): string {
    return `Tool usage rules:
1. RESPOND DIRECTLY when you already have enough information. For conversational questions, greetings, general knowledge, or tasks where the vault context block already tells you what you need — just write your answer as text. Do NOT call any tools. The conversation loop ends automatically when you produce text without tool calls.
2. READ BEFORE EDITING. Always use read_file before edit_file or write_file on an existing file.
3. PREFER edit_file OVER write_file for changes to existing files — it's safer and more precise.
4. USE EXACT STRINGS. The old_str in edit_file must exactly match the file content (whitespace, newlines included). Include surrounding context to make it unique.
5. COMPLETE FILES. write_file replaces the entire file — always include the full content.
6. attempt_completion is ONLY for multi-step tasks that used tools. After your final tool call, write a summary as text, then call attempt_completion with a brief internal log. For simple questions and conversations: never call attempt_completion — just respond with text.
7. USE ask_followup_question only when truly needed — don't ask for information you can find yourself.
8. USE update_todo_list ONLY for complex tasks with 3 or more distinct steps. For simple tasks (single file edit, answering a question, one lookup), skip the plan and act directly.`;
}
