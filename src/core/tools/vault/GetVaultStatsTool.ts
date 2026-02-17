/**
 * GetVaultStatsTool - Return a high-level overview of the vault
 *
 * Provides counts and structure overview without reading every file.
 * Useful as a first step when the agent needs to understand vault scope.
 */

import { TFile, TFolder } from 'obsidian';
import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';

export class GetVaultStatsTool extends BaseTool<'get_vault_stats'> {
    readonly name = 'get_vault_stats' as const;
    readonly isWriteOperation = false;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'get_vault_stats',
            description:
                'Get a high-level overview of the vault: total notes, folders, top-level structure, most used tags, and recently modified files. Use this as a first step to understand vault size and organization.',
            input_schema: {
                type: 'object',
                properties: {},
            },
        };
    }

    async execute(_input: Record<string, any>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;

        try {
            const allFiles = this.app.vault.getMarkdownFiles();
            const allFolders = this.app.vault.getAllLoadedFiles().filter((f) => f instanceof TFolder);

            // Top-level folders
            const rootFolders = (this.app.vault.getRoot().children ?? [])
                .filter((f) => f instanceof TFolder)
                .map((f) => f.name)
                .sort();

            // Tag frequency
            const tagCounts: Record<string, number> = {};
            for (const file of allFiles) {
                const cache = this.app.metadataCache.getFileCache(file);
                if (!cache) continue;

                // Inline tags
                cache.tags?.forEach((tc) => {
                    const tag = tc.tag;
                    tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
                });

                // Frontmatter tags
                const fmTags = cache.frontmatter?.tags;
                if (fmTags) {
                    const arr = Array.isArray(fmTags) ? fmTags : [fmTags];
                    arr.forEach((t: string) => {
                        const tag = t.startsWith('#') ? t : `#${t}`;
                        tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
                    });
                }
            }

            // Top 15 tags by frequency
            const topTags = Object.entries(tagCounts)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 15)
                .map(([tag, count]) => `${tag} (${count})`);

            // Recently modified (last 10)
            const recentFiles = [...allFiles]
                .sort((a, b) => b.stat.mtime - a.stat.mtime)
                .slice(0, 10)
                .map((f) => {
                    const date = new Date(f.stat.mtime).toLocaleDateString();
                    return `${f.path} (${date})`;
                });

            const lines = [
                `<vault_stats>`,
                `Notes: ${allFiles.length}`,
                `Folders: ${allFolders.length}`,
                `Unique tags: ${Object.keys(tagCounts).length}`,
                ``,
                `Top-level folders:`,
                ...(rootFolders.length > 0
                    ? rootFolders.map((f) => `  ${f}/`)
                    : ['  (vault root — no subfolders)']),
                ``,
                `Most used tags:`,
                ...(topTags.length > 0 ? topTags.map((t) => `  ${t}`) : ['  (none)']),
                ``,
                `Recently modified:`,
                ...recentFiles.map((f) => `  ${f}`),
                `</vault_stats>`,
            ];

            callbacks.pushToolResult(lines.join('\n'));
            callbacks.log(`Vault stats: ${allFiles.length} notes, ${allFolders.length} folders`);
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('get_vault_stats', error);
        }
    }
}
