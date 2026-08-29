/**
 * ConfigureModelTool — Add, select, or test LLM models
 *
 * Three actions:
 * - 'add': Add a new model with API key (and optionally enable + select it)
 * - 'select': Switch the active model
 * - 'test': Test connectivity by sending a minimal request
 *
 * This is the only tool that can set API keys programmatically.
 */

import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';
import type { CustomModel, ProviderType } from '../../../types/settings';
import { getModelKey, BUILT_IN_MODELS, getDefaultBaseUrlForProvider } from '../../../types/settings';
import { buildApiHandlerForModel } from '../../../api/index';
import { runMeteredCall } from '../../pricing/meteredCall';
import { validateProviderUrl } from '../../../api/providers/providerUrlGuard';
import { expandProviderConfigsToCustomModels } from '../../settings/expandProviderConfigs';

export class ConfigureModelTool extends BaseTool<'configure_model'> {
    readonly name = 'configure_model' as const;
    // AUDIT-037 H-2: configure_model can rotate the API key and the baseUrl of
    // an LLM provider, so a compromised turn could re-point Bedrock or OpenAI
    // at an attacker host and the next createMessage() would walk the API key
    // off. Treat it as a write operation so the approval surface fires before
    // the settings mutation, in addition to the URL guard in handleAdd.
    readonly isWriteOperation = true;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'configure_model',
            description:
                'List, add, select, or test an LLM model. ' +
                'Use action "list" to see the models you already have configured (name|provider keys). ' +
                'Use action "add" to configure a new model with API key. ' +
                'Use action "select" to switch the active model. ' +
                'Use action "test" to verify API connectivity. ' +
                'Built-in models (Claude, GPT, Gemini, Llama, Qwen) only need an API key — ' +
                'the model name and base URL are pre-configured.',
            input_schema: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        enum: ['list', 'add', 'select', 'test'],
                        description: 'Action to perform',
                    },
                    provider: {
                        type: 'string',
                        enum: ['anthropic', 'openai', 'ollama', 'lmstudio', 'openrouter', 'azure', 'custom'],
                        description: 'LLM provider (for action "add")',
                    },
                    model_name: {
                        type: 'string',
                        description: 'Model identifier, e.g. "claude-sonnet-4-5-20250929" or "gemini-2.5-flash" (for action "add")',
                    },
                    display_name: {
                        type: 'string',
                        description: 'Human-readable name shown in UI (optional for "add")',
                    },
                    api_key: {
                        type: 'string',
                        description: 'API key for the model (for action "add")',
                    },
                    base_url: {
                        type: 'string',
                        description: 'Custom base URL (for action "add", required for custom/azure providers)',
                    },
                    model_key: {
                        type: 'string',
                        description: 'Model key "name|provider" for actions "select" and "test"',
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
            if (action === 'add') {
                await this.handleAdd(input, callbacks);
            } else if (action === 'list') {
                this.handleList(callbacks);
            } else if (action === 'select') {
                await this.handleSelect(input, callbacks);
            } else if (action === 'test') {
                await this.handleTest(input, callbacks, context.reportAuxUsage);
            } else {
                callbacks.pushToolResult(this.formatError(new Error(
                    `Unknown action: "${action}". Use "list", "add", "select", or "test".`
                )));
            }
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('configure_model', error);
        }
    }

    /**
     * Issue #54.4b: the canonical model universe after the EPIC-26 migration
     * lives in providerConfigs[]; activeModels[] is emptied on migration. All
     * agent-facing lookups resolve against this bridge instead of the dead array.
     */
    private getConfiguredModels(): CustomModel[] {
        return expandProviderConfigsToCustomModels(this.plugin.settings.providerConfigs ?? []);
    }

    private handleList(callbacks: import('../types').ToolCallbacks): void {
        const models = this.getConfiguredModels();
        if (models.length === 0) {
            callbacks.pushToolResult(
                'No models configured. Add one in Settings > Providers, or use action "add".'
            );
            return;
        }
        const lines = models.map(
            (m) => `- ${getModelKey(m)} (${m.displayName ?? m.name}, provider: ${m.provider})`
        );
        callbacks.pushToolResult(`Configured models (${models.length}):\n${lines.join('\n')}`);
        callbacks.log(`configure_model: listed ${models.length} models`);
    }

    private async handleAdd(input: Record<string, unknown>, callbacks: import('../types').ToolCallbacks): Promise<void> {
        const modelName = (input.model_name as string ?? '').trim();
        const apiKey = (input.api_key as string ?? '').trim();
        const provider = (input.provider as ProviderType | undefined);

        if (!modelName) {
            callbacks.pushToolResult(this.formatError(new Error('model_name is required')));
            return;
        }

        // Check if this is a built-in model — just needs API key
        const builtIn = BUILT_IN_MODELS.find((m) => m.name === modelName);

        const resolvedProvider = provider ?? builtIn?.provider;
        if (!resolvedProvider) {
            callbacks.pushToolResult(this.formatError(new Error(
                'provider is required for custom models'
            )));
            return;
        }

        // AUDIT-037 H-2: SSRF guard for the supplied base_url. Refuses public
        // cloud impersonators, AWS / GCP metadata hosts and unmatched HTTPS
        // targets before the entry lands in plugin.settings.activeModels.
        const baseUrlInput = ((input.base_url as string) ?? '').trim();
        if (baseUrlInput) {
            try {
                validateProviderUrl(resolvedProvider, baseUrlInput);
            } catch (e) {
                callbacks.pushToolResult(this.formatError(e));
                return;
            }
        }

        // Build the model entry
        const model: CustomModel = {
            name: modelName,
            provider: resolvedProvider,
            displayName: (input.display_name as string) ?? builtIn?.displayName ?? modelName,
            apiKey: apiKey || undefined,
            baseUrl: (input.base_url as string) ?? builtIn?.baseUrl ?? getDefaultBaseUrlForProvider(resolvedProvider),
            enabled: true,
            isBuiltIn: builtIn?.isBuiltIn ?? false,
            maxTokens: builtIn?.maxTokens,
        };

        const key = getModelKey(model);

        // Check if model already exists in activeModels
        const existingIdx = this.plugin.settings.activeModels.findIndex(
            (m) => getModelKey(m) === key
        );

        if (existingIdx >= 0) {
            // Update existing entry (preserve other fields, update key + enabled)
            const existing = this.plugin.settings.activeModels[existingIdx];
            if (apiKey) existing.apiKey = apiKey;
            // AUDIT-037 H-2: re-validate before overwriting the existing baseUrl
            // since the existing entry may have come from a trusted UI flow but
            // the agent-driven update is in scope of the LLM trust boundary.
            if (input.base_url) {
                try {
                    validateProviderUrl(existing.provider, input.base_url as string);
                } catch (e) {
                    callbacks.pushToolResult(this.formatError(e));
                    return;
                }
                existing.baseUrl = input.base_url as string;
            }
            if (input.display_name) existing.displayName = input.display_name as string;
            existing.enabled = true;
        } else {
            // Add new model
            this.plugin.settings.activeModels.push(model);
        }

        // Auto-select if no active model
        if (!this.plugin.settings.activeModelKey) {
            this.plugin.settings.activeModelKey = key;
        }

        await this.plugin.saveSettings();

        const isActive = this.plugin.settings.activeModelKey === key;
        callbacks.pushToolResult(this.formatSuccess(
            `Model "${model.displayName}" (${key}) configured and enabled.` +
            (isActive ? ' Set as active model.' : ` Use select action with model_key "${key}" to activate it.`)
        ));
        callbacks.log(`configure_model: added ${key}`);
    }

    private async handleSelect(input: Record<string, unknown>, callbacks: import('../types').ToolCallbacks): Promise<void> {
        const modelKey = (input.model_key as string ?? '').trim();

        if (!modelKey) {
            callbacks.pushToolResult(this.formatError(new Error('model_key is required')));
            return;
        }

        // Issue #54.4b: resolve against providerConfigs (the post-migration
        // store); expandProviderConfigsToCustomModels only yields enabled
        // provider models, so a separate disabled-model branch is unnecessary.
        const models = this.getConfiguredModels();
        const model = models.find((m) => getModelKey(m) === modelKey);

        if (!model) {
            const available = models
                .map((m) => `${getModelKey(m)} (${m.displayName ?? m.name})`)
                .join(', ');
            callbacks.pushToolResult(this.formatError(new Error(
                `Model "${modelKey}" not found. Available: ${available || 'none configured'}. `
                + 'Use action "list" to see configured models.'
            )));
            return;
        }

        this.plugin.settings.activeModelKey = modelKey;
        await this.plugin.saveSettings();

        callbacks.pushToolResult(this.formatSuccess(
            `Active model switched to "${model.displayName ?? model.name}" (${modelKey})`
        ));
        callbacks.log(`configure_model: selected ${modelKey}`);
    }

    private async handleTest(
        input: Record<string, unknown>,
        callbacks: import('../types').ToolCallbacks,
        /**
         * FIX-24-05-09 (D10): a probe is cheap but not free, and unlike the
         * settings-tab connection test this one is agent-driven -- a loop that
         * tests five models in a turn should show up in that turn's cost.
         */
        reportAuxUsage?: import('../../pricing/meteredCall').UsageSink,
    ): Promise<void> {
        const modelKey = (input.model_key as string ?? '').trim();

        if (!modelKey) {
            callbacks.pushToolResult(this.formatError(new Error('model_key is required')));
            return;
        }

        // Issue #54.4b: resolve against providerConfigs (post-migration store).
        const model = this.getConfiguredModels().find((m) => getModelKey(m) === modelKey);

        if (!model) {
            callbacks.pushToolResult(this.formatError(new Error(
                `Model "${modelKey}" not found. Use action "list" to see configured models.`
            )));
            return;
        }

        if (!model.apiKey && !['ollama', 'lmstudio'].includes(model.provider)) {
            callbacks.pushToolResult(this.formatError(new Error(
                `No API key configured for "${model.displayName ?? model.name}". Add one first.`
            )));
            return;
        }

        try {
            const handler = buildApiHandlerForModel(model);
            const stream = runMeteredCall(handler, 'model-connection-test', {
                systemPrompt: 'Respond with exactly: "OK"',
                messages: [{ role: 'user', content: 'Test connection' }],
            }, reportAuxUsage);

            let responseText = '';
            for await (const chunk of stream) {
                if (chunk.type === 'text') {
                    responseText += chunk.text;
                    if (responseText.length > 50) break; // enough to confirm connectivity
                }
            }

            if (responseText.length > 0) {
                callbacks.pushToolResult(this.formatSuccess(
                    `Connection to "${model.displayName ?? model.name}" successful. Model responded.`
                ));
            } else {
                callbacks.pushToolResult(this.formatError(new Error(
                    'Connection succeeded but no response received. The model may be unavailable.'
                )));
            }
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            callbacks.pushToolResult(this.formatError(new Error(
                `Connection test failed for "${model.displayName ?? model.name}": ${msg}`
            )));
        }

        callbacks.log(`configure_model: tested ${modelKey}`);
    }
}
