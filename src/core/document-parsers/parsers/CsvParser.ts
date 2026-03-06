/**
 * CSV Parser — RFC 4180 compliant with auto-delimiter detection.
 *
 * Output: Markdown table with header row.
 */

import type { ParseResult } from '../types';

/** Detect the most likely delimiter by counting occurrences in the first few lines. */
function detectDelimiter(text: string): string {
    const sample = text.slice(0, 4096);
    const candidates = [',', '\t', ';', '|'];
    let best = ',';
    let bestCount = 0;
    for (const d of candidates) {
        const count = sample.split(d).length - 1;
        if (count > bestCount) {
            bestCount = count;
            best = d;
        }
    }
    return best;
}

/**
 * Parse CSV text into a 2D string array (RFC 4180: quoted fields, escaped quotes).
 */
function parseRows(text: string, delimiter: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;
    let i = 0;

    while (i < text.length) {
        const ch = text[i];

        if (inQuotes) {
            if (ch === '"') {
                if (i + 1 < text.length && text[i + 1] === '"') {
                    field += '"';
                    i += 2;
                } else {
                    inQuotes = false;
                    i++;
                }
            } else {
                field += ch;
                i++;
            }
        } else if (ch === '"') {
            inQuotes = true;
            i++;
        } else if (ch === delimiter) {
            row.push(field.trim());
            field = '';
            i++;
        } else if (ch === '\r') {
            // Handle \r\n or standalone \r
            row.push(field.trim());
            field = '';
            if (row.length > 0) rows.push(row);
            row = [];
            i++;
            if (i < text.length && text[i] === '\n') i++;
        } else if (ch === '\n') {
            row.push(field.trim());
            field = '';
            if (row.length > 0) rows.push(row);
            row = [];
            i++;
        } else {
            field += ch;
            i++;
        }
    }

    // Last field/row
    if (field || row.length > 0) {
        row.push(field.trim());
        if (row.length > 0) rows.push(row);
    }

    return rows;
}

/** Escape pipe characters for Markdown table cells. */
function escapeCell(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/** Convert rows to a Markdown table. First row is treated as header. */
function toMarkdownTable(rows: string[][]): string {
    if (rows.length === 0) return '(empty CSV)';

    const header = rows[0];
    const dataRows = rows.slice(1);

    const lines: string[] = [];
    lines.push('| ' + header.map(escapeCell).join(' | ') + ' |');
    lines.push('| ' + header.map(() => '---').join(' | ') + ' |');
    for (const row of dataRows) {
        // Pad row to header length
        const padded = header.map((_, idx) => escapeCell(row[idx] ?? ''));
        lines.push('| ' + padded.join(' | ') + ' |');
    }
    return lines.join('\n');
}

export function parseCsv(data: ArrayBuffer): ParseResult {
    const decoder = new TextDecoder('utf-8');
    const text = decoder.decode(data);

    if (text.trim().length === 0) {
        return { text: '(empty CSV file)', images: [], metadata: { format: 'csv' } };
    }

    const delimiter = detectDelimiter(text);
    const rows = parseRows(text, delimiter);
    const markdown = toMarkdownTable(rows);

    const rowCount = Math.max(0, rows.length - 1); // exclude header

    return {
        text: `## CSV Data (${rowCount} rows)\n\n${markdown}`,
        images: [],
        metadata: {
            format: 'csv',
            pageCount: 1,
        },
    };
}
