# TECH: Modes, Prompts, and Context Injection

Technical reference for the mode system, rules, workflows, skills, support prompts, and power steering in Obsidian Agent.

Source files:
- `src/core/modes/ModeService.ts` -- Mode resolution, tool filtering, overrides
- `src/core/modes/builtinModes.ts` -- Built-in mode definitions, tool group mapping
- `src/core/context/RulesLoader.ts` -- User-defined rules injection
- `src/core/context/WorkflowLoader.ts` -- Slash command workflows
- `src/core/context/SkillsManager.ts` -- Keyword-matched skill injection
- `src/core/context/SupportPrompts.ts` -- Quick-action prompt templates
- `src/core/AgentTask.ts` -- Power steering implementation

---

## 1. ModeService

File: `src/core/modes/ModeService.ts`

Central authority for mode resolution and tool access control. All mode lookups and tool filtering go through this service.

### Resolution Priority

Modes are resolved in a three-tier hierarchy:

1. **Built-in modes** -- Shipped with the plugin (`BUILT_IN_MODES` array).
2. **Global modes** -- Loaded from `~/.obsidian-agent/modes.json` (shared across all vaults).
3. **Vault modes** -- Stored in `settings.customModes` (per-vault).

If a vault mode has the same slug as a built-in mode, the vault version **replaces** the built-in. This allows users to override default mode behavior.

```typescript
getAllModes(): ModeConfig[] {
    const overriddenSlugs = new Set(vault.map(m => m.slug));
    const effectiveBuiltIns = BUILT_IN_MODES.filter(m => !overriddenSlugs.has(m.slug));
    return [...effectiveBuiltIns, ...this.globalModes, ...vault];
}
```

### Tool Filtering

#### getToolNames(mode)
Expands the mode's `toolGroups` array into individual tool names using `TOOL_GROUP_MAP`.

#### getEffectiveToolNames(mode)
Applies user overrides on top of group expansion:
1. Check `settings.modeToolOverrides[slug]` for a permanent user override.
2. If override exists, intersect it with the mode's allowed tools (never escalates beyond mode groups).
3. If no override, return all tools from the mode's groups.

#### getToolDefinitions(mode)
Returns `ToolDefinition[]` filtered to the effective tool set. Additionally removes `web_search` and `web_fetch` when web tools are disabled in settings.

### Mode Switching
`switchMode(slug)` persists the new mode slug to `settings.currentMode` and saves settings. Returns the ModeConfig or null if the slug is invalid.

### Active Mode Fallback
`getActiveMode()` reads `settings.currentMode`. If the slug no longer exists (e.g., deleted custom mode), falls back to the `'ask'` built-in mode.

---

## 2. Built-in Modes

File: `src/core/modes/builtinModes.ts`

### Tool Group Mapping

```typescript
TOOL_GROUP_MAP: Record<ToolGroup, string[]> = {
    read:  ['read_file', 'list_files', 'search_files'],
    vault: ['get_frontmatter', 'search_by_tag', 'get_vault_stats',
            'get_linked_notes', 'get_daily_note', 'open_note',
            'semantic_search', 'query_base'],
    edit:  ['write_file', 'edit_file', 'append_to_file', 'create_folder',
            'delete_file', 'move_file', 'update_frontmatter',
            'generate_canvas', 'create_base', 'update_base'],
    web:   ['web_fetch', 'web_search'],
    agent: ['ask_followup_question', 'attempt_completion', 'update_todo_list',
            'new_task', 'switch_mode', 'update_settings', 'configure_model'],
    mcp:   ['use_mcp_tool'],
    skill: ['execute_command', 'execute_recipe', 'call_plugin_api',
            'resolve_capability_gap', 'enable_plugin'],
}
```

### expandToolGroups(groups: ToolGroup[]): string[]
Flattens an array of group names into a deduplicated list of tool names. Used by ModeService for all tool resolution.

### Ask Mode

- **Slug**: `ask`
- **Tool groups**: `read`, `vault`, `agent`
- **No write access**: Cannot create, edit, move, or delete files.
- **Behavior**: Conversational vault Q&A. Parallel semantic search. Cites sources.
- **Escalation**: Uses `switch_mode` to escalate to Agent mode when the user needs write operations or web access.
- **Search strategy**: semantic_search first, then search_by_tag, then search_files, then read_file.

### Agent Mode

- **Slug**: `agent`
- **Tool groups**: `read`, `vault`, `edit`, `web`, `agent`, `mcp`, `skill`
- **Full access**: All tools including file writes, web, MCP, and plugin skills.
- **Behavior**: Autonomous agent. Parallel tool calls. Todo lists for multi-step tasks.
- **Sub-agents**: Can spawn via `new_task`. Max nesting depth: 1 (children cannot spawn further children).
- **Plugin awareness**: Checks if required plugins are enabled before using plugin-dependent content.

---

## 3. Custom Modes

### ModeConfig Interface

```typescript
interface ModeConfig {
    slug: string;              // URL-safe identifier
    name: string;              // Display name
    icon: string;              // Lucide icon name
    description: string;       // Short description
    roleDefinition: string;    // System prompt role text
    whenToUse?: string;        // Hint for delegation decisions
    customInstructions?: string; // User-editable extra instructions
    toolGroups: ToolGroup[];   // Which tool groups are available
    source: 'built-in' | 'global' | 'vault';
    modelOverride?: string;    // Optional per-mode model selection
    mcpServers?: string[];     // Optional per-mode MCP server whitelist
}
```

### CRUD Operations
- **Vault modes**: Stored in `settings.customModes`. Created/updated/deleted via the settings UI.
- **Global modes**: Stored in `~/.obsidian-agent/modes.json`. Managed by `GlobalModeStore`. Loaded during `ModeService.initialize()`, reloaded via `reloadGlobalModes()`.
- Modes with slug ending in `__custom` are filtered out from getAllModes() (reserved for custom instruction entries).

### Per-Mode Model Override
The `modelOverride` field allows a mode to use a different LLM than the default. When set, the agent loop uses this model instead of the globally selected one.

### Per-Mode MCP Whitelist
The `mcpServers` field restricts which MCP servers are available when the mode is active. Combined with the `activeMcpServers` global setting.

---

## 4. RulesLoader

File: `src/core/context/RulesLoader.ts`

### Directory Structure
Rules are stored at `{vault}/.obsidian-agent/rules/` as `.md` or `.txt` files.

### Discovery
`discoverRules()` lists all `.md` and `.txt` files in the rules directory, sorted alphabetically.

### Toggle System
- Each rule file can be toggled on/off in Settings.
- Toggles stored as `Record<string, boolean>` where keys are vault-relative paths.
- Default: enabled (new rules are active unless explicitly set to `false`).

### Loading
`loadEnabledRules(toggles)`:
1. Discovers all rule files.
2. Skips files where `toggles[path] === false`.
3. Reads each file's content.
4. Enforces a 50,000 character per-file size limit (prevents injection of huge payloads).
5. Joins all enabled rules with double newlines.
6. Result is injected as a RULES section at the bottom of the system prompt.

### Management
- `createRule(name, content)`: Sanitizes name (alphanumeric + hyphens/underscores/spaces), writes `.md` file.
- `deleteRule(rPath)`: Removes the file.
- `RulesLoader.displayName(rPath)`: Extracts filename without extension for UI display.

---

## 5. WorkflowLoader

File: `src/core/context/WorkflowLoader.ts`

### Directory Structure
Workflows are stored at `{vault}/.obsidian-agent/workflows/` as `.md` or `.txt` files.

### Slug Derivation
Filename is converted to a slug: lowercase, spaces become hyphens, extension removed. For example, `My Workflow.md` becomes slug `my-workflow`.

### Slash Command Activation
`processSlashCommand(text, toggles)`:

1. Checks if text starts with `/`.
2. Parses `/slug [rest-of-message]`.
3. Looks up matching workflow by slug.
4. Checks toggle (enabled by default).
5. Reads the workflow file content.
6. Wraps content in `<explicit_instructions type="{slug}">` tags.
7. Prepends to the user's rest-of-message.

Example transformation:
```
Input:  "/daily-review What happened today?"
Output: "<explicit_instructions type="daily-review">
         [content of daily-review.md]
         </explicit_instructions>

         What happened today?"
```

If no workflow matches the slug, the text is passed through unchanged. This allows other slash commands (like support prompts) to work without collision.

### Management
- `createWorkflow(name, content)`: Creates workflow file with sanitized name.
- `deleteWorkflow(wPath)`: Removes workflow file.
- Workflows have their own toggle system, separate from rules.

---

## 6. SkillsManager

File: `src/core/context/SkillsManager.ts`

### Directory Structure
Skills are stored as directories at `{vault}/.obsidian-agent/skills/{name}/SKILL.md`.

### SKILL.md Format
```yaml
---
name: my-skill
description: What this skill does (used for keyword matching)
---

Instructions the agent follows when using this skill.
```

Both `name` and `description` are required in frontmatter. Skills without a description are ignored.

### Keyword Matching Algorithm
`getRelevantSkills(userMessage, toggles)`:

1. Discovers all skills by scanning for SKILL.md files in subdirectories.
2. Filters out disabled skills (where `toggles[path] === false`).
3. Extracts words (3+ characters) from the user message into a Set.
4. For each skill, extracts words from its description.
5. A skill matches if any word in its description appears in the user message.

This is a simple bag-of-words overlap -- no stemming, no fuzzy matching. Designed for speed and predictability.

### Auto-Inject Logic
When matching skills are found:
1. Full SKILL.md content is read and inlined (frontmatter stripped).
2. Content is capped at 4,000 characters per skill (prevents system prompt bloat).
3. Output is wrapped in `<available_skills>` XML:

```xml
<available_skills>
  <skill>
    <name>my-skill</name>
    <description>What this skill does</description>
    <instructions>Full body of SKILL.md</instructions>
  </skill>
</available_skills>
```

This inlining eliminates the need for the agent to call `read_file` on the SKILL.md before acting.

---

## 7. SupportPrompts

File: `src/core/context/SupportPrompts.ts`

### Template Types
Four built-in quick-action templates:

| Type | Label | Purpose |
|------|-------|---------|
| `ENHANCE` | Improve prompt | Rewrites user input as a better prompt |
| `SUMMARIZE` | Summarize note | TL;DR + key points + action items |
| `EXPLAIN` | Explain note | Purpose, concepts, connections |
| `FIX` | Fix issues | Error correction, formatting, broken links |

### Substitution Variables
Two variable syntaxes are supported:

**Built-in syntax** (used in default templates):
- `${userInput}` -- The user's text input
- `${activeFileHint}` -- Resolves to ` (active file: path)` or empty string

**User-friendly syntax** (for custom templates):
- `{{userInput}}` -- Same as above
- `{{activeFile}}` -- The raw active file path

Both syntaxes are resolved by `resolvePromptContent()`.

### PromptEntry Interface
Unified entry for autocomplete and settings:

```typescript
interface PromptEntry {
    id: string;         // e.g. "builtin-enhance"
    name: string;       // e.g. "Improve prompt"
    slug: string;       // e.g. "enhance" (slash command trigger)
    content: string;    // Raw template with variables
    isBuiltIn: boolean;
}
```

`getBuiltInPromptEntries()` returns the four default templates as PromptEntry objects.

---

## 8. Power Steering

Implemented in `src/core/AgentTask.ts`.

### Purpose
During long agentic loops, the model can drift from its assigned role. Power Steering periodically re-injects the mode's role definition as a user message to keep the model on task.

### Configuration
- `powerSteeringFrequency: number` -- inject a reminder every N iterations (0 = disabled).
- Configured per-session in the AgentTask constructor.
- Exposed in Settings as a numeric input.

### Implementation
In the agent loop, after each iteration:

```typescript
if (
    this.powerSteeringFrequency > 0
    && iteration > 0
    && iteration % this.powerSteeringFrequency === 0
) {
    history.push({
        role: 'user',
        content: `[Power Steering Reminder]\n\nYou are operating in **${activeMode.name}** mode.\n\n${activeMode.roleDefinition}\n\nContinue the task.`,
    });
}
```

Key properties:
- Injected as a `user` message so the model treats it as a fresh instruction.
- Contains the full `roleDefinition` from the active mode.
- Only triggers every Nth iteration (not every turn).
- Never triggers on iteration 0 (the first turn).
- The `[Power Steering Reminder]` prefix helps the model recognize it as a system-level nudge rather than user input.

---

## 9. Context Assembly Order

The system prompt is assembled with these sections in order:

1. **Mode role definition** -- From `activeMode.roleDefinition`
2. **Custom instructions** -- From `activeMode.customInstructions` (if set)
3. **Rules** -- From `RulesLoader.loadEnabledRules()` (if any enabled rules exist)
4. **Plugin Skills** -- From `SkillRegistry.getPluginSkillsPromptSection()` (active + disabled plugin listings)
5. **Available Skills** -- From `SkillsManager.getRelevantSkills()` (keyword-matched, per-message)
6. **MCP Tools** -- Descriptions of available MCP server tools

At the message level:
- **Workflows** -- Prepended to the user message via `WorkflowLoader.processSlashCommand()`
- **Support Prompts** -- Replace the user message when a quick-action template is selected
- **Power Steering** -- Injected as periodic user messages during the agent loop
