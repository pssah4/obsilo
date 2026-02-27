import { TFolder } from 'obsidian';
import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';

export class ListFilesTool extends BaseTool<'list_files'> {
    readonly name = 'list_files' as const;
    readonly isWriteOperation = false;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'list_files',
            description:
                'List files and folders in a directory of the vault. Use recursive=true to list all files in nested subdirectories. Use path "/" or "" for the vault root.',
            input_schema: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Directory path relative to vault root (e.g., "folder" or "/" for root)',
                    },
                    recursive: {
                        type: 'boolean',
                        description: 'If true, list files in all subdirectories as well',
                    },
                },
                required: ['path'],
            },
        };
    }

    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const rawPath = (input.path as string) ?? '/';
        const recursive = (input.recursive as boolean) ?? false;

        try {
            // Normalize root path
            const dirPath = rawPath === '/' || rawPath === '' ? '' : rawPath;

            // Get all files in vault and filter by prefix
            const allFiles = this.app.vault.getFiles();
            const allFolders = this.app.vault.getAllFolders();

            const matchingFiles = allFiles.filter((f) => {
                if (!dirPath) return true;
                if (recursive) return f.path.startsWith(dirPath + '/') || f.path.startsWith(dirPath);
                // Non-recursive: only direct children
                const rel = dirPath ? f.path.replace(dirPath + '/', '') : f.path;
                return f.path.startsWith(dirPath ? dirPath + '/' : '') && !rel.includes('/');
            });

            const matchingFolders = allFolders.filter((folder) => {
                if (!dirPath) {
                    // Root: show top-level folders only (non-recursive)
                    return recursive ? folder.path !== '' : (!folder.path.includes('/') && folder.path !== '');
                }
                if (recursive) return folder.path.startsWith(dirPath + '/');
                // Non-recursive: direct child folders only
                const rel = folder.path.replace(dirPath + '/', '');
                return folder.path.startsWith(dirPath + '/') && !rel.includes('/');
            });

            if (matchingFiles.length === 0 && matchingFolders.length === 0) {
                // Check if the folder itself exists
                const target = this.app.vault.getAbstractFileByPath(dirPath);
                if (!target && dirPath !== '') {
                    callbacks.pushToolResult(this.formatError(new Error(`Directory not found: ${rawPath}`)));
                    return;
                }
                callbacks.pushToolResult(`(empty directory: ${rawPath})`);
                return;
            }

            const lines: string[] = [];

            // Show folders first
            for (const folder of matchingFolders.sort((a, b) => a.path.localeCompare(b.path))) {
                lines.push(`[DIR]  ${folder.path}/`);
            }
            // Then files
            for (const file of matchingFiles.sort((a, b) => a.path.localeCompare(b.path))) {
                lines.push(`[FILE] ${file.path}`);
            }

            const header = `Contents of "${rawPath || '/'}" (${matchingFolders.length} folders, ${matchingFiles.length} files${recursive ? ', recursive' : ''}):\n`;
            callbacks.pushToolResult(header + lines.join('\n'));
            callbacks.log(`Listed ${lines.length} entries in ${rawPath}`);
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('list_files', error);
        }
    }
}
