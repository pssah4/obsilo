/**
 * CapabilityGapResolver — 3-stage gap resolution (PAS-1)
 *
 * When the agent cannot find a suitable tool or skill, this component
 * checks if a disabled or previously installed plugin could help.
 *
 * ADR-106: Implemented as TypeScript component (not prompt instruction)
 * for deterministic, testable behavior.
 *
 * Stages:
 *   1. Active skills — keyword match against enabled plugins
 *   2. Disabled plugins — keyword match against disabled but installed
 *   3. Archived / not found — check previously installed, then honest gap
 */

import type { VaultDNAScanner } from './VaultDNAScanner';
import type { VaultDNAEntry } from './types';

export type GapResult =
    | { found: 'active-skill'; skillId: string; skillName: string; message: string }
    | { found: 'disabled-plugin'; pluginId: string; pluginName: string; message: string }
    | { found: 'archived'; pluginId: string; pluginName: string; message: string }
    | { found: false; message: string };

export class CapabilityGapResolver {
    private scanner: VaultDNAScanner;

    constructor(scanner: VaultDNAScanner) {
        this.scanner = scanner;
    }

    resolve(capability: string, _context?: string): GapResult {
        const keywords = this.extractKeywords(capability);
        const dna = this.scanner.getVaultDNA();

        if (!dna || keywords.length === 0) {
            return {
                found: false,
                message: `No plugin match found for "${capability}". The user may need to install a community plugin via Obsidian Settings > Community Plugins.`,
            };
        }

        // Stage 1: Active skills (enabled + FULL/PARTIAL)
        const active = dna.plugins.filter(
            (p) => p.status === 'enabled' && p.classification !== 'NONE',
        );
        const activeMatch = this.findMatch(active, keywords);
        if (activeMatch) {
            return {
                found: 'active-skill',
                skillId: activeMatch.id,
                skillName: activeMatch.name,
                message: `Plugin "${activeMatch.name}" is active and available as a skill. Read its .skill.md at .obsidian-agent/plugin-skills/${activeMatch.id}.skill.md for command details, then use execute_command.`,
            };
        }

        // Stage 2: Disabled but installed plugins
        const disabled = dna.plugins.filter(
            (p) => p.status === 'disabled' && p.classification !== 'NONE',
        );
        const disabledMatch = this.findMatch(disabled, keywords);
        if (disabledMatch) {
            return {
                found: 'disabled-plugin',
                pluginId: disabledMatch.id,
                pluginName: disabledMatch.name,
                message: `Plugin "${disabledMatch.name}" is installed but currently disabled. It may help with this task. Ask the user if they want to enable it in Obsidian Settings.`,
            };
        }

        // Stage 3: Archived (previously installed)
        const archived = dna.archived ?? [];
        const archivedMatch = this.findMatch(archived, keywords);
        if (archivedMatch) {
            return {
                found: 'archived',
                pluginId: archivedMatch.id,
                pluginName: archivedMatch.name,
                message: `Plugin "${archivedMatch.name}" was previously installed but has been removed. The user could reinstall it via Obsidian Settings > Community Plugins.`,
            };
        }

        // No match at all
        return {
            found: false,
            message: `No installed plugin matches the capability "${capability}". The user may need to install a community plugin via Obsidian Settings > Community Plugins.`,
        };
    }

    private findMatch(entries: VaultDNAEntry[], keywords: string[]): VaultDNAEntry | null {
        for (const entry of entries) {
            const text = `${entry.id} ${entry.name}`.toLowerCase();
            if (keywords.some((k) => text.includes(k))) return entry;
        }
        return null;
    }

    private extractKeywords(text: string): string[] {
        return (text.toLowerCase().match(/\b\w{3,}\b/g) ?? []);
    }
}
