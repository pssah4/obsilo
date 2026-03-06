/**
 * TaskSelectionModal — Checkbox modal for selecting which tasks to create as notes.
 *
 * ADR-026: Presented after agent completion when tasks are detected.
 * Review-Bot compliant: createEl/createDiv, CSS classes, no innerHTML.
 */

import { App, Modal } from 'obsidian';
import type { TaskItem } from '../core/tasks/types';

export class TaskSelectionModal extends Modal {
    private readonly items: TaskItem[];
    private readonly onConfirm: (selected: TaskItem[]) => void | Promise<void>;
    private selected: Set<number>;

    constructor(
        app: App,
        items: TaskItem[],
        onConfirm: (selected: TaskItem[]) => void | Promise<void>,
    ) {
        super(app);
        this.items = items;
        this.onConfirm = onConfirm;
        this.selected = new Set(items.map((_, i) => i)); // all selected by default
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.addClass('task-selection-modal');

        // Title
        contentEl.createEl('h3', {
            text: `${this.items.length} Aufgabe${this.items.length === 1 ? '' : 'n'} erkannt`,
            cls: 'task-selection-title',
        });

        contentEl.createEl('p', {
            text: 'Welche Aufgaben sollen als Task-Notes erstellt werden?',
            cls: 'task-selection-subtitle',
        });

        // Toggle all
        const toggleRow = contentEl.createDiv({ cls: 'task-selection-toggle' });
        const toggleLink = toggleRow.createEl('a', { text: 'Keine auswählen' });
        toggleLink.addEventListener('click', (e) => {
            e.preventDefault();
            const allSelected = this.selected.size === this.items.length;
            const checkboxes = contentEl.querySelectorAll<HTMLInputElement>('.task-selection-checkbox');
            if (allSelected) {
                this.selected.clear();
                checkboxes.forEach((cb) => { cb.checked = false; });
                toggleLink.textContent = 'Alle auswählen';
            } else {
                this.items.forEach((_, i) => this.selected.add(i));
                checkboxes.forEach((cb) => { cb.checked = true; });
                toggleLink.textContent = 'Keine auswählen';
            }
            this.updateCreateButton(createBtn);
        });

        // Task list
        const listEl = contentEl.createDiv({ cls: 'task-selection-list' });
        for (let i = 0; i < this.items.length; i++) {
            this.renderTaskItem(listEl, this.items[i], i, toggleLink);
        }

        // Action buttons
        const btnRow = contentEl.createDiv({ cls: 'task-selection-actions' });
        const createBtn = btnRow.createEl('button', {
            text: `${this.selected.size} erstellen`,
            cls: 'mod-cta',
        });
        const cancelBtn = btnRow.createEl('button', { text: 'Abbrechen' });

        createBtn.addEventListener('click', () => {
            const selectedItems = this.items.filter((_, i) => this.selected.has(i));
            if (selectedItems.length > 0) {
                const result = this.onConfirm(selectedItems);
                if (result instanceof Promise) void result.catch(console.error);
            }
            this.close();
        });

        cancelBtn.addEventListener('click', () => this.close());
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private renderTaskItem(
        container: HTMLElement,
        item: TaskItem,
        index: number,
        toggleLink: HTMLElement,
    ): void {
        const row = container.createDiv({ cls: 'task-selection-item' });

        const label = row.createEl('label', { cls: 'task-selection-label' });

        const checkbox = label.createEl('input', { cls: 'task-selection-checkbox' });
        checkbox.type = 'checkbox';
        checkbox.checked = this.selected.has(index);
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
                this.selected.add(index);
            } else {
                this.selected.delete(index);
            }
            // Update toggle link text
            if (this.selected.size === this.items.length) {
                toggleLink.textContent = 'Keine auswählen';
            } else {
                toggleLink.textContent = 'Alle auswählen';
            }
            // Update create button
            const createBtn = this.contentEl.querySelector<HTMLButtonElement>('.mod-cta');
            if (createBtn) this.updateCreateButton(createBtn);
        });

        const textSpan = label.createSpan({ cls: 'task-selection-text' });
        textSpan.appendText(item.cleanText);

        // Meta info (assignee, due date)
        if (item.assignee || item.dueDate) {
            const metaSpan = row.createSpan({ cls: 'task-selection-meta' });
            const parts: string[] = [];
            if (item.assignee) parts.push(item.assignee);
            if (item.dueDate) parts.push(`Fällig: ${item.dueDate}`);
            metaSpan.appendText(parts.join(' | '));
        }
    }

    private updateCreateButton(btn: HTMLButtonElement): void {
        const count = this.selected.size;
        btn.textContent = `${count} erstellen`;
        btn.disabled = count === 0;
    }
}
