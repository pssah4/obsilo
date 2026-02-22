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
        const disabled = this.getDisabledPluginSkills();

        if (active.length === 0 && disabled.length === 0) return '';

        const lines: string[] = [
            'PLUGIN SKILLS',
            '',
            'CRITICAL RULE: When the user names a specific plugin (e.g., "DB Folder", "Dataview",',
            '"Templater", "OneDrive Mirror"), you MUST use that plugin via execute_command.',
            'NEVER substitute a built-in tool (like create_base, write_file, etc.) for a plugin',
            'the user explicitly requested. Built-in tools and plugins are DIFFERENT things.',
            '',
            'Before using a plugin\'s commands, ALWAYS read its skill file first:',
            '  read_file(".obsidian-agent/plugin-skills/{plugin-id}.skill.md")',
            'This tells you what the plugin does, its commands, its current configuration, and how to use them.',
            '',
        ];

        // Active plugins with descriptions + commands
        if (active.length > 0) {
            lines.push('ACTIVE PLUGINS (use execute_command to run):');
            for (const skill of active) {
                const cmdList = skill.commands.map((c) => `${c.id}`).join(', ');
                const type = skill.source === 'core' ? 'Core' : 'Community';
                lines.push(`- ${skill.name} [${type}] -- ${skill.description}`);
                if (cmdList) {
                    lines.push(`  Commands: ${cmdList}`);
                }
                if (skill.needsSetup) {
                    lines.push('  [NEEDS SETUP -- read .skill.md for details]');
                }
            }
            lines.push('');
            lines.push('PLUGIN SETTINGS: Each .skill.md includes the plugin\'s current configuration');
            lines.push('under "## Current Configuration". Use this to understand how the plugin works');
            lines.push('in this vault. When settings are missing, guide the user to configure the plugin');
            lines.push('via Obsidian Settings. Do NOT guess default values -- check .skill.md first.');
            lines.push('');
        }

        // Disambiguation examples — prevent common tool confusion
        lines.push('COMMON MISTAKES TO AVOID:');
        lines.push('- WRONG: User says "DB Folder Tabelle" -> you use create_base');
        lines.push('  RIGHT: User says "DB Folder Tabelle" -> read_file(".obsidian-agent/plugin-skills/dbfolder.skill.md") then execute_command("dbfolder:create-new-database-folder")');
        lines.push('- WRONG: User says "Dataview query" -> you use query_base');
        lines.push('  RIGHT: User says "Dataview query" -> read_file(".obsidian-agent/plugin-skills/dataview.skill.md") then execute_command with Dataview commands');
        lines.push('- WRONG: User mentions a disabled plugin -> you ask the user to enable it manually');
        lines.push('  RIGHT: User mentions a disabled plugin -> you call enable_plugin(plugin_id) yourself');
        lines.push('- WRONG: User mentions a disabled plugin -> you fall back to a built-in tool');
        lines.push('  RIGHT: User mentions a disabled plugin -> enable_plugin first, then execute_command');
        lines.push('');

        // Disabled plugins — agent can enable them via enable_plugin tool
        if (disabled.length > 0) {
            lines.push('DISABLED PLUGINS (installed but not active):');
            for (const skill of disabled) {
                lines.push(`- ${skill.name} (${skill.id}) -- ${skill.description}`);
            }
            lines.push('');
            lines.push('When a disabled plugin matches the user\'s request:');
            lines.push('1. Tell the user the plugin is installed but disabled');
            lines.push('2. Call enable_plugin(plugin_id) to activate it — do NOT ask the user to enable it manually');
            lines.push('3. After enabling, read its .skill.md file to learn the available commands');
            lines.push('4. Then use execute_command to run the plugin\'s commands');
            lines.push('NEVER ask the user to manually enable a plugin. NEVER fall back to a built-in tool.');
            lines.push('ALWAYS use enable_plugin yourself, then execute_command.');
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
