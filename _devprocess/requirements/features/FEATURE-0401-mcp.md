# FEATURE: MCP Client & Tools

**Status:** Implemented
**Source:** `src/core/mcp/McpClient.ts`, `src/core/tools/mcp/UseMcpToolTool.ts`

## Summary
Model Context Protocol client that connects to external MCP servers and exposes their tools to the agent. Supports stdio (local processes), SSE (remote HTTP), and streamable-HTTP transports. Connected tools are dynamically injected into the system prompt and callable via `use_mcp_tool`.

## How It Works

### Transport Types
| Type | How | Use Case |
|------|-----|----------|
| `stdio` | Spawns local process, stdin/stdout | Local scripts, npx-based servers |
| `sse` | HTTP GET + Server-Sent Events | Remote hosted tools |
| `streamable-http` | Bidirectional HTTP streaming | Modern MCP servers |

### Connection Flow (`connect(name, config)`)
1. Skip if `config.disabled = true`
2. Create MCP `Client` with name `'obsidian-agent'`
3. Create transport based on `config.type`
4. `client.connect(transport)` with timeout (`config.timeout` seconds, default 60)
5. `client.listTools()` → store discovered tools in `McpConnection.tools[]`
6. Status: `connecting` → `connected` (or `error` on failure)

### Security: Stdio Command Validation
Before spawning any stdio MCP process, `validateStdioCommand()` checks command and all args for shell metacharacters: `;`, `&`, `|`, `` ` ``, `$`, `(`, `)`, `{`, `}`, `[`, `]`, `<`, `>`, `\`. Rejects with error if found. Prevents command injection.

### Tool Discovery
`getAllTools()` — returns `{ serverName, tool }[]` for all connected servers. Used by `systemPrompt.ts` to inject the MCP tool list into the system prompt dynamically:

```
Connected servers and their tools:
  - filesystem: read_file — Read complete contents of a file
  - github: create_issue — Create a GitHub issue
```

### Tool Execution (`use_mcp_tool`)
`UseMcpToolTool.execute({ server_name, tool_name, arguments })`:
1. Validates `server_name` is in allowed servers (per-mode whitelist check)
2. Calls `mcpClient.callTool(serverName, toolName, args)`
3. Returns text content from MCP response

`callTool()` flow:
- Checks server connection status
- `client.callTool({ name, arguments })`
- Extracts `text` type content blocks from response
- Returns joined text or `(no output)` / `(non-text response)` fallbacks

### Per-Mode Server Whitelist
`allowedMcpServers` parameter in `AgentTask.run()` → passed to `buildSystemPromptForMode()`.
When non-empty, only listed servers appear in the system prompt tool list.

Configured in `settings.modeMcpServers[modeSlug]`:
```typescript
modeMcpServers: Record<string, string[]>
// empty/missing = all servers allowed
```

### Global Server Whitelist
`settings.activeMcpServers: string[]`
- Empty = all configured servers active
- Non-empty = only listed server names are active

### alwaysAllow
`McpServerConfig.alwaysAllow?: string[]` — tool names on this server that never require user approval. Checked in the approval flow (currently handled at `use_mcp_tool` tool level, not pipeline level — see limitation).

### Lifecycle
- `connectAll(servers)` — called on plugin load and when MCP settings change
- `disconnectAll()` — called on plugin unload
- `disconnect(name)` / `connect(name, config)` — for manual connect/disconnect from settings UI

## Key Files
- `src/core/mcp/McpClient.ts`
- `src/core/tools/mcp/UseMcpToolTool.ts`
- `src/ui/settings/McpTab.ts` — add/edit/delete servers, connect/disconnect
- `src/core/systemPrompt.ts` — dynamic MCP tool injection
- `src/types/settings.ts` — `McpServerConfig` type

## Dependencies
- `@modelcontextprotocol/sdk` npm package — official MCP client SDK
- `ObsidianAgentPlugin.mcpClient` — singleton, initialized in `main.ts`
- `ObsidianAgentPlugin.settings.mcpServers` — server configs
- `ObsidianAgentPlugin.settings.activeMcpServers` — global whitelist
- `AgentTask.run()` — receives `mcpClient` and `allowedMcpServers` params
- `ToolExecutionPipeline` — approves/logs `use_mcp_tool` calls

## Configuration
| Key | Default | Description |
|-----|---------|-------------|
| `mcpServers` | `{}` | Server configs keyed by name |
| `activeMcpServers` | `[]` | Global whitelist (empty = all) |
| `modeMcpServers` | `{}` | Per-mode server whitelist |
| `autoApproval.mcp` | false | Auto-approve MCP tool calls |

### McpServerConfig Fields
| Field | Type | Description |
|-------|------|-------------|
| `type` | string | `stdio` \| `sse` \| `streamable-http` |
| `command` | string | (stdio) command to run |
| `args` | string[] | (stdio) command arguments |
| `env` | object | (stdio) environment variables |
| `url` | string | (sse/http) server URL |
| `headers` | object | (sse/http) HTTP headers |
| `timeout` | number | Connection timeout in seconds (default 60) |
| `alwaysAllow` | string[] | Tool names that never need approval |
| `disabled` | boolean | Temporarily disable without removing |

## Known Limitations / Edge Cases
- No auto-reconnect — if an MCP server crashes, it stays in `error` state until user manually reconnects from settings.
- `alwaysAllow` is parsed from config but approval bypass logic is not fully wired into `ToolExecutionPipeline`. MCP tools go through normal approval flow (mcp group). Needs explicit implementation.
- SSE transport requires Obsidian's network permissions — may not work with all private/internal servers.
- Stdio processes inherit the plugin's environment; sensitive variables from parent process may leak to spawned processes.
- No message transport for binary content — only text output from MCP tools is extracted.
- Error messages from MCP server failures are returned as tool result text (not as `is_error=true`), so the agent may not detect errors reliably.
