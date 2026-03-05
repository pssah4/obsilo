/**
 * PDF Parser — extracts text from PDF files using pdfjs-dist.
 *
 * Runs in fake-worker mode (no Web Worker) for Obsidian/Electron compatibility.
 * Returns empty text for encrypted, image-only, or unreadable PDFs.
 *
 * Refactored from SemanticIndexService.extractPdfText().
 */

import type { ParseResult } from '../types';

/**
 * Parse a PDF from an ArrayBuffer and extract text per page.
 *
 * Uses dynamic import of pdfjs-dist to avoid bundling the worker at startup.
 * Disables web worker (fake-worker mode) and auto-fetch for sandbox compatibility.
 */
export async function parsePdf(data: ArrayBuffer): Promise<ParseResult> {
    // Dynamic import — typed inline since pdfjs-dist has no clean default export.
    const pdfjsLib = await import('pdfjs-dist') as Record<string, unknown> & {
        GlobalWorkerOptions?: { workerSrc: string };
        getDocument(params: { data: Uint8Array; useWorkerFetch: boolean }): {
            promise: Promise<{
                numPages: number;
                getPage(num: number): Promise<{
                    getTextContent(): Promise<{ items: Array<{ str?: string }> }>;
                }>;
            }>;
        };
    };

    // Disable the web worker — pdfjs falls back to in-process (fake-worker) mode.
    // In Electron renderer, isNodeJS is false so pdfjs tries to spawn a real Worker.
    // Setting workerSrc to empty string AND importing the worker module directly
    // triggers the fake-worker fallback (mainThreadWorkerMessageHandler).
    if (pdfjsLib.GlobalWorkerOptions) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = '';
    }
    // Force fake-worker: import worker module so pdfjs detects it on main thread.
    await import('pdfjs-dist/build/pdf.worker.mjs');

    const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(data),
        useWorkerFetch: false,
    });
    const pdf = await loadingTask.promise;

    const parts: string[] = [];
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const content = await page.getTextContent();
        const pageText = content.items
            .map((item: { str?: string }) => (item.str ?? ''))
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (pageText) {
            parts.push(`## Page ${pageNum}\n\n${pageText}`);
        }
    }

    const text = parts.length > 0
        ? parts.join('\n\n')
        : '(No extractable text found — this PDF may be image-based/scanned.)';

    return {
        text,
        images: [],
        metadata: {
            format: 'pdf',
            pageCount: pdf.numPages,
        },
    };
}
