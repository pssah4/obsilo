# Architectural Decisions

Vollstaendige Liste aller ADRs. Details in `_devprocess/architecture/ADR-NNN-*.md`.

## Core Architecture

| ADR | Titel | Status |
|-----|-------|--------|
| ADR-001 | Central Tool Execution Pipeline | Akzeptiert |
| ADR-002 | isomorphic-git Checkpoints | Akzeptiert |
| ADR-003 | vectra Semantic Index | Akzeptiert |
| ADR-004 | Mode-basierte Tool-Filterung via Tool-Gruppen | Akzeptiert |
| ADR-005 | Fail-Closed Approval | Akzeptiert |
| ADR-006 | Sliding Window Repetition Detection | Akzeptiert |
| ADR-007 | Event Separation (Callbacks) | Akzeptiert |
| ADR-008 | Modular Prompt Sections | Akzeptiert |
| ADR-009 | Local Skills (Markdown-based) | Akzeptiert |
| ADR-010 | Permissions Audit Trail | Akzeptiert |
| ADR-011 | Multi-Provider API (Adapter Pattern) | Akzeptiert |
| ADR-012 | Context Condensing (Keep-First-Last, Smart Tail, Emergency Auto-Retry) | Akzeptiert |
| ADR-013 | 3-Tier Memory Architecture | Akzeptiert |
| ADR-014 | VaultDNA Plugin Discovery | Akzeptiert |
| ADR-015 | Hybrid Search (Semantic + BM25 + RRF) | Akzeptiert |
| ADR-016 | Rich Tool Descriptions | Akzeptiert |
| ADR-017 | Procedural Recipes | Akzeptiert |
| ADR-018 | Episodic Task Memory | Akzeptiert |
| ADR-019 | Electron SafeStorage (OS Keychain) | Akzeptiert |
| ADR-020 | Global Storage (~/.obsidian-agent/) | Akzeptiert |

## Extended Features

| ADR | Titel | Status |
|-----|-------|--------|
| ADR-021 | Sandbox OS-Level Process Isolation | Akzeptiert, implementiert |
| ADR-022 | Chat-Linking (Pipeline Post-Write Hook) | Akzeptiert, implementiert |
| ADR-023 | Document Parser als wiederverwendbare Tools | Akzeptiert, implementiert |
| ADR-024 | Leichtgewicht-Parsing (JSZip + Custom OOXML) | Akzeptiert, implementiert |
| ADR-025 | On-Demand Bild-Nachlade (Lazy Extraction) | Akzeptiert, geplant |
| ADR-026 | Post-Processing Hook fuer Task Extraction | Akzeptiert, implementiert |
| ADR-027 | Task-Note Frontmatter Schema | Akzeptiert, implementiert |
| ADR-028 | Base Plugin Integration (Task-Uebersicht) | Akzeptiert, teilweise implementiert |
