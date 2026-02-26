/**
 * SkillsManager - Discover and match skills from global storage (Sprint 3.4)
 *
 * Skills are stored as Markdown files at:
 *   ~/.obsidian-agent/skills/{name}/SKILL.md
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

import type { FileAdapter } from '../storage/types';

export interface SkillMeta {
    /** Path relative to FileAdapter root (e.g. "skills/my-skill/SKILL.md") */
    path: string;
    /** Short name (from frontmatter or directory name) */
    name: string;
    /** Description used for keyword matching */
    description: string;
}

export class SkillsManager {
    private readonly fs: FileAdapter;
    readonly skillsDir: string;

    constructor(fs: FileAdapter) {
        this.fs = fs;
        this.skillsDir = 'skills';
    }

    async initialize(): Promise<void> {
        try {
            const exists = await this.fs.exists(this.skillsDir);
            if (!exists) {
                await this.fs.mkdir(this.skillsDir);
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
            const exists = await this.fs.exists(this.skillsDir);
            if (!exists) return [];
            const listed = await this.fs.list(this.skillsDir);
            const skills: SkillMeta[] = [];
            for (const folder of listed.folders) {
                const skillPath = `${folder}/SKILL.md`;
                const fileExists = await this.fs.exists(skillPath);
                if (!fileExists) continue;
                try {
                    const content = await this.fs.read(skillPath);
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
     * Returns a formatted prompt section string with full skill content inlined,
     * or empty string if no matches. Inlining eliminates the read_file round-trip
     * that the agent would otherwise need before applying the skill.
     */
    async getRelevantSkills(userMessage: string, toggles?: Record<string, boolean>): Promise<string> {
        const allSkills = await this.discoverSkills();
        // Filter out disabled skills when toggles are provided
        const skills = toggles
            ? allSkills.filter((s) => toggles[s.path] !== false)
            : allSkills;
        if (skills.length === 0) return '';

        const msgWords = new Set(userMessage.toLowerCase().match(/\b\w{3,}\b/g) ?? []);
        const relevant = skills.filter((s) => {
            const descWords = s.description.toLowerCase().match(/\b\w{3,}\b/g) ?? [];
            return descWords.some((w) => msgWords.has(w));
        });

        if (relevant.length === 0) return '';

        const lines: string[] = ['<available_skills>'];
        for (const s of relevant) {
            // Read the full SKILL.md content and inline it — no agent read_file needed
            let fullContent = '';
            try {
                const raw = await this.fs.read(s.path);
                // Strip frontmatter, keep only the body
                fullContent = raw.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
                // Cap at 4000 chars to avoid bloating the system prompt
                if (fullContent.length > 4000) fullContent = fullContent.slice(0, 4000) + '\n…(truncated)';
            } catch {
                // Fall back to name+description only if file can't be read
            }
            lines.push(`  <skill>`);
            lines.push(`    <name>${this.xmlEscape(s.name)}</name>`);
            lines.push(`    <description>${this.xmlEscape(s.description)}</description>`);
            if (fullContent) {
                lines.push(`    <instructions>${this.xmlEscape(fullContent)}</instructions>`);
            }
            lines.push(`  </skill>`);
        }
        lines.push('</available_skills>');
        return lines.join('\n');
    }

    /**
     * Read a skill file's content (for UI editing).
     */
    async readFile(path: string): Promise<string> {
        return this.fs.read(path);
    }

    /**
     * Write a skill file's content (for UI editing).
     */
    async writeFile(path: string, content: string): Promise<void> {
        await this.fs.write(path, content);
    }

    /**
     * Create a skill directory and file.
     */
    async createSkill(dirPath: string, content: string): Promise<void> {
        await this.fs.mkdir(dirPath);
        await this.fs.write(`${dirPath}/SKILL.md`, content);
    }

    /**
     * Delete a skill file.
     */
    async deleteSkill(path: string): Promise<void> {
        await this.fs.remove(path);
    }

    /**
     * Check if a path exists in global storage.
     */
    async fileExists(path: string): Promise<boolean> {
        return this.fs.exists(path);
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
