# Obsilo Agent — Deep Dive

> **Lesezeit:** ~30 Minuten
> **Zielgruppe:** Du selbst (Sebastian) und jeder, der verstehen will, wie das Plugin aufgebaut ist und funktioniert.
> **Stand:** März 2026, Version 1.0.0

---

## Inhaltsverzeichnis

1. [Was ist Obsilo?](#1-was-ist-obsilo)
2. [Die Architektur im Überblick](#2-die-architektur-im-überblick)
3. [Einstiegspunkt: Das Plugin startet](#3-einstiegspunkt-das-plugin-startet)
4. [Der Agent-Loop: Wie Obsilo „denkt"](#4-der-agent-loop-wie-obsilo-denkt)
5. [Tools: Die Hände des Agenten](#5-tools-die-hände-des-agenten)
6. [Die Tool Execution Pipeline: Governance & Sicherheit](#6-die-tool-execution-pipeline-governance--sicherheit)
7. [Modi: Ask vs. Agent](#7-modi-ask-vs-agent)
8. [LLM-Provider: Die Anbindung an KI-Modelle](#8-llm-provider-die-anbindung-an-ki-modelle)
9. [System Prompt: Was der Agent „weiß"](#9-system-prompt-was-der-agent-weiß)
10. [Memory: Langzeitgedächtnis](#10-memory-langzeitgedächtnis)
11. [Semantic Search: Bedeutungsbasierte Suche](#11-semantic-search-bedeutungsbasierte-suche)
12. [Checkpoints: Undo-System mit Git](#12-checkpoints-undo-system-mit-git)
13. [MCP: Externe Tool-Erweiterung](#13-mcp-externe-tool-erweiterung)
14. [VaultDNA & Plugin Skills](#14-vaultdna--plugin-skills)
15. [Mastery: Rezepte & Episodisches Lernen](#15-mastery-rezepte--episodisches-lernen)
16. [Self-Development: Der Agent verbessert sich selbst](#16-self-development-der-agent-verbessert-sich-selbst)
17. [Sicherheitsarchitektur](#17-sicherheitsarchitektur)
18. [Storage: Wo Daten leben](#18-storage-wo-daten-leben)
19. [UI: Die Sidebar & Benutzerinteraktion](#19-ui-die-sidebar--benutzerinteraktion)
20. [Build-System & Deployment](#20-build-system--deployment)
21. [Verzeichnisreferenz](#21-verzeichnisreferenz)

---

## 1. Was ist Obsilo?

Obsilo ist ein **AI-Agent-Plugin für Obsidian**. Es verwandelt dein Obsidian-Vault in einen interaktiven Arbeitsbereich, in dem ein KI-Agent:

- Notizen lesen, schreiben, bearbeiten und durchsuchen kann
- Im Internet recherchieren kann
- Semantisch (nach Bedeutung) suchen kann
- Aufgaben in Teilaufgaben zerlegen und an Sub-Agenten delegieren kann
- Sich an dich und deine Präferenzen erinnert
- Seine eigenen Fähigkeiten erweitern kann
- Andere Obsidian-Plugins als Skills nutzen kann
- Via MCP-Protokoll mit externen Services kommunizieren kann

Das Ganze passiert mit einem mehrstufigen Sicherheitssystem: Jede Schreiboperation kann eine Genehmigung erfordern, jede Aktion wird geloggt, und jede Änderung kann rückgängig gemacht werden.

**Tech-Stack:**
- TypeScript, gebaut mit esbuild
- Obsidian Plugin API
- Anthropic SDK, OpenAI SDK (LLM-Anbindung)
- isomorphic-git (Checkpoints)
- vectra (Vektor-Index für Semantic Search)
- MCP SDK (Model Context Protocol)

---

## 2. Die Architektur im Überblick

```
┌─────────────────────────────────────────────────────────┐
│                    Obsidian App                          │
│  ┌───────────────────────────────────────────────────┐  │
│  │              ObsidianAgentPlugin (main.ts)         │  │
│  │  ┌─────────┐  ┌──────────┐  ┌──────────────────┐ │  │
│  │  │   UI    │  │  API     │  │      Core        │ │  │
│  │  │ Sidebar │◄─┤ Handler  │◄─┤   AgentTask      │ │  │
│  │  │ Settings│  │(Anthropic│  │   (Agent Loop)   │ │  │
│  │  │ Modals  │  │ OpenAI)  │  │                  │ │  │
│  │  └────┬────┘  └──────────┘  │  ┌────────────┐  │ │  │
│  │       │                     │  │  Pipeline   │  │ │  │
│  │       │                     │  │ (Governance)│  │ │  │
│  │       │                     │  └──────┬─────┘  │ │  │
│  │       │                     │         │        │ │  │
│  │       │                     │  ┌──────▼─────┐  │ │  │
│  │       │                     │  │   Tools    │  │ │  │
│  │       │                     │  │ (30+ Vault,│  │ │  │
│  │       │                     │  │  Web, MCP) │  │ │  │
│  │       │                     │  └────────────┘  │ │  │
│  │       │                     └──────────────────┘ │  │
│  │       │                                          │  │
│  │  ┌────▼──────────────────────────────────────┐   │  │
│  │  │  Services: Memory, Semantic Index,        │   │  │
│  │  │  Checkpoints, MCP, Skills, Mastery,       │   │  │
│  │  │  Governance, Storage, i18n                │   │  │
│  │  └───────────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

Die Architektur folgt einem klaren Schichtenmodell:
1. **UI-Schicht** (`src/ui/`) — Sidebar, Settings, Modals
2. **API-Schicht** (`src/api/`) — LLM-Provider-Adapter
3. **Core-Schicht** (`src/core/`) — Agent-Loop, Tools, Pipeline, alle Services

---

## 3. Einstiegspunkt: Das Plugin startet

**Datei:** `src/main.ts` — Klasse `ObsidianAgentPlugin extends Plugin`

Wenn Obsidian das Plugin lädt, passiert in `onload()` eine definierte Reihenfolge:

### Schritt 1: Infrastruktur
```
ConsoleRingBuffer → SafeStorageService → GlobalFileService → GlobalSettingsService
```
- **ConsoleRingBuffer** (`src/core/observability/ConsoleRingBuffer.ts`): Fängt alle `console.*`-Aufrufe ab und speichert die letzten 500 Einträge in einem Ringpuffer. Der Agent kann diese Logs per Tool lesen.
- **SafeStorageService** (`src/core/security/SafeStorageService.ts`): Verschlüsselt API-Keys über Electrons OS-Keychain (macOS Keychain, Windows DPAPI, Linux libsecret).
- **GlobalFileService** (`src/core/storage/GlobalFileService.ts`): Filesystem-Adapter für `~/.obsidian-agent/` — der globale Speicherort, der vault-übergreifend gilt.

### Schritt 2: Settings laden
Settings werden aus zwei Quellen zusammengeführt:
- **Vault-lokal**: `.obsidian/plugins/obsilo-agent/data.json` (Obsidian-Standard)
- **Global**: `~/.obsidian-agent/settings.json` (vault-übergreifend)

Globale Settings (API-Keys, Models, Memory) überschreiben lokale. API-Keys werden beim Laden entschlüsselt, beim Speichern verschlüsselt.

### Schritt 3: Core Services initialisieren 
In dieser Reihenfolge:
1. **SyncBridge** — Synchronisiert globale Daten mit dem Vault-Plugin-Ordner (für Obsidian Sync)
2. **IgnoreService** — Lädt `.obsidian-agentignore` und `.obsidian-agentprotected`
3. **RulesLoader, WorkflowLoader, SkillsManager** — Laden benutzerdefinierte Regeln, Workflows, Skills
4. **VaultDNAScanner + SkillRegistry** — Erkennt installierte Obsidian-Plugins als Skills
5. **OperationLogger** — Tägliche JSONL-Audit-Logs
6. **GitCheckpointService** — Shadow-Git-Repo für Undo
7. **McpClient** — Verbindet zu konfigurierten MCP-Servern
8. **SandboxExecutor + EsbuildWasmManager** — Sandbox für dynamischen Code
9. **SelfAuthoredSkillLoader** — Vom Agent erstellte Skills laden
10. **ToolRegistry** — Registriert alle 43+ Tools
11. **SemanticIndexService** — Vektor-Index für semantische Suche
12. **RecipeStore + Mastery-System** — Prozedurale Rezepte und episodisches Lernen
13. **ConversationStore** — Persistente Chat-History
14. **MemoryService + ExtractionQueue** — Langzeitgedächtnis mit LLM-Extraktion

### Schritt 4: UI registrieren
- Sidebar-View wird registriert und automatisch bei Start geöffnet
- Settings-Tab wird registriert
- Obsidian-Commands werden registriert
- Deep-Link-Handler (`obsidian://obsilo-settings`) wird registriert

---

## 4. Der Agent-Loop: Wie Obsilo „denkt"

**Datei:** `src/core/AgentTask.ts` — Klasse `AgentTask`

Das ist das Herzstück. Wenn du eine Nachricht sendest, passiert folgendes:

### Der Loop im Detail

```
Benutzer sendet Nachricht
        │
        ▼
┌─ Iteration 0 ─────────────────────────────────┐
│  1. System Prompt bauen (inkl. Mode, Memory,   │
│     Tools, Rules, Skills, Rezepte)             │
│  2. An LLM senden (Streaming)                  │
│  3. Antwort empfangen:                         │
│     - Text-Chunks → an UI streamen             │
│     - Tool-Calls → sammeln                     │
│     - Usage → Token-Zähler aktualisieren       │
│  4. Falls keine Tool-Calls → FERTIG            │
│  5. Falls Tool-Calls:                          │
│     a) Parallel-safe? → parallel ausführen     │
│     b) Sonst → sequenziell ausführen           │
│     c) Pro Tool: Pipeline → Governance →       │
│        Approval → Checkpoint → Execute → Log   │
│  6. Tool-Ergebnisse als User-Message anhängen  │
│  7. Context Condensing prüfen                  │
│  8. Nächste Iteration (zurück zu 1)            │
└────────────────────────────────────────────────┘
        │
        ▼ (max 25 Iterationen)
    Ergebnis an User
```

### Wichtige Mechanismen im Loop

**Parallel-Ausführung:** Read-only Tools (`read_file`, `search_files`, `semantic_search`, `web_fetch` etc.) werden parallel ausgeführt wenn mehrere gleichzeitig auftreten. Write-Tools immer sequenziell.

**Tool Repetition Detection** (`src/core/tool-execution/ToolRepetitionDetector.ts`): Erkennt wenn der Agent denselben Tool-Call 3x wiederholt (exakt oder fuzzy bei Suchen) und blockiert ihn mit einer hilfreichen Fehlermeldung.

**Context Condensing** (`condenseHistory()`): Wenn die Konversation zu lang wird (>80% des Model-Kontextfensters), wird der mittlere Teil per LLM zusammengefasst. Erste Nachricht und letzte 4 Nachrichten bleiben erhalten. Vor dem Condensen werden wichtige Fakten ins Langzeitgedächtnis extrahiert (Pre-Compaction Flush).

**Power Steering:** Alle N Iterationen wird eine Erinnerung an die aktuelle Rolle injiziert, damit der Agent bei langen Aufgaben nicht abdriftet.

**Soft + Hard Limit:** Bei 60% der Max-Iterationen bekommt der Agent einen Hinweis, sich zu beeilen. Bei 100% wird ein finaler Text-Only-API-Call erzwungen, damit immer eine Antwort kommt.

**Sub-Agents** (`new_task` Tool): Der Agent kann Kind-Agenten spawnen mit eigenem Modus und eigener History. Maximale Verschachtelungstiefe: 2 Ebenen. Sub-Agents teilen den Approval-Callback des Elternteils.

**Abort:** Jeder Task hat einen `AbortController`. Wenn der User auf "Stop" klickt, wird der Signal an die LLM-API und alle laufenden Tools weitergegeben.

---

## 5. Tools: Die Hände des Agenten

**Dateien:** `src/core/tools/BaseTool.ts`, `src/core/tools/ToolRegistry.ts`

Jedes Tool ist eine Klasse die `BaseTool` erweitert und drei Dinge definiert:
1. `name` — Eindeutiger Bezeichner
2. `getDefinition()` — JSON-Schema das dem LLM die Parameter beschreibt
3. `execute(input, context)` — Die eigentliche Logik

### Tool-Kategorien

**Vault-Lesen** (`src/core/tools/vault/`):
| Tool | Datei | Was es tut |
|------|-------|------------|
| `read_file` | `ReadFileTool.ts` | Liest eine Datei (Markdown, PDF, Canvas, JSON) |
| `list_files` | `ListFilesTool.ts` | Listet Dateien in einem Ordner |
| `search_files` | `SearchFilesTool.ts` | Regex-Suche über den Vault |
| `get_frontmatter` | `GetFrontmatterTool.ts` | Liest YAML-Frontmatter |
| `get_linked_notes` | `GetLinkedNotesTool.ts` | Findet Wikilink-Verbindungen |
| `get_vault_stats` | `GetVaultStatsTool.ts` | Vault-Statistiken (Dateianzahl, Tags, etc.) |
| `search_by_tag` | `SearchByTagTool.ts` | Sucht Dateien nach Tags |
| `get_daily_note` | `GetDailyNoteTool.ts` | Liest/erstellt Daily Notes |
| `semantic_search` | `SemanticSearchTool.ts` | Bedeutungsbasierte Suche per Vektor-Index |
| `query_base` | `QueryBaseTool.ts` | Abfragen auf Obsidian Bases |

**Vault-Schreiben** (`src/core/tools/vault/`):
| Tool | Datei | Was es tut |
|------|-------|------------|
| `write_file` | `WriteFileTool.ts` | Erstellt oder überschreibt eine Datei |
| `edit_file` | `EditFileTool.ts` | Bearbeitet Teile einer Datei (search & replace) |
| `append_to_file` | `AppendToFileTool.ts` | Fügt Text am Ende an |
| `create_folder` | `CreateFolderTool.ts` | Erstellt einen Ordner |
| `delete_file` | `DeleteFileTool.ts` | Löscht eine Datei (via Trash) |
| `move_file` | `MoveFileTool.ts` | Verschiebt/benennt eine Datei um |
| `update_frontmatter` | `UpdateFrontmatterTool.ts` | Aktualisiert YAML-Frontmatter |
| `generate_canvas` | `GenerateCanvasTool.ts` | Erstellt Obsidian Canvas-Dateien |
| `create_excalidraw` | `CreateExcalidrawTool.ts` | Erstellt Excalidraw-Zeichnungen |
| `create_base` / `update_base` | `CreateBaseTool.ts`, `UpdateBaseTool.ts` | Erstellt/bearbeitet Obsidian Bases |

**Web** (`src/core/tools/web/`):
| Tool | Datei | Was es tut |
|------|-------|------------|
| `web_fetch` | `WebFetchTool.ts` | Lädt eine URL herunter (HTML → Markdown) |
| `web_search` | `WebSearchTool.ts` | Sucht im Internet |

**Agent-Steuerung** (`src/core/tools/agent/`):
| Tool | Was es tut |
|------|------------|
| `ask_followup_question` | Stellt dem User eine Rückfrage (pausiert den Loop) |
| `attempt_completion` | Signalisiert: „Ich bin fertig" |
| `update_todo_list` | Zeigt eine Todo-Liste in der UI |
| `switch_mode` | Wechselt den Agent-Modus |
| `new_task` | Spawnt einen Sub-Agenten |
| `update_settings` | Ändert Plugin-Settings |
| `configure_model` | Konfiguriert LLM-Modelle |
| `read_agent_logs` | Liest den ConsoleRingBuffer |
| `manage_mcp_server` | Verwaltet MCP-Server-Verbindungen |
| `manage_skill` | Erstellt/bearbeitet selbst-erstellte Skills |
| `evaluate_expression` | Führt Code in der Sandbox aus |
| `manage_source` | Liest/modifiziert eigenen Quellcode (Phase 4) |
| `execute_command` | Führt Obsidian-Commands aus (Plugin Skills) |
| `call_plugin_api` | Ruft Plugin-APIs direkt auf |
| `execute_recipe` | Führt ein prozedurales Rezept aus |

**MCP** (`src/core/tools/mcp/`):
| Tool | Datei | Was es tut |
|------|-------|------------|
| `use_mcp_tool` | `UseMcpToolTool.ts` | Leitet Tool-Calls an MCP-Server weiter |

### ToolRegistry

Die `ToolRegistry` (`src/core/tools/ToolRegistry.ts`) erstellt alle Tool-Instanzen in `registerInternalTools()` und speichert sie in einer `Map<ToolName, BaseTool>`. Sie bietet:
- `getTool(name)` — Einzelnes Tool holen
- `getToolDefinitions()` — Alle Tool-Schemas für den LLM-Call
- `getToolDefinitionsForMode(mode)` — Gefiltert nach Modus

---

## 6. Die Tool Execution Pipeline: Governance & Sicherheit

**Datei:** `src/core/tool-execution/ToolExecutionPipeline.ts`

Dies ist die **kritischste Komponente** (ASR-02). Jeder einzelne Tool-Call — ob intern oder MCP — fließt durch diese Pipeline. Sie stellt 7 Dinge sicher:

### Die 7 Schritte der Pipeline

```
Tool-Call kommt rein
       │
       ▼
1. ✅ Tool existiert? (sonst Error)
       │
       ▼
2. 🛡️ Governance-Check (IgnoreService):
   - Ist der Pfad in .obsidian-agentignore? → Blockiert
   - Ist der Pfad in .obsidian-agentprotected? → Nur lesen erlaubt
   - .git/, .obsidian/workspace etc. → Immer blockiert
       │
       ▼
3. 📦 Cache-Check (nur Lese-Tools):
   - Identischer Call schon ausgeführt? → Cache-Hit, sofort zurück
       │
       ▼
4. 🔐 Approval-Check:
   - Agent-Tools → immer auto-approved
   - Self-Modify-Tools → IMMER manuell (kein Auto-Approve möglich)
   - Andere → je nach Auto-Approval-Settings
   - Kein Approval-Callback vorhanden? → Fail-Closed (abgelehnt)
       │
       ▼
5. 💾 Checkpoint (nur Write-Tools):
   - Snapshot der betroffenen Datei BEVOR sie geändert wird
       │
       ▼
6. ⚡ Ausführung:
   - Tool.execute() mit ToolExecutionContext
       │
       ▼
7. 📝 Logging:
   - OperationLogger schreibt JSONL-Audit-Zeile
   - Erfolgreiche Reads werden gecacht
```

### Auto-Approval-Gruppen

Jedes Tool ist einer Gruppe zugeordnet (definiert in `TOOL_GROUPS`):

| Gruppe | Beispiel-Tools | Auto-Approval Setting |
|--------|---------------|----------------------|
| `read` | read_file, search_files | `autoApproval.read` |
| `note-edit` | write_file, edit_file | `autoApproval.noteEdits` |
| `vault-change` | create_folder, delete_file | `autoApproval.vaultChanges` |
| `web` | web_fetch, web_search | Immer auto (wenn aktiviert) |
| `agent` | ask_followup_question etc. | Immer auto |
| `self-modify` | manage_source, manage_skill | **Nie auto** (immer manuell) |
| `mcp` | use_mcp_tool | `autoApproval.mcp` |
| `skill` | execute_command | `autoApproval.skills` |

---

## 7. Modi: Ask vs. Agent

**Dateien:** `src/core/modes/builtinModes.ts`, `src/core/modes/ModeService.ts`

Obsilo hat zwei eingebaute Modi:

### Ask-Modus
- **Zweck:** Lesen, Suchen, Fragen beantworten — **kein Schreiben**
- **Tools:** `read`, `vault`, `agent` (keine `edit`, `web`, `mcp`, `skill`)
- **Verhalten:** Wenn der User etwas will, das Schreiben erfordert, wechselt der Agent automatisch per `switch_mode` in den Agent-Modus

### Agent-Modus
- **Zweck:** Volle Autonomie — alles lesen, schreiben, im Web suchen, Sub-Agenten spawnen
- **Tools:** Alle Gruppen (`read`, `vault`, `edit`, `web`, `agent`, `mcp`, `skill`)
- **Verhalten:** Handelt eigenständig, parallelisiert wo möglich

### Benutzerdefinierte Modi
User können eigene Modi erstellen (Settings → Modi oder `~/.obsidian-agent/modes.json`):
- Eigene `roleDefinition` (System-Prompt-Rolle)
- Eigene `toolGroups` (welche Tool-Kategorien verfügbar sind)
- Eigene `customInstructions` (zusätzliche Anweisungen)
- Quelle: `built-in`, `global` (vault-übergreifend), oder `vault` (nur dieses Vault)

Der **ModeService** (`src/core/modes/ModeService.ts`) verwaltet Modi, filtert Tool-Definitionen nach aktuellem Modus, und handhabt Mode-Switches.

---

## 8. LLM-Provider: Die Anbindung an KI-Modelle

**Dateien:** `src/api/index.ts`, `src/api/types.ts`, `src/api/providers/`

### Das Provider-System

Obsilo unterstützt mehrere LLM-Anbieter über eine einheitliche Schnittstelle:

```typescript
interface ApiHandler {
    createMessage(
        systemPrompt: string,
        messages: Message[],
        tools: ToolDefinition[],
        abortSignal?: AbortSignal
    ): AsyncGenerator<ApiEvent>;
}
```

Jeder Provider implementiert dieses Interface und liefert einen **AsyncGenerator**, der Events streamt:
- `text` — Text-Chunk (wird live in der UI angezeigt)
- `thinking` — Reasoning/Thinking-Token (Extended Thinking)
- `tool_use` — Der Agent möchte ein Tool aufrufen
- `tool_error` — Ungültiges Tool-JSON (wird als Fehler behandelt)
- `usage` — Token-Verbrauch (Input, Output, Cache)

### Unterstützte Provider

| Provider | Datei | Besonderheiten |
|----------|-------|----------------|
| **Anthropic** | `providers/anthropic.ts` | Claude-Modelle, Prompt Caching, Extended Thinking |
| **OpenAI** | `providers/openai.ts` | GPT-Modelle, auch: Ollama, LM Studio, OpenRouter, Azure |

Die `buildApiHandler()`-Funktion in `src/api/index.ts` entscheidet anhand des Provider-Typs, welche Implementierung erstellt wird. OpenAI-kompatible APIs (Ollama, LM Studio, OpenRouter, Azure, Custom) nutzen alle denselben `OpenAiProvider` mit unterschiedlicher `baseUrl`.

### Model-Konfiguration

Models werden als `CustomModel`-Objekte gespeichert (`src/types/settings.ts`):
- `name` — Model-ID für API-Calls (z.B. `claude-sonnet-4-5-20250929`)
- `provider` — Typ (`anthropic`, `openai`, `ollama`, etc.)
- `apiKey` — Verschlüsselt gespeichert
- `enabled` — Ob im Model-Selector sichtbar
- `promptCachingEnabled`, `thinkingEnabled` — Anthropic-spezifisch

Es gibt **drei Model-Slots:**
1. **Chat-Model** — Für Agent-Konversationen (primär)
2. **Embedding-Model** — Für Semantic Search (getrennt konfigurierbar)
3. **Memory-Model** — Für Session-Extraktion und Langzeit-Memory-Updates (kann ein günstiges/schnelles Model sein)

---

## 9. System Prompt: Was der Agent „weiß"

**Dateien:** `src/core/systemPrompt.ts`, `src/core/prompts/sections/`

Der System Prompt wird aus **16 modularen Sektionen** zusammengebaut, jeweils eine eigene Datei in `src/core/prompts/sections/`:

| # | Sektion | Datei | Inhalt |
|---|---------|-------|--------|
| 1 | DateTime | `dateTime.ts` | Aktuelles Datum/Uhrzeit |
| 2 | VaultContext | `vaultContext.ts` | „Du arbeitest in einem Obsidian-Vault" |
| 3 | Capabilities | `capabilities.ts` | Hochlevel-Zusammenfassung der Fähigkeiten |
| 4 | Memory | `memory.ts` | User-Profil, Projekte, Patterns, Soul |
| 5 | Tools | `tools.ts` | Tool-Definitionen (gefiltert nach Modus) |
| 6 | PluginSkills | `pluginSkills.ts` | Erkannte Obsidian-Plugin-Skills |
| 6.5 | Recipes | *(inline)* | Prozedurale Rezepte |
| 6.6 | SelfAuthoredSkills | *(inline)* | Vom Agent erstellte Skills |
| 7 | ToolRules | `toolRules.ts` | Regeln für Tool-Verwendung |
| 8 | ToolDecisionGuidelines | `toolDecisionGuidelines.ts` | Wann welches Tool verwenden |
| 9 | Objective | `objective.ts` | Aufgabenzerlegung, Planung |
| 10 | ResponseFormat | `responseFormat.ts` | Wie Antworten formatiert sein sollen |
| 11 | ExplicitInstructions | `explicitInstructions.ts` | Sicherheits- und Verhaltensregeln |
| 12 | SecurityBoundary | `securityBoundary.ts` | Sicherheitsgrenzen |
| 13 | ModeDefinition | `modeDefinition.ts` | Rollendefinition des aktiven Modus |
| 14 | CustomInstructions | `customInstructions.ts` | Benutzerdefinierte Anweisungen |
| 15 | Skills | `skills.ts` | Manuell definierte Skills |
| 16 | Rules | `rules.ts` | Benutzerdefinierte Regeln |

**Wichtig:** Sub-Tasks (Kind-Agenten) bekommen eine **abgespeckte Version** ohne Memory, Rezepte, Response-Format und Custom Instructions — sie sind Arbeiter, keine Konversationspartner.

---

## 10. Memory: Langzeitgedächtnis

**Dateien:** `src/core/memory/MemoryService.ts`, `SessionExtractor.ts`, `LongTermExtractor.ts`, `ExtractionQueue.ts`, `MemoryRetriever.ts`

### Wie Memory funktioniert

Obsilo hat ein zweistufiges Gedächtnis:

**Stufe 1: Sofort-Memory (im System Prompt)**
Vier Markdown-Dateien werden bei jedem API-Call mitgesendet:
- `~/.obsidian-agent/memory/user-profile.md` — Wer du bist, deine Präferenzen (~200 Token)
- `~/.obsidian-agent/memory/projects.md` — Aktive Projekte (~300 Token)
- `~/.obsidian-agent/memory/patterns.md` — Verhaltens-Muster (~200 Token)
- `~/.obsidian-agent/memory/soul.md` — Agent-Identität & Persönlichkeit (~200 Token)

Zusammen max. 4000 Zeichen — klein genug für jeden API-Call.

**Stufe 2: LLM-Extraktion (nach Konversation)**
Wenn eine Konversation endet und Memory aktiviert ist:
1. Die **ExtractionQueue** (`ExtractionQueue.ts`) nimmt den Konversationstranskript auf
2. Der **SessionExtractor** (`SessionExtractor.ts`) schickt ihn an ein (günstigeres) LLM-Modell
3. Das LLM extrahiert: Zusammenfassung, Entscheidungen, User-Präferenzen, Task-Outcome, Tool-Effectiveness, Learnings
4. Ergebnis wird als `~/.obsidian-agent/memory/sessions/{id}.md` gespeichert
5. Optional: Der **LongTermExtractor** aktualisiert die Sofort-Memory-Dateien mit neuen Erkenntnissen

**Pre-Compaction Flush:** Bevor Context Condensing die History zusammenfasst, werden zuerst wichtige Fakten ins Memory extrahiert — so geht nichts verloren.

**`knowledge.md`** wird *nicht* in den System Prompt injiziert (zu groß). Stattdessen wird es on-demand über Semantic Search abgefragt.

---

## 11. Semantic Search: Bedeutungsbasierte Suche

**Datei:** `src/core/semantic/SemanticIndexService.ts`

### Wie der Vektor-Index funktioniert

1. **Indexierung:** Alle Markdown-Dateien (optional auch PDFs) werden in Chunks geteilt (default: 2000 Zeichen), an Markdown-Headings orientiert
2. **Embedding:** Chunks werden über ein Embedding-Modell (z.B. `text-embedding-3-small`) in Vektoren umgewandelt — batch-weise (16 Texte pro API-Call)
3. **Speicherung:** Vektoren werden lokal per **vectra** (LocalIndex) gespeichert
4. **Suche:** Bei `semantic_search` wird die Query embedded und die ähnlichsten Chunks per Kosinus-Ähnlichkeit gefunden

### Technische Details
- **Heading-aware Chunking:** Größere Chunks (2000 Zeichen), gesplittet an Markdown-Headings, dann an Paragraphen
- **Resumable Indexing:** Ein Checkpoint (`index-meta.json`) speichert pro Datei die `mtime` — unterbrochene Builds setzen dort fort
- **Auto-Index:** Optional bei Vault-Änderungen (create, modify, rename, delete) mit Debouncing
- **Cancel-Support:** `cancelBuild()` setzt ein Flag das zwischen File-Batches geprüft wird
- **Event-Loop Yielding:** `setTimeout(0)` zwischen Disk-Commits verhindert UI-Freeze

---

## 12. Checkpoints: Undo-System mit Git

**Datei:** `src/core/checkpoints/GitCheckpointService.ts`

### Wie es funktioniert

Obsilo unterhält ein **Shadow-Git-Repo** unter `.obsidian/plugins/obsilo-agent/checkpoints/`. Es ist komplett unabhängig von einem eventuellen Git-Repo im Vault selbst.

**Vor jedem Write-Tool:**
1. Die Pipeline ruft `checkpointService.snapshot(taskId, [filePath], toolName)` auf
2. Die betroffenen Dateien werden ins Shadow-Repo kopiert und committed
3. Ein `CheckpointInfo`-Objekt wird gespeichert (taskId, commitOid, Zeitstempel, geänderte Dateien)
4. Die UI zeigt den Checkpoint als wiederherstellbar an

**Beim Undo:**
1. Die Datei wird aus dem Shadow-Repo-Commit wiederhergestellt
2. Dateien die vor dem Checkpoint nicht existierten werden gelöscht

**isomorphic-git** wird verwendet — reines JavaScript, kein nativer Git-Binary nötig. Funktioniert auf allen Plattformen (macOS, Windows, Linux, iOS, Android).

---

## 13. MCP: Externe Tool-Erweiterung

**Datei:** `src/core/mcp/McpClient.ts`

### Was ist MCP?

Das **Model Context Protocol** ist ein Standard von Anthropic für die Kommunikation zwischen KI-Agenten und externen Services. Obsilo kann sich mit MCP-Servern verbinden und deren Tools nutzen.

### Unterstützte Transporte
- **SSE** (Server-Sent Events) — für bestehende SSE-basierte Server
- **Streamable HTTP** — neuerer Transport-Standard

### Wie die Integration funktioniert

1. User konfiguriert MCP-Server in den Settings (URL, Typ, Header, Timeout)
2. Beim Plugin-Start verbindet `McpClient.connectAll()` zu allen aktivierten Servern
3. Server-Tools werden abgefragt (`listTools()`) und in die Tool-Liste aufgenommen
4. Wenn der Agent `use_mcp_tool` aufruft, leitet der `UseMcpToolTool` den Call an den richtigen Server weiter
5. MCP-Calls durchlaufen die gleiche Pipeline (Governance, Approval, Logging)

### Der Agent kann auch MCP-Server verwalten
Das `manage_mcp_server`-Tool erlaubt dem Agent, zur Laufzeit Server hinzuzufügen, zu entfernen, zu aktivieren/deaktivieren und neu zu verbinden.

---

## 14. VaultDNA & Plugin Skills

**Dateien:** `src/core/skills/VaultDNAScanner.ts`, `SkillRegistry.ts`, `CapabilityGapResolver.ts`

### VaultDNA: Plugin-Erkennung

Der **VaultDNAScanner** scannt beim Start alle installierten Obsidian-Plugins und erstellt für jedes ein Profil:

1. **Scan:** Liest `app.plugins.manifests` (alle installierten Plugins)
2. **Klassifikation:** Basierend auf Befehlsanzahl
   - `RICH` — Viele agentifizierbare Commands
   - `MODERATE` — Einige Commands
   - `MINIMAL` — Wenige Commands
   - `NONE` — Keine nutzbaren Commands (nur UI)
3. **Skill-Generierung:** Für jedes Plugin wird eine `.skill.md` Datei erzeugt unter `~/.obsidian-agent/plugin-skills/`
4. **Persistenz:** `vault-dna.json` speichert den Scan-Zustand
5. **Live-Sync:** Polling erkennt Plugin-Änderungen (enable/disable)

### Was der Agent damit kann

- **`execute_command`**: Führt einen Obsidian-Command aus (z.B. `daily-notes:open-today`)
- **`call_plugin_api`**: Ruft Plugin-APIs direkt auf (mit Allowlist für bekannte sichere Methoden)
- **`resolve_capability_gap`**: Sucht Community-Plugins die eine fehlende Fähigkeit bereitstellen könnten
- **`enable_plugin`**: Aktiviert ein installiertes aber deaktiviertes Plugin

---

## 15. Mastery: Rezepte & Episodisches Lernen

**Dateien:** `src/core/mastery/RecipeStore.ts`, `RecipeMatchingService.ts`, `EpisodicExtractor.ts`, `RecipePromotionService.ts`

### Prozedurale Rezepte

Rezepte sind **wiederverwendbare Schritt-für-Schritt-Anleitungen** die dem Agent beibringen, wie er bestimmte Aufgaben erledigen soll.

- **Statische Rezepte** (`staticRecipes.ts`): Werden mit dem Plugin ausgeliefert
- **Gelernte Rezepte**: Werden aus erfolgreichen Aufgaben extrahiert und als JSON gespeichert
- **Rezept-Matching** (`RecipeMatchingService.ts`): Findet relevante Rezepte basierend auf der User-Message
- **Im System Prompt**: Relevante Rezepte werden zwischen Plugin-Skills und Tool-Rules eingefügt

### Episodisches Lernen

Nach jeder Konversation:
1. Der **EpisodicExtractor** speichert die Tool-Sequenz und einen Ledger (welche Tools mit welchen Ergebnissen)
2. Der **RecipePromotionService** analysiert wiederkehrende Muster in Episoden
3. Erfolgreiche Muster werden per LLM in neue Rezepte umgewandelt und dem `RecipeStore` hinzugefügt

So lernt der Agent über die Zeit dazu — nicht durch Model-Finetuning, sondern durch **prozedurale Erinnerungen** die im System Prompt stehen.

---

## 16. Self-Development: Der Agent verbessert sich selbst

Dies ist das ambitionierteste Feature, aufgeteilt in 4 Phasen:

### Phase 1: Observability
- **ConsoleRingBuffer** (`src/core/observability/ConsoleRingBuffer.ts`): Der Agent kann seine eigenen Logs lesen
- **`read_agent_logs`**: Tool zum Lesen des Ringpuffers
- **`manage_mcp_server`**: Tool zum Verwalten externer Verbindungen

### Phase 2: Self-Authored Skills
- **SelfAuthoredSkillLoader** (`src/core/skills/SelfAuthoredSkillLoader.ts`): Lädt vom Agent erstellte Skills aus `~/.obsidian-agent/self-authored-skills/`
- **`manage_skill`** Tool: Der Agent kann Skills erstellen, bearbeiten, löschen
- Skills sind Markdown-Dateien mit optionalen Code-Modulen

### Phase 3: Sandbox & Dynamic Modules
- **SandboxExecutor** (`src/core/sandbox/SandboxExecutor.ts`): Eine sandboxed iframe (`sandbox="allow-scripts"`) für Code-Ausführung
- **EsbuildWasmManager** (`src/core/sandbox/EsbuildWasmManager.ts`): esbuild-wasm kompiliert TypeScript zu JS direkt im Browser
  - Zwei Kompilierungsmodi: `transform()` (Einzeldatei, ~100ms) und `build()` (mit npm-Deps, ~500ms-2s)
  - npm-Pakete werden von CDN geladen: esm.sh `?bundle` (bevorzugt, transitive Deps inlined), jsdelivr `/+esm` (Fallback)
  - `resolveInternalImports()` loest rekursiv absolute CDN-Imports auf (z.B. Node-Polyfills `/node/buffer.mjs`, `/node/process.mjs` -> `/node/events.mjs` -> `/node/async_hooks.mjs`)
  - Parallele Package-Downloads via `Promise.all()`
- **AstValidator** (`src/core/sandbox/AstValidator.ts`): Validiert Code vor Ausführung (keine `eval`, kein `require`, etc.). Strippt Kommentare vor der Prüfung.
- **SandboxBridge** (`src/core/sandbox/SandboxBridge.ts`): Kontrolliert was die Sandbox darf (Vault-Read/Write, URL-Fetch). Rate Limits: 10 Writes/min, 5 Requests/min. URL-Allowlist: unpkg.com, cdn.jsdelivr.net, registry.npmjs.org, esm.sh.
- **DynamicToolLoader** (`src/core/tools/dynamic/DynamicToolLoader.ts`): Lädt zur Laufzeit neue Tools aus Code-Modulen
- **`evaluate_expression`** Tool: Führt TypeScript in der Sandbox aus. Unterstützt `dependencies`-Parameter für npm-Pakete (z.B. pptxgenjs, xlsx, pdf-lib). Import-Hoisting: Statische `import`-Zeilen werden automatisch an den Modul-Top-Level extrahiert.
- **CSP:** `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'`

### Phase 4: Core Self-Modification
- **EmbeddedSourceManager** (`src/core/self-development/EmbeddedSourceManager.ts`): Im Build wird der gesamte TypeScript-Quellcode base64-encodiert in `main.js` eingebettet. Der Agent kann seinen eigenen Code lesen und durchsuchen.
- **PluginBuilder** (`src/core/self-development/PluginBuilder.ts`): Kann den Plugin-Code mit esbuild-wasm neu kompilieren
- **PluginReloader** (`src/core/self-development/PluginReloader.ts`): Kann das Plugin zur Laufzeit neuladen
- **`manage_source`** Tool: Lesen, Suchen, Bearbeiten des eigenen Quellcodes
- **Sicherheit:** Self-Modify-Tools erfordern **immer** manuelle Genehmigung (M-7: kein Auto-Approve möglich)

---

## 17. Sicherheitsarchitektur

Obsilo hat **7 Sicherheitsschichten**, die zusammen ein Defense-in-Depth-Modell bilden:

### Schicht 1: Verschlüsselte API-Keys
**Datei:** `src/core/security/SafeStorageService.ts`

API-Keys werden über Electrons `safeStorage` API verschlüsselt und als `enc:v1:<base64>` in `data.json` gespeichert. Die tatsächliche Verschlüsselung delegiert an den OS-Keychain (macOS Keychain Services, Windows DPAPI, Linux libsecret). Fallback: Wenn `safeStorage` nicht verfügbar ist, werden Keys im Klartext gespeichert (mit Warnung).

### Schicht 2: Dateisystem-Governance
**Datei:** `src/core/governance/IgnoreService.ts`

- `.obsidian-agentignore`: Pfade die der Agent nicht mal lesen darf (gitignore-Syntax)
- `.obsidian-agentprotected`: Pfade die gelesen aber nie geschrieben werden dürfen
- **Always-Blocked:** `.git/`, `.obsidian/workspace`, `.obsidian/cache`
- **Always-Protected:** Die Governance-Dateien selbst
- **Fail-Closed:** Bevor die Regeln geladen sind, wird alles blockiert

### Schicht 3: Approval-System
**Datei:** `src/core/tool-execution/ToolExecutionPipeline.ts`

- Jedes Write-Tool kann eine User-Genehmigung erfordern
- Granulare Auto-Approval-Settings pro Tool-Gruppe
- **Fail-Closed:** Fehlt der Approval-Callback → wird abgelehnt (nie stillschweigend auto-approved)
- **Self-Modify:** Immer manuell, kein Auto-Approve möglich

### Schicht 4: Diff-Review
**Datei:** `src/ui/DiffReviewModal.ts`

Wenn der Agent eine Datei schreiben will und Approval erforderlich ist:
- Ein **Diff-Modal** zeigt die Änderungen mit semantischer Gruppierung (Frontmatter, Headings, Listen, Code, Paragraphen)
- User kann pro Sektion genehmigen oder ablehnen
- User kann den Inhalt direkt im Modal bearbeiten
- Erst nach „Apply" wird geschrieben

### Schicht 5: Checkpoint-System
(Siehe Kapitel 12)
- Jede Schreiboperation erzeugt vorher einen Git-Snapshot
- Änderungen können jederzeit rückgängig gemacht werden

### Schicht 6: Audit Trail
**Datei:** `src/core/governance/OperationLogger.ts`

- Jeder Tool-Call wird in täglichen JSONL-Dateien geloggt
- Sensitive Daten werden sanitized (API-Keys → `[REDACTED]`, Dateiinhalte → `[N chars]`, URLs → auth-stripped)
- Rotation: Logs älter als 30 Tage werden gelöscht

### Schicht 7: Loop-Guards
**Datei:** `src/core/tool-execution/ToolRepetitionDetector.ts`

- **Exact Repetition:** Identischer Tool-Call 3x → blockiert
- **Fuzzy Search Dedup:** Semantisch ähnliche Suchanfragen 3x → blockiert
- **Consecutive Mistake Limit:** Konfigurierbare Grenze für aufeinanderfolgende Fehler
- **Max Iterations:** Harte Obergrenze (default: 25) verhindert Endlosschleifen
- **Soft Limit:** Bei 60% der Iterationen wird der Agent zum Abschluss aufgefordert

### Zusätzliche Maßnahmen

- **Path Traversal Protection** in `GlobalFileService`: Pfade die aus `~/.obsidian-agent/` ausbrechen werden blockiert
- **Plugin API Allowlist** (`src/core/tools/agent/pluginApiAllowlist.ts`): Nur bekannte sichere Plugin-Methoden sind als Read klassifiziert
- **AST Validation** für Sandbox-Code: Kein `eval`, `new Function()`, `require()`, `import()`, `process`, `__proto__`, `globalThis`, `WebAssembly`, `constructor.constructor`, `arguments.callee`, `setTimeout/setInterval` mit String-Argument. Kommentare werden vor der Pruefung gestrippt.
- **CSP Meta Tag** in der Sandbox-HTML: `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'`
- **Context Condensing**: Default aktiviert. Emergency-Condensing bei 400-Context-Overflow-Fehlern mit automatischer History-Komprimierung.
- **Recipe Validation** (`src/core/tools/agent/recipeValidator.ts`): Rezepte werden vor Ausführung validiert
- **Security Boundary** im System Prompt: Explizite Anweisungen an den Agent, keine sensiblen Daten preiszugeben
- **Review-Bot Compliance:** Code folgt Obsidian's Plugin-Review-Richtlinien (kein `console.log`, kein `fetch()`, kein `innerHTML` etc.)

---

## 18. Storage: Wo Daten leben

### Zwei Speicherorte

**Vault-lokal** (`.obsidian/plugins/obsilo-agent/`):
- `data.json` — Vault-spezifische Settings
- `checkpoints/` — Shadow-Git-Repo
- `semantic-index/` — Vektor-Index (wenn Sync-Location = obsidian-sync)

**Global** (`~/.obsidian-agent/`):
- `settings.json` — Vault-übergreifende Settings (Models, API-Keys)
- `memory/` — User-Profil, Projekte, Patterns, Soul, Sessions
- `rules/` — Benutzerdefinierte Regeln (`.md` Dateien)
- `workflows/` — Workflow-Definitionen
- `skills/` — Manuell definierte Skills
- `self-authored-skills/` — Vom Agent erstellte Skills
- `plugin-skills/` — VaultDNA-generierte Plugin-Skills
- `recipes/` — Gelernte prozedurale Rezepte
- `episodes/` — Episodische Erinnerungen
- `conversations/` — Persistente Chat-History
- `logs/` — Audit-Trail (JSONL pro Tag)
- `modes.json` — Global definierte Modi

### SyncBridge (`src/core/storage/SyncBridge.ts`)

Damit globale Daten auch über Obsidian Sync funktionieren:
1. **Push:** Kopiert ausgewählte globale Dateien in den Vault-Plugin-Ordner
2. **Pull:** Beim Start werden Dateien aus dem Vault-Plugin-Ordner nach global kopiert
3. So fließen Memory, Rules, Skills etc. über Obsidian Sync zwischen Geräten

---

## 19. UI: Die Sidebar & Benutzerinteraktion

**Dateien:** `src/ui/AgentSidebarView.ts`, `src/ui/AgentSettingsTab.ts`, `src/ui/DiffReviewModal.ts`, `src/ui/ChatHistoryModal.ts`

### AgentSidebarView (3000+ Zeilen)

Die Sidebar ist die Hauptschnittstelle zum Agent:

**Header:**
- Plugin-Icon + Titel
- New Chat Button
- History Button (öffnet HistoryPanel)

**Chat-Container:**
- Scrollbare Nachrichtenliste
- Markdown-Rendering (Obsidians `MarkdownRenderer`)
- User-Nachrichten, Agent-Antworten, Tool-Calls mit ein/ausklappbaren Ergebnissen
- Todo-Listen (vom Agent via `update_todo_list`)
- Checkpoints (mit Undo-Button)
- Token-Usage-Anzeige
- Context-Condensed-Indikatoren

**Chat-Input:**
- Textarea mit Auto-Resize
- **Mode-Button:** Wechselt zwischen Ask/Agent/Custom-Modi
- **Model-Button:** Wechselt das aktive LLM-Model
- **Tool-Picker** (Pocket-Knife-Icon): Wählt Tools, Skills, Workflows direkt aus
- **Web-Toggle** (Globe-Icon): Aktiviert/deaktiviert Web-Tools
- **File-Picker** (@-Button): Fügt Vault-Dateien als Kontext hinzu
- **Attachment-Handler**: Support für Bild-Attachments
- **Autocomplete**: `/`-Commands und `@`-File-References
- **Send/Stop-Button**: Sendet Nachricht oder bricht laufende Anfrage ab

### Onboarding

Beim ersten Start ohne konfiguriertes Model:
1. Die Sidebar erkennt: Kein API-Key → startet chat-basiertes Onboarding
2. User wählt Provider (Anthropic, OpenAI, etc.)
3. User gibt API-Key ein
4. Key wird getestet
5. Model wird aktiviert
6. Der `OnboardingService` (`src/core/memory/OnboardingService.ts`) führt durch den Prozess

### Settings (`src/ui/AgentSettingsTab.ts`)

Umfangreicher Settings-Tab mit Sektionen:
- **Models:** Konfiguration aller LLM-Modelle
- **Agent Behaviour:** Modi, Custom Instructions, Auto-Approval
- **Memory:** Memory ein/aus, Memory-Model, Auto-Extraction
- **Semantic Search:** Index-Konfiguration, Embedding-Model
- **Web Tools:** Aktivierung, Brave Search API Key
- **MCP Servers:** Server-Konfiguration
- **Plugin Skills (VaultDNA):** Scan, Skill-Toggles
- **Mastery:** Rezepte ein/aus, Rezept-Toggles
- **Checkpoints:** Ein/Aus, Timeout, Auto-Cleanup
- **Advanced:** Debug-Mode, Rate-Limit, Consecutive-Error-Limit, etc.
- **Backup & Restore:** Export/Import der Settings

---

## 20. Build-System & Deployment

**Dateien:** `esbuild.config.mjs`, `tsconfig.json`, `deploy-local.sh`

### Build-Prozess

```bash
npm run build  # TypeScript-Check + esbuild
```

esbuild kompiliert alles zu einer einzigen `main.js`:
- **Format:** CommonJS (`cjs`)
- **Target:** ES2022
- **Externals:** `obsidian`, `electron`, `esbuild-wasm`, `@codemirror/*`, `@lezer/*`, Node.js builtins
- **Besonderheit:** Ein Custom-Plugin `embed-source` bettet den gesamten TypeScript-Quellcode base64-encodiert als `EMBEDDED_SOURCE`-Konstante ein (für Self-Modification, Phase 4)

### Ausgabe-Dateien
- `main.js` — Das kompilierte Plugin
- `manifest.json` — Plugin-Metadaten für Obsidian
- `styles.css` — Alle Styles (keine inline-Styles, Review-Bot-Compliance)

### Lokales Deployment

```bash
npm run deploy  # Build + deploy-local.sh
```

`deploy-local.sh` kopiert `main.js`, `manifest.json` und `styles.css` in den Vault-Plugin-Ordner.

### i18n

Das Plugin verwendet **i18next** (`src/i18n/`) für Internationalisierung. Alle UI-Strings werden über `t('key')` referenziert. Unterstützte Sprachen werden in der Settings als `language`-Feld konfiguriert.

---

## 21. Verzeichnisreferenz

Hier eine kompakte Übersicht, was wo liegt:

```
src/
├── main.ts                          # Plugin Entry Point — alles startet hier
├── api/
│   ├── index.ts                     # buildApiHandler() Factory
│   ├── types.ts                     # ApiHandler Interface, Message-Typen
│   └── providers/
│       ├── anthropic.ts             # Claude-Anbindung (Streaming, Caching, Thinking)
│       └── openai.ts               # OpenAI + alle kompatiblen (Ollama, Azure, etc.)
├── core/
│   ├── AgentTask.ts                 # ⭐ DER Agent-Loop (Konversationsschleife)
│   ├── systemPrompt.ts             # System Prompt Builder (16 Sektionen)
│   ├── ChatHistoryService.ts       # Legacy Chat-History (Markdown-Dateien im Vault)
│   ├── checkpoints/
│   │   └── GitCheckpointService.ts # Shadow-Git Undo-System
│   ├── config/                      # Konfigurationsdateien
│   ├── context/
│   │   ├── RulesLoader.ts          # Benutzerdefinierte Regeln laden
│   │   ├── WorkflowLoader.ts       # Workflow-Definitionen laden
│   │   ├── SkillsManager.ts        # Skill-Definitionen laden
│   │   └── SupportPrompts.ts       # Vordefinierte Prompt-Templates
│   ├── governance/
│   │   ├── IgnoreService.ts        # 🛡️ Dateizugriffs-Governance
│   │   └── OperationLogger.ts      # 📝 Audit-Trail (JSONL)
│   ├── history/
│   │   └── ConversationStore.ts    # Persistente Konversationen (global)
│   ├── mastery/
│   │   ├── RecipeStore.ts          # Rezept-Speicher (statisch + gelernt)
│   │   ├── RecipeMatchingService.ts # Rezepte zu User-Messages matchen
│   │   ├── EpisodicExtractor.ts    # Tool-Sequenzen als Episoden speichern
│   │   ├── RecipePromotionService.ts # Episoden zu Rezepten promoten
│   │   ├── SuggestionService.ts    # Proaktive Vorschläge
│   │   ├── staticRecipes.ts        # Mitgelieferte Rezepte
│   │   └── types.ts                # ProceduralRecipe Interface
│   ├── mcp/
│   │   └── McpClient.ts            # MCP-Server-Verbindungen (SSE/HTTP)
│   ├── memory/
│   │   ├── MemoryService.ts        # Lese/Schreib-Zugriff auf Memory-Dateien
│   │   ├── SessionExtractor.ts     # LLM-basierte Session-Zusammenfassung
│   │   ├── LongTermExtractor.ts    # LLM-basiertes Langzeit-Memory-Update
│   │   ├── ExtractionQueue.ts      # Async Queue für Background-Extraktion
│   │   ├── MemoryRetriever.ts      # Memory-Context für System Prompt bauen
│   │   └── OnboardingService.ts    # Ersteinrichtungs-Assistent
│   ├── modes/
│   │   ├── builtinModes.ts         # Ask + Agent Modi
│   │   ├── ModeService.ts          # Mode-Verwaltung + Tool-Filterung
│   │   └── GlobalModeStore.ts      # Globale Modi (vault-übergreifend)
│   ├── observability/
│   │   └── ConsoleRingBuffer.ts    # 500-Einträge Console-Log Ringpuffer
│   ├── prompts/
│   │   ├── defaultPrompts.ts       # Vordefinierte Support-Prompts
│   │   └── sections/               # 16 modulare System-Prompt-Sektionen
│   │       ├── capabilities.ts
│   │       ├── customInstructions.ts
│   │       ├── dateTime.ts
│   │       ├── explicitInstructions.ts
│   │       ├── memory.ts
│   │       ├── modeDefinition.ts
│   │       ├── objective.ts
│   │       ├── pluginSkills.ts
│   │       ├── responseFormat.ts
│   │       ├── rules.ts
│   │       ├── securityBoundary.ts
│   │       ├── skills.ts
│   │       ├── toolDecisionGuidelines.ts
│   │       ├── toolRules.ts
│   │       ├── tools.ts
│   │       └── vaultContext.ts
│   ├── sandbox/
│   │   ├── SandboxExecutor.ts      # Iframe-basierte Code-Sandbox
│   │   ├── EsbuildWasmManager.ts   # TypeScript → JS Kompilierung im Browser
│   │   ├── AstValidator.ts         # Code-Validierung vor Ausführung
│   │   ├── SandboxBridge.ts        # Security Bridge (Sandbox ↔ Plugin)
│   │   └── sandboxHtml.ts          # HTML-Template für die Sandbox-Iframe
│   ├── security/
│   │   └── SafeStorageService.ts   # 🔐 OS-Keychain-Verschlüsselung für API-Keys
│   ├── self-development/
│   │   ├── EmbeddedSourceManager.ts # Eingebetteten Quellcode lesen/durchsuchen
│   │   ├── PluginBuilder.ts        # Plugin neu kompilieren (esbuild-wasm)
│   │   └── PluginReloader.ts       # Plugin zur Laufzeit neuladen
│   ├── skills/
│   │   ├── VaultDNAScanner.ts      # Obsidian-Plugins als Skills erkennen
│   │   ├── SkillRegistry.ts        # Plugin-Skills verwalten
│   │   ├── CapabilityGapResolver.ts # Fehlende Fähigkeiten → Plugin-Vorschläge
│   │   ├── SelfAuthoredSkillLoader.ts # Vom Agent erstellte Skills laden
│   │   ├── CodeModuleCompiler.ts   # TypeScript-Skills kompilieren
│   │   └── CorePluginLibrary.ts    # Bekannte Obsidian Core-Plugins
│   ├── storage/
│   │   ├── GlobalFileService.ts    # ~/.obsidian-agent/ Filesystem-Adapter
│   │   ├── GlobalSettingsService.ts # Globale Settings verwalten
│   │   ├── GlobalMigrationService.ts # Einmalige Migration vault→global
│   │   ├── SyncBridge.ts           # Global ↔ Vault Sync für Obsidian Sync
│   │   └── types.ts                # FileAdapter Interface
│   ├── tool-execution/
│   │   ├── ToolExecutionPipeline.ts # ⭐ ZENTRALE GOVERNANCE-PIPELINE
│   │   └── ToolRepetitionDetector.ts # Loop-Guard (Repetition + Fuzzy-Dedup)
│   ├── tools/
│   │   ├── BaseTool.ts             # Abstrakte Basisklasse für alle Tools
│   │   ├── ToolRegistry.ts         # Zentrale Tool-Registry
│   │   ├── toolMetadata.ts         # UI-Metadaten (Icons, Beschreibungen)
│   │   ├── types.ts                # ToolName, ToolDefinition, ToolUse, etc.
│   │   ├── vault/                  # 22 Vault-Tools (Read + Write)
│   │   ├── web/                    # 2 Web-Tools (Fetch + Search)
│   │   ├── agent/                  # 17 Agent-Steuerungs-Tools
│   │   ├── mcp/                    # 1 MCP-Proxy-Tool
│   │   └── dynamic/               # Dynamic Tool Loader (Phase 3)
│   └── utils/                      # Hilfsfunktionen (Diff, Markdown, Regex etc.)
├── i18n/                           # Internationalisierung (i18next)
├── types/
│   ├── settings.ts                 # ⭐ ObsidianAgentSettings, CustomModel, etc.
│   ├── electron.d.ts              # Electron-Typdeklarationen
│   └── obsidian-augments.d.ts     # Obsidian-API-Erweiterungen
├── ui/
│   ├── AgentSidebarView.ts         # ⭐ Hauptsidebar (3000+ Zeilen)
│   ├── AgentSettingsTab.ts         # Settings-Tab
│   ├── ChatHistoryModal.ts        # Chat-History-Modal
│   ├── DiffReviewModal.ts         # Diff-Review bei Approval (887 Zeilen)
│   ├── obsiloIcon.ts              # SVG-Icon
│   ├── settings/                   # Settings-Sub-Komponenten
│   └── sidebar/
│       ├── AttachmentHandler.ts    # Bild/Datei-Attachments
│       ├── AutocompleteHandler.ts  # /Commands und @Files Autocomplete
│       ├── HistoryPanel.ts         # Konversations-History Panel
│       ├── ToolPickerPopover.ts    # Tool/Skill/Workflow Picker
│       └── VaultFilePicker.ts      # @-File Picker
└── assets/                         # Statische Assets
```

---

## Zusammenfassung: Der Datenfluss

Wenn du „Erstelle mir eine Zusammenfassung aller Meeting-Notes" eintippst, passiert folgendes:

1. **UI** (`AgentSidebarView`) nimmt die Nachricht entgegen
2. **History** wird geladen (Memory-Context, Rules, Skills, Rezepte)
3. **AgentTask** wird erstellt und `run()` aufgerufen
4. **System Prompt** wird aus 16 Sektionen zusammengebaut
5. **API Handler** sendet an Claude/GPT (Streaming)
6. Claude antwortet: „Ich suche erstmal nach Meeting-Notes" + `semantic_search(query="meeting notes")`
7. **AgentSidebarView** zeigt den Text + Tool-Call live an
8. **ToolExecutionPipeline** empfängt den Tool-Call:
   - IgnoreService prüft den Pfad → OK
   - Read-Tool → Auto-Approved
   - SemanticSearchTool.execute() → Vektor-Suche → Ergebnisse
   - OperationLogger schreibt Audit-Zeile
9. Ergebnis geht zurück an AgentTask → wird als User-Message angehängt
10. **Iteration 2:** Claude liest die gefundenen Dateien (parallel: `read_file` × 5)
11. **Iteration 3:** Claude schreibt: `write_file(path="Summaries/Meeting-Notes.md", content="...")`
12. **Pipeline:** 
    - Write-Tool → Approval prüfen (je nach Settings: Auto oder Modal)
    - DiffReviewModal zeigt Vorschau → User genehmigt
    - Checkpoint wird erstellt (Git Snapshot)
    - WriteFileTool.execute() → Datei wird geschrieben
    - Logger dokumentiert
13. Claude: `attempt_completion(result="Zusammenfassung erstellt")`
14. **AgentTask** beendet den Loop, gibt Token-Usage weiter
15. **Memory:** ExtractionQueue nimmt die Konversation auf, extrahiert Learnings im Hintergrund
16. **Mastery:** Episode wird gespeichert, ggf. als Rezept promoted

---

*Dieses Dokument wurde aus der Analyse des vollständigen Quellcodes erstellt. Alle Datei-Referenzen beziehen sich auf `src/` im Projekt-Root `/Users/sebastianhanke/projects/obsidian-agent/`.*
