import { Plugin, WorkspaceLeaf } from 'obsidian';
import { ObsidianAgentSettings, DEFAULT_SETTINGS } from './types/settings';
import { AgentSidebarView, VIEW_TYPE_AGENT_SIDEBAR } from './ui/AgentSidebarView';
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

        // 5. Initialize MCP connections
        // TODO: Phase 6 - Uncomment when MCP is implemented
        // await this.mcpHub.initialize();

        // 6. Start semantic indexing (background)
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
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    /**
     * Save plugin settings to disk
     */
    async saveSettings() {
        await this.saveData(this.settings);
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
}
