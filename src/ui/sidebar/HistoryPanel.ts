/**
 * HistoryPanel
 *
 * Sliding overlay panel that displays conversation history grouped by date.
 * Placed inside the chat container as an absolute-positioned overlay.
 */

import { setIcon } from 'obsidian';
import type { ConversationMeta, ConversationStore } from '../../core/history/ConversationStore';
import { t } from '../../i18n';

// ---------------------------------------------------------------------------
// Date grouping helpers
// ---------------------------------------------------------------------------

type DateGroup = 'today' | 'yesterday' | 'thisWeek' | 'older';

const DATE_GROUP_KEYS: Record<DateGroup, string> = {
    today: 'ui.history.today',
    yesterday: 'ui.history.yesterday',
    thisWeek: 'ui.history.thisWeek',
    older: 'ui.history.older',
};

function getDateGroup(isoDate: string): DateGroup {
    const date = new Date(isoDate);
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart.getTime() - 86_400_000);
    const weekStart = new Date(todayStart.getTime() - todayStart.getDay() * 86_400_000);

    if (date >= todayStart) return 'today';
    if (date >= yesterdayStart) return 'yesterday';
    if (date >= weekStart) return 'thisWeek';
    return 'older';
}

function formatTime(isoDate: string): string {
    const d = new Date(isoDate);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function formatDate(isoDate: string): string {
    const d = new Date(isoDate);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ---------------------------------------------------------------------------
// HistoryPanel
// ---------------------------------------------------------------------------

export class HistoryPanel {
    private panelEl: HTMLElement | null = null;
    private isOpen = false;
    private filterText = '';

    constructor(
        private store: ConversationStore,
        private onLoad: (id: string) => void,
        private onDelete: (id: string) => void,
        private activeConversationId: string | null,
    ) {}

    /** Mount the panel inside a parent container. */
    mount(parent: HTMLElement): void {
        this.panelEl = parent.createDiv({ cls: 'history-panel' });
        this.panelEl.style.display = 'none';
    }

    /** Toggle open/close. */
    toggle(): void {
        if (this.isOpen) this.close();
        else this.open();
    }

    open(): void {
        if (!this.panelEl) return;
        this.isOpen = true;
        this.filterText = '';
        this.render();
        this.panelEl.style.display = '';
        requestAnimationFrame(() => this.panelEl?.addClass('history-panel-open'));
    }

    close(): void {
        if (!this.panelEl) return;
        this.isOpen = false;
        this.panelEl.removeClass('history-panel-open');
        setTimeout(() => {
            if (!this.isOpen && this.panelEl) this.panelEl.style.display = 'none';
        }, 200); // match CSS transition
    }

    /** Update active conversation id (for highlighting). */
    setActiveId(id: string | null): void {
        this.activeConversationId = id;
        if (this.isOpen) this.render();
    }

    /** Refresh if open (e.g., after a save). */
    refresh(): void {
        if (this.isOpen) this.render();
    }

    // -----------------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------------

    private render(): void {
        if (!this.panelEl) return;
        this.panelEl.empty();

        // Header
        const header = this.panelEl.createDiv({ cls: 'history-panel-header' });
        header.createSpan({ cls: 'history-panel-title', text: t('ui.history.title') });
        const closeBtn = header.createEl('button', { cls: 'history-panel-close clickable-icon' });
        setIcon(closeBtn, 'x');
        closeBtn.addEventListener('click', () => this.close());

        // Filter
        const filterRow = this.panelEl.createDiv({ cls: 'history-panel-filter' });
        const filterInput = filterRow.createEl('input', {
            type: 'text',
            placeholder: t('ui.history.filter'),
            cls: 'history-panel-filter-input',
        });
        filterInput.value = this.filterText;
        filterInput.addEventListener('input', () => {
            this.filterText = filterInput.value;
            this.renderList(listEl);
        });

        // List
        const listEl = this.panelEl.createDiv({ cls: 'history-panel-list' });
        this.renderList(listEl);
    }

    private renderList(container: HTMLElement): void {
        container.empty();

        let conversations = this.store.list();
        if (this.filterText) {
            const lower = this.filterText.toLowerCase();
            conversations = conversations.filter((c) => c.title.toLowerCase().includes(lower));
        }

        if (conversations.length === 0) {
            container.createDiv({ cls: 'history-panel-empty', text: t('ui.history.empty') });
            return;
        }

        // Group by date
        const groups = new Map<DateGroup, ConversationMeta[]>();
        const order: DateGroup[] = ['today', 'yesterday', 'thisWeek', 'older'];
        for (const c of conversations) {
            const group = getDateGroup(c.updated);
            if (!groups.has(group)) groups.set(group, []);
            groups.get(group)!.push(c);
        }

        for (const groupName of order) {
            const items = groups.get(groupName);
            if (!items || items.length === 0) continue;

            container.createDiv({ cls: 'history-group-label', text: t(DATE_GROUP_KEYS[groupName]) });

            for (const conv of items) {
                const row = container.createDiv({
                    cls: `history-row${conv.id === this.activeConversationId ? ' history-row-active' : ''}`,
                });

                const info = row.createDiv({ cls: 'history-row-info' });
                info.createDiv({ cls: 'history-row-title', text: conv.title });
                const meta = info.createDiv({ cls: 'history-row-meta' });
                const timeStr = groupName === 'today' || groupName === 'yesterday'
                    ? formatTime(conv.updated)
                    : formatDate(conv.updated);
                meta.createSpan({ text: timeStr });
                meta.createSpan({ text: ` \u00B7 ${t('ui.history.messageCount', { count: conv.messageCount })}` });

                // Delete button (visible on hover)
                const delBtn = row.createEl('button', { cls: 'history-row-delete clickable-icon' });
                setIcon(delBtn, 'trash-2');
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.onDelete(conv.id);
                    this.render();
                });

                row.addEventListener('click', () => {
                    this.onLoad(conv.id);
                    this.close();
                });
            }
        }
    }
}
