# ADR: Permissions Audit — Auto-Approval Wiring

**Date:** 2026-02-23
**Status:** Accepted (issues found and fixed)

## Context

The auto-approval system controls whether the agent can execute tools immediately or must ask the user for confirmation. The system has three layers that must stay in sync:

1. **Pipeline** (`ToolExecutionPipeline.ts`) — `TOOL_GROUPS` maps tool names to groups, `checkApproval()` checks settings per group
2. **Sidebar** (`AgentSidebarView.ts`) — `getToolGroup()` maps tool names for the approval UI, `groupToPermKey()` maps groups to settings keys, `groupLabels` provides display labels
3. **Settings UI** (`PermissionsTab.ts`) — Toggles that read/write `autoApproval.*` keys
4. **Config Type** (`settings.ts`) — `AutoApprovalConfig` interface + `DEFAULT_SETTINGS`

## Audit Results

### Complete Tool-to-Permission Matrix

| Tool | Pipeline Group | Sidebar Group | Settings Key | Default | UI Toggle |
|------|---------------|---------------|-------------|---------|-----------|
| `read_file` | read | read | `read` | true | Read operations |
| `list_files` | read | read | `read` | true | Read operations |
| `search_files` | read | read | `read` | true | Read operations |
| `get_frontmatter` | read | read | `read` | true | Read operations |
| `get_linked_notes` | read | read | `read` | true | Read operations |
| `get_vault_stats` | read | read | `read` | true | Read operations |
| `search_by_tag` | read | read | `read` | true | Read operations |
| `get_daily_note` | read | read | `read` | true | Read operations |
| `query_base` | read | read | `read` | true | Read operations |
| `semantic_search` | read | read | `read` | true | Read operations |
| `write_file` | note-edit | note-edit | `noteEdits` | false | Note edits |
| `edit_file` | note-edit | note-edit | `noteEdits` | false | Note edits |
| `append_to_file` | note-edit | note-edit | `noteEdits` | false | Note edits |
| `update_frontmatter` | note-edit | note-edit | `noteEdits` | false | Note edits |
| `create_folder` | vault-change | vault-change | `vaultChanges` | false | Vault structure changes |
| `delete_file` | vault-change | vault-change | `vaultChanges` | false | Vault structure changes |
| `move_file` | vault-change | vault-change | `vaultChanges` | false | Vault structure changes |
| `generate_canvas` | vault-change | vault-change | `vaultChanges` | false | Vault structure changes |
| `create_base` | vault-change | vault-change | `vaultChanges` | false | Vault structure changes |
| `update_base` | vault-change | vault-change | `vaultChanges` | false | Vault structure changes |
| `web_fetch` | web | web | `web` | false | Web access |
| `web_search` | web | web | `web` | false | Web access |
| `use_mcp_tool` | mcp | mcp | `mcp` | false | MCP tool calls |
| `switch_mode` | mode | mode | `mode` | false | Mode switching |
| `new_task` | subtask | subtask | `subtasks` | false | Subtasks |
| `execute_command` | skill | skill | `skills` | true | Plugin skills |
| `enable_plugin` | skill | skill | `skills` | true | Plugin skills |
| `resolve_capability_gap` | skill | skill | `skills` | true | Plugin skills |
| `call_plugin_api` | plugin-api | plugin-api | `pluginApiRead`/`pluginApiWrite` | true/false | Plugin API reads/writes |
| `execute_recipe` | recipe | recipe | `recipes` | true | Recipe execution |
| `ask_followup_question` | agent | (no approval) | — | always auto | — |
| `attempt_completion` | agent | (no approval) | — | always auto | — |
| `update_todo_list` | agent | (no approval) | — | always auto | — |
| `open_note` | agent | (no approval) | — | always auto | — |

### Settings-Only Keys (UI toggle exists, no tool group)

| Settings Key | Default | UI Toggle | Purpose |
|---|---|---|---|
| `enabled` | false | Enable auto-approve | Master switch — gates all auto-approvals |
| `showMenuInChat` | true | Show approval bar | UI-only, no permission effect |
| `question` | true | Follow-up questions | Agent tool, always auto-approved in Pipeline |
| `todo` | true | Todo list updates | Agent tool, always auto-approved in Pipeline |

Note: `question` and `todo` have UI toggles but the Pipeline always auto-approves agent tools regardless. These toggles have **no effect** on the approval flow. They could be removed from the UI or wired to actually gate those tools.

## Issues Found and Fixed

### 1. `skills` default was `false` (FIXED)

**File:** `src/types/settings.ts:534`
**Impact:** New installations required manual toggle for execute_command.
**Fix:** Changed default to `true`. Migration in `main.ts` flips existing `false` to `true` when master switch is on.

### 2. `semantic_search` missing from Pipeline TOOL_GROUPS (FIXED)

**File:** `src/core/tool-execution/ToolExecutionPipeline.ts`
**Impact:** Falls to `'note-edit'` fallback. No functional issue (isWriteOperation=false, so checkApproval never called), but inconsistent.
**Fix:** Added `semantic_search: 'read'`.

### 3. `call_plugin_api` and `execute_recipe` missing from Sidebar (FIXED)

**File:** `src/ui/AgentSidebarView.ts`
**Impact:** When Pipeline requests approval for these tools, the Sidebar showed "note edits not enabled" instead of "plugin API not enabled" / "recipes not enabled". "Enable in Settings" button set the wrong key.
**Fix:** Added `plugin-api` and `recipe` to `getToolGroup()`, `groupToPermKey()`, and `groupLabels`.

### 4. `pluginApiRead` missing from existing data.json (FIXED)

**File:** `src/main.ts` (migration)
**Impact:** Pipeline checked `cfg.pluginApiRead` which was `undefined` (falsy) — read-only plugin API calls prompted for approval even though they should be safe.
**Fix:** Migration sets `pluginApiRead = true` when missing.

### 5. `question` and `todo` UI toggles are inert (NOT FIXED — by design)

**Files:** `PermissionsTab.ts:108-126`, `ToolExecutionPipeline.ts:255`
**Impact:** Pipeline always auto-approves `agent` group tools. The `question` and `todo` toggles in the UI write to settings but have zero effect on the approval flow.
**Decision:** Keep for now. These are aspirational — may be wired in the future if users want to gate follow-up questions.

## Approval Flow Diagram

```
Tool called
  |
  v
Pipeline.executeTool()
  |
  +-- Is tool in TOOL_GROUPS? (yes: use group, no: fallback to 'note-edit')
  |
  +-- Is isWriteOperation || web || mcp || mode || subtask?
  |     no -> execute immediately (no approval needed)
  |     yes -> checkApproval()
  |
  +-- Is group === 'agent'? -> always auto-approve
  |
  +-- Is cfg.enabled (master switch)?
  |     no -> fall through to manual approval
  |     yes -> check per-group setting (e.g., cfg.skills for 'skill' group)
  |             match? -> auto-approve
  |             no match? -> fall through
  |
  +-- Is onApprovalRequired callback wired?
  |     no -> DENY (fail-closed for subtasks)
  |     yes -> Show approval card (Sidebar)
  |             |
  |             +-- Sidebar.getToolGroup() -> group label
  |             +-- "Allow once" -> approved
  |             +-- "Enable in Settings" -> groupToPermKey() -> save setting -> approved
  |             +-- "X" -> rejected
```

## Gate Condition (Pipeline line 147)

Only these tools enter the approval check:
- `isWriteOperation = true`: write_file, edit_file, append_to_file, update_frontmatter, create_folder, delete_file, move_file, generate_canvas, create_base, update_base, execute_command, enable_plugin, use_mcp_tool, call_plugin_api, execute_recipe
- `toolGroup === 'web'`: web_fetch, web_search (isWriteOperation=false but gated by group)
- `toolGroup === 'mode'`: switch_mode (isWriteOperation=false but gated by group)
- `toolGroup === 'subtask'`: new_task (isWriteOperation=false but gated by group)

Tools that bypass the check entirely (isWriteOperation=false AND not in web/mcp/mode/subtask):
- All read tools, semantic_search, open_note, ask_followup_question, attempt_completion, update_todo_list, resolve_capability_gap

Note: `resolve_capability_gap` has `isWriteOperation = false` but is in the `skill` group. Since it's not a write and not web/mcp/mode/subtask, it bypasses the approval check entirely. This is correct — it only reads vault-dna.json.
