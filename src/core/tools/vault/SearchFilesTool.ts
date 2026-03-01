import { TFile } from 'obsidian';
import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';
import { safeRegex } from '../../utils/safeRegex';

const MAX_RESULTS = 50;
const MAX_FILES_TO_SCAN = 500;

export class SearchFilesTool extends BaseTool<'search_files'> {
    readonly name = 'search_files' as const;
    readonly isWriteOperation = false;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'search_files',
            description:
                'Search for a text pattern across files in the vault. Returns matching lines with file path and line numbers. Use path "/" to search the entire vault.',
            input_schema: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Directory to search in (relative to vault root, or "/" for entire vault)',
                    },
                    pattern: {
                        type: 'string',
                        description: 'Text or regular expression to search for',
                    },
                    file_pattern: {
                        type: 'string',
                        description: 'Optional file extension filter, e.g. ".md" or ".txt"',
                    },
                },
                required: ['path', 'pattern'],
            },
        };
    }

    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const rawPath = (input.path as string) ?? '/';
        const pattern = (input.pattern as string) ?? '';
        const filePattern = input.file_pattern as string | undefined;

        if (!pattern) {
            callbacks.pushToolResult(this.formatError(new Error('pattern parameter is required')));
            return;
        }

        try {
            // K-2 / S-02: ReDoS-safe regex via shared utility
            const regex = safeRegex(pattern, 'i');

            const dirPath = rawPath === '/' || rawPath === '' ? '' : rawPath;

            // Get candidate files
            let files = this.app.vault.getFiles().filter((f) => {
                if (dirPath && !f.path.startsWith(dirPath + '/') && f.path !== dirPath) return false;
                if (filePattern && !f.name.endsWith(filePattern)) return false;
                return true;
            });

            if (files.length > MAX_FILES_TO_SCAN) {
                files = files.slice(0, MAX_FILES_TO_SCAN);
            }

            const results: string[] = [];
            let totalMatches = 0;

            for (const file of files) {
                if (totalMatches >= MAX_RESULTS) break;

                let content: string;
                try {
                    content = await this.app.vault.cachedRead(file);
                } catch {
                    continue;
                }

                const lines = content.split('\n');
                const fileMatches: string[] = [];

                for (let i = 0; i < lines.length; i++) {
                    if (regex.test(lines[i])) {
                        fileMatches.push(`  L${i + 1}: ${lines[i].trim()}`);
                        totalMatches++;
                        if (totalMatches >= MAX_RESULTS) break;
                    }
                }

                if (fileMatches.length > 0) {
                    results.push(`${file.path}:\n${fileMatches.join('\n')}`);
                }
            }

            if (results.length === 0) {
                callbacks.pushToolResult(`No matches found for "${pattern}" in "${rawPath}".`);
                return;
            }

            const header = `Found ${totalMatches} match(es) for "${pattern}" in "${rawPath || '/'}":${totalMatches >= MAX_RESULTS ? ` (showing first ${MAX_RESULTS})` : ''}\n\n`;
            callbacks.pushToolResult(header + results.join('\n\n'));
            callbacks.log(`Search "${pattern}" found ${totalMatches} matches across ${results.length} files`);
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('search_files', error);
        }
    }
}
