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
import { getModelKey, BUILT_IN_MODELS } from '../../../types/settings';
import { buildApiHandlerForModel } from '../../../api/index';

export class ConfigureModelTool extends BaseTool<'configure_model'> {
    readonly name = 'configure_model' as const;
    readonly isWriteOperation = false; // Settings change, not vault write

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'configure_model',
            description:
                'Add, select, or test an LLM model. ' +
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
                        enum: ['add', 'select', 'test'],
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

    async execute(input: Record<string, any>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const action = (input.action as string ?? '').trim();

        try {
            if (action === 'add') {
                await this.handleAdd(input, callbacks);
            } else if (action === 'select') {
                await this.handleSelect(input, callbacks);
            } else if (action === 'test') {
                await this.handleTest(input, callbacks);
            } else {
                callbacks.pushToolResult(this.formatError(new Error(
                    `Unknown action: "${action}". Use "add", "select", or "test".`
                )));
            }
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('configure_model', error);
        }
    }

    private async handleAdd(input: Record<string, any>, callbacks: import('../types').ToolCallbacks): Promise<void> {
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

        // Build the model entry
        const model: CustomModel = {
            name: modelName,
            provider: resolvedProvider,
            displayName: (input.display_name as string) ?? builtIn?.displayName ?? modelName,
            apiKey: apiKey || undefined,
            baseUrl: (input.base_url as string) ?? builtIn?.baseUrl ?? undefined,
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
            if (input.base_url) existing.baseUrl = input.base_url as string;
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

    private async handleSelect(input: Record<string, any>, callbacks: import('../types').ToolCallbacks): Promise<void> {
        const modelKey = (input.model_key as string ?? '').trim();

        if (!modelKey) {
            callbacks.pushToolResult(this.formatError(new Error('model_key is required')));
            return;
        }

        const model = this.plugin.settings.activeModels.find(
            (m) => getModelKey(m) === modelKey
        );

        if (!model) {
            const available = this.plugin.settings.activeModels
                .filter((m) => m.enabled)
                .map((m) => `${getModelKey(m)} (${m.displayName ?? m.name})`)
                .join(', ');
            callbacks.pushToolResult(this.formatError(new Error(
                `Model "${modelKey}" not found in active models. Available: ${available || 'none configured'}`
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

    private async handleTest(input: Record<string, any>, callbacks: import('../types').ToolCallbacks): Promise<void> {
        const modelKey = (input.model_key as string ?? '').trim();

        if (!modelKey) {
            callbacks.pushToolResult(this.formatError(new Error('model_key is required')));
            return;
        }

        const model = this.plugin.settings.activeModels.find(
            (m) => getModelKey(m) === modelKey
        );

        if (!model) {
            callbacks.pushToolResult(this.formatError(new Error(
                `Model "${modelKey}" not found in active models`
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
            const stream = handler.createMessage(
                'Respond with exactly: "OK"',
                [{ role: 'user', content: 'Test connection' }],
                [],
            );

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
