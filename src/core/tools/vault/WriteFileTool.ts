/**
 * WriteFileTool - Write content to a file, creating it if needed
 *
 * This is a write operation, so:
 * - isWriteOperation = true
 * - Requires approval (Phase 2)
 * - Creates checkpoint (Phase 3)
 */

import { TFile, TFolder } from 'obsidian';
import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';

interface WriteFileInput {
    path: string;
    content: string;
}

export class WriteFileTool extends BaseTool<'write_file'> {
    readonly name = 'write_file' as const;
    readonly isWriteOperation = true; // Triggers approval + checkpoint

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'write_file',
            description:
                'Write content to a file in the vault, creating it if it does not exist. Use this to create new notes or completely replace existing content.',
            input_schema: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description:
                            'Path to the file relative to vault root (e.g., "folder/note.md")',
                    },
                    content: {
                        type: 'string',
                        description: 'The complete content to write to the file',
                    },
                },
                required: ['path', 'content'],
            },
        };
    }

    async execute(input: Record<string, any>, context: ToolExecutionContext): Promise<void> {
        const { path, content } = input as WriteFileInput;
        const { callbacks } = context;

        try {
            // Validate input
            if (!path) {
                throw new Error('Path parameter is required');
            }
            if (content === undefined || content === null) {
                throw new Error('Content parameter is required');
            }

            // .obsidian/ paths are not in the vault index — use adapter directly
            if (path.startsWith('.obsidian/') || path.startsWith('.obsidian-agent/')) {
                await this.writeViaAdapter(path, content, callbacks);
                return;
            }

            // Check if file exists
            const existingFile = this.app.vault.getAbstractFileByPath(path);

            if (existingFile) {
                // File exists - modify it
                if (!(existingFile instanceof TFile)) {
                    throw new Error(`Path exists but is not a file: ${path}`);
                }

                const existingContent = await this.app.vault.read(existingFile);
                await this.app.vault.modify(existingFile, content);
                const beforeLines = existingContent.split('\n').length;
                const afterLines = content.split('\n').length;
                const added = Math.max(0, afterLines - beforeLines);
                const removed = Math.max(0, beforeLines - afterLines);
                callbacks.pushToolResult(
                    this.formatSuccess(`File updated: ${path} (${content.length} chars)`) +
                    `\n<diff_stats added="${added}" removed="${removed}"/>`
                );
                callbacks.log(`Successfully updated file: ${path}`);
            } else {
                // File doesn't exist - create it
                // First ensure parent folder exists
                const parentPath = path.substring(0, path.lastIndexOf('/'));
                if (parentPath) {
                    await this.ensureFolderExists(parentPath);
                }

                await this.app.vault.create(path, content);
                const newLines = content.split('\n').length;
                callbacks.pushToolResult(
                    this.formatSuccess(`File created: ${path} (${content.length} chars)`) +
                    `\n<diff_stats added="${newLines}" removed="0"/>`
                );
                callbacks.log(`Successfully created file: ${path}`);
            }
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('write_file', error);
        }
    }

    /**
     * Write via vault.adapter for paths outside the vault index (.obsidian/, .obsidian-agent/).
     * These paths are not tracked by Obsidian's file index, so vault.getAbstractFileByPath()
     * and vault.createFolder() don't work reliably for them.
     */
    private async writeViaAdapter(path: string, content: string, callbacks: ToolExecutionContext['callbacks']): Promise<void> {
        const adapter = this.app.vault.adapter;
        const existed = await adapter.exists(path);

        // Ensure parent directory exists
        const parentPath = path.substring(0, path.lastIndexOf('/'));
        if (parentPath) {
            const parentExists = await adapter.exists(parentPath);
            if (!parentExists) {
                await adapter.mkdir(parentPath);
            }
        }

        await adapter.write(path, content);

        if (existed) {
            callbacks.pushToolResult(this.formatSuccess(`File updated: ${path} (${content.length} chars)`));
            callbacks.log(`Successfully updated file: ${path}`);
        } else {
            callbacks.pushToolResult(this.formatSuccess(`File created: ${path} (${content.length} chars)`));
            callbacks.log(`Successfully created file: ${path}`);
        }
    }

    /**
     * Ensure a folder path exists, creating it if needed
     */
    private async ensureFolderExists(folderPath: string): Promise<void> {
        const folder = this.app.vault.getAbstractFileByPath(folderPath);

        if (!folder) {
            // Folder doesn't exist, create it
            await this.app.vault.createFolder(folderPath);
        } else if (!(folder instanceof TFolder)) {
            throw new Error(`Path exists but is not a folder: ${folderPath}`);
        }
    }
}
