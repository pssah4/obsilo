# Obsidian Agent – Konsolidierte Deep Research Ergebnisse

## Ziel dieses Dokuments

Dieses Dokument konsolidiert die Ergebnisse aus zwei Deep-Research-Analysen:

1. Analyse von KiloCode (Architektur, Tool-System, Orchestrator, Checkpoints)
2. Analyse der Obsidian Plugin API und aller Core-Plugins hinsichtlich Machbarkeit eines agentischen Vault-Operators

Ziel ist die technische und strategische Bewertung der Umsetzbarkeit von Obsidian Agent.

---

# 1. Analyse: KiloCode Architektur

## 1.1 Zentrale Architekturprinzipien

KiloCode basiert auf folgenden Kernmustern:

- Tool Registry
- Proposed Actions mit Approval
- Modes (Agent Personas)
- Orchestrator mit Subtasks
- Checkpoints (Shadow Git Repository)
- Auto-Approve Kategorien
- Mentions-basierte Kontextaggregation
- Indexing + Retrieval
- Konfigurierbare Model Provider

Diese Prinzipien sind konzeptionell vollständig auf Obsidian Agent übertragbar.

---

## 1.2 Tool-Use Pattern

KiloCode unterscheidet klar zwischen:

- Read Tools
- Write Tools
- System Tools (Terminal, Git etc.)
- Search Tools
- Browser Tool

Übertragbarkeit:

Terminal Tools werden zu Vault Operations Tools.
Git wird intern ersetzt (siehe Checkpoints).

---

## 1.3 Orchestrator

KiloCode implementiert:

- Parent Task
- Child Tasks
- Isolation
- Summary-Merge

Übertragbarkeit:

Dieses Pattern ist vollständig übertragbar auf Wissensarbeit:
- Research Subtasks
- Analyse Subtasks
- Strukturierungs Subtasks

---

## 1.4 Checkpoints in KiloCode

KiloCode verwendet ein Shadow Git Repository.

Merkmale:
- Commit pro Action
- Diff & Restore
- Snapshot Isolation

Obsidian Agent Entscheidung:
→ isomorphic-git
→ internes Repo in `.obsidian-agent/checkpoints`
→ kein externes Git erforderlich

---

# 2. Analyse: Obsidian Plugin API

## 2.1 Stabil offiziell möglich

### Vault API
- create file
- modify file
- delete file
- rename file
- create folder
- read file

### MetadataCache
- Backlinks
- Outlinks
- Tags
- Resolved links
- Unresolved links

### Frontmatter Manipulation
- YAML via Read-Transform-Write Pattern

### Commands
- app.commands.executeCommandById()

---

## 2.2 Canvas (Core Plugin)

Canvas speichert Daten als `.canvas` JSON.

Struktur:
- nodes
- edges

Ergebnisse:

- Canvas-Datei programmatisch erzeugbar
- Nodes aus Notes generierbar
- Edges generierbar
- Auto-Layout nur über eigene Logik
- Keine offizielle Canvas API

Bewertung:
Technisch stabil umsetzbar.
Empfohlen als Graph-Projektions-Mechanismus.

---

## 2.3 Bases

Erkenntnisse:

- Keine offizielle stabile API
- Speicherung nicht öffentlich dokumentiert
- Command Execution möglich
- Filter-Automatisierung unsicher

Bewertung:
V2 Feature.
Erhöhtes Risiko.
Nicht architekturell kritisch für MVP.

---

## 2.4 Knowledge Graph

Nicht möglich:
- Zugriff auf internen Graph-View
- Manipulation des Memory Graphs

Möglich:
- Eigene Graph-Repräsentation auf Basis von:
  - Backlinks
  - Outlinks
  - Tags
  - Semantischer Ähnlichkeit

Empfehlung:
Hybrid Graph im Plugin implementieren.

---

## 2.5 Core Plugins – Steuerbarkeit

Core Plugins untersucht:

- Canvas
- Bases
- Graph
- Backlinks
- Templates
- Daily Notes
- Outline
- Search
- Tags
- File Explorer
- Command Palette
- Workspaces
- Bookmarks
- Quick Switcher

Bewertung:

Stabil steuerbar:
- Templates (über Commands)
- Daily Notes
- Command Palette
- File CRUD

Teilweise steuerbar:
- Canvas (JSON direkt)
- Bases (Command-basiert)

Nicht steuerbar:
- Interner Graph

---

# 3. Sandbox & Runtime

## Desktop

- Electron Runtime
- Node APIs verfügbar
- Lokale Datenbanken möglich
- isomorphic-git möglich

## Mobile

- Einschränkungen bei Node APIs
- Performance-Limit
- Git/DB Nutzung unsicher

Strategie:
Desktop-first MVP.

---

# 4. Indexing & Retrieval

## 4.1 Semantic Index

Geplante Architektur:

- Chunking
- Local Vector DB
- BYO Embeddings
- Provider konfigurierbar
- Desktop-only

## 4.2 Hybrid Search

Explizit:
- Backlinks
- Link traversal

Implizit:
- Embedding similarity

---

# 5. Vault Operations Layer

Erweiterung über reine Textbearbeitung hinaus:

Möglich:
- Folder Operations
- File Operations
- Template Anwendung
- Command Execution
- Canvas Generierung
- Dashboard Erstellung

Nicht möglich:
- Interne Core Plugin Manipulation
- UI Automation außerhalb Commands

---

# 6. Checkpoint System (Obsidian Agent)

Entscheidung:

isomorphic-git

Struktur:
`.obsidian-agent/checkpoints`

Pro Tool-Action:
- Identify changed files
- Stage
- Commit with metadata

Restore:
- Diff Preview
- File-level restore

Keine Cloud.
Kein externes Git erforderlich.

---

# 7. Sicherheitsmodell

- Approval by default
- Auto-Approve optional
- Snapshot before write
- Operation Log
- Ignore File
- Dry Run Option

---

# 8. Machbarkeitsbewertung

Technisch realistisch:

- Agentische Wissensbearbeitung
- Vault Operator
- Canvas Generierung
- Semantic Index
- Workflow Engine
- Checkpoint System

Risiko-Bereiche:

- Bases Automatisierung
- Mobile Unterstützung
- Performance bei großen Vaults

---

# 9. Strategische Bewertung

Obsidian Agent ist:

- Keine einfache AI-Integration
- Sondern eine agentische Betriebsschicht

Es kombiniert:

- KiloCode Tool-Use
- Wissensmanagement
- Strukturautomatisierung
- Semantische Analyse
- Lokale Governance

Komplexität: Hoch
Machbarkeit: Hoch
Architektur-Relevanz: Kritisch
Differenzierungspotential: Sehr hoch
