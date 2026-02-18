import { Plugin, WorkspaceLeaf, Notice, addIcon } from 'obsidian';
import { ObsidianAgentSettings, DEFAULT_SETTINGS, getModelKey, modelToLLMProvider } from './types/settings';
import type { CustomModel } from './types/settings';
import { AgentSidebarView, VIEW_TYPE_AGENT_SIDEBAR } from './ui/AgentSidebarView';
import { AgentSettingsTab } from './ui/AgentSettingsTab';
import { ToolRegistry } from './core/tools/ToolRegistry';
import { ToolExecutionPipeline } from './core/tool-execution/ToolExecutionPipeline';
import { IgnoreService } from './core/governance/IgnoreService';
import { OperationLogger } from './core/governance/OperationLogger';
import { GitCheckpointService } from './core/checkpoints/GitCheckpointService';
import { buildApiHandler } from './api/index';
import type { ApiHandler } from './api/types';
import type { ToolUse, ToolCallbacks } from './core/tools/types';

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
    ignoreService: IgnoreService;
    operationLogger: OperationLogger;
    checkpointService: GitCheckpointService;

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

        // Register custom plugin icon (hooded agent logo).
        // Uses fill-rule="evenodd" so inner subpaths punch transparent holes —
        // the hood rim is the outer minus the inner silhouette,
        // and the face has the eyes stamped out as transparent circles.
        addIcon('obsidian-agent', `
          <g fill="currentColor">
            <!-- Hood rim: outer cloak shape minus inner opening = just the border -->
            <path fill-rule="evenodd" d="
              M50 4 L8 30 L6 72 Q6 88 22 90 L78 90 Q94 88 94 72 L92 30 Z
              M50 16 L20 37 L18 72 Q18 84 30 85 L70 85 Q82 84 82 72 L80 37 Z
            "/>
            <!-- Face with eye holes stamped out -->
            <path fill-rule="evenodd" d="
              M50 22 L26 40 L24 67 Q24 79 38 80 L62 80 Q76 79 76 67 L74 40 Z
              M30 48 a7,7 0 1 0 14,0 a7,7 0 1 0 -14,0
              M56 48 a7,7 0 1 0 14,0 a7,7 0 1 0 -14,0
            "/>
            <!-- Smile: thin stroke rendered in the same currentColor,
                 slightly lighter via opacity so it reads as a mouth highlight -->
            <path fill="none" stroke="currentColor" stroke-opacity="0.35"
                  stroke-width="3" stroke-linecap="round"
                  d="M39 65 Q50 73 61 65"/>
          </g>
        `);

        // 1. Load settings
        await this.loadSettings();

        // 2. Initialize core services
        // Governance: ignore/protected path rules
        this.ignoreService = new IgnoreService(this.app.vault);
        await this.ignoreService.load();

        // Governance: persistent operation log + checkpoints
        const pluginDir = `.obsidian/plugins/${this.manifest.id}`;
        this.operationLogger = new OperationLogger(this.app.vault, pluginDir);
        await this.operationLogger.initialize();

        // Checkpoints (isomorphic-git shadow repo)
        this.checkpointService = new GitCheckpointService(
            this.app.vault,
            pluginDir,
            this.settings.checkpointTimeoutSeconds,
            this.settings.checkpointAutoCleanup,
        );
        if (this.settings.enableCheckpoints) {
            await this.checkpointService.initialize().catch((e) =>
                console.warn('[Plugin] Checkpoint service init failed (non-fatal):', e)
            );
        }

        // Tool registry (ToolExecutionPipeline created per-task)
        this.toolRegistry = new ToolRegistry(this);

        // LLM provider (null if no API key configured)
        this.initApiHandler();

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
        this.settings.activeModels = this.settings.activeModels ?? [];
        this.settings.webTools = this.settings.webTools ?? DEFAULT_SETTINGS.webTools;
        // Migrate old mode slugs to new built-in mode slugs (Phase 3.1)
        const OLD_MODE_MAP: Record<string, string> = { ask: 'librarian', code: 'writer' };
        if (OLD_MODE_MAP[this.settings.currentMode]) {
            this.settings.currentMode = OLD_MODE_MAP[this.settings.currentMode];
        }
        // Migrate source: 'custom' → 'vault' (introduced in Phase 3.1+)
        this.settings.globalCustomInstructions = this.settings.globalCustomInstructions ?? '';
        this.settings.modeModelKeys = this.settings.modeModelKeys ?? {};
        for (const mode of this.settings.customModes) {
            if ((mode.source as string) === 'custom') {
                mode.source = 'vault';
            }
        }
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
        if ((model.provider === 'anthropic' || model.provider === 'openai' || model.provider === 'openrouter' || model.provider === 'azure') && !model.apiKey) {
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
