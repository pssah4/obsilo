import { App, Modal } from 'obsidian';
import { t } from '../../i18n';

export class SystemPromptPreviewModal extends Modal {
    private modeName: string;
    private prompt: string;

    constructor(app: App, modeName: string, prompt: string) {
        super(app);
        this.modeName = modeName;
        this.prompt = prompt;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.addClass('system-prompt-preview-modal');
        contentEl.createEl('h2', { text: t('modal.promptPreview.title', { mode: this.modeName }) });

        const copyBtn = contentEl.createEl('button', { text: t('modal.promptPreview.copy'), cls: 'mod-cta' });
        copyBtn.classList.add('agent-u-mb-12');
        copyBtn.addEventListener('click', () => { void (async () => {
            await navigator.clipboard.writeText(this.prompt);
            copyBtn.setText(t('modal.promptPreview.copied'));
            setTimeout(() => copyBtn.setText(t('modal.promptPreview.copy')), 2000);
        })(); });

        const pre = contentEl.createEl('pre', { cls: 'system-prompt-preview-pre' });
        pre.setText(this.prompt);
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
