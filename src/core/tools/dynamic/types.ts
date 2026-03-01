/**
 * Dynamic Tool Types
 *
 * Shared types for the dynamic tool system.
 */

export interface DynamicToolDefinition {
    name: string;
    description: string;
    input_schema: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
    };
    isWriteOperation?: boolean;
    dependencies?: string[];
}

export interface DynamicToolRecord {
    definition: DynamicToolDefinition;
    sourceTs: string;
    compiledJs: string;
    createdAt: string;
    updatedAt: string;
}

/**
 * Metadata for a code module within a skill.
 * The .ts source file self-defines via `export const definition = {...}`.
 * This interface represents the parsed/loaded state at runtime.
 */
export interface CodeModuleInfo {
    /** Tool name (must start with custom_) */
    name: string;
    /** Filename without .ts extension (e.g. "pptx-generator") */
    file: string;
    /** Description of what this code module does */
    description: string;
    /** JSON Schema for tool input */
    inputSchema: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
    };
    /** Whether this tool performs write operations */
    isWriteOperation: boolean;
    /** npm packages to bundle */
    dependencies: string[];
    /** Compiled JavaScript (loaded from code-compiled/ cache) */
    compiledJs?: string;
}
