/**
 * QueryBaseTool
 *
 * Returns notes that match a base file's filter conditions.
 * Parses the .base file, extracts the first (or named) view's filter,
 * and queries the vault metadataCache against those conditions.
 *
 * Supported filter functions:
 *   - containsAny("val1", "val2", ...)  — property contains any of the values
 *   - contains("val")                    — property contains value
 *   - == "val"                           — property equals value
 *   - file.name.contains("val")          — file name contains
 * Negation prefix: ! is supported.
 */

import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';
import type { TFile } from 'obsidian';

export class QueryBaseTool extends BaseTool<'query_base'> {
    readonly name = 'query_base' as const;
    readonly isWriteOperation = false;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'query_base',
            description:
                'Query an Obsidian Bases file and return the notes that match its filter. ' +
                'Returns note paths and key frontmatter properties.',
            input_schema: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Path to the .base file to query',
                    },
                    view_name: {
                        type: 'string',
                        description: 'Name of the view to use (defaults to first view)',
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum number of results to return (default: 20)',
                    },
                },
                required: ['path'],
            },
        };
    }

    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const path: string = (input.path as string ?? '').trim();
        const viewName: string = (input.view_name as string ?? '').trim();
        const limit: number = Math.min(Number(input.limit) || 20, 100);

        if (!path) {
            callbacks.pushToolResult(this.formatError(new Error('path is required')));
            return;
        }

        try {
            const file = this.app.vault.getFileByPath(path);
            if (!file) {
                callbacks.pushToolResult(this.formatError(new Error(`Base file not found: ${path}`)));
                return;
            }

            const yaml = await this.app.vault.read(file);

            // Extract the target view's filter conditions (simple text parsing)
            const filters = this.extractFilters(yaml, viewName);
            const orderFields = this.extractOrder(yaml, viewName);

            // Query vault
            const allFiles = this.app.vault.getMarkdownFiles();
            const matched: TFile[] = [];
            for (const f of allFiles) {
                const cache = this.app.metadataCache.getFileCache(f);
                const fm = cache?.frontmatter ?? {};
                if (this.matchesFilters(f, fm, filters)) {
                    matched.push(f);
                }
            }

            // Limit results
            const results = matched.slice(0, limit);

            if (results.length === 0) {
                callbacks.pushToolResult(`No notes matched the filters in **${path}**.`);
                return;
            }

            const displayFields = orderFields.filter((f) => f !== 'file.name').slice(0, 5);

            const lines: string[] = [
                `Query results from **${path}** (${results.length} of ${matched.length} matching notes):`,
                '',
            ];
            for (const f of results) {
                const cache = this.app.metadataCache.getFileCache(f);
                const fm = cache?.frontmatter ?? {};
                const row = [`**${f.path}**`];
                for (const field of displayFields) {
                    const val = fm[field];
                    if (val !== undefined && val !== null) {
                        const display = Array.isArray(val) ? val.join(', ') : String(val);
                        row.push(`${field}: ${display.slice(0, 60)}`);
                    }
                }
                lines.push('- ' + row.join(' | '));
            }
            if (matched.length > limit) {
                lines.push(`\n…${matched.length - limit} more notes not shown.`);
            }

            callbacks.pushToolResult(lines.join('\n'));
            callbacks.log(`query_base: ${path} → ${results.length} results`);
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('query_base', error);
        }
    }

    // -------------------------------------------------------------------------
    // Simple .base YAML parser (text-based, no full YAML parser needed for MVP)
    // -------------------------------------------------------------------------

    private extractFilters(yaml: string, viewName: string): string[] {
        // Find the right view block
        const lines = yaml.split('\n');
        let inTargetView = false;
        let inFilters = false;
        const filters: string[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Detect view start
            if (line.trim().startsWith('- type: table')) {
                const nameLine = lines[i + 1]?.trim() ?? '';
                const name = nameLine.replace('name:', '').trim();
                inTargetView = !viewName || name === viewName;
                inFilters = false;
                continue;
            }
            if (!inTargetView) continue;
            // Next top-level view resets state
            if (line.startsWith('  - type:') && line !== lines[i]) {
                if (inTargetView) break; // left the target view
            }
            if (line.trim() === 'filters:' || line.trim() === 'and:') {
                inFilters = true;
                continue;
            }
            if (inFilters) {
                // Lines starting with '        - ' are filter conditions
                const m = line.match(/^\s+- (.+)$/);
                if (m) {
                    filters.push(m[1].replace(/^'|'$/g, '').trim());
                } else if (line.match(/^\s{4}[a-z]/) && !line.includes('- ')) {
                    inFilters = false; // left filter block
                }
            }
        }
        return filters;
    }

    private extractOrder(yaml: string, viewName: string): string[] {
        const lines = yaml.split('\n');
        let inTargetView = false;
        let inOrder = false;
        const order: string[] = [];

        for (const line of lines) {
            if (line.trim().startsWith('- type: table')) {
                inTargetView = false;
                inOrder = false;
                continue;
            }
            if (line.match(/^\s+name: /)) {
                const name = line.replace(/^\s+name:\s*/, '').trim();
                inTargetView = !viewName || name === viewName;
                continue;
            }
            if (!inTargetView) continue;
            if (line.trim() === 'order:') { inOrder = true; continue; }
            if (inOrder) {
                const m = line.match(/^\s+- (.+)$/);
                if (m) order.push(m[1].trim());
                else inOrder = false;
            }
        }
        return order;
    }

    private matchesFilters(file: TFile, fm: Record<string, unknown>, filters: string[]): boolean {
        for (const filter of filters) {
            if (!this.evaluateFilter(file, fm, filter)) return false;
        }
        return true;
    }

    private evaluateFilter(file: TFile, fm: Record<string, unknown>, filter: string): boolean {
        const negated = filter.startsWith('!');
        const expr = negated ? filter.slice(1) : filter;

        // file.name.contains("value")
        const fileNameContains = expr.match(/^file\.name\.contains\("(.+?)"\)$/i);
        if (fileNameContains) {
            const result = file.basename.toLowerCase().includes(fileNameContains[1].toLowerCase());
            return negated ? !result : result;
        }

        // property.containsAny("v1", "v2")
        const containsAny = expr.match(/^(\w[\w.]*?)\.containsAny\((.+)\)$/i);
        if (containsAny) {
            const prop = containsAny[1];
            const vals = this.parseStringArgs(containsAny[2]);
            const result = vals.some((v) => this.propContains(fm[prop], v));
            return negated ? !result : result;
        }

        // property.contains("value")
        const contains = expr.match(/^(\w[\w.]*?)\.contains\("(.+?)"\)$/i);
        if (contains) {
            const result = this.propContains(fm[contains[1]], contains[2]);
            return negated ? !result : result;
        }

        // property == "value" or property == true/false/number
        const eq = expr.match(/^(\w[\w.]*?)\s*==\s*(.+)$/);
        if (eq) {
            const prop = eq[1].trim();
            const rawVal = eq[2].trim().replace(/^"|"$/g, '');
            const fmVal = fm[prop];
            const fmStr = typeof fmVal === 'string' ? fmVal
                : typeof fmVal === 'number' || typeof fmVal === 'boolean' ? String(fmVal)
                : JSON.stringify(fmVal);
            const result = fmVal !== undefined && fmStr === rawVal;
            return negated ? !result : result;
        }

        return true; // unknown filter — pass-through
    }

    private toStr(val: unknown): string {
        if (typeof val === 'string') return val;
        if (typeof val === 'number' || typeof val === 'boolean') return String(val);
        return JSON.stringify(val);
    }

    private propContains(value: unknown, needle: string): boolean {
        if (value === undefined || value === null) return false;
        if (Array.isArray(value)) {
            return value.some((v) => this.toStr(v).toLowerCase().includes(needle.toLowerCase()));
        }
        return this.toStr(value).toLowerCase().includes(needle.toLowerCase());
    }

    private parseStringArgs(argsStr: string): string[] {
        const result: string[] = [];
        const regex = /"([^"\\]*)"/g;
        let m: RegExpExecArray | null;
        while ((m = regex.exec(argsStr)) !== null) {
            result.push(m[1]);
        }
        return result;
    }
}
