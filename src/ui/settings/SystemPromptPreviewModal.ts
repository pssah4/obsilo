import { App, Modal } from 'obsidian';

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
        contentEl.createEl('h2', { text: `System Prompt — ${this.modeName}` });

        const copyBtn = contentEl.createEl('button', { text: 'Copy to clipboard', cls: 'mod-cta' });
        copyBtn.style.marginBottom = '12px';
        copyBtn.addEventListener('click', async () => {
            await navigator.clipboard.writeText(this.prompt);
            copyBtn.setText('Copied!');
            setTimeout(() => copyBtn.setText('Copy to clipboard'), 2000);
        });

        const pre = contentEl.createEl('pre', { cls: 'system-prompt-preview-pre' });
        pre.setText(this.prompt);
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
