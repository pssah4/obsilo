/**
 * GlobalModeStore
 *
 * Persists modes that should be available across ALL Obsidian vaults.
 * Storage: ~/.obsidian-agent/modes.json (outside any vault).
 * Uses Node.js fs/os/path available in Obsidian's Electron runtime.
 */

import type { ModeConfig } from '../../types/settings';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fsModule = require('fs') as typeof import('fs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const osModule = require('os') as typeof import('os');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pathModule = require('path') as typeof import('path');

const GLOBAL_DIR = pathModule.join(osModule.homedir(), '.obsidian-agent');
const GLOBAL_MODES_FILE = pathModule.join(GLOBAL_DIR, 'modes.json');

export const GlobalModeStore = {
    /** Read all global modes. Returns [] if file is missing or unparseable. */
    async loadModes(): Promise<ModeConfig[]> {
        try {
            await fsModule.promises.mkdir(GLOBAL_DIR, { recursive: true });
            const raw = await fsModule.promises.readFile(GLOBAL_MODES_FILE, 'utf-8');
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed.filter(
                (m): m is ModeConfig =>
                    typeof m?.slug === 'string' && typeof m?.name === 'string',
            );
        } catch {
            return [];
        }
    },

    /** Overwrite the full list of global modes. */
    async saveModes(modes: ModeConfig[]): Promise<void> {
        await fsModule.promises.mkdir(GLOBAL_DIR, { recursive: true });
        await fsModule.promises.writeFile(
            GLOBAL_MODES_FILE,
            JSON.stringify(
                modes.map((m) => ({ ...m, source: 'global' as const })),
                null,
                2,
            ),
            'utf-8',
        );
    },

    /** Append a single mode (sets source to 'global'). */
    async addMode(mode: ModeConfig): Promise<void> {
        const existing = await this.loadModes();
        existing.push({ ...mode, source: 'global' });
        await this.saveModes(existing);
    },

    /** Remove a mode by slug. */
    async removeMode(slug: string): Promise<void> {
        const existing = await this.loadModes();
        await this.saveModes(existing.filter((m: ModeConfig) => m.slug !== slug));
    },

    /** Update a mode in-place (matched by slug). */
    async updateMode(updated: ModeConfig): Promise<void> {
        const existing = await this.loadModes();
        const idx = existing.findIndex((m: ModeConfig) => m.slug === updated.slug);
        if (idx >= 0) existing[idx] = { ...updated, source: 'global' };
        else existing.push({ ...updated, source: 'global' });
        await this.saveModes(existing);
    },
};
