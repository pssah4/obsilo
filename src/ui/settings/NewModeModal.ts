import { App, Modal, Notice, Setting } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import type { ModeService } from '../../core/modes/ModeService';
import type { ModeConfig } from '../../types/settings';
import { getModelKey } from '../../types/settings';
import { BUILT_IN_MODES } from '../../core/modes/builtinModes';
import { TOOL_GROUP_META } from './constants';
import { GlobalModeStore } from '../../core/modes/GlobalModeStore';

export class NewModeModal extends Modal {
    private plugin: ObsidianAgentPlugin;
    private onSave: () => void;
    private modeService?: ModeService;

    constructor(app: App, plugin: ObsidianAgentPlugin, onSave: () => void, modeService?: ModeService) {
        super(app);
        this.plugin = plugin;
        this.onSave = onSave;
        this.modeService = modeService;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.addClass('new-mode-modal');
        contentEl.createEl('h2', { text: 'New Mode' });

        let slug = '';
        let name = '';
        let icon = 'sparkles';
        let description = '';
        let whenToUse = '';
        let roleDefinition = '';
        let customInstructions = '';
        let selectedGroups: Set<string> = new Set(['read', 'vault', 'agent']);
        let modelKey = '';
        let saveLocation: 'vault' | 'global' = 'vault';

        // ── Model ─────────────────────────────────────────────────────────────
        const modelSetting = new Setting(contentEl)
            .setName('Model')
            .setDesc('Which model this mode uses. Falls back to the global model if not set.');
        modelSetting.addDropdown((dd) => {
            dd.addOption('', '— Use global model —');
            for (const m of this.plugin.settings.activeModels) {
                const key = getModelKey(m);
                dd.addOption(key, m.displayName ?? m.name);
            }
            dd.setValue(modelKey);
            dd.onChange((v) => { modelKey = v; });
        });

        // ── Name ──────────────────────────────────────────────────────────────
        let slugInput: HTMLInputElement | null = null;
        new Setting(contentEl)
            .setName('Name')
            .setDesc('Display name (e.g. "Daily Planner")')
            .addText((t) => t.onChange((v) => {
                name = v;
                const computed = v.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
                slug = computed;
                if (slugInput) slugInput.value = computed;
            }));

        // ── Slug ──────────────────────────────────────────────────────────────
        const slugSetting = new Setting(contentEl)
            .setName('Slug')
            .setDesc('Auto-generated from name. Used internally and in file names.');
        slugSetting.addText((t) => {
            slugInput = t.inputEl;
            t.onChange((v) => { slug = v; });
        });

        // ── Short description ─────────────────────────────────────────────────
        contentEl.createEl('div', { cls: 'new-mode-field-label', text: 'Short description (for humans)' });
        contentEl.createEl('div', { cls: 'new-mode-field-desc', text: 'Brief description shown in the mode selector dropdown.' });
        const descTextarea = contentEl.createEl('textarea', {
            cls: 'new-mode-textarea',
            attr: { placeholder: 'Brief description...' },
        });
        descTextarea.rows = 2;
        descTextarea.addEventListener('input', () => { description = descTextarea.value; });

        // ── When to Use ───────────────────────────────────────────────────────
        contentEl.createEl('div', { cls: 'new-mode-field-label', text: 'When to Use (optional)' });
        contentEl.createEl('div', { cls: 'new-mode-field-desc', text: 'Guidance for the Orchestrator when deciding which mode to use.' });
        const wtuTextarea = contentEl.createEl('textarea', {
            cls: 'new-mode-textarea',
            attr: { placeholder: 'Describe when this mode should be chosen...' },
        });
        wtuTextarea.rows = 3;
        wtuTextarea.addEventListener('input', () => { whenToUse = wtuTextarea.value; });

        // ── Available Tools ───────────────────────────────────────────────────
        const toolsWrap = contentEl.createDiv('new-mode-groups');
        toolsWrap.createEl('label', { cls: 'new-mode-groups-label', text: 'Available Tools' });
        const groupGrid = toolsWrap.createDiv('new-mode-groups-grid');

        for (const [group, meta] of Object.entries(TOOL_GROUP_META)) {
            const row = groupGrid.createDiv('new-mode-group-row');
            const cb = row.createEl('input', { type: 'checkbox' });
            cb.checked = selectedGroups.has(group);
            cb.addEventListener('change', () => {
                if (cb.checked) selectedGroups.add(group);
                else selectedGroups.delete(group);
            });
            const label = row.createEl('label');
            label.createEl('strong', { text: meta.label });
            label.createEl('span', { text: ` — ${meta.desc}`, cls: 'modes-group-desc' });
        }

        // ── Role Definition ───────────────────────────────────────────────────
        contentEl.createEl('label', { cls: 'new-mode-field-label', text: 'Role Definition' });
        contentEl.createEl('div', { cls: 'new-mode-field-desc', text: "Define the agent's expertise and personality." });
        const roleTextarea = contentEl.createEl('textarea', {
            cls: 'new-mode-textarea',
            attr: { placeholder: "Describe the agent's identity, behavior, and focus area..." },
        });
        roleTextarea.rows = 6;
        roleTextarea.addEventListener('input', () => { roleDefinition = roleTextarea.value; });

        // ── Custom Instructions ───────────────────────────────────────────────
        contentEl.createEl('label', { cls: 'new-mode-field-label', text: 'Mode-specific Custom Instructions (optional)' });
        contentEl.createEl('div', { cls: 'new-mode-field-desc', text: 'Additional behavioral guidelines for this mode.' });
        const ciTextarea = contentEl.createEl('textarea', {
            cls: 'new-mode-textarea',
            attr: { placeholder: 'Additional guidelines...' },
        });
        ciTextarea.rows = 3;
        ciTextarea.addEventListener('input', () => { customInstructions = ciTextarea.value; });

        // ── Save Location ─────────────────────────────────────────────────────
        const locationWrap = contentEl.createDiv('new-mode-location');
        locationWrap.createEl('div', { cls: 'new-mode-field-label', text: 'Save Location' });
        locationWrap.createEl('div', { cls: 'new-mode-field-desc', text: 'Global modes are available in all your Obsidian vaults.' });
        const locGrid = locationWrap.createDiv('new-mode-loc-grid');

        for (const opt of [
            { value: 'vault' as const, label: 'This Vault', desc: 'Only in this vault' },
            { value: 'global' as const, label: 'Global', desc: 'All vaults on this machine' },
        ]) {
            const row = locGrid.createDiv('new-mode-loc-row');
            const radio = row.createEl('input', { type: 'radio', attr: { name: 'save-location', value: opt.value } });
            radio.checked = opt.value === saveLocation;
            radio.addEventListener('change', () => { if (radio.checked) saveLocation = opt.value; });
            const lbl = row.createEl('label');
            lbl.createEl('strong', { text: opt.label });
            lbl.createEl('span', { text: ` — ${opt.desc}`, cls: 'modes-group-desc' });
        }

        // ── Actions ───────────────────────────────────────────────────────────
        const actions = contentEl.createDiv('new-mode-actions');
        const saveBtn = actions.createEl('button', { text: 'Create Mode', cls: 'mod-cta' });
        saveBtn.addEventListener('click', async () => {
            if (!name.trim()) { new Notice('Name is required'); return; }
            if (!roleDefinition.trim()) { new Notice('Role definition is required'); return; }

            const allSlugs = [
                ...BUILT_IN_MODES.map((m) => m.slug),
                ...this.plugin.settings.customModes.map((m) => m.slug),
                ...(await GlobalModeStore.loadModes()).map((m) => m.slug),
            ];
            let finalSlug = slug.trim() || name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
            if (!finalSlug) finalSlug = `mode-${Date.now()}`;
            if (allSlugs.includes(finalSlug)) finalSlug = `${finalSlug}-${Date.now()}`;

            const newMode: ModeConfig = {
                slug: finalSlug,
                name: name.trim(),
                icon: icon.trim() || 'sparkles',
                description: description.trim(),
                whenToUse: whenToUse.trim() || undefined,
                roleDefinition: roleDefinition.trim(),
                customInstructions: customInstructions.trim() || undefined,
                toolGroups: Array.from(selectedGroups) as any,
                source: saveLocation,
            };

            if (saveLocation === 'global') {
                await GlobalModeStore.addMode(newMode);
                if (this.modeService) await this.modeService.reloadGlobalModes();
            } else {
                this.plugin.settings.customModes.push(newMode);
                await this.plugin.saveSettings();
            }

            if (modelKey) {
                if (!this.plugin.settings.modeModelKeys) this.plugin.settings.modeModelKeys = {};
                this.plugin.settings.modeModelKeys[finalSlug] = modelKey;
                await this.plugin.saveSettings();
            }

            this.onSave();
            this.close();
        });

        const cancelBtn = actions.createEl('button', { text: 'Cancel' });
        cancelBtn.addEventListener('click', () => this.close());
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
