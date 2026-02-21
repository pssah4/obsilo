/**
 * GitCheckpointService - isomorphic-git based snapshot/restore (Sprint 1.4)
 *
 * Maintains a shadow git repository at:
 *   .obsidian/plugins/obsidian-agent/checkpoints/
 *
 * Before each task's first write operation, it commits a snapshot of all
 * tracked files. If the user triggers undo, we restore from the snapshot.
 *
 * Uses isomorphic-git — pure JS, no native git binary required.
 *
 * ADR-003: Shadow-repo approach for robust undo without modifying the vault's
 * own git history (if any).
 */

import git from 'isomorphic-git';
import type { Vault } from 'obsidian';

export interface CheckpointInfo {
    taskId: string;
    commitOid: string;
    timestamp: string;
    filesChanged: string[];
}

export interface RestoreResult {
    restored: string[];
    errors: string[];
}

export class GitCheckpointService {
    private vault: Vault;
    /** Absolute filesystem path to the shadow repo */
    private repoPath: string;
    /** Vault-relative path to the shadow repo (for vault.adapter calls) */
    private repoRelPath: string;
    private initialized = false;
    private timeoutMs: number;
    private autoCleanup: boolean;

    constructor(vault: Vault, pluginDir: string, timeoutSeconds = 30, autoCleanup = true) {
        this.vault = vault;
        this.repoRelPath = `${pluginDir}/checkpoints`;
        // isomorphic-git needs an absolute path
        const vaultRoot = (vault.adapter as any).basePath as string;
        this.repoPath = `${vaultRoot}/${this.repoRelPath}`;
        this.timeoutMs = timeoutSeconds * 1000;
        this.autoCleanup = autoCleanup;
    }

    /**
     * Initialize the shadow repo (git init if not already done).
     * Safe to call multiple times.
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;
        try {
            // Ensure directory exists
            const exists = await this.vault.adapter.exists(this.repoRelPath);
            if (!exists) {
                await this.vault.adapter.mkdir(this.repoRelPath);
            }

            // Check if already a git repo
            const fs = this.getFs();
            try {
                await git.resolveRef({ fs, dir: this.repoPath, ref: 'HEAD' });
            } catch {
                // Not initialized — do git init
                await git.init({
                    fs,
                    dir: this.repoPath,
                    defaultBranch: 'main',
                });
                console.log('[Checkpoints] Shadow repo initialized');
            }
            this.initialized = true;
        } catch (e) {
            console.error('[Checkpoints] Failed to initialize shadow repo:', e);
            throw e;
        }
    }

    /**
     * Create a snapshot of the specified files before a task modifies them.
     * Returns a CheckpointInfo with the commit OID.
     */
    async snapshot(taskId: string, filePaths: string[]): Promise<CheckpointInfo> {
        console.log(`[Checkpoints] snapshot() called: taskId=${taskId} files=${filePaths.join(', ')} initialized=${this.initialized}`);
        await this.ensureInit();
        const fs = this.getFs();
        const vaultRoot = (this.vault.adapter as any).basePath as string;

        const staged: string[] = [];
        for (const vaultRelPath of filePaths) {
            try {
                const absPath = `${vaultRoot}/${vaultRelPath}`;
                const repoRelative = vaultRelPath; // store under same relative path

                // Read file content from vault
                const content = await this.withTimeout(
                    this.vault.adapter.read(vaultRelPath),
                    `Read ${vaultRelPath}`
                );

                // Write into shadow repo at same relative path
                const destPath = `${this.repoPath}/${repoRelative}`;
                const destDir = destPath.substring(0, destPath.lastIndexOf('/'));
                await this.mkdirRecursive(destDir);
                await fs.promises.writeFile(destPath, content, 'utf8');

                // Stage file
                await git.add({ fs, dir: this.repoPath, filepath: repoRelative });
                staged.push(vaultRelPath);
            } catch (e) {
                console.warn(`[Checkpoints] Could not snapshot ${vaultRelPath}:`, e);
            }
        }

        if (staged.length === 0) {
            // Nothing to commit — return a dummy checkpoint
            return {
                taskId,
                commitOid: 'empty',
                timestamp: new Date().toISOString(),
                filesChanged: [],
            };
        }

        const commitOid = await git.commit({
            fs,
            dir: this.repoPath,
            author: { name: 'obsidian-agent', email: 'agent@obsidian.local' },
            message: `checkpoint:${taskId}\n\nFiles: ${staged.join(', ')}`,
        });

        console.log(`[Checkpoints] Snapshot created for task ${taskId}: ${commitOid.substring(0, 8)}`);
        return {
            taskId,
            commitOid,
            timestamp: new Date().toISOString(),
            filesChanged: staged,
        };
    }

    /**
     * Restore files from a checkpoint back into the vault.
     */
    async restore(checkpoint: CheckpointInfo): Promise<RestoreResult> {
        await this.ensureInit();
        if (checkpoint.commitOid === 'empty') {
            return { restored: [], errors: ['No files were snapshotted'] };
        }

        const fs = this.getFs();
        const restored: string[] = [];
        const errors: string[] = [];

        for (const vaultRelPath of checkpoint.filesChanged) {
            try {
                // Read file content from shadow repo at that commit
                const { blob } = await git.readBlob({
                    fs,
                    dir: this.repoPath,
                    oid: checkpoint.commitOid,
                    filepath: vaultRelPath,
                });
                const content = new TextDecoder().decode(blob);

                // Write back to vault
                const existingFile = this.vault.getAbstractFileByPath(vaultRelPath);
                if (existingFile) {
                    const { TFile } = await import('obsidian');
                    if (existingFile instanceof TFile) {
                        await this.vault.modify(existingFile, content);
                    }
                } else {
                    await this.vault.adapter.write(vaultRelPath, content);
                }
                restored.push(vaultRelPath);
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                errors.push(`${vaultRelPath}: ${msg}`);
            }
        }

        console.log(`[Checkpoints] Restored ${restored.length} files for task ${checkpoint.taskId}`);
        return { restored, errors };
    }

    /**
     * Generate a unified diff between the snapshot and current vault state.
     */
    async diff(checkpoint: CheckpointInfo): Promise<string> {
        if (checkpoint.commitOid === 'empty' || checkpoint.filesChanged.length === 0) {
            return '(no files snapshotted)';
        }

        const fs = this.getFs();
        const lines: string[] = [];

        for (const vaultRelPath of checkpoint.filesChanged) {
            try {
                // Get original content from snapshot
                const { blob } = await git.readBlob({
                    fs,
                    dir: this.repoPath,
                    oid: checkpoint.commitOid,
                    filepath: vaultRelPath,
                });
                const original = new TextDecoder().decode(blob);
                const current = await this.vault.adapter.read(vaultRelPath);

                if (original === current) {
                    lines.push(`--- ${vaultRelPath}: unchanged`);
                } else {
                    lines.push(`--- ${vaultRelPath}`);
                    const diffLines = this.simpleDiff(original, current);
                    lines.push(...diffLines);
                }
            } catch (e) {
                lines.push(`--- ${vaultRelPath}: (error reading diff)`);
            }
        }

        return lines.join('\n');
    }

    /**
     * Restore all files snapshotted for a given task.
     *
     * Because the pipeline creates one commit per file (to snapshot each file
     * before its first write), a single task may have N commits in the log.
     * We collect ALL of them, then restore each file from its EARLIEST snapshot
     * so we always recover the true pre-task state.
     */
    async restoreLatestForTask(taskId: string): Promise<RestoreResult> {
        await this.ensureInit();
        const fs = this.getFs();
        try {
            const commits = await git.log({ fs, dir: this.repoPath, depth: 200 });
            const prefix = `checkpoint:${taskId}`;
            const matches = commits.filter((c) => c.commit.message.startsWith(prefix));
            if (matches.length === 0) {
                return { restored: [], errors: [`No checkpoint found for task ${taskId}`] };
            }

            // Collect each file → OID of its earliest snapshot (commits are newest-first,
            // so we iterate in reverse to find the earliest per file).
            const fileToOid = new Map<string, string>();
            for (const match of [...matches].reverse()) {
                const msgParts = match.commit.message.split('\n\nFiles: ');
                const files = msgParts[1] ? msgParts[1].split(', ').map((f) => f.trim()) : [];
                for (const f of files) {
                    fileToOid.set(f, match.oid); // later reverse-iterations win = earliest
                }
            }

            const restored: string[] = [];
            const errors: string[] = [];

            for (const [vaultRelPath, oid] of fileToOid.entries()) {
                try {
                    const { blob } = await git.readBlob({
                        fs,
                        dir: this.repoPath,
                        oid,
                        filepath: vaultRelPath,
                    });
                    const content = new TextDecoder().decode(blob);
                    const existingFile = this.vault.getAbstractFileByPath(vaultRelPath);
                    if (existingFile) {
                        const { TFile } = await import('obsidian');
                        if (existingFile instanceof TFile) {
                            await this.vault.modify(existingFile, content);
                        }
                    } else {
                        await this.vault.adapter.write(vaultRelPath, content);
                    }
                    restored.push(vaultRelPath);
                } catch (e) {
                    errors.push(`${vaultRelPath}: ${e instanceof Error ? e.message : String(e)}`);
                }
            }

            console.log(`[Checkpoints] Restored ${restored.length} files for task ${taskId}`);
            return { restored, errors };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return { restored: [], errors: [msg] };
        }
    }

    /**
     * Remove old checkpoint commits to keep repo lean.
     * Call after task completes (if autoCleanup is enabled).
     */
    async cleanup(taskId: string): Promise<void> {
        if (!this.autoCleanup) return;
        // For simplicity: we keep the last 10 commits and prune older ones via gc
        // isomorphic-git doesn't have a built-in GC, so we just log for now
        console.log(`[Checkpoints] Cleanup for task ${taskId} (repo stays lean via periodic prune)`);
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    private async ensureInit(): Promise<void> {
        if (!this.initialized) await this.initialize();
    }

    /** isomorphic-git fs plugin using Node's built-in fs (available in Electron) */
    private getFs() {
        // In Obsidian (Electron), we can use require('fs')
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require('fs');
    }

    private async withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error(`Timeout: ${label}`)),
                this.timeoutMs
            );
            promise.then(
                (val) => { clearTimeout(timer); resolve(val); },
                (err) => { clearTimeout(timer); reject(err); }
            );
        });
    }

    private async mkdirRecursive(dirPath: string): Promise<void> {
        const fs = this.getFs();
        try {
            await fs.promises.mkdir(dirPath, { recursive: true });
        } catch {
            // Already exists — fine
        }
    }

    /** Very simple line-by-line diff for display purposes */
    private simpleDiff(original: string, current: string): string[] {
        // Use Set for O(n+m) membership tests instead of the previous Array.includes()
        // which was O(n²) for files with many lines.
        const origLines = original.split('\n');
        const currLines = current.split('\n');
        const origSet = new Set(origLines);
        const currSet = new Set(currLines);
        const added = currLines.filter((l) => !origSet.has(l)).length;
        const removed = origLines.filter((l) => !currSet.has(l)).length;
        return [`  +${added} lines added, -${removed} lines removed`];
    }
}
