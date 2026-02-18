/**
 * SwitchModeTool - Switch the active agent mode mid-task
 *
 * The agent calls this to change to a mode better suited for the current task.
 * The UI updates the mode button and the next iteration uses the new mode's
 * system prompt and tool set.
 *
 * Inspired by Kilo Code's SwitchModeTool.ts
 */

import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';
import { BUILT_IN_MODES } from '../../modes/builtinModes';

interface SwitchModeInput {
    mode_slug: string;
    reason: string;
}

export class SwitchModeTool extends BaseTool<'switch_mode'> {
    readonly name = 'switch_mode' as const;
    readonly isWriteOperation = false;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        const allModes = [
            ...BUILT_IN_MODES,
            ...this.plugin.settings.customModes,
        ];
        const modeList = allModes
            .map((m) => `- ${m.slug}: ${m.description}`)
            .join('\n');

        return {
            name: 'switch_mode',
            description:
                'Switch to a different agent mode when the current task is better handled by another mode. ' +
                'The new mode takes effect from the next response. ' +
                'Available modes:\n' + modeList,
            input_schema: {
                type: 'object',
                properties: {
                    mode_slug: {
                        type: 'string',
                        description: 'The slug of the mode to switch to (e.g. "researcher", "writer", "architect").',
                    },
                    reason: {
                        type: 'string',
                        description: 'Brief explanation of why you are switching modes.',
                    },
                },
                required: ['mode_slug', 'reason'],
            },
        };
    }

    async execute(input: Record<string, any>, context: ToolExecutionContext): Promise<void> {
        const { mode_slug, reason } = input as SwitchModeInput;
        const { callbacks } = context;

        if (!mode_slug) {
            callbacks.pushToolResult(this.formatError(new Error('mode_slug parameter is required')));
            return;
        }

        // Validate the mode exists
        const allModes = [...BUILT_IN_MODES, ...this.plugin.settings.customModes];
        const targetMode = allModes.find((m) => m.slug === mode_slug);

        if (!targetMode) {
            const available = allModes.map((m) => m.slug).join(', ');
            callbacks.pushToolResult(
                this.formatError(new Error(`Unknown mode: "${mode_slug}". Available: ${available}`))
            );
            return;
        }

        // Notify the task loop via context callback
        if (context.switchMode) {
            context.switchMode(mode_slug);
        }

        callbacks.pushToolResult(
            `<mode_switch from="${this.plugin.settings.currentMode}" to="${mode_slug}">` +
            `Switching to ${targetMode.name} mode. Reason: ${reason}` +
            `</mode_switch>`
        );
        callbacks.log(`Mode switched to: ${mode_slug} — ${reason}`);
    }
}
