/**
 * ReadFileTool - Read the complete content of a file from the vault
 *
 * This is a read-only tool, so:
 * - isWriteOperation = false
 * - No approval needed
 * - No checkpoint needed
 */

import { TFile } from 'obsidian';
import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';

interface ReadFileInput {
    path: string;
}

export class ReadFileTool extends BaseTool<'read_file'> {
    readonly name = 'read_file' as const;
    readonly isWriteOperation = false;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'read_file',
            description:
                'Read the complete content of a file from the vault. Use this to view notes, check existing content before editing, or gather information.',
            input_schema: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description:
                            'Path to the file relative to vault root (e.g., "folder/note.md")',
                    },
                },
                required: ['path'],
            },
        };
    }

    async execute(input: Record<string, any>, context: ToolExecutionContext): Promise<void> {
        const { path } = input as ReadFileInput;
        const { callbacks } = context;

        try {
            // Validate input
            if (!path) {
                throw new Error('Path parameter is required');
            }

            // Get the file from vault (indexed files)
            const file = this.app.vault.getAbstractFileByPath(path);

            let content: string;
            let filePath: string;
            let basename: string;
            let extension: string;

            if (file && file instanceof TFile) {
                // Standard path: file is in Obsidian's vault index
                content = await this.app.vault.read(file);
                filePath = file.path;
                basename = file.basename;
                extension = file.extension;
            } else {
                // Fallback: file might be in a hidden/dot folder (e.g. .obsidian-agent/)
                // that Obsidian doesn't index. Use the adapter for direct filesystem access.
                const exists = await this.app.vault.adapter.exists(path);
                if (!exists) {
                    callbacks.pushToolResult(
                        this.formatError(new Error(`File not found: ${path}`)),
                    );
                    return;
                }
                content = await this.app.vault.adapter.read(path);
                filePath = path;
                const parts = path.split('/');
                const filename = parts[parts.length - 1] ?? path;
                const dotIdx = filename.lastIndexOf('.');
                basename = dotIdx > 0 ? filename.substring(0, dotIdx) : filename;
                extension = dotIdx > 0 ? filename.substring(dotIdx + 1) : '';
            }

            // Return formatted content
            const result = this.formatContent(content, {
                path: filePath,
                basename,
                extension,
            });

            callbacks.pushToolResult(result);
            callbacks.log(`Successfully read file: ${path} (${content.length} chars)`);
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('read_file', error);
        }
    }
}
