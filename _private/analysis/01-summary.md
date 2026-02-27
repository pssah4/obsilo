# Codebase Analysis — Obsidian Agent
**Datum:** 2026-02-26 (aktualisiert)
**Analysierte Dateien:** 158 TypeScript-Dateien, ~38.000 LOC (src/)
**Plugin-Version:** 1.1.0 (Obsilo Agent)
**Vergleich mit:** forked-kilocode/ (2.368 TS-Dateien)

---

## 1. Kilo Code Vergleich

### Identisch übernommene Patterns
| Bereich | Obsidian Agent | Kilo Code | Bewertung |
|---------|---------------|-----------|-----------|
| Agent Tool Struktur | `execute()` + Callbacks | `parseLegacy()` + `execute()` | Identisch |
| Todo-Parsing | Regex `^- \[([x~\s])\]` | Gleiches Pattern | Identisch |
| Mode-Validation | `getModeBySlug()` | Gleiches Pattern | Identisch |
| Attempt Completion | Signal via Context | Signal via Context | Identisch |
| Ask Followup | Callback-Pattern | Callback-Pattern | Identisch |

### Angepasst / Vereinfacht
| Feature | Obsidian Agent | Kilo Code | Delta |
|---------|---------------|-----------|-------|
| ReadFileTool | 91 LOC, basic read | 830 LOC, Token-Budget, Image, Line-Ranges | -90% Features |
| EditFileTool | 2-stufiges Matching (exact → normalized) | 3-stufig (exact → whitespace → token-based) | Weniger robust |
| NewTaskTool | nur `mode` + `message` | + `todos`-Parameter, requireTodos-Setting | Limitierter |
| UseMcpToolTool | Basic call + error | Validation, MCP-Hub, Status-Updates | Weniger sicher |

### Unique in Obsidian Agent (nicht in Kilo Code)
- SemanticIndexService (Vectra LocalIndex mit Batch-Embedding, Hybrid Search mit RRF)
- Obsidian-native Vault-Tools (Frontmatter, Daily Note, Backlinks, Search-by-Tag)
- Bases-Tools (QueryBase, CreateBase, UpdateBase)
- GenerateCanvas + CreateExcalidraw
- GitCheckpointService (isomorphic-git Shadow-Repo)
- OperationLogger mit PII-Scrubbing
- IgnoreService / .obsidian-agentignore + .obsidian-agentprotected
- SupportPrompts / Quick-Action Templates
- 3-Tier Memory Architecture (Session → Long-Term → Soul)
- VaultDNA Plugin Discovery (Auto-Skill-Generation fuer installierte Plugins)
- Agent Skill Mastery (Recipes, Episodic Memory, Auto-Promotion)
- i18n (6 Sprachen: DE, EN, ES, JA, ZH-CN, HI)
- Global Storage Architecture (cross-vault Settings via ~/.obsidian-agent/)
- SafeStorageService (Electron-Keychain-Verschluesselung fuer API-Keys)
- Onboarding-Wizard (5-Schritt Setup-Dialog)
- Code Import Modal (Auto-Extract von Provider/URL/Models aus Paste)

### Inzwischen implementiert (frueher fehlend)
- `ToolRepetitionDetector` — Sliding Window (10 Calls, max 3 Wiederholungen), fuzzy dedup, ledger
- `ExecuteCommandTool` — Obsidian-Commands via Plugin-API
- `ReadFileTool` Content Truncation — 20K chars max
- `CallPluginApiTool` — Plugin-API-Bridge mit Allowlist
- `ExecuteRecipeTool` — Procedural Recipes Shell
- `UpdateSettingsTool` + `ConfigureModelTool` — Settings via Agent

### Weiterhin fehlend im Vergleich zu Kilo Code
- `ApplyDiffTool` / `MultiApplyDiffTool` (Patch-basiertes Editing)
- Image-Support in ReadFileTool
- Line-Range-Support in ReadFileTool

### Bewertung
Das Plugin hat **158 TypeScript-Dateien (~38k LOC)** und deckt alle Kilo-Code-Kernfeatures ab, plus umfangreiche Obsidian-spezifische Erweiterungen (Semantic Index, Memory, VaultDNA, Mastery, i18n, Bases). Die Kern-Architektur (Agent Loop, Tool Registry, API Providers) ist konzeptuell identisch. Feature-Paritaet bei Kernfunktionalitaet: ~85%.

---

## 2. Funktionalität & Zusammenspiel

### Agent Loop (AgentTask.ts)
```
User Message
    ↓
[iteration 0..MAX_ITERATIONS]
    → Power Steering injection (every N iterations)
    → buildSystemPromptForMode() [gecacht per Mode]
    → API.createMessage() [streamed]
    → collect textParts + toolUses
    → history.push({ role: 'assistant', content })
    → parallelSafe? → Promise.all() : sequential for-loop
    → Tool execution via ToolExecutionPipeline
    → history.push({ role: 'user', content: toolResultBlocks })
    → Context Condensing? [if enabled, after tool results]
    ↓
attempt_completion / MAX_ITERATIONS → done
```

**Status:** Korrekt implementiert. Die jüngste Bugfix-Runde hat kritische Probleme (orphaned tool_calls, condensing timing, getModelContextWindow) behoben. Verbleibende Minor-Bugs dokumentiert in Abschnitt 4.

### Tool Registry & Execution
- `ToolRegistry` registriert 37 Built-in Tools + UseMcpToolTool
- `ToolExecutionPipeline` handhabt Approval, Snapshot, Execution, Logging
- Tool-Gruppen: `read`, `vault`, `edit`, `web`, `agent`, `skill`, `mcp` (7 Gruppen)
- Fail-Closed bei fehlender Approval-Callback — korrekt
- Pipeline Result Cache (per-task, write-invalidation)
- ToolRepetitionDetector (fuzzy dedup, ledger, recoverable errors)

**Status:** Gut strukturiert, Approval-Flow korrekt.

### Skills / Workflows / Rules
- `SkillsManager.discoverSkills()` → SKILL.md mit Frontmatter (vault korrekt zugewiesen)
- `WorkflowLoader.processSlashCommand()` → wraps in `<explicit_instructions>`
- `RulesLoader.loadEnabledRules()` → 50KB Limit pro Datei, joined to system prompt
- System Prompt enthält Guidance für alle drei Kontexttypen

**Status:** Korrekt implementiert nach letzter Bugfix-Runde.

### MCP Integration
- `McpClient` unterstützt stdio / SSE / streamable-http
- Tool-Discovery nach Verbindung, Tool-Calls weitergeleitet
- `UseMcpToolTool` delegiert an McpClient
- Mode-Level `allowedMcpServers` Filterung im System Prompt

**Status:** Funktional, aber Security-Lücken (Abschnitt 4).

### Sub-Agents (new_task)
- `NewTaskTool` spawnt Child-`AgentTask` mit separater History
- Callbacks werden propagiert (inkl. `onApprovalRequired`)
- Sub-Task bekommt alle nötigen Parameter (nach letzter Bugfix-Runde)

**Status:** Korrekt nach Fixes. Sub-Agents können ihre eigenen Tools nutzen.

### Semantic Index
- Vectra LocalIndex unter `.obsidian/plugins/obsidian-agent/semantic-index/`
- Batch-Embedding (16 Texts/Request) — effizient
- Resumable Indexing via `index-meta.json` (mtime-basiert)
- Heading-aware Chunking

**Status:** Feature-komplett, Minor-Bugs bei Chunk-Splitting und PDF-Import.

### API Providers
- **Anthropic:** `@anthropic-ai/sdk`, nativer Streaming-Support
- **OpenAI:** native `fetch()`, SSE-Parsing, unterstützt OpenAI/Ollama/Mistral/Azure/OpenRouter
- Message-Conversion bidirektional implementiert

**Status:** Funktional. Minor-Bugs bei JSON-Parse-Fehler im Tool-Input-Handling.

---

## 3. Architektur-Bewertung

### Stärken
1. **Klare Trennung:** `api/` | `core/` | `ui/` | `types/` ist gut strukturiert
2. **Extensible Tool-System:** `BaseTool` + `ToolRegistry` erlaubt einfaches Hinzufügen neuer Tools
3. **Mode-System:** Built-in + Custom Modes mit Settings-Persistierung
4. **Governance:** IgnoreService, OperationLogger, GitCheckpoints, Approval-Flow
5. **SemanticIndex:** Obsidian-spezifischer Mehrwert gegenüber Kilo Code
6. **Minimalismus:** ~40% von Kilo Code, aber fokussiert und wartbar

### Schwaechen
1. **Monolithische UI-Dateien:** `AgentSidebarView.ts` ist sehr gross (~146 KB)
2. **Keine Tool-Input-Validation:** Kein standardisiertes Schema-Validation (kein zod/joi)
3. **Inkonsistente Error-Message-Formate:** `<error>` Tags, raw strings, structured objects gemischt
4. **Token-Estimation ungenau:** 4 chars/token-Annahme ist zu grob
5. **Kein standardisierter ToolResult-Typ:** content ist immer `string`, kein structured data

### Erweiterbarkeit
- Neue Tools: einfach (BaseTool erweitern, in registerInternalTools eintragen)
- Neue API Provider: moderate Komplexität (ApiHandler interface + createMessage)
- Neue Modes: sehr einfach (BUILT_IN_MODES oder Settings)
- Neue Context-Sources: einfach (SkillsManager/WorkflowLoader Pattern)

---

## 4. Bug-Übersicht

### Kritische Bugs (potenzieller Data Loss / funktionsuntüchtig)

| ID | Datei | Zeile | Beschreibung |
|----|-------|-------|-------------|
| B-01 | `ToolExecutionPipeline.ts` | ~145 | Checkpoint-Snapshot `.catch()` nicht awaited → Race Condition bei paralleler Ausführung |
| B-02 | `api/providers/anthropic.ts` | ~132 | Tool JSON-Parse-Fehler silent → Tool bekommt leeres `{}` als Input |
| B-03 | `api/providers/openai.ts` | ~276 | Tool Arguments JSON-Parse-Fehler silent → Tool bekommt leeres `{}` als Input |
| B-04 | `core/tools/vault/EditFileTool.ts` | ~181 | `oldStr.trim()` in Replacement ohne entsprechende Normalisierung des Contents → falsche Replacements möglich |

### Hohe Bugs (beeinträchtigen Stabilität)

| ID | Datei | Zeile | Beschreibung |
|----|-------|-------|-------------|
| B-05 | `core/AgentTask.ts` | ~374,396 | Consecutive-Mistake-Counter nicht resettet bei Mode-Wechsel |
| B-06 | `ui/AgentSidebarView.ts` | ~901 | `document.addEventListener('mousedown', closeHandler)` wird nicht entfernt → Memory Leak |
| B-07 | `core/mcp/McpClient.ts` | ~70 | Shell-Metacharacter in stdio-Commands wird nur gewarnt, nicht geblockt |
| B-08 | `core/tools/vault/SearchFilesTool.ts` | ~102 | Regex mit globalem Flag in `.test()` Loop → `lastIndex` State nicht resettet |

### Mittlere Bugs

| ID | Datei | Zeile | Beschreibung |
|----|-------|-------|-------------|
| B-09 | `core/semantic/SemanticIndexService.ts` | ~682 | Hard-Split kann mitten im Wort splitten → schlechte Embedding-Qualität |
| B-10 | `core/AgentTask.ts` | ~292 | Token-Accumulation nach Fehler unvollständig |
| B-11 | `ui/AgentSidebarView.ts` | ~796 | Async Skills/Workflows-Loading Race Condition bei Popover-Close |
| B-12 | `core/tools/vault/EditFileTool.ts` | ~102 | Regex-Performance O(n) auf ganzer Datei bei normalization |
| B-13 | `core/mcp/McpClient.ts` | ~154 | Inconsistentes Content-Extraktion-Format |

### Niedrige Bugs

| ID | Datei | Zeile | Beschreibung |
|----|-------|-------|-------------|
| B-14 | `api/providers/openai.ts` | ~266 | Tool-Name-Akkumulation nutzt `+=` statt `=` |
| B-15 | `core/AgentTask.ts` | ~491 | Token-Estimation 4 chars/token zu grob |
| B-16 | `ui/AgentSettingsTab.ts` | ~703 | Error Message `String(null)` → "null" |

---

## 5. Performance-Bewertung

| Bereich | Status | Hauptproblem |
|---------|--------|-------------|
| Agent Loop | Akzeptabel | `estimateTokens()` O(N) bei jedem Schritt |
| Tool Execution | Gut | Parallel-Safe für Read-Tools |
| EditFileTool | Suboptimal | normalize() auf ganzer Datei O(N) |
| SemanticIndex | Gut | Batch-Embedding, Resume-Support |
| OperationLogger | Suboptimal | Full file read+write bei jedem Log-Eintrag |
| Tool Picker | Akzeptabel | Keine Debouncing beim Search-Filter |
| Skills Keyword-Match | Suboptimal | O(n*m) bei jedem Message-Render |

---

## 6. Sicherheits-Bewertung (SonarQube/NexusIQ Analog)

### Kritisch
- **Prompt Injection:** Vault-Inhalte koennen als Agent-Instructions interpretiert werden (Multi-Agent besonders anfaellig)

### Hoch
- **MCP Tool-Poisoning:** Externe MCP-Server koennen beliebige Tools registrieren — per-Mode Whitelist existiert, aber keine Schema-Validation
- **Shell-Injection:** stdio-MCP-Commands werden nur gewarnt, nicht geblockt
- **SSRF:** WebFetchTool hat IP-Range-Blacklist (169.254.x, 10.x, 192.168.x) — groesstenteils adressiert

### Mittel
- **JSON.parse ohne Schema-Validation:** GlobalModeStore, SemanticIndex, Settings
- **ReDoS in QueryBaseTool:** Filter-Parser ohne Laengen/Komplexitaetslimit
- **Unverschluesselte Chat-History:** Sensible Daten (API-Keys im Chat) im Klartext gespeichert

### Behoben (seit Erstanalyse)
- **API-Key-Speicherung:** SafeStorageService nutzt Electron safeStorage (OS Keychain) — ADR-019
- **ToolRepetitionDetector:** Sliding Window + fuzzy dedup verhindert endlose Tool-Loops

### Governance (positiv)
- IgnoreService + Protected-Paths: gut
- OperationLogger mit PII-Scrubbing: gut
- Approval-Flow mit Fail-Closed: gut
- GitCheckpoints fuer Rollback: gut
- 50KB Datei-Limit in RulesLoader: gut
- 500KB Limit in GlobalModeStore: gut
- Plugin-API Allowlist (CallPluginApiTool): gut
- ReadFile Content Truncation (20K chars): gut

---

## 7. Gesamtbewertung

| Kriterium | Bewertung | Begruendung |
|-----------|-----------|-----------|
| Kilo Code Klon | 9/10 | Kern-Architektur identisch, ~85% Feature-Paritaet, plus umfangreiche Obsidian-spezifische Erweiterungen |
| Funktion | 9/10 | 37 Tools, 7 Gruppen, Memory, Semantic Search, Multi-Agent, i18n, VaultDNA — alle Phasen (A-D) komplett |
| Effizienz | 6/10 | Mehrere O(N)-Operationen in Hot-Paths, BM25 ist Live-Scan |
| Robustheit | 7/10 | ToolRepetitionDetector implementiert, Pipeline Result Cache, Content Truncation. JSON-Parse silent fails teilweise noch vorhanden |
| Sicherheit | 7/10 | SafeStorage fuer API-Keys, Plugin-API Allowlist, MCP-Whitelist per Mode. Prompt Injection bleibt systeminhaerentes Risiko |
| Erweiterbarkeit | 9/10 | Klare Patterns, einfaches Tool-Hinzufuegen, MCP, Plugin-API, Recipes |

**Gesamtbewertung: 8/10** — Production-faehig mit umfassenden Safety Controls. Verbleibende Schwaechen bei Token-Estimation und monolithischer UI-Datei.
