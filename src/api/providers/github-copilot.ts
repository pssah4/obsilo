/**
 * GitHubCopilotProvider - LLM provider for GitHub Copilot API
 *
 * Uses the OpenAI SDK with a custom fetch wrapper that injects Copilot
 * authentication headers. Content normalization handles Claude-via-Copilot
 * streaming quirks (array delta.content, missing delta.role).
 *
 * @see ADR-036 (Streaming Strategy — OpenAI SDK + custom fetch)
 * @see ADR-037 (Provider Architecture — separate provider + auth service)
 * @see ADR-039 (Content Normalization)
 * @see FEATURE-1202 (Chat Completions Provider)
 */

import OpenAI from 'openai';
import { createNodeFetch } from './openai';
import type { LLMProvider } from '../../types/settings';
import type { ApiHandler, ApiStream, ApiStreamChunk, MessageParam, ModelInfo } from '../types';
import type { ToolDefinition } from '../../core/tools/types';
import {
    GitHubCopilotAuthService,
    CHAT_COMPLETIONS_ENDPOINT,
    RESPONSES_ENDPOINT,
} from '../../core/security/GitHubCopilotAuthService';
import { resolveOutputBudget, estimatePromptTokens, modelUsesBudgetTokensThinking, modelSupportsTemperature, getModelInfo, getModelEffortSupport } from '../../types/model-registry';
import { logCacheStat } from '../logCacheStat';
import { normalizeDeltaContent } from './utils/openAiContent';
import { flushToolCallAccumulators, type ToolCallAccumulator } from './utils/toolCallFlush';
import { convertToOpenAiChatMessages, convertToOpenAiChatTools } from '../adapters/openaiChat';
import { markCopilotChatCacheBreakpoints } from '../adapters/openaiShapeCacheMarkers';
import {
    markCopilotResponsesCacheBreakpoints,
    type CopilotResponsesBodyParts,
} from '../adapters/copilotResponsesCacheMarkers';
import { readOpenAiShapeCacheUsage } from '../adapters/openaiShapeCacheUsage';
import { getCacheCapability } from '../capabilities';
import { stripCacheBreakpointMarker } from '../../core/systemPrompt';
import {
    convertToResponsesInput,
    convertToResponsesTools,
    createResponsesStreamState,
    flushResponsesStreamState,
    asGptEffort,
    resolveGptEffort,
    responsesEventToChunks,
    type ReasoningEffort,
} from '../adapters/openaiResponses';

// ---------------------------------------------------------------------------
// OpenAI REST API types (subset — mirrors openai.ts)
// ---------------------------------------------------------------------------

// IMP-41-03-03 / ADR-150: message/tool types + conversion live in the
// shared openai-chat wire adapter (one implementation, three consumers).

// ToolCallAccumulator moved to utils/toolCallFlush.ts (FIX-13-02-01); see import above.

// ---------------------------------------------------------------------------
// Known models — fallback when model is not in the global registry.
// Kept in the provider to avoid ID collisions with direct OpenAI/Anthropic models.
// ---------------------------------------------------------------------------

const KNOWN_MODELS: Record<string, ModelInfo> = {
    'claude-sonnet-4': { contextWindow: 200_000, supportsTools: true, supportsStreaming: true },
    'claude-sonnet-4-5-20250929': { contextWindow: 200_000, supportsTools: true, supportsStreaming: true },
    'claude-3.5-sonnet': { contextWindow: 200_000, supportsTools: true, supportsStreaming: true },
    'gpt-5.4': { contextWindow: 200_000, supportsTools: true, supportsStreaming: true },
    'gpt-4o': { contextWindow: 128_000, supportsTools: true, supportsStreaming: true },
    'gpt-4o-mini': { contextWindow: 128_000, supportsTools: true, supportsStreaming: true },
    'gpt-4.1': { contextWindow: 128_000, supportsTools: true, supportsStreaming: true },
    'o3-mini': { contextWindow: 200_000, supportsTools: true, supportsStreaming: true },
    'o4-mini': { contextWindow: 200_000, supportsTools: true, supportsStreaming: true },
    'gemini-2.0-flash': { contextWindow: 1_048_576, supportsTools: true, supportsStreaming: true },
};

const DEFAULT_MODEL_INFO: ModelInfo = {
    contextWindow: 128_000,
    supportsTools: true,
    supportsStreaming: true,
};

/**
 * FIX-45-03-01: the wording GitHub uses when a model is not served on a given
 * route, e.g. `model "gpt-5.6-sol" is not accessible via the /chat/completions
 * endpoint`. Deliberately loose on the verb -- "accessible", "available" and
 * "supported" have all been observed -- but anchored on the endpoint path, so
 * an unrelated 400 cannot trip the retry.
 */
const ROUTE_REJECTED_RE: Record<string, RegExp> = {
    [CHAT_COMPLETIONS_ENDPOINT]:
        /\/chat\/completions\s+endpoint|not\s+(?:accessible|available|supported)[^.]*\/chat\/completions/i,
    [RESPONSES_ENDPOINT]:
        /\/responses\s+endpoint|not\s+(?:accessible|available|supported)[^.]*\/responses/i,
};

/**
 * Effort default for the Copilot reasoning lineup. Higher than the Codex
 * backend's 'low' floor on purpose: the GPT-5.6 models are picked for agentic
 * work, where reasoning depth is the reason to use them. An explicit setting
 * still wins in both directions (see resolveGptEffort).
 */
const COPILOT_DEFAULT_EFFORT: ReasoningEffort = 'high';

/**
 * True when a rejection is GitHub saying "this model is not on that route".
 * Reads the SDK error's message, which carries the server's own wording.
 */
function isRouteRejected(
    e: unknown,
    route: typeof CHAT_COMPLETIONS_ENDPOINT | typeof RESPONSES_ENDPOINT,
): boolean {
    if (!(e instanceof OpenAI.APIError) || e.status !== 400) return false;
    // eslint-disable-next-line security/detect-object-injection -- key is one of two module constants, not user input
    return ROUTE_REJECTED_RE[route].test(e.message ?? '');
}

// ---------------------------------------------------------------------------
// Content normalization (ADR-039)
// ---------------------------------------------------------------------------

/**
 * Normalize streaming delta.content for Copilot API responses.
 *
 * Re-exported from the shared helper since FIX-13-02-02 -- kilo-gateway
 * needed the same normalisation, and one shared helper is easier to
 * keep in lockstep than two parallel one-offs.
 */
// (helper now lives in utils/openAiContent.ts -- imported above)

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class GitHubCopilotProvider implements ApiHandler {
    private config: LLMProvider;
    private client: OpenAI;
    private authService: GitHubCopilotAuthService;

    constructor(config: LLMProvider) {
        this.config = config;
        this.authService = GitHubCopilotAuthService.getInstance();

        this.client = new OpenAI({
            apiKey: 'copilot', // Placeholder — real auth injected via custom fetch
            baseURL: 'https://api.githubcopilot.com',
            dangerouslyAllowBrowser: true,
            // Side finding (2026-08-14): route through the Node transport
            // instead of the renderer's fetch, so Copilot does not depend on
            // api.githubcopilot.com continuing to send CORS headers. Same
            // path gemini/custom/ollama/lmstudio use (ADR-064).
            fetch: this.authService.getCopilotFetch(createNodeFetch()),
        });
    }

    getModel(): { id: string; info: ModelInfo } {
        // Registry first for the context window so Claude ids resolve correctly
        // (incl. the 1M family-floor inference for Opus 4.7+/Sonnet 5+); the
        // local KNOWN_MODELS table stays as the override for ids the registry
        // does not carry (GPT/o-series/Gemini via Copilot) and supplies the
        // tools/streaming flags. Prevents Claude models from silently dropping
        // to the 128k default and condensing too early.
        const known = KNOWN_MODELS[this.config.model] ?? DEFAULT_MODEL_INFO;
        // ADR-158 stage 1: discovery-reported window wins over registry and table.
        // FIX-45-03-01 adds the Copilot model list between the two: a model picked
        // by hand (a tier override) never passes through discovery, so without
        // this it would run on the 128k default while actually serving 1M. A
        // configured value still wins -- a manual entry is an override, not a
        // suggestion.
        const contextWindow = this.config.contextWindow
            ?? this.authService.getModelLimits(this.config.model)?.contextWindow
            ?? getModelInfo(this.config.model)?.contextWindow ?? known.contextWindow;
        return { id: this.config.model, info: { ...known, contextWindow } };
    }

    async *createMessage(
        systemPrompt: string,
        messages: MessageParam[],
        tools: ToolDefinition[],
        abortSignal?: AbortSignal,
    ): ApiStream {
        // FIX-45-03-01: route decision before anything is built. Only models whose
        // own metadata says they do NOT answer on /chat/completions go the other
        // way, so every model that works today keeps its exact request.
        if (this.usesResponsesApi()) {
            yield* this.createMessageViaResponses(systemPrompt, messages, tools, abortSignal);
            return;
        }
        yield* this.createMessageViaChatCompletions(systemPrompt, messages, tools, abortSignal);
    }

    /**
     * Stream one turn over /chat/completions. Unchanged from before FIX-45-03-01
     * apart from the route-rejection branch; every model that worked yesterday
     * still builds and sends exactly this request.
     *
     * `allowResponsesFallback` mirrors the guard in createMessageViaResponses:
     * false when we came from there, so a model both routes reject surfaces the
     * error instead of bouncing.
     */
    private async *createMessageViaChatCompletions(
        systemPrompt: string,
        messages: MessageParam[],
        tools: ToolDefinition[],
        abortSignal?: AbortSignal,
        allowResponsesFallback = true,
    ): ApiStream {
        const openAiMessages = convertToOpenAiChatMessages(systemPrompt, messages, 'github-copilot');
        const openAiTools = tools.length > 0 ? convertToOpenAiChatTools(tools) : undefined;

        // IMP-18-01-04: Copilot's own marker form on this route. Gated on the
        // capability table AND the user switch, so a `false` restores the exact
        // pre-marker request (D3 made that switch reach this path).
        if (this.cacheMarkersSent()) {
            markCopilotChatCacheBreakpoints(openAiMessages, systemPrompt);
        }

        // Extended thinking for Claude models via Copilot
        const isClaude = /^claude/i.test(this.config.model);
        const thinkingEnabled = isClaude && (this.config.thinkingEnabled ?? false);
        // Adaptive lineup (Opus 4.7/4.8, Fable, Mythos) removed budget_tokens
        // and 400s if it is sent -- it only accepts thinking: { type: 'adaptive' }.
        // Older Claude (Opus 4.6, Sonnet 4.6 and earlier, 3.x) still takes the
        // legacy { type: 'enabled', budget_tokens } shape.
        const claudeUsesBudgetTokens = isClaude
            && modelUsesBudgetTokensThinking(this.config.model);
        const { maxTokens: effectiveMaxTokens, thinkingBudgetTokens: budgetTokens } = resolveOutputBudget(
            this.config.model,
            this.config.maxTokens,
            {
                enabled: thinkingEnabled,
                budgetTokens: this.config.thinkingBudgetTokens,
                estimatedInputTokens: estimatePromptTokens(systemPrompt, messages, tools),
            },
        );

        // Temperature: o-series omit, thinking forces 1, otherwise respect config or use 0.2 default.
        // ADR-148 side fix: gate through modelSupportsTemperature — Copilot was
        // the one provider without the FIX-04-03-12 gate, so Claude 5 / Opus
        // 4.7+ routed via Copilot got temperature 0.2 and a 400.
        const isOSeries = /^o[1-9]/.test(this.config.model);
        let temperature: number | undefined;
        if (isOSeries || !modelSupportsTemperature(this.config.model)) {
            temperature = undefined;
        } else if (thinkingEnabled) {
            temperature = 1;
        } else if (this.config.temperature !== undefined) {
            temperature = this.config.temperature;
        } else {
            temperature = 0.2;
        }

        // BUG-015 / FEATURE-1206: GitHub Copilot routes through models that
        // require max_completion_tokens instead of max_tokens (gpt-5,
        // gpt-5-codex, o3, o4-mini). The Copilot Gateway accepts
        // max_completion_tokens uniformly across the catalog, so we send only
        // the new parameter for all models.
        const requestBody: Record<string, unknown> = {
            model: this.config.model,
            messages: openAiMessages,
            tools: openAiTools,
            temperature: temperature !== undefined ? Math.min(temperature, 2.0) : undefined,
            max_completion_tokens: effectiveMaxTokens,
            stream: true,
            stream_options: { include_usage: true },
            // Extended thinking: passed as top-level body param for Claude-via-Copilot.
            // The adaptive lineup (Opus 4.7+, Fable, Mythos) rejects budget_tokens
            // with a 400; it only accepts { type: 'adaptive' }. The older
            // budget-tokens lineup (Sonnet 4.6, Opus 4.6 and earlier, 3.x) keeps
            // the legacy { type: 'enabled', budget_tokens } shape.
            ...(thinkingEnabled
                ? {
                    thinking: claudeUsesBudgetTokens
                        ? { type: 'enabled', budget_tokens: budgetTokens }
                        : { type: 'adaptive' },
                }
                : {}),
        };

        if (openAiTools && openAiTools.length > 0) {
            requestBody.tool_choice = 'auto';
        }

        // Cast to SDK type — extra fields (like `thinking`) are passed through by the API
        const createParams = requestBody as unknown as OpenAI.ChatCompletionCreateParamsStreaming;

        let stream: AsyncIterable<OpenAI.ChatCompletionChunk>;
        try {
            stream = await this.client.chat.completions.create(createParams, {
                signal: abortSignal ?? null,
            });
        } catch (e) {
            // 401 retry: invalidate token, refresh, retry once
            if (this.is401Error(e)) {
                this.authService.invalidateCopilotToken();
                stream = await this.client.chat.completions.create(createParams, {
                    signal: abortSignal ?? null,
                });
            } else if (allowResponsesFallback && isRouteRejected(e, CHAT_COMPLETIONS_ENDPOINT)) {
                // FIX-45-03-01: the model was configured before VO knew about
                // routes, or GitHub moved it. The server just told us plainly.
                // Remember it and answer on the other route -- nothing has
                // streamed yet, the create() call is what threw.
                this.authService.noteResponsesOnly(this.config.model);
                yield* this.createMessageViaResponses(systemPrompt, messages, tools, abortSignal, false);
                return;
            } else {
                throw this.enhanceError(e);
            }
        }

        // Accumulate tool calls across chunks (keyed by index)
        const toolCallAccumulators = new Map<number, ToolCallAccumulator>();
        // FIX-18-04-03: see openai.ts comment.
        let lastFinishReason: string | null | undefined = null;

        for await (const chunk of stream) {
            // Usage (sent at end with stream_options)
            if (chunk.usage) {
                // AP3: shared reader instead of a third copy of the same
                // extraction (ADR-150 anti-drift). 'auto' stays correct here:
                // Copilot caches server-side without markers from us, measured at
                // a 51-58% hit rate on the gpt-5.6 lineup in 2026-08 telemetry.
                const cacheUsage = readOpenAiShapeCacheUsage(chunk.usage, 'github-copilot');
                logCacheStat({
                    provider: 'github-copilot',
                    model: this.config.model,
                    caching: 'auto',
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

            // Text content — with normalization (ADR-039)
            const text = normalizeDeltaContent((delta as Record<string, unknown>)?.content);
            if (text) {
                yield { type: 'text', text } satisfies ApiStreamChunk;
            }

            // Tool call deltas — accumulate until finish_reason = 'tool_calls'
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

            // When the turn ends with tool_calls, yield complete tool_use chunks.
            if (choice.finish_reason === 'tool_calls') {
                yield* flushToolCallAccumulators(toolCallAccumulators, {
                    wasMaxTokens: false,
                    providerLabel: 'Copilot',
                });
            }
        }

        // BUG-013 / FEATURE-0409: Some Copilot-routed models emit
        // finish_reason="stop" or "length" while still streaming tool_calls
        // deltas. Without this post-loop flush the accumulated tool calls are
        // silently dropped. If the in-loop branch already cleared the map, this
        // is a no-op. FIX-18-04-03 wires the wasMaxTokens flag.
        if (toolCallAccumulators.size > 0) {
            yield* flushToolCallAccumulators(toolCallAccumulators, {
                wasMaxTokens: lastFinishReason === 'length',
                providerLabel: 'Copilot',
            });
        }
    }

    // ---------------------------------------------------------------------------
    // Responses route (FIX-45-03-01)
    // ---------------------------------------------------------------------------

    /**
     * Whether this request carries Copilot's cache markers.
     *
     * One decision for both routes: the capability style says "Copilot's own
     * marker forms", each route then writes its own field. Reading it in one
     * place keeps the two routes from disagreeing about whether caching is on.
     */
    private cacheMarkersSent(): boolean {
        if (!(this.config.promptCachingEnabled ?? false)) return false;
        return getCacheCapability('github-copilot', this.config.model).cacheStyle
            === 'copilot-cache-control';
    }

    /**
     * Whether this model has to go through /responses.
     *
     * Deliberately narrower than the Copilot Chat extension, which prefers
     * /responses as soon as a model offers it. We only switch when the chat
     * route is absent, so models that work today are not moved onto a different
     * wire format for no reason.
     *
     * An unknown model (no metadata, e.g. configured before this fix or entered
     * by hand) reads as "not responses-only" and keeps the old path; the 400 in
     * createMessage corrects it and pins the route for next time.
     */
    private usesResponsesApi(): boolean {
        const endpoints = this.authService.getModelEndpoints(this.config.model);
        if (!endpoints || endpoints.length === 0) return false;
        return !endpoints.includes(CHAT_COMPLETIONS_ENDPOINT)
            && endpoints.includes(RESPONSES_ENDPOINT);
    }

    /**
     * Build the Responses request body for one turn.
     *
     * Same client, same headers, same auth as the chat route -- only the shape
     * and the path differ. Kept close to what the Copilot Chat extension sends:
     * model, instructions, input, stream, tools, max_output_tokens. The Codex
     * quirks that prepareResponsesRequest adds for chatgpt.com (`store: false`,
     * `include: ['reasoning.encrypted_content']`) are deliberately absent --
     * Copilot's own client does not send them.
     */
    private buildResponsesBody(
        systemPrompt: string,
        messages: MessageParam[],
        tools: ToolDefinition[],
    ): Record<string, unknown> {
        const { maxTokens: effectiveMaxTokens } = resolveOutputBudget(
            this.config.model,
            this.config.maxTokens,
            { estimatedInputTokens: estimatePromptTokens(systemPrompt, messages, tools) },
        );

        const body: Record<string, unknown> = {
            model: this.config.model,
            // D1: this route builds its own body and never passed through
            // prepareResponsesRequest, so the strip added there (openaiResponses.ts)
            // missed it. The gpt-5.6 lineup routes here, which is most of the
            // logged Copilot traffic, and it kept sending the sentinel.
            instructions: stripCacheBreakpointMarker(systemPrompt),
            input: convertToResponsesInput(messages),
            stream: true,
            max_output_tokens: effectiveMaxTokens,
        };

        if (tools.length > 0) {
            body.tools = convertToResponsesTools(tools);
            body.tool_choice = 'auto';
        }

        // Only models with a native effort surface get the field; sending it to
        // one without (Claude via Copilot) is a 400.
        if (getModelEffortSupport(this.config.model, 'github-copilot')) {
            const effort = this.resolveEffort();
            if (effort) body.reasoning = { effort };
        }

        if (this.config.temperature !== undefined && modelSupportsTemperature(this.config.model)) {
            body.temperature = Math.min(this.config.temperature, 2.0);
        }

        // IMP-18-01-04: Copilot's Responses marker form. Restructures the system
        // prompt out of `instructions` and into input[0] so the marker has a
        // content part to sit on, and keeps the volatile tail behind it. Gated,
        // so promptCachingEnabled=false leaves this body byte-identical to the
        // pre-marker one -- the safety valve for the riskiest change here.
        if (this.cacheMarkersSent()) {
            markCopilotResponsesCacheBreakpoints(
                body as unknown as CopilotResponsesBodyParts,
                systemPrompt,
            );
        }

        return body;
    }

    /**
     * The effort level to send, or undefined for "send no field".
     *
     * Precedence, highest first:
     *  1. an explicit level the user picked in the chat header -- in both
     *     directions, so choosing 'minimal' really lowers it;
     *  2. thinking switched explicitly off -- send nothing, the model keeps its
     *     vendor default, which is the contract every other provider follows.
     *     A high default that overrules an explicit Off would be a bug, not a
     *     convenience;
     *  3. the Copilot default of 'high' (user request 2026-08-22): the GPT-5.6
     *     lineup is picked for agentic work, where reasoning depth is the point.
     */
    private resolveEffort(): ReasoningEffort | undefined {
        const explicit = asGptEffort(this.config.reasoningEffort);
        if (explicit) return explicit;
        if (this.config.thinkingEnabled === false) return undefined;
        return COPILOT_DEFAULT_EFFORT;
    }

    /**
     * Stream one turn over /responses.
     *
     * `allowChatFallback` guards the one hop back to the chat route. A
     * remembered route is a cache of something GitHub controls -- it moved the
     * GPT-5.6 lineup off /chat/completions once, so it can move a model back,
     * and a user on a stale table would otherwise sit on a dead model until
     * they happened to press Fetch. The flag is false when we arrived here
     * FROM the chat route, so the two paths can never ping-pong.
     */
    private async *createMessageViaResponses(
        systemPrompt: string,
        messages: MessageParam[],
        tools: ToolDefinition[],
        abortSignal?: AbortSignal,
        allowChatFallback = true,
    ): ApiStream {
        const body = this.buildResponsesBody(systemPrompt, messages, tools);

        let stream: AsyncIterable<unknown>;
        try {
            stream = await this.createResponsesStream(body, abortSignal);
        } catch (e) {
            if (this.is401Error(e)) {
                this.authService.invalidateCopilotToken();
                stream = await this.createResponsesStream(body, abortSignal);
            } else if (allowChatFallback && isRouteRejected(e, RESPONSES_ENDPOINT)) {
                this.authService.noteChatCompletions(this.config.model);
                yield* this.createMessageViaChatCompletions(systemPrompt, messages, tools, abortSignal, false);
                return;
            } else {
                throw this.enhanceError(e);
            }
        }

        const state = createResponsesStreamState();
        for await (const event of stream) {
            yield* responsesEventToChunks(event as Record<string, unknown>, state);
        }
        // Providers that end without a response.completed would otherwise drop
        // accumulated tool calls (the Responses twin of BUG-013).
        yield* flushResponsesStreamState(state);
    }

    /**
     * The SDK's responses surface posts to `${baseURL}/responses`, which is the
     * route the Copilot Chat extension calls (capiResponsesURL). Cast because
     * the body carries fields outside the SDK's parameter type; the API passes
     * them through.
     */
    private createResponsesStream(
        body: Record<string, unknown>,
        abortSignal?: AbortSignal,
    ): Promise<AsyncIterable<unknown>> {
        return this.client.responses.create(
            body as unknown as Parameters<typeof this.client.responses.create>[0],
            { signal: abortSignal ?? null },
        ) as unknown as Promise<AsyncIterable<unknown>>;
    }

    /**
     * Quick non-streaming classification call.
     * Used by skill matching LLM-fallback.
     */
    async classifyText(prompt: string, abortSignal?: AbortSignal): Promise<string> {
        // FIX-45-03-01: same route decision as createMessage -- a responses-only
        // model would 400 here too, and skill matching would silently lose its
        // LLM fallback.
        if (this.usesResponsesApi()) {
            return this.classifyViaResponses(prompt, abortSignal);
        }
        // BUG-015 / FEATURE-1206: see createMessage() for the rationale.
        const response = await this.client.chat.completions.create({
            model: this.config.model,
            max_completion_tokens: 50,
            messages: [{ role: 'user', content: prompt }],
        }, {
            signal: abortSignal ?? undefined,
        });

        return response.choices?.[0]?.message?.content?.trim() ?? '';
    }

    /** classifyText over /responses. Short call, so effort stays at the floor. */
    private async classifyViaResponses(prompt: string, abortSignal?: AbortSignal): Promise<string> {
        const body: Record<string, unknown> = {
            model: this.config.model,
            input: [{
                type: 'message',
                role: 'user',
                content: [{ type: 'input_text', text: prompt }],
            }],
            stream: true,
            max_output_tokens: 50,
        };
        if (getModelEffortSupport(this.config.model, 'github-copilot')) {
            // A one-line classification does not benefit from deep reasoning,
            // and the tokens are billed either way.
            body.reasoning = { effort: resolveGptEffort(this.config.reasoningEffort, 'low') };
        }

        const stream = await this.createResponsesStream(body, abortSignal);
        const state = createResponsesStreamState();
        const buffer: string[] = [];
        for await (const event of stream) {
            for (const chunk of responsesEventToChunks(event as Record<string, unknown>, state)) {
                if (chunk.type === 'text') buffer.push(chunk.text);
            }
        }
        return buffer.join('').trim();
    }

    // ---------------------------------------------------------------------------
    // Format conversion: Anthropic → OpenAI (mirrors OpenAiProvider)
    // ---------------------------------------------------------------------------

    // ---------------------------------------------------------------------------
    // Error handling
    // ---------------------------------------------------------------------------

    private is401Error(e: unknown): boolean {
        if (e instanceof OpenAI.APIError) {
            return e.status === 401;
        }
        return false;
    }

    /**
     * Enhance Copilot API errors with actionable messages.
     */
    private enhanceError(e: unknown): Error {
        if (!(e instanceof OpenAI.APIError)) {
            return e instanceof Error ? e : new Error(String(e));
        }
        switch (e.status) {
            case 401:
                return new Error('Copilot authentication failed. Please sign in again.');
            case 403:
                return new Error('No active GitHub Copilot subscription, or model not enabled. Check your Copilot settings at github.com.');
            case 429:
                return new Error('Copilot rate limit exceeded. Please wait a moment and try again.');
            case 400:
                // FIX-45-03-01: the old blanket "may require policy acceptance"
                // was appended to every 400 regardless of cause, and pointed at
                // the wrong setting entirely when the real problem was the
                // route. Say what the server said, and only name the route when
                // that is what actually went wrong.
                return isRouteRejected(e, CHAT_COMPLETIONS_ENDPOINT)
                    ? new Error(
                        `Copilot does not serve "${this.config.model}" on the chat route. `
                        + 'Open Provider settings, refresh the Copilot model list, and try again.',
                    )
                    : new Error(`Copilot request error: ${e.message}`);
            default:
                return new Error(`Copilot API error (${e.status}): ${e.message}`);
        }
    }
}

