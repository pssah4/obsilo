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

| ID | Prio | Beschreibung | Datei | Status |
|----|------|-------------|-------|--------|
| FIX-01 | P0 | Tool JSON-Parse Error wird verschluckt statt propagiert | `src/api/providers/*.ts` | Resolved -- Error als tool_error/text-chunk propagiert |
| FIX-02 | P0 | EditFileTool.tryNormalizedMatch() Inkonsistenz (trim vs normalize) | `src/core/tools/vault/EditFileTool.ts` | Resolved -- konsistente normalize()-Funktion |
| FIX-03 | P0 | Checkpoint-Snapshot Race Condition bei concurrent Writes | `src/core/checkpoints/GitCheckpointService.ts` | Resolved -- serielle Commits, in-memory Map |
| FIX-04 | P1 | Tool-Picker Event-Listener Memory Leak | `src/ui/sidebar/ToolPickerPopover.ts` | Resolved -- close() entfernt alle Listener |
| FIX-05 | P1 | SearchFilesTool Regex lastIndex Bug (global Flag) | `src/core/tools/vault/SearchFilesTool.ts` | Resolved -- safeRegex() ohne global Flag |
| FIX-06 | P2 | Consecutive-Mistake-Counter Reset bei Mode-Switch fehlt | `src/core/AgentTask.ts` | Resolved -- consecutiveMistakes + repetitionDetector Reset |

### Security Findings (abgeglichen mit AUDIT-003 vom 2026-03-06)

Referenz: `_devprocess/analysis/security/AUDIT-003-obsilo-2026-03-06.md`

| ID (AUDIT-003) | Severity | Finding | Status |
|-----------------|----------|---------|--------|
| H-1 | High | Prompt Injection bei permissive Auto-Approval (CWE-77) | By Design -- UI-Warning implementiert (`PermissionsTab.ts:196-212`), Checkpoint-Rollback vorhanden |
| M-1 | Medium | npm-Packages in Sandbox ohne Integritaetspruefung (CWE-494) | Confirmed -- SandboxBridge mitigiert. Known-Good-Hashes mittelfristig |
| M-2 | Medium | Vault-Inhalte (PII) an Cloud-LLMs (CWE-200) | By Design -- Ollama/LM Studio als lokale Alternative, .obsidian-agentignore |
| M-3 | Medium | manage_source Excessive Agency (CWE-269) | By Design -- IMMER manuell genehmigt (self-modify Klassifikation) |
| M-4 | Medium | DNS-Rebinding-Restrisiko in SSRF-Schutz (CWE-918) | Improved -- Zweiphasige Validierung, TOCTOU dokumentiert |
| L-1 | Low | PostMessage targetOrigin '*' in IframeSandboxExecutor (CWE-345) | Known Limitation -- event.source-Pruefung vorhanden |
| L-2 | Low | SelfAuthoredSkillLoader new RegExp() (CWE-1333) | Low Risk -- nur hardcoded Literals als field-Parameter |
| L-3 | Low | MCP-Verbindungen ohne Mutual TLS (CWE-295) | Confirmed -- lokale MCP-Server |

**Ehemalige Findings (aus Scan 2026-03-01, nicht mehr in AUDIT-003):**

| ID (alt) | Finding | Status |
|----------|---------|--------|
| H-1 (alt) | `new Function()` in EsbuildWasmManager (CWE-94) | Resolved -- ProcessSandboxExecutor + SHA-256 |
| H-2 (alt) | PostMessage Origin-Validierung | Resolved -- event.source-Pruefung (jetzt L-1) |
| H-3 (alt) | iframe Sandbox in Electron | Resolved -- ProcessSandboxExecutor auf Desktop |
| M-1 (alt) | User-controlled Regex ReDoS in SearchFilesTool | Resolved -- safeRegex() |
| M-2 (alt) | IgnoreService Glob-to-Regex ReDoS | Resolved -- Length Guard |
| M-4 (alt) | Plugin API Allowlist Bypass (dynamic require) | Resolved -- kein require(), Property-Lookup + Allowlist |
| M-5 (alt) | Path Traversal in GlobalFileService | Resolved -- resolvePath() mit Prefix-Check |

### Technische Schulden

| Bereich | Beschreibung | Aufwand | Status |
|---------|-------------|---------|--------|
| UI Modularisierung | `AgentSidebarView.ts` monolithisch (~3500 LOC) -- Split in ChatRenderer, etc. | 4-6h | Offen |
| Virtual Scrolling | Lange Chat-Historien verursachen UI-Lag | 4h | Offen |
| Token-Estimation | Grobe ~4 chars/token Schaetzung -- genauer mit js-tiktoken | 2h | Niedrige Prio (funktioniert konsistent) |
| ~~Semantic Index Trigger~~ | ~~Kein Auto-Index bei Vault-Aenderungen~~ | -- | Resolved -- `main.ts:348-363` (vault events + debounce) |
| ~~Error-Format~~ | ~~`<tool_error>` Tags nicht standardisiert~~ | -- | Resolved -- Tools nutzen einheitlich `is_error` Flag |

---

## Naechste Prioritaeten

### Kurzfristig (2-4 Wochen)

1. Token Budget Management (FEATURE-0603) -- limitiert Kontext-Ueberladung
2. On-Demand Image Extraction (FEATURE-0604) -- komplettiert Document Parsing
3. Model Compatibility Check (FEATURE-0605) -- verhindert Feature-Fehlkonfiguration

### Mittelfristig (4-8 Wochen)

1. UI Refactoring (SidebarView Split, ~3500 LOC -> Unterkomponenten)
2. Virtual Scrolling fuer lange Chats
3. npm-Package Integrity (Known-Good-Hashes fuer Sandbox-CDN-Pakete)

### Langfristig

1. Obsilo Gateway MVP (Monetarisierung)
2. Token-Estimation mit js-tiktoken (Verbesserung, nicht kritisch)
