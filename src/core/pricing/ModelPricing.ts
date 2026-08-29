/**
 * ModelPricing -- USD/EUR cost calculation per model (ADR-090, Lever 5 + 10)
 *
 * Pricing is per-million tokens. Numbers are best-effort published rates,
 * may drift over time -- update when models change.
 *
 * FIX-24-05-07: resolution reports its own provenance. resolveModelPrice()
 * returns a price plus the tier that produced it, and null when no tier can
 * price the id at all. A guessed number is no longer indistinguishable from a
 * measured one. getModelPrice() stays as the "never show blank" shim on top,
 * with no production caller left.
 *
 * Locality is NOT a pricing property. A local id can match a hosted rate
 * ('llama-3.2-3b-instruct' hits the 'llama-3' key at a word boundary), so the
 * caller that knows the provider says so via computeCostForBuckets' predicate
 * or unpricedBreakdown.
 *
 * FEAT-24-12: the USD->EUR rate and a per-model override map come from plugin
 * settings via setPricingConfig(). The point is order-of-magnitude cost
 * awareness for the user, not financial accuracy, but the numbers now say where
 * they came from and the user can correct the ones only they know.
 */

import { normalizeModelId } from '../../types/model-registry';

export interface ModelPrice {
    /** USD per 1M input tokens (uncached) */
    inputPerMillionUsd: number;
    /** USD per 1M output tokens */
    outputPerMillionUsd: number;
    /** USD per 1M tokens read from prompt cache (typically 10% of input) */
    cacheReadPerMillionUsd?: number;
    /** USD per 1M tokens written to prompt cache (typically 125% of input) */
    cacheWritePerMillionUsd?: number;
    /**
     * IMP-24-05-03: the premium rate above a prompt-size threshold, for the
     * vendors that charge one. Absent on every model that bills one flat rate.
     */
    longContext?: LongContextTier;
}

/**
 * IMP-24-05-03 (D8): a second rate card that applies to a SINGLE request whose
 * prompt is bigger than `thresholdInputTokens`.
 *
 * It has to be per request, which is why this could not be built before the
 * usage ledger: 300k tokens is one long request at the premium rate or two short
 * ones at the base rate, and a sum cannot tell those apart. computeCost applies
 * it only when the caller says its numbers describe one request
 * (`scope: 'request'`).
 *
 * The two provenance fields carry the same rule the whole epic runs on: a rate
 * nobody checked stays labelled as a guess. A tier with rateSource 'estimated'
 * makes computeCost report priceSource 'estimated', so the chat footer marks the
 * amount instead of letting it read like a published number.
 */
export interface LongContextTier {
    /**
     * Prompt tokens ABOVE which the tier applies (the threshold value itself
     * still pays the base rate, which is how the vendors word it: "up to 200k").
     * The prompt is the whole input side of the request, cached tokens included.
     */
    thresholdInputTokens: number;
    inputPerMillionUsd: number;
    outputPerMillionUsd: number;
    /** Omitted means "the tier's own input rate", as everywhere else in ModelPrice. */
    cacheReadPerMillionUsd?: number;
    /** Omitted means "the tier's own input rate", as everywhere else in ModelPrice. */
    cacheWritePerMillionUsd?: number;
    /** 'estimated' until somebody checks these numbers against the vendor rate card. */
    rateSource: 'estimated' | 'verified';
    /** ISO date the numbers were written or last checked. */
    rateAsOf: string;
}

/**
 * IMP-24-05-03: does this argument list describe ONE request or a SUM?
 *
 * Only the caller knows, and a long-context tier is unanswerable without it.
 * 'aggregate' is the default because it is the safe answer: a task total priced
 * at the premium rate would charge fifty short requests for being long together.
 */
export type CostScope = 'request' | 'aggregate';

/**
 * FIX-24-05-07: where a price came from, strongest tier first.
 *
 *  - 'override'   the user's own rate map (the answer to regional pricing:
 *                 no region dimension in the table, an explicit override)
 *  - 'live'       the fetched vendor catalog
 *  - 'table'      the manually maintained PRICING table below
 *  - 'estimated'  IMP-24-05-03: the request was billed by a long-context tier
 *                 whose rate nobody has checked against a vendor rate card yet.
 *                 The model is known and its base row is real; the premium step
 *                 above the threshold is the part that is taken on trust.
 *  - 'generation' a family rule: this id is a newer generation of a family we
 *                 do have a rate for, so the newest known family rate is used
 *  - 'unknown'    nothing could price this id (local models, custom ids, and
 *                 the literal 'unknown' usage bucket)
 */
export type PriceSource = 'override' | 'live' | 'table' | 'estimated' | 'generation' | 'unknown';

export interface PriceResolution {
    /** null when no tier could price the id. */
    price: ModelPrice | null;
    source: PriceSource;
}

export interface CostBreakdown {
    inputCost: number;
    outputCost: number;
    cacheReadCost: number;
    cacheWriteCost: number;
    totalUsd: number;
    totalEur: number;
    /**
     * FIX-24-05-07: provenance of the amount. For a bucket sum this is the
     * WEAKEST tier that contributed, and 'unknown' only when not a single
     * bucket could be priced (then the totals are 0 and the UI must omit the
     * amount rather than show a zero).
     */
    priceSource: PriceSource;
    /** Model ids that carried usage but no price. Empty when everything priced. */
    unpricedModelIds: string[];
}

/** FIX-24-05-05: token usage attributed to one model. */
export interface ModelUsage {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
}

/**
 * Per-model usage buckets keyed by model id. A task that mixes models
 * (advisor flagship, fast-tier subagents, TaskRouter escalation, helper
 * condensing) carries one bucket per model so cost can be computed per
 * model instead of pricing the total under a single id.
 */
export type UsageByModel = Record<string, ModelUsage>;

/**
 * Bucket key for usage that arrived without a model id. FIX-24-05-07 gives it
 * an early exit in resolveModelPrice: it used to substring-sweep like a real
 * id and land on the Sonnet fallback.
 */
export const UNKNOWN_MODEL_KEY = 'unknown';

/**
 * Keys that reach an object's prototype through bracket assignment.
 *
 * One set for both users in this file: the price-override parser, which reads
 * lines the user typed, and addUsage, which keys buckets by model id. Two copies
 * would let one of them fall behind the other.
 */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * An empty bucket map.
 *
 * AUDIT-2026-08-27 L-1: a map with no prototype has nothing for a magic key to
 * reach, so `map[key]` cannot hand back an inherited object. addUsage's key
 * guard is what actually closes the hole; this makes the closure structural for
 * every future reader of a bucket map too.
 */
export function createUsageByModel(): UsageByModel {
    return Object.create(null) as UsageByModel;
}

/**
 * Add usage to the bucket for `modelId`, creating it on demand.
 *
 * AUDIT-2026-08-27 L-1: the key is a model id, and a model id can arrive from a
 * resumed inflight snapshot, which is a cloud-synced, hand-editable file.
 * `target['__proto__']` reads the prototype getter, which is truthy, so the
 * `??` used to short-circuit, `bucket` WAS Object.prototype, and the four `+=`
 * put four enumerable NaN properties on every object in the renderer. An unsafe
 * id is booked under the unknown key instead of dropped: the tokens were really
 * spent, and losing them would break the invariant the run exits assert.
 */
export function addUsage(
    target: UsageByModel,
    modelId: string,
    input: number,
    output: number,
    cacheRead = 0,
    cacheCreation = 0,
): void {
    const id = modelId || UNKNOWN_MODEL_KEY;
    const key = UNSAFE_KEYS.has(id) ? UNKNOWN_MODEL_KEY : id;
    const bucket = target[key] ?? (target[key] = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });
    bucket.input += input;
    bucket.output += output;
    bucket.cacheRead += cacheRead;
    bucket.cacheCreation += cacheCreation;
}

/** Merge all of `source`'s buckets into `target`. */
export function mergeUsageByModel(target: UsageByModel, source: UsageByModel | undefined): void {
    if (!source) return;
    for (const [id, u] of Object.entries(source)) {
        addUsage(target, id, u.input, u.output, u.cacheRead, u.cacheCreation);
    }
}

/** Tiers from strongest to weakest, for the aggregate over several buckets. */
const SOURCE_STRENGTH: PriceSource[] = ['override', 'live', 'table', 'estimated', 'generation', 'unknown'];

/** The weaker of two tiers; null means "nothing seen yet". */
function weakerSource(current: PriceSource | null, next: PriceSource): PriceSource {
    if (current === null) return next;
    return SOURCE_STRENGTH.indexOf(current) >= SOURCE_STRENGTH.indexOf(next) ? current : next;
}

/**
 * FIX-24-05-07: a report with nothing billable in it. Zero amounts, source
 * 'unknown', and the ids named so a reader can tell "no rate for these" from
 * "this really was free".
 */
export function unpricedBreakdown(modelIds: string[]): CostBreakdown {
    return {
        inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0,
        totalUsd: 0, totalEur: 0, priceSource: 'unknown',
        unpricedModelIds: [...modelIds],
    };
}

/**
 * Sum of per-model costs -- the correct price for a mixed-model task.
 *
 * FIX-24-05-07: a bucket nobody can price no longer poisons the whole sum.
 * The priced buckets are added up and the unpriced ids are named, so the UI
 * can show a partial amount plus a marker instead of either a Sonnet guess
 * for a local model or no number at all.
 *
 * `isLocalModelId` is how the caller reports what this module cannot know:
 * where the model ran. A model served from the user's own machine has no bill
 * even when its id happens to match a hosted rate ('llama-3.2-3b-instruct'
 * hits the 'llama-3' key at a word boundary), so a local bucket is counted as
 * unpriced rather than billed at somebody else's rate.
 *
 * IMP-24-05-03: this stays TIER-BLIND on purpose, and that is not an oversight
 * to fix later. A bucket is a whole task's traffic on one model, and a long
 * context tier is charged per request. 300k tokens in a bucket can be one long
 * request or fifty short ones; nothing here can tell those apart, so the base
 * rate is the only answer that is not invented. The per-request history does
 * exist since FEAT-24-13 (AgentLoopState.usage holds one record per request), so
 * a tier-aware task total is a read over the ledger, not a change here.
 *
 * AUDIT-2026-08-27 I-5: deliberate is not the same as invisible. A caller that
 * presents this sum has to say when a tier WOULD have applied, or the amount
 * reads like the invoice while being a floor. longContextRequestModelIds (in
 * LoopState) answers that off the same ledger, and the footer marks the amount.
 * The exact tier-aware total is the open half (backlog IMP-SEC-27-02).
 */
export function computeCostForBuckets(
    usageByModel: UsageByModel,
    isLocalModelId?: (modelId: string) => boolean,
): CostBreakdown {
    const total: CostBreakdown = {
        inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0,
        totalUsd: 0, totalEur: 0, priceSource: 'unknown', unpricedModelIds: [],
    };
    let weakest: PriceSource | null = null;
    for (const [id, u] of Object.entries(usageByModel)) {
        if (isLocalModelId?.(id)) {
            total.unpricedModelIds.push(id);
            continue;
        }
        const c = computeCost(id, u.input, u.output, u.cacheRead, u.cacheCreation);
        if (c.priceSource === 'unknown') {
            total.unpricedModelIds.push(id);
            continue;
        }
        total.inputCost += c.inputCost;
        total.outputCost += c.outputCost;
        total.cacheReadCost += c.cacheReadCost;
        total.cacheWriteCost += c.cacheWriteCost;
        total.totalUsd += c.totalUsd;
        total.totalEur += c.totalEur;
        weakest = weakerSource(weakest, c.priceSource);
    }
    total.priceSource = weakest ?? 'unknown';
    return total;
}

/**
 * FEAT-24-12 (D9): the USD->EUR rate is a SETTING with a documented default,
 * not a module constant. The constant it replaced was 0.93 with a comment
 * claiming it was configurable; nothing could configure it, and 0.93 sat 8.4
 * percent above the real mid-market rate, so every euro amount in the chat
 * footer was inflated by that much.
 *
 * 0.86 is the mid-market USD/EUR rate measured for the 2026-08 cost audit. It
 * is a DEFAULT the user is expected to adjust, not a rate this plugin can keep
 * current: there is deliberately no FX fetch, because a background fetch would
 * overwrite a rate the user typed by hand, which is the same defect as the
 * hardcoded constant with fewer ways to notice it. Card rates, corporate rates
 * and the rate on an invoice all differ from mid-market anyway.
 */
export const DEFAULT_USD_TO_EUR = 0.86;

/**
 * When DEFAULT_USD_TO_EUR was last checked. Separate from
 * PRICING_LAST_UPDATED, which by its own comment covers the table only: a
 * currency pair and a vendor rate card drift on completely different clocks.
 */
export const USD_TO_EUR_LAST_UPDATED = '2026-08-27';

/**
 * Plausible band for an FX rate on this pair. Wide on purpose (the point is to
 * catch a NaN, an empty field, or a decimal point in the wrong place, not to
 * predict the market), and it must never let a non-positive value through:
 * a 0 would render every run as free.
 */
const USD_TO_EUR_MIN = 0.5;
const USD_TO_EUR_MAX = 2;

let usdToEur: number = DEFAULT_USD_TO_EUR;

/** True only for a finite number inside the plausible band. */
export function isPlausibleUsdToEur(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value)
        && value >= USD_TO_EUR_MIN && value <= USD_TO_EUR_MAX;
}

/**
 * The rate to convert with: the stored setting when it is usable, the
 * documented default otherwise. Unusable covers a hand-edited data.json, an
 * empty settings field, and a typo that moved the decimal point.
 */
export function sanitizeUsdToEur(value: unknown): number {
    return isPlausibleUsdToEur(value) ? value : DEFAULT_USD_TO_EUR;
}

/** The rate currently in effect, for display in settings. */
export function getUsdToEur(): number {
    return usdToEur;
}

/**
 * Manual pricing-table maintenance marker. Bump this string when you have
 * just verified the PRICING table below against the live Anthropic /
 * OpenAI / Google rate cards. ISO date.
 *
 * Why this is manual rather than scraped: the three vendors publish prices
 * on HTML pages with no stable machine-readable contract. A reminder is
 * pragmatic; a scraper would break with every redesign.
 */
export const PRICING_LAST_UPDATED = '2026-07-02';
const PRICING_STALE_DAYS = 90;

/**
 * Return a maintenance warning string when the pricing table has not been
 * touched for more than PRICING_STALE_DAYS, otherwise null. Called once
 * from plugin onload so the warning shows up exactly once per session.
 */
export function getPricingAgeWarning(today: Date = new Date()): string | null {
    const last = new Date(PRICING_LAST_UPDATED);
    const days = Math.floor((today.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));
    if (days <= PRICING_STALE_DAYS) return null;
    return `[ModelPricing] Pricing table is ${days} days old (last updated ${PRICING_LAST_UPDATED}). ` +
        'Verify Anthropic / OpenAI / Google rate cards and bump PRICING_LAST_UPDATED.';
}

/**
 * Pricing table. Keys are matched by:
 *   1. Exact model id (case-insensitive)
 *   2. Substring at a word boundary (e.g. "claude-sonnet-4" matches the dated
 *      snapshot ids, but "o3" no longer matches mid-word)
 * If nothing matches, the family rules below get a turn and then the id is
 * reported as unpriced (FIX-24-05-07).
 */
const PRICING: Record<string, ModelPrice> = {
    // Anthropic Claude. Opus dropped to 5/25 with Opus 4.5 (Nov 2025);
    // only Opus 4.0/4.1 keep the legacy 15/75 rates. The bare
    // 'claude-opus-4' key stays at 15/75 so opus-4-0/4-1 substring
    // matches price correctly; newer generations have explicit entries.
    //
    // IMP-24-05-03: NO Claude row gets a longContext tier, and adding one needs
    // measurements this repo cannot currently make. The 6/22.50 premium that
    // gets quoted belongs to the context-1m BETA of Sonnet 4 and 4.5, which a
    // client only gets by sending an anthropic-beta header; that header appears
    // nowhere in src/ (the forked reference implementation has it, this plugin
    // does not). Sonnet 5 and Opus 4.7 have native 1M windows at the standard
    // rates in types/model-registry.ts, so a tier there would invent a charge
    // the user never pays. Before adding one: confirm the plugin actually opts
    // into a premium long-context mode on the wire, then read the threshold and
    // both rates off the vendor rate card for the exact model id.
    'claude-fable-5': { inputPerMillionUsd: 10, outputPerMillionUsd: 50, cacheReadPerMillionUsd: 1, cacheWritePerMillionUsd: 12.5 },
    'claude-opus-4-8': { inputPerMillionUsd: 5, outputPerMillionUsd: 25, cacheReadPerMillionUsd: 0.5, cacheWritePerMillionUsd: 6.25 },
    'claude-opus-4-7': { inputPerMillionUsd: 5, outputPerMillionUsd: 25, cacheReadPerMillionUsd: 0.5, cacheWritePerMillionUsd: 6.25 },
    'claude-opus-4-6': { inputPerMillionUsd: 5, outputPerMillionUsd: 25, cacheReadPerMillionUsd: 0.5, cacheWritePerMillionUsd: 6.25 },
    'claude-opus-4-5': { inputPerMillionUsd: 5, outputPerMillionUsd: 25, cacheReadPerMillionUsd: 0.5, cacheWritePerMillionUsd: 6.25 },
    'claude-opus-4': { inputPerMillionUsd: 15, outputPerMillionUsd: 75, cacheReadPerMillionUsd: 1.5, cacheWritePerMillionUsd: 18.75 },
    // Sonnet 5 sticker price; intro pricing (2/10 through 2026-08-31) is
    // deliberately not modeled -- sticker keeps the table stable.
    'claude-sonnet-5': { inputPerMillionUsd: 3, outputPerMillionUsd: 15, cacheReadPerMillionUsd: 0.3, cacheWritePerMillionUsd: 3.75 },
    'claude-sonnet-4-6': { inputPerMillionUsd: 3, outputPerMillionUsd: 15, cacheReadPerMillionUsd: 0.3, cacheWritePerMillionUsd: 3.75 },
    'claude-sonnet-4-5': { inputPerMillionUsd: 3, outputPerMillionUsd: 15, cacheReadPerMillionUsd: 0.3, cacheWritePerMillionUsd: 3.75 },
    'claude-sonnet-4': { inputPerMillionUsd: 3, outputPerMillionUsd: 15, cacheReadPerMillionUsd: 0.3, cacheWritePerMillionUsd: 3.75 },
    'claude-haiku-4-5': { inputPerMillionUsd: 1, outputPerMillionUsd: 5, cacheReadPerMillionUsd: 0.1, cacheWritePerMillionUsd: 1.25 },

    // OpenAI. mini/nano variants need their own entries: the substring
    // fallback would otherwise route them onto the full-size price.
    'gpt-5-mini': { inputPerMillionUsd: 0.25, outputPerMillionUsd: 2, cacheReadPerMillionUsd: 0.025 },
    'gpt-5-nano': { inputPerMillionUsd: 0.05, outputPerMillionUsd: 0.4, cacheReadPerMillionUsd: 0.005 },
    'gpt-5': { inputPerMillionUsd: 1.25, outputPerMillionUsd: 10, cacheReadPerMillionUsd: 0.125 },
    'gpt-4.1': { inputPerMillionUsd: 2, outputPerMillionUsd: 8, cacheReadPerMillionUsd: 0.5 },
    'gpt-4o': { inputPerMillionUsd: 2.5, outputPerMillionUsd: 10, cacheReadPerMillionUsd: 1.25 },
    'gpt-4o-mini': { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6, cacheReadPerMillionUsd: 0.075 },
    'o3-mini': { inputPerMillionUsd: 1.1, outputPerMillionUsd: 4.4, cacheReadPerMillionUsd: 0.55 },
    'o3': { inputPerMillionUsd: 2, outputPerMillionUsd: 8, cacheReadPerMillionUsd: 0.5 },
    'o4-mini': { inputPerMillionUsd: 1.1, outputPerMillionUsd: 4.4, cacheReadPerMillionUsd: 0.275 },

    // Google (cache read = implicit caching, 75% discount on input).
    //
    // IMP-24-05-03: Gemini 2.5 Pro is the one model in this table that bills a
    // long-context tier today: 1.25/10 up to a 200k prompt, 2.50/15 above it,
    // which is a straight doubling of the input rate and a 50 percent step on
    // output. The tier's cache-read rate follows this row's own stated rule (25
    // percent of input, so 0.625), which happens to agree with the published
    // step from 0.3125. Both readings are still 'estimated': agreeing
    // derivations are not a rate card, and nobody here has checked one.
    'gemini-2.5-pro': {
        inputPerMillionUsd: 1.25, outputPerMillionUsd: 10, cacheReadPerMillionUsd: 0.3125,
        longContext: {
            thresholdInputTokens: 200_000,
            inputPerMillionUsd: 2.5, outputPerMillionUsd: 15, cacheReadPerMillionUsd: 0.625,
            rateSource: 'estimated', rateAsOf: '2026-08-27',
        },
    },
    'gemini-2.5-flash': { inputPerMillionUsd: 0.3, outputPerMillionUsd: 2.5, cacheReadPerMillionUsd: 0.075 },

    // Meta (free tiers approximated)
    'llama-3': { inputPerMillionUsd: 0.2, outputPerMillionUsd: 0.6 },
};

/**
 * Static keys sorted longest first, so 'claude-sonnet-4-6' wins over
 * 'claude-sonnet-4'. Hoisted out of the lookup: PRICING is a module constant,
 * and the sort used to run on every single computeCost call.
 */
const PRICING_KEYS_BY_LENGTH: string[] = Object.keys(PRICING).sort((a, b) => b.length - a.length);

/**
 * FIX-24-05-07: family rules for ids no table knows yet.
 *
 * 'claude-opus-5' has no PRICING key, so the substring sweep missed it and the
 * old fallback billed an Opus run at Sonnet rates. A newer generation of a
 * family we DO have a rate for inherits that family's newest known rate, and
 * the result is labelled 'generation' so the UI can mark it as extrapolated.
 *
 * The patterns mirror the family regexes in types/model-registry.ts
 * (modelSupportsTemperature): major version 5..9 or any two-or-more digit
 * major, so a future claude-opus-11 stays covered, while the dotted minors
 * (claude-haiku-4-5) keep their own table entries.
 *
 * Only families with an anchor entry are listed. A family we have never
 * priced (a new Claude line, gpt-6, gemini-3) stays 'unknown' on purpose:
 * inheriting a rate across families would be an invented number.
 */
const GENERATION_RULES: Array<{ pattern: RegExp; anchor: string }> = [
    { pattern: /^claude-opus-(?:[5-9]|\d\d+)\b/, anchor: 'claude-opus-4-8' },
    { pattern: /^claude-sonnet-(?:[5-9]|\d\d+)\b/, anchor: 'claude-sonnet-5' },
    { pattern: /^claude-haiku-(?:[5-9]|\d\d+)\b/, anchor: 'claude-haiku-4-5' },
    { pattern: /^claude-fable-(?:[6-9]|\d\d+)\b/, anchor: 'claude-fable-5' },
];

/**
 * Reached only through the getModelPrice shim: midrange Sonnet pricing for a
 * caller that just wants a number. Nothing in src/ calls that shim any more
 * (computeCost resolves directly), so this constant is currently test-only.
 * Everything that needs to KNOW whether a price exists uses resolveModelPrice.
 */
const FALLBACK: ModelPrice = { inputPerMillionUsd: 3, outputPerMillionUsd: 15, cacheReadPerMillionUsd: 0.3, cacheWritePerMillionUsd: 3.75 };

/**
 * FIX-24-05-07: user-supplied rates, checked before every other tier.
 *
 * This is the answer to regional pricing (Bedrock EU and friends): the base
 * rates are disputed, so the table stays region-free and a user who knows
 * their contract rate states it explicitly.
 */
let OVERRIDES: Record<string, ModelPrice> | null = null;
let OVERRIDE_KEYS_BY_LENGTH: string[] = [];

export function setPriceOverrides(overrides: Record<string, ModelPrice> | null): void {
    OVERRIDES = overrides && Object.keys(overrides).length > 0 ? overrides : null;
    OVERRIDE_KEYS_BY_LENGTH = OVERRIDES
        ? Object.keys(OVERRIDES).sort((a, b) => b.length - a.length)
        : [];
}

/**
 * IMP-24-05-02: live price catalog (OpenRouter /v1/models, keys normalized
 * by PriceCatalogService). Preferred over the static table when set -- it
 * carries current vendor rates including intro pricing and models newer
 * than any manual maintenance. The static table stays as offline fallback.
 */
let LIVE_CATALOG: Record<string, ModelPrice> | null = null;
let LIVE_KEYS_BY_LENGTH: string[] = [];

export function setLivePriceCatalog(catalog: Record<string, ModelPrice> | null): void {
    LIVE_CATALOG = catalog && Object.keys(catalog).length > 0 ? catalog : null;
    LIVE_KEYS_BY_LENGTH = LIVE_CATALOG
        ? Object.keys(LIVE_CATALOG).sort((a, b) => b.length - a.length)
        : [];
}

/**
 * Incoming ids use vendor-specific spellings (Bedrock
 * `eu.anthropic.claude-haiku-4-5-...`, OpenRouter
 * `anthropic/claude-opus-4.8`). Live-catalog keys use the dashed form,
 * so normalize version dots before matching.
 */
function normalizeForLiveLookup(modelId: string): string {
    return modelId.toLowerCase().replace(/(\d)\.(\d)/g, '$1-$2');
}

/**
 * FEAT-24-12: the override map as the user writes it, one entry per line:
 *
 *   claude-opus-5 = 5/25
 *   claude-haiku-4-5 = 1.2/6/0.12/1.5
 *   # a comment
 *
 * Order is input/output/cacheRead/cacheWrite in USD per million tokens, the
 * same "5/25" shorthand the table's own comments use; the two cache rates are
 * optional and fall back to the input rate like every other tier.
 *
 * Text rather than a structured settings object on purpose: a typo stays on
 * screen where the user can fix it, and the unusable lines come back by name
 * instead of vanishing.
 *
 * Keys are lowercased, version dots become dashes, and an OpenRouter vendor
 * prefix is dropped ('Anthropic/Claude-Opus-4.8' -> 'claude-opus-4-8'), the
 * same normalization PriceCatalogService applies to a catalog key. A bare key
 * matches every vendor spelling of that model through the boundary sweep, which
 * is what a user pasting an id means. A DOTTED prefix is deliberately kept:
 * 'eu.anthropic.claude-opus-5-...' as a key is how one region gets its own rate
 * while 'us.anthropic....' keeps the table rate.
 *
 * The value band mirrors PriceCatalogService's (must be > 0, at most
 * MAX_PLAUSIBLE_PER_MILLION_USD): both guard the same money math, one against
 * a hostile endpoint, this one against a slipped decimal point.
 *
 * IMP-24-05-03: the format has four scalars and no threshold, so an override
 * cannot express a long-context tier and replaces one it shadows. That is the
 * right way round: a rate the user typed is charged as typed. Same for the live
 * catalog, whose feed only carries a flat prompt/completion pair.
 */
const MAX_PLAUSIBLE_PER_MILLION_USD = 10_000;

export function parsePriceOverrideText(
    text: string,
): { overrides: Record<string, ModelPrice>; invalidLines: string[] } {
    const overrides: Record<string, ModelPrice> = Object.create(null) as Record<string, ModelPrice>;
    const invalidLines: string[] = [];
    const rate = (raw: string | undefined): number | null => {
        if (raw === undefined) return null;
        const n = Number(raw.trim());
        if (!Number.isFinite(n) || n <= 0 || n > MAX_PLAUSIBLE_PER_MILLION_USD) return null;
        return n;
    };
    for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        const id = eq < 0 ? '' : line.slice(0, eq).trim();
        const parts = eq < 0 ? [] : line.slice(eq + 1).split('/');
        const normalized = id ? normalizeForLiveLookup(id) : '';
        const key = normalized.slice(normalized.lastIndexOf('/') + 1);
        const input = rate(parts[0]);
        const output = rate(parts[1]);
        if (!key || UNSAFE_KEYS.has(key) || input === null || output === null) {
            invalidLines.push(line);
            continue;
        }
        const price: ModelPrice = { inputPerMillionUsd: input, outputPerMillionUsd: output };
        const cacheRead = rate(parts[2]);
        const cacheWrite = rate(parts[3]);
        if (cacheRead !== null) price.cacheReadPerMillionUsd = cacheRead;
        if (cacheWrite !== null) price.cacheWritePerMillionUsd = cacheWrite;
        overrides[key] = price;
    }
    return { overrides, invalidLines };
}

/** FEAT-24-12: the pricing knobs that live in plugin settings. */
export interface PricingConfig {
    /** `advancedApi.usdToEurRate`. Anything unusable falls back to the default. */
    usdToEur?: unknown;
    /** `advancedApi.priceOverridesText`. Unusable lines are reported, not applied. */
    priceOverridesText?: unknown;
}

/**
 * FEAT-24-12: apply the settings-backed pricing config. Same module-setter
 * shape as setLivePriceCatalog, and called from BOTH plugin boot and
 * saveSettings: without the second call the setting only takes effect after a
 * reload, which is indistinguishable from the setting not working.
 *
 * Full-state, not a patch: settings are the whole truth on every save, so a
 * field the user cleared has to clear the module state too. Returns the lines
 * of the override text it could not use, so the settings UI can name them.
 */
export function setPricingConfig(config: PricingConfig): { invalidLines: string[] } {
    usdToEur = sanitizeUsdToEur(config.usdToEur);
    const text = typeof config.priceOverridesText === 'string' ? config.priceOverridesText : '';
    const { overrides, invalidLines } = parsePriceOverrideText(text);
    setPriceOverrides(overrides);
    return { invalidLines };
}

/** Ids and keys are lowercased before matching, so this is the word class. */
function isWordChar(ch: string): boolean {
    return ch.length > 0 && /[a-z0-9]/.test(ch);
}

/**
 * FIX-24-05-07: substring match that has to land on a word boundary.
 *
 * The sweep is load-bearing (the bare 'claude-opus-4' key exists so opus-4-0
 * and opus-4-1 keep the legacy 15/75), but without a boundary a two-character
 * key like 'o3' also matches mid-word in any custom or local model name and
 * prices it as OpenAI o3. Dots and dashes count as boundaries, which is what
 * makes Bedrock ('eu.anthropic.claude-haiku-4-5-...') and OpenRouter
 * ('anthropic/claude-opus-4-8') ids match their bare keys.
 */
function includesAtWordBoundary(haystack: string, needle: string): boolean {
    let at = haystack.indexOf(needle);
    while (at >= 0) {
        // charAt returns '' out of range, which counts as a boundary.
        const before = at === 0 ? '' : haystack.charAt(at - 1);
        const after = haystack.charAt(at + needle.length);
        if (!isWordChar(before) && !isWordChar(after)) return true;
        at = haystack.indexOf(needle, at + 1);
    }
    return false;
}

/**
 * Exact key, then longest-first substring sweep with the boundary check.
 * hasOwnProperty rather than truthiness: the override map is user input, and
 * a plain lookup would answer an id called 'constructor' with a function.
 */
function matchPriceTable(
    table: Record<string, ModelPrice>,
    keysByLength: string[],
    id: string,
): ModelPrice | null {
    if (Object.prototype.hasOwnProperty.call(table, id)) return table[id];
    for (const key of keysByLength) {
        if (includesAtWordBoundary(id, key)) return table[key];
    }
    return null;
}

/**
 * FIX-24-05-07: resolve a price AND say where it came from.
 *
 * Order: user override, live catalog, static table (exact then boundary
 * sweep), family rule, unknown. The literal 'unknown' bucket key exits before
 * any matching runs, because it is not a model id at all.
 *
 * FEAT-24-12: the override tier sits ABOVE live on purpose. The live catalog
 * used to win unconditionally, and it structurally cannot carry a regional
 * rate: PriceCatalogService.normalizeCatalogKey strips the vendor prefix, so
 * every region of a model collapses onto one key. A regional correction
 * therefore belongs in the override map, and a nightly catalog refresh must not
 * overwrite a rate the user typed. Regions stay out of the table itself: the
 * base rates are disputed, and an invented regional rate would be the same
 * defect in nicer packaging.
 */
export function resolveModelPrice(modelId: string | undefined | null): PriceResolution {
    if (!modelId) return { price: null, source: 'unknown' };
    const lower = modelId.toLowerCase();
    if (lower === UNKNOWN_MODEL_KEY) return { price: null, source: 'unknown' };

    const forCatalogs = normalizeForLiveLookup(modelId);

    if (OVERRIDES) {
        const hit = matchPriceTable(OVERRIDES, OVERRIDE_KEYS_BY_LENGTH, forCatalogs);
        if (hit) return { price: hit, source: 'override' };
    }

    // IMP-24-05-02: live catalog before the manually maintained table.
    if (LIVE_CATALOG) {
        const hit = matchPriceTable(LIVE_CATALOG, LIVE_KEYS_BY_LENGTH, forCatalogs);
        if (hit) return { price: hit, source: 'live' };
    }

    const tableHit = matchPriceTable(PRICING, PRICING_KEYS_BY_LENGTH, lower);
    if (tableHit) return { price: tableHit, source: 'table' };

    // Family rules run on the normalized id so Bedrock and OpenRouter
    // spellings anchor at the start of the pattern like a bare id does.
    const normalized = normalizeModelId(lower);
    for (const rule of GENERATION_RULES) {
        if (!rule.pattern.test(normalized)) continue;
        const anchor = PRICING[rule.anchor];
        if (anchor) return { price: anchor, source: 'generation' };
    }

    return { price: null, source: 'unknown' };
}

/**
 * Look up pricing for a model id, falling back to Sonnet rates when nothing
 * matches. Shim over resolveModelPrice for a caller that only needs a number
 * and cannot act on the provenance. It has no production caller left: the
 * pricing paths all went to resolveModelPrice, and the shim survives as the
 * documented "never blank" answer plus the pin for the old assertions.
 */
export function getModelPrice(modelId: string | undefined | null): ModelPrice {
    return resolveModelPrice(modelId).price ?? FALLBACK;
}

/**
 * Compact label for the chat footer (FIX-24-05-07, D7): strip the vendor and
 * region prefixes, the Bedrock version suffix, and a trailing snapshot date,
 * so 'eu.anthropic.claude-opus-5-20260401-v1:0' reads 'claude-opus-5'. A local
 * id has none of that decoration and comes back unchanged.
 */
export function shortModelLabel(modelId: string): string {
    const normalized = normalizeModelId(modelId).replace(/-\d{6,8}$/, '');
    return normalized || modelId;
}

/**
 * The prompt of one request: the whole input side, cache reads and cache writes
 * included.
 *
 * The vendors charge a long-context tier on the tokens they had to read, and most
 * providers report inputTokens with the cache hits already subtracted, so
 * ignoring the cached half would keep a 900k-token cached conversation on the
 * small-prompt rate.
 *
 * AUDIT-2026-08-27 I-5: one definition for the two places that need it, the
 * rate-card selection below and the tier disclosure. A second reading of
 * "prompt" would let the footer mark an amount the pricing never tiered, or
 * leave a tiered amount unmarked.
 */
export function promptTokensOf(
    inputTokens: number,
    cacheReadTokens = 0,
    cacheCreationTokens = 0,
): number {
    return inputTokens + cacheReadTokens + cacheCreationTokens;
}

/**
 * AUDIT-2026-08-27 I-5: would a long-context tier bill THIS request above the
 * base rate?
 *
 * The question a bucket sum cannot answer, asked about one request. It resolves
 * the price the way computeCost does, so a rate the user typed or a rate from the
 * live catalog answers false: both hand over a complete flat price and the tier
 * they shadow is never charged, so disclosing it would describe a charge that did
 * not happen. An id nothing can price answers false too, because a tier without a
 * base row is not a rate card.
 *
 * The threshold comparison is strictly greater, the same boundary selectRateCard
 * applies, matching how the vendors word the tier ("up to 200k").
 */
export function crossesLongContextTier(
    modelId: string | undefined | null,
    promptTokens: number,
): boolean {
    const tier = resolveModelPrice(modelId).price?.longContext;
    return tier !== undefined && promptTokens > tier.thresholdInputTokens;
}

/**
 * IMP-24-05-03: pick the rate card for ONE request.
 *
 * The prompt is the whole input side (uncached input plus cache reads plus cache
 * writes); see promptTokensOf. Comparison is strictly greater than the threshold,
 * matching how the tier is worded ("up to 200k").
 *
 * A missing cache rate on the tier falls back to the TIER's input rate, not to
 * the base row's cache rate: charging the premium input rate next to the cheap
 * base cache rate would be a rate card no vendor publishes.
 */
function selectRateCard(
    price: ModelPrice,
    source: PriceSource,
    promptTokens: number,
    scope: CostScope,
): { rates: ModelPrice; source: PriceSource } {
    const tier = price.longContext;
    if (scope !== 'request' || !tier || promptTokens <= tier.thresholdInputTokens) {
        return { rates: price, source };
    }
    return {
        rates: {
            inputPerMillionUsd: tier.inputPerMillionUsd,
            outputPerMillionUsd: tier.outputPerMillionUsd,
            cacheReadPerMillionUsd: tier.cacheReadPerMillionUsd,
            cacheWritePerMillionUsd: tier.cacheWritePerMillionUsd,
        },
        // An unchecked premium rate is worth what an extrapolated family rate is
        // worth, so it reports as an estimate however solid the base row was.
        source: tier.rateSource === 'estimated' ? 'estimated' : source,
    };
}

/**
 * Compute cost for a usage report.
 * cacheReadTokens are billed at the cache-read rate (much cheaper).
 * cacheCreationTokens are billed at the cache-write rate (slightly more than input).
 * Regular inputTokens already exclude cache hits in most providers' usage reports.
 *
 * IMP-24-05-03 (D8): `scope` says whether the four token counts describe one
 * request or a sum of them, which is the one thing a long-context tier needs and
 * cannot derive. It defaults to 'aggregate', so every existing caller keeps
 * pricing its sums flat; the callers that hold a single request (the metered-call
 * log line, and any future read over the FEAT-24-13 ledger) opt in.
 */
export function computeCost(
    modelId: string | undefined | null,
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens: number = 0,
    cacheCreationTokens: number = 0,
    scope: CostScope = 'aggregate',
): CostBreakdown {
    const resolved = resolveModelPrice(modelId);

    // FIX-24-05-07: no price means no amount. Reporting the Sonnet fallback
    // here is how a local Ollama run used to show up as cloud spend.
    if (!resolved.price) return unpricedBreakdown([modelId || UNKNOWN_MODEL_KEY]);

    const { rates: price, source } = selectRateCard(
        resolved.price,
        resolved.source,
        promptTokensOf(inputTokens, cacheReadTokens, cacheCreationTokens),
        scope,
    );

    const inputCost = (inputTokens / 1_000_000) * price.inputPerMillionUsd;
    const outputCost = (outputTokens / 1_000_000) * price.outputPerMillionUsd;
    const cacheReadCost = (cacheReadTokens / 1_000_000) * (price.cacheReadPerMillionUsd ?? price.inputPerMillionUsd);
    const cacheWriteCost = (cacheCreationTokens / 1_000_000) * (price.cacheWritePerMillionUsd ?? price.inputPerMillionUsd);

    // AP5: the two `??` above fall back to the INPUT rate when a row publishes no
    // cache rate. The fallback is the conservative direction and stays, but it
    // was SILENT: priceSource kept claiming 'live' or 'table' for a cache amount
    // nobody published. A cache read is billed at 0.1x on Anthropic-style
    // caches, so the fallback overstates it roughly tenfold.
    //
    // Scale: 130 of the 331 entries in the OpenRouter catalog cached in the vault
    // (2026-08-27) carry no cache-read rate.
    //
    // 'estimated' rather than a new source value, because an extrapolated family
    // rate already means exactly this and TaskTelemetry's GUESSED_PRICE_SOURCES
    // already turns it into the "estimated rate" marker in the footer. Firing
    // only when cache tokens are actually priced keeps the marker meaningful: a
    // model with no cache rate that never used the cache is priced exactly right.
    const cacheRateGuessed =
        (cacheReadTokens > 0 && price.cacheReadPerMillionUsd === undefined)
        || (cacheCreationTokens > 0 && price.cacheWritePerMillionUsd === undefined);

    const totalUsd = inputCost + outputCost + cacheReadCost + cacheWriteCost;
    const totalEur = totalUsd * usdToEur;

    return {
        inputCost, outputCost, cacheReadCost, cacheWriteCost, totalUsd, totalEur,
        priceSource: cacheRateGuessed ? 'estimated' : source, unpricedModelIds: [],
    };
}

/**
 * FIX-24-05-07: USD estimate for a token budget, or NaN when the model has no
 * price. Used by the weekly freshness budget (FIX-19-16-04 wiring in main.ts).
 *
 * NaN rather than 0 is the point: Stufe3PeriodicJob.spendTokens accepts any
 * estimate >= 0, so a 0 would be booked as a real cost and freeze the weekly
 * budget at zero spend. A non-finite value falls into its tokensPerUsd
 * fallback instead.
 *
 * The default 85/15 split reflects the verifier traffic it pays for: a note
 * body plus URLs in the prompt, a short JSON answer back.
 */
export function estimateSpendUsd(
    modelId: string | undefined | null,
    tokens: number,
    inputShare = 0.85,
): number {
    const cost = computeCost(
        modelId,
        Math.round(tokens * inputShare),
        Math.round(tokens * (1 - inputShare)),
    );
    return cost.priceSource === 'unknown' ? NaN : cost.totalUsd;
}

/**
 * Format an EUR amount for compact display in the UI footer using the
 * locale-aware German currency format. Uses up to 4 fraction digits so
 * sub-cent values stay legible (a Haiku query is often 0,0005 EUR).
 *
 *   0.0005 -> "0,0005 €"
 *   0.02   -> "0,02 €"
 *   1.23   -> "1,23 €"
 *
 * (Plan v2.10.0 user request: replace mixed ¢/€ format with a single
 * locale-correct currency representation.)
 */
const EUR_FORMATTER = new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
});

export function formatEur(eur: number): string {
    return EUR_FORMATTER.format(eur);
}
