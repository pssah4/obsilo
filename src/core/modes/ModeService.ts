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
     *
     * Vault entries with a slug matching a built-in are treated as overrides:
     * the vault version REPLACES the built-in in the returned list so that
     * user customisations are visible to the agent loop.
     */
    getAllModes(): ModeConfig[] {
        const vault = this.plugin.settings.customModes.filter(
            (m) => !m.slug.endsWith('__custom'),
        );
        // Vault overrides of built-in slugs take priority over the built-in definition
        const overriddenSlugs = new Set(vault.map((m) => m.slug));
        const effectiveBuiltIns = BUILT_IN_MODES.filter((m) => !overriddenSlugs.has(m.slug));
        return [...effectiveBuiltIns, ...this.globalModes, ...vault];
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

    /** Get the currently active mode; falls back to 'ask' if the saved slug no longer exists */
    getActiveMode(): ModeConfig {
        const slug = this.plugin.settings.currentMode;
        return this.getMode(slug) ?? BUILT_IN_MODES.find((m) => m.slug === 'ask')!;
    }

    /** Check whether a given slug is a valid mode */
    isValidMode(slug: string): boolean {
        return this.getAllModes().some((m) => m.slug === slug);
    }

    // ---------------------------------------------------------------------------
    // Tool access
    // ---------------------------------------------------------------------------

    /** Get the raw expanded list of all tool names for a mode's groups (no overrides) */
    getToolNames(mode: ModeConfig): string[] {
        return expandToolGroups(mode.toolGroups);
    }

    /**
     * Get the effective list of tool names for a mode, applying overrides in priority order:
     *   1. settings.modeToolOverrides[slug] (permanent user override)
     *   2. All tools in the mode's groups (default)
     *
     * The result is always filtered to tools actually in the mode's groups.
     */
    getEffectiveToolNames(mode: ModeConfig): string[] {
        const allInGroups = new Set(expandToolGroups(mode.toolGroups));
        const override = this.plugin.settings.modeToolOverrides?.[mode.slug];
        if (override && override.length > 0) {
            // Intersect with group-allowed tools (never escalate beyond what the mode allows)
            return override.filter((t) => allInGroups.has(t));
        }
        return [...allInGroups];
    }

    /** Get ToolDefinitions filtered to the effective tool set for a mode */
    getToolDefinitions(mode: ModeConfig): ToolDefinition[] {
        const allowed = new Set(this.getEffectiveToolNames(mode));
        // Remove web tools from the definition set when web tools are disabled.
        // This prevents the LLM from calling them and hitting error loops.
        const webDisabled = !this.plugin.settings.webTools?.enabled;
        if (webDisabled) {
            allowed.delete('web_search');
            allowed.delete('web_fetch');
        }
        return this.toolRegistry
            .getAllTools()
            .filter((t) => allowed.has(t.name))
            .map((t) => t.getDefinition());
    }

    /** Check whether a mode has access to a specific tool (respects overrides) */
    modeHasTool(mode: ModeConfig, toolName: string): boolean {
        return this.getEffectiveToolNames(mode).includes(toolName);
    }

    /**
     * Permanently set the tool override for a mode.
     * Pass an empty array or undefined to clear the override (restore defaults).
     */
    async setModeToolOverride(slug: string, tools: string[]): Promise<void> {
        if (!this.plugin.settings.modeToolOverrides) {
            this.plugin.settings.modeToolOverrides = {};
        }
        if (tools.length === 0) {
            delete this.plugin.settings.modeToolOverrides[slug];
        } else {
            this.plugin.settings.modeToolOverrides[slug] = tools;
        }
        await this.plugin.saveSettings();
    }

    /** Check whether a mode has access to a specific tool group */
    modeHasGroup(mode: ModeConfig, group: ToolGroup): boolean {
        return mode.toolGroups.includes(group);
    }

    /** Check whether web tools are enabled in settings */
    isWebEnabled(): boolean {
        return this.plugin.settings.webTools?.enabled === true;
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
