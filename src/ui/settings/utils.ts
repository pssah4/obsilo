import { App, Modal, Setting, setIcon } from 'obsidian';

/**
 * Append a small info icon button to a setting's name cell.
 * Clicking it opens a Modal with a title and explanatory body text.
 */
export function addInfoButton(setting: Setting, app: App, title: string, body: string): void {
    setting.nameEl.createEl('button', {
        cls: 'setting-info-btn',
        attr: { 'aria-label': 'More information', title },
    }, (btn) => {
        setIcon(btn, 'info');
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const modal = new Modal(app);
            modal.titleEl.setText(title);
            modal.contentEl.createEl('p', { text: body, cls: 'setting-info-body' });
            modal.open();
        });
    });
}
