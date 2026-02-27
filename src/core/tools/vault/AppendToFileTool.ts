/**
 * AppendToFileTool - Append content to end of a file (Sprint 1.1)
 *
 * Useful for: Daily Notes, Logbuch entries, appending sections.
 * More efficient than read_file + write_file when only adding content.
 */

import { TFile, TFolder } from 'obsidian';
import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';

interface AppendToFileInput {
    path: string;
    content: string;
    separator?: string;
}

export class AppendToFileTool extends BaseTool<'append_to_file'> {
    readonly name = 'append_to_file' as const;
    readonly isWriteOperation = true;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'append_to_file',
            description:
                'Append content to the end of an existing file. ' +
                'If the file does not exist, it will be created. ' +
                'Use this for adding entries to logs, daily notes, or appending sections to existing notes. ' +
                'For targeted edits within a file, use edit_file instead.',
            input_schema: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Path to the file relative to vault root (e.g., "Daily/2025-01-15.md")',
                    },
                    content: {
                        type: 'string',
                        description: 'The content to append to the end of the file.',
                    },
                    separator: {
                        type: 'string',
                        description:
                            'String to insert between existing content and new content (default: "\\n"). ' +
                            'Use "\\n\\n" to add a blank line before the appended content.',
                    },
                },
                required: ['path', 'content'],
            },
        };
    }

    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { path, content, separator = '\n' } = input as unknown as AppendToFileInput;
        const { callbacks } = context;

        try {
            if (!path) throw new Error('path parameter is required');
            if (!content) throw new Error('content parameter is required');

            const existing = this.app.vault.getAbstractFileByPath(path);

            if (existing) {
                if (!(existing instanceof TFile)) {
                    throw new Error(`Path exists but is not a file: ${path}`);
                }
                const currentContent = await this.app.vault.read(existing);
                const newContent = currentContent ? currentContent + separator + content : content;
                await this.app.vault.modify(existing, newContent);
                const appendedLines = content.split('\n').length;
                callbacks.pushToolResult(
                    this.formatSuccess(`Appended to ${path} (+${appendedLines} lines)`) +
                    `\n<diff_stats added="${appendedLines}" removed="0"/>`
                );
            } else {
                // File doesn't exist — create it
                const parentPath = path.substring(0, path.lastIndexOf('/'));
                if (parentPath) {
                    await this.ensureFolderExists(parentPath);
                }
                await this.app.vault.create(path, content);
                const newLines = content.split('\n').length;
                callbacks.pushToolResult(
                    this.formatSuccess(`Created and wrote to ${path} (${newLines} lines)`) +
                    `\n<diff_stats added="${newLines}" removed="0"/>`
                );
            }

            callbacks.log(`Successfully appended to file: ${path}`);
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('append_to_file', error);
        }
    }

    private async ensureFolderExists(folderPath: string): Promise<void> {
        const folder = this.app.vault.getAbstractFileByPath(folderPath);
        if (!folder) {
            await this.app.vault.createFolder(folderPath);
        } else if (!(folder instanceof TFolder)) {
            throw new Error(`Path exists but is not a folder: ${folderPath}`);
        }
    }
}
