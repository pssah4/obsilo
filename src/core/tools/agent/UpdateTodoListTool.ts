/**
 * UpdateTodoListTool - Maintain a visible task plan during a long task (Phase 1.3)
 *
 * The agent calls this to publish its current plan as a Markdown checklist.
 * The UI renders it as a persistent Todo-Box in the chat — updating live.
 *
 * Checklist format:
 *   - [ ] pending
 *   - [~] in progress
 *   - [x] done
 *
 * Adapted from Kilo Code's UpdateTodoListTool.ts pattern.
 */

import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';

interface UpdateTodoListInput {
    todos: string;
}

export class UpdateTodoListTool extends BaseTool<'update_todo_list'> {
    readonly name = 'update_todo_list' as const;
    readonly isWriteOperation = false;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'update_todo_list',
            description:
                'Publish your current task plan as a visible checklist in the chat. ' +
                'Use this at the START of any multi-step task to show the user what you plan to do, ' +
                'and update it as steps complete. ' +
                'Format: one item per line using - [ ] (pending), - [~] (in progress), - [x] (done). ' +
                'Call this BEFORE starting work, then update after each step completes.',
            input_schema: {
                type: 'object',
                properties: {
                    todos: {
                        type: 'string',
                        description:
                            'Markdown checklist. Each line must start with "- [ ]", "- [~]", or "- [x]". ' +
                            'Example:\n- [x] Read existing notes\n- [~] Create summary\n- [ ] Add tags',
                    },
                },
                required: ['todos'],
            },
        };
    }

    async execute(input: Record<string, any>, context: ToolExecutionContext): Promise<void> {
        const { todos } = input as UpdateTodoListInput;
        const { callbacks } = context;

        if (!todos || typeof todos !== 'string') {
            callbacks.pushToolResult(this.formatError(new Error('todos parameter is required')));
            return;
        }

        // Parse and validate
        const items = this.parseTodos(todos);
        if (items.length === 0) {
            callbacks.pushToolResult(
                this.formatError(new Error('No valid todo items found. Use - [ ], - [~], or - [x] format.'))
            );
            return;
        }

        // Notify UI via context callback
        if (context.updateTodos) {
            context.updateTodos(items);
        }

        const done = items.filter((i) => i.status === 'done').length;
        const total = items.length;
        callbacks.pushToolResult(
            `<todo_update items="${total}" done="${done}">Todo list updated (${done}/${total} complete)</todo_update>`
        );
        callbacks.log(`Todo list updated: ${done}/${total} done`);
    }

    private parseTodos(markdown: string): TodoItem[] {
        return markdown
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.startsWith('- ['))
            .map((line) => {
                const match = line.match(/^- \[([x~\s])\]\s*(.+)$/i);
                if (!match) return null;
                const statusChar = match[1].toLowerCase();
                const text = match[2].trim();
                const status: TodoItem['status'] =
                    statusChar === 'x' ? 'done' :
                    statusChar === '~' ? 'in_progress' :
                    'pending';
                return { text, status };
            })
            .filter((item): item is TodoItem => item !== null);
    }
}

export interface TodoItem {
    text: string;
    status: 'pending' | 'in_progress' | 'done';
}
