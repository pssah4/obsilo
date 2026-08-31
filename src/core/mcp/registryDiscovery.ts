/**
 * registryDiscovery -- search client for the official MCP registry (FEAT-04-11).
 *
 * Talks to https://registry.modelcontextprotocol.io/v0.1 (API pinned; frozen
 * for breaking changes since 2025-10). Reads are unauthenticated. The registry
 * is minimally moderated, so this module is deliberately defensive:
 *
 * - Only entries with a hosted remote endpoint survive (streamable-http
 *   preferred, sse fallback); package-only entries (npm/pypi/oci, stdio) drop.
 * - Candidates must be https and pass the provider URL guard (SSRF) before
 *   they are ever rendered as addable.
 * - `version=latest` is mandatory (without it every version of every server
 *   appears as its own row -- live-verified).
 * - Entries whose registry status is not `active` drop; ai.smithery/* mirror
 *   entries drop in wave 1 (they proxy through Smithery and need a foreign
 *   API key); templated URLs ({variable}) drop in wave 1.
 * - Publisher verification derives from the namespace (domain-verified
 *   reverse-DNS vs io.github.* account); the registry does NOT bind the
 *   remote URL to the verified domain, so a host mismatch is surfaced.
 * - Brand look-alikes of curated catalog connectors are flagged.
 *
 * Observed registry latency is 13-20s per request: callers must search on
 * explicit submit only, keep a session cache, and use the default 30s timeout.
 *
 * Wayfinder: src/ARCHITECTURE.map concept `mcp-registry-discovery`.
 */

import { validateProviderUrl } from '../../api/providers/providerUrlGuard';
import { MCP_CONNECTOR_CATALOG } from './connectorCatalog';

/** Normalized (lowercase, no trailing slash) URLs of the curated built-in
 *  catalog. A registry entry pointing at one of these IS our vouched-for
 *  first-party server, so it earns the "Official" marker. */
const CATALOG_URLS: ReadonlySet<string> = new Set(
    MCP_CONNECTOR_CATALOG.filter((e) => e.url).map((e) => e.url!.toLowerCase().replace(/\/+$/, '')),
);

function normalizeUrlForMatch(url: string): string {
    return url.toLowerCase().replace(/\/+$/, '');
}

export const MCP_REGISTRY_BASE = 'https://registry.modelcontextprotocol.io/v0.1';
const REGISTRY_META_KEY = 'io.modelcontextprotocol.registry/official';
const DEFAULT_TIMEOUT_MS = 30_000;
// Max accepted by the registry (probe: 100 entries ~= 78 KB). High yield per
// request matters because most entries are package-only and get filtered out.
const PAGE_LIMIT = 100;

export interface RegistryDiscoveryResult {
    /** Reverse-DNS registry name, e.g. "com.notion/mcp". */
    registryName: string;
    /** Sanitized settings map key, e.g. "com.notion.mcp". */
    key: string;
    displayName: string;
    description: string;
    url: string;
    transport: 'streamable-http' | 'sse';
    verification: 'domain' | 'github' | null;
    /**
     * Human-readable publisher identity: the DNS-verified domain
     * ("notion.com") or the GitHub handle ("@user"); null when unverified.
     */
    publisher: string | null;
    /** https source-repository link from the registry entry, if any. */
    repositoryUrl: string | null;
    /** https documentation/website link from the registry entry, if any. */
    websiteUrl: string | null;
    /** Names of required secret headers (empty for OAuth-or-open endpoints). */
    requiredSecretHeaders: string[];
    /** Secret headers with the registry's own description, for setup hints. */
    secretHeaders: { name: string; description: string }[];
    /** Curated brand this entry imitates without being its verified publisher. */
    brandWarning: string | null;
    /** Domain-verified namespace whose domain does not cover the endpoint host. */
    hostMismatch: boolean;
    /** True when the current settings already contain this server. */
    alreadyAdded: boolean;
    /**
     * A curated first-party server surfaced directly (fetchRegistryEntry),
     * bypassing the registry's substring-search ranking which buries
     * well-known official servers under thousands of same-namespace entries.
     */
    official?: boolean;
    /**
     * FEAT-04-13: 'stdio' for a curated local-program catalog entry. Such a
     * result has no url/remote endpoint; the Add flow routes it into the
     * guided stdio setup (device-local store + trust) instead of the url add.
     */
    catalogKind?: 'remote' | 'stdio';
}

/**
 * Curated official servers the registry search cannot surface for a generic
 * brand term (its name-substring match + alphabetical order buries them). Each
 * is fetched directly and pinned to the top. Keep this list small and truly
 * first-party.
 */
export interface FeaturedOfficial {
    terms: string[];
    registryName: string;
    /** Friendly service name to show instead of the registry title/segment. */
    displayName?: string;
}

export const FEATURED_OFFICIAL: FeaturedOfficial[] = [
    {
        terms: ['github', 'repo', 'repository', 'pull request', 'issues', 'actions', 'workflow'],
        registryName: 'io.github.github/github-mcp-server',
        displayName: 'GitHub',
    },
];

/** Registry names to fetch directly and pin for a search term (min 3 chars). */
export function featuredNamesForTerm(term: string): string[] {
    const n = term.trim().toLowerCase();
    if (n.length < 3) return [];
    const out: string[] = [];
    for (const f of FEATURED_OFFICIAL) {
        if (f.terms.some((keyword) => keyword.includes(n) || n.includes(keyword))) {
            out.push(f.registryName);
        }
    }
    return out;
}

/**
 * Fetch a single registry entry by name (detail endpoint) and map it through
 * the same connectability filters. Returns null if it is not connectable.
 * Used to pin featured official servers.
 */
export async function fetchRegistryEntry(
    name: string,
    opts: { existingKeys: Set<string>; timeoutMs?: number; fetcher: (url: string) => Promise<unknown> },
): Promise<RegistryDiscoveryResult | null> {
    const url = `${MCP_REGISTRY_BASE}/servers/${encodeURIComponent(name)}/versions/latest`;
    const payload = await withTimeout(opts.fetcher(url), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    // The detail endpoint returns a single { server, _meta }; wrap it so the
    // shared parser applies the exact same filters as the list flow.
    const page = parseRegistryResponse({ servers: [payload], metadata: {} }, opts.existingKeys, '');
    const result = page.results[0];
    if (!result) return null;
    result.official = true;
    // Prefer the curated friendly name over the registry title/segment
    // (e.g. "GitHub" instead of "github-mcp-server").
    const featured = FEATURED_OFFICIAL.find((f) => f.registryName === name);
    if (featured?.displayName) result.displayName = featured.displayName;
    return result;
}

/**
 * Curated catalog connectors, rendered as discovery results so the search is
 * the single place to add a connector (the hidden-catalog model). They are our
 * vouched-for first-party servers, so each is flagged `official`. Many are not
 * in the registry at all (Plaud, Exa, Tavily, Readwise, Atlassian), so only
 * this local source can surface them. An empty `term` returns the full catalog
 * (the "popular" default); a non-empty `term` filters by id/name/description/
 * context tag. Entries already present (by endpoint) are dropped.
 */
export function catalogDiscoveryResults(term: string, existingUrls: ReadonlySet<string>): RegistryDiscoveryResult[] {
    const needle = term.trim().toLowerCase();
    const out: RegistryDiscoveryResult[] = [];
    for (const e of MCP_CONNECTOR_CATALOG) {
        // Remote entries dedupe by endpoint; stdio entries have no url.
        if (e.url && existingUrls.has(normalizeUrlForMatch(e.url))) continue;
        const matches = !needle
            || e.id.includes(needle)
            || e.displayName.toLowerCase().includes(needle)
            || e.description.toLowerCase().includes(needle)
            || e.contextTags.some((tag) => tag.includes(needle));
        if (!matches) continue;
        out.push({
            registryName: e.id,
            key: e.id,
            displayName: e.displayName,
            description: e.description,
            url: e.url ?? '',
            transport: e.transport ?? 'streamable-http',
            verification: null,
            publisher: null,
            repositoryUrl: null,
            websiteUrl: null,
            requiredSecretHeaders: [],
            secretHeaders: [],
            brandWarning: null,
            hostMismatch: false,
            alreadyAdded: false,
            official: true,
            catalogKind: e.kind ?? 'remote',
        });
    }
    return out;
}

export interface RegistrySearchPage {
    results: RegistryDiscoveryResult[];
    nextCursor: string | null;
    /** Raw entry count of the page, before the connectability filters. */
    totalSeen: number;
}

export interface RegistrySearchOptions {
    existingKeys: Set<string>;
    cursor?: string;
    timeoutMs?: number;
    /**
     * HTTP transport, injected by the caller (McpTab passes an Obsidian
     * requestUrl wrapper). Required: this module must stay free of obsidian
     * imports -- a dynamic import('obsidian') survives esbuild's CJS bundle
     * as a native dynamic import and fails at runtime in the renderer.
     */
    fetcher: (url: string) => Promise<unknown>;
}

export function buildSearchUrl(term: string, cursor?: string): string {
    let url = `${MCP_REGISTRY_BASE}/servers?search=${encodeURIComponent(term)}&version=latest&limit=${PAGE_LIMIT}`;
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
    return url;
}

/** "com.notion/mcp" -> "com.notion.mcp" (valid, readable settings key). */
export function sanitizeServerKey(registryName: string): string {
    return registryName.replace(/\//g, '.');
}

export async function searchMcpRegistry(term: string, opts: RegistrySearchOptions): Promise<RegistrySearchPage> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const url = buildSearchUrl(term, opts.cursor);
    const payload = await withTimeout(opts.fetcher(url), timeoutMs);
    return parseRegistryResponse(payload, opts.existingKeys, term);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
        p,
        new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error(`Registry request timed out after ${Math.round(ms / 1000)}s`)), ms)),
    ]);
}

/**
 * Pure parser/filter for a /v0.1/servers response. Malformed entries drop
 * silently; this function never throws on foreign data.
 *
 * The registry searches by name substring, so a term like "github" floods the
 * page with unrelated io.github.* namespaces. Results are therefore ranked:
 * term match in the name segment (after the slash) first, domain-verified
 * publishers before GitHub-verified ones, then registry order.
 */
export function parseRegistryResponse(json: unknown, existingKeys: Set<string>, term = ''): RegistrySearchPage {
    const results: RegistryDiscoveryResult[] = [];
    const root = asRecord(json);
    const servers = Array.isArray(root?.servers) ? root.servers : [];
    for (const raw of servers) {
        const mapped = mapEntry(asRecord(raw), existingKeys);
        if (mapped) results.push(mapped);
    }
    const needle = term.trim().toLowerCase();
    const contentMatch = (r: RegistryDiscoveryResult): boolean => {
        const segment = r.registryName.slice(r.registryName.indexOf('/') + 1).toLowerCase();
        return segment.includes(needle)
            || r.displayName.toLowerCase().includes(needle)
            || r.description.toLowerCase().includes(needle);
    };
    // Search noise: terms like "github" substring-match EVERY io.github.*
    // namespace regardless of what the server does. Drop entries whose only
    // match is the literal "io.github." prefix itself (a username needle like
    // "someone" is not inside that prefix and survives).
    let visible = results;
    if (needle && 'io.github.'.includes(needle)) {
        visible = results.filter((r) => contentMatch(r) || !r.registryName.toLowerCase().startsWith('io.github.'));
    }
    const rank = (r: RegistryDiscoveryResult): number => {
        let score = 0;
        if (needle && contentMatch(r)) score -= 2;
        if (r.verification === 'domain') score -= 1;
        return score;
    };
    visible.sort((a, b) => rank(a) - rank(b));
    const metadata = asRecord(root?.metadata);
    const nextCursor = typeof metadata?.nextCursor === 'string' && metadata.nextCursor ? metadata.nextCursor : null;
    return { results: visible, nextCursor, totalSeen: servers.length };
}

function mapEntry(entry: Record<string, unknown> | null, existingKeys: Set<string>): RegistryDiscoveryResult | null {
    if (!entry) return null;
    const server = asRecord(entry.server);
    if (!server) return null;
    const name = typeof server.name === 'string' ? server.name : '';
    if (!name || !name.includes('/')) return null;

    // Wave 1: Smithery mirror entries proxy through third-party infrastructure
    // and require a foreign API key; adding them blind produces dead servers.
    if (name.startsWith('ai.smithery/')) return null;

    // Registry status gate (active only).
    const meta = asRecord(asRecord(entry._meta)?.[REGISTRY_META_KEY]);
    if (meta && typeof meta.status === 'string' && meta.status !== 'active') return null;

    // Remote selection: streamable-http preferred, sse fallback.
    const remotes = Array.isArray(server.remotes) ? server.remotes.map(asRecord) : [];
    const remote = remotes.find((r) => r?.type === 'streamable-http') ?? remotes.find((r) => r?.type === 'sse');
    if (!remote) return null;
    const url = typeof remote.url === 'string' ? remote.url : '';
    if (!url.startsWith('https://')) return null;
    if (/\{[^}]*\}/.test(url)) return null; // templated multi-tenant URL (wave 2)
    try {
        validateProviderUrl('custom', url, { allowLocalhost: false });
    } catch {
        return null;
    }

    const namespace = name.slice(0, name.indexOf('/'));
    const segment = name.slice(name.indexOf('/') + 1);
    const verification: RegistryDiscoveryResult['verification'] =
        namespace.startsWith('io.github.') ? 'github' : namespace.includes('.') ? 'domain' : null;

    // A domain-verified namespace ("com.notion") claims a domain ("notion.com").
    // Checking and displaying that claim both go through verifiedDomainSuffix,
    // which slices the real host instead of composing a domain from namespace
    // parts, so no hostname exists here that the registry response did not.
    let hostMismatch = false;
    let publisher: string | null = null;
    if (verification === 'github') {
        publisher = `@${namespace.slice('io.github.'.length)}`;
    } else if (verification === 'domain') {
        let host: string;
        try {
            host = new URL(url).hostname.toLowerCase();
        } catch {
            return null;
        }
        const verified = verifiedDomainSuffix(host, namespace);
        hostMismatch = verified === null;
        // Claim not backed by the endpoint: show the namespace as the registry
        // spells it, next to the hostWarn line, rather than a domain this
        // server does not answer for.
        publisher = verified ?? namespace;
    }

    // Brand look-alike: mentions a curated brand without being its publisher.
    const haystack = `${segment} ${typeof server.title === 'string' ? server.title : ''}`.toLowerCase();
    let brandWarning: string | null = null;
    for (const catalogEntry of MCP_CONNECTOR_CATALOG) {
        const brand = catalogEntry.id.toLowerCase();
        if (haystack.includes(brand) && !namespace.toLowerCase().includes(brand)) {
            brandWarning = brand;
            break;
        }
    }

    // A header flagged isSecret needs a user-supplied value even when the
    // registry omits isRequired (a secret header with no value is useless).
    // The official GitHub entry, for example, marks Authorization isSecret
    // without isRequired.
    const headers = Array.isArray(remote.headers) ? remote.headers.map(asRecord) : [];
    const secretHeaders = headers
        .filter((h) => h?.isSecret === true && typeof h.name === 'string')
        .map((h) => ({ name: h!.name as string, description: typeof h!.description === 'string' ? h!.description : '' }));
    const requiredSecretHeaders = secretHeaders.map((h) => h.name);

    const key = sanitizeServerKey(name);
    return {
        registryName: name,
        key,
        displayName: typeof server.title === 'string' && server.title ? server.title : segment,
        description: typeof server.description === 'string' ? server.description : '',
        url,
        transport: remote.type as 'streamable-http' | 'sse',
        verification,
        publisher,
        official: CATALOG_URLS.has(normalizeUrlForMatch(url)) || undefined,
        repositoryUrl: httpsOrNull(asRecord(server.repository)?.url),
        websiteUrl: httpsOrNull(server.websiteUrl),
        requiredSecretHeaders,
        secretHeaders,
        brandWarning,
        hostMismatch,
        alreadyAdded: existingKeys.has(key),
    };
}

/**
 * The registry's reverse-DNS namespace ("com.notion") claims control of a
 * domain ("notion.com"). Returns that domain as a SLICE OF THE ACTUAL HOST
 * when the claim holds, otherwise null.
 *
 * Compares label by label and slices, rather than reversing the namespace into
 * a domain string: the only hostname this can return is one that already
 * arrived in the registry response, so the anti-spoofing check and the
 * publisher badge cannot disagree, and nothing composes an endpoint at
 * runtime. Label-wise comparison also keeps the boundary the string form got
 * from `endsWith('.' + domain)`, so "evilnotion.com" stays a mismatch for
 * "com.notion".
 */
function verifiedDomainSuffix(host: string, namespace: string): string | null {
    const nsLabels = namespace.split('.');
    const hostLabels = host.split('.');
    if (hostLabels.length < nsLabels.length) return null;
    // Reverse-DNS order: the i-th namespace label is the i-th host label from
    // the end. "com.notion" against "mcp.notion.com" walks com/com, notion/notion.
    for (const [i, claimedLabel] of nsLabels.entries()) {
        if (hostLabels.at(-1 - i) !== claimedLabel) return null;
    }
    // Walk past the labels the namespace does not claim; what remains is the
    // claimed domain, verbatim from `host`.
    let start = 0;
    for (let extra = hostLabels.length - nsLabels.length; extra > 0; extra--) {
        start = host.indexOf('.', start) + 1;
    }
    return host.slice(start);
}

function asRecord(v: unknown): Record<string, unknown> | null {
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Registry strings are attacker-controlled: accept https URLs only. */
function httpsOrNull(v: unknown): string | null {
    if (typeof v !== 'string' || !v.startsWith('https://')) return null;
    try {
        new URL(v);
        return v;
    } catch {
        return null;
    }
}
