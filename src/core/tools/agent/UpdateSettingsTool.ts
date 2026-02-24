/**
 * UpdateSettingsTool — Programmatically change plugin settings
 *
 * Two actions:
 * - 'set': Set a single setting by dot-path (e.g. "autoApproval.noteEdits")
 * - 'apply_preset': Apply a named permission preset (permissive/balanced/restrictive)
 *
 * Security: API keys are NOT accessible via this tool. Use configure_model instead.
 */

import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';
import type { AutoApprovalConfig } from '../../../types/settings';

/** Dot-paths that are writable via update_settings */
const WRITABLE_PATHS = new Set([
    // Auto-approval flags
    'autoApproval.enabled',
    'autoApproval.read',
    'autoApproval.noteEdits',
    'autoApproval.vaultChanges',
    'autoApproval.web',
    'autoApproval.mcp',
    'autoApproval.mode',
    'autoApproval.subtasks',
    'autoApproval.question',
    'autoApproval.todo',
    'autoApproval.skills',
    'autoApproval.pluginApiRead',
    'autoApproval.pluginApiWrite',
    'autoApproval.recipes',
    'autoApproval.showMenuInChat',
    // Advanced API
    'advancedApi.condensingEnabled',
    'advancedApi.condensingThreshold',
    'advancedApi.powerSteeringFrequency',
    'advancedApi.maxIterations',
    'advancedApi.consecutiveMistakeLimit',
    'advancedApi.rateLimitMs',
    'advancedApi.maxSubtaskDepth',
    // Semantic Index
    'enableSemanticIndex',
    'semanticAutoIndex',
    'semanticAutoIndexOnChange',
    // Checkpoints
    'enableCheckpoints',
    // Memory
    'memory.enabled',
    'memory.autoExtractSessions',
    'memory.autoUpdateLongTerm',
    // UI
    'autoAddActiveFileContext',
    'sendWithEnter',
    'includeCurrentTimeInContext',
    // Web Tools
    'webTools.enabled',
    'webTools.provider',
    // VaultDNA
    'vaultDNA.enabled',
    // Plugin API
    'pluginApi.enabled',
    // Recipes
    'recipes.enabled',
    // Onboarding
    'onboarding.completed',
    'onboarding.currentStep',
    // Debug
    'debugMode',
]);

/** Permission presets */
const PRESETS: Record<string, Partial<AutoApprovalConfig>> = {
    permissive: {
        enabled: true,
        read: true,
        noteEdits: true,
        vaultChanges: true,
        web: true,
        mcp: true,
        mode: true,
        subtasks: true,
        question: true,
        todo: true,
        skills: true,
        pluginApiRead: true,
        pluginApiWrite: true,
        recipes: true,
    },
    balanced: {
        enabled: true,
        read: true,
        noteEdits: false,
        vaultChanges: false,
        web: true,
        mcp: false,
        mode: true,
        subtasks: false,
        question: true,
        todo: true,
        skills: true,
        pluginApiRead: true,
        pluginApiWrite: false,
        recipes: true,
    },
    restrictive: {
        enabled: false,
        read: true,
        noteEdits: false,
        vaultChanges: false,
        web: false,
        mcp: false,
        mode: false,
        subtasks: false,
        question: true,
        todo: true,
        skills: false,
        pluginApiRead: false,
        pluginApiWrite: false,
        recipes: false,
    },
};

export class UpdateSettingsTool extends BaseTool<'update_settings'> {
    readonly name = 'update_settings' as const;
    readonly isWriteOperation = false; // Settings change, not vault write

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'update_settings',
            description:
                'Change Obsilo plugin settings. Use action "set" to change a single setting by path, ' +
                '"apply_preset" to apply a permission preset, or "open_tab" to open a settings tab for the user. ' +
                'Available presets: "permissive" (all auto-approved), "balanced" (reads + skills auto, writes ask), "restrictive" (everything asks). ' +
                'Available tabs for open_tab: "providers", "agent-behaviour", "advanced". Sub-tabs: "backup", "models", "permissions", "interface". ' +
                'This tool cannot change API keys — use configure_model for that.',
            input_schema: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        enum: ['set', 'apply_preset', 'open_tab'],
                        description: 'Action to perform',
                    },
                    path: {
                        type: 'string',
                        description: 'Dot-path of the setting to change (for action "set"), e.g. "autoApproval.noteEdits"',
                    },
                    value: {
                        description: 'New value for the setting (for action "set")',
                    },
                    preset: {
                        type: 'string',
                        enum: ['permissive', 'balanced', 'restrictive'],
                        description: 'Preset name (for action "apply_preset")',
                    },
                    tab: {
                        type: 'string',
                        description: 'Settings tab to open (for action "open_tab"), e.g. "advanced", "providers", "agent-behaviour"',
                    },
                    sub_tab: {
                        type: 'string',
                        description: 'Settings sub-tab to open (for action "open_tab"), e.g. "backup", "models", "permissions", "interface"',
                    },
                },
                required: ['action'],
            },
        };
    }

    async execute(input: Record<string, any>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const action = (input.action as string ?? '').trim();

        try {
            if (action === 'set') {
                await this.handleSet(input, callbacks, context);
            } else if (action === 'apply_preset') {
                await this.handlePreset(input, callbacks);
            } else if (action === 'open_tab') {
                await this.handleOpenTab(input, callbacks);
            } else {
                callbacks.pushToolResult(this.formatError(new Error(
                    `Unknown action: "${action}". Use "set", "apply_preset", or "open_tab".`
                )));
            }
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('update_settings', error);
        }
    }

    private async handleSet(input: Record<string, any>, callbacks: import('../types').ToolCallbacks, context?: ToolExecutionContext): Promise<void> {
        const path = (input.path as string ?? '').trim();
        const value = input.value;

        if (!path) {
            callbacks.pushToolResult(this.formatError(new Error('path is required for action "set"')));
            return;
        }

        if (!WRITABLE_PATHS.has(path)) {
            callbacks.pushToolResult(this.formatError(new Error(
                `Setting path "${path}" is not writable via this tool. ` +
                `Use configure_model for API key changes.`
            )));
            return;
        }

        if (value === undefined) {
            callbacks.pushToolResult(this.formatError(new Error('value is required for action "set"')));
            return;
        }

        // Navigate to the nested property and set it
        const parts = path.split('.');
        let target: any = this.plugin.settings;
        for (let i = 0; i < parts.length - 1; i++) {
            target = target?.[parts[i]];
            if (target === undefined || target === null) {
                callbacks.pushToolResult(this.formatError(new Error(`Invalid setting path: "${path}"`)));
                return;
            }
        }

        const key = parts[parts.length - 1];
        const oldValue = target[key];
        target[key] = value;
        await this.plugin.saveSettings();

        // Invalidate tool cache when settings that affect tool availability change
        if (path.startsWith('webTools')) {
            context?.invalidateToolCache?.();
        }

        callbacks.pushToolResult(this.formatSuccess(
            `Setting "${path}" changed: ${JSON.stringify(oldValue)} -> ${JSON.stringify(value)}`
        ));
        callbacks.log(`update_settings: ${path} = ${JSON.stringify(value)}`);
    }

    private async handleOpenTab(input: Record<string, any>, callbacks: import('../types').ToolCallbacks): Promise<void> {
        const tab = (input.tab as string ?? '').trim();
        const subTab = (input.sub_tab as string ?? '').trim() || undefined;

        if (!tab) {
            callbacks.pushToolResult(this.formatError(new Error('tab is required for action "open_tab"')));
            return;
        }

        this.plugin.openSettingsAt(tab, subTab);
        const desc = subTab ? `${tab}/${subTab}` : tab;
        callbacks.pushToolResult(this.formatSuccess(`Opened settings tab: ${desc}`));
        callbacks.log(`update_settings: opened tab ${desc}`);
    }

    private async handlePreset(input: Record<string, any>, callbacks: import('../types').ToolCallbacks): Promise<void> {
        const presetName = (input.preset as string ?? '').trim();

        if (!presetName) {
            callbacks.pushToolResult(this.formatError(new Error('preset is required for action "apply_preset"')));
            return;
        }

        const preset = PRESETS[presetName];
        if (!preset) {
            callbacks.pushToolResult(this.formatError(new Error(
                `Unknown preset: "${presetName}". Available: permissive, balanced, restrictive`
            )));
            return;
        }

        // Apply preset values to autoApproval
        Object.assign(this.plugin.settings.autoApproval, preset);
        await this.plugin.saveSettings();

        const summary = presetName === 'permissive'
            ? 'All operations auto-approved. The agent can read, write, and modify without asking.'
            : presetName === 'balanced'
            ? 'Reads and skills auto-approved. Write operations require confirmation.'
            : 'All operations require confirmation. Maximum control.';

        callbacks.pushToolResult(this.formatSuccess(
            `Applied "${presetName}" permission preset. ${summary}`
        ));
        callbacks.log(`update_settings: applied preset "${presetName}"`);
    }
}
