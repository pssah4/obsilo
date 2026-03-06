# Obsilo Agent -- Vollstaendiges Backlog

Stand: 2026-03-06
Branch: `feature/task-management`

---

## Implementierungshistorie

### Phase A: Core Foundation & Parallel Tools

- Vault CRUD: `read_file`, `write_file`, `list_files`, `search_files`, `create_folder`, `delete_file`, `move_file`
- Content Editing: `edit_file`, `append_to_file` (diff-basiert)
- Control Flow: `ask_followup_question`, `attempt_completion`, `switch_mode`
- Sidebar Chat UI mit Message-Rendering
- Approval System (Fail-Closed, per-Category Auto-Approve, DiffReviewModal)
- Checkpoints (isomorphic-git Shadow-Repo, Diff, Restore, Undo-Bar)
- Operation Logging (JSONL Audit Trail mit PII-Scrubbing)
- Parallel Tool Execution (Promise.all fuer read-safe Tools)
- Diff-Stats Badge (+N/-N auf Write-Ops)
- Log-Viewer in Settings

### Phase B: Rules, Workflows, Skills & Autocomplete

- Rules System (`.obsidian-agent/rules/` mit Toggle-UI)
- Workflows/Slash-Commands (`/slug` Invocation)
- Skills & VaultDNA (Plugin API Bridge, Skill Discovery)
- Autocomplete (`/` Workflows, `@` File-Mentions, VaultFilePicker)
- Support Prompts (Custom Prompt Templates)
- Chat History (ConversationStore + HistoryPanel UI)
- Mode System (2 Built-In Modes + Custom Mode Editor)
- Per-Mode Tool Filtering + API Config

### Phase C: Context, Memory, Semantic Index & Multi-Agent

- Semantic Index (vectra HNSW, Hybrid Keyword + Semantic, HyDE, Heading-Aware Chunking)
- Keyword Search Upgrade (Stemming + TF-IDF + Word Boundaries)
- Context Management (Active File Awareness, Pinned Context, @-Mentions)
- 3-Tier Memory (Session -> Long-Term -> Soul, Async Extraction via ExtractionQueue)
- Chat History Restore + Continue
- Multi-Agent (`new_task`, Depth Guard maxSubtaskDepth=2, Mode-Aware Subtask Propagation)
- Context Condensing (LLM-Summarization bei 70% Token-Threshold, Smart Tail, Multi-Pass, Emergency Auto-Retry)
- Canvas Tools (`generate_canvas`, `create_excalidraw`)
- Bases Tools (`create_base`, `update_base`, `query_base`)
- Global Storage (~/.obsidian-agent/, SyncBridge, GlobalMigrationService)
- Safe Storage (Electron safeStorage, OS Keychain)
- Tool Repetition Detection (Sliding Window, Fuzzy Dedup)
- Power Steering (Periodic Mode Reminder)

### Phase D: MCP, Web, Localization & Security

- MCP Client (SSE, streamable-HTTP), `use_mcp_tool`, `manage_mcp_server`
- Web Tools (`web_fetch`, `web_search` via Brave/Tavily)
- i18n (6 Sprachen: DE, EN, ES, JA, ZH-CN, HI)
- Onboarding Wizard (Conversational Onboarding via OnboardingService)
- Notifications (Task-Completion Toast)
- VaultDNA Plugin Discovery
- Agent Skill Mastery (Rich Descriptions, Procedural Recipes, Auto-Promotion, Episodic Learning)
- Multi-Provider API (Anthropic, OpenAI, Ollama, LM Studio, OpenRouter, Azure, Custom)

### Phase E: Self-Development, Sandbox & Tools

- Self-Development Framework komplett:
  - Stufe 1: Skills als Markdown (ManageSkillTool, SelfAuthoredSkillLoader)
  - Stufe 2: Dynamic Modules (iframe Sandbox, EsbuildWasmManager, DynamicToolFactory, EvaluateExpressionTool)
  - Stufe 3: Core Self-Modification (EmbeddedSourceManager, PluginBuilder, PluginReloader, ManageSourceTool)
  - Stufe 5: Proactive Self-Improvement (SuggestionService, LongTermExtractor, Pre-Compaction Flush)
- Sandbox OS-Level Isolation (ISandboxExecutor, ProcessSandboxExecutor, IframeSandboxExecutor, sandbox-worker)
- Console Observability (ConsoleRingBuffer, ReadAgentLogsTool)
- Settings Tools (UpdateSettingsTool, ConfigureModelTool)
- Plugin API (CallPluginApiTool, EnablePluginTool, pluginApiAllowlist)
- ExecuteCommandTool, ResolveCapabilityGapTool, ExecuteRecipeTool

### Phase F: Chat-Linking & Document Parsing

- Chat-Linking (semantisches Chat-Titling, Auto-Frontmatter-Linking, Protocol Handler, chatLinking Setting)
- Document Parsing Pipeline (ReadDocumentTool, parseDocument fuer PPTX/XLSX/DOCX/PDF/JSON/XML/CSV)
- File Picker Erweiterung (VaultFilePicker fuer Office-Formate)
- Task Extraction (TaskExtractor, TaskNoteCreator, TaskSelectionModal)

---

## Aktueller Feature-Status

### Vollstaendig implementiert (43+ Tools, alle Features)

| Feature | Spec | Key Files |
|---------|------|-----------|
| Agent Core Loop | FEATURE-0101-agent-core.md | `src/core/AgentTask.ts` |
| Core Interaction & Modes | FEATURE-0102-core-interaction.md | `src/ui/AgentSidebarView.ts` |
| Context Management | FEATURE-0303-context-management.md | `src/core/systemPrompt.ts` |
| Providers & Models | FEATURE-0403-providers-models.md | `src/api/` |
| Custom Instructions/Modes/Rules | FEATURE-0210-custom-instructions-modes-rules.md | `src/core/modes/ModeService.ts` |
| Permissions & Approval | FEATURE-0106-permissions-approval.md | `src/core/governance/IgnoreService.ts` |
| Checkpoints | FEATURE-0107-checkpoints.md | `src/core/checkpoints/GitCheckpointService.ts` |
| Operation Logging | FEATURE-0108-operation-logging.md | `src/core/governance/OperationLogger.ts` |
| Vault Operations (CRUD) | FEATURE-0103-vault-ops.md | `src/core/tools/vault/` |
| Content Editing | FEATURE-0105-content-editing.md | `src/core/tools/vault/EditFileTool.ts` |
| Canvas & Bases | FEATURE-0309-canvas-bases.md | `src/core/tools/vault/` |
| Semantic Index | FEATURE-0301-semantic-index.md | `src/core/semantic/SemanticIndexService.ts` |
| Keyword Search Upgrade | FEATURE-0302-keyword-search-upgrade.md | `src/core/semantic/SemanticIndexService.ts` |
| MCP Support | FEATURE-0401-mcp.md | `src/core/mcp/McpClient.ts` |
| Web Tools | FEATURE-0402-web-tools.md | `src/core/tools/web/` |
| Workflows & Skills | FEATURE-0202-workflows.md, FEATURE-0203-skills.md | `src/core/context/WorkflowLoader.ts` |
| Local Skills | FEATURE-0204-local-skills.md | `src/core/skills/SkillRegistry.ts` |
| Memory & Personalization | FEATURE-0304-memory-personalization.md | `src/core/memory/MemoryService.ts` |
| Multi-Agent | FEATURE-0305-multi-agent.md | `src/core/tools/agent/NewTaskTool.ts` |
| VaultDNA & Plugin Skills | FEATURE-0205-vault-dna.md | `src/core/skills/CorePluginLibrary.ts` |
| i18n | FEATURE-0404-localization.md | `src/i18n/` |
| Global Storage | FEATURE-0310-global-storage.md | `src/core/storage/GlobalFileService.ts` |
| Safe Storage | FEATURE-0311-safe-storage.md | `src/core/security/SafeStorageService.ts` |
| Parallel Tool Execution | FEATURE-0110-parallel-tools.md | `src/core/AgentTask.ts` |
| Diff Stats | FEATURE-0111-diff-stats.md | `src/core/tool-execution/ToolExecutionPipeline.ts` |
| Context Condensing | FEATURE-0306-context-condensing.md | `src/core/AgentTask.ts` |
| Power Steering | FEATURE-0307-power-steering.md | `src/core/AgentTask.ts` |
| Tool Repetition Detection | FEATURE-0308-tool-repetition-detection.md | `src/core/tool-execution/ToolRepetitionDetector.ts` |
| Chat History | FEATURE-0208-chat-history.md | `src/core/history/ConversationStore.ts` |
| Autocomplete | FEATURE-0206-autocomplete.md | `src/ui/sidebar/AutocompleteHandler.ts` |
| Notifications | FEATURE-0406-notifications.md | `src/ui/AgentSidebarView.ts` |
| Modular System Prompt | FEATURE-0312-modular-system-prompt.md | `src/core/systemPrompt.ts`, `src/core/prompts/sections/` |
| Tool Execution Pipeline | FEATURE-0109-tool-execution-pipeline.md | `src/core/tool-execution/ToolExecutionPipeline.ts` |
| Tool Metadata Registry | FEATURE-0506-tool-metadata-registry.md | `src/core/tools/toolMetadata.ts` |
| Rules | FEATURE-0201-rules.md | `src/core/context/RulesLoader.ts` |
| Custom Prompts | FEATURE-0207-custom-prompts.md | `src/core/context/SupportPrompts.ts` |
| Modes | FEATURE-0209-modes.md | `src/core/modes/ModeService.ts` |
| Agent Tools (17) | FEATURE-0503-agent-tools.md | `src/core/tools/agent/` |
| Vault Tools (22) | FEATURE-0104-vault-tools.md | `src/core/tools/vault/` |
| Settings Tools | FEATURE-0504-settings-tools.md | `src/core/tools/agent/UpdateSettingsTool.ts` |
| Plugin API | FEATURE-0505-plugin-api.md | `src/core/tools/agent/CallPluginApiTool.ts` |
| Code Import Models | FEATURE-0313-code-import-models.md | `src/ui/settings/CodeImportModal.ts` |
| Attachments & Clipboard | FEATURE-0112-attachments-clipboard-images.md | `src/ui/sidebar/AttachmentHandler.ts` |
| Self-Development (alle Stufen) | FEATURE-0501-self-development.md | `src/core/self-development/`, `src/core/sandbox/` |
| Sandbox OS-Level Isolation | FEATURE-0502-sandbox-os-isolation.md | `src/core/sandbox/ProcessSandboxExecutor.ts` |
| Agent Skill Mastery | FEATURE-0407-skill-mastery.md | `src/core/mastery/` |
| Onboarding | FEATURE-0405-onboarding.md | `src/core/memory/OnboardingService.ts` |
| Chat-Linking | FEATURE-0701-chat-linking.md | `src/core/tool-execution/ToolExecutionPipeline.ts` |
| Protocol Handler | FEATURE-0702-protocol-handler.md | `src/main.ts` |
| Auto-Frontmatter-Linking | FEATURE-0703-auto-frontmatter-linking.md | `src/core/tool-execution/ToolExecutionPipeline.ts` |
| Semantic Chat-Titling | FEATURE-0704-semantic-chat-titling.md | `src/ui/AgentSidebarView.ts` |
| Chat-Linking Setting | FEATURE-0705-chat-linking-setting.md | `src/types/settings.ts` |
| Document Parsing Pipeline | FEATURE-0601-document-parsing-pipeline.md | `src/core/document-parsers/` |
| File Picker Erweiterung | FEATURE-0602-file-picker-extension.md | `src/ui/sidebar/VaultFilePicker.ts` |
| Task Extraction & Management | FEATURE-0801-task-extraction.md | `src/core/tasks/` |

### Geplant (nicht implementiert)

| Feature | Spec | Prioritaet |
|---------|------|------------|
| Token Budget Management | FEATURE-0603-token-budget-management.md | P1-High |
| On-Demand Image Extraction | FEATURE-0604-on-demand-image-extraction.md | P1-High |
| Model Compatibility Check | FEATURE-0605-model-compatibility-check.md | P2-Medium |
| Obsilo Gateway | FEATURE-0901-obsilo-gateway.md | Nach Stabilisierung (Monetarisierung) |

---

## Offene Punkte

### Bekannte Bugs (aus Codebase-Analyse)

| ID | Prio | Beschreibung | Datei |
|----|------|-------------|-------|
| FIX-01 | P0 | Tool JSON-Parse Error wird verschluckt statt propagiert | `src/api/providers/*.ts` |
| FIX-02 | P0 | EditFileTool.tryNormalizedMatch() Inkonsistenz (trim vs normalize) | `src/core/tools/vault/EditFileTool.ts` |
| FIX-03 | P0 | Checkpoint-Snapshot Race Condition bei concurrent Writes | `src/core/checkpoints/GitCheckpointService.ts` |
| FIX-04 | P1 | Tool-Picker Event-Listener Memory Leak | `src/ui/sidebar/ToolPickerPopover.ts` |
| FIX-05 | P1 | SearchFilesTool Regex lastIndex Bug (global Flag) | `src/core/tools/vault/SearchFilesTool.ts` |
| FIX-06 | P2 | Consecutive-Mistake-Counter Reset bei Mode-Switch fehlt | `src/core/AgentTask.ts` |

### Security Findings (aus Scan 2026-03-01)

| ID | Severity | Finding | Status |
|----|----------|---------|--------|
| H-1 | High | `new Function()` in EsbuildWasmManager (CWE-94) | Mitigiert (ProcessSandboxExecutor auf Desktop, SHA-256) |
| H-2 | High | PostMessage Origin-Validierung Luecken | Mitigiert (IframeSandboxExecutor nur Mobile-Fallback) |
| H-3 | High | iframe Sandbox Effektivitaet in Electron | Geloest: ProcessSandboxExecutor auf Desktop (OS-Level Isolation) |
| M-1 | Medium | User-controlled Regex ReDoS in SearchFilesTool | Mitigiert (safeRegex) |
| M-2 | Medium | IgnoreService Glob-to-Regex ReDoS | Mitigiert (Length Guard) |
| M-3 | Medium | SelfAuthoredSkillLoader Regex ReDoS | Offen |
| M-4 | Medium | Plugin API Allowlist Bypass (dynamic require) | Audit noetig |
| M-5 | Medium | Path Traversal in GlobalFileService | Normalisierung noetig |

### Technische Schulden

| Bereich | Beschreibung | Aufwand |
|---------|-------------|---------|
| UI Modularisierung | `AgentSidebarView.ts` monolithisch (~2500 LOC) -- Split in ChatRenderer, ToolPickerPopover, etc. | 4-6h |
| Error-Format | `<tool_error>` Tags nicht standardisiert ueber alle 43+ Tools | 2-3h |
| Token-Estimation | Grobe ~4 chars/token Schaetzung -- genauer mit js-tiktoken | 2h |
| Virtual Scrolling | Lange Chat-Historien verursachen UI-Lag | 4h |
| Semantic Index Trigger | Kein Auto-Index bei Vault-Aenderungen, nur manueller Rebuild | 2h |

---

## Naechste Prioritaeten

### Sofort (aktueller Sprint)

1. Security Bug Fixes (FIX-01 bis FIX-03) -- P0
2. Security Findings Triage (M-3, M-4, M-5 -- offene Medium-Findings)
3. Dokumentation vollstaendig aktualisieren (laufend)

### Kurzfristig (2-4 Wochen)

1. Token Budget Management (FEATURE-0603) -- limitiert Kontext-Ueberladung
2. On-Demand Image Extraction (FEATURE-0604) -- komplettiert Document Parsing
3. Model Compatibility Check (FEATURE-0605) -- verhindert Feature-Fehlkonfiguration
4. UI Event-Listener Cleanup (FIX-04)

### Mittelfristig (4-8 Wochen)

1. UI Refactoring (SidebarView Split)
2. Virtual Scrolling fuer lange Chats
3. Semantic Index Auto-Trigger bei Vault-Aenderungen

### Langfristig

1. Obsilo Gateway MVP (Monetarisierung)
2. Performance-Optimierung (Token-Estimation, Index-Rebuild)
