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
            'CRITICAL RULE: When the user names a plugin, use the right tool for its type:',
            '- Plugin wraps CLI tool (Pandoc, Mermaid, ffmpeg, LaTeX): use execute_recipe — no UI dialog, verified output.',
            '- Plugin provides Obsidian-native commands (Templater, Daily Notes): use execute_command.',
            '- Plugin exposes JS API (Dataview, Omnisearch, MetaEdit): use call_plugin_api.',
            'For file export: prefer native Obsidian commands (execute_command) over CLI recipes (execute_recipe). Use recipes only for advanced features (custom templates, DOCX, LaTeX).',
            'NEVER substitute a built-in tool (like create_base, write_file) for a plugin the user requested.',
            '',
            'Before using a plugin, ALWAYS read its skill file first:',
            '  read_file(".obsidian-agent/plugin-skills/{plugin-id}.skill.md")',
            'This tells you what the plugin does, its commands, its configuration, and how to use it.',
            '',
        ];

        // Active plugins with descriptions + commands
        if (active.length > 0) {
            lines.push('ACTIVE PLUGINS:');
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
        lines.push('- WRONG: User says "export as PDF" -> you use execute_recipe even though file:export-to-pdf exists');
        lines.push('  RIGHT: User says "export as PDF" -> execute_command("file:export-to-pdf") -- native, zero dependencies');
        lines.push('  ALSO RIGHT: User needs custom template or DOCX -> execute_recipe("pandoc-pdf", {input, output})');
        lines.push('- WRONG: User says "DB Folder Tabelle" -> you use create_base');
        lines.push('  RIGHT: User says "DB Folder Tabelle" -> read .skill.md then execute_command("dbfolder:create-new-database-folder")');
        lines.push('- WRONG: User says "Dataview query" -> you use query_base');
        lines.push('  RIGHT: User says "Dataview query" -> use call_plugin_api("dataview", "query", ...)');
        lines.push('- WRONG: User mentions a disabled plugin -> you ask the user to enable it manually');
        lines.push('  RIGHT: User mentions a disabled plugin -> enable_plugin(plugin_id) yourself, then use the plugin');
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
            lines.push('4. Use the appropriate tool (execute_recipe for CLI tools, execute_command for native, call_plugin_api for APIs)');
            lines.push('NEVER ask the user to manually enable a plugin. NEVER fall back to a built-in tool.');
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
