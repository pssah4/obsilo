/**
 * EvaluateExpressionTool
 *
 * Executes a one-off JavaScript/TypeScript expression in the sandbox.
 * Useful for data transformations, regex testing, calculations, etc.
 * No persistent tool is created — just immediate execution.
 *
 * Part of Self-Development Phase 3: Sandbox + Dynamic Modules.
 */

import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';
import type { SandboxExecutor } from '../../sandbox/SandboxExecutor';
import type { EsbuildWasmManager } from '../../sandbox/EsbuildWasmManager';
import { AstValidator } from '../../sandbox/AstValidator';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

interface EvaluateExpressionInput {
    expression: string;
    context?: Record<string, unknown>;
    dependencies?: string[];
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export class EvaluateExpressionTool extends BaseTool<'evaluate_expression'> {
    readonly name = 'evaluate_expression' as const;
    readonly isWriteOperation = false;

    constructor(
        plugin: ObsidianAgentPlugin,
        private sandboxExecutor: SandboxExecutor,
        private esbuildManager: EsbuildWasmManager,
    ) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: this.name,
            description: 'Execute TypeScript/JavaScript in a sandboxed iframe. The sandbox provides ctx.vault (read, readBinary, write, writeBinary, list) and ctx.requestUrl for HTTP. Use for data transforms, computations, AND binary file generation (PPTX, XLSX, images via npm packages). Optionally specify dependencies to import npm packages. NEVER write Python scripts — use this tool instead.',
            input_schema: {
                type: 'object',
                properties: {
                    expression: {
                        type: 'string',
                        description: 'The TypeScript/JavaScript expression or code to evaluate. Must return a value. Use ctx.vault for file I/O and ctx.requestUrl for HTTP.',
                    },
                    context: {
                        type: 'object',
                        description: 'Optional context variables available as "ctx" inside the expression.',
                    },
                    dependencies: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Optional npm package names to bundle (e.g. ["pptxgenjs", "xlsx"]). When provided, packages are fetched from CDN and bundled with esbuild.',
                    },
                },
                required: ['expression'],
            },
        };
    }

    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const params = input as unknown as EvaluateExpressionInput;

        try {
            if (!params.expression) {
                throw new Error('Missing "expression".');
            }

            // AST validation (supplementary)
            const validation = AstValidator.validate(params.expression);
            if (!validation.valid) {
                throw new Error(`Expression validation failed:\n${validation.errors.join('\n')}`);
            }

            // Wrap expression in a module that exports an execute function
            const wrappedSource = `
export const definition = { name: '_eval', description: 'eval' };
export function execute(input: Record<string, unknown>, ctx: { vault: unknown; requestUrl: unknown }): unknown {
    const context = input.context || {};
    ${params.expression.includes('return') ? params.expression : `return (${params.expression})`};
}
`;

            const compiledJs = (params.dependencies?.length)
                ? await this.esbuildManager.build(wrappedSource, params.dependencies)
                : await this.esbuildManager.transform(wrappedSource);
            const result = await this.sandboxExecutor.execute(compiledJs, {
                context: params.context ?? {},
            });

            const output = typeof result === 'string'
                ? result
                : JSON.stringify(result, null, 2);

            callbacks.pushToolResult(this.formatSuccess(output));
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
        }
    }
}
