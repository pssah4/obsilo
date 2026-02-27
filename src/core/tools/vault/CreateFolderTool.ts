import { TFolder } from 'obsidian';
import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';

export class CreateFolderTool extends BaseTool<'create_folder'> {
    readonly name = 'create_folder' as const;
    readonly isWriteOperation = true;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'create_folder',
            description:
                'Create a new folder (directory) in the vault. Creates all intermediate parent folders as needed.',
            input_schema: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Folder path relative to vault root (e.g., "projects/2024/notes")',
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
            const existing = this.app.vault.getAbstractFileByPath(path);

            if (existing instanceof TFolder) {
                callbacks.pushToolResult(this.formatSuccess(`Folder already exists: ${path}`));
                return;
            }

            if (existing) {
                callbacks.pushToolResult(
                    this.formatError(new Error(`A file already exists at that path: ${path}`))
                );
                return;
            }

            await this.app.vault.createFolder(path);
            callbacks.pushToolResult(this.formatSuccess(`Folder created: ${path}`));
            callbacks.log(`Created folder: ${path}`);
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('create_folder', error);
        }
    }
}
