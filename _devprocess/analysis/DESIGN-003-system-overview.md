# Obsidian Agent — System Architecture Overview

**Version:** 4.0
**Date:** 2026-03-04
**Status:** All Features Implemented (Phase A-D complete, Sandbox OS-Level Isolation complete)

---

## 1. Executive Summary

Obsidian Agent (Obsilo Agent) is a desktop-first Obsidian plugin (v1.1.0) that provides an agentic operating layer for vault operations. It adapts the Kilo Code architecture to the Obsidian context, replacing IDE operations with vault operations while maintaining the core patterns of tool governance, approval systems, checkpoints, and MCP extensibility.

**Key Stats:** 158 TypeScript files, ~38k LOC, 42 tools across 7 groups, 6 languages, 21 ADRs.

### Key Architectural Principles

1. **Tool-Use Interception**: ALL tool executions (internal vault ops AND MCP) flow through a central governance layer (ADR-001)
2. **Approval-by-Default**: Every write operation requires explicit user approval unless whitelisted (ADR-005)
3. **Shadow Repository**: Isomorphic-git maintains checkpoints in `.obsidian/plugins/obsilo-agent/checkpoints/` (ADR-002)
4. **Local-Only**: No cloud dependencies except user-configured LLM providers
5. **Mode-Based Agents**: Different agent personas with scoped tool access and specialized prompts (ADR-004)
6. **MCP Extensibility**: External tools integrate seamlessly through the governance layer
7. **3-Tier Memory**: Chat History -> Session Summaries -> Long-Term Memory (ADR-013)
8. **Plugin Discovery**: VaultDNA auto-generates skills from installed Obsidian plugins (ADR-014)
9. **Hybrid Search**: Semantic + BM25/TF-IDF with RRF fusion (ADR-015)

---

## 2. High-Level Architecture Diagram

```
+-----------------------------------------------------------------+
|                     OBSIDIAN PLUGIN HOST                         |
|  +-----------------------------------------------------------+  |
|  |             ObsidianAgentPlugin (main.ts)                  |  |
|  |  Plugin lifecycle | Services init | Commands | Views       |  |
|  +-----------------------------------------------------------+  |
|                              |                                   |
|              +---------------+---------------+                   |
|              |               |               |                   |
|  +-----------v----+ +-------v--------+ +----v--------------+    |
|  |   UI Layer     | |  Core Engine   | |  Service Layer    |    |
|  |  Sidebar +     | |  AgentTask +   | |  Memory, History  |    |
|  |  Settings +    | |  Pipeline +    | |  Semantic, Skills |    |
|  |  Modals        | |  Tools         | |  Storage, i18n    |    |
|  +----------------+ +----------------+ +-------------------+    |
+-----------------------------------------------------------------+
         |                      |                      |
         v                      v                      v
  +--------------+    +-----------------+    +----------------+
  | Chat View    |    | Tool Execution  |    | Services       |
  | Mode Select  |    | Pipeline (Gov)  |    | - Checkpoint   |
  | Autocomplete |    | 42 Tools        |    | - Semantic     |
  | History      |    | (7 groups)      |    | - Memory       |
  | Attachments  |    |                 |    | - MCP Client   |
  +--------------+    +-----------------+    | - VaultDNA     |
                               |             | - SafeStorage  |
                               v             | - Sandbox      |
                      +-----------------+    +----------------+
                      | Tool Registry   |
                      | - Vault (22)    |
                      | - Agent (12)    |
                      | - Skill (5)     |
                      | - Web (2)       |
                      | - MCP (1)       |
                      +-----------------+
```

---

## 3. Core Subsystems

### 3.1 UI Layer
- **AgentSidebarView**: Main chat interface (~146 KB), streaming, approval cards, todo box, undo bar, diff-stats badges
- **AutocompleteHandler**: `/`-workflows, `@`-files, inline dropdown
- **VaultFilePicker**: Live search, multi-select for file attachments
- **ToolPickerPopover**: Session-level tool/skill/workflow overrides
- **AttachmentHandler**: File attachments as context
- **HistoryPanel**: Sliding overlay with grouped conversations, search, restore
- **DiffReviewModal**: Line-by-line diff view before edit approval
- **AgentSettingsTab**: Settings router (20 tabs)

### 3.2 Core Engine
- **AgentTask**: Main orchestrator — iteration loop, streaming, tool calls, context condensing, power steering, sub-agent spawning
- **ToolExecutionPipeline**: Central 6-step governance (validate -> approval -> checkpoint -> execute -> log -> result cache)
- **ToolRegistry**: Registry of 42 internal tools across 7 groups + MCP tools
- **ToolRepetitionDetector**: Sliding window (10 calls, max 3 repeats), fuzzy dedup, ledger
- **ModeService**: Built-in (ask, agent) + custom modes with per-mode model, MCP whitelist
- **systemPrompt.ts**: Modular prompt builder (16 sections as pure functions)

### 3.3 Service Layer
- **GitCheckpointService**: isomorphic-git shadow repo for undo/restore
- **SemanticIndexService**: vectra HNSW + Xenova ONNX embeddings, hybrid search (semantic + BM25 + RRF)
- **McpClient**: stdio / SSE / streamable-HTTP transports, tool discovery
- **MemoryService**: 3-tier memory (chat history -> session summaries -> long-term)
- **VaultDNAScanner**: Runtime scan of installed plugins, auto-generates skill files
- **SafeStorageService**: Electron safeStorage (OS keychain) for API keys
- **GlobalFileService**: Cross-vault settings persistence (~/.obsidian-agent/)
- **SyncBridge**: Bidirectional sync for Obsidian Sync compatibility
- **OperationLogger**: JSONL audit trail with PII scrubbing
- **IgnoreService**: Path-level access control (.obsidian-agentignore, .obsidian-agentprotected)

### 3.4 Context Injection
- **RulesLoader**: Vault + global rules (permanent instructions, 50KB limit)
- **SkillsManager**: Keyword-matched skill files, auto-inject per mode
- **WorkflowLoader**: Slash-command workflows with explicit instructions wrapping
- **SupportPrompts**: Custom prompt templates with `{{userInput}}` / `{{activeFile}}` variables

### 3.5 Mastery System
- **RecipeMatchingService**: Keyword-first matching of procedural recipes (2000 chars budget)
- **EpisodicExtractor**: Records successful tool sequences without extra API calls
- **RecipePromotionService**: Auto-promotes patterns to recipes after 3+ successes
- **RecipeStore**: Persistent storage of learned recipes
- **staticRecipes**: Built-in recipes (pandoc export, file conversion)

### 3.6 API Layer
- **Anthropic provider**: `@anthropic-ai/sdk`, native streaming + tool calls
- **OpenAI-compatible provider**: Supports OpenAI, Ollama, LM Studio, Azure, OpenRouter, Google Gemini, custom endpoints
- **CodeConfigParser**: Auto-extract provider/URL/models from pasted code snippets

### 3.7 Sandbox Execution
- **AstValidator**: Pre-check TypeScript for blocked patterns (require, process, fs, child_process)
- **EsbuildWasmManager**: Compile TypeScript via esbuild-wasm, resolve npm dependencies from CDN (esm.sh, jsdelivr)
- **IframeSandboxExecutor**: Run compiled code in `<iframe sandbox="allow-scripts">` with CSP
- **SandboxBridge**: Cross-boundary mediation (vault I/O, HTTP, rate limiting)

### 3.8 Internationalization
- 6 languages: English, German, Spanish, Japanese, Simplified Chinese, Hindi
- 1008 translation keys per locale
- Lazy-load architecture, fallback to English

---

## 4. Architectural Significant Requirements (ASRs)

### Critical

**ASR-01: Isomorphic-Git Integration** (ADR-002)
- Shadow git repository at `.obsidian/plugins/obsilo-agent/checkpoints/`
- Status: Implemented

**ASR-02: Tool-Use Interception Layer** (ADR-001)
- All tool executions (internal + MCP) flow through central governance handler
- Status: Implemented

### Important

**ASR-mcp-01: MCP Client Integration**
- Bridges MCP tool calls to governance handler; stdio/SSE/HTTP transports
- Status: Implemented

**ASR-03: Local Vector Store** (ADR-003)
- vectra HNSW + Xenova Transformers (ONNX), hybrid search with RRF
- Status: Implemented

**ASR-04: 3-Tier Memory** (ADR-013)
- Chat History -> Session Summaries -> Long-Term Memory with async extraction
- Status: Implemented

**ASR-05: Global Storage** (ADR-020)
- Cross-vault settings and modes at ~/.obsidian-agent/ with Sync Bridge
- Status: Implemented

---

## 5. Technology Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Git | isomorphic-git | Pure JS, no system dependency |
| Vector DB | vectra (HNSW) | Lightweight, TypeScript-native, no native deps |
| Embeddings | @xenova/transformers | Local ONNX models, privacy-preserving |
| MCP Client | @modelcontextprotocol/sdk | Official implementation |
| LLM APIs | @anthropic-ai/sdk, openai | Direct provider integration |
| Search | @orama/orama, custom BM25 | Keyword search with stemming |
| PDF | pdfjs-dist, pdf-parse | PDF content extraction |
| Encryption | Electron safeStorage | OS keychain for API keys |
| Build | esbuild | Fast bundling to single main.js (~11 MB) |
| Lint | eslint + prettier | Code quality (incl. eslint-plugin-security) |
| Security | CodeQL (GitHub Actions) | Static analysis |

---

## 6. Data Flow Overview

### User Message -> Agent Response
1. User types in sidebar (with optional `/workflow`, `@file`, attachments)
2. AutocompleteHandler resolves mentions and workflows
3. AgentTask sends to LLM with system prompt + mode-filtered tools
4. LLM returns streamed text + tool calls
5. ToolExecutionPipeline executes each tool (6 steps):
   - Validate operation (IgnoreService)
   - Check auto-approval or show approval card
   - Create checkpoint (if write operation, via GitCheckpointService)
   - Execute tool
   - Log operation (OperationLogger)
   - Cache result (Pipeline Result Cache)
6. Tool results sent back to LLM
7. Context Condensing triggered if token threshold exceeded
8. Power Steering reminder injected every N iterations
9. Final response rendered in sidebar with diff-stats badges

### Memory Extraction (post-conversation)
1. Conversation ends (>= extractionThreshold messages)
2. Build minimal transcript (~8000 chars)
3. Enqueue PendingExtraction to persistent FIFO queue
4. SessionExtractor generates summary via LLM
5. LongTermExtractor promotes facts to user-profile/projects/patterns

---

## 7. Security & Safety Model

### Defense in Depth (4 layers)
1. **Path Validation**: IgnoreService (.obsidian-agentignore, .obsidian-agentprotected)
2. **Approval Layer**: Fail-closed — no callback = rejection (ADR-005)
3. **Checkpoint Layer**: Every write creates restore point via isomorphic-git
4. **Audit Layer**: JSONL operation log with PII scrubbing

### Additional Safety Mechanisms
- ToolRepetitionDetector prevents infinite tool loops (ADR-006)
- Plugin-API Allowlist for call_plugin_api
- ReadFile content truncation (20K chars)
- MCP per-mode whitelist
- SafeStorageService for API key encryption
- Content size limits (Rules 50KB, GlobalModeStore 500KB)
- Sandbox OS-level isolation for evaluate_expression (ADR-021): iframe sandbox, CSP, AST validation, blocked APIs

---

## 8. Tool Inventory (42 tools, 7 groups)

| Group | Count | Tools |
|-------|-------|-------|
| read | 3 | read_file, list_files, search_files |
| vault | 8 | get_frontmatter, search_by_tag, get_vault_stats, get_linked_notes, get_daily_note, open_note, semantic_search, query_base |
| edit | 11 | write_file, edit_file, append_to_file, create_folder, delete_file, move_file, update_frontmatter, generate_canvas, create_excalidraw, create_base, update_base |
| web | 2 | web_fetch, web_search |
| agent | 12 | ask_followup_question, attempt_completion, update_todo_list, new_task, switch_mode, update_settings, configure_model, evaluate_expression, manage_skill, manage_mcp_server, manage_source, read_agent_logs |
| skill | 5 | execute_command, execute_recipe, call_plugin_api, resolve_capability_gap, enable_plugin |
| mcp | 1 | use_mcp_tool |

---

## 9. Related Documents

- [arc42 Architecture](../architecture/arc42.md) — Full arc42 documentation (v3.4)
- [ADR Index](../architecture/) — 21 Architecture Decision Records
- [Backlog](../context/10_backlog.md) — Feature implementation status
- [Agent Internals](../implementation/TECH-agent-internals.md) — Deep technical internals
- [Component Designs](DESIGN-component-designs.md) — Detailed component specifications
- [Implementation Roadmap](ROADMAP-implementation.md) — 8-phase development plan
