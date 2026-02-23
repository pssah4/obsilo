/**
 * CreateBaseTool
 *
 * Creates an Obsidian Bases (.base) file with a configured view.
 * The .base format is YAML with a `views` array.
 */

import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';

export class CreateBaseTool extends BaseTool<'create_base'> {
    readonly name = 'create_base' as const;
    readonly isWriteOperation = true;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'create_base',
            description:
                'Create an Obsidian Bases file (.base) — a structured view over vault notes. ' +
                'Bases filter and display notes by their frontmatter properties. ' +
                'IMPORTANT: This is Obsidian\'s native Bases feature, NOT the "DB Folder" plugin. ' +
                'If the user asks for a "DB Folder" table, do NOT use this tool — use the DB Folder plugin ' +
                'via execute_command("dbfolder:create-new-database-folder") instead. ' +
                'Only use create_base when the user explicitly asks for a Bases view or .base file.',
            input_schema: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'File path for the base (must end with .base, e.g. "Projects.base")',
                    },
                    view_name: {
                        type: 'string',
                        description: 'Display name for the first view (e.g. "All Projects")',
                    },
                    filter_property: {
                        type: 'string',
                        description: 'Frontmatter property to filter on (e.g. "Kategorie", "Status", "tags")',
                    },
                    filter_values: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Values the filter property must match (uses containsAny logic)',
                    },
                    columns: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Column names to show in the table (e.g. ["file.name", "Status", "Tags"]). file.name is always first.',
                    },
                    sort_property: {
                        type: 'string',
                        description: 'Property to sort by (optional)',
                    },
                    sort_direction: {
                        type: 'string',
                        enum: ['ASC', 'DESC'],
                        description: 'Sort direction (default: ASC)',
                    },
                    exclude_templates: {
                        type: 'boolean',
                        description: 'Exclude notes whose name contains "Template" (default: true)',
                    },
                },
                required: ['path', 'view_name'],
            },
        };
    }

    async execute(input: Record<string, any>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const path: string = (input.path as string ?? '').trim();
        const viewName: string = (input.view_name as string ?? 'Table').trim();
        const filterProp: string = input.filter_property ?? '';
        const filterValues: string[] = Array.isArray(input.filter_values) ? input.filter_values : [];
        const columns: string[] = Array.isArray(input.columns)
            ? input.columns
            : ['file.name'];
        const sortProp: string = input.sort_property ?? '';
        const sortDir: string = input.sort_direction ?? 'ASC';
        const excludeTemplates: boolean = input.exclude_templates !== false;

        if (!path) {
            callbacks.pushToolResult(this.formatError(new Error('path is required')));
            return;
        }
        if (!path.endsWith('.base')) {
            callbacks.pushToolResult(this.formatError(new Error('path must end with .base')));
            return;
        }

        try {
            // Refuse to overwrite existing bases — use update_base instead
            const existingFile = this.app.vault.getFileByPath(path);
            if (existingFile) {
                callbacks.pushToolResult(
                    `<error>Base file already exists: ${path}. ` +
                    `Use update_base to add or modify views in an existing base. ` +
                    `Do NOT use create_base on existing files.</error>`,
                );
                return;
            }

            // Build the filter conditions
            const filterConditions: string[] = [];
            if (filterProp && filterValues.length > 0) {
                const quotedValues = filterValues.map((v) => `"${v.replace(/"/g, '\\"')}"`).join(', ');
                filterConditions.push(`${filterProp}.containsAny(${quotedValues})`);
            }
            if (excludeTemplates) {
                filterConditions.push('\'!file.name.contains("Template")\'');
            }

            // Build YAML
            const lines: string[] = ['views:'];
            lines.push(`  - type: table`);
            lines.push(`    name: ${viewName}`);

            if (filterConditions.length > 0) {
                lines.push(`    filters:`);
                lines.push(`      and:`);
                for (const cond of filterConditions) {
                    lines.push(`        - ${cond}`);
                }
            }

            // Ensure file.name is always first
            const orderedCols = ['file.name', ...columns.filter((c) => c !== 'file.name')];
            lines.push(`    order:`);
            for (const col of orderedCols) {
                lines.push(`      - ${col}`);
            }

            if (sortProp) {
                lines.push(`    sort:`);
                lines.push(`      - property: ${sortProp}`);
                lines.push(`        direction: ${sortDir}`);
            }

            lines.push(`    rowHeight: medium`);

            const yaml = lines.join('\n') + '\n';

            // Write the file (we already verified it doesn't exist above)
            const dir = path.includes('/') ? path.split('/').slice(0, -1).join('/') : null;
            if (dir) {
                await this.app.vault.createFolder(dir).catch(() => { /* already exists */ });
            }
            await this.app.vault.create(path, yaml);
            callbacks.pushToolResult(`Created base: **${path}**\n\nOpen the file in Obsidian to view it as a database table.`);
            callbacks.log(`Created base: ${path}`);
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('create_base', error);
        }
    }
}
