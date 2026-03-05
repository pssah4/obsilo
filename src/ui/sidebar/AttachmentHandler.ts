import { setIcon, TFile, Notice } from 'obsidian';
import type { ContentBlock, ImageMediaType } from '../../api/types';
import type { Vault } from 'obsidian';
import { t } from '../../i18n';
import { parseDocument } from '../../core/document-parsers/parseDocument';
import {
    BINARY_DOCUMENT_EXTENSIONS,
    MAX_FILE_SIZE,
    LARGE_DOCUMENT_CHAR_THRESHOLD,
} from '../../core/document-parsers/types';

/** Extensions handled by the document parser (binary formats via OS file picker). */
const DOCUMENT_EXTENSIONS = ['.pptx', '.xlsx', '.docx', '.pdf', '.csv'];

/** Map file extension to Lucide icon name for chip display. */
const CHIP_ICON_MAP: Record<string, string> = {
    pptx: 'presentation',
    xlsx: 'table-2',
    docx: 'file-text',
    pdf: 'file-type',
    csv: 'table-2',
};

/** A file (image or text) attached to the current compose turn. */
export interface AttachmentItem {
    name: string;
    /** File extension (for icon selection in chips). */
    extension?: string;
    /** Object URL for thumbnail display (images only); revoked when removed before send. */
    objectUrl?: string;
    /** The ContentBlock that will be included in the API message. */
    block: ContentBlock;
}

/**
 * AttachmentHandler — manages the pending attachment list and chip bar UI.
 *
 * Extracted from AgentSidebarView to reduce file size.
 */
export class AttachmentHandler {
    readonly pending: AttachmentItem[] = [];

    constructor(
        private vault: Vault,
        private chipBar: HTMLElement,
    ) {}

    openFilePicker(): void {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        // No accept filter — Electron/macOS greyed out Office files with MIME-based filters.
        // Validation happens in processFile() which shows a Notice for unsupported formats.
        input.addEventListener('change', () => {
            if (input.files) {
                for (const file of Array.from(input.files)) void this.processFile(file);
            }
        });
        input.click();
    }

    async processFile(file: File): Promise<void> {
        if (file.size > MAX_FILE_SIZE) {
            new Notice(t('ui.attachment.tooLarge', { name: file.name }));
            return;
        }

        const IMAGE_TYPES: Record<string, ImageMediaType> = {
            'image/png': 'image/png',
            'image/jpeg': 'image/jpeg',
            'image/gif': 'image/gif',
            'image/webp': 'image/webp',
        };
        const TEXT_EXTENSIONS = ['.txt', '.md', '.json', '.py', '.ts', '.js', '.jsx', '.tsx', '.css', '.html', '.xml', '.yaml', '.yml', '.sh'];

        const mediaType = IMAGE_TYPES[file.type];
        const ext = file.name.split('.').pop()?.toLowerCase() ?? '';

        if (mediaType) {
            // Image attachment
            const arrayBuffer = await file.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
            const base64 = btoa(binary);
            const objectUrl = URL.createObjectURL(file);
            this.pending.push({
                name: file.name || 'image.png',
                objectUrl,
                block: { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            });
        } else if (DOCUMENT_EXTENSIONS.some(d => file.name.toLowerCase().endsWith(d))) {
            // Document attachment — parse via document parser
            try {
                const arrayBuffer = await file.arrayBuffer();
                const result = await parseDocument(arrayBuffer, ext);

                if (result.text.length > LARGE_DOCUMENT_CHAR_THRESHOLD) {
                    new Notice(t('ui.attachment.largeDocument', { name: file.name }));
                }

                this.pending.push({
                    name: file.name,
                    extension: ext,
                    block: {
                        type: 'text',
                        text: `<attached_document name="${file.name}" format="${ext}"${result.metadata.pageCount ? ` pages="${result.metadata.pageCount}"` : ''}>\n${result.text}\n</attached_document>`,
                    },
                });
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                new Notice(`Failed to parse ${file.name}: ${msg}`);
                return;
            }
        } else if (TEXT_EXTENSIONS.some(te => file.name.toLowerCase().endsWith(te)) || file.type.startsWith('text/')) {
            const text = await file.text();
            this.pending.push({
                name: file.name,
                block: { type: 'text', text: `<attached_file name="${file.name}">\n${text}\n</attached_file>` },
            });
        } else {
            new Notice(t('ui.attachment.unsupported', { name: file.name }));
            return;
        }
        this.renderChips();
    }

    async addVaultFile(file: TFile): Promise<void> {
        try {
            const ext = file.extension.toLowerCase();

            if (BINARY_DOCUMENT_EXTENSIONS.has(ext)) {
                // Binary document — parse via document parser
                const data = await this.vault.readBinary(file);
                const result = await parseDocument(data, ext);

                if (result.text.length > LARGE_DOCUMENT_CHAR_THRESHOLD) {
                    new Notice(t('ui.attachment.largeDocument', { name: file.path }));
                }

                this.pending.push({
                    name: file.path,
                    extension: ext,
                    block: {
                        type: 'text',
                        text: `<attached_document name="${file.path}" format="${ext}"${result.metadata.pageCount ? ` pages="${result.metadata.pageCount}"` : ''}>\n${result.text}\n</attached_document>`,
                    },
                });
            } else if (ext === 'csv') {
                // CSV — read as text, parse to Markdown table
                const content = await this.vault.read(file);
                const data = new TextEncoder().encode(content).buffer as ArrayBuffer;
                const result = await parseDocument(data, ext);

                this.pending.push({
                    name: file.path,
                    extension: ext,
                    block: {
                        type: 'text',
                        text: `<attached_document name="${file.path}" format="${ext}">\n${result.text}\n</attached_document>`,
                    },
                });
            } else {
                // Text file — read as text
                const content = await this.vault.read(file);
                this.pending.push({
                    name: file.path,
                    extension: ext,
                    block: { type: 'text', text: `<attached_file name="${file.path}">\n${content}\n</attached_file>` },
                });
            }
            this.renderChips();
        } catch {
            new Notice(t('ui.attachment.readFailed', { path: file.path }));
        }
    }

    renderChips(): void {
        this.chipBar.empty();
        this.pending.forEach((item, i) => {
            const chip = this.chipBar.createDiv('chat-attachment-chip');
            if (item.objectUrl) {
                const img = chip.createEl('img', { cls: 'attachment-chip-thumb' });
                img.src = item.objectUrl;
                img.alt = item.name;
            } else {
                const iconName = (item.extension && CHIP_ICON_MAP[item.extension]) || 'file-text';
                setIcon(chip.createSpan('attachment-chip-icon'), iconName);
                chip.createSpan('attachment-chip-name').setText(item.name);
            }
            const removeBtn = chip.createSpan('attachment-chip-remove');
            setIcon(removeBtn, 'x');
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
                this.pending.splice(i, 1);
                this.renderChips();
            });
        });
    }

    clear(): void {
        for (const att of this.pending) {
            if (att.objectUrl) URL.revokeObjectURL(att.objectUrl);
        }
        this.pending.length = 0;
        this.chipBar.empty();
    }
}
