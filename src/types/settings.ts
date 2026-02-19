/**
 * Plugin Settings
 */

// ---------------------------------------------------------------------------
// CustomModel — single unified model entry (replaces per-provider LLMProvider)
// Adapted from Obsidian Copilot's CustomModel pattern
// ---------------------------------------------------------------------------

export type ProviderType = 'anthropic' | 'openai' | 'ollama' | 'lmstudio' | 'openrouter' | 'azure' | 'custom';

export interface CustomModel {
    /** Model identifier used in API calls (e.g. "claude-sonnet-4-5-20250929") */
    name: string;
    /** LLM provider */
    provider: ProviderType;
    /** Human-readable name shown in UI */
    displayName?: string;
    /** API key for this model (stored per-model, not per-provider) */
    apiKey?: string;
    /** Custom base URL (required for ollama/custom/azure, optional for others) */
    baseUrl?: string;
    /** Whether the model appears in the chat model selector */
    enabled: boolean;
    /** True for pre-defined models shipped with the plugin */
    isBuiltIn?: boolean;
    maxTokens?: number;
    temperature?: number;
    /** API version string (required for Azure OpenAI and some enterprise gateways, e.g. "2024-10-21") */
    apiVersion?: string;
}

/** Unique key for a model across all providers */
export function getModelKey(model: CustomModel): string {
    return `${model.name}|${model.provider}`;
}

/** Built-in models — shown in settings by default, user can add API keys & enable */
export const BUILT_IN_MODELS: CustomModel[] = [
    // Anthropic
    {
        name: 'claude-sonnet-4-5-20250929',
        provider: 'anthropic',
        displayName: 'Claude Sonnet 4.5',
        enabled: false,
        isBuiltIn: true,
    },
    {
        name: 'claude-opus-4-6',
        provider: 'anthropic',
        displayName: 'Claude Opus 4.6',
        enabled: false,
        isBuiltIn: true,
    },
    {
        name: 'claude-haiku-4-5-20251001',
        provider: 'anthropic',
        displayName: 'Claude Haiku 4.5',
        enabled: false,
        isBuiltIn: true,
    },
    // OpenAI
    {
        name: 'gpt-4o',
        provider: 'openai',
        displayName: 'GPT-4o',
        enabled: false,
        isBuiltIn: true,
    },
    {
        name: 'gpt-4o-mini',
        provider: 'openai',
        displayName: 'GPT-4o mini',
        enabled: false,
        isBuiltIn: true,
    },
    {
        name: 'gpt-4.1',
        provider: 'openai',
        displayName: 'GPT-4.1',
        enabled: false,
        isBuiltIn: true,
    },
    // Ollama (local)
    {
        name: 'llama3.2',
        provider: 'ollama',
        displayName: 'Llama 3.2 (local)',
        baseUrl: 'http://localhost:11434',
        enabled: false,
        isBuiltIn: true,
    },
    {
        name: 'qwen2.5:7b',
        provider: 'ollama',
        displayName: 'Qwen 2.5 7B (local)',
        baseUrl: 'http://localhost:11434',
        enabled: false,
        isBuiltIn: true,
    },
    // OpenRouter (API key required, base URL pre-configured)
    {
        name: 'anthropic/claude-3.5-sonnet',
        provider: 'openrouter',
        displayName: 'Claude 3.5 Sonnet',
        enabled: false,
        isBuiltIn: true,
    },
    {
        name: 'openai/gpt-4o',
        provider: 'openrouter',
        displayName: 'GPT-4o',
        enabled: false,
        isBuiltIn: true,
    },
    {
        name: 'meta-llama/llama-3.2-3b-instruct:free',
        provider: 'openrouter',
        displayName: 'Llama 3.2 3B (free)',
        enabled: false,
        isBuiltIn: true,
    },
];

// ---------------------------------------------------------------------------
// LLMProvider — kept for backwards compatibility with API handler layer
// ---------------------------------------------------------------------------

export interface LLMProvider {
    type: ProviderType;
    apiKey?: string;
    /** For openrouter: pre-set to https://openrouter.ai/api/v1; for ollama: http://localhost:11434 */
    baseUrl?: string;
    model: string;
    maxTokens?: number;
    temperature?: number;
    /** API version for Azure OpenAI and compatible enterprise gateways */
    apiVersion?: string;
}

/** Convert a CustomModel to LLMProvider for the API handler layer */
export function modelToLLMProvider(model: CustomModel): LLMProvider {
    return {
        type: model.provider,
        model: model.name,
        apiKey: model.apiKey,
        baseUrl: model.baseUrl,
        maxTokens: model.maxTokens,
        temperature: model.temperature,
        apiVersion: model.apiVersion,
    };
}

// ---------------------------------------------------------------------------
// Custom Prompts — user-defined slash-command prompt templates
// ---------------------------------------------------------------------------

export interface CustomPrompt {
    /** Unique identifier */
    id: string;
    /** Display name, e.g. "Tagesbericht" */
    name: string;
    /** Slash-command trigger, e.g. "daily-report" → /daily-report */
    slug: string;
    /** Template text — supports {{userInput}} and {{activeFile}} variables */
    content: string;
    /** Whether this prompt appears in autocomplete */
    enabled: boolean;
    /** Optional: restrict this prompt to a specific mode slug. If unset, appears in all modes. */
    mode?: string;
}

// ---------------------------------------------------------------------------
// MCP Server configuration
// ---------------------------------------------------------------------------

export interface McpServerConfig {
    type: 'stdio' | 'sse' | 'streamable-http';
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
    disabled?: boolean;
    timeout?: number;
    alwaysAllow?: string[];
}

// ---------------------------------------------------------------------------
// Agent Mode configuration
// ---------------------------------------------------------------------------

/** Logical tool groups — controls which tools are available in a mode */
export type ToolGroup = 'read' | 'vault' | 'edit' | 'web' | 'agent' | 'mcp';

export interface ModeConfig {
    /** URL-safe identifier (e.g. "researcher", "daily-writer") */
    slug: string;
    /** Display name shown in UI */
    name: string;
    /** Lucide icon name */
    icon: string;
    /** Short description shown in mode selector */
    description: string;
    /** Core role definition injected into system prompt */
    roleDefinition: string;
    /** Hint for the Orchestrator when deciding which mode to delegate to */
    whenToUse?: string;
    /** User-editable extra instructions appended after roleDefinition */
    customInstructions?: string;
    /** Which tool groups are available in this mode */
    toolGroups: ToolGroup[];
    /**
     * 'built-in'  — ships with the plugin (not user-editable)
     * 'global'    — user-created, stored in ~/.obsidian-agent/modes.json (all vaults)
     * 'vault'     — user-created, stored in this vault's plugin settings (this vault only)
     */
    source: 'built-in' | 'global' | 'vault';
}

// ---------------------------------------------------------------------------
// Auto-approval config (Sprint 1.3)
// ---------------------------------------------------------------------------

export interface AutoApprovalConfig {
    /** Master toggle: when false, all write operations require manual approval */
    enabled: boolean;
    /** Show the quick-toggle bar inside the chat view */
    showMenuInChat: boolean;
    /** Auto-approve read operations (read_file, list_files, search_files, ...) */
    read: boolean;
    /**
     * @deprecated — migrated to noteEdits + vaultChanges.
     * Kept as optional for the migration pass in loadSettings().
     */
    write?: boolean;
    /** Auto-approve note content changes (write_file, edit_file, append_to_file, update_frontmatter) */
    noteEdits: boolean;
    /** Auto-approve vault structural changes (create_folder, delete_file, move_file) */
    vaultChanges: boolean;
    /** Auto-approve web operations (web_fetch, web_search) */
    web: boolean;
    /** Auto-approve MCP tool calls */
    mcp: boolean;
    /** Auto-approve mode switching (switch_mode) */
    mode: boolean;
    /** Auto-approve spawning subtasks (new_task) */
    subtasks: boolean;
    /** Auto-approve ask_followup_question (skips approval card, shows question card directly) */
    question: boolean;
    /** Auto-approve update_todo_list */
    todo: boolean;
    /** Auto-approve skills injection into context (future) */
    skills: boolean;
}

/** Legacy — kept for backwards compat */
export interface AutoApprovalRules {
    readOperations: boolean;
    writeToTempFiles: boolean;
    maxRequestsPerSession?: number;
    whitelistedPaths?: string[];
}

// ---------------------------------------------------------------------------
// Web Tools Settings (Phase 1.1)
// ---------------------------------------------------------------------------

export type WebSearchProvider = 'brave' | 'tavily' | 'none';

export interface WebToolsSettings {
    /** Master toggle — when false, web_fetch and web_search are disabled */
    enabled: boolean;
    /** Search provider (required for web_search) */
    provider: WebSearchProvider;
    /** Brave Search API key */
    braveApiKey: string;
    /** Tavily Search API key */
    tavilyApiKey: string;
}

// ---------------------------------------------------------------------------
// Advanced API Settings (Sprint 1.5)
// ---------------------------------------------------------------------------

export interface AdvancedApiSettings {
    /** Stop agent after N consecutive errors (0 = disabled) */
    consecutiveMistakeLimit: number;
    /** Minimum milliseconds between API requests (0 = no limit) */
    rateLimitMs: number;
    /** Automatically summarize conversation when estimated tokens exceed threshold */
    condensingEnabled: boolean;
    /** Percentage of model context window at which to trigger condensing (50–95) */
    condensingThreshold: number;
    /** Inject a mode-role reminder every N iterations to keep the model on track (0 = disabled) */
    powerSteeringFrequency: number;
}

// ---------------------------------------------------------------------------
// Main plugin settings
// ---------------------------------------------------------------------------

export interface ObsidianAgentSettings {
    // Model management (new — replaces providers/defaultProvider)
    activeModels: CustomModel[];
    activeModelKey: string;

    // Legacy provider settings (kept for backwards compat, not used in new UI)
    defaultProvider: string;
    providers: Record<string, LLMProvider>;

    // MCP Servers
    mcpServers: Record<string, McpServerConfig>;

    // Modes
    currentMode: string;
    customModes: ModeConfig[];
    /** Per-mode model override: maps mode slug → model key. Falls back to activeModelKey if not set. */
    modeModelKeys: Record<string, string>;
    /** Instructions appended to the system prompt for ALL modes */
    globalCustomInstructions: string;
    /**
     * Permanent per-mode tool overrides: maps mode slug → explicit list of enabled tool names.
     * When set, only the listed tools are available (intersection with mode's tool groups).
     * When absent, all tools in the mode's groups are available.
     */
    modeToolOverrides: Record<string, string[]>;
    /**
     * MCP server whitelist: which configured MCP servers are active.
     * Empty array = all configured servers are allowed (when use_mcp_tool is enabled).
     * Non-empty array = only listed server names are allowed.
     */
    activeMcpServers: string[];
    /**
     * Permanent per-mode forced skill names: maps mode slug → skill names to always inject.
     * When set, these skills are included in the system prompt regardless of keyword matching.
     */
    forcedSkills: Record<string, string[]>;
    /**
     * Permanent per-mode forced workflow slug: maps mode slug → workflow slug.
     * When set, this workflow is applied to each message (unless message starts with /).
     */
    forcedWorkflow: Record<string, string>;
    /**
     * Per-mode MCP server whitelist: maps mode slug → allowed server names.
     * Missing entry or empty array = all configured servers allowed.
     */
    modeMcpServers: Record<string, string[]>;

    // Approval (Sprint 1.3)
    autoApproval: AutoApprovalConfig;
    /** @deprecated use autoApproval */
    autoApprovalRules: AutoApprovalRules;

    // Advanced API (Sprint 1.5)
    advancedApi: AdvancedApiSettings;

    // Semantic Index
    enableSemanticIndex: boolean;
    embeddingModel: string; // legacy — kept for backwards compat
    embeddingModels: CustomModel[];
    activeEmbeddingModelKey: string;
    semanticBatchSize: number;
    semanticAutoIndex: 'startup' | 'mode-switch' | 'never';
    semanticExcludedFolders: string[];
    semanticStorageLocation: 'obsidian-sync' | 'local';
    semanticIndexPdfs: boolean;
    /** Chunk size in characters. Changing this invalidates and rebuilds the index. */
    semanticChunkSize: number;

    // Checkpoints (Sprint 1.4)
    enableCheckpoints: boolean;
    checkpointTimeoutSeconds: number;
    checkpointAutoCleanup: boolean;

    // Web Tools (Phase 1.1)
    webTools: WebToolsSettings;

    // UI
    sidebarPosition: 'left' | 'right';
    showWelcomeMessage: boolean;
    autoAddActiveFileContext: boolean;
    /** Vault folder for saved chat history JSON files. Empty string = disabled. */
    chatHistoryFolder: string;
    /** Press Enter to send (Shift+Enter for newline). When false, Ctrl/Cmd+Enter sends. */
    sendWithEnter: boolean;
    /** Inject current date and time into the system prompt */
    includeCurrentTimeInContext: boolean;

    // Rules (Sprint 3.2) — per-file enabled/disabled toggles
    // key: vault-relative path, value: true=enabled (default), false=disabled
    rulesToggles: Record<string, boolean>;

    // Workflows (Sprint 3.3) — per-file enabled/disabled toggles
    workflowToggles: Record<string, boolean>;

    // Custom Prompts — user-defined slash-command templates
    customPrompts: CustomPrompt[];

    // Advanced
    debugMode: boolean;
}

export const DEFAULT_SETTINGS: ObsidianAgentSettings = {
    activeModels: [],
    activeModelKey: '',

    defaultProvider: 'anthropic',
    providers: {},

    mcpServers: {},
    currentMode: 'agent',
    customModes: [],
    modeModelKeys: {},
    globalCustomInstructions: '',
    modeToolOverrides: {
        // Agent: all tools enabled EXCEPT delete_file and use_mcp_tool (safe defaults)
        agent: [
            'read_file', 'list_files', 'search_files',
            'get_vault_stats', 'get_frontmatter', 'search_by_tag', 'get_linked_notes',
            'get_daily_note', 'open_note', 'semantic_search', 'query_base',
            'write_file', 'edit_file', 'append_to_file', 'create_folder',
            'move_file', 'update_frontmatter', 'generate_canvas', 'create_base', 'update_base',
            'web_fetch', 'web_search',
            'ask_followup_question', 'attempt_completion', 'update_todo_list', 'new_task',
        ],
    },
    activeMcpServers: [],
    forcedSkills: {},
    forcedWorkflow: {},
    modeMcpServers: {},

    autoApproval: {
        enabled: false,
        showMenuInChat: true,
        read: true,         // reads are always safe
        noteEdits: false,
        vaultChanges: false,
        web: false,
        mcp: false,
        mode: false,
        subtasks: false,
        question: true,
        todo: true,
        skills: false,
    },
    autoApprovalRules: {
        readOperations: true,
        writeToTempFiles: false,
        maxRequestsPerSession: undefined,
        whitelistedPaths: [],
    },

    advancedApi: {
        consecutiveMistakeLimit: 3,
        rateLimitMs: 0,
        condensingEnabled: false,
        condensingThreshold: 80,
        powerSteeringFrequency: 0,
    },

    enableSemanticIndex: false,
    embeddingModel: 'Xenova/all-MiniLM-L6-v2',
    embeddingModels: [],
    activeEmbeddingModelKey: '',
    semanticBatchSize: 20,
    semanticAutoIndex: 'never',
    semanticExcludedFolders: [],
    semanticStorageLocation: 'obsidian-sync',
    semanticIndexPdfs: false,
    semanticChunkSize: 2000,

    enableCheckpoints: true,
    checkpointTimeoutSeconds: 30,
    checkpointAutoCleanup: true,

    webTools: {
        enabled: false,
        provider: 'none',
        braveApiKey: '',
        tavilyApiKey: '',
    },

    sidebarPosition: 'right',
    showWelcomeMessage: true,
    autoAddActiveFileContext: true,
    chatHistoryFolder: '',
    sendWithEnter: true,
    includeCurrentTimeInContext: true,
    rulesToggles: {},
    workflowToggles: {},
    customPrompts: [],
    debugMode: false,
};
