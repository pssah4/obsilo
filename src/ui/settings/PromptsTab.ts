import { App, Notice, Setting, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import type { CustomPrompt } from '../../types/settings';
import { BUILT_IN_MODES } from '../../core/modes/builtinModes';
import { t } from '../../i18n';

export class PromptsTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    build(containerEl: HTMLElement): void {
        containerEl.createEl('h3', { text: t('settings.prompts.heading') });
        containerEl.createEl('p', {
            cls: 'agent-settings-desc',
            text: t('settings.prompts.desc'),
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
            type: 'text', placeholder: t('settings.prompts.namePlaceholder'),
            cls: 'agent-rules-name-input',
        }) as HTMLInputElement;
        const createBtn = createRow.createEl('button', { text: t('settings.prompts.create'), cls: 'mod-cta' });

        // Import button
        const importBtn = createRow.createEl('button', { text: t('settings.prompts.import'), cls: 'agent-rules-import-btn' });
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
                        new Notice(t('settings.prompts.invalidFile'));
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
                    new Notice(t('settings.prompts.importFailed'));
                }
            });
            fileInput.click();
        });

        // ── Inline form (edit only — appears when editing a prompt) ─────
        const formEl = containerEl.createDiv({ cls: 'agent-prompt-form' });
        formEl.style.display = 'none';

        const formTitle = formEl.createEl('p', { cls: 'agent-prompt-form-title', text: t('settings.prompts.newPrompt') });
        const formNameInput = formEl.createEl('input', {
            type: 'text', placeholder: t('settings.prompts.formName'),
            cls: 'agent-prompt-input',
        }) as HTMLInputElement;
        const slugInput = formEl.createEl('input', {
            type: 'text', placeholder: t('settings.prompts.formSlug'),
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
            placeholder: t('settings.prompts.formTemplate'),
            cls: 'agent-prompt-textarea',
        }) as HTMLTextAreaElement;
        contentInput.rows = 5;

        formEl.createEl('p', {
            cls: 'agent-empty-state',
            text: t('settings.prompts.variables'),
        });

        // Optional mode selector
        const modeRow = formEl.createDiv({ cls: 'agent-prompt-mode-row' });
        modeRow.createEl('label', { text: t('settings.prompts.modeLabel'), cls: 'agent-prompt-mode-label' });
        const modeSelect = modeRow.createEl('select', { cls: 'agent-prompt-input agent-prompt-mode-select' }) as HTMLSelectElement;
        modeSelect.createEl('option', { value: '', text: t('settings.prompts.modeAll') });
        for (const mode of allModes) {
            modeSelect.createEl('option', { value: mode.slug, text: mode.name });
        }
        modeRow.createEl('span', {
            cls: 'agent-empty-state',
            text: t('settings.prompts.modeHint'),
        });

        const formBtns = formEl.createDiv({ cls: 'agent-prompt-form-btns' });
        const saveBtn = formBtns.createEl('button', { text: t('settings.prompts.save'), cls: 'mod-cta' });
        const cancelBtn = formBtns.createEl('button', { text: t('settings.prompts.cancel') });

        const openForm = (prompt?: CustomPrompt) => {
            editingId = prompt?.id ?? null;
            formTitle.setText(prompt ? t('settings.prompts.editPrompt') : t('settings.prompts.newPrompt'));
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
                    text: t('settings.prompts.empty'),
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
                editBtn.setAttribute('aria-label', t('settings.prompts.edit'));
                editBtn.addEventListener('click', () => openForm(p));

                const exportBtn = actions.createEl('button', { cls: 'agent-rules-export-btn' });
                setIcon(exportBtn, 'download');
                exportBtn.setAttribute('aria-label', t('settings.prompts.export'));
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
                delBtn.setAttribute('aria-label', t('settings.prompts.delete'));
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
