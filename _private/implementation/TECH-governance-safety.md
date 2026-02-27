# Governance and Safety -- Technical Reference

> Source of truth for the IgnoreService, auto-approval system, diff review modal,
> checkpoint service, operation logger, and defense-in-depth architecture.

---

## 1. IgnoreService

**File:** `src/core/governance/IgnoreService.ts`

Controls which vault paths the agent can access. Two levels of restriction:

| Level       | Effect                                           | Config file                  |
|-------------|--------------------------------------------------|------------------------------|
| **Ignored** | Path is completely inaccessible (read and write). | `.obsidian-agentignore`      |
| **Protected** | Path is readable but never writable.            | `.obsidian-agentprotected`   |

### 1.1 Hard-coded blocks (no config needed)

These paths are always blocked regardless of any user configuration:

**Always blocked (no access at all):**
- `.git/`
- `.obsidian/workspace`
- `.obsidian/workspace.json`
- `.obsidian/cache`

**Always write-protected (readable, never writable):**
- `.obsidian-agentignore` (prevents the agent from editing its own restrictions)
- `.obsidian-agentprotected` (same rationale)

### 1.2 File format

Both `.obsidian-agentignore` and `.obsidian-agentprotected` use gitignore-style
syntax. They are read from the vault root.

```
# Lines starting with # are comments
# Empty lines are ignored

# Block an entire folder
private-journal/

# Glob patterns
*.secret
sensitive/**/*.md

# Basename matching (no slash) matches anywhere in the vault
credentials.yaml
```

Supported pattern features:
- `*` matches any characters except `/`
- `**` matches anything including `/`
- Trailing `/` means directory match (matches the folder and all children)
- Patterns without `/` match against the basename anywhere in the path
- Patterns with `/` match from the vault root

Not yet supported: `!` negation patterns (silently skipped).

### 1.3 Safety: ReDoS protection

Patterns longer than 200 characters or containing 3+ consecutive `**` sequences
are rejected to prevent Regular Expression Denial of Service attacks.

### 1.4 Fail-closed initialization

**Critical safety property:** Before `load()` completes, both `isIgnored()`
and `isProtected()` return `true` for ALL paths. This means:

- If the plugin starts and the ignore files cannot be read, NO paths are accessible.
- The agent cannot operate until the governance rules are successfully loaded.

```typescript
isIgnored(path: string): boolean {
    if (!this.loaded) return true;   // fail-closed
    // ... pattern matching
}
```

### 1.5 Integration with pipeline

The `ToolExecutionPipeline.validatePaths()` method checks every tool call:

1. If the tool's input contains a `path` parameter:
   - `isIgnored(path)` -- if true, deny with reason.
   - If the tool `isWriteOperation` AND `isProtected(path)` -- deny with reason.
2. If no `path` parameter, validation passes (non-file tools).
3. If `IgnoreService` is not loaded, validation passes (graceful degradation).

`getDenialReason(path)` provides a user-facing explanation string that is
returned to the LLM as an `<error>` block.

---

## 2. Auto-Approval System

**File:** `src/types/settings.ts` (AutoApprovalConfig) and
`src/core/tool-execution/ToolExecutionPipeline.ts` (checkApproval)

### 2.1 Configuration structure

```typescript
interface AutoApprovalConfig {
    enabled: boolean;           // Master toggle (false = all writes need approval)
    showMenuInChat: boolean;    // Show quick-toggle bar in chat view
    read: boolean;              // read_file, list_files, search_files, ...
    noteEdits: boolean;         // write_file, edit_file, append_to_file, update_frontmatter
    vaultChanges: boolean;      // create_folder, delete_file, move_file, generate_canvas, create/update_base
    web: boolean;               // web_fetch, web_search
    mcp: boolean;               // use_mcp_tool
    mode: boolean;              // switch_mode
    subtasks: boolean;          // new_task
    question: boolean;          // ask_followup_question
    todo: boolean;              // update_todo_list
    skills: boolean;            // execute_command, resolve_capability_gap, enable_plugin
    pluginApiRead: boolean;     // call_plugin_api (read methods)
    pluginApiWrite: boolean;    // call_plugin_api (write methods)
    recipes: boolean;           // execute_recipe
}
```

### 2.2 Default values (conservative)

```typescript
{
    enabled: false,         // Master toggle OFF by default
    showMenuInChat: true,
    read: true,             // Reads are always safe
    noteEdits: false,       // Writes need approval
    vaultChanges: false,    // Structural changes need approval
    web: false,             // Web access needs approval
    mcp: false,             // MCP needs approval
    mode: false,            // Mode switching needs approval
    subtasks: false,        // Sub-agent spawning needs approval
    question: true,         // Questions auto-approved
    todo: true,             // Todo updates auto-approved
    skills: true,           // Skills auto-approved
    pluginApiRead: true,    // Plugin API reads auto-approved
    pluginApiWrite: false,  // Plugin API writes need approval
    recipes: true,          // Recipes auto-approved
}
```

### 2.3 Approval decision flow

```
checkApproval(toolCall, extensions):
  |
  1. group = TOOL_GROUPS[toolCall.name]
  |
  2. Is group === 'agent'?
  |    Yes -> ALWAYS auto-approved (no config check)
  |
  3. Is cfg.enabled?
  |    Yes -> check per-group toggle:
  |           cfg.read, cfg.noteEdits, cfg.vaultChanges, cfg.web, ...
  |           Match -> auto-approved
  |           For plugin-api: split into read/write via isPluginApiWriteCall()
  |
  4. No auto-approval AND no onApprovalRequired callback?
  |    -> REJECTED (fail-closed)
  |    This is critical: prevents silent auto-approval of writes in
  |    contexts where no UI is available (e.g., headless subtasks).
  |
  5. Call extensions.onApprovalRequired(toolName, input)
     -> User decides: approved / rejected
     -> Returns ApprovalResult { decision, finalContent? }
```

### 2.4 The "agent" group exception

Tools classified as `agent` in the pipeline's `TOOL_GROUPS` are unconditionally
auto-approved. This includes: `ask_followup_question`, `attempt_completion`,
`update_todo_list`, `open_note`, `update_settings`, `configure_model`.

These tools either have no side effects (todos, completion signal) or are
essential for the conversation loop to function (asking questions).

### 2.5 Fail-closed on missing callback

When `onApprovalRequired` is undefined (e.g., in a subtask without a UI),
the pipeline **rejects** the tool call rather than silently approving it.
This prevents unauthorized vault modifications in headless execution contexts.

---

## 3. DiffReviewModal (Approval UI)

**File:** `src/ui/DiffReviewModal.ts`

Multi-file diff editor that provides the user interface for write approval
and post-task change review.

### 3.1 Two operating modes

| Mode         | Trigger                              | User actions                          |
|--------------|--------------------------------------|---------------------------------------|
| `review`     | Post-task: agent finished, user reviews all changes | Keep / Undo / Edit per section, Keep All, Undo All, Apply Selected |
| `checkpoint` | User clicks a checkpoint marker      | Read-only diff view + Restore button  |

### 3.2 Semantic section grouping

Changes are NOT shown as raw contiguous changed lines. Instead, the modal
groups diff hunks by **Markdown structure**:

- Frontmatter
- Headings (## / ### sections)
- Code blocks
- Lists
- Callouts
- Tables
- Paragraphs

Each semantic group gets its own header with a Lucide icon, stats (+N/-M),
and action buttons (Keep / Undo / Edit).

### 3.3 Side-by-side diff rendering

Within each semantic group, diff lines are rendered side-by-side:
- Left side: removed lines (old content)
- Right side: added lines (new content)
- Unchanged context lines: shown on both sides

Long runs of unchanged lines are collapsed with an expandable
"... N unchanged lines" button (threshold: `CONTEXT_LINES = 3` on each side).

### 3.4 Section editing capability

In `review` mode, the user can click "Edit" on any semantic group to open
a textarea pre-filled with the new content for that section. After editing:

1. `group.editedContent` is set to the textarea value.
2. The group is marked as `approved`.
3. The diff body re-renders to reflect the updated state.

### 3.5 Decision building and content assembly

When the user clicks "Apply Selected" or "Undo All":

1. All pending groups are auto-approved (for "Apply Selected") or rejected.
2. `buildDecisions()` iterates all files, identifies rejected or edited groups.
3. `assembleFinalContent()` reconstructs each file's content:
   - **Fast path** (no edits): Standard hunk-based assembly. Rejected hunks
     emit removed lines (old content); approved hunks emit added lines (new content).
   - **Edit path**: Tracks `newLineIndex` to splice in edited section content
     at the correct positions.
4. Returns `FileDecision[]` with `filePath`, `finalContent`, and `hasChanges`.

### 3.6 Checkpoint mode

In `checkpoint` mode, the modal shows a read-only diff with a "Restore to
this checkpoint" button. Clicking it calls `options.onRestore()` which
delegates to `GitCheckpointService.restore()`.

---

## 4. GitCheckpointService

**File:** `src/core/checkpoints/GitCheckpointService.ts`

### 4.1 Shadow repository concept

The service maintains a **shadow git repository** at:
```
.obsidian/plugins/obsidian-agent/checkpoints/
```

This is deliberately separate from any user git repo in the vault.
The shadow repo uses `isomorphic-git` (pure JavaScript, no native binary)
running on Electron's Node.js `fs` module.

**Rationale (ADR-003):** Using a shadow repo avoids polluting the user's
own git history with agent-generated commits. The checkpoint repo is purely
internal and can be safely deleted without affecting the vault.

### 4.2 Snapshot before writes

The `ToolExecutionPipeline` calls `snapshot()` before every write operation:

```typescript
// Pipeline step 4:
if (tool.isWriteOperation && settings.enableCheckpoints) {
    const path = toolCall.input?.path;
    if (path) {
        const cp = await checkpointService.snapshot(taskId, [path], toolName);
        if (cp.commitOid !== 'empty') extensions.onCheckpoint(cp);
    }
}
```

`snapshot()` flow:
1. For each file path, check if the file exists in the vault.
2. **Existing files:** Read content, copy into shadow repo at the same
   relative path, `git add`, then `git commit`.
3. **New files** (file does not exist yet): Track in `newFiles[]` array
   on the `CheckpointInfo`. Restore = delete these files.
4. If no files were staged and no new files tracked, return a marker
   checkpoint with `commitOid: 'empty'`.

### 4.3 CheckpointInfo structure

```typescript
interface CheckpointInfo {
    taskId: string;
    commitOid: string;         // Git commit hash, or 'empty'/'none'
    timestamp: string;         // ISO 8601
    filesChanged: string[];    // Vault-relative paths of existing files
    toolName?: string;         // Which tool triggered this checkpoint
    newFiles?: string[];       // Files that didn't exist before (restore = delete)
}
```

### 4.4 In-memory tracking

Checkpoints are tracked per task in a `Map<string, CheckpointInfo[]>`.
This allows fast lookups during the active session without scanning the git log.

### 4.5 Restore capability

Three restore methods:

| Method                     | Use case                                           |
|----------------------------|----------------------------------------------------|
| `restore(checkpoint)`      | Restore a specific checkpoint (used by DiffReviewModal) |
| `restoreToCheckpoint(cp)`  | Alias for `restore()` (used by checkpoint markers)  |
| `restoreLatestForTask(id)` | Restore the earliest checkpoint for a task (full undo) |

Restore flow for existing files:
1. `git.readBlob()` from the shadow repo at the checkpoint's commit OID.
2. Write content back into the vault via `vault.modify()` or `vault.adapter.write()`.

Restore flow for new files (files created by the agent):
1. Look up the file in the vault.
2. `vault.delete()` to remove it.

### 4.6 Post-restart recovery

If the plugin restarts mid-task, in-memory checkpoints are lost. The service
falls back to scanning `git.log()` for commits with the `checkpoint:{taskId}`
message prefix. This scan has no depth limit to ensure recovery.

### 4.7 Configuration

| Setting                      | Default | Description                          |
|------------------------------|---------|--------------------------------------|
| `enableCheckpoints`          | `true`  | Master toggle                        |
| `checkpointTimeoutSeconds`   | `30`    | Timeout for file read operations     |
| `checkpointAutoCleanup`      | `true`  | Clean up old commits after task ends |

---

## 5. OperationLogger

**File:** `src/core/governance/OperationLogger.ts`

### 5.1 JSONL format

Every tool execution is logged as a single JSON line in a daily file:

```
.obsidian/plugins/obsidian-agent/logs/YYYY-MM-DD.jsonl
```

Each line contains a `LogEntry`:

```typescript
interface LogEntry {
    timestamp: string;         // ISO 8601
    taskId: string;            // Which AgentTask
    mode: string;              // Active mode slug
    tool: string;              // Tool name
    params: Record<string, any>; // Sanitized input parameters
    result?: string;           // Truncated result (max 2000 chars)
    success: boolean;          // Whether execution succeeded
    durationMs: number;        // Wall-clock execution time
    error?: string;            // Error message (if failed)
}
```

### 5.2 Parameter sanitization (H-5)

Before writing to disk, `sanitizeParams()` applies these rules:

| Key pattern           | Action                                         |
|-----------------------|------------------------------------------------|
| password, token, api_key, secret, key, auth, authorization | Replace with `[REDACTED]` |
| content, new_str, old_str (file content) | Replace with `[N chars]`   |
| url                   | Strip credentials from URL                     |
| Any string > 500 chars| Truncate to 500 chars                          |
| Everything else       | Pass through unchanged                         |

### 5.3 File rotation

- **Retention:** 30 days (`MAX_LOG_DAYS`).
- **Trigger:** When a new day's log file is created, `rotateLogs()` runs
  asynchronously. It lists all `.jsonl` files, sorts by date, and deletes
  files beyond the 30-day window.
- **Append performance:** Uses `vault.adapter.append()` for true O(1) appends
  (no full-file rewrite).

### 5.4 Resilience

Logging never breaks agent execution. All log operations are wrapped in
try-catch blocks with console warnings. If the log directory does not exist,
`initialize()` creates it.

---

## 6. Defense in Depth -- The 4-Layer Security Model

The governance system implements four independent layers of protection.
A tool call must pass ALL layers to execute:

```
Layer 1: MODE FILTERING (ModeService)
  |  Which tools does the active mode allow?
  |  Ask mode: no write tools. Agent mode: all tools.
  |  -> Filters tool definitions sent to the LLM.
  |     The LLM cannot call tools it does not see.
  |
Layer 2: PATH GOVERNANCE (IgnoreService)
  |  Is the target path blocked or protected?
  |  Hard blocks: .git/, .obsidian/workspace, .obsidian/cache
  |  User blocks: .obsidian-agentignore, .obsidian-agentprotected
  |  -> Fail-closed: blocks everything until rules are loaded.
  |
Layer 3: APPROVAL GATE (AutoApprovalConfig + DiffReviewModal)
  |  Does this operation category require user approval?
  |  Master toggle + per-category toggles.
  |  -> Fail-closed: rejects when no approval callback is available.
  |
Layer 4: CHECKPOINT + UNDO (GitCheckpointService)
     Even after approval, every write is snapshotted.
     User can review changes and restore any checkpoint.
     -> Last line of defense: reversible operations.
```

### 6.1 Why four layers?

Each layer addresses a different attack vector:

- **Layer 1** prevents the LLM from even considering restricted tools.
- **Layer 2** prevents path traversal and access to sensitive vault areas.
- **Layer 3** gives the user a per-operation veto with full diff visibility.
- **Layer 4** provides recovery when approval was granted but the result is
  unwanted.

No single layer is sufficient. Together they provide robust protection.

---

## 7. Consecutive Mistake Limit

**File:** `src/core/AgentTask.ts`

### 7.1 How it works

AgentTask tracks a `consecutiveMistakes` counter that increments on every
tool error and resets to 0 on every success:

```typescript
if (result.is_error) {
    consecutiveMistakes++;
} else {
    consecutiveMistakes = 0;
}

if (consecutiveMistakeLimit > 0
    && consecutiveMistakes >= consecutiveMistakeLimit) {
    throw new Error(
        `Agent stopped after ${consecutiveMistakes} consecutive errors. ...`
    );
}
```

### 7.2 Configuration

| Setting                          | Default | Location                    |
|----------------------------------|---------|-----------------------------|
| `advancedApi.consecutiveMistakeLimit` | `3` | Settings -> Advanced API     |

When set to 0, the limit is disabled and the agent continues regardless
of errors (up to `maxIterations`).

### 7.3 Purpose

Prevents the agent from burning API tokens in an error loop. Common
scenarios where this triggers:

- The LLM repeatedly calls a tool with invalid parameters.
- A path is blocked by IgnoreService and the LLM keeps retrying.
- A network-dependent tool (web_fetch) fails repeatedly.

The error message is surfaced to the user via `onError` and includes
guidance to check tool results or raise the limit in settings.

### 7.4 Interaction with ToolRepetitionDetector

The consecutive mistake limit and the repetition detector are independent
safety nets:

| Mechanism               | Trigger                              | Action                        |
|-------------------------|--------------------------------------|-------------------------------|
| ConsecutiveMistakeLimit | N consecutive tool errors (any tool) | Throws, stops entire task     |
| ToolRepetitionDetector  | Same tool+input 3x in 10-call window| Returns error, signals completion |

Both can fire in the same session. The repetition detector fires first
(before execution) while the mistake limit fires after execution.

---

## 8. Additional Safety Mechanisms

### 8.1 Max iterations

`advancedApi.maxIterations` (default: 25, range: 5-50) caps the total number
of agentic loop iterations per message. Prevents runaway loops even if neither
the repetition detector nor the mistake limit fires.

### 8.2 Sub-agent depth guard

`advancedApi.maxSubtaskDepth` (default: 2) limits nesting of sub-agents.
When a child task is at `depth >= maxSubtaskDepth`, the `spawnSubtask`
extension is set to `undefined`, making `new_task` unavailable. This prevents
exponential sub-agent proliferation.

### 8.3 Abort signal

Every `AgentTask.run()` call accepts an optional `AbortSignal`. When the user
clicks "Stop" in the UI, the signal is triggered. The task checks for
`abortSignal.aborted` at the start of each iteration and between tool calls.
Abort errors are treated as non-errors (task completes gracefully).

### 8.4 Orphaned tool call cleanup

If an error occurs after the assistant's tool_call message was pushed to
history but before tool results were added, the task removes orphaned
assistant messages from the tail of the history. This prevents OpenAI-format
API errors ("tool_calls must be followed by tool messages") on the next
user message in the same conversation.
