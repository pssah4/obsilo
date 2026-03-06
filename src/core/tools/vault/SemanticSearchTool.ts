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
                'Searches across notes AND indexed documents (PDF, PPTX, XLSX, DOCX). ' +
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
                        description: 'Maximum number of results to return (default: 8, max: 20)',
                    },
                    folder: {
                        type: 'string',
                        description: 'Restrict results to notes inside this folder (e.g. "Projects" or "Work/Q1"). Prefix match.',
                    },
                    tags: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Only return notes that have ANY of these tags (e.g. ["project", "active"]). Tags with or without # both work.',
                    },
                    since: {
                        type: 'string',
                        description: 'Only return notes modified on or after this date (ISO format: "2025-01-01").',
                    },
                },
                required: ['query'],
            },
        };
    }

    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const query = (input.query as string) ?? '';
        const topK: number = Math.min(Number(input.top_k) || 8, 20);
        const folderFilter: string | undefined = ((input.folder as string) ?? '').trim() || undefined;
        const tagsFilter: string[] | undefined = Array.isArray(input.tags) && input.tags.length > 0
            ? (input.tags as string[]).map((t: string) => t.replace(/^#/, '').toLowerCase())
            : undefined;
        const sinceFilter: number | undefined = input.since
            ? new Date(input.since as string).getTime()
            : undefined;
        const hasFilter = !!(folderFilter || tagsFilter || sinceFilter);
        // Request more candidates when filters are active so we still return topK after filtering
        // Request more candidates so per-file dedup still yields topK unique files
        const searchK = hasFilter ? Math.min(topK * 4, 80) : Math.min(topK * 3, 40);

        if (!query.trim()) {
            callbacks.pushToolResult(this.formatError(new Error('query parameter is required')));
            return;
        }

        const semanticIndex = this.plugin.semanticIndex;
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
            // ── HyDE: generate hypothetical document for better query embedding ──
            // If enabled, ask the LLM to write a short note excerpt that would answer
            // the query. We embed that hypothetical text instead of the raw query,
            // which gives the embedding model a much richer signal to match against.
            let hydeText: string | undefined;
            const hydeEnabled = (this.plugin.settings as unknown as Record<string, unknown>)?.hydeEnabled === true;
            const apiHandler = this.plugin.apiHandler;
            if (hydeEnabled && apiHandler) {
                try {
                    const hydePrompt = `Write a 2-3 sentence Obsidian note excerpt that would directly answer this question: "${query}". Write only the note content itself, no meta-commentary.`;
                    let generated = '';
                    for await (const chunk of apiHandler.createMessage(
                        'You are a document generator for an Obsidian vault. Given a question, write a short realistic note excerpt that would answer it.',
                        [{ role: 'user', content: hydePrompt }],
                        [],
                    )) {
                        if (chunk.type === 'text') generated += chunk.text;
                    }
                    if (generated.trim()) hydeText = generated.trim();
                } catch {
                    // HyDE is best-effort — fall back to raw query on any error
                }
            }

            // ── Hybrid search: semantic + keyword in parallel, fused via RRF ──
            const [semanticResults, keywordResults] = await Promise.all([
                semanticIndex.search(query, searchK, hydeText),
                semanticIndex.keywordSearch(query, searchK),
            ]);

            // Reciprocal Rank Fusion (RRF k=60): score(d) = Σ 1/(k + rank)
            // Results appearing in both lists float naturally to the top.
            const RRF_K = 60;
            type HybridEntry = { path: string; excerpt: string; score: number; method: 'semantic' | 'keyword' | 'hybrid' };
            const fused = new Map<string, HybridEntry>();

            semanticResults.forEach((r, i) => {
                // Keep first (best-ranked) occurrence per file — don't overwrite with worse rank
                if (!fused.has(r.path)) {
                    fused.set(r.path, { path: r.path, excerpt: r.excerpt, score: 1 / (RRF_K + i + 1), method: 'semantic' });
                }
            });
            keywordResults.forEach((r, i) => {
                const rrf = 1 / (RRF_K + i + 1);
                const existing = fused.get(r.path);
                if (existing) {
                    existing.score += rrf;
                    existing.method = 'hybrid';
                } else {
                    fused.set(r.path, { path: r.path, excerpt: r.excerpt, score: rrf, method: 'keyword' });
                }
            });

            let results = Array.from(fused.values())
                .sort((a, b) => b.score - a.score);

            // ── Metadata filters ─────────────────────────────────────────────
            if (folderFilter) {
                const prefix = folderFilter.replace(/\/$/, '') + '/';
                results = results.filter((r) => r.path.startsWith(prefix));
            }
            if (tagsFilter) {
                results = results.filter((r) => {
                    const vaultFile = this.plugin.app.vault.getFileByPath(r.path);
                    if (!vaultFile) return false;
                    const cache = this.plugin.app.metadataCache.getFileCache(vaultFile);
                    const raw = cache?.frontmatter?.tags ?? [];
                    const fileTags: string[] = (Array.isArray(raw) ? raw : [raw])
                        .map((t: unknown) => String(t).replace(/^#/, '').toLowerCase());
                    return tagsFilter.some((t) => fileTags.includes(t));
                });
            }
            if (sinceFilter) {
                results = results.filter((r) => {
                    const vaultFile = this.plugin.app.vault.getFileByPath(r.path);
                    return (vaultFile?.stat?.mtime ?? 0) >= sinceFilter;
                });
            }

            results = results.slice(0, topK);

            if (results.length === 0) {
                const filterDesc = [
                    folderFilter ? `folder="${folderFilter}"` : '',
                    tagsFilter ? `tags=[${tagsFilter.join(',')}]` : '',
                    sinceFilter ? `since=${String(input.since)}` : '',
                ].filter(Boolean).join(', ');
                callbacks.pushToolResult(`No results found for: "${query}"${filterDesc ? ` with filters: ${filterDesc}` : ''}`);
                return;
            }

            // Format path as Obsidian wikilink (strip extension)
            const toWikilink = (filePath: string): string => {
                const base = filePath.replace(/\.[^/.]+$/, '');
                const name = base.split('/').pop() ?? base;
                return `[[${name}]]`;
            };

            const kwCount = results.filter((r) => r.method !== 'semantic').length;
            const activeFilters = [
                folderFilter ? `folder: ${folderFilter}` : '',
                tagsFilter ? `tags: ${tagsFilter.join(', ')}` : '',
                sinceFilter ? `since: ${String(input.since)}` : '',
            ].filter(Boolean).join(' | ');
            const hydeNote = hydeText ? ' · HyDE' : '';
            const lines = [
                `Hybrid search results for: "${query}"${activeFilters ? ` [${activeFilters}]` : ''}`,
                `(${results.length} results — ${kwCount} via keyword/hybrid${hydeNote}. Synthesize answer directly — do not call read_file)\n`,
            ];
            // Truncate each excerpt to 500 chars to keep total context manageable.
            // The agent can call read_file for the full content if needed.
            const MAX_EXCERPT = 500;
            const truncate = (s: string) => s.length > MAX_EXCERPT ? s.slice(0, MAX_EXCERPT) + '…' : s;
            for (let i = 0; i < results.length; i++) {
                const r = results[i];
                const wikilink = toWikilink(r.path);
                const label = r.method === 'hybrid' ? 'semantic+keyword' : r.method;
                lines.push(`${i + 1}. ${wikilink} — \`${r.path}\` (${label})`);
                lines.push(truncate(r.excerpt));
                lines.push('');
            }

            // ── Graph augmentation: follow [[wikilinks]] 1-hop ───────────────
            // Parse [[wikilinks]] from each result's excerpt. For every linked
            // note not already in the top-K results, load its first indexed
            // chunk and append it as "Linked context". This surfaces notes that
            // are intentionally connected but may not have matched semantically.
            const WIKILINK_RE = /\[\[([^\]|#\n]+?)(?:[|#][^\]]*?)?\]\]/g;
            const topKPaths = new Set<string>(results.map((r) => r.path));
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
                    linkedLines.push(truncate(chunks[0]));
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
