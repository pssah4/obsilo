import { App, Notice, Setting, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { ContentEditorModal } from './ContentEditorModal';
import { RulesLoader } from '../../core/context/RulesLoader';

export class RulesTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    build(containerEl: HTMLElement): void {
        containerEl.createEl('p', {
            cls: 'agent-settings-desc',
            text: 'Rules are injected into the system prompt of every agent session. ' +
                  'Store rule files as .md or .txt in your vault at .obsidian-agent/rules/.',
        });

        const rulesLoader = (this.plugin as any).rulesLoader;

        // ── Create new rule ────────────────────────────────────────────────
        const createRow = containerEl.createDiv({ cls: 'agent-rules-create-row' });
        const nameInput = createRow.createEl('input', {
            type: 'text', placeholder: 'Rule name (e.g. "always-use-iso-dates")',
            cls: 'agent-rules-name-input',
        });
        const createBtn = createRow.createEl('button', { text: 'Create rule', cls: 'mod-cta' });

        // ── Rule list ──────────────────────────────────────────────────────
        const listEl = containerEl.createDiv({ cls: 'agent-rules-list' });

        const refreshList = async () => {
            listEl.empty();
            if (!rulesLoader) {
                listEl.createEl('p', { cls: 'agent-settings-desc', text: 'Rules loader not available.' });
                return;
            }
            const paths: string[] = await rulesLoader.discoverRules();
            if (paths.length === 0) {
                listEl.createEl('p', { cls: 'agent-settings-desc', text: 'No rules yet. Create one above.' });
                return;
            }
            for (const rPath of paths) {
                const row = listEl.createDiv({ cls: 'agent-rules-row' });
                const label = row.createSpan({ cls: 'agent-rules-label' });

                const enabled = this.plugin.settings.rulesToggles?.[rPath] !== false;
                const toggle = label.createEl('input', { type: 'checkbox' });
                (toggle as HTMLInputElement).checked = enabled;
                toggle.addEventListener('change', async () => {
                    this.plugin.settings.rulesToggles ??= {};
                    this.plugin.settings.rulesToggles[rPath] = (toggle as HTMLInputElement).checked;
                    await this.plugin.saveSettings();
                });

                const { RulesLoader } = await import('../../core/context/RulesLoader');
                label.createSpan({ text: RulesLoader.displayName(rPath) });

                const actions = row.createDiv({ cls: 'agent-rules-actions' });
                const editBtn = actions.createEl('button', { text: 'Edit', cls: 'agent-rules-edit-btn' });
                editBtn.addEventListener('click', async () => {
                    const content = await this.app.vault.adapter.read(rPath);
                    const { RulesLoader } = await import('../../core/context/RulesLoader');
                    new ContentEditorModal(this.app, `Edit rule: ${RulesLoader.displayName(rPath)}`, content, async (newContent) => {
                        await this.app.vault.adapter.write(rPath, newContent);
                    }).open();
                });

                const delBtn = actions.createEl('button', { text: 'Delete', cls: 'agent-rules-delete-btn' });
                delBtn.addEventListener('click', async () => {
                    await rulesLoader.deleteRule(rPath);
                    this.plugin.settings.rulesToggles ??= {};
                    delete this.plugin.settings.rulesToggles[rPath];
                    await this.plugin.saveSettings();
                    await refreshList();
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
