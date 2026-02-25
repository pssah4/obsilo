# FEATURE: Agent Core Loop

**Status:** Implemented
**Source:** `src/core/AgentTask.ts`

## Summary
The central agentic loop that drives all AI interactions. Sends messages to an LLM, streams responses (text + tool calls), executes tools, and iterates until the task is complete.

## How It Works

### Loop Mechanics
1. User message → pushed onto `history[]` (shared, mutated in-place across calls)
2. `api.createMessage(systemPrompt, history, tools)` — streams chunks
3. Chunks: `text` (streamed to UI), `thinking` (extended thinking), `tool_use` (queued), `usage` (token count)
4. After stream: assistant message pushed to history
5. If no tool calls → loop ends (natural end_turn)
6. Tools execute → `tool_result` blocks pushed to history → next iteration
7. `MAX_ITERATIONS = 10` hard cap prevents runaway loops

### Parallel Tool Execution
Read-only tools (`read_file`, `list_files`, `search_files`, `get_frontmatter`, `get_linked_notes`, `search_by_tag`, `get_vault_stats`, `get_daily_note`, `web_fetch`, `web_search`) execute in parallel via `Promise.all()` when the model calls multiple of them in one turn. Write tools and mixed batches always run sequentially.

### Control Flow Signals
- `signalCompletion(result)` — set by `attempt_completion` tool, breaks the loop after current tool batch
- `pendingModeSwitch` — set by `switch_mode` tool, applied at start of next iteration (triggers system prompt rebuild)
- AbortSignal — passed through to `api.createMessage()`, throws `AbortError` (handled gracefully, calls `onComplete`)

### System Prompt Caching
`cachedSystemPrompt` and `cachedTools` are rebuilt only when `activeMode.slug` changes. This avoids rebuilding on every iteration for long-running tasks.

### Consecutive Mistake Limit
`consecutiveMistakeLimit` (default 3, 0=disabled): after N consecutive tool errors, throws with a user-readable message. Counter resets on any successful tool call.

### Rate Limiting
`rateLimitMs` (default 0): `setTimeout(rateLimitMs)` between iterations. Used to avoid hitting API rate limits on fast local models.

### Orphaned Message Cleanup
On error, scans history backward and removes orphaned `assistant` messages that contain `tool_use` blocks without matching `tool_result` responses. Required for OpenAI-compatible providers (strict API validation).

### Sub-task Spawning
`spawnSubtask(mode, message)` creates a child `AgentTask` with a **fresh history** and returns its accumulated text output. Child shares the parent's `api`, `toolRegistry`, and `onApprovalRequired` callback. Child does NOT condense or power-steer (lean by design).

## Key Files
- `src/core/AgentTask.ts` — main loop, context condensing, sub-task spawning
- `src/core/systemPrompt.ts` — system prompt builder (called by `rebuildPromptCache`)
- `src/core/tool-execution/ToolExecutionPipeline.ts` — all tool calls routed here

## Dependencies
- `ApiHandler` (from `src/api/`) — provider-agnostic streaming interface
- `ToolRegistry` — tool lookup and definition list
- `ToolExecutionPipeline` — approval, checkpoint, logging wrapper
- `ModeService` — mode resolution and tool filtering
- `ToolRepetitionDetector` — loop detection (3 identical calls → abort)

## Configuration (Settings Keys)
| Key | Type | Default | Effect |
|-----|------|---------|--------|
| `advancedApi.consecutiveMistakeLimit` | number | 3 | Stop after N consecutive errors |
| `advancedApi.rateLimitMs` | number | 0 | ms between iterations |
| `advancedApi.condensingEnabled` | boolean | false | Enable context condensing |
| `advancedApi.condensingThreshold` | number | 80 | % of context window to trigger condensing |
| `advancedApi.powerSteeringFrequency` | number | 0 | Inject mode reminder every N iterations |

## Callbacks (AgentTaskCallbacks)
| Callback | When |
|----------|------|
| `onIterationStart(n)` | Start of each iteration |
| `onText(text)` | Each streamed text chunk |
| `onThinking(text)` | Extended thinking chunks |
| `onToolStart(name, input)` | Before tool executes |
| `onToolResult(name, content, isError)` | After tool finishes |
| `onUsage(input, output)` | Cumulative token count at task end |
| `onComplete()` | Task finished (normal or cancelled) |
| `onAttemptCompletion()` | attempt_completion signaled |
| `onQuestion(q, opts, resolve)` | ask_followup_question pauses loop |
| `onApprovalRequired(name, input)` | Write tool needs user approval |
| `onTodoUpdate(items)` | update_todo_list published |
| `onModeSwitch(slug)` | switch_mode applied |
| `onContextCondensed()` | History was condensed |
| `onError(error)` | Unrecoverable error |

## Known Limitations / Edge Cases
- MAX_ITERATIONS=10 is a hard cap — very long tasks may not complete. Consider raising (or configuring) for complex workflows.
- Context condensing doesn't preserve image/attachment content in history.
- Sub-tasks inherit parent's tool registry (no per-subtask tool restriction).
- Parallel execution only fires when ALL tools in a batch are in `PARALLEL_SAFE` — mixed batches (read + write) always serialize.
- Token counting uses a rough ~4 chars/token estimate for condensing threshold checks.
