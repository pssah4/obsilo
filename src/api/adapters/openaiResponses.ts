/**
 * OpenAI-Responses wire adapter (IMP-41-03-03, ADR-150).
 *
 * Owns the Responses-API wire format used by the chatgpt-oauth (Codex) and
 * github-copilot providers: message/tool conversion (incl. the FIX-04-03-11
 * input_image mapping), the complete request-body construction with the GPT-5
 * reasoning-floor quirks, and (FIX-45-03-01) the transport-free mapping of stream
 * events back into ApiStreamChunks. Each provider keeps its own auth and
 * transport: Node-https plus SSE parsing for the Codex backend, the OpenAI SDK
 * for Copilot.
 */

import type { LLMProvider } from '../../types/settings';
import type { ApiStreamChunk, MessageParam } from '../types';
import { truncatedToolInputError } from '../types';
import type { ToolDefinition } from '../../core/tools/types';
import { modelSupportsTemperature } from '../../types/model-registry';
import { stripCacheBreakpointMarker } from '../../core/systemPrompt';
import { createLogger } from '../../core/observability/log';

const log = createLogger('Responses');

// ---------------------------------------------------------------------------
// Responses API types (observed 2026-04-28)
// ---------------------------------------------------------------------------

export interface ResponsesInputMessage {
    type: 'message';
    role: 'user' | 'assistant' | 'system';
    content: ResponsesContentBlock[];
}

export interface ResponsesFunctionCallOutput {
    type: 'function_call_output';
    call_id: string;
    output: string;
}

export interface ResponsesFunctionCall {
    type: 'function_call';
    call_id: string;
    name: string;
    arguments: string;
}

export type ResponsesInputItem = ResponsesInputMessage | ResponsesFunctionCallOutput | ResponsesFunctionCall;

export type ResponsesContentBlock =
    // IMP-18-01-04: `prompt_cache_breakpoint` marks the end of a reusable prompt
    // prefix on the Responses API. Copilot and Bedrock-hosted GPT-5.6 read it;
    // every other provider ignores an unknown field. Typed rather than cast so
    // the marker code stays free of `any` and the name cannot be misspelled.
    | { type: 'input_text'; text: string; prompt_cache_breakpoint?: { mode: 'explicit' } }
    | { type: 'output_text'; text: string }
    // FIX-04-03-11: Responses API image input. detail defaults to 'auto' so
    // the upload tokens stay bounded for OCR-style screenshots.
    | { type: 'input_image'; image_url: string; detail?: 'auto' | 'low' | 'high' };

export interface ResponsesTool {
    type: 'function';
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

/** The GPT-5 / o-series effort levels accepted on the Codex Responses surface. */
const GPT_EFFORT_LEVELS: ReasoningEffort[] = ['minimal', 'low', 'medium', 'high'];

/**
 * Resolve the reasoning effort to send. The configured level may be a wider
 * EffortLevel (Claude has xhigh/max) so only a GPT-valid level is forwarded;
 * anything else (unset, or a Claude-only level) falls back to `fallback`.
 *
 * An explicit GPT-valid value always wins, in both directions -- a user who
 * picks 'minimal' gets 'minimal' even where the fallback is higher. That is the
 * point of the manual selector.
 *
 * The default fallback stays 'low', the documented 400-avoidance floor for the
 * Codex backend. Copilot passes 'high' instead (FIX-45-03-01): its GPT-5.6 lineup
 * is used for agentic work where the extra reasoning is the reason to pick the
 * model at all.
 */
export function resolveGptEffort(
    level: string | undefined,
    fallback: ReasoningEffort = 'low',
): ReasoningEffort {
    return asGptEffort(level) ?? fallback;
}

/**
 * The configured level if it is one a GPT reasoning model accepts, otherwise
 * undefined. Separate from resolveGptEffort because a caller that wants "no
 * level at all" cannot express it through the fallback parameter -- passing
 * undefined there triggers the default value instead.
 */
export function asGptEffort(level: string | undefined): ReasoningEffort | undefined {
    return GPT_EFFORT_LEVELS.find((valid) => valid === level);
}

export interface ResponsesRequestBody {
    model: string;
    instructions?: string;
    input: ResponsesInputItem[];
    tools?: ResponsesTool[];
    stream: true;
    parallel_tool_calls?: boolean;
    store?: boolean;
    /** Required for GPT-5* models on the Codex backend; omitting it yields HTTP 400. */
    reasoning?: { effort: ReasoningEffort; summary?: 'auto' };
    include?: string[];
    [extra: string]: unknown;
}

/**
 * GPT-5* are reasoning models; the chatgpt.com Codex backend rejects requests
 * for them with HTTP 400 when the `reasoning` field is missing. "low" is the
 * narrowest effort accepted by both `gpt-5` (minimal/low/medium/high) and the
 * stricter codex variants (low/medium/high), so it is the safe default for
 * connection tests and short calls. Verified against
 * forked-kilocode/packages/types/src/providers/openai-codex.ts (supportsReasoningEffort matrix).
 */
export function isGpt5Family(modelId: string): boolean {
    return /^gpt-5(\b|[.-])/i.test(modelId);
}

/** Convert internal MessageParam[] to Responses input items. */
export function convertToResponsesInput(messages: MessageParam[]): ResponsesInputItem[] {
    const result: ResponsesInputItem[] = [];

    for (const msg of messages) {
        if (typeof msg.content === 'string') {
            result.push({
                type: 'message',
                role: msg.role,
                content: [
                    msg.role === 'assistant'
                        ? { type: 'output_text', text: msg.content }
                        : { type: 'input_text', text: msg.content },
                ],
            });
            continue;
        }

        const blocks = msg.content;

        if (msg.role === 'assistant') {
            // FIX-04-03-07: thinking blocks (DeepSeek-style reasoning) are
            // dropped here -- ChatGPT-OAuth uses the Responses API with
            // encrypted reasoning summaries, not a plaintext echo field.
            const textParts = blocks
                .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
                .map((b) => b.text)
                .join('');
            if (textParts) {
                result.push({
                    type: 'message',
                    role: 'assistant',
                    content: [{ type: 'output_text', text: textParts }],
                });
            }
            for (const block of blocks) {
                if (block.type === 'tool_use') {
                    result.push({
                        type: 'function_call',
                        call_id: block.id,
                        name: block.name,
                        arguments: JSON.stringify(block.input),
                    });
                }
            }
        } else {
            // FIX-04-03-11: pre-fix this branch handled only text and
            // tool_result blocks; image blocks were silently dropped, so
            // GPT-5 / o-series vision through the Codex Responses path
            // saw text only and answered "I don't see an image". Same
            // class as FIX-04-03-09 (which fixed the openai / copilot /
            // kilo OpenAI-Chat-Completions shape). The Responses API
            // expects { type: 'input_image', image_url: data:... } on a
            // user message content array.
            const textParts: string[] = [];
            const userContent: ResponsesContentBlock[] = [];
            for (const block of blocks) {
                if (block.type === 'text') {
                    textParts.push(block.text);
                } else if (block.type === 'image') {
                    userContent.push({
                        type: 'input_image',
                        image_url: `data:${block.source.media_type};base64,${block.source.data}`,
                    });
                } else if (block.type === 'tool_result') {
                    const text = typeof block.content === 'string'
                        ? block.content
                        : block.content
                            .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
                            .map((b) => b.text)
                            .join('\n');
                    result.push({
                        type: 'function_call_output',
                        call_id: block.tool_use_id,
                        output: text,
                    });
                }
            }
            if (textParts.length > 0) {
                userContent.unshift({ type: 'input_text', text: textParts.join('\n') });
            }
            if (userContent.length > 0) {
                result.push({
                    type: 'message',
                    role: 'user',
                    content: userContent,
                });
            }
        }
    }

    return result;
}

/** Convert ToolDefinition[] to Responses function tools. */
export function convertToResponsesTools(tools: ToolDefinition[]): ResponsesTool[] {
    return tools.map((tool) => ({
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
    }));
}

/**
 * Build the COMPLETE streaming request body for one turn, including the
 * GPT-5 reasoning floor and temperature quirks. Byte-identical to the
 * legacy inline construction (golden-pinned).
 */
export function prepareResponsesRequest(
    config: LLMProvider,
    systemPrompt: string,
    messages: MessageParam[],
    tools: ToolDefinition[],
): ResponsesRequestBody {
    const body: ResponsesRequestBody = {
        model: config.model,
        // D1: `instructions` is plain text with no marker slot. This path serves
        // chatgpt-oauth AND Copilot's /responses route (the gpt-5.6 lineup),
        // which together carried the sentinel on most of the logged traffic.
        instructions: stripCacheBreakpointMarker(systemPrompt),
        input: convertToResponsesInput(messages),
        stream: true,
        store: false,
    };
    if (tools.length > 0) {
        body.tools = convertToResponsesTools(tools);
        body.parallel_tool_calls = false;
    }
    if (isGpt5Family(config.model)) {
        // The Codex backend rejects GPT-5* requests without a reasoning field.
        // Default to 'low' (the documented 400-avoidance value); an explicit
        // user-chosen effort overrides it. Never derive medium/high without
        // an explicit user value -- the hardcoded low stays the floor.
        body.reasoning = { effort: resolveGptEffort(config.reasoningEffort), summary: 'auto' };
        body.include = ['reasoning.encrypted_content'];
    }
    // FIX-04-03-02: omit temperature for default-only models (e.g. GPT-5.x)
    if (config.temperature !== undefined && modelSupportsTemperature(config.model)) {
        body.temperature = Math.min(config.temperature, 2.0);
    }
    return body;
}

// ---------------------------------------------------------------------------
// Stream events -> ApiStreamChunk (FIX-45-03-01)
// ---------------------------------------------------------------------------

/** One function call being assembled across events. */
interface ResponsesToolCallState {
    callId: string;
    name: string;
    argsJson: string;
}

/**
 * Per-stream accumulator. The Responses API splits a function call across an
 * `output_item.added`, a run of `function_call_arguments.delta` events and a
 * closing `output_item.done`, so the pieces have to be held somewhere between
 * events. One state object per stream; never share across streams.
 */
export interface ResponsesStreamState {
    toolCalls: Map<string, ResponsesToolCallState>;
}

export function createResponsesStreamState(): ResponsesStreamState {
    return { toolCalls: new Map() };
}

function num(v: unknown): number | undefined {
    return typeof v === 'number' ? v : undefined;
}

/**
 * The key under which one function call is accumulated across its
 * `output_item.added`, argument deltas and `output_item.done`.
 *
 * `output_index` first, because it is the only field guaranteed to be the same
 * on all three: Copilot's /responses stream stamps every argument delta with a
 * fresh opaque `item_id`, so keying on the id split a single call into one
 * nameless orphan per streamed token -- the call never reached the agent, and
 * each orphan logged a line. Where `output_index` is absent (the Codex backend
 * sends stable ids) the id fallback keeps the previous behaviour.
 */
function toolCallKey(
    event: Record<string, unknown>,
    item?: Record<string, unknown>,
): string | undefined {
    const index = num(event.output_index);
    if (index !== undefined) return `idx:${index}`;
    return (event.item_id ?? event.call_id ?? item?.call_id ?? item?.id) as string | undefined;
}

/** The id the model expects back on a function_call_output, if this event carries it. */
function callIdOf(item: Record<string, unknown> | undefined): string | undefined {
    return (item?.call_id ?? item?.id) as string | undefined;
}

function* finalizeToolCall(state: ResponsesToolCallState): Generator<ApiStreamChunk> {
    if (!state.callId || !state.name) {
        // Debug, not warn: a nameless remainder is the expected shape when the
        // model stops mid-call (output cap, abort), and it is not something the
        // user can act on. See core/observability/log.ts for why noisy paths
        // must not occupy the ring buffer.
        log.debug('Skipping incomplete tool_call', state);
        return;
    }
    let input: Record<string, unknown> = {};
    try {
        input = state.argsJson.trim() ? JSON.parse(state.argsJson) as Record<string, unknown> : {};
    } catch (e) {
        // BUG-032: emit tool_error so AgentTask records the failure and breaks
        // the loop, rather than letting a parse error kill the whole stream.
        yield {
            type: 'tool_error',
            id: state.callId,
            name: state.name,
            error: truncatedToolInputError(state.name, (e as Error).message),
        };
        return;
    }
    yield { type: 'tool_use', id: state.callId, name: state.name, input };
}

/**
 * Map one parsed Responses stream event onto ApiStreamChunks.
 *
 * Transport-free on purpose: the caller supplies already-parsed event objects,
 * whether they came from hand-parsed SSE blocks (chatgpt-oauth) or from the
 * OpenAI SDK's typed event stream (github-copilot).
 *
 * Throws on `response.failed` -- that event means the server gave up, and
 * swallowing it would leave the turn looking like an empty answer.
 */
export function* responsesEventToChunks(
    event: Record<string, unknown>,
    state: ResponsesStreamState,
): Generator<ApiStreamChunk> {
    const type = event.type as string | undefined;
    if (!type) return;
    const { toolCalls } = state;

    if (type === 'response.output_text.delta') {
        const delta = event.delta;
        if (typeof delta === 'string' && delta.length > 0) {
            yield { type: 'text', text: delta };
        }
        return;
    }

    if (type === 'response.output_item.added') {
        const item = event.item as Record<string, unknown> | undefined;
        if (item && item.type === 'function_call') {
            const key = toolCallKey(event, item);
            if (!key) return;
            const name = (item.name as string | undefined) ?? '';
            toolCalls.set(key, { callId: callIdOf(item) ?? '', name, argsJson: '' });
        }
        return;
    }

    if (type === 'response.function_call_arguments.delta') {
        const key = toolCallKey(event);
        const delta = event.delta as string | undefined;
        if (key && delta) {
            const existing = toolCalls.get(key);
            if (existing) existing.argsJson += delta;
            // A delta before its added event: keep the fragment, the closing
            // done event still carries the name and the real call id.
            else {
                const callId = (event.item_id ?? event.call_id ?? '') as string;
                toolCalls.set(key, { callId, name: '', argsJson: delta });
            }
        }
        return;
    }

    if (type === 'response.output_item.done') {
        const item = event.item as Record<string, unknown> | undefined;
        if (item && item.type === 'function_call') {
            const key = toolCallKey(event, item);
            if (!key) return;
            const existing = toolCalls.get(key);
            const call: ResponsesToolCallState = existing ?? { callId: '', name: '', argsJson: '' };
            // The done event is the authority on the call id: a delta-first
            // call was keyed by index and may hold a per-delta id, or none.
            const doneCallId = callIdOf(item);
            if (doneCallId) call.callId = doneCallId;
            if (!call.name && typeof item.name === 'string') call.name = item.name;
            if (!call.argsJson && typeof item.arguments === 'string') call.argsJson = item.arguments;
            yield* finalizeToolCall(call);
            toolCalls.delete(key);
        }
        return;
    }

    if (type === 'response.completed') {
        const response = event.response as Record<string, unknown> | undefined;
        const usage = response?.usage as Record<string, unknown> | undefined;
        if (usage) {
            const input = num(usage.input_tokens) ?? num(usage.prompt_tokens) ?? 0;
            const output = num(usage.output_tokens) ?? num(usage.completion_tokens) ?? 0;
            // FIX-21-02-01 / IMP-18-01-02: input_tokens INCLUDES the cached
            // prefix. Report the non-cached part as inputTokens and the cached
            // part separately, matching the other OpenAI-shaped providers, so
            // the cost calc bills the cached prefix at the cache-read rate.
            const details = usage.input_tokens_details as Record<string, unknown> | undefined;
            const cachedIn = num(details?.cached_tokens) ?? 0;
            yield {
                type: 'usage',
                inputTokens: Math.max(0, input - cachedIn),
                outputTokens: output,
                cacheReadTokens: cachedIn > 0 ? cachedIn : undefined,
            };
        }
        yield* flushResponsesStreamState(state);
        return;
    }

    if (type === 'response.failed') {
        const response = event.response as Record<string, unknown> | undefined;
        const error = response?.error as Record<string, unknown> | undefined;
        const message = (error?.message as string | undefined) ?? 'response.failed';
        throw new Error(`Responses stream failed: ${message}`);
    }

    // Everything else (response.created, .in_progress, .output_text.done,
    // reasoning summaries) carries nothing the agent loop consumes.
}

/**
 * Emit any function calls still open, then clear them. Call once after the
 * stream ends: a provider that stops without a closing `response.completed`
 * would otherwise drop the tool calls silently (the Responses-side twin of
 * BUG-013). A no-op when everything already went out.
 */
export function* flushResponsesStreamState(
    state: ResponsesStreamState,
): Generator<ApiStreamChunk> {
    for (const call of state.toolCalls.values()) {
        yield* finalizeToolCall(call);
    }
    state.toolCalls.clear();
}
