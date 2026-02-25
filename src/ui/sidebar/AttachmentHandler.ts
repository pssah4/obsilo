import { setIcon, TFile, Notice } from 'obsidian';
import type { ContentBlock, ImageMediaType } from '../../api/types';
import type { Vault } from 'obsidian';
import { t } from '../../i18n';

/** A file (image or text) attached to the current compose turn. */
export interface AttachmentItem {
    name: string;
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
        input.accept = 'image/png,image/jpeg,image/gif,image/webp,.txt,.md,.json,.py,.ts,.js,.jsx,.tsx,.css,.html,.xml,.yaml,.yml,.csv,.sh';
        input.addEventListener('change', () => {
            if (input.files) {
                for (const file of Array.from(input.files)) this.processFile(file);
            }
        });
        input.click();
    }

    async processFile(file: File): Promise<void> {
        const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
        if (file.size > MAX_BYTES) {
            new Notice(t('ui.attachment.tooLarge', { name: file.name }));
            return;
        }

        const IMAGE_TYPES: Record<string, ImageMediaType> = {
            'image/png': 'image/png',
            'image/jpeg': 'image/jpeg',
            'image/gif': 'image/gif',
            'image/webp': 'image/webp',
        };
        const TEXT_EXTENSIONS = ['.txt', '.md', '.json', '.py', '.ts', '.js', '.jsx', '.tsx', '.css', '.html', '.xml', '.yaml', '.yml', '.csv', '.sh'];

        const mediaType = IMAGE_TYPES[file.type];
        if (mediaType) {
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
        } else if (TEXT_EXTENSIONS.some(ext => file.name.toLowerCase().endsWith(ext)) || file.type.startsWith('text/')) {
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
            const content = await this.vault.read(file);
            this.pending.push({
                name: file.path,
                block: { type: 'text', text: `<attached_file name="${file.path}">\n${content}\n</attached_file>` },
            });
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
                setIcon(chip.createSpan('attachment-chip-icon'), 'file-text');
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
