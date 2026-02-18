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
// Import tools — web
import { WebFetchTool } from './web/WebFetchTool';
import { WebSearchTool } from './web/WebSearchTool';
// Import tools — agent control
import { AskFollowupQuestionTool } from './agent/AskFollowupQuestionTool';
import { AttemptCompletionTool } from './agent/AttemptCompletionTool';
import { UpdateTodoListTool } from './agent/UpdateTodoListTool';
import { SwitchModeTool } from './agent/SwitchModeTool';

export class ToolRegistry {
    private tools: Map<ToolName, BaseTool>;
    private plugin: ObsidianAgentPlugin;

    constructor(plugin: ObsidianAgentPlugin) {
        this.plugin = plugin;
        this.tools = new Map();
        this.registerInternalTools();
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
        // Web (Phase 1.1)
        this.register(new WebFetchTool(this.plugin));
        this.register(new WebSearchTool(this.plugin));
        // Agent control (Sprint 1.2 / Phase 1.3 / Phase 3.1)
        this.register(new AskFollowupQuestionTool(this.plugin));
        this.register(new AttemptCompletionTool(this.plugin));
        this.register(new UpdateTodoListTool(this.plugin));
        this.register(new SwitchModeTool(this.plugin));

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
        console.log(`ToolRegistry: Registered tool '${tool.name}'`);
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
