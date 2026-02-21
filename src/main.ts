import { Plugin, WorkspaceLeaf, Notice, TFile } from 'obsidian';
import { ObsidianAgentSettings, DEFAULT_SETTINGS, getModelKey, modelToLLMProvider } from './types/settings';
import type { CustomModel, AutoApprovalConfig } from './types/settings';
import { AgentSidebarView, VIEW_TYPE_AGENT_SIDEBAR } from './ui/AgentSidebarView';
import { AgentSettingsTab } from './ui/AgentSettingsTab';
import { ToolRegistry } from './core/tools/ToolRegistry';
import { ToolExecutionPipeline } from './core/tool-execution/ToolExecutionPipeline';
import { IgnoreService } from './core/governance/IgnoreService';
import { OperationLogger } from './core/governance/OperationLogger';
import { RulesLoader } from './core/context/RulesLoader';
import { WorkflowLoader } from './core/context/WorkflowLoader';
import { SkillsManager } from './core/context/SkillsManager';
import { GitCheckpointService } from './core/checkpoints/GitCheckpointService';
import { SemanticIndexService } from './core/semantic/SemanticIndexService';
import { ChatHistoryService } from './core/ChatHistoryService';
import { ConversationStore } from './core/history/ConversationStore';
import { MemoryService } from './core/memory/MemoryService';
import { ExtractionQueue } from './core/memory/ExtractionQueue';
import { SessionExtractor } from './core/memory/SessionExtractor';
import { LongTermExtractor } from './core/memory/LongTermExtractor';
import { McpClient } from './core/mcp/McpClient';
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
    rulesLoader: RulesLoader;
    workflowLoader: WorkflowLoader;
    skillsManager: SkillsManager;
    semanticIndex: SemanticIndexService | null = null;
    private autoIndexDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private warmupFired = false;
    chatHistoryService: ChatHistoryService | null = null;
    conversationStore: ConversationStore | null = null;
    memoryService: MemoryService | null = null;
    extractionQueue: ExtractionQueue | null = null;
    mcpClient: McpClient;

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
        console.log('Loading Obsilo Agent plugin');


        // 1. Load settings
        await this.loadSettings();

        // 2. Initialize core services
        // Governance: ignore/protected path rules
        this.ignoreService = new IgnoreService(this.app.vault);
        await this.ignoreService.load();

        // Rules loader (Sprint 3.2)
        this.rulesLoader = new RulesLoader(this.app.vault);
        await this.rulesLoader.initialize();

        // Workflow loader (Sprint 3.3)
        this.workflowLoader = new WorkflowLoader(this.app.vault);
        await this.workflowLoader.initialize();

        // Skills manager (Sprint 3.4)
        this.skillsManager = new SkillsManager(this.app.vault);
        await this.skillsManager.initialize();

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

        // MCP Client — connect to all configured servers
        this.mcpClient = new McpClient();
        if (Object.keys(this.settings.mcpServers ?? {}).length > 0) {
            this.mcpClient.connectAll(this.settings.mcpServers).catch((e) =>
                console.warn('[Plugin] MCP connect failed (non-fatal):', e)
            );
        }

        // Tool registry (ToolExecutionPipeline created per-task)
        this.toolRegistry = new ToolRegistry(this, this.mcpClient);

        // Semantic index (Phase C2) — lazy build, only when enabled
        if (this.settings.enableSemanticIndex) {
            const pluginDirSI = `.obsidian/plugins/${this.manifest.id}`;
            this.semanticIndex = new SemanticIndexService(this.app.vault, pluginDirSI, {
                batchSize: this.settings.semanticBatchSize,
                embeddingBatchSize: 16,  // texts per API call — batch for performance
                excludedFolders: this.settings.semanticExcludedFolders,
                storageLocation: this.settings.semanticStorageLocation,
                indexPdfs: this.settings.semanticIndexPdfs,
                chunkSize: this.settings.semanticChunkSize ?? 2000,
            });
            const embeddingModel = this.getActiveEmbeddingModel();
            if (embeddingModel) this.semanticIndex.setEmbeddingModel(embeddingModel);
            await this.semanticIndex.initialize().catch((e) =>
                console.warn('[Plugin] Semantic index init failed (non-fatal):', e)
            );
            // Auto-index on startup if configured
            if (this.settings.semanticAutoIndex === 'startup') {
                this.semanticIndex.buildIndex().catch((e) =>
                    console.warn('[Plugin] Auto-index on startup failed:', e)
                );
            }
        }

        // Auto-index: keep semantic index current as vault files change.
        // Only enabled when semanticAutoIndexOnChange is explicitly set — disabled by default
        // because local Xenova embedding blocks the main thread and makes Obsidian sluggish.
        if (this.settings.enableSemanticIndex && this.semanticIndex && this.settings.semanticAutoIndexOnChange) {
            this.registerEvent(this.app.vault.on('modify', (file) => {
                if (!(file instanceof TFile)) return;
                if (file.extension !== 'md' && !(this.settings.semanticIndexPdfs && file.extension === 'pdf')) return;
                this.scheduleFileIndex(file.path);
            }));
            this.registerEvent(this.app.vault.on('create', (file) => {
                if (!(file instanceof TFile)) return;
                if (file.extension !== 'md' && !(this.settings.semanticIndexPdfs && file.extension === 'pdf')) return;
                this.scheduleFileIndex(file.path);
            }));
            this.registerEvent(this.app.vault.on('delete', (file) => {
                if (!(file instanceof TFile)) return;
                if (file.extension !== 'md' && !(this.settings.semanticIndexPdfs && file.extension === 'pdf')) return;
                this.semanticIndex?.removeFile(file.path);
            }));
            this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
                if (!(file instanceof TFile)) return;
                if (file.extension !== 'md' && !(this.settings.semanticIndexPdfs && file.extension === 'pdf')) return;
                this.semanticIndex?.removeFile(oldPath);
                this.scheduleFileIndex(file.path);
            }));
        }

        // Chat history service (legacy — only when folder is configured)
        if (this.settings.chatHistoryFolder) {
            this.chatHistoryService = new ChatHistoryService(this.app.vault, this.settings.chatHistoryFolder);
        }

        // Conversation store (new persistent history)
        if (this.settings.enableChatHistory) {
            this.conversationStore = new ConversationStore(this.app.vault, pluginDir);
            await this.conversationStore.initialize().catch((e) =>
                console.warn('[Plugin] ConversationStore init failed (non-fatal):', e)
            );
        }

        // Memory service + extraction queue
        if (this.settings.memory.enabled) {
            this.memoryService = new MemoryService(this.app.vault, pluginDir);
            await this.memoryService.initialize().catch((e) =>
                console.warn('[Plugin] MemoryService init failed (non-fatal):', e)
            );
            this.extractionQueue = new ExtractionQueue(this.app.vault, pluginDir);
            await this.extractionQueue.load().catch((e) =>
                console.warn('[Plugin] ExtractionQueue load failed (non-fatal):', e)
            );

            // Wire SessionExtractor as the queue processor
            const sessionExtractor = new SessionExtractor(
                this.app.vault,
                this.memoryService,
                () => this.getMemoryModel(),
                () => this.settings.memory.autoUpdateLongTerm,
                this.extractionQueue,
                () => this.semanticIndex,
            );
            const longTermExtractor = new LongTermExtractor(
                this.app.vault,
                this.memoryService,
                () => this.getMemoryModel(),
            );
            this.extractionQueue.setProcessor(async (item) => {
                if (item.type === 'session') {
                    await sessionExtractor.process(item);
                } else if (item.type === 'long-term') {
                    await longTermExtractor.process(item);
                }
            });

            // Process any pending extractions from a previous session
            if (!this.extractionQueue.isEmpty()) {
                console.log(`[Plugin] Processing ${this.extractionQueue.size()} pending extractions from previous session`);
                this.extractionQueue.processQueue().catch((e) =>
                    console.warn('[Plugin] Queue processing failed (non-fatal):', e)
                );
            }
        }

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

        console.log('Obsilo Agent plugin loaded successfully');
    }

    /**
     * Plugin cleanup
     */
    async onunload() {
        console.log('Unloading Obsilo Agent plugin');
        for (const timer of this.autoIndexDebounceTimers.values()) clearTimeout(timer);
        this.autoIndexDebounceTimers.clear();
        await this.mcpClient?.disconnectAll();
        console.log('Obsilo Agent plugin unloaded');
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
        const OLD_MODE_MAP: Record<string, string> = { librarian: 'ask', writer: 'agent', orchestrator: 'agent', researcher: 'ask', curator: 'agent', architect: 'agent' };
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
        // Migrate: global temperature override removed — temperature is now per-model on CustomModel
        const advApi = this.settings.advancedApi as unknown as Record<string, unknown>;
        if ('useCustomTemperature' in advApi) delete advApi['useCustomTemperature'];
        if ('temperature' in advApi) delete advApi['temperature'];
        // Migrate: autoApproval.write split into noteEdits + vaultChanges
        const ap = this.settings.autoApproval as AutoApprovalConfig & { write?: boolean };
        if (ap.write !== undefined) {
            if (ap.noteEdits === undefined || ap.noteEdits === false) ap.noteEdits = ap.write;
            if (ap.vaultChanges === undefined || ap.vaultChanges === false) ap.vaultChanges = ap.write;
            delete ap.write;
        }
        // Ensure new fields exist for users upgrading from older versions
        ap.noteEdits = ap.noteEdits ?? false;
        ap.vaultChanges = ap.vaultChanges ?? false;
        ap.skills = ap.skills ?? false;
        // Migrate: chatHistoryFolder → enableChatHistory
        if (this.settings.chatHistoryFolder && this.settings.enableChatHistory === undefined) {
            this.settings.enableChatHistory = true;
        }
        this.settings.enableChatHistory = this.settings.enableChatHistory ?? true;
        // Deep-merge memory settings so upgrading users get new fields with defaults
        const memDefaults = DEFAULT_SETTINGS.memory;
        this.settings.memory = this.settings.memory ?? memDefaults;
        this.settings.memory.enabled = this.settings.memory.enabled ?? memDefaults.enabled;
        this.settings.memory.autoExtractSessions = this.settings.memory.autoExtractSessions ?? memDefaults.autoExtractSessions;
        this.settings.memory.autoUpdateLongTerm = this.settings.memory.autoUpdateLongTerm ?? memDefaults.autoUpdateLongTerm;
        this.settings.memory.memoryModelKey = this.settings.memory.memoryModelKey ?? memDefaults.memoryModelKey;
        this.settings.memory.extractionThreshold = this.settings.memory.extractionThreshold ?? memDefaults.extractionThreshold;
    }

    /** Return the currently active CustomModel, or null if none configured */
    getActiveModel(): CustomModel | null {
        const key = this.settings.activeModelKey;
        if (!key) return null;
        return this.settings.activeModels.find((m) => getModelKey(m) === key) ?? null;
    }

    /** Return the memory extraction CustomModel, or null if none configured */
    getMemoryModel(): CustomModel | null {
        const key = this.settings.memory.memoryModelKey;
        if (!key) return null;
        return this.settings.activeModels.find((m) => getModelKey(m) === key) ?? null;
    }

    /** Return the active embedding CustomModel, or null if none configured */
    getActiveEmbeddingModel(): CustomModel | null {
        const key = this.settings.activeEmbeddingModelKey;
        if (!key) return null;
        return this.settings.embeddingModels.find((m) => getModelKey(m) === key) ?? null;
    }

    /**
     * Save plugin settings to disk and reinitialize API handler
     */
    async saveSettings() {
        await this.saveData(this.settings);
        this.initApiHandler();
    }

    /** Reconnect all MCP servers from current settings. Called when MCP config changes. */
    async reconnectMcp(): Promise<void> {
        await this.mcpClient.disconnectAll();
        if (Object.keys(this.settings.mcpServers ?? {}).length > 0) {
            await this.mcpClient.connectAll(this.settings.mcpServers);
        }
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

            // Pre-warm the DNS + TLS connection so the FIRST user message isn't delayed
            // by cold-start network setup (~5-18 s on some systems / networks).
            // We fire a lightweight HEAD to the provider base URL immediately after the
            // handler is created.  The server will return an error (no valid payload),
            // but the TCP/TLS connection is established and Chromium caches it for reuse.
            // Local providers (ollama, lmstudio) are intentionally skipped.
            const CLOUD_BASE_URLS: Partial<Record<string, string>> = {
                anthropic:  'https://api.anthropic.com',
                openai:     'https://api.openai.com',
                openrouter: 'https://openrouter.ai',
                azure:      model.baseUrl ?? '',
                custom:     model.baseUrl ?? '',
            };
            const warmupUrl = CLOUD_BASE_URLS[model.provider];
            if (warmupUrl && !this.warmupFired) {
                this.warmupFired = true;
                fetch(warmupUrl, { method: 'HEAD', signal: AbortSignal.timeout(8000) })
                    .catch(() => { /* expected — we only want the TCP/TLS handshake */ });
            }
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
     * Schedule a single file for re-indexing after a 2s debounce.
     * Fires on vault modify/create events — debounce prevents thrashing
     * while the user is actively typing in a note.
     */
    private scheduleFileIndex(filePath: string): void {
        if (!this.semanticIndex?.isIndexed) return;
        if (this.settings.semanticExcludedFolders?.some((f) => filePath.startsWith(f + '/'))) return;
        const existing = this.autoIndexDebounceTimers.get(filePath);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => {
            this.autoIndexDebounceTimers.delete(filePath);
            // Use queue (concurrency=1) instead of direct updateFile to prevent
            // concurrent embedding calls from freezing Obsidian's main thread.
            this.semanticIndex?.queueAutoUpdate(filePath);
        }, 2000);
        this.autoIndexDebounceTimers.set(filePath, timer);
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
