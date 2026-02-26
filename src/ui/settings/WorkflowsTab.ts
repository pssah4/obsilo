import { App, Notice, Setting, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { ContentEditorModal } from './ContentEditorModal';
import { t } from '../../i18n';

export class WorkflowsTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    build(containerEl: HTMLElement): void {
        containerEl.createEl('h3', { text: t('settings.workflows.heading') });
        containerEl.createEl('p', {
            cls: 'agent-settings-desc',
            text: t('settings.workflows.desc'),
        });

        const workflowLoader = (this.plugin as any).workflowLoader;

        // ── Create row ───────────────────────────────────────────────────
        const createRow = containerEl.createDiv({ cls: 'agent-rules-create-row' });
        const nameInput = createRow.createEl('input', {
            type: 'text', placeholder: t('settings.workflows.placeholder'),
            cls: 'agent-rules-name-input',
        });
        const createBtn = createRow.createEl('button', { text: t('settings.workflows.create'), cls: 'mod-cta' });

        // Import button
        const importBtn = createRow.createEl('button', { text: t('settings.workflows.import'), cls: 'agent-rules-import-btn' });
        importBtn.addEventListener('click', () => {
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.md,.txt';
            fileInput.addEventListener('change', async () => {
                const file = fileInput.files?.[0];
                if (!file || !workflowLoader) return;
                const content = await file.text();
                const nameWithoutExt = file.name.replace(/\.[^.]+$/, '');
                try {
                    await workflowLoader.createWorkflow(nameWithoutExt, content);
                    await refreshList();
                } catch {
                    new Notice(t('settings.workflows.importFailed'));
                }
            });
            fileInput.click();
        });

        // ── Workflow list ────────────────────────────────────────────────
        const listEl = containerEl.createDiv({ cls: 'agent-rules-list' });

        const refreshList = async () => {
            listEl.empty();
            if (!workflowLoader) {
                listEl.createEl('p', { cls: 'agent-empty-state', text: t('settings.workflows.loaderNotAvailable') });
                return;
            }
            const workflows: { path: string; slug: string; displayName: string }[] =
                await workflowLoader.discoverWorkflows();
            if (workflows.length === 0) {
                listEl.createEl('p', { cls: 'agent-empty-state', text: t('settings.workflows.empty') });
                return;
            }
            for (const wf of workflows) {
                const row = listEl.createDiv({ cls: 'agent-rules-row' });
                const label = row.createSpan({ cls: 'agent-rules-label' });
                label.createSpan({ text: wf.displayName });
                label.createSpan({ cls: 'agent-workflow-slug', text: `/${wf.slug}` });

                const actions = row.createDiv({ cls: 'agent-rules-actions' });

                const editBtn = actions.createEl('button', { cls: 'agent-rules-edit-btn' });
                setIcon(editBtn, 'pencil');
                editBtn.setAttribute('aria-label', t('settings.workflows.edit'));
                editBtn.addEventListener('click', async () => {
                    const content = await workflowLoader.readFile(wf.path);
                    new ContentEditorModal(this.app, t('settings.workflows.editWorkflow', { name: wf.displayName }), content, async (newContent) => {
                        await workflowLoader.writeFile(wf.path, newContent);
                    }).open();
                });

                const exportBtn = actions.createEl('button', { cls: 'agent-rules-export-btn' });
                setIcon(exportBtn, 'download');
                exportBtn.setAttribute('aria-label', t('settings.workflows.export'));
                exportBtn.addEventListener('click', async () => {
                    const content = await workflowLoader.readFile(wf.path);
                    const blob = new Blob([content], { type: 'text/markdown' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${wf.slug}.md`;
                    a.click();
                    URL.revokeObjectURL(url);
                });

                const delBtn = actions.createEl('button', { cls: 'agent-rules-delete-btn' });
                setIcon(delBtn, 'trash-2');
                delBtn.setAttribute('aria-label', t('settings.workflows.delete'));
                delBtn.addEventListener('click', async () => {
                    await workflowLoader.deleteWorkflow(wf.path);
                    this.plugin.settings.workflowToggles ??= {};
                    delete this.plugin.settings.workflowToggles[wf.path];
                    await this.plugin.saveSettings();
                    await refreshList();
                });

                // Enable/disable toggle
                this.plugin.settings.workflowToggles ??= {};
                const isActive = this.plugin.settings.workflowToggles[wf.path] !== false;
                const toggleEl = row.createDiv({
                    cls: `checkbox-container agent-rules-toggle${isActive ? ' is-enabled' : ''}`,
                });
                toggleEl.addEventListener('click', async () => {
                    this.plugin.settings.workflowToggles ??= {};
                    const current = this.plugin.settings.workflowToggles[wf.path] !== false;
                    this.plugin.settings.workflowToggles[wf.path] = !current;
                    await this.plugin.saveSettings();
                    toggleEl.toggleClass('is-enabled', !current);
                });
            }
        };

        createBtn.addEventListener('click', async () => {
            const name = nameInput.value.trim();
            if (!name || !workflowLoader) return;
            const template = `# ${name}\n\n`;
            const wPath = await workflowLoader.createWorkflow(name, template);
            nameInput.value = '';
            await refreshList();
            new ContentEditorModal(this.app, t('settings.workflows.editWorkflow', { name }), template, async (content) => {
                await workflowLoader.writeFile(wPath, content);
            }).open();
        });

        refreshList();
    }

}
