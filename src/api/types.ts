/**
 * API Types - LLM Provider Abstraction
 *
 * Adapted from Kilo Code's src/api/transform/stream.ts
 *
 * Internal format uses Anthropic's message structure.
 * Each provider converts to/from its own format.
 */

import type { ToolDefinition } from '../core/tools/types';

// --- Stream Chunks ---

export type ApiStreamChunk =
    | { type: 'text'; text: string }
    | { type: 'thinking'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, any> }
    | { type: 'usage'; inputTokens: number; outputTokens: number };

export type ApiStream = AsyncIterable<ApiStreamChunk>;

// --- Model Info ---

export interface ModelInfo {
    contextWindow: number;
    supportsTools: boolean;
    supportsStreaming: boolean;
}

// --- Message Format (Anthropic-internal, like Kilo Code) ---

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export type ContentBlock =
    | { type: 'text'; text: string }
    | { type: 'image'; source: { type: 'base64'; media_type: ImageMediaType; data: string } }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, any> }
    | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export type MessageParam = {
    role: 'user' | 'assistant';
    content: string | ContentBlock[];
};

// --- ApiHandler Interface (adapted from Kilo Code's ApiHandler) ---

export interface ApiHandler {
    /**
     * Send a message to the LLM and stream the response.
     * Tools are provided so the LLM can call them.
     * Pass an AbortSignal to support cancellation.
     */
    createMessage(
        systemPrompt: string,
        messages: MessageParam[],
        tools: ToolDefinition[],
        abortSignal?: AbortSignal,
    ): ApiStream;

    /**
     * Get model information
     */
    getModel(): { id: string; info: ModelInfo };
}
