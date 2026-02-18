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
import { GlobalModeStore } from './GlobalModeStore';

export class ModeService {
    private plugin: ObsidianAgentPlugin;
    private toolRegistry: ToolRegistry;
    /** Global modes loaded from ~/.obsidian-agent/modes.json */
    private globalModes: ModeConfig[] = [];

    constructor(plugin: ObsidianAgentPlugin, toolRegistry: ToolRegistry) {
        this.plugin = plugin;
        this.toolRegistry = toolRegistry;
    }

    /** Load global modes from disk. Call once during plugin onload. */
    async initialize(): Promise<void> {
        this.globalModes = await GlobalModeStore.loadModes();
    }

    /** Reload global modes from disk (call after add/remove/update). */
    async reloadGlobalModes(): Promise<void> {
        this.globalModes = await GlobalModeStore.loadModes();
    }

    // ---------------------------------------------------------------------------
    // Mode resolution
    // ---------------------------------------------------------------------------

    /**
     * All available modes (excl. __custom instruction entries):
     * built-in → global → vault
     */
    getAllModes(): ModeConfig[] {
        const vault = this.plugin.settings.customModes.filter(
            (m) => !m.slug.endsWith('__custom'),
        );
        return [...BUILT_IN_MODES, ...this.globalModes, ...vault];
    }

    /** Vault-only custom modes (source === 'vault'). */
    getVaultModes(): ModeConfig[] {
        return this.plugin.settings.customModes.filter(
            (m) => m.source === 'vault' && !m.slug.endsWith('__custom'),
        );
    }

    /** Global modes (loaded from ~/.obsidian-agent/modes.json). */
    getGlobalModes(): ModeConfig[] {
        return this.globalModes;
    }

    /** Get a mode by slug (built-in, global, or vault) */
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
