# arc42 — Obsidian Agent Architecture

**Version:** 3.0 (pre-release)
**Stand:** 2026-02-24
**Status:** Aktuell — alle Features implementiert, Dokumentation vollstaendig

---

## 1. Einführung und Ziele

### 1.1 Aufgabenstellung
Obsidian Agent ist ein Obsidian-Plugin, das einen vollständigen KI-Agenten direkt in den Obsidian-Desktop integriert. Es implementiert die Kilo-Code-Architektur (VS-Code-Extension) für den Obsidian-Kontext: Vault-Operationen ersetzen IDE-Operationen, während die Kernmuster für Tool Governance, Approval, Checkpoints und MCP-Erweiterbarkeit übernommen werden.

### 1.2 Qualitätsziele

| Priorität | Qualitätsziel | Szenario |
|-----------|--------------|---------|
| 1 | **Datensicherheit** | Keine Vault-Datei wird ohne explizite Freigabe durch den Nutzer verändert. |
| 2 | **Erweiterbarkeit** | Neue Tools und MCP-Server können ohne Änderung am Core integriert werden. |
| 3 | **Privacy** | Kein Cloud-Service außer dem konfiguriertem LLM-Provider. Semantic Index läuft lokal. |
| 4 | **Transparenz** | Jede Tool-Ausführung ist im Audit-Log nachvollziehbar und undo-bar. |
| 5 | **Performance** | Plugin-Start < 1s, Semantic Indexing blockiert die UI nicht. |

### 1.3 Stakeholder

| Rolle | Erwartung |
|-------|-----------|
| Obsidian-Nutzer | Agentic AI direkt im Vault, keine Einrichtungshürden |
| Vault-Owner | Kontrolle über jede Änderung, Undo-Möglichkeit |
| Entwickler (Erweiterung) | Klare Extension Points (Tools, MCP, Modes) |

---

## 2. Randbedingungen

### 2.1 Technische Randbedingungen
- **Obsidian Plugin API** — Zugriff auf Vault, MetadataCache, Workspace via `app.*`
- **Electron-Renderer** — TypeScript/Node.js, kein Browser-Sandbox, kein Worker-Thread-Zugriff
- **No system git** — `isomorphic-git` für Checkpoints (Pure-JS, keine System-Abhängigkeit)
- **Obsidian Sync kompatibel** — Index-Daten im `.obsidian/`-Verzeichnis für Sync

### 2.2 Organisatorische Randbedingungen
- Apache 2.0 Lizenz
- Kilo Code als Referenzimplementierung (`forked-kilocode/`, gitignored, device-local)
- Private Dokumentation in `devprocess/` (gitignored, nie publiziert)

---

## 3. Kontextabgrenzung

### 3.1 Fachlicher Kontext

```
                    ┌──────────────────┐
     Nutzer ───────►│  Obsidian Agent  │◄──── Obsidian Vault (Markdown, Canvas, Bases)
                    │  (Plugin)        │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        LLM Provider     MCP Server    Obsidian API
        (Anthropic,      (externe      (vault, metadataCache,
         OpenAI,          Tools)        workspace, settings)
         Custom)
```

### 3.2 Technischer Kontext

| Nachbar | Kanal | Richtung |
|---------|-------|----------|
| LLM-Provider (Anthropic, OpenAI) | HTTPS / SSE | → (Anfrage), ← (Stream) |
| MCP-Server | stdio (subprocess) | ↔ (JSON-RPC) |
| Obsidian Vault | Obsidian Vault API | ↔ (read/write) |
| Obsidian MetadataCache | In-Memory | → (links, tags, frontmatter) |
| isomorphic-git Shadow-Repo | Filesystem | ↔ (checkpoint commits) |
| vectra LocalIndex | Filesystem | ↔ (vector read/write) |
| Xenova Transformers | In-Process (ONNX) | ← (embeddings) |

---

## 4. Lösungsstrategie

### Kernentscheidungen

1. **Central Tool Execution Pipeline** — Alle Tool-Aufrufe (intern + MCP) fließen durch eine zentrale Governance-Schicht. Keine Tool-Ausführung ohne Pipeline.

2. **Fail-Closed Approval** — Fehlt der Approval-Callback, wird eine Aktion abgelehnt. Kein Approval = kein Write.

3. **Shadow Git Repository** — Checkpoints via isomorphic-git im `.obsidian/plugins/obsidian-agent/checkpoints/`-Verzeichnis. Keine externen Abhängigkeiten, Undo ohne System-Git.

4. **Mode-Based Tool Filtering** — Jeder Mode definiert seine Tool-Gruppen. Der Agent sieht nur die für seinen Mode relevanten Tools. Keine globalem Tool-Whitelist nötig.

5. **Local-Only Semantic Index** — vectra (Pure-TypeScript HNSW) + Xenova Transformers (ONNX). Keine Cloud-Abhängigkeit. Index liegt im Obsidian-Sync-Ordner.

6. **Sliding Window Repetition Detection** — Erkennt Tool-Loops (gleiche Tool+Input-Kombination >= 3x in letzten 10 Calls) und bricht den Loop ab.

7. **Multi-Provider API (Adapter Pattern)** — Einheitliches `ApiHandler`-Interface fuer Anthropic (nativ) und alle OpenAI-kompatiblen Provider (OpenAI, Ollama, LM Studio, OpenRouter, Azure, Custom). Internes Message-Format ist Anthropic-nativ. [ADR-011](ADR-011-multi-provider-api.md)

8. **3-Tier Memory Architecture** — Chat History (kurzfristig) -> Session Summaries (mittelfristig, LLM-extrahiert) -> Long-Term Memory (langfristig, Fakten-Promotion). Asynchrone Verarbeitung via persistenter ExtractionQueue. [ADR-013](ADR-013-memory-architecture.md)

9. **VaultDNA Plugin Discovery** — Automatischer Runtime-Scan aller installierten Plugins. Generiert Skill-Files mit Commands und API-Methoden. Agent kann Plugins aktivieren und deren APIs nutzen. [ADR-014](ADR-014-vault-dna-plugin-discovery.md)

10. **Hybrid Search (Semantic + BM25 + RRF)** — Kombiniert Vektor-Aehnlichkeit mit TF-IDF/BM25-Keyword-Scoring (inkl. Stemming). Ergebnis-Fusion via Reciprocal Rank Fusion (k=60). Graph Augmentation via 1-Hop-Wikilinks. [ADR-015](ADR-015-hybrid-search-rrf.md)

---

## 5. Bausteinsicht

### 5.1 Ebene 1: Übersicht

```
┌──────────────────────────────────────────────────────────────┐
│                  ObsidianAgentPlugin (main.ts)                │
│  Plugin-Lifecycle · Services-Init · Commands · Views         │
└────────────┬───────────────┬───────────────┬─────────────────┘
             │               │               │
      ┌──────▼──────┐ ┌──────▼──────┐ ┌────▼─────────────┐
      │   UI Layer  │ │ Core Engine │ │  Service Layer   │
      │  (sidebar,  │ │ (AgentTask) │ │ (infra + tools)  │
      │   modals)   │ │             │ │ Memory, History   │
      └─────────────┘ └─────────────┘ └──────────────────┘
```

**UI Layer — Komponenten:**

| Komponente | Zuständigkeit |
|------------|--------------|
| `AgentSidebarView` | Chat-UI, Mode-Selector, Streaming, Approval-Cards, Todo-Box, Undo-Bar |
| `AutocompleteHandler` | `/`-Workflows, `@`-Dateien Autocomplete |
| `VaultFilePicker` | Live-Suche und Multi-Select für Datei-Anhänge |
| `ToolPickerPopover` | Session-Overrides für Tools / Skills / Workflows |
| `AttachmentHandler` | Datei-Anhänge als Kontext in der Chat-Eingabe |
| `ApproveEditModal` | Line-by-line Diff-View vor Edit-Approval |
| `HistoryPanel` | Sliding overlay mit gruppierten Gesprächen, Suche, Restore |
| `AgentSettingsTab` | Settings-Router (16 Tabs, inkl. Memory) |

### 5.2 Ebene 2: Core Engine

```
AgentTask.run()
  │
  ├── buildSystemPromptForMode()  ← systemPrompt.ts (orchestrator)
  │     ├── Modular sections (src/core/prompts/sections/)
  │     │     ├── dateTime, vaultContext, capabilities, objective
  │     │     ├── tools (← toolMetadata.ts single source of truth)
  │     │     ├── toolRules, toolDecisionGuidelines
  │     │     ├── responseFormat, explicitInstructions, securityBoundary
  │     │     └── modeDefinition, customInstructions, skills, rules
  │     ├── ModeService.getToolDefinitions()
  │     ├── RulesLoader (vault + global rules)
  │     ├── SkillsManager (per-mode skills)
  │     ├── WorkflowLoader (slash-commands)
  │     └── MemoryService.buildMemoryContext() (user profile, projects, patterns)
  │
  ├── API call (Anthropic/OpenAI stream)
  │
  ├── Process tool_use blocks
  │     ├── ToolRepetitionDetector.check()
  │     └── ToolExecutionPipeline.executeTool()
  │           ├── 1. IgnoreService.validate()
  │           ├── 2. checkApproval() [fail-closed]
  │           │     └── ApproveEditModal (Diff-View für edit_file)
  │           ├── 3. GitCheckpointService.snapshot()
  │           ├── 4. tool.execute()
  │           └── 5. OperationLogger.log()
  │
  └── Context Condensing (wenn threshold erreicht)
```

### 5.3 Ebene 2: Tool Registry (34 Tools)

```
ToolRegistry
  ├── read group:     read_file, list_files, search_files
  ├── vault group:    get_vault_stats, get_frontmatter, update_frontmatter,
  │                   search_by_tag, get_linked_notes, open_note,
  │                   get_daily_note, semantic_search, query_base
  ├── edit group:     write_file, edit_file, append_to_file, create_folder,
  │                   delete_file, move_file, generate_canvas,
  │                   create_base, update_base
  ├── web group:      web_fetch, web_search
  ├── agent group:    ask_followup_question, attempt_completion,
  │                   switch_mode, update_todo_list, new_task
  ├── skill group:    execute_command, enable_plugin, resolve_capability_gap
  ├── plugin-api:     call_plugin_api, execute_recipe
  ├── settings:       update_settings, configure_model
  └── mcp group:      use_mcp_tool
```

Tool-Beschreibungen kommen aus `toolMetadata.ts` (Single Source of Truth fuer Prompt und UI). Feature-Spec: `FEATURE-tool-metadata-registry.md`. ADR: [ADR-008](ADR-008-modular-prompt-sections.md).

### 5.4 Ebene 2: Semantic Search Pipeline

```
SemanticSearchTool.execute()
  │
  ├── [optional] HyDE: LLM generiert hypothetisches Dokument
  ├── Embedding: Xenova/all-MiniLM-L6-v2 (384 dim)
  ├── vectra.queryItems(vector, top_k × 3)  ← semantisch
  ├── BM25 keyword scan (live, alle vault files)
  ├── RRF Fusion (k=60): merge + rank
  ├── Metadata Filter (folder, tags, since)
  ├── Graph Augmentation (1-hop wikilinks)
  └── Excerpt truncation (500 chars)
```

### 5.5 Ebene 2: Memory Architecture (3-Tier)

```
Tier 1: Chat History (ConversationStore)
  └── Volle Konversationen als JSON im Plugin-Verzeichnis
      Kurzfristig, pro Session

Tier 2: Session Summaries (SessionExtractor)
  └── LLM-generierte Zusammenfassung nach Gespraechsende
      Mittelfristig, eine pro Konversation
      Semantisch durchsuchbar (MemoryRetriever)

Tier 3: Long-Term Memory (LongTermExtractor)
  └── Fakten aus Sessions in persistente Dateien promoviert
      user-profile.md, projects.md, patterns.md, soul.md
      Langfristig, kumulativ

Asynchrone Verarbeitung:
  ExtractionQueue (persistent FIFO, ueberlebt Neustarts)
    ├── SessionExtractor -> LLM call -> sessions/{id}.md
    └── LongTermExtractor -> LLM call -> update memory files
```

ADR: [ADR-013](ADR-013-memory-architecture.md). Feature-Spec: `FEATURE-memory-personalization.md`.

### 5.6 Ebene 2: VaultDNA / Plugin Skills

```
VaultDNAScanner (onLayoutReady + 5s Polling)
  │
  ├── Core Plugins (Obsidian Built-ins)
  │     └── Commands sofort verfuegbar
  │
  └── Community Plugins
        ├── API Reflection → Method Discovery
        ├── Command Discovery → Command IDs
        └── Skill-File Generation → .obsidian-agent/plugin-skills/{id}.skill.md

Agent-Nutzung:
  ├── execute_command(command_id)
  ├── enable_plugin(plugin_id, enable)
  ├── resolve_capability_gap(capability, context)
  └── call_plugin_api(plugin_id, method, args)
```

ADR: [ADR-014](ADR-014-vault-dna-plugin-discovery.md). Feature-Spec: `FEATURE-local-skills.md`.

---

## 6. Laufzeitsicht

### 6.1 Normaler Agent-Zyklus

```
Nutzer: "Schreibe eine Zusammenfassung von Kapitel 3"
  │
  ▼
AgentTask.run()
  ├── Iteration 1: LLM antwortet mit tool_use: read_file("kapitel3.md")
  │     ├── ToolRepetitionDetector: ok
  │     ├── Pipeline: validate → kein Approval nötig (read) → execute
  │     └── Result: file content
  │
  ├── Iteration 2: LLM antwortet mit tool_use: write_file("zusammenfassung.md", ...)
  │     ├── ToolRepetitionDetector: ok
  │     ├── Pipeline: validate → Approval-Card im UI
  │     │     User klickt "Approve"
  │     ├── Pipeline: snapshot (checkpoint) → execute → log
  │     └── Result: "File written. <diff_stats added=15 removed=0/>"
  │
  └── Iteration 3: LLM antwortet mit attempt_completion
        └── AgentTask: signalCompletion('completed')
```

### 6.2 Multi-Agent (new_task)

```
Parent AgentTask
  ├── tool_use: new_task("Analysiere alle Dateien in /research/")
  │     └── Spawnt Child AgentTask
  │           ├── Eigene Konversations-History
  │           ├── Eigener ToolRepetitionDetector
  │           ├── Forwards approval callback von Parent
  │           └── Eigener GitCheckpoint-Scope
  └── Erhält Ergebnis des Child als Tool-Result zurück
```

### 6.3 Approval Flow

```
Pipeline.checkApproval(toolCall)
  ├── autoApproval.read = true → approve (read tools)
  ├── autoApproval.vaultChanges = true → approve (write tools)
  ├── onApprovalRequired callback vorhanden?
  │     └── Nein → reject (fail-closed)
  │     └── Ja → zeige Approval-Card in UI
  │           ├── User: "Approve" → proceed
  │           ├── User: "Always Allow" → setze auto-approve, proceed
  │           └── User: "Deny" → return error result
  └── Tool-Result enthält Fehlermeldung bei Ablehnung
```

### 6.4 Memory Extraction Flow

```
Conversation End (>= extractionThreshold messages)
  │
  ├── Build minimal transcript (~8000 chars)
  ├── Enqueue PendingExtraction { type: 'session' }
  │
  └── ExtractionQueue (background, one-at-a-time)
        ├── SessionExtractor
        │     ├── LLM call (memoryModelKey)
        │     ├── Output: sessions/{id}.md (YAML frontmatter + summary)
        │     └── if autoUpdateLongTerm → enqueue { type: 'long-term' }
        │
        └── LongTermExtractor
              ├── LLM call (merges facts into existing files)
              └── Updates: user-profile.md, projects.md, patterns.md
```

### 6.5 Context Condensing Flow

```
AgentTask Iteration N (nach Tool-Result)
  │
  ├── estimateTokenCount(history) > contextWindow * condensingThreshold?
  │     └── Nein → weiter mit naechster Iteration
  │
  └── Ja → maybeCondenseContext()
        ├── Behalte: erste User-Nachricht (Original-Aufgabe)
        ├── Behalte: letzte 4 Nachrichten (aktueller Kontext)
        ├── Komprimiere: mittlerer Teil via LLM-Call
        └── Ersetze History: [erste, Zusammenfassung, letzte 4]
```

ADR: [ADR-012](ADR-012-context-condensing.md).

### 6.6 Semantic Search Pipeline

```
semantic_search(query, top_k, folder?, tags?, since?)
  │
  ├── [optional] HyDE: LLM generiert hypothetisches Dokument
  │
  ├── Parallel:
  │     ├── Semantic: Vectra HNSW (top_k * 3 Ergebnisse)
  │     └── Keyword: BM25/TF-IDF mit Stemming (alle Vault-Dateien)
  │
  ├── RRF Fusion (k=60): score(doc) = SUM(1/(60+rank_i))
  ├── Metadata Filter (folder, tags, since)
  ├── Graph Augmentation (1-hop Wikilinks, max 5)
  └── Excerpt Truncation (500 chars)
```

ADR: [ADR-015](ADR-015-hybrid-search-rrf.md).

---

## 7. Verteilungssicht

Obsidian Agent läuft vollständig lokal im Obsidian Electron-Renderer-Prozess. Es gibt keine Server-Komponente. Externe Verbindungen nur zu:
- Konfigurierten LLM-Providern (HTTPS)
- Konfigurierten MCP-Servern (stdio subprocess, lokal)
- Optional: Web-Search-APIs (Brave/Tavily)

```
Nutzer-Gerät:
  Obsidian (Electron)
  └── Plugin-Prozess (Renderer)
        ├── vectra Index       → .obsidian/plugins/obsidian-agent/semantic-index/
        ├── isomorphic-git     → .obsidian/plugins/obsidian-agent/checkpoints/
        ├── ONNX Runtime       → In-Memory (Xenova Transformers)
        ├── Audit Logs         → .obsidian/plugins/obsidian-agent/logs/
        ├── Chat History       → .obsidian/plugins/obsidian-agent/history/
        ├── Memory Files       → .obsidian/plugins/obsidian-agent/memory/
        ├── Extraction Queue   → .obsidian/plugins/obsidian-agent/pending-extractions.json
        └── MCP subprocesses   → stdio (lokal)
```

---

## 8. Querschnittliche Konzepte

### 8.1 Sicherheits- und Governance-Modell

**Defense in Depth** — vier Schutzschichten:

| Schicht | Mechanismus | Datei |
|---------|-------------|-------|
| 1. Pfad-Validierung | IgnoreService (.obsidian-agentignore, protected) | `src/core/governance/IgnoreService.ts` |
| 2. Approval | Explicit user consent für Write-Ops | `src/core/tool-execution/ToolExecutionPipeline.ts` |
| 3. Checkpoint | Snapshot vor jedem Write (isomorphic-git) | `src/core/checkpoints/GitCheckpointService.ts` |
| 4. Audit | JSONL-Log jeder Operation | `src/core/governance/OperationLogger.ts` |

### 8.2 Fehlerbehandlung

- **Tool-Fehler** → werden als Tool-Result zurückgegeben (nicht als Exception). LLM sieht den Fehler und kann reagieren.
- **Consecutive Mistakes** → nach `consecutiveMistakeLimit` Fehlern bricht AgentTask ab.
- **Tool Repetition** → nach 3× gleiches Tool+Input in 10 Calls → abort mit Fehlermeldung.
- **Pipeline ohne Approval-Callback** → fail-closed, ablehnen.

### 8.3 Context Management

- **System Prompt** wird pro Task einmalig aufgebaut (nicht pro Iteration). Modulare Architektur: 15 Sections als Pure Functions in `src/core/prompts/sections/`, orchestriert von `buildSystemPromptForMode()`. Tool-Beschreibungen kommen aus der zentralen `toolMetadata.ts` (Single Source of Truth fuer Prompt und UI). Feature-Specs: `FEATURE-modular-system-prompt.md`, `FEATURE-tool-metadata-registry.md`. ADR: [ADR-008](ADR-008-modular-prompt-sections.md).
- **Context Condensing** — wenn Kontext-Schätzung den `condensingThreshold` überschreitet: erste + letzte 4 Nachrichten behalten, Rest via LLM-Komprimierung.
- **Power Steering** — alle `powerSteeringFrequency` Iterationen wird der Mode-Reminder erneut injiziert.

### 8.4 Chat History & Memory System

Persistentes Memory-System mit drei Säulen: Chat History, Short/Long-Term Memory, Onboarding. Alle Daten liegen im Plugin-Verzeichnis (`.obsidian/plugins/obsidian-agent/`). Feature-Spec: `FEATURE-memory-personalization.md`. ADR: [ADR-007](ADR-007-event-separation.md).

#### Storage Layout

```
.obsidian/plugins/obsidian-agent/
├── history/                     # Chat History
│   ├── index.json               # ConversationMeta[] (id, title, created, updated, messageCount, tokens)
│   └── {id}.json                # ConversationData (meta + messages + uiMessages)
├── memory/                      # Long-Term Memory
│   ├── user-profile.md          # Identity, communication, agent behavior
│   ├── projects.md              # Active projects, goals
│   ├── patterns.md              # Behavioral patterns, refinements
│   ├── knowledge.md             # Domain knowledge (on-demand)
│   └── sessions/                # Session summaries (one per conversation)
│       └── {id}.md              # YAML frontmatter + summary
├── pending-extractions.json     # Persistent extraction queue
└── semantic-index/              # (existing) Vectra index (+ session source filter)
```

#### ConversationStore (`src/core/history/ConversationStore.ts`)

```
ConversationStore
  ├── initialize()       → ensure dir, load/create index
  ├── create(mode,model) → new conversation
  ├── save(id,msgs,ui)   → write full conversation
  ├── updateMeta(id,patch) → title, tokens
  ├── load(id)           → full ConversationData
  ├── list()             → in-memory index (no disk I/O)
  └── delete(id) / deleteAll()
```

#### Memory Extraction Pipeline

```
Conversation End (>= extractionThreshold messages)
  │
  ├── 1. Build minimal transcript (~8000 chars)
  ├── 2. Enqueue PendingExtraction { type: 'session' }
  │
  └── ExtractionQueue (background, one-at-a-time)
        ├── SessionExtractor → LLM call (memoryModelKey) → sessions/{id}.md
        │     └── if autoUpdateLongTerm → enqueue { type: 'long-term' }
        └── LongTermExtractor → LLM call → update user-profile/projects/patterns
```

#### Memory Context Injection (System Prompt)

At session start, `MemoryService.buildMemoryContext()` injects:
1. **User Profile** (~200 tokens) — always
2. **Project Memory** (~300 tokens) — always
3. **Pattern Memory** (~200 tokens) — always
4. **Relevant Session Summaries** (~500 tokens) — via `MemoryRetriever` semantic search on first user message

Total budget: ~1200 tokens. Knowledge memory is retrieved on demand via `semantic_search`.

#### Event Separation (ADR-007)

`attempt_completion` result is an internal signal, not user-facing text. `AgentTask` tracks `hasStreamedText` — completion result only rendered as fallback when no text was streamed. System prompt rules ensure attempt_completion is only called after multi-step tool workflows.

#### Key Files

| File | Purpose |
|------|---------|
| `src/core/history/ConversationStore.ts` | Conversation persistence |
| `src/ui/sidebar/HistoryPanel.ts` | History UI overlay |
| `src/core/memory/MemoryService.ts` | Memory file I/O + context builder |
| `src/core/memory/ExtractionQueue.ts` | Persistent FIFO queue |
| `src/core/memory/SessionExtractor.ts` | LLM-based session summary |
| `src/core/memory/LongTermExtractor.ts` | Promote facts to long-term |
| `src/core/memory/OnboardingService.ts` | First-contact detection |
| `src/core/memory/MemoryRetriever.ts` | Cross-session context retrieval |
| `src/ui/settings/MemoryTab.ts` | Memory settings UI |

### 8.5 Session-Overrides (ToolPickerPopover)

Der `ToolPickerPopover` erlaubt es dem Nutzer, für die aktuelle Session (RAM only, kein Persist) gezielt Tool-Gruppen, Skills und Workflows zu erzwingen — unabhängig von den Mode-Einstellungen. Die drei Override-Maps (`sessionToolOverrides`, `sessionForcedSkills`, `sessionForcedWorkflow`) werden beim nächsten `handleSendMessage()` ausgelesen.

### 8.6 Tool-Parallelisierung

Tools in `PARALLEL_SAFE` werden via `Promise.all()` parallel ausgeführt. Safe: alle Read-Tools (`read_file`, `list_files`, `search_files`, `get_frontmatter`, `get_linked_notes`, `search_by_tag`, `web_fetch`, `web_search`). Write-Tools immer sequenziell.

### 8.7 Einheitliche Fehler-/Ergebnisformatierung

Alle Tools erben von `BaseTool` und nutzen:
- `this.formatSuccess(message)` → `"✓ message"`
- `this.formatError(error)` → `"<error>message</error>"`
- `this.formatContent(content, meta)` → Content mit optionalem Metadaten-Header

### 8.8 Diff-Stats

Write-Tools (`write_file`, `edit_file`) emittieren `<diff_stats added="N" removed="N"/>` im Tool-Result. Die UI parst diesen Tag und rendert das Badge.

### 8.9 Multi-Agent Orchestration

Der Agent kann via `new_task` Tool Sub-Agenten (Child Tasks) spawnen:

- **Depth Guard**: `maxSubtaskDepth` begrenzt die Verschachtelungstiefe (Default: 2)
- **Isolation**: Kind-Task hat eigene History, eigenen ToolRepetitionDetector
- **Shared**: Kind erbt den Approval-Callback des Parents (damit Write-Ops nicht auto-rejected werden)
- **Modes**: Kind kann nur in `agent` oder `ask` Mode laufen
- **Patterns**: Prompt Chaining, Orchestrator-Worker, Evaluator-Optimizer, Routing

### 8.10 Plugin Skills & VaultDNA

VaultDNA ermoeglicht dem Agent die Nutzung aller installierten Obsidian-Plugins:

- **Discovery**: Runtime-Scan via Obsidian API (Core + Community Plugins)
- **Skill-Files**: Automatisch generierte Beschreibungen in `.obsidian-agent/plugin-skills/`
- **Commands**: Agent kann Obsidian-Befehle via `execute_command` ausfuehren
- **Plugin API**: Agent kann Plugin-Methoden via `call_plugin_api` aufrufen (Allowlist-geschuetzt)
- **Recipes**: Vordefinierte Workflows (z.B. Pandoc-Export) via `execute_recipe`
- **Continuous Sync**: 5s-Polling erkennt Plugin-Aenderungen

### 8.11 Onboarding

`OnboardingService` erkennt den ersten Kontakt (kein Memory vorhanden) und fuehrt den Nutzer durch einen 5-Schritt-Dialog:
1. Backup-Import
2. Profil (Name, Sprache, Tonfall)
3. Modell (API-Key oder Gemini Free Tier)
4. Permissions (Preset: Permissive / Balanced / Restrictive)
5. Abschluss

---

## 9. Architekturentscheidungen

Siehe einzelne ADRs in `devprocess/architecture/`:

| ADR | Entscheidung |
|-----|-------------|
| [ADR-001](ADR-001-central-tool-execution-pipeline.md) | Zentrale ToolExecutionPipeline für alle Tool-Aufrufe |
| [ADR-002](ADR-002-isomorphic-git-checkpoints.md) | isomorphic-git statt System-Git für Checkpoints |
| [ADR-003](ADR-003-vectra-semantic-index.md) | vectra + Xenova für lokalen Semantic Index |
| [ADR-004](ADR-004-mode-based-tool-filtering.md) | Mode-basierte Tool-Filterung statt globaler Whitelist |
| [ADR-005](ADR-005-fail-closed-approval.md) | Fail-Closed Approval (kein Callback = ablehnen) |
| [ADR-006](ADR-006-sliding-window-repetition.md) | Sliding Window für Tool-Repetition-Erkennung |
| [ADR-007](ADR-007-event-separation.md) | Event Separation — Completion-Signale getrennt von Text-Output |
| [ADR-008](ADR-008-modular-prompt-sections.md) | Modulare Prompt-Sections & zentrale Tool-Metadata-Registry |
| [ADR-009](ADR-009-local-skills.md) | Lokale Plugin-Skills (VaultDNA PAS-1) |
| [ADR-010](ADR-010-permissions-audit.md) | Permissions Audit & Governance-Analyse |
| [ADR-011](ADR-011-multi-provider-api.md) | Multi-Provider API Architecture (Adapter Pattern) |
| [ADR-012](ADR-012-context-condensing.md) | Context Condensing (Keep-First-Last + LLM-Summarize) |
| [ADR-013](ADR-013-memory-architecture.md) | 3-Tier Memory Architecture |
| [ADR-014](ADR-014-vault-dna-plugin-discovery.md) | VaultDNA — Automatische Plugin-Erkennung als Skills |
| [ADR-015](ADR-015-hybrid-search-rrf.md) | Hybrid Search mit Semantic + BM25 + RRF Fusion |

---

## 10. Qualitätsszenarien

| Szenario | Response |
|----------|---------|
| Agent versucht `.env`-Datei zu lesen | IgnoreService blockiert, Tool-Result: `<error>Path not allowed</error>` |
| Nutzer lehnt Write-Op ab | Tool-Result: `<error>User rejected</error>`, LLM kann alternative vorschlagen |
| Agent ruft `edit_file` 3× mit identischem Input | ToolRepetitionDetector: abort mit Fehlermeldung, signalCompletion |
| Vault hat 5000 Dateien, Semantic Index läuft | `setTimeout(0)` nach jeder Batch, UI bleibt responsiv |
| Obsidian wird während Indexing geschlossen | Checkpoint (mtime-basiert) ermöglicht Resume beim nächsten Start |
| MCP-Server nicht erreichbar | McpClient: Timeout, Fehler-Result, kein Plugin-Crash |
| Kontext wird zu lang | Context Condensing: first + last 4 Messages behalten, Rest komprimiert |

---

## 11. Risiken und technische Schulden

| Risiko | Auswirkung | Mitigation |
|--------|-----------|-----------|
| vectra lädt gesamten Index in RAM | Hohe RAM-Nutzung bei >10k Notizen | Chunked loading (future) |
| `search_files` nutzt Node.js `fs` direkt | Nicht kompatibel mit Obsidian Mobile | Obsidian-API-Fallback (future) |
| `query_base` nutzt Regex-YAML-Parser | Komplexe Filterausdrücke können falsch geparst werden | Echter YAML-Parser (future) |
| `update_base` erkennt View-Blöcke via Regex | Fragil bei unerwarteter YAML-Formatierung | Vollständiger YAML-Parser (future) |
| Keyword-Suche (BM25) ist ein Live-Scan | Linear mit Vault-Groesse | Vorkompilierter BM25-Index (future) |
| HyDE verursacht extra LLM-Call | +2-5s Latenz pro Suche | Default: disabled, opt-in |
| Memory-Extraktion basiert auf LLM-Qualitaet | Ungenaue Fakten bei schwachen Modellen | Separate memoryModelKey-Einstellung |
| VaultDNA Reflection kann bei Plugins fehlschlagen | Unvollstaendige Skill-Files | Nutzer kann Skill-Files manuell anpassen |
| MCP stdio spawnt Subprozesse | Sicherheitsrisiko bei boeswilligen Configs | Shell-Metacharacter-Validation |

---

## 12. Glossar

| Begriff | Bedeutung |
|---------|-----------|
| **AgentTask** | Eine einzelne Agenten-Session (eine Konversation mit dem LLM) |
| **ToolExecutionPipeline** | Zentrale Governance-Schicht für alle Tool-Ausführungen |
| **Mode** | Agent-Persona mit definiertem Tool-Set, System-Prompt und Modell |
| **Checkpoint** | isomorphic-git-Commit im Shadow-Repo, erstellt vor jedem Write |
| **PARALLEL_SAFE** | Set von Tool-Namen, die parallel via Promise.all ausgeführt werden können |
| **Power Steering** | Periodische Injektion des Mode-Reminders in den Kontext |
| **Context Condensing** | LLM-basierte Komprimierung der Konversationshistorie bei zu vollem Kontext |
| **HyDE** | Hypothetical Document Embeddings — LLM generiert ein hypothetisches Dokument als Embedding-Input |
| **RRF** | Reciprocal Rank Fusion — Zusammenführung von Semantic- und Keyword-Rankings |
| **Shadow-Repo** | Separates isomorphic-git-Repository in `.obsidian/plugins/obsidian-agent/checkpoints/` |
| **Fail-Closed** | Sicherheits-Default: Fehlt die Approval-Callback-Funktion, wird die Aktion abgelehnt |
| **ApproveEditModal** | Modal mit line-by-line Diff-View, das vor `edit_file`-Operationen angezeigt wird |
| **ConversationStore** | Persistiert Konversationen (index.json + per-conversation JSON) im Plugin-Verzeichnis |
| **MemoryService** | Liest/schreibt Memory-Dateien (user-profile, projects, patterns, knowledge) und baut den Memory-Kontext für den System Prompt |
| **ExtractionQueue** | Persistente FIFO-Queue für asynchrone Memory-Extraktion. Überlebt Obsidian-Neustarts |
| **SessionExtractor** | LLM-basierte Session-Zusammenfassung (verwendet memoryModelKey) |
| **LongTermExtractor** | Promoviert Fakten aus Session-Summaries in die Long-Term-Memory-Dateien |
| **MemoryRetriever** | Semantische Suche über Session-Summaries für Cross-Session-Kontext |
| **Event Separation** | Architekturmuster: Completion-Signale (attempt_completion) getrennt von Text-Output. hasStreamedText-Flag steuert Fallback-Rendering (ADR-007) |
| **ToolPickerPopover** | UI-Element für session-lokale Overrides von Tools, Skills und Workflows |
| **Session-Override** | RAM-only Ueberschreibung von Mode-Einstellungen fuer die aktuelle Chat-Session |
| **VaultDNA** | Automatischer Runtime-Scan aller installierten Plugins. Generiert Skill-Files mit Commands und API-Methoden |
| **BM25** | Best Matching 25 — probabilistisches Keyword-Ranking-Verfahren basierend auf TF-IDF |
| **TF-IDF** | Term Frequency - Inverse Document Frequency — Gewichtung der Relevanz eines Terms in einem Dokument relativ zum Gesamtkorpus |
| **Stemming** | Reduktion von Woertern auf ihren Wortstamm (z.B. "analysiert" -> "analys") fuer besseren Recall |
| **Multi-Agent** | Delegation von Teilaufgaben an Kind-Tasks via `new_task`. Eigene History, forwarded Approval |
| **Plugin Skills** | Automatisch aus installierten Plugins generierte Skill-Beschreibungen in `.obsidian-agent/plugin-skills/` |
| **Soul** | Persistente Agent-Persoenlichkeit (Name, Sprache, Werte, Anti-Patterns) in `memory/soul.md` |
| **OnboardingService** | Erkennt ersten Kontakt und fuehrt den Nutzer durch einen 5-Schritt-Setup-Dialog |
| **ExplicitInstructions** | Best-Practice-Anweisungen im System Prompt (z.B. "Vault is sacred", parallele Reads) |
