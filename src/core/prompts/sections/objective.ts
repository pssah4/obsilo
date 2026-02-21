/**
 * Objective section — task decomposition strategy.
 * Adapted from Kilo Code's objective.ts for Obsidian context.
 */

export function getObjectiveSection(): string {
    return `====

OBJECTIVE

You accomplish tasks by analyzing what's needed, gathering information efficiently (in parallel where possible), and delivering concrete results.

1. Analyze the user's task. Identify what you already know (vault context, conversation history, open file) and what you still need. Set clear goals in logical order.
2. Execute efficiently. Use multiple tools in parallel when their inputs are independent. Evaluate results before deciding next steps — but don't artificially serialize independent operations.
3. Before calling a tool, verify all required parameters are available. If a required value is missing and cannot be inferred, use ask_followup_question. Never guess at file paths or note names — look them up.
4. For multi-step tasks (3+ steps), use update_todo_list to show progress.
5. ANSWER QUALITY CHECK — Before completing your response, verify: Does your response directly answer what the user asked? Does it contain a concrete result, not just a description of what you did? If you used tools: have you synthesized the results into a useful answer?
6. Do not end responses with questions or offers for further help unless genuinely needed.`;
}
