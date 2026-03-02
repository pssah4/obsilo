/**
 * PluginReloader
 *
 * Handles hot-reloading the plugin after a core self-modification rebuild.
 * Creates backups of main.js, writes the new bundle, and triggers
 * Obsidian's plugin disable/enable cycle.
 *
 * Part of Self-Development Phase 4: Core Self-Modification.
 */

import type ObsidianAgentPlugin from '../../main';

// ---------------------------------------------------------------------------
// PluginReloader
// ---------------------------------------------------------------------------

export class PluginReloader {
    private readonly pluginDir: string;

    constructor(private plugin: ObsidianAgentPlugin) {
        this.pluginDir = `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}`;
    }

    /**
     * Create a backup of the current main.js before overwriting.
     * Returns true if backup was created, false if main.js doesn't exist.
     */
    async createBackup(): Promise<boolean> {
        const adapter = this.plugin.app.vault.adapter;
        const mainPath = `${this.pluginDir}/main.js`;
        const backupPath = `${this.pluginDir}/main.js.bak`;

        const exists = await adapter.exists(mainPath);
        if (!exists) {
            console.warn('[PluginReloader] main.js not found, skipping backup');
            return false;
        }

        const content = await adapter.read(mainPath);
        await adapter.write(backupPath, content);
        console.debug(`[PluginReloader] Backup created: ${backupPath}`);
        return true;
    }

    /**
     * Write a new main.js to the plugin directory.
     */
    async writeBundle(compiledJs: string): Promise<void> {
        const adapter = this.plugin.app.vault.adapter;
        const mainPath = `${this.pluginDir}/main.js`;
        await adapter.write(mainPath, compiledJs);
        console.debug(`[PluginReloader] Wrote new main.js (${compiledJs.length} bytes)`);
    }

    /**
     * Reload the plugin by disabling and re-enabling it via Obsidian API.
     * Waits a brief period between disable and enable to allow cleanup.
     */
    async reload(): Promise<void> {
        const id = this.plugin.manifest.id;
        console.debug(`[PluginReloader] Reloading plugin: ${id}`);

        const plugins = (this.plugin.app as unknown as Record<string, unknown>).plugins as
            { disablePlugin(id: string): Promise<void>; enablePlugin(id: string): Promise<void> } | undefined;

        if (!plugins) {
            throw new Error('Cannot access Obsidian plugin manager for reload');
        }

        await plugins.disablePlugin(id);
        // Brief pause to allow cleanup
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
        await plugins.enablePlugin(id);

        console.debug(`[PluginReloader] Plugin reloaded successfully`);
    }

    /**
     * Roll back to the backup main.js.bak.
     * Returns true if rollback succeeded, false if no backup exists.
     */
    async rollback(): Promise<boolean> {
        const adapter = this.plugin.app.vault.adapter;
        const mainPath = `${this.pluginDir}/main.js`;
        const backupPath = `${this.pluginDir}/main.js.bak`;

        const backupExists = await adapter.exists(backupPath);
        if (!backupExists) {
            console.warn('[PluginReloader] No backup found for rollback');
            return false;
        }

        const backupContent = await adapter.read(backupPath);
        await adapter.write(mainPath, backupContent);
        console.debug('[PluginReloader] Rolled back to main.js.bak');
        return true;
    }

    /**
     * Check if a backup exists.
     */
    async hasBackup(): Promise<boolean> {
        const adapter = this.plugin.app.vault.adapter;
        return adapter.exists(`${this.pluginDir}/main.js.bak`);
    }

    /**
     * Full rebuild flow: backup → write → reload → verify.
     * If reload fails, automatically rolls back.
     */
    async deployAndReload(compiledJs: string): Promise<{ success: boolean; error?: string }> {
        try {
            // 1. Create backup
            await this.createBackup();

            // 2. Write new bundle
            await this.writeBundle(compiledJs);

            // 3. Reload plugin
            await this.reload();

            return { success: true };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`[PluginReloader] Deploy failed: ${msg}`);

            // Attempt rollback
            const rolled = await this.rollback().catch(() => false);
            if (rolled) {
                // Re-reload with the original main.js
                await this.reload().catch((re) =>
                    console.error('[PluginReloader] Rollback reload failed:', re)
                );
                return { success: false, error: `Deploy failed (rolled back): ${msg}` };
            }

            return { success: false, error: `Deploy failed (rollback unavailable): ${msg}` };
        }
    }
}
