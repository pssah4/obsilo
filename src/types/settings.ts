/**
 * Plugin Settings
 */

// ---------------------------------------------------------------------------
// CustomModel — single unified model entry (replaces per-provider LLMProvider)
// Adapted from Obsidian Copilot's CustomModel pattern
// ---------------------------------------------------------------------------

export type ProviderType = 'anthropic' | 'openai' | 'ollama' | 'openrouter' | 'custom';

export interface CustomModel {
    /** Model identifier used in API calls (e.g. "claude-sonnet-4-5-20250929") */
    name: string;
    /** LLM provider */
    provider: ProviderType;
    /** Human-readable name shown in UI */
    displayName?: string;
    /** API key for this model (stored per-model, not per-provider) */
    apiKey?: string;
    /** Custom base URL (required for ollama/custom, optional for others) */
    baseUrl?: string;
    /** Whether the model appears in the chat model selector */
    enabled: boolean;
    /** True for pre-defined models shipped with the plugin */
    isBuiltIn?: boolean;
    maxTokens?: number;
    temperature?: number;
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

export interface ModeConfig {
    id: string;
    name: string;
    description: string;
    systemPrompt: string;
    allowedTools: string[];
    mcpServers: string[];
    customInstructions?: string;
}

// ---------------------------------------------------------------------------
// Auto-approval rules
// ---------------------------------------------------------------------------

export interface AutoApprovalRules {
    readOperations: boolean;
    writeToTempFiles: boolean;
    maxRequestsPerSession?: number;
    whitelistedPaths?: string[];
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

    // Approval
    autoApprovalRules: AutoApprovalRules;

    // Semantic Index
    enableSemanticIndex: boolean;
    embeddingModel: string;

    // Checkpoints
    enableCheckpoints: boolean;
    maxCheckpointsPerTask: number;

    // UI
    sidebarPosition: 'left' | 'right';
    showWelcomeMessage: boolean;
    autoAddActiveFileContext: boolean;

    // Advanced
    debugMode: boolean;
}

export const DEFAULT_SETTINGS: ObsidianAgentSettings = {
    activeModels: BUILT_IN_MODELS.map((m) => ({ ...m })),
    activeModelKey: '',

    defaultProvider: 'anthropic',
    providers: {},

    mcpServers: {},
    currentMode: 'ask',
    customModes: [],
    autoApprovalRules: {
        readOperations: true,
        writeToTempFiles: false,
        maxRequestsPerSession: undefined,
        whitelistedPaths: [],
    },
    enableSemanticIndex: true,
    embeddingModel: 'Xenova/all-MiniLM-L6-v2',
    enableCheckpoints: true,
    maxCheckpointsPerTask: 50,
    sidebarPosition: 'right',
    showWelcomeMessage: true,
    autoAddActiveFileContext: true,
    debugMode: false,
};
