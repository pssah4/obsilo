# Obsidian Agent — Backlog

> Status: `[x]` fertig · `[~]` in Arbeit · `[ ]` offen · `[-]` zurückgestellt
> Letzte Aktualisierung: 2026-02-25 (Agent Skill Mastery komplett)

---

## Alle Features

### Core: Agent Loop
| Status | Feature | Datei |
|--------|---------|-------|
| `[x]` | AgentTask Loop (MAX_ITERATIONS, consecutive mistake limit, rate limit) | `src/core/AgentTask.ts` |
| `[x]` | Parallel Tool Execution (PARALLEL_SAFE set, Promise.all für Read-Tools) | `src/core/AgentTask.ts` |
| `[x]` | Context Condensing (Token-Schätzung, keeps first + last 4 messages) | `src/core/AgentTask.ts` |
| `[x]` | Power Steering (Periodik mode reminder injection) | `src/core/AgentTask.ts` |
| `[x]` | Tool Repetition Detection (sliding window 10, max 3 occurrences) | `src/core/tool-execution/ToolRepetitionDetector.ts` |

### Core: Tool Execution
| Status | Feature | Datei |
|--------|---------|-------|
| `[x]` | ToolExecutionPipeline (6-step governance: validate→approval→checkpoint→execute→log) | `src/core/tool-execution/ToolExecutionPipeline.ts` |
| `[x]` | IgnoreService (.obsidian-agentignore, protected files) | `src/core/governance/IgnoreService.ts` |
| `[x]` | OperationLogger (JSONL audit trail) | `src/core/governance/OperationLogger.ts` |
| `[x]` | GitCheckpointService (isomorphic-git shadow repo, undo) | `src/core/checkpoints/GitCheckpointService.ts` |

### Core: Modes & Prompts
| Status | Feature | Datei |
|--------|---------|-------|
| `[x]` | Built-in Modes (ask, agent) | `src/core/modes/builtinModes.ts` |
| `[x]` | Custom Modes (CRUD, per-mode model override, MCP whitelist) | `src/core/modes/ModeService.ts` |
| `[x]` | System Prompt Builder (modular sections architecture) | `src/core/systemPrompt.ts`, `src/core/prompts/sections/` |
| `[x]` | Objective Section (task decomposition strategy) | `src/core/prompts/sections/objective.ts` |
| `[x]` | Capabilities Section (high-level agent abilities) | `src/core/prompts/sections/capabilities.ts` |
| `[x]` | Tool Metadata Registry (single source of truth for prompt + UI) | `src/core/tools/toolMetadata.ts` |
| `[x]` | Rules (vault + global, RulesLoader) | `src/core/context/RulesLoader.ts` |
| `[x]` | Skills (auto-inject per mode, SkillsManager) | `src/core/context/SkillsManager.ts` |
| `[x]` | Workflows / Slash-Commands (WorkflowLoader) | `src/core/context/WorkflowLoader.ts` |
| `[x]` | Support Prompts (custom quick-action prompts) | `src/core/context/SupportPrompts.ts` |

### Core: Providers & API
| Status | Feature | Datei |
|--------|---------|-------|
| `[x]` | Anthropic provider | `src/api/providers/anthropic.ts` |
| `[x]` | OpenAI-compatible provider | `src/api/providers/openai.ts` |
| `[x]` | Custom models + per-model temperature | `src/types/settings.ts` |

### Core: MCP
| Status | Feature | Datei |
|--------|---------|-------|
| `[x]` | McpClient (stdio transport, command validation, timeout) | `src/core/mcp/McpClient.ts` |
| `[x]` | use_mcp_tool (LLM-callable wrapper) | `src/core/tools/mcp/UseMcpToolTool.ts` |

### Core: Memory & Chat History
| Status | Feature | Datei |
|--------|---------|-------|
| `[x]` | ConversationStore (index.json + per-conversation JSON, in-memory index) | `src/core/history/ConversationStore.ts` |
| `[x]` | HistoryPanel (sliding overlay, date grouping, search, restore) | `src/ui/sidebar/HistoryPanel.ts` |
| `[x]` | MemoryService (read/write memory files, buildMemoryContext for system prompt) | `src/core/memory/MemoryService.ts` |
| `[x]` | ExtractionQueue (persistent FIFO, survives restarts, background processing) | `src/core/memory/ExtractionQueue.ts` |
| `[x]` | SessionExtractor (LLM-based session summary via memoryModelKey) | `src/core/memory/SessionExtractor.ts` |
| `[x]` | LongTermExtractor (promote facts from sessions to long-term files) | `src/core/memory/LongTermExtractor.ts` |
| `[x]` | OnboardingService (step-based conversational setup, 5-step flow) | `src/core/memory/OnboardingService.ts` |
| `[x]` | MemoryRetriever (cross-session context via semantic search) | `src/core/memory/MemoryRetriever.ts` |
| `[x]` | Event Separation (hasStreamedText flag, completion result as fallback only) | `src/core/AgentTask.ts` |

### Core: Semantic Index
| Status | Feature | Datei |
|--------|---------|-------|
| `[x]` | SemanticIndexService (vectra HNSW, Xenova embeddings, heading-aware chunking) | `src/core/semantic/SemanticIndexService.ts` |
| `[x]` | Hybrid search (semantic + TF-IDF keyword with stemming + RRF fusion) | `src/core/semantic/SemanticIndexService.ts` |
| `[x]` | HyDE support (hypothetical document expansion) | `src/core/semantic/SemanticIndexService.ts` |
| `[x]` | Graph augmentation (1-hop wikilink expansion) | `src/core/semantic/SemanticIndexService.ts` |
| `[x]` | Incremental builds (mtime checkpoint, resumable) | `src/core/semantic/SemanticIndexService.ts` |

### Tools: Vault Read
| Status | Tool | Datei |
|--------|------|-------|
| `[x]` | read_file | `src/core/tools/vault/ReadFileTool.ts` |
| `[x]` | list_files | `src/core/tools/vault/ListFilesTool.ts` |
| `[x]` | search_files | `src/core/tools/vault/SearchFilesTool.ts` |

### Tools: Vault Intelligence
| Status | Tool | Datei |
|--------|------|-------|
| `[x]` | get_vault_stats | `src/core/tools/vault/GetVaultStatsTool.ts` |
| `[x]` | get_frontmatter | `src/core/tools/vault/GetFrontmatterTool.ts` |
| `[x]` | update_frontmatter | `src/core/tools/vault/UpdateFrontmatterTool.ts` |
| `[x]` | search_by_tag | `src/core/tools/vault/SearchByTagTool.ts` |
| `[x]` | get_linked_notes | `src/core/tools/vault/GetLinkedNotesTool.ts` |
| `[x]` | open_note | `src/core/tools/vault/OpenNoteTool.ts` |
| `[x]` | get_daily_note | `src/core/tools/vault/GetDailyNoteTool.ts` |
| `[x]` | semantic_search | `src/core/tools/vault/SemanticSearchTool.ts` |
| `[x]` | query_base | `src/core/tools/vault/QueryBaseTool.ts` |

### Tools: Vault Edit
| Status | Tool | Datei |
|--------|------|-------|
| `[x]` | write_file | `src/core/tools/vault/WriteFileTool.ts` |
| `[x]` | edit_file | `src/core/tools/vault/EditFileTool.ts` |
| `[x]` | append_to_file | `src/core/tools/vault/AppendToFileTool.ts` |
| `[x]` | create_folder | `src/core/tools/vault/CreateFolderTool.ts` |
| `[x]` | delete_file | `src/core/tools/vault/DeleteFileTool.ts` |
| `[x]` | move_file | `src/core/tools/vault/MoveFileTool.ts` |
| `[x]` | generate_canvas | `src/core/tools/vault/GenerateCanvasTool.ts` |
| `[x]` | create_excalidraw | `src/core/tools/vault/CreateExcalidrawTool.ts` |
| `[x]` | create_base | `src/core/tools/vault/CreateBaseTool.ts` |
| `[x]` | update_base | `src/core/tools/vault/UpdateBaseTool.ts` |

### Tools: Web
| Status | Tool | Datei |
|--------|------|-------|
| `[x]` | web_fetch | `src/core/tools/web/WebFetchTool.ts` |
| `[x]` | web_search (Brave / Tavily) | `src/core/tools/web/WebSearchTool.ts` |

### Tools: Agent
| Status | Tool | Datei |
|--------|------|-------|
| `[x]` | ask_followup_question | `src/core/tools/agent/AskFollowupQuestionTool.ts` |
| `[x]` | attempt_completion | `src/core/tools/agent/AttemptCompletionTool.ts` |
| `[x]` | switch_mode | `src/core/tools/agent/SwitchModeTool.ts` |
| `[x]` | update_todo_list | `src/core/tools/agent/UpdateTodoListTool.ts` |
| `[x]` | new_task (multi-agent subtask delegation) | `src/core/tools/agent/NewTaskTool.ts` |
| `[x]` | call_plugin_api (Plugin API Bridge) | `src/core/tools/agent/CallPluginApiTool.ts` |
| `[x]` | execute_recipe (Recipe Shell) | `src/core/tools/agent/ExecuteRecipeTool.ts` |
| `[x]` | update_settings (set + apply_preset) | `src/core/tools/agent/UpdateSettingsTool.ts` |
| `[x]` | configure_model (add + select + test) | `src/core/tools/agent/ConfigureModelTool.ts` |

### Tools: MCP
| Status | Tool | Datei |
|--------|------|-------|
| `[x]` | use_mcp_tool | `src/core/tools/mcp/UseMcpToolTool.ts` |

### UI
| Status | Feature | Datei |
|--------|---------|-------|
| `[x]` | AgentSidebarView (Chat-UI, Mode-Selector, Input) | `src/ui/AgentSidebarView.ts` |
| `[x]` | Approval Cards (inline Allow / Enable Always / Deny) | `src/ui/AgentSidebarView.ts` |
| `[x]` | ApproveEditModal (Diff-View mit line-by-line Kontext vor Edit-Approval) | `src/ui/ApproveEditModal.ts` |
| `[x]` | Todo-Box (live update, auto-complete on attempt_completion) | `src/ui/AgentSidebarView.ts` |
| `[x]` | Undo-Bar (nach Write-Ops) | `src/ui/AgentSidebarView.ts` |
| `[x]` | Thinking-Blöcke (collapsible, Spinner während Reasoning) | `src/ui/AgentSidebarView.ts` |
| `[x]` | Tool I/O Cards (expandierbar, auto-expand/collapse) | `src/ui/AgentSidebarView.ts` |
| `[x]` | Token-Usage Footer (input/output, akkumuliert) | `src/ui/AgentSidebarView.ts` |
| `[x]` | Diff-Stats Badge (+N / -N) | `src/ui/AgentSidebarView.ts` |
| `[x]` | Chat Autocomplete (/ Workflows, @ Dateien, VaultFilePicker) | `src/ui/sidebar/AutocompleteHandler.ts` |
| `[x]` | VaultFilePicker (Live-Suche, Multi-Select via @) | `src/ui/sidebar/VaultFilePicker.ts` |
| `[x]` | ToolPickerPopover (Session-Overrides für Tools / Skills / Workflows) | `src/ui/sidebar/ToolPickerPopover.ts` |
| `[x]` | AttachmentHandler (Datei-Anhänge als Kontext in der Chat-Eingabe) | `src/ui/sidebar/AttachmentHandler.ts` |
| `[x]` | Chat History (ConversationStore, HistoryPanel, restore + continue) | `src/core/history/ConversationStore.ts`, `src/ui/sidebar/HistoryPanel.ts` |
| `[x]` | Notifications (System-Notification bei Task-Abschluss) | `src/main.ts` |
| `[x]` | Log-Viewer in Settings | `src/ui/settings/LogTab.ts` |

### Settings UI
| Status | Feature | Datei |
|--------|---------|-------|
| `[x]` | Models Tab (Provider, API-Key, Custom Models, per-model Temperatur) | `src/ui/settings/ModelsTab.ts` |
| `[x]` | Code Import (Paste API-Snippet, auto-extract Provider/URL/Models) | `src/ui/settings/CodeImportModal.ts`, `src/core/config/CodeConfigParser.ts` |
| `[x]` | Modes Tab (CRUD Custom Modes, per-mode Model + MCP-Whitelist) | `src/ui/settings/ModesTab.ts` |
| `[x]` | Prompts Tab (Custom Prompt Templates mit `{{userInput}}` / `{{activeFile}}`) | `src/ui/settings/PromptsTab.ts` |
| `[x]` | Rules Tab | `src/ui/settings/RulesTab.ts` |
| `[x]` | Skills Tab | `src/ui/settings/SkillsTab.ts` |
| `[x]` | Workflows Tab | `src/ui/settings/WorkflowsTab.ts` |
| `[x]` | Web Search Tab (Brave / Tavily API-Key) | `src/ui/settings/WebSearchTab.ts` |
| `[x]` | MCP Tab (Server-Config, stdio commands) | `src/ui/settings/McpTab.ts` |
| `[x]` | Permissions Tab (Auto-Approve per Tool-Kategorie) | `src/ui/settings/PermissionsTab.ts` |
| `[x]` | Loop Tab (Error-Limit, Rate-Limit, Context Condensing, Power Steering, Max Sub-Agent Depth) | `src/ui/settings/LoopTab.ts` |
| `[x]` | Shell Tab (Plugin API Allowlist, Recipe Toggles) | `src/ui/settings/ShellTab.ts` |
| `[x]` | Interface Tab (Auto-add active note, Welcome-Message) | `src/ui/settings/InterfaceTab.ts` |
| `[x]` | Embeddings Tab (Semantic Index Konfiguration) | `src/ui/settings/EmbeddingsTab.ts` |
| `[x]` | Vault Tab (Vault-Pfade) | `src/ui/settings/VaultTab.ts` |
| `[x]` | Memory Tab (Memory-Toggles, Model, Threshold, Reset) | `src/ui/settings/MemoryTab.ts` |
| `[x]` | Backup Tab (Export / Import Settings als JSON) | `src/ui/settings/BackupTab.ts` |
| `[x]` | Debug Tab (Debug Mode Toggle) | `src/ui/settings/DebugTab.ts` |
| `[x]` | Log Tab (JSONL Audit-Log-Viewer) | `src/ui/settings/LogTab.ts` |
| `[x]` | Language Tab (Sprachauswahl-Dropdown, 6 Sprachen) | `src/ui/settings/LanguageTab.ts` |

### Localization (i18n)
| Status | Feature | Datei |
|--------|---------|-------|
| `[x]` | i18n-Infrastruktur (t(), setLanguage(), initI18n(), lazy-load) | `src/i18n/index.ts`, `src/i18n/types.ts` |
| `[x]` | English Locale (937 Keys, vollstaendig) | `src/i18n/locales/en.ts` |
| `[x]` | Deutsch Locale (937 Keys, vollstaendig) | `src/i18n/locales/de.ts` |
| `[x]` | Espanol Locale (937 Keys, vollstaendig) | `src/i18n/locales/es.ts` |
| `[x]` | Japanese Locale (937 Keys, vollstaendig) | `src/i18n/locales/ja.ts` |
| `[x]` | Simplified Chinese Locale (937 Keys, vollstaendig) | `src/i18n/locales/zh-CN.ts` |
| `[x]` | Hindi Locale (teilweise, EN-Fallback) | `src/i18n/locales/hi.ts` |
| `[x]` | Settings-Tabs Migration (17 Tabs + constants.ts) | alle Settings-Tab-Dateien |
| `[x]` | Chat-UI & Modals Migration | `AgentSidebarView.ts`, alle Modals |

### Agent Skill Mastery
| Status | Feature | Datei |
|--------|---------|-------|
| `[x]` | Rich Tool Descriptions (example, whenToUse, commonMistakes) | `src/core/tools/toolMetadata.ts` |
| `[x]` | Procedural Recipes (static + learned, keyword + semantic matching) | `src/core/mastery/` |
| `[x]` | Recipe Prompt Section (injection between skills and rules) | `RecipeMatchingService.buildPromptSection()` |
| `[x]` | Episodic Task Memory (recording, Vectra indexing) | `src/core/mastery/EpisodicExtractor.ts` |
| `[x]` | Recipe Promotion (auto-promote 3+ success patterns) | `src/core/mastery/RecipePromotionService.ts` |
| `[x]` | Mastery Settings (toggle, budget, recipe toggles) | `src/types/settings.ts` |

### Agentic Loop Refactoring (completed)
| Status | Feature | Datei |
|--------|---------|-------|
| `[x]` | ReadFile Content Truncation (20K chars max) | `src/core/tools/vault/ReadFileTool.ts` |
| `[x]` | ToolRepetitionDetector Rewrite (fuzzy dedup, ledger, recoverable errors) | `src/core/tool-execution/ToolRepetitionDetector.ts` |
| `[x]` | Pipeline Result Cache (per-task, write-invalidation) | `src/core/tool-execution/ToolExecutionPipeline.ts` |
| `[x]` | Soft/Hard Limit + Condensing Ledger | `src/core/AgentTask.ts` |

---

## Geplant / Backlog

| Priorität | Feature | Spec | Notiz |
|-----------|---------|------|-------|
| Mittel | Mode Export/Import (JSON) | — | Fehlte in Settings-Tab |
| Niedrig | Settings Reset (Factory Reset) | — | BackupTab hat Export/Import, nur Reset fehlt |
| Niedrig | Custom Tools (`.ts` Dateien laden) | — | Experimental |
| Niedrig | Speech-to-Text (Whisper) | — | Zurückgestellt |
| Geplant | **Obsilo Gateway** (LLM-Relay, OpenRouter, Stripe) | archiviert | Post-Stabilisierung, Monetarisierung |

---

## Tool-Zaehlung

**37 Tools implementiert** (7 Tool-Gruppen):
- read (3): read_file, list_files, search_files
- vault (8): get_frontmatter, search_by_tag, get_vault_stats, get_linked_notes, get_daily_note, open_note, semantic_search, query_base
- edit (11): write_file, edit_file, append_to_file, create_folder, delete_file, move_file, update_frontmatter, generate_canvas, create_excalidraw, create_base, update_base
- web (2): web_fetch, web_search
- agent (7): ask_followup_question, attempt_completion, update_todo_list, new_task, switch_mode, update_settings, configure_model
- mcp (1): use_mcp_tool
- skill (5): execute_command, execute_recipe, call_plugin_api, resolve_capability_gap, enable_plugin

---

## Dokumentation

### Feature-Specs (43 Dateien in `devprocess/requirements/features/`)

Alle implementierten Features haben eine `FEATURE-*.md` Spec.

### Architecture (18 ADRs + arc42)

| ADR | Entscheidung |
|-----|-------------|
| ADR-001 | Zentrale ToolExecutionPipeline |
| ADR-002 | isomorphic-git Checkpoints |
| ADR-003 | vectra + Xenova Semantic Index |
| ADR-004 | Mode-basierte Tool-Filterung |
| ADR-005 | Fail-Closed Approval |
| ADR-006 | Sliding Window Repetition Detection |
| ADR-007 | Event Separation |
| ADR-008 | Modulare Prompt-Sections & Tool Metadata |
| ADR-009 | Local Skills (VaultDNA PAS-1) |
| ADR-010 | Permissions Audit |
| ADR-011 | Multi-Provider API Architecture |
| ADR-012 | Context Condensing Strategy |
| ADR-013 | 3-Tier Memory Architecture |
| ADR-014 | VaultDNA Plugin Discovery |
| ADR-015 | Hybrid Search (Semantic + BM25 + RRF) |
| ADR-016 | Rich Tool Descriptions |
| ADR-017 | Procedural Skill Recipes |
| ADR-018 | Episodic Task Memory |

### Technische Dokumentation (10 Dateien in `devprocess/implementation/`)

| Datei | Inhalt |
|-------|--------|
| `AGENT-INTERNALS.md` | Agent Loop, Tool Calls, System Prompt, Modes, Multi-Agent, Skills, Memory, Soul |
| `TECH-tool-system.md` | ToolRegistry, BaseTool, Pipeline, Metadata, Parallel Execution, Repetition Detection |
| `TECH-semantic-search.md` | SemanticIndex, Vectra, BM25, RRF, HyDE, Graph Augmentation |
| `TECH-memory-system.md` | MemoryService, Extraction Pipeline, Soul, Onboarding |
| `TECH-modes-prompts.md` | ModeService, Built-in Modes, Rules, Workflows, Skills, Support Prompts |
| `TECH-governance-safety.md` | IgnoreService, Approval, Checkpoints, OperationLogger, Defense in Depth |
| `TECH-providers-api.md` | ApiHandler, Anthropic/OpenAI Provider, Stream Processing |
| `TECH-mcp-integration.md` | McpClient, Transports, Tool Discovery, Per-Mode Whitelist |
| `TECH-ui-architecture.md` | AgentSidebarView, Autocomplete, HistoryPanel, DiffReview, Settings Tabs |
| `TECH-plugin-skills.md` | VaultDNA, execute_command, call_plugin_api, execute_recipe |
