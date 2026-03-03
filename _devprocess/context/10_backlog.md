# Obsilo Agent -- Vollstaendiges Backlog

Stand: 2026-03-03
Branch: `reviewbot-fixes-round3`

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
- Mode System (5 Built-In Modes + Custom Mode Editor)
- Per-Mode Tool Filtering + API Config

### Phase C: Context, Memory, Semantic Index & Multi-Agent

- Semantic Index (vectra HNSW, Hybrid Keyword + Semantic, HyDE, Heading-Aware Chunking)
- Context Management (Active File Awareness, Pinned Context, @-Mentions)
- 3-Tier Memory (Session -> Long-Term -> Soul, Async Extraction)
- Chat History Restore + Continue
- Multi-Agent (`new_task`, Depth Guard, Mode-Aware Subtask Propagation)
- Context Condensing (LLM-Summarization bei Token-Threshold)
- Canvas Tools (`generate_canvas`, `create_excalidraw`)
- Bases Tools (`create_base`, `update_base`, `query_base`)
- Global Storage (~/.obsidian-agent/, SyncBridge)
- Safe Storage (Electron safeStorage, OS Keychain)
- Tool Repetition Detection (Sliding Window, Fuzzy Dedup)
- Power Steering (Periodic Mode Reminder)

### Phase D: MCP, Web, Localization & Security

- MCP Client (stdio, SSE, streamable-HTTP), `use_mcp_tool`, `manage_mcp_server`
- Stdio Command Validation (Shell-Injection Blocking)
- Web Tools (`web_fetch`, `web_search` via Brave/Tavily)
- i18n (6 Sprachen: DE, EN, ES, JA, ZH-CN, HI)
- Onboarding Wizard (5-Schritt Setup)
- Notifications (Task-Completion Toast)
- VaultDNA Plugin Discovery
- Agent Skill Mastery (Rich Tool Descriptions, Episodic Memory Grundlagen)
- Self-Development Framework (Spec + Level 1)
- Multi-Provider API (Anthropic, OpenAI, Ollama, LM Studio, OpenRouter, Azure, Custom)

---

## Aktueller Feature-Status

### Vollstaendig implementiert

| Feature | Spec | Key Files |
|---------|------|-----------|
| Agent Core Loop | FEATURE-agent-core.md | `src/core/AgentTask.ts` |
| Core Interaction & Modes | FEATURE-core-interaction.md | `src/ui/AgentSidebarView.ts` |
| Context Management | FEATURE-context-management.md | `src/core/systemPrompt.ts` |
| Providers & Models | FEATURE-providers-models.md | `src/api/` |
| Custom Instructions/Modes/Rules | FEATURE-custom-instructions-modes-rules.md | `src/core/modes/ModeService.ts` |
| Permissions & Approval | FEATURE-permissions-approval.md | `src/core/governance/IgnoreService.ts` |
| Checkpoints | FEATURE-checkpoints.md | `src/core/governance/CheckpointService.ts` |
| Operation Logging | FEATURE-operation-logging.md | `src/core/governance/OperationLogger.ts` |
| Vault Operations (CRUD) | FEATURE-vault-ops.md | `src/core/tools/vault/` |
| Content Editing | FEATURE-content-editing.md | `src/core/tools/vault/EditFileTool.ts` |
| Canvas & Bases | FEATURE-canvas-bases.md | `src/core/tools/vault/` |
| Semantic Index | FEATURE-semantic-index.md | `src/core/semantic/` |
| MCP Support | FEATURE-mcp.md | `src/core/mcp/McpClient.ts` |
| Web Tools | FEATURE-web-tools.md | `src/core/tools/web/` |
| Workflows & Skills | FEATURE-workflows.md, FEATURE-skills.md | `src/core/modes/` |
| Local Skills | FEATURE-local-skills.md | `src/core/modes/SkillsManager.ts` |
| Memory & Personalization | FEATURE-memory-personalization.md | `src/core/memory/MemoryService.ts` |
| Multi-Agent | FEATURE-multi-agent.md | `src/core/AgentTask.ts` |
| VaultDNA & Plugin Skills | FEATURE-vault-dna.md | `src/core/skills/VaultDnaService.ts` |
| i18n | FEATURE-localization.md | `src/i18n/` |
| Global Storage | FEATURE-global-storage.md | `src/services/GlobalStorageService.ts` |
| Safe Storage | FEATURE-safe-storage.md | `src/services/SafeStorageService.ts` |
| Parallel Tool Execution | FEATURE-parallel-tools.md | `src/core/AgentTask.ts` |
| Diff Stats | FEATURE-diff-stats.md | `src/core/tools/` |
| Context Condensing | FEATURE-context-condensing.md | `src/core/AgentTask.ts` |
| Power Steering | FEATURE-power-steering.md | `src/core/AgentTask.ts` |
| Tool Repetition Detection | FEATURE-tool-repetition-detection.md | `src/core/tool-execution/` |
| Chat History | FEATURE-chat-history.md | `src/core/ConversationStore.ts` |
| Autocomplete | FEATURE-autocomplete.md | `src/ui/` |
| Notifications | FEATURE-notifications.md | `src/ui/` |
| Modular System Prompt | FEATURE-modular-system-prompt.md | `src/core/systemPrompt.ts` |
| Tool Execution Pipeline | FEATURE-tool-execution-pipeline.md | `src/core/tool-execution/` |
| Tool Metadata Registry | FEATURE-tool-metadata-registry.md | `src/core/tools/` |
| Rules | FEATURE-rules.md | `src/core/modes/` |
| Custom Prompts | FEATURE-custom-prompts.md | `src/core/modes/` |
| Modes | FEATURE-modes.md | `src/core/modes/ModeService.ts` |
| Agent Tools | FEATURE-agent-tools.md | `src/core/tools/agent/` |
| Vault Tools | FEATURE-vault-tools.md | `src/core/tools/vault/` |
| Settings Tools | FEATURE-settings-tools.md | `src/core/tools/settings/` |
| Plugin API | FEATURE-plugin-api.md | `src/core/tools/` |
| Code Import Models | FEATURE-code-import-models.md | `src/api/` |
| Keyword Search Upgrade | FEATURE-keyword-search-upgrade.md | `src/core/tools/vault/` |
| Attachments & Clipboard | FEATURE-attachments-clipboard-images.md | `src/ui/` |

### Teilweise implementiert

| Feature | Status | Offene Punkte |
|---------|--------|---------------|
| Onboarding Wizard | 5-Schritt-Flow vorhanden | `update_settings` + `configure_model` Tools fehlen |
| Agent Skill Mastery | Level 1 (Rich Descriptions) done | Level 2 (Procedural Recipes, Auto-Promotion) + Level 3 (Episodic Learning) offen |
| Self-Development | Spec + Level 1 (Skills als Markdown) | Level 2 (Dynamic Modules, iframe Sandbox) + Level 3 (Core Self-Modification) offen |
| Sandbox OS-Level Isolation | Spec + ADR + Plan fertig | Implementierung auf Branch `sandbox-os-isolation` ausstehend |

### In der Pipeline (Requirements fertig)

| Feature | Spec | Prioritaet | Status |
|---------|------|------------|--------|
| Task Extraction & Management | FEATURE-100-task-extraction.md | P1-High | BA + Feature-Spec + Handoff fertig, wartet auf Architektur |

### Geplant (nicht implementiert)

| Feature | Spec | Prioritaet |
|---------|------|------------|
| Obsilo Gateway | FEATURE-obsilo-gateway.md | Nach Stabilisierung (Monetarisierung) |

---

## Offene Punkte

### Bekannte Bugs (aus Codebase-Analyse)

| ID | Prio | Beschreibung | Datei |
|----|------|-------------|-------|
| FIX-01 | P0 | Tool JSON-Parse Error wird verschluckt statt propagiert | `src/api/providers/*.ts` |
| FIX-02 | P0 | EditFileTool.tryNormalizedMatch() Inkonsistenz (trim vs normalize) | `src/core/tools/vault/EditFileTool.ts` |
| FIX-03 | P0 | Checkpoint-Snapshot Race Condition bei concurrent Writes | `src/core/governance/CheckpointService.ts` |
| FIX-04 | P1 | Tool-Picker Event-Listener Memory Leak | `src/ui/` |
| FIX-05 | P1 | SearchFilesTool Regex lastIndex Bug (global Flag) | `src/core/tools/vault/SearchFilesTool.ts` |
| FIX-06 | P2 | Consecutive-Mistake-Counter Reset bei Mode-Switch fehlt | `src/core/AgentTask.ts` |
| FIX-07 | P2 | MCP stdio Command Shell-Injection unvollstaendig | `src/core/mcp/McpClient.ts` |

### Security Findings (aus Scan 2026-03-01)

| ID | Severity | Finding | Status |
|----|----------|---------|--------|
| H-1 | High | `new Function()` in EsbuildWasmManager (CWE-94) | Mitigiert (SHA-256), Monitoring noetig |
| H-2 | High | PostMessage Origin-Validierung Luecken | Offen |
| H-3 | High | iframe Sandbox Effektivitaet in Electron | Adressiert: ADR-021, child_process.fork() auf Desktop, Branch `sandbox-os-isolation` |
| M-1 | Medium | User-controlled Regex ReDoS in SearchFilesTool | Offen |
| M-2 | Medium | IgnoreService Glob-to-Regex ReDoS | Mitigiert (Length Guard) |
| M-3 | Medium | SelfAuthoredSkillLoader Regex ReDoS | Offen |
| M-4 | Medium | Plugin API Allowlist Bypass (dynamic require) | Audit noetig |
| M-5 | Medium | Path Traversal in GlobalFileService | Normalisierung noetig |

Gesamt: 0 Critical, 6 High, 15 Medium, 11 Low, 5 Info

### Technische Schulden

| Bereich | Beschreibung | Aufwand |
|---------|-------------|---------|
| UI Modularisierung | `AgentSidebarView.ts` monolithisch (~2500 LOC) -- Split in ChatRenderer, ToolPickerPopover, etc. | 4-6h |
| Error-Format | `<tool_error>` Tags nicht standardisiert ueber alle 30+ Tools | 2-3h |
| Token-Estimation | Grobe ~4 chars/token Schaetzung -- genauer mit js-tiktoken | 2h |
| Virtual Scrolling | Lange Chat-Historien verursachen UI-Lag | 4h |
| Semantic Index Trigger | Kein Auto-Index bei Vault-Aenderungen, nur manueller Rebuild | 2h |

---

## Naechste Prioritaeten

### Sofort (aktueller Sprint)

1. Security Bug Fixes (FIX-01 bis FIX-03) -- P0
2. Security Findings Triage (H-2, M-1, M-5)
3. AstValidator und Permissions Hardening (laufend auf aktuellem Branch)
4. **Sandbox OS-Level Isolation** (Branch `sandbox-os-isolation`, ADR-021) -- H-3 Remediation

### Kurzfristig (2-4 Wochen)

1. Onboarding Wizard vervollstaendigen (`update_settings`, `configure_model`)
2. **Task Extraction & Management** (FEATURE-100) -- Architektur (ADRs) -> Implementierung
3. Agent Skill Mastery Phase 2 (Procedural Recipes, Auto-Promotion)
4. UI Event-Listener Cleanup (FIX-04)

### Mittelfristig (4-8 Wochen)

1. Self-Development Level 2 (Dynamic Module Sandbox)
2. UI Refactoring (SidebarView Split)
3. Global Storage Sync-Testing

### Langfristig

1. Obsilo Gateway MVP
2. Agent Skill Mastery Phase 3 (Core Self-Modification)
3. Virtual Scrolling + Performance-Optimierung
