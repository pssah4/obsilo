/**
 * RecipePromotionService — Promotes recurring tool-sequence patterns to learned recipes.
 *
 * After each episode is recorded, this service checks whether the tool-sequence
 * pattern has appeared 3+ times successfully. If so, it uses one LLM call
 * (memory model) to generate a recipe description and trigger keywords,
 * then saves the result via RecipeStore.
 *
 * ADR-018: Episodic Task Memory — Promotion zu Rezepten
 */

import type { Vault } from 'obsidian';
import type { RecipeStore } from './RecipeStore';
import type { TaskEpisode } from './EpisodicExtractor';
import type { ProceduralRecipe } from './types';
import type { ApiHandler } from '../../api/types';
import { SCHEMA_VERSION } from './staticRecipes';

/** Minimum successful occurrences of a pattern before promotion. */
const PROMOTION_THRESHOLD = 3;

interface PatternEntry {
    patternKey: string;
    toolSequence: string[];
    episodes: Array<{ userMessage: string; resultSummary: string }>;
    successCount: number;
}

export class RecipePromotionService {
    private vault: Vault;
    private store: RecipeStore;
    private getApi: () => ApiHandler | null;
    private patternsDir: string;

    constructor(
        vault: Vault,
        pluginDir: string,
        store: RecipeStore,
        getApi: () => ApiHandler | null,
    ) {
        this.vault = vault;
        this.store = store;
        this.getApi = getApi;
        this.patternsDir = `${pluginDir}/patterns`;
    }

    async initialize(): Promise<void> {
        const exists = await this.vault.adapter.exists(this.patternsDir);
        if (!exists) {
            await this.vault.adapter.mkdir(this.patternsDir);
        }
    }

    /**
     * Check if an episode's tool-sequence pattern qualifies for promotion.
     * Called after each episode is recorded (fire-and-forget).
     */
    async checkForPromotion(episode: TaskEpisode): Promise<void> {
        if (!episode.success) return;
        if (episode.toolSequence.length < 2) return;

        const patternKey = this.makePatternKey(episode.toolSequence);

        // Check if already promoted as a recipe
        const existingRecipe = this.store.getById(`learned-${patternKey}`);
        if (existingRecipe) {
            this.store.incrementSuccess(existingRecipe.id);
            return;
        }

        // Load or create pattern tracker
        const pattern = await this.loadPattern(patternKey, episode.toolSequence);
        pattern.episodes.push({
            userMessage: episode.userMessage.slice(0, 200),
            resultSummary: episode.resultSummary.slice(0, 200),
        });
        pattern.successCount++;

        // Persist updated pattern
        await this.savePattern(pattern);

        // Check threshold
        if (pattern.successCount >= PROMOTION_THRESHOLD) {
            await this.promoteToRecipe(pattern);
        }
    }

    /**
     * Promote a pattern to a learned recipe using one LLM call.
     */
    private async promoteToRecipe(pattern: PatternEntry): Promise<void> {
        const api = this.getApi();
        if (!api) {
            console.warn('[RecipePromotion] No API available for promotion LLM call');
            return;
        }

        try {
            // Build a concise prompt for the LLM
            const exampleMessages = pattern.episodes
                .slice(-3) // Last 3 examples
                .map((e) => `- "${e.userMessage}" => ${e.resultSummary}`)
                .join('\n');

            const systemPrompt = 'You are a recipe generator. Given a tool sequence pattern and example uses, generate a JSON recipe. Respond ONLY with valid JSON, no markdown.';
            const userPrompt = `Tool sequence pattern: ${pattern.toolSequence.join(' -> ')}

Example uses:
${exampleMessages}

Generate a JSON object with:
- "name": Short recipe name (max 40 chars)
- "description": One sentence describing what this recipe does (max 100 chars)
- "trigger": Pipe-separated keywords for matching (max 8 keywords)
- "steps": Array of {tool, note} objects for each tool in the sequence`;

            let responseText = '';
            for await (const chunk of api.createMessage(systemPrompt, [
                { role: 'user', content: userPrompt },
            ], [], undefined)) {
                if (chunk.type === 'text') responseText += chunk.text;
            }

            // Parse LLM response
            const parsed = JSON.parse(responseText.trim());
            if (!parsed.name || !parsed.trigger || !parsed.steps) {
                console.warn('[RecipePromotion] Invalid LLM response, skipping');
                return;
            }

            const recipe: ProceduralRecipe = {
                id: `learned-${pattern.patternKey}`,
                name: String(parsed.name).slice(0, 40),
                description: String(parsed.description ?? '').slice(0, 100),
                trigger: String(parsed.trigger).slice(0, 200),
                steps: (parsed.steps as Array<{ tool: string; note: string }>).map((s) => ({
                    tool: String(s.tool),
                    note: String(s.note),
                })),
                source: 'learned',
                schemaVersion: SCHEMA_VERSION,
                successCount: pattern.successCount,
                lastUsed: new Date().toISOString(),
                modes: [],
            };

            await this.store.save(recipe);
            console.log(`[RecipePromotion] Promoted pattern to recipe: ${recipe.name}`);

            // Clean up pattern tracker (no longer needed)
            await this.deletePattern(pattern.patternKey);
        } catch (e) {
            console.warn('[RecipePromotion] Promotion failed:', e);
        }
    }

    /**
     * Create a stable key from a tool sequence (order-preserving).
     */
    private makePatternKey(toolSequence: string[]): string {
        return toolSequence.join('-').replace(/[^a-z0-9_-]/gi, '').slice(0, 80);
    }

    private async loadPattern(key: string, toolSequence: string[]): Promise<PatternEntry> {
        const filePath = `${this.patternsDir}/${key}.json`;
        try {
            const exists = await this.vault.adapter.exists(filePath);
            if (exists) {
                const raw = await this.vault.adapter.read(filePath);
                return JSON.parse(raw) as PatternEntry;
            }
        } catch { /* fall through to create new */ }

        return {
            patternKey: key,
            toolSequence,
            episodes: [],
            successCount: 0,
        };
    }

    private async savePattern(pattern: PatternEntry): Promise<void> {
        const filePath = `${this.patternsDir}/${pattern.patternKey}.json`;
        await this.vault.adapter.write(filePath, JSON.stringify(pattern, null, 2));
    }

    private async deletePattern(key: string): Promise<void> {
        const filePath = `${this.patternsDir}/${key}.json`;
        try {
            const exists = await this.vault.adapter.exists(filePath);
            if (exists) await this.vault.adapter.remove(filePath);
        } catch { /* non-fatal */ }
    }
}
