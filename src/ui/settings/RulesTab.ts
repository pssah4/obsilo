import { App, Notice, Setting, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { ContentEditorModal } from './ContentEditorModal';
import { RulesLoader } from '../../core/context/RulesLoader';

export class RulesTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    build(containerEl: HTMLElement): void {
        containerEl.createEl('h3', { text: 'Rules' });
        containerEl.createEl('p', {
            cls: 'agent-settings-desc',
            text: 'Rules are injected into the system prompt of every agent session. ' +
                  'Store rule files as .md or .txt in your vault at .obsidian-agent/rules/.',
        });

        const rulesLoader = (this.plugin as any).rulesLoader;

        // ── Create row ───────────────────────────────────────────────────
        const createRow = containerEl.createDiv({ cls: 'agent-rules-create-row' });
        const nameInput = createRow.createEl('input', {
            type: 'text', placeholder: 'Rule name (e.g. "always-use-iso-dates")',
            cls: 'agent-rules-name-input',
        });
        const createBtn = createRow.createEl('button', { text: 'Create rule', cls: 'mod-cta' });

        // Import button
        const importBtn = createRow.createEl('button', { text: 'Import', cls: 'agent-rules-import-btn' });
        importBtn.addEventListener('click', () => {
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.md,.txt';
            fileInput.addEventListener('change', async () => {
                const file = fileInput.files?.[0];
                if (!file || !rulesLoader) return;
                const content = await file.text();
                const nameWithoutExt = file.name.replace(/\.[^.]+$/, '');
                try {
                    await rulesLoader.createRule(nameWithoutExt, content);
                    await refreshList();
                } catch {
                    new Notice('Could not import rule');
                }
            });
            fileInput.click();
        });

        // ── Rule list ────────────────────────────────────────────────────
        const listEl = containerEl.createDiv({ cls: 'agent-rules-list' });

        const refreshList = async () => {
            listEl.empty();
            if (!rulesLoader) {
                listEl.createEl('p', { cls: 'agent-empty-state', text: 'Rules loader not available.' });
                return;
            }
            const paths: string[] = await rulesLoader.discoverRules();
            if (paths.length === 0) {
                listEl.createEl('p', { cls: 'agent-empty-state', text: 'No rules yet. Create one above.' });
                return;
            }
            for (const rPath of paths) {
                const row = listEl.createDiv({ cls: 'agent-rules-row' });
                const label = row.createSpan({ cls: 'agent-rules-label' });
                label.createSpan({ text: RulesLoader.displayName(rPath) });

                const actions = row.createDiv({ cls: 'agent-rules-actions' });

                const editBtn = actions.createEl('button', { cls: 'agent-rules-edit-btn' });
                setIcon(editBtn, 'pencil');
                editBtn.setAttribute('aria-label', 'Edit');
                editBtn.addEventListener('click', async () => {
                    const content = await this.app.vault.adapter.read(rPath);
                    new ContentEditorModal(this.app, `Edit rule: ${RulesLoader.displayName(rPath)}`, content, async (newContent) => {
                        await this.app.vault.adapter.write(rPath, newContent);
                    }).open();
                });

                const exportBtn = actions.createEl('button', { cls: 'agent-rules-export-btn' });
                setIcon(exportBtn, 'download');
                exportBtn.setAttribute('aria-label', 'Export');
                exportBtn.addEventListener('click', async () => {
                    const content = await this.app.vault.adapter.read(rPath);
                    const blob = new Blob([content], { type: 'text/markdown' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${RulesLoader.displayName(rPath)}.md`;
                    a.click();
                    URL.revokeObjectURL(url);
                });

                const delBtn = actions.createEl('button', { cls: 'agent-rules-delete-btn' });
                setIcon(delBtn, 'trash-2');
                delBtn.setAttribute('aria-label', 'Delete');
                delBtn.addEventListener('click', async () => {
                    await rulesLoader.deleteRule(rPath);
                    this.plugin.settings.rulesToggles ??= {};
                    delete this.plugin.settings.rulesToggles[rPath];
                    await this.plugin.saveSettings();
                    await refreshList();
                });

                // Enable/disable toggle
                this.plugin.settings.rulesToggles ??= {};
                const isActive = this.plugin.settings.rulesToggles[rPath] !== false;
                const toggleEl = row.createDiv({
                    cls: `checkbox-container agent-rules-toggle${isActive ? ' is-enabled' : ''}`,
                });
                toggleEl.addEventListener('click', async () => {
                    this.plugin.settings.rulesToggles ??= {};
                    const current = this.plugin.settings.rulesToggles[rPath] !== false;
                    this.plugin.settings.rulesToggles[rPath] = !current;
                    await this.plugin.saveSettings();
                    toggleEl.toggleClass('is-enabled', !current);
                });
            }
        };

        createBtn.addEventListener('click', async () => {
            const name = nameInput.value.trim();
            if (!name || !rulesLoader) return;
            const template = `# ${name}\n\n`;
            const rPath = await rulesLoader.createRule(name, template);
            nameInput.value = '';
            await refreshList();
            new ContentEditorModal(this.app, `Edit rule: ${name}`, template, async (content) => {
                await this.app.vault.adapter.write(rPath, content);
            }).open();
        });

        refreshList();
    }

}
