/**
 * GetDailyNoteTool - Read (or create) the daily note for a given day
 *
 * Supports both the core "Daily notes" plugin and the "Periodic Notes" plugin.
 * Falls back to a simple date-based path if neither plugin is active.
 *
 * offset: 0 = today, -1 = yesterday, 1 = tomorrow, etc.
 */

import { TFile } from 'obsidian';
import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';

interface GetDailyNoteInput {
    offset?: number;
    create?: boolean;
}

export class GetDailyNoteTool extends BaseTool<'get_daily_note'> {
    readonly name = 'get_daily_note' as const;
    readonly isWriteOperation = false; // may create — handled inline

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'get_daily_note',
            description:
                'Read the daily note for a given day. offset=0 is today (default), offset=-1 is yesterday, offset=1 is tomorrow, etc. Set create=true to create the note if it does not exist yet.',
            input_schema: {
                type: 'object',
                properties: {
                    offset: {
                        type: 'number',
                        description: 'Day offset from today: 0 = today (default), -1 = yesterday, 1 = tomorrow.',
                    },
                    create: {
                        type: 'boolean',
                        description: 'Create the daily note if it does not exist (default: false).',
                    },
                },
            },
        };
    }

    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { offset = 0, create = false } = input as unknown as GetDailyNoteInput;
        const { callbacks } = context;

        try {
            const targetDate = new Date();
            targetDate.setDate(targetDate.getDate() + offset);

            const path = this.resolveDailyNotePath(targetDate);
            const dateStr = targetDate.toISOString().slice(0, 10);

            let file = this.app.vault.getAbstractFileByPath(path);

            if (!file) {
                if (!create) {
                    callbacks.pushToolResult(
                        `<daily_note date="${dateStr}">\n` +
                        `Note not found at: ${path}\n` +
                        `Use create=true to create it.\n` +
                        `</daily_note>`
                    );
                    return;
                }

                // Create the note (and any missing parent folders)
                const dir = path.substring(0, path.lastIndexOf('/'));
                if (dir) {
                    const dirExists = await this.app.vault.adapter.exists(dir);
                    if (!dirExists) {
                        await this.app.vault.createFolder(dir);
                    }
                }

                const template = `# ${dateStr}\n\n`;
                file = await this.app.vault.create(path, template);
                callbacks.log(`Created daily note: ${path}`);
            }

            if (!(file instanceof TFile)) {
                throw new Error(`Path is not a file: ${path}`);
            }

            const content = await this.app.vault.read(file);
            callbacks.pushToolResult(
                `<daily_note date="${dateStr}" path="${path}">\n${content}\n</daily_note>`
            );
            callbacks.log(`Read daily note: ${path}`);
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('get_daily_note', error);
        }
    }

    /**
     * Determine the expected path for the daily note.
     * Checks core "Daily notes" plugin settings, then falls back to YYYY-MM-DD.md in vault root.
     */
    private resolveDailyNotePath(date: Date): string {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');

        // Try to read Daily Notes plugin settings from internal config
        try {
            const config = this.app.internalPlugins?.plugins?.['daily-notes']?.instance?.options;
            if (config) {
                const folder = ((config.folder as string) ?? '').replace(/\/$/, '');
                const format = ((config.format as string) ?? 'YYYY-MM-DD').trim();
                const filename = this.formatDate(date, format);
                return folder ? `${folder}/${filename}.md` : `${filename}.md`;
            }
        } catch {
            // Plugin not active or config unavailable — use fallback
        }

        // Try Periodic Notes plugin
        try {
            const periodicPlugin = this.app.plugins?.plugins?.['periodic-notes'] as Record<string, unknown> | undefined;
            const periodicSettings = periodicPlugin?.settings as Record<string, Record<string, unknown>> | undefined;
            if (periodicSettings?.daily?.enabled) {
                const folder = ((periodicSettings.daily.folder as string) ?? '').replace(/\/$/, '');
                const format = ((periodicSettings.daily.format as string) ?? 'YYYY-MM-DD').trim();
                const filename = this.formatDate(date, format);
                return folder ? `${folder}/${filename}.md` : `${filename}.md`;
            }
        } catch {
            // Plugin not active
        }

        // Default fallback: YYYY-MM-DD.md in vault root
        return `${y}-${m}-${d}.md`;
    }

    /** Minimal moment-like date formatter for common Daily Notes format strings */
    private formatDate(date: Date, format: string): string {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        const M = date.toLocaleString('en', { month: 'long' });
        const MMM = date.toLocaleString('en', { month: 'short' });
        const ddd = date.toLocaleString('en', { weekday: 'long' });

        return format
            .replace(/YYYY/g, String(y))
            .replace(/YY/g, String(y).slice(-2))
            .replace(/MM/g, m)
            .replace(/MMMM/g, M)
            .replace(/MMM/g, MMM)
            .replace(/DD/g, d)
            .replace(/dddd/g, ddd)
            .replace(/D/g, String(date.getDate()));
    }
}
