# Obsidian Agent — Roadmap

> Details: [BACKLOG.md](BACKLOG.md) · Plan: `.claude/plans/synthetic-gathering-tide.md`

---

## Sprint 1 — Kritische Blocker
*Ziel: Agent ist nutzbar für echtes Note-Editing*

| # | Feature | Was es bringt |
|---|---------|---------------|
| 1.1 | **`edit_file` Tool** (diff-basiert, Match Precision) | Bestehende Notizen gezielt bearbeiten ohne Inhalt zu verlieren |
| 1.1 | **`append_to_file` Tool** | Text an Note anhängen (Daily Note, Logbuch) |
| 1.2 | **`ask_followup_question` Tool** | Agent kann bei Unklarheiten nachfragen statt zu raten |
| 1.2 | **`attempt_completion` Tool** | Agent signalisiert explizit wann er fertig ist |
| 1.3 | **Auto-Approve System** | Lesen immer erlaubt, Schreiben per Klick oder automatisch |
| 1.3 | **Auto-Approve Chat-Leiste** | Schnell-Toggles direkt im Chat-Fenster |
| 1.4 | **Checkpoints** (isomorphic-git Shadow-Repo) | Git-basiertes Undo aller Task-Änderungen, kein nativer Git-Client nötig |
| 1.5 | **Advanced API Settings** | Temperature, Error Limit, Rate Limiting |
| 1.6 | **Ignore & Protected Files** | `.obsidian-agentignore` + `.obsidian-agentprotected` schützen sensible Dateien |
| 1.7 | **Operation Logging** | JSONL Audit-Trail jedes Tool-Calls für Transparenz und Debugging |

---

## Sprint 2 — Display & Context
*Ziel: Professionelle Chat-UX, Token-Management*

| # | Feature | Was es bringt |
|---|---------|---------------|
| 2.1 | **Timestamps** pro Message | Nachvollziehen wann was passiert ist |
| 2.1 | **Thinking-Blöcke collapsible** | Reasoning-Output nicht störend aufgebläht |
| 2.1 | **Diff-Stats** nach Writes | "+12 / -3 Zeilen" Feedback nach Datei-Edits |
| 2.1 | **Task-Timeline** | Visueller Überblick über Task-Verlauf |
| 2.1 | **Enter-to-Send + Cost-Threshold** | UX-Einstellungen wie Kilo Code |
| 2.2 | **Context Settings** | Max Dateien, Large-File-Guard, Current Time im Prompt |
| 2.2 | **Condensing Trigger** | Auto-Komprimierung wenn Kontext voll wird |
| 2.3 | **Support Prompts (✨)** | "Prompt verbessern", "Zusammenfassen" Quick-Actions |
| 2.4 | **Chat Autocomplete** | `/` → Workflow-Auswahl, `@` → Datei-Mention |

---

## Sprint 3 — Modes & Agent Behaviour
*Ziel: Kilo Code Feature-Parität bei Modes, Rules, Workflows, Skills*

| # | Feature | Was es bringt |
|---|---------|---------------|
| 3.1 | **Custom Modes** + Mode Editor | Eigene Agenten-Rollen definieren (z.B. "Tagebuch-Schreiber") |
| 3.1 | **5 Built-in Modes** (ask, writer, architect, researcher, orchestrator) | Spezialisierte Agenten out-of-the-box |
| 3.1 | **Tool-Filterung je Mode** | Orchestrator hat kein `write_file`, Ask-Mode kein Schreiben |
| 3.1 | **`switch_mode` Tool** | Agent wechselt Mode selbständig |
| 3.2 | **Rules** (Global + Vault, togglebar) | Dauerhafte Verhaltensregeln für alle Konversationen |
| 3.3 | **Workflows** + `/slash-commands` | Wiederverwendbare Prompt-Templates mit `/name` abrufen |
| 3.4 | **Skills** (auto-injiziert) | Spezialisierte Instruktionen automatisch bei passendem Task |

---

## Sprint 4 — Orchestrierung & Multi-Agent
*Ziel: Komplexe Aufgaben in Subtasks aufteilen und koordinieren*

| # | Feature | Was es bringt |
|---|---------|---------------|
| 4.1 | **`update_todo_list` Tool** | Agent erstellt/aktualisiert sichtbare Aufgabenliste im Chat |
| 4.1 | **Todo-Box UI** | Persistent sichtbare Checkliste während Agent arbeitet |
| 4.2 | **`new_task` Tool** | Orchestrator delegiert Subtasks an Spezialisten-Agents |
| 4.2 | **Orchestrator Mode** | Koordinierender Agent der selbst keine Dateien bearbeitet |
| 4.2 | **Multi-Agent UI** | Verschachtelte Task-Anzeige: Orchestrator → Subtasks |

---

## Sprint 5 — Web & Vault-Intelligence
*Ziel: Agent als Research-Assistent + volle Obsidian-API-Nutzung*

| # | Feature | Was es bringt |
|---|---------|---------------|
| 5.1 | **`web_fetch` Tool** | URL-Inhalt als Markdown laden (kein Chromium) |
| 5.1 | **`web_search` Tool** | Web-Suche via Brave/Tavily/DuckDuckGo API |
| 5.2 | **`generate_canvas` Tool** (P0) | Wissensgraph aus verlinkten Notizen als Obsidian Canvas generieren |
| 5.3 | **`create_base` + `update_base`** | Obsidian Bases anlegen und Filter/Spalten/Sortierung anpassen |
| 5.3 | **`query_base`** | Base ausführen und gefilterte Notizen+Properties als Agent-Kontext laden |
| 5.4 | **`get_vault_stats`** | Statistiken: Dateianzahl, Top-Tags, letzte Dateien |
| 5.4 | **`search_by_tag`** | Notizen nach Frontmatter-Tags filtern |
| 5.4 | **`get_frontmatter` + `update_frontmatter`** | YAML-Header lesen/schreiben ohne Body zu berühren |
| 5.4 | **`get_linked_notes`** | Backlinks + Outlinks einer Notiz abfragen |
| 5.4 | **`open_note`** | Datei im Editor öffnen |
| 5.4 | **`get_daily_note`** | Daily Note öffnen/erstellen (heute / ±N Tage) |

---

## Sprint 6 — Power Features & Experimental
*Ziel: Erweiterte Steuerungs- und Customization-Optionen*

| # | Feature | Was es bringt |
|---|---------|---------------|
| 6.1 | **Power Steering** | Agent erinnert sich häufiger an seine Rolle → stärkere Charakter-Adhärenz |
| 6.2 | **Concurrent File Edits** | Mehrere Dateien gleichzeitig bearbeiten |
| 6.2 | **Model-initiated Slash Commands** | Agent ruft selbst Workflows auf |
| 6.2 | **Custom Tools** (`.ts` Dateien im Plugin-Ordner) | Eigene Tools ohne Plugin-Code ändern |
| 6.3 | **Speech-to-Text** (Whisper) | Spracheingabe im Chat |

---

## Sprint 7 — Infrastruktur
*Ziel: Stabilität, Erweiterbarkeit, Polishing*

| # | Feature | Was es bringt |
|---|---------|---------------|
| 7.1 | **Context-Condensing** | Lange Gespräche komprimieren wenn Kontext voll |
| 7.2 | **MCP-Integration** + Marketplace | Externe Tool-Server (GitHub, Notion, Calendar, ...) |
| 7.3 | **Task-Persistenz** | Gespräche über Obsidian-Sessions hinweg speichern |
| 7.4 | **Notifications** | System-Benachrichtigung bei Task-Abschluss |
| 7.5 | **i18n** (Deutsch / English) | UI-Sprache wählbar |
| 7.5b | **Semantic Index** (lokal, vectra) | Vault-weite semantische Suche ohne Cloud — `semantic_search` Tool |
| 7.6 | **Export / Import / Reset** | Settings portieren, zurücksetzen |

---

## Tool-Übersicht

```
✅ Implementiert (7)     ❌ Offen (23)
─────────────────────────────────────────────────────────
read_file       ✅       edit_file           ❌  Sprint 1
write_file      ✅       append_to_file      ❌  Sprint 1
list_files      ✅       ask_followup        ❌  Sprint 1
search_files    ✅       attempt_completion  ❌  Sprint 1
create_folder   ✅       switch_mode         ❌  Sprint 3
delete_file     ✅       new_task            ❌  Sprint 4
move_file       ✅       update_todo_list    ❌  Sprint 4
                         web_fetch           ❌  Sprint 5
                         web_search          ❌  Sprint 5
                         generate_canvas     ❌  Sprint 5  ← P0
                         create_base         ❌  Sprint 5
                         update_base         ❌  Sprint 5
                         query_base          ❌  Sprint 5
                         get_vault_stats     ❌  Sprint 5
                         search_by_tag       ❌  Sprint 5
                         get_frontmatter     ❌  Sprint 5
                         update_frontmatter  ❌  Sprint 5
                         get_linked_notes    ❌  Sprint 5
                         open_note           ❌  Sprint 5
                         get_daily_note      ❌  Sprint 5
                         use_mcp_tool        ❌  Sprint 7
                         semantic_search     ❌  Sprint 7
```

**7 / 29 Tools implementiert (24%)**
