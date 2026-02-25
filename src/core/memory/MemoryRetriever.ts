/**
 * MemoryRetriever
 *
 * Cross-session context retrieval via semantic search over session summaries
 * and task episodes (ADR-018).
 *
 * On new conversation start, searches for relevant past sessions and episodes,
 * then returns formatted context for injection into the system prompt.
 *
 * Primary path: semantic search over indexed session summaries + episodes.
 * Fallback (no semantic index): most recent 3 session summaries by file date.
 *
 * Budget: 4000 chars total (shared between sessions and episodes).
 */

import type { Vault } from 'obsidian';
import type { SemanticIndexService } from '../semantic/SemanticIndexService';
import type { MemoryService } from './MemoryService';

// ---------------------------------------------------------------------------
// MemoryRetriever
// ---------------------------------------------------------------------------

export class MemoryRetriever {
    constructor(
        private vault: Vault,
        private memoryService: MemoryService,
        private getSemanticIndex: () => SemanticIndexService | null,
    ) {}

    /**
     * Retrieve relevant session context for a new conversation.
     *
     * @param firstMessage - The user's first message (used as search query).
     * @param topK - Maximum number of session summaries to include.
     * @returns Formatted context string, or empty string if no relevant sessions.
     */
    async retrieveSessionContext(firstMessage: string, topK = 3): Promise<string> {
        const semanticIndex = this.getSemanticIndex();

        let excerpts: Array<{ id: string; excerpt: string }> = [];

        // Primary path: semantic search over session summaries
        if (semanticIndex?.isIndexed) {
            try {
                const results = await semanticIndex.searchSessions(firstMessage, topK);
                excerpts = results.map((r) => ({
                    id: r.path.replace('session:', ''),
                    excerpt: r.excerpt,
                }));
            } catch (e) {
                console.warn('[MemoryRetriever] Semantic search failed, falling back to recency:', e);
            }
        }

        // Fallback: most recent session summaries by file modification time
        if (excerpts.length === 0) {
            excerpts = await this.getRecentSessions(topK);
        }

        // Episodic memory: search for similar past task episodes (ADR-018)
        let episodeExcerpts: Array<{ id: string; excerpt: string }> = [];
        if (semanticIndex?.isIndexed) {
            try {
                const episodeResults = await semanticIndex.searchEpisodes(firstMessage, 3);
                episodeExcerpts = episodeResults.map((r) => ({
                    id: r.path.replace('episode:', ''),
                    excerpt: r.excerpt,
                }));
            } catch (e) {
                console.warn('[MemoryRetriever] Episode search failed (non-fatal):', e);
            }
        }

        if (excerpts.length === 0 && episodeExcerpts.length === 0) return '';

        // Format as context block — shared budget of 4000 chars
        const BUDGET = 4000;
        let charCount = 0;
        const lines: string[] = [];

        // Sessions first (higher priority)
        if (excerpts.length > 0) {
            lines.push('<relevant_sessions>');
            for (const { id, excerpt } of excerpts) {
                const truncated = excerpt.length > 600 ? excerpt.slice(0, 600) + '...' : excerpt;
                if (charCount + truncated.length > BUDGET) break;
                lines.push(`<session id="${id}">`);
                lines.push(truncated);
                lines.push('</session>');
                lines.push('');
                charCount += truncated.length + 40; // tag overhead
            }
            lines.push('</relevant_sessions>');
        }

        // Episodes (fill remaining budget)
        if (episodeExcerpts.length > 0 && charCount < BUDGET) {
            lines.push('<past_task_episodes>');
            for (const { id, excerpt } of episodeExcerpts) {
                const truncated = excerpt.length > 400 ? excerpt.slice(0, 400) + '...' : excerpt;
                if (charCount + truncated.length > BUDGET) break;
                lines.push(`<episode id="${id}">`);
                lines.push(truncated);
                lines.push('</episode>');
                lines.push('');
                charCount += truncated.length + 40;
            }
            lines.push('</past_task_episodes>');
        }

        return lines.join('\n');
    }

    /**
     * Fallback: load most recent session summary files.
     */
    private async getRecentSessions(topK: number): Promise<Array<{ id: string; excerpt: string }>> {
        const sessionsDir = this.memoryService.getMemoryDir() + '/sessions';
        try {
            const listed = await this.vault.adapter.list(sessionsDir);
            const mdFiles = listed.files.filter((f) => f.endsWith('.md'));

            if (mdFiles.length === 0) return [];

            // Get modification times and sort by most recent
            const withStats = await Promise.all(
                mdFiles.map(async (filePath) => {
                    try {
                        const stat = await this.vault.adapter.stat(filePath);
                        return { filePath, mtime: stat?.mtime ?? 0 };
                    } catch {
                        return { filePath, mtime: 0 };
                    }
                }),
            );
            withStats.sort((a, b) => b.mtime - a.mtime);

            const results: Array<{ id: string; excerpt: string }> = [];
            for (const { filePath } of withStats.slice(0, topK)) {
                try {
                    const content = await this.vault.adapter.read(filePath);
                    const id = filePath.split('/').pop()?.replace('.md', '') ?? '';
                    results.push({ id, excerpt: content.trim() });
                } catch { /* skip */ }
            }
            return results;
        } catch {
            return [];
        }
    }
}
