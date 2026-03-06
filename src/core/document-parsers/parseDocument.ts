/**
 * parseDocument — single entry point for all document parsing.
 *
 * Routes by file extension to the appropriate parser.
 * Used by both AttachmentHandler (chat) and ReadDocumentTool (agent).
 */

import type { ParseResult } from './types';
import { parsePptx } from './parsers/PptxParser';
import { parseXlsx } from './parsers/XlsxParser';
import { parseDocx } from './parsers/DocxParser';
import { parsePdf } from './parsers/PdfParser';
import { parseCsv } from './parsers/CsvParser';

/**
 * Parse a document from binary data.
 *
 * @param data - Raw file content as ArrayBuffer
 * @param extension - File extension without dot (e.g. "pptx", "pdf")
 * @returns Structured text with metadata
 */
export async function parseDocument(data: ArrayBuffer, extension: string): Promise<ParseResult> {
    switch (extension.toLowerCase()) {
        case 'pptx': return parsePptx(data);
        case 'xlsx': return parseXlsx(data);
        case 'docx': return parseDocx(data);
        case 'pdf':  return parsePdf(data);
        case 'csv':  return parseCsv(data);
        case 'json': return parseJson(data);
        case 'xml':  return parseXml(data);
        default:
            throw new Error(`Unsupported document format: .${extension}`);
    }
}

// ---------------------------------------------------------------------------
// Inline parsers for trivial formats (no separate file needed)
// ---------------------------------------------------------------------------

function parseJson(data: ArrayBuffer): ParseResult {
    const text = new TextDecoder('utf-8').decode(data);
    try {
        const parsed: unknown = JSON.parse(text);
        const formatted = JSON.stringify(parsed, null, 2);

        // Summary line
        let summary = '';
        if (Array.isArray(parsed)) {
            summary = `JSON Array with ${parsed.length} element(s)`;
        } else if (typeof parsed === 'object' && parsed !== null) {
            const keys = Object.keys(parsed);
            summary = `JSON Object with ${keys.length} key(s): ${keys.slice(0, 10).join(', ')}${keys.length > 10 ? ', ...' : ''}`;
        } else {
            summary = `JSON ${typeof parsed}`;
        }

        return {
            text: `## ${summary}\n\n\`\`\`json\n${formatted}\n\`\`\``,
            images: [],
            metadata: { format: 'json' },
        };
    } catch {
        return {
            text: `## JSON (parse error)\n\n\`\`\`\n${text.slice(0, 5000)}\n\`\`\``,
            images: [],
            metadata: { format: 'json' },
        };
    }
}

function parseXml(data: ArrayBuffer): ParseResult {
    const text = new TextDecoder('utf-8').decode(data);

    // Extract root element name via regex (avoids DOMParser — CodeQL js/xss-through-dom)
    // Skip BOM, XML declaration, comments, and processing instructions before root element
    const stripped = text
        .replace(/^[\s\uFEFF]+/, '')
        .replace(/^<\?[^?]*\?>\s*/g, '')
        .replace(/^<!--[\s\S]*?-->\s*/g, '');
    const rootMatch = stripped.match(/<([a-zA-Z_][\w.:-]*)[>\s/]/);
    const rootTag = rootMatch ? rootMatch[1] : 'unknown';

    // Count element tags (rough heuristic for size indication)
    const afterRoot = stripped.slice(stripped.indexOf('>') + 1);
    const childMatches = afterRoot.match(/<[a-zA-Z_][\w.:-]*[\s>]/g);
    const childCount = childMatches ? childMatches.length : 0;

    return {
        text: `## XML Document (root: <${rootTag}>, ~${childCount} element(s))\n\n\`\`\`xml\n${text}\n\`\`\``,
        images: [],
        metadata: { format: 'xml' },
    };
}
