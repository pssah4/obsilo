/**
 * GlobalFileService
 *
 * FileAdapter implementation backed by Node.js `fs` at ~/.obsidian-agent/.
 * Used by all services whose data is shared across vaults (memory, history,
 * rules, workflows, skills, recipes, episodes, logs, etc.).
 *
 * Pattern follows GlobalModeStore (same require-based Node.js access
 * available in Obsidian's Electron runtime).
 */

import type { FileAdapter } from './types';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fsModule = require('fs') as typeof import('fs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const osModule = require('os') as typeof import('os');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pathModule = require('path') as typeof import('path');

const GLOBAL_DIR_NAME = '.obsidian-agent';

export class GlobalFileService implements FileAdapter {
    private readonly root: string;

    constructor() {
        this.root = pathModule.join(osModule.homedir(), GLOBAL_DIR_NAME);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /** Resolve a relative path to an absolute path under the root. */
    resolvePath(relativePath: string): string {
        return pathModule.join(this.root, relativePath);
    }

    /** Return the root directory path (~/.obsidian-agent/). */
    getRoot(): string {
        return this.root;
    }

    // ── FileAdapter implementation ───────────────────────────────────────────

    async exists(p: string): Promise<boolean> {
        try {
            await fsModule.promises.access(this.resolvePath(p));
            return true;
        } catch {
            return false;
        }
    }

    async read(p: string): Promise<string> {
        return fsModule.promises.readFile(this.resolvePath(p), 'utf-8');
    }

    async write(p: string, data: string): Promise<void> {
        const abs = this.resolvePath(p);
        // Ensure parent directory exists
        await fsModule.promises.mkdir(pathModule.dirname(abs), { recursive: true });
        await fsModule.promises.writeFile(abs, data, 'utf-8');
    }

    async mkdir(p: string): Promise<void> {
        await fsModule.promises.mkdir(this.resolvePath(p), { recursive: true });
    }

    async list(p: string): Promise<{ files: string[]; folders: string[] }> {
        const abs = this.resolvePath(p);
        try {
            const entries = await fsModule.promises.readdir(abs, { withFileTypes: true });
            const files: string[] = [];
            const folders: string[] = [];
            for (const entry of entries) {
                // Return paths relative to the adapter root (matching Obsidian convention)
                const relPath = p ? `${p}/${entry.name}` : entry.name;
                if (entry.isDirectory()) {
                    folders.push(relPath);
                } else {
                    files.push(relPath);
                }
            }
            return { files: files.sort(), folders: folders.sort() };
        } catch (err: any) {
            if (err?.code === 'ENOENT') {
                return { files: [], folders: [] };
            }
            throw err;
        }
    }

    async remove(p: string): Promise<void> {
        const abs = this.resolvePath(p);
        const stat = await fsModule.promises.stat(abs).catch(() => null);
        if (!stat) return;
        if (stat.isDirectory()) {
            await fsModule.promises.rm(abs, { recursive: true, force: true });
        } else {
            await fsModule.promises.unlink(abs);
        }
    }

    async append(p: string, data: string): Promise<void> {
        const abs = this.resolvePath(p);
        // Ensure parent directory exists
        await fsModule.promises.mkdir(pathModule.dirname(abs), { recursive: true });
        await fsModule.promises.appendFile(abs, data, 'utf-8');
    }

    async stat(p: string): Promise<{ mtime: number; size: number } | null> {
        try {
            const s = await fsModule.promises.stat(this.resolvePath(p));
            return { mtime: s.mtimeMs, size: s.size };
        } catch {
            return null;
        }
    }
}
