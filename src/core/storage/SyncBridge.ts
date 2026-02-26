/**
 * SyncBridge
 *
 * Bidirectional sync between global storage (~/.obsidian-agent/) and
 * the vault's plugin directory (.obsidian/plugins/obsilo-agent/).
 *
 * Purpose: Services read/write exclusively to global storage (via
 * GlobalFileService). The SyncBridge keeps the plugin directory in sync
 * so that Obsidian Sync can transport changes between devices.
 *
 * Lifecycle:
 *   1. pullFromVault() — on plugin load: merge newer files from vault → global
 *   2. pushToVault()   — on save/unload: copy changed global files → vault
 *
 * Conflict resolution: newer mtime wins.
 */

import type { Vault } from 'obsidian';
import type { GlobalFileService } from './GlobalFileService';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pathModule = require('path') as typeof import('path');

// ── Sync category mapping ─────────────────────────────────────────────────

interface SyncCategory {
    /** Subdirectory name in global storage (~/.obsidian-agent/{globalDir}/) */
    globalDir: string;
    /** Subdirectory name in plugin dir ({pluginDir}/{vaultDir}/) */
    vaultDir: string;
    /** Whether to recurse into subdirectories */
    recursive: boolean;
}

/**
 * Categories synced between global and vault plugin directory.
 * The vaultDir is relative to the plugin directory.
 */
const SYNC_CATEGORIES: SyncCategory[] = [
    { globalDir: 'memory', vaultDir: 'memory', recursive: true },
    { globalDir: 'history', vaultDir: 'history', recursive: false },
    { globalDir: 'logs', vaultDir: 'logs', recursive: false },
    { globalDir: 'recipes', vaultDir: 'recipes', recursive: false },
    { globalDir: 'episodes', vaultDir: 'episodes', recursive: false },
    { globalDir: 'patterns', vaultDir: 'patterns', recursive: false },
    { globalDir: 'rules', vaultDir: 'rules', recursive: false },
    { globalDir: 'workflows', vaultDir: 'workflows', recursive: false },
    { globalDir: 'skills', vaultDir: 'skills', recursive: true },
];

// Single-file entries (not directories)
const SYNC_FILES: { globalPath: string; vaultPath: string }[] = [
    { globalPath: 'pending-extractions.json', vaultPath: 'pending-extractions.json' },
];

// ── SyncBridge ────────────────────────────────────────────────────────────

export class SyncBridge {
    private readonly pluginDir: string;

    constructor(
        private readonly globalFs: GlobalFileService,
        private readonly vault: Vault,
        pluginDir: string,
    ) {
        this.pluginDir = pluginDir;
    }

    // ── Public API ────────────────────────────────────────────────────────

    /**
     * Pull newer files from vault plugin dir into global storage.
     * Called on plugin load to pick up changes arriving via Obsidian Sync.
     */
    async pullFromVault(): Promise<void> {
        for (const cat of SYNC_CATEGORIES) {
            try {
                await this.syncDirectory(
                    `${this.pluginDir}/${cat.vaultDir}`,  // source (vault)
                    cat.globalDir,                         // destination (global)
                    'vault-to-global',
                    cat.recursive,
                );
            } catch (e) {
                console.warn(`[SyncBridge] pull ${cat.globalDir} failed (non-fatal):`, e);
            }
        }
        for (const entry of SYNC_FILES) {
            try {
                await this.syncSingleFile(
                    `${this.pluginDir}/${entry.vaultPath}`,
                    entry.globalPath,
                    'vault-to-global',
                );
            } catch (e) {
                console.warn(`[SyncBridge] pull ${entry.globalPath} failed (non-fatal):`, e);
            }
        }
    }

    /**
     * Also pull from the legacy .obsidian-agent/ vault-root location
     * for rules, workflows, skills (their previous home before global storage).
     * Only used during initial migration phase.
     */
    async pullFromLegacyVaultRoot(): Promise<void> {
        const legacyMappings = [
            { vaultDir: '.obsidian-agent/rules', globalDir: 'rules', recursive: false },
            { vaultDir: '.obsidian-agent/workflows', globalDir: 'workflows', recursive: false },
            { vaultDir: '.obsidian-agent/skills', globalDir: 'skills', recursive: true },
        ];
        for (const cat of legacyMappings) {
            try {
                await this.syncDirectory(
                    cat.vaultDir,
                    cat.globalDir,
                    'vault-to-global',
                    cat.recursive,
                );
            } catch (e) {
                console.warn(`[SyncBridge] legacy pull ${cat.globalDir} failed (non-fatal):`, e);
            }
        }
    }

    /**
     * Push changed global files back to vault plugin dir.
     * Called on save and plugin unload so Obsidian Sync can pick up changes.
     */
    async pushToVault(): Promise<void> {
        for (const cat of SYNC_CATEGORIES) {
            try {
                await this.syncDirectory(
                    cat.globalDir,                         // source (global)
                    `${this.pluginDir}/${cat.vaultDir}`,   // destination (vault)
                    'global-to-vault',
                    cat.recursive,
                );
            } catch (e) {
                console.warn(`[SyncBridge] push ${cat.globalDir} failed (non-fatal):`, e);
            }
        }
        for (const entry of SYNC_FILES) {
            try {
                await this.syncSingleFile(
                    entry.globalPath,
                    `${this.pluginDir}/${entry.vaultPath}`,
                    'global-to-vault',
                );
            } catch (e) {
                console.warn(`[SyncBridge] push ${entry.globalPath} failed (non-fatal):`, e);
            }
        }
    }

    // ── Internal sync logic ───────────────────────────────────────────────

    /**
     * Sync a directory in one direction, copying only files that are newer
     * at the source than at the destination.
     */
    private async syncDirectory(
        srcDir: string,
        destDir: string,
        direction: 'vault-to-global' | 'global-to-vault',
        recursive: boolean,
    ): Promise<void> {
        // List source files
        const srcFiles = await this.listFiles(srcDir, direction === 'vault-to-global' ? 'vault' : 'global', recursive);
        if (srcFiles.length === 0) return;

        for (const srcRelFile of srcFiles) {
            // srcRelFile is relative to srcDir (e.g., "user-profile.md" or "sessions/abc.md")
            const srcFullPath = `${srcDir}/${srcRelFile}`;
            const destFullPath = `${destDir}/${srcRelFile}`;

            const srcMtime = await this.getMtime(srcFullPath, direction === 'vault-to-global' ? 'vault' : 'global');
            const destMtime = await this.getMtime(destFullPath, direction === 'vault-to-global' ? 'global' : 'vault');

            // Copy if source is newer or destination doesn't exist
            if (srcMtime > destMtime) {
                await this.copyFile(srcFullPath, destFullPath, direction);
            }
        }
    }

    /**
     * Sync a single file in one direction.
     */
    private async syncSingleFile(
        srcPath: string,
        destPath: string,
        direction: 'vault-to-global' | 'global-to-vault',
    ): Promise<void> {
        const srcSide = direction === 'vault-to-global' ? 'vault' : 'global';
        const destSide = direction === 'vault-to-global' ? 'global' : 'vault';

        const srcExists = srcSide === 'vault'
            ? await this.vault.adapter.exists(srcPath)
            : await this.globalFs.exists(srcPath);
        if (!srcExists) return;

        const srcMtime = await this.getMtime(srcPath, srcSide);
        const destMtime = await this.getMtime(destPath, destSide);

        if (srcMtime > destMtime) {
            await this.copyFile(srcPath, destPath, direction);
        }
    }

    /**
     * List all files (relative to dir) from a given side.
     */
    private async listFiles(
        dir: string,
        side: 'vault' | 'global',
        recursive: boolean,
    ): Promise<string[]> {
        const result: string[] = [];

        const dirExists = side === 'vault'
            ? await this.vault.adapter.exists(dir)
            : await this.globalFs.exists(dir);
        if (!dirExists) return result;

        const listed = side === 'vault'
            ? await this.vault.adapter.list(dir)
            : await this.globalFs.list(dir);

        // Extract relative file paths (strip dir prefix)
        for (const f of listed.files) {
            const rel = f.startsWith(dir + '/') ? f.slice(dir.length + 1) : f;
            result.push(rel);
        }

        if (recursive) {
            for (const folder of listed.folders) {
                const folderRel = folder.startsWith(dir + '/') ? folder.slice(dir.length + 1) : folder;
                const subFiles = await this.listFiles(folder, side, true);
                for (const sf of subFiles) {
                    result.push(`${folderRel}/${sf}`);
                }
            }
        }

        return result;
    }

    /**
     * Get mtime of a file. Returns 0 if file doesn't exist.
     */
    private async getMtime(filePath: string, side: 'vault' | 'global'): Promise<number> {
        if (side === 'vault') {
            try {
                const stat = await this.vault.adapter.stat(filePath);
                return stat?.mtime ?? 0;
            } catch {
                return 0;
            }
        } else {
            const stat = await this.globalFs.stat(filePath);
            return stat?.mtime ?? 0;
        }
    }

    /**
     * Copy a file from source to destination across sides.
     */
    private async copyFile(
        srcPath: string,
        destPath: string,
        direction: 'vault-to-global' | 'global-to-vault',
    ): Promise<void> {
        let content: string;

        if (direction === 'vault-to-global') {
            content = await this.vault.adapter.read(srcPath);
            await this.globalFs.write(destPath, content);
        } else {
            content = await this.globalFs.read(srcPath);
            // Ensure parent directory exists in vault
            const parentDir = destPath.substring(0, destPath.lastIndexOf('/'));
            if (parentDir) {
                const parentExists = await this.vault.adapter.exists(parentDir);
                if (!parentExists) {
                    await this.vault.adapter.mkdir(parentDir);
                }
            }
            await this.vault.adapter.write(destPath, content);
        }
    }
}
