/**
 * Mastery Types — Shared type definitions for the Agent Skill Mastery system.
 *
 * ProceduralRecipe: Step-by-step tool sequence for known task patterns.
 * The agent follows recipes instead of re-discovering tool combinations.
 *
 * Two sources:
 *   - Static: TypeScript constants bundled with the plugin (staticRecipes.ts)
 *   - Learned: JSON files in .obsidian/plugins/obsidian-agent/recipes/ (Phase 3)
 */

export interface ProceduralRecipe {
    /** Unique identifier (kebab-case, e.g. "create-excalidraw-visualization") */
    id: string;
    /** Human-readable name */
    name: string;
    /** Brief description of what this recipe accomplishes */
    description: string;
    /** Pipe-separated trigger keywords for fast keyword matching */
    trigger: string;
    /** Ordered tool steps — the recipe's procedure */
    steps: RecipeStep[];
    /** Origin: bundled with plugin or learned from past executions */
    source: 'static' | 'learned';
    /** Schema version for future migrations */
    schemaVersion: number;
    /** How many times this recipe was successfully used */
    successCount: number;
    /** ISO timestamp of last successful use (null = never used) */
    lastUsed: string | null;
    /** Mode filter: empty array = available in all modes */
    modes: string[];
}

export interface RecipeStep {
    /** Tool name to call (must match a registered tool) */
    tool: string;
    /** What this step accomplishes (guidance for the LLM) */
    note: string;
    /** Optional parameter hints with {variable} placeholders for user-specific values */
    params?: Record<string, string>;
    /** When true, this step is optional / conditional */
    conditional?: boolean;
}
