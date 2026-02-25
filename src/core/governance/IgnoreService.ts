/**
 * IgnoreService - File access governance (Sprint 1.6)
 *
 * Reads `.obsidian-agentignore` (gitignore syntax) and `.obsidian-agentprotected`
 * from the vault root to control which paths the agent can access.
 *
 * - Ignored paths: not accessible at all (like .gitignore)
 * - Protected paths: accessible for reading but NEVER writable (even with approval)
 *
 * Always blocks: .obsidian/ internals (except plugin files), .git/
 */

import type { Vault } from 'obsidian';

export class IgnoreService {
    private vault: Vault;
    private ignorePatterns: string[] = [];
    private protectedPatterns: string[] = [];
    private loaded = false;

    /** Paths always blocked regardless of config */
    private static readonly ALWAYS_BLOCKED: string[] = [
        '.git/',
        '.obsidian/workspace',
        '.obsidian/workspace.json',
        '.obsidian/cache',
    ];

    /** Paths always write-protected regardless of config */
    private static readonly ALWAYS_PROTECTED: string[] = [
        '.obsidian-agentignore',
        '.obsidian-agentprotected',
    ];

    constructor(vault: Vault) {
        this.vault = vault;
    }

    /**
     * Load (or reload) ignore and protected patterns from vault root files.
     * Called at plugin start and can be re-called if files change.
     */
    async load(): Promise<void> {
        this.ignorePatterns = await this.readPatternFile('.obsidian-agentignore');
        this.protectedPatterns = await this.readPatternFile('.obsidian-agentprotected');
        this.loaded = true;
    }

    /**
     * Check if a path is completely blocked (agent cannot access it at all).
     * Returns true if the path should be denied.
     */
    isIgnored(path: string): boolean {
        if (!this.loaded) return true; // fail-closed: deny all until rules are loaded
        const normalPath = this.normalize(path);

        // Always-blocked paths
        for (const blocked of IgnoreService.ALWAYS_BLOCKED) {
            if (normalPath === blocked || normalPath.startsWith(blocked)) return true;
        }

        // User-defined ignore patterns
        return this.matchesAnyPattern(normalPath, this.ignorePatterns);
    }

    /**
     * Check if a path is protected from writing.
     * Protected paths can be read but never written/deleted/moved.
     */
    isProtected(path: string): boolean {
        if (!this.loaded) return true; // fail-closed: protect all until rules are loaded
        const normalPath = this.normalize(path);

        // Always-protected governance files
        for (const p of IgnoreService.ALWAYS_PROTECTED) {
            if (normalPath === p) return true;
        }

        // User-defined protected patterns
        return this.matchesAnyPattern(normalPath, this.protectedPatterns);
    }

    /**
     * Get user-facing description of why a path is blocked.
     */
    getDenialReason(path: string): string {
        if (this.isProtected(path)) {
            return `"${path}" is protected (.obsidian-agentprotected). Cannot write to protected files.`;
        }
        if (this.isIgnored(path)) {
            return `"${path}" is excluded (.obsidian-agentignore). Add it to the ignore list to allow access.`;
        }
        return `"${path}" is blocked by system defaults.`;
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    private async readPatternFile(filename: string): Promise<string[]> {
        try {
            const file = this.vault.getAbstractFileByPath(filename);
            if (!file) return [];
            const content = await this.vault.adapter.read(filename);
            return content
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => line.length > 0 && !line.startsWith('#'));
        } catch {
            return [];
        }
    }

    private normalize(path: string): string {
        // Remove leading slash, normalize separators
        return path.replace(/\\/g, '/').replace(/^\//, '');
    }

    /**
     * Minimal gitignore-style pattern matching:
     * - `*` matches any characters except `/`
     * - `**` matches anything including `/`
     * - Trailing `/` means directory match
     * - Leading `!` means negation (not yet supported — skip)
     */
    private matchesAnyPattern(path: string, patterns: string[]): boolean {
        for (const pattern of patterns) {
            if (pattern.startsWith('!')) continue; // negation not supported yet
            if (this.matchPattern(path, pattern)) return true;
        }
        return false;
    }

    private matchPattern(path: string, pattern: string): boolean {
        // Normalize pattern
        let p = pattern.replace(/\\/g, '/').replace(/^\//, '');

        // Directory pattern: "folder/" matches "folder/anything"
        if (p.endsWith('/')) {
            return path.startsWith(p) || path === p.slice(0, -1);
        }

        // M-2: Reject pathologically long or complex patterns to prevent ReDoS
        if (p.length > 200) return false;
        if (/(\*\*){3,}/.test(p)) return false;

        // Convert glob to regex (escape backslashes first to prevent double-escaping)
        const regexStr = p
            .replace(/\\/g, '\\\\') // escape backslashes first
            .replace(/\./g, '\\.') // escape dots
            .replace(/\*\*/g, '§DOUBLESTAR§')
            .replace(/\*/g, '[^/]*')
            .replace(/§DOUBLESTAR§/g, '.*');

        try {
            // Pattern without slash: match basename or full path
            if (!p.includes('/')) {
                const basenameRegex = new RegExp(`(^|/)${regexStr}($|/)`);
                return basenameRegex.test(path);
            }
            // Pattern with slash: match from root
            const fullRegex = new RegExp(`^${regexStr}($|/)`);
            return fullRegex.test(path);
        } catch {
            // Invalid regex — fall back to exact match
            return path === p || path.startsWith(p + '/');
        }
    }
}
