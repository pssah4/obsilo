import { App, Modal } from 'obsidian';
import { t } from '../../i18n';

export class ContentEditorModal extends Modal {
    private readonly initialContent: string;
    private readonly onSave: (content: string) => void | Promise<void>;
    private readonly modalTitle: string;

    constructor(app: App, title: string, initialContent: string, onSave: (content: string) => void | Promise<void>) {
        super(app);
        this.modalTitle = title;
        this.initialContent = initialContent;
        this.onSave = onSave;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.addClass('content-editor-modal');
        contentEl.createEl('h3', { cls: 'content-editor-title', text: this.modalTitle });

        const textarea = contentEl.createEl('textarea', { cls: 'content-editor-textarea' });
        textarea.value = this.initialContent;
        textarea.setAttribute('rows', '20');
        textarea.setAttribute('spellcheck', 'false');

        const btnRow = contentEl.createDiv({ cls: 'content-editor-btn-row' });
        const saveBtn = btnRow.createEl('button', { text: t('modal.modelConfig.save'), cls: 'mod-cta' });
        const cancelBtn = btnRow.createEl('button', { text: t('modal.modelConfig.cancel') });

        saveBtn.addEventListener('click', () => {
            const result = this.onSave(textarea.value);
            if (result instanceof Promise) void result.catch(console.error);
            this.close();
        });
        cancelBtn.addEventListener('click', () => this.close());

        setTimeout(() => {
            textarea.focus();
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        }, 50);
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
