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
                'Signal that the task loop should end. ' +
                'Call this ONLY after you have already written your complete answer as streamed text. ' +
                'The result field is a brief internal log entry — it is NOT shown to the user as the answer. ' +
                'Never put your response inside result. Always stream the answer first, then call this.',
            input_schema: {
                type: 'object',
                properties: {
                    result: {
                        type: 'string',
                        description:
                            'A brief internal log entry only (e.g. "Answered X" or "Created file Y"). ' +
                            'Do NOT put the actual answer here — stream the answer as text before calling this tool.',
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
