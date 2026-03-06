/**
 * TaskExtractor — Pure regex-based scanner for `- [ ]` items in agent responses.
 *
 * No side effects, no state, no Obsidian dependency.
 * ADR-026: Post-Processing Hook for Task Extraction.
 */

import type { TaskItem } from './types';

/** Pattern matching unchecked markdown checkboxes: `- [ ] text` or `* [ ] text` */
const CHECKBOX_PATTERN = /^[\t ]*[-*]\s\[ \]\s+(.+)$/gm;

/** Pattern matching `@Person` or `@Person:` at the start of task text */
const ASSIGNEE_PATTERN = /^@(\S+):?\s*/;

/** Pattern matching `due: YYYY-MM-DD` or `(due: YYYY-MM-DD)` anywhere in text */
const DUE_DATE_PATTERN = /\(?\bdue:\s*(\d{4}-\d{2}-\d{2})\)?/i;

/**
 * Scans text for unchecked markdown checkboxes and parses assignee + due date.
 *
 * @param text - The agent response text to scan
 * @returns Array of parsed TaskItems (empty if no tasks found)
 */
export function scan(text: string): TaskItem[] {
    const items: TaskItem[] = [];
    let match: RegExpExecArray | null;

    // Reset lastIndex for global regex
    CHECKBOX_PATTERN.lastIndex = 0;

    while ((match = CHECKBOX_PATTERN.exec(text)) !== null) {
        const rawText = match[1].trim();
        let cleanText = rawText;
        let assignee = '';
        let dueDate = '';

        // Extract assignee (@Person or @Person:)
        const assigneeMatch = cleanText.match(ASSIGNEE_PATTERN);
        if (assigneeMatch) {
            assignee = `@${assigneeMatch[1]}`;
            cleanText = cleanText.slice(assigneeMatch[0].length);
        }

        // Extract due date
        const dueMatch = cleanText.match(DUE_DATE_PATTERN);
        if (dueMatch) {
            dueDate = dueMatch[1];
            cleanText = cleanText.replace(dueMatch[0], '').trim();
        }

        // Clean up trailing/leading whitespace and punctuation artifacts
        cleanText = cleanText.replace(/\s{2,}/g, ' ').trim();

        if (cleanText.length > 0) {
            items.push({ text: rawText, assignee, dueDate, cleanText });
        }
    }

    return items;
}
