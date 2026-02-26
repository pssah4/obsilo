/**
 * GlobalMigrationService
 *
 * One-time migration from per-vault storage to global storage (~/.obsidian-agent/).
 * Copies data files from the vault's plugin directory to the global directory.
 *
 * Strategy:
 * - First vault: copy all data to global (cold start)
 * - Subsequent vaults: merge — newer mtime wins for individual files
 * - Sets `_globalStorageMigrated` flag in data.json so migration runs only once per vault
 *
 * ADR-020: Global Storage Architecture
 */

import type { Vault } from 'obsidian';
import type { GlobalFileService } from './GlobalFileService';

// ---------------------------------------------------------------------------
// Categories to migrate from plugin dir to global
// ---------------------------------------------------------------------------

const MIGRATE_DIRS = [
    'memory',
    'history',
    'logs',
    'recipes',
    'episodes',
    'patterns',
];

/** Files in the old vault-root .obsidian-agent/ location */
const MIGRATE_VAULT_ROOT_DIRS = [
    'rules',
    'workflows',
    'skills',
];

const MIGRATE_FILES = [
    'pending-extractions.json',
];

// ---------------------------------------------------------------------------
// GlobalMigrationService
// ---------------------------------------------------------------------------

export class GlobalMigrationService {
    constructor(
        private globalFs: GlobalFileService,
        private vault: Vault,
        private pluginDir: string,
    ) {}

    /**
     * Run the one-time migration if not already done.
     * @returns true if migration was performed, false if skipped
     */
    async migrateIfNeeded(migrated: boolean | undefined): Promise<boolean> {
        if (migrated) return false;

        console.log('[GlobalMigration] Starting one-time migration to global storage...');
        let migratedCount = 0;

        // Migrate directories from plugin dir (memory, history, logs, etc.)
        for (const dir of MIGRATE_DIRS) {
            const vaultPath = `${this.pluginDir}/${dir}`;
            const count = await this.migrateDirectory(vaultPath, dir);
            migratedCount += count;
        }

        // Migrate directories from vault-root .obsidian-agent/ (rules, workflows, skills)
        for (const dir of MIGRATE_VAULT_ROOT_DIRS) {
            const vaultPath = `.obsidian-agent/${dir}`;
            const count = await this.migrateDirectory(vaultPath, dir);
            migratedCount += count;
        }

        // Migrate individual files
        for (const file of MIGRATE_FILES) {
            const vaultPath = `${this.pluginDir}/${file}`;
            const migrated = await this.migrateFile(vaultPath, file);
            if (migrated) migratedCount++;
        }

        console.log(`[GlobalMigration] Migration complete: ${migratedCount} files copied`);
        return true;
    }

    /**
     * Migrate all files in a vault directory to the global directory.
     * Uses newer-mtime-wins strategy for conflict resolution.
     */
    private async migrateDirectory(vaultDir: string, globalDir: string): Promise<number> {
        let count = 0;
        try {
            const exists = await this.vault.adapter.exists(vaultDir);
            if (!exists) return 0;

            // Ensure target directory exists
            const globalDirExists = await this.globalFs.exists(globalDir);
            if (!globalDirExists) {
                await this.globalFs.mkdir(globalDir);
            }

            const listing = await this.vault.adapter.list(vaultDir);

            // Migrate files
            for (const filePath of listing.files) {
                const relativeName = filePath.slice(vaultDir.length + 1); // strip dir prefix + /
                if (!relativeName) continue;
                const globalPath = `${globalDir}/${relativeName}`;

                try {
                    const copied = await this.copyIfNewer(filePath, globalPath);
                    if (copied) count++;
                } catch (e) {
                    console.warn(`[GlobalMigration] Failed to migrate ${filePath}:`, e);
                }
            }

            // Recurse into subdirectories
            for (const subDir of listing.folders) {
                const subName = subDir.slice(vaultDir.length + 1);
                if (!subName) continue;
                const subCount = await this.migrateDirectory(subDir, `${globalDir}/${subName}`);
                count += subCount;
            }
        } catch (e) {
            console.warn(`[GlobalMigration] Failed to migrate directory ${vaultDir}:`, e);
        }
        return count;
    }

    /**
     * Migrate a single file from vault to global.
     */
    private async migrateFile(vaultPath: string, globalPath: string): Promise<boolean> {
        try {
            const exists = await this.vault.adapter.exists(vaultPath);
            if (!exists) return false;
            return await this.copyIfNewer(vaultPath, globalPath);
        } catch (e) {
            console.warn(`[GlobalMigration] Failed to migrate file ${vaultPath}:`, e);
            return false;
        }
    }

    /**
     * Copy a file from vault to global if the vault version is newer
     * or the global version doesn't exist yet.
     */
    private async copyIfNewer(vaultPath: string, globalPath: string): Promise<boolean> {
        const vaultStat = await this.vault.adapter.stat(vaultPath);
        if (!vaultStat) return false;

        const globalStat = await this.globalFs.stat(globalPath);
        if (globalStat && globalStat.mtime >= vaultStat.mtime) {
            return false; // global is same or newer — skip
        }

        const content = await this.vault.adapter.read(vaultPath);
        await this.globalFs.write(globalPath, content);
        return true;
    }
}
