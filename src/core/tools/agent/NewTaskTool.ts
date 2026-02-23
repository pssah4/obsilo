/**
 * NewTaskTool
 *
 * Spawns a child agent task and returns its response.
 * Available in Agent mode — enables agentic workflow patterns:
 *   Prompt Chaining, Orchestrator-Worker, Evaluator-Optimizer, Routing.
 *
 * The child task runs in the specified mode ('agent' or 'ask') with a fresh
 * conversation history and returns its complete response as the tool result.
 *
 * The parent resumes with the child's response as context for the next step.
 */

import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';

/** Modes that are permitted as sub-agent targets */
const ALLOWED_SUB_MODES = new Set(['agent', 'ask']);

export class NewTaskTool extends BaseTool<'new_task'> {
    readonly name = 'new_task' as const;
    readonly isWriteOperation = false;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'new_task',
            description:
                'Spawn a sub-agent for tasks that CANNOT be done directly with your tools. ' +
                'ONLY use when: (a) task needs 5+ steps across specialties, ' +
                '(b) context isolation helps (deep research into many files), ' +
                'or (c) truly parallel independent subtasks. ' +
                'For file conversion, plugin commands, or simple read/write: use your own tools directly. ' +
                'The sub-agent runs with a fresh conversation — pass all context in the message. ' +
                'Only available in Agent mode.',
            input_schema: {
                type: 'object',
                properties: {
                    mode: {
                        type: 'string',
                        description:
                            'Sub-agent mode: "agent" (full capabilities — reading, writing, web) ' +
                            'or "ask" (read-only vault queries and search).',
                    },
                    message: {
                        type: 'string',
                        description:
                            'The task description for the sub-agent. Include all context needed — ' +
                            'the sub-agent cannot see the current conversation.',
                    },
                },
                required: ['mode', 'message'],
            },
        };
    }

    async execute(input: Record<string, any>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const mode: string = (input.mode as string ?? '').trim();
        const message: string = (input.message as string ?? '').trim();

        if (!mode) {
            callbacks.pushToolResult(this.formatError(new Error('mode parameter is required')));
            return;
        }
        if (!message) {
            callbacks.pushToolResult(this.formatError(new Error('message parameter is required')));
            return;
        }

        // Only available in Agent mode.
        if (context.mode !== 'agent') {
            callbacks.pushToolResult(
                'new_task is only available in Agent mode. ' +
                'Switch to Agent mode to use sub-agent workflows.'
            );
            return;
        }

        // Restrict sub-agent targets to known safe modes.
        if (!ALLOWED_SUB_MODES.has(mode)) {
            callbacks.pushToolResult(
                this.formatError(
                    new Error(
                        `Unknown sub-agent mode "${mode}". Use "agent" (full capabilities) or "ask" (read-only).`
                    )
                )
            );
            return;
        }

        // Depth-guard: if spawnSubtask is not wired, we are at max nesting depth.
        if (!context.spawnSubtask) {
            callbacks.pushToolResult(
                'Maximum sub-agent nesting depth reached. ' +
                'Execute this task directly using your available tools.'
            );
            return;
        }

        callbacks.log(`Spawning sub-agent in mode "${mode}": ${message.slice(0, 80)}…`);

        try {
            const result = await context.spawnSubtask(mode, message);
            callbacks.pushToolResult(
                `[Sub-agent completed — mode: ${mode}]\n\n${result || '(No response from sub-agent)'}`
            );
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('new_task', error);
        }
    }
}
