/**
 * McpClient — simplified MCP client for Obsilo Agent
 *
 * Manages connections to MCP servers (stdio, SSE, streamable-http) and
 * forwards tool calls from the agent to the appropriate server.
 *
 * Intentionally lean: no OAuth, no file-watching, no auto-reconnect.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpServerConfig } from '../../types/settings';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface McpToolInfo {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
}

export type McpConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

export interface McpConnection {
    name: string;
    config: McpServerConfig;
    client?: Client;
    tools: McpToolInfo[];
    status: McpConnectionStatus;
    error?: string;
}

// ---------------------------------------------------------------------------
// McpClient
// ---------------------------------------------------------------------------

export class McpClient {
    private connections = new Map<string, McpConnection>();

    // ── Connection management ──────────────────────────────────────────────

    async connectAll(servers: Record<string, McpServerConfig>): Promise<void> {
        await Promise.all(
            Object.entries(servers).map(([name, config]) => this.connect(name, config))
        );
    }

    async connect(name: string, config: McpServerConfig): Promise<void> {
        // Skip disabled servers
        if (config.disabled) {
            this.connections.set(name, { name, config, tools: [], status: 'disconnected' });
            return;
        }

        const conn: McpConnection = { name, config, tools: [], status: 'connecting' };
        this.connections.set(name, conn);

        try {
            const client = new Client({ name: 'obsidian-agent', version: '1.0.0' });

            let transport;
            if (config.type === 'stdio') {
                if (!config.command) throw new Error(`stdio server "${name}" has no command configured`);
                // H-4: Block commands containing shell metacharacters that could enable injection.
                // MCP commands are exec'd directly (not via shell), so these characters are suspicious.
                this.validateStdioCommand(config.command, config.args ?? []);
                transport = new StdioClientTransport({
                    command: config.command,
                    args: config.args ?? [],
                    env: config.env,
                });
            } else if (config.type === 'sse') {
                if (!config.url) throw new Error(`SSE server "${name}" has no URL configured`);
                const sseOptions: Record<string, unknown> = {};
                if (config.headers && Object.keys(config.headers).length > 0) {
                    sseOptions.eventSourceInit = { headers: config.headers };
                    sseOptions.requestInit = { headers: config.headers };
                }
                transport = new SSEClientTransport(new URL(config.url), sseOptions);
            } else {
                if (!config.url) throw new Error(`streamable-http server "${name}" has no URL configured`);
                const httpOptions: Record<string, unknown> = {};
                if (config.headers && Object.keys(config.headers).length > 0) {
                    httpOptions.requestInit = { headers: config.headers };
                }
                transport = new StreamableHTTPClientTransport(new URL(config.url), httpOptions);
            }

            const timeoutMs = (config.timeout ?? 60) * 1000;
            await Promise.race([
                client.connect(transport),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error(`Connection to "${name}" timed out`)), timeoutMs)
                ),
            ]);

            const toolsResult = await client.listTools();
            conn.client = client;
            conn.tools = (toolsResult.tools ?? []).map((t) => ({
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema as Record<string, unknown> | undefined,
            }));
            conn.status = 'connected';
        } catch (e) {
            conn.status = 'error';
            conn.error = e instanceof Error ? e.message : String(e);
            console.error(`[McpClient] Failed to connect to "${name}":`, e);
        }
    }

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

    async disconnect(name: string): Promise<void> {
        const conn = this.connections.get(name);
        if (!conn?.client) return;
        try {
            await conn.client.close();
        } catch {
            // ignore close errors
        }
        conn.client = undefined;
        conn.tools = [];
        conn.status = 'disconnected';
        conn.error = undefined;
    }

    async disconnectAll(): Promise<void> {
        await Promise.all([...this.connections.keys()].map((name) => this.disconnect(name)));
        this.connections.clear();
    }

    // ── Tool execution ─────────────────────────────────────────────────────

    async callTool(
        serverName: string,
        toolName: string,
        args: Record<string, unknown>,
    ): Promise<string> {
        const conn = this.connections.get(serverName);
        if (!conn) {
            return `Error: MCP server "${serverName}" is not configured`;
        }
        if (conn.status !== 'connected' || !conn.client) {
            return `Error: MCP server "${serverName}" is not connected (status: ${conn.status}${conn.error ? ' — ' + conn.error : ''})`;
        }

        try {
            const result = await conn.client.callTool({ name: toolName, arguments: args });
            const content = result.content as Array<{ type: string; text?: string }> | undefined;
            if (!content || content.length === 0) return '(no output)';

            return content
                .filter((c) => c.type === 'text' && c.text != null)
                .map((c) => c.text as string)
                .join('\n') || '(non-text response)';
        } catch (e) {
            return `Error calling ${toolName} on ${serverName}: ${e instanceof Error ? e.message : String(e)}`;
        }
    }

    // ── Introspection ──────────────────────────────────────────────────────

    getConnections(): McpConnection[] {
        return [...this.connections.values()];
    }

    getConnection(name: string): McpConnection | undefined {
        return this.connections.get(name);
    }

    getAllTools(): { serverName: string; tool: McpToolInfo }[] {
        const results: { serverName: string; tool: McpToolInfo }[] = [];
        for (const conn of this.connections.values()) {
            if (conn.status === 'connected') {
                for (const tool of conn.tools) {
                    results.push({ serverName: conn.name, tool });
                }
            }
        }
        return results;
    }
}
