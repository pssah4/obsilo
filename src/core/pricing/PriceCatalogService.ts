/**
 * PriceCatalogService -- live model prices from OpenRouter (IMP-24-05-02)
 *
 * The static PRICING table in ModelPricing.ts drifts (FIX-24-05-01 found
 * it up to 30x off) and its staleness warning reaches nobody. OpenRouter's
 * public /v1/models endpoint carries current vendor rates for all common
 * models -- including the ones served via Bedrock -- with cache-read/write
 * rates where the vendor bills them. We fetch it at most once per 24h,
 * persist the snapshot, and feed it into ModelPricing as the preferred
 * price source. Offline or pre-first-fetch behavior is unchanged (static
 * table, then FALLBACK).
 *
 * The prices are a best-guess approximation by design: OpenRouter passes
 * vendor rates through, but regional platform pricing (e.g. Bedrock EU)
 * can deviate in edge cases.
 */

import { requestUrl } from 'obsidian';
import { setLivePriceCatalog, type ModelPrice } from './ModelPricing';
import type { FileAdapter } from '../storage/types';

/** Persisted snapshot path, relative to the GlobalFS data root. */
export const PRICE_CATALOG_FILE = 'price-catalog.json';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Normalize an OpenRouter id to the static-table key style: strip the
 * vendor prefix, lowercase, version dots to dashes ("anthropic/claude-
 * haiku-4.5" -> "claude-haiku-4-5", which also substring-matches Bedrock
 * ids). Colon variants (":free", ":extended") carry different pricing
 * tiers and are skipped.
 */
/**
 * AUDIT-2026-07-02 I-2: keys that would touch an object's prototype when
 * used in bracket assignment. Skipped defensively even though the current
 * flat assignment does not reach Object.prototype.
 */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** AUDIT-2026-07-02 I-1: cap parsed entries so a hostile catalog can't bloat memory. */
const MAX_CATALOG_ENTRIES = 10_000;
/** AUDIT-2026-07-02 L-1: reject per-1M prices outside a sane range (must be > 0). */
const MAX_PLAUSIBLE_PER_MILLION = 10_000;

export function normalizeCatalogKey(id: string): string | null {
    if (id.includes(':')) return null;
    const bare = id.includes('/') ? id.slice(id.indexOf('/') + 1) : id;
    if (!bare) return null;
    const key = bare.toLowerCase().replace(/(\d)\.(\d)/g, '$1-$2');
    if (UNSAFE_KEYS.has(key)) return null;
    return key;
}

/**
 * Parse the OpenRouter /v1/models wire format (per-token USD strings)
 * into a per-1M-token catalog. Entries without prompt+completion pricing
 * are skipped; cache rates are only set when the vendor bills them.
 */
export function parseOpenRouterCatalog(json: unknown): Record<string, ModelPrice> {
    const catalog: Record<string, ModelPrice> = {};
    const data = (json as { data?: unknown } | null)?.data;
    if (!Array.isArray(data)) return catalog;
    // AUDIT-2026-07-02 L-1: a per-1M price is only accepted when strictly
    // positive and within a plausible range -- a hostile endpoint or
    // tampered file must not inject negative or absurd rates into the cost
    // display. `required=false` allows optional cache rates to be absent.
    const perMillion = (v: unknown, required: boolean): number | undefined => {
        if (v === undefined && !required) return undefined;
        if (typeof v !== 'string' && typeof v !== 'number') return undefined;
        const n = (typeof v === 'string' ? parseFloat(v) : v) * 1_000_000;
        if (!Number.isFinite(n) || n <= 0 || n > MAX_PLAUSIBLE_PER_MILLION) return undefined;
        return n;
    };
    // AUDIT-2026-07-02 I-1 bound, counted incrementally. FIX-24-05-10: this used
    // to read `Object.keys(catalog).length` per iteration, which allocates the
    // whole key array every time -- quadratic in accepted entries, so the guard
    // against an oversized catalog was itself the expensive part of parsing one.
    // Measured 2.9s for 10k accepted entries on the boot path (refreshIfStale).
    // The counter tracks DISTINCT keys, exactly like Object.keys did, so a
    // catalog with repeated ids keeps the same entries as before.
    let distinctKeys = 0;
    for (const entry of data) {
        if (distinctKeys >= MAX_CATALOG_ENTRIES) break;
        const e = entry as { id?: unknown; pricing?: Record<string, unknown> };
        if (typeof e.id !== 'string' || !e.pricing) continue;
        const key = normalizeCatalogKey(e.id);
        if (!key) continue;
        const input = perMillion(e.pricing.prompt, true);
        const output = perMillion(e.pricing.completion, true);
        if (input === undefined || output === undefined) continue;
        const price: ModelPrice = { inputPerMillionUsd: input, outputPerMillionUsd: output };
        const cacheRead = perMillion(e.pricing.input_cache_read, false);
        const cacheWrite = perMillion(e.pricing.input_cache_write, false);
        if (cacheRead !== undefined) price.cacheReadPerMillionUsd = cacheRead;
        if (cacheWrite !== undefined) price.cacheWritePerMillionUsd = cacheWrite;
        // hasOwnProperty rather than `key in catalog`, which walks the prototype
        // chain. `in` happens to be safe here only by coincidence: the key is
        // lowercased and every Object.prototype member is camelCase, so
        // 'constructor' is the single possible collision and UNSAFE_KEYS already
        // drops it. This form does not depend on that holding.
        if (!Object.prototype.hasOwnProperty.call(catalog, key)) distinctKeys++;
        catalog[key] = price;
    }
    return catalog;
}

/**
 * AUDIT-2026-07-02 L-1: re-validate a catalog loaded from the on-disk
 * snapshot -- the file lives in the vault and could be tampered with, so
 * apply the same value bounds as parseOpenRouterCatalog rather than
 * trusting persisted entries. Drops entries with a non-positive or absurd
 * required price; clears out-of-range cache rates.
 */
export function sanitizeCatalog(catalog: Record<string, ModelPrice>): Record<string, ModelPrice> {
    const clean: Record<string, ModelPrice> = {};
    const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= MAX_PLAUSIBLE_PER_MILLION;
    for (const [key, p] of Object.entries(catalog)) {
        if (UNSAFE_KEYS.has(key) || !p || typeof p !== 'object') continue;
        if (!ok(p.inputPerMillionUsd) || !ok(p.outputPerMillionUsd)) continue;
        const price: ModelPrice = { inputPerMillionUsd: p.inputPerMillionUsd, outputPerMillionUsd: p.outputPerMillionUsd };
        if (ok(p.cacheReadPerMillionUsd)) price.cacheReadPerMillionUsd = p.cacheReadPerMillionUsd;
        if (ok(p.cacheWritePerMillionUsd)) price.cacheWritePerMillionUsd = p.cacheWritePerMillionUsd;
        clean[key] = price;
    }
    return clean;
}

interface PersistedCatalog {
    fetchedAt: number;
    catalog: Record<string, ModelPrice>;
}

async function fetchOpenRouterModels(): Promise<unknown> {
    const res = await requestUrl({ url: OPENROUTER_MODELS_URL, method: 'GET', throw: false });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    return res.json;
}

export class PriceCatalogService {
    private fetchedAt = 0;

    constructor(
        private fs: FileAdapter,
        private fetchJson: () => Promise<unknown> = fetchOpenRouterModels,
    ) {}

    /** Apply a previously persisted snapshot -- no network involved. */
    async load(): Promise<void> {
        try {
            if (!(await this.fs.exists(PRICE_CATALOG_FILE))) return;
            const raw = await this.fs.read(PRICE_CATALOG_FILE);
            const parsed = JSON.parse(raw) as PersistedCatalog;
            if (typeof parsed?.fetchedAt !== 'number' || !parsed.catalog || Object.keys(parsed.catalog).length === 0) return;
            // AUDIT-2026-07-02 L-1: re-validate persisted entries (the file
            // is vault-resident and could be tampered with).
            const clean = sanitizeCatalog(parsed.catalog);
            if (Object.keys(clean).length === 0) return;
            this.fetchedAt = parsed.fetchedAt;
            setLivePriceCatalog(clean);
        } catch (e) {
            console.warn('[PriceCatalog] load failed (non-fatal):', e);
        }
    }

    /**
     * FEAT-24-12: when the catalog on screen was fetched, or null when this
     * session has never applied one. The settings UI shows it so a price the
     * user is looking at carries its own age; before this getter the private
     * stamp had no reader and the age was invisible.
     */
    getLastFetchedAt(): number | null {
        return this.fetchedAt === 0 ? null : this.fetchedAt;
    }

    /**
     * Fetch a fresh catalog. The 24h TTL gate is right for the boot refresh
     * and wrong for a user who just pressed a button, so `force` skips it
     * (FEAT-24-12): without a force path the only ways to refetch were to
     * wait a day or delete the snapshot file.
     *
     * Returns true when a new catalog was applied and persisted. Best-effort
     * either way: failures leave the current pricing (persisted snapshot or
     * static table) untouched, and the boolean is what lets a manual refresh
     * tell the user it did not work instead of looking successful.
     */
    async refresh(options: { force?: boolean } = {}): Promise<boolean> {
        if (!options.force && Date.now() - this.fetchedAt < TTL_MS) return false;
        try {
            const json = await this.fetchJson();
            const catalog = parseOpenRouterCatalog(json);
            // Defensive: never replace a working catalog with an empty one.
            if (Object.keys(catalog).length === 0) return false;
            this.fetchedAt = Date.now();
            setLivePriceCatalog(catalog);
            await this.fs.write(PRICE_CATALOG_FILE, JSON.stringify({ fetchedAt: this.fetchedAt, catalog } satisfies PersistedCatalog));
            return true;
        } catch (e) {
            console.warn('[PriceCatalog] refresh failed (non-fatal):', e);
            return false;
        }
    }

    /** Boot path: refresh only when the current catalog is older than 24h. */
    async refreshIfStale(): Promise<boolean> {
        return this.refresh();
    }
}
