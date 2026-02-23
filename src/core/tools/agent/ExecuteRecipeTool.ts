/**
 * ExecuteRecipeTool — Recipe Shell (PAS-1.5, ADR-109)
 *
 * Executes pre-defined shell recipes using child_process.spawn with shell: false.
 * NO arbitrary shell commands. NO shell expansion.
 *
 * Security (7 layers):
 *   1. Master toggle (recipes.enabled)
 *   2. Per-recipe toggle (recipeToggles)
 *   3. Parameter validation (type, length, charset, path confinement)
 *   4. No shell expansion (spawn with args array)
 *   5. Pipeline approval (isWriteOperation = true)
 *   6. Process confinement (cwd=vault, timeout, output limit, SIGKILL)
 *   7. Audit trail (OperationLogger)
 */

import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';
import { findRecipe, BUILT_IN_RECIPES } from './recipeRegistry';
import { validateRecipeParams } from './recipeValidator';

/** Resolve binary to absolute path via 'which' (macOS/Linux) or 'where' (Windows) */
async function resolveBinary(name: string): Promise<string | null> {
    const { spawn } = require('child_process') as typeof import('child_process');
    const cmd = process.platform === 'win32' ? 'where' : 'which';

    return new Promise((resolve) => {
        const child = spawn(cmd, [name], {
            shell: false,
            timeout: 5_000,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
        child.on('close', (code: number | null) => {
            if (code === 0 && stdout.trim()) {
                resolve(stdout.trim().split('\n')[0]); // First result
            } else {
                resolve(null);
            }
        });
        child.on('error', () => resolve(null));
    });
}

export class ExecuteRecipeTool extends BaseTool<'execute_recipe'> {
    readonly name = 'execute_recipe' as const;
    readonly isWriteOperation = true;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        // Build available recipes list for description
        const recipeList = BUILT_IN_RECIPES.map((r) => `${r.id}: ${r.description}`).join('; ');

        return {
            name: 'execute_recipe',
            description:
                'Execute a pre-defined recipe for external tools like Pandoc. ' +
                'Recipes are validated shell commands that run without shell expansion. ' +
                `Available recipes: ${recipeList}. ` +
                'Use check-dependency first to verify that a required program is installed.',
            input_schema: {
                type: 'object',
                properties: {
                    recipe_id: {
                        type: 'string',
                        description:
                            'The recipe ID to execute (e.g., "pandoc-pdf", "pandoc-docx", "check-dependency").',
                    },
                    params: {
                        type: 'object',
                        description:
                            'Parameters for the recipe. Keys are parameter names, values are strings. ' +
                            'Example: { "input": "notes/report.md", "output": "exports/report.pdf" }',
                    },
                },
                required: ['recipe_id', 'params'],
            },
        };
    }

    async execute(input: Record<string, any>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const recipeId = (input.recipe_id as string ?? '').trim();
        const params = (input.params as Record<string, unknown>) ?? {};

        // 1. Master toggle check
        if (!this.plugin.settings.recipes?.enabled) {
            callbacks.pushToolResult(
                this.formatError(new Error(
                    'Recipe execution is disabled. Enable it in Settings > Advanced > Shell.',
                )),
            );
            return;
        }

        // 2. Find recipe
        const customRecipes = this.plugin.settings.recipes?.customRecipes ?? [];
        const recipe = findRecipe(recipeId, customRecipes);
        if (!recipe) {
            const available = BUILT_IN_RECIPES.map((r) => r.id).join(', ');
            callbacks.pushToolResult(
                this.formatError(new Error(
                    `Unknown recipe: "${recipeId}". Available: ${available}`,
                )),
            );
            return;
        }

        // 3. Per-recipe toggle check
        const recipeToggles = this.plugin.settings.recipes?.recipeToggles ?? {};
        if (recipeToggles[recipeId] === false) {
            callbacks.pushToolResult(
                this.formatError(new Error(
                    `Recipe "${recipeId}" is disabled. Enable it in Settings > Advanced > Shell.`,
                )),
            );
            return;
        }

        // 4. Get vault root
        const adapter = this.app.vault.adapter;
        const vaultRoot: string = (adapter as any).basePath ?? (adapter as any).getBasePath?.() ?? '';
        if (!vaultRoot) {
            callbacks.pushToolResult(
                this.formatError(new Error('Cannot determine vault root path')),
            );
            return;
        }

        // 5. Validate parameters
        const errors = validateRecipeParams(recipe.parameters, params, vaultRoot);
        if (errors.length > 0) {
            const msgs = errors.map((e) => `${e.parameter}: ${e.message}`).join('; ');
            callbacks.pushToolResult(
                this.formatError(new Error(`Parameter validation failed: ${msgs}`)),
            );
            return;
        }

        // 6. Resolve binary to absolute path (S-06, S-13: no PATH hijacking)
        const binaryPath = await resolveBinary(recipe.binary);
        if (!binaryPath) {
            callbacks.pushToolResult(
                this.formatError(new Error(
                    `"${recipe.binary}" is not installed on this system. ` +
                    `Install it first, then try again.`,
                )),
            );
            return;
        }

        // 7. Build args from template
        const validatedParams: Record<string, string> = {};
        for (const param of recipe.parameters) {
            if (params[param.name] !== undefined) {
                validatedParams[param.name] = String(params[param.name]);
            }
        }

        const args = recipe.argsTemplate.map((tmpl) =>
            tmpl.replace(/\{\{(\w+)\}\}/g, (_, name) => validatedParams[name] ?? ''),
        );

        // 8. Spawn process (S-04: shell: false)
        try {
            const result = await this.spawnProcess(binaryPath, args, vaultRoot, recipe);

            if (result.exitCode !== 0) {
                const stderr = result.stderr.trim();
                callbacks.pushToolResult(
                    this.formatError(new Error(
                        `Recipe "${recipeId}" failed (exit code ${result.exitCode}).` +
                        (stderr ? ` Error: ${stderr}` : ''),
                    )),
                );
                return;
            }

            // Success
            let output = result.stdout.trim();
            if (recipe.producesFile) {
                const outputParam = recipe.parameters.find((p) => p.type === 'vault-output');
                const outputPath = outputParam ? validatedParams[outputParam.name] : '';
                output = `Recipe "${recipe.name}" completed successfully.` +
                    (outputPath ? ` Output file: ${outputPath}` : '') +
                    (output ? `\n\nProcess output:\n${output}` : '');
            }

            callbacks.pushToolResult(this.formatSuccess(output || `Recipe "${recipe.name}" completed.`));
            callbacks.log(`Recipe executed: ${recipeId} (${recipe.binary})`);
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('execute_recipe', error);
        }
    }

    /**
     * Spawn a child process with full confinement.
     * S-04: shell: false
     * S-05: Minimal env vars
     * S-06: cwd = vault root
     * S-09: Output capped, SIGKILL after timeout
     */
    private spawnProcess(
        binaryPath: string,
        args: string[],
        vaultRoot: string,
        recipe: { timeout: number; maxOutputSize: number },
    ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
        const { spawn } = require('child_process') as typeof import('child_process');

        return new Promise((resolve, reject) => {
            const child = spawn(binaryPath, args, {
                cwd: vaultRoot,
                shell: false,
                timeout: recipe.timeout,
                env: {
                    PATH: process.env.PATH,
                    HOME: process.env.HOME,
                    LANG: 'en_US.UTF-8',
                },
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true,
            });

            let stdout = '';
            let stderr = '';
            let stdoutSize = 0;
            let stderrSize = 0;
            const maxSize = recipe.maxOutputSize;

            child.stdout.on('data', (data: Buffer) => {
                if (stdoutSize < maxSize) {
                    const chunk = data.toString();
                    stdout += chunk;
                    stdoutSize += chunk.length;
                    if (stdoutSize >= maxSize) {
                        stdout = stdout.slice(0, maxSize) + '\n... [output truncated]';
                    }
                }
            });

            child.stderr.on('data', (data: Buffer) => {
                if (stderrSize < maxSize) {
                    const chunk = data.toString();
                    stderr += chunk;
                    stderrSize += chunk.length;
                    if (stderrSize >= maxSize) {
                        stderr = stderr.slice(0, maxSize) + '\n... [output truncated]';
                    }
                }
            });

            // SIGKILL fallback if process doesn't exit after timeout
            const killTimer = setTimeout(() => {
                try { child.kill('SIGKILL'); } catch {}
            }, recipe.timeout + 5_000);

            child.on('close', (code: number | null) => {
                clearTimeout(killTimer);
                resolve({
                    exitCode: code ?? 1,
                    stdout,
                    stderr,
                });
            });

            child.on('error', (err: Error) => {
                clearTimeout(killTimer);
                reject(err);
            });
        });
    }
}
