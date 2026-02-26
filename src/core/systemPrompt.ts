/**
 * System Prompt Builder
 *
 * Orchestrates modular prompt sections into the final system prompt.
 * Each section is a pure function in src/core/prompts/sections/.
 *
 * Section order:
 *   1. Date/Time header
 *   2. Vault context
 *   3. Capabilities
 *   4. User memory
 *   5. Tools (filtered by mode)
 *   6. Plugin Skills (right after tools — agent sees plugins before deciding)
 *   7. Tool rules
 *   8. Tool decision guidelines
 *   9. Objective (task decomposition)
 *  10. Response format
 *  11. Explicit instructions
 *  12. Security boundary
 *  13. Mode role definition
 *  14. Custom instructions
 *  15. Skills (manual)
 *  16. Rules
 *
 * Adapted from Kilo Code's src/core/prompts/system.ts — modularized for Obsidian.
 */

import type { ModeConfig } from '../types/settings';
import { BUILT_IN_MODES } from './modes/builtinModes';
import type { McpClient } from './mcp/McpClient';
import {
    getDateTimeSection,
    getVaultContextSection,
    getCapabilitiesSection,
    getMemorySection,
    getToolsSection,
    getToolRulesSection,
    getToolDecisionGuidelinesSection,
    getObjectiveSection,
    getResponseFormatSection,
    getExplicitInstructionsSection,
    getSecurityBoundarySection,
    getModeDefinitionSection,
    getCustomInstructionsSection,
    getPluginSkillsSection,
    getSkillsSection,
    getRulesSection,
} from './prompts/sections';

/**
 * Build the system prompt for a given mode.
 *
 * @param mode - The active ModeConfig
 * @param allModes - Unused, kept for API compatibility.
 * @param globalCustomInstructions - User's global instructions applied to every mode.
 * @param includeTime - When true, inject current date and time into the context.
 * @param rulesContent - Combined content of all enabled rule files.
 * @param skillsSection - XML block listing relevant skills for this message.
 * @param mcpClient - MCP client for dynamic tool listing.
 * @param allowedMcpServers - Per-mode MCP server whitelist.
 * @param memoryContext - Pre-built memory context string.
 * @param pluginSkillsSection - Compact plugin skills list from VaultDNA.
 * @param isSubtask - When true, build a leaner prompt for sub-agents (omits response format, skills, custom instructions).
 * @param recipesSection - Pre-matched procedural recipes for the current user message.
 */
export function buildSystemPromptForMode(
    mode: ModeConfig,
    allModes?: ModeConfig[],
    globalCustomInstructions?: string,
    includeTime?: boolean,
    rulesContent?: string,
    skillsSection?: string,
    mcpClient?: McpClient,
    allowedMcpServers?: string[],
    memoryContext?: string,
    pluginSkillsSection?: string,
    isSubtask = false,
    webEnabled?: boolean,
    recipesSection?: string,
): string {
    const sections: string[] = [
        // 1. Date/time + 2. Vault context (combined at top)
        getDateTimeSection(includeTime) + getVaultContextSection(),

        // 3. Capabilities (high-level summary)
        getCapabilitiesSection(webEnabled),

        // 4. User memory (conditional — omit for subtasks, parent already applied)
        isSubtask ? '' : getMemorySection(memoryContext),

        // 5. Tools (filtered by mode — subtasks get compact descriptions without examples)
        getToolsSection(mode.toolGroups, mcpClient, allowedMcpServers, webEnabled, !isSubtask),

        // 6. Plugin Skills — right after tools so agent sees plugins before planning
        getPluginSkillsSection(pluginSkillsSection),

        // 6.5. Procedural Recipes — between plugins and rules (ADR-017)
        // Agent sees tools → plugins → how to combine them → rules
        (isSubtask || !recipesSection) ? '' : recipesSection,

        // 7. Tool rules
        getToolRulesSection(),
        '',

        // 8. Tool decision guidelines
        getToolDecisionGuidelinesSection(),
        '',

        // 9. Objective (task decomposition)
        getObjectiveSection(),
        '',

        // 10. Response format (omit for subtasks — output goes to parent, not user)
        isSubtask ? '' : getResponseFormatSection(),
        '',

        // 11. Explicit instructions
        getExplicitInstructionsSection(),

        // 12. Security boundary
        getSecurityBoundarySection(),

        // 13. Mode role definition
        getModeDefinitionSection(mode),

        // 14. Custom instructions (omit for subtasks — parent handles orchestration)
        isSubtask ? '' : getCustomInstructionsSection(globalCustomInstructions, mode.customInstructions),

        // 15. Skills — manual (omit for subtasks)
        isSubtask ? '' : getSkillsSection(skillsSection),

        // 16. Rules (conditional)
        getRulesSection(rulesContent),
    ];

    // Filter empty strings from conditional sections, then join
    return sections.filter(Boolean).join('\n');
}

/**
 * Legacy builder — accepts a mode slug string.
 * Used as fallback if ModeConfig is not available.
 */
export function buildSystemPrompt(mode: string): string {
    const modeConfig = BUILT_IN_MODES.find((m) => m.slug === mode)
        ?? BUILT_IN_MODES[0];
    return buildSystemPromptForMode(modeConfig, BUILT_IN_MODES);
}
