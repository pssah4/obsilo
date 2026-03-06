# UI Architecture -- Obsidian Agent

Technical reference for the Obsidian Agent user interface layer. Covers the
main chat sidebar, input subsystems, settings tab router, and modal dialogs.

---

## 1. AgentSidebarView -- Main Chat Interface

**File:** `src/ui/AgentSidebarView.ts`

### 1.1 ItemView Registration

`AgentSidebarView` extends Obsidian's `ItemView`, registered under
`VIEW_TYPE_AGENT_SIDEBAR = 'obsidian-agent-sidebar'`. Display name is
"Obsilo Agent", icon `obsilo-agent`. Activated as a right-sidebar leaf.

### 1.2 State Management

| Field | Type | Purpose |
|---|---|---|
| `conversationHistory` | `MessageParam[]` | Full API-level message history, persisted across turns within a session. Passed into every `AgentTask.run()` call so the model retains context. |
| `uiMessages` | `UiMessage[]` | Lightweight (role + text + timestamp) transcript used for history persistence via `ConversationStore`. |
| `activeConversationId` | `string \| null` | ID of the current conversation in the store. Created lazily on first user message; cleared on "New Chat". |
| `currentAbortController` | `AbortController \| null` | Non-null while a task is running. Wired to the stop button and passed as `signal` to `AgentTask.run()`. |
| `lastUserMessage` | `string` | Cached for the "Regenerate" action on the response action bar. |
| `lastMarkdownView` | `MarkdownView \| null` | Tracked via `active-leaf-change` because clicking the sidebar loses `getActiveViewOfType`. Used by "Insert at cursor". |
| `nextMessageHidden` | `boolean` | When true, the next send skips the user bubble but still sends the text to the LLM (used by programmatic/onboarding messages). |
| `userDismissedContext` | `boolean` | Reset on file change. When true, the active-file context chip is hidden and the file is not injected into the prompt. |

### 1.3 Message Flow

1. User types into the `<textarea>` and presses Enter (or clicks Send).
2. `handleSendMessage()` is called:
   - A new `activeConversationId` is created if this is the first message.
   - Attachments are snapshot and the chip bar is cleared.
   - The user bubble is rendered (unless `nextMessageHidden`).
   - Active file context (`<context>`) and vault context (`<vault_context>`) are appended.
   - Slash commands are expanded via `workflowLoader.processSlashCommand()`.
   - The effective model is resolved (mode-specific override or global default).
   - An `AbortController` is created and the UI switches to "running" state.
   - A streaming message container is created (thinking, tools, content, footer).
   - An `AgentTask` is constructed with all resolved parameters and `task.run()` is awaited.
3. During execution, callbacks stream data into the DOM (see 1.4).
4. On `onComplete`, the raw streaming paragraph is replaced by a full `MarkdownRenderer.render()` pass, follow-ups and sources are parsed, the undo bar / post-task review are shown, and the conversation is saved.

### 1.4 Callback Wiring to AgentTask

The `AgentTask` constructor receives a callbacks object with these handlers:

| Callback | Behavior |
|---|---|
| `onIterationStart(n)` | Ensures the steps block exists. For iteration > 0, inserts an "Analyzing results..." row inside the steps body. |
| `onThinking(chunk)` | Builds a collapsible "Reasoning..." section on first chunk. Subsequent chunks append to the thinking content element. Collapsed when text streaming begins. |
| `onText(chunk)` | In Q&A mode (no tools), text is appended directly to a `<p class="streaming-para">` for O(1) per-chunk cost. In agentic mode, text is buffered in `accumulatedText` and rendered once on completion. |
| `onToolStart(name, input)` | Creates tool call UI inside the "agent steps" collapsible block. Groupable tools (read_file, list_files, search_files, etc.) are merged into a single expandable row with an item count. Standalone tools get their own `<details>` element with input JSON and an output slot. |
| `onToolResult(name, content, isError)` | Pops the oldest pending element for the tool name. Updates status icon (check/x). For standalone tools, fills the output `<pre>`. Parses `<diff_stats>` tags and renders a diff badge on the summary. Updates the steps block summary count. |
| `onUsage(in, out)` | Writes token counts and timestamp into the message footer. |
| `onTodoUpdate(items)` | Re-renders the todo box in the tools area with live status per item. |
| `onContextCondensed()` | Appends a "context condensed" badge to the message footer. |
| `onModeSwitch(slug)` | Syncs `settings.currentMode`, updates the mode button, shows a Notice. Optionally triggers semantic auto-index. |
| `onCheckpoint(cp)` | Renders a checkpoint marker with timestamp and tool name. |
| `onQuestion(q, opts, resolve)` | Renders accumulated text, shows a question card, and wraps `resolve` to insert a user bubble and create a fresh streaming container for the next agent turn. |
| `onApprovalRequired(tool, input)` | Delegates to `showApprovalCard()` which renders inline Allow / Enable Always / Deny buttons and returns a promise. |
| `onAttemptCompletion()` | Auto-completes any unfinished todo items. |
| `onComplete()` | Final Markdown render, citation wiring, response actions bar, follow-up suggestions, undo bar, post-task review, conversation save, memory extraction enqueue. |
| `onError(error)` | Renders an error row inside the steps block with a user-friendly title (maps HTTP status codes and common error patterns). |

### 1.5 Rendering

- **Markdown**: Obsidian's `MarkdownRenderer.render()` for final assistant messages and restored history. Internal `[[wikilinks]]` are post-processed to be clickable.
- **Tool I/O Cards**: `<details>` elements with summary (icon + name + brief param + time + status) and collapsible body (input JSON + output pre). Grouped tools use a count label (e.g. "read_file (3)") with compact item rows.
- **Thinking Blocks**: Collapsible section with a spinner during streaming, collapsed with a chevron after text starts.
- **Diff-Stats Badge**: Parsed from `<diff_stats added="X" removed="Y"/>` in tool output. Rendered as `+X / -Y` on the tool summary row.
- **Token Usage Footer**: `HH:MM  ·  X,XXX in · Y,YYY out` per message.
- **Agent Steps Block**: A single `<details class="agent-steps-block">` wrapping all tool calls. Summary shows a spinning icon during execution, then a check/x with action count. Individual tool details are collapsed on completion.

### 1.6 Approval Cards

Rendered inline by `showApprovalCard()`. Three buttons: Allow (one-time), Enable Always (persists auto-approval for this tool), Deny. Returns a promise that the `ToolExecutionPipeline` awaits before proceeding.

### 1.7 Todo Box

Rendered by `renderTodoBox()` inside the tools area. Shows each item with a status icon (pending/in-progress/done). Updated live via `onTodoUpdate`. Auto-completed on `onAttemptCompletion` and `onComplete`. An activity badge in the todo section shows the running count of completed tool actions.

### 1.8 Undo Bar

Shown after write operations when checkpoints are enabled. Provides a single "Undo" button that restores to the pre-task checkpoint. Also triggers `showPostTaskReview()` which opens the `DiffReviewModal` for granular section-level review.

### 1.9 Toolbar

The toolbar at the bottom of the input area contains:

| Position | Element | Behavior |
|---|---|---|
| Left | Mode button | Opens a dropdown menu listing all modes (from `ModeService`). Switches mode on click. Shows icon + name + chevron. |
| Left | Model button | Opens a dropdown of enabled models. Sets a mode-specific model override. Shows "Use global default" option when an override is active. |
| Left | Tool picker (pocket-knife) | Opens `ToolPickerPopover`. Hidden in Ask mode. |
| Left | Web toggle (globe) | Toggles `webTools.enabled`. Visual highlight when active. Hidden when mode lacks web tool group. |
| Left | Attach (paperclip) | Opens native file picker via `AttachmentHandler`. |
| Left | Vault file (at-sign) | Opens `VaultFilePicker` popover. |
| Left | More options (ellipsis) | Context menu with Refresh Index, Clear, and other actions. |
| Right | Stop button | Visible during task execution. Calls `abort()` on the controller. |
| Right | Send button | Triggers `handleSendMessage()`. Hidden during execution. |

---

## 2. Chat Autocomplete -- AutocompleteHandler

**File:** `src/ui/sidebar/AutocompleteHandler.ts`

### 2.1 Trigger Characters

| Trigger | Condition | Items |
|---|---|---|
| `/` | Text starts with `/` | Workflows (from `workflowLoader.discoverWorkflows()`) + custom prompts (from `settings.customPrompts`). Filtered by slug prefix. Mode-scoped prompts only show in their target mode. |
| `@` | `@` preceded by whitespace or at start | Vault markdown files. "Active note" appears first when applicable. Up to 10 results filtered by path. |

### 2.2 Dropdown Rendering

A `div.autocomplete-dropdown` is created inside the input area on first match.
Each item is a row with a label and an optional subtitle. The active item is
highlighted via the `active` CSS class. A click-outside listener auto-hides the
dropdown.

### 2.3 Selection Handling

- **Keyboard**: ArrowUp/Down navigate, Tab/Enter select, Escape closes.
- **Mouse**: `mousedown` on a row triggers `onSelect()` (using mousedown to fire before blur).
- **`/` selection**: Replaces the textarea value with `/<slug>` followed by any text after the first space.
- **`@` selection**: Removes the `@query` from the textarea and calls `addVaultFile(file)` to attach the file as a context chip.

### 2.4 Priority

`handleKeyDown()` returns `true` when the autocomplete consumed the event. The
textarea's own keydown handler checks this first and skips Enter-to-send when
autocomplete is active.

---

## 3. VaultFilePicker -- File Attachment via @

**File:** `src/ui/sidebar/VaultFilePicker.ts`

### 3.1 UI Structure

A floating popover (`div.vault-file-picker`) anchored to the @-button. Contains
a search input, a scrollable file list (max 80 entries), and a footer with a
selection count and an "Add" button. Positioned above or below the anchor
depending on available viewport space.

### 3.2 Live Search and Multi-Select

- All markdown files from the vault are listed, sorted alphabetically.
- The currently active file is pinned at the top with an "Active:" prefix.
- Search filters by basename and full path (case-insensitive substring).
- Rows have checkboxes. Clicking a row toggles selection. A `Set<string>` of
  file paths tracks selected files.

### 3.3 Keyboard Navigation

ArrowUp/Down move the active index, Space toggles the active row's checkbox,
Enter confirms (auto-selects the focused row if nothing is selected), Escape
closes.

### 3.4 Integration with AttachmentHandler

On confirm, selected `TFile` objects are passed to the `onConfirm` callback
which calls `attachments.addVaultFile(file)` for each file. The picker then
hides itself.

---

## 4. ToolPickerPopover -- Tool Configuration

**File:** `src/ui/sidebar/ToolPickerPopover.ts`

### 4.1 Structure

A fixed-position popover (`div.tool-picker-popover`) with a header, search
input, and scrollable body. Four collapsible top-level categories:

1. **Built-In** -- Tool groups from the active mode's `toolGroups` (excluding
   `web` and `mcp`). Each group is a sub-category with its own group checkbox.
   Individual tools listed with metadata from `TOOL_METADATA`.
2. **MCP Servers** -- Lists configured MCP servers with toggle checkboxes.
   Persisted to `settings.activeMcpServers`.
3. **Skills** -- Async-loaded from `skillsManager.discoverSkills()`. Toggling
   a skill adds/removes it from `settings.forcedSkills[modeSlug]`.
4. **Workflows** -- Async-loaded from `workflowLoader.discoverWorkflows()`.
   Radio-style selection (only one workflow active per mode). Stored in
   `settings.forcedWorkflow[modeSlug]`.

### 4.2 Persistence

All changes are persisted immediately to plugin settings via
`plugin.saveSettings()`. Tool overrides go through
`modeService.setModeToolOverride(slug, selected)` which writes to
`settings.modeToolOverrides`. There is no session-only / RAM-only state --
every change survives plugin reload.

### 4.3 Search Filter

The search input filters all item rows by `data-label` and `data-desc`
attributes (case-insensitive substring). When a search is active, the Built-In
category is force-expanded.

### 4.4 How Overrides Affect the Next Message

When `handleSendMessage()` constructs the `AgentTask`, it calls
`modeService.getEffectiveToolNames()` which reads `modeToolOverrides`. The
tool registry then only exposes the selected tools to the LLM. Forced skills
and workflows are read from `settings.forcedSkills` and
`settings.forcedWorkflow` respectively and injected into the system prompt.

---

## 5. AttachmentHandler -- File Attachments

**File:** `src/ui/sidebar/AttachmentHandler.ts`

### 5.1 How Files Are Added as Context

Two entry points:

- **`processFile(file: File)`**: Handles native `File` objects from the OS file
  picker, clipboard paste, or drag-and-drop. Images (PNG/JPG/GIF/WebP) are
  base64-encoded into an `image` ContentBlock. Text files (.md, .ts, .py, etc.)
  are read as UTF-8 and wrapped in `<attached_file>` XML tags inside a `text`
  ContentBlock. Files over 10 MB are rejected with a Notice.
- **`addVaultFile(file: TFile)`**: Reads the file content via `vault.read()`
  and wraps it identically to text file attachments.

### 5.2 Clipboard Image and Drag-and-Drop Support

The textarea's `paste` event handler iterates `clipboardData.items`. Any item
with `kind === 'file'` is intercepted and routed to `processFile()`.
Drag-and-drop is handled via `dragover`/`dragleave`/`drop` events on the input
wrapper, with a visual `drag-over` class for feedback.

### 5.3 Rendering of Attachment Chips

`renderChips()` rebuilds `div.chat-attachment-chips` from the `pending` array.
Each chip shows either a thumbnail (`<img>` with `objectUrl`) for images or a
file-text icon with the filename for text files. A remove button (`x` icon)
revokes the object URL and splices the item from the array.

On send, `handleSendMessage()` snapshots `pending`, calls `clear()`, and builds
the final `ContentBlock[]` array (images first, then text, then file blocks).

---

## 6. HistoryPanel -- Conversation History

**File:** `src/ui/sidebar/HistoryPanel.ts`

### 6.1 Sliding Overlay UI

The panel is an absolute-positioned `div.history-panel` inside the chat wrapper.
It slides in via CSS transition (`history-panel-open` class). The toggle button
in the header calls `toggle()` which alternates between `open()` and `close()`.
Close has a 200ms timeout matching the CSS transition before setting
`display: none`.

### 6.2 Date Grouping

Conversations are grouped into four buckets using `getDateGroup()`:

- **Today** -- created/updated today
- **Yesterday** -- created/updated yesterday
- **This Week** -- within the current calendar week
- **Older** -- everything else

Within each group, conversations are listed in reverse-chronological order.
Time is shown as HH:MM for Today/Yesterday, and as "Mon DD" for older entries.

### 6.3 Search Functionality

A text input at the top of the panel filters conversations by title
(case-insensitive substring match). The list re-renders on every keystroke.

### 6.4 Restore and Continue Conversations

Clicking a row calls `onLoad(id)` which triggers `loadConversation(id)`: saves
the current conversation, replaces `conversationHistory` and `uiMessages` with
stored data, re-renders the chat, and highlights the active row. Each row also
has a delete button (trash icon, visible on hover).

### 6.5 ConversationStore Integration

The panel receives a `ConversationStore` in its constructor. It calls
`store.list()` to get `ConversationMeta[]` (id, title, updated, messageCount).
The store handles JSON persistence in the plugin's data directory.

---

## 7. DiffReviewModal -- Edit Approval and Review

**File:** `src/ui/DiffReviewModal.ts`

### 7.1 Two Modes

| Mode | Purpose | Footer Actions |
|---|---|---|
| `review` | Post-task review of all agent changes. | Undo All, Apply Selected, Keep All |
| `checkpoint` | Read-only diff view of a checkpoint. | Close, Restore to this checkpoint |

### 7.2 Side-by-Side Diff View

The modal computes line-level diffs using `diffLines()` and renders them in a
side-by-side layout. Added lines appear on the right (green), removed lines on
the left (red), unchanged context on both sides. Long stretches of unchanged
lines (> 7) are collapsed behind a clickable "... N unchanged lines" button.

### 7.3 Section-Based Grouping

Raw diff hunks are mapped to Markdown semantic sections via
`parseMarkdownSections()`. Section types: frontmatter, heading, code-block,
list, callout, table, paragraph. Each section gets a header with an icon,
label, and per-section stats (+X / -Y). Multiple hunks within the same
section are grouped for semantically meaningful approval decisions.

### 7.4 User Editing Capability

In `review` mode, each section header has three buttons: Keep, Undo, Edit.
The Edit button opens an inline textarea pre-filled with the new-side content
for that section. The user can modify the text and click "Apply Edit". The
edited content is stored in `group.editedContent` and used during final
content assembly.

### 7.5 Accept/Reject Flow

- **Keep**: Marks section as `approved` (green border).
- **Undo**: Marks section as `rejected` (red border).
- **Keep All**: Closes modal without changes (empty decisions array).
- **Undo All**: Marks all sections as rejected, returns revert decisions.
- **Apply Selected**: Enabled once every section has a decision. Approved
  sections keep new content, rejected sections revert, edited sections use
  the user's text.

Content assembly: `assembleFromHunks()` for pure approve/reject,
`assembleWithEdits()` for sections with user edits (tracks `newLineIndex`
to splice edited content at correct positions).

---

## 8. Settings Tab System -- AgentSettingsTab

**File:** `src/ui/AgentSettingsTab.ts`

### 8.1 Tab Router Architecture

`AgentSettingsTab` extends Obsidian's `PluginSettingTab`. It implements a
two-level tab navigation: four top-level tabs, each with sub-tabs. Router state
is held in `activeTab`, `activeProvidersSubTab`, `activeAgentSubTab`, and
`activeAdvancedSubTab`. Navigation calls `this.display()` which clears and
rebuilds the entire settings DOM. `openAt(tab, subTab)` enables programmatic
deep-linking (e.g., from the `obsidian://obsilo-settings` URI handler).

### 8.2 Tab Overview

Each sub-tab is an extracted module in `src/ui/settings/`. The tab router
instantiates the module and calls `.build(container)`.

**Providers** (top-level)

| Sub-Tab | Module | Purpose |
|---|---|---|
| Models | `ModelsTab` | Configure LLM models (built-in + custom), API keys, enable/disable, per-model settings. |
| Embeddings | `EmbeddingsTab` | Embedding model configuration for semantic search. |
| Web Search | `WebSearchTab` | Web search provider selection (Brave, Tavily), API keys. |
| MCP | `McpTab` | MCP server configuration (stdio/SSE), server list management. |

**Agent Behaviour** (top-level)

| Sub-Tab | Module | Purpose |
|---|---|---|
| Modes | `ModesTab` | View and edit agent modes, tool group assignments, custom modes. |
| Auto-Approve | `PermissionsTab` | Per-tool-group auto-approval toggles (read, write, command, web, mcp). |
| Loop | `LoopTab` | Max iterations, consecutive mistake limit, rate limit, condensing threshold, power steering frequency. |
| Memory | `MemoryTab` | Memory system settings: enable/disable, auto-extract sessions, extraction threshold. |
| Rules | `RulesTab` | Manage rule files (.md) that are injected into the system prompt. Toggle per rule. |
| Workflows | `WorkflowsTab` | Manage workflow files (slash commands). Toggle per workflow. |
| Skills | `SkillsTab` | Discover and toggle skills. Manual enable/disable per skill. |
| Prompts | `PromptsTab` | Custom support prompts (slug, content, mode scope). |

**Vault** (top-level, single tab)

| Module | Purpose |
|---|---|
| `VaultTab` | Vault-level settings: auto-add active file context, semantic index configuration, ignored paths. |

**Advanced** (top-level)

| Sub-Tab | Module | Purpose |
|---|---|---|
| Interface | `InterfaceTab` | UI preferences: send with Enter, theme overrides, display options. |
| Shell | `ShellTab` | Shell command execution settings: allowed commands, shell path, timeout. |
| Log | `LogTab` | View and filter the agent execution log. |
| Debug | `DebugTab` | Debug toggles, verbose logging, internal state inspection. |
| Backup | `BackupTab` | Export/import plugin settings and conversation history. |

**Total: 4 top-level tabs, 18 sub-tabs (17 extracted modules + 1 single-tab).**
