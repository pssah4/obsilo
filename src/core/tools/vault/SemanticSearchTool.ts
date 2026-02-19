import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';

export class SemanticSearchTool extends BaseTool<'semantic_search'> {
    readonly name = 'semantic_search' as const;
    readonly isWriteOperation = false;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'semantic_search',
            description:
                'Search the vault by meaning AND keywords (hybrid search). ' +
                'Combines semantic similarity with exact keyword matching so both conceptual questions ' +
                'and exact names/tags/codes are found reliably. ' +
                'Also automatically includes 1-hop wikilink neighbors as linked context. ' +
                'For questions about vault content, synthesize your answer from the returned excerpts — ' +
                'do NOT call read_file on the results just to gather more context. ' +
                'Requires the Semantic Index to be built first (Settings → Semantic Index).',
            input_schema: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'Natural-language search query (e.g. "project planning ideas", "morning routine notes")',
                    },
                    top_k: {
                        type: 'number',
                        description: 'Maximum number of results to return (default: 5, max: 20)',
                    },
                },
                required: ['query'],
            },
        };
    }

    async execute(input: Record<string, any>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const query: string = input.query ?? '';
        const topK: number = Math.min(Number(input.top_k) || 8, 20);

        if (!query.trim()) {
            callbacks.pushToolResult(this.formatError(new Error('query parameter is required')));
            return;
        }

        const semanticIndex = (this.plugin as any).semanticIndex;
        if (!semanticIndex) {
            callbacks.pushToolResult(
                'Semantic Index is not enabled. Enable it in Settings → Semantic Index and click "Build Index".'
            );
            return;
        }

        if (!semanticIndex.isIndexed) {
            callbacks.pushToolResult(
                'Semantic Index has not been built yet. Go to Settings → Semantic Index and click "Build Index".'
            );
            return;
        }

        try {
            // ── Hybrid search: semantic + keyword in parallel, fused via RRF ──
            const [semanticResults, keywordResults] = await Promise.all([
                semanticIndex.search(query, topK),
                semanticIndex.keywordSearch(query, topK),
            ]);

            // Reciprocal Rank Fusion (RRF k=60): score(d) = Σ 1/(k + rank)
            // Results appearing in both lists float naturally to the top.
            const RRF_K = 60;
            type HybridEntry = { path: string; excerpt: string; score: number; method: 'semantic' | 'keyword' | 'hybrid' };
            const fused = new Map<string, HybridEntry>();

            semanticResults.forEach((r: any, i: number) => {
                fused.set(r.path, { path: r.path, excerpt: r.excerpt, score: 1 / (RRF_K + i + 1), method: 'semantic' });
            });
            keywordResults.forEach((r: any, i: number) => {
                const rrf = 1 / (RRF_K + i + 1);
                const existing = fused.get(r.path);
                if (existing) {
                    existing.score += rrf;
                    existing.method = 'hybrid';
                } else {
                    fused.set(r.path, { path: r.path, excerpt: r.excerpt, score: rrf, method: 'keyword' });
                }
            });

            const results = Array.from(fused.values())
                .sort((a, b) => b.score - a.score)
                .slice(0, topK);

            if (results.length === 0) {
                callbacks.pushToolResult(`No results found for: "${query}"`);
                return;
            }

            // Format path as Obsidian wikilink (strip extension)
            const toWikilink = (filePath: string): string => {
                const base = filePath.replace(/\.[^/.]+$/, '');
                const name = base.split('/').pop() ?? base;
                return `[[${name}]]`;
            };

            const kwCount = results.filter((r) => r.method !== 'semantic').length;
            const lines = [
                `Hybrid search results for: "${query}"`,
                `(${results.length} results — ${kwCount} via keyword/hybrid match. Synthesize answer directly — do not call read_file)\n`,
            ];
            for (let i = 0; i < results.length; i++) {
                const r = results[i];
                const wikilink = toWikilink(r.path);
                const label = r.method === 'hybrid' ? 'semantic+keyword' : r.method;
                lines.push(`${i + 1}. ${wikilink} — \`${r.path}\` (${label})`);
                lines.push(r.excerpt);
                lines.push('');
            }

            // ── Graph augmentation: follow [[wikilinks]] 1-hop ───────────────
            // Parse [[wikilinks]] from each result's excerpt. For every linked
            // note not already in the top-K results, load its first indexed
            // chunk and append it as "Linked context". This surfaces notes that
            // are intentionally connected but may not have matched semantically.
            const WIKILINK_RE = /\[\[([^\]|#\n]+?)(?:[|#][^\]]*?)?\]\]/g;
            const topKPaths = new Set<string>(results.map((r: any) => r.path));
            const shownLinked = new Set<string>();
            const linkedLines: string[] = [];

            outer: for (const r of results) {
                WIKILINK_RE.lastIndex = 0;
                let match: RegExpExecArray | null;
                while ((match = WIKILINK_RE.exec(r.excerpt)) !== null) {
                    if (shownLinked.size >= 5) break outer;
                    const linktext = match[1].trim();
                    const linkedFile = this.plugin.app.metadataCache.getFirstLinkpathDest(linktext, r.path);
                    if (!linkedFile) continue;
                    if (topKPaths.has(linkedFile.path) || shownLinked.has(linkedFile.path)) continue;
                    shownLinked.add(linkedFile.path);
                    const chunks: string[] = await semanticIndex.getChunksByPath(linkedFile.path);
                    if (chunks.length === 0) continue;
                    linkedLines.push(`${shownLinked.size}. ${toWikilink(linkedFile.path)} — \`${linkedFile.path}\` (linked from ${toWikilink(r.path)})`);
                    linkedLines.push(chunks[0]);
                    linkedLines.push('');
                }
            }

            if (linkedLines.length > 0) {
                lines.push('─────────────────────────────────────────');
                lines.push('Linked context (1-hop wikilink neighbors):');
                lines.push('(Connected via [[wikilinks]] — relevant by association, not semantic match)\n');
                lines.push(...linkedLines);
            }

            callbacks.pushToolResult(lines.join('\n'));
            callbacks.log(`Hybrid search: "${query}" → ${results.length} results (${kwCount} keyword), ${shownLinked.size} linked`);
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('semantic_search', error);
        }
    }
}
