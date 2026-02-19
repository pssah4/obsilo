import type { App, TFile } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { resolvePromptContent } from '../../core/context/SupportPrompts';

interface AutocompleteItem {
    label: string;
    sub?: string;
    onSelect: () => void;
}

/**
 * AutocompleteHandler — manages the / and @ autocomplete dropdown.
 *
 * Extracted from AgentSidebarView to reduce file size.
 */
export class AutocompleteHandler {
    private items: AutocompleteItem[] = [];
    private selectedIndex = 0;
    private dropdownEl: HTMLElement | null = null;

    constructor(
        private plugin: ObsidianAgentPlugin,
        private app: App,
        private getTextarea: () => HTMLTextAreaElement | null,
        private getInputArea: () => HTMLElement | null,
        private addVaultFile: (file: TFile) => Promise<void>,
    ) {}

    async handleInput(): Promise<void> {
        const textarea = this.getTextarea();
        if (!textarea) return;
        const value = textarea.value;

        // / at the very start → workflow + prompt autocomplete
        if (value.startsWith('/')) {
            const query = value.slice(1).split(' ')[0].toLowerCase();

            const workflowLoader = (this.plugin as any).workflowLoader;
            const workflows: { slug: string; displayName: string }[] = workflowLoader
                ? await workflowLoader.discoverWorkflows()
                : [];
            const workflowItems = workflows
                .filter((w) => query === '' || w.slug.startsWith(query))
                .map((w) => ({
                    label: w.displayName,
                    sub: `/${w.slug}`,
                    onSelect: () => {
                        const ta = this.getTextarea();
                        if (!ta) return;
                        const rest = value.includes(' ') ? value.slice(value.indexOf(' ') + 1) : '';
                        ta.value = `/${w.slug}${rest ? ' ' + rest : ''}`;
                        this.hide();
                        ta.focus();
                    },
                }));

            const makePromptSelector = (content: string) => () => {
                const ta = this.getTextarea();
                if (!ta) return;
                const userInput = value.includes(' ') ? value.slice(value.indexOf(' ') + 1) : '';
                const activeFile = this.app.workspace.getActiveFile()?.name;
                ta.value = resolvePromptContent(content, { userInput, activeFile });
                this.hide();
                ta.focus();
            };

            const activeMode = this.plugin.settings.currentMode;
            const customItems = (this.plugin.settings.customPrompts ?? [])
                .filter((p) =>
                    p.enabled !== false &&
                    (query === '' || p.slug.startsWith(query)) &&
                    (!p.mode || p.mode === activeMode)
                )
                .map((p) => ({
                    label: p.name,
                    sub: `/${p.slug}`,
                    onSelect: makePromptSelector(p.content),
                }));

            this.items = [...workflowItems, ...customItems];
            if (this.items.length === 0) { this.hide(); return; }
            this.selectedIndex = 0;
            this.render();
            return;
        }

        // @ anywhere in the text → file mention autocomplete
        const cursorPos = textarea.selectionStart ?? value.length;
        const beforeCursor = value.slice(0, cursorPos);
        const atIdx = beforeCursor.lastIndexOf('@');
        if (atIdx !== -1 && (atIdx === 0 || /\s/.test(beforeCursor[atIdx - 1]))) {
            const query = beforeCursor.slice(atIdx + 1).toLowerCase();

            const makeFileOnSelect = (f: TFile) => async () => {
                const ta = this.getTextarea();
                if (!ta) return;
                const newValue = value.slice(0, atIdx) + value.slice(atIdx + 1 + query.length);
                ta.value = newValue.trim();
                this.hide();
                await this.addVaultFile(f);
                ta.focus();
            };

            const currentFile = this.app.workspace.getActiveFile();
            const activeOption = (currentFile && (query === '' || 'active'.startsWith(query)))
                ? [{ label: 'Active note', sub: `@active → ${currentFile.basename}`, onSelect: makeFileOnSelect(currentFile) }]
                : [];

            const allFiles = this.app.vault.getMarkdownFiles();
            const filtered = allFiles
                .filter((f) => f.path.toLowerCase().includes(query))
                .slice(0, 10);

            this.items = [
                ...activeOption,
                ...filtered.map((f) => ({ label: f.basename, sub: f.path, onSelect: makeFileOnSelect(f) })),
            ];
            if (this.items.length === 0) { this.hide(); return; }
            this.selectedIndex = 0;
            this.render();
            return;
        }

        this.hide();
    }

    /** Returns true if the event was consumed by the autocomplete. */
    handleKeyDown(e: KeyboardEvent): boolean {
        if (!this.dropdownEl) return false;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.selectedIndex = Math.min(this.selectedIndex + 1, this.items.length - 1);
            this.render();
            return true;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
            this.render();
            return true;
        }
        if (e.key === 'Tab' || e.key === 'Enter') {
            e.preventDefault();
            this.items[this.selectedIndex]?.onSelect();
            return true;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            this.hide();
            return true;
        }
        return false;
    }

    hide(): void {
        this.dropdownEl?.remove();
        this.dropdownEl = null;
        this.items = [];
        this.selectedIndex = 0;
    }

    private render(): void {
        const inputArea = this.getInputArea();
        if (!inputArea) return;

        if (!this.dropdownEl) {
            this.dropdownEl = inputArea.createDiv('autocomplete-dropdown');
            document.addEventListener('click', (e) => {
                if (this.dropdownEl && !this.dropdownEl.contains(e.target as Node)) {
                    this.hide();
                }
            }, { once: true });
        }

        this.dropdownEl.empty();
        this.items.forEach((item, idx) => {
            const row = this.dropdownEl!.createDiv({
                cls: `autocomplete-item${idx === this.selectedIndex ? ' active' : ''}`,
            });
            row.createSpan({ cls: 'autocomplete-label', text: item.label });
            if (item.sub) row.createSpan({ cls: 'autocomplete-sub', text: item.sub });
            row.addEventListener('mousedown', (e) => {
                e.preventDefault();
                item.onSelect();
            });
        });
    }
}
