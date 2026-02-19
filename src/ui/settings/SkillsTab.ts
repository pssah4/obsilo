import { App, Notice, Setting, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { ContentEditorModal } from './ContentEditorModal';

export class SkillsTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    build(containerEl: HTMLElement): void {
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

    // ---------------------------------------------------------------------------
    // Modes tab
    // ---------------------------------------------------------------------------

}
