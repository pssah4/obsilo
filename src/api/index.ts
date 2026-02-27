/**
 * API Handler Factory
 *
 * Adapted from Kilo Code's src/api/index.ts (buildApiHandler)
 */

import type { LLMProvider, CustomModel } from '../types/settings';
import { modelToLLMProvider } from '../types/settings';
import { AnthropicProvider } from './providers/anthropic';
import { OpenAiProvider } from './providers/openai';

export type { ApiHandler, ApiStream, ApiStreamChunk, MessageParam, ContentBlock, ModelInfo } from './types';

/**
 * Build an ApiHandler from a CustomModel (new path)
 */
export function buildApiHandlerForModel(model: CustomModel) {
    return buildApiHandler(modelToLLMProvider(model));
}

/**
 * Build an ApiHandler from a LLMProvider config (legacy / internal path)
 */
export function buildApiHandler(config: LLMProvider) {
    switch (config.type) {
        case 'anthropic':
            return new AnthropicProvider(config);
        case 'openai':
        case 'ollama':
        case 'lmstudio':
        case 'openrouter':
        case 'azure':
        case 'custom':
            return new OpenAiProvider(config);
        default:
            throw new Error(`Unknown provider type: ${(config as LLMProvider).type}`);
    }
}
