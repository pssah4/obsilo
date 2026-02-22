import { App, Notice, Setting, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { ContentEditorModal } from './ContentEditorModal';
import type { PluginSkillMeta } from '../../core/skills/types';

export class SkillsTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    build(containerEl: HTMLElement): void {
        // ── Plugin Skills (PAS-1) ─────────────────────────────────────────
        this.buildPluginSkillsSection(containerEl);

        // ── Separator ─────────────────────────────────────────────────────
        containerEl.createEl('hr');

        // ── Manual Skills ─────────────────────────────────────────────────
        containerEl.createEl('h3', { text: 'Manual Skills' });
        containerEl.createEl('p', {
            cls: 'agent-settings-desc',
            text: 'Skills are automatically injected into the system prompt when relevant to the user\'s message. ' +
                  'Each skill lives in a subfolder at .obsidian-agent/skills/{name}/SKILL.md with frontmatter: name, description.',
        });

        const skillsManager = (this.plugin as any).skillsManager;

        // ── Create new skill ──────────────────────────────────────────────
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
                // Extract name from frontmatter if present, otherwise use filename
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

        // ── Skill list ─────────────────────────────────────────────────────
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

    // ── Plugin Skills (PAS-1) ─────────────────────────────────────────────

    private buildPluginSkillsSection(containerEl: HTMLElement): void {
        const scanner = this.plugin.vaultDNAScanner;
        const registry = this.plugin.skillRegistry;

        if (!scanner || !registry) {
            containerEl.createEl('h3', { text: 'Plugin Skills' });
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
        containerEl.createEl('h3', { text: 'Plugin Skills' });
        const statsEl = containerEl.createEl('p', { cls: 'agent-settings-desc' });
        statsEl.setText(
            `Auto-discovered from installed Obsidian plugins. ` +
            `Active: ${activeSkills.length} | Disabled: ${disabledSkills.length} | Total: ${allSkills.length}`,
        );

        // Rescan button
        const rescanRow = containerEl.createDiv({ cls: 'agent-rules-create-row' });
        const rescanBtn = rescanRow.createEl('button', { text: 'Rescan Vault', cls: 'mod-cta' });
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
            containerEl.createEl('h4', { text: 'Core Plugins' });
            this.buildSkillList(containerEl, coreSkills);
        }

        // Community Skills section
        const communitySkills = allSkills.filter((s) => s.source !== 'core');
        if (communitySkills.length > 0) {
            containerEl.createEl('h4', { text: 'Community Plugins' });
            this.buildSkillList(containerEl, communitySkills);
        }
    }

    private buildSkillList(containerEl: HTMLElement, skills: PluginSkillMeta[]): void {
        const listEl = containerEl.createDiv({ cls: 'agent-rules-list' });

        // Sort: enabled first, then alphabetical
        const sorted = [...skills].sort((a, b) => {
            if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
            return a.name.localeCompare(b.name);
        });

        for (const skill of sorted) {
            const row = listEl.createDiv({ cls: 'agent-rules-row' });

            // Status indicator
            const statusIcon = row.createSpan({ cls: 'agent-plugin-skill-status' });
            statusIcon.style.display = 'inline-block';
            statusIcon.style.width = '8px';
            statusIcon.style.height = '8px';
            statusIcon.style.borderRadius = '50%';
            statusIcon.style.marginRight = '8px';
            statusIcon.style.backgroundColor = skill.enabled
                ? 'var(--color-green)' : 'var(--text-faint)';
            statusIcon.title = skill.enabled ? 'Plugin enabled' : 'Plugin disabled';

            // Label
            const label = row.createSpan({ cls: 'agent-rules-label' });
            label.createSpan({ text: skill.name });
            const meta = `${skill.classification} | ${skill.commands.length} cmd${skill.commands.length !== 1 ? 's' : ''}`;
            label.createSpan({ cls: 'agent-workflow-slug', text: meta });

            // Agent toggle (only for enabled plugins)
            if (skill.enabled) {
                const actions = row.createDiv({ cls: 'agent-rules-actions' });
                const isActive = this.plugin.settings.vaultDNA.skillToggles[skill.id] !== false;
                const toggleBtn = actions.createEl('button', {
                    text: isActive ? 'Active' : 'Off',
                    cls: `agent-rules-edit-btn ${isActive ? '' : 'agent-toggle-off'}`,
                });
                toggleBtn.addEventListener('click', async () => {
                    const current = this.plugin.settings.vaultDNA.skillToggles[skill.id] !== false;
                    this.plugin.settings.vaultDNA.skillToggles[skill.id] = !current;
                    this.plugin.skillRegistry?.updateToggles(this.plugin.settings.vaultDNA.skillToggles);
                    await this.plugin.saveSettings();
                    toggleBtn.setText(!current ? 'Active' : 'Off');
                    toggleBtn.toggleClass('agent-toggle-off', current);
                });
            }
        }
    }
}
