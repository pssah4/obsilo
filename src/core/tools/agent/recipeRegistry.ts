/**
 * Recipe Registry — Built-in recipe definitions for execute_recipe (PAS-1.5)
 *
 * Recipes are pre-defined, validated shell commands that the agent can execute.
 * They use child_process.spawn with shell: false — NO shell expansion.
 *
 * Users can add custom recipes via settings; those are validated on load.
 */

export interface RecipeParameter {
    name: string;
    type: 'vault-file' | 'vault-output' | 'enum' | 'safe-string' | 'number';
    required: boolean;
    description: string;
    /** Allowed values for enum type */
    enumValues?: string[];
    /** Validation pattern for safe-string type */
    pattern?: RegExp;
    /** Min value for number type */
    min?: number;
    /** Max value for number type */
    max?: number;
}

export interface Recipe {
    id: string;
    name: string;
    description: string;
    /** Binary name (resolved via which/where to absolute path at runtime) */
    binary: string;
    /** Argument template array. Use {{paramName}} for substitution. */
    argsTemplate: string[];
    parameters: RecipeParameter[];
    /** Working directory — always vault root */
    cwd: 'vault-root';
    /** Max execution time in ms */
    timeout: number;
    /** Max stdout+stderr size in bytes */
    maxOutputSize: number;
    /** Whether this recipe produces an output file */
    producesFile: boolean;
}

export const BUILT_IN_RECIPES: Recipe[] = [
    {
        id: 'pandoc-pdf',
        name: 'Pandoc PDF Export',
        description: 'Convert a markdown file to PDF using Pandoc with XeLaTeX engine',
        binary: 'pandoc',
        argsTemplate: ['{{input}}', '-o', '{{output}}', '--pdf-engine=xelatex'],
        parameters: [
            {
                name: 'input',
                type: 'vault-file',
                required: true,
                description: 'Input markdown file (relative to vault root)',
            },
            {
                name: 'output',
                type: 'vault-output',
                required: true,
                description: 'Output PDF file path (relative to vault root)',
            },
        ],
        cwd: 'vault-root',
        timeout: 120_000,
        maxOutputSize: 10_000,
        producesFile: true,
    },
    {
        id: 'pandoc-docx',
        name: 'Pandoc DOCX Export',
        description: 'Convert a markdown file to DOCX using Pandoc',
        binary: 'pandoc',
        argsTemplate: ['{{input}}', '-o', '{{output}}'],
        parameters: [
            {
                name: 'input',
                type: 'vault-file',
                required: true,
                description: 'Input markdown file (relative to vault root)',
            },
            {
                name: 'output',
                type: 'vault-output',
                required: true,
                description: 'Output DOCX file path (relative to vault root)',
            },
        ],
        cwd: 'vault-root',
        timeout: 60_000,
        maxOutputSize: 10_000,
        producesFile: true,
    },
    {
        id: 'pandoc-convert',
        name: 'Pandoc Convert',
        description: 'Convert between document formats using Pandoc (format inferred from file extension)',
        binary: 'pandoc',
        argsTemplate: ['{{input}}', '-o', '{{output}}'],
        parameters: [
            {
                name: 'input',
                type: 'vault-file',
                required: true,
                description: 'Input file (relative to vault root)',
            },
            {
                name: 'output',
                type: 'vault-output',
                required: true,
                description: 'Output file path (relative to vault root)',
            },
        ],
        cwd: 'vault-root',
        timeout: 60_000,
        maxOutputSize: 10_000,
        producesFile: true,
    },
    {
        id: 'check-dependency',
        name: 'Check Dependency',
        description: 'Check if an external program is installed on the system',
        binary: 'which',
        argsTemplate: ['{{program}}'],
        parameters: [
            {
                name: 'program',
                type: 'safe-string',
                required: true,
                description: 'Program name to check',
                pattern: /^[a-zA-Z0-9._-]+$/,
            },
        ],
        cwd: 'vault-root',
        timeout: 5_000,
        maxOutputSize: 1_000,
        producesFile: false,
    },
];

/**
 * Find a recipe by ID in built-in + custom recipes.
 */
export function findRecipe(id: string, customRecipes: Recipe[] = []): Recipe | undefined {
    return BUILT_IN_RECIPES.find((r) => r.id === id)
        ?? customRecipes.find((r) => r.id === id);
}
