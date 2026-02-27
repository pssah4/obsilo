# FEATURE: Diff Stats Badge

**Status:** Implemented
**Source:** `src/core/tools/vault/WriteFileTool.ts`, `src/core/tools/vault/EditFileTool.ts`, `src/core/tools/vault/AppendToFileTool.ts`, `src/core/utils/diffLines.ts`, `src/ui/AgentSidebarView.ts`

## Summary
Write operations (write_file, edit_file, append_to_file) append a `<diff_stats>` tag to their tool results. The sidebar UI parses this tag and renders a compact `+N / -N` badge on the tool result summary, giving the user immediate visual feedback about the scope of changes.

## How It Works

### Tool-Side: Generating Diff Stats

Each write tool computes line-level diff statistics and appends them as a self-closing XML tag to the tool result:

**WriteFileTool:**
- **File update (existing):** Compares line count before and after
  ```
  added = max(0, afterLines - beforeLines)
  removed = max(0, beforeLines - afterLines)
  ```
- **File create (new):** `added = newLines`, `removed = 0`
- Appended as: `\n<diff_stats added="N" removed="N"/>`

**EditFileTool:**
- Uses `diffNums()` helper: compares old content vs new content line counts
- Also has `diffStats()` for human-readable summary (e.g., "+3 lines")
- Applies to both exact match and fuzzy (normalized whitespace) match replacements

**AppendToFileTool:**
- Counts lines in the appended content as `added`, `removed = 0`

### Diff Engine: `diffLines.ts`

A Myers diff algorithm implementation (LCS-based) that produces line-level diffs:

```typescript
interface DiffLine {
    type: 'added' | 'removed' | 'unchanged';
    content: string;
}

interface DiffStats {
    added: number;
    removed: number;
}
```

`getDiffStats(lines)` counts added and removed lines from the diff output. This is used by the `DiffReviewModal` for more detailed diff views, while the write tools use simpler line-count arithmetic.

### UI-Side: Rendering the Badge

In `AgentSidebarView.ts`, when rendering tool results:

1. **Parse:** Regex extracts the diff_stats tag:
   ```typescript
   const diffMatch = content.match(/<diff_stats added="(\d+)" removed="(\d+)"\/>/);
   ```

2. **Strip:** The tag is removed from the displayed content:
   ```typescript
   displayContent = content.replace(/\n?<diff_stats[^/]*\/>/g, '');
   ```

3. **Render Badge:** If non-zero stats exist and the result is not an error:
   ```typescript
   const badge = summary.createSpan('tool-diff-badge');
   const parts: string[] = [];
   if (diffAdded > 0) parts.push(`+${diffAdded}`);
   if (diffRemoved > 0) parts.push(`-${diffRemoved}`);
   badge.setText(parts.join(' / '));
   ```

The badge is appended to the `<summary>` element of the tool result `<details>` block, appearing inline next to the tool name.

### Visual Example
```
[write_file] File updated: notes/example.md  +5 / -2
```

## Key Files
- `src/core/tools/vault/WriteFileTool.ts` — generates diff_stats for write/create
- `src/core/tools/vault/EditFileTool.ts` — generates diff_stats for edit operations
- `src/core/tools/vault/AppendToFileTool.ts` — generates diff_stats for append operations
- `src/core/utils/diffLines.ts` — Myers diff algorithm, `DiffStats` type
- `src/ui/AgentSidebarView.ts` — parses and renders the badge
- `src/ui/DiffReviewModal.ts` — uses full diff output for detailed review

## Dependencies
- Write tools (`WriteFileTool`, `EditFileTool`, `AppendToFileTool`) — produce the tag
- `AgentSidebarView` — consumes and renders the tag
- CSS class `tool-diff-badge` — styling for the badge element

## Configuration
| Key | Default | Description |
|-----|---------|-------------|
| (none) | - | Diff stats are always generated; no toggle exists |

## Known Limitations / Edge Cases
- WriteFileTool uses a simple line-count difference rather than a true line-level diff — an edit that replaces 5 lines with 5 different lines shows `+0 / -0` even though content changed.
- EditFileTool's `diffNums()` also uses line-count arithmetic, not the Myers diff from `diffLines.ts`. The more accurate `getDiffStats()` is available but not used by the tools themselves.
- The `<diff_stats>` tag is embedded in the tool result string — if the LLM re-quotes or reformats tool results, the tag may not parse correctly.
- Badge only shows when the tool result is rendered as a standalone `<details>` block — results rendered inline or in other formats do not show the badge.
- No badge is shown when both added and removed are 0 (no-op edits).
