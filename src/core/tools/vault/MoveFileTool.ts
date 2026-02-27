import { TFile, TFolder } from 'obsidian';
import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';

export class MoveFileTool extends BaseTool<'move_file'> {
    readonly name = 'move_file' as const;
    readonly isWriteOperation = true;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'move_file',
            description:
                'Move or rename a file or folder to a new path. Can be used to rename a file by keeping the same directory but changing the filename.',
            input_schema: {
                type: 'object',
                properties: {
                    source: {
                        type: 'string',
                        description: 'Current path of the file or folder (relative to vault root)',
                    },
                    destination: {
                        type: 'string',
                        description: 'New path for the file or folder (relative to vault root)',
                    },
                },
                required: ['source', 'destination'],
            },
        };
    }

    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const source = (input.source as string) ?? '';
        const destination = (input.destination as string) ?? '';

        if (!source) {
            callbacks.pushToolResult(this.formatError(new Error('source parameter is required')));
            return;
        }
        if (!destination) {
            callbacks.pushToolResult(this.formatError(new Error('destination parameter is required')));
            return;
        }
        if (source === destination) {
            callbacks.pushToolResult(this.formatError(new Error('source and destination are the same path')));
            return;
        }

        try {
            const item = this.app.vault.getAbstractFileByPath(source);

            if (!item) {
                callbacks.pushToolResult(this.formatError(new Error(`Not found: ${source}`)));
                return;
            }

            // Check destination doesn't already exist
            const existing = this.app.vault.getAbstractFileByPath(destination);
            if (existing) {
                callbacks.pushToolResult(
                    this.formatError(new Error(`Destination already exists: ${destination}`))
                );
                return;
            }

            // Ensure parent directory of destination exists
            const parentPath = destination.includes('/')
                ? destination.substring(0, destination.lastIndexOf('/'))
                : '';

            if (parentPath) {
                const parent = this.app.vault.getAbstractFileByPath(parentPath);
                if (!parent) {
                    await this.app.vault.createFolder(parentPath);
                }
            }

            await this.app.vault.rename(item, destination);

            const type = item instanceof TFolder ? 'Folder' : 'File';
            callbacks.pushToolResult(this.formatSuccess(`${type} moved: ${source} → ${destination}`));
            callbacks.log(`Moved ${source} → ${destination}`);
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('move_file', error);
        }
    }
}
