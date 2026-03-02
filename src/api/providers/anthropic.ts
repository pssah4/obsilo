/**
 * AnthropicProvider - LLM provider for Anthropic Claude
 *
 * Adapted from Kilo Code's src/api/providers/anthropic.ts
 *
 * Key difference from Kilo Code: We accumulate tool_use input_json_delta chunks
 * internally and yield complete tool_use objects (not partial streaming).
 * This simplifies the conversation loop significantly.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider } from '../../types/settings';
import type { ApiHandler, ApiStream, ApiStreamChunk, ContentBlock, MessageParam, ModelInfo } from '../types';
import type { ToolDefinition } from '../../core/tools/types';

export class AnthropicProvider implements ApiHandler {
    private client: Anthropic;
    private config: LLMProvider;

    constructor(config: LLMProvider) {
        this.config = config;
        this.client = new Anthropic({
            apiKey: config.apiKey ?? '',
            baseURL: config.baseUrl,
            dangerouslyAllowBrowser: true, // Required for Obsidian (Electron)
        });
    }

    getModel(): { id: string; info: ModelInfo } {
        return {
            id: this.config.model,
            info: {
                contextWindow: 200000,
                supportsTools: true,
                supportsStreaming: true,
            },
        };
    }

    async *createMessage(
        systemPrompt: string,
        messages: MessageParam[],
        tools: ToolDefinition[],
        abortSignal?: AbortSignal,
    ): ApiStream {
        // Convert our internal MessageParam[] to Anthropic's format
        const anthropicMessages = this.convertMessages(messages);

        // Convert ToolDefinition[] to Anthropic's tool format
        const anthropicTools: Anthropic.Tool[] = tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.input_schema as Anthropic.Tool.InputSchema,
        }));

        // Prompt caching: mark the last user message with cache_control
        if (this.config.promptCachingEnabled && anthropicMessages.length > 0) {
            for (let i = anthropicMessages.length - 1; i >= 0; i--) {
                if (anthropicMessages[i].role === 'user') {
                    const lastUser = anthropicMessages[i];
                    if (typeof lastUser.content === 'string') {
                        anthropicMessages[i] = {
                            role: 'user',
                            content: [{
                                type: 'text' as const,
                                text: lastUser.content,
                                cache_control: { type: 'ephemeral' as const },
                            }],
                        };
                    } else if (Array.isArray(lastUser.content) && lastUser.content.length > 0) {
                        const blocks = [...lastUser.content] as Anthropic.Messages.ContentBlockParam[];
                        const lastBlock = blocks[blocks.length - 1];
                        if ('type' in lastBlock && lastBlock.type === 'text') {
                            blocks[blocks.length - 1] = { ...lastBlock, cache_control: { type: 'ephemeral' as const } };
                            anthropicMessages[i] = { role: 'user', content: blocks };
                        }
                    }
                    break;
                }
            }
        }

        // Build system prompt: use array form with cache_control when caching is enabled
        const systemParam: string | Anthropic.Messages.TextBlockParam[] = this.config.promptCachingEnabled
            ? [{ type: 'text' as const, text: systemPrompt, cache_control: { type: 'ephemeral' as const } }]
            : systemPrompt;

        // Extended thinking: when enabled, temperature MUST be 1, max_tokens >= budget_tokens
        const thinkingEnabled = this.config.thinkingEnabled ?? false;
        const budgetTokens = this.config.thinkingBudgetTokens ?? 10000;
        const effectiveTemperature = thinkingEnabled
            ? 1
            : Math.min(this.config.temperature ?? 0.2, 1.0);
        const effectiveMaxTokens = thinkingEnabled
            ? Math.max(this.config.maxTokens ?? 16384, budgetTokens)
            : (this.config.maxTokens ?? 8192);

        // Create streaming request (pass abort signal for cancellation support)
        const stream = this.client.messages.stream(
            {
                model: this.config.model,
                max_tokens: effectiveMaxTokens,
                temperature: effectiveTemperature,
                system: systemParam,
                messages: anthropicMessages,
                tools: anthropicTools.length > 0 ? anthropicTools : undefined,
                tool_choice: anthropicTools.length > 0 ? { type: 'auto' } : undefined,
                ...(thinkingEnabled
                    ? { thinking: { type: 'enabled' as const, budget_tokens: budgetTokens } }
                    : {}),
            },
            { signal: abortSignal },
        );

        // Process stream - accumulate tool input JSON, yield complete tool_use
        // Adapted from Kilo Code's approach in anthropic.ts
        const toolAccumulator = new Map<
            number,
            { id: string; name: string; inputJson: string }
        >();
        // Track thinking blocks by index — yield streaming text then flush on stop
        const thinkingAccumulator = new Map<number, { text: string }>();

        let inputTokens = 0;
        let outputTokens = 0;
        let cacheReadTokens = 0;
        let cacheCreationTokens = 0;

        for await (const event of stream) {
            if (event.type === 'message_start') {
                inputTokens = event.message.usage.input_tokens;
                cacheReadTokens = event.message.usage.cache_read_input_tokens ?? 0;
                cacheCreationTokens = event.message.usage.cache_creation_input_tokens ?? 0;
            }

            if (event.type === 'message_delta') {
                outputTokens = event.usage.output_tokens;
            }

            if (event.type === 'content_block_start') {
                if (event.content_block.type === 'tool_use') {
                    toolAccumulator.set(event.index, {
                        id: event.content_block.id,
                        name: event.content_block.name,
                        inputJson: '',
                    });
                } else if (event.content_block.type === 'thinking') {
                    thinkingAccumulator.set(event.index, { text: '' });
                }
            }

            if (event.type === 'content_block_delta') {
                if (event.delta.type === 'text_delta') {
                    yield { type: 'text', text: event.delta.text } satisfies ApiStreamChunk;
                }

                if (event.delta.type === 'input_json_delta') {
                    const tool = toolAccumulator.get(event.index);
                    if (tool) tool.inputJson += event.delta.partial_json;
                }

                // Anthropic extended thinking delta
                if (event.delta.type === 'thinking_delta') {
                    const thinking = thinkingAccumulator.get(event.index);
                    if (thinking) {
                        const chunk = event.delta.thinking;
                        thinking.text += chunk;
                        yield { type: 'thinking', text: chunk } satisfies ApiStreamChunk;
                    }
                }
            }

            if (event.type === 'content_block_stop') {
                thinkingAccumulator.delete(event.index);

                // If this was a tool_use block, yield the complete tool call
                const tool = toolAccumulator.get(event.index);
                if (tool) {
                    let parsedInput: Record<string, unknown> = {};
                    try {
                        parsedInput = tool.inputJson ? JSON.parse(tool.inputJson) : {};
                    } catch (e) {
                        yield {
                            type: 'tool_error',
                            id: tool.id,
                            name: tool.name,
                            error: `Tool input parse error: ${(e as Error).message}`,
                        } satisfies ApiStreamChunk;
                        toolAccumulator.delete(event.index);
                        continue;
                    }

                    yield {
                        type: 'tool_use',
                        id: tool.id,
                        name: tool.name,
                        input: parsedInput,
                    } satisfies ApiStreamChunk;

                    toolAccumulator.delete(event.index);
                }
            }
        }

        // Yield token usage at the end
        if (inputTokens > 0 || outputTokens > 0) {
            yield {
                type: 'usage',
                inputTokens,
                outputTokens,
                cacheReadTokens: cacheReadTokens > 0 ? cacheReadTokens : undefined,
                cacheCreationTokens: cacheCreationTokens > 0 ? cacheCreationTokens : undefined,
            } satisfies ApiStreamChunk;
        }
    }

    /**
     * Convert our internal MessageParam[] to Anthropic's MessageParam[]
     * Adapted from Kilo Code's message conversion logic
     */
    private convertMessages(messages: MessageParam[]): Anthropic.MessageParam[] {
        return messages.map((msg) => {
            if (typeof msg.content === 'string') {
                return { role: msg.role, content: msg.content };
            }

            // Let TypeScript infer the correct union type from the SDK
            const content = msg.content.map((block) => {
                if (block.type === 'text') {
                    return { type: 'text' as const, text: block.text };
                }

                if (block.type === 'tool_use') {
                    return {
                        type: 'tool_use' as const,
                        id: block.id,
                        name: block.name,
                        input: block.input,
                    };
                }

                if (block.type === 'image') {
                    return {
                        type: 'image' as const,
                        source: {
                            type: 'base64' as const,
                            media_type: block.source.media_type,
                            data: block.source.data,
                        },
                    };
                }

                if (block.type === 'tool_result') {
                    return {
                        type: 'tool_result' as const,
                        tool_use_id: block.tool_use_id,
                        content: block.content,
                        is_error: block.is_error,
                    };
                }

                throw new Error(`Unknown content block type: ${(block as ContentBlock).type}`);
            });

            return { role: msg.role, content } as Anthropic.MessageParam;
        });
    }
}
