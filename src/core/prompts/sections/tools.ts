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
    webEnabled?: boolean,
    includeExamples = true,
): string {
    const parts: string[] = [
        '====', '', 'TOOLS', '',
        'You have access to these tools. Use them proactively — do not guess at file contents or vault structure.', '',
    ];

    // Generate non-MCP tool descriptions from central metadata.
    // When web tools are disabled, remove the 'web' group from the prompt
    // and insert a notice so the LLM knows the capability exists but is not configured.
    let nonMcpGroups = toolGroups.filter((g) => g !== 'mcp');
    if (!webEnabled && nonMcpGroups.includes('web')) {
        nonMcpGroups = nonMcpGroups.filter((g) => g !== 'web');
        parts.push('**Web:** Disabled. When the user asks for internet search, the ONLY reason is webTools.enabled=false. Ask the user for permission first: "Web search is currently disabled. Shall I enable it?" If they agree, call update_settings(action:"set", path:"webTools.enabled", value:true), then use web_search. Do NOT enable without asking. Do NOT mention API keys or providers — that is handled at runtime. Do NOT fall back to vault search.\n');
    }
    if (nonMcpGroups.length > 0) {
        parts.push(buildToolPromptSection(nonMcpGroups, includeExamples));
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
