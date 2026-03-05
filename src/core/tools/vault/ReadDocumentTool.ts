/**
 * ReadDocumentTool — parse an Office/data document from the vault.
 *
 * Supports: PPTX, XLSX, DOCX, PDF, JSON, XML, CSV.
 * Returns structured text extracted from the document.
 * Read-only: no approval needed.
 */

import { TFile } from 'obsidian';
import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';
import { parseDocument } from '../../document-parsers/parseDocument';
import { SUPPORTED_DOCUMENT_EXTENSIONS, BINARY_DOCUMENT_EXTENSIONS, MAX_FILE_SIZE } from '../../document-parsers/types';

interface ReadDocumentInput {
    path: string;
}

export class ReadDocumentTool extends BaseTool<'read_document'> {
    readonly name = 'read_document' as const;
    readonly isWriteOperation = false;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'read_document',
            description:
                'Parse and extract text from an Office or data document in the vault. ' +
                'Supports PPTX, XLSX, DOCX, PDF, JSON, XML, CSV. ' +
                'Returns structured text (Markdown-formatted). ' +
                'Use this instead of read_file for binary document formats.',
            input_schema: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description:
                            'Path to the document relative to vault root (e.g., "Reports/Q3-results.pptx")',
                    },
                },
                required: ['path'],
            },
        };
    }

    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { path } = input as unknown as ReadDocumentInput;
        const { callbacks } = context;

        try {
            if (!path) {
                throw new Error('Path parameter is required');
            }

            // Determine extension
            const ext = path.split('.').pop()?.toLowerCase() ?? '';
            if (!SUPPORTED_DOCUMENT_EXTENSIONS.has(ext)) {
                throw new Error(
                    `Unsupported format: .${ext}. Supported: ${[...SUPPORTED_DOCUMENT_EXTENSIONS].join(', ')}. ` +
                    'For plain text files (.md, .txt, .ts, etc.), use read_file instead.'
                );
            }

            // Resolve file
            const file = this.app.vault.getAbstractFileByPath(path);
            if (!file || !(file instanceof TFile)) {
                throw new Error(`File not found: ${path}`);
            }

            // Size check
            if (file.stat.size > MAX_FILE_SIZE) {
                throw new Error(
                    `File too large: ${(file.stat.size / 1024 / 1024).toFixed(1)} MB ` +
                    `(limit: ${MAX_FILE_SIZE / 1024 / 1024} MB)`
                );
            }

            // Read file data
            let data: ArrayBuffer;
            if (BINARY_DOCUMENT_EXTENSIONS.has(ext)) {
                data = await this.app.vault.readBinary(file);
            } else {
                // Text formats (csv, json, xml) — read as text, convert to ArrayBuffer
                const text = await this.app.vault.read(file);
                data = new TextEncoder().encode(text).buffer as ArrayBuffer;
            }

            // Parse
            const result = await parseDocument(data, ext);

            // Format output
            const meta: Record<string, string> = {
                path: file.path,
                format: ext,
            };
            if (result.metadata.pageCount !== undefined) {
                meta['pages'] = String(result.metadata.pageCount);
            }
            if (result.metadata.sheetNames?.length) {
                meta['sheets'] = result.metadata.sheetNames.join(', ');
            }
            if (result.images.length > 0) {
                meta['images'] = String(result.images.length);
            }

            callbacks.pushToolResult(this.formatContent(result.text, meta));
            callbacks.log(`Parsed document: ${path} (${ext}, ${result.text.length} chars)`);
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('read_document', error);
        }
    }
}
