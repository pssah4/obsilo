# Tool System -- Technical Reference

> Source of truth for the tool registration, metadata, execution pipeline,
> parallel execution strategy, and loop-detection subsystems.

---

## 1. ToolRegistry

**File:** `src/core/tools/ToolRegistry.ts`

The `ToolRegistry` is a central `Map<ToolName, BaseTool>` that owns every tool
instance the agent can call. It is constructed once during plugin startup and
injected into `AgentTask` and `ModeService`.

### 1.1 Registration flow

```
constructor(plugin, mcpClient?)
  |
  +-- registerInternalTools()   // all built-in tools (30+)
  |     register(new ReadFileTool(plugin))
  |     register(new ListFilesTool(plugin))
  |     ...
  |
  +-- if mcpClient:
        register(new UseMcpToolTool(plugin, mcpClient))
```

`register()` stores the tool by its `.name` property. Duplicate names
overwrite the previous entry (with a console warning).

### 1.2 Tool categories (import order)

| Category           | Tools                                                                                         |
|--------------------|-----------------------------------------------------------------------------------------------|
| Vault: read        | ReadFileTool, ListFilesTool, SearchFilesTool                                                  |
| Vault: write       | WriteFileTool, EditFileTool, AppendToFileTool, CreateFolderTool, DeleteFileTool, MoveFileTool |
| Vault: intelligence| GetFrontmatterTool, UpdateFrontmatterTool, SearchByTagTool, GetVaultStatsTool, GetLinkedNotesTool, OpenNoteTool, GetDailyNoteTool |
| Vault: semantic    | SemanticSearchTool                                                                            |
| Vault: canvas      | GenerateCanvasTool                                                                            |
| Vault: bases       | CreateBaseTool, UpdateBaseTool, QueryBaseTool                                                 |
| Web                | WebFetchTool, WebSearchTool                                                                   |
| Agent control      | AskFollowupQuestionTool, AttemptCompletionTool, UpdateTodoListTool, SwitchModeTool, NewTaskTool |
| Plugin Skills      | ExecuteCommandTool, ResolveCapabilityGapTool, EnablePluginTool                                |
| Plugin API/Recipe  | CallPluginApiTool, ExecuteRecipeTool                                                          |
| Settings           | UpdateSettingsTool, ConfigureModelTool                                                        |
| MCP                | UseMcpToolTool (conditionally registered)                                                     |

### 1.3 Key methods

| Method                          | Purpose                                                        |
|---------------------------------|----------------------------------------------------------------|
| `getToolDefinitions()`          | Returns every tool's JSON Schema definition for the LLM.       |
| `getFilteredToolDefinitions(allowedTools)` | Returns definitions only for the listed tool names (used by ModeService). |
| `getTool(name)`                 | Single tool lookup by name.                                    |
| `hasTool(name)`                 | Existence check.                                               |
| `registerMcpTool(server, name, tool)` | Future MCP Phase 6 hook (currently delegates to `register()`). |
| `unregister(name)`              | Remove a tool at runtime.                                      |

---

## 2. BaseTool

**File:** `src/core/tools/BaseTool.ts`

Abstract base class that every tool (internal and MCP) must extend.

### 2.1 Interface contract

```typescript
abstract class BaseTool<TName extends ToolName = ToolName> {
    abstract readonly name: TName;
    abstract readonly isWriteOperation: boolean;

    abstract getDefinition(): ToolDefinition;
    abstract execute(input: Record<string, any>, context: ToolExecutionContext): Promise<void>;

    protected validate(input: Record<string, any>): void;          // optional override
    protected formatError(error: unknown): string;                 // "<error>...</error>"
    protected formatSuccess(message: string): string;              // "<success>...</success>"
    protected formatContent(content: string, metadata?: Record<string, string>): string;
}
```

### 2.2 Property semantics

- **`name`** -- Unique string identifier (matches the API tool name sent to the LLM).
- **`isWriteOperation`** -- Determines whether the pipeline creates a checkpoint
  and requires approval before execution. Read-only tools set this to `false`.

### 2.3 Output formatting

Tools communicate results back to the LLM through `context.callbacks.pushToolResult()`.
Three helper methods standardize the XML-wrapped format:

| Method            | Output format                                           |
|-------------------|---------------------------------------------------------|
| `formatError(e)`  | `<error>{message}</error>`                              |
| `formatSuccess(m)`| `<success>{message}</success>`                          |
| `formatContent(c, meta?)` | `<content key="val">...content...</content>` or plain text |

### 2.4 Execution context

The `ToolExecutionContext` passed to `execute()` carries:

| Field               | Type                            | Description                                       |
|---------------------|---------------------------------|---------------------------------------------------|
| `taskId`            | `string`                        | Unique ID of the running AgentTask                 |
| `mode`              | `string`                        | Active mode slug                                   |
| `callbacks`         | `ToolCallbacks`                 | pushToolResult, handleError, log                   |
| `askQuestion?`      | function                        | Pause loop, ask user (AskFollowupQuestionTool)     |
| `signalCompletion?` | function                        | Signal end of task (AttemptCompletionTool)          |
| `updateTodos?`      | function                        | Publish todo list (UpdateTodoListTool)              |
| `switchMode?`       | function                        | Switch active mode (SwitchModeTool)                 |
| `spawnSubtask?`     | function                        | Spawn child agent (NewTaskTool). Undefined at max depth. |
| `invalidateToolCache?` | function                     | Force rebuild of tool definitions (UpdateSettingsTool) |

---

## 3. Tool Metadata Registry

**File:** `src/core/tools/toolMetadata.ts`

Single source of truth for all tool display information. Consumed by:
- **System prompt builder** (`systemPrompt.ts`) -- generates the TOOLS section the LLM sees.
- **ToolPickerPopover** (UI) -- renders labels, descriptions, and icons.

### 3.1 ToolMeta interface

```typescript
interface ToolMeta {
    group: ToolGroup;       // 'read' | 'vault' | 'edit' | 'web' | 'agent' | 'mcp' | 'skill'
    label: string;          // "Read File"
    description: string;    // Used in system prompt AND UI popover
    icon: string;           // Lucide icon name
    signature: string;      // "read_file(path)" -- shown in system prompt
}
```

### 3.2 Companion structures

| Export                  | Purpose                                                       |
|-------------------------|---------------------------------------------------------------|
| `TOOL_METADATA`         | `Record<string, ToolMeta>` -- one entry per tool name.        |
| `GROUP_META`            | Display labels and icons for group headers in UI.             |
| `GROUP_PROMPT_HEADERS`  | Section titles for the system prompt (e.g. `**Reading & Searching:**`). |
| `GROUP_ORDER`           | Ordered array `['read','vault','edit','web','agent','mcp','skill']`. |

### 3.3 Helper functions

- **`getToolsForGroup(group)`** -- Returns `[toolName, ToolMeta][]` for a given group.
- **`buildToolPromptSection(groups)`** -- Generates the formatted tool section
  string for the system prompt, iterating `GROUP_ORDER` and emitting each
  tool's `signature: description` line.

### 3.4 Dual-layer design

The metadata in `toolMetadata.ts` is intentionally separate from each tool's
`getDefinition()` method. The API-level definition carries the full JSON Schema
(`input_schema`) required for function calling. The metadata carries the
human-readable description used in the system prompt and UI. These serve
different purposes and evolve independently.

---

## 4. ToolExecutionPipeline

**File:** `src/core/tool-execution/ToolExecutionPipeline.ts`

Central governance layer. **Every tool execution -- internal and MCP -- flows
through `executeTool()`**. There are no bypasses.

### 4.1 The 6-step execution flow

```
executeTool(toolCall, callbacks, extensions)
  |
  1. VALIDATE        -- Tool exists in registry?
  |                     No  -> error result
  |
  2. IGNORE CHECK    -- IgnoreService: is path blocked or protected?
  |                     Blocked -> error result with denial reason
  |
  3. APPROVAL        -- Is this a write/web/mcp/mode/subtask tool?
  |                     Yes -> checkApproval()
  |                       Agent group ('agent') -> always auto-approved
  |                       Auto-approval config enabled for this group? -> auto
  |                       No config, no callback? -> REJECTED (fail-closed)
  |                       Otherwise -> prompt user via onApprovalRequired
  |                     Rejected -> error result
  |
  4. CHECKPOINT      -- Is this a write operation AND checkpoints enabled?
  |                     Yes -> snapshot file(s) via GitCheckpointService
  |                            Notify UI via onCheckpoint callback
  |                     Failure is non-fatal (logged, execution continues)
  |
  5. EXECUTE         -- tool.execute(input, context)
  |                     Results collected via wrappedCallbacks
  |                     Error detection: content starting with "<error>"
  |
  6. LOG             -- OperationLogger.log() with full metadata
  |                     Duration, success/error, sanitized params
  |                     Fallback: console.log in debug mode
  |
  Return ToolResult { tool_use_id, content, is_error }
```

### 4.2 Tool group classification (Pipeline-internal)

The pipeline uses its own group taxonomy (distinct from the metadata groups)
to drive approval logic:

| Pipeline Group  | Tools                                                                                    | Approval behavior                          |
|-----------------|------------------------------------------------------------------------------------------|---------------------------------------------|
| `read`          | read_file, list_files, search_files, get_frontmatter, get_linked_notes, get_vault_stats, search_by_tag, get_daily_note, query_base, semantic_search | Auto when `cfg.read` |
| `note-edit`     | write_file, edit_file, append_to_file, update_frontmatter                                | Auto when `cfg.noteEdits`                   |
| `vault-change`  | create_folder, delete_file, move_file, generate_canvas, create_base, update_base         | Auto when `cfg.vaultChanges`                |
| `web`           | web_fetch, web_search                                                                    | Auto when `cfg.web`                         |
| `agent`         | ask_followup_question, attempt_completion, update_todo_list, open_note, update_settings, configure_model | **Always auto-approved**       |
| `mode`          | switch_mode                                                                              | Auto when `cfg.mode`                        |
| `subtask`       | new_task                                                                                 | Auto when `cfg.subtasks`                    |
| `mcp`           | use_mcp_tool                                                                             | Auto when `cfg.mcp`                         |
| `skill`         | execute_command, resolve_capability_gap, enable_plugin                                   | Auto when `cfg.skills`                      |
| `plugin-api`    | call_plugin_api                                                                          | Split: `cfg.pluginApiRead` / `cfg.pluginApiWrite` based on allowlist |
| `recipe`        | execute_recipe                                                                           | Auto when `cfg.recipes`                     |

### 4.3 Plugin API write detection

For `call_plugin_api`, the pipeline differentiates read vs. write calls:

1. Check the built-in allowlist (`pluginApiAllowlist.ts`) for an `isWrite` flag.
2. Check user-defined safe method overrides in `settings.pluginApi.safeMethodOverrides`.
3. Default: treat unknown methods as write (conservative).

### 4.4 ContextExtensions

The pipeline receives optional `ContextExtensions` from `AgentTask` that wire
agent-control tools to the conversation loop:

```typescript
interface ContextExtensions {
    askQuestion?:         (question, options?, allowMultiple?) => Promise<string>;
    signalCompletion?:    (result) => void;
    onApprovalRequired?:  (toolName, input) => Promise<ApprovalResult>;
    updateTodos?:         (items) => void;
    switchMode?:          (slug) => void;
    spawnSubtask?:        (mode, message) => Promise<string>;
    onCheckpoint?:        (checkpoint) => void;
    invalidateToolCache?: () => void;
}
```

---

## 5. Tool Groups and Mode Filtering

**File:** `src/core/modes/builtinModes.ts` and `src/core/modes/ModeService.ts`

### 5.1 TOOL_GROUP_MAP

The canonical mapping from logical tool group to individual tool names:

| Group   | Tool names                                                                                                    |
|---------|---------------------------------------------------------------------------------------------------------------|
| `read`  | read_file, list_files, search_files                                                                           |
| `vault` | get_frontmatter, search_by_tag, get_vault_stats, get_linked_notes, get_daily_note, open_note, semantic_search, query_base |
| `edit`  | write_file, edit_file, append_to_file, create_folder, delete_file, move_file, update_frontmatter, generate_canvas, create_base, update_base |
| `web`   | web_fetch, web_search                                                                                         |
| `agent` | ask_followup_question, attempt_completion, update_todo_list, new_task, switch_mode, update_settings, configure_model |
| `mcp`   | use_mcp_tool                                                                                                  |
| `skill` | execute_command, execute_recipe, call_plugin_api, resolve_capability_gap, enable_plugin                       |

### 5.2 expandToolGroups()

```typescript
function expandToolGroups(groups: ToolGroup[]): string[]
```

Takes an array of group slugs, concatenates the tool names from `TOOL_GROUP_MAP`,
and deduplicates. Called by `ModeService.getToolNames()`.

### 5.3 ModeService filtering

Resolution order for the effective tool set per mode:

1. Expand mode's `toolGroups` via `TOOL_GROUP_MAP`.
2. If `settings.modeToolOverrides[slug]` exists, intersect with the expanded set
   (user can never escalate beyond what the mode's groups allow).
3. If web tools are disabled in settings, remove `web_fetch` and `web_search`.
4. Return `ToolDefinition[]` filtered to the effective set.

### 5.4 Built-in modes

| Mode    | Tool groups                                  | Description                         |
|---------|----------------------------------------------|-------------------------------------|
| `ask`   | read, vault, agent                           | Read-only conversational assistant  |
| `agent` | read, vault, edit, web, agent, mcp, skill    | Fully autonomous with all tools     |

Users can create additional modes (vault-scoped or global-scoped) with any
combination of tool groups.

---

## 6. Parallel Execution

**File:** `src/core/AgentTask.ts` (lines 376-455)

### 6.1 PARALLEL_SAFE set

```typescript
const PARALLEL_SAFE = new Set([
    'read_file', 'list_files', 'search_files', 'get_frontmatter',
    'get_linked_notes', 'search_by_tag', 'get_vault_stats', 'get_daily_note',
    'web_fetch', 'web_search',
    'semantic_search', 'query_base', 'open_note',
]);
```

### 6.2 Decision logic

When the LLM returns multiple tool calls in a single response:

```
if validToolUses.length > 1
   AND every tool is in PARALLEL_SAFE
   -> Promise.all(validToolUses.map(runTool))
   -> onToolResult called sequentially AFTER all finish (preserves UI order)

else
   -> sequential for-loop
   -> break early if completionResult is signaled
```

Write tools, control-flow tools (`attempt_completion`, `switch_mode`, `new_task`),
and mixed batches always execute sequentially to preserve correctness.

---

## 7. ToolRepetitionDetector

**File:** `src/core/tool-execution/ToolRepetitionDetector.ts`

Prevents infinite tool-call loops (adapted from Kilo Code's loop-detection pattern).

### 7.1 Configuration

| Parameter        | Value | Description                                      |
|------------------|-------|--------------------------------------------------|
| `windowSize`     | 10    | Sliding window of recent calls                   |
| `maxRepetitions` | 3     | Trigger threshold within the window               |

### 7.2 Algorithm

```
check(toolName, input):
    key = toolName + ":" + JSON.stringify(input)
    recentCalls.push(key)
    if recentCalls.length > windowSize:
        recentCalls.shift()                          // drop oldest
    return recentCalls.filter(k == key).length >= maxRepetitions
```

When `check()` returns `true`:
- The call IS recorded (so the window stays accurate for subsequent checks).
- AgentTask injects an `<error>Tool loop detected...</error>` result.
- `signalCompletion('aborted: tool repetition loop')` is called, breaking the
  agentic loop.

### 7.3 Reset

The detector is reset when the active mode switches (`pendingModeSwitch` in
AgentTask) to avoid false positives across mode transitions.

---

## 8. Dependency Graph

```
AgentTask
  |
  +-- ToolRegistry          (tool lookup + definitions)
  |     +-- BaseTool[]      (30+ tool instances)
  |
  +-- ToolExecutionPipeline (governance layer)
  |     +-- IgnoreService   (path blocking / protection)
  |     +-- AutoApproval    (config-driven or user prompt)
  |     +-- GitCheckpointService  (snapshot before writes)
  |     +-- OperationLogger (JSONL audit trail)
  |
  +-- ToolRepetitionDetector (loop prevention)
  |
  +-- ModeService           (tool filtering per mode)
        +-- TOOL_GROUP_MAP  (group -> tool name expansion)
        +-- expandToolGroups()
```

Data flow for a single tool call:

```
LLM response (tool_use block)
  -> AgentTask.runTool()
       -> ToolRepetitionDetector.check()    // loop guard
       -> ToolExecutionPipeline.executeTool()
            1. Registry lookup
            2. IgnoreService validation
            3. Approval check (config or user)
            4. GitCheckpointService.snapshot()
            5. BaseTool.execute()
            6. OperationLogger.log()
       <- ToolResult
  -> onToolResult callback (UI update)
  -> consecutiveMistakes counter check
  -> history.push(tool_result)
  -> next iteration (or break if completion signaled)
```
