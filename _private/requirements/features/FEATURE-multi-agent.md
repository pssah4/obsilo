# FEATURE: Multi-Agent (new_task)

**Status:** Implemented
**Source:** `src/core/tools/agent/NewTaskTool.ts`, `src/core/AgentTask.ts`

## Summary
Enables agentic workflow patterns (Prompt Chaining, Orchestrator-Worker, Evaluator-Optimizer, Routing) by spawning child agent tasks. The parent agent delegates work via the `new_task` tool, and the child runs with a fresh conversation history, returning its complete response as context for the parent's next step.

## How It Works

### Tool: `new_task`
Only available in **Agent mode**. Accepts two parameters:
- `mode`: `"agent"` (full capabilities) or `"ask"` (read-only vault queries)
- `message`: Complete task description for the child (must include all context — child cannot see parent conversation)

### Subtask Spawning (AgentTask.run)
When `new_task` is invoked, the pipeline calls `context.spawnSubtask(mode, message)`:

1. A new `AgentTask` instance is created with:
   - Same API handler, tool registry, and mode service as the parent
   - Same consecutive mistake limit and rate limit
   - **No condensing** (`condensingEnabled = false`)
   - **No power steering** (`powerSteeringFrequency = 0`)
   - Incremented depth (`parentDepth + 1`)
   - Same `maxSubtaskDepth` limit
   - Fresh empty history array

2. The child task runs its full agentic loop (streaming, tool calls, etc.)

3. All child text output is accumulated and returned to the parent as the tool result:
   ```
   [Sub-agent completed -- mode: {mode}]

   {child response text}
   ```

4. Child tool events are forwarded to the parent's UI with `[subtask]` prefix for visibility

5. Child token usage is forwarded to the parent for accurate cost tracking

### Depth Guard
Prevents infinite recursion:
```typescript
const childDepth = this.depth + 1;
const childCanSpawn = childDepth < this.maxSubtaskDepth;

// Children at max depth get spawnSubtask = undefined
spawnSubtask: childCanSpawn ? spawnSubtask : undefined
```

When `spawnSubtask` is `undefined`, the NewTaskTool returns:
```
"Maximum sub-agent nesting depth reached. Execute this task directly using your available tools."
```

### Mode Restriction
Only `agent` and `ask` modes are allowed as sub-agent targets (enforced by `ALLOWED_SUB_MODES` set). Other mode slugs are rejected with an error.

### Approval Forwarding
The parent's `onApprovalRequired` callback is forwarded to child tasks so that write operations in subtasks are not auto-rejected by the fail-closed fallback in the ToolExecutionPipeline.

## Key Files
- `src/core/tools/agent/NewTaskTool.ts` — Tool definition and execution
- `src/core/AgentTask.ts` — `spawnSubtask` closure, depth guard logic, child task construction

## Dependencies
- `AgentTask` — child task is a full AgentTask instance with the same API/registry
- `ToolExecutionPipeline` — child gets its own pipeline instance per task
- `ModeService` — resolves child mode to ModeConfig
- Parent callbacks — `onToolStart`, `onToolResult`, `onUsage`, `onApprovalRequired` forwarded

## Configuration
| Key | Default | Description |
|-----|---------|-------------|
| `advancedApi.maxSubtaskDepth` | 2 | Maximum nesting depth (0 = root only, 2 = root + 2 child levels) |
| `advancedApi.maxIterations` | 25 | Max iterations per task (applies to children too) |
| `autoApproval.subtasks` | false | Auto-approve subtask spawning without user confirmation |

## Known Limitations / Edge Cases
- Child tasks have no condensing or power steering — long-running subtasks may hit context limits without recovery.
- Child conversation history is discarded after completion. Only the accumulated text response is returned to the parent.
- All child text is concatenated into a single string — structured data or multi-step results may be hard to parse.
- Tool events from children are prefixed `[subtask]` but there is no nesting indicator for grandchildren (depth 2+).
- If a child task errors out, the error is propagated as a tool error to the parent — the parent may retry or fail.
- The depth guard is enforced by passing `undefined` for `spawnSubtask` — the child still has the tool definition but will get a runtime error message.
