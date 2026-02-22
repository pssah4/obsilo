/**
 * SkillRegistry — Unified registry for VaultDNA plugin skills (PAS-1)
 *
 * Combines auto-discovered VaultDNA skills with user toggle settings.
 * Provides a compact system prompt section listing active plugin skills
 * so the agent knows which execute_command IDs are available.
 *
 * ADR-104: Only a compact list goes into the system prompt.
 * Full .skill.md content is read on-demand via read_file.
 */

import type { VaultDNAScanner } from './VaultDNAScanner';
import type { PluginSkillMeta } from './types';

export class SkillRegistry {
    private scanner: VaultDNAScanner;
    private skillToggles: Record<string, boolean>;

    constructor(scanner: VaultDNAScanner, skillToggles: Record<string, boolean>) {
        this.scanner = scanner;
        this.skillToggles = skillToggles;
    }

    /**
     * Get all active plugin skills (enabled + not toggled off by user).
     */
    getActivePluginSkills(): PluginSkillMeta[] {
        return this.scanner.getEnabledPluginSkills().filter(
            (s) => this.skillToggles[s.id] !== false,
        );
    }

    /**
     * Get all disabled plugin skills.
     */
    getDisabledPluginSkills(): PluginSkillMeta[] {
        return this.scanner.getDisabledPluginSkills();
    }

    /**
     * Build a compact PLUGIN SKILLS section for the system prompt.
     *
     * Lists active plugins with their commands so the agent knows
     * what execute_command IDs are available without reading .skill.md files.
     */
    getPluginSkillsPromptSection(): string {
        const active = this.getActivePluginSkills();
        if (active.length === 0) return '';

        const lines: string[] = [
            'PLUGIN SKILLS',
            '',
            'The following Obsidian plugins are active and available as skills.',
            'Use execute_command(command_id) to run any listed command.',
            'For detailed instructions, read the .skill.md file at .obsidian-agent/plugin-skills/{id}.skill.md',
            'If no plugin matches the user\'s request, use resolve_capability_gap to check for disabled plugins.',
            '',
        ];

        for (const skill of active) {
            const cmdList = skill.commands.map((c) => c.id).join(', ');
            const type = skill.source === 'core' ? 'Core' : 'Community';
            lines.push(`- ${skill.name} [${type}/${skill.classification}]: ${cmdList || '(no commands loaded)'}`);
        }

        return lines.join('\n');
    }

    /**
     * Update skill toggles (called when settings change).
     */
    updateToggles(toggles: Record<string, boolean>): void {
        this.skillToggles = toggles;
    }
}
