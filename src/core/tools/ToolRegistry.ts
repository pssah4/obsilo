/**
 * ToolRegistry - Manages all available tools
 *
 * Central registry for:
 * - Internal vault operation tools
 * - MCP tools (added in Phase 6)
 * - Tool lookup and discovery
 */

import type ObsidianAgentPlugin from '../../main';
import type { BaseTool } from './BaseTool';
import type { ToolName, ToolDefinition } from './types';

// Import tools — vault: read
import { ReadFileTool } from './vault/ReadFileTool';
import { ListFilesTool } from './vault/ListFilesTool';
import { SearchFilesTool } from './vault/SearchFilesTool';
// Import tools — vault: write
import { WriteFileTool } from './vault/WriteFileTool';
import { EditFileTool } from './vault/EditFileTool';
import { AppendToFileTool } from './vault/AppendToFileTool';
import { CreateFolderTool } from './vault/CreateFolderTool';
import { DeleteFileTool } from './vault/DeleteFileTool';
import { MoveFileTool } from './vault/MoveFileTool';
// Import tools — vault: intelligence (Phase 1.2)
import { GetFrontmatterTool } from './vault/GetFrontmatterTool';
import { UpdateFrontmatterTool } from './vault/UpdateFrontmatterTool';
import { SearchByTagTool } from './vault/SearchByTagTool';
import { GetVaultStatsTool } from './vault/GetVaultStatsTool';
import { GetLinkedNotesTool } from './vault/GetLinkedNotesTool';
import { OpenNoteTool } from './vault/OpenNoteTool';
import { GetDailyNoteTool } from './vault/GetDailyNoteTool';
// Import tools — vault: semantic search (Phase C2)
import { SemanticSearchTool } from './vault/SemanticSearchTool';
// Import tools — vault: canvas (Phase C3)
import { GenerateCanvasTool } from './vault/GenerateCanvasTool';
// Import tools — vault: bases (Phase C4)
import { CreateBaseTool } from './vault/CreateBaseTool';
import { UpdateBaseTool } from './vault/UpdateBaseTool';
import { QueryBaseTool } from './vault/QueryBaseTool';
// Import tools — web
import { WebFetchTool } from './web/WebFetchTool';
import { WebSearchTool } from './web/WebSearchTool';
// Import tools — agent control
import { AskFollowupQuestionTool } from './agent/AskFollowupQuestionTool';
import { AttemptCompletionTool } from './agent/AttemptCompletionTool';
import { UpdateTodoListTool } from './agent/UpdateTodoListTool';
import { SwitchModeTool } from './agent/SwitchModeTool';
import { NewTaskTool } from './agent/NewTaskTool';
// Plugin Skills (PAS-1)
import { ExecuteCommandTool } from './agent/ExecuteCommandTool';
import { ResolveCapabilityGapTool } from './agent/ResolveCapabilityGapTool';
import { EnablePluginTool } from './agent/EnablePluginTool';
// Plugin API + Recipe Shell (PAS-1.5)
import { CallPluginApiTool } from './agent/CallPluginApiTool';
import { ExecuteRecipeTool } from './agent/ExecuteRecipeTool';
// MCP tool
import { UseMcpToolTool } from './mcp/UseMcpToolTool';
import type { McpClient } from '../mcp/McpClient';

export class ToolRegistry {
    private tools: Map<ToolName, BaseTool>;
    private plugin: ObsidianAgentPlugin;

    constructor(plugin: ObsidianAgentPlugin, mcpClient?: McpClient) {
        this.plugin = plugin;
        this.tools = new Map();
        this.registerInternalTools();
        if (mcpClient) {
            this.register(new UseMcpToolTool(this.plugin, mcpClient));
        }
    }

    /**
     * Register all internal (built-in) tools
     */
    private registerInternalTools(): void {
        // Vault: read
        this.register(new ReadFileTool(this.plugin));
        this.register(new ListFilesTool(this.plugin));
        this.register(new SearchFilesTool(this.plugin));
        // Vault: write (Sprint 1.1)
        this.register(new WriteFileTool(this.plugin));
        this.register(new EditFileTool(this.plugin));
        this.register(new AppendToFileTool(this.plugin));
        this.register(new CreateFolderTool(this.plugin));
        this.register(new DeleteFileTool(this.plugin));
        this.register(new MoveFileTool(this.plugin));
        // Vault: intelligence (Phase 1.2)
        this.register(new GetFrontmatterTool(this.plugin));
        this.register(new UpdateFrontmatterTool(this.plugin));
        this.register(new SearchByTagTool(this.plugin));
        this.register(new GetVaultStatsTool(this.plugin));
        this.register(new GetLinkedNotesTool(this.plugin));
        this.register(new OpenNoteTool(this.plugin));
        this.register(new GetDailyNoteTool(this.plugin));
        // Vault: semantic search (Phase C2 — only active when index is built)
        this.register(new SemanticSearchTool(this.plugin));
        // Vault: canvas (Phase C3)
        this.register(new GenerateCanvasTool(this.plugin));
        // Vault: bases (Phase C4)
        this.register(new CreateBaseTool(this.plugin));
        this.register(new UpdateBaseTool(this.plugin));
        this.register(new QueryBaseTool(this.plugin));
        // Web (Phase 1.1)
        this.register(new WebFetchTool(this.plugin));
        this.register(new WebSearchTool(this.plugin));
        // Agent control (Sprint 1.2 / Phase 1.3 / Phase 3.1)
        this.register(new AskFollowupQuestionTool(this.plugin));
        this.register(new AttemptCompletionTool(this.plugin));
        this.register(new UpdateTodoListTool(this.plugin));
        this.register(new SwitchModeTool(this.plugin));
        this.register(new NewTaskTool(this.plugin));
        // Plugin Skills (PAS-1)
        this.register(new ExecuteCommandTool(this.plugin));
        this.register(new ResolveCapabilityGapTool(this.plugin));
        this.register(new EnablePluginTool(this.plugin));
        // Plugin API + Recipe Shell (PAS-1.5)
        this.register(new CallPluginApiTool(this.plugin));
        this.register(new ExecuteRecipeTool(this.plugin));

        console.log(`ToolRegistry: Registered ${this.getToolCount()} tools`);
    }

    /**
     * Register a tool
     */
    register(tool: BaseTool): void {
        if (this.tools.has(tool.name)) {
            console.warn(`ToolRegistry: Tool '${tool.name}' already registered, overwriting`);
        }
        this.tools.set(tool.name, tool);
    }

    /**
     * Get a tool by name
     */
    getTool(name: ToolName): BaseTool | undefined {
        return this.tools.get(name);
    }

    /**
     * Get all registered tools
     */
    getAllTools(): BaseTool[] {
        return Array.from(this.tools.values());
    }

    /**
     * Get tool definitions (schemas) for LLM
     */
    getToolDefinitions(): ToolDefinition[] {
        return this.getAllTools().map((tool) => tool.getDefinition());
    }

    /**
     * Get tool definitions filtered by allowed tools
     * (used by Mode system to restrict tool access)
     */
    getFilteredToolDefinitions(allowedTools: ToolName[]): ToolDefinition[] {
        return allowedTools
            .map((name) => this.getTool(name))
            .filter((tool): tool is BaseTool => tool !== undefined)
            .map((tool) => tool.getDefinition());
    }

    /**
     * Check if a tool exists
     */
    hasTool(name: ToolName): boolean {
        return this.tools.has(name);
    }

    /**
     * Get number of registered tools
     */
    getToolCount(): number {
        return this.tools.size;
    }

    /**
     * Register an MCP tool (Phase 6)
     */
    registerMcpTool(serverName: string, toolName: string, tool: BaseTool): void {
        // TODO: Phase 6 - MCP integration
        // For now, just register it like a normal tool
        this.register(tool);
    }

    /**
     * Unregister a tool
     */
    unregister(name: ToolName): boolean {
        return this.tools.delete(name);
    }

    /**
     * Clear all tools (useful for testing)
     */
    clear(): void {
        this.tools.clear();
    }
}
