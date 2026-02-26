import { App, Notice, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { ContentEditorModal } from './ContentEditorModal';
import type { PluginSkillMeta } from '../../core/skills/types';
import { t } from '../../i18n';


export class SkillsTab {
    private readonly skillsDir = '.obsidian-agent/plugin-skills';

    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    build(containerEl: HTMLElement): void {
        // -- Manual Skills (first) --
        this.buildManualSkillsSection(containerEl);

        // -- Separator --
        containerEl.createEl('hr');

        // -- Obsidian Plugin Skills (PAS-1) --
        this.buildPluginSkillsSection(containerEl);
    }

    // -- Manual Skills --

    private buildManualSkillsSection(containerEl: HTMLElement): void {
        containerEl.createEl('h3', { text: t('settings.skills.headingManual') });
        containerEl.createEl('p', {
            cls: 'agent-settings-desc',
            text: t('settings.skills.desc'),
        });

        const skillsManager = (this.plugin as any).skillsManager;

        // -- Create new skill --
        const createRow = containerEl.createDiv({ cls: 'agent-rules-create-row' });
        const nameInput = createRow.createEl('input', {
            type: 'text', placeholder: t('settings.skills.placeholder'),
            cls: 'agent-rules-name-input',
        });
        const createBtn = createRow.createEl('button', { text: t('settings.skills.create'), cls: 'mod-cta' });

        // Import button
        const importSkillBtn = createRow.createEl('button', { text: t('settings.skills.import'), cls: 'agent-rules-import-btn' });
        importSkillBtn.addEventListener('click', () => {
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.md,.txt';
            fileInput.addEventListener('change', async () => {
                const file = fileInput.files?.[0];
                if (!file || !skillsManager) return;
                const content = await file.text();
                let skillName = file.name.replace(/\.[^.]+$/, '');
                const fmMatch = content.match(/^---[\s\S]*?^name:\s*(.+)$/m);
                if (fmMatch) skillName = fmMatch[1].trim();
                const safeName = skillName.replace(/[^a-zA-Z0-9\-_ ]/g, '').trim();
                const dir = `${skillsManager.skillsDir}/${safeName}`;
                try {
                    await skillsManager.createSkill(dir, content);
                    await refreshList();
                } catch {
                    new Notice(t('settings.skills.importFailed'));
                }
            });
            fileInput.click();
        });

        // -- Skill list (table layout matching Plugin Skills) --
        const listEl = containerEl.createDiv({ cls: 'agent-rules-list' });

        const refreshList = async () => {
            listEl.empty();
            if (!skillsManager) {
                listEl.createEl('p', { cls: 'agent-settings-desc', text: t('settings.skills.managerNotAvailable') });
                return;
            }
            const skills: { path: string; name: string; description: string }[] =
                await skillsManager.discoverSkills();
            if (skills.length === 0) {
                listEl.createEl('p', { cls: 'agent-empty-state', text: t('settings.skills.empty') });
                return;
            }

            const table = listEl.createEl('table', { cls: 'agent-skill-table' });
            const thead = table.createEl('thead');
            const hr = thead.createEl('tr');
            hr.createEl('th', { text: '', cls: 'agent-skill-th-status' });
            hr.createEl('th', { text: t('settings.skills.headerSkill') });
            hr.createEl('th', { text: '', cls: 'agent-skill-th-actions' });
            hr.createEl('th', { text: t('settings.skills.headerAgent'), cls: 'agent-skill-th-toggle' });

            const tbody = table.createEl('tbody');

            for (const skill of skills) {
                this.plugin.settings.manualSkillToggles ??= {};
                const isActive = this.plugin.settings.manualSkillToggles[skill.path] !== false;

                const tr = tbody.createEl('tr', {
                    cls: isActive ? '' : 'agent-skill-disabled',
                });

                // Status dot
                const statusTd = tr.createEl('td', { cls: 'agent-skill-status-cell' });
                const dot = statusTd.createSpan({ cls: 'agent-skill-dot' });
                dot.addClass(isActive ? 'agent-skill-dot-on' : 'agent-skill-dot-off');

                // Name + description
                const nameTd = tr.createEl('td', { cls: 'agent-skill-name-cell' });
                nameTd.createDiv({ text: skill.name, cls: 'agent-skill-name' });
                if (skill.description) {
                    nameTd.createDiv({ text: skill.description, cls: 'agent-skill-desc' });
                }

                // Actions (edit, export, delete)
                const actionsTd = tr.createEl('td', { cls: 'agent-skill-actions-cell' });

                const editBtn = actionsTd.createEl('button', {
                    cls: 'agent-skill-action-btn', attr: { 'aria-label': t('settings.skills.edit') },
                });
                setIcon(editBtn, 'pencil');
                editBtn.addEventListener('click', async () => {
                    const content = await skillsManager.readFile(skill.path);
                    new ContentEditorModal(this.app, t('settings.skills.editSkill', { name: skill.name }), content, async (newContent) => {
                        await skillsManager.writeFile(skill.path, newContent);
                    }).open();
                });

                const exportSkillBtn = actionsTd.createEl('button', {
                    cls: 'agent-skill-action-btn', attr: { 'aria-label': t('settings.skills.export') },
                });
                setIcon(exportSkillBtn, 'download');
                exportSkillBtn.addEventListener('click', async () => {
                    const content = await skillsManager.readFile(skill.path);
                    const blob = new Blob([content], { type: 'text/markdown' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `SKILL-${skill.name}.md`;
                    a.click();
                    URL.revokeObjectURL(url);
                });

                const delBtn = actionsTd.createEl('button', {
                    cls: 'agent-skill-action-btn', attr: { 'aria-label': t('settings.skills.delete') },
                });
                setIcon(delBtn, 'trash-2');
                delBtn.addEventListener('click', async () => {
                    try {
                        await skillsManager.deleteSkill(skill.path);
                        this.plugin.settings.manualSkillToggles ??= {};
                        delete this.plugin.settings.manualSkillToggles[skill.path];
                        await this.plugin.saveSettings();
                        await refreshList();
                    } catch {
                        new Notice(t('settings.skills.deleteFailed'));
                    }
                });

                // Toggle
                const toggleTd = tr.createEl('td', { cls: 'agent-skill-toggle-cell' });
                const toggleContainer = toggleTd.createDiv({
                    cls: `checkbox-container agent-skill-toggle${isActive ? ' is-enabled' : ''}`,
                });
                toggleContainer.addEventListener('click', async () => {
                    this.plugin.settings.manualSkillToggles ??= {};
                    const current = this.plugin.settings.manualSkillToggles[skill.path] !== false;
                    this.plugin.settings.manualSkillToggles[skill.path] = !current;
                    await this.plugin.saveSettings();
                    toggleContainer.toggleClass('is-enabled', !current);
                    dot.removeClass(current ? 'agent-skill-dot-on' : 'agent-skill-dot-off');
                    dot.addClass(current ? 'agent-skill-dot-off' : 'agent-skill-dot-on');
                    tr.toggleClass('agent-skill-disabled', current);
                });
            }
        };

        createBtn.addEventListener('click', async () => {
            const name = nameInput.value.trim();
            if (!name || !skillsManager) return;
            const safeName = name.replace(/[^a-zA-Z0-9\-_ ]/g, '').trim();
            const dir = `${skillsManager.skillsDir}/${safeName}`;
            const skillPath = `${dir}/SKILL.md`;
            const template = `---\nname: ${safeName}\ndescription: Describe when this skill applies\nkeywords: []\n---\n\n# ${safeName}\n\n<!-- Describe what this skill does and when to use it. The agent reads this file when the skill is relevant. -->\n\n`;
            try {
                await skillsManager.createSkill(dir, template);
                nameInput.value = '';
                await refreshList();
                new ContentEditorModal(this.app, t('settings.skills.editSkill', { name: safeName }), template, async (content) => {
                    await skillsManager.writeFile(skillPath, content);
                }).open();
            } catch {
                new Notice(t('settings.skills.createFailed'));
            }
        });

        refreshList();
    }

    // -- Obsidian Plugin Skills (PAS-1) --

    private buildPluginSkillsSection(containerEl: HTMLElement): void {
        const scanner = this.plugin.vaultDNAScanner;
        const registry = this.plugin.skillRegistry;

        if (!scanner || !registry) {
            containerEl.createEl('h3', { text: t('settings.skills.headingPlugin') });
            containerEl.createEl('p', {
                cls: 'agent-settings-desc',
                text: t('settings.skills.pluginDisabled'),
            });
            return;
        }

        const activeSkills = registry.getActivePluginSkills();
        const disabledSkills = registry.getDisabledPluginSkills();
        const allSkills = scanner.getAllPluginSkills();

        // Header with stats
        containerEl.createEl('h3', { text: t('settings.skills.headingPlugin') });
        const statsEl = containerEl.createEl('p', { cls: 'agent-settings-desc' });
        statsEl.setText(
            t('settings.skills.pluginStats', { active: activeSkills.length, disabled: disabledSkills.length, total: allSkills.length }),
        );

        // Controls row
        const controlsRow = containerEl.createDiv({ cls: 'agent-skill-controls' });
        const rescanBtn = controlsRow.createEl('button', { text: t('settings.skills.rescan'), cls: 'mod-cta' });
        rescanBtn.addEventListener('click', async () => {
            rescanBtn.disabled = true;
            rescanBtn.setText(t('settings.skills.scanning'));
            try {
                await scanner.fullScan();
                registry.updateToggles(this.plugin.settings.vaultDNA.skillToggles);
                new Notice(t('settings.skills.scanComplete', { count: scanner.getAllPluginSkills().length }));
                this.rerender();
            } catch (e) {
                new Notice(t('settings.skills.scanFailed'));
                console.error('[VaultDNA] Rescan failed:', e);
            } finally {
                rescanBtn.disabled = false;
                rescanBtn.setText(t('settings.skills.rescan'));
            }
        });

        // Core Skills section (collapsible)
        const coreSkills = allSkills.filter((s) => s.source === 'core');
        if (coreSkills.length > 0) {
            this.buildCollapsibleSkillGroup(containerEl, t('settings.skills.corePlugins', { count: coreSkills.length }), coreSkills);
        }

        // Community Skills section (collapsible)
        const communitySkills = allSkills.filter((s) => s.source !== 'core');
        if (communitySkills.length > 0) {
            this.buildCollapsibleSkillGroup(containerEl, t('settings.skills.communityPlugins', { count: communitySkills.length }), communitySkills);
        }
    }

    private buildCollapsibleSkillGroup(containerEl: HTMLElement, title: string, skills: PluginSkillMeta[]): void {
        const header = containerEl.createDiv({ cls: 'agent-skill-group-header' });
        const chevron = header.createSpan({ cls: 'agent-skill-group-chevron' });
        setIcon(chevron, 'chevron-down');
        header.createSpan({ text: title, cls: 'agent-skill-group-title' });

        const content = containerEl.createDiv({ cls: 'agent-skill-group-content' });
        this.buildCompactSkillList(content, skills);

        header.addEventListener('click', () => {
            const collapsed = content.classList.toggle('agent-skill-group-collapsed');
            chevron.empty();
            setIcon(chevron, collapsed ? 'chevron-right' : 'chevron-down');
        });
    }

    private buildCompactSkillList(containerEl: HTMLElement, skills: PluginSkillMeta[]): void {
        const table = containerEl.createEl('table', { cls: 'agent-skill-table' });

        // Header
        const thead = table.createEl('thead');
        const hr = thead.createEl('tr');
        hr.createEl('th', { text: '', cls: 'agent-skill-th-status' }); // installed dot
        hr.createEl('th', { text: t('settings.skills.headerPlugin') });
        hr.createEl('th', { text: t('settings.skills.headerCommands'), cls: 'agent-skill-th-cmds' });
        hr.createEl('th', { text: '', cls: 'agent-skill-th-actions' }); // view buttons
        hr.createEl('th', { text: t('settings.skills.headerAgent'), cls: 'agent-skill-th-toggle' }); // agent toggle

        const tbody = table.createEl('tbody');

        // Sort: enabled first, then alphabetical
        const sorted = [...skills].sort((a, b) => {
            if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
            return a.name.localeCompare(b.name);
        });

        for (const skill of sorted) {
            const tr = tbody.createEl('tr', {
                cls: skill.enabled ? '' : 'agent-skill-disabled',
            });

            // Status dot (installed in Obsidian?)
            const statusTd = tr.createEl('td', { cls: 'agent-skill-status-cell' });
            const dot = statusTd.createSpan({ cls: 'agent-skill-dot' });
            dot.addClass(skill.enabled ? 'agent-skill-dot-on' : 'agent-skill-dot-off');
            dot.setAttribute('aria-label', skill.enabled ? t('settings.skills.installed') : t('settings.skills.disabled'));

            // Name + description
            const nameTd = tr.createEl('td', { cls: 'agent-skill-name-cell' });
            nameTd.createDiv({ text: skill.name, cls: 'agent-skill-name' });
            if (skill.description) {
                nameTd.createDiv({ text: skill.description, cls: 'agent-skill-desc' });
            }

            // Command count
            tr.createEl('td', { text: String(skill.commands.length), cls: 'agent-skill-cmd-cell' });

            // Actions (view buttons)
            const actionsTd = tr.createEl('td', { cls: 'agent-skill-actions-cell' });

            // Edit skill file
            const editSkillBtn = actionsTd.createEl('button', {
                cls: 'agent-skill-action-btn', attr: { 'aria-label': t('settings.skills.editFile') },
            });
            setIcon(editSkillBtn, 'pencil');
            editSkillBtn.addEventListener('click', () => this.openSkillFile(skill));

            // View README (if exists)
            const docsBtn = actionsTd.createEl('button', {
                cls: 'agent-skill-action-btn', attr: { 'aria-label': t('settings.skills.viewReadme') },
            });
            setIcon(docsBtn, 'book-open');
            this.checkReadmeExists(skill.id).then((exists) => {
                if (!exists) {
                    docsBtn.addClass('agent-skill-action-btn-faint');
                    docsBtn.setAttribute('aria-label', t('settings.skills.noReadme'));
                }
            });
            docsBtn.addEventListener('click', () => this.openReadmeFile(skill));

            // Toggle — for ALL plugins (controls whether agent may use this skill)
            const toggleTd = tr.createEl('td', { cls: 'agent-skill-toggle-cell' });
            const isActive = this.plugin.settings.vaultDNA.skillToggles[skill.id] !== false;
            const toggleContainer = toggleTd.createDiv({
                cls: `checkbox-container agent-skill-toggle${isActive ? ' is-enabled' : ''}`,
            });
            toggleContainer.addEventListener('click', async () => {
                const current = this.plugin.settings.vaultDNA.skillToggles[skill.id] !== false;
                this.plugin.settings.vaultDNA.skillToggles[skill.id] = !current;
                this.plugin.skillRegistry?.updateToggles(this.plugin.settings.vaultDNA.skillToggles);
                await this.plugin.saveSettings();
                toggleContainer.toggleClass('is-enabled', !current);
            });
        }
    }

    private async openSkillFile(skill: PluginSkillMeta): Promise<void> {
        const path = `${this.skillsDir}/${skill.id}.skill.md`;
        try {
            const content = await this.app.vault.adapter.read(path);
            new ContentEditorModal(this.app, t('settings.skills.skillDetail', { name: skill.name }), content, async (updated) => {
                await this.app.vault.adapter.write(path, updated);
            }).open();
        } catch {
            new Notice(t('settings.skills.fileNotFound', { id: skill.id }));
        }
    }

    private async openReadmeFile(skill: PluginSkillMeta): Promise<void> {
        const path = `${this.skillsDir}/${skill.id}.readme.md`;
        try {
            const content = await this.app.vault.adapter.read(path);
            new ContentEditorModal(this.app, t('settings.skills.readme', { name: skill.name }), content, async (updated) => {
                await this.app.vault.adapter.write(path, updated);
            }).open();
        } catch {
            new Notice(t('settings.skills.noReadmeAvailable', { name: skill.name }));
        }
    }

    private async checkReadmeExists(pluginId: string): Promise<boolean> {
        try {
            return await this.app.vault.adapter.exists(`${this.skillsDir}/${pluginId}.readme.md`);
        } catch {
            return false;
        }
    }
}
