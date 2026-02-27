/**
 * UpdateBaseTool
 *
 * Adds a new view to an existing .base file, or replaces a named view.
 * Reads the file, parses the YAML, appends/replaces the view, and saves.
 */

import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';

export class UpdateBaseTool extends BaseTool<'update_base'> {
    readonly name = 'update_base' as const;
    readonly isWriteOperation = true;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'update_base',
            description:
                'Add a new view to an existing Obsidian Bases file, or replace a view with a new configuration.',
            input_schema: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Path to the existing .base file',
                    },
                    view_name: {
                        type: 'string',
                        description: 'Name for the new view (if a view with this name exists, it is replaced)',
                    },
                    filter_property: {
                        type: 'string',
                        description: 'Frontmatter property to filter on',
                    },
                    filter_values: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Values the filter property must match',
                    },
                    columns: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Column names to show in the table',
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

    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const path = ((input.path as string) ?? '').trim();
        const viewName = ((input.view_name as string) ?? '').trim();
        const filterProp = (input.filter_property as string) ?? '';
        const filterValues: string[] = Array.isArray(input.filter_values) ? input.filter_values as string[] : [];
        const columns: string[] = Array.isArray(input.columns) ? input.columns as string[] : ['file.name'];
        const sortProp = (input.sort_property as string) ?? '';
        const sortDir = (input.sort_direction as string) ?? 'ASC';
        const excludeTemplates: boolean = input.exclude_templates !== false;

        if (!path || !viewName) {
            callbacks.pushToolResult(this.formatError(new Error('path and view_name are required')));
            return;
        }

        try {
            const file = this.app.vault.getFileByPath(path);
            if (!file) {
                callbacks.pushToolResult(this.formatError(new Error(`Base file not found: ${path}`)));
                return;
            }

            const existing = await this.app.vault.read(file);

            // Build new view block as YAML fragment (indented for the views array)
            const filterConditions: string[] = [];
            if (filterProp && filterValues.length > 0) {
                const quotedValues = filterValues.map((v) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(', ');
                filterConditions.push(`${filterProp}.containsAny(${quotedValues})`);
            }
            if (excludeTemplates) {
                filterConditions.push('\'!file.name.contains("Template")\'');
            }

            const viewLines: string[] = [];
            viewLines.push(`  - type: table`);
            viewLines.push(`    name: ${viewName}`);
            if (filterConditions.length > 0) {
                viewLines.push(`    filters:`);
                viewLines.push(`      and:`);
                for (const cond of filterConditions) {
                    viewLines.push(`        - ${cond}`);
                }
            }
            const orderedCols = ['file.name', ...columns.filter((c) => c !== 'file.name')];
            viewLines.push(`    order:`);
            for (const col of orderedCols) {
                viewLines.push(`      - ${col}`);
            }
            if (sortProp) {
                viewLines.push(`    sort:`);
                viewLines.push(`      - property: ${sortProp}`);
                viewLines.push(`        direction: ${sortDir}`);
            }
            viewLines.push(`    rowHeight: medium`);
            const newViewBlock = viewLines.join('\n');

            // Try to replace an existing view with the same name by simple line-based edit
            // If we can't find it cleanly, just append.
            const viewStartRegex = new RegExp(`^  - type: table\\s*\\n    name: ${this.escapeRegex(viewName)}`, 'm');
            if (viewStartRegex.test(existing)) {
                // Remove the old view block and replace: find next '  - type:' or end
                const viewBlockRegex = new RegExp(
                    `(  - type: table\\s*\\n    name: ${this.escapeRegex(viewName)}[\\s\\S]*?)(?=\\n  - type:|$)`,
                    'm',
                );
                const updated = existing.replace(viewBlockRegex, newViewBlock);
                await this.app.vault.modify(file, updated);
                callbacks.pushToolResult(`Updated view "${viewName}" in **${path}**`);
            } else {
                // Append the new view
                const updated = existing.trimEnd() + '\n' + newViewBlock + '\n';
                await this.app.vault.modify(file, updated);
                callbacks.pushToolResult(`Added view "${viewName}" to **${path}**`);
            }
            callbacks.log(`Updated base: ${path} (view: ${viewName})`);
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('update_base', error);
        }
    }

    private escapeRegex(s: string): string {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}
