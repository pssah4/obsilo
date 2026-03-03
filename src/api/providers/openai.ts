/**
 * OpenAiProvider - LLM provider for OpenAI-compatible APIs
 *
 * Adapted from Kilo Code's src/api/providers/openai.ts + base-provider.ts
 *
 * Covers: OpenAI, Mistral, Ollama (port 11434), custom OpenAI-compatible endpoints.
 */

import OpenAI from 'openai';
import type { LLMProvider } from '../../types/settings';
import type { ApiHandler, ApiStream, ApiStreamChunk, MessageParam, ModelInfo } from '../types';
import type { ToolDefinition } from '../../core/tools/types';
import { getModelContextWindow } from '../../types/model-registry';

// ---------------------------------------------------------------------------
// OpenAI REST API types (subset we need)
// ---------------------------------------------------------------------------

interface OpenAIMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    tool_calls?: OpenAIToolCall[];
    tool_call_id?: string;
    name?: string;
}

interface OpenAIToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

interface OpenAITool {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}

// ---------------------------------------------------------------------------
// Tool call accumulator for streaming
// ---------------------------------------------------------------------------

interface ToolCallAccumulator {
    id: string;
    name: string;
    argumentsJson: string;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URLS: Record<string, string> = {
    openai: 'https://api.openai.com/v1',
    ollama: 'http://localhost:11434/v1',
    lmstudio: 'http://localhost:1234/v1',
    openrouter: 'https://openrouter.ai/api/v1',
    custom: 'https://api.openai.com/v1',
};

export class OpenAiProvider implements ApiHandler {
    private config: LLMProvider;
    private client: OpenAI;

    constructor(config: LLMProvider) {
        this.config = config;

        let baseURL = config.baseUrl ?? DEFAULT_BASE_URLS[config.type] ?? DEFAULT_BASE_URLS.openai;
        if (config.type === 'ollama' && !baseURL.match(/\/v\d/)) {
            baseURL = baseURL.replace(/\/+$/, '') + '/v1';
        }

        const defaultHeaders: Record<string, string> = {};
        if (config.type === 'openrouter') {
            defaultHeaders['HTTP-Referer'] = 'https://obsidian.md';
            defaultHeaders['X-Title'] = 'Obsilo Agent';
        }
        if (config.type === 'azure' && config.apiKey) {
            defaultHeaders['api-key'] = config.apiKey;
        }

        this.client = new OpenAI({
            apiKey: config.type === 'azure' ? '' : (config.apiKey || ''),
            baseURL,
            dangerouslyAllowBrowser: true,
            defaultHeaders,
        });
    }

    getModel(): { id: string; info: ModelInfo } {
        // Get context window from central registry
        const contextWindow = getModelContextWindow(this.config.model);

        return {
            id: this.config.model,
            info: {
                contextWindow,
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
        const openAiMessages = this.convertMessages(systemPrompt, messages);
        const openAiTools = tools.length > 0 ? this.convertTools(tools) : undefined;

        // Temperature handling — three cases:
        // 1. o-series (o1, o3, o4-mini, etc.) enforce temperature=1 API-side -> omit entirely
        // 2. Explicitly configured temperature -> always respect it
        // 3. No explicit config -> use 0.2 default for deterministic agent behavior,
        //    EXCEPT for Azure where deployment names are opaque (may hide o-series models)
        const isOSeries = /^o[1-9]/.test(this.config.model);
        let temperature: number | undefined;
        if (isOSeries) {
            temperature = undefined;
        } else if (this.config.temperature !== undefined) {
            temperature = this.config.temperature;
        } else if (this.config.type !== 'azure') {
            temperature = 0.2;
        }

        // Build request body
        const requestBody: OpenAI.ChatCompletionCreateParamsStreaming = {
            model: this.config.type !== 'azure' ? this.config.model : this.config.model,
            messages: openAiMessages as OpenAI.ChatCompletionMessageParam[],
            tools: openAiTools as OpenAI.ChatCompletionTool[] | undefined,
            temperature: temperature !== undefined ? Math.min(temperature, 2.0) : undefined,
            max_tokens: this.config.type !== 'azure' ? (this.config.maxTokens ?? 8192) : undefined,
            stream: true,
            stream_options: (this.config.type === 'openai' || this.config.type === 'openrouter')
                ? { include_usage: true }
                : undefined,
        };

        // Azure uses max_completion_tokens instead of max_tokens
        if (this.config.type === 'azure') {
            (requestBody as unknown as Record<string, unknown>).max_completion_tokens = this.config.maxTokens ?? 8192;
        }

        if (openAiTools && openAiTools.length > 0) {
            requestBody.tool_choice = 'auto';
        }

        // Azure deployment-based routing: use a custom path
        const requestOptions: OpenAI.RequestOptions = { signal: abortSignal ?? null };
        if (this.config.type === 'azure') {
            const apiVersion = this.config.apiVersion ?? '2024-10-21';
            requestOptions.path = `/deployments/${this.config.model}/chat/completions?api-version=${apiVersion}`;
        }

        const stream = await this.client.chat.completions.create(requestBody, requestOptions);

        // Accumulate tool calls across chunks (keyed by index)
        const toolCallAccumulators = new Map<number, ToolCallAccumulator>();

        for await (const chunk of stream) {
            // Usage (sent at end with stream_options)
            if (chunk.usage) {
                yield {
                    type: 'usage',
                    inputTokens: chunk.usage.prompt_tokens,
                    outputTokens: chunk.usage.completion_tokens,
                } satisfies ApiStreamChunk;
            }

            const choice = chunk.choices?.[0];
            if (!choice) continue;

            const delta = choice.delta;

            // Text content
            if (delta?.content) {
                yield { type: 'text', text: delta.content } satisfies ApiStreamChunk;
            }

            // Tool call deltas -- accumulate until finish_reason = 'tool_calls'
            if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                    const idx = tc.index;
                    if (!toolCallAccumulators.has(idx)) {
                        toolCallAccumulators.set(idx, { id: '', name: '', argumentsJson: '' });
                    }
                    const acc = toolCallAccumulators.get(idx)!;
                    if (tc.id) acc.id = tc.id;
                    if (tc.function?.name) acc.name += tc.function.name;
                    if (tc.function?.arguments) acc.argumentsJson += tc.function.arguments;
                }
            }

            // When the turn ends with tool_calls, yield complete tool_use chunks
            if (choice.finish_reason === 'tool_calls') {
                for (const [, acc] of toolCallAccumulators) {
                    let input: Record<string, unknown> = {};
                    try {
                        input = JSON.parse(acc.argumentsJson);
                    } catch (e) {
                        yield {
                            type: 'text',
                            text: `[Tool input parse error for "${acc.name}": ${(e as Error).message}]`,
                        } satisfies ApiStreamChunk;
                        continue;
                    }
                    yield {
                        type: 'tool_use',
                        id: acc.id,
                        name: acc.name,
                        input,
                    } satisfies ApiStreamChunk;
                }
                toolCallAccumulators.clear();
            }
        }
    }

    // ---------------------------------------------------------------------------
    // Format conversion: Anthropic → OpenAI
    // ---------------------------------------------------------------------------

    private convertMessages(systemPrompt: string, messages: MessageParam[]): OpenAIMessage[] {
        const result: OpenAIMessage[] = [
            { role: 'system', content: systemPrompt },
        ];

        for (const msg of messages) {
            if (typeof msg.content === 'string') {
                result.push({ role: msg.role, content: msg.content });
                continue;
            }

            // Array of ContentBlock
            const blocks = msg.content;

            if (msg.role === 'assistant') {
                // Assistant messages may contain text + tool_use blocks
                const textParts = blocks
                    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
                    .map((b) => b.text)
                    .join('');

                const toolUseParts = blocks.filter(
                    (b): b is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
                        b.type === 'tool_use',
                );

                if (toolUseParts.length > 0) {
                    // Message with tool calls
                    result.push({
                        role: 'assistant',
                        content: textParts || null,
                        tool_calls: toolUseParts.map((b) => ({
                            id: b.id,
                            type: 'function',
                            function: {
                                name: b.name,
                                arguments: JSON.stringify(b.input),
                            },
                        })),
                    });
                } else {
                    result.push({ role: 'assistant', content: textParts });
                }
            } else {
                // User messages may contain text + tool_result blocks
                for (const block of blocks) {
                    if (block.type === 'text') {
                        result.push({ role: 'user', content: block.text });
                    } else if (block.type === 'tool_result') {
                        // Tool results become separate 'tool' role messages in OpenAI format
                        result.push({
                            role: 'tool',
                            tool_call_id: block.tool_use_id,
                            content: block.content,
                        });
                    }
                }
            }
        }

        return result;
    }

    private convertTools(tools: ToolDefinition[]): OpenAITool[] {
        return tools.map((tool) => ({
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.input_schema,
            },
        }));
    }
}
