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
export const WRITABLE_PATHS = new Set([
    // Auto-approval flags. FIX-44-34: read/mode/question/todo/showMenuInChat
    // removed -- they were dead keys the agent could set to no effect.
    'autoApproval.enabled',
    'autoApproval.noteEdits',
    'autoApproval.vaultChanges',
    'autoApproval.web',
    'autoApproval.mcp',
    'autoApproval.subtasks',
    'autoApproval.skills',
    'autoApproval.pluginApiRead',
    'autoApproval.pluginApiWrite',
    'autoApproval.recipes',
    // sandbox is deliberately NOT writable here: the agent must not be able to
    // request its own sandbox auto-approval, even via a confirmed settings change.
    // Advanced API
    'advancedApi.condensingEnabled',
    'advancedApi.condensingThreshold',
    'advancedApi.powerSteeringFrequency',
    'advancedApi.maxIterations',
    'advancedApi.consecutiveMistakeLimit',
    'advancedApi.rateLimitMs',
    'advancedApi.maxSubtaskDepth',
    // FEAT-24-02 / ADR-12 Amendment: microcompaction + rolling summary
    'advancedApi.microcompactionEnabled',
    'advancedApi.rollingSummaryThreshold',
    // FEAT-24-04 / ADR-113: per-call token budget for new_task
    'advancedApi.subtaskTokenBudget',
    // FEAT-24-07 / ADR-115: helper-model routing for internal LLM calls
    'helperModelKey',
    // FEAT-24-05: sidebar cost warning threshold (in EUR).
    // FEAT-24-12: the parent prefix is load-bearing. This entry used to be the
    // bare key while the setting lives under advancedApi, so handleSet wrote a
    // dead top-level property, reported success, and the threshold never moved.
    'advancedApi.costWarnThresholdEur',
    // The FEAT-24-12 pricing knobs (advancedApi.usdToEurRate,
    // advancedApi.priceOverridesText) are deliberately NOT writable here: they
    // decide what the cost footer claims a run cost, and an agent that can
    // rewrite its own price tag is the opposite of the point.
    // Semantic Index
    'enableSemanticIndex',
    'semanticAutoIndex',
    'semanticAutoIndexOnChange',
    // Checkpoints
    'enableCheckpoints',
    // Memory
    'memory.enabled',
    'memory.autoExtractSessions',
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

/**
 * Permission presets.
 *
 * FIX-44-25: every preset sets EVERY gating flag. Leaving `sandbox` (or any
 * flag) unset made Object.assign preserve whatever value was already there, so
 * `balanced` could silently keep a stale `sandbox: true` from a past permissive
 * run. `sandbox` is false in all three presets on purpose -- auto-approving
 * arbitrary agent-authored code is a deliberate, per-run decision, never a
 * preset side effect (it still carries its own confirm on the card, FIX-44-03b).
 * A drift test asserts each preset covers every category key.
 */
export const PRESETS: Record<string, Partial<AutoApprovalConfig>> = {
    permissive: {
        enabled: true,
        noteEdits: true,
        vaultChanges: true,
        web: true,
        mcp: true,
        subtasks: true,
        skills: true,
        pluginApiRead: true,
        pluginApiWrite: true,
        recipes: true,
        sandbox: false,
    },
    balanced: {
        enabled: true,
        noteEdits: false,
        vaultChanges: false,
        web: true,
        mcp: false,
        subtasks: false,
        skills: true,
        pluginApiRead: true,
        pluginApiWrite: false,
        recipes: true,
        sandbox: false,
    },
    restrictive: {
        enabled: false,
        noteEdits: false,
        vaultChanges: false,
        web: false,
        mcp: false,
        subtasks: false,
        skills: false,
        pluginApiRead: false,
        pluginApiWrite: false,
        recipes: false,
        sandbox: false,
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
                'Change Vault Operator plugin settings. Use action "set" to change a single setting by path, ' +
                '"apply_preset" to apply a permission preset, or "open_tab" to open a settings tab for the user. ' +
                'Available presets: "permissive" (writes/web/mcp/skills auto; sandbox, settings and self-modify still ask), "balanced" (reads + web + skills auto, writes ask), "restrictive" (everything that writes asks; reads still run). ' +
                'Available tabs for open_tab: "providers", "agent-behaviour", "customize", "advanced". Sub-tabs (agent-behaviour): "modes", "permissions", "memory", "loop", "inline-chat"; (customize): "skills", "connectors", "prompts", "workflows", "rules", "recipes"; (advanced): "interface", "vault", "plugin-api", "data", "optional-assets". ' +
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
                        description: 'Settings sub-tab to open (for action "open_tab"), e.g. "data", "permissions", "interface", "recipes"',
                    },
                },
                required: ['action'],
            },
        };
    }

    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const action = (input.action as string ?? '').trim();

        try {
            if (action === 'set') {
                await this.handleSet(input, callbacks, context);
            } else if (action === 'apply_preset') {
                await this.handlePreset(input, callbacks);
            } else if (action === 'open_tab') {
                this.handleOpenTab(input, callbacks);
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

    private async handleSet(input: Record<string, unknown>, callbacks: import('../types').ToolCallbacks, context?: ToolExecutionContext): Promise<void> {
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
        let target: Record<string, unknown> = this.plugin.settings as unknown as Record<string, unknown>;
        for (let i = 0; i < parts.length - 1; i++) {
            target = target?.[parts[i]] as Record<string, unknown>;
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

    private handleOpenTab(input: Record<string, unknown>, callbacks: import('../types').ToolCallbacks): void {
        const tab = (input.tab as string ?? '').trim();
        const subTab = (input.sub_tab as string ?? '').trim() || undefined;

        if (!tab) {
            callbacks.pushToolResult(this.formatError(new Error('tab is required for action "open_tab"')));
            return;
        }

        // FIX-26-99-01: validate against the AgentSettingsTab TabId union.
        // Pre-fix, an unknown name like 'agent' would be silently cast and
        // open the default tab with the user expecting something else.
        const VALID_TABS = new Set(['providers', 'agent-behaviour', 'customize', 'advanced', 'help']);
        if (!VALID_TABS.has(tab)) {
            callbacks.pushToolResult(this.formatError(new Error(
                `Unknown settings tab "${tab}". Valid: ${Array.from(VALID_TABS).join(', ')}.`,
            )));
            return;
        }

        this.plugin.openSettingsAt(tab as import('../../../ui/AgentSettingsTab').TabId, subTab);
        const desc = subTab ? `${tab}/${subTab}` : tab;
        callbacks.pushToolResult(this.formatSuccess(`Opened settings tab: ${desc}`));
        callbacks.log(`update_settings: opened tab ${desc}`);
    }

    private async handlePreset(input: Record<string, unknown>, callbacks: import('../types').ToolCallbacks): Promise<void> {
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
        // Auto-complete onboarding when a preset is applied during setup
        if (!this.plugin.settings.onboarding.completed) {
            this.plugin.settings.onboarding.completed = true;
            this.plugin.settings.onboarding.currentStep = 'done';
        }
        await this.plugin.saveSettings();

        // FIX-44-31: describe what the preset ACTUALLY does. Sandbox execution,
        // plugin-settings changes and agent self-modification always ask, even
        // under "permissive"; reads always run, even under "restrictive".
        const summary = presetName === 'permissive'
            ? 'Note edits, vault changes, web, MCP, subtasks, skills and recipes auto-approved. '
              + 'Sandbox code execution, plugin settings changes and agent self-modification still ask.'
            : presetName === 'balanced'
            ? 'Reads, web and skills auto-approved. Writes, vault changes, sandbox and MCP ask.'
            : 'Everything that writes, spends, or leaves the device asks. Reads still run.';

        callbacks.pushToolResult(this.formatSuccess(
            `Applied "${presetName}" permission preset. ${summary}`
        ));
        callbacks.log(`update_settings: applied preset "${presetName}"`);
    }
}
