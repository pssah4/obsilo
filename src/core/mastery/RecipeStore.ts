/**
 * RecipeStore — Persistence layer for Procedural Recipes.
 *
 * Combines static (bundled) and learned (vault-local) recipes into
 * a single queryable store. Learned recipes are persisted as JSON
 * in .obsidian/plugins/obsidian-agent/recipes/.
 */

import type { Vault } from 'obsidian';
import type { ProceduralRecipe } from './types';
import { STATIC_RECIPES, SCHEMA_VERSION } from './staticRecipes';

export class RecipeStore {
    private staticRecipes: ProceduralRecipe[];
    private learnedRecipes: ProceduralRecipe[] = [];
    private vault: Vault;
    private recipesDir: string;

    constructor(vault: Vault, pluginDir: string) {
        this.vault = vault;
        this.recipesDir = `${pluginDir}/recipes`;
        this.staticRecipes = STATIC_RECIPES;
    }

    /**
     * Load learned recipes from disk. Safe to call multiple times.
     */
    async initialize(): Promise<void> {
        try {
            const exists = await this.vault.adapter.exists(this.recipesDir);
            if (!exists) return;

            const files = await this.vault.adapter.list(this.recipesDir);
            const jsonFiles = files.files.filter((f: string) => f.endsWith('.json'));

            this.learnedRecipes = [];
            for (const file of jsonFiles) {
                try {
                    const raw = await this.vault.adapter.read(file);
                    const recipe = JSON.parse(raw) as ProceduralRecipe;
                    if (recipe.schemaVersion === SCHEMA_VERSION && recipe.source === 'learned') {
                        this.learnedRecipes.push(recipe);
                    }
                } catch (e) {
                    console.warn(`[RecipeStore] Failed to load recipe ${file}:`, e);
                }
            }
        } catch (e) {
            console.warn('[RecipeStore] Failed to initialize:', e);
        }
    }

    /**
     * Get all recipes (static + learned), optionally filtered by mode.
     */
    getAll(mode?: string): ProceduralRecipe[] {
        const all = [...this.staticRecipes, ...this.learnedRecipes];
        if (!mode) return all;
        return all.filter((r) => r.modes.length === 0 || r.modes.includes(mode));
    }

    /**
     * Get a recipe by ID.
     */
    getById(id: string): ProceduralRecipe | undefined {
        return this.staticRecipes.find((r) => r.id === id)
            ?? this.learnedRecipes.find((r) => r.id === id);
    }

    /**
     * Save a learned recipe to disk.
     */
    async save(recipe: ProceduralRecipe): Promise<void> {
        recipe.source = 'learned';
        recipe.schemaVersion = SCHEMA_VERSION;

        const exists = await this.vault.adapter.exists(this.recipesDir);
        if (!exists) {
            await this.vault.adapter.mkdir(this.recipesDir);
        }

        const filePath = `${this.recipesDir}/${recipe.id}.json`;
        await this.vault.adapter.write(filePath, JSON.stringify(recipe, null, 2));

        // Update in-memory
        const idx = this.learnedRecipes.findIndex((r) => r.id === recipe.id);
        if (idx >= 0) {
            this.learnedRecipes[idx] = recipe;
        } else {
            this.learnedRecipes.push(recipe);
        }
    }

    /**
     * Delete a learned recipe from disk and memory.
     */
    async delete(id: string): Promise<void> {
        const idx = this.learnedRecipes.findIndex((r) => r.id === id);
        if (idx >= 0) {
            this.learnedRecipes.splice(idx, 1);
        }
        const filePath = `${this.recipesDir}/${id}.json`;
        const exists = await this.vault.adapter.exists(filePath);
        if (exists) {
            await this.vault.adapter.remove(filePath);
        }
    }

    /**
     * Increment success count and update lastUsed for a recipe.
     */
    incrementSuccess(id: string): void {
        const recipe = this.getById(id);
        if (recipe) {
            recipe.successCount++;
            recipe.lastUsed = new Date().toISOString();
            // Persist learned recipes only (static recipes are in-memory only)
            if (recipe.source === 'learned') {
                this.save(recipe).catch((e) =>
                    console.warn(`[RecipeStore] Failed to persist success count for ${id}:`, e)
                );
            }
        }
    }
}
