/**
 * XLSX Parser — extracts tabular data from Excel workbooks as Markdown tables.
 *
 * XLSX is a ZIP archive containing:
 *   xl/worksheets/sheet1.xml, ...   (cell data)
 *   xl/sharedStrings.xml            (shared string pool)
 *   xl/workbook.xml                 (sheet names)
 */

import type { ParseResult } from '../types';
import { openZipSafe, getXmlDoc, getElementsByLocalName } from './ooxmlHelpers';

/** Parse column letter(s) to zero-based index: A=0, B=1, ..., Z=25, AA=26 */
function colLetterToIndex(letters: string): number {
    let idx = 0;
    for (let i = 0; i < letters.length; i++) {
        idx = idx * 26 + (letters.charCodeAt(i) - 64);
    }
    return idx - 1;
}

/** Extract column letters from a cell reference like "B5" -> "B" */
function colFromRef(ref: string): string {
    return ref.replace(/\d+/g, '');
}

/** Extract row number from a cell reference like "B5" -> 5 */
function rowFromRef(ref: string): number {
    return parseInt(ref.replace(/[A-Z]+/gi, ''), 10);
}

export async function parseXlsx(data: ArrayBuffer): Promise<ParseResult> {
    const zip = await openZipSafe(data);
    const sizeTracker = { total: 0 };

    // Load shared strings (string pool referenced by index in cells)
    const sharedStrings: string[] = [];
    const ssDoc = await getXmlDoc(zip, 'xl/sharedStrings.xml', sizeTracker);
    if (ssDoc) {
        const siElements = getElementsByLocalName(ssDoc.documentElement, 'si');
        for (const si of siElements) {
            // Concatenate all <t> text within each <si>
            const tElements = getElementsByLocalName(si, 't');
            const text = tElements.map(t => t.textContent ?? '').join('');
            sharedStrings.push(text);
        }
    }

    // Get sheet names from workbook.xml
    const sheetNames: string[] = [];
    const wbDoc = await getXmlDoc(zip, 'xl/workbook.xml', sizeTracker);
    if (wbDoc) {
        const sheets = getElementsByLocalName(wbDoc.documentElement, 'sheet');
        for (const sheet of sheets) {
            sheetNames.push(sheet.getAttribute('name') ?? `Sheet${sheetNames.length + 1}`);
        }
    }

    // Find sheet files
    const sheetFiles = Object.keys(zip.files)
        .filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
        .sort((a, b) => {
            const numA = parseInt(a.match(/sheet(\d+)/)?.[1] ?? '0', 10);
            const numB = parseInt(b.match(/sheet(\d+)/)?.[1] ?? '0', 10);
            return numA - numB;
        });

    const parts: string[] = [];

    for (let i = 0; i < sheetFiles.length; i++) {
        const sheetName = sheetNames[i] ?? `Sheet${i + 1}`;
        const doc = await getXmlDoc(zip, sheetFiles[i], sizeTracker);
        if (!doc) continue;

        // Parse cells into a sparse grid
        const rows = getElementsByLocalName(doc.documentElement, 'row');
        const grid: Map<number, Map<number, string>> = new Map();
        let maxCol = 0;
        let maxRow = 0;
        let minRow = Infinity;

        for (const row of rows) {
            const cells = getElementsByLocalName(row, 'c');
            for (const cell of cells) {
                const ref = cell.getAttribute('r');
                if (!ref) continue;

                const colIdx = colLetterToIndex(colFromRef(ref));
                const rowIdx = rowFromRef(ref);
                maxCol = Math.max(maxCol, colIdx);
                maxRow = Math.max(maxRow, rowIdx);
                minRow = Math.min(minRow, rowIdx);

                // Get cell value
                const type = cell.getAttribute('t');
                const vElements = getElementsByLocalName(cell, 'v');
                const rawValue = vElements[0]?.textContent ?? '';

                let value: string;
                if (type === 's') {
                    // Shared string reference
                    const idx = parseInt(rawValue, 10);
                    value = sharedStrings[idx] ?? '';
                } else if (type === 'inlineStr') {
                    const tElements = getElementsByLocalName(cell, 't');
                    value = tElements.map(t => t.textContent ?? '').join('');
                } else {
                    value = rawValue;
                }

                if (!grid.has(rowIdx)) grid.set(rowIdx, new Map());
                grid.get(rowIdx)!.set(colIdx, value);
            }
        }

        if (grid.size === 0) {
            parts.push(`## ${sheetName}\n\n(empty sheet)`);
            continue;
        }

        // Cap rows for very large sheets
        const MAX_DISPLAY_ROWS = 200;
        const totalRows = maxRow - minRow + 1;

        // Build markdown table
        const colCount = maxCol + 1;
        const tableRows: string[][] = [];

        let rowCount = 0;
        for (let r = minRow; r <= maxRow && rowCount < MAX_DISPLAY_ROWS; r++) {
            const rowData = grid.get(r);
            if (!rowData) continue; // skip fully empty rows
            const cells: string[] = [];
            for (let c = 0; c <= maxCol; c++) {
                cells.push((rowData.get(c) ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' '));
            }
            // Skip rows where all cells are empty
            if (cells.every(c => c === '')) continue;
            tableRows.push(cells);
            rowCount++;
        }

        if (tableRows.length === 0) {
            parts.push(`## ${sheetName}\n\n(empty sheet)`);
            continue;
        }

        // First row as header
        const header = tableRows[0];
        const dataRows = tableRows.slice(1);

        const lines: string[] = [];
        lines.push('| ' + header.join(' | ') + ' |');
        lines.push('| ' + header.map(() => '---').join(' | ') + ' |');
        for (const row of dataRows) {
            // Pad to header length
            const padded = header.map((_, idx) => row[idx] ?? '');
            lines.push('| ' + padded.join(' | ') + ' |');
        }

        let sheetSection = `## ${sheetName}\n\n` + lines.join('\n');
        if (totalRows > MAX_DISPLAY_ROWS) {
            sheetSection += `\n\n*(Showing ${MAX_DISPLAY_ROWS} of ${totalRows} rows)*`;
        }

        parts.push(sheetSection);
    }

    const text = parts.length > 0
        ? parts.join('\n\n')
        : '(Empty workbook)';

    return {
        text,
        images: [],
        metadata: {
            format: 'xlsx',
            pageCount: sheetFiles.length,
            sheetNames,
        },
    };
}
