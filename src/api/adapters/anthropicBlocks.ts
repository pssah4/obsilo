/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/restrict-template-expressions -- File-level disable: wire-format code against the external Anthropic SDK where untyped values are unavoidable. */
/**
 * Anthropic-blocks wire adapter (IMP-41-03-03, ADR-150).
 *
 * Owns the COMPLETE wire format for Anthropic's native message API: internal
 * MessageParam[] -> SDK shapes, tool schemas, the four-breakpoint cache
 * layout (ADR-62 / FEAT-24-01 / FIX-PERF-21), generation parameters
 * (temperature quirks, thinking shapes, output_config.effort) and the
 * stream-event -> ApiStreamChunk parser (including signed-thinking capture
 * and truncated-tool recovery).
 *
 * The provider class keeps ONLY auth/endpoint/dispatch. Every payload this
 * adapter produces is pinned by the wire-format golden suite
 * (src/api/__tests__/wireFormatGolden.test.ts) — the extraction reproduced
 * the legacy payloads byte-identically, and any future change here must
 * update those snapshots with an explaining commit.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider } from '../../types/settings';
import type { ApiStream, ApiStreamChunk, ContentBlock, MessageParam } from '../types';
import { truncatedToolInputError } from '../types';
import type { ToolDefinition } from '../../core/tools/types';
import { resolveOutputBudget, estimatePromptTokens, modelSupportsTemperature, modelUsesBudgetTokensThinking } from '../../types/model-registry';
import { splitSystemPromptAtCacheBreakpoint, stripCacheBreakpointMarker } from '../../core/systemPrompt';
import { logCacheStat } from '../logCacheStat';
import { stripThinkingBlocks, prepareThinkingForPassback, repairEmptyWireMessages } from '../../core/utils/stripThinkingBlocks';

/** The Claude-native reasoning-effort levels accepted by output_config.effort. */
const CLAUDE_EFFORT_SET = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

/** Put an ephemeral cache_control marker on the last content block of a message. */
export function markLastBlock(msg: Anthropic.MessageParam): void {
    if (typeof msg.content === 'string') {
        msg.content = [{ type: 'text', text: msg.content, cache_control: { type: 'ephemeral' } }];
        return;
    }
    if (Array.isArray(msg.content) && msg.content.length > 0) {
        const blocks = msg.content;
        const last = blocks[blocks.length - 1] as Anthropic.Messages.ContentBlockParam & { cache_control?: { type: 'ephemeral' } };
        // text and tool_result blocks accept cache_control; for anything else, append a tiny text block.
        if ('type' in last && (last.type === 'text' || last.type === 'tool_result')) {
            last.cache_control = { type: 'ephemeral' };
        } else {
            blocks.push({ type: 'text', text: '​', cache_control: { type: 'ephemeral' } });
        }
    }
}

/**
 * FEAT-24-01: place two rolling cache breakpoints in the message history — one on
 * the last user message (advances each turn) and one a few turns earlier (stays a
 * stable cache prefix across turns). Keeps the conversation part of long sessions
 * mostly cache reads instead of full re-sends.
 */
export function markRollingHistoryBreakpoints(messages: Anthropic.MessageParam[]): void {
    let lastUser = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') { lastUser = i; break; }
    }
    if (lastUser < 0) return;
    markLastBlock(messages[lastUser]);
    // Second marker at least ~6 messages further back, so it stays a stable cache
    // prefix across several turns instead of advancing with the conversation.
    const STABLE_BACKOFF = 6;
    for (let i = lastUser - STABLE_BACKOFF; i >= 0; i--) {
        if (messages[i].role === 'user') { markLastBlock(messages[i]); break; }
    }
}

/**
 * Convert internal MessageParam[] to Anthropic's MessageParam[].
 * Adapted from Kilo Code's message conversion logic.
 */
export function convertToAnthropicMessages(messages: MessageParam[]): Anthropic.MessageParam[] {
    return messages.map((msg) => {
        if (typeof msg.content === 'string') {
            return { role: msg.role, content: msg.content };
        }

        // Let TypeScript infer the correct union type from the SDK
        const content = msg.content.map((block) => {
            if (block.type === 'text') {
                return { type: 'text' as const, text: block.text };
            }

            // IMP-41-01-05: signed thinking round-trips verbatim. Unsigned
            // blocks should have been filtered by prepareThinkingForPassback /
            // stripThinkingBlocks; drop defensively rather than 400.
            if (block.type === 'thinking') {
                if (block.signature) {
                    return { type: 'thinking' as const, thinking: block.text, signature: block.signature };
                }
                return null;
            }

            if (block.type === 'redacted_thinking') {
                return { type: 'redacted_thinking' as const, data: block.data };
            }

            if (block.type === 'tool_use') {
                return {
                    type: 'tool_use' as const,
                    id: block.id,
                    name: block.name,
                    input: block.input,
                };
            }

            if (block.type === 'image') {
                return {
                    type: 'image' as const,
                    source: {
                        type: 'base64' as const,
                        media_type: block.source.media_type,
                        data: block.source.data,
                    },
                };
            }

            if (block.type === 'tool_result') {
                return {
                    type: 'tool_result' as const,
                    tool_use_id: block.tool_use_id,
                    content: block.content,
                    is_error: block.is_error,
                };
            }

            throw new Error(`Unknown content block type: ${(block as ContentBlock).type}`);
        }).filter((b): b is NonNullable<typeof b> => b !== null);

        return { role: msg.role, content };
    });
}

/** Convert ToolDefinition[] to Anthropic's tool format. */
export function convertToAnthropicTools(tools: ToolDefinition[]): Anthropic.Tool[] {
    return tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema,
    }));
}

/**
 * Build the COMPLETE streaming request body for one turn: message/tool
 * conversion, thinking passback preparation, the four-breakpoint cache
 * layout and every generation parameter. Byte-identical to the legacy
 * inline construction (golden-pinned).
 */
export function prepareAnthropicRequest(
    config: LLMProvider,
    systemPrompt: string,
    messages: MessageParam[],
    tools: ToolDefinition[],
): Record<string, unknown> {
    // IMP-41-01-05: with thinking enabled, signed thinking blocks of the
    // last assistant turn are passed back (API contract for tool_use
    // loops); unsigned blocks are stripped everywhere. With thinking
    // disabled the legacy full strip applies (the API rejects thinking
    // blocks on non-thinking requests). FIX-04-03-07 cross-provider
    // safety is preserved: foreign reasoner blocks are unsigned and
    // therefore never reach the wire.
    // Loop-economy FIX C3: repair messages the strip left empty (assistant
    // turns that carried only reasoning) — the API rejects empty content.
    const preparedMessages = repairEmptyWireMessages((config.thinkingEnabled ?? false)
        ? prepareThinkingForPassback(messages)
        : stripThinkingBlocks(messages));
    const anthropicMessages = convertToAnthropicMessages(preparedMessages);
    const anthropicTools = convertToAnthropicTools(tools);

    // Prompt caching (ADR-62 amendment / FEAT-24-01):
    //  1) split the system prompt at the cache breakpoint — only the stable
    //     prefix gets cache_control, the volatile tail (date/memory/skills/
    //     vault context) gets none, so the prefix stays a cache hit per turn;
    //  2) one cache_control on the last tool entry (~30k tokens, stable);
    //  3) two rolling markers in the message history — one on the last user
    //     message (moves each turn), one a few turns back (stays warm). That
    //     is 1 + 1 + 2 = 4 breakpoints, the Anthropic maximum.
    if (config.promptCachingEnabled) {
        markRollingHistoryBreakpoints(anthropicMessages);
        if (anthropicTools.length > 0) {
            // FIX-PERF-21: pin the cache marker on attempt_completion when
            // available instead of the literal last tool. attempt_completion
            // is one of the most stable tools across mode switches and
            // dynamic tool registrations; pinning the breakpoint there
            // means the cache prefix stays warm even when the tail of
            // the tool list changes (e.g. find_tool surfaces a deferred
            // tool, mode switch swaps the toolset). Fallback to last
            // tool preserves behaviour for unusual configurations.
            const attemptIdx = anthropicTools.findIndex((t) => t.name === 'attempt_completion');
            const targetIdx = attemptIdx !== -1 ? attemptIdx : anthropicTools.length - 1;
            const target = anthropicTools[targetIdx] as Anthropic.Tool & { cache_control?: { type: 'ephemeral' } };
            target.cache_control = { type: 'ephemeral' };
        }
    }

    let systemParam: string | Anthropic.Messages.TextBlockParam[];
    if (config.promptCachingEnabled) {
        const { stable, volatile } = splitSystemPromptAtCacheBreakpoint(systemPrompt);
        systemParam = volatile.trim().length > 0
            ? [
                { type: 'text' as const, text: stable, cache_control: { type: 'ephemeral' as const } },
                { type: 'text' as const, text: volatile },
              ]
            : [{ type: 'text' as const, text: stable, cache_control: { type: 'ephemeral' as const } }];
    } else {
        // D1: with caching off nothing splits the prompt, so the sentinel has to
        // be removed here or it reaches the model.
        systemParam = stripCacheBreakpointMarker(systemPrompt);
    }

    // Extended thinking: when enabled, temperature MUST be 1.
    // resolveOutputBudget adds the thinking budget on top of the visible-output
    // budget and clamps both to the model's real output ceiling — prevents a
    // near-empty answer (truncated tool calls) and prevents 400s from an
    // over-eager Settings value.
    const thinkingEnabled = config.thinkingEnabled ?? false;
    const { maxTokens: effectiveMaxTokens, thinkingBudgetTokens: budgetTokens } = resolveOutputBudget(
        config.model,
        config.maxTokens,
        {
            enabled: thinkingEnabled,
            budgetTokens: config.thinkingBudgetTokens,
            estimatedInputTokens: estimatePromptTokens(systemPrompt, messages, tools),
        },
    );
    // FIX-04-03-02: Some recent models (Opus 4.7+) reject any temperature
    // value with a 400. Detect via shared helper and omit the parameter.
    const supportsTemperature = modelSupportsTemperature(config.model);
    const effectiveTemperature = !supportsTemperature
        ? undefined
        : thinkingEnabled
            ? 1
            : Math.min(config.temperature ?? 0.2, 1.0);

    // Extended thinking shape depends on the model family:
    //  - Adaptive lineup (Opus 4.7/4.8, Fable, Mythos) removed budget_tokens
    //    and 400s if it is sent -> { type: 'adaptive' }.
    //  - Older Claude (Opus 4.6 and earlier, Sonnet 4.6, 3.x) still takes the
    //    legacy { type: 'enabled', budget_tokens } shape.
    // budgetTokens is computed regardless (resolveOutputBudget already added
    // it on top of the visible budget) but only emitted for the older family.
    const usesBudgetTokens = modelUsesBudgetTokensThinking(config.model);
    let thinkingParam: Anthropic.Messages.ThinkingConfigParam | undefined;
    if (thinkingEnabled) {
        thinkingParam = usesBudgetTokens
            ? { type: 'enabled' as const, budget_tokens: budgetTokens }
            : { type: 'adaptive' as const };
    }

    // Per-conversation reasoning effort (GA, no beta header). Only sent when
    // the user pinned an explicit level; 'auto'/undefined sends nothing, so
    // the request stays byte-identical to today. The chat-header gate already
    // restricts this to effort-capable (model, provider) pairs. Defensive:
    // only a level in the Claude family set is forwarded, so a GPT-only
    // 'minimal' accidentally set on a Claude model is dropped, not sent.
    const reasoningEffort = config.reasoningEffort;
    const claudeEffort = reasoningEffort && CLAUDE_EFFORT_SET.has(reasoningEffort)
        ? reasoningEffort
        : undefined;
    // output_config.effort accepts low|medium|high|xhigh|max on the wire; the
    // SDK type does not yet list 'xhigh', so the field is built as a loose
    // record and merged below (the GA wire surface is the source of truth).
    const outputConfig: Record<string, unknown> | undefined = claudeEffort
        ? { effort: claudeEffort }
        : undefined;

    return {
        model: config.model,
        max_tokens: effectiveMaxTokens,
        ...(effectiveTemperature !== undefined ? { temperature: effectiveTemperature } : {}),
        system: systemParam,
        messages: anthropicMessages,
        tools: anthropicTools.length > 0 ? anthropicTools : undefined,
        tool_choice: anthropicTools.length > 0 ? { type: 'auto' } : undefined,
        ...(thinkingParam ? { thinking: thinkingParam } : {}),
        ...(outputConfig ? { output_config: outputConfig } : {}),
    };
}

/**
 * Parse the SDK's stream events into ApiStreamChunks: accumulate tool input
 * JSON and yield complete tool_use objects (not partial streaming — this
 * simplifies the conversation loop significantly), capture signed thinking
 * blocks, hold parse failures until stop_reason is known
 * (truncated-tool recovery), and emit usage + cache diagnostics at the end.
 */
export async function* parseAnthropicStream(
    stream: AsyncIterable<Anthropic.Messages.RawMessageStreamEvent>,
    opts: { model: string; cachingEnabled: boolean },
): ApiStream {
    // Process stream - accumulate tool input JSON, yield complete tool_use
    // Adapted from Kilo Code's approach in anthropic.ts
    const toolAccumulator = new Map<
        number,
        { id: string; name: string; inputJson: string }
    >();
    // Track thinking blocks by index — yield streaming text then flush on stop.
    // IMP-41-01-05: signature_delta events accumulate per block and are
    // sealed as a thinking_signature chunk at content_block_stop.
    const thinkingAccumulator = new Map<number, { text: string; signature: string }>();

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;
    // stop_reason arrives in message_delta, AFTER every content_block_stop, so
    // parse failures are held and resolved once we know whether the response
    // was cut off by max_tokens.
    let stopReason: string | null = null;
    const failedToolParses: Array<{ id: string; name: string; rawError: string }> = [];

    for await (const event of stream) {
        if (event.type === 'message_start') {
            inputTokens = event.message.usage.input_tokens;
            cacheReadTokens = event.message.usage.cache_read_input_tokens ?? 0;
            cacheCreationTokens = event.message.usage.cache_creation_input_tokens ?? 0;
        }

        if (event.type === 'message_delta') {
            outputTokens = event.usage.output_tokens;
            if (event.delta.stop_reason) stopReason = event.delta.stop_reason;
        }

        if (event.type === 'content_block_start') {
            if (event.content_block.type === 'tool_use') {
                toolAccumulator.set(event.index, {
                    id: event.content_block.id,
                    name: event.content_block.name,
                    inputJson: '',
                });
            } else if (event.content_block.type === 'thinking') {
                thinkingAccumulator.set(event.index, { text: '', signature: '' });
            }
        }

        if (event.type === 'content_block_delta') {
            if (event.delta.type === 'text_delta') {
                yield { type: 'text', text: event.delta.text } satisfies ApiStreamChunk;
            }

            if (event.delta.type === 'input_json_delta') {
                const tool = toolAccumulator.get(event.index);
                if (tool) tool.inputJson += event.delta.partial_json;
            }

            // Anthropic extended thinking delta. requiresPassback so the
            // loop persists the text into the assistant message; the
            // signature below decides whether it is ever re-sent.
            if (event.delta.type === 'thinking_delta') {
                const thinking = thinkingAccumulator.get(event.index);
                if (thinking) {
                    const chunk = event.delta.thinking;
                    thinking.text += chunk;
                    yield { type: 'thinking', text: chunk, requiresPassback: true } satisfies ApiStreamChunk;
                }
            }

            // IMP-41-01-05: signature arrives in fragments after the text.
            if (event.delta.type === 'signature_delta') {
                const thinking = thinkingAccumulator.get(event.index);
                if (thinking) thinking.signature += event.delta.signature;
            }
        }

        if (event.type === 'content_block_stop') {
            const closingThinking = thinkingAccumulator.get(event.index);
            if (closingThinking && closingThinking.signature.length > 0) {
                yield {
                    type: 'thinking_signature',
                    signature: closingThinking.signature,
                } satisfies ApiStreamChunk;
            }
            thinkingAccumulator.delete(event.index);

            // If this was a tool_use block, yield the complete tool call
            const tool = toolAccumulator.get(event.index);
            if (tool) {
                let parsedInput: Record<string, unknown> | undefined;
                try {
                    parsedInput = tool.inputJson ? JSON.parse(tool.inputJson) : {};
                } catch (e) {
                    // Hold it — the actionable message depends on the stop_reason,
                    // which only arrives in the upcoming message_delta event.
                    failedToolParses.push({ id: tool.id, name: tool.name, rawError: (e as Error).message });
                }
                if (parsedInput !== undefined) {
                    yield {
                        type: 'tool_use',
                        id: tool.id,
                        name: tool.name,
                        input: parsedInput,
                    } satisfies ApiStreamChunk;
                }
                toolAccumulator.delete(event.index);
            }
        }
    }

    // A tool still in the accumulator means the stream ended without a
    // content_block_stop for it (abrupt cutoff) — treat as a parse failure.
    for (const tool of toolAccumulator.values()) {
        failedToolParses.push({ id: tool.id, name: tool.name, rawError: 'the stream ended before the tool call completed' });
    }
    toolAccumulator.clear();

    const wasMaxTokens = stopReason === 'max_tokens';
    for (const ft of failedToolParses) {
        yield {
            type: 'tool_error',
            id: ft.id,
            name: ft.name,
            error: truncatedToolInputError(ft.name, ft.rawError, wasMaxTokens),
        } satisfies ApiStreamChunk;
    }

    // Yield token usage at the end
    if (inputTokens > 0 || outputTokens > 0) {
        logCacheStat({
            provider: 'anthropic',
            model: opts.model,
            caching: opts.cachingEnabled ? 'on' : 'OFF',
            nonCachedInputTokens: inputTokens, // message_start.usage.input_tokens excludes cached
            cacheReadTokens,
            cacheCreationTokens,
            outputTokens,
        });
        yield {
            type: 'usage',
            inputTokens,
            outputTokens,
            cacheReadTokens: cacheReadTokens > 0 ? cacheReadTokens : undefined,
            cacheCreationTokens: cacheCreationTokens > 0 ? cacheCreationTokens : undefined,
        } satisfies ApiStreamChunk;
    }
}
/* eslint-enable -- end of file-level disable for boundary code (Anthropic SDK wire format) */
