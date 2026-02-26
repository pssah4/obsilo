/**
 * MemoryService
 *
 * Read/write memory files and build context for the system prompt.
 * Memory files are Markdown, stored in ~/.obsidian-agent/memory/ (global).
 *
 * Memory types loaded into the system prompt:
 *   - user-profile.md  (~200 tokens)
 *   - projects.md       (~300 tokens)
 *   - patterns.md       (~200 tokens)
 *   - soul.md           (~200 tokens) — Agent identity & personality (OpenClaw SOUL.md inspired)
 *
 * knowledge.md is on-demand only (via semantic search), NOT in the system prompt.
 */

import type { FileAdapter } from '../storage/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryFiles {
    userProfile: string;
    projects: string;
    patterns: string;
    knowledge: string;
    soul: string;
    learnings: string;
}

export interface MemoryStats {
    fileCount: number;
    sessionCount: number;
    lastUpdated: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MEMORY_FILES = ['user-profile.md', 'projects.md', 'patterns.md', 'knowledge.md', 'soul.md', 'learnings.md'] as const;

const TEMPLATES: Record<string, string> = {
    'user-profile.md': `# User Profile

## Identity
- Name:
- Role:

## Communication
- Language:
- Style:

## Agent Behavior
`,
    'projects.md': `# Active Projects
`,
    'patterns.md': `# Behavioral Patterns
`,
    'knowledge.md': `# Domain Knowledge
`,
    'soul.md': `# Agent Identity

## Name
Obsilo

## Communication
- Language: Deutsch
- Style: Warm, nahbar, auf Augenhoehe

## Values
- Nuetzlichkeit vor Hoeflichkeit
- Ehrlichkeit — sage wenn ich etwas nicht weiss
- Respektiere die Arbeit des Nutzers
- Lerne aus Fehlern

## Anti-Patterns
- Keine leeren Floskeln
- Keine unnoetigen Entschuldigungen
- Keine Emojis
`,
    'learnings.md': `# Task Learnings
`,
};

/** Maximum characters per memory file injected into the system prompt. */
const MAX_CHARS_PER_FILE = 800;
/** Maximum total characters for the combined memory context. */
const MAX_TOTAL_CHARS = 4000;

// ---------------------------------------------------------------------------
// MemoryService
// ---------------------------------------------------------------------------

export class MemoryService {
    private memoryDir: string;
    private sessionsDir: string;

    constructor(private fs: FileAdapter) {
        this.memoryDir = 'memory';
        this.sessionsDir = 'memory/sessions';
    }

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    async initialize(): Promise<void> {
        await this.ensureDir(this.memoryDir);
        await this.ensureDir(this.sessionsDir);
        // Create template files only if they don't exist
        for (const name of MEMORY_FILES) {
            const path = `${this.memoryDir}/${name}`;
            const exists = await this.fs.exists(path);
            if (!exists) {
                await this.fs.write(path, TEMPLATES[name] ?? '');
            }
        }
    }

    // -----------------------------------------------------------------------
    // Read / Write
    // -----------------------------------------------------------------------

    async loadMemoryFiles(): Promise<MemoryFiles> {
        return {
            userProfile: await this.readFile('user-profile.md'),
            projects: await this.readFile('projects.md'),
            patterns: await this.readFile('patterns.md'),
            knowledge: await this.readFile('knowledge.md'),
            soul: await this.readFile('soul.md'),
            learnings: await this.readFile('learnings.md'),
        };
    }

    async readFile(name: string): Promise<string> {
        const path = `${this.memoryDir}/${name}`;
        try {
            return await this.fs.read(path);
        } catch {
            return '';
        }
    }

    async writeFile(name: string, content: string): Promise<void> {
        const path = `${this.memoryDir}/${name}`;
        await this.fs.write(path, content);
    }

    async appendToFile(name: string, content: string): Promise<void> {
        const existing = await this.readFile(name);
        await this.writeFile(name, existing + '\n' + content);
    }

    async writeSessionSummary(conversationId: string, content: string): Promise<void> {
        const path = `${this.sessionsDir}/${conversationId}.md`;
        await this.fs.write(path, content);
    }

    async readSessionSummary(conversationId: string): Promise<string> {
        const path = `${this.sessionsDir}/${conversationId}.md`;
        try {
            return await this.fs.read(path);
        } catch {
            return '';
        }
    }

    // -----------------------------------------------------------------------
    // Context Builder
    // -----------------------------------------------------------------------

    /**
     * Build the memory context string for injection into the system prompt.
     * Only includes non-empty files. Truncates each to MAX_CHARS_PER_FILE.
     * Total output capped at MAX_TOTAL_CHARS.
     */
    buildMemoryContext(files: MemoryFiles): string {
        const sections: string[] = [];

        const addSection = (tag: string, content: string) => {
            const trimmed = content.trim();
            if (!trimmed || Object.values(TEMPLATES).some((t) => trimmed === t.trim())) {
                return; // Skip empty/template-only files
            }
            const truncated = trimmed.length > MAX_CHARS_PER_FILE
                ? trimmed.slice(0, MAX_CHARS_PER_FILE) + '\n[...truncated]'
                : trimmed;
            sections.push(`<${tag}>\n${truncated}\n</${tag}>`);
        };

        addSection('agent_identity', files.soul);
        addSection('user_profile', files.userProfile);
        addSection('active_projects', files.projects);
        addSection('behavioral_patterns', files.patterns);
        addSection('task_learnings', files.learnings);
        // knowledge.md is NOT included — it's on-demand via semantic search

        if (sections.length === 0) return '';

        let result = sections.join('\n\n');
        if (result.length > MAX_TOTAL_CHARS) {
            result = result.slice(0, MAX_TOTAL_CHARS) + '\n[...truncated]';
        }
        return result;
    }

    // -----------------------------------------------------------------------
    // Detection & Stats
    // -----------------------------------------------------------------------

    /** Check if user-profile.md has meaningful content (for onboarding detection). */
    async hasUserProfile(): Promise<boolean> {
        const content = await this.readFile('user-profile.md');
        const trimmed = content.trim();
        const template = (TEMPLATES['user-profile.md'] ?? '').trim();
        return trimmed.length > 0 && trimmed !== template;
    }

    async getStats(): Promise<MemoryStats> {
        let fileCount = 0;
        let sessionCount = 0;
        let lastUpdated: string | null = null;

        for (const name of MEMORY_FILES) {
            const path = `${this.memoryDir}/${name}`;
            try {
                const stat = await this.fs.stat(path);
                if (stat) {
                    fileCount++;
                    const mtime = new Date(stat.mtime).toISOString();
                    if (!lastUpdated || mtime > lastUpdated) lastUpdated = mtime;
                }
            } catch { /* skip */ }
        }

        try {
            const listed = await this.fs.list(this.sessionsDir);
            sessionCount = listed.files.filter((f) => f.endsWith('.md')).length;
        } catch { /* skip */ }

        return { fileCount, sessionCount, lastUpdated };
    }

    /** Delete all memory files and session summaries. */
    async resetAll(): Promise<void> {
        // Delete session summaries
        try {
            const listed = await this.fs.list(this.sessionsDir);
            for (const file of listed.files) {
                try { await this.fs.remove(file); } catch { /* skip */ }
            }
        } catch { /* skip */ }

        // Reset memory files to templates
        for (const name of MEMORY_FILES) {
            await this.writeFile(name, TEMPLATES[name] ?? '');
        }
    }

    /** Return the memory directory path (for "open in editor" functionality). */
    getMemoryDir(): string {
        return this.memoryDir;
    }

    // -----------------------------------------------------------------------
    // Private
    // -----------------------------------------------------------------------

    private async ensureDir(dir: string): Promise<void> {
        const exists = await this.fs.exists(dir);
        if (!exists) {
            await this.fs.mkdir(dir);
        }
    }
}
