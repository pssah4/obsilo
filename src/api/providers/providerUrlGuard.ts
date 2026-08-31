/**
 * SSRF guard for provider baseUrl/endpoint values (AUDIT-037 H-1, H-2).
 *
 * The OpenAI and Bedrock provider constructors used to accept `config.baseUrl`
 * verbatim. For provider types that route through createNodeFetch() (gemini,
 * custom, ollama, lmstudio) that bypasses Electron CORS and reaches private
 * networks (127/8, 169.254/16 AWS IMDS, RFC 1918 ranges). A compromised
 * settings file or a malicious model config payload could pivot the next API
 * call into the local network or AWS metadata.
 *
 * Strategy:
 *   - Known cloud providers (openai, anthropic, openrouter, azure, gemini,
 *     bedrock, kilo-gateway): hostname must match a hardcoded allow-list.
 *   - Local-by-design providers (ollama, lmstudio): loopback and private IPv4
 *     ranges are permitted; public hostnames are also fine because the user
 *     may run a tunnelled instance.
 *   - User-elected "custom" type: any HTTPS host is fine, but AWS IMDS
 *     (169.254.169.254 and the IPv6 fd00:ec2::254 form) and the catch-all
 *     0.0.0.0 are always refused. HTTP is allowed only for loopback / RFC 1918
 *     hosts so a local opencode-go on http://localhost:1234 keeps working.
 *
 * Failure mode is fail-closed: an invalid URL throws from the provider
 * constructor, surfacing a clear error instead of silently sending API keys to
 * a hostile endpoint.
 */

/**
 * Strict allow-list. Providers whose API surface always lives behind one
 * canonical host AND whose credentials would do real damage when leaked.
 * Bedrock is the canonical example: AWS IAM keys reach a *.amazonaws.com
 * host or nothing. Most other "cloud LLM" types are commonly used as
 * OpenAI-compatible aliases for community endpoints (DeepSeek, Together,
 * Groq, etc), so they live in PERMISSIVE_PROVIDERS instead.
 */
export const PROVIDER_HOST_ALLOWLIST: Record<string, RegExp[]> = {
    bedrock: [/^bedrock\.[a-z0-9-]+\.amazonaws\.com$/i, /^bedrock-runtime\.[a-z0-9-]+\.amazonaws\.com$/i],
};

/**
 * Permissive cloud providers: HTTPS to any public host is fine. Private IP
 * ranges and metadata hosts are still rejected so SSRF into the local
 * network or AWS IMDS cannot happen, but the user is free to point the
 * connection at deepseek.com, groq.com, together.xyz, etc.
 */
const PERMISSIVE_PROVIDERS = new Set([
    'openai',
    'azure',
    'anthropic',
    'openrouter',
    'gemini',
    'github-copilot',
    'chatgpt-oauth',
    'kilo-gateway',
]);

const LOCAL_PROVIDERS = new Set(['ollama', 'lmstudio']);

const BLOCKED_HOSTNAMES = new Set([
    '0.0.0.0',
    '::',
    '[::]',
    // AWS Instance Metadata Service
    '169.254.169.254',
    '[fd00:ec2::254]',
    'fd00:ec2::254',
    // Azure / GCP metadata
    'metadata.google.internal',
    '169.254.169.253',
]);

export interface ValidateUrlOptions {
    /** Explicit opt-in for the local-IP relaxation on a custom provider. */
    allowLocalhost?: boolean;
    /**
     * FEAT-26-07: opt-in for enterprise API-Gateway endpoints that proxy the
     * Bedrock Runtime ConverseStream API (e.g. an APIM host like
     * `gateway.apim.example.com/genai/bedrock`). When set together with
     * providerType='bedrock', the strict `*.amazonaws.com` allow-list is
     * skipped but every other SSRF check (HTTPS-only, BLOCKED_HOSTNAMES,
     * local/private IP) remains in force. No-op for other provider types.
     */
    gatewayMode?: boolean;
}

/**
 * Validates a provider URL. Returns the parsed URL on success and throws
 * a descriptive Error on rejection. Pass `undefined` through unchanged so
 * callers can fall back to a hardcoded DEFAULT.
 */
export function validateProviderUrl(
    providerType: string,
    rawUrl: string | undefined,
    opts: ValidateUrlOptions = {},
): URL | undefined {
    if (!rawUrl || !rawUrl.trim()) return undefined;
    const trimmed = rawUrl.trim();

    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        throw new Error(`Provider URL is not a valid URL: "${trimmed}"`);
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error(`Provider URL must use http(s): "${trimmed}"`);
    }

    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

    // AUDIT 2026-07-14 L-2: fold alternate IP encodings (decimal/hex/octal)
    // to dotted-quad before the metadata denylist. Otherwise `http://2852039166/`
    // (= 169.254.169.254) slips past BLOCKED_HOSTNAMES and, in the custom-provider
    // branch below (private IPs allowed), reaches AWS/GCP IMDS -- a blind SSRF
    // that contradicts the "IMDS always refused" contract.
    const canonicalIp = normalizeIpv4Encoding(hostname);
    if (
        BLOCKED_HOSTNAMES.has(hostname) ||
        BLOCKED_HOSTNAMES.has(parsed.hostname.toLowerCase()) ||
        (canonicalIp !== null && BLOCKED_HOSTNAMES.has(canonicalIp))
    ) {
        throw new Error(`Provider URL targets a blocked metadata or wildcard host: "${parsed.host}"`);
    }

    const local = isLocalHostname(hostname);
    const privateIp = isPrivateIpHostname(hostname);

    const isLocalLike = local || privateIp;

    // Local-by-design providers may freely use loopback / RFC 1918 ranges.
    if (LOCAL_PROVIDERS.has(providerType)) return parsed;

    if (providerType === 'custom') {
        // Custom is user-elected and may target a self-hosted gateway.
        // HTTP is fine for loopback, otherwise require HTTPS.
        if (parsed.protocol === 'http:' && !isLocalLike && !opts.allowLocalhost) {
            throw new Error(`Custom provider URL must use HTTPS for non-loopback hosts: "${parsed.host}"`);
        }
        return parsed;
    }

    // All other types: reject local/private hosts so an LLM-driven settings
    // mutation cannot point a cloud provider at an internal service or
    // AWS IMDS.
    if (isLocalLike) {
        throw new Error(
            `Provider URL "${parsed.host}" resolves to a local or private network. ` +
            `Only the "ollama" and "lmstudio" provider types may use private hosts.`,
        );
    }

    const allowlist = PROVIDER_HOST_ALLOWLIST[providerType] ?? [];
    if (allowlist.length > 0) {
        // FEAT-26-07: Bedrock gateway mode skips the strict AWS allow-list so
        // enterprise APIM hosts can proxy ConverseStream. HTTPS-only enforced
        // explicitly below since the permissive HTTPS gate at the bottom only
        // applies to PERMISSIVE_PROVIDERS.
        if (opts.gatewayMode && providerType === 'bedrock') {
            if (parsed.protocol === 'http:') {
                throw new Error(`Provider URL must use HTTPS for bedrock gateway: "${trimmed}"`);
            }
            return parsed;
        }
        if (!allowlist.some((re) => re.test(hostname))) {
            throw new Error(
                `Provider URL "${parsed.host}" is not in the allow-list for "${providerType}". ` +
                `Expected one of: ${allowlist.map((re) => re.source).join(', ')}.`,
            );
        }
        return parsed;
    }

    // Permissive provider types: HTTPS to a public host is fine. Block plain
    // HTTP since none of the supported cloud providers serve over HTTP and
    // an unencrypted bearer key going off-box is itself an exposure.
    if (PERMISSIVE_PROVIDERS.has(providerType) && parsed.protocol === 'http:') {
        throw new Error(`Provider URL must use HTTPS for "${providerType}": "${trimmed}"`);
    }

    return parsed;
}

export function isLocalHostname(hostname: string): boolean {
    const h = hostname.toLowerCase();
    if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
    if (h.endsWith('.localhost') || h.endsWith('.local')) return true;
    return false;
}

/**
 * MCP-1: normalize alternate IPv4/IPv6 literal encodings to canonical
 * dotted-quad so the private-range check cannot be bypassed via decimal
 * (`2130706433` = 127.0.0.1), hex (`0x7f000001`), octal (`0177.0.0.1`), or
 * IPv4-mapped IPv6 (`::ffff:7f00:1`) forms. Pure string parsing, no DNS, so it
 * behaves identically on desktop and mobile. Returns canonical dotted-quad, or
 * null when the host is not one of these integer/mapped IP encodings.
 */
function normalizeIpv4Encoding(hostname: string): string | null {
    let h = hostname.trim().toLowerCase();
    if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);

    const toQuad = (n: number): string | null =>
        Number.isInteger(n) && n >= 0 && n <= 0xffffffff
            ? `${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`
            : null;

    // IPv4-mapped IPv6: ::ffff:127.0.0.1 or ::ffff:7f00:1
    const mapped = h.match(/^::ffff:(.+)$/i);
    if (mapped) {
        const tail = mapped[1];
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(tail)) return tail;
        const pair = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
        if (pair) return toQuad(((parseInt(pair[1], 16) & 0xffff) << 16) | (parseInt(pair[2], 16) & 0xffff));
    }
    // Bare decimal integer: 2130706433
    if (/^\d+$/.test(h)) return toQuad(Number(h));
    // Hex integer: 0x7f000001
    if (/^0x[0-9a-f]+$/i.test(h)) return toQuad(parseInt(h, 16));
    // Dotted form with an octal (leading-zero) component: 0177.0.0.1
    // Canonicalises an address the CALLER already supplied so
    // isPrivateIpHostname sees through obfuscated private-IP encodings. Spelled
    // as a template like toQuad above: this is an address, not a hostname, and
    // nothing here composes one.
    const parts = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (parts && parts.slice(1).some((p) => /^0\d+$/.test(p))) {
        const [a, b, c, d] = parts.slice(1).map((p) => (/^0\d+$/.test(p) ? parseInt(p, 8) : Number(p)));
        if ([a, b, c, d].every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
            return `${a}.${b}.${c}.${d}`;
        }
    }
    return null;
}

export function isPrivateIpHostname(hostname: string): boolean {
    // MCP-1: fold alternate IP encodings to canonical dotted-quad first.
    const canonical = normalizeIpv4Encoding(hostname);
    if (canonical) hostname = canonical;
    const v4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (v4) {
        const a = Number(v4[1]);
        const b = Number(v4[2]);
        if (![a, b].every((n) => Number.isFinite(n) && n >= 0 && n <= 255)) return false;
        if (a === 0) return true;             // 0.0.0.0/8
        if (a === 10) return true;             // 10.0.0.0/8
        if (a === 127) return true;            // 127.0.0.0/8
        if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local + AWS IMDS
        if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
        if (a === 192 && b === 168) return true; // 192.168.0.0/16
        if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    }
    // IPv6 unique-local (fc00::/7) and link-local (fe80::/10), AWS IMDS IPv6
    if (/^fc[0-9a-f]{2}:/i.test(hostname) || /^fd[0-9a-f]{2}:/i.test(hostname)) return true;
    if (/^fe[89ab][0-9a-f]:/i.test(hostname)) return true;
    return false;
}
