# FEATURE: Context Condensing & Power Steering

**Status:** Implemented
**Source:** `src/core/AgentTask.ts` (condenseHistory, powerSteering)

## Summary
Two mechanisms to keep long-running agent tasks effective: **Context Condensing** summarizes conversation history when the context window fills up, and **Power Steering** periodically reinjects the mode's role definition to keep the agent on task.

## Context Condensing

### Trigger
Checked after each agentic iteration (after tool results are pushed to history):
```typescript
estimatedTokens = sum(charLength / 4) for all history messages
contextWindow = model.info.contextWindow ?? 200k (claude) / 128k (others)
threshold = contextWindow * (condensingThreshold / 100)
if (estimatedTokens > threshold) → condenseHistory()
```

- `condensingEnabled` must be true (default: true)
- Only fires on iterations > 0 (never on the very first response)
- Does NOT fire if `completionResult !== null` (task already ending)

### condenseHistory() Process
1. Keep `history[0]` (original user message — preserves task context)
2. Keep last 4 messages (recent context — prevents losing in-progress work)
3. Summarize `history[0..-4]` (the middle) via a separate LLM call:
   ```
   "Summarize this conversation compactly. Preserve:
   - The original task and goal
   - Key decisions made
   - Files read, created, or modified (include exact paths)
   - Important findings, code snippets, or facts discovered
   - Errors encountered and how they were resolved"
   ```
4. Replace history in-place:
   ```
   [firstMsg, assistantSummary, userAck, ...tail4]
   ```
5. On condensing failure (network error, abort): history unchanged (non-fatal)
6. Triggers `onContextCondensed()` callback → UI shows indicator

### Token Estimation
Rough estimate: `ceil(totalChars / 4)` — adequate for threshold checks, not billing.
Model context windows:
- `claude` model IDs → 200,000 tokens
- `gpt-4`, `gpt-5` → 128,000 tokens
- fallback → 128,000 tokens

---

## Power Steering

### Trigger
At the start of each iteration (before API call), when:
```typescript
powerSteeringFrequency > 0
&& iteration > 0
&& iteration % powerSteeringFrequency === 0
```

### Injection
Pushes a synthetic `user` message into history:
```
[Power Steering Reminder]

You are operating in **{mode.name}** mode.

{mode.roleDefinition}

Continue the task.
```

Effect: the model "re-reads" its role instructions periodically. Helps with:
- Long tasks where the model drifts from its role
- Modes with specific formatting requirements that get ignored after many iterations
- Preventing "task creep" in orchestrator patterns

---

## Key Files
- `src/core/AgentTask.ts` — `condenseHistory()`, `estimateTokens()`, `getModelContextWindow()`, power steering injection
- `src/ui/settings/LoopTab.ts` — settings UI

## Dependencies
- `ApiHandler.createMessage()` — separate LLM call for summarization (uses same model)
- `AgentTask.api` — condensing uses the same API instance
- `ModeConfig.roleDefinition` — power steering content
- `onContextCondensed` callback → UI indicator

## Configuration
| Key | Default | Description |
|-----|---------|-------------|
| `advancedApi.condensingEnabled` | true | Enable context condensing |
| `advancedApi.condensingThreshold` | 70 | % of context window (50–95) |
| `advancedApi.powerSteeringFrequency` | 0 | Inject reminder every N iterations (0=disabled) |

## Sub-task Behavior
Child tasks spawned via `new_task` do NOT condense or power-steer:
```typescript
new AgentTask(api, registry, callbacks, modeService,
  consecutiveMistakeLimit, rateLimitMs,
  false, 70, 0  // condensingEnabled=false, threshold=70, powerSteering=0
)
```
Keeps child loops lean and prevents recursive condensing.

## Emergency Condensing (400 Error Recovery)

When the API call fails with a 400 error indicating context overflow (`context_length_exceeded`, `prompt too long`, `too many tokens`, `token limit`, `request too large`), and history has >= 7 messages, `condenseHistory()` is triggered as emergency recovery in the outer catch block of `AgentTask.run()`.

- **Auto-Retry**: On success, the agent loop restarts automatically with the condensed history (max 1 retry). The user does NOT need to resend their message.
- Pre-Compaction Memory Flush (`onPreCompactionFlush`) runs before emergency condensing to preserve facts.
- On failure: falls through to normal error handling
- Uses `cachedSystemPrompt` (outer scope) since the catch block is outside the iteration loop

This prevents total task abortion on unexpected context overflow (e.g., very large tool results in a single turn that exceed the proactive threshold check).

## Known Limitations / Edge Cases
- Token estimation (~4 chars/token) can be off by 50-100% for non-English content, code-heavy conversations, or messages with images. Consider using `usage` stream chunks for accurate tracking.
- Condensing call uses no tools (empty tools list) and no system prompt structuring — may produce inconsistent summaries across runs.
- If proactive condensing fails silently (e.g. API timeout), history grows unchecked — but emergency condensing in the catch block provides a safety net for 400 errors.
- Condensing supports multi-pass (up to 2 retries per checkpoint) if one pass is not enough.
- Power Steering synthetic messages accumulate in history — not removed after the summary point. Could slightly inflate token count over very long tasks.
- History preservation uses smart tail (up to 10k tokens, min 2 messages). For tasks with very long tool outputs, the tail may still not capture enough context.
