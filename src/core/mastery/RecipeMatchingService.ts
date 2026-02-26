/**
 * RecipeMatchingService — Matches user messages to procedural recipes.
 *
 * Strategy (ADR-017):
 *   1. Keyword-first (< 1ms): Trigger recall with prefix matching.
 *      Measures what fraction of trigger keywords appear in the user message
 *      (exact or prefix match for German word forms). No API call.
 *   2. Semantic fallback: If keyword matching returns fewer than maxResults,
 *      use Vectra search over recipe descriptions (only when semantic index
 *      is available).
 *
 * Budget: max 3 recipes, max 2000 chars total.
 */

import type { RecipeStore } from './RecipeStore';
import type { ProceduralRecipe } from './types';

export interface RecipeMatchResult {
    recipe: ProceduralRecipe;
    score: number;
}

const MAX_RESULTS = 3;
const MAX_CHARS = 2000;
/**
 * Minimum trigger recall score to consider a match.
 * 0.10 = at least 1 out of 10 trigger tokens must appear in the message.
 * This is deliberately low because a single specific keyword (e.g. "excalidraw")
 * is often enough to identify the right recipe.
 */
const MIN_TRIGGER_RECALL = 0.10;
/** Minimum prefix length for fuzzy stem matching (e.g. "visualisiert" matches "visualisierung") */
const MIN_PREFIX_LEN = 6;

export class RecipeMatchingService {
    private store: RecipeStore;

    constructor(store: RecipeStore) {
        this.store = store;
    }

    /**
     * Find matching recipes for a user message.
     * Returns up to MAX_RESULTS recipes within the char budget.
     */
    match(userMessage: string, mode?: string): RecipeMatchResult[] {
        const recipes = this.store.getAll(mode);
        if (recipes.length === 0) return [];

        const msgTokens = this.tokenize(userMessage);
        if (msgTokens.size === 0) return [];

        // Phase 1: Keyword matching (fast, no API call)
        const scored: RecipeMatchResult[] = [];
        for (const recipe of recipes) {
            const triggerTokens = this.tokenize(recipe.trigger.replace(/\|/g, ' '));
            const score = this.triggerRecall(msgTokens, triggerTokens);
            if (score >= MIN_TRIGGER_RECALL) {
                scored.push({ recipe, score });
            }
        }

        // Sort by score descending, take top N
        scored.sort((a, b) => b.score - a.score);
        const topMatches = scored.slice(0, MAX_RESULTS);

        // Enforce char budget
        return this.enforceCharBudget(topMatches);
    }

    /**
     * Build the prompt section string for matched recipes.
     * Returns empty string if no matches.
     */
    buildPromptSection(matches: RecipeMatchResult[]): string {
        if (matches.length === 0) return '';

        const parts: string[] = [
            '====', '',
            'PROCEDURAL RECIPES', '',
            'For the following task types, use this proven step-by-step approach:', '',
        ];

        for (const { recipe } of matches) {
            parts.push(`**${recipe.name}** (${recipe.source})`);
            parts.push(recipe.description);
            parts.push('Steps:');
            for (let i = 0; i < recipe.steps.length; i++) {
                const step = recipe.steps[i];
                const prefix = step.conditional ? `  ${i + 1}. [if needed] ` : `  ${i + 1}. `;
                parts.push(`${prefix}${step.tool} -- ${step.note}`);
            }
            parts.push('');
        }

        parts.push('These are GUIDELINES, not rigid scripts. Adapt parameters to the specific task.');
        return parts.join('\n');
    }

    /**
     * Tokenize a string into a set of lowercase words (3+ chars).
     */
    private tokenize(text: string): Set<string> {
        const words = text
            .toLowerCase()
            .replace(/[^a-z0-9\u00e4\u00f6\u00fc\u00df]/g, ' ')
            .split(/\s+/)
            .filter((w) => w.length >= 3);
        return new Set(words);
    }

    /**
     * Trigger recall: |matched trigger tokens| / |total trigger tokens|
     *
     * Unlike Jaccard, this is NOT penalized by long user messages.
     * A single specific keyword like "excalidraw" in a 20-word message
     * still produces a meaningful score (1/8 = 0.125).
     *
     * Also supports prefix matching for German word forms:
     * "visualisiert" matches "visualisierung" (shared prefix >= 6 chars).
     */
    private triggerRecall(msgTokens: Set<string>, triggerTokens: Set<string>): number {
        if (triggerTokens.size === 0) return 0;
        let matched = 0;
        const msgArray = [...msgTokens];

        for (const trigger of triggerTokens) {
            // Exact match
            if (msgTokens.has(trigger)) {
                matched++;
                continue;
            }
            // Prefix match: check if any message token shares a prefix >= MIN_PREFIX_LEN
            if (trigger.length >= MIN_PREFIX_LEN) {
                const prefix = trigger.slice(0, MIN_PREFIX_LEN);
                if (msgArray.some((m) => m.length >= MIN_PREFIX_LEN && m.startsWith(prefix))) {
                    matched += 0.8; // Slightly lower weight for prefix matches
                }
            }
        }

        return matched / triggerTokens.size;
    }

    /**
     * Trim results to fit within the character budget.
     */
    private enforceCharBudget(matches: RecipeMatchResult[]): RecipeMatchResult[] {
        const result: RecipeMatchResult[] = [];
        let totalChars = 0;

        for (const match of matches) {
            const recipeChars = this.estimateRecipeChars(match.recipe);
            if (totalChars + recipeChars > MAX_CHARS && result.length > 0) break;
            result.push(match);
            totalChars += recipeChars;
        }

        return result;
    }

    /**
     * Rough character estimate for a serialized recipe in the prompt.
     */
    private estimateRecipeChars(recipe: ProceduralRecipe): number {
        let chars = recipe.name.length + recipe.description.length + 50; // header overhead
        for (const step of recipe.steps) {
            chars += step.tool.length + step.note.length + 20; // step formatting
        }
        return chars;
    }
}
