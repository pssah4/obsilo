/**
 * Tools Section
 *
 * Generates tool descriptions filtered by the active mode's tool groups.
 * Tool metadata comes from the central toolMetadata.ts (single source of truth).
 * MCP tools are dynamically listed from connected servers when available.
 */

import type { ToolGroup } from '../../../types/settings';
import type { McpClient } from '../../mcp/McpClient';
import { buildToolPromptSection } from '../../tools/toolMetadata';

export function getToolsSection(
    toolGroups: ToolGroup[],
    mcpClient?: McpClient,
    allowedMcpServers?: string[],
): string {
    const parts: string[] = [
        '====', '', 'TOOLS', '',
        'You have access to these tools. Use them proactively — do not guess at file contents or vault structure.', '',
    ];

    // Generate non-MCP tool descriptions from central metadata
    const nonMcpGroups = toolGroups.filter((g) => g !== 'mcp');
    if (nonMcpGroups.length > 0) {
        parts.push(buildToolPromptSection(nonMcpGroups));
    }

    // MCP tools: dynamic listing from connected servers when available
    if (toolGroups.includes('mcp')) {
        if (mcpClient) {
            const rawMcpTools = mcpClient.getAllTools();
            const allMcpTools = (allowedMcpServers && allowedMcpServers.length > 0)
                ? rawMcpTools.filter(({ serverName }) => allowedMcpServers.includes(serverName))
                : rawMcpTools;
            if (allMcpTools.length > 0) {
                const toolLines = allMcpTools.map(({ serverName, tool }) =>
                    `  - ${serverName}: ${tool.name}${tool.description ? ' — ' + tool.description : ''}`
                ).join('\n');
                parts.push(
                    `**MCP Tools (via use_mcp_tool):**\n` +
                    `- use_mcp_tool(server_name, tool_name, arguments): Call a tool on a connected MCP server.\n\n` +
                    `Connected servers and their tools:\n${toolLines}`
                );
            } else {
                parts.push(buildToolPromptSection(['mcp']));
            }
        } else {
            parts.push(buildToolPromptSection(['mcp']));
        }
        parts.push('');
    }

    return parts.join('\n');
}
