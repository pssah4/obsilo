import { Plugin, WorkspaceLeaf, Notice } from 'obsidian';
import { ObsidianAgentSettings, DEFAULT_SETTINGS, BUILT_IN_MODELS, getModelKey, modelToLLMProvider } from './types/settings';
import type { CustomModel } from './types/settings';
import { AgentSidebarView, VIEW_TYPE_AGENT_SIDEBAR } from './ui/AgentSidebarView';
import { AgentSettingsTab } from './ui/AgentSettingsTab';
import { ToolRegistry } from './core/tools/ToolRegistry';
import { ToolExecutionPipeline } from './core/tool-execution/ToolExecutionPipeline';
import { buildApiHandler } from './api/index';
import type { ApiHandler } from './api/types';
import type { ToolUse, ToolCallbacks } from './core/tools/types';
// import { AgentProvider } from './core/AgentProvider';
// import { McpHub } from './services/mcp/McpHub';
// import { GlobalCheckpointService } from './services/checkpoints/GlobalCheckpointService';
// import { SemanticIndexService } from './services/semantic-index/SemanticIndexService';

/**
 * Obsidian Agent Plugin
 *
 * An agentic operating layer for Obsidian that provides:
 * - Approval-based vault operations
 * - Local checkpoints with restore capability
 * - MCP (Model Context Protocol) support
 * - Semantic search and indexing
 * - Multiple agent modes
 *
 * Architecture:
 * - Tool Execution Pipeline: Central governance for all operations
 * - Shadow Checkpoint System: isomorphic-git based version control
 * - MCP Integration: External tool extensibility
 * - Semantic Index: Local vector search
 */
export default class ObsidianAgentPlugin extends Plugin {
    settings: ObsidianAgentSettings;
    toolRegistry: ToolRegistry;
    apiHandler: ApiHandler | null = null;
    // provider: AgentProvider;
    // mcpHub: McpHub;
    // checkpointService: GlobalCheckpointService;
    // semanticIndex: SemanticIndexService;

    /**
     * Plugin initialization
     *
     * Lifecycle:
     * 1. Load settings
     * 2. Initialize core services
     * 3. Register UI views
     * 4. Register commands
     * 5. Initialize MCP connections
     * 6. Start semantic indexing
     */
    async onload() {
        console.log('Loading Obsidian Agent plugin');

        // 1. Load settings
        await this.loadSettings();

        // 2. Initialize core services
        // Phase 1: Tool registry (ToolExecutionPipeline created per-task)
        this.toolRegistry = new ToolRegistry(this);

        // Phase 4: LLM provider (null if no API key configured)
        this.initApiHandler();

        // TODO: Phase 1 - Uncomment when services are implemented
        // this.provider = new AgentProvider(this);
        // this.mcpHub = new McpHub(this.provider);
        // this.checkpointService = new GlobalCheckpointService(this);
        // this.semanticIndex = new SemanticIndexService(this);

        // 3. Register UI views
        this.registerView(
            VIEW_TYPE_AGENT_SIDEBAR,
            (leaf) => new AgentSidebarView(leaf, this)
        );

        // 4. Register commands
        this.addCommand({
            id: 'open-agent-sidebar',
            name: 'Open Agent Sidebar',
            callback: () => this.activateView()
        });

        // Development: Test tool execution
        this.addCommand({
            id: 'test-tool-execution',
            name: 'Test Tool Execution',
            callback: () => this.testToolExecution()
        });

        // 5. Register settings tab
        this.addSettingTab(new AgentSettingsTab(this.app, this));

        // 7. Initialize MCP connections
        // TODO: Phase 6 - Uncomment when MCP is implemented
        // await this.mcpHub.initialize();

        // 8. Start semantic indexing (background)
        // TODO: Phase 7 - Uncomment when semantic index is implemented
        // this.semanticIndex.startIndexing();

        console.log('Obsidian Agent plugin loaded successfully');
    }

    /**
     * Plugin cleanup
     */
    async onunload() {
        console.log('Unloading Obsidian Agent plugin');

        // Dispose of services
        // TODO: Uncomment when services are implemented
        // await this.mcpHub.dispose();
        // await this.semanticIndex.dispose();
        // this.provider.dispose();

        console.log('Obsidian Agent plugin unloaded');
    }

    /**
     * Load plugin settings from disk
     */
    async loadSettings() {
        const saved = (await this.loadData()) ?? {};
        this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
        // Ensure all built-in models are present (merge new built-ins after updates)
        this.settings.activeModels = this.mergeBuiltInModels(this.settings.activeModels ?? []);
    }

    /**
     * Merge strategy: preserve user's saved models (with their API keys / enabled state),
     * and append any built-in models that don't exist yet in saved data.
     */
    private mergeBuiltInModels(saved: CustomModel[]): CustomModel[] {
        const savedKeys = new Set(saved.map(getModelKey));
        const result = [...saved];
        for (const builtIn of BUILT_IN_MODELS) {
            if (!savedKeys.has(getModelKey(builtIn))) {
                result.push({ ...builtIn });
            }
        }
        return result;
    }

    /** Return the currently active CustomModel, or null if none configured */
    getActiveModel(): CustomModel | null {
        const key = this.settings.activeModelKey;
        if (!key) return null;
        return this.settings.activeModels.find((m) => getModelKey(m) === key) ?? null;
    }

    /**
     * Save plugin settings to disk and reinitialize API handler
     */
    async saveSettings() {
        await this.saveData(this.settings);
        this.initApiHandler();
    }

    /**
     * Initialize the API handler from current settings.
     * Called on load and whenever settings change.
     */
    initApiHandler(): void {
        const model = this.getActiveModel();

        if (!model) {
            if (this.settings.debugMode) {
                console.log('[Plugin] No active model configured');
            }
            this.apiHandler = null;
            return;
        }

        // Require API key for cloud providers
        if ((model.provider === 'anthropic' || model.provider === 'openai' || model.provider === 'openrouter') && !model.apiKey) {
            if (this.settings.debugMode) {
                console.log('[Plugin] API key not set for active model:', getModelKey(model));
            }
            this.apiHandler = null;
            return;
        }

        try {
            this.apiHandler = buildApiHandler(modelToLLMProvider(model));
            console.log(`[Plugin] API handler initialized: ${model.displayName ?? model.name} (${model.provider})`);
        } catch (error) {
            console.error('[Plugin] Failed to initialize API handler:', error);
            this.apiHandler = null;
        }
    }

    /**
     * Activate the agent sidebar view
     */
    async activateView() {
        const { workspace } = this.app;

        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE_AGENT_SIDEBAR);

        if (leaves.length > 0) {
            // View already exists, reveal it
            leaf = leaves[0];
        } else {
            // Create new leaf in right sidebar
            leaf = workspace.getRightLeaf(false);
            if (leaf) {
                await leaf.setViewState({
                    type: VIEW_TYPE_AGENT_SIDEBAR,
                    active: true,
                });
            }
        }

        // Reveal the view
        if (leaf) {
            workspace.revealLeaf(leaf);
        }
    }

    /**
     * Test tool execution (Development only)
     */
    async testToolExecution() {
        console.log('=== Testing Tool Execution ===');
        new Notice('Testing tool execution...');

        // Create a pipeline instance for testing
        const pipeline = new ToolExecutionPipeline(
            this,
            this.toolRegistry,
            'test-task-001',
            'ask'
        );

        // Create callbacks to collect results
        const results: string[] = [];
        const callbacks: ToolCallbacks = {
            pushToolResult: (content: string) => {
                results.push(content);
                console.log('Tool result:', content);
            },
            handleError: async (toolName: string, error: unknown) => {
                console.error(`Error in ${toolName}:`, error);
            },
            log: (message: string) => {
                console.log('Tool log:', message);
            }
        };

        try {
            // Test 1: Write then read to test roundtrip
            console.log('\n--- Test 1: Write test file ---');
            const writeTool: ToolUse = {
                type: 'tool_use',
                id: 'test-write-001',
                name: 'write_file',
                input: {
                    path: 'obsidian-agent-test.md',
                    content: `# Tool Execution Test\n\nTimestamp: ${new Date().toISOString()}\n\nAll systems operational!`
                }
            };
            await pipeline.executeTool(writeTool, callbacks);

            // Then read it back
            console.log('\n--- Test 2: Read back the test file ---');
            const readTool: ToolUse = {
                type: 'tool_use',
                id: 'test-read-001',
                name: 'read_file',
                input: { path: 'obsidian-agent-test.md' }
            };

            const readResult = await pipeline.executeTool(readTool, callbacks);
            console.log('Read result (content populated):', readResult.content.substring(0, 100) + '...');

            console.log('\n=== Tool Execution Test Complete ===');
            console.log('Results collected:', results.length);

            new Notice('Tool execution test complete! Check console and vault.');
        } catch (error) {
            console.error('Tool execution test failed:', error);
            new Notice('Tool execution test failed! Check console.');
        }
    }
}
