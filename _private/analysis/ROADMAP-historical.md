# Obsidian Agent — Roadmap

> Details: [BACKLOG.md](BACKLOG.md)
> Status: ✅ fertig · 🔄 teilweise · ⬜ offen

---

## Sprint 1 — Kritische Blocker ✅

| # | Feature | Status |
|---|---------|--------|
| 1.1 | `edit_file` Tool (diff-basiert) | ✅ |
| 1.1 | `append_to_file` Tool | ✅ |
| 1.2 | `ask_followup_question` Tool | ✅ |
| 1.2 | `attempt_completion` Tool | ✅ |
| 1.2 | `switch_mode` Tool | ✅ |
| 1.2 | UI: Question-Card, Approval-Card, Todo-Box | ✅ |
| 1.3 | Auto-Approve System (Pipeline + Settings) | ✅ |
| 1.4 | Checkpoints (isomorphic-git Shadow-Repo) | ✅ |
| 1.4 | Undo-Bar im Chat | ✅ |
| 1.5 | Temperature, consecutiveMistakeLimit, rateLimitMs | ✅ |
| 1.6 | Ignore & Protected Files | ✅ |
| 1.7 | Operation Logging (JSONL Audit Trail) | ✅ |
| 1.7 | Log-Viewer in Settings | ⬜ |

---

## Sprint 2 — Display & Context 🔄

| # | Feature | Status |
|---|---------|--------|
| 2.1 | Timestamps pro Message | ✅ |
| 2.1 | Thinking-Blöcke collapsible | ✅ |
| 2.1 | Tool I/O expandierbar (auto-expand/collapse) | ✅ |
| 2.1 | Token-Usage im Footer | ✅ |
| 2.1 | Enter-to-Send Setting | ✅ |
| 2.1 | Diff-Stats Badge nach Write-Ops | ⬜ |
| 2.2 | Current Time im System Prompt (Systemuhr, ISO+TZ) | ✅ |
| 2.2 | Large-File-Guard in ReadFileTool | ✅ |
| 2.2 | Max concurrent file reads / Parallel Execution | ⬜ → #9 |
| 2.2 | Context-Condensing Trigger | ⬜ → Sprint 7 |
| 2.3 | Support Prompts (✨ Quick Actions) | ⬜ |
| 2.4 | Chat Autocomplete (`/` Workflows, `@` Dateien) | ⬜ → Sprint 3.3 |

---

## Sprint 3 — Modes & Agent Behaviour 🔄

| # | Feature | Status |
|---|---------|--------|
| 3.1 | 5 Built-in Modes (ask, writer, architect, librarian, orchestrator) | ✅ |
| 3.1 | Custom Modes + Mode Editor (CRUD, Export/Import) | ✅ |
| 3.1 | Tool-Filterung je Mode | ✅ |
| 3.1 | Per-Mode API-Config (eigenes Modell je Mode) | ✅ |
| 3.1 | Mode-Export/Import JSON | ⬜ |
| 3.2 | Rules (Global + Vault, togglebar, `RulesLoader`) | ⬜ |
| 3.3 | Workflows + `/slash-commands` (`WorkflowLoader`) | ⬜ |
| 3.4 | Skills (auto-injiziert, `SkillsManager`) | ⬜ |

---

## Sprint 4 — Orchestrierung & Multi-Agent 🔄

| # | Feature | Status |
|---|---------|--------|
| 4.1 | `update_todo_list` Tool + Todo-Box UI | ✅ |
| 4.2 | `new_task` Tool (Orchestrator delegiert an Subtask) | ⬜ |
| 4.2 | Multi-Agent UI (verschachtelte Task-Anzeige) | ⬜ |

---

## Sprint 5 — Web & Vault-Intelligence 🔄

| # | Feature | Status |
|---|---------|--------|
| 5.1 | `web_fetch` Tool | ✅ |
| 5.1 | `web_search` Tool (Brave/Tavily) | ✅ |
| 5.2 | `generate_canvas` Tool (P0 — Wissensgraph) | ⬜ |
| 5.3 | `create_base` + `update_base` + `query_base` Tools | ⬜ |
| 5.4 | `get_vault_stats` | ✅ |
| 5.4 | `search_by_tag` | ✅ |
| 5.4 | `get_frontmatter` + `update_frontmatter` | ✅ |
| 5.4 | `get_linked_notes` | ✅ |
| 5.4 | `open_note` | ✅ |
| 5.4 | `get_daily_note` | ✅ |

---

## Sprint 6 — Power Features & Experimental ⬜

| # | Feature | Status |
|---|---------|--------|
| 6.1 | Power Steering (Mode-Reminder alle N Iterationen) | ⬜ |
| 6.2 | Concurrent File Edits | ⬜ |
| 6.2 | Custom Tools (`.ts` im Plugin-Ordner) | ⬜ |

---

## Sprint 7 — Infrastruktur ⬜

| # | Feature | Status |
|---|---------|--------|
| 7.1 | Context-Condensing (Token-Schätzer + LLM-Komprimierung) | ⬜ |
| 7.2 | MCP-Integration + `use_mcp_tool` | ⬜ |
| 7.3 | Task-Persistenz (History über Sessions) | ⬜ |
| 7.4 | System-Notifications bei Task-Abschluss | ⬜ |
| 7.5b | Semantic Index (`vectra`) + `semantic_search` Tool | ⬜ |
| 7.6 | Export / Import / Reset Settings | ⬜ |

---

## Querschnitts-Tasks ⬜

| # | Feature | Priorität |
|---|---------|-----------|
| #9 | **Parallel Tool Execution** (Read-Tools via `Promise.all`) | Hoch — direkt spürbare Beschleunigung |
| — | Log-Viewer in Settings (About-Tab) | Niedrig |

---

## Tool-Übersicht

```
✅ Implementiert (22)          ⬜ Offen (7)
─────────────────────────────────────────────────────
read_file          ✅          new_task           ⬜  Sprint 4
write_file         ✅          use_mcp_tool       ⬜  Sprint 7
list_files         ✅          semantic_search    ⬜  Sprint 7
search_files       ✅          generate_canvas    ⬜  Sprint 5  ← P0
create_folder      ✅          create_base        ⬜  Sprint 5
delete_file        ✅          update_base        ⬜  Sprint 5
move_file          ✅          query_base         ⬜  Sprint 5
edit_file          ✅
append_to_file     ✅
get_vault_stats    ✅
get_frontmatter    ✅
update_frontmatter ✅
search_by_tag      ✅
get_linked_notes   ✅
open_note          ✅
get_daily_note     ✅
web_fetch          ✅
web_search         ✅
ask_followup_question ✅
attempt_completion ✅
update_todo_list   ✅
switch_mode        ✅
```

**22 / 29 Tools implementiert (76%)**

---

## Nächste Schritte (priorisiert)

1. **#9 Parallel Tool Execution** — `Promise.all()` für Read-Tools in `AgentTask.ts` → direkt spürbar
2. **3.2 Rules** — `RulesLoader` + Settings UI → dauerhaftes Agenten-Verhalten steuerbar
3. **3.3 Workflows** — `WorkflowLoader` + `/slash-commands` → Wiederverwendbare Prompts
4. **5.2 generate_canvas** (P0) — Wissensgraph aus Vault-Links generieren
5. **7.5b Semantic Index** — `vectra` + `semantic_search` → semantische Vault-Suche
