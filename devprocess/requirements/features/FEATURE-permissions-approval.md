# FEATURE: Permissions & Approval

**Status:** Implemented
**Source:** `src/core/governance/IgnoreService.ts`, `src/core/tool-execution/ToolExecutionPipeline.ts`, `src/types/settings.ts`

## Summary
Multi-layered permission system: file-level access control (ignore/protect lists), per-category auto-approval toggles, and a user-facing approval card for manual approval of write operations.

## How It Works

### Layer 1: IgnoreService (File Access Control)

**Always blocked** (hardcoded, no override):
- `.git/` — git internals
- `.obsidian/workspace.json`, `.obsidian/workspace-mobile.json` — Obsidian workspace state
- `.obsidian/cache` — Obsidian cache

**User-defined ignore** (`.obsidian-agentignore` in vault root):
- gitignore-style glob patterns
- `*` = no slash, `**` = anything including slashes, trailing `/` = directory
- Example: `Archive/**, Templates/**, *.tmp`

**User-defined protected** (`.obsidian-agentprotected` in vault root):
- Same syntax as ignore
- Files can be read but NOT written
- Both control files (`.obsidian-agentignore`, `.obsidian-agentprotected`) are themselves always protected

**Fail-closed behavior:** Until rules are loaded, all access is denied. This prevents window-of-vulnerability on plugin startup.

**Denial messages:**
- Ignored: `"Access denied: 'path' is in the ignore list"`
- Protected (write): `"Write denied: 'path' is protected"`

### Layer 2: AutoApproval (Per-Category Toggles)

Config structure (`AutoApprovalConfig`):
```typescript
{
  enabled: boolean,      // master toggle — false = everything manual
  showMenuInChat: boolean,
  read: boolean,         // always safe, default true
  noteEdits: boolean,    // write_file, edit_file, append_to_file, update_frontmatter
  vaultChanges: boolean, // create_folder, delete_file, move_file
  web: boolean,          // web_fetch, web_search
  mcp: boolean,          // use_mcp_tool
  mode: boolean,         // switch_mode (currently auto-approved in pipeline)
  subtasks: boolean,     // new_task
  question: boolean,     // ask_followup_question (default true — shows card directly)
  todo: boolean,         // update_todo_list (default true)
  skills: boolean,       // future — skills injection
}
```

**Master toggle:** When `enabled = false`, ALL write/web/mcp operations require manual approval regardless of individual toggles.

**Agent group** (`ask_followup_question`, `attempt_completion`, `switch_mode`, `new_task`, `update_todo_list`, `open_note`) are ALWAYS auto-approved in the pipeline — no settings check needed.

### Layer 3: Manual Approval Card

When a tool requires manual approval and `onApprovalRequired` callback is wired (from UI):
- UI shows an approval card with tool name, input params preview
- User clicks Approve or Reject
- Returns `Promise<'auto' | 'approved' | 'rejected'>`
- `'rejected'` → `pipeline.executeTool()` returns `<error>Operation denied by user</error>`

**Fail-closed:** If no approval callback is wired (e.g. subtask without parent forwarding), write tools are denied with a console warning. Prevents unauthorized vault changes from sub-agents.

### Quick-Toggle Bar
`autoApproval.showMenuInChat` — shows a compact bar in the chat sidebar with per-category toggles visible during a session. Modifies live settings so changes persist.

## Key Files
- `src/core/governance/IgnoreService.ts` — file access control
- `src/core/tool-execution/ToolExecutionPipeline.ts` — approval flow (steps 2+3)
- `src/types/settings.ts` — `AutoApprovalConfig` type, `DEFAULT_SETTINGS.autoApproval`
- `src/ui/settings/PermissionsTab.ts` — settings UI
- `src/ui/AgentSidebarView.ts` — quick-toggle bar, approval card rendering

## Dependencies
- `ToolExecutionPipeline` — calls IgnoreService and manages approval flow
- `AgentTask` — wires `onApprovalRequired` callback from UI → pipeline
- `ObsidianAgentPlugin.ignoreService` — loaded from vault files on plugin init
- File watch: `.obsidian-agentignore` and `.obsidian-agentprotected` should reload on change (check if implemented)

## Configuration
| Key | Default | Description |
|-----|---------|-------------|
| `autoApproval.enabled` | false | Master toggle |
| `autoApproval.showMenuInChat` | true | Show quick-toggle bar |
| `autoApproval.read` | true | Auto-approve reads |
| `autoApproval.noteEdits` | false | Auto-approve note edits |
| `autoApproval.vaultChanges` | false | Auto-approve structural changes |
| `autoApproval.web` | false | Auto-approve web tools |
| `autoApproval.mcp` | false | Auto-approve MCP tools |
| `autoApproval.question` | true | Auto-approve followup questions |
| `autoApproval.todo` | true | Auto-approve todo updates |

## Tool → Category Mapping
| Tool | Category | Default |
|------|----------|---------|
| read_file, list_files, search_files, get_frontmatter, get_linked_notes, get_vault_stats, search_by_tag, get_daily_note, query_base | read | auto |
| write_file, edit_file, append_to_file, update_frontmatter | noteEdits | manual |
| create_folder, delete_file, move_file, generate_canvas, create_base, update_base | vaultChanges | manual |
| web_fetch, web_search | web | manual |
| use_mcp_tool | mcp | manual |
| ask_followup_question, attempt_completion, switch_mode, new_task, update_todo_list, open_note | agent | always auto |

## Known Limitations / Edge Cases
- `delete_file` is in the `vaultChanges` category but is also excluded from the default `modeToolOverrides.agent` list — users must explicitly enable it in both places.
- `IgnoreService` pattern matching is minimal gitignore (no negation patterns, no `!` overrides).
- Approval card UX: if the user closes Obsidian while an approval prompt is pending, the Promise never resolves — task hangs. Consider a timeout.
- `autoApproval.mode` and `autoApproval.subtasks` fields exist in settings but `switch_mode` and `new_task` are both classified as `'agent'` in the pipeline (always auto-approved). These settings are currently unused but reserved for future finer control.
