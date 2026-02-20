# FEATURE: Checkpoints (Undo / Restore)

**Status:** Implemented (replaces old requirements spec)
**Source:** `src/core/checkpoints/GitCheckpointService.ts`

## Summary
Automatic pre-task snapshots using a shadow git repository. Before the first write operation of any task, all affected files are committed to an isomorphic-git repo. Users can restore files to their pre-task state from Settings → Advanced → Backup.

## How It Works

### Shadow Repository
- Location: `.obsidian/plugins/obsidian-agent/checkpoints/` (absolute path via `vault.adapter.basePath`)
- Technology: `isomorphic-git` — pure JavaScript, no native git binary needed
- Initialized with `defaultBranch: 'main'` on first use
- Completely separate from vault's own git history (if any)

### Snapshot Process (`snapshot(taskId, filePaths)`)
1. Read current file content from vault (`vault.adapter.read`)
2. Write file into shadow repo directory structure (mirrors vault paths)
3. `git.add()` the file into the shadow repo index
4. After all files are staged: `git.commit()` with message `"snapshot:${taskId}"`
5. Returns `CheckpointInfo { taskId, commitOid, timestamp, filesChanged[] }`

**Called by:** `ToolExecutionPipeline.executeTool()` before the first write to each unique path per task. Each path is snapshotted at most once per task (`snapshotedPaths: Set<string>`).

**Timeout:** Configurable `checkpointTimeoutSeconds` (default 30s). If snapshot exceeds timeout, task continues without checkpoint (non-fatal). Implemented via `withTimeout()` helper.

### Restore Process

**`restore(checkpoint)`:**
1. Walk `checkpoint.filesChanged[]`
2. For each file: `git.readBlob()` from the commit OID
3. Write blob content back to vault via `vault.adapter.write()`
4. Deleted files (blob not in commit): moved to trash via `vault.trash()`
5. Returns `RestoreResult { restored[], errors[] }`

**`restoreLatestForTask(taskId)`:**
1. Scan last 200 commits in shadow repo
2. Find all commits matching `"snapshot:${taskId}"`
3. Restore from the EARLIEST matching commit (true pre-task state)

### Diff (`diff(checkpoint)`)
Reads current vault file content vs. snapshot content:
- Line-by-line comparison
- Returns `+added` / `-removed` summary for each file
- Used in Settings → Backup "Preview" before restore

### Cleanup (`cleanup(taskId)`)
Currently a no-op placeholder. Auto-cleanup configured via `checkpointAutoCleanup` setting but actual git GC/pack not implemented (isomorphic-git lacks native GC). Old snapshots accumulate as git objects.

### Listing Checkpoints
`listCheckpoints()` — scans commit log (last 200 commits), groups by taskId, returns `CheckpointInfo[]` sorted by timestamp. Used by Settings → Backup tab.

## Key Files
- `src/core/checkpoints/GitCheckpointService.ts`
- `src/ui/settings/BackupTab.ts` — list, preview diff, restore button
- `src/core/tool-execution/ToolExecutionPipeline.ts` — calls `snapshot()` in step 4

## Dependencies
- `isomorphic-git` npm package — pure JS git
- `require('fs')` (Electron Node.js) — `getFs()` helper provides Node.js fs to isomorphic-git
- `vault.adapter.basePath` — converts vault-relative paths to absolute
- `ToolExecutionPipeline` — calls snapshot on first write per path per task
- `ObsidianAgentPlugin.settings.enableCheckpoints`
- `ObsidianAgentPlugin.settings.checkpointTimeoutSeconds`
- `ObsidianAgentPlugin.settings.checkpointAutoCleanup`

## Configuration
| Key | Default | Description |
|-----|---------|-------------|
| `enableCheckpoints` | true | Master toggle |
| `checkpointTimeoutSeconds` | 30 | Max snapshot wait time |
| `checkpointAutoCleanup` | true | Remove old checkpoints (not yet implemented) |

## Restore Scope
Restoring a checkpoint restores ONLY the files changed in that specific task:
- Files edited → restored to pre-edit content
- Files created → moved to Obsidian trash
- Files deleted → restored from snapshot content

## Known Limitations / Edge Cases
- `cleanup()` / auto-cleanup is a no-op — shadow repo will grow indefinitely. Consider implementing `git gc --aggressive` or pruning old commits manually.
- 200 commit scan limit for `restoreLatestForTask` / `listCheckpoints` — could miss old checkpoints on vaults with many tasks.
- Snapshot only covers `toolCall.input.path` (single path). Multi-path tools (e.g., `move_file` affects source + destination) only snapshot the source path.
- Shadow repo uses `vault.adapter.basePath` which is only available in Electron (desktop). Not compatible with Obsidian Mobile without an alternative path strategy.
- No diff for binary files (images, PDFs) — text-only diff.
- File encoding: reads/writes as UTF-8 strings. Binary files in checkpoints may be corrupted.
