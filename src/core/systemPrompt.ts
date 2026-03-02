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
 * Configuration for building the system prompt.
 * Replaces 15+ positional parameters with a structured config object.
 */
export interface SystemPromptConfig {
    mode: ModeConfig;
    globalCustomInstructions?: string;
    includeTime?: boolean;
    rulesContent?: string;
    skillsSection?: string;
    mcpClient?: McpClient;
    allowedMcpServers?: string[];
    memoryContext?: string;
    pluginSkillsSection?: string;
    isSubtask?: boolean;
    webEnabled?: boolean;
    recipesSection?: string;
    configDir: string;
    selfAuthoredSkillsSection?: string;
}

/**
 * Build the system prompt for a given mode.
 *
 * Accepts either a SystemPromptConfig object (preferred) or positional
 * parameters (legacy, kept for backwards compatibility during migration).
 */
export function buildSystemPromptForMode(config: SystemPromptConfig): string;
/** @deprecated Use the config object overload instead. */
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
    isSubtask?: boolean,
    webEnabled?: boolean,
    recipesSection?: string,
    configDir?: string,
    selfAuthoredSkillsSection?: string,
): string;
export function buildSystemPromptForMode(
    configOrMode: SystemPromptConfig | ModeConfig,
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
    configDir?: string,
    selfAuthoredSkillsSection?: string,
): string {
    // Normalize: if first arg has 'slug' and 'toolGroups', it's a ModeConfig (legacy call)
    // If it has 'mode' property, it's a SystemPromptConfig
    let mode: ModeConfig;
    if ('mode' in configOrMode && 'slug' in configOrMode.mode!) {
        // Config object form
        const cfg = configOrMode;
        mode = cfg.mode;
        globalCustomInstructions = cfg.globalCustomInstructions;
        includeTime = cfg.includeTime;
        rulesContent = cfg.rulesContent;
        skillsSection = cfg.skillsSection;
        mcpClient = cfg.mcpClient;
        allowedMcpServers = cfg.allowedMcpServers;
        memoryContext = cfg.memoryContext;
        pluginSkillsSection = cfg.pluginSkillsSection;
        isSubtask = cfg.isSubtask ?? false;
        webEnabled = cfg.webEnabled;
        recipesSection = cfg.recipesSection;
        configDir = cfg.configDir;
        selfAuthoredSkillsSection = cfg.selfAuthoredSkillsSection;
    } else {
        // Legacy positional form
        mode = configOrMode as ModeConfig;
    }
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

        // 6.6. Self-Authored Skills — agent-created workflow skills
        (isSubtask || !selfAuthoredSkillsSection) ? '' : `SELF-AUTHORED SKILLS\n\nThe following skills are available. When a user message matches a skill trigger, use its instructions.\nTo manage skills: use the manage_skill tool.\n\n${selfAuthoredSkillsSection}`,

        // 7. Tool rules
        getToolRulesSection(),
        '',

        // 8. Tool decision guidelines
        getToolDecisionGuidelinesSection(configDir!),
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

