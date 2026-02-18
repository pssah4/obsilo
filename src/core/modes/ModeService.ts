/**
 * ModeService — Central authority for mode resolution and tool access
 *
 * Provides:
 * - Active mode lookup (built-in first, then custom)
 * - Tool name expansion from tool groups
 * - Filtered tool definitions per mode
 */

import type ObsidianAgentPlugin from '../../main';
import type { ModeConfig, ToolGroup } from '../../types/settings';
import type { ToolRegistry } from '../tools/ToolRegistry';
import type { ToolDefinition } from '../tools/types';
import { BUILT_IN_MODES, TOOL_GROUP_MAP, expandToolGroups } from './builtinModes';

export class ModeService {
    private plugin: ObsidianAgentPlugin;
    private toolRegistry: ToolRegistry;

    constructor(plugin: ObsidianAgentPlugin, toolRegistry: ToolRegistry) {
        this.plugin = plugin;
        this.toolRegistry = toolRegistry;
    }

    // ---------------------------------------------------------------------------
    // Mode resolution
    // ---------------------------------------------------------------------------

    /** All available modes: built-in first, then custom */
    getAllModes(): ModeConfig[] {
        return [...BUILT_IN_MODES, ...this.plugin.settings.customModes];
    }

    /** Get a mode by slug (built-in or custom) */
    getMode(slug: string): ModeConfig | undefined {
        return this.getAllModes().find((m) => m.slug === slug);
    }

    /** Get the currently active mode; falls back to 'librarian' */
    getActiveMode(): ModeConfig {
        const slug = this.plugin.settings.currentMode;
        return this.getMode(slug) ?? BUILT_IN_MODES.find((m) => m.slug === 'librarian')!;
    }

    /** Check whether a given slug is a valid mode */
    isValidMode(slug: string): boolean {
        return this.getAllModes().some((m) => m.slug === slug);
    }

    // ---------------------------------------------------------------------------
    // Tool access
    // ---------------------------------------------------------------------------

    /** Get the expanded list of tool names for a mode */
    getToolNames(mode: ModeConfig): string[] {
        return expandToolGroups(mode.toolGroups);
    }

    /** Get ToolDefinitions filtered to what a mode is allowed to use */
    getToolDefinitions(mode: ModeConfig): ToolDefinition[] {
        const allowed = new Set(this.getToolNames(mode));
        return this.toolRegistry
            .getAllTools()
            .filter((t) => allowed.has(t.name))
            .map((t) => t.getDefinition());
    }

    /** Check whether a mode has access to a specific tool */
    modeHasTool(mode: ModeConfig, toolName: string): boolean {
        return this.getToolNames(mode).includes(toolName);
    }

    /** Check whether a mode has access to a specific tool group */
    modeHasGroup(mode: ModeConfig, group: ToolGroup): boolean {
        return mode.toolGroups.includes(group);
    }

    // ---------------------------------------------------------------------------
    // Mode switching (persists to settings)
    // ---------------------------------------------------------------------------

    async switchMode(slug: string): Promise<ModeConfig | null> {
        const mode = this.getMode(slug);
        if (!mode) return null;
        this.plugin.settings.currentMode = slug;
        await this.plugin.saveSettings();
        return mode;
    }
}
