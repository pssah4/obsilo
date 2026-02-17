/**
 * Plugin Settings
 *
 * Configuration for Obsidian Agent including:
 * - LLM provider settings
 * - MCP server configurations
 * - Mode definitions
 * - Approval rules
 */

/**
 * LLM Provider configuration
 */
export interface LLMProvider {
    type: 'anthropic' | 'openai' | 'ollama' | 'custom';
    apiKey?: string;
    baseUrl?: string;
    model: string;
    maxTokens?: number;
    temperature?: number;
}

/**
 * MCP Server configuration
 */
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

/**
 * Agent Mode configuration
 */
export interface ModeConfig {
    id: string;
    name: string;
    description: string;
    systemPrompt: string;
    allowedTools: string[];
    mcpServers: string[];
    customInstructions?: string;
}

/**
 * Auto-approval rules
 */
export interface AutoApprovalRules {
    readOperations: boolean;
    writeToTempFiles: boolean;
    maxRequestsPerSession?: number;
    whitelistedPaths?: string[];
}

/**
 * Main plugin settings
 */
export interface ObsidianAgentSettings {
    // LLM Provider
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

    // Advanced
    debugMode: boolean;
}

/**
 * Default settings
 */
export const DEFAULT_SETTINGS: ObsidianAgentSettings = {
    defaultProvider: 'anthropic',
    providers: {
        anthropic: {
            type: 'anthropic',
            model: 'claude-sonnet-4-5-20250929',
            maxTokens: 8192,
            temperature: 0.7,
        },
        openai: {
            type: 'openai',
            model: 'gpt-4-turbo-preview',
            maxTokens: 4096,
            temperature: 0.7,
        },
        ollama: {
            type: 'ollama',
            baseUrl: 'http://localhost:11434',
            model: 'llama2',
            maxTokens: 4096,
            temperature: 0.7,
        },
    },
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
    debugMode: false,
};
