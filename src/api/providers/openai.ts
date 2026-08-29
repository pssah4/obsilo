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
import type { IncomingMessage } from 'http';
import { getModelContextWindow, resolveOutputBudget, estimatePromptTokens, modelSupportsTemperature, resolveEffortLevels, modelUsesBudgetTokensThinking, isEffortWithToolsUnsupported } from '../../types/model-registry';
import { validateProviderUrl } from './providerUrlGuard';
import { getCacheCapability } from '../capabilities';
import { logCacheStat } from '../logCacheStat';
import { flushToolCallAccumulators, type ToolCallAccumulator } from './utils/toolCallFlush';

// ---------------------------------------------------------------------------
// OpenAI REST API types (subset we need)
// ---------------------------------------------------------------------------

import { convertToOpenAiChatMessages, convertToOpenAiChatTools } from '../adapters/openaiChat';
import { markOpenAiShapeCacheBreakpoints } from '../adapters/openaiShapeCacheMarkers';
import { readOpenAiShapeCacheUsage } from '../adapters/openaiShapeCacheUsage';

// IMP-41-03-03 / ADR-150: message/tool types and the conversion itself live
// in the shared openai-chat wire adapter (../adapters/openaiChat) — one
// implementation for all OpenAI-shape providers instead of three copies.

// FIX-04-03-10: per-conversation Thinking toggle for OpenAI-compatible local
// backends. The OpenRouter path has its own `reasoning` wrapper, OpenAI/Azure
// have no on/off toggle (effort-only), so this set is the local cluster only.
// Mechanism (only when this.config.thinkingEnabled is EXPLICITLY set):
//   1. `chat_template_kwargs: { enable_thinking: <bool> }` extra body field
//      (vLLM + MLX-LM pass it through to the chat template; other servers
//      ignore unknown fields).
//   2. For Qwen-family model names: prefix the system prompt with `/no_think `
//      or `/think `. Servers that drop chat_template_kwargs (Ollama today) still
//      honour the inline token, which is Qwen's official documented mechanism.
const THINKING_TOGGLE_PROVIDER_TYPES = new Set<string>(['custom', 'ollama', 'lmstudio']);
const QWEN_THINKING_MODEL_REGEX = /qwen3?/i;

// ToolCallAccumulator moved to utils/toolCallFlush.ts (FIX-13-02-01); see import above.

// FIX-54-10: once-per-session-per-model notice when a user-chosen effort is
// suppressed to 'none' because the model rejects effort with function tools.
const effortSuppressionNotified = new Set<string>();

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Node.js fetch wrapper — bypasses CORS in Electron renderer (ADR-064)
// ---------------------------------------------------------------------------

/**
 * Creates a fetch-compatible function using Node.js http(s) module.
 * Used for providers where Electron's CORS enforcement blocks window.fetch
 * (e.g. Google's generativelanguage.googleapis.com, chatgpt.com/backend-api,
 * and FIX-04-03-03 custom OpenAI-compatible servers like opencode go on
 * localhost).
 *
 * Picks the http or https module based on the URL protocol so plain-HTTP
 * local dev servers also work, not just HTTPS endpoints.
 */
export function createNodeFetch(): typeof window.fetch {
    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const parsed = new URL(url);
        const isHttps = parsed.protocol === 'https:';

        // Node.js http(s) only available via dynamic require in Electron renderer
        const httpModule = isHttps
            // eslint-disable-next-line @typescript-eslint/no-require-imports -- dynamic require for Electron renderer
            ? (require('https') as typeof import('https'))
            // eslint-disable-next-line @typescript-eslint/no-require-imports -- dynamic require for Electron renderer
            : (require('http') as unknown as typeof import('https'));

        return new Promise<Response>((resolve, reject) => {
            const headers: Record<string, string> = {};
            if (init?.headers) {
                if (init.headers instanceof Headers) {
                    init.headers.forEach((v, k) => { headers[k] = v; });
                } else if (Array.isArray(init.headers)) {
                    for (const [k, v] of init.headers) headers[k] = v;
                } else {
                    Object.assign(headers, init.headers);
                }
            }

            const defaultPort = isHttps ? 443 : 80;
            const req = httpModule.request({
                hostname: parsed.hostname,
                port: parsed.port || defaultPort,
                path: parsed.pathname + parsed.search,
                method: init?.method ?? 'GET',
                headers,
            }, (res: IncomingMessage) => {
                // AUDIT-023 L-1: clear the connection-level idle timeout once
                // the server actually starts responding; the stream itself is
                // driven by res.on('data'/'end'/'error').
                req.setTimeout(0);
                // Convert Node.js IncomingMessage to a Web ReadableStream
                const body = new ReadableStream<Uint8Array>({
                    start(controller) {
                        res.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
                        res.on('end', () => controller.close());
                        res.on('error', (err) => controller.error(err));
                    },
                    cancel() { res.destroy(); },
                });

                const responseHeaders = new Headers();
                for (const [key, value] of Object.entries(res.headers)) {
                    if (value) responseHeaders.set(key, Array.isArray(value) ? value.join(', ') : value);
                }

                resolve(new Response(body, {
                    status: res.statusCode ?? 500,
                    statusText: res.statusMessage ?? '',
                    headers: responseHeaders,
                }));
            });

            req.on('error', reject);

            // AUDIT-023 L-1: bound idle-time on the socket so a server that
            // accepts the connection and then never writes does not hang
            // forever. 120 s matches the upstream chat-loop tolerance; the
            // AbortSignal path below still cancels earlier on user action.
            req.setTimeout(120_000, () => {
                req.destroy(new Error('Request timed out after 120s with no response'));
                reject(new Error('Request timed out after 120s with no response'));
            });

            if (init?.signal) {
                init.signal.addEventListener('abort', () => { req.destroy(); reject(new DOMException('Aborted', 'AbortError')); });
            }

            if (init?.body) {
                req.write(typeof init.body === 'string' ? init.body : init.body);
            }
            req.end();
        });
    };
}

const DEFAULT_BASE_URLS: Record<string, string> = {
    openai: 'https://api.openai.com/v1',
    gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
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

        // AUDIT-037 H-1: SSRF guard on config.baseUrl. validateProviderUrl
        // throws when the URL is a public-cloud provider impersonator (e.g.
        // openai pointed at an internal IP) or targets AWS / GCP metadata.
        // For ollama / lmstudio loopback and RFC 1918 ranges are allowed; for
        // "custom" any HTTPS host is allowed and HTTP is allowed only for
        // loopback hosts. Undefined config.baseUrl falls back to the hardcoded
        // DEFAULT_BASE_URLS entry below.
        if (config.baseUrl) validateProviderUrl(config.type, config.baseUrl);

        let baseURL = config.baseUrl ?? DEFAULT_BASE_URLS[config.type] ?? DEFAULT_BASE_URLS.openai;
        // FIX-04-03-15 (Issue #73): the settings UI stores the ollama and
        // lmstudio base URL WITHOUT the version segment and tells the user
        // "no /v1 needed" -- appending it is this layer's job. Model listing
        // and the embedding path already do it; the chat path used to cover
        // ollama only, so every LM Studio request went to /chat/completions,
        // which LM Studio answers with 200 plus a non-SSE body (the SDK then
        // yields zero chunks and the chat stays silent).
        // The /v\d guard keeps two shapes untouched: a URL the user already
        // suffixed, and LM Studio's second API surface /api/v0.
        if ((config.type === 'ollama' || config.type === 'lmstudio') && !baseURL.match(/\/v\d/)) {
            baseURL = baseURL.replace(/\/+$/, '') + '/v1';
        }

        const defaultHeaders: Record<string, string> = {};
        if (config.type === 'openrouter') {
            defaultHeaders['HTTP-Referer'] = 'https://obsidian.md';
            defaultHeaders['X-Title'] = 'Vault Operator';
        }
        if (config.type === 'azure' && config.apiKey) {
            defaultHeaders['api-key'] = config.apiKey;
        }

        this.client = new OpenAI({
            apiKey: config.type === 'azure' ? '' : (config.apiKey || ''),
            baseURL,
            dangerouslyAllowBrowser: true,
            defaultHeaders,
            // Bypass Electron's CORS enforcement for providers whose endpoints
            // do not set the right Access-Control-Allow-Origin headers. Obsidian
            // renderer enforces CORS on window.fetch; Node.js http(s) is not
            // subject to CORS.
            // - 'gemini' (always blocked by Google):
            // - 'custom' (FIX-04-03-03): generic OpenAI-compatible servers like
            //   opencode go on localhost rarely send CORS headers.
            // - 'ollama' / 'lmstudio' on localhost: same class of local server,
            //   safer to bypass CORS than to rely on the server config.
            ...((['gemini', 'custom', 'ollama', 'lmstudio'] as const).includes(config.type as never)
                ? { fetch: createNodeFetch() }
                : {}),
        });
    }

    getModel(): { id: string; info: ModelInfo } {
        // ADR-158 stage 1: discovery-reported window wins; registry chain as fallback
        const contextWindow = this.config.contextWindow ?? getModelContextWindow(this.config.model);

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
        // FIX-04-03-10: apply Qwen inline thinking token before convertMessages
        // bakes the system prompt in. Only fires when the toggle is explicitly
        // set AND the backend is in the local-cluster gate AND the model is a
        // Qwen-family. Undefined stays byte-identical to today.
        const effectiveSystemPrompt = this.maybePrefixQwenThinkingToken(systemPrompt);
        const openAiMessages = convertToOpenAiChatMessages(effectiveSystemPrompt, messages, this.config.type);
        const openAiTools = tools.length > 0 ? convertToOpenAiChatTools(tools) : undefined;

        // ADR-111: the capability table is the single source of truth for what
        // this (provider, model) pair does about caching. Read once per request
        // and used both for the marker decision and the diagnostic line, so the
        // log can never describe a different decision than the one taken.
        const cacheCapability = getCacheCapability(this.config.type, this.config.model);
        // AP3: the passthrough style is the only one this class can produce.
        // Gated on the user switch as well, so a misbehaving gateway can be put
        // back on plain requests without a downgrade (D3 made that switch real).
        const cacheMarkersSent = (this.config.promptCachingEnabled ?? false)
            && cacheCapability.cacheStyle === 'passthrough';
        if (cacheMarkersSent) {
            // The ORIGINAL prompt goes in: convertToOpenAiChatMessages already
            // stripped the sentinel (D1), and the split point can only be read
            // from the unstripped string.
            markOpenAiShapeCacheBreakpoints(openAiMessages, effectiveSystemPrompt);
        }

        // Temperature handling — four cases:
        // 1. o-series (o1, o3, o4-mini, etc.) enforce temperature=1 API-side -> omit entirely
        // 2. FIX-04-03-02: GPT-5.x and other default-only models reject any
        //    explicit temperature with a 400 -> omit entirely (detected via
        //    shared helper modelSupportsTemperature so the same rule covers
        //    OpenRouter aliases and gateway names too).
        // 3. Explicitly configured temperature -> always respect it
        // 4. No explicit config -> use 0.2 default for deterministic agent behavior,
        //    EXCEPT for Azure where deployment names are opaque (may hide o-series models)
        const isOSeries = /^o[1-9]/.test(this.config.model);
        const supportsTemperature = modelSupportsTemperature(this.config.model);
        let temperature: number | undefined;
        if (isOSeries || !supportsTemperature) {
            temperature = undefined;
        } else if (this.config.temperature !== undefined) {
            temperature = this.config.temperature;
        } else if (this.config.type !== 'azure') {
            temperature = 0.2;
        }

        // OpenRouter extended thinking: when enabled for Anthropic models via OpenRouter,
        // force temperature to 1 and pass reasoning parameter. The guard must
        // not override models that reject temperature outright (Opus 4.7+,
        // Fable, Mythos via supportsTemperature) or pin it API-side (o-series),
        // otherwise sending temperature: 1 re-introduces the 400 the
        // supportsTemperature gate above just prevented.
        const openRouterThinking = this.config.type === 'openrouter'
            && (this.config.thinkingEnabled ?? false);
        if (openRouterThinking && supportsTemperature && !isOSeries) {
            temperature = 1;
        }
        // Clamp the output budget to the model's real ceiling and (for thinking)
        // add the reasoning budget on top of the visible-output budget. budgetTokens
        // is only used in the reasoning passthrough below, which is gated on
        // openRouterThinking, so the 0 returned when thinking is off is harmless.
        const { maxTokens: effectiveMaxTokens, thinkingBudgetTokens: budgetTokens } = resolveOutputBudget(
            this.config.model,
            this.config.maxTokens,
            {
                enabled: openRouterThinking,
                budgetTokens: this.config.thinkingBudgetTokens,
                estimatedInputTokens: estimatePromptTokens(systemPrompt, messages, tools),
            },
        );

        // Per-conversation reasoning effort. Only honoured for effort-capable
        // (model, provider) pairs (gpt-5 / o-series on openai/copilot/openrouter,
        // Claude-via-openrouter). 'auto'/undefined sends nothing, so the request
        // stays byte-identical to today. The wire field differs by provider:
        //   - OpenRouter normalizes to reasoning: { effort } (works for both its
        //     Claude and non-Claude reasoning models, and merges with the
        //     existing reasoning.max_tokens passthrough).
        //   - openai / github-copilot use the chat-completions reasoning_effort.
        // Defensive per-family validity: resolveEffortLevels returns the exact
        // native set for this (model, provider) pair (OpenRouter Claude -> low..
        // max, GPT -> minimal..high), so a cross-family level (a Claude-only
        // xhigh/max accidentally set on a GPT model, or a GPT-only minimal on an
        // OpenRouter Claude) is dropped, not sent. IMP-54-05b: the per-model
        // opt-in (custom / OpenAI-compatible endpoints, e.g. GLM-5.2) grants
        // the OpenAI-style set through the same choke point the picker gate
        // uses, so slider visibility and the wire field can never disagree.
        const effort = this.config.reasoningEffort;
        const effortLevels = resolveEffortLevels(this.config.model, this.config.type, this.config.effortOptIn);
        const effortValid = effort !== undefined && effortLevels.includes(effort);
        // FIX-54-10: learned per-model restriction. The gpt-5.6 platform
        // generation 400s when function tools and reasoning_effort are
        // combined on /v1/chat/completions ("... use /v1/responses or set
        // reasoning_effort to 'none'"). When the flag is set AND tools are
        // present, the request must carry the EXPLICIT 'none' the provider
        // names as the escape, REGARDLESS of whether the user chose an
        // effort: omitting the field is not equivalent, because reasoning
        // models apply a non-none default effort server-side and 400 with the
        // identical message on a field-less request (second field report,
        // 2026-07-14). Only the chat-completions reasoning_effort branch
        // consults the flag; OpenRouter's reasoning.effort is a different
        // wire surface with its own semantics.
        const suppressEffortForTools = this.config.type !== 'openrouter'
            && openAiTools !== undefined && openAiTools.length > 0
            && isEffortWithToolsUnsupported(this.config.model);
        if (suppressEffortForTools && !effortSuppressionNotified.has(this.config.model)) {
            effortSuppressionNotified.add(this.config.model);
            console.debug(
                `[OpenAi] ${this.config.model}: reasoning_effort forced to 'none' `
                + `(was ${effortValid ? `'${effort}'` : 'unset, server default'}; `
                + `model rejects effort combined with function tools; learned flag, FIX-54-10)`,
            );
        }
        // OpenRouter reasoning object: merge the existing extended-thinking
        // max_tokens passthrough (if any) with the effort field (if any).
        // The adaptive Claude lineup (Opus 4.7/4.8, Fable, Mythos) removed
        // budget_tokens at the Anthropic layer and 400s if it is sent, so
        // max_tokens is omitted for that family even if the user has thinking
        // pinned on -- the effort field below carries the intent instead, and
        // when no effort is set the model thinks at its own adaptive default.
        const openRouterReasoning: Record<string, unknown> = {};
        const skipReasoningMaxTokens = openRouterThinking
            && /^(anthropic\/)?claude-/i.test(this.config.model)
            && !modelUsesBudgetTokensThinking(this.config.model);
        if (openRouterThinking && !skipReasoningMaxTokens) openRouterReasoning.max_tokens = budgetTokens;
        if (effortValid && this.config.type === 'openrouter') openRouterReasoning.effort = effort;

        // Build request body
        const requestBody: OpenAI.ChatCompletionCreateParamsStreaming = {
            model: this.config.type !== 'azure' ? this.config.model : this.config.model,
            messages: openAiMessages as OpenAI.ChatCompletionMessageParam[],
            tools: openAiTools,
            temperature: temperature !== undefined ? Math.min(temperature, 2.0) : undefined,
            // OpenAI and Azure require max_completion_tokens (max_tokens deprecated / rejected by newer models)
            // Other providers (ollama, lmstudio, custom) still need max_tokens
            max_tokens: (this.config.type !== 'azure' && this.config.type !== 'openai')
                ? effectiveMaxTokens
                : undefined,
            stream: true,
            // FIX-04-03-11: Azure supports include_usage on the pinned
            // api-version (2024-10-21); without the flag Azure streams carry
            // no usage chunk and the cost footer stays empty. Local backends
            // (custom/ollama/lmstudio) stay excluded -- strict OpenAI-compat
            // servers may reject unknown stream_options fields.
            stream_options: (this.config.type === 'openai' || this.config.type === 'openrouter' || this.config.type === 'azure')
                ? { include_usage: true }
                : undefined,
            // OpenRouter reasoning object: extended-thinking max_tokens passthrough
            // and/or the native effort field, whichever is active.
            ...(Object.keys(openRouterReasoning).length > 0
                ? { reasoning: openRouterReasoning } as Record<string, unknown>
                : {}),
            // openai / github-copilot reasoning effort (chat-completions field).
            // FIX-54-10: forced to 'none' when the learned flag says this model
            // rejects effort with function tools; the flag path fires even
            // without a user-chosen effort, because a field-less request gets
            // the server-side default effort and 400s identically ('none' is
            // not in the SDK's ReasoningEffort union yet, hence the cast).
            ...(suppressEffortForTools || (effortValid && this.config.type !== 'openrouter')
                ? { reasoning_effort: suppressEffortForTools ? 'none' : effort } as Record<string, unknown>
                : {}),
            // OpenRouter: disable automatic model fallback to prevent silent model switches.
            // Without this, OpenRouter can route to a completely different model (e.g. Gemini)
            // when the configured model is rate-limited or under high load.
            ...(this.config.type === 'openrouter'
                ? { provider: { allow_fallbacks: false } } as Record<string, unknown>
                : {}),
            // FIX-04-03-10: per-conversation Thinking toggle for custom/ollama/
            // lmstudio. vLLM and MLX-LM forward this to the model's chat template
            // (Qwen3 enable_thinking, etc.). Other backends ignore unknown fields.
            // Only emitted when the toggle is explicitly set; undefined keeps the
            // request byte-identical to today.
            ...(this.chatTemplateKwargsForThinking()),
        };

        // OpenAI and Azure use max_completion_tokens (newer models reject max_tokens with 400)
        if (this.config.type === 'openai' || this.config.type === 'azure') {
            (requestBody as unknown as Record<string, unknown>).max_completion_tokens = effectiveMaxTokens;
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
        // FIX-18-04-03: track the most recent finish_reason so the post-loop
        // tool_call flush can distinguish a "length"-cutoff from a "stop"
        // and emit the right recovery message.
        let lastFinishReason: string | null | undefined = null;

        for await (const chunk of stream) {
            // Usage (sent at end with stream_options)
            if (chunk.usage) {
                // AP3: one shared reader for cached_tokens AND cache_write_tokens.
                // The write count was never read on this wire, so a cache fill was
                // billed as ordinary input at 1x instead of 1.25x.
                const cacheUsage = readOpenAiShapeCacheUsage(chunk.usage, this.config.type);
                logCacheStat({
                    // D2: this class serves seven provider types. A hardcoded
                    // 'openai' made an OpenRouter run log as [CacheStat:openai],
                    // so no measurement was attributable to the provider that
                    // produced it -- and the cost investigation runs on these
                    // lines. config.type is the value src/api/index.ts stamps as
                    // handler.providerType, available here since construction.
                    provider: this.config.type,
                    model: this.config.model,
                    // D2: 'auto' was asserted for everyone. It is wrong twice:
                    // local inference does not cache at all, and OpenRouter with
                    // an Anthropic model upstream caches only when we send
                    // markers. Follow the capability table instead of guessing.
                    // AP3: 'on' once we actually send markers, so the log states the
                    // decision this request took rather than a property of the model.
                    caching: cacheMarkersSent
                        ? 'on'
                        : (cacheCapability.supportsPromptCache ? 'auto' : 'OFF'),
                    nonCachedInputTokens: cacheUsage.inputTokens,
                    cacheReadTokens: cacheUsage.cacheReadTokens,
                    cacheCreationTokens: cacheUsage.cacheCreationTokens,
                    outputTokens: cacheUsage.outputTokens,
                });
                yield {
                    type: 'usage',
                    // IMP-18-01-02: prompt_tokens is the TOTAL (cached + non-cached).
                    // Report the non-cached part as inputTokens and the cached part
                    // separately, matching the Anthropic convention, so the cost calc
                    // bills the cached prefix at the cache-read rate instead of full price.
                    inputTokens: cacheUsage.inputTokens,
                    outputTokens: cacheUsage.outputTokens,
                    cacheReadTokens: cacheUsage.cacheReadTokens > 0 ? cacheUsage.cacheReadTokens : undefined,
                    // AP3: an absent count stays absent. index.ts treats undefined as
                    // "this provider does not report caching", which is a different
                    // statement from "zero cache writes".
                    cacheCreationTokens: cacheUsage.cacheCreationTokens > 0
                        ? cacheUsage.cacheCreationTokens
                        : undefined,
                } satisfies ApiStreamChunk;
            }

            const choice = chunk.choices?.[0];
            if (!choice) continue;

            const delta = choice.delta;

            // OpenRouter reasoning content (extended thinking passthrough) +
            // DeepSeek deepseek-reasoner. requiresPassback tells AgentTask to
            // persist these chunks into a ThinkingBlock on the assistant
            // message so convertMessages can echo them back on the next request
            // (FIX-04-03-07). The wire-side allow-list still gates whether the
            // echo actually happens.
            const reasoning = (delta as Record<string, unknown>)?.reasoning_content
                ?? (delta as Record<string, unknown>)?.reasoning;
            if (typeof reasoning === 'string' && reasoning) {
                yield { type: 'thinking', text: reasoning, requiresPassback: true } satisfies ApiStreamChunk;
            }

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

            // Track the most recent finish_reason so the post-loop fallback
            // flush (FIX-18-04-03) can decide whether a JSON-parse failure
            // came from a max-tokens cutoff vs a normal "stop".
            if (choice.finish_reason) {
                lastFinishReason = choice.finish_reason;
            }

            // When the turn ends with tool_calls, yield complete tool_use chunks.
            // wasMaxTokens=false here -- a finish_reason of tool_calls means
            // the arguments were intended to be complete.
            if (choice.finish_reason === 'tool_calls') {
                yield* flushToolCallAccumulators(toolCallAccumulators, {
                    wasMaxTokens: false,
                    providerLabel: 'OpenAi',
                });
            }
        }

        // BUG-013 / FEATURE-0409: Some OpenAI-compatible providers (OpenRouter
        // gpt-oss-120b, Groq, certain local backends) stream tool_calls deltas
        // but emit finish_reason="stop" or "length" instead of "tool_calls".
        // Without this post-loop flush the accumulated tool calls are silently
        // dropped and the agent treats the response as text only.
        // If finish_reason==="tool_calls" already flushed the map, this is a no-op.
        // FIX-18-04-03: wasMaxTokens flag wired so a JSON parse failure on a
        // length-truncated payload surfaces as the "split write_file + append_to_file"
        // hint instead of the generic recovery message.
        if (toolCallAccumulators.size > 0) {
            yield* flushToolCallAccumulators(toolCallAccumulators, {
                wasMaxTokens: lastFinishReason === 'length',
                providerLabel: 'OpenAi',
            });
        }
    }

    // ---------------------------------------------------------------------------
    // FIX-04-03-10: Thinking toggle helpers (OpenAI-compat local backends)
    // ---------------------------------------------------------------------------

    private chatTemplateKwargsForThinking(): Record<string, unknown> {
        if (typeof this.config.thinkingEnabled !== 'boolean') return {};
        if (!THINKING_TOGGLE_PROVIDER_TYPES.has(this.config.type)) return {};
        return { chat_template_kwargs: { enable_thinking: this.config.thinkingEnabled } };
    }

    private maybePrefixQwenThinkingToken(systemPrompt: string): string {
        if (typeof this.config.thinkingEnabled !== 'boolean') return systemPrompt;
        if (!THINKING_TOGGLE_PROVIDER_TYPES.has(this.config.type)) return systemPrompt;
        if (!QWEN_THINKING_MODEL_REGEX.test(this.config.model)) return systemPrompt;
        const token = this.config.thinkingEnabled ? '/think ' : '/no_think ';
        return `${token}${systemPrompt}`;
    }

    // ---------------------------------------------------------------------------
    // Format conversion: Anthropic → OpenAI
    // ---------------------------------------------------------------------------

    /**
     * Quick non-streaming classification call (~100 input, ~10 output tokens).
     * Used by skill matching LLM-fallback when regex finds no match.
     */
    async classifyText(prompt: string, abortSignal?: AbortSignal): Promise<string> {
        const classifyBody: OpenAI.ChatCompletionCreateParamsNonStreaming = {
            model: this.config.model,
            max_tokens: (this.config.type !== 'openai' && this.config.type !== 'azure') ? 50 : undefined,
            messages: [{ role: 'user', content: prompt }],
        };
        if (this.config.type === 'openai' || this.config.type === 'azure') {
            (classifyBody as unknown as Record<string, unknown>).max_completion_tokens = 50;
        }
        const response = await this.client.chat.completions.create(classifyBody, {
            signal: abortSignal ?? undefined,
        });

        return response.choices?.[0]?.message?.content?.trim() ?? '';
    }
}

