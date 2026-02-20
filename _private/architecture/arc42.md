# arc42 — Obsidian Agent Architecture

**Version:** 2.0 (post-implementation)
**Stand:** 2026-02-20
**Status:** Aktuell — alle Features implementiert

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
- Private Dokumentation in `_private/` (gitignored, nie publiziert)

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

6. **Sliding Window Repetition Detection** — Erkennt Tool-Loops (gleiche Tool+Input-Kombination ≥ 3× in letzten 10 Calls) und bricht den Loop ab.

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
      │  (sidebar)  │ │ (AgentTask) │ │ (infra + tools)  │
      └─────────────┘ └─────────────┘ └──────────────────┘
```

### 5.2 Ebene 2: Core Engine

```
AgentTask.run()
  │
  ├── buildSystemPrompt()  ← systemPrompt.ts
  │     ├── ModeService.getToolDefinitions()
  │     ├── RulesLoader (vault + global rules)
  │     ├── SkillsManager (per-mode skills)
  │     └── WorkflowLoader (slash-commands)
  │
  ├── API call (Anthropic/OpenAI stream)
  │
  ├── Process tool_use blocks
  │     ├── ToolRepetitionDetector.check()
  │     └── ToolExecutionPipeline.executeTool()
  │           ├── 1. IgnoreService.validate()
  │           ├── 2. checkApproval() [fail-closed]
  │           ├── 3. GitCheckpointService.snapshot()
  │           ├── 4. tool.execute()
  │           └── 5. OperationLogger.log()
  │
  └── Context Condensing (wenn threshold erreicht)
```

### 5.3 Ebene 2: Tool Registry

```
ToolRegistry
  ├── read group:    read_file, list_files, search_files
  ├── vault group:   get_vault_stats, get_frontmatter, update_frontmatter,
  │                  search_by_tag, get_linked_notes, open_note,
  │                  get_daily_note, semantic_search, query_base
  ├── edit group:    write_file, edit_file, append_to_file, create_folder,
  │                  delete_file, move_file, generate_canvas,
  │                  create_base, update_base
  ├── web group:     web_fetch, web_search
  ├── agent group:   ask_followup_question, attempt_completion,
  │                  switch_mode, update_todo_list, new_task
  └── mcp group:     use_mcp_tool
```

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

- **System Prompt** wird pro Task einmalig aufgebaut (nicht pro Iteration).
- **Context Condensing** — wenn Kontext-Schätzung den `condensingThreshold` überschreitet: erste + letzte 4 Nachrichten behalten, Rest via LLM-Komprimierung.
- **Power Steering** — alle `powerSteeringFrequency` Iterationen wird der Mode-Reminder erneut injiziert.

### 8.4 Tool-Parallelisierung

Tools in `PARALLEL_SAFE` werden via `Promise.all()` parallel ausgeführt. Safe: alle Read-Tools (`read_file`, `list_files`, `search_files`, `get_frontmatter`, `get_linked_notes`, `search_by_tag`, `web_fetch`, `web_search`). Write-Tools immer sequenziell.

### 8.5 Einheitliche Fehler-/Ergebnisformatierung

Alle Tools erben von `BaseTool` und nutzen:
- `this.formatSuccess(message)` → `"✓ message"`
- `this.formatError(error)` → `"<error>message</error>"`
- `this.formatContent(content, meta)` → Content mit optionalem Metadaten-Header

### 8.6 Diff-Stats

Write-Tools (`write_file`, `edit_file`) emittieren `<diff_stats added="N" removed="N"/>` im Tool-Result. Die UI parst diesen Tag und rendert das Badge.

---

## 9. Architekturentscheidungen

Siehe einzelne ADRs in `_private/docs/architecture/`:

| ADR | Entscheidung |
|-----|-------------|
| [ADR-001](ADR-001-central-tool-execution-pipeline.md) | Zentrale ToolExecutionPipeline für alle Tool-Aufrufe |
| [ADR-002](ADR-002-isomorphic-git-checkpoints.md) | isomorphic-git statt System-Git für Checkpoints |
| [ADR-003](ADR-003-vectra-semantic-index.md) | vectra + Xenova für lokalen Semantic Index |
| [ADR-004](ADR-004-mode-based-tool-filtering.md) | Mode-basierte Tool-Filterung statt globaler Whitelist |
| [ADR-005](ADR-005-fail-closed-approval.md) | Fail-Closed Approval (kein Callback = ablehnen) |
| [ADR-006](ADR-006-sliding-window-repetition.md) | Sliding Window für Tool-Repetition-Erkennung |

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
| Keyword-Suche in SemanticSearch ist ein Live-Scan | Langsam bei großen Vaults | BM25-Index aufbauen (future) |
| HyDE verursacht extra LLM-Call | +2-5s Latenz pro Suche | Default: disabled, opt-in |

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
