/**
 * EpisodicExtractor — Records and queries task episodes.
 *
 * After each successful multi-tool task, a TaskEpisode is persisted
 * and indexed in the semantic index for future retrieval.
 *
 * No extra API call is needed for recording — all data comes from
 * the ToolRepetitionDetector's ledger (already in memory).
 *
 * ADR-018: Episodic Task Memory
 */

import type { Vault } from 'obsidian';
import type { SemanticIndexService } from '../semantic/SemanticIndexService';

export interface TaskEpisode {
    id: string;
    timestamp: string;
    userMessage: string;
    mode: string;
    toolSequence: string[];
    toolLedger: string;
    success: boolean;
    resultSummary: string;
}

/** Maximum episodes before FIFO eviction starts. */
const MAX_EPISODES = 500;

export class EpisodicExtractor {
    private vault: Vault;
    private episodesDir: string;
    private getSemanticIndex: () => SemanticIndexService | null;
    private episodeCount = 0;

    constructor(
        vault: Vault,
        pluginDir: string,
        getSemanticIndex: () => SemanticIndexService | null,
    ) {
        this.vault = vault;
        this.episodesDir = `${pluginDir}/episodes`;
        this.getSemanticIndex = getSemanticIndex;
    }

    /**
     * Initialize: count existing episodes for eviction tracking.
     */
    async initialize(): Promise<void> {
        try {
            const exists = await this.vault.adapter.exists(this.episodesDir);
            if (!exists) {
                await this.vault.adapter.mkdir(this.episodesDir);
                return;
            }
            const listing = await this.vault.adapter.list(this.episodesDir);
            this.episodeCount = listing.files.filter((f: string) => f.endsWith('.json')).length;
        } catch (e) {
            console.warn('[EpisodicExtractor] Init failed (non-fatal):', e);
        }
    }

    /**
     * Record a task episode after completion. Fire-and-forget from the sidebar.
     *
     * Only records multi-tool tasks (2+ tool calls) to avoid noise.
     */
    async recordEpisode(params: {
        userMessage: string;
        mode: string;
        toolSequence: string[];
        toolLedger: string;
        success: boolean;
        resultSummary: string;
    }): Promise<TaskEpisode | null> {
        // Skip trivial single-tool tasks
        if (params.toolSequence.length < 2) return null;

        const episode: TaskEpisode = {
            id: `ep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            timestamp: new Date().toISOString(),
            userMessage: params.userMessage.slice(0, 500), // Cap user message
            mode: params.mode,
            toolSequence: params.toolSequence,
            toolLedger: params.toolLedger.slice(0, 1500), // Cap ledger
            success: params.success,
            resultSummary: params.resultSummary.slice(0, 300),
        };

        try {
            // FIFO eviction if at limit
            if (this.episodeCount >= MAX_EPISODES) {
                await this.evictOldest();
            }

            // Persist to disk
            const filePath = `${this.episodesDir}/${episode.id}.json`;
            await this.vault.adapter.write(filePath, JSON.stringify(episode, null, 2));
            this.episodeCount++;

            // Index in semantic search (source='episode')
            const index = this.getSemanticIndex();
            if (index) {
                const content = `Task: ${episode.userMessage}\n`
                    + `Tools: ${episode.toolSequence.join(' -> ')}\n`
                    + `Result: ${episode.resultSummary}`;
                await index.indexEpisode(episode.id, content);
            }

            return episode;
        } catch (e) {
            console.warn('[EpisodicExtractor] Failed to record episode:', e);
            return null;
        }
    }

    /**
     * Search for similar past episodes using semantic search.
     */
    async findSimilarEpisodes(query: string, topK = 3): Promise<TaskEpisode[]> {
        const index = this.getSemanticIndex();
        if (!index) return [];

        try {
            const results = await index.searchEpisodes(query, topK);
            const episodes: TaskEpisode[] = [];

            for (const result of results) {
                const episodeId = result.path.replace('episode:', '');
                try {
                    const filePath = `${this.episodesDir}/${episodeId}.json`;
                    const exists = await this.vault.adapter.exists(filePath);
                    if (!exists) continue;
                    const raw = await this.vault.adapter.read(filePath);
                    episodes.push(JSON.parse(raw) as TaskEpisode);
                } catch {
                    // Episode file missing or corrupt — skip
                }
            }

            return episodes;
        } catch (e) {
            console.warn('[EpisodicExtractor] Search failed:', e);
            return [];
        }
    }

    /**
     * FIFO eviction: remove the oldest episode file.
     */
    private async evictOldest(): Promise<void> {
        try {
            const listing = await this.vault.adapter.list(this.episodesDir);
            const jsonFiles = listing.files
                .filter((f: string) => f.endsWith('.json'))
                .sort(); // Lexicographic = chronological (ep-{timestamp} prefix)

            if (jsonFiles.length > 0) {
                await this.vault.adapter.remove(jsonFiles[0]);
                this.episodeCount--;
            }
        } catch (e) {
            console.warn('[EpisodicExtractor] Eviction failed:', e);
        }
    }
}
