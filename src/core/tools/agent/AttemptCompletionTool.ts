/**
 * AttemptCompletionTool - Signal that the agent has finished the task (Sprint 1.2)
 *
 * The agent MUST call this when it has completed all work.
 * This ends the ReAct loop and shows the user a completion card.
 *
 * Inspired by Kilo Code's AttemptCompletionTool.ts
 */

import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';

interface AttemptCompletionInput {
    result: string;
}

export class AttemptCompletionTool extends BaseTool<'attempt_completion'> {
    readonly name = 'attempt_completion' as const;
    readonly isWriteOperation = false;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'attempt_completion',
            description:
                'Signal that you have completed the task. ' +
                'Call this ONLY when all work is done and the user\'s request has been fully addressed. ' +
                'Provide a concise summary of what was accomplished in the result field. ' +
                'Do NOT call this if the task is not complete — continue working instead.',
            input_schema: {
                type: 'object',
                properties: {
                    result: {
                        type: 'string',
                        description:
                            'A concise summary of what was accomplished. ' +
                            'Be specific: mention files created/edited, changes made, questions answered.',
                    },
                },
                required: ['result'],
            },
        };
    }

    async execute(input: Record<string, any>, context: ToolExecutionContext): Promise<void> {
        const { result } = input as AttemptCompletionInput;
        const { callbacks } = context;

        if (!result) {
            callbacks.pushToolResult(this.formatError(new Error('result parameter is required')));
            return;
        }

        // Signal completion to AgentTask to break the loop
        if (context.signalCompletion) {
            context.signalCompletion(result);
        }

        callbacks.pushToolResult(`<completion_result>${result}</completion_result>`);
        callbacks.log(`Task completed: ${result.substring(0, 100)}...`);
    }
}
