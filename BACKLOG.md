# Obsidian Agent — Backlog

> Vollständiger Plan: `.claude/plans/synthetic-gathering-tide.md`
> Status: `[ ]` offen · `[~]` in Arbeit · `[x]` fertig · `[-]` zurückgestellt

---

## Sprint 1 — Kritische Blocker

### 1.1 Diff-basiertes Editing
- [ ] **`edit_file` Tool** (`src/core/tools/vault/EditFileTool.ts`)
  - Parameter: `path`, `old_str`, `new_str`, `expected_replacements?`
  - Fuzzy-Matching mit konfigurierbarer Precision (0–100%)
  - Fehler bei: not found / Ambiguität / truncated
  - `isWriteOperation: true` → Checkpoint vor Ausführung
  - In `ToolRegistry` registrieren
  - In `systemPrompt.ts` beschreiben
- [ ] **`append_to_file` Tool** (`src/core/tools/vault/AppendToFileTool.ts`)
  - Parameter: `path`, `content`, `separator?` (default: `\n`)
  - `isWriteOperation: true`
- [ ] **Settings: Diff-Editing Toggle + Match Precision Slider**
  - `settings.advancedApi.enableDiffEditing: boolean`
  - `settings.advancedApi.diffMatchPrecision: number` (0–100)
  - Im Models-Tab, Abschnitt "Advanced"

### 1.2 Agent-Control-Tools
- [ ] **`ask_followup_question` Tool** (`src/core/tools/agent/AskFollowupQuestionTool.ts`)
  - Parameter: `question`, `options?: string[]`
  - Unterbricht Loop via Promise → wartet auf User-Antwort
  - UI: Question-Card im Chat mit optionalen Buttons
  - Callback in `AgentTask`: `onQuestion(q, options) → Promise<string>`
  - Callback in `AgentSidebarView`: rendert Card, resolved Promise bei Klick
- [ ] **`attempt_completion` Tool** (`src/core/tools/agent/AttemptCompletionTool.ts`)
  - Parameter: `result`
  - Beendet AgentTask-Loop sofort (setzt Flag)
  - UI: Completion-Card (grün, mit result-Text)

### 1.3 Auto-Approve System
- [ ] **`AutoApprovalConfig` Typ in `settings.ts`**
  ```typescript
  { enabled, showMenuInChat, read, write, web, mcp, mode, subtasks, question, todo }
  ```
  Default: `enabled: false`, alle Sub-Toggles `false`
- [ ] **Approval-Logik in `ToolExecutionPipeline.ts`**
  - `checkApproval(toolName, params) → Promise<'auto'|'approved'|'rejected'>`
  - Session-Cache: "Immer erlauben" für Tool-Typ merken
  - Tool-Typ-Mapping: read/write/web/agent/mcp
- [ ] **Approval-Callback-Architektur in `AgentTask.ts`**
  - `onApprovalRequired(tool, params) → Promise<boolean>`
- [ ] **Approval-Card UI in `AgentSidebarView.ts`**
  - Zeigt Tool-Name + Parameter-Preview
  - Buttons: Erlauben / Immer erlauben / Ablehnen
  - Resolved Pipeline-Promise bei Klick
- [ ] **Auto-Approve-Leiste im Chat**
  - Sichtbar wenn `showMenuInChat: true`
  - Schnell-Toggles: ⚡ Auto · 📖 Lesen · ✏️ Schreiben · 🌐 Web · 🤖 Tasks
- [ ] **Settings: Behaviour-Tab — Auto-Approve Sektion**
  - Master-Toggle + Chat-Menu-Toggle
  - Granulare Toggles je Operationstyp (read, write, web, mcp, mode, subtasks, question, todo)

### 1.4 Checkpoints (isomorphic-git)
> Original-Scope: ADR-003 — Shadow-Repo in `.obsidian-agent/checkpoints/` via isomorphic-git (kein externes Git nötig)

- [ ] **`isomorphic-git` als Dependency** (`package.json`)
  - `npm install isomorphic-git` — läuft im Browser/Electron ohne nativen Git-Client
- [ ] **`GitCheckpointService`** (`src/core/checkpoints/GitCheckpointService.ts`)
  - Shadow-Repo: `.obsidian/plugins/obsidian-agent/checkpoints/` (git init beim ersten Start)
  - `snapshot(taskId)` — staged commit aller geänderten Dateien vor Task-Start
  - `restore(taskId)` — git checkout auf Snapshot-Commit
  - `diff(taskId)` — unified diff zwischen Snapshot und aktuellem Stand
  - `cleanup(taskId)` — Branch/Tag des Snapshots löschen
  - Timeout-Support: Operation schlägt nach N Sekunden fehl
  - Auto-Cleanup nach Task-Ende (wenn konfiguriert)
- [ ] **Integration in `ToolExecutionPipeline.ts`**
  - `checkpoint.snapshot(taskId)` VOR erstem schreibenden Tool-Call des Tasks
- [ ] **Diff-Anzeige in `AgentSidebarView.ts`**
  - Nach Task-Ende (wenn Writes stattfanden): Diff-Button + Undo-Button
  - Diff-Modal: unified diff aller Änderungen des Tasks
  - Klick Undo → `checkpoint.restore(taskId)`
- [ ] **Settings: Behaviour-Tab — Checkpoints Sektion**
  - "Automatische Checkpoints" Toggle
  - "Timeout (Sekunden)" Number-Input (default: 30)
  - "Auto-Cleanup nach Task" Toggle

### 1.6 Governance: Ignore & Protected Files
> Original-Scope: GOV-02, nicht-verhandelbare technische Constraints

- [ ] **`.obsidian-agentignore` Unterstützung** (`src/core/governance/IgnoreService.ts`)
  - Liest `.obsidian-agentignore` aus Vault-Root (gitignore-Syntax)
  - `isIgnored(path): boolean` — prüft vor jedem Tool-Call
  - Default-Ignoriert: `.obsidian/`, `node_modules/`, `.git/`
  - Gitignore-Parsing: eigene Implementierung oder `ignore` npm package
- [ ] **`.obsidian-agentprotected` Unterstützung**
  - Dateien/Ordner die NIEMALS modifiziert werden dürfen (auch nicht mit Approval)
  - `isProtected(path): boolean` — harte Sperre in `ToolExecutionPipeline`
  - Bei Versuch: Fehler-Card im Chat mit Erklärung
- [ ] **Integration in `ToolExecutionPipeline.ts`**
  - VOR Approval-Check: `ignoreService.isIgnored(path)` + `ignoreService.isProtected(path)`
- [ ] **Settings: Behaviour-Tab — Governance Sektion**
  - "Ignorierte Pfade anzeigen" → zeigt aktive Ignore-Regeln
  - "Geschützte Dateien anzeigen" → zeigt Protected-Liste
  - Link: "`.obsidian-agentignore` bearbeiten" → öffnet Datei

### 1.7 Operation Logging / Audit Trail
> Original-Scope: GOV-02 — Jeder Tool-Call wird persistent geloggt

- [ ] **`OperationLogger`** (`src/core/governance/OperationLogger.ts`)
  - Speicherort: `.obsidian/plugins/obsidian-agent/logs/YYYY-MM-DD.jsonl`
  - Format: `{ timestamp, taskId, mode, tool, params, result, durationMs }`
  - Rotierung: neue Datei pro Tag, max 30 Tage behalten
  - Writes: immer loggen (auch auto-approved)
  - Reads: nur loggen wenn Debug-Mode aktiv
- [ ] **Integration in `ToolExecutionPipeline.ts`**
  - Nach jedem `tool.execute()`: `logger.log(toolCall, result)`
- [ ] **Log-Viewer in Settings (About-Tab)**
  - Liste der letzten N Log-Einträge
  - Filter nach Tool-Typ / Datum
  - "Logs löschen" Button

### 1.5 Advanced API Settings
- [ ] **`AdvancedApiSettings` Typ in `settings.ts`**
  ```typescript
  { useCustomTemperature, temperature, consecutiveMistakeLimit, rateLimitSeconds }
  ```
- [ ] **Temperature-Support in `AnthropicProvider` + `OpenAiProvider`**
  - Wenn `useCustomTemperature: true` → `temperature` an API übergeben
- [ ] **Error/Repetition Detector in `AgentTask.ts`**
  - Zählt konsekutive Fehler
  - Bei Limit → Dialog: "Agent hat Probleme — fortfahren oder abbrechen?"
  - Limit 0 = deaktiviert
- [ ] **Rate Limiting in `AgentTask.ts`**
  - Mindest-Wartezeit zwischen API-Calls (requestAnimationFrame / setTimeout)
- [ ] **Settings: Behaviour-Tab — Advanced API Sektion**
  - Custom Temperature Toggle + Slider
  - Error/Repetition Limit Number-Input
  - Rate Limit Number-Input

---

## Sprint 2 — Display & Context

### 2.1 Display Settings
- [ ] **`DisplaySettings` Typ in `settings.ts`**
  ```typescript
  { collapseThinkingByDefault, showTaskTimeline, showTimestamps, showDiffStats,
    sendWithEnter, hideCostBelowCents }
  ```
- [ ] **Timestamps in `AgentSidebarView.ts`**
  - Kleiner grauer Zeitstempel unter jeder Message
  - Sichtbar wenn `showTimestamps: true`
- [ ] **Thinking-Blöcke collapsible**
  - `<details><summary>💭 Denkt nach...</summary>...</details>`
  - Default-State: `collapseThinkingByDefault` Setting
- [ ] **Diff-Stats nach Write-Ops**
  - "+12 Zeilen hinzugefügt, -3 entfernt" Badge
  - Sichtbar wenn `showDiffStats: true`
- [ ] **Task-Timeline (optional)**
  - Horizontale Leiste mit farbigen Punkten pro Message-Typ
  - Sichtbar wenn `showTaskTimeline: true`
- [ ] **Enter-to-Send Verhalten**
  - Wenn `sendWithEnter: true`: Enter sendet, Shift+Enter = Newline
  - Default: true (wie Kilo Code)
- [ ] **Cost-Threshold**
  - Kosten unter X Cent ausblenden
  - Default: 0 (immer zeigen)
- [ ] **Settings: Behaviour-Tab — Display Sektion**

### 2.2 Context Settings
- [ ] **`ContextSettings` Typ in `settings.ts`**
  ```typescript
  { maxConcurrentFileReads, allowVeryLargeFileReads, includeCurrentTimeInContext,
    condensingEnabled, condensingTriggerThreshold, maxVaultFilesInContext }
  ```
- [ ] **Current Time im System Prompt** (`src/core/systemPrompt.ts`)
  - Wenn `includeCurrentTimeInContext: true` → Datum+Zeit+Timezone injizieren
- [ ] **Max concurrent file reads** in `ReadFileTool.ts`
  - Wenn mehrere read_file in einem Turn → Semaphore / Limit
- [ ] **Large file guard** in `ReadFileTool.ts`
  - Warnung wenn Datei > 80% Kontext-Fenster, außer `allowVeryLargeFileReads: true`
- [ ] **Condensing Trigger Threshold** in `AgentTask.ts`
  - Token-Schätzung nach jeder Message
  - Bei > Threshold% → auto-condense (separater LLM-Call)
- [ ] **Settings: Behaviour-Tab — Context Sektion**

### 2.3 Support Prompts (Quick Actions)
- [ ] **`SupportPrompts` Typ in `settings.ts`**
  - `enhancePrompt`, `summarize`, `explain`, `fix` — je ein String-Template
- [ ] **✨ Button im Chat-Input** (`AgentSidebarView.ts`)
  - Öffnet Dropdown: Prompt verbessern / Zusammenfassen / Erklären / Beheben
  - Injiziert Template (mit aktuellem Prompt / offener Note) in Input-Feld
- [ ] **Settings: Behaviour-Tab — Prompts Sektion**
  - Editierbare Textareas je Quick-Action

### 2.4 Chat Autocomplete
- [ ] **`/` → Workflow-Autocomplete im Input**
  - Tippen von `/` → Dropdown mit verfügbaren Workflows
  - Dateiname + erste Zeile als Beschreibung
  - Tab/Enter/Klick: Workflow-Content in Message injizieren
- [ ] **`@` → Datei-Mention (optional)**
  - Tippen von `@` → Vault-Dateisuche
  - Gewählte Datei als Kontext zum nächsten Message hinzufügen
- [ ] **Settings: Toggle "Chat-Autocomplete aktivieren"**

---

## Sprint 3 — Modes & Agent Behaviour

### 3.1 Custom Modes + Mode Editor
- [ ] **`ModeConfig` Typ** (`src/types/modes.ts`)
  ```typescript
  { slug, name, roleDefinition, shortDescription?, whenToUse?,
    customInstructions?, groups, apiConfig?, iconName?, source }
  ```
- [ ] **`TOOL_GROUP_TOOLS` Mapping**
  - `read | edit | web | agent | mcp` → Tool-Namen
- [ ] **5 Built-in Modes in `systemPrompt.ts` überarbeiten**
  - ask, writer, architect, researcher, orchestrator
- [ ] **Mode-Selector in `AgentSidebarView.ts` dynamisieren**
  - Zeigt alle built-in + custom Modes
  - Short Description als Tooltip
- [ ] **Tool-Filterung in `AgentTask.ts`**
  - Nur Tools die zum Mode's `groups` gehören an LLM übergeben
- [ ] **Mode Editor Settings-Tab**
  - Liste aller Modes: Icon, Name, Beschreibung
  - Built-in: nur `customInstructions` editierbar
  - Custom: full CRUD + Export/Import
  - Felder: Name, Slug, Role Definition, Short Desc, When to Use, Tool Groups, API Config
- [ ] **Mode-Export/Import** (JSON/YAML)
- [ ] **`switch_mode` Tool** (`src/core/tools/agent/SwitchModeTool.ts`)
  - Validiert slug, Approval, lädt neuen System Prompt in laufendem Task

### 3.2 Rules
- [ ] **`RulesLoader`** (`src/core/context/RulesLoader.ts`)
  - Liest `.obsidian/plugins/obsidian-agent/rules/` + konfig. Vault-Ordner
  - Filtert nach `.md`/`.txt`, respektiert `settings.rulesToggles`
  - Mode-spezifische Rules: `rules-{slug}/` Unterordner
- [ ] **Integration in `systemPrompt.ts`**
  - Aktive Rules ans Ende des System Prompts anhängen
- [ ] **Settings-Tab "Rules"**
  - Global Rules + Vault Rules je mit Toggle/Edit/Delete
  - "+ Neue Regel" → Textarea-Modal → speichert als Datei

### 3.3 Workflows (Slash-Commands)
- [ ] **`WorkflowLoader`** (`src/core/context/WorkflowLoader.ts`)
  - Liest `.obsidian/plugins/obsidian-agent/workflows/`
  - Listet Dateien mit Name + erster Zeile als Beschreibung
  - Respektiert `settings.workflowToggles`
- [ ] **Slash-Command Processing** in `AgentSidebarView.ts`
  - Bei Absenden: `/name` in Message erkennen
  - Workflow-Inhalt als `<explicit_instructions>` prefixen
- [ ] **Settings-Tab "Workflows"**
  - Global + Vault Workflows mit Toggle/Edit/Delete
  - "+ Neuer Workflow" → Editor-Modal

### 3.4 Skills
- [ ] **`SkillsManager`** (`src/core/context/SkillsManager.ts`)
  - Entdeckt `SKILL.md` Dateien in `skills/` Unterverzeichnissen
  - Parsed Frontmatter: `name`, `description`, `mode?`
  - Keyword-Matching: User-Message vs. alle `description`-Felder
- [ ] **Integration in `AgentTask.ts`**
  - Vor jedem LLM-Call: relevante Skills in System Prompt injizieren
- [ ] **Settings-Tab "Skills"**
  - Entdeckte Skills mit Name + Description + Source
  - "+ Neuen Skill erstellen" → Wizard

---

## Sprint 4 — Orchestrierung & Multi-Agent

### 4.1 Todo-Listen
- [ ] **`update_todo_list` Tool** (`src/core/tools/agent/UpdateTodoListTool.ts`)
  - Parameter: `todos` (Markdown-Checklist: `[ ]`, `[~]`, `[x]`)
  - Speichert in `AgentTask.currentTodos`
  - Callback: `onTodoUpdate(todos)` → UI
- [ ] **Todo-Box UI in `AgentSidebarView.ts`**
  - Persistent sichtbar über den Chat-Messages
  - Live-Update bei `update_todo_list`-Calls
  - ✅ / ⏳ / ☐ Icons je Status
- [ ] **Settings: "Todo-Listen-Tool aktivieren" Toggle**

### 4.2 Multi-Agent / Orchestrator
- [ ] **`new_task` Tool** (`src/core/tools/agent/NewTaskTool.ts`)
  - Parameter: `mode`, `message`
  - Erstellt Kind-`AgentTask` mit eigenem Mode + Tool-Set
  - Eltern wartet auf `attempt_completion` des Kinds
  - Max 3 Tiefenebenen (prüfen via `parentTask` chain)
- [ ] **`AgentTask`: `parentTask?` Referenz** + Tiefen-Check
- [ ] **Orchestrator Mode** als Built-in hinzufügen
  - `groups: ['agent']` only
  - System Prompt auf Koordination ausgerichtet
- [ ] **Multi-Agent UI in `AgentSidebarView.ts`**
  - Verschachtelte Task-Anzeige: Einrückung + Mode-Label
  - Status-Icons je Subtask

---

## Sprint 5 — Web & Vault-Intelligence

### 5.1 Web-Tools
- [ ] **`web_fetch` Tool** (`src/core/tools/web/WebFetchTool.ts`)
  - Parameter: `url`, `selector?`
  - `requestUrl()` → HTML → Markdown (eigene Implementierung)
  - Max 8.000 Zeichen Output
  - `isWriteOperation: false`
- [ ] **`web_search` Tool** (`src/core/tools/web/WebSearchTool.ts`)
  - Parameter: `query`, `num_results?`
  - Provider-Dispatch: Brave / Tavily / DuckDuckGo
  - Gibt `[{ title, url, snippet }]` zurück
- [ ] **Settings: Behaviour-Tab — Web Sektion**
  - "Web-Tools aktivieren" Toggle
  - Provider-Dropdown + API Key
  - "Remote Browser" Stub (deaktiviert, "Kommt bald")
- [ ] **Web-Provider in `ToolRegistry` registrieren** (nur wenn enabled)

### 5.2 Canvas Generation
> Original-Scope: VIS-01 — P0-Feature; Obsidian Canvas als Ausgabeformat für Wissensstrukturen

- [ ] **`generate_canvas` Tool** (`src/core/tools/vault/GenerateCanvasTool.ts`)
  - Parameter: `path` (Ausgabe-Canvas-Datei), `source_folder?`, `filter_tags?`, `layout?: 'force'|'grid'`
  - Liest `metadataCache` für alle Wikilinks zwischen Notizen
  - Produziert `.canvas` JSON (Obsidian Canvas Format):
    ```json
    { "nodes": [{ "id", "type": "file", "file": "path.md", "x", "y", "width", "height" }],
      "edges": [{ "id", "fromNode", "toNode", "fromSide", "toSide" }] }
    ```
  - Layout-Algorithmen: Grid (einfach) oder Force-Directed (iterativ, keine externe Lib nötig)
  - Filtert nach `filter_tags` wenn angegeben (nur Notizen mit diesen Tags)
  - Einschränkung auf `source_folder` wenn angegeben
  - `isWriteOperation: true`
- [ ] **Canvas-Hilfsfunktionen** (`src/core/tools/vault/canvasLayout.ts`)
  - `gridLayout(nodes): positions` — einfaches Raster
  - `forceLayout(nodes, edges): positions` — vereinfachter Force-Directed Algorithmus

### 5.3 Obsidian Bases Tools
> Obsidian Bases (Core Plugin, ab Obsidian 1.8+) — strukturierte Datenbank-Ansichten auf Basis von Properties

- [ ] **`create_base` Tool** (`src/core/tools/vault/CreateBaseTool.ts`)
  - Parameter: `path` (Ausgabe-`.base`-Datei), `filters?`, `sort?`, `group_by?`, `columns?`, `view?: 'table'|'list'|'gallery'`
  - Schreibt valides `.base` JSON (Obsidian Bases Format):
    ```json
    { "viewType": "table",
      "filter": { "operator": "and", "conditions": [{"field", "operator", "value"}] },
      "sort": [{ "field": "modified", "direction": "desc" }],
      "columns": [{ "id", "field", "type", "width" }] }
    ```
  - `isWriteOperation: true`
- [ ] **`update_base` Tool** (`src/core/tools/vault/UpdateBaseTool.ts`)
  - Parameter: `path`, `filters?`, `sort?`, `group_by?`, `add_column?`, `remove_column?`
  - Liest bestehende `.base` Datei, merged Änderungen, schreibt zurück
  - Validiert gegen bekanntes Bases-Schema
  - `isWriteOperation: true`
- [ ] **`query_base` Tool** (`src/core/tools/vault/QueryBaseTool.ts`)
  - Parameter: `path` (`.base`-Datei), `limit?: number`
  - Zwei Strategien (je nach Verfügbarkeit):
    1. **API-Pfad**: `app.internalPlugins.getPluginById('bases')` → Query-Engine aufrufen
    2. **Fallback**: Filter-Logik selbst auswerten gegen `metadataCache` Properties
  - Gibt zurück: `[{ file, properties: Record<string, any> }]` — die Notizen die die Base-Filter erfüllen
  - Ermöglicht dem Agent, strukturierte Vault-Daten als Kontext zu nutzen

### 5.4 Vault-Intelligence Tools
- [ ] **`get_vault_stats` Tool**
  - `metadataCache.getTags()`, `vault.getFiles()`
  - Gibt: `{ fileCount, folderCount, topTags, recentFiles }`
- [ ] **`search_by_tag` Tool**
  - Parameter: `tags[]`, `match: 'all'|'any'`
  - Iteriert `metadataCache`, filtert nach Frontmatter-Tags
- [ ] **`get_frontmatter` Tool**
  - Parameter: `path`
  - Nutzt `metadataCache.getFileCache()`
- [ ] **`update_frontmatter` Tool**
  - Parameter: `path`, `updates: Record<string, any>`
  - Nutzt `app.fileManager.processFrontMatter()`
  - `isWriteOperation: true`
- [ ] **`get_linked_notes` Tool**
  - Parameter: `path`
  - `metadataCache.getBacklinksForFile()` + outlinks
- [ ] **`open_note` Tool**
  - Parameter: `path`
  - `workspace.openLinkText(path, '')`
- [ ] **`get_daily_note` Tool**
  - Parameter: `offset?: number` (0=heute, -1=gestern)
  - Periodic Notes Plugin falls vorhanden, sonst eigene Logik

---

## Sprint 6 — Power Features & Experimental

### 6.1 Power Steering
- [ ] **Mode-Reminder in `AgentTask.ts`**
  - Alle N Iterationen: kurze Mode-Definition in User-Message prefixen
- [ ] **Settings: "Power Steering" Toggle + Frequenz**

### 6.2 Experimental Toggles
- [ ] **Concurrent File Edits** — mehrere `write_file`/`edit_file` parallel
- [ ] **Model-initiated Slash Commands** — Agent kann selbst `/workflow` aufrufen
- [ ] **Custom Tools** — `.obsidian/plugins/obsidian-agent/tools/*.ts` laden
- [ ] **Settings: Experimental-Sektion**

### 6.3 Speech-to-Text (optional)
- [ ] **Mikrofon-Button** im Chat-Input
- [ ] **OpenAI Whisper** via `requestUrl()` + MediaRecorder API
- [ ] **Settings: STT Toggle** (Experimental)

---

## Sprint 7 — Infrastruktur

### 7.1 Context-Condensing
- [ ] **Token-Schätzer** in `AgentTask.ts`
  - `estimateTokens(messages): number` → Schätzung
  - Vergleich gegen aktives Model's `contextWindow`
- [ ] **Condense-Logik**
  - Separater LLM-Call: "Fasse Konversation zusammen"
  - Ersetzt älteste Messages, behält letzte 4
- [ ] **UI-Indikator** "Konversation komprimiert (Kontext: 45%)"

### 7.2 MCP-Integration
- [ ] **`McpClient`** (`src/core/mcp/McpClient.ts`)
  - HTTP-SSE oder stdio Verbindung
  - Tool-Registrierung in `ToolRegistry`
- [ ] **`use_mcp_tool` Tool**
- [ ] **Settings-Tab "MCP"**
  - Server-Liste mit Toggle/Refresh/Delete
  - MCP Marketplace (kuratierte Liste)
  - Global/Workspace MCP Config (JSON-Editor)

### 7.3 Task-Persistenz
- [ ] **History-Speicher** (`src/core/persistence/TaskHistory.ts`)
  - Speicherort: `.obsidian/plugins/obsidian-agent/history/`
  - Format: JSON pro Gespräch
- [ ] **History-UI** in `AgentSidebarView.ts`
  - Button "Letzte Gespräche" → Liste
  - "Fortsetzen" lädt History in neuen Task
- [ ] **Auto-Save** nach jeder Completion

### 7.4 Notifications
- [ ] **System-Notification** bei Task-Completion (Electron / Notice)
- [ ] **Settings: "Notifications aktivieren" Toggle**

### 7.5 Language / i18n
- [ ] **Sprach-Strings auslagern** (`src/i18n/de.ts`, `src/i18n/en.ts`)
- [ ] **Settings: Sprach-Dropdown** (Deutsch / English)

### 7.5b Semantic Index (lokal)
> Original-Scope: AI-02 — Vault-weite semantische Suche ohne Cloud-Dienste

- [ ] **Lokale Vektor-Datenbank** — `vectra` npm Package (reines TypeScript, kein WASM nötig)
  - `npm install vectra` — In-Memory + JSON-Persistenz auf Disk
  - Kein Chromium, kein native Module, läuft in Obsidian/Electron
- [ ] **`SemanticIndexService`** (`src/core/semantic/SemanticIndexService.ts`)
  - Index-Speicherort: `.obsidian/plugins/obsidian-agent/semantic-index/`
  - `buildIndex()` — alle Vault-Markdown-Dateien in Chunks (500 Token, 50 Token Overlap)
  - `updateFile(path)` — einzelne Datei neu indexieren (bei Vault-Änderung)
  - `search(query, topK): SemanticSearchResult[]` — Embedding-Query → nächste K Chunks
  - Embedding via konfiguriertem Embedding-Model (Anthropic/OpenAI/Ollama/LM Studio)
  - Hintergrund-Indizierung beim Plugin-Start (nicht blockierend)
- [ ] **`semantic_search` Tool** (`src/core/tools/vault/SemanticSearchTool.ts`)
  - Parameter: `query`, `top_k?: number` (default: 5)
  - Gibt `[{ path, excerpt, score }]` zurück
  - Ergebnis im Chat als kompakte Liste
- [ ] **Index-Status in `AgentSidebarView.ts`**
  - Badge: "Semantic Index: 1.240 Dokumente" / "Indiziere..." Spinner
- [ ] **Settings: Behaviour-Tab — Semantic Index Sektion**
  - "Semantic Index aktivieren" Toggle
  - "Embedding Model" Dropdown (aus konfigurierten Embedding-Models)
  - "Chunk-Größe (Token)" Number-Input (default: 500)
  - "Jetzt neu indizieren" Button + letzter Index-Zeitstempel
  - "Index löschen" Button

### 7.6 Export / Import / Reset
- [ ] **Export** — `plugin.settings` → JSON-Download
- [ ] **Import** — JSON einlesen + validieren
- [ ] **Reset** — `DEFAULT_SETTINGS` mit Bestätigungs-Dialog
- [ ] **About-Tab** mit diesen Aktionen + Plugin-Version + Links

---

## Notizen zur Implementierung

### Datei-Konventionen
- Neue Tools: `src/core/tools/{kategorie}/{ToolName}Tool.ts`
- Neue Kontext-Loader: `src/core/context/{Name}.ts`
- Neue Settings-Typen: immer in `src/types/settings.ts`
- Jedes neue Tool: in `ToolRegistry.registerInternalTools()` registrieren

### Kilo Code Referenzen
- edit_file: `forked-kilocode/src/core/tools/EditFileTool.ts`
- ask_followup: `forked-kilocode/src/core/tools/AskFollowupQuestionTool.ts`
- attempt_completion: `forked-kilocode/src/core/tools/AttemptCompletionTool.ts`
- new_task: `forked-kilocode/src/core/tools/NewTaskTool.ts`
- update_todo_list: `forked-kilocode/src/core/tools/UpdateTodoListTool.ts`
- switch_mode: `forked-kilocode/src/core/tools/SwitchModeTool.ts`
- skills: `forked-kilocode/src/services/skills/SkillsManager.ts`
- auto-approve: `forked-kilocode/packages/core-schemas/src/config/auto-approval.ts`
- modes: `forked-kilocode/packages/types/src/mode.ts`

### Nach jedem Abschnitt
```bash
npm run build  # TypeScript prüfen
npm run deploy # In Vault deployen
# → Obsidian neu laden + testen
```
