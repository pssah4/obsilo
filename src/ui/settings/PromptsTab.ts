import { App, Notice, Setting, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { ContentEditorModal } from './ContentEditorModal';
import type { CustomPrompt } from '../../types/settings';
import { BUILT_IN_MODES } from '../../core/modes/builtinModes';

export class PromptsTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    build(containerEl: HTMLElement): void {
        containerEl.createEl('p', {
            cls: 'agent-settings-desc',
            text: 'Create your own prompt templates. Type / in the chat to trigger them. ' +
                  'Use {{userInput}} to insert your current message text, ' +
                  'and {{activeFile}} to insert the name of the active note.',
        });

        const listEl = containerEl.createDiv({ cls: 'agent-rules-list' });
        let editingId: string | null = null;

        const savePrompts = async (prompts: CustomPrompt[]) => {
            this.plugin.settings.customPrompts = prompts;
            await this.plugin.saveSettings();
        };

        // Collect all available modes for the mode selector
        const allModes = [
            ...BUILT_IN_MODES,
            ...(this.plugin.settings.customModes ?? []),
        ];

        // ── Inline form (create / edit) ────────────────────────────────────────
        const formEl = containerEl.createDiv({ cls: 'agent-prompt-form' });
        formEl.style.display = 'none';

        const formTitle = formEl.createEl('p', { cls: 'agent-prompt-form-title', text: 'New Prompt' });
        const nameInput = formEl.createEl('input', {
            type: 'text', placeholder: 'Name (e.g. "Daily report")',
            cls: 'agent-prompt-input',
        }) as HTMLInputElement;
        const slugInput = formEl.createEl('input', {
            type: 'text', placeholder: 'Slug (e.g. "daily-report")',
            cls: 'agent-prompt-input',
        }) as HTMLInputElement;

        // Auto-derive slug from name
        nameInput.addEventListener('input', () => {
            if (!editingId) {
                slugInput.value = nameInput.value
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

        const formHint = formEl.createEl('p', {
            cls: 'agent-settings-desc',
            text: 'Variables: {{userInput}} = current chat message  |  {{activeFile}} = active note name',
        });
        formHint.style.fontSize = 'var(--font-smaller)';

        // Optional mode selector
        const modeRow = formEl.createDiv({ cls: 'agent-prompt-mode-row' });
        modeRow.createEl('label', { text: 'Mode (optional):', cls: 'agent-prompt-mode-label' });
        const modeSelect = modeRow.createEl('select', { cls: 'agent-prompt-input agent-prompt-mode-select' }) as HTMLSelectElement;
        modeSelect.createEl('option', { value: '', text: 'All modes' });
        for (const mode of allModes) {
            modeSelect.createEl('option', { value: mode.slug, text: mode.name });
        }
        modeRow.createEl('span', {
            cls: 'agent-settings-desc',
            text: 'Restrict this prompt to a specific mode. Leave blank to show in all modes.',
        }).style.fontSize = 'var(--font-smaller)';

        const formBtns = formEl.createDiv({ cls: 'agent-prompt-form-btns' });
        const saveBtn = formBtns.createEl('button', { text: 'Save', cls: 'mod-cta' });
        const cancelBtn = formBtns.createEl('button', { text: 'Cancel' });

        const openForm = (prompt?: CustomPrompt) => {
            editingId = prompt?.id ?? null;
            formTitle.setText(prompt ? 'Edit Prompt' : 'New Prompt');
            nameInput.value = prompt?.name ?? '';
            slugInput.value = prompt?.slug ?? '';
            contentInput.value = prompt?.content ?? '';
            modeSelect.value = prompt?.mode ?? '';
            formEl.style.display = '';
            nameInput.focus();
        };

        cancelBtn.addEventListener('click', () => {
            formEl.style.display = 'none';
            editingId = null;
        });

        saveBtn.addEventListener('click', async () => {
            const name = nameInput.value.trim();
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

        // ── New prompt button ──────────────────────────────────────────────────
        const addBtn = containerEl.createEl('button', { text: 'New Prompt', cls: 'mod-cta agent-prompt-add-btn' });
        addBtn.addEventListener('click', () => openForm());

        // ── List rendering ─────────────────────────────────────────────────────
        const renderList = () => {
            listEl.empty();
            const prompts = this.plugin.settings.customPrompts ?? [];
            if (prompts.length === 0) {
                listEl.createEl('p', {
                    cls: 'agent-settings-desc',
                    text: 'No custom prompts yet. Click "New Prompt" to create one.',
                });
                return;
            }
            for (const p of prompts) {
                const row = listEl.createDiv({ cls: 'agent-rules-row' });
                const label = row.createSpan({ cls: 'agent-rules-label' });

                const toggle = label.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
                toggle.checked = p.enabled !== false;
                toggle.addEventListener('change', async () => {
                    const updated = (this.plugin.settings.customPrompts ?? []).map((cp) =>
                        cp.id === p.id ? { ...cp, enabled: toggle.checked } : cp
                    );
                    await savePrompts(updated);
                });

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

                const delBtn = actions.createEl('button', { cls: 'agent-rules-delete-btn' });
                setIcon(delBtn, 'trash-2');
                delBtn.setAttribute('aria-label', 'Delete');
                delBtn.addEventListener('click', async () => {
                    const updated = (this.plugin.settings.customPrompts ?? []).filter((cp) => cp.id !== p.id);
                    await savePrompts(updated);
                    renderList();
                });
            }
        };

        // Insert form before list
        containerEl.insertBefore(formEl, listEl);
        renderList();
    }

}
