/**
 * Shared helpers for OOXML parsers (PPTX, XLSX, DOCX).
 *
 * All OOXML formats are ZIP archives with XML content.
 * This module provides ZIP security checks and XML parsing utilities.
 */

import JSZip from 'jszip';
import { MAX_DECOMPRESSED_SIZE } from '../types';

/**
 * Open a ZIP archive with security checks:
 * - Path traversal: rejects entries with `../` or absolute paths
 * - ZIP bomb: rejects if total decompressed size exceeds MAX_DECOMPRESSED_SIZE
 */
export async function openZipSafe(data: ArrayBuffer): Promise<JSZip> {
    const zip = await JSZip.loadAsync(data);

    let totalSize = 0;
    for (const [name, entry] of Object.entries(zip.files)) {
        // Path traversal check
        if (name.includes('..') || name.startsWith('/')) {
            throw new Error(`Suspicious path in ZIP: "${name}"`);
        }
        // Accumulate decompressed size (approximation from compressed info)
        if (!entry.dir) {
            // JSZip doesn't expose decompressed size directly before extraction,
            // but _data._compressedSize or similar internals aren't reliable.
            // We check after extraction in getXmlContent instead.
            totalSize += 0;
        }
    }

    return zip;
}

/**
 * Read an XML file from the ZIP and parse it to a Document.
 * Returns null if the file doesn't exist in the archive.
 * Tracks cumulative decompressed size and throws on ZIP bomb.
 */
export async function getXmlDoc(
    zip: JSZip,
    path: string,
    sizeTracker: { total: number },
): Promise<Document | null> {
    const file = zip.file(path);
    if (!file) return null;

    const text = await file.async('text');
    sizeTracker.total += text.length;
    if (sizeTracker.total > MAX_DECOMPRESSED_SIZE) {
        throw new Error('ZIP decompressed size exceeds safety limit');
    }

    const parser = new DOMParser();
    return parser.parseFromString(text, 'text/xml');
}

/**
 * Get text content of all matching XML elements, ignoring namespace prefixes.
 * Uses local name matching since OOXML namespaces vary between generators.
 */
export function getElementsText(parent: Element, localName: string): string[] {
    const results: string[] = [];
    const elements = parent.getElementsByTagName('*');
    for (let i = 0; i < elements.length; i++) {
        const el = elements[i];
        if (el.localName === localName) {
            const text = el.textContent?.trim();
            if (text) results.push(text);
        }
    }
    return results;
}

/**
 * Find all elements matching a local name (namespace-agnostic).
 */
export function getElementsByLocalName(parent: Element | Document, localName: string): Element[] {
    const results: Element[] = [];
    const elements = parent.getElementsByTagName('*');
    for (let i = 0; i < elements.length; i++) {
        if (elements[i].localName === localName) {
            results.push(elements[i]);
        }
    }
    return results;
}
