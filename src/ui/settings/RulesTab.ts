import { App, Notice, Setting, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { ContentEditorModal } from './ContentEditorModal';
import { RulesLoader } from '../../core/context/RulesLoader';
import { t } from '../../i18n';

export class RulesTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    build(containerEl: HTMLElement): void {
        containerEl.createEl('h3', { text: t('settings.rules.heading') });
        containerEl.createEl('p', {
            cls: 'agent-settings-desc',
            text: t('settings.rules.desc'),
        });

        const rulesLoader = (this.plugin as any).rulesLoader;

        // ── Create row ───────────────────────────────────────────────────
        const createRow = containerEl.createDiv({ cls: 'agent-rules-create-row' });
        const nameInput = createRow.createEl('input', {
            type: 'text', placeholder: t('settings.rules.placeholder'),
            cls: 'agent-rules-name-input',
        });
        const createBtn = createRow.createEl('button', { text: t('settings.rules.create'), cls: 'mod-cta' });

        // Import button
        const importBtn = createRow.createEl('button', { text: t('settings.rules.import'), cls: 'agent-rules-import-btn' });
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
                    new Notice(t('settings.rules.importFailed'));
                }
            });
            fileInput.click();
        });

        // ── Rule list ────────────────────────────────────────────────────
        const listEl = containerEl.createDiv({ cls: 'agent-rules-list' });

        const refreshList = async () => {
            listEl.empty();
            if (!rulesLoader) {
                listEl.createEl('p', { cls: 'agent-empty-state', text: t('settings.rules.loaderNotAvailable') });
                return;
            }
            const paths: string[] = await rulesLoader.discoverRules();
            if (paths.length === 0) {
                listEl.createEl('p', { cls: 'agent-empty-state', text: t('settings.rules.empty') });
                return;
            }
            for (const rPath of paths) {
                const row = listEl.createDiv({ cls: 'agent-rules-row' });
                const label = row.createSpan({ cls: 'agent-rules-label' });
                label.createSpan({ text: RulesLoader.displayName(rPath) });

                const actions = row.createDiv({ cls: 'agent-rules-actions' });

                const editBtn = actions.createEl('button', { cls: 'agent-rules-edit-btn' });
                setIcon(editBtn, 'pencil');
                editBtn.setAttribute('aria-label', t('settings.rules.edit'));
                editBtn.addEventListener('click', async () => {
                    const content = await rulesLoader.readFile(rPath);
                    new ContentEditorModal(this.app, t('settings.rules.editRule', { name: RulesLoader.displayName(rPath) }), content, async (newContent) => {
                        await rulesLoader.writeFile(rPath, newContent);
                    }).open();
                });

                const exportBtn = actions.createEl('button', { cls: 'agent-rules-export-btn' });
                setIcon(exportBtn, 'download');
                exportBtn.setAttribute('aria-label', t('settings.rules.export'));
                exportBtn.addEventListener('click', async () => {
                    const content = await rulesLoader.readFile(rPath);
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
                delBtn.setAttribute('aria-label', t('settings.rules.delete'));
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
            new ContentEditorModal(this.app, t('settings.rules.editRule', { name }), template, async (content) => {
                await rulesLoader.writeFile(rPath, content);
            }).open();
        });

        refreshList();
    }

}
