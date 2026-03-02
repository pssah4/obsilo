/**
 * BaseTool - Abstract base class for all tools
 *
 * Adapted from Kilo Code's tool architecture.
 * All tools (internal and MCP) extend this class.
 */

import type { App } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import type {
    ToolName,
    ToolDefinition,
    ToolExecutionContext,
} from './types';

/**
 * Abstract base class for all tools
 */
export abstract class BaseTool<TName extends ToolName = ToolName> {
    /**
     * The unique name of this tool
     */
    abstract readonly name: TName;

    /**
     * Whether this tool performs write operations
     * (determines if approval and checkpoints are needed)
     */
    abstract readonly isWriteOperation: boolean;

    /**
     * Obsidian app instance
     */
    protected app: App;

    /**
     * Plugin instance
     */
    protected plugin: ObsidianAgentPlugin;

    constructor(plugin: ObsidianAgentPlugin) {
        this.plugin = plugin;
        this.app = plugin.app;
    }

    /**
     * Get the tool definition (schema) for the LLM
     */
    abstract getDefinition(): ToolDefinition;

    /**
     * Execute the tool with the given input
     *
     * @param input - Tool input parameters from LLM
     * @param context - Execution context
     */
    abstract execute(
        input: Record<string, unknown>,
        context: ToolExecutionContext
    ): Promise<void>;

    /**
     * Validate the tool input (optional)
     * Override this to add custom validation
     */
    protected validate(input: Record<string, unknown>): void {
        // Default: no validation
        // Subclasses can override to validate input
    }

    /**
     * Format an error message for the LLM
     */
    protected formatError(error: unknown): string {
        if (error instanceof Error) {
            return `<error>${error.message}</error>`;
        }
        return `<error>Unknown error: ${String(error)}</error>`;
    }

    /**
     * Format a success message for the LLM
     */
    protected formatSuccess(message: string): string {
        return `<success>${message}</success>`;
    }

    /**
     * Format content for the LLM
     */
    protected formatContent(content: string, metadata?: Record<string, string>): string {
        const attrs = metadata
            ? Object.entries(metadata)
                  .map(([key, value]) => `${key}="${value}"`)
                  .join(' ')
            : '';

        return attrs ? `<content ${attrs}>\n${content}\n</content>` : content;
    }
}
