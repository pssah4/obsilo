# Requirements Overview — Obsidian Agent
Scope: Production (alle Phasen A-F komplett)
Date: 2026-03-06 (aktualisiert)

## Goal
Local-only, agentic operating layer fuer Obsidian: safe, governed vault operations, multi-provider support, MCP extensibility, semantic search, persistent memory, multi-agent orchestration, and plugin auto-discovery.

## In/Out of Scope
**Implementiert:**
- Sidebar Chat & Mode System (Ask, Agent + Custom Modes)
- Multi-Provider (Anthropic, OpenAI, Ollama, Azure, OpenRouter, LM Studio, Gemini, Custom)
- MCP Client (stdio, SSE, streamable-HTTP)
- Approval-by-default fuer alle Write/Side-Effect Actions
- Local Checkpoints (isomorphic-git) mit Diff & Restore
- Vault Operations (CRUD, Folder Ops, Frontmatter, Daily Notes, Backlinks)
- Canvas Graph Projection (generate_canvas, create_excalidraw)
- Semantic Index (vectra HNSW + Hybrid Search + RRF)
- Operation Logging (JSONL Audit Trail)
- Bases Tools (create_base, update_base, query_base)
- 3-Tier Memory Architecture (Session -> Long-Term -> Soul)
- VaultDNA Plugin Discovery + Plugin API Bridge
- Agent Skill Mastery (Recipes, Episodic Memory, Auto-Promotion)
- Context Condensing & Power Steering
- Multi-Agent (new_task, depth guard, mode restriction)
- i18n (6 Sprachen: DE, EN, ES, JA, ZH-CN, HI)
- Global Storage Architecture (cross-vault Settings)
- SafeStorage (Electron Keychain fuer API-Keys)
- Onboarding-Wizard (5-Schritt Setup)
- Web Tools (web_fetch, web_search via Brave/Tavily)
- Settings/Configure Tools (update_settings, configure_model)
- Tool Repetition Detection
- Notifications (System-Notification bei Task-Abschluss)
- Chat History (ConversationStore, HistoryPanel, restore + continue)
- Autocomplete (/workflows, @files, VaultFilePicker)
- Self-Development Tools (evaluate_expression, manage_skill, manage_source)
- Sandbox OS-Level Isolation (ProcessSandboxExecutor Desktop, IframeSandboxExecutor Mobile-Fallback)
- Agent Log Viewer (read_agent_logs)
- Chat-Linking (Protocol Handler, Auto-Frontmatter-Linking, Semantic Titling, Setting)
- Document Parsing Pipeline (PPTX, XLSX, DOCX, PDF, JSON, XML, CSV)
- File Picker Erweiterung (Office-Formate)
- Task Extraction & Management (TaskExtractor, TaskNoteCreator, TaskSelectionModal)

**Out of Scope:**
- Direct manipulation of Obsidian internal Memory Graph
- Full UI automation (clicking buttons/menus beyond execute_command)
- Cloud backends or sync services (beyond LLM providers)
- Mobile support (desktop-only due to Electron/Node deps)
- ApplyDiffTool / MultiApplyDiffTool (patch-based editing)

## Feature List

### P0 (Core — alle implementiert)
| Feature Ref | Feature Name | Spec |
|---|---|---|
| CORE-01 | Agent Interaction & Modes | `FEATURE-0102-core-interaction.md` |
| CORE-02 | Context Management | `FEATURE-0303-context-management.md` |
| CORE-04 | Custom Instructions, Modes, Rules | `FEATURE-0210-custom-instructions-modes-rules.md` |
| GOV-01 | Permissions & Approval | `FEATURE-0106-permissions-approval.md` |
| GOV-02 | Local Checkpoints & Restore | `FEATURE-0107-checkpoints.md` |
| OPS-01 | Vault Operations (CRUD) | `FEATURE-0103-vault-ops.md` |
| OPS-02 | Controlled Content Editing | `FEATURE-0105-content-editing.md` |
| VIS-01 | Canvas & Bases | `FEATURE-0309-canvas-bases.md` |

### P1 (Extended — alle implementiert)
| Feature Ref | Feature Name | Spec |
|---|---|---|
| EXT-01 | MCP Support | `FEATURE-0401-mcp.md` |
| CORE-03 | Providers & Models | `FEATURE-0403-providers-models.md` |
| KNOW-01 | Semantic Index & Retrieval | `FEATURE-0301-semantic-index.md` |
| FLOW-01 | Workflows & Skills | `FEATURE-0202-workflows.md`, `FEATURE-0203-skills.md` |
| MEM-01 | Memory & Personalization | `FEATURE-0304-memory-personalization.md` |
| MULTI-01 | Multi-Agent (new_task) | `FEATURE-0305-multi-agent.md` |
| SKILL-01 | VaultDNA & Plugin Skills | `FEATURE-0204-local-skills.md` |
| MASTERY-01 | Agent Skill Mastery | `FEATURE-0407-skill-mastery.md` |
| I18N-01 | Localization | `FEATURE-0404-localization.md` |
| STORE-01 | Global Storage | `FEATURE-0310-global-storage.md` |
| SAFE-01 | Safe Storage | `FEATURE-0311-safe-storage.md` |
| SELF-01 | Self-Development & Sandbox | `FEATURE-0501-self-development.md` |
| LOG-01 | Agent Log Viewer | `FEATURE-0503-agent-tools.md` |

## Top Success Criteria
- SC-01 Users explicitly approve 100% of write operations before execution (or auto-approve per category).
- SC-02 Every tool-based modification creates a restore point that can revert the file state.
- SC-03 Agent can use external tools via MCP and internal plugins via VaultDNA.
- SC-04 Retrieval operations find relevant context via hybrid search (semantic + keyword + RRF).
- SC-05 Users can seamlessly switch between providers and configure models per mode.
- SC-06 Memory persists across sessions (user profile, projects, patterns, soul).
- SC-07 Agent can delegate subtasks to child agents (multi-agent orchestration).

## NFR Summary
- **Performance:** Single file write + checkpoint < 2 seconds (perceived). Semantic indexing non-blocking.
- **Availability:** Local-first; zero dependency on external APIs (unless user configures them).
- **Security:** API keys encrypted via OS keychain. No data leaves local machine unless user explicitly configures remote provider/MCP.
- **Scalability:** Indexing supports vaults up to 10k markdown files. Incremental builds with resume support.
- **Internationalization:** Full UI in 6 languages with lazy-load architecture.

## Implementierte Epics

### EPIC-006: Files-to-Chat (Office-Format-Support) — Teilweise implementiert
| Feature Ref | Feature Name | Priority | Spec | Status |
|---|---|---|---|---|
| FEATURE-0601 | Document Parsing Pipeline | P0 | `FEATURE-0601-document-parsing-pipeline.md` | Implementiert |
| FEATURE-0602 | File Picker Erweiterung | P0 | `FEATURE-0602-file-picker-extension.md` | Implementiert |
| FEATURE-0603 | Token-Budget-Management | P1 | `FEATURE-0603-token-budget-management.md` | Geplant |
| FEATURE-0604 | On-Demand Bild-Extraktion | P1 | `FEATURE-0604-on-demand-image-extraction.md` | Geplant |
| FEATURE-0605 | Modell-Kompatibilitäts-Check | P1 | `FEATURE-0605-model-compatibility-check.md` | Geplant |

### EPIC-007: Chat-Linking (Provenienz & Nachvollziehbarkeit) — Vollständig implementiert
| Feature Ref | Feature Name | Priority | Spec | Status |
|---|---|---|---|---|
| FEATURE-0702 | Protocol Handler (Deep-Links) | P0 | `FEATURE-0702-protocol-handler.md` | Implementiert |
| FEATURE-0703 | Auto-Frontmatter-Linking | P0 | `FEATURE-0703-auto-frontmatter-linking.md` | Implementiert |
| FEATURE-0704 | Semantisches Chat-Titling | P1 | `FEATURE-0704-semantic-chat-titling.md` | Implementiert |
| FEATURE-0705 | Chat-Linking Setting | P2 | `FEATURE-0705-chat-linking-setting.md` | Implementiert |

### EPIC-008: Task Extraction & Management — Implementiert
| Feature Ref | Feature Name | Priority | Spec | Status |
|---|---|---|---|---|
| FEATURE-0801 | Task Extraction & Management | P1 | `FEATURE-0801-task-extraction.md` | Implementiert |

## ASR Summary
- ASR-01: isomorphic-git Checkpoints (ADR-002) — Implemented
- ASR-02: Central Tool Execution Pipeline (ADR-001) — Implemented
- ASR-mcp-01: MCP Client Integration — Implemented
- ASR-03: vectra Semantic Index (ADR-003) — Implemented
- ASR-04: 3-Tier Memory (ADR-013) — Implemented
- ASR-05: Global Storage (ADR-020) — Implemented
- ASR-06: Pipeline Post-Write Hook für Chat-Linking (ADR-022) — Implemented

## Resolved Decisions
1. Vector storage: vectra (HNSW, TypeScript-native) — ADR-003
2. PDF handling: pdfjs-dist + pdf-parse for content extraction
3. Command whitelist: execute_command via Obsidian command palette, Plugin API via allowlist
4. API key encryption: Electron safeStorage (ADR-019)
5. Cross-vault settings: GlobalFileService at ~/.obsidian-agent/ (ADR-020)
