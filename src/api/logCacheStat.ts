/**
 * logCacheStat -- RESEARCH-36 diagnostic. One debug line per API call showing
 * prompt-cache effectiveness, emitted by every provider so the cache picture
 * is provider-agnostic.
 *
 * `nonCachedInputTokens` = input tokens billed at full price this call.
 * `cacheReadTokens`       = input tokens served from the cache (~10% price).
 * `cacheCreationTokens`   = input tokens just written to the cache (Anthropic/
 *                           Bedrock only; OpenAI-compatible APIs don't report it).
 *
 * hitRate close to 0 across repeated calls of one session => the cached prefix
 * is unstable/poisoned (see RESEARCH-36 section 3). hitRate > ~50% => caching
 * works and the cost driver lies elsewhere (history re-send / tool output).
 *
 * `caching` is 'on'/'OFF' where the provider has an explicit toggle, 'auto'
 * where the provider caches automatically without a flag (OpenAI-compatible).
 *
 * Sub-minimum aggregation: prompts below the provider's minimum cacheable
 * prefix (Anthropic: 2048 tokens for Haiku-class, 1024 otherwise) can never
 * hit the cache; the provider silently ignores the cache markers. Such calls
 * (caching on, read=0, create=0) would flood the console with meaningless
 * 'hitRate=0%' lines (e.g. one per chunk during background enrichment), so
 * they are aggregated into one summary line per AGGREGATE_EVERY calls.
 * Large prompts with 0% hit rate still log per call -- that is the real
 * poisoned-prefix diagnostic and must stay visible.
 */

/** Minimum cacheable prefix in tokens. Only affects log verbosity, never request behavior. */
function minCacheablePrefixTokens(model: string): number {
    return /haiku/i.test(model) ? 2048 : 1024;
}

/**
 * AUDIT-2026-08-28 L-2 (CWE-532): providers whose model id is a private endpoint
 * detail rather than a public product name.
 *
 * `src/api/index.ts` already states the rule ("never log the model id, it is
 * sensitive for custom endpoints. Provider type + source suffice") and this
 * logger broke it. The consequence is not confined to a local console line:
 * ConsoleRingBuffer captures debug output and ReadAgentLogsTool hands it to the
 * model on request, where sanitizeErrorMessage filters secret patterns but not
 * model ids. A prompt injection could therefore read and exfiltrate a private
 * deployment name.
 */
const PRIVATE_MODEL_ID_PROVIDERS = new Set(['custom', 'ollama', 'lmstudio']);

/**
 * The model label for the log line. Withheld, not hashed: FNV-1a over a short
 * id is brute-forceable with a candidate list, so a hash would be obfuscation
 * sold as protection. The aggregation key below keeps the real id, so two
 * private models stay in separate suppression buckets.
 */
function modelLabel(provider: string, model: string): string {
    return PRIVATE_MODEL_ID_PROVIDERS.has(provider) ? '<withheld>' : model;
}

const AGGREGATE_EVERY = 20;
const suppressed = new Map<string, { count: number; in: number; out: number }>();

/** Test-only helper: clears the sub-minimum aggregation buckets. */
export function resetCacheStatAggregation(): void {
    suppressed.clear();
}

export function logCacheStat(opts: {
    provider: string;
    model: string;
    caching: 'on' | 'OFF' | 'auto';
    nonCachedInputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens?: number;
    outputTokens: number;
}): void {
    const create = opts.cacheCreationTokens ?? 0;
    const total = opts.nonCachedInputTokens + opts.cacheReadTokens + create;
    const hitRate = total > 0 ? Math.round((opts.cacheReadTokens / total) * 100) : 0;

    const subMinimum =
        opts.caching !== 'OFF' &&
        opts.cacheReadTokens === 0 &&
        create === 0 &&
        total > 0 &&
        total < minCacheablePrefixTokens(opts.model);
    if (subMinimum) {
        const key = `${opts.provider}|${opts.model}`;
        const bucket = suppressed.get(key) ?? { count: 0, in: 0, out: 0 };
        bucket.count += 1;
        bucket.in += total;
        bucket.out += opts.outputTokens;
        if (bucket.count >= AGGREGATE_EVERY) {
            const avgIn = Math.round(bucket.in / bucket.count);
            const avgOut = Math.round(bucket.out / bucket.count);
            console.debug(
                `[CacheStat:${opts.provider}] model=${modelLabel(opts.provider, opts.model)} ${bucket.count} sub-minimum calls aggregated: ` +
                `avgIn=${avgIn}t avgOut=${avgOut}t (prefix below cacheable minimum, cache markers ignored by provider)`,
            );
            suppressed.delete(key);
        } else {
            suppressed.set(key, bucket);
        }
        return;
    }

    console.debug(
        `[CacheStat:${opts.provider}] model=${modelLabel(opts.provider, opts.model)} caching=${opts.caching} ` +
        `nonCachedIn=${opts.nonCachedInputTokens}t cacheRead=${opts.cacheReadTokens}t ` +
        `cacheCreate=${create}t out=${opts.outputTokens}t totalIn=${total}t hitRate=${hitRate}%`,
    );
}
