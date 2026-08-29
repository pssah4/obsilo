/**
 * RecipePromotionService — Promotes recurring task patterns to learned recipes.
 *
 * ADR-058: Semantic Recipe Promotion (Intent-based, not sequence-based).
 * After each episode is recorded, this service checks whether semantically
 * similar successful episodes exist (via embedding similarity). If 3+ similar
 * episodes are found, a recipe is generated via one LLM call and saved.
 *
 * Replaces the old pattern-key approach (ADR-018) which required identical
 * tool sequences — proven ineffective in Systemtest 2026-04-03.
 *
 * FEATURE-1505: Uses MemoryDB (SQLite) for recipe storage.
 */

import type { RecipeStore } from './RecipeStore';
import type {
    TaskEpisode,
    EpisodicExtractor,
} from './EpisodicExtractor';
import type { ProceduralRecipe } from './types';
import type { ApiHandler } from '../../api/types';
import { runMeteredCall } from '../pricing/meteredCall';
import { SCHEMA_VERSION } from './staticRecipes';

/** Minimum similar successful episodes before promotion. */
const PROMOTION_THRESHOLD = 3;

/** Maximum learned recipes to prevent unbounded growth. */
const MAX_LEARNED_RECIPES = 50;

export class RecipePromotionService {
    private store: RecipeStore;
    private getApi: () => ApiHandler | null;
    private getLearnedEnabled: () => boolean;
    private episodicExtractor: EpisodicExtractor | null;

    constructor(
        store: RecipeStore,
        getApi: () => ApiHandler | null,
        getLearnedEnabled?: () => boolean,
        episodicExtractor?: EpisodicExtractor | null,
    ) {
        this.store = store;
        this.getApi = getApi;
        this.getLearnedEnabled = getLearnedEnabled ?? (() => true);
        this.episodicExtractor = episodicExtractor ?? null;
    }

    async initialize(): Promise<void> {
        // No initialization needed — semantic search is provided by EpisodicExtractor
    }

    /**
     * Check if an episode qualifies for recipe promotion (ADR-058): when
     * >= 3 semantically similar successful episodes exist (embedding-based
     * lookup via the EpisodicExtractor), one LLM call generates a learned
     * recipe. Guarded by `getLearnedEnabled` and the `MAX_LEARNED_RECIPES`
     * cap. Called fire-and-forget from the sidebar and from syncSession.
     *
     * `recipeWinner` is the RecipeStore id of the recipe FastPath executed
     * this turn (if any). A win bumps that recipe's success count and stops
     * here -- promoting the same intent again would create a duplicate
     * learned recipe, because the token-overlap dedup below is stricter
     * than FastPath's fuzzy trigger matching.
     */
    async checkForPromotion(episode: TaskEpisode, recipeWinner?: string | null): Promise<void> {
        if (!this.getLearnedEnabled()) return;

        // Recipe-win gate: FastPath ran a recipe this turn, so bump its
        // success count instead of promoting.
        if (recipeWinner) {
            this.store.incrementSuccess(recipeWinner);
            return;
        }

        if (!episode.success) return;
        if (episode.toolSequence.length < 2) return;

        if (!this.episodicExtractor) return;

        // Check if we already have too many learned recipes
        const allRecipes = this.store.getAll();
        const learnedCount = allRecipes.filter((r) => r.source === 'learned').length;
        if (learnedCount >= MAX_LEARNED_RECIPES) return;

        try {
            // Find semantically similar past episodes (ADR-058)
            const similarEpisodes = await this.episodicExtractor.findSimilarEpisodes(
                episode.userMessage,
                PROMOTION_THRESHOLD + 2, // fetch a few extra to filter
            );

            // Filter: only successful episodes, exclude the current one
            const candidates = similarEpisodes.filter(
                (ep) => ep.success && ep.id !== episode.id && ep.toolSequence.length >= 2,
            );

            if (candidates.length < PROMOTION_THRESHOLD - 1) return; // -1 because current episode counts

            // Check if a recipe already covers this intent
            // (simple heuristic: if any candidate's userMessage is already covered by a learned recipe trigger)
            const existingRecipes = allRecipes.filter((r) => r.source === 'learned');
            for (const recipe of existingRecipes) {
                const triggerTokens = new Set(recipe.trigger.toLowerCase().split(/[|, ]+/).filter((t) => t.length >= 3));
                const msgTokens = new Set(episode.userMessage.toLowerCase().split(/\s+/).filter((t) => t.length >= 3));
                const overlap = [...triggerTokens].filter((t) => msgTokens.has(t)).length;
                if (overlap >= 2) {
                    // Likely already covered — increment success count instead
                    this.store.incrementSuccess(recipe.id);
                    return;
                }
            }

            // Promotion threshold met — generate recipe
            await this.promoteToRecipe(episode, candidates.slice(0, PROMOTION_THRESHOLD - 1));
        } catch (e) {
            console.warn('[RecipePromotion] Semantic check failed (non-fatal):', e);
        }
    }

    /**
     * Promote a set of similar episodes to a learned recipe using one LLM call.
     */
    private async promoteToRecipe(trigger: TaskEpisode, similar: TaskEpisode[]): Promise<void> {
        const api = this.getApi();
        if (!api) {
            console.warn('[RecipePromotion] No API available for promotion LLM call');
            return;
        }

        try {
            const allEpisodes = [trigger, ...similar];
            const exampleMessages = allEpisodes
                .slice(0, 4)
                .map((e) => `- "${e.userMessage}" => Tools: ${e.toolSequence.join(' -> ')} => ${e.resultSummary}`)
                .join('\n');

            // Find the most common tools across all episodes
            const toolFreq = new Map<string, number>();
            for (const ep of allEpisodes) {
                for (const tool of new Set(ep.toolSequence)) {
                    toolFreq.set(tool, (toolFreq.get(tool) ?? 0) + 1);
                }
            }
            const commonTools = [...toolFreq.entries()]
                .filter(([, count]) => count >= 2) // tool used in at least 2 episodes
                .sort((a, b) => b[1] - a[1])
                .map(([tool]) => tool);

            const systemPrompt = 'You are a recipe generator. Given similar task episodes, generate a JSON recipe that captures the common workflow pattern. Respond ONLY with valid JSON, no markdown.';
            const userPrompt = `These ${allEpisodes.length} tasks were identified as semantically similar:

${exampleMessages}

Most common tools across episodes: ${commonTools.join(', ')}

Generate a JSON object with:
- "name": Short recipe name (max 40 chars)
- "description": One sentence describing what this recipe does (max 100 chars)
- "trigger": Pipe-separated keywords for matching user messages (max 8 keywords, include German and English terms)
- "steps": Array of {tool, note} objects for the recommended tool sequence (use the most common tools)`;

            let responseText = '';
            // FIX-24-05-09 (D10): promotion fires from the episode recorder
            // after a task has already reported its usage, so this call had
            // nowhere to land and was dropped.
            for await (const chunk of runMeteredCall(api, 'recipe-promotion', {
                systemPrompt,
                messages: [{ role: 'user', content: userPrompt }],
            })) {
                if (chunk.type === 'text') responseText += chunk.text;
            }

            // L-1: Limit response size before parsing
            if (responseText.length > 50_000) {
                console.warn('[RecipePromotion] LLM response too large, skipping');
                return;
            }

            // Strip markdown code fences if present (LLMs often wrap JSON in ```json ... ```)
            let cleaned = responseText.trim();
            if (cleaned.startsWith('```')) {
                cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
            }

            // Parse LLM response (M-9: type-guarded validation)
            const raw: unknown = JSON.parse(cleaned);
            if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
                console.warn('[RecipePromotion] LLM response is not an object, skipping');
                return;
            }
            const parsed = raw as Record<string, unknown>;
            if (typeof parsed.name !== 'string' || typeof parsed.trigger !== 'string' || !Array.isArray(parsed.steps)) {
                console.warn('[RecipePromotion] Invalid LLM response structure, skipping');
                return;
            }
            const validSteps = (parsed.steps as unknown[]).filter(
                (s): s is { tool: string; note: string } =>
                    typeof s === 'object' && s !== null &&
                    typeof (s as Record<string, unknown>).tool === 'string' &&
                    typeof (s as Record<string, unknown>).note === 'string',
            );
            if (validSteps.length === 0) {
                console.warn('[RecipePromotion] No valid steps in LLM response, skipping');
                return;
            }

            // Generate a stable ID from the recipe name
            const idSlug = parsed.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
            const recipe: ProceduralRecipe = {
                id: `learned-${idSlug}-${Date.now()}`,
                name: parsed.name.slice(0, 40),
                description: typeof parsed.description === 'string' ? parsed.description.slice(0, 100) : '',
                trigger: parsed.trigger.slice(0, 200),
                steps: validSteps.map((s) => ({
                    tool: String(s.tool),
                    note: String(s.note),
                })),
                source: 'learned',
                schemaVersion: SCHEMA_VERSION,
                successCount: allEpisodes.length,
                lastUsed: new Date().toISOString(),
                modes: [],
            };

            await this.store.save(recipe);
            console.debug(`[RecipePromotion] Promoted ${allEpisodes.length} similar episodes to recipe: ${recipe.name}`);
        } catch (e) {
            console.warn('[RecipePromotion] Promotion failed:', e);
        }
    }
}
