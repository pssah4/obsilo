/**
 * OpenAiProvider - LLM provider for OpenAI-compatible APIs
 *
 * Adapted from Kilo Code's src/api/providers/openai.ts + base-provider.ts
 *
 * Covers: OpenAI, Mistral, Ollama (port 11434), custom OpenAI-compatible endpoints.
 */

import type { LLMProvider } from '../../types/settings';
import type { ApiHandler, ApiStream, ApiStreamChunk, ContentBlock, MessageParam, ModelInfo } from '../types';
import type { ToolDefinition } from '../../core/tools/types';

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
        parameters: Record<string, any>;
    };
}

interface OpenAIStreamDelta {
    role?: string;
    content?: string | null;
    tool_calls?: {
        index: number;
        id?: string;
        type?: 'function';
        function?: {
            name?: string;
            arguments?: string;
        };
    }[];
}

interface OpenAIStreamChoice {
    index: number;
    delta: OpenAIStreamDelta;
    finish_reason: string | null;
}

interface OpenAIStreamChunk {
    id: string;
    object: string;
    model: string;
    choices: OpenAIStreamChoice[];
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
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

    constructor(config: LLMProvider) {
        this.config = config;
    }

    getModel(): { id: string; info: ModelInfo } {
        return {
            id: this.config.model,
            info: {
                contextWindow: 128000,
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
        let baseUrl = this.config.baseUrl ?? DEFAULT_BASE_URLS[this.config.type] ?? DEFAULT_BASE_URLS.openai;
        let url: string;

        if (this.config.type === 'azure') {
            // Azure OpenAI: {endpoint}/deployments/{model}/chat/completions?api-version={version}
            const apiVersion = this.config.apiVersion ?? '2024-10-21';
            url = `${baseUrl.replace(/\/$/, '')}/deployments/${this.config.model}/chat/completions?api-version=${apiVersion}`;
        } else {
            // Ollama's OpenAI-compatible API lives at /v1 — auto-add if missing
            if (this.config.type === 'ollama' && !baseUrl.match(/\/v\d/)) {
                baseUrl = baseUrl.replace(/\/+$/, '') + '/v1';
            }
            url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
        }

        const openAiMessages = this.convertMessages(systemPrompt, messages);
        const openAiTools = tools.length > 0 ? this.convertTools(tools) : undefined;

        const body: Record<string, any> = {
            messages: openAiMessages,
            stream: true,
        };

        // Azure deployment-based routing: model is already encoded in the URL path,
        // so we omit it from the body (some enterprise gateways reject it as redundant)
        if (this.config.type !== 'azure') {
            body.model = this.config.model;
        }

        // Newer models (GPT-5, o-series) require max_completion_tokens; older models use max_tokens
        if (this.config.type === 'azure') {
            body.max_completion_tokens = this.config.maxTokens ?? 8192;
        } else {
            body.max_tokens = this.config.maxTokens ?? 8192;
        }

        // stream_options supported by OpenAI and OpenRouter — enterprise/Azure gateways often reject this extension
        if (this.config.type === 'openai' || this.config.type === 'openrouter') {
            body.stream_options = { include_usage: true };
        }

        // o-series models (o1, o2, o3, o4, o1-mini, o3-mini, o4-mini, etc.) enforce temperature=1
        // API-side and reject any other value. For all other models, pass temperature if explicitly
        // configured — including 0 for deterministic mode.
        const isOSeries = /^o[1-9]/.test(this.config.model);
        if (!isOSeries) {
            body.temperature = this.config.temperature ?? 0.2;
        }

        if (openAiTools && openAiTools.length > 0) {
            body.tools = openAiTools;
            body.tool_choice = 'auto';
        }

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };

        if (this.config.type === 'azure') {
            // Azure OpenAI uses api-key header instead of Authorization: Bearer
            if (this.config.apiKey) headers['api-key'] = this.config.apiKey;
        } else if (this.config.apiKey) {
            headers['Authorization'] = `Bearer ${this.config.apiKey}`;
        }

        // OpenRouter requires these headers for routing and analytics
        if (this.config.type === 'openrouter') {
            headers['HTTP-Referer'] = 'https://obsidian.md';
            headers['X-Title'] = 'Obsilo Agent';
        }

        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: abortSignal,
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            console.error(`[OpenAiProvider] ${response.status} from ${url}\n${errorText}`);
            throw Object.assign(new Error(`OpenAI API error (${response.status}): ${errorText}`), { status: response.status });
        }

        if (!response.body) {
            throw new Error('No response body from OpenAI API');
        }

        // Parse SSE stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        // Accumulate tool calls across chunks (keyed by index)
        const toolCallAccumulators = new Map<number, ToolCallAccumulator>();

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed === 'data: [DONE]') continue;
                    if (!trimmed.startsWith('data: ')) continue;

                    let chunk: OpenAIStreamChunk;
                    try {
                        chunk = JSON.parse(trimmed.slice(6));
                    } catch {
                        continue;
                    }

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
                    if (delta.content) {
                        yield { type: 'text', text: delta.content } satisfies ApiStreamChunk;
                    }

                    // Tool call deltas — accumulate until finish_reason = 'tool_calls'
                    if (delta.tool_calls) {
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
                            let input: Record<string, any> = {};
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
        } finally {
            reader.releaseLock();
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
            const blocks = msg.content as ContentBlock[];

            if (msg.role === 'assistant') {
                // Assistant messages may contain text + tool_use blocks
                const textParts = blocks
                    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
                    .map((b) => b.text)
                    .join('');

                const toolUseParts = blocks.filter(
                    (b): b is { type: 'tool_use'; id: string; name: string; input: Record<string, any> } =>
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
