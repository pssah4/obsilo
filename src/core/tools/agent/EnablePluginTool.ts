/**
 * EnablePluginTool — Enable or disable an Obsidian community plugin (PAS-1)
 *
 * Allows the agent to activate a disabled plugin (or deactivate an enabled one)
 * so it can then use the plugin's commands via execute_command.
 *
 * This is a write operation that requires user approval.
 */

import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';

export class EnablePluginTool extends BaseTool<'enable_plugin'> {
    readonly name = 'enable_plugin' as const;
    readonly isWriteOperation = true; // Requires approval — changes plugin state

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'enable_plugin',
            description:
                'Enable or disable an installed Obsidian community plugin. ' +
                'Use this when the user agrees to activate a disabled plugin that can help with their task. ' +
                'After enabling, wait briefly for commands to register, then use execute_command.',
            input_schema: {
                type: 'object',
                properties: {
                    plugin_id: {
                        type: 'string',
                        description:
                            'The plugin ID to enable or disable (e.g., "dbfolder", "obsidian-kanban", "dataview").',
                    },
                    enable: {
                        type: 'boolean',
                        description: 'true to enable the plugin, false to disable it. Defaults to true.',
                    },
                },
                required: ['plugin_id'],
            },
        };
    }

    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const pluginId = (input.plugin_id as string ?? '').trim();
        const enable = input.enable !== false; // default: true

        if (!pluginId) {
            callbacks.pushToolResult(this.formatError(new Error('plugin_id parameter is required')));
            return;
        }

        try {
            const plugins = this.app.plugins;
            if (!plugins) {
                callbacks.pushToolResult(this.formatError(new Error('Plugin system not available')));
                return;
            }

            const manifests = plugins.manifests ?? {};
            if (!manifests[pluginId]) {
                // Suggest similar plugin IDs
                const similar = Object.keys(manifests)
                    .filter((id) => id.includes(pluginId) || pluginId.includes(id))
                    .slice(0, 5);
                const hint = similar.length > 0
                    ? ` Similar plugin IDs: ${similar.join(', ')}`
                    : '';
                callbacks.pushToolResult(
                    this.formatError(new Error(`Plugin "${pluginId}" is not installed.${hint}`)),
                );
                return;
            }

            const isCurrentlyEnabled = plugins.enabledPlugins?.has(pluginId) ?? false;
            const pluginName = manifests[pluginId]?.name ?? pluginId;

            if (enable && isCurrentlyEnabled) {
                callbacks.pushToolResult(
                    this.formatSuccess(`Plugin "${pluginName}" is already enabled.`),
                );
                return;
            }

            if (!enable && !isCurrentlyEnabled) {
                callbacks.pushToolResult(
                    this.formatSuccess(`Plugin "${pluginName}" is already disabled.`),
                );
                return;
            }

            if (enable) {
                await plugins.enablePlugin(pluginId);
                // Brief pause for command registration
                await new Promise<void>((r) => setTimeout(r, 500));

                // Immediately update VaultDNA so .skill.md is current
                const scanner = this.plugin.vaultDNAScanner;
                if (scanner) {
                    try {
                        await scanner.handlePluginEnabled(pluginId);
                    } catch (e) {
                        // Non-fatal: skill file may be stale but commands still work
                        console.warn('[EnablePlugin] VaultDNA update failed:', e);
                    }
                }

                callbacks.pushToolResult(
                    this.formatSuccess(
                        `Plugin "${pluginName}" has been enabled successfully. ` +
                        `NEXT STEP: Read the skill file with read_file(".obsidian-agent/plugin-skills/${pluginId}.skill.md") to learn the available commands, then use execute_command to run them.`,
                    ),
                );
            } else {
                await plugins.disablePlugin(pluginId);

                // Immediately update VaultDNA
                const scanner = this.plugin.vaultDNAScanner;
                if (scanner) {
                    try {
                        await scanner.handlePluginDisabled(pluginId);
                    } catch (e) {
                        console.warn('[EnablePlugin] VaultDNA update failed:', e);
                    }
                }

                callbacks.pushToolResult(
                    this.formatSuccess(`Plugin "${pluginName}" has been disabled.`),
                );
            }

            callbacks.log(`Plugin ${enable ? 'enabled' : 'disabled'}: ${pluginName} (${pluginId})`);
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('enable_plugin', error);
        }
    }
}
