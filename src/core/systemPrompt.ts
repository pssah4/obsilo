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
 *   6. Tool rules
 *   7. Tool decision guidelines
 *   8. Objective (task decomposition)
 *   9. Response format
 *  10. Explicit instructions
 *  11. Security boundary
 *  12. Mode role definition
 *  13. Custom instructions
 *  14. Skills
 *  15. Rules
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
): string {
    const sections: string[] = [
        // 1. Date/time + 2. Vault context (combined at top)
        getDateTimeSection(includeTime) + getVaultContextSection(),

        // 3. Capabilities (high-level summary)
        getCapabilitiesSection(),

        // 4. User memory (conditional)
        getMemorySection(memoryContext),

        // 5. Tools (filtered by mode)
        getToolsSection(mode.toolGroups, mcpClient, allowedMcpServers),

        // 6. Tool rules
        getToolRulesSection(),
        '',

        // 7. Tool decision guidelines
        getToolDecisionGuidelinesSection(),
        '',

        // 8. Objective (task decomposition)
        getObjectiveSection(),
        '',

        // 9. Response format
        getResponseFormatSection(),
        '',

        // 10. Explicit instructions
        getExplicitInstructionsSection(),

        // 11. Security boundary
        getSecurityBoundarySection(),

        // 12. Mode role definition
        getModeDefinitionSection(mode),

        // 13. Custom instructions (conditional)
        getCustomInstructionsSection(globalCustomInstructions, mode.customInstructions),

        // 14. Skills (conditional)
        getSkillsSection(skillsSection),

        // 15. Rules (conditional)
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
