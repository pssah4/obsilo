# FEATURE: Rules

**Status:** Implemented
**Source:** `src/core/context/RulesLoader.ts`

## Summary
User-defined text instructions injected into every system prompt. Rules are Markdown/text files stored in `.obsidian-agent/rules/`. Each file can be toggled on/off in settings. Enabled rules are concatenated and placed in a `RULES` / `<user_defined_rules>` block at the bottom of the system prompt.

## How It Works

### Storage
- Directory: `{vault}/.obsidian-agent/rules/`
- File types: `.md` and `.txt`
- Created on first plugin use via `initialize()` (creates dir if missing)

### Discovery
`discoverRules()` scans the rules directory and returns a sorted list of vault-relative paths.

### Toggle System
Each rule file has a toggle stored in settings:
```typescript
rulesToggles: Record<string, boolean>
// key = vault-relative path, e.g. ".obsidian-agent/rules/my-rule.md"
// true (default) = enabled, false = disabled
```
Rules missing from `rulesToggles` are treated as enabled by default.

### Loading
`loadEnabledRules(toggles)` → combined string of all enabled rules:
```
--- .obsidian-agent/rules/rule-1.md ---
[content of rule-1]

--- .obsidian-agent/rules/rule-2.md ---
[content of rule-2]
```
- Per-file size cap: 50,000 characters (truncated with a note)
- Returns empty string if no rules are enabled

### System Prompt Injection
In `buildSystemPromptForMode()`:
```
====

RULES

The following rules were defined by the user and must always be followed:

<user_defined_rules>
[content from loadEnabledRules()]
</user_defined_rules>
```
The `<user_defined_rules>` boundary tags help the LLM distinguish user-defined content (less trusted) from core system instructions.

### Display Name
`RulesLoader.displayName(path)` strips `.obsidian-agent/rules/` prefix for UI display.

### CRUD Operations
- `createRule(name, content)` — creates `{name}.md` in rules dir, returns path
- `deleteRule(rPath)` — deletes the file from vault

## Key Files
- `src/core/context/RulesLoader.ts`
- `src/ui/settings/RulesTab.ts` — settings UI (toggle, new, edit, delete)
- `src/core/systemPrompt.ts` — injects `rulesContent` at end of system prompt

## Dependencies
- `AgentSidebarView` → `main.ts` → `RulesLoader.loadEnabledRules()` called before each task
- `ObsidianAgentPlugin.settings.rulesToggles` — persists per-file toggle state
- `systemPrompt.ts` — receives `rulesContent` as parameter

## Configuration
| Key | Default | Description |
|-----|---------|-------------|
| `rulesToggles` | `{}` | Per-file enabled/disabled map |

## Use Cases for Rules
- Language preferences: "Always respond in German"
- Formatting standards: "Use ## for sections, ### for subsections"
- Frontmatter templates: "Always include title, tags, created in frontmatter"
- Obsidian conventions: "Use lowercase hyphenated tags"
- Persona: "Be concise, avoid filler phrases"

## Known Limitations / Edge Cases
- Rules are loaded on every task start (not cached) — file I/O per message. Acceptable for most vaults, could be optimized with a watch-based cache.
- Rules directory path (`.obsidian-agent/rules/`) is hardcoded, not user-configurable.
- No rule ordering/priority — rules are concatenated in filesystem sort order. Consider adding explicit ordering UI.
- Rules content is trusted user data but wrapped in `<user_defined_rules>` tags to signal to LLM that it's user-defined (prompt injection mitigation).
- 50k char cap applies per file, not total — a vault with many large rules files could produce a very large system prompt.
