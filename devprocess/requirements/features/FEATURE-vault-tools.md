# FEATURE: Vault Tools (Read, Write, Intelligence)

**Status:** Implemented
**Source:** `src/core/tools/vault/`

## Summary
30+ tools organized in three groups covering all vault operations: reading/searching files, writing/editing content, and Obsidian-specific intelligence (frontmatter, tags, links, daily notes, vault stats).

---

## Tool Group: read

### read_file
Reads the complete content of a vault file. Returns content with metadata header (`path`, `basename`, `extension`). Read-only, no approval needed. Most frequently used tool.

### list_files
Lists files and folders in a directory. `path="/"` for vault root. Optional `recursive: boolean`. Returns a tree-formatted list of paths.

### search_files
Full-text search across vault files. Parameters:
- `path: string` — directory to search (use `/` for whole vault)
- `pattern: string` — regex or literal string
- `file_pattern?: string` — glob to filter files (e.g., `*.md`)

Returns matching lines with line numbers and context. Uses Node.js `fs` via Electron for recursive file walking.

---

## Tool Group: vault (Obsidian Intelligence)

### get_vault_stats
Overview of the vault: note count, folder structure, top tags, recently modified files. Returns a formatted summary. Useful for initial vault exploration without listing every file.

### get_frontmatter
Read all YAML frontmatter fields of a note. Returns parsed key-value pairs. No-op if file has no frontmatter.

### update_frontmatter
Set or update frontmatter fields without touching note content. Parameters:
- `path: string`
- `updates: Record<string, any>` — fields to set/update
- `remove?: string[]` — fields to remove

Preserves existing frontmatter. Creates frontmatter block if none exists. Uses string manipulation (not full YAML parser).

### search_by_tag
Find all notes with given tags. Parameters:
- `tags: string[]` — with or without `#` prefix
- `match?: 'any' | 'all'` — OR (default) or AND matching

Scans frontmatter `tags` and `cssclass` fields + inline `#tag` in content.

### get_linked_notes
Get wikilink graph for a note. Parameters:
- `path: string`
- `direction?: 'both' | 'forward' | 'backlinks'` (default: `'both'`)

Uses Obsidian's `MetadataCache.resolvedLinks` for forward links and manual backlink scan for backlinks.

### open_note
Open a note in the Obsidian editor. Parameters:
- `path: string`
- `newLeaf?: boolean` — open in new tab

Calls `this.app.workspace.openLinkText()`. Used by agent after creating/editing notes to bring them into view.

### get_daily_note
Read (or create) the daily note. Parameters:
- `offset?: number` — 0=today (default), -1=yesterday, 1=tomorrow
- `create?: boolean` — create if missing

Uses Obsidian's Daily Notes plugin settings (`moment.js` format) to resolve the path. If Daily Notes plugin is not configured, uses `YYYY-MM-DD.md` at vault root as fallback.

---

## Tool Group: edit (Write Operations)

All edit tools have `isWriteOperation = true` → trigger approval + checkpoint pipeline.

### write_file
Create a new file or completely replace an existing file's content. Parameters:
- `path: string`
- `content: string` (complete content)

Behavior:
- Existing file → `vault.modify()` (preserves file metadata)
- New file → `vault.create()` (creates parent folders if needed via `ensureFolderExists()`)
- Emits `<diff_stats added="N" removed="N"/>` in result

### edit_file
Replace a specific string in an existing file. Parameters:
- `path: string`
- `old_str: string` — must exactly match file content
- `new_str: string`
- `expected_replacements?: number` — validates replacement count (default: 1)

Features:
- Exact match first, then `tryNormalizedMatch()` (collapses whitespace) as fallback
- Reports multiple matches if `old_str` is ambiguous
- `expected_replacements` check prevents partial replacements
- Emits `<diff_stats added="N" removed="N"/>` in result

**Preferred over write_file for targeted edits** — preserves surrounding content.

### append_to_file
Append content to the end of a file. Parameters:
- `path: string`
- `content: string`
- `separator?: string` — prepended before new content (default: `"\n"`)

Ideal for daily notes, logs, additive entries. Reads existing content first, appends, writes back.

### create_folder
Create a new folder including all parent directories. Parameters:
- `path: string`

Uses `vault.createFolder()`. No-op if folder already exists.

### delete_file
Move a file or empty folder to trash (safe — recoverable). Parameters:
- `path: string`

Uses `vault.trash(file, true)` (system trash, not `.trash` folder). NOT a hard delete.

### move_file
Move or rename a file or folder. Parameters:
- `source: string`
- `destination: string`

Uses `vault.rename()`. Updates Obsidian's link cache automatically.

### update_frontmatter
(Also listed under vault group — available in both groups depending on mode configuration.)

---

## BaseTool (Base Class)
All tools extend `BaseTool<TName>`:
- `getDefinition()` → `ToolDefinition` (JSON schema for LLM)
- `execute(input, context: ToolExecutionContext)` → `Promise<void>`
- Helpers: `formatError(error)`, `formatSuccess(msg)`, `formatContent(content, meta)`, `validate(input)`

## Key Files
- `src/core/tools/vault/*.ts` — 20+ vault tool implementations
- `src/core/tools/BaseTool.ts` — abstract base class
- `src/core/tools/ToolRegistry.ts` — registers all tools on plugin init
- `src/core/tools/types.ts` — `ToolName` union, `ToolDefinition`, `ToolExecutionContext`

## Dependencies
- `ObsidianAgentPlugin` passed to each tool constructor (access to `app`, `vault`, `settings`)
- `ToolExecutionPipeline` — all tools execute via pipeline (approval, checkpoint, logging)
- `ModeService.getToolDefinitions()` — filters tool list per mode and per-session override

## Tool Count by Group
| Group | Tools |
|-------|-------|
| read | read_file, list_files, search_files |
| vault | get_frontmatter, update_frontmatter, search_by_tag, get_vault_stats, get_linked_notes, open_note, get_daily_note, semantic_search, query_base |
| edit | write_file, edit_file, append_to_file, create_folder, delete_file, move_file, update_frontmatter, generate_canvas, create_base, update_base |
| web | web_fetch, web_search |
| agent | ask_followup_question, attempt_completion, update_todo_list, switch_mode, new_task |
| mcp | use_mcp_tool |

**Total: 30+ tools**

## Known Limitations / Edge Cases
- `edit_file` normalized fallback match (whitespace collapse) may produce unexpected results if whitespace is semantically significant (code files).
- `delete_file` uses system trash — irreversible via Obsidian UI if trash is emptied. Consider warning when `delete_file` is used in auto-approved mode.
- `get_daily_note` depends on Daily Notes plugin configuration; if not installed, falls back to simple date format.
- `move_file` renames may break external references (links from apps other than Obsidian).
- `list_files` recursive with large vaults can be slow — no pagination or depth limit.
- `search_files` uses Node.js `fs` directly (Electron path) — not compatible with mobile Obsidian.
