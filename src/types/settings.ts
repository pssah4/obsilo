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
    /** 'built-in' modes ship with the plugin; 'custom' modes are user-created */
    source: 'built-in' | 'custom';
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
    /** Auto-approve write operations (write_file, edit_file, append_to_file, delete_file, move_file, ...) */
    write: boolean;
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
    /** Use a custom temperature instead of the model default */
    useCustomTemperature: boolean;
    /** Temperature value (0.0 – 2.0) */
    temperature: number;
    /** Stop agent after N consecutive errors (0 = disabled) */
    consecutiveMistakeLimit: number;
    /** Minimum milliseconds between API requests (0 = no limit) */
    rateLimitMs: number;
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

    // Advanced
    debugMode: boolean;
}

export const DEFAULT_SETTINGS: ObsidianAgentSettings = {
    activeModels: [],
    activeModelKey: '',

    defaultProvider: 'anthropic',
    providers: {},

    mcpServers: {},
    currentMode: 'librarian',
    customModes: [],

    autoApproval: {
        enabled: false,
        showMenuInChat: true,
        read: true,    // reads are always safe
        write: false,
        web: false,
        mcp: false,
        mode: false,
        subtasks: false,
        question: true,
        todo: true,
    },
    autoApprovalRules: {
        readOperations: true,
        writeToTempFiles: false,
        maxRequestsPerSession: undefined,
        whitelistedPaths: [],
    },

    advancedApi: {
        useCustomTemperature: false,
        temperature: 1.0,
        consecutiveMistakeLimit: 3,
        rateLimitMs: 0,
    },

    enableSemanticIndex: false,
    embeddingModel: 'Xenova/all-MiniLM-L6-v2',
    embeddingModels: [],
    activeEmbeddingModelKey: '',

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
    debugMode: false,
};
