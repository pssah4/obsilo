# FEATURE: Autocomplete

**Status:** Implemented
**Source:** `src/ui/sidebar/AutocompleteHandler.ts`, `src/ui/sidebar/VaultFilePicker.ts`

## Summary
Two input assistance systems for the chat textarea: an inline autocomplete dropdown for `/` (workflows + support prompts) and `@` (file mentions), plus a floating multi-select file picker (VaultFilePicker) for attaching vault files as context.

## How It Works

### AutocompleteHandler — Inline Dropdown

**Trigger: `/` at start of input**
When the textarea value starts with `/`, the handler builds a combined list of:

1. **Workflows** — discovered from `.obsidian-agent/workflows/` via WorkflowLoader. Each workflow has a slug (e.g., `/review`). Filtered by the query after `/` and by toggle state (`workflowToggles`).

2. **Support Prompts** — custom prompts defined in settings (`customPrompts` array). Each has a slug, name, content template, and optional mode restriction. Only prompts matching the current mode (or without a mode restriction) are shown.

On selection:
- Workflows: replaces the textarea value with `/{slug} {remaining text}`
- Support Prompts: resolves the template content via `resolvePromptContent()` (supports `{{userInput}}` and `{{activeFile}}` placeholders) and replaces the full textarea value

**Trigger: `@` anywhere in text**
When `@` is detected (preceded by whitespace or at position 0):

1. **Active note shortcut** — if the query matches "active", shows the currently open file
2. **Vault file search** — searches all markdown files by path (case-insensitive), limited to 10 results

On selection:
- Removes the `@query` text from the textarea
- Calls `addVaultFile(file)` to attach the file as context (reads content and adds to the message)

**Keyboard Navigation:**
- ArrowUp/ArrowDown — navigate items
- Tab/Enter — select current item
- Escape — close dropdown

**DOM:** The dropdown is rendered as an absolutely positioned div (`autocomplete-dropdown`) inside the input area. Closes on outside click.

### VaultFilePicker — Floating Multi-Select

A popover search interface for attaching multiple vault files at once:

**Features:**
- Live search by filename and path
- Checkbox multi-select (click row or space to toggle)
- Active note shown first with "Active:" prefix
- Up to 80 results displayed
- Keyboard: ArrowUp/Down (navigate), Space (toggle), Enter (confirm), Escape (close)
- Footer with selected count and "Add" button

**Positioning:** Anchored to the toolbar button. Automatically positions above or below based on available viewport space.

**On Confirm:** Selected files are passed to `onConfirm(files: TFile[])` callback, which reads their content and attaches them as context for the next message.

## Key Files
- `src/ui/sidebar/AutocompleteHandler.ts` — `/` and `@` autocomplete logic
- `src/ui/sidebar/VaultFilePicker.ts` — floating multi-select file picker
- `src/core/context/SupportPrompts.ts` — `resolvePromptContent()` template resolution
- `src/core/context/WorkflowLoader.ts` — workflow discovery

## Dependencies
- `WorkflowLoader` — discovers workflow files for `/` autocomplete
- `settings.customPrompts` — support prompt definitions
- `settings.workflowToggles` — per-workflow enable/disable
- `App.vault.getMarkdownFiles()` — file listing for `@` mentions and VaultFilePicker
- `App.workspace.getActiveFile()` — active note detection

## Configuration
| Key | Default | Description |
|-----|---------|-------------|
| `workflowToggles` | `{}` | Per-workflow enable/disable map |
| `customPrompts` | `[]` | Support prompt definitions (name, slug, content, mode) |

## Known Limitations / Edge Cases
- `@` file search is limited to markdown files only — PDFs, images, and other file types are not searchable.
- File search results are capped at 10 (autocomplete) or 80 (VaultFilePicker) — large vaults may not show all matching files.
- The autocomplete dropdown uses a single `click` listener with `{ once: true }` for outside-click detection — rapid open/close sequences could lose the listener.
- No fuzzy matching — both `/` and `@` use simple `startsWith` or `includes` matching.
- VaultFilePicker does not remember previous selections across open/close cycles.
- Support prompt template resolution only supports two variables: `{{userInput}}` and `{{activeFile}}`.
