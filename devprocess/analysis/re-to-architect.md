# RE → Architect Handoff - Obsidian Agent
Scope: C (MVP - Clone)
Date: 2026-02-16

## P0/P1 Feature List
- **Core:** Interaction Modes, Context Awareness (Active File/Tabs), Provider Management.
- **Core (added for parity):** Custom Instructions / Custom Modes / Vault Rules; Browser Tool; Attachments (Images/Clipboard).
- **Extensibility:** MCP Support (Client).
- **Ops:** Vault CRUD, Content Editing, Canvas Projection.
- **Governance:** Approval System, Local Checkpoints (git).
- **Knowledge:** Semantic Index, Workflows.

## Top Success Criteria (3-5)
1. **Safety:** 100% of write operations (Internal or MCP) require user approval (default).
2. **Revert:** Every action creates a git commit in `.obsidian-agent/checkpoints`.
3. **Extensibility:** Can connect to standard MCP servers (stdio).
4. **Context:** Agent "sees" the active Obsidian file automatically.

## Top NFRs (3-5, quantified)
1. **Latency:** Editor remains responsive (UI < 100ms lag) even during background indexing/MCP calls.
2. **Privacy:** Zero egress by default. All egress (LLM/MCP) requires explicit config.
3. **Startup:** Plugin loads fully < 1s.

## ASRs (critical first)
- 🔴 **ASR-01: Isomorphic-Git** (for Checkpoints).
- 🔴 **ASR-02: Tool Interception Layer** (Central Governance for ALL tools).
- 🟡 **ASR-mcp-01: MCP Client** (Integration with Interception Layer).
- 🟡 **ASR-03: Local Vector Store** (Pluggable abstraction).

## Constraints / Non-negotiables
- **Desktop First:** Focus on Electron/Node.js environment features.
- **No Remote Backend:** We do not host a server. Everything is local or direct-to-provider.
- **Obsidian API:** Must play nice with other plugins (use standard Vault API).

## Decision requests for Architect (max 5)
1. **MCP Transport:** Confirm support for `stdio` transport within Electron renderer vs main process constraints?
2. **Vector DB:** Recommendation for best "Embedded" vector DB for usage within Obsidian (WASM vs SQLite)?
3. **Context Window:** Strategy for "pinning" huge files? (RAG vs Context Window stuffing).

## Risks & Dependencies
- **Risk:** MCP servers requiring full Node.js environment might struggle in restricted Electron contexts (need detailed technical feasibility check).
- **Risk:** Large vaults (>10k notes) choking the semantic indexer.
- **Risk:** Browser/URL fetch may require sandboxing and explicit network permissions to preserve local-first/privacy guarantees.

## Parity Notes vs `origin/forked-kilocode`
Evidence: `requirements/forked-kilocode-filetree.md`

Upstream capabilities that are now explicitly captured in requirements:
- Custom Instructions / Custom Modes / Rules: `requirements/features/FEATURE-custom-instructions-modes-rules.md`
- Browser tool & URL fetch: `requirements/features/FEATURE-browser-tool.md`
- Attachments / clipboard / images: `requirements/features/FEATURE-attachments-clipboard-images.md`
- Budget limits + rate limit handling: updated in `requirements/features/FEATURE-provider-management.md`
- Context condensing + truncation transparency: updated in `requirements/features/FEATURE-context-management.md`
- Follow-up suggestions + task resume: updated in `requirements/features/FEATURE-core-interaction.md`
- Auto-approval limits: updated in `requirements/features/FEATURE-approval-safety.md`

Upstream capabilities intentionally not pulled into Obsidian Agent MVP (local-only Obsidian scope):
- Team/cloud billing and org dashboards
- Full IDE autocomplete/inline completion stack
- Telemetry/analytics pipelines (may be added later)

## ORCHESTRATOR SUMMARY (<= 15 lines)
- Scope: MVP Clone of Kilo Code for Obsidian.
- Epics count: 3
- P0 features: 6 (Core, Context, Approval, Checkpoints, Ops, Content)
- P1 features: 4 (MCP, Provider, Semantic, Workflow)
- Top SC: Safety (Approval) + Extensibility (MCP) + Revert (Git).
- Top NFR: UI Responsiveness.
- Constraints: Local-only, Desktop-first.
- Open decisions: MCP transport in Electron, Vector DB choice.
- Next step: Switch to Architect Integration.
