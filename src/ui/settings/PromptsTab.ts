import { App, Notice, Setting, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { ContentEditorModal } from './ContentEditorModal';
import type { CustomPrompt } from '../../types/settings';
import { BUILT_IN_MODES } from '../../core/modes/builtinModes';

export class PromptsTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    build(containerEl: HTMLElement): void {
        containerEl.createEl('h3', { text: 'Prompts' });
        containerEl.createEl('p', {
            cls: 'agent-settings-desc',
            text: 'Create your own prompt templates. Type / in the chat to trigger them. ' +
                  'Use {{userInput}} to insert your current message text, ' +
                  'and {{activeFile}} to insert the name of the active note.',
        });

        let editingId: string | null = null;

        const savePrompts = async (prompts: CustomPrompt[]) => {
            this.plugin.settings.customPrompts = prompts;
            await this.plugin.saveSettings();
        };

        const allModes = [
            ...BUILT_IN_MODES,
            ...(this.plugin.settings.customModes ?? []),
        ];

        // ── Create row (same pattern as Skills/Rules/Workflows) ─────────
        const createRow = containerEl.createDiv({ cls: 'agent-rules-create-row' });
        const nameInput = createRow.createEl('input', {
            type: 'text', placeholder: 'Prompt name (e.g. "daily-report")',
            cls: 'agent-rules-name-input',
        }) as HTMLInputElement;
        const createBtn = createRow.createEl('button', { text: 'Create prompt', cls: 'mod-cta' });

        // Import button
        const importBtn = createRow.createEl('button', { text: 'Import', cls: 'agent-rules-import-btn' });
        importBtn.addEventListener('click', () => {
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.json';
            fileInput.addEventListener('change', async () => {
                const file = fileInput.files?.[0];
                if (!file) return;
                try {
                    const text = await file.text();
                    const data = JSON.parse(text);
                    if (!data.name || !data.slug || !data.content) {
                        new Notice('Invalid prompt file: missing name, slug, or content');
                        return;
                    }
                    const prompts = [...(this.plugin.settings.customPrompts ?? [])];
                    prompts.push({
                        id: `custom-${Date.now()}`,
                        name: data.name,
                        slug: data.slug,
                        content: data.content,
                        enabled: true,
                        mode: data.mode || undefined,
                    });
                    await savePrompts(prompts);
                    renderList();
                } catch {
                    new Notice('Could not import prompt');
                }
            });
            fileInput.click();
        });

        // ── Inline form (edit only — appears when editing a prompt) ─────
        const formEl = containerEl.createDiv({ cls: 'agent-prompt-form' });
        formEl.style.display = 'none';

        const formTitle = formEl.createEl('p', { cls: 'agent-prompt-form-title', text: 'New Prompt' });
        const formNameInput = formEl.createEl('input', {
            type: 'text', placeholder: 'Name (e.g. "Daily report")',
            cls: 'agent-prompt-input',
        }) as HTMLInputElement;
        const slugInput = formEl.createEl('input', {
            type: 'text', placeholder: 'Slug (e.g. "daily-report")',
            cls: 'agent-prompt-input',
        }) as HTMLInputElement;

        formNameInput.addEventListener('input', () => {
            if (!editingId) {
                slugInput.value = formNameInput.value
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-+|-+$/g, '');
            }
        });

        const contentInput = formEl.createEl('textarea', {
            placeholder: 'Prompt template — use {{userInput}} and {{activeFile}}',
            cls: 'agent-prompt-textarea',
        }) as HTMLTextAreaElement;
        contentInput.rows = 5;

        formEl.createEl('p', {
            cls: 'agent-empty-state',
            text: 'Variables: {{userInput}} = current chat message  |  {{activeFile}} = active note name',
        });

        // Optional mode selector
        const modeRow = formEl.createDiv({ cls: 'agent-prompt-mode-row' });
        modeRow.createEl('label', { text: 'Mode (optional):', cls: 'agent-prompt-mode-label' });
        const modeSelect = modeRow.createEl('select', { cls: 'agent-prompt-input agent-prompt-mode-select' }) as HTMLSelectElement;
        modeSelect.createEl('option', { value: '', text: 'All modes' });
        for (const mode of allModes) {
            modeSelect.createEl('option', { value: mode.slug, text: mode.name });
        }
        modeRow.createEl('span', {
            cls: 'agent-empty-state',
            text: 'Restrict this prompt to a specific mode. Leave blank to show in all modes.',
        });

        const formBtns = formEl.createDiv({ cls: 'agent-prompt-form-btns' });
        const saveBtn = formBtns.createEl('button', { text: 'Save', cls: 'mod-cta' });
        const cancelBtn = formBtns.createEl('button', { text: 'Cancel' });

        const openForm = (prompt?: CustomPrompt) => {
            editingId = prompt?.id ?? null;
            formTitle.setText(prompt ? 'Edit Prompt' : 'New Prompt');
            formNameInput.value = prompt?.name ?? '';
            slugInput.value = prompt?.slug ?? '';
            contentInput.value = prompt?.content ?? '';
            modeSelect.value = prompt?.mode ?? '';
            formEl.style.display = '';
            formNameInput.focus();
        };

        cancelBtn.addEventListener('click', () => {
            formEl.style.display = 'none';
            editingId = null;
        });

        saveBtn.addEventListener('click', async () => {
            const name = formNameInput.value.trim();
            const slug = slugInput.value.trim().replace(/[^a-z0-9-]/g, '');
            const content = contentInput.value.trim();
            if (!name || !slug || !content) return;

            const mode = modeSelect.value || undefined;
            const prompts = [...(this.plugin.settings.customPrompts ?? [])];
            if (editingId) {
                const idx = prompts.findIndex((p) => p.id === editingId);
                if (idx !== -1) prompts[idx] = { ...prompts[idx], name, slug, content, mode };
            } else {
                prompts.push({ id: `custom-${Date.now()}`, name, slug, content, enabled: true, mode });
            }
            await savePrompts(prompts);
            formEl.style.display = 'none';
            editingId = null;
            renderList();
        });

        createBtn.addEventListener('click', () => {
            const rawName = nameInput.value.trim();
            if (!rawName) return;
            const slug = rawName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
            openForm({ id: '', name: rawName, slug, content: '', enabled: true });
            editingId = null; // new prompt, not editing existing
            nameInput.value = '';
        });

        // ── Prompt list ─────────────────────────────────────────────────
        const listEl = containerEl.createDiv({ cls: 'agent-rules-list' });

        const renderList = () => {
            listEl.empty();
            const prompts = this.plugin.settings.customPrompts ?? [];
            if (prompts.length === 0) {
                listEl.createEl('p', {
                    cls: 'agent-empty-state',
                    text: 'No custom prompts yet. Create one above.',
                });
                return;
            }
            for (const p of prompts) {
                const row = listEl.createDiv({ cls: 'agent-rules-row' });
                const label = row.createSpan({ cls: 'agent-rules-label' });
                label.createSpan({ text: p.name });
                label.createSpan({ cls: 'agent-workflow-slug', text: `/${p.slug}` });
                if (p.mode) {
                    const modeName = allModes.find((m) => m.slug === p.mode)?.name ?? p.mode;
                    label.createSpan({ cls: 'agent-prompt-mode-badge', text: modeName });
                }

                const actions = row.createDiv({ cls: 'agent-rules-actions' });

                const editBtn = actions.createEl('button', { cls: 'agent-rules-edit-btn' });
                setIcon(editBtn, 'pencil');
                editBtn.setAttribute('aria-label', 'Edit');
                editBtn.addEventListener('click', () => openForm(p));

                const exportBtn = actions.createEl('button', { cls: 'agent-rules-export-btn' });
                setIcon(exportBtn, 'download');
                exportBtn.setAttribute('aria-label', 'Export');
                exportBtn.addEventListener('click', () => {
                    const data = { name: p.name, slug: p.slug, content: p.content, mode: p.mode };
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `prompt-${p.slug}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                });

                const delBtn = actions.createEl('button', { cls: 'agent-rules-delete-btn' });
                setIcon(delBtn, 'trash-2');
                delBtn.setAttribute('aria-label', 'Delete');
                delBtn.addEventListener('click', async () => {
                    const updated = (this.plugin.settings.customPrompts ?? []).filter((cp) => cp.id !== p.id);
                    await savePrompts(updated);
                    renderList();
                });

                // Enable/disable toggle
                const isActive = p.enabled !== false;
                const toggleEl = row.createDiv({
                    cls: `checkbox-container agent-rules-toggle${isActive ? ' is-enabled' : ''}`,
                });
                toggleEl.addEventListener('click', async () => {
                    const prompts = [...(this.plugin.settings.customPrompts ?? [])];
                    const idx = prompts.findIndex((cp) => cp.id === p.id);
                    if (idx !== -1) {
                        prompts[idx] = { ...prompts[idx], enabled: prompts[idx].enabled === false };
                        await savePrompts(prompts);
                        toggleEl.toggleClass('is-enabled', prompts[idx].enabled !== false);
                    }
                });
            }
        };

        // Insert form before list
        containerEl.insertBefore(formEl, listEl);
        renderList();
    }

}
