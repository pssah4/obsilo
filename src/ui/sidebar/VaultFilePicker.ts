import type { App } from 'obsidian';
import { setIcon, TFile } from 'obsidian';
import { t } from '../../i18n';

/**
 * VaultFilePicker — floating search/multi-select popover for vault files.
 *
 * Opens anchored to a toolbar button. Supports:
 *  - Live search (name + path)
 *  - Multi-select via checkbox or row click
 *  - Keyboard: ArrowUp/Down = navigate, Space = toggle, Enter = confirm, Esc = close
 *  - Enter with no selection = confirm currently focused row
 */
export class VaultFilePicker {
    private containerEl: HTMLElement | null = null;
    private searchInput: HTMLInputElement | null = null;
    private listEl: HTMLElement | null = null;
    private countEl: HTMLSpanElement | null = null;

    private selected = new Set<string>(); // file paths
    private filtered: Array<{ file: TFile; label: string }> = [];
    private activeIdx = 0;
    private resizeHandler: (() => void) | null = null;

    constructor(
        private app: App,
        private onConfirm: (files: TFile[]) => Promise<void>,
    ) {}

    show(anchor: HTMLElement, parentContainerEl?: HTMLElement): void {
        this.hide();
        this.selected.clear();
        this.activeIdx = 0;

        // ── Container ────────────────────────────────────────────────
        this.containerEl = document.body.createDiv('vault-file-picker');

        const positionPopover = () => {
            if (!this.containerEl) return;
            const br = anchor.getBoundingClientRect();
            const cr = parentContainerEl
                ? parentContainerEl.getBoundingClientRect()
                : { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth, width: window.innerWidth };
            const pad = 8;

            this.containerEl.style.setProperty('position', 'fixed');

            // Constrain width to container
            const popWidth = Math.min(320, cr.width - pad * 2);
            this.containerEl.style.setProperty('width', `${popWidth}px`);

            // Prefer opening upward; fall back to downward
            const spaceAbove = br.top - cr.top - pad;
            const spaceBelow = cr.bottom - br.bottom - pad;

            if (spaceAbove >= spaceBelow) {
                this.containerEl.style.setProperty('bottom', (window.innerHeight - br.top + 4) + 'px');
                this.containerEl.style.setProperty('top', '');
                this.containerEl.style.setProperty('max-height', `${Math.max(spaceAbove, 200)}px`);
            } else {
                this.containerEl.style.setProperty('top', (br.bottom + 4) + 'px');
                this.containerEl.style.setProperty('bottom', '');
                this.containerEl.style.setProperty('max-height', `${Math.max(spaceBelow, 200)}px`);
            }

            // Horizontal: keep inside container
            let left = Math.max(br.left, cr.left + pad);
            if (left + popWidth > cr.right - pad) left = cr.right - pad - popWidth;
            left = Math.max(left, cr.left + pad);
            this.containerEl.style.setProperty('left', `${left}px`);
        };
        positionPopover();

        this.resizeHandler = positionPopover;
        window.addEventListener('resize', this.resizeHandler);

        // ── Search row ───────────────────────────────────────────────
        const searchRow = this.containerEl.createDiv('vfp-search-row');
        const searchIconEl = searchRow.createSpan('vfp-search-icon');
        setIcon(searchIconEl, 'search');
        this.searchInput = searchRow.createEl('input', {
            cls: 'vfp-search-input',
            attr: { placeholder: t('ui.filePicker.search'), type: 'text', spellcheck: 'false' },
        });

        // ── List ─────────────────────────────────────────────────────
        this.listEl = this.containerEl.createDiv('vfp-list');

        // ── Footer ───────────────────────────────────────────────────
        const footer = this.containerEl.createDiv('vfp-footer');
        this.countEl = footer.createSpan('vfp-count');
        const addBtn = footer.createEl('button', { cls: 'vfp-add-btn', text: t('ui.filePicker.add') });
        addBtn.addEventListener('mousedown', (e) => { e.preventDefault(); void this.confirm(); });

        // ── Wire up events ────────────────────────────────────────────
        this.searchInput.addEventListener('input', () => {
            this.activeIdx = 0;
            this.renderList();
        });

        this.searchInput.addEventListener('keydown', (e: KeyboardEvent) => {
            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    this.activeIdx = Math.min(this.activeIdx + 1, this.filtered.length - 1);
                    this.renderList();
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    this.activeIdx = Math.max(this.activeIdx - 1, 0);
                    this.renderList();
                    break;
                case ' ':
                    e.preventDefault();
                    this.toggleActive();
                    break;
                case 'Enter':
                    e.preventDefault();
                    // If nothing selected, auto-select the focused row first
                    if (this.selected.size === 0) {
                        const item = this.filtered[this.activeIdx];
                        if (item) this.selected.add(item.file.path);
                    }
                    void this.confirm();
                    break;
                case 'Escape':
                    e.preventDefault();
                    this.hide();
                    break;
            }
        });

        // Close on outside click
        const closeOnOutside = (e: MouseEvent) => {
            if (this.containerEl && !this.containerEl.contains(e.target as Node)) {
                this.hide();
                document.removeEventListener('mousedown', closeOnOutside);
            }
        };
        document.addEventListener('mousedown', closeOnOutside);

        this.renderList();
        this.updateCount();

        // Focus search input after mount
        setTimeout(() => this.searchInput?.focus(), 0);
    }

    hide(): void {
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }
        this.containerEl?.remove();
        this.containerEl = null;
        this.searchInput = null;
        this.listEl = null;
        this.countEl = null;
        this.selected.clear();
        this.filtered = [];
    }

    // ── Private ────────────────────────────────────────────────────────

    private toggleActive(): void {
        const item = this.filtered[this.activeIdx];
        if (!item) return;
        if (this.selected.has(item.file.path)) {
            this.selected.delete(item.file.path);
        } else {
            this.selected.add(item.file.path);
        }
        this.renderList();
        this.updateCount();
    }

    private async confirm(): Promise<void> {
        const files = Array.from(this.selected)
            .map(p => this.app.vault.getAbstractFileByPath(p))
            .filter((f): f is TFile => f instanceof TFile);
        this.hide();
        if (files.length > 0) await this.onConfirm(files);
    }

    private updateCount(): void {
        if (!this.countEl) return;
        this.countEl.setText(
            this.selected.size > 0 ? t('ui.filePicker.selected', { count: this.selected.size }) : '',
        );
    }

    private renderList(): void {
        if (!this.listEl) return;
        const query = (this.searchInput?.value ?? '').toLowerCase();
        const isSearching = query !== '';

        const activeFile = this.app.workspace.getActiveFile();

        this.filtered = [];

        // Active note first
        if (activeFile) {
            const match = !isSearching
                || activeFile.basename.toLowerCase().includes(query)
                || activeFile.path.toLowerCase().includes(query);
            if (match) this.filtered.push({ file: activeFile, label: t('ui.filePicker.activeFile', { name: activeFile.basename }) });
        }

        if (isSearching) {
            const SUPPORTED = new Set(['md', 'txt', 'pptx', 'xlsx', 'docx', 'pdf', 'json', 'xml', 'csv']);
            this.app.vault.getFiles()
                .filter(f => SUPPORTED.has(f.extension)
                    && (!activeFile || f.path !== activeFile.path)
                    && (f.basename.toLowerCase().includes(query) || f.path.toLowerCase().includes(query)))
                .sort((a, b) => a.basename.localeCompare(b.basename))
                .slice(0, 80)
                .forEach(f => this.filtered.push({ file: f, label: f.basename }));
        }

        if (this.activeIdx >= this.filtered.length) this.activeIdx = 0;

        this.listEl.empty();

        if (this.filtered.length === 0) {
            this.listEl.createDiv({ cls: 'vfp-empty', text: t('ui.filePicker.noFiles') });
            return;
        }

        this.filtered.forEach(({ file, label }, idx) => {
            const isChecked = this.selected.has(file.path);
            const isActive = idx === this.activeIdx;

            const row = this.listEl!.createDiv({
                cls: `vfp-row${isChecked ? ' vfp-row-checked' : ''}${isActive ? ' vfp-row-active' : ''}`,
            });

            const cb = row.createEl('input', { attr: { type: 'checkbox', tabindex: '-1' } });
            cb.checked = isChecked;

            const info = row.createDiv('vfp-row-info');
            info.createSpan({ cls: 'vfp-row-name', text: label });
            const parentPath = file.parent?.path;
            if (parentPath && parentPath !== '/') {
                info.createSpan({ cls: 'vfp-row-path', text: parentPath });
            }

            row.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (this.selected.has(file.path)) {
                    this.selected.delete(file.path);
                } else {
                    this.selected.add(file.path);
                }
                this.activeIdx = idx;
                this.renderList();
                this.updateCount();
            });
        });

        // Scroll active row into view
        const activeRow = this.listEl.querySelector<HTMLElement>('.vfp-row-active');
        activeRow?.scrollIntoView({ block: 'nearest' });
    }
}
