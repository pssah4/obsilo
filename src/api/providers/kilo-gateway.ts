/**
 * KiloGatewayProvider — LLM Provider für Kilo Gateway API
 *
 * Nutzt den OpenAI SDK mit einem custom fetch-Wrapper, der Kilo Auth-Header
 * injiziert. Die Inferenzseite ist OpenAI-kompatibel, Auth und Session sind
 * proprietär und leben im KiloAuthService.
 *
 * @see ADR-040 (Provider Architecture)
 * @see ADR-041 (Auth and Session Architecture)
 * @see FEATURE-1302 (Gateway Chat Provider)
 */

import OpenAI from 'openai';
import type { LLMProvider } from '../../types/settings';
import type { ApiHandler, ApiStream, ApiStreamChunk, MessageParam, ModelInfo } from '../types';
import type { ToolDefinition } from '../../core/tools/types';
import { KiloAuthService } from '../../core/security/KiloAuthService';
import { resolveOutputBudget, estimatePromptTokens, modelSupportsTemperature, getModelContextWindow } from '../../types/model-registry';
import { logCacheStat } from '../logCacheStat';
import { normalizeDeltaContent } from './utils/openAiContent';
import { flushToolCallAccumulators, type ToolCallAccumulator } from './utils/toolCallFlush';
import { convertToOpenAiChatMessages, convertToOpenAiChatTools } from '../adapters/openaiChat';
import { markOpenAiShapeCacheBreakpoints } from '../adapters/openaiShapeCacheMarkers';
import { readOpenAiShapeCacheUsage } from '../adapters/openaiShapeCacheUsage';
import { getCacheCapability } from '../capabilities';
import { createNodeFetch } from './openai';

// ---------------------------------------------------------------------------
// OpenAI REST API types (subset — mirrors github-copilot.ts)
// ---------------------------------------------------------------------------

// IMP-41-03-03 / ADR-150: message/tool types + conversion live in the
// shared openai-chat wire adapter (one implementation, three consumers).

// ToolCallAccumulator moved to utils/toolCallFlush.ts (FIX-13-02-01); see import above.

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const KILO_GATEWAY_BASE = 'https://api.kilo.ai/api/gateway';

export class KiloGatewayProvider implements ApiHandler {
    private config: LLMProvider;
    private client: OpenAI;
    private authService: KiloAuthService;

    constructor(config: LLMProvider) {
        this.config = config;
        this.authService = KiloAuthService.getInstance();

        this.client = new OpenAI({
            apiKey: 'kilo', // Placeholder — echte Auth über custom fetch
            baseURL: KILO_GATEWAY_BASE,
            dangerouslyAllowBrowser: true,
            // FIX-13-02-03 (Issue #64): Node-Transport statt Renderer-fetch.
            // Derselbe Weg, den gemini/custom/ollama/lmstudio und der
            // Anthropic-Gateway-Modus gehen (ADR-064), Streaming inklusive.
            fetch: this.authService.getKiloFetch(createNodeFetch()),
        });
    }

    getModel(): { id: string; info: ModelInfo } {
        // Resolve the real window from the central registry instead of a flat
        // 128k, which condensed 1M-context models (Opus 4.7/4.8, Sonnet 5) at
        // ~100k. getModelContextWindow normalizes any gateway-decorated id.
        return {
            id: this.config.model,
            info: {
                // ADR-158 stage 1: discovery-reported window wins
                contextWindow: this.config.contextWindow ?? getModelContextWindow(this.config.model),
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
        const openAiMessages = convertToOpenAiChatMessages(systemPrompt, messages, 'kilo-gateway');
        const openAiTools = tools.length > 0 ? convertToOpenAiChatTools(tools) : undefined;

        // AP3: the gateway routes Anthropic-format requests, so the same
        // cache_control passthrough the vendor's own client sends applies here.
        // Table entry and producer now agree (D4).
        const cacheMarkersSent = (this.config.promptCachingEnabled ?? false)
            && getCacheCapability('kilo-gateway', this.config.model).cacheStyle === 'passthrough';
        if (cacheMarkersSent) {
            markOpenAiShapeCacheBreakpoints(openAiMessages, systemPrompt);
        }

        // Temperature: o-series weglassen, default-only Modelle (Opus 4.7,
        // GPT-5.x; FIX-04-03-02) ebenfalls weglassen, sonst Config oder 0.2.
        const isOSeries = /^o[1-9]/.test(this.config.model);
        const supportsTemperature = modelSupportsTemperature(this.config.model);
        const temperature: number | undefined = (isOSeries || !supportsTemperature)
            ? undefined
            : (this.config.temperature ?? 0.2);

        const { maxTokens: effectiveMaxTokens } = resolveOutputBudget(
            this.config.model,
            this.config.maxTokens,
            { estimatedInputTokens: estimatePromptTokens(systemPrompt, messages, tools) },
        );
        const requestBody: Record<string, unknown> = {
            model: this.config.model,
            messages: openAiMessages,
            tools: openAiTools,
            temperature: temperature !== undefined ? Math.min(temperature, 2.0) : undefined,
            max_tokens: effectiveMaxTokens,
            stream: true,
            stream_options: { include_usage: true },
        };

        if (openAiTools && openAiTools.length > 0) {
            requestBody.tool_choice = 'auto';
        }

        const createParams = requestBody as unknown as OpenAI.ChatCompletionCreateParamsStreaming;

        let stream: AsyncIterable<OpenAI.ChatCompletionChunk>;
        try {
            stream = await this.client.chat.completions.create(createParams, {
                signal: abortSignal ?? null,
            });
        } catch (e) {
            throw this.enhanceError(e);
        }

        const toolCallAccumulators = new Map<number, ToolCallAccumulator>();
        // FIX-18-04-03: see openai.ts comment.
        let lastFinishReason: string | null | undefined = null;

        for await (const chunk of stream) {
            if (chunk.usage) {
                // AP3: shared reader, so cache_write_tokens is picked up here too.
                const cacheUsage = readOpenAiShapeCacheUsage(chunk.usage, 'kilo-gateway');
                logCacheStat({
                    provider: 'kilo-gateway',
                    model: this.config.model,
                    // AP3: 'auto' was wrong for this gateway. It routes Anthropic
                    // models, which cache only when cache_control is sent, so before
                    // the marker code existed nothing was cached at all.
                    caching: cacheMarkersSent ? 'on' : 'OFF',
                    nonCachedInputTokens: cacheUsage.inputTokens,
                    cacheReadTokens: cacheUsage.cacheReadTokens,
                    cacheCreationTokens: cacheUsage.cacheCreationTokens,
                    outputTokens: cacheUsage.outputTokens,
                });
                yield {
                    type: 'usage',
                    // IMP-18-01-02: prompt_tokens is the total; report non-cached as
                    // inputTokens + cached separately so cost bills the cached prefix cheap.
                    inputTokens: cacheUsage.inputTokens,
                    outputTokens: cacheUsage.outputTokens,
                    cacheReadTokens: cacheUsage.cacheReadTokens > 0 ? cacheUsage.cacheReadTokens : undefined,
                    cacheCreationTokens: cacheUsage.cacheCreationTokens > 0
                        ? cacheUsage.cacheCreationTokens
                        : undefined,
                } satisfies ApiStreamChunk;
            }

            const choice = chunk.choices?.[0];
            if (!choice) continue;

            const delta = choice.delta;

            // FIX-13-02-02: delta.content can arrive either as a plain
            // string or as an Anthropic-style array of content blocks
            // when the gateway proxies to a Claude tier. Strict-string
            // typecheck used to drop the array form and the user saw
            // empty output despite a billed completion.
            const text = normalizeDeltaContent(delta?.content);
            if (text) {
                yield { type: 'text', text } satisfies ApiStreamChunk;
            }

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

            // FIX-18-04-03: track finish_reason for the post-loop fallback.
            if (choice.finish_reason) {
                lastFinishReason = choice.finish_reason;
            }

            // When the turn ends with tool_calls, flush via the shared helper
            // so kilo-gateway, openai and copilot stay in lockstep.
            if (choice.finish_reason === 'tool_calls') {
                yield* flushToolCallAccumulators(toolCallAccumulators, {
                    wasMaxTokens: false,
                    providerLabel: 'Kilo',
                });
            }
        }

        // FIX-13-02-01 / BUG-013-pattern: Kilo Gateway routes to varied
        // upstream models (Groq, OpenRouter shapes, Claude tiers); any of them
        // can stream tool_calls deltas and finish with finish_reason="stop"
        // or "length" instead of "tool_calls". Without this post-loop flush
        // the accumulated tool calls were silently discarded -- the exact bug
        // openai.ts and github-copilot.ts already guard against.
        // FIX-18-04-03 wires the wasMaxTokens flag.
        if (toolCallAccumulators.size > 0) {
            yield* flushToolCallAccumulators(toolCallAccumulators, {
                wasMaxTokens: lastFinishReason === 'length',
                providerLabel: 'Kilo',
            });
        }
    }

    /**
     * Schneller non-streaming Klassifizierungsaufruf.
     * Wird für Skill-Matching LLM-Fallback genutzt.
     */
    async classifyText(prompt: string, abortSignal?: AbortSignal): Promise<string> {
        const response = await this.client.chat.completions.create({
            model: this.config.model,
            max_tokens: 50,
            messages: [{ role: 'user', content: prompt }],
        }, {
            signal: abortSignal ?? undefined,
        });

        return response.choices?.[0]?.message?.content?.trim() ?? '';
    }

    // ---------------------------------------------------------------------------
    // Format conversion: Anthropic → OpenAI (mirrors github-copilot.ts)
    // ---------------------------------------------------------------------------

    // ---------------------------------------------------------------------------
    // Error handling
    // ---------------------------------------------------------------------------

    private enhanceError(e: unknown): Error {
        if (!(e instanceof OpenAI.APIError)) {
            return e instanceof Error ? e : new Error(String(e));
        }
        switch (e.status) {
            case 401:
                return new Error('Kilo session expired. Please sign in again in the settings.');
            case 403:
                return new Error('Access denied. Check your Kilo subscription and model access.');
            case 429:
                return new Error('Kilo rate limit exceeded. Please wait a moment and try again.');
            case 400:
                return new Error(`Kilo request error: ${e.message}`);
            default:
                return new Error(`Kilo Gateway API error (${e.status}): ${e.message}`);
        }
    }
}

