# TECH: MCP Integration

Technical reference for Model Context Protocol (MCP) integration in Obsidian Agent.

Source files:
- `src/core/mcp/McpClient.ts` -- Connection management, transport handling, tool execution
- `src/core/tools/mcp/UseMcpToolTool.ts` -- LLM-facing bridge tool for MCP invocations
- `src/types/settings.ts` -- McpServerConfig, activeMcpServers

---

## 1. McpClient Overview

File: `src/core/mcp/McpClient.ts`

The McpClient is the central manager for all MCP server connections. It maintains a `Map<string, McpConnection>` that tracks each server's state, client instance, and discovered tools.

Design principles:
- Intentionally lean: no OAuth, no file-watching, no auto-reconnect.
- One `Client` instance (from `@modelcontextprotocol/sdk`) per server.
- All connections are managed through explicit connect/disconnect calls.

### Public Types

```typescript
interface McpToolInfo {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
}

type McpConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

interface McpConnection {
    name: string;
    config: McpServerConfig;
    client?: Client;
    tools: McpToolInfo[];
    status: McpConnectionStatus;
    error?: string;
}
```

---

## 2. Transport Types

The McpClient supports three transport mechanisms, selected by the `config.type` field:

### stdio
- Used for local processes (Node.js scripts, Python scripts, binaries).
- Requires `config.command` (the executable) and optional `config.args`.
- Creates a `StdioClientTransport` from the MCP SDK.
- Environment variables can be passed via `config.env`.

### sse (Server-Sent Events)
- Used for HTTP-based servers using the legacy SSE transport.
- Requires `config.url`.
- Supports custom headers via `config.headers` (passed to both EventSource and request init).
- Creates an `SSEClientTransport`.

### streamable-http
- Used for HTTP-based servers using the newer streamable HTTP transport.
- Requires `config.url`.
- Supports custom headers via `config.headers`.
- Creates a `StreamableHTTPClientTransport`.

---

## 3. Security: Command Validation

For stdio transports, the McpClient validates commands and arguments before execution:

```typescript
private validateStdioCommand(command: string, args: string[]): void {
    const DANGEROUS = /[;&|`$(){}[\]<>\\]/;
    if (DANGEROUS.test(command)) {
        throw new Error(`MCP stdio command contains shell metacharacters: "${command}"`);
    }
    for (const arg of args) {
        if (DANGEROUS.test(arg)) {
            throw new Error(`MCP stdio argument contains shell metacharacters: "${arg}"`);
        }
    }
}
```

This blocks shell injection via metacharacters. MCP commands are exec'd directly (not via shell), so characters like `;`, `|`, `$()` are suspicious and always rejected.

---

## 4. Connection Flow

### connect(name, config)

1. **Disabled check**: If `config.disabled === true`, the connection is stored with status `'disconnected'` and no client is created.
2. **Status update**: Connection set to `'connecting'`.
3. **Transport creation**: Based on `config.type` (stdio, sse, or streamable-http).
4. **Timeout race**: `client.connect(transport)` races against a configurable timeout (`config.timeout`, default 60 seconds).
5. **Tool discovery**: On successful connection, calls `client.listTools()` to populate `conn.tools`.
6. **Status finalization**: Set to `'connected'` on success, `'error'` on failure (with error message stored).

### connectAll(servers)

- Takes the full `Record<string, McpServerConfig>` from settings.
- Calls `connect()` for each server in parallel using `Promise.all`.
- Called once during plugin startup (`onload`).

### disconnect(name)

- Calls `client.close()` on the MCP client instance.
- Clears the client reference, tools array, and resets status to `'disconnected'`.
- Close errors are silently ignored.

### disconnectAll()

- Disconnects all servers in parallel.
- Clears the connections map entirely.
- Called during plugin unload.

---

## 5. Tool Execution

### callTool(serverName, toolName, args)

```typescript
async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
): Promise<string>
```

Execution flow:
1. **Server lookup**: Finds the connection by name. Returns error string if not found.
2. **Status check**: Verifies the server is `'connected'` with an active client.
3. **SDK call**: Invokes `client.callTool({ name: toolName, arguments: args })`.
4. **Response extraction**: Filters for `text` content blocks, joins with newlines.
5. **Error handling**: Returns error strings (not thrown exceptions) for all failure cases.

Response handling:
- Empty responses: `'(no output)'`
- Non-text responses: `'(non-text response)'`
- SDK errors: formatted as `'Error calling {tool} on {server}: {message}'`

---

## 6. UseMcpToolTool (LLM Bridge)

File: `src/core/tools/mcp/UseMcpToolTool.ts`

This tool is the interface the LLM uses to invoke MCP tools. It is registered in the tool registry and exposed to the model.

### Tool Definition

```typescript
{
    name: 'use_mcp_tool',
    input_schema: {
        properties: {
            server_name: { type: 'string' },  // MCP server name from settings
            tool_name: { type: 'string' },     // Tool to invoke on that server
            arguments: { type: 'object' },     // Tool arguments (optional)
        },
        required: ['server_name', 'tool_name'],
    }
}
```

### Write Operation Classification
`isWriteOperation = true` -- MCP tools are dynamic and may perform writes, deletes, or destructive operations. Treating them as write operations ensures the ToolExecutionPipeline applies approval checks via the `'mcp'` tool group.

### Execution Flow

1. **Input validation**: Checks that `server_name` and `tool_name` are present.
2. **Server whitelist check**: Verifies `server_name` is in `settings.activeMcpServers` (if the list is non-empty). This is the per-mode MCP server filtering mechanism.
3. **Delegation**: Calls `mcpClient.callTool(server_name, tool_name, args)`.
4. **Result forwarding**: Pushes the string result to `callbacks.pushToolResult()`.

---

## 7. Per-Mode Server Whitelist

The `activeMcpServers` setting controls which MCP servers are available to the agent in the current session.

- Stored in `settings.activeMcpServers` as `string[]`.
- When the array is non-empty, only listed servers can be called via `use_mcp_tool`.
- When empty (default), all connected servers are accessible.
- The UI provides a tool picker (pocket-knife button) in the chat toolbar to toggle servers.
- This mechanism allows different modes to restrict MCP server access without reconfiguring connections.

The check is performed in `UseMcpToolTool.execute()`:
```typescript
const activeMcpServers: string[] = (this.plugin.settings as any).activeMcpServers ?? [];
if (activeMcpServers.length > 0 && !activeMcpServers.includes(server_name)) {
    // Error: server not enabled
}
```

---

## 8. Introspection API

The McpClient exposes read-only methods for UI and system prompt construction:

### getConnections(): McpConnection[]
Returns all connection entries (regardless of status).

### getConnection(name): McpConnection | undefined
Returns a specific connection by server name.

### getAllTools(): { serverName: string; tool: McpToolInfo }[]
Returns a flat list of all tools across all connected servers. Only includes servers with status `'connected'`. Used to build the MCP tools section in the system prompt.

---

## 9. Lifecycle

### Plugin Startup (onload)

```
plugin.onload()
    |
    v
mcpClient = new McpClient()
    |
    v
mcpClient.connectAll(settings.mcpServers)
    |
    +-- For each server: connect(name, config) in parallel
    |   +-- Create transport (stdio/sse/streamable-http)
    |   +-- client.connect(transport) with timeout
    |   +-- client.listTools() for tool discovery
    |
    v
MCP tools available in system prompt
```

### Plugin Unload

```
plugin.onunload()
    |
    v
mcpClient.disconnectAll()
    |
    +-- For each server: client.close() in parallel
    |
    v
All connections cleared
```

---

## 10. Error Handling

### Connection Errors
- Timeout: `Promise.race` against configurable timeout (default 60s). Throws `"Connection to "{name}" timed out"`.
- Transport errors: Caught and stored in `conn.error`. Connection status set to `'error'`.
- Missing config: Throws immediately for missing command (stdio) or URL (sse/streamable-http).

### Tool Call Errors
- Server not configured: Returns error string (does not throw).
- Server not connected: Returns error string including current status and error message.
- SDK call failure: Caught and returned as formatted error string.

### Security Errors
- Shell metacharacters in stdio commands/args: Throws before creating transport.

All error paths produce user-readable strings rather than thrown exceptions, because the LLM needs to see the error as a tool result and potentially retry or inform the user.

---

## 11. Settings Configuration

Defined in `src/types/settings.ts`:

```typescript
interface McpServerConfig {
    type: 'stdio' | 'sse' | 'streamable-http';
    command?: string;         // stdio only
    args?: string[];          // stdio only
    env?: Record<string, string>;  // stdio only
    url?: string;             // sse/streamable-http
    headers?: Record<string, string>;  // sse/streamable-http
    disabled?: boolean;       // Skip during connectAll
    timeout?: number;         // Connection timeout in seconds (default: 60)
    alwaysAllow?: string[];   // Reserved for future per-tool auto-approval
}
```

Servers are stored in `settings.mcpServers` as `Record<string, McpServerConfig>` where the key is the server name used for identification throughout the system.
