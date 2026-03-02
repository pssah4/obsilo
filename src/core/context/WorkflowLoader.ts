/**
 * WorkflowLoader - Load and process slash-command workflows (Sprint 3.3)
 *
 * Workflows are Markdown/text files stored in ~/.obsidian-agent/workflows/ (global).
 * They are invoked by the user typing /workflow-name at the start of a message.
 * When a workflow is matched, its content is prepended to the message as
 * explicit instructions before sending to the LLM.
 *
 * Inspired by Kilo Code's slash-commands pattern.
 */

import type { FileAdapter } from '../storage/types';

export interface WorkflowMeta {
    /** Path relative to FileAdapter root: "workflows/my-workflow.md" */
    path: string;
    /** Slug used as slash command: "my-workflow" */
    slug: string;
    /** Human-readable display name: "my workflow" */
    displayName: string;
}

export class WorkflowLoader {
    private readonly fs: FileAdapter;
    readonly workflowsDir: string;

    constructor(fs: FileAdapter) {
        this.fs = fs;
        this.workflowsDir = 'workflows';
    }

    async initialize(): Promise<void> {
        try {
            const exists = await this.fs.exists(this.workflowsDir);
            if (!exists) {
                await this.fs.mkdir(this.workflowsDir);
            }
        } catch {
            // Non-fatal
        }
    }

    /**
     * Discover all workflow files.
     */
    async discoverWorkflows(): Promise<WorkflowMeta[]> {
        try {
            const exists = await this.fs.exists(this.workflowsDir);
            if (!exists) return [];
            const listed = await this.fs.list(this.workflowsDir);
            return listed.files
                .filter((f) => f.endsWith('.md') || f.endsWith('.txt'))
                .sort()
                .map((path) => ({
                    path,
                    slug: WorkflowLoader.pathToSlug(path),
                    displayName: WorkflowLoader.displayName(path),
                }));
        } catch {
            return [];
        }
    }

    /**
     * If `text` starts with /slug (optionally followed by a space + rest-of-message),
     * load the matching workflow and prepend it as instructions.
     * Returns the transformed message, or the original text if no match.
     */
    async processSlashCommand(
        text: string,
        toggles: Record<string, boolean>,
    ): Promise<string> {
        if (!text.startsWith('/')) return text;

        // Parse /slug [rest]
        const spaceIdx = text.indexOf(' ');
        const slug = spaceIdx === -1 ? text.slice(1) : text.slice(1, spaceIdx);
        const rest = spaceIdx === -1 ? '' : text.slice(spaceIdx + 1).trim();

        if (!slug) return text;

        const workflows = await this.discoverWorkflows();
        const match = workflows.find((w) => w.slug === slug);
        if (!match) return text; // no match — pass through as-is

        // Check toggle (enabled by default)
        if (toggles[match.path] === false) return text;

        try {
            const content = await this.fs.read(match.path);
            const instructions = `<explicit_instructions type="${slug}">\n${content.trim()}\n</explicit_instructions>`;
            return rest ? `${instructions}\n\n${rest}` : instructions;
        } catch {
            return text;
        }
    }

    /**
     * Load a single workflow file's content.
     */
    async loadWorkflow(wPath: string): Promise<string> {
        return this.fs.read(wPath);
    }

    /**
     * Create a new workflow file. Returns the path.
     */
    async createWorkflow(name: string, content: string): Promise<string> {
        await this.initialize();
        const safeName = name.replace(/[^a-zA-Z0-9_ -]/g, '').trim() || 'workflow';
        const wPath = `${this.workflowsDir}/${safeName}.md`;
        await this.fs.write(wPath, content);
        return wPath;
    }

    /**
     * Delete a workflow file.
     */
    async deleteWorkflow(wPath: string): Promise<void> {
        await this.fs.remove(wPath);
    }

    /**
     * Read a workflow file's content (for UI editing).
     */
    async readFile(wPath: string): Promise<string> {
        return this.fs.read(wPath);
    }

    /**
     * Write a workflow file's content (for UI editing).
     */
    async writeFile(wPath: string, content: string): Promise<void> {
        await this.fs.write(wPath, content);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    static pathToSlug(wPath: string): string {
        const parts = wPath.split('/');
        const filename = parts[parts.length - 1] ?? wPath;
        return filename.replace(/\.(md|txt)$/, '').toLowerCase().replace(/\s+/g, '-');
    }

    static displayName(wPath: string): string {
        const parts = wPath.split('/');
        const filename = parts[parts.length - 1] ?? wPath;
        return filename.replace(/\.(md|txt)$/, '');
    }
}
