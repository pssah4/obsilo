# FEATURE: Modular System Prompt Architecture

**Status:** Implemented
**Source:** `src/core/systemPrompt.ts` (orchestrator), `src/core/prompts/sections/` (15 section modules)

## Summary

The system prompt is the single most important piece of text in Obsilo — it shapes every agent response. Previously, the entire prompt (~300 lines of inline constants + builder logic) lived in a monolithic `systemPrompt.ts`. This feature decomposes it into 15 independent section modules, each a pure function returning a string. The orchestrator (`buildSystemPromptForMode`) assembles them in a defined order.

Additionally, two new prompt sections were added that were missing from the original implementation:
- **Objective** — task decomposition strategy (how the agent breaks down and executes multi-step tasks)
- **Capabilities** — high-level summary of what the agent can do (gives the model a self-model)

Both sections are adapted from Kilo Code's equivalent (`src/core/prompts/sections/objective.ts` and `capabilities.ts`).

## Motivation

### Problem
1. **Monolithic file**: All prompt content and assembly logic in one 300+ line file made it hard to find, review, or modify individual sections.
2. **No separation of concerns**: Static content (vault context description), dynamic content (tool listing), and conditional content (memory, skills, rules) were all interleaved.
3. **Missing prompt engineering**: Kilo Code's prompt has Objective (task decomposition strategy) and Capabilities (self-model) sections. Obsilo's original prompt lacked both, leading to less structured agent behavior on complex tasks.
4. **Cross-cutting redundancy**: Tool descriptions were duplicated between the system prompt and the UI's ToolPickerPopover (addressed separately in FEATURE-tool-metadata-registry.md).

### Solution
Extract each logical section into a pure function in `src/core/prompts/sections/`. The orchestrator imports all sections and assembles them in order. Adding, removing, or reordering sections is now a one-line change in the orchestrator.

## Architecture

### Section Order (15 sections)

| # | Section | File | Conditional |
|---|---------|------|-------------|
| 1 | Date/Time header | `dateTime.ts` | `includeTime` param |
| 2 | Vault context | `vaultContext.ts` | No (always) |
| 3 | Capabilities | `capabilities.ts` | No (always) |
| 4 | User memory | `memory.ts` | Yes (only if `memoryContext` provided) |
| 5 | Tools | `tools.ts` | Yes (filtered by mode's `toolGroups`) |
| 6 | Tool rules | `toolRules.ts` | No (always) |
| 7 | Tool decision guidelines | `toolDecisionGuidelines.ts` | No (always) |
| 8 | Objective | `objective.ts` | No (always) |
| 9 | Response format | `responseFormat.ts` | No (always) |
| 10 | Explicit instructions | `explicitInstructions.ts` | No (always) |
| 11 | Security boundary | `securityBoundary.ts` | No (always) |
| 12 | Mode role definition | `modeDefinition.ts` | No (always) |
| 13 | Custom instructions | `customInstructions.ts` | Yes (only if global or mode instructions set) |
| 14 | Skills | `skills.ts` | Yes (only if `skillsSection` provided) |
| 15 | Rules | `rules.ts` | Yes (only if `rulesContent` provided) |

### Section Contract
Each section is a pure function with this pattern:
```typescript
export function get{Name}Section(params?): string {
    // Return prompt text or empty string (conditional sections)
}
```
- Pure functions (no side effects, no plugin/app access)
- Return empty string `''` for conditional sections when content is absent
- The orchestrator filters empty strings before joining

### Orchestrator
```typescript
// systemPrompt.ts — thin orchestrator
const sections: string[] = [
    getDateTimeSection(includeTime) + getVaultContextSection(),
    getCapabilitiesSection(),
    getMemorySection(memoryContext),
    getToolsSection(mode.toolGroups, mcpClient, allowedMcpServers),
    // ... all 15 sections
];
return sections.filter(Boolean).join('\n');
```

## New Sections Detail

### Objective Section (adapted from Kilo Code)
6 rules for task decomposition:
1. Analyze the task — identify what you have vs. what you need
2. Work goals one at a time, evaluate before deciding next action
3. Verify tool parameters before calling — never guess paths
4. Publish task plan for 3+ step tasks
5. Summarize when done — completion signal only for tool workflows
6. Incorporate feedback, don't end with unnecessary questions

**Kilo Code comparison:** Kilo has 5 rules. Obsilo adds rule 4 (explicit update_todo_list guidance) and adjusts rule 5 to differentiate tool workflows from Q&A (aligned with ADR-007 event separation).

### Capabilities Section (adapted from Kilo Code)
8 bullet points describing agent abilities:
- Vault read/search/navigate with vault_context overview
- Note creation and editing with vault integrity
- Knowledge graph understanding (frontmatter, wikilinks, backlinks, tags)
- Semantic search (vector similarity)
- Canvas visualization and Bases database views
- Web access (fetch + search)
- Task decomposition with sub-agents
- Cross-session memory

**Kilo Code comparison:** Kilo's capabilities focus on VS Code editing (code editing, terminal, browser). Obsilo's capabilities are entirely vault- and knowledge-management-focused.

## Key Files
- `src/core/systemPrompt.ts` — orchestrator (imports + assembles sections)
- `src/core/prompts/sections/index.ts` — barrel export for all sections
- `src/core/prompts/sections/*.ts` — 15 individual section modules

## Dependencies
- `ModeConfig` (from `types/settings.ts`) — mode's toolGroups, roleDefinition, customInstructions
- `McpClient` — for dynamic MCP tool listing in tools section
- `MemoryService` — provides memoryContext string
- `RulesLoader` — provides rulesContent string
- `SkillsManager` — provides skillsSection XML
- `toolMetadata.ts` — tools section delegates to `buildToolPromptSection()` (see FEATURE-tool-metadata-registry.md)

## Kilo Code Reference
- `forked-kilocode/src/core/prompts/system.ts` — modular section architecture (same pattern adopted)
- `forked-kilocode/src/core/prompts/sections/objective.ts` — original objective section
- `forked-kilocode/src/core/prompts/sections/capabilities.ts` — original capabilities section

## Design Decisions
- **Pure functions over classes**: Sections have no state and no dependencies on plugin/app. Functions are the simplest abstraction.
- **Ordering in orchestrator, not sections**: Sections don't know their position. The orchestrator defines the order. This makes reordering trivial.
- **Conditional via empty string**: Sections return `''` when inactive. The orchestrator uses `.filter(Boolean)` to skip them. No boolean flags needed.
- **No section registry / dynamic loading**: Sections are statically imported. This gives compile-time safety and makes the full prompt composition visible in one file.
