/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/restrict-template-expressions, @typescript-eslint/unbound-method -- File-level disable: interacts with external SDK / JSON / Obsidian internals where untyped 'any' values are unavoidable. Inputs are validated at boundaries via type guards or schema checks where security-relevant. */
import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';
import { fuseHybridArms } from '../../semantic/weightedFusion';
import { getGraphEdgeLabel } from '../../knowledge/graphEdgeLabel';
import { runMeteredCall } from '../../pricing/meteredCall';

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
                'Also automatically includes graph-linked neighbors (Wikilinks + MOC-Properties) as context. ' +
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
                    // FIX-24-05-09 (D10): HyDE runs on every semantic_search
                    // when enabled, i.e. several times per agent task, and
                    // reported nothing. It bills to the task that searched.
                    for await (const chunk of runMeteredCall(apiHandler, 'search-hyde', {
                        systemPrompt: 'You are a document generator for an Obsidian vault. Given a question, write a short realistic note excerpt that would answer it.',
                        messages: [{ role: 'user', content: hydePrompt }],
                    }, context.reportAuxUsage)) {
                        if (chunk.type === 'text') generated += chunk.text;
                    }
                    if (generated.trim()) hydeText = generated.trim();
                } catch {
                    // HyDE is best-effort — fall back to raw query on any error
                }
            }

            // ── Hybrid search: 3 signals in parallel, fused via Engine-public RRF ──
            // PLAN-005 task 5: Cosine + TF-IDF stay; Tag-Match is the new
            // signal (notes whose tags overlap the query tokens). Edge-Walk
            // and Trigram are deferred to Phase 3 / a follow-up iteration --
            // they are unlikely to dominate the recall delta and add risk to
            // the heat path.
            const [semanticResults, keywordResults, tagResults] = await Promise.all([
                semanticIndex.search(query, searchK, hydeText, { adjacentChunks: 1, adjacentThreshold: 0.3, maxPerFile: 2 }),
                semanticIndex.keywordSearch(query, searchK),
                semanticIndex.tagMatchSearch(query, searchK),
            ]);

            // Cache excerpts per path so the fused result can pick the best
            // available text. Prefer the opener chunk (chunkIndex 0) so the
            // agent sees the lede of a note instead of a random middle
            // paragraph. Results without chunkIndex (older code paths, MCP)
            // only feed the fallback map, which keeps the previous
            // first-write-wins behavior (cosine > keyword > tag).
            const openerExcerptByPath = new Map<string, string>();
            const fallbackExcerptByPath = new Map<string, string>();
            const remember = (path: string, text: string, chunkIndex?: number) => {
                if (!text) return;
                if (chunkIndex === 0 && !openerExcerptByPath.has(path)) openerExcerptByPath.set(path, text);
                if (!fallbackExcerptByPath.has(path)) fallbackExcerptByPath.set(path, text);
            };
            for (const r of semanticResults) remember(r.path, r.excerpt, r.chunkIndex);
            for (const r of keywordResults) remember(r.path, r.excerpt, r.chunkIndex);
            for (const r of tagResults) remember(r.path, r.excerpt, r.chunkIndex);
            const excerptFor = (path: string): string =>
                openerExcerptByPath.get(path) ?? fallbackExcerptByPath.get(path) ?? '';
            // The chunk that actually matched the query (first-write-wins
            // across arms, the pre-wave behavior). The cross-encoder must
            // judge THIS text, not the opener lede promoted for display.
            const matchedExcerptFor = (path: string): string =>
                fallbackExcerptByPath.get(path) ?? openerExcerptByPath.get(path) ?? '';

            // Reciprocal Rank Fusion via the engine-public utility from
            // FEATURE-0316 task 1. Method tag mirrors which signals contributed
            // (semantic / keyword / tag / hybrid) for the result line.
            // With weightedFusionEnabled (retrieval wave 1, item 4) the tag
            // arm is downweighted to 0.6 and the dense cosine is blended
            // into the final ordering; flag off keeps plain RRF.
            const weightedFusion = this.plugin.settings.weightedFusionEnabled !== false;
            // Best dense cosine per path (the dense arm may return more
            // than one chunk per file, keep the strongest). Only needed in
            // weighted mode; non-finite scores (corrupted embedding blobs)
            // are skipped so a NaN can neither win the max-tracking here
            // nor reach the fusion sort.
            const cosineByPath = new Map<string, number>();
            if (weightedFusion) {
                for (const r of semanticResults) {
                    if (!Number.isFinite(r.score)) continue;
                    const prev = cosineByPath.get(r.path);
                    if (prev === undefined || r.score > prev) cosineByPath.set(r.path, r.score);
                }
            }
            const fused = fuseHybridArms(
                {
                    semantic: semanticResults.map(r => r.path),
                    keyword: keywordResults.map(r => r.path),
                    tag: tagResults.map(r => r.path),
                },
                { weighted: weightedFusion, cosineByPath },
            );

            type HybridEntry = { path: string; excerpt: string; score: number; method: 'semantic' | 'keyword' | 'hybrid'; rerankScore?: number };
            const classify = (contribs: Record<string, number>): HybridEntry['method'] => {
                const signals = Object.keys(contribs).filter(k => contribs[k] > 0);
                if (signals.length >= 2) return 'hybrid';
                if (signals[0] === 'semantic') return 'semantic';
                return 'keyword'; // tag-only and keyword-only both render with the keyword/hybrid badge
            };

            let results: HybridEntry[] = fused.map(f => ({
                path: f.id,
                excerpt: excerptFor(f.id),
                score: f.score,
                method: classify(f.contributions),
            }));

            // ── AUDIT-013 / FIX-29-99-02 IgnoreService filter ────────────────
            // The semantic arm reads embeddings from the KnowledgeDB. Paths
            // that the user marked ignored via .obsidian-agentignore must
            // not surface through this tool. Pre-fix, SemanticSearchTool
            // only honoured the ignore list at BUILD time (via
            // SemanticIndexOptions.isIgnored); rows already in the DB
            // before the ignore entry was added were still returned. The
            // post-fetch filter closes that read-time leak (defense in
            // depth with searchVault, which has the same check).
            {
                const ignoreService = this.plugin.ignoreService;
                if (ignoreService) {
                    results = results.filter((r) => !ignoreService.isIgnored(r.path));
                }
            }

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

            // ── Local Reranking (FEATURE-1504): Cross-encoder re-scores candidates ──
            const reranker = this.plugin.rerankerService;
            if (reranker && this.plugin.settings.enableReranking && results.length > 1) {
                try {
                    const rerankCount = Math.min(results.length, this.plugin.settings.rerankCandidates ?? 20);
                    const toRerank = results.slice(0, rerankCount);
                    // Feed the cross-encoder the chunk that actually
                    // matched the query, NOT the opener excerpt promoted
                    // for display: relevance must be judged against the
                    // matching passage of long notes.
                    const reranked = await reranker.rerank(
                        query,
                        toRerank.map(r => ({ path: r.path, text: matchedExcerptFor(r.path) || r.excerpt, score: r.score })),
                    );
                    // Keep the original fusion score in `score`; the
                    // cross-encoder output rides along as `rerankScore`.
                    // Ordering still follows the reranker (the service
                    // returns candidates sorted by rerankScore). The
                    // rendered excerpt keeps the opener preference.
                    results = reranked.map(r => ({
                        path: r.path,
                        excerpt: excerptFor(r.path) || r.text,
                        score: r.score,
                        rerankScore: r.rerankScore,
                        method: 'hybrid' as const,
                    }));
                } catch (e) {
                    console.warn('[SemanticSearch] Reranking failed, using original order:', e);
                }
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
            const MAX_EXCERPT = 2000; // FEATURE-1501: adjacent chunks provide wider context
            const truncate = (s: string) => s.length > MAX_EXCERPT ? s.slice(0, MAX_EXCERPT) + '…' : s;
            for (let i = 0; i < results.length; i++) {
                const r = results[i];
                const wikilink = toWikilink(r.path);
                const label = r.method === 'hybrid' ? 'semantic+keyword' : r.method;
                lines.push(`${i + 1}. ${wikilink} — \`${r.path}\` (${label})`);
                lines.push(truncate(r.excerpt));
                lines.push('');
            }

            // ── Graph expansion (FEATURE-1502, FEATURE-2004): confidence-weighted neighbor lookup ──
            // Uses getNeighborsWithImplicit() to include both explicit edges (confidence=1.0)
            // and implicit edges (confidence=cosine similarity). Neighbors sorted by confidence
            // so strongly connected notes appear first. ADR-069, ADR-071.
            const graphStore = this.plugin.graphStore;
            let graphLinkedCount = 0;
            if (graphStore && this.plugin.settings.enableGraphExpansion) {
                const hops = Math.min(this.plugin.settings.graphExpansionHops ?? 1, 3);
                const topKPaths = new Set(results.map((r) => r.path));
                const graphLines: string[] = [];
                const seenGraph = new Set<string>();

                for (const r of results) {
                    if (graphLines.length >= 5) break;
                    const neighbors = graphStore.getNeighborsWithImplicit(r.path, hops, 10)
                        .sort((a, b) => b.confidence - a.confidence);
                    for (const n of neighbors) {
                        if (graphLines.length >= 5) break;
                        if (topKPaths.has(n.path) || seenGraph.has(n.path)) continue;
                        seenGraph.add(n.path);
                        const chunks: string[] = await semanticIndex.getChunksByPath(n.path);
                        if (chunks.length === 0) continue;
                        // Typed graph labels (retrieval wave 1, item 5):
                        // frontmatter property name > 'wikilink' > 'similar',
                        // contradiction properties get a line marker.
                        const edgeLabel = getGraphEdgeLabel(n);
                        const marker = edgeLabel.contradicts ? '[contradicts] ' : '';
                        const ctx = `via ${toWikilink(n.viaPath)} (${edgeLabel.label}, confidence: ${n.confidence.toFixed(2)})`;
                        graphLines.push(`${graphLines.length + 1}. ${marker}${toWikilink(n.path)} - \`${n.path}\` (${ctx})`);
                        graphLines.push(truncate(chunks[0]));
                        graphLines.push('');
                    }
                }

                if (graphLines.length > 0) {
                    graphLinkedCount = seenGraph.size;
                    lines.push('─────────────────────────────────────────');
                    lines.push(`Graph context (${hops}-hop expansion):`);
                    lines.push('(Connected via Wikilinks, MOC, or semantic similarity — sorted by confidence)\n');
                    lines.push(...graphLines);
                }
            }

            // ── Ontology expansion (FEATURE-1902): discover related concepts via cluster membership ──
            const ontologyStore = this.plugin.ontologyStore;
            let ontologyCount = 0;
            if (ontologyStore) {
                const topKPaths = new Set(results.map((r) => r.path));
                const seenOntology = new Set<string>();
                const ontologyLines: string[] = [];

                for (const r of results) {
                    if (ontologyLines.length >= 5) break;
                    const related = ontologyStore.getRelatedEntities(r.path, 10);
                    for (const rel of related) {
                        if (ontologyLines.length >= 5) break;
                        if (topKPaths.has(rel.entityPath) || seenOntology.has(rel.entityPath)) continue;
                        seenOntology.add(rel.entityPath);
                        const chunks: string[] = await semanticIndex.getChunksByPath(rel.entityPath);
                        if (chunks.length === 0) continue;
                        ontologyLines.push(`${ontologyLines.length + 1}. ${toWikilink(rel.entityPath)} — \`${rel.entityPath}\` (cluster: ${toWikilink(rel.cluster)}, ${rel.role})`);
                        ontologyLines.push(truncate(chunks[0]));
                        ontologyLines.push('');
                    }
                }

                if (ontologyLines.length > 0) {
                    ontologyCount = seenOntology.size;
                    lines.push('─────────────────────────────────────────');
                    lines.push('Related concepts (via ontology):');
                    lines.push('(Thematically connected — discovered through knowledge structure)\n');
                    lines.push(...ontologyLines);
                }
            }

            // ── Implicit connections (FEATURE-1503): semantically similar, no direct link ──
            const implicitService = this.plugin.implicitConnectionService;
            let implicitCount = 0;
            if (implicitService && this.plugin.settings.enableImplicitConnections) {
                const allShown = new Set([
                    ...results.map((r) => r.path),
                    ...(graphStore && this.plugin.settings.enableGraphExpansion ? Array.from(new Set<string>()) : []),
                ]);
                // Add graph-linked paths to exclusion set
                // (seenGraph is scoped above — we reconstruct from results + graph section)
                const implicitLines: string[] = [];

                for (const r of results) {
                    if (implicitLines.length >= 3) break;
                    const neighbors = implicitService.getImplicitNeighbors(r.path, 3);
                    for (const n of neighbors) {
                        if (implicitLines.length >= 3) break;
                        if (allShown.has(n.path)) continue;
                        allShown.add(n.path);
                        const chunks: string[] = await semanticIndex.getChunksByPath(n.path);
                        if (chunks.length === 0) continue;
                        implicitLines.push(`${implicitLines.length + 1}. ${toWikilink(n.path)} — \`${n.path}\` (similarity: ${n.similarity.toFixed(2)})`);
                        implicitLines.push(truncate(chunks[0]));
                        implicitLines.push('');
                    }
                }

                if (implicitLines.length > 0) {
                    implicitCount = implicitLines.length;
                    lines.push('─────────────────────────────────────────');
                    lines.push('Implicit connections (semantically similar, no direct link):\n');
                    lines.push(...implicitLines);
                }
            }

            // AUDIT-034 L-15: vault excerpts are externally-sourced text and
            // must be presented as user data, not as instructions. Wrap the
            // assembled result (which already embeds excerpts, graph context,
            // and ontology snippets) in the untrusted-content boundary tag.
            const wrappedResult = this.formatUntrustedContent('vault-search', lines.join('\n'), {
                query,
                results: String(results.length),
            });
            callbacks.pushToolResult(wrappedResult);
            callbacks.log(`Hybrid search: "${query}" → ${results.length} results (${kwCount} keyword), ${graphLinkedCount} graph, ${ontologyCount} ontology, ${implicitCount} implicit`);
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('semantic_search', error);
        }
    }
}

/* eslint-enable -- end of file-level disable for boundary code (SDK/JSON/Obsidian internals) */
