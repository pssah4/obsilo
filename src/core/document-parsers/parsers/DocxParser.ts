/**
 * DOCX Parser — extracts text with heading hierarchy from Word documents.
 *
 * DOCX is a ZIP archive containing:
 *   word/document.xml   (main content: paragraphs, headings, tables, lists)
 *   word/media/...      (embedded images)
 */

import type { ParseResult, ImageMetadata } from '../types';
import { openZipSafe, getXmlDoc, getElementsByLocalName } from './ooxmlHelpers';

/** Map OOXML heading styles to Markdown heading levels. */
function headingLevel(styleName: string): number | null {
    // Standard OOXML heading styles: Heading1, Heading2, ..., heading 1, heading 2, ...
    const match = styleName.match(/[Hh]eading\s*(\d)/);
    if (match) return parseInt(match[1], 10);
    // Title style -> H1
    if (/^[Tt]itle$/.test(styleName)) return 1;
    // Subtitle -> H2
    if (/^[Ss]ubtitle$/.test(styleName)) return 2;
    return null;
}

export async function parseDocx(data: ArrayBuffer): Promise<ParseResult> {
    const zip = await openZipSafe(data);
    const sizeTracker = { total: 0 };

    const doc = await getXmlDoc(zip, 'word/document.xml', sizeTracker);
    if (!doc) {
        return { text: '(Could not read document.xml)', images: [], metadata: { format: 'docx' } };
    }

    const parts: string[] = [];
    const body = getElementsByLocalName(doc.documentElement, 'body')[0];
    if (!body) {
        return { text: '(Empty document)', images: [], metadata: { format: 'docx' } };
    }

    // Process top-level children of <w:body>
    for (let i = 0; i < body.children.length; i++) {
        const child = body.children[i];

        if (child.localName === 'p') {
            // Paragraph
            const result = processParagraph(child);
            if (result) parts.push(result);
        } else if (child.localName === 'tbl') {
            // Table
            const result = processTable(child);
            if (result) parts.push(result);
        }
    }

    // Image metadata from word/media/
    const images: ImageMetadata[] = [];
    const mediaFiles = Object.keys(zip.files)
        .filter(name => /^word\/media\//.test(name) && !zip.files[name].dir);
    for (let idx = 0; idx < mediaFiles.length; idx++) {
        const filename = mediaFiles[idx].split('/').pop() ?? mediaFiles[idx];
        images.push({
            id: `img${idx + 1}`,
            filename,
            location: 'Document',
        });
    }

    if (images.length > 0) {
        parts.push(`\n---\n*${images.length} embedded image(s) detected. Use extract_document_images to view them.*`);
    }

    const text = parts.length > 0
        ? parts.join('\n\n')
        : '(Empty document)';

    return {
        text,
        images,
        metadata: {
            format: 'docx',
        },
    };
}

function processParagraph(p: Element): string | null {
    // Check paragraph style for heading
    const pPr = getElementsByLocalName(p, 'pPr')[0];
    let level: number | null = null;
    let isListItem = false;
    let numLevel = 0;

    if (pPr) {
        const pStyle = getElementsByLocalName(pPr, 'pStyle')[0];
        if (pStyle) {
            const val = pStyle.getAttribute('w:val') ?? pStyle.getAttribute('val') ?? '';
            level = headingLevel(val);
            // List detection: ListParagraph or similar
            if (/list/i.test(val)) isListItem = true;
        }
        // Numbered/bulleted list via numPr
        const numPr = getElementsByLocalName(pPr, 'numPr')[0];
        if (numPr) {
            isListItem = true;
            const ilvl = getElementsByLocalName(numPr, 'ilvl')[0];
            numLevel = parseInt(ilvl?.getAttribute('w:val') ?? ilvl?.getAttribute('val') ?? '0', 10);
        }
    }

    // Collect all text runs (w:t elements)
    const textContent = getElementsByLocalName(p, 't')
        .map(t => t.textContent ?? '')
        .join('');

    if (!textContent.trim()) return null;

    if (level !== null && level >= 1 && level <= 6) {
        return '#'.repeat(level) + ' ' + textContent.trim();
    }

    if (isListItem) {
        const indent = '  '.repeat(numLevel);
        return `${indent}- ${textContent.trim()}`;
    }

    return textContent.trim();
}

function processTable(tbl: Element): string | null {
    const rows = getElementsByLocalName(tbl, 'tr');
    if (rows.length === 0) return null;

    const tableData: string[][] = [];
    for (const tr of rows) {
        const cells = getElementsByLocalName(tr, 'tc');
        const rowData: string[] = [];
        for (const tc of cells) {
            const cellText = getElementsByLocalName(tc, 't')
                .map(t => t.textContent ?? '')
                .join(' ')
                .replace(/\\/g, '\\\\')
                .replace(/\|/g, '\\|')
                .replace(/\n/g, ' ')
                .trim();
            rowData.push(cellText);
        }
        tableData.push(rowData);
    }

    if (tableData.length === 0) return null;

    // First row as header
    const maxCols = Math.max(...tableData.map(r => r.length));
    const lines: string[] = [];

    const header = tableData[0];
    const paddedHeader = Array.from({ length: maxCols }, (_, i) => header[i] ?? '');
    lines.push('| ' + paddedHeader.join(' | ') + ' |');
    lines.push('| ' + paddedHeader.map(() => '---').join(' | ') + ' |');

    for (let r = 1; r < tableData.length; r++) {
        const padded = Array.from({ length: maxCols }, (_, i) => tableData[r][i] ?? '');
        lines.push('| ' + padded.join(' | ') + ' |');
    }

    return lines.join('\n');
}
