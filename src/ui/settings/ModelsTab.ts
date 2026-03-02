import { App, Notice, Setting, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { ModelConfigModal } from './ModelConfigModal';
import { CodeImportModal } from './CodeImportModal';
import type { CustomModel } from '../../types/settings';
import { getModelKey, getFirstEnabledModelKey } from '../../types/settings';
import { PROVIDER_LABELS, PROVIDER_COLORS } from './constants';
import { t } from '../../i18n';

export class ModelsTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    build(containerEl: HTMLElement): void {
        // Table header
        const table = containerEl.createDiv('model-table');
        const header = table.createDiv('model-row model-row-header');
        header.createDiv({ cls: 'mc-name', text: t('settings.models.headerModel') });
        header.createDiv({ cls: 'mc-provider', text: t('settings.models.headerProvider') });
        header.createDiv({ cls: 'mc-key', text: t('settings.models.headerKey') });
        header.createDiv({ cls: 'mc-enable', text: t('settings.models.headerEnable') });
        header.createDiv({ cls: 'mc-default', text: t('settings.models.headerDefault') });
        header.createDiv({ cls: 'mc-actions' });

        // Rows
        const models = this.plugin.settings.activeModels;
        if (models.length === 0) {
            table.createDiv({ cls: 'model-table-empty', text: t('settings.models.empty') });
        } else {
            models.forEach((model) => this.renderModelRow(table, model));
        }

        // Add model button
        const footer = containerEl.createDiv('model-table-footer');
        const addBtn = footer.createEl('button', { cls: 'mod-cta model-add-btn', text: t('settings.models.addModel') });
        addBtn.addEventListener('click', () => {
            new ModelConfigModal(this.app, null, async (newModel) => {
                const key = getModelKey(newModel);
                if (this.plugin.settings.activeModels.some((m) => getModelKey(m) === key)) {
                    new Notice(t('settings.models.alreadyExists', { name: newModel.name }));
                    return;
                }
                this.plugin.settings.activeModels.push(newModel);
                await this.plugin.saveSettings();
                this.rerender();
            }).open();
        });

        // Import from Code button
        const importBtn = footer.createEl('button', { cls: 'model-import-btn', text: t('settings.models.importFromCode') });
        importBtn.addEventListener('click', () => {
            const existingKeys = new Set(
                this.plugin.settings.activeModels.map((m) => getModelKey(m)),
            );
            new CodeImportModal(this.app, existingKeys, async (newModels) => {
                let imported = 0;
                let skipped = 0;
                for (const model of newModels) {
                    const k = getModelKey(model);
                    if (this.plugin.settings.activeModels.some((m) => getModelKey(m) === k)) {
                        skipped++;
                        continue;
                    }
                    this.plugin.settings.activeModels.push(model);
                    imported++;
                }
                if (imported > 0) {
                    await this.plugin.saveSettings();
                    this.rerender();
                }
                const parts: string[] = [];
                if (imported > 0) parts.push(t('settings.models.imported', { count: imported }));
                if (skipped > 0) parts.push(t('settings.models.skipped', { count: skipped }));
                if (parts.length > 0) new Notice(parts.join('. ') + '.');
            }).open();
        });
    }

    renderModelRow(table: HTMLElement, model: CustomModel): void {
        const key = getModelKey(model);
        const hasKey = !!model.apiKey || model.provider === 'ollama' || model.provider === 'lmstudio';
        const isActive = this.plugin.settings.activeModelKey === key;

        const row = table.createDiv(`model-row${isActive ? ' model-row-active' : ''}${!model.enabled ? ' model-row-disabled' : ''}`);

        // Name
        const nameEl = row.createDiv('mc-name');
        nameEl.createSpan({ text: model.displayName ?? model.name, cls: 'mc-name-text' });

        // Provider badge
        const provEl = row.createDiv('mc-provider');
        const badge = provEl.createSpan({ cls: 'provider-badge', text: PROVIDER_LABELS[model.provider] ?? model.provider });
        badge.style.setProperty('background', PROVIDER_COLORS[model.provider] ?? '#607d8b');

        // Key indicator
        const keyEl = row.createDiv('mc-key');
        const keyIcon = keyEl.createSpan('mc-key-icon');
        setIcon(keyIcon, hasKey ? 'check' : 'minus');
        keyEl.addClass(hasKey ? 'mc-key-ok' : 'mc-key-missing');

        // Enable — small toggle switch
        const enableEl = row.createDiv('mc-enable');
        const toggleLabel = enableEl.createEl('label', { cls: 'mc-toggle' });
        const toggleInput = toggleLabel.createEl('input', { attr: { type: 'checkbox' } });
        toggleLabel.createSpan({ cls: 'mc-toggle-track' });
        toggleInput.checked = model.enabled;
        toggleInput.addEventListener('change', () => { void (async () => {
            const idx = this.plugin.settings.activeModels.findIndex((m) => getModelKey(m) === key);
            if (idx !== -1) this.plugin.settings.activeModels[idx].enabled = toggleInput.checked;

            // If disabling the current default, fall back to first enabled model
            if (!toggleInput.checked && this.plugin.settings.activeModelKey === key) {
                this.plugin.settings.activeModelKey = getFirstEnabledModelKey(this.plugin.settings.activeModels);
            }

            // Clean up mode overrides pointing to this now-disabled model
            if (!toggleInput.checked && this.plugin.settings.modeModelKeys) {
                for (const [modeSlug, modeKey] of Object.entries(this.plugin.settings.modeModelKeys)) {
                    if (modeKey === key) {
                        delete this.plugin.settings.modeModelKeys[modeSlug];
                    }
                }
            }

            await this.plugin.saveSettings();
            this.rerender();
        })(); });

        // Default — radio button (single selection)
        const defaultEl = row.createDiv('mc-default');
        const defaultRadio = defaultEl.createEl('input', { attr: { type: 'radio', name: 'active-model' } });
        defaultRadio.checked = isActive;
        defaultRadio.disabled = !model.enabled;
        defaultRadio.addEventListener('change', () => { void (async () => {
            if (defaultRadio.checked) {
                this.plugin.settings.activeModelKey = key;
                await this.plugin.saveSettings();
                this.rerender();
            }
        })(); });

        // Actions
        const actionsEl = row.createDiv('mc-actions');

        const configBtn = actionsEl.createEl('button', { cls: 'mc-action-btn', attr: { title: t('settings.models.configure') } });
        setIcon(configBtn, 'settings');
        configBtn.addEventListener('click', () => {
            new ModelConfigModal(this.app, { ...model }, async (updated) => {
                const idx = this.plugin.settings.activeModels.findIndex((m) => getModelKey(m) === key);
                if (idx !== -1) this.plugin.settings.activeModels[idx] = updated;
                // If the active model was renamed, keep it active under the new key
                if (this.plugin.settings.activeModelKey === key) {
                    this.plugin.settings.activeModelKey = getModelKey(updated);
                }
                await this.plugin.saveSettings();
                this.rerender();
            }).open();
        });

        const delBtn = actionsEl.createEl('button', { cls: 'mc-action-btn mc-action-del', attr: { title: t('settings.models.remove') } });
        setIcon(delBtn, 'trash');
        delBtn.addEventListener('click', () => { void (async () => {
            this.plugin.settings.activeModels = this.plugin.settings.activeModels.filter(
                (m) => getModelKey(m) !== key,
            );
            if (this.plugin.settings.activeModelKey === key) this.plugin.settings.activeModelKey = '';
            await this.plugin.saveSettings();
            this.rerender();
        })(); });
    }

    // ---------------------------------------------------------------------------
    // Embeddings tab
    // ---------------------------------------------------------------------------

}
