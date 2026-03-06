# FEATURE: Parallel Tool Execution

**Status:** Implemented
**Source:** `src/core/AgentTask.ts`

## Summary
Read-only tools are executed in parallel via `Promise.all` when the LLM requests multiple tool calls in a single response. Write tools and control-flow tools always execute sequentially to preserve ordering guarantees and approval workflows.

## How It Works

### PARALLEL_SAFE Set
A static set defines which tools are safe for concurrent execution:

```typescript
const PARALLEL_SAFE = new Set([
    'read_file', 'list_files', 'search_files', 'get_frontmatter',
    'get_linked_notes', 'search_by_tag', 'get_vault_stats', 'get_daily_note',
    'web_fetch', 'web_search',
    'semantic_search', 'query_base', 'open_note',
]);
```

These are all pure-read operations with no side effects on vault state.

### Decision Logic
After collecting all tool calls from a single LLM response:

```typescript
const allParallelSafe = validToolUses.length > 1
    && validToolUses.every(t => PARALLEL_SAFE.has(t.name));
```

**Parallel execution** occurs only when:
1. There are 2+ tool calls in the response
2. ALL tool calls are in the `PARALLEL_SAFE` set

If any single tool is not parallel-safe (write tool, control-flow tool, or mixed batch), the entire batch falls back to sequential execution.

### Parallel Path
```typescript
const results = await Promise.all(validToolUses.map(runTool));
```

All tools execute concurrently. After all promises resolve, results are iterated in original order to:
1. Fire `onToolResult` callbacks sequentially (preserves FIFO ordering for UI)
2. Track consecutive mistake counts
3. Build `tool_result` content blocks for the history

### Sequential Path
```typescript
for (const toolUse of validToolUses) {
    const result = await runTool(toolUse);
    // ... process result, check for completion signal
    if (completionResult !== null) break;
}
```

Tools execute one at a time. After each tool:
- `onToolResult` is called immediately
- Consecutive mistake count is updated
- If `attempt_completion` was signaled, remaining tools are skipped

### Error Handling
Both paths share the same error tracking:
- `consecutiveMistakes` counter increments on tool errors, resets on success
- If `consecutiveMistakeLimit > 0` and the counter reaches the limit, an error is thrown to abort the task

## Key Files
- `src/core/AgentTask.ts` — `PARALLEL_SAFE` set definition, parallel/sequential branching logic

## Dependencies
- `ToolExecutionPipeline.executeTool()` — individual tool execution (same for both paths)
- `AgentTaskCallbacks.onToolResult` — UI notification (called sequentially even for parallel results)
- `ToolRepetitionDetector` — checks for repetitive tool loops before execution (applies to both paths)

## Configuration
| Key | Default | Description |
|-----|---------|-------------|
| (none) | - | Parallel execution is always enabled; no toggle exists |

## Known Limitations / Edge Cases
- The parallel-safe classification is hardcoded — new read tools must be manually added to the `PARALLEL_SAFE` set.
- Mixed batches (e.g., 3 reads + 1 write) fall back entirely to sequential — no partial parallelism.
- `onToolResult` callbacks are always fired sequentially after parallel execution, which means the UI sees results in the original order even though execution order may differ.
- Parallel execution does not provide per-tool timeout — if one read hangs, all parallel results are delayed.
- The `PARALLEL_SAFE` set includes `web_fetch` and `web_search`, which involve network I/O. These are safe for parallelism but can have variable latency.
- Only tool calls within a single LLM response are considered for parallelism — tools across different iterations always run sequentially.
