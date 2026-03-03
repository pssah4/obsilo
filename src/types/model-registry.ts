/**
 * Central Model Registry
 * Based on Kilo Code's model definitions structure
 * All model metadata including context windows are defined here
 */

export interface ModelInfo {
    contextWindow: number;
    maxTokens?: number;
    supportsTools?: boolean;
    supportsStreaming?: boolean;
    displayName?: string;
}

// Anthropic Models
// https://docs.anthropic.com/en/docs/about-claude/models
export const ANTHROPIC_MODELS: Record<string, ModelInfo> = {
    'claude-opus-4-6': {
        contextWindow: 200_000,
        maxTokens: 128_000,
        supportsTools: true,
        supportsStreaming: true,
        displayName: 'Claude Opus 4.6',
    },
    'claude-sonnet-4-6': {
        contextWindow: 200_000,
        maxTokens: 64_000,
        supportsTools: true,
        supportsStreaming: true,
        displayName: 'Claude Sonnet 4.6',
    },
    'claude-sonnet-4-5-20250929': {
        contextWindow: 200_000,
        maxTokens: 64_000,
        supportsTools: true,
        supportsStreaming: true,
        displayName: 'Claude Sonnet 4.5',
    },
    'claude-haiku-4-5-20251001': {
        contextWindow: 200_000,
        maxTokens: 8_192,
        supportsTools: true,
        supportsStreaming: true,
        displayName: 'Claude Haiku 4.5',
    },
    // Legacy models
    'claude-3-5-sonnet-20241022': {
        contextWindow: 200_000,
        maxTokens: 8_192,
        supportsTools: true,
        supportsStreaming: true,
    },
    'claude-3-5-sonnet-20240620': {
        contextWindow: 200_000,
        maxTokens: 8_192,
        supportsTools: true,
        supportsStreaming: true,
    },
    'claude-3-opus-20240229': {
        contextWindow: 200_000,
        maxTokens: 4_096,
        supportsTools: true,
        supportsStreaming: true,
    },
};

// OpenAI Models
// https://platform.openai.com/docs/models
export const OPENAI_MODELS: Record<string, ModelInfo> = {
    'gpt-4o': {
        contextWindow: 128_000,
        maxTokens: 16_384,
        supportsTools: true,
        supportsStreaming: true,
    },
    'gpt-4o-mini': {
        contextWindow: 128_000,
        maxTokens: 16_384,
        supportsTools: true,
        supportsStreaming: true,
    },
    'o1': {
        contextWindow: 200_000,
        maxTokens: 100_000,
        supportsTools: false,
        supportsStreaming: false,
    },
    'o1-mini': {
        contextWindow: 128_000,
        maxTokens: 65_536,
        supportsTools: false,
        supportsStreaming: false,
    },
    'gpt-4-turbo': {
        contextWindow: 128_000,
        maxTokens: 4_096,
        supportsTools: true,
        supportsStreaming: true,
    },
    'gpt-4': {
        contextWindow: 8_192,
        maxTokens: 4_096,
        supportsTools: true,
        supportsStreaming: true,
    },
    'gpt-3.5-turbo': {
        contextWindow: 16_385,
        maxTokens: 4_096,
        supportsTools: true,
        supportsStreaming: true,
    },
};

// Gemini Models (via OpenAI-compatible API)
// https://ai.google.dev/gemini-api/docs/models/gemini
export const GEMINI_MODELS: Record<string, ModelInfo> = {
    'gemini-3-pro-preview': {
        contextWindow: 2_097_152, // 2M tokens
        maxTokens: 8_192,
        supportsTools: true,
        supportsStreaming: true,
        displayName: 'Gemini 3 Pro Preview',
    },
    'gemini-2.5-flash': {
        contextWindow: 1_048_576, // 1M tokens
        maxTokens: 8_192,
        supportsTools: true,
        supportsStreaming: true,
        displayName: 'Gemini 2.5 Flash',
    },
    'gemini-2.0-flash-exp': {
        contextWindow: 1_048_576,
        maxTokens: 8_192,
        supportsTools: true,
        supportsStreaming: true,
    },
    'gemini-1.5-pro': {
        contextWindow: 2_097_152,
        maxTokens: 8_192,
        supportsTools: true,
        supportsStreaming: true,
    },
    'gemini-1.5-pro-002': {
        contextWindow: 2_097_152,
        maxTokens: 8_192,
        supportsTools: true,
        supportsStreaming: true,
    },
    'gemini-1.5-flash': {
        contextWindow: 1_048_576,
        maxTokens: 8_192,
        supportsTools: true,
        supportsStreaming: true,
    },
    'gemini-1.5-flash-002': {
        contextWindow: 1_048_576,
        maxTokens: 8_192,
        supportsTools: true,
        supportsStreaming: true,
    },
    'gemini-1.5-flash-8b': {
        contextWindow: 1_048_576,
        maxTokens: 8_192,
        supportsTools: true,
        supportsStreaming: true,
    },
};

// Combined registry for all models
export const MODEL_REGISTRY: Record<string, ModelInfo> = {
    ...ANTHROPIC_MODELS,
    ...OPENAI_MODELS,
    ...GEMINI_MODELS,
};

/**
 * Get model info by model ID
 */
export function getModelInfo(modelId: string): ModelInfo | undefined {
    return MODEL_REGISTRY[modelId];
}

/**
 * Get context window for a model
 */
export function getModelContextWindow(modelId: string): number {
    const info = getModelInfo(modelId);
    return info?.contextWindow ?? 200_000; // Default fallback
}

/**
 * Get max tokens for a model
 */
export function getModelMaxTokens(modelId: string): number {
    const info = getModelInfo(modelId);
    return info?.maxTokens ?? 8_192; // Default fallback
}
