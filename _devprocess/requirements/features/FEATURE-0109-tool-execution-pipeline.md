# FEATURE: Tool Execution Pipeline

**Status:** Implemented
**Source:** `src/core/tool-execution/ToolExecutionPipeline.ts`

## Summary
Central governance layer that ALL tool calls must pass through. Enforces path access rules, manages approval flow, triggers checkpoints before writes, and logs every operation.

## How It Works

### Execution Steps (in order)
1. **Tool lookup** — `toolRegistry.getTool(name)`. Returns `<error>Unknown tool</error>` if not found.
2. **Path validation** — `IgnoreService.isIgnored(path)` and `isProtected(path)`. Blocks access to `.obsidian-agentignore`-listed files and write-protected files.
3. **Approval check** — For write, web, and MCP tools: checks `autoApproval` config, then calls `onApprovalRequired` callback. Fail-closed: if no callback is wired (e.g. subtasks without parent forwarding), write tools are denied.
4. **Checkpoint** — Before the FIRST write to each unique path per task, calls `checkpointService.snapshot(taskId, [path])`. Tracked via `snapshotedPaths: Set<string>` to ensure each file is snapshotted at most once per task.
5. **Execute** — Calls `tool.execute(input, context)` where `context` includes `askQuestion`, `signalCompletion`, `switchMode`, `spawnSubtask`, `updateTodos`.
6. **Log** — `OperationLogger.log()` with tool name, params, success, duration.

### Tool Group Classification
```
read:         read_file, list_files, search_files, get_frontmatter,
              get_linked_notes, get_vault_stats, search_by_tag,
              get_daily_note, query_base
note-edit:    write_file, edit_file, append_to_file, update_frontmatter
vault-change: create_folder, delete_file, move_file,
              generate_canvas, create_base, update_base
web:          web_fetch, web_search
agent:        ask_followup_question, attempt_completion, switch_mode,
              new_task, update_todo_list, open_note  ← always auto-approved
mcp:          use_mcp_tool
```

### Approval Logic
```
group = 'agent'               → auto (never asks)
cfg.enabled && cfg.noteEdits  → auto for note-edit group
cfg.enabled && cfg.vaultChanges → auto for vault-change group
cfg.enabled && cfg.web        → auto for web group
cfg.enabled && cfg.mcp        → auto for mcp group
no callback                   → rejected (fail-closed)
else                          → onApprovalRequired(toolName, input)
```

### Context Extensions (ContextExtensions interface)
Passed to `executeTool()` by `AgentTask.run()`:
- `askQuestion` — promise-based: pauses loop, waits for UI answer card
- `signalCompletion` — sets a flag, loop breaks after current tool batch
- `switchMode` — schedules mode change for next iteration start
- `spawnSubtask` — creates child AgentTask, returns its output text
- `updateTodos` — publishes todo list to UI sidebar
- `onApprovalRequired` — forwards to parent's approval callback

### ToolExecutionContext (passed to each tool)
```typescript
{
  taskId: string,
  mode: string,
  callbacks: ToolCallbacks,
  askQuestion?,
  signalCompletion?,
  updateTodos?,
  switchMode?,
  spawnSubtask?,
}
```

## Key Files
- `src/core/tool-execution/ToolExecutionPipeline.ts`
- `src/core/governance/IgnoreService.ts` — path access rules
- `src/core/governance/OperationLogger.ts` — audit logging
- `src/core/checkpoints/GitCheckpointService.ts` — pre-write snapshots

## Dependencies
- `IgnoreService` (via `plugin.ignoreService`) — loaded on plugin init
- `OperationLogger` (via `plugin.operationLogger`) — loaded on plugin init
- `GitCheckpointService` (via `plugin.checkpointService`) — loaded on plugin init
- `ObsidianAgentPlugin.settings.autoApproval` — live settings read on each call
- `ObsidianAgentPlugin.settings.enableCheckpoints`

## Configuration
| Key | Default | Effect |
|-----|---------|--------|
| `autoApproval.enabled` | false | Master auto-approval toggle |
| `autoApproval.read` | true | Auto-approve read tools |
| `autoApproval.noteEdits` | false | Auto-approve note content writes |
| `autoApproval.vaultChanges` | false | Auto-approve structural changes |
| `autoApproval.web` | false | Auto-approve web tools |
| `autoApproval.mcp` | false | Auto-approve MCP tools |
| `enableCheckpoints` | true | Checkpoint before writes |

## Extension Points for Future Features
- Parallel read execution optimization already in `AgentTask` (not pipeline)
- Per-tool rate limiting could be added in step 2.5
- Audit export / streaming log viewing uses `OperationLogger`

## Known Limitations
- `snapshotedPaths` is per-pipeline-instance (per task) — correct, but means a file re-opened in a new task needs a new snapshot.
- Path validation only applies to tools with a `path` input field; tools with multiple path inputs (e.g. `move_file` with `source` and `destination`) only check `input.path` (i.e. `source`). Destination path is not separately validated.
- Approval check for `subtasks` requires parent to explicitly forward `onApprovalRequired` to child `AgentTask`. Already done in current implementation but must be maintained when adding new delegation patterns.
