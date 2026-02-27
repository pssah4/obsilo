/**
 * ExecuteCommandTool — Execute any Obsidian command by ID (PAS-1)
 *
 * Single tool that replaces per-command adapter tools.
 * The agent learns available commands from the PLUGIN SKILLS prompt section
 * and calls execute_command({ command_id: "plugin:command-name" }).
 */

import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';

export class ExecuteCommandTool extends BaseTool<'execute_command'> {
    readonly name = 'execute_command' as const;
    readonly isWriteOperation = true; // Commands can modify vault state

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'execute_command',
            description:
                'Execute an Obsidian command by its command ID. Commands are registered by core and community plugins. ' +
                'Use this to leverage plugin capabilities: create daily notes, insert templates, run dataview queries, etc. ' +
                'Check the PLUGIN SKILLS section in your context for available command IDs.',
            input_schema: {
                type: 'object',
                properties: {
                    command_id: {
                        type: 'string',
                        description:
                            'The Obsidian command ID to execute (e.g., "daily-notes:open", "templater-obsidian:insert-template").',
                    },
                },
                required: ['command_id'],
            },
        };
    }

    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const commandId = (input.command_id as string ?? '').trim();

        if (!commandId) {
            callbacks.pushToolResult(this.formatError(new Error('command_id parameter is required')));
            return;
        }

        try {
            const commands = this.app.commands?.commands ?? {};

            if (!commands[commandId]) {
                // Suggest similar commands (same plugin prefix)
                const prefix = commandId.split(':')[0];
                const similar = Object.keys(commands)
                    .filter((id) => id.startsWith(prefix + ':'))
                    .slice(0, 5);
                const hint = similar.length > 0
                    ? ` Available commands with prefix "${prefix}:": ${similar.join(', ')}`
                    : '';
                callbacks.pushToolResult(
                    this.formatError(new Error(`Command not found: "${commandId}".${hint}`)),
                );
                return;
            }

            this.app.commands.executeCommandById(commandId);

            const cmdName = commands[commandId]?.name ?? commandId;
            callbacks.pushToolResult(
                this.formatSuccess(`Executed command: ${cmdName} (${commandId})`),
            );
            callbacks.log(`Executed Obsidian command: ${commandId}`);
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('execute_command', error);
        }
    }
}
