# Obsidian Agent - System Architecture Overview

**Version:** 1.0
**Date:** 2026-02-17
**Status:** Design Complete, Implementation Pending

---

## 1. Executive Summary

Obsidian Agent is a desktop-first Obsidian plugin that provides an agentic operating layer for vault operations. It adapts the Kilo Code architecture to the Obsidian context, replacing IDE operations with vault operations while maintaining the core patterns of tool governance, approval systems, checkpoints, and MCP extensibility.

### Key Architectural Principles

1. **Tool-Use Interception**: ALL tool executions (internal vault ops AND MCP) flow through a central governance layer
2. **Approval-by-Default**: Every write operation requires explicit user approval unless whitelisted
3. **Shadow Repository**: Isomorphic-git maintains checkpoints in `.obsidian-agent/checkpoints/`
4. **Local-Only**: No cloud dependencies except user-configured LLM providers
5. **Mode-Based Agents**: Different agent personas with scoped tool access and specialized prompts
6. **MCP Extensibility**: External tools integrate seamlessly through the governance layer

---

## 2. High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     OBSIDIAN PLUGIN HOST                         │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              ObsidianAgentPlugin (Entry Point)             │  │
│  │  - Plugin lifecycle (onload/unload)                        │  │
│  │  - Settings management                                     │  │
│  │  - Command registration                                    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│              ┌───────────────┼───────────────┐                  │
│              │               │               │                  │
│  ┌───────────▼────┐ ┌───────▼────────┐ ┌───▼──────────────┐  │
│  │   UI Layer     │ │  Core Engine    │ │  Service Layer    │  │
│  │  (Sidebar)     │ │  (Task Runner)  │ │  (Infrastructure) │  │
│  └────────────────┘ └─────────────────┘ └──────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
         │                      │                      │
         ▼                      ▼                      ▼
  ┌──────────────┐    ┌─────────────────┐    ┌────────────────┐
  │ Chat View    │    │ Tool Execution  │    │ Checkpoint     │
  │ Mode Selector│    │ Pipeline        │    │ Service        │
  │ Context UI   │    │ (Governance)    │    │ (isomorphic-   │
  └──────────────┘    └─────────────────┘    │     git)       │
                               │               └────────────────┘
                               ▼
                      ┌─────────────────┐
                      │ Tool Registry   │
                      │ - Vault Ops     │
                      │ - MCP Tools     │
                      │ - System Tools  │
                      └─────────────────┘
```

---

## 3. Core Subsystems

### 3.1 UI Layer
- **AgentSidebarView**: Main chat interface
- **Mode Selector**: Switch between agent personas
- **Approval Cards**: Visual approval prompts for tool operations
- **Context Indicator**: Shows active file and pinned context

### 3.2 Core Engine
- **Task**: Main orchestrator for agent conversations
- **ToolExecutionPipeline**: Central governance for all tool calls
- **ToolRegistry**: Registry of internal and MCP tools
- **ModeManager**: Manages agent personas and tool access

### 3.3 Service Layer
- **ShadowCheckpointService**: isomorphic-git based version control
- **McpHub**: MCP client for external tool integration
- **SemanticIndexService**: Local vector search with Orama
- **ContextManager**: Aggregates context from active files and mentions

### 3.4 API Layer
- **ApiHandler**: LLM provider abstraction (Anthropic, OpenAI, Ollama)
- **Streaming**: Token streaming and tool call parsing

---

## 4. Architectural Significant Requirements (ASRs)

### 🔴 Critical ASRs

**ASR-01: Isomorphic-Git Integration**
- Must implement a shadow git repository within `.obsidian-agent/checkpoints`
- Satisfies: Checkpoint system without external git dependency
- Impact: Core safety feature

**ASR-02: Tool-Use Interception Layer**
- Architecture must force all tool executions (Internal OR MCP) through a central governance handler
- Satisfies: Approval-by-default requirement
- Impact: Core safety and governance feature

### 🟡 Important ASRs

**ASR-mcp-01: MCP Client Integration**
- Must bridge MCP tool calls to the central governance handler
- Satisfies: Extensibility requirement
- Impact: Enables external tool ecosystem

**ASR-03: Local Vector Store Abstraction**
- Must support pluggable local embedding generation and storage
- Satisfies: Semantic search requirement
- Impact: Knowledge retrieval capability

---

## 5. Key Design Decisions

### Decision: Central Tool Execution Pipeline
**Why**: Ensures 100% governance coverage for all tool calls (internal + MCP)
**Trade-off**: Single point of execution, but provides guaranteed safety

### Decision: Shadow Repository per Task
**Why**: Isolated checkpoint history per conversation
**Trade-off**: More disk space, but clean separation and easy cleanup

### Decision: Mode-Based Tool Filtering
**Why**: Clear user expectations and prevents accidental destructive operations
**Trade-off**: Less flexible than per-tool toggles, but simpler UX

### Decision: Local-Only Semantic Index
**Why**: Privacy preservation and no external dependencies
**Trade-off**: Limited by local compute, but acceptable for desktop

---

## 6. Technology Stack Summary

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Git | isomorphic-git | Pure JS, no system dependency |
| Vector DB | Orama | Lightweight, embedded, no native deps |
| Embeddings | @xenova/transformers | Local ONNX models, privacy-preserving |
| MCP Client | @modelcontextprotocol/sdk | Official implementation |
| LLM APIs | @anthropic-ai/sdk, openai | Direct provider integration |

---

## 7. Data Flow Overview

### User Message → Agent Response
1. User types in sidebar
2. ContextManager builds context (active file + mentions)
3. Task sends to LLM with system prompt + tools
4. LLM returns text + tool calls
5. ToolExecutionPipeline executes each tool:
   - Validate operation (ignore/protect checks)
   - Request approval if needed
   - Create checkpoint (if write operation)
   - Execute tool
   - Log operation
6. Tool results sent back to LLM
7. Final response rendered in sidebar

### Tool Execution Flow
1. Tool call enters ToolExecutionPipeline
2. Validate against .obsidian-agentignore
3. Check auto-approval rules
4. Show approval UI if needed
5. Create checkpoint (write operations only)
6. Execute tool (internal or MCP)
7. Log operation
8. Return result

---

## 8. Security & Safety Model

### Defense in Depth
1. **Approval Layer**: User must approve write operations
2. **Ignore System**: `.obsidian-agentignore` prevents access to sensitive files
3. **Protected System**: `.obsidian-agentprotected` requires explicit approval
4. **Checkpoint Layer**: Every write creates restore point
5. **Operation Log**: Audit trail of all actions
6. **Dry Run**: Preview mode available

### Threat Model
- **Risk**: Accidental data loss → **Mitigation**: Approval + Checkpoints
- **Risk**: Malicious MCP server → **Mitigation**: Approval required for MCP tools
- **Risk**: Privacy leak → **Mitigation**: Local-only by default

---

## 9. Performance Considerations

### Scalability Targets
- Vault size: Support up to 10,000 markdown files
- Indexing: Background, < 20% CPU usage
- Checkpoint creation: < 2 seconds perceived latency
- Plugin startup: < 1 second

### Optimization Strategies
- Lazy loading of MCP connections
- Incremental semantic indexing
- Debounced file watching
- Async checkpoint operations

---

## 10. Future Evolution

### Post-MVP Enhancements
- Mobile support (requires alternative to isomorphic-git)
- Parallel agent execution (orchestrator subtasks)
- Canvas auto-creation from prompts
- Template automation
- Advanced graph analysis

### Extension Points
- Custom tool development API
- Plugin hooks for other Obsidian plugins
- Alternative vector DB backends
- Custom embedding models

---

## 11. Reference Architecture

This architecture adapts **Kilo Code** (forked-kilocode/) for the Obsidian context:
- Tool execution pipeline → Adapted from Kilo Code's provider system
- Approval system → Adapted from Kilo Code's ask/approval flow
- Checkpoint system → Adapted from Kilo Code's shadow git (using isomorphic-git)
- MCP integration → Direct port from Kilo Code's MCP hub
- Mode system → Adapted from Kilo Code's agent modes

---

## Related Documents

- [Component Designs](component-designs.md) - Detailed component specifications
- [Data Flows](data-flows.md) - Sequence diagrams and flows
- [Interfaces](interfaces.md) - TypeScript interface definitions
- [Implementation Roadmap](implementation-roadmap.md) - 8-phase development plan
- [ADRs](adrs.md) - Architecture decision records
