# FEATURE: Notifications

**Status:** Implemented
**Source:** `src/ui/AgentSidebarView.ts`

## Summary
Displays an Obsidian `Notice` when an agent task completes and the sidebar is not the currently focused view. This ensures the user is notified of task completion even when working in a different pane or note.

## How It Works

### Trigger Condition
Inside the `onComplete` callback of the agentic loop (in `sendMessage()`):

```typescript
if (this.app.workspace.getMostRecentLeaf()?.view !== this) {
    new Notice('Agent task complete', 3000);
}
```

The check compares the most recently focused workspace leaf's view against the sidebar view instance. If the user has switched to a different view (e.g., editing a note, viewing another pane), a 3-second toast notification appears.

### Notification Types
The codebase uses `Notice` (Obsidian's built-in toast system) for several additional in-context notifications:

| Trigger | Message | Duration |
|---------|---------|----------|
| Task complete (unfocused) | "Agent task complete" | 3s |
| Mode switch | "Switched to {mode} mode" | default |
| Web tools enabled without provider | "Web search enabled. Set a search provider..." | default |
| Clipboard copy | "Copied." / "Copied to clipboard" | default |
| Conversation load failure | "Could not load conversation" | default |
| Semantic index actions | Various ("Reindexing...", "Index rebuilt", etc.) | default |

### No External Notification System
All notifications use Obsidian's built-in `Notice` class. There is no integration with OS-level notifications (macOS Notification Center, etc.) or sound alerts.

## Key Files
- `src/ui/AgentSidebarView.ts` — `onComplete` callback with notification logic

## Dependencies
- `obsidian.Notice` — Obsidian's built-in toast notification API
- `WorkspaceLeaf.view` — focus detection via most recent leaf comparison

## Configuration
| Key | Default | Description |
|-----|---------|-------------|
| (none) | - | Notifications are always enabled; no toggle exists |

## Known Limitations / Edge Cases
- The focus check (`getMostRecentLeaf()?.view !== this`) may not detect all cases where the user is "away" — e.g., if the sidebar is the most recent leaf but the user is looking at a different monitor.
- No OS-level notifications — the Obsidian `Notice` is only visible within the Obsidian window.
- No sound or visual persistence — the toast disappears after 3 seconds with no history or log.
- There is no per-task notification setting — all completions trigger the notice when unfocused.
- Long-running subtasks do not trigger their own completion notice — only the root task's `onComplete` fires the notification.
