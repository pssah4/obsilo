/**
 * WebFetchTool - Fetch a URL and return readable content
 *
 * Uses Obsidian's requestUrl() — no browser/Chromium required.
 * Converts HTML to Markdown for clean LLM consumption.
 * Adapted from Kilo Code's UrlContentFetcher pattern.
 */

import { requestUrl } from 'obsidian';
import dns from 'dns';
import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';

/**
 * Check whether an IP address belongs to a private/internal network range.
 * Covers RFC 1918, loopback, link-local, and IPv6 equivalents.
 */
function isPrivateIP(ip: string): boolean {
    // IPv4
    if (ip.includes('.')) {
        const parts = ip.split('.').map(Number);
        if (parts.length !== 4 || parts.some((p) => isNaN(p))) return false;
        const [a, b] = parts;
        return (
            a === 127 ||             // 127.0.0.0/8  loopback
            a === 10 ||              // 10.0.0.0/8   RFC 1918
            (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 RFC 1918
            (a === 192 && b === 168) ||          // 192.168.0.0/16 RFC 1918
            (a === 169 && b === 254) ||          // 169.254.0.0/16 link-local / AWS metadata
            a === 0                  // 0.0.0.0/8    "this" network
        );
    }
    // IPv6
    const norm = ip.toLowerCase();
    return (
        norm === '::1' ||                   // loopback
        norm.startsWith('fe80') ||          // link-local fe80::/10
        /^f[cd][0-9a-f]{2}:/.test(norm)    // unique-local fc00::/7
    );
}

interface WebFetchInput {
    url: string;
    maxLength?: number;
    startIndex?: number;
}

export class WebFetchTool extends BaseTool<'web_fetch'> {
    readonly name = 'web_fetch' as const;
    readonly isWriteOperation = false;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'web_fetch',
            description:
                'Fetch a URL and return its content as readable text. Use for reading documentation, articles, APIs, or any public webpage. HTML is automatically converted to Markdown.',
            input_schema: {
                type: 'object',
                properties: {
                    url: {
                        type: 'string',
                        description: 'The URL to fetch (must start with http:// or https://).',
                    },
                    maxLength: {
                        type: 'number',
                        description:
                            'Maximum characters to return (default: 20000). Large pages are truncated.',
                    },
                    startIndex: {
                        type: 'number',
                        description:
                            'Start reading from this character offset (default: 0). Use with maxLength to paginate large pages.',
                    },
                },
                required: ['url'],
            },
        };
    }

    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { url, maxLength = 20000, startIndex = 0 } = input as unknown as WebFetchInput;
        const { callbacks } = context;

        if (!url) {
            callbacks.pushToolResult(this.formatError(new Error('url parameter is required')));
            return;
        }

        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            callbacks.pushToolResult(
                this.formatError(new Error('URL must start with http:// or https://'))
            );
            return;
        }

        // H-3 + M-2: Block SSRF with two-phase check.
        // Phase 1: Reject obviously private hostnames (fast, no DNS).
        // Phase 2: Resolve DNS and reject private resolved IPs (catches rebinding).
        // TOCTOU note: requestUrl() resolves DNS independently, so a fast rebinding
        // between our check and the actual request is theoretically possible but
        // requires sub-second DNS TTL manipulation. This raises the bar significantly.
        let parsedUrl: URL;
        try {
            parsedUrl = new URL(url);
        } catch {
            callbacks.pushToolResult(this.formatError(new Error('Invalid URL')));
            return;
        }

        const host = parsedUrl.hostname.toLowerCase();

        // Phase 1: Block obviously private hostnames
        if (host === 'localhost' || isPrivateIP(host)) {
            callbacks.pushToolResult(
                this.formatError(new Error('Access to private/internal network addresses is not allowed'))
            );
            return;
        }

        // Phase 2: Resolve DNS and check resolved IPs
        try {
            const ips = await this.resolveHost(host);
            const privateIp = ips.find(isPrivateIP);
            if (privateIp) {
                callbacks.pushToolResult(
                    this.formatError(new Error(
                        `Hostname "${host}" resolves to private IP ${privateIp} — access denied (SSRF protection)`
                    ))
                );
                return;
            }
        } catch {
            // DNS resolution failed — could be IP literal or non-resolvable host.
            // IP literals are already checked in Phase 1. For non-resolvable hosts,
            // let requestUrl() handle the error naturally.
        }

        try {
            callbacks.log(`Fetching: ${url}`);

            const TIMEOUT_MS = 15_000;
            const timeoutPromise = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error(`Request timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS)
            );

            const response = await Promise.race([
                requestUrl({
                    url,
                    method: 'GET',
                    headers: {
                        'User-Agent':
                            'Mozilla/5.0 (compatible; ObsidianAgent/1.0; +https://obsidian.md)',
                        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    },
                    throw: false,
                }),
                timeoutPromise,
            ]);

            const statusCode = response.status;

            if (statusCode >= 400) {
                callbacks.pushToolResult(
                    this.formatError(
                        new Error(`HTTP ${statusCode} error fetching ${url}`)
                    )
                );
                return;
            }

            const contentType = (response.headers['content-type'] ?? '').toLowerCase();
            let content: string;

            // M-4: Limit raw response size before HTML parsing to prevent ReDoS on
            // giant pages with complex regex patterns in htmlToMarkdown().
            const MAX_PARSE_BYTES = 2_000_000; // 2 MB
            const rawText = response.text ?? '';
            const safeText = rawText.length > MAX_PARSE_BYTES ? rawText.slice(0, MAX_PARSE_BYTES) : rawText;

            if (contentType.includes('text/html') || contentType === '') {
                content = this.htmlToMarkdown(safeText);
            } else {
                // Plain text, JSON, etc.
                content = safeText;
            }

            // Apply pagination
            const totalLength = content.length;
            const slice = content.slice(startIndex, startIndex + maxLength);
            const truncated = startIndex + maxLength < totalLength;

            let result = `<web_fetch url="${url}" status="${statusCode}" chars="${totalLength}">\n`;
            result += slice;
            if (truncated) {
                result += `\n\n[Content truncated. Use startIndex=${startIndex + maxLength} to read more.]`;
            }
            result += '\n</web_fetch>';

            callbacks.pushToolResult(result);
            callbacks.log(
                `Fetched ${url} — ${statusCode}, ${slice.length} chars returned${truncated ? ' (truncated)' : ''}`
            );
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
        }
    }

    // ---------------------------------------------------------------------------
    // DNS resolution helper (M-2: anti-rebinding)
    // ---------------------------------------------------------------------------

    /**
     * Resolve a hostname to its IPv4 and IPv6 addresses.
     * Used to detect DNS rebinding (hostname resolves to private IP).
     */
    private async resolveHost(hostname: string): Promise<string[]> {
        const results: string[] = [];
        const resolver = new dns.promises.Resolver();
        // Short timeout — we don't want to delay the user for DNS issues
        resolver.setServers(['8.8.8.8', '1.1.1.1']);

        try {
            const ipv4 = await resolver.resolve4(hostname);
            results.push(...ipv4);
        } catch { /* no A records — ok */ }

        try {
            const ipv6 = await resolver.resolve6(hostname);
            results.push(...ipv6);
        } catch { /* no AAAA records — ok */ }

        return results;
    }

    // ---------------------------------------------------------------------------
    // HTML → Markdown converter (no external dependencies)
    // ---------------------------------------------------------------------------

    private htmlToMarkdown(html: string): string {
        let md = html;

        // Remove DOCTYPE, comments (loop to handle nested/reconstructed sequences)
        md = md.replace(/<!DOCTYPE[^>]*>/gi, '');
        while (/<!--[\s\S]*?-->/g.test(md)) {
            md = md.replace(/<!--[\s\S]*?-->/g, '');
        }

        // Remove <head> entirely (scripts, styles, meta)
        md = md.replace(/<head[\s\S]*?<\/head[^>]*>/gi, '');

        // Remove script and style blocks (loop to handle nested/reconstructed tags,
        // [^>]* in closing tag handles malformed end tags like </script \n bar>)
        while (/<script[\s\S]*?<\/script[^>]*>/gi.test(md)) {
            md = md.replace(/<script[\s\S]*?<\/script[^>]*>/gi, '');
        }
        while (/<style[\s\S]*?<\/style[^>]*>/gi.test(md)) {
            md = md.replace(/<style[\s\S]*?<\/style[^>]*>/gi, '');
        }
        md = md.replace(/<noscript[\s\S]*?<\/noscript[^>]*>/gi, '');

        // Remove nav, footer, aside, header — usually not main content
        md = md.replace(/<nav[\s\S]*?<\/nav>/gi, '');
        md = md.replace(/<footer[\s\S]*?<\/footer>/gi, '');
        md = md.replace(/<aside[\s\S]*?<\/aside>/gi, '');

        // Block-level: headings
        md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n');
        md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n');
        md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n');
        md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n');
        md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '\n##### $1\n');
        md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '\n###### $1\n');

        // Block-level: paragraphs, divs, sections
        md = md.replace(/<\/p>/gi, '\n\n');
        md = md.replace(/<p[^>]*>/gi, '\n');
        md = md.replace(/<\/div>/gi, '\n');
        md = md.replace(/<div[^>]*>/gi, '\n');
        md = md.replace(/<\/section>/gi, '\n');
        md = md.replace(/<section[^>]*>/gi, '\n');
        md = md.replace(/<article[^>]*>/gi, '\n');
        md = md.replace(/<\/article>/gi, '\n');
        md = md.replace(/<main[^>]*>/gi, '\n');
        md = md.replace(/<\/main>/gi, '\n');

        // Lists
        md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1');
        md = md.replace(/<\/?[uo]l[^>]*>/gi, '\n');

        // Inline: links
        md = md.replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
        md = md.replace(/<a[^>]+href='([^']*)'[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
        // Links without href
        md = md.replace(/<a[^>]*>([\s\S]*?)<\/a>/gi, '$1');

        // Inline: emphasis
        md = md.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/(strong|b)>/gi, '**$2**');
        md = md.replace(/<(em|i)[^>]*>([\s\S]*?)<\/(em|i)>/gi, '*$2*');

        // Inline: code
        md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
        md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '\n```\n$1\n```\n');

        // Line breaks
        md = md.replace(/<br\s*\/?>/gi, '\n');
        md = md.replace(/<hr\s*\/?>/gi, '\n---\n');

        // Tables (simplified)
        md = md.replace(/<th[^>]*>([\s\S]*?)<\/th>/gi, '| $1 ');
        md = md.replace(/<td[^>]*>([\s\S]*?)<\/td>/gi, '| $1 ');
        md = md.replace(/<\/tr>/gi, '|\n');
        md = md.replace(/<[^>]*(tr|table|thead|tbody|tfoot)[^>]*>/gi, '\n');

        // Final safety pass: remove any script/style fragments that survived conversion
        // Use while-loops to handle nested/reconstructed fragments like <scr<script>ipt> (CWE-116)
        while (/<\/?script[^>]*>/gi.test(md)) {
            md = md.replace(/<\/?script[^>]*>/gi, '');
        }
        while (/<\/?style[^>]*>/gi.test(md)) {
            md = md.replace(/<\/?style[^>]*>/gi, '');
        }

        // Strip ALL remaining HTML tags in a loop until stable (CWE-116 / CodeQL #50)
        // A single pass can miss tags reconstructed from nested fragments.
        {
            let prev: string;
            do {
                prev = md;
                md = md.replace(/<[^>]+>/g, '');
            } while (md !== prev);
        }

        // Decode common HTML entities (&amp; last to prevent double-unescaping)
        md = md.replace(/&lt;/g, '<');
        md = md.replace(/&gt;/g, '>');
        md = md.replace(/&quot;/g, '"');
        md = md.replace(/&#39;/g, "'");
        md = md.replace(/&nbsp;/g, ' ');
        md = md.replace(/&mdash;/g, '—');
        md = md.replace(/&ndash;/g, '–');
        md = md.replace(/&hellip;/g, '...');
        md = md.replace(/&amp;/g, '&');
        md = md.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
        md = md.replace(/&#x([0-9a-f]+);/gi, (_, code) =>
            String.fromCharCode(parseInt(code, 16))
        );

        // Post-decode safety: entity decoding may reconstruct HTML tags (CodeQL #53)
        // Remove dangerous tags first, then strip all remaining tags until stable.
        while (/<\/?script[^>]*>/gi.test(md)) {
            md = md.replace(/<\/?script[^>]*>/gi, '');
        }
        while (/<\/?style[^>]*>/gi.test(md)) {
            md = md.replace(/<\/?style[^>]*>/gi, '');
        }
        {
            let prev: string;
            do {
                prev = md;
                md = md.replace(/<[^>]+>/g, '');
            } while (md !== prev);
        }

        // Collapse excessive blank lines (max 2 in a row)
        md = md.replace(/\n{3,}/g, '\n\n');

        // Trim leading/trailing whitespace on each line
        md = md
            .split('\n')
            .map((line) => line.trimEnd())
            .join('\n');

        return md.trim();
    }
}
