/**
 * API Handler Factory
 *
 * Adapted from Kilo Code's src/api/index.ts (buildApiHandler)
 */

import type { LLMProvider, CustomModel } from '../types/settings';
import { modelToLLMProvider } from '../types/settings';
import { AnthropicProvider } from './providers/anthropic';
import { OpenAiProvider } from './providers/openai';
import { GitHubCopilotProvider } from './providers/github-copilot';
import { KiloGatewayProvider } from './providers/kilo-gateway';
import { BedrockProvider } from './providers/bedrock';
import { ChatGptOAuthProvider } from './providers/chatgpt-oauth';
import type { ApiHandler, ApiStream, ApiStreamChunk, MessageParam } from './types';
import type { ToolDefinition } from '../core/tools/types';
import { RequestRateLimiter, requestRateLimiter } from './RequestRateLimiter';
import { ProviderHealth, providerHealth } from './ProviderHealth';
import { classifyProviderError } from './retry';
import { logAuthErrorDiagnostics } from './authDiagnostics';

export type { ApiHandler, ApiStream, ApiStreamChunk, MessageParam, ContentBlock, ModelInfo } from './types';

/** Local inference has no provider-side rate limits — never wrapped. */
const UNLIMITED_PROVIDER_TYPES = new Set(['ollama', 'lmstudio']);

/**
 * IMP-41-02-03 / ADR-146: decorate createMessage with the token bucket so
 * EVERY call site (main loop, condensing helper, subtasks, FastPath
 * planners) passes through. The provider classes themselves stay
 * resilience-free.
 */
export function withRateLimit(
    handler: ApiHandler,
    providerType: string,
    limiter: RequestRateLimiter = requestRateLimiter,
): ApiHandler {
    const wrapped: ApiHandler = Object.create(handler) as ApiHandler;
    wrapped.createMessage = function (
        systemPrompt: string,
        messages: MessageParam[],
        tools: ToolDefinition[],
        abortSignal?: AbortSignal,
    ): ApiStream {
        return (async function* () {
            await limiter.acquire(providerType, handler.getModel().id, abortSignal);
            yield* handler.createMessage(systemPrompt, messages, tools, abortSignal);
        })();
    };
    return wrapped;
}

/**
 * IMP-41-03-02 / ADR-146: circuit-breaker decorator. Fails fast while the
 * provider's breaker is open (microseconds instead of a retry cascade
 * against a dead provider) and feeds outcomes back into the health record.
 * Abort/auth outcomes never open the breaker (classified upstream).
 */
export function withCircuitBreaker(
    handler: ApiHandler,
    providerType: string,
    health: ProviderHealth = providerHealth,
): ApiHandler {
    const wrapped: ApiHandler = Object.create(handler) as ApiHandler;
    wrapped.createMessage = function (
        systemPrompt: string,
        messages: MessageParam[],
        tools: ToolDefinition[],
        abortSignal?: AbortSignal,
    ): ApiStream {
        return (async function* () {
            // FEAT-55-04 (ADR-172): key the breaker by provider::model (same
            // scheme as RequestRateLimiter.key) instead of providerType alone.
            // Under parallel chats a struggling model must not fail-fast or
            // starve the half-open probe of a healthy model on the same
            // provider (one model = one endpoint). The user-facing message
            // keeps the readable providerType.
            const breakerKey = `${providerType}::${handler.getModel().id}`;
            if (!health.canRequest(breakerKey)) {
                const wait = health.secondsUntilProbe(breakerKey);
                throw new Error(
                    `Provider "${providerType}" is currently unreachable (circuit open). `
                    + `Next automatic attempt in ${wait}s.`,
                );
            }
            try {
                yield* handler.createMessage(systemPrompt, messages, tools, abortSignal);
                health.reportSuccess(breakerKey);
            } catch (err) {
                const cls = classifyProviderError(err);
                // FIX-54-11 follow-up: structured diagnostic line on auth-class
                // errors so scope-restriction, quota-as-401 and continuation-
                // restriction are distinguishable in the console without a
                // repro. Field report 2026-07-14 (gpt-5.6-sol succeeded on
                // turn 1, 401ed on the follow-up tool_result call).
                if (cls === 'auth') {
                    logAuthErrorDiagnostics(err, { providerType, model: handler.getModel().id });
                }
                health.reportFailure(breakerKey, cls);
                throw err;
            }
        })();
    };
    return wrapped;
}

type UsageChunk = Extract<ApiStreamChunk, { type: 'usage' }>;

/** A token count, or 0 for anything that is not one. */
function tokenCount(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
    return value > 0 ? value : 0;
}

/**
 * AUDIT-2026-08-27 L-2: a token count that is not a finite, non-negative number
 * becomes 0 before it leaves the provider.
 *
 * An OpenAI-compatible endpoint that answers with `usage: {}` (several local and
 * self-hosted servers do) makes the provider compute
 * `Math.max(0, undefined - cachedIn)`, i.e. NaN. Every consumer downstream only
 * does `+=`, so the NaN spreads into the run totals, renders as a literal NaN in
 * the cost footer, and reaches the crash-recovery snapshot -- where it
 * serialises to null, fails the ledger record guard, and costs the task its
 * whole recovery point on the next load.
 *
 * Seven places read this chunk (main loop, hard-limit recovery, condensing, the
 * FastPath planner, tool-reported usage, the metered out-of-loop ledger, the
 * memory extractor). buildApiHandler is the one place every provider passes
 * through, so the check belongs here: it holds for consumers nobody enumerated
 * and cannot be forgotten by the next one. The log line names the provider type
 * only -- AUDIT 2026-07-18 L-1: the model id is sensitive for custom endpoints.
 */
function sanitiseUsageChunk(chunk: UsageChunk, providerType: string | undefined): UsageChunk {
    const inputTokens = tokenCount(chunk.inputTokens);
    const outputTokens = tokenCount(chunk.outputTokens);
    // An absent cache count stays absent: it means "this provider does not
    // report caching", which is not the same statement as "zero cache hits".
    const cacheReadTokens = chunk.cacheReadTokens === undefined
        ? undefined : tokenCount(chunk.cacheReadTokens);
    const cacheCreationTokens = chunk.cacheCreationTokens === undefined
        ? undefined : tokenCount(chunk.cacheCreationTokens);
    if (inputTokens === chunk.inputTokens && outputTokens === chunk.outputTokens
        && cacheReadTokens === chunk.cacheReadTokens
        && cacheCreationTokens === chunk.cacheCreationTokens) {
        return chunk;
    }
    console.warn(
        `[ApiHandler] ${providerType ?? 'unknown'} reported a usage block with a token count that is `
        + 'not a number (a partial or empty usage object); the affected counts are booked as 0. '
        + 'The run\'s cost line understates this call.',
    );
    return { ...chunk, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens };
}

/**
 * FIX-24-05-08 (R1): stamp the serving model id onto every usage chunk.
 *
 * The consumer used to attribute usage by asking whatever handler was current
 * at fold time (`this.api.getModel().id` in AgentTask). That is a different
 * object than the one that produced the chunk whenever the run swapped handlers
 * mid-flight -- TaskRouter escalation, advisor consult, helper-model condensing
 * -- so the tokens landed in the wrong bucket and were billed at the wrong rate.
 * Attribution belongs to the producer, which is the only place that cannot be
 * wrong about it.
 *
 * A modelId the inner handler already set is left alone: a provider that reads
 * the model off its own response knows more than this decorator does.
 */
export function withUsageAttribution(handler: ApiHandler): ApiHandler {
    const wrapped: ApiHandler = Object.create(handler) as ApiHandler;
    wrapped.createMessage = function (
        systemPrompt: string,
        messages: MessageParam[],
        tools: ToolDefinition[],
        abortSignal?: AbortSignal,
    ): ApiStream {
        return (async function* () {
            for await (const chunk of handler.createMessage(systemPrompt, messages, tools, abortSignal)) {
                if (chunk.type !== 'usage') {
                    yield chunk;
                    continue;
                }
                // AUDIT-2026-08-27 L-2: the numbers are checked for EVERY usage
                // chunk, including one that already names its model. Doing it
                // inside the attribution branch would mean a provider that
                // stamps its own id buys itself an unchecked token count.
                const usage = sanitiseUsageChunk(chunk, handler.providerType);
                if (usage.modelId !== undefined) {
                    yield usage;
                    continue;
                }
                yield { ...usage, modelId: handler.getModel().id, idOrigin: 'served' };
            }
        })();
    };
    return wrapped;
}

/**
 * Build an ApiHandler from a CustomModel (new path)
 */
export function buildApiHandlerForModel(model: CustomModel) {
    return buildApiHandler(modelToLLMProvider(model));
}

/**
 * Build an ApiHandler from a LLMProvider config (legacy / internal path)
 */
export function buildApiHandler(config: LLMProvider) {
    const providerType = config.type;
    // ADR-158: name the winning context-window source once at construction
    // (getModel() is hot-path; logging there would spam every turn).
    // AUDIT 2026-07-18 L-1 / AUDIT-034 M-26: never log the model id -- it is
    // sensitive for custom endpoints. Provider type + source suffice.
    console.debug(
        `[ApiHandler] context window source (${providerType}): `
        + (config.contextWindow !== undefined
            ? `discovery-reported (${config.contextWindow})`
            : 'registry chain'),
    );
    const handler = ((): ApiHandler => {
        switch (providerType) {
            case 'anthropic':
                return new AnthropicProvider(config);
            case 'github-copilot':
                return new GitHubCopilotProvider(config);
            case 'kilo-gateway':
                return new KiloGatewayProvider(config);
            case 'bedrock':
                return new BedrockProvider(config);
            case 'chatgpt-oauth':
                return new ChatGptOAuthProvider(config);
            case 'openai':
            case 'gemini':
            case 'ollama':
            case 'lmstudio':
            case 'openrouter':
            case 'azure':
            case 'custom':
                return new OpenAiProvider(config);
            default: {
                const _exhaustive: never = providerType;
                throw new Error(`Unknown provider type: ${String(_exhaustive)}`);
            }
        }
    })();
    // IMP-41-02-03: every non-local handler passes the shared token bucket.
    // Unconfigured keys resolve instantly, so this is a no-op until a rate
    // is set (rateLimitMs mapping or future per-provider settings).
    handler.providerType = providerType;
    // FIX-24-05-08: attribution goes on FIRST -- closest to the producer, so
    // every decorator further out re-yields an already-stamped chunk -- and
    // BEFORE the local-provider early return. ollama and lmstudio skip the
    // resilience decorators, and they are exactly the providers whose usage
    // must not be priced as somebody's cloud model, so a decorator applied
    // after the return would leave the broken case broken.
    // providerType resolves through the prototype chain (Object.create).
    const attributed = withUsageAttribution(handler);
    if (UNLIMITED_PROVIDER_TYPES.has(providerType)) return attributed;
    // Composition order: breaker OUTERMOST so an open circuit fails fast
    // without first waiting on (and consuming) a rate-limit token; the
    // limiter then paces only requests that are actually going out. Both
    // are no-ops until configured / until failures accumulate.
    const limited = withRateLimit(attributed, providerType);
    const wrapped = withCircuitBreaker(limited, providerType);
    wrapped.providerType = providerType;
    return wrapped;
}
