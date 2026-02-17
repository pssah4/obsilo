/**
 * OpenNoteTool - Open a note in the Obsidian editor
 *
 * Uses workspace.openLinkText to navigate to a note.
 * This is an "agent control" style tool — it affects the UI.
 */

import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';

interface OpenNoteInput {
    path: string;
    newLeaf?: boolean;
}

export class OpenNoteTool extends BaseTool<'open_note'> {
    readonly name = 'open_note' as const;
    readonly isWriteOperation = false;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'open_note',
            description:
                'Open a note in the Obsidian editor so the user can see or edit it. Use this after creating or modifying a note to bring it into focus, or when the user asks to navigate to a specific note.',
            input_schema: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Path to the note relative to vault root (e.g., "folder/note.md").',
                    },
                    newLeaf: {
                        type: 'boolean',
                        description: 'Open in a new tab/pane (default: false — opens in current pane).',
                    },
                },
                required: ['path'],
            },
        };
    }

    async execute(input: Record<string, any>, context: ToolExecutionContext): Promise<void> {
        const { path, newLeaf = false } = input as OpenNoteInput;
        const { callbacks } = context;

        try {
            if (!path) throw new Error('path parameter is required');

            // Check the file exists
            const file = this.app.vault.getAbstractFileByPath(path);
            if (!file) throw new Error(`File not found: ${path}`);

            // openLinkText handles wikilink resolution gracefully
            await this.app.workspace.openLinkText(path, '', newLeaf);

            callbacks.pushToolResult(
                this.formatSuccess(`Opened note: ${path}`)
            );
            callbacks.log(`Opened note: ${path}`);
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('open_note', error);
        }
    }
}
