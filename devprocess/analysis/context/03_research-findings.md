# Research Findings

## Kilo Code Patterns

Übertragbar:
- Tool Registry
- Proposed Actions + Approval
- Modes
- Orchestrator + Subtasks
- Settings per Mode
- Auto-Approve Kategorien

Nicht direkt übertragbar:
- Git-Checkpoints → benötigen eigenes lokales Git-System

---

## Obsidian Plugin API

Stabil:
- Vault CRUD
- MetadataCache
- Backlinks
- Frontmatter
- Command Execution

Canvas:
- .canvas JSON Format
- Direkt erzeugbar
- Keine offizielle API
- JSON-Spec stabil genug

Bases:
- Keine stabile öffentliche API
- Automatisierung riskant

Graph:
- Kein Zugriff auf internen Graph
- Eigener Graph im Plugin möglich

---

## Checkpoint Strategy

Kilo Code nutzt Shadow Git Repo.

Obsidian Agent:
- isomorphic-git
- internes Repo in `.obsidian-agent/checkpoints`
- Commit pro Tool-Action
- Diff + Restore
- Keine externe Git-Abhängigkeit

---

## Indexing

- Local Vector DB
- Chunking
- BYO Embeddings
- Desktop-first
- Mobile später evaluieren
