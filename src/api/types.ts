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
    // requiresPassback: set by providers whose API contract requires the reasoning
    // text to be echoed back on the next tool-resolution request (DeepSeek
    // deepseek-reasoner via OpenAI-compatible; see FIX-04-03-07). AgentTask
    // accumulates these into a ThinkingBlock on the assistant message; others
    // are display-only.
    | { type: 'thinking'; text: string; requiresPassback?: boolean }
    // IMP-41-01-05: emitted once per Anthropic thinking block at its
    // content_block_stop, sealing the preceding thinking deltas with the
    // signature required for multi-turn passback.
    | { type: 'thinking_signature'; signature: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
    | { type: 'tool_error'; id: string; name: string; error: string }
    // FIX-24-05-08 (R1): the usage chunk names the model it belongs to, so the
    // code that PRICES a call reads the same id as the code that SERVED it.
    // Without this the consumer had to ask some other object which model was
    // current, and every mid-run swap (TaskRouter escalation, advisor consult,
    // helper-model condensing) billed the tokens to the wrong model.
    //
    // idOrigin says how much to trust the id:
    //  - 'served'    stamped by the handler that produced this stream, from its
    //                own configured model id (withUsageAttribution, or a
    //                provider that knows better). This is NOT "echoed by the
    //                endpoint": reading the model back off the wire would let a
    //                server's own spelling replace the configured id, which is a
    //                separate decision because the id doubles as the lookup key
    //                into the user's model settings.
    //  - 'requested' the id a caller asked for or assumed, for a consumer that
    //                has to fill the field in because no producer stamped one.
    | { type: 'usage'; inputTokens: number; outputTokens: number;
        cacheReadTokens?: number; cacheCreationTokens?: number;
        modelId?: string; idOrigin?: 'requested' | 'served' };

export type ApiStream = AsyncIterable<ApiStreamChunk>;

/**
 * Build the actionable error for a malformed / truncated tool-call input. Every
 * provider's stream handler uses this so the model gets a consistent,
 * recovery-oriented instruction (split the write, do not double-emit) instead of
 * a bare JSON parse error it can only loop on.
 */
export function truncatedToolInputError(toolName: string, rawError: string, wasMaxTokens = false): string {
    const cause = wasMaxTokens
        ? `The response hit the max output token limit, so this "${toolName}" call was cut off before its arguments finished.`
        : `The "${toolName}" tool-call arguments were truncated or malformed.`;
    return `Tool input parse error: ${rawError}. ${cause} `
        + `Do NOT retry the same call. If this was a large write, split it: call write_file with the document header and the first section only, then call append_to_file repeatedly for the rest. `
        + `Reduce the payload if needed. Output the document only through the tool — do not also print its full text in your reply.`;
}

// --- Model Info ---

export interface ModelInfo {
    contextWindow: number;
    supportsTools: boolean;
    supportsStreaming: boolean;
}

// --- Message Format (Anthropic-internal, like Kilo Code) ---

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

/**
 * Content blocks that can appear inside a tool_result to return multimodal data
 * (e.g. rendered slide images alongside text descriptions).
 */
export type ToolResultContentBlock =
    | { type: 'text'; text: string }
    | { type: 'image'; source: { type: 'base64'; media_type: ImageMediaType; data: string } };

export type ContentBlock =
    | { type: 'text'; text: string }
    | { type: 'image'; source: { type: 'base64'; media_type: ImageMediaType; data: string } }
    // FIX-04-03-07: persisted reasoning text for OpenAI-compatible reasoner
    // models (DeepSeek deepseek-reasoner). Only emitted on the wire by the
    // OpenAI-compatible provider for the last assistant message with tool_use,
    // and only for config.type ∈ {custom, ollama, lmstudio}. All other
    // providers strip thinking blocks via stripThinkingBlocks().
    // IMP-41-01-05: signature present = Anthropic signed extended thinking;
    // sent back verbatim on the last assistant turn (prepareThinkingForPassback).
    // Absent = display/reasoner text, stripped before Anthropic/Bedrock sends.
    | { type: 'thinking'; text: string; signature?: string }
    // IMP-41-01-05: opaque encrypted reasoning Anthropic occasionally returns;
    // must round-trip unmodified on the last assistant turn.
    | { type: 'redacted_thinking'; data: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
    | { type: 'tool_result'; tool_use_id: string; content: string | ToolResultContentBlock[]; is_error?: boolean };

export type MessageParam = {
    role: 'user' | 'assistant';
    content: string | ContentBlock[];
};

// --- ApiHandler Interface (adapted from Kilo Code's ApiHandler) ---

export interface ApiHandler {
    /**
     * IMP-41-02-03: provider type this handler serves, stamped by
     * buildApiHandler. Consumed by the rate limiter and (W3) the circuit
     * breaker for per-provider keying. Optional for hand-built test handlers.
     */
    providerType?: string;

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

    /**
     * Quick non-streaming text completion for lightweight classification tasks.
     * Used by skill matching LLM-fallback (~100 input tokens, ~10 output tokens).
     * Returns the raw text response trimmed of whitespace.
     *
     * FIX-19-05-05: optionaler maxTokens (Default 50). Der Freshness-Verifier
     * uebergibt ~512, weil sein JSON-Urteil sonst abgeschnitten wird.
     */
    classifyText?(prompt: string, abortSignal?: AbortSignal, maxTokens?: number): Promise<string>;

    /**
     * IMP-41-01-04 / ADR-148: exact prompt token count for the given request
     * shape, when the provider offers a counting endpoint (Anthropic
     * count_tokens). Returns undefined on any failure — callers treat this
     * as an optional calibration seed, never a blocker.
     */
    countTokens?(
        systemPrompt: string,
        messages: MessageParam[],
        tools: ToolDefinition[],
        abortSignal?: AbortSignal,
    ): Promise<number | undefined>;
}
