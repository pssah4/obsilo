/**
 * Provider Cache Capabilities
 *
 * Single source of truth for prompt-caching capability per provider/model.
 * Both the settings UI (toggle visibility) and the provider implementations
 * (cache-style dispatch) read from getCacheCapability().
 *
 * Architecture: ADR-111 (Provider Capability-Flag und Bedrock cachePoint).
 * IMPs: IMP-18-01-01 (this module + UI wiring), IMP-18-01-02 (provider wiring).
 *
 * Wayfinder: src/ARCHITECTURE.map row "cache-capability".
 *
 * To extend: add an entry to CACHE_CAPABILITY_TABLE. Specific patterns first,
 * generic last. Conservative default for unknown patterns is none.
 */

import type { ProviderType } from '../types/settings';

/**
 * How a provider expects cache markers to be set:
 * - anthropic-ephemeral: explicit cache_control on system + last user message
 * - bedrock-cachepoint: explicit cachePoint ContentBlock (Bedrock + Anthropic model)
 * - openai-implicit: automatic cache for prompts >1024 tokens; cached_tokens tracking only
 * - passthrough: anthropic-style cache_control forwarded through a gateway
 * - none: provider does not support prompt caching (or not implemented yet)
 */
export type CacheStyle =
    | 'anthropic-ephemeral'
    | 'bedrock-cachepoint'
    | 'openai-implicit'
    | 'passthrough'
    // IMP-18-01-04: Copilot's own forms, one per route. `copilot_cache_control`
    // on the message for /chat/completions, `prompt_cache_breakpoint` on the
    // content part for /responses. One style rather than two, because the route
    // is a runtime property of the model and not something a table row can
    // express; the provider picks the field.
    | 'copilot-cache-control'
    | 'none';

/**
 * Styles that need a marker IN THE REQUEST.
 *
 * A style outside this set caches server-side without our help: there is
 * nothing to send, and consequently nothing for the user to switch. The
 * distinction matters in two places that used to conflate it:
 *
 *  - the settings UI, which showed a prompt-caching checkbox for gpt-4o where
 *    the checkbox could not change anything (implicit cache);
 *  - the capability contract test, which can only demand a producer for a
 *    style that is supposed to produce something.
 *
 * `supportsPromptCache` answers "does this provider cache at all" and drives
 * the cost display. This set answers "does Vault Operator have to say so" and
 * drives the toggle plus the contract test. Keeping them apart is what lets
 * the table report a measured implicit cache honestly without growing a
 * placebo switch.
 */
export const MARKER_BEARING_STYLES: ReadonlySet<CacheStyle> = new Set<CacheStyle>([
    'anthropic-ephemeral',
    'bedrock-cachepoint',
    'passthrough',
    'copilot-cache-control',
]);

export interface CacheCapabilityEntry {
    providerType: ProviderType;
    /** Glob-style pattern with `*` as wildcard. Matched against the model id (case-insensitive). */
    modelPattern: string;
    supportsPromptCache: boolean;
    cacheStyle: CacheStyle;
    /** Optional rationale; not consumed at runtime, helps maintainers. */
    notes?: string;
}

/**
 * Capability table. Order matters: the first matching entry wins.
 * Specific patterns must come before generic ones.
 */
export const CACHE_CAPABILITY_TABLE: ReadonlyArray<CacheCapabilityEntry> = [
    // --- Anthropic direct (existing behaviour, FEAT-18-01) ---
    { providerType: 'anthropic', modelPattern: 'claude-*', supportsPromptCache: true, cacheStyle: 'anthropic-ephemeral', notes: 'cache_control: ephemeral on system + last user message' },

    // --- GitHub Copilot ---
    // D4 (2026-08-28): the claude-* row used to claim 'anthropic-ephemeral'. That
    // was wrong in form, not just unimplemented: Copilot requests are built by
    // convertToOpenAiChatMessages (OpenAI shape), while anthropic-ephemeral is
    // only ever produced by anthropicBlocks.ts. Verified against the bundled
    // VS Code Copilot extension (dist/extension.js) rather than the docs:
    //   - /chat/completions expects `copilot_cache_control: {type:'ephemeral'}`
    //     on the MESSAGE, not `cache_control` on a content part
    //   - /responses expects `prompt_cache_breakpoint` on the part plus
    //     `prompt_cache_options: {mode}` at request level
    // Both are a third marker form with no producer here yet, so the honest
    // entry is none until that producer ships with its own measurement. The
    // 'cache_control' hits in the same bundle belong to its Anthropic-direct
    // BYOK path (they build tool_use/thinking/system arrays), not to the
    // Copilot API.
    // IMP-18-01-04: both producers now exist, so the row states the real style.
    // Billing note that makes this worth doing: Copilot is metered per token as
    // AI credits (1 credit = 0.01 USD), and cached input costs 0.1x while a cache
    // write costs 1.25x. It is not a flat subscription.
    { providerType: 'github-copilot', modelPattern: '*', supportsPromptCache: true, cacheStyle: 'copilot-cache-control', notes: 'copilot_cache_control on the message for /chat/completions, prompt_cache_breakpoint on the content part for /responses; both verified against the bundled VS Code extension 2026-08-28' },

    // --- Bedrock (Phase 2: explicit cachePoint markers) ---
    // FIX-18-01-01: segment-wise prefix pattern instead of an enumerated
    // eu./us. list. The `global.` cross-region profile fell through to the
    // cache-off fallback (live incident 2026-07-03: hitRate=0% on every
    // Sonnet-5 call, $0.62 for one short chain); any future region prefix
    // (apac., us-gov.) would have driftet the same way.
    { providerType: 'bedrock', modelPattern: '*anthropic.claude-*', supportsPromptCache: true, cacheStyle: 'bedrock-cachepoint', notes: 'Anthropic Claude in every region flavour: bare, eu., us., global., apac., ARNs' },
    { providerType: 'bedrock', modelPattern: '*', supportsPromptCache: false, cacheStyle: 'none', notes: 'Amazon Nova and other Bedrock models: no cachePoint support yet' },

    // --- OpenAI (implicit cache for >1024 tokens, cached_tokens tracking in Phase 2) ---
    // AP4 (2026-08-28): the gpt-5 generation used to fall through to the `*` row
    // and report caching=OFF for a family that caches implicitly. Verified from
    // two independent vendor sources: the OpenRouter provider table ("OpenAI:
    // automated, does not require any additional configuration, minimum 1,024
    // tokens") and the AWS Bedrock prompt-caching guide for OpenAI models
    // ("prior to GPT-5.6 ... caching is automatic ... prefixes of 1,024 tokens or
    // longer"). Corroborated by measurement: the gpt-5.6 lineup returns a 51-58%
    // cache-read share in the 2026-08 telemetry. Implicit style sends no marker,
    // so no request byte changes and the entry only makes the diagnostic honest.
    //
    // Deliberately NOT modelled here: gpt-5.6 also accepts EXPLICIT breakpoints
    // (prompt_cache_breakpoint plus prompt_cache_options on the Responses API).
    // That is a marker-bearing style with no producer yet, so claiming it would
    // be the D4 defect again. It belongs to the Copilot/Responses delivery.
    { providerType: 'openai', modelPattern: 'gpt-5*', supportsPromptCache: true, cacheStyle: 'openai-implicit', notes: 'Implicit cache from 1024 tokens; explicit prompt_cache_breakpoint on /responses is deferred until a producer exists' },
    { providerType: 'openai', modelPattern: 'gpt-4o*', supportsPromptCache: true, cacheStyle: 'openai-implicit', notes: 'Implicit cache, 50% discount on cached prefix' },
    { providerType: 'openai', modelPattern: 'gpt-4.1*', supportsPromptCache: true, cacheStyle: 'openai-implicit' },
    { providerType: 'openai', modelPattern: 'o1*', supportsPromptCache: true, cacheStyle: 'openai-implicit' },
    { providerType: 'openai', modelPattern: 'o3*', supportsPromptCache: true, cacheStyle: 'openai-implicit' },
    { providerType: 'openai', modelPattern: 'o4*', supportsPromptCache: true, cacheStyle: 'openai-implicit' },
    { providerType: 'openai', modelPattern: '*', supportsPromptCache: false, cacheStyle: 'none', notes: 'gpt-3.5 and legacy gpt-4: no implicit cache' },

    // --- Kilo Gateway (Anthropic-format passthrough) ---
    // D4 decision 2026-08-28: kept as passthrough rather than downgraded to none.
    // The wire form is verified from the vendor's own client, which is stronger
    // than a doc page: forked-kilocode/src/api/transform/caching/kilocode.ts
    // sends cache_control on system plus the last two user/tool messages to this
    // very gateway. Not measured live here -- no gateway account is configured --
    // so the producer is the shared OpenAI-shape marker code and the claim is
    // "wire form verified, hit rate unmeasured", not "verified working".
    { providerType: 'kilo-gateway', modelPattern: '*', supportsPromptCache: true, cacheStyle: 'passthrough', notes: 'Anthropic-format cache_control passthrough; wire form verified against the vendor client (kilocode.ts), hit rate not measured live' },

    // --- Out of scope for cache (kept explicit for clarity) ---
    { providerType: 'chatgpt-oauth', modelPattern: '*', supportsPromptCache: false, cacheStyle: 'none', notes: 'Unofficial backend API, no documented caching' },
    { providerType: 'gemini', modelPattern: '*', supportsPromptCache: false, cacheStyle: 'none', notes: 'Gemini Context Caching is TTL-based, separate mechanism, deferred (FEAT-18-01 out of scope)' },
    { providerType: 'ollama', modelPattern: '*', supportsPromptCache: false, cacheStyle: 'none', notes: 'Local inference, no API-level cache concept' },
    { providerType: 'lmstudio', modelPattern: '*', supportsPromptCache: false, cacheStyle: 'none', notes: 'Local inference' },
    // --- OpenRouter (AP3: explicit cache_control passthrough to Anthropic upstream) ---
    // Verified 2026-08-28 against https://openrouter.ai/docs/features/prompt-caching:
    // `cache_control: {type:'ephemeral'}` on an individual content part, max four
    // explicit breakpoints, usage returns prompt_tokens_details.cached_tokens and
    // .cache_write_tokens. Anthropic rates via OpenRouter: read 0.1x, write 1.25x
    // at the 5-minute TTL. Minimum cacheable prefix 1024 tokens for Sonnet
    // (4096 for Opus 4.5+ and Haiku 4.5); our prompts run ~60k, so it never binds.
    // Cross-checked against Kilo Code, which gates the same way
    // (forked-kilocode openrouter.ts: modelId.startsWith('anthropic/claude')).
    { providerType: 'openrouter', modelPattern: 'anthropic/claude-*', supportsPromptCache: true, cacheStyle: 'passthrough', notes: 'Explicit cache_control on content parts, forwarded to Anthropic upstream (docs 2026-08-28)' },
    // Everything else on OpenRouter stays none, for two different reasons that
    // both end in "send nothing": GPT and DeepSeek cache automatically upstream,
    // and Gemini/Qwen would accept explicit breakpoints but have no measurement
    // here yet. A `true` on suspicion is what D4 was about.
    { providerType: 'openrouter', modelPattern: '*', supportsPromptCache: false, cacheStyle: 'none', notes: 'GPT/DeepSeek via OpenRouter cache implicitly (no markers to send); Gemini/Qwen support explicit cache_control but are unmeasured here' },
    { providerType: 'azure', modelPattern: '*', supportsPromptCache: false, cacheStyle: 'none', notes: 'OpenAI-compatible, but cached_tokens behaviour unverified' },
    { providerType: 'custom', modelPattern: '*', supportsPromptCache: false, cacheStyle: 'none', notes: 'OpenAI-compatible adapter, capability cannot be assumed' },
];

/**
 * Conservative fallback when no entry matches. Same shape as a real entry,
 * always returns supportsPromptCache=false / cacheStyle=none.
 */
function fallback(providerType: ProviderType, modelId: string): CacheCapabilityEntry {
    return {
        providerType,
        modelPattern: '*',
        supportsPromptCache: false,
        cacheStyle: 'none',
        notes: `No capability entry matched provider=${providerType} model=${modelId}, defaulting to none`,
    };
}

/**
 * Lookup the cache capability for a given provider and model id.
 * Returns the first matching entry, or a conservative fallback if no
 * pattern matches.
 */
export function getCacheCapability(providerType: ProviderType, modelId: string): CacheCapabilityEntry {
    const id = (modelId ?? '').toLowerCase();
    for (const entry of CACHE_CAPABILITY_TABLE) {
        if (entry.providerType !== providerType) continue;
        if (matchesPattern(entry.modelPattern, id)) {
            return entry;
        }
    }
    return fallback(providerType, modelId);
}

/**
 * Whether Vault Operator has to put cache markers into the request for this
 * (provider, model) pair. Drives the settings toggle: a provider that caches
 * implicitly gets no switch, because there is nothing a switch could do.
 */
export function requiresRequestMarkers(providerType: ProviderType, modelId: string): boolean {
    const cap = getCacheCapability(providerType, modelId);
    return cap.supportsPromptCache && MARKER_BEARING_STYLES.has(cap.cacheStyle);
}

/**
 * Simple glob match: only the `*` wildcard is supported (zero or more chars).
 * Pattern is lowercased; the model id is expected to be lowercased by the caller.
 */
function matchesPattern(pattern: string, modelId: string): boolean {
    const p = pattern.toLowerCase();
    if (p === '*') return true;
    if (!p.includes('*')) return p === modelId;
    // Convert glob to regex: escape regex specials except *, then * -> .*
    const escaped = p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`).test(modelId);
}
