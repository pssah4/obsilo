/**
 * SkillsManager - Discover and match skills from vault (Sprint 3.4)
 *
 * Skills are stored as Markdown files at:
 *   {vault}/.obsidian-agent/skills/{name}/SKILL.md
 *
 * SKILL.md frontmatter (required):
 *   name: string        — short identifier (lowercase, hyphens)
 *   description: string — what the skill is for (used for keyword matching)
 *
 * SKILL.md body — instructions the agent should follow when using this skill.
 *
 * Relevant skills (by keyword overlap with user message) are injected into
 * the system prompt as an <available_skills> block. The agent can then
 * read_file the SKILL.md path to get the full instructions.
 *
 * Inspired by Kilo Code's src/services/skills/SkillsManager.ts (simplified).
 */

import type { Vault } from 'obsidian';

export interface SkillMeta {
    /** Vault-relative path to the SKILL.md file */
    path: string;
    /** Short name (from frontmatter or directory name) */
    name: string;
    /** Description used for keyword matching */
    description: string;
}

export class SkillsManager {
    private readonly vault: Vault;
    readonly skillsDir: string;

    constructor(vault: Vault) {
        this.vault = vault;
        this.skillsDir = '.obsidian-agent/skills';
    }

    async initialize(): Promise<void> {
        try {
            const exists = await this.vault.adapter.exists(this.skillsDir);
            if (!exists) {
                await this.vault.adapter.mkdir(this.skillsDir);
            }
        } catch {
            // Non-fatal
        }
    }

    /**
     * Discover all skills by scanning for SKILL.md files.
     */
    async discoverSkills(): Promise<SkillMeta[]> {
        try {
            const exists = await this.vault.adapter.exists(this.skillsDir);
            if (!exists) return [];
            const listed = await this.vault.adapter.list(this.skillsDir);
            const skills: SkillMeta[] = [];
            for (const folder of listed.folders) {
                const skillPath = `${folder}/SKILL.md`;
                const fileExists = await this.vault.adapter.exists(skillPath);
                if (!fileExists) continue;
                try {
                    const content = await this.vault.adapter.read(skillPath);
                    const meta = this.parseFrontmatter(content, folder, skillPath);
                    if (meta) skills.push(meta);
                } catch {
                    // Skip unreadable skill files
                }
            }
            return skills;
        } catch {
            return [];
        }
    }

    /**
     * Get skills relevant to the user's message (by keyword overlap).
     * Returns a formatted prompt section string, or empty string if no matches.
     */
    async getRelevantSkills(userMessage: string): Promise<string> {
        const skills = await this.discoverSkills();
        if (skills.length === 0) return '';

        const msgWords = new Set(userMessage.toLowerCase().match(/\b\w{3,}\b/g) ?? []);
        const relevant = skills.filter((s) => {
            const descWords = s.description.toLowerCase().match(/\b\w{3,}\b/g) ?? [];
            return descWords.some((w) => msgWords.has(w));
        });

        if (relevant.length === 0) return '';

        const lines: string[] = ['<available_skills>'];
        for (const s of relevant) {
            lines.push(`  <skill>`);
            lines.push(`    <name>${this.xmlEscape(s.name)}</name>`);
            lines.push(`    <description>${this.xmlEscape(s.description)}</description>`);
            lines.push(`    <file>${this.xmlEscape(s.path)}</file>`);
            lines.push(`  </skill>`);
        }
        lines.push('</available_skills>');
        return lines.join('\n');
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private parseFrontmatter(content: string, folder: string, skillPath: string): SkillMeta | null {
        // Extract YAML frontmatter between --- delimiters
        const match = content.match(/^---\n([\s\S]*?)\n---/);
        if (!match) return null;
        const yaml = match[1];

        const nameMatch = yaml.match(/^name:\s*(.+)$/m);
        const descMatch = yaml.match(/^description:\s*(.+)$/m);

        const name = nameMatch?.[1]?.trim() ?? folder.split('/').pop() ?? 'unknown';
        const description = descMatch?.[1]?.trim() ?? '';

        if (!description) return null;

        return { path: skillPath, name, description };
    }

    private xmlEscape(s: string): string {
        return s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
}
