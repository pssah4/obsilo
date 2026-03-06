# Glossar (Kurzreferenz)

> Detailliertes Glossar mit Abgrenzungen: `_devprocess/architecture/GLOSSAR-begriffe.md`

| Begriff | Definition |
|---------|-----------|
| Mode | Agent Persona mit eigenem System Prompt und Tool-Set |
| Tool | Kontrollierte Aktion (Built-in, Custom, Plugin, MCP) |
| Workflow | Multi-Step Prompt Kette (Slash-Command) |
| Skill | Markdown-Anleitung fuer bestimmte Aufgabentypen (User Skills, Plugin Skills) |
| Checkpoint | Git Snapshot (isomorphic-git Shadow-Repo) |
| Vault Ops | Datei/Struktur Manipulation (CRUD, Frontmatter, Links) |
| Semantic Graph | Implizite Beziehungen (vectra HNSW + Hybrid Search) |
| Sandbox | Isolierte Laufzeit fuer Agent-Code (ProcessSandboxExecutor / IframeSandboxExecutor) |
| Task | Extrahierte Aufgabe aus Agent-Antwort (TaskExtractor, Task-Note) |
| Context Condensing | LLM-basierte Komprimierung der Konversationshistorie |
| Power Steering | Periodische Mode-Reminder-Injektion |
| Chat-Linking | Automatische Verknuepfung von Notes mit Quell-Chats (Frontmatter + Deep-Link) |
