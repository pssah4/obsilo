# Feature: MCP Support (Model Context Protocol)
Priority: P1
Related Epic: `requirements/epics/EPIC-core-engine.md`

## Description
Implements the Model Context Protocol (MCP) Client within Obsidian Agent. This allows the agent to connect to external MCP servers (running locally or remotely) to extend its toolset beyond the built-in Obsidian operations.

## Benefits Hypothesis
- **Extensibility:** Users can give the agent access to external data (Postgres, Linear, GitHub, Google Drive) without Obsidian Agent needing native integrations for each.
- **Ecosystem:** Leverages the growing ecosystem of MCP servers.
- **Customization:** Users can write their own simple MCP servers (e.g., python scripts) to give the agent specific capabilities.

## User Stories
- As a user, I want to configure a list of MCP servers (command commands or URLs) in settings.
- As a user, I want the agent to see tools provided by these servers (e.g., `fetch_url`, `query_db`) in its available toolset.
- As a user, I want to enable/disable specific MCP servers for specific Modes (e.g., only "Researcher" gets web access).

## Acceptance Criteria
- [ ] **Settings UI:** Interface to add/remove MCP server configurations (name, create command, env vars).
- [ ] **Client Implementation:** Obsidian Agent connects to configured servers on startup/demand.
- [ ] **Tool Registration:** Tools exposed by MCP servers appear in the agent's context.
- [ ] **Resource Access:** Agent can read resources exposed by MCP servers.
- [ ] **Transports:** Supports at least stdio-based local servers for MVP; SSE/HTTP is a P1/P2 extension.
- [ ] **Per-Mode Enablement:** Users can enable/disable MCP servers per Mode.
- [ ] **Error Handling:** Connection failures to MCP servers are reported but don't crash the plugin.
- [ ] **Governance:** MCP tool calls go through the same approval and logging pipeline as built-in tools.

## Success Criteria
- SC-01: Agent successfully executes a tool from a standard MCP server (e.g., `fetch` from `mcp-server-fetch`).
- SC-02: Connection to a local stdio-based MCP server is established < 1s.

## Non-functional requirements (quantified)
- **Stability:** Misbehaving MCP server (timeout/crash) does not free/crash Obsidian.
- **Security:** MCP tool execution is subject to the same Approval Governance as internal tools.

## ASRs
🟡 **ASR-mcp-01: MCP Client Integration**
- Must implement the MCP Client specification.
- Must bridge MCP tool calls to the central `ToolExecutionHandler` (ASR-02) for approval/logging.

## Dependencies
- `@modelcontextprotocol/sdk` (Node.js SDK).
- User must have necessary runtimes (Node, Python) for the servers they want to run.
