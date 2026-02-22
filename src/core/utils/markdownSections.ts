/**
 * Markdown Section Parser — detects logical sections in Markdown content.
 *
 * Used by DiffReviewModal to group diff hunks into semantic sections
 * (frontmatter, headings, code blocks, lists, etc.) instead of
 * per-line approval.
 *
 * Strategy: heading-scoped sections with block-level fallback for
 * files without headings.
 */

export type SectionType =
    | 'frontmatter'
    | 'heading'
    | 'code-block'
    | 'list'
    | 'callout'
    | 'table'
    | 'paragraph';

export interface MarkdownSection {
    type: SectionType;
    label: string;
    /** 0-based inclusive start line */
    startLine: number;
    /** 0-based inclusive end line */
    endLine: number;
}

/**
 * Parse Markdown text into logical sections.
 *
 * 1. Frontmatter (YAML between --- markers at start)
 * 2. Heading-scoped sections (heading + all content until next same-or-higher level heading)
 * 3. Block-level fallback for content before first heading or files without headings
 */
export function parseMarkdownSections(text: string): MarkdownSection[] {
    const lines = text.split('\n');
    if (lines.length === 0) return [];

    const sections: MarkdownSection[] = [];
    let i = 0;

    // 1. Frontmatter detection
    if (lines[0]?.trim() === '---') {
        let fmEnd = -1;
        for (let j = 1; j < lines.length; j++) {
            if (lines[j].trim() === '---') {
                fmEnd = j;
                break;
            }
        }
        if (fmEnd > 0) {
            sections.push({
                type: 'frontmatter',
                label: 'Frontmatter',
                startLine: 0,
                endLine: fmEnd,
            });
            i = fmEnd + 1;
        }
    }

    // 2. Collect heading positions
    const headings: Array<{ line: number; level: number; text: string }> = [];
    for (let j = i; j < lines.length; j++) {
        const match = lines[j].match(/^(#{1,6})\s+(.*)/);
        if (match) {
            headings.push({ line: j, level: match[1].length, text: match[0] });
        }
    }

    if (headings.length === 0) {
        // No headings: use block-level grouping for all remaining content
        pushBlockSections(lines, i, lines.length - 1, sections);
        return sections;
    }

    // 3. Content before first heading → block-level sections
    if (i < headings[0].line) {
        pushBlockSections(lines, i, headings[0].line - 1, sections);
    }

    // 4. Heading-scoped sections
    for (let h = 0; h < headings.length; h++) {
        const start = headings[h].line;
        // Find next heading of same or higher level (lower number)
        let next = h + 1;
        while (next < headings.length && headings[next].level > headings[h].level) {
            next++;
        }
        const end = (next < headings.length ? headings[next].line : lines.length) - 1;
        sections.push({
            type: 'heading',
            label: headings[h].text,
            startLine: start,
            endLine: end,
        });
    }

    return sections;
}

// ---------------------------------------------------------------------------
// Block-level fallback grouping
// ---------------------------------------------------------------------------

function pushBlockSections(
    lines: string[],
    start: number,
    end: number,
    sections: MarkdownSection[],
): void {
    let i = start;

    while (i <= end) {
        const line = lines[i];

        // Skip blank lines
        if (line.trim() === '') {
            i++;
            continue;
        }

        // Code block: ``` ... ```
        if (line.trim().startsWith('```')) {
            const blockStart = i;
            i++;
            while (i <= end && !lines[i].trim().startsWith('```')) {
                i++;
            }
            if (i <= end) i++; // Skip closing ```
            sections.push({
                type: 'code-block',
                label: 'Code block',
                startLine: blockStart,
                endLine: i - 1,
            });
            continue;
        }

        // Callout: > [!type] or blockquote starting with >
        if (/^>\s*\[!/.test(line)) {
            const blockStart = i;
            i++;
            while (i <= end && lines[i].startsWith('>')) {
                i++;
            }
            sections.push({
                type: 'callout',
                label: 'Callout',
                startLine: blockStart,
                endLine: i - 1,
            });
            continue;
        }

        // Table: | ... |
        if (/^\|.*\|/.test(line)) {
            const blockStart = i;
            while (i <= end && /^\|.*\|/.test(lines[i])) {
                i++;
            }
            sections.push({
                type: 'table',
                label: 'Table',
                startLine: blockStart,
                endLine: i - 1,
            });
            continue;
        }

        // List: starts with - , * , + , or 1. (including nested/indented continuations)
        if (/^\s*[-*+]\s|^\s*\d+\.\s/.test(line)) {
            const blockStart = i;
            i++;
            while (i <= end && isListContinuation(lines[i])) {
                i++;
            }
            sections.push({
                type: 'list',
                label: 'List',
                startLine: blockStart,
                endLine: i - 1,
            });
            continue;
        }

        // Paragraph: contiguous non-blank lines that don't match other patterns
        {
            const blockStart = i;
            i++;
            while (i <= end && lines[i].trim() !== '' && !isBlockStart(lines[i])) {
                i++;
            }
            const preview = lines[blockStart].slice(0, 40).replace(/[#*_~`]/g, '').trim();
            sections.push({
                type: 'paragraph',
                label: preview.length < lines[blockStart].trim().length
                    ? `${preview}...`
                    : preview || 'Paragraph',
                startLine: blockStart,
                endLine: i - 1,
            });
        }
    }
}

/** Check if a line continues a list (list item or indented continuation) */
function isListContinuation(line: string): boolean {
    if (line.trim() === '') return false;
    // New list item
    if (/^\s*[-*+]\s|^\s*\d+\.\s/.test(line)) return true;
    // Indented continuation (at least 2 spaces)
    if (/^\s{2,}\S/.test(line)) return true;
    return false;
}

/** Check if a line starts a new block (code, callout, table, list) */
function isBlockStart(line: string): boolean {
    if (line.trim().startsWith('```')) return true;
    if (/^>\s*\[!/.test(line)) return true;
    if (/^\|.*\|/.test(line)) return true;
    if (/^\s*[-*+]\s|^\s*\d+\.\s/.test(line)) return true;
    if (/^#{1,6}\s+/.test(line)) return true;
    return false;
}
