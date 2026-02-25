# FEATURE: Operation Logging & Audit Trail

**Status:** Implemented
**Source:** `src/core/governance/OperationLogger.ts`

## Summary
Persistent JSONL audit trail of every tool call. Logged automatically by `ToolExecutionPipeline` after each tool execution. Logs are stored per day, retained for 30 days, and viewable in Settings → Advanced → Logs.

## How It Works

### Storage
- Path: `.obsidian/plugins/obsidian-agent/logs/YYYY-MM-DD.jsonl`
- Format: one JSON object per line (JSONL)
- Rotation: new file per calendar day
- Retention: last 30 days (older files deleted on next write)

### Log Entry Format
```typescript
{
  timestamp: string,   // ISO 8601
  taskId: string,
  mode: string,
  tool: string,
  params: Record<string, any>,  // sanitized (see below)
  success: boolean,
  durationMs: number,
  error?: string,
}
```

### Sanitization
Before logging, `params` are sanitized:
- **API keys:** any key matching `apiKey`, `key`, `token`, `password`, `secret`, `authorization` → value replaced with `"[REDACTED]"`
- **Content fields:** `content`, `text`, `body`, `data` → values truncated to first 500 chars + `"...[truncated]"`
- **URL credentials:** `https://user:pass@...` → `https://[redacted]@...`
- Objects and arrays are recursively sanitized

### Log Rotation & Cleanup
On each `log()` call:
1. Compute today's log file path
2. If day has changed since last write: check for files older than 30 days, delete them
3. Append new entry to today's file (create if missing)

### Debug Mode
When `settings.debugMode = true`: also logs to `console.log` in addition to file.

When `OperationLogger` is not initialized (plugin startup): `ToolExecutionPipeline` falls back to `console.log` with `[Pipeline]` prefix if `debugMode` is on.

## Key Files
- `src/core/governance/OperationLogger.ts`
- `src/ui/settings/LogTab.ts` — date selector, JSONL viewer, format/filter UI

## Dependencies
- `ToolExecutionPipeline.logOperation()` — called after every tool execution
- `vault.adapter.write()` / `vault.adapter.read()` — file I/O
- `vault.adapter.exists()` / `vault.adapter.list()` — for rotation/cleanup
- `ObsidianAgentPlugin.operationLogger` — singleton, initialized in `main.ts`

## Configuration
| Key | Default | Description |
|-----|---------|-------------|
| `debugMode` | false | Also log to browser console |

(Retention period = 30 days, hardcoded)

## Log Viewer (Settings → Logs)
- Select a date to view that day's log
- Entries shown as formatted cards: timestamp, tool name, mode, success/error indicator, duration
- Expandable params (sanitized) and error message
- Export button (copies raw JSONL to clipboard) — check if implemented

## Known Limitations / Edge Cases
- Large tool results are NOT logged (content truncated to 500 chars). The audit trail shows what happened but not the full output.
- Log files stored inside `.obsidian/` — synced by Obsidian Sync if enabled. Could cause unexpected log sharing between devices.
- No log encryption — sanitization removes secrets but conversation content could still be present in truncated form.
- Retention cleanup only runs on `log()` calls — if the agent hasn't been used for >30 days, no cleanup happens until next use.
- JSONL format allows corruption if a write is interrupted mid-line. No integrity check on read.
