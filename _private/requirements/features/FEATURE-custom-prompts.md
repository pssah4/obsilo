# FEATURE: Custom Prompts (Slash Command Templates)

**Status:** Implemented
**Source:** `src/core/context/SupportPrompts.ts`, `src/types/settings.ts` (CustomPrompt)

## Summary
User-defined prompt templates invoked via slash commands or UI quick-actions. Two subsystems: **Built-in support prompts** (ENHANCE, SUMMARIZE, EXPLAIN, FIX — triggered from context menu) and **Custom Prompts** (user-defined templates with `/slug` triggers and variable substitution).

## How It Works

### Built-in Support Prompts (SupportPrompts)
Four built-in action types, triggered from right-click or toolbar:
- `ENHANCE` — improve/expand selected text or active file
- `SUMMARIZE` — create a concise summary
- `EXPLAIN` — explain a concept or code
- `FIX` — fix errors in selected text or code

`createSupportPrompt(type, params)` → returns a ready-to-send prompt string.

**Variable substitution supports both syntaxes:**
- `${variableName}` (ES6 template style)
- `{{variableName}}` (Handlebars/Mustache style)

Both are supported in `resolvePromptContent(content, params)`.

Available params: `userInput`, `activeFile`, `selectedText`, `filePath`.

`getBuiltInPromptEntries()` returns the list for UI display (settings list + quick-action bar).

### Custom Prompts (User-defined)
Stored in `settings.customPrompts: CustomPrompt[]`:
```typescript
{
  id: string,          // UUID
  name: string,        // display name, e.g. "Tagesbericht"
  slug: string,        // slash trigger, e.g. "daily-report" → /daily-report
  content: string,     // template text
  enabled: boolean,    // appears in autocomplete when true
  mode?: string,       // optional: restrict to specific mode slug
}
```

**Variables available in template content:**
- `{{userInput}}` / `${userInput}` — text after the slash command
- `{{activeFile}}` / `${activeFile}` — vault path of currently open file

**Invocation:**
User types `/daily-report [optional text]` in chat:
1. AutocompleteHandler matches slug
2. `resolvePromptContent(prompt.content, { userInput: 'optional text', activeFile: '...' })`
3. Resolved content sent as the message

**Filtering:** If `mode` is set on a prompt, it only appears in autocomplete when that mode is active.

### Difference vs. Workflows
| | Custom Prompts | Workflows |
|--|----------------|-----------|
| Storage | Plugin settings (JSON) | Vault files (.md/.txt) |
| Variables | `{{userInput}}`, `{{activeFile}}` | None |
| Format | Single template string | Multi-step markdown |
| Scope | Optional per-mode | Optional per-mode (forced) |
| Invocation | `/slug` → resolved content sent | `/slug` → content prepended as `<explicit_instructions>` |

## Key Files
- `src/core/context/SupportPrompts.ts` — built-in support prompt templates + resolvePromptContent
- `src/types/settings.ts` — `CustomPrompt` interface
- `src/ui/settings/PromptsTab.ts` — CRUD UI for custom prompts
- `src/ui/sidebar/AutocompleteHandler.ts` — `/` autocomplete including custom prompts

## Dependencies
- `ObsidianAgentPlugin.settings.customPrompts` — list of user-defined prompts
- `AutocompleteHandler` — shows matching prompts on `/` keypress
- `AgentSidebarView` — resolves prompt and sends to AgentTask

## Configuration
| Key | Default | Description |
|-----|---------|-------------|
| `customPrompts` | `[]` | User-defined prompt templates |

## Known Limitations / Edge Cases
- No nesting or composition of custom prompts.
- `{{activeFile}}` substitution depends on UI passing the current file path at send time. If no file is open, it substitutes an empty string.
- Slug uniqueness is not enforced — two prompts with the same slug will both appear in autocomplete but only one will be resolved (undefined behavior — first match wins).
- Custom prompts are stored in plugin settings (vault-specific). Not synced across vaults unless using global settings (not implemented for prompts).
- Built-in support prompts (ENHANCE etc.) are hardcoded in `SupportPrompts.ts` — not user-editable, not toggleable.
