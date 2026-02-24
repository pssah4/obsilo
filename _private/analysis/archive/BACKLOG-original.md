# Obsidian Agent — Backlog

> Vollständiger Plan: `.claude/plans/synthetic-gathering-tide.md`
> Status: `[ ]` offen · `[~]` in Arbeit · `[x]` fertig · `[-]` zurückgestellt

---

## Sprint 1 — Kritische Blocker ✅ Abgeschlossen

### 1.1 Diff-basiertes Editing
- [x] **`edit_file` Tool** (`src/core/tools/vault/EditFileTool.ts`)
  - Parameter: `path`, `old_str`, `new_str`, `expected_replacements?`
  - Fuzzy-Matching Fallback bei Whitespace-Unterschieden
  - `isWriteOperation: true` → Checkpoint vor Ausführung
- [x] **`append_to_file` Tool** (`src/core/tools/vault/AppendToFileTool.ts`)
  - Parameter: `path`, `content`, `separator?` (default: `\n`)
- [x] **Settings: Diff-Editing Toggle** (in Settings → Advanced implementiert)

### 1.2 Agent-Control-Tools
- [x] **`ask_followup_question` Tool** (`src/core/tools/agent/AskFollowupQuestionTool.ts`)
  - Unterbricht Loop via Promise → wartet auf User-Antwort via Approval-Card
- [x] **`attempt_completion` Tool** (`src/core/tools/agent/AttemptCompletionTool.ts`)
  - Beendet AgentTask-Loop, triggert Todo-Auto-Complete im UI
- [x] **`switch_mode` Tool** (`src/core/tools/agent/SwitchModeTool.ts`)
  - Wechselt Mode innerhalb laufendem Task, rebuilt System Prompt
- [x] **UI: Question-Card + Todo-Box + Approval-Card in `AgentSidebarView.ts`**

### 1.3 Auto-Approve System
- [x] **`AutoApprovalConfig` Typ in `settings.ts`**
- [x] **Approval-Logik in `ToolExecutionPipeline.ts`**
- [x] **Approval-Card UI in `AgentSidebarView.ts`** (inline mit Allow / Enable Always / Deny)
- [x] **Settings: Behaviour-Tab — Auto-Approve Sektion** (read/write/web/mcp/subtasks/todo)

### 1.4 Checkpoints (isomorphic-git)
- [x] **`GitCheckpointService`** (`src/core/checkpoints/GitCheckpointService.ts`)
  - Shadow-Repo in `.obsidian/plugins/obsidian-agent/checkpoints/`
  - `snapshot(taskId, files[])`, `restore(checkpoint)`, `diff(checkpoint)`
- [x] **Integration in `ToolExecutionPipeline.ts`** — Snapshot vor erstem Write
- [x] **Undo-Bar in `AgentSidebarView.ts`** — erscheint nach Write-Ops, "Undo all changes"
- [x] **Settings: Behaviour-Tab — Checkpoints Sektion** (Enable, Timeout, Auto-Cleanup)

### 1.5 Advanced API Settings
- [x] **Temperature-Support** per Model (in Model-Config-Modal)
- [x] **`consecutiveMistakeLimit`** in `AgentTask.ts` verdrahtet
- [x] **`rateLimitMs`** (Sleep zwischen Iterationen) in `AgentTask.ts` verdrahtet
- [x] **Settings: Advanced-Tab** (Consecutive Error Limit, Rate Limit Ms)

### 1.6 Governance: Ignore & Protected Files
- [x] **`IgnoreService`** (`src/core/governance/IgnoreService.ts`)
- [x] **Integration in `ToolExecutionPipeline.ts`** — VOR Approval-Check

### 1.7 Operation Logging / Audit Trail
- [x] **`OperationLogger`** (`src/core/governance/OperationLogger.ts`)
  - Speicherort: `.obsidian/plugins/obsidian-agent/logs/YYYY-MM-DD.jsonl`
- [x] **Integration in `ToolExecutionPipeline.ts`**
- [ ] **Log-Viewer in Settings (About-Tab)** *(noch offen)*

---

## Sprint 2 — Display & Context (teilweise fertig)

### 2.1 Display Settings
- [x] **Timestamps** — im Message-Footer (Tool-Zeit + Abschlusszeit)
- [x] **Thinking-Blöcke collapsible** — mit Spinner während Reasoning, kollabierend bei Text-Start
- [x] **Tool I/O expandierbar** — `<details>` pro Tool-Call, auto-expand während läuft, collapse bei Erfolg
- [x] **Token-Usage** — `{input} in · {output} out` im Footer, akkumuliert über Iterationen
- [x] **Enter-to-Send** — `sendWithEnter` Setting implementiert
- [ ] **Diff-Stats Badge** nach Write-Ops (`+12 / -3 Zeilen`) *(offen)*
- [ ] **Cost-Threshold** (Kosten unter X Cent ausblenden) *(zurückgestellt)*
- [ ] **Task-Timeline** (horizontale Leiste) *(zurückgestellt — Todo-Box erfüllt ähnlichen Zweck)*

### 2.2 Context Settings
- [x] **Current Time im System Prompt** — ganz oben, ISO + Human-Readable + Timezone
- [x] **Large-File-Guard** — Warnung bei Dateien > 80% Kontext (in ReadFileTool)
- [ ] **Max concurrent file reads / Semaphore** *(offen — → Sprint parallel execution)*
- [ ] **Condensing Trigger** (Auto-Komprimierung wenn Kontext voll) *(offen — Sprint 7)*

### 2.3 Support Prompts (Quick Actions)
- [ ] **✨ Button im Chat-Input** — Dropdown: Prompt verbessern / Zusammenfassen / Erklären / Beheben *(offen)*
- [ ] **Settings: editierbare Templates je Quick-Action** *(offen)*

### 2.4 Chat Autocomplete
- [ ] **`/` → Workflow-Auswahl** im Input-Dropdown *(offen — hängt an Sprint 3.3)*
- [ ] **`@` → Datei-Mention** (Vault-Dateisuche, Datei als Kontext hinzufügen) *(offen)*

---

## Sprint 3 — Modes & Agent Behaviour (teilweise fertig)

### 3.1 Custom Modes + Mode Editor
- [x] **`ModeConfig` Typ** in `settings.ts`
- [x] **5 Built-in Modes** (ask, writer, architect, librarian, orchestrator)
- [x] **Mode-Selector** im Chat dynamisiert (alle built-in + custom)
- [x] **Tool-Filterung je Mode** (ToolGroups in AgentTask + ModeService)
- [x] **Mode Editor Settings-Tab** — full CRUD, Icon, Name, Slug, Role, Custom Instructions
- [x] **Global Modes** (vault-übergreifend gespeichert)
- [x] **Per-Mode API-Config** (eigenes Modell je Mode wählbar)
- [ ] **Mode-Export/Import** (JSON/YAML) *(offen)*

### 3.2 Rules
- [ ] **`RulesLoader`** (`src/core/context/RulesLoader.ts`) *(offen)*
- [ ] **Integration in `systemPrompt.ts`** *(offen)*
- [ ] **Settings-Tab „Rules"** (UI-Placeholder existiert, Logik fehlt) *(offen)*

### 3.3 Workflows (Slash-Commands)
- [ ] **`WorkflowLoader`** (`src/core/context/WorkflowLoader.ts`) *(offen)*
- [ ] **Slash-Command Processing** in `AgentSidebarView.ts` *(offen)*
- [ ] **Settings-Tab „Workflows"** (UI-Placeholder existiert, Logik fehlt) *(offen)*

### 3.4 Skills
- [ ] **`SkillsManager`** (`src/core/context/SkillsManager.ts`) *(offen)*
- [ ] **Integration in `AgentTask.ts`** *(offen)*
- [ ] **Settings-Tab „Skills"** (UI-Placeholder existiert, Logik fehlt) *(offen)*

---

## Sprint 4 — Orchestrierung & Multi-Agent (teilweise fertig)

### 4.1 Todo-Listen
- [x] **`update_todo_list` Tool** (`src/core/tools/agent/UpdateTodoListTool.ts`)
- [x] **Todo-Box UI** in `AgentSidebarView.ts` — live-update, auto-complete bei `attempt_completion`

### 4.2 Multi-Agent / Orchestrator
- [ ] **`new_task` Tool** (`src/core/tools/agent/NewTaskTool.ts`) *(offen)*
- [ ] **`AgentTask`: `parentTask?` Referenz + Tiefen-Check** *(offen)*
- [ ] **Multi-Agent UI** (verschachtelte Task-Anzeige) *(offen)*

---

## Sprint 5 — Web & Vault-Intelligence (teilweise fertig)

### 5.1 Web-Tools
- [x] **`web_fetch` Tool** (`src/core/tools/web/WebFetchTool.ts`)
- [x] **`web_search` Tool** (`src/core/tools/web/WebSearchTool.ts`) — Brave/Tavily/None
- [x] **Settings: Web-Tab** (Enable Toggle, Provider-Dropdown, API Key)

### 5.2 Canvas Generation
- [ ] **`generate_canvas` Tool** *(offen — P0-Feature)*
- [ ] **Canvas-Hilfsfunktionen** (`canvasLayout.ts` — Grid + Force-Directed) *(offen)*

### 5.3 Obsidian Bases Tools
- [ ] **`create_base` Tool** *(offen)*
- [ ] **`update_base` Tool** *(offen)*
- [ ] **`query_base` Tool** *(offen)*

### 5.4 Vault-Intelligence Tools
- [x] **`get_vault_stats` Tool** — fileCount, folderCount, topTags, recentFiles
- [x] **`search_by_tag` Tool** — tags[], match: all|any
- [x] **`get_frontmatter` Tool** — metadataCache
- [x] **`update_frontmatter` Tool** — processFrontMatter()
- [x] **`get_linked_notes` Tool** — Backlinks + Outlinks
- [x] **`open_note` Tool** — öffnet Datei im Editor
- [x] **`get_daily_note` Tool** — offset (heute/-1/+1), create-Flag

---

## Sprint 6 — Power Features & Experimental

### 6.1 Power Steering
- [ ] **Mode-Reminder** alle N Iterationen in `AgentTask.ts` *(offen)*
- [ ] **Settings: „Power Steering" Toggle + Frequenz** *(offen)*

### 6.2 Experimental Toggles
- [ ] **Concurrent File Edits** *(offen — verwandt mit #9 Parallel Execution)*
- [ ] **Custom Tools** (`.ts` Dateien im Plugin-Ordner laden) *(offen)*

### 6.3 Speech-to-Text (optional)
- [ ] **Mikrofon-Button + Whisper** *(zurückgestellt)*

---

## Sprint 7 — Infrastruktur

### 7.1 Context-Condensing
- [ ] **Token-Schätzer** in `AgentTask.ts` *(offen)*
- [ ] **Condense-Logik** (separater LLM-Call, behält letzte 4 Messages) *(offen)*
- [ ] **UI-Indikator** „Konversation komprimiert" *(offen)*

### 7.2 MCP-Integration
- [ ] **`McpClient`** (`src/core/mcp/McpClient.ts`) *(offen — UI-Placeholder vorhanden)*
- [ ] **`use_mcp_tool` Tool** *(offen)*
- [ ] **Settings-Tab „MCP"** (Placeholder existiert, Logik fehlt) *(offen)*

### 7.3 Task-Persistenz
- [ ] **`TaskHistory`** (`src/core/persistence/TaskHistory.ts`) *(offen)*
- [ ] **History-UI** in `AgentSidebarView.ts` *(offen)*

### 7.4 Notifications
- [ ] **System-Notification bei Task-Completion** *(offen)*

### 7.5b Semantic Index (lokal)
- [ ] **`vectra` npm Package** — In-Memory + JSON-Persistenz *(offen)*
- [ ] **`SemanticIndexService`** (`src/core/semantic/SemanticIndexService.ts`) *(offen)*
- [ ] **`semantic_search` Tool** *(offen)*
- [ ] **Index-Status-Badge in `AgentSidebarView.ts`** *(offen)*
- [ ] **Settings: Semantic Index Sektion** *(offen)*

### 7.6 Export / Import / Reset
- [ ] **Export/Import/Reset Settings** *(offen)*
- [ ] **About-Tab** mit Plugin-Version + Links *(offen)*

---

## Offene Querschnitts-Tasks

### #9 Parallel Tool Execution *(neu — hohe Priorität)*
- [ ] **Parallele Read-Tools** in `AgentTask.ts` — `Promise.all()` für unabhängige Reads
  - Sicher parallel: `read_file`, `list_files`, `search_files`, `get_frontmatter`, `get_linked_notes`, `search_by_tag`, `web_fetch`, `web_search`
  - Weiterhin sequenziell: alle Write-Tools (Konfliktrisiko)

### Log-Viewer (1.7 Rest)
- [ ] **Log-Viewer in Settings (About-Tab)** — JSONL-Logs lesbar machen

---

## Notizen zur Implementierung

### Datei-Konventionen
- Neue Tools: `src/core/tools/{kategorie}/{ToolName}Tool.ts`
- Neue Kontext-Loader: `src/core/context/{Name}.ts`
- Neue Settings-Typen: immer in `src/types/settings.ts`
- Jedes neue Tool: in `ToolRegistry.registerInternalTools()` registrieren

### Kilo Code Referenzen
- new_task: `forked-kilocode/src/core/tools/NewTaskTool.ts`
- skills: `forked-kilocode/src/services/skills/SkillsManager.ts`
- rules: `forked-kilocode/src/core/context/RulesLoader.ts`
- modes: `forked-kilocode/packages/types/src/mode.ts`

### Nach jedem Abschnitt
```bash
npx tsc --noEmit      # TypeScript prüfen
node esbuild.config.mjs production  # Build + Deploy in Vault
# → Obsidian neu laden + testen
```
