/**
 * Line-level diff using the optimized `diff` npm package (Myers algorithm).
 * Returns an array of DiffLine objects describing which lines were added,
 * removed, or unchanged between oldText and newText.
 */

import { diffLines as jsDiffLines } from 'diff';

export interface DiffLine {
    type: 'added' | 'removed' | 'unchanged';
    content: string;
}

export interface DiffStats {
    added: number;
    removed: number;
}

export function diffLines(oldText: string, newText: string): DiffLine[] {
    const changes = jsDiffLines(oldText, newText);
    const result: DiffLine[] = [];
    for (const change of changes) {
        // diff package appends trailing \n — strip it to get clean line array
        const raw = change.value.endsWith('\n')
            ? change.value.slice(0, -1)
            : change.value;
        const lines = raw.split('\n');
        const type: DiffLine['type'] = change.added ? 'added' : change.removed ? 'removed' : 'unchanged';
        for (const content of lines) {
            result.push({ type, content });
        }
    }
    return result;
}

export function getDiffStats(lines: DiffLine[]): DiffStats {
    let added = 0;
    let removed = 0;
    for (const l of lines) {
        if (l.type === 'added') added++;
        else if (l.type === 'removed') removed++;
    }
    return { added, removed };
}
