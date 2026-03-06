# FEATURE: Agent Control Tools

**Status:** Implemented
**Source:** `src/core/tools/agent/`

## Summary
17 built-in agent tools that control the agent's flow, communicate with the user, spawn sub-agents, manage task planning, configure settings, execute commands, handle MCP servers, and provide self-development capabilities. Core control tools are always auto-approved (never require user confirmation).

## Tools

### ask_followup_question
**Purpose:** Ask the user a clarifying question when the request is ambiguous.

**Input:**
- `question: string` — the question text
- `options?: string[]` — optional answer choices (shows as clickable buttons)

**Flow:**
1. Tool calls `context.askQuestion(question, options)`
2. AgentTask pauses the loop via `Promise` (resolves when user answers)
3. UI shows question card with optional answer buttons
4. User types or clicks → Promise resolves with answer string
5. Tool returns `<answer>{answer}</answer>` as tool result
6. Loop continues with answer injected into history

**System prompt guidance:** "Use sparingly — only when genuinely needed."

---

### attempt_completion
**Purpose:** Signal that the task is done and close the agentic loop.

**Input:**
- `result: string` — brief internal log entry (NOT shown to user)

**Flow:**
1. Tool calls `context.signalCompletion(result)` → sets `completionResult` flag in AgentTask
2. AgentTask loop checks after current tool batch → calls `onAttemptCompletion()` callback
3. If `result` is non-empty text: `onText(result)` is NOT called — result is meta-log only
4. Loop breaks on next iteration check

**Important:** The agent must write its complete response as streaming text BEFORE calling `attempt_completion`. The `result` field is an internal signal, not the visible answer.

---

### new_task (Sub-agent Spawning)
**Purpose:** Spawn a child agent in a specified mode with a fresh conversation.

**Input:**
- `mode: string` — mode slug (`'agent'` or `'ask'`)
- `message: string` — complete context + instructions for the sub-agent

**Flow:**
1. Tool calls `context.spawnSubtask(mode, message)`
2. AgentTask creates a child `AgentTask` with:
   - Same `api` and `toolRegistry` as parent
   - Fresh `history: MessageParam[] = []`
   - Parent's `onApprovalRequired` forwarded (so sub-agent writes are approved)
   - condensingEnabled=false, powerSteering=0 (lean)
3. Child runs to completion, accumulates text output
4. Tool returns child's output as `<task_result>{output}</task_result>`
5. Parent continues with result

**Sub-agent tool events** are forwarded to parent UI with `[subtask]` prefix.

**Agentic patterns** documented in Agent mode's `roleDefinition`:
- **Prompt Chaining** — sequential agents, each builds on previous
- **Orchestrator-Worker** — parent plans, workers execute focused tasks
- **Evaluator-Optimizer** — generate → evaluate → refine loop
- **Routing** — dispatch to right mode based on subtask type

**Only available in Agent mode** (not in Ask mode's tool groups).

---

### switch_mode
**Purpose:** Change the active mode mid-task.

**Input:**
- `mode_slug: string` — slug of the target mode

**Flow:**
1. Tool calls `context.switchMode(modeSlug)` → sets `pendingModeSwitch` in AgentTask
2. Applied at the START of the next iteration (not immediately)
3. `activeMode` is updated, `ModeService.switchMode()` called, `ToolRepetitionDetector.reset()`
4. System prompt and tool list are rebuilt for the new mode

**Use case:** Orchestrator pattern — start in Agent mode, switch to Ask for read-only sub-phase, switch back.

---

### update_todo_list
**Purpose:** Publish a task plan as a visible checklist in the chat sidebar.

**Input:**
- `todos: TodoItem[]` — items with `content`, `status` ('pending'|'in_progress'|'completed'), `activeForm`

**Flow:**
1. Tool calls `context.updateTodos(items)`
2. `onTodoUpdate` callback sends items to UI
3. UI renders a live todo list that updates as the agent progresses

**System prompt guidance:** "Use ONLY for complex tasks with 3+ distinct steps. For simple tasks, execute directly — no plan needed."

---

### configure_model
**Purpose:** Change the active AI model mid-conversation.
**Source:** `src/core/tools/agent/ConfigureModelTool.ts`

---

### enable_plugin
**Purpose:** Enable a Community Plugin by ID at runtime.
**Source:** `src/core/tools/agent/EnablePluginTool.ts`

---

### execute_command
**Purpose:** Execute an Obsidian command by its command ID.
**Source:** `src/core/tools/agent/ExecuteCommandTool.ts`

---

### resolve_capability_gap
**Purpose:** Dynamically resolve missing capabilities by suggesting or installing plugins/skills.
**Source:** `src/core/tools/agent/ResolveCapabilityGapTool.ts`

---

### update_settings
**Purpose:** Update plugin settings programmatically (model, theme, features).
**Source:** `src/core/tools/agent/UpdateSettingsTool.ts`

---

### manage_mcp_server
**Purpose:** Add, remove, update, list, reconnect, or test MCP servers.
**Source:** `src/core/tools/agent/ManageMcpServerTool.ts`

---

### read_agent_logs
**Purpose:** Read the agent's operation log (ring buffer) for debugging.
**Source:** `src/core/tools/agent/ReadAgentLogsTool.ts`

---

### manage_source
**Purpose:** Read and modify the plugin's own source code (self-development).
**Source:** `src/core/tools/agent/ManageSourceTool.ts`

---

### execute_recipe
**Purpose:** Execute a procedural recipe (skill mastery system, ADR-017).
**Source:** `src/core/tools/agent/ExecuteRecipeTool.ts`

---

### evaluate_expression
**Purpose:** Execute JavaScript/TypeScript code in a sandboxed iframe environment.
**Source:** `src/core/tools/agent/EvaluateExpressionTool.ts`

---

### call_plugin_api
**Purpose:** Call Obsidian Community Plugin APIs via an allowlisted interface.
**Source:** `src/core/tools/agent/CallPluginApiTool.ts`

---

### manage_skill
**Purpose:** Create, list, read, update, or delete user-authored skills (markdown instructions).
**Source:** `src/core/tools/agent/ManageSkillTool.ts`

## Key Files
- `src/core/tools/agent/AskFollowupQuestionTool.ts`
- `src/core/tools/agent/AttemptCompletionTool.ts`
- `src/core/tools/agent/NewTaskTool.ts`
- `src/core/tools/agent/SwitchModeTool.ts`
- `src/core/tools/agent/UpdateTodoListTool.ts`
- `src/core/tools/agent/ConfigureModelTool.ts`
- `src/core/tools/agent/EnablePluginTool.ts`
- `src/core/tools/agent/ExecuteCommandTool.ts`
- `src/core/tools/agent/ResolveCapabilityGapTool.ts`
- `src/core/tools/agent/UpdateSettingsTool.ts`
- `src/core/tools/agent/ManageMcpServerTool.ts`
- `src/core/tools/agent/ReadAgentLogsTool.ts`
- `src/core/tools/agent/ManageSourceTool.ts`
- `src/core/tools/agent/ExecuteRecipeTool.ts`
- `src/core/tools/agent/EvaluateExpressionTool.ts`
- `src/core/tools/agent/CallPluginApiTool.ts`
- `src/core/tools/agent/ManageSkillTool.ts`

## Dependencies
- `ToolExecutionContext.askQuestion` — wired in AgentTask.run()
- `ToolExecutionContext.signalCompletion` — wired in AgentTask.run()
- `ToolExecutionContext.spawnSubtask` — wired in AgentTask.run()
- `ToolExecutionContext.switchMode` — wired in AgentTask.run()
- `ToolExecutionContext.updateTodos` — wired in AgentTask.run()
- `AgentTaskCallbacks.onQuestion` — UI question card
- `AgentTaskCallbacks.onTodoUpdate` — UI todo panel
- `AgentTaskCallbacks.onModeSwitch` — UI mode indicator update

## Tool Group
All 17 tools are in the `agent` tool group. Core control tools (`ask_followup_question`, `attempt_completion`, `new_task`, `switch_mode`, `update_todo_list`) are always auto-approved, never checkpointed. Other agent tools may require approval depending on their write impact.

**Availability by mode:**
- Ask mode: `ask_followup_question`, `attempt_completion` (from `agent` group, but not `new_task`)
- Agent mode: all 5 (full `agent` group)

Note: `switch_mode` is always available in the pipeline's TOOL_GROUPS classification but its availability in the LLM's tool list depends on mode configuration.

## Known Limitations / Edge Cases
- `new_task` depth: hard enforcement via `depth`/`maxSubtaskDepth` (default 2). Children at max depth cannot spawn further sub-agents.
- `ask_followup_question` blocks the loop until the user responds. If used in a sub-agent, the question appears in the parent UI (via forwarded `onQuestion` callback — check if implemented in sub-agent wiring).
- `switch_mode` is deferred to next iteration — if the current iteration has multiple tools, they all execute before the mode switch takes effect.
- `update_todo_list` sends the full list each time (no diff). UI re-renders on each call.
- `attempt_completion.result` content is logged (via OperationLogger) but NOT displayed in UI. If the agent puts important info in `result` instead of streaming text, users won't see it.
