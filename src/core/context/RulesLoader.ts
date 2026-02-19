/**
 * RulesLoader - Load user-defined rules into the system prompt (Sprint 3.2)
 *
 * Rules are Markdown/text files stored in {vault}/.obsidian-agent/rules/
 * Each rule file can be toggled on/off in Settings → Agent Behaviour → Rules.
 * Enabled rules are injected as a RULES section at the bottom of the system prompt.
 *
 * Inspired by Kilo Code's src/core/context/instructions/ pattern.
 */

import type { Vault } from 'obsidian';

export class RulesLoader {
    private readonly vault: Vault;
    readonly rulesDir: string;

    constructor(vault: Vault) {
        this.vault = vault;
        this.rulesDir = '.obsidian-agent/rules';
    }

    /**
     * Ensure the rules directory exists (create if needed).
     */
    async initialize(): Promise<void> {
        try {
            const exists = await this.vault.adapter.exists(this.rulesDir);
            if (!exists) {
                await this.vault.adapter.mkdir(this.rulesDir);
            }
        } catch {
            // Non-fatal — will create on first write
        }
    }

    /**
     * Discover all rule files in the rules directory.
     * Returns full vault-relative paths (e.g. ".obsidian-agent/rules/my-rule.md").
     */
    async discoverRules(): Promise<string[]> {
        try {
            const exists = await this.vault.adapter.exists(this.rulesDir);
            if (!exists) return [];
            const listed = await this.vault.adapter.list(this.rulesDir);
            return listed.files
                .filter((f) => f.endsWith('.md') || f.endsWith('.txt'))
                .sort();
        } catch {
            return [];
        }
    }

    /**
     * Load all enabled rule files into a combined string.
     * A rule is enabled if `toggles[path]` is not explicitly `false`.
     * (New rules default to enabled.)
     */
    async loadEnabledRules(toggles: Record<string, boolean>): Promise<string> {
        const paths = await this.discoverRules();
        const parts: string[] = [];
        for (const rPath of paths) {
            if (toggles[rPath] === false) continue;
            try {
                const content = await this.vault.adapter.read(rPath);
                if (content.trim()) {
                    // M-3: Limit per-file size to prevent injection of huge system-prompt payloads
                    const limited = content.length > 50_000 ? content.slice(0, 50_000) : content;
                    parts.push(limited.trim());
                }
            } catch {
                // Skip files that can't be read
            }
        }
        return parts.join('\n\n');
    }

    /**
     * Create a new rule file. Returns the path of the created file.
     */
    async createRule(name: string, content: string): Promise<string> {
        await this.initialize();
        const safeName = name.replace(/[^a-zA-Z0-9\-_ ]/g, '').trim() || 'rule';
        const rPath = `${this.rulesDir}/${safeName}.md`;
        await this.vault.adapter.write(rPath, content);
        return rPath;
    }

    /**
     * Delete a rule file.
     */
    async deleteRule(rPath: string): Promise<void> {
        await this.vault.adapter.remove(rPath);
    }

    /**
     * Extract the display name from a rule path (filename without extension).
     */
    static displayName(rPath: string): string {
        const parts = rPath.split('/');
        const filename = parts[parts.length - 1] ?? rPath;
        return filename.replace(/\.(md|txt)$/, '');
    }
}
