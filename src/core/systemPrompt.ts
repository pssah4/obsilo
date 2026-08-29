/**
 * System Prompt Builder
 *
 * Orchestrates modular prompt sections into the final system prompt.
 * Each section is a pure function in src/core/prompts/sections/.
 *
 * Section order (ADR-062: KV-Cache-Optimized):
 *
 * STABLE (cached across iterations):
 *   1. Mode definition
 *   2. Capabilities
 *   3. Obsidian conventions
 *   4. Tools (filtered by mode, largest stable block)
 *   5. Tool routing (rules + guidelines)
 *   6. Objective
 *   7. Response format
 *   8. Security boundary
 *   8b. Skill Directory (ADR-116 / FEAT-24-09 — name+description per skill;
 *       full body loaded on demand via the read_skill tool)
 *   ── CACHE BREAKPOINT ──
 * DYNAMIC (can change per message/session):
 *   9. Plugin Skills
 *  10. User memory
 *  11. Procedural Recipes
 *  12. Custom instructions + Rules
 *  13. Explicit instructions
 *  14. Vault context
 *  15. DateTime (MUST be last -- timestamp invalidates cache)
 *
 * Adapted from Kilo Code's src/core/prompts/system.ts — modularized for Obsidian.
 */

import type { ModeConfig } from '../types/settings';
import type { McpClient } from './mcp/McpClient';
import { capSection, TAIL_SECTION_CAPS } from './prompts/sections/sectionCaps';
import {
    getDateTimeSection,
    getVaultContextSection,
    getCapabilitiesSection,
    getMemorySection,
    getToolsSection,
    getToolRoutingSection,
    getObjectiveSection,
    getResponseFormatSection,
    getExplicitInstructionsSection,
    getSecurityBoundarySection,
    getModeDefinitionSection,
    getCustomInstructionsSection,
    getPluginSkillsSection,
    getSkillDirectorySection,
    getRulesSection,
    getObsidianConventionsSection,
    getCostAwareHeuristicsSection,
    getCostAwareHeuristicsSectionLean,
    getPluginSkillsSectionLean,
} from './prompts/sections';

/**
 * ADR-62 amendment (FEAT-24-01): a real sentinel line that splits the system
 * prompt into the cacheable prefix (sections 1-8) and the volatile tail
 * (sections 9-17, e.g. memory / active skills / vault context / date). Providers
 * with an explicit cache marker (Anthropic `cache_control`, Bedrock `cachePoint`)
 * put the marker only on the prefix; the tail gets no marker. The line is unique,
 * appears on its own line, and is stripped before the prompt is sent.
 *
 * Until 2026-05-12 the "CACHE BREAKPOINT" was only a code comment in this file
 * (never in the rendered string), so the marker landed on the whole prompt incl.
 * the volatile tail -> cache miss + re-write on every call (RESEARCH-36 Befund A).
 */
export const CACHE_BREAKPOINT_MARKER = '<<<OBSILO_CACHE_BREAKPOINT>>>';

/**
 * Split a rendered system prompt at {@link CACHE_BREAKPOINT_MARKER}. Returns the
 * cacheable prefix and the volatile tail with the marker line removed. If the
 * marker is absent (legacy prompt, subtask), `stable` is the whole prompt and
 * `volatile` is empty — callers then fall back to marking the whole thing.
 */
export function splitSystemPromptAtCacheBreakpoint(prompt: string): { stable: string; volatile: string } {
    // AUDIT-2026-08-28 L-1 (CWE-74, OWASP LLM01:2025): match the sentinel as a
    // full LINE, and clean any remaining occurrence out of both halves.
    //
    // This used to be a plain indexOf, which let untrusted content decide where
    // the cache boundary sits. Traced path: a skill name/description is
    // untrusted (AgentSidebarView marks it so), `sanitizeDirectoryEntry` only
    // defangs its BOUNDARY_TAG_RE allowlist and lets this sentinel through, and
    // the skill directory renders ABOVE the real marker -- so an injected copy
    // was found first and moved the split.
    //
    // Line anchoring closes that vector completely rather than narrowing it:
    // `sanitizeDirectoryEntry` collapses newlines to spaces, so an injected
    // marker can never occupy a line of its own. The extra strip covers the
    // leftovers, so no consumer has to think about it -- this one function is
    // the choke point all five provider paths go through.
    const match = markerLineRe().exec(prompt);
    if (!match) return { stable: stripAllMarkers(prompt), volatile: '' };
    const stable = stripAllMarkers(prompt.slice(0, match.index)).replace(/\n+$/, '\n');
    const volatile = stripAllMarkers(prompt.slice(match.index + match[0].length)).replace(/^\n+/, '\n');
    return { stable, volatile };
}

/** Escape the marker for use inside a RegExp, so the constant stays the source. */
function escapeForRegExp(literal: string): string {
    return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The sentinel as its own line, which is exactly how the section list emits it
 * (own array element, joined by newlines). Built fresh per call because a shared
 * global-flagged RegExp carries lastIndex between calls.
 */
function markerLineRe(): RegExp {
    return new RegExp(`^[ \\t]*${escapeForRegExp(CACHE_BREAKPOINT_MARKER)}[ \\t]*$`, 'm');
}

/** Remove every occurrence of the sentinel, line-anchored or inline. */
function stripAllMarkers(text: string): string {
    if (!text.includes(CACHE_BREAKPOINT_MARKER)) return text;
    return text.split(CACHE_BREAKPOINT_MARKER).join('');
}

/**
 * D1: remove the sentinel for a wire that has no marker slot for it.
 *
 * The comment above {@link CACHE_BREAKPOINT_MARKER} promised the line is
 * stripped before send, but only the two caching branches that call
 * {@link splitSystemPromptAtCacheBreakpoint} ever removed it. Every other path
 * forwarded it verbatim: the OpenAI-shape system message, the Responses-API
 * `instructions` field, and both adapters whenever prompt caching was off. A
 * sentinel the format cannot carry is a stray instruction to the model.
 *
 * Use this wherever the prompt goes out WITHOUT being split. Where it is
 * split, the split already removed the marker and this must not run again.
 */
export function stripCacheBreakpointMarker(prompt: string): string {
    if (!prompt.includes(CACHE_BREAKPOINT_MARKER)) return prompt;
    // AUDIT-2026-08-28 L-1: EVERY occurrence, not just the first. The old
    // version removed one and reported success, so a second (injected) copy
    // reached the model while the marker-absence suite stayed green on its clean
    // fixture. The split below already strips both halves; deriving from it
    // keeps the two functions from drifting apart on the edge cases (trailing
    // newlines, an empty volatile tail).
    const { stable, volatile } = splitSystemPromptAtCacheBreakpoint(prompt);
    return volatile.trim().length > 0 ? `${stable}${volatile}` : stable.replace(/\n+$/, '\n');
}

/**
 * Configuration for building the system prompt.
 * Replaces 15+ positional parameters with a structured config object.
 */
export interface SystemPromptConfig {
    mode: ModeConfig;
    globalCustomInstructions?: string;
    includeTime?: boolean;
    rulesContent?: string;
    /**
     * FEAT-24-09 / ADR-116: stable skill directory (name + description per
     * installed skill, plus inventory lines for self-authored skills). Lives
     * above the cache breakpoint. Replaces the per-message-classified
     * `skillsSection` and the dynamic `selfAuthoredSkillsSection`.
     */
    skillDirectorySection?: string;
    mcpClient?: McpClient;
    allowedMcpServers?: string[];
    memoryContext?: string;
    pluginSkillsSection?: string;
    isSubtask?: boolean;
    webEnabled?: boolean;
    recipesSection?: string;
    configDir: string;
    /**
     * FEAT-24-04 / ADR-113: when set, REPLACES `mode.roleDefinition` in
     * Section 1 so a profile-spawned subagent gets a lean role line
     * instead of the inherited mode role. Only set by spawnSubtask when
     * `new_task` was called with `profile='...'`.
     */
    subagentRoleOverride?: string;
    /**
     * FEAT-24-04 / ADR-113: when set, the TOOLS section is rendered for
     * exactly this allowlist (subset of `mode.toolGroups`). Keeps the
     * subagent's tool surface as small as the profile demands.
     */
    subagentAllowedTools?: string[];
    /**
     * EPIC-26 / FEAT-26-01 / ADR-120: when true AND `consult_flagship` is
     * available, injects a single-line reminder AFTER the cache breakpoint
     * marker. Triggered by the AgentTask when consecutiveMistakes >= 2 so
     * the agent considers escalating instead of looping on the same
     * mistake.
     */
    consultFlagshipReminderActive?: boolean;
    /**
     * EPIC-26 / FEAT-26-01: marks that the active tool schema contains
     * `consult_flagship`. Used together with `consultFlagshipReminderActive`
     * so the reminder is silent on installs that have no flagship slot.
     */
    consultFlagshipAvailable?: boolean;
    /**
     * EPIC-26 / FEAT-26-06: render the lean variant of cost-heuristics
     * (~500 tokens vs the full ~1435). Active when the task runs on the
     * mid tier without an explicit flagship override. Falls back to the
     * full variant when not set (backwards-compat for subtask spawns and
     * tests that build a prompt without the EPIC-26 plumbing).
     */
    costHeuristicsLean?: boolean;
    /**
     * EPIC-26 / FEAT-26-06: render the lean variant of plugin-skills
     * (~30 tokens vs the full ~5000). Active when no plugin-skill tool
     * has been invoked yet in this task and the user message has no
     * `@`-plugin-mention. Falls back to full on miss.
     */
    pluginSkillsLean?: boolean;
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
    skillDirectorySection?: string,
    mcpClient?: McpClient,
    allowedMcpServers?: string[],
    memoryContext?: string,
    pluginSkillsSection?: string,
    isSubtask?: boolean,
    webEnabled?: boolean,
    recipesSection?: string,
    configDir?: string,
): string;
export function buildSystemPromptForMode(
    configOrMode: SystemPromptConfig | ModeConfig,
    allModes?: ModeConfig[],
    globalCustomInstructions?: string,
    includeTime?: boolean,
    rulesContent?: string,
    skillDirectorySection?: string,
    mcpClient?: McpClient,
    allowedMcpServers?: string[],
    memoryContext?: string,
    pluginSkillsSection?: string,
    isSubtask = false,
    webEnabled?: boolean,
    recipesSection?: string,
    configDir?: string,
): string {
    // Normalize: if first arg has 'slug' and 'toolGroups', it's a ModeConfig (legacy call)
    // If it has 'mode' property, it's a SystemPromptConfig
    let mode: ModeConfig;
    let subagentRoleOverride: string | undefined;
    let subagentAllowedTools: string[] | undefined;
    let consultFlagshipReminderActive = false;
    let consultFlagshipAvailable = false;
    let costHeuristicsLean = false;
    let pluginSkillsLean = false;
    if ('mode' in configOrMode && 'slug' in configOrMode.mode) {
        // Config object form
        const cfg = configOrMode;
        mode = cfg.mode;
        globalCustomInstructions = cfg.globalCustomInstructions;
        includeTime = cfg.includeTime;
        rulesContent = cfg.rulesContent;
        skillDirectorySection = cfg.skillDirectorySection;
        mcpClient = cfg.mcpClient;
        allowedMcpServers = cfg.allowedMcpServers;
        memoryContext = cfg.memoryContext;
        pluginSkillsSection = cfg.pluginSkillsSection;
        isSubtask = cfg.isSubtask ?? false;
        webEnabled = cfg.webEnabled;
        recipesSection = cfg.recipesSection;
        configDir = cfg.configDir;
        subagentRoleOverride = cfg.subagentRoleOverride;
        subagentAllowedTools = cfg.subagentAllowedTools;
        consultFlagshipReminderActive = cfg.consultFlagshipReminderActive ?? false;
        consultFlagshipAvailable = cfg.consultFlagshipAvailable ?? false;
        costHeuristicsLean = cfg.costHeuristicsLean ?? false;
        pluginSkillsLean = cfg.pluginSkillsLean ?? false;
    } else {
        // Legacy positional form
        mode = configOrMode as ModeConfig;
    }
    // ADR-062: KV-Cache-Optimized Section Order
    // STABLE sections first (cached by KV-cache across iterations),
    // DYNAMIC sections after the breakpoint (change per message/session).
    // A single changed token in the prefix invalidates the entire cache.
    // Reference: Manus Context Engineering (2025)
    const sections: string[] = [
        // ── STABLE (cached, does not change within a task session) ──────
        // 1. Mode role definition (or subagent profile override -- FEAT-24-04 / ADR-113)
        getModeDefinitionSection(mode, subagentRoleOverride),

        // 1b. ADR-090: Cost-Aware Agent Heuristics (plan-first, tool tiers,
        //     anti-overthinking, sub-agent gating, error recovery, stop
        //     condition, budget awareness). Placed early so the agent reads
        //     the cost rules BEFORE the tool catalogue.
        // EPIC-26 / FEAT-26-06: lean variant on auto-mode mid-tier loops
        // (~500 tokens). Decided at task start; cache-stable per task.
        costHeuristicsLean
            ? getCostAwareHeuristicsSectionLean()
            : getCostAwareHeuristicsSection(),

        // 2. Capabilities (compact summary)
        getCapabilitiesSection(webEnabled),

        // 3. Obsidian conventions (central, not mode-specific)
        getObsidianConventionsSection(),

        // 4. Tools (filtered by mode -- compact form by default, ~1.5k tokens.
        //    Full docs via find_tool(name). ADR-090 Lever 8.
        //    FEAT-24-04 / ADR-113: subagent profile narrows the allowlist further.
        getToolsSection(mode.toolGroups, mcpClient, allowedMcpServers, webEnabled, false, subagentAllowedTools),

        // 5. Tool Routing (merged rules + guidelines)
        getToolRoutingSection(configDir!),

        // 6. Objective (task decomposition)
        getObjectiveSection(),

        // 7. Response format (omit for subtasks)
        isSubtask ? '' : getResponseFormatSection(),

        // 8. Security boundary
        getSecurityBoundarySection(),

        // 8b. Skill Directory (ADR-116 / FEAT-24-09) — stable, cached.
        // Lists every installed skill (name + description, plus inventory
        // lines for self-authored skills). The model loads the full body
        // on demand via the read_skill tool; the body lives in the message
        // stream and falls under microcompaction (FEAT-24-02). Subtasks
        // skip skills entirely (same as the old behaviour).
        //
        // FIX-29-03-03: dieses Weglassen spart Token, kostete aber auch das
        // Inventar des Skills, um dessentwillen der Subtask überhaupt läuft.
        // Der bleibt jetzt nicht mehr ahnungslos: InvokeSkillTool legt die
        // Inventarzeilen genau dieses einen Skills in die Subtask-Nachricht
        // (skillInventoryRenderer). Das Verzeichnis bleibt hier draußen.
        isSubtask ? '' : getSkillDirectorySection(skillDirectorySection),

        // ── CACHE BREAKPOINT ────────────────────────────────────────────
        // Real sentinel line (ADR-62 amendment / FEAT-24-01). Providers with an
        // explicit cache marker put it ONLY on everything ABOVE this line; the
        // volatile tail below gets no marker. The line is stripped before send.
        CACHE_BREAKPOINT_MARKER,

        // 8c. EPIC-26 / ADR-120: advisor reminder. Below the cache marker so
        // toggling it on/off does not invalidate the stable prefix.
        (consultFlagshipReminderActive && consultFlagshipAvailable && !isSubtask)
            ? '[Advisor Hint] You have had repeated failures. If this problem needs deeper synthesis (architecture / subtle bug / ambiguous spec), consider one consult_flagship call. Budget: 3 per task.'
            : '',

        // 9. Plugin Skills (can change when plugins are enabled/disabled)
        // EPIC-26 / FEAT-26-06: lean ~30-token replacement when no plugin
        // skill has been invoked in this task; flips to full once usage
        // is observed (AgentTask `recentPluginSkillUsage` + @-mention).
        // IMP-41-01-03: tail sections are capped at assembly time so a
        // bloated section cannot dominate the uncached per-turn cost.
        pluginSkillsLean
            ? getPluginSkillsSectionLean()
            : capSection(getPluginSkillsSection(pluginSkillsSection), TAIL_SECTION_CAPS.pluginSkills),

        // 10. User memory (changes across sessions)
        isSubtask ? '' : capSection(getMemorySection(memoryContext), TAIL_SECTION_CAPS.memory),

        // 11. Procedural Recipes (ADR-017, matched per message)
        (isSubtask || !recipesSection) ? '' : capSection(recipesSection, TAIL_SECTION_CAPS.recipes),

        // 12. Custom instructions + Rules (user-defined, can change)
        isSubtask ? '' : capSection(
            getCustomInstructionsSection(globalCustomInstructions, mode.customInstructions),
            TAIL_SECTION_CAPS.customInstructions,
        ),
        capSection(getRulesSection(rulesContent), TAIL_SECTION_CAPS.rules),

        // 13. Explicit instructions
        getExplicitInstructionsSection(),

        // 14. Vault context (file structure can change between tasks)
        capSection(getVaultContextSection(), TAIL_SECTION_CAPS.vaultContext),

        // 15. DateTime — MUST be last (timestamp invalidates KV-cache!)
        getDateTimeSection(includeTime),
    ];

    // Token-budget diagnostics: log a section-level char breakdown so the
    // user can see WHICH section dominates the system prompt. ~4 chars
    // per token is a usable rule of thumb (Anthropic / OpenAI tokenisers
    // are close enough for ranking purposes). Disabled when the result
    // is small to avoid noise on subtask prompts.
    const labels = [
        'mode', 'cost-heuristics', 'capabilities', 'obsidian-conv', 'tools', 'tool-routing',
        'objective', 'response-format', 'security', 'skill-directory', 'cache-breakpoint',
        'advisor-hint', 'plugin-skills', 'memory', 'recipes',
        'custom-instructions', 'rules',
        'explicit-instructions', 'vault-context', 'datetime',
    ];
    const merged = sections.filter(Boolean).join('\n');
    if (merged.length > 20_000) {
        const breakdown: Array<{ section: string; chars: number; approxTokens: number }> = [];
        for (let i = 0; i < sections.length; i++) {
            const chars = sections[i]?.length ?? 0;
            if (chars === 0) continue;
            breakdown.push({ section: labels[i] ?? `s${i}`, chars, approxTokens: Math.round(chars / 4) });
        }
        breakdown.sort((a, b) => b.chars - a.chars);
        const totalTok = Math.round(merged.length / 4);
        const top = breakdown.slice(0, 8).map(b => `${b.section}=${b.approxTokens}`).join(' ');
        console.debug(
            `[SystemPrompt] ${merged.length} chars (~${totalTok} tokens). ` +
            `Top sections: ${top}`,
        );
    }
    return merged;
}

