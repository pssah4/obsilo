# FEATURE: Tool Repetition Detection

**Status:** Implemented
**Source:** `src/core/tool-execution/ToolRepetitionDetector.ts`

## Summary
Detects when the agent calls the same tool with identical input 3+ times within a sliding window of 10 calls. When triggered, the agent is force-stopped with an error message instructing it to try a different approach.

## How It Works

### Detection Logic
`ToolRepetitionDetector.check(toolName, input)`:
```typescript
private recentCalls: string[] = [];
private readonly windowSize = 10;
private readonly maxRepetitions = 3;

check(toolName, input): boolean {
    const key = `${toolName}:${JSON.stringify(input)}`;
    this.recentCalls.push(key);
    if (this.recentCalls.length > this.windowSize) this.recentCalls.shift();
    return this.recentCalls.filter((k) => k === key).length >= this.maxRepetitions;
}
```

1. Build key: `"toolName:{json-serialized-input}"`
2. Push into sliding window of last 10 calls
3. Count occurrences of this key in the window
4. If count >= 3: return `true` (loop detected)

**Important:** NOT strictly "consecutive" — the tool can appear 3+ times anywhere within the last 10 calls (interspersed with other tools). The error message says "in a row" but the implementation is a sliding window.

### Counter Threshold
Hardcoded at 3 consecutive identical calls. Not configurable.

### Integration in AgentTask
Called in `runTool()` before the tool executes:
```typescript
if (repetitionDetector.check(toolUse.name, toolUse.input)) {
  const errorContent = `<error>Tool loop detected: "${toolUse.name}" was called
    with identical input 3 times in a row. Try a different approach
    or use attempt_completion.</error>`;
  signalCompletion('aborted: tool repetition loop');
  return { content: errorContent, is_error: true };
}
```

When triggered:
1. Returns an error tool result (not an exception)
2. Calls `signalCompletion('aborted: tool repetition loop')` → breaks the agentic loop after current batch
3. Error is included in conversation history (the LLM sees why it was stopped)

### Reset Triggers
`repetitionDetector.reset()` called:
- When a mode switch is applied (`pendingModeSwitch` processed at iteration start)
- On `AgentTask` instance creation (new instance = fresh detector)

### Scope
One `ToolRepetitionDetector` instance per `AgentTask.run()` invocation. Sub-tasks (spawned via `new_task`) get their own child `AgentTask` instance with a fresh detector.

## Key Files
- `src/core/tool-execution/ToolRepetitionDetector.ts`
- `src/core/AgentTask.ts` — calls `repetitionDetector.check()` in `runTool()`

## Dependencies
- `AgentTask` — instantiated and used entirely within `AgentTask.run()`
- No external dependencies

## Known Limitations / Edge Cases
- Detection is purely syntactic (JSON string equality). If the agent calls the same tool with slightly different whitespace or key ordering in input, it won't be detected.
- Sliding window (not consecutive) — if the agent alternates A, B, A, B, A: if B appears fewer than 3 times, only A would be detected. Pattern A, B, A, B, A, B, A (within 10 calls) would detect both A and B at 3+ occurrences.
- Threshold of 3 is hardcoded — could be useful to make configurable (some tools like `edit_file` may legitimately need 2 retries).
- `signalCompletion` is called but the error IS added to history — the agent may attempt to recover in a future message (same conversation, next user turn) if the history still contains the loop. That's intentional.
