# Obsidian Agent — Backlog

> Status: `[x]` fertig · `[~]` in Arbeit · `[ ]` offen · `[-]` zurückgestellt
> Letzte Aktualisierung: 2026-02-21 (Code Import Models)

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
| `[x]` | OnboardingService (first-contact detection, profile bootstrapping) | `src/core/memory/OnboardingService.ts` |
| `[x]` | MemoryRetriever (cross-session context via semantic search) | `src/core/memory/MemoryRetriever.ts` |
| `[x]` | Event Separation (hasStreamedText flag, completion result as fallback only) | `src/core/AgentTask.ts` |

### Core: Semantic Index
| Status | Feature | Datei |
|--------|---------|-------|
| `[x]` | SemanticIndexService (vectra HNSW, Xenova embeddings, heading-aware chunking) | `src/core/semantic/SemanticIndexService.ts` |
| `[x]` | Hybrid search (semantic + BM25 keyword + RRF fusion) | `src/core/semantic/SemanticIndexService.ts` |
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
| `[x]` | Loop Tab (Error-Limit, Rate-Limit, Context Condensing, Power Steering) | `src/ui/settings/LoopTab.ts` |
| `[x]` | Interface Tab (Auto-add active note, Welcome-Message) | `src/ui/settings/InterfaceTab.ts` |
| `[x]` | Embeddings Tab (Semantic Index Konfiguration) | `src/ui/settings/EmbeddingsTab.ts` |
| `[x]` | Vault Tab (Vault-Pfade) | `src/ui/settings/VaultTab.ts` |
| `[x]` | Memory Tab (Memory-Toggles, Model, Threshold, Reset) | `src/ui/settings/MemoryTab.ts` |
| `[x]` | Backup Tab (Export / Import Settings als JSON) | `src/ui/settings/BackupTab.ts` |
| `[x]` | Debug Tab (Debug Mode Toggle) | `src/ui/settings/DebugTab.ts` |
| `[x]` | Log Tab (JSONL Audit-Log-Viewer) | `src/ui/settings/LogTab.ts` |

---

## Geplant / Backlog

| Priorität | Feature | Spec | Notiz |
|-----------|---------|------|-------|
| Mittel | Mode Export/Import (JSON) | — | Fehlte in Settings-Tab |
| Niedrig | Settings Reset (Factory Reset) | — | BackupTab hat Export/Import, nur Reset fehlt |
| Niedrig | Custom Tools (`.ts` Dateien laden) | — | Experimental |
| Niedrig | Speech-to-Text (Whisper) | — | Zurückgestellt |
| Geplant | **Obsilo Gateway** (LLM-Relay, OpenRouter, Stripe) | `FEATURE-obsilo-gateway.md` | Post-Stabilisierung, Monetarisierung |

---

## Tool-Zählung

**30 Tools implementiert:**
- read (3): read_file, list_files, search_files
- vault (9): get_vault_stats, get_frontmatter, update_frontmatter, search_by_tag, get_linked_notes, open_note, get_daily_note, semantic_search, query_base
- edit (9): write_file, edit_file, append_to_file, create_folder, delete_file, move_file, generate_canvas, create_base, update_base
- web (2): web_fetch, web_search
- agent (5): ask_followup_question, attempt_completion, switch_mode, update_todo_list, new_task
- mcp (1): use_mcp_tool
- (update_frontmatter ist in vault + edit verfügbar)
