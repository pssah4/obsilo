/**
 * GetLinkedNotesTool - Get forward links and backlinks for a note
 *
 * Uses Obsidian's MetadataCache for both directions:
 * - Forward links: notes this file links to ([[wikilinks]] and [md](links))
 * - Backlinks: notes that link to this file
 */

import { TFile } from 'obsidian';
import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';

interface GetLinkedNotesInput {
    path: string;
    direction?: 'both' | 'forward' | 'backlinks';
}

export class GetLinkedNotesTool extends BaseTool<'get_linked_notes'> {
    readonly name = 'get_linked_notes' as const;
    readonly isWriteOperation = false;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'get_linked_notes',
            description:
                'Get the forward links (notes this note links to) and backlinks (notes that link to this note) for a given file. Useful for understanding note relationships and navigating the knowledge graph.',
            input_schema: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Path to the note relative to vault root.',
                    },
                    direction: {
                        type: 'string',
                        enum: ['both', 'forward', 'backlinks'],
                        description: '"both" (default) = forward links + backlinks, "forward" = only links this note makes, "backlinks" = only notes linking to this note.',
                    },
                },
                required: ['path'],
            },
        };
    }

    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { path, direction = 'both' } = input as unknown as GetLinkedNotesInput;
        const { callbacks } = context;

        try {
            if (!path) throw new Error('path parameter is required');

            const file = this.app.vault.getAbstractFileByPath(path);
            if (!file) throw new Error(`File not found: ${path}`);
            if (!(file instanceof TFile)) throw new Error(`Path is not a file: ${path}`);

            const lines: string[] = [`<linked_notes path="${path}">`];

            // Forward links
            if (direction === 'both' || direction === 'forward') {
                const cache = this.app.metadataCache.getFileCache(file);
                const links = cache?.links ?? [];
                const embeds = cache?.embeds ?? [];

                const forwardPaths = new Set<string>();
                [...links, ...embeds].forEach((lc) => {
                    const resolved = this.app.metadataCache.getFirstLinkpathDest(lc.link, path);
                    if (resolved) {
                        forwardPaths.add(resolved.path);
                    } else {
                        forwardPaths.add(`${lc.link} (unresolved)`);
                    }
                });

                lines.push(`\nForward links (${forwardPaths.size}):`);
                if (forwardPaths.size > 0) {
                    forwardPaths.forEach((p) => lines.push(`  → ${p}`));
                } else {
                    lines.push('  (none)');
                }
            }

            // Backlinks
            if (direction === 'both' || direction === 'backlinks') {
                const backlinks = this.app.metadataCache.getBacklinksForFile(file);
                const backlinkPaths = backlinks ? Object.keys(backlinks.data) : [];

                lines.push(`\nBacklinks (${backlinkPaths.length}):`);
                if (backlinkPaths.length > 0) {
                    backlinkPaths.forEach((p) => lines.push(`  ← ${p}`));
                } else {
                    lines.push('  (none)');
                }
            }

            lines.push('</linked_notes>');
            callbacks.pushToolResult(lines.join('\n'));
            callbacks.log(`Linked notes for ${path}`);
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('get_linked_notes', error);
        }
    }
}
