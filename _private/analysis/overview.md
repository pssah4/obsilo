# Requirements Overview - Obsidian Agent
Scope: C (MVP - Clone)
Date: 2026-02-16

## Goal
Build a local-only, agentic operating layer for Obsidian that clones the "Kilo Code" experience: safe, governed vault operations, multi-provider support, and MCP extensibility.

## In/Out of Scope (top-level)
**In Scope (MVP):**
- Sidebar Chat & Mode System (Agent Personas)
- **Multi-Provider & Context Management** (New)
- **MCP (Model Context Protocol) Client** (New)
- Approval-by-default for all write/side-effect actions
- Local Checkpoints (isomorphic-git) with Diff & Restore
- Vault Operations (CRUD, Folder Ops)
- Canvas Graph Projection (via `.canvas` JSON generation)
- Semantic Index (Local Vector DB)
- Operation Logging

**Out of Scope (V1):**
- Direct manipulation of Obsidian internal Memory Graph
- Automation of "Bases" (Database) core plugin
- Full UI automation (clicking buttons/menus)
- Cloud backends or sync services
- Mobile support (initially desktop-only due to Node deps)

## Feature List (P0/P1)
| Priority | Feature Ref | Feature Name | File |
|---|---|---|---|
| P0 | CORE-01 | Agent Interaction & Modes | `requirements/features/FEATURE-core-interaction.md` |
| P0 | CORE-02 | Context Management (Active Files) | `requirements/features/FEATURE-context-management.md` |
| P0 | CORE-04 | Custom Instructions, Modes, and Rules | `requirements/features/FEATURE-custom-instructions-modes-rules.md` |
| P0 | GOV-01 | Approval System & Safety | `requirements/features/FEATURE-approval-safety.md` |
| P0 | GOV-02 | Local Checkpoints & Restore | `requirements/features/FEATURE-checkpoints.md` |
| P0 | OPS-01 | Vault Operations (CRUD) | `requirements/features/FEATURE-vault-ops.md` |
| P0 | OPS-02 | Controlled Content Editing | `requirements/features/FEATURE-content-editing.md` |
| P1 | EXT-01 | MCP Support (Extensibility) | `requirements/features/FEATURE-mcp-support.md` |
| P1 | CORE-03 | Provider & Cost Management | `requirements/features/FEATURE-provider-management.md` |
| P1 | CORE-05 | Browser Tool (Web Session + URL Fetch) | `requirements/features/FEATURE-browser-tool.md` |
| P1 | CORE-06 | Attachments, Clipboard, and Images | `requirements/features/FEATURE-attachments-clipboard-images.md` |
| P0 | VIS-01 | Canvas Graph Projection | `requirements/features/FEATURE-canvas-projection.md` |
| P1 | KNOW-01 | Semantic Index & Retrieval | `requirements/features/FEATURE-semantic-index.md` |
| P1 | FLOW-01 | Workflow Engine & Skills | `requirements/features/FEATURE-workflows.md` |

## Top Success Criteria (aggregated)
- SC-01 Users explicitly approve 100% of write operations before execution.
- SC-02 Every tool-based modification creates a restore point that can revert the file state.
- SC-03 Agent can successfully use external tools via MCP (e.g., fetch URL).
- SC-04 Retrieval operations find relevant context across the vault within acceptable time limits (local-only).
- SC-05 Users can seamlessly switch between Local (Ollama) and Cloud (LLM) providers per Mode.

## NFR Summary (quantified)
- **Performance:** Single file write + checkpoint < 2 seconds (perceived).
- **Availability:** Local-first; zero dependency on external APIs (unless user configures them).
- **Security:** No data leaves the local machine unless user explicitly configures a remote model provider/MCP.
- **Scalability:** Indexing supports vaults up to 10k markdown files without freezing the UI.

## ASR Summary (critical first)
🔴 **ASR-01: Isomorphic-Git Integration**
- Must implement a shadow git repository within `.obsidian-agent/checkpoints`.

🔴 **ASR-02: Tool-Use Interception Layer**
- Architecture must force all tool executions (Internal OR MCP) through a central governance handler.

🟡 **ASR-mcp-01: MCP Client Integration**
- Must bridge MCP tool calls to the central governance handler.

🟡 **ASR-03: Local Vector Store Abstraction**
- Must support pluggable local embedding generation and storage.

## Open Decisions (for Architecture)
1. Specific library selection for local vector storage.
2. Strategy for handling large file binaries (PDFs).
3. Exact command-ID whitelist for "safe" command execution.
