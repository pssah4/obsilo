import { TFile, TFolder } from 'obsidian';
import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';

export class DeleteFileTool extends BaseTool<'delete_file'> {
    readonly name = 'delete_file' as const;
    readonly isWriteOperation = true;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'delete_file',
            description:
                'Move a file or empty folder to the trash (safe delete). The item can be restored from the OS trash or Obsidian trash folder.',
            input_schema: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Path to the file or folder to delete (relative to vault root)',
                    },
                },
                required: ['path'],
            },
        };
    }

    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const path = (input.path as string) ?? '';

        if (!path) {
            callbacks.pushToolResult(this.formatError(new Error('path parameter is required')));
            return;
        }

        try {
            const item = this.app.vault.getAbstractFileByPath(path);

            if (!item) {
                callbacks.pushToolResult(this.formatError(new Error(`Not found: ${path}`)));
                return;
            }

            const isFolder = item instanceof TFolder;

            if (isFolder) {
                // Only delete empty folders to avoid data loss
                const folder = item as TFolder;
                if (folder.children && folder.children.length > 0) {
                    callbacks.pushToolResult(
                        this.formatError(
                            new Error(
                                `Cannot delete non-empty folder: ${path}. Delete the files inside first, or use write_file to manage the contents.`
                            )
                        )
                    );
                    return;
                }
            }

            // Use Obsidian's trash (moves to .trash in vault or OS trash)
            await this.app.vault.trash(item, true);

            const type = isFolder ? 'Folder' : 'File';
            callbacks.pushToolResult(this.formatSuccess(`${type} moved to trash: ${path}`));
            callbacks.log(`Deleted (trashed) ${isFolder ? 'folder' : 'file'}: ${path}`);
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('delete_file', error);
        }
    }
}
