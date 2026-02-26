/**
 * GlobalModeStore
 *
 * Persists modes that should be available across ALL Obsidian vaults.
 * Storage: ~/.obsidian-agent/modes.json (via GlobalFileService).
 */

import type { ModeConfig } from '../../types/settings';
import { GlobalFileService } from '../storage/GlobalFileService';

const MODES_FILE = 'modes.json';

/** Shared GlobalFileService instance (lazy-initialized). */
let _globalFs: GlobalFileService | null = null;
function getFs(): GlobalFileService {
    if (!_globalFs) _globalFs = new GlobalFileService();
    return _globalFs;
}

/** Allow injecting a GlobalFileService (e.g. from plugin onload). */
export function setGlobalModeStoreFs(fs: GlobalFileService): void {
    _globalFs = fs;
}

export const GlobalModeStore = {
    /** Read all global modes. Returns [] if file is missing or unparseable. */
    async loadModes(): Promise<ModeConfig[]> {
        try {
            const fs = getFs();
            const exists = await fs.exists(MODES_FILE);
            if (!exists) return [];
            const raw = await fs.read(MODES_FILE);
            // M-1: Validate size before parsing — reject absurdly large files
            if (raw.length > 500_000) return [];
            let parsed: unknown;
            try {
                parsed = JSON.parse(raw);
            } catch {
                return [];
            }
            if (!Array.isArray(parsed)) return [];
            return parsed.filter(
                (m): m is ModeConfig =>
                    m !== null &&
                    typeof m === 'object' &&
                    typeof (m as any).slug === 'string' &&
                    typeof (m as any).name === 'string' &&
                    typeof (m as any).roleDefinition === 'string',
            );
        } catch {
            return [];
        }
    },

    /** Overwrite the full list of global modes. */
    async saveModes(modes: ModeConfig[]): Promise<void> {
        const fs = getFs();
        await fs.write(
            MODES_FILE,
            JSON.stringify(
                modes.map((m) => ({ ...m, source: 'global' as const })),
                null,
                2,
            ),
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
