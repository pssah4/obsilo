/**
 * GetFrontmatterTool - Read YAML frontmatter from a note
 *
 * Uses Obsidian's MetadataCache for fast, pre-parsed access.
 * Falls back to manual parsing if the cache is not ready yet.
 */

import { TFile } from 'obsidian';
import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';

interface GetFrontmatterInput {
    path: string;
}

export class GetFrontmatterTool extends BaseTool<'get_frontmatter'> {
    readonly name = 'get_frontmatter' as const;
    readonly isWriteOperation = false;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'get_frontmatter',
            description:
                'Read the YAML frontmatter of a note. Returns all metadata fields such as tags, aliases, dates, status, or any custom properties. Use this before update_frontmatter to see current values.',
            input_schema: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Path to the note relative to vault root (e.g., "folder/note.md")',
                    },
                },
                required: ['path'],
            },
        };
    }

    async execute(input: Record<string, any>, context: ToolExecutionContext): Promise<void> {
        const { path } = input as GetFrontmatterInput;
        const { callbacks } = context;

        try {
            if (!path) throw new Error('path parameter is required');

            const file = this.app.vault.getAbstractFileByPath(path);
            if (!file) throw new Error(`File not found: ${path}`);
            if (!(file instanceof TFile)) throw new Error(`Path is not a file: ${path}`);

            // Use MetadataCache for pre-parsed frontmatter
            const cache = this.app.metadataCache.getFileCache(file);
            const fm = cache?.frontmatter;

            if (!fm || Object.keys(fm).length === 0) {
                callbacks.pushToolResult(
                    `<frontmatter path="${path}">\n(no frontmatter)\n</frontmatter>`
                );
                return;
            }

            // Serialize to YAML-like output (exclude internal Obsidian key)
            const entries = Object.entries(fm)
                .filter(([key]) => key !== 'position')
                .map(([key, value]) => {
                    if (Array.isArray(value)) {
                        const items = value.map((v) => `  - ${v}`).join('\n');
                        return `${key}:\n${items}`;
                    }
                    return `${key}: ${value}`;
                });

            const result = `<frontmatter path="${path}">\n${entries.join('\n')}\n</frontmatter>`;
            callbacks.pushToolResult(result);
            callbacks.log(`Read frontmatter from ${path} (${entries.length} fields)`);
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('get_frontmatter', error);
        }
    }
}
