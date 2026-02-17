/**
 * WebSearchTool - Search the web via Brave or Tavily API
 *
 * Uses Obsidian's requestUrl() — no browser required.
 * Providers: Brave Search API, Tavily Search API.
 * Adapted from Kilo Code's web search integration pattern.
 */

import { requestUrl } from 'obsidian';
import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';

interface WebSearchInput {
    query: string;
    numResults?: number;
}

interface SearchResult {
    title: string;
    url: string;
    snippet: string;
}

export class WebSearchTool extends BaseTool<'web_search'> {
    readonly name = 'web_search' as const;
    readonly isWriteOperation = false;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'web_search',
            description:
                'Search the web for current information. Returns titles, URLs, and snippets. Use web_fetch to read the full content of a result.',
            input_schema: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'The search query.',
                    },
                    numResults: {
                        type: 'number',
                        description: 'Number of results to return (default: 5, max: 10).',
                    },
                },
                required: ['query'],
            },
        };
    }

    async execute(input: Record<string, any>, context: ToolExecutionContext): Promise<void> {
        const { query, numResults = 5 } = input as WebSearchInput;
        const { callbacks } = context;

        if (!query) {
            callbacks.pushToolResult(this.formatError(new Error('query parameter is required')));
            return;
        }

        const webSettings = this.plugin.settings.webTools;
        const count = Math.min(Math.max(1, numResults), 10);

        if (!webSettings?.enabled) {
            callbacks.pushToolResult(
                this.formatError(
                    new Error(
                        'Web tools are disabled. Enable them in Settings → Behaviour → Web.'
                    )
                )
            );
            return;
        }

        const provider = webSettings.provider ?? 'none';

        if (provider === 'none') {
            callbacks.pushToolResult(
                this.formatError(
                    new Error(
                        'No search provider configured. Set a provider in Settings → Behaviour → Web.'
                    )
                )
            );
            return;
        }

        try {
            callbacks.log(`Searching (${provider}): ${query}`);

            let results: SearchResult[];

            if (provider === 'brave') {
                results = await this.searchBrave(query, count, webSettings.braveApiKey ?? '');
            } else if (provider === 'tavily') {
                results = await this.searchTavily(query, count, webSettings.tavilyApiKey ?? '');
            } else {
                callbacks.pushToolResult(
                    this.formatError(new Error(`Unknown provider: ${provider}`))
                );
                return;
            }

            if (results.length === 0) {
                callbacks.pushToolResult('<web_search>No results found.</web_search>');
                return;
            }

            const lines: string[] = [
                `<web_search query="${query}" provider="${provider}" results="${results.length}">`,
            ];
            results.forEach((r, i) => {
                lines.push(`\n${i + 1}. **${r.title}**`);
                lines.push(`   URL: ${r.url}`);
                if (r.snippet) lines.push(`   ${r.snippet}`);
            });
            lines.push('\n</web_search>');

            callbacks.pushToolResult(lines.join('\n'));
            callbacks.log(`Search complete — ${results.length} results`);
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
        }
    }

    // ---------------------------------------------------------------------------
    // Brave Search API
    // Docs: https://api.search.brave.com/
    // ---------------------------------------------------------------------------

    private async searchBrave(
        query: string,
        count: number,
        apiKey: string
    ): Promise<SearchResult[]> {
        if (!apiKey) {
            throw new Error(
                'Brave API key is not configured. Add it in Settings → Behaviour → Web.'
            );
        }

        const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;

        const response = await requestUrl({
            url,
            method: 'GET',
            headers: {
                'X-Subscription-Token': apiKey,
                Accept: 'application/json',
            },
            throw: false,
        });

        if (response.status >= 400) {
            throw new Error(`Brave API error: HTTP ${response.status}`);
        }

        const data = response.json as any;
        const webResults = data?.web?.results ?? [];

        return webResults.map((r: any) => ({
            title: r.title ?? '',
            url: r.url ?? '',
            snippet: r.description ?? '',
        }));
    }

    // ---------------------------------------------------------------------------
    // Tavily Search API
    // Docs: https://docs.tavily.com/
    // ---------------------------------------------------------------------------

    private async searchTavily(
        query: string,
        count: number,
        apiKey: string
    ): Promise<SearchResult[]> {
        if (!apiKey) {
            throw new Error(
                'Tavily API key is not configured. Add it in Settings → Behaviour → Web.'
            );
        }

        const response = await requestUrl({
            url: 'https://api.tavily.com/search',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                api_key: apiKey,
                query,
                num_results: count,
                search_depth: 'basic',
                include_answer: false,
                include_raw_content: false,
            }),
            throw: false,
        });

        if (response.status >= 400) {
            throw new Error(`Tavily API error: HTTP ${response.status}`);
        }

        const data = response.json as any;
        const tavilyResults = data?.results ?? [];

        return tavilyResults.map((r: any) => ({
            title: r.title ?? '',
            url: r.url ?? '',
            snippet: r.content ?? '',
        }));
    }
}
