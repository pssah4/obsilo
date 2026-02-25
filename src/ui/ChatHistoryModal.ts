/**
 * ChatHistoryModal
 *
 * Lists saved conversations. Clicking one loads it into the chat panel.
 */

import { App, Modal, setIcon } from 'obsidian';
import type { ChatHistoryService, HistoryMessage, SavedConversation } from '../core/ChatHistoryService';
import { t } from '../i18n';

export class ChatHistoryModal extends Modal {
    private conversations: SavedConversation[] = [];

    constructor(
        app: App,
        private service: ChatHistoryService,
        private onLoad: (messages: HistoryMessage[]) => void,
    ) {
        super(app);
    }

    async onOpen(): Promise<void> {
        this.titleEl.setText(t('modal.chatHistory.title'));
        this.contentEl.empty();
        this.contentEl.addClass('chat-history-modal');

        this.conversations = await this.service.list();

        if (this.conversations.length === 0) {
            this.contentEl.createEl('p', {
                cls: 'chat-history-empty',
                text: t('modal.chatHistory.empty'),
            });
            return;
        }

        const list = this.contentEl.createDiv('chat-history-list');

        for (const conv of this.conversations) {
            this.renderRow(list, conv);
        }
    }

    private renderRow(container: HTMLElement, conv: SavedConversation): void {
        const row = container.createDiv('chat-history-row');

        const info = row.createDiv('chat-history-info');
        info.createDiv('chat-history-title').setText(conv.title || t('modal.chatHistory.untitled'));
        info.createDiv('chat-history-date').setText(new Date(conv.savedAt).toLocaleString([], {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
        }));

        const actions = row.createDiv('chat-history-actions');

        const loadBtn = actions.createEl('button', { cls: 'mod-cta chat-history-load-btn', text: t('modal.chatHistory.open') });
        loadBtn.addEventListener('click', () => {
            this.onLoad(conv.messages);
            this.close();
        });

        const deleteBtn = actions.createEl('button', { cls: 'chat-history-delete-btn' });
        setIcon(deleteBtn, 'trash-2');
        deleteBtn.setAttribute('aria-label', t('modal.chatHistory.delete'));
        deleteBtn.addEventListener('click', async () => {
            await this.service.delete(conv.id);
            row.remove();
            const remaining = this.contentEl.querySelectorAll('.chat-history-row');
            if (remaining.length === 0) {
                this.contentEl.querySelector('.chat-history-list')?.remove();
                this.contentEl.createEl('p', {
                    cls: 'chat-history-empty',
                    text: t('modal.chatHistory.emptyAfterDelete'),
                });
            }
        });
    }
}
