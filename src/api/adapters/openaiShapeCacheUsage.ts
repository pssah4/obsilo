/**
 * Cache usage reader for OpenAI-shaped streaming responses (AP3).
 *
 * Three providers (openai, kilo-gateway, github-copilot) carried a copy of the
 * same `prompt_tokens_details.cached_tokens` extraction. AP3 adds a second field
 * to read, and ADR-150's lesson is that a second field added to three copies is
 * a drift carrier -- FIX-04-03-09 had to patch three near-identical converters
 * for exactly this reason. So the extraction moves here once.
 *
 * The two fields, per the OpenRouter documentation checked 2026-08-28
 * (https://openrouter.ai/docs/features/prompt-caching):
 *
 *   prompt_tokens_details.cached_tokens      -- served from the cache (read)
 *   prompt_tokens_details.cache_write_tokens -- just written into the cache
 *
 * `cache_write_tokens` is why this exists: until now `cacheCreationTokens` was
 * set only by anthropicBlocks and bedrockConverse, so a cache WRITE on an
 * OpenAI-shaped provider was silently billed as ordinary input. Anthropic
 * charges 1.25x for a write, so the cost line understated exactly the turns
 * where the cache was being filled.
 *
 * The subtraction, and the assumption it rests on
 * -----------------------------------------------
 * OpenAI's `prompt_tokens` is the TOTAL prompt size, and `cached_tokens` is a
 * SUBSET of it. `cache_write_tokens` is documented in the same details object,
 * so it is read as a subset too, which makes the billable remainder
 * `prompt_tokens - cached - written`.
 *
 * That reading is not certain from the docs alone. Rather than guess silently,
 * an inconsistency is detectable and self-correcting: if subtracting both
 * exceeds the total, the subset assumption is wrong for this provider, so the
 * function falls back to subtracting the read only and warns once. Whichever
 * branch fires is visible in the console next to the CacheStat line, which is
 * what the first live measurement needs to settle it.
 */

/** Cache-aware token counts, in the Anthropic convention (input EXCLUDES cache). */
export interface OpenAiShapeCacheUsage {
    /** Prompt tokens billed at the full input rate this call. */
    inputTokens: number;
    /** Prompt tokens served from the cache (~0.1x). */
    cacheReadTokens: number;
    /** Prompt tokens written into the cache this call (~1.25x). */
    cacheCreationTokens: number;
    outputTokens: number;
}

interface PromptTokensDetails {
    cached_tokens?: unknown;
    cache_write_tokens?: unknown;
}

/**
 * The shape this reader consumes. Every field is `unknown` on purpose: it comes
 * straight off an external stream, and several self-hosted OpenAI-compatible
 * servers answer with a partial or empty usage object (AUDIT-2026-08-27 L-2).
 * Declaring the fields as numbers here would move the lie one layer up.
 */
export interface OpenAiShapeUsageLike {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    prompt_tokens_details?: PromptTokensDetails;
}

/** A finite, non-negative integer, or 0. Mirrors index.ts sanitiseUsageChunk. */
function count(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
    return value;
}

/** Warn once per provider, not once per turn: the tail would flood the console. */
const inconsistencyWarned = new Set<string>();

/** Test-only helper: clears the once-per-provider warning latch. */
export function resetCacheUsageWarnings(): void {
    inconsistencyWarned.clear();
}

/**
 * Read the cache-relevant counts off one OpenAI-shaped usage object.
 *
 * `providerLabel` only names the provider in the diagnostic; it is never the
 * model id (AUDIT 2026-07-18 L-1: a custom endpoint's model id is sensitive).
 */
export function readOpenAiShapeCacheUsage(
    usage: OpenAiShapeUsageLike | null | undefined,
    providerLabel: string,
): OpenAiShapeCacheUsage {
    const details = usage?.prompt_tokens_details;
    const promptTokens = count(usage?.prompt_tokens);
    const outputTokens = count(usage?.completion_tokens);
    const cacheReadTokens = count(details?.cached_tokens);
    const cacheCreationTokens = count(details?.cache_write_tokens);

    const bothSubtracted = promptTokens - cacheReadTokens - cacheCreationTokens;
    if (bothSubtracted >= 0) {
        return { inputTokens: bothSubtracted, cacheReadTokens, cacheCreationTokens, outputTokens };
    }

    // The subset assumption does not hold for this provider: the write count is
    // reported ON TOP of prompt_tokens rather than inside it. Subtracting only
    // the read keeps input honest; the write is still reported and priced.
    if (!inconsistencyWarned.has(providerLabel)) {
        inconsistencyWarned.add(providerLabel);
        console.warn(
            `[CacheUsage] ${providerLabel} reports cache_write_tokens outside prompt_tokens `
            + `(prompt=${promptTokens}, read=${cacheReadTokens}, write=${cacheCreationTokens}). `
            + 'Billable input is derived by subtracting the cache read only.',
        );
    }
    return {
        inputTokens: Math.max(0, promptTokens - cacheReadTokens),
        cacheReadTokens,
        cacheCreationTokens,
        outputTokens,
    };
}
