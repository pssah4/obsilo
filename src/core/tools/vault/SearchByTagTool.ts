/**
 * SearchByTagTool - Find notes by one or more tags
 *
 * Uses Obsidian's MetadataCache to efficiently search by tag
 * without reading every file. Supports AND/OR matching.
 */

import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';

interface SearchByTagInput {
    tags: string[];
    match?: 'any' | 'all';
    limit?: number;
}

export class SearchByTagTool extends BaseTool<'search_by_tag'> {
    readonly name = 'search_by_tag' as const;
    readonly isWriteOperation = false;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'search_by_tag',
            description:
                'Find all notes that have one or more specific tags. Tags can be specified with or without the # prefix. Use match="all" to require all tags (AND), or match="any" to require at least one (OR, default).',
            input_schema: {
                type: 'object',
                properties: {
                    tags: {
                        type: 'array',
                        items: { type: 'string' },
                        description:
                            'Tags to search for. The # prefix is optional (e.g., ["project", "#active"]).',
                    },
                    match: {
                        type: 'string',
                        enum: ['any', 'all'],
                        description: '"any" = OR match (default), "all" = AND match (note must have every tag).',
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum number of results to return (default: 50).',
                    },
                },
                required: ['tags'],
            },
        };
    }

    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { tags, match = 'any', limit = 50 } = input as unknown as SearchByTagInput;
        const { callbacks } = context;

        try {
            if (!tags || !Array.isArray(tags) || tags.length === 0) {
                throw new Error('tags must be a non-empty array');
            }

            // Normalize tags: ensure they all start with #
            const normalizedTags = tags.map((t) => (t.startsWith('#') ? t.toLowerCase() : `#${t.toLowerCase()}`));

            const results: { path: string; matchedTags: string[] }[] = [];
            const allFiles = this.app.vault.getMarkdownFiles();

            for (const file of allFiles) {
                const cache = this.app.metadataCache.getFileCache(file);
                if (!cache) continue;

                // Collect all tags in this file (from frontmatter + inline)
                const fileTags: string[] = [];

                // Frontmatter tags
                const fmTags = cache.frontmatter?.tags;
                if (fmTags) {
                    const arr = Array.isArray(fmTags) ? fmTags : [fmTags];
                    arr.forEach((t: string) => fileTags.push(t.startsWith('#') ? t.toLowerCase() : `#${t.toLowerCase()}`));
                }

                // Inline tags from cache
                if (cache.tags) {
                    cache.tags.forEach((tc) => fileTags.push(tc.tag.toLowerCase()));
                }

                const matchedTags = normalizedTags.filter((t) => fileTags.includes(t));

                const passes =
                    match === 'all'
                        ? matchedTags.length === normalizedTags.length
                        : matchedTags.length > 0;

                if (passes) {
                    results.push({ path: file.path, matchedTags });
                    if (results.length >= limit) break;
                }
            }

            if (results.length === 0) {
                callbacks.pushToolResult(
                    `<tag_search tags="${tags.join(', ')}" match="${match}">\nNo notes found.\n</tag_search>`
                );
                return;
            }

            const lines = results.map((r) => `- ${r.path}  [${r.matchedTags.join(', ')}]`);
            const output = [
                `<tag_search tags="${tags.join(', ')}" match="${match}" count="${results.length}">`,
                ...lines,
                '</tag_search>',
            ].join('\n');

            callbacks.pushToolResult(output);
            callbacks.log(`Tag search: found ${results.length} notes`);
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('search_by_tag', error);
        }
    }
}
