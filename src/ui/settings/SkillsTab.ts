import { App, Notice, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { ContentEditorModal } from './ContentEditorModal';
import type { PluginSkillMeta } from '../../core/skills/types';

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
        containerEl.createEl('h3', { text: 'Manual Skills' });
        containerEl.createEl('p', {
            cls: 'agent-settings-desc',
            text: 'Skills are automatically injected into the system prompt when relevant to the user\'s message. ' +
                  'Each skill lives in a subfolder at .obsidian-agent/skills/{name}/SKILL.md with frontmatter: name, description.',
        });

        const skillsManager = (this.plugin as any).skillsManager;

        // -- Create new skill --
        const createRow = containerEl.createDiv({ cls: 'agent-rules-create-row' });
        const nameInput = createRow.createEl('input', {
            type: 'text', placeholder: 'Skill name (e.g. "daily-template")',
            cls: 'agent-rules-name-input',
        });
        const createBtn = createRow.createEl('button', { text: 'Create skill', cls: 'mod-cta' });

        // Import button
        const importSkillBtn = createRow.createEl('button', { text: 'Import', cls: 'agent-rules-import-btn' });
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
                    const exists = await this.app.vault.adapter.exists(dir);
                    if (!exists) await this.app.vault.adapter.mkdir(dir);
                    await this.app.vault.adapter.write(`${dir}/SKILL.md`, content);
                    await refreshList();
                } catch {
                    new Notice('Could not import skill');
                }
            });
            fileInput.click();
        });

        // -- Skill list --
        const listEl = containerEl.createDiv({ cls: 'agent-rules-list' });

        const refreshList = async () => {
            listEl.empty();
            if (!skillsManager) {
                listEl.createEl('p', { cls: 'agent-settings-desc', text: 'Skills manager not available.' });
                return;
            }
            const skills: { path: string; name: string; description: string }[] =
                await skillsManager.discoverSkills();
            if (skills.length === 0) {
                listEl.createEl('p', { cls: 'agent-settings-desc', text: 'No skills yet. Create one above.' });
                return;
            }
            for (const skill of skills) {
                const row = listEl.createDiv({ cls: 'agent-rules-row' });
                const label = row.createSpan({ cls: 'agent-rules-label' });
                label.createSpan({ text: skill.name });
                label.createSpan({ cls: 'agent-workflow-slug', text: skill.description });

                const actions = row.createDiv({ cls: 'agent-rules-actions' });
                const editBtn = actions.createEl('button', { text: 'Edit', cls: 'agent-rules-edit-btn' });
                editBtn.addEventListener('click', async () => {
                    const content = await this.app.vault.adapter.read(skill.path);
                    new ContentEditorModal(this.app, `Edit skill: ${skill.name}`, content, async (newContent) => {
                        await this.app.vault.adapter.write(skill.path, newContent);
                    }).open();
                });

                const exportSkillBtn = actions.createEl('button', { text: 'Export', cls: 'agent-rules-export-btn' });
                exportSkillBtn.addEventListener('click', async () => {
                    const content = await this.app.vault.adapter.read(skill.path);
                    const blob = new Blob([content], { type: 'text/markdown' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `SKILL-${skill.name}.md`;
                    a.click();
                    URL.revokeObjectURL(url);
                });

                const delBtn = actions.createEl('button', { text: 'Delete', cls: 'agent-rules-delete-btn' });
                delBtn.addEventListener('click', async () => {
                    try {
                        await this.app.vault.adapter.remove(skill.path);
                        await refreshList();
                    } catch {
                        new Notice('Could not delete skill file');
                    }
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
                const exists = await this.app.vault.adapter.exists(dir);
                if (!exists) await this.app.vault.adapter.mkdir(dir);
                await this.app.vault.adapter.write(skillPath, template);
                nameInput.value = '';
                await refreshList();
                new ContentEditorModal(this.app, `Edit skill: ${safeName}`, template, async (content) => {
                    await this.app.vault.adapter.write(skillPath, content);
                }).open();
            } catch {
                new Notice('Could not create skill');
            }
        });

        refreshList();
    }

    // -- Obsidian Plugin Skills (PAS-1) --

    private buildPluginSkillsSection(containerEl: HTMLElement): void {
        const scanner = this.plugin.vaultDNAScanner;
        const registry = this.plugin.skillRegistry;

        if (!scanner || !registry) {
            containerEl.createEl('h3', { text: 'Obsidian Plugin Skills' });
            containerEl.createEl('p', {
                cls: 'agent-settings-desc',
                text: 'Plugin skills are disabled. Enable "VaultDNA" in the Advanced settings to auto-discover Obsidian plugins as agent skills.',
            });
            return;
        }

        const activeSkills = registry.getActivePluginSkills();
        const disabledSkills = registry.getDisabledPluginSkills();
        const allSkills = scanner.getAllPluginSkills();

        // Header with stats
        containerEl.createEl('h3', { text: 'Obsidian Plugin Skills' });
        const statsEl = containerEl.createEl('p', { cls: 'agent-settings-desc' });
        statsEl.setText(
            `Auto-discovered from installed Obsidian plugins. ` +
            `Active: ${activeSkills.length} | Disabled: ${disabledSkills.length} | Total: ${allSkills.length}`,
        );

        // Controls row
        const controlsRow = containerEl.createDiv({ cls: 'agent-skill-controls' });
        const rescanBtn = controlsRow.createEl('button', { text: 'Rescan Vault', cls: 'mod-cta' });
        rescanBtn.addEventListener('click', async () => {
            rescanBtn.disabled = true;
            rescanBtn.setText('Scanning...');
            try {
                await scanner.fullScan();
                registry.updateToggles(this.plugin.settings.vaultDNA.skillToggles);
                new Notice(`VaultDNA: Scanned ${scanner.getAllPluginSkills().length} plugins`);
                this.rerender();
            } catch (e) {
                new Notice('VaultDNA scan failed');
                console.error('[VaultDNA] Rescan failed:', e);
            } finally {
                rescanBtn.disabled = false;
                rescanBtn.setText('Rescan Vault');
            }
        });

        // Core Skills section
        const coreSkills = allSkills.filter((s) => s.source === 'core');
        if (coreSkills.length > 0) {
            containerEl.createEl('h4', { text: `Core Plugin Skills (${coreSkills.length})` });
            this.buildCompactSkillList(containerEl, coreSkills);
        }

        // Community Skills section
        const communitySkills = allSkills.filter((s) => s.source !== 'core');
        if (communitySkills.length > 0) {
            containerEl.createEl('h4', { text: `Community Plugin Skills (${communitySkills.length})` });
            this.buildCompactSkillList(containerEl, communitySkills);
        }
    }

    private buildCompactSkillList(containerEl: HTMLElement, skills: PluginSkillMeta[]): void {
        const table = containerEl.createEl('table', { cls: 'agent-skill-table' });

        // Header
        const thead = table.createEl('thead');
        const hr = thead.createEl('tr');
        hr.createEl('th', { text: '', cls: 'agent-skill-th-status' }); // installed dot
        hr.createEl('th', { text: 'Plugin' });
        hr.createEl('th', { text: 'Commands', cls: 'agent-skill-th-cmds' });
        hr.createEl('th', { text: '', cls: 'agent-skill-th-actions' }); // view buttons
        hr.createEl('th', { text: 'Agent', cls: 'agent-skill-th-toggle' }); // agent toggle

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
            dot.setAttribute('aria-label', skill.enabled ? 'Installed & enabled' : 'Disabled in Obsidian');

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

            // View skill file
            const viewBtn = actionsTd.createEl('button', {
                cls: 'agent-skill-action-btn', attr: { 'aria-label': 'View skill file' },
            });
            setIcon(viewBtn, 'file-text');
            viewBtn.addEventListener('click', () => this.openSkillFile(skill));

            // View README (if exists)
            const docsBtn = actionsTd.createEl('button', {
                cls: 'agent-skill-action-btn', attr: { 'aria-label': 'View README' },
            });
            setIcon(docsBtn, 'book-open');
            this.checkReadmeExists(skill.id).then((exists) => {
                if (!exists) {
                    docsBtn.addClass('agent-skill-action-btn-faint');
                    docsBtn.setAttribute('aria-label', 'No README available');
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
            new ContentEditorModal(this.app, `Skill: ${skill.name}`, content, async (updated) => {
                await this.app.vault.adapter.write(path, updated);
            }).open();
        } catch {
            new Notice(`Skill file not found: ${skill.id}.skill.md`);
        }
    }

    private async openReadmeFile(skill: PluginSkillMeta): Promise<void> {
        const path = `${this.skillsDir}/${skill.id}.readme.md`;
        try {
            const content = await this.app.vault.adapter.read(path);
            new ContentEditorModal(this.app, `README: ${skill.name}`, content, async (updated) => {
                await this.app.vault.adapter.write(path, updated);
            }).open();
        } catch {
            new Notice(`No README available for ${skill.name}. Run "Rescan Vault" to fetch READMEs.`);
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
