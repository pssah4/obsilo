import { App, Notice, Setting, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { ContentEditorModal } from './ContentEditorModal';

export class WorkflowsTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    build(containerEl: HTMLElement): void {
        containerEl.createEl('p', {
            cls: 'agent-settings-desc',
            text: 'Workflows are triggered by typing /workflow-name in the chat. ' +
                  'Store workflow files as .md or .txt in your vault at .obsidian-agent/workflows/.',
        });

        const workflowLoader = (this.plugin as any).workflowLoader;

        // ── Create new workflow ────────────────────────────────────────────
        const createRow = containerEl.createDiv({ cls: 'agent-rules-create-row' });
        const nameInput = createRow.createEl('input', {
            type: 'text', placeholder: 'Workflow name (e.g. "daily-review")',
            cls: 'agent-rules-name-input',
        });
        const createBtn = createRow.createEl('button', { text: 'Create workflow', cls: 'mod-cta' });

        // Import button
        const importWfBtn = createRow.createEl('button', { text: 'Import', cls: 'agent-rules-import-btn' });
        importWfBtn.addEventListener('click', () => {
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.md,.txt';
            fileInput.addEventListener('change', async () => {
                const file = fileInput.files?.[0];
                if (!file || !workflowLoader) return;
                const content = await file.text();
                const nameWithoutExt = file.name.replace(/\.[^.]+$/, '');
                await workflowLoader.createWorkflow(nameWithoutExt, content);
                await refreshList();
            });
            fileInput.click();
        });

        // ── Workflow list ──────────────────────────────────────────────────
        const listEl = containerEl.createDiv({ cls: 'agent-rules-list' });

        const refreshList = async () => {
            listEl.empty();
            if (!workflowLoader) {
                listEl.createEl('p', { cls: 'agent-settings-desc', text: 'Workflow loader not available.' });
                return;
            }
            const workflows: { path: string; slug: string; displayName: string }[] =
                await workflowLoader.discoverWorkflows();
            if (workflows.length === 0) {
                listEl.createEl('p', { cls: 'agent-settings-desc', text: 'No workflows yet. Create one above.' });
                return;
            }
            for (const wf of workflows) {
                const row = listEl.createDiv({ cls: 'agent-rules-row' });
                const label = row.createSpan({ cls: 'agent-rules-label' });

                const enabled = this.plugin.settings.workflowToggles?.[wf.path] !== false;
                const toggle = label.createEl('input', { type: 'checkbox' });
                (toggle as HTMLInputElement).checked = enabled;
                toggle.addEventListener('change', async () => {
                    this.plugin.settings.workflowToggles ??= {};
                    this.plugin.settings.workflowToggles[wf.path] = (toggle as HTMLInputElement).checked;
                    await this.plugin.saveSettings();
                });

                const nameSpan = label.createSpan({ text: wf.displayName });
                const slugSpan = label.createSpan({ cls: 'agent-workflow-slug', text: `/${wf.slug}` });
                nameSpan; slugSpan; // suppress unused warnings

                const actions = row.createDiv({ cls: 'agent-rules-actions' });
                const editBtn = actions.createEl('button', { text: 'Edit', cls: 'agent-rules-edit-btn' });
                editBtn.addEventListener('click', async () => {
                    const content = await this.app.vault.adapter.read(wf.path);
                    new ContentEditorModal(this.app, `Edit workflow: ${wf.displayName}`, content, async (newContent) => {
                        await this.app.vault.adapter.write(wf.path, newContent);
                    }).open();
                });

                const exportWfBtn = actions.createEl('button', { text: 'Export', cls: 'agent-rules-export-btn' });
                exportWfBtn.addEventListener('click', async () => {
                    const content = await this.app.vault.adapter.read(wf.path);
                    const blob = new Blob([content], { type: 'text/markdown' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${wf.slug}.md`;
                    a.click();
                    URL.revokeObjectURL(url);
                });

                const delBtn = actions.createEl('button', { text: 'Delete', cls: 'agent-rules-delete-btn' });
                delBtn.addEventListener('click', async () => {
                    await workflowLoader.deleteWorkflow(wf.path);
                    this.plugin.settings.workflowToggles ??= {};
                    delete this.plugin.settings.workflowToggles[wf.path];
                    await this.plugin.saveSettings();
                    await refreshList();
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
            new ContentEditorModal(this.app, `Edit workflow: ${name}`, template, async (content) => {
                await this.app.vault.adapter.write(wPath, content);
            }).open();
        });

        refreshList();
    }

}
