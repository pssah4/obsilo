# FEATURE: Modes

**Status:** Implemented
**Source:** `src/core/modes/`, `src/types/settings.ts`

## Summary
Mode system that defines the agent's capabilities, persona, and available tools. Two built-in modes (Ask, Agent) plus unlimited user-created custom modes. Each mode has its own role definition, tool groups, optional model override, and per-mode MCP whitelist.

## How It Works

### Built-in Modes

**Ask** (`slug: 'ask'`)
- Tool groups: `read`, `vault`, `agent`
- Role: conversational, read-only vault Q&A. Prioritizes `semantic_search` → `search_by_tag` → `search_files` → `read_file`.
- Cannot create, edit, or delete files.
- Suggests switching to Agent when the user needs to take action.

**Agent** (`slug: 'agent'`)
- Tool groups: `read`, `vault`, `edit`, `web`, `agent`, `mcp`
- Role: fully autonomous. Access to all tools including sub-agent spawning (`new_task`).
- Includes Obsidian conventions (wikilinks, frontmatter format, callout syntax).
- Documents 4 agentic patterns: Prompt Chaining, Orchestrator-Worker, Evaluator-Optimizer, Routing.

### Tool Groups
```typescript
TOOL_GROUP_MAP = {
  read:  ['read_file', 'list_files', 'search_files'],
  vault: ['get_frontmatter', 'search_by_tag', 'get_vault_stats',
          'get_linked_notes', 'get_daily_note', 'open_note',
          'semantic_search', 'query_base'],
  edit:  ['write_file', 'edit_file', 'append_to_file', 'create_folder',
          'delete_file', 'move_file', 'update_frontmatter',
          'generate_canvas', 'create_base', 'update_base'],
  web:   ['web_fetch', 'web_search'],
  agent: ['ask_followup_question', 'attempt_completion',
          'update_todo_list', 'new_task'],
  mcp:   ['use_mcp_tool'],
}
```
`switch_mode` is always in `TOOL_GROUPS` (pipeline classification) but NOT in `TOOL_GROUP_MAP` — it's included for all modes regardless.

### Custom Modes (ModeConfig)
```typescript
{
  slug: string,           // URL-safe, unique
  name: string,           // display name
  icon: string,           // Lucide icon name
  description: string,    // shown in mode selector
  roleDefinition: string, // injected into system prompt
  whenToUse?: string,     // hint for orchestrators
  customInstructions?: string, // user-editable, appended after roleDefinition
  toolGroups: ToolGroup[],
  source: 'built-in' | 'global' | 'vault',
}
```

**Scopes:**
- `vault` — stored in plugin settings (per-vault)
- `global` — stored at `~/.obsidian-agent/modes.json` (all vaults)
- `built-in` — ships with plugin, not user-editable

### Per-Mode Overrides (settings)
| Override | Key | Description |
|----------|-----|-------------|
| Model override | `modeModelKeys[slug]` | Use a different model for this mode |
| Tool override | `modeToolOverrides[slug]` | Restrict to specific tool names (intersection with toolGroups) |
| MCP whitelist | `modeMcpServers[slug]` | Limit which MCP servers are available |
| Forced skills | `forcedSkills[slug]` | Skills always injected regardless of keyword match |
| Forced workflow | `forcedWorkflow[slug]` | Workflow applied to every message (unless message starts with /) |

### Default Tool Override (Agent mode)
`modeToolOverrides.agent` ships pre-configured WITHOUT `delete_file` and `use_mcp_tool` — safe defaults. User must explicitly enable them.

### ModeService
- `getActiveMode()` — returns current `ModeConfig`
- `getAllModes()` — built-in + vault + global custom modes
- `getMode(slug)` — lookup by slug
- `switchMode(slug)` — updates `currentMode` in settings, persists
- `getToolDefinitions(mode, sessionOverride?)` — expands tool groups, applies `modeToolOverrides`, then intersects with `sessionOverride` (per-session chat override)

### Mode Switching
- **From UI**: mode selector dropdown in sidebar
- **From agent**: `switch_mode` tool → sets `pendingModeSwitch` in AgentTask → applied at next iteration start → system prompt rebuilt
- On mode switch: `ToolRepetitionDetector.reset()` (clears loop detection state)

### System Prompt Integration
`buildSystemPromptForMode()` called with `activeMode`. Includes:
1. Tool sections for mode's `toolGroups`
2. Mode's `roleDefinition` under `MODE: {NAME}` header
3. Mode's `customInstructions` (if any)
4. Global custom instructions (if any)

## Key Files
- `src/core/modes/builtinModes.ts` — BUILT_IN_MODES, TOOL_GROUP_MAP, expandToolGroups()
- `src/core/modes/ModeService.ts` — runtime mode management
- `src/core/modes/_deprecatedModes.ts` — 6 specialist modes (Orchestrator, Researcher, Librarian, Curator, Writer, Architect) — preserved, not active
- `src/core/modes/GlobalModeStore.ts` — reads/writes ~/.obsidian-agent/modes.json
- `src/types/settings.ts` — ModeConfig, ToolGroup types

## Dependencies
- `AgentTask` — receives active mode, rebuilds system prompt on mode change
- `ToolExecutionPipeline` — receives `mode` slug for logging
- `systemPrompt.ts` — buildSystemPromptForMode uses mode.toolGroups + roleDefinition
- `AgentSidebarView` — mode selector, displays current mode name/icon

## Configuration
| Key | Default | Description |
|-----|---------|-------------|
| `currentMode` | `'agent'` | Active mode slug |
| `customModes` | `[]` | User-created vault-scope modes |
| `modeModelKeys` | `{}` | Per-mode model overrides |
| `modeToolOverrides` | `{agent: [...]}` | Per-mode tool restrictions |
| `modeMcpServers` | `{}` | Per-mode MCP server whitelist |
| `forcedSkills` | `{}` | Per-mode always-inject skills |
| `forcedWorkflow` | `{}` | Per-mode default workflow |
| `globalCustomInstructions` | `''` | Appended to all modes |

## Extension Points
- Deprecated modes can be re-activated by adding them back to `BUILT_IN_MODES` in `builtinModes.ts`
- `whenToUse` field on `ModeConfig` — used by orchestrator patterns in `new_task` to auto-select the right sub-agent mode
- New tool groups can be added to `TOOL_GROUP_MAP` + `TOOL_SECTIONS` in `systemPrompt.ts`

## Known Limitations
- Max iterations (10) not per-mode configurable — could be useful for "safe" low-limit modes
- `switch_mode` during parallel tool execution is deferred to next iteration (correct behavior, but worth noting in multi-tool responses)
- Global modes file (`~/.obsidian-agent/modes.json`) not yet implemented — `GlobalModeStore` exists but reads from local settings as fallback
