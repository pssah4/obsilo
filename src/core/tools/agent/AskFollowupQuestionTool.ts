/**
 * AskFollowupQuestionTool - Pause the agent loop to ask the user a question (Sprint 1.2)
 *
 * When the agent needs clarification, it calls this tool instead of guessing.
 * The loop pauses, the UI renders a question card, and resumes when the user answers.
 *
 * Inspired by Kilo Code's AskFollowupQuestionTool.ts
 */

import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';

interface AskFollowupQuestionInput {
    question: string;
    options?: string[];
}

export class AskFollowupQuestionTool extends BaseTool<'ask_followup_question'> {
    readonly name = 'ask_followup_question' as const;
    readonly isWriteOperation = false;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'ask_followup_question',
            description:
                'Ask the user a question when you genuinely need a decision to proceed. ' +
                'Use ONLY when the request is ambiguous and you cannot determine the right approach yourself. ' +
                'Do NOT use this to offer follow-up suggestions or next steps — just write those as text. ' +
                'Do NOT use this if you already have enough information to answer — proceed directly.',
            input_schema: {
                type: 'object',
                properties: {
                    question: {
                        type: 'string',
                        description: 'The specific question to ask the user.',
                    },
                    options: {
                        type: 'array',
                        items: { type: 'string' },
                        description:
                            'Optional list of suggested answers. If provided, the user can click one or type their own answer.',
                    },
                },
                required: ['question'],
            },
        };
    }

    async execute(input: Record<string, any>, context: ToolExecutionContext): Promise<void> {
        const { question, options } = input as AskFollowupQuestionInput;
        const { callbacks } = context;

        if (!question) {
            callbacks.pushToolResult(this.formatError(new Error('question parameter is required')));
            return;
        }

        if (!context.askQuestion) {
            // Fallback if callback not wired: inform LLM to treat as unanswered
            callbacks.pushToolResult(
                '<answer>No answer available — user interaction not supported in current context.</answer>'
            );
            return;
        }

        try {
            const answer = await context.askQuestion(question, options);
            callbacks.pushToolResult(`<answer>${answer}</answer>`);
            callbacks.log(`User answered followup question: "${answer}"`);
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('ask_followup_question', error);
        }
    }
}
