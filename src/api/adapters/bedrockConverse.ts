/**
 * Bedrock-Converse wire adapter (IMP-41-03-03, ADR-150).
 *
 * Owns the complete Converse-API wire format: message/block conversion,
 * the no-tools sanitization (FIX-04-03-06), cachePoint placement
 * (IMP-18-01-02 / ADR-111), inference config with the temperature/thinking
 * quirks, the additionalModelRequestFields reasoning passthrough, and the
 * Converse stream-event parser. The provider class keeps only auth, region
 * resolution, the lazy SDK/client (FIX-PERF-13) and dispatch.
 *
 * Type-only SDK imports — the ~120 KB @aws-sdk bundle still loads lazily
 * in the provider (FIX-PERF-13 stays intact).
 */

import type {
    ContentBlock as BedrockContentBlock,
    Message as BedrockMessage,
    SystemContentBlock,
    Tool as BedrockTool,
    ToolResultContentBlock,
    ConverseStreamCommandInput,
    ConverseStreamOutput,
} from '@aws-sdk/client-bedrock-runtime';
import type { DocumentType } from '@smithy/types';
import type { LLMProvider } from '../../types/settings';
import type { ApiStream, ApiStreamChunk, ContentBlock, MessageParam } from '../types';
import { truncatedToolInputError } from '../types';
import type { ToolDefinition } from '../../core/tools/types';
import { resolveOutputBudget, estimatePromptTokens, modelSupportsTemperature, getModelEffortSupport, modelUsesBudgetTokensThinking } from '../../types/model-registry';
import { getCacheCapability } from '../capabilities';
import { splitSystemPromptAtCacheBreakpoint, stripCacheBreakpointMarker } from '../../core/systemPrompt';
import { logCacheStat } from '../logCacheStat';
import { stripThinkingBlocks, repairEmptyWireMessages } from '../../core/utils/stripThinkingBlocks';

/**
 * FIX-04-03-06: AWS Bedrock Converse rejects calls where the history
 * contains `toolUse`/`toolResult` blocks but the call passes no
 * `toolConfig`. The hard-limit-recovery path in AgentTask intentionally
 * sends `tools=[]` to disable further tool calls, which then trips the
 * mismatch. This helper replaces tool-blocks in a defensive copy with
 * compact text markers so the API call shape is consistent.
 *
 * Pure function; does not mutate the input.
 */
export function messagesHaveToolBlocks(messages: MessageParam[]): boolean {
    for (const msg of messages) {
        if (typeof msg.content === 'string') continue;
        for (const block of msg.content) {
            if (block.type === 'tool_use' || block.type === 'tool_result') return true;
        }
    }
    return false;
}

export function stripToolBlocksForNoToolsCall(messages: MessageParam[]): MessageParam[] {
    return messages.map((msg) => {
        if (typeof msg.content === 'string') return msg;
        const newContent: ContentBlock[] = msg.content.map((block) => {
            if (block.type === 'tool_use') {
                return {
                    type: 'text',
                    text: `[prior tool call: ${block.name}]`,
                };
            }
            if (block.type === 'tool_result') {
                // Compact representation: collapse any structured tool-result
                // payload into a single text marker. The conversation history
                // stays meaningful, but no tool-block references remain.
                const summary = typeof block.content === 'string'
                    ? block.content.slice(0, 200)
                    : '[tool result content]';
                return {
                    type: 'text',
                    text: `[prior tool result] ${summary}`,
                };
            }
            return block;
        });
        return { role: msg.role, content: newContent };
    });
}

/**
 * Convert internal MessageParam[] to Bedrock Converse Message[].
 * Handles text, image (base64), tool_use and tool_result content blocks.
 */
export function convertToBedrockMessages(messages: MessageParam[]): BedrockMessage[] {
    return messages.map((msg) => {
        if (typeof msg.content === 'string') {
            return {
                role: msg.role,
                content: [{ text: msg.content }] as BedrockContentBlock[],
            };
        }

        const content: BedrockContentBlock[] = msg.content.map((block) => convertBedrockBlock(block));
        return { role: msg.role, content };
    });
}

function convertBedrockBlock(block: ContentBlock): BedrockContentBlock {
    if (block.type === 'text') {
        return { text: block.text };
    }

    if (block.type === 'tool_use') {
        return {
            toolUse: {
                toolUseId: block.id,
                name: block.name,
                input: block.input as unknown as DocumentType,
            },
        };
    }

    if (block.type === 'image') {
        const format = mediaTypeToBedrockFormat(block.source.media_type);
        return {
            image: {
                format,
                source: { bytes: base64ToUint8Array(block.source.data) },
            },
        };
    }

    if (block.type === 'tool_result') {
        const resultContent: ToolResultContentBlock[] = [];
        if (typeof block.content === 'string') {
            resultContent.push({ text: block.content });
        } else {
            for (const c of block.content) {
                if (c.type === 'text') {
                    resultContent.push({ text: c.text });
                } else if (c.type === 'image') {
                    resultContent.push({
                        image: {
                            format: mediaTypeToBedrockFormat(c.source.media_type),
                            source: { bytes: base64ToUint8Array(c.source.data) },
                        },
                    });
                }
            }
        }
        return {
            toolResult: {
                toolUseId: block.tool_use_id,
                content: resultContent,
                status: block.is_error ? 'error' : 'success',
            },
        };
    }

    if (block.type === 'thinking' || block.type === 'redacted_thinking') {
        // FIX-04-03-07 / IMP-41-01-05: should never reach here --
        // stripThinkingBlocks runs in prepareBedrockConverseInput and drops
        // both variants. Fail loud if someone bypasses it. Converse-API
        // signature passback stays unsupported by design (see spec).
        throw new Error('[Bedrock] thinking blocks must be stripped before convertBlock');
    }

    // Exhaustiveness check -- unreachable
    const _exhaustive: never = block;
    throw new Error(`[Bedrock] Unknown content block: ${String(_exhaustive)}`);
}

/**
 * Build the COMPLETE ConverseStream input for one turn. Byte-identical to
 * the legacy inline construction (golden-pinned): thinking strip, no-tools
 * sanitization, cachePoint layout, inference config, reasoning passthrough.
 */
export function prepareBedrockConverseInput(
    config: LLMProvider,
    systemPrompt: string,
    messages: MessageParam[],
    tools: ToolDefinition[],
): ConverseStreamCommandInput {
    // FIX-04-03-07: defensive drop of thinking blocks before the strict
    // exhaustive switch in convertMessages — same reasoning as Anthropic.
    // Loop-economy FIX C3: repair messages the strip left empty (assistant
    // turns that carried only reasoning) — Bedrock 400s on empty content.
    const thinkingFreeMessages = repairEmptyWireMessages(stripThinkingBlocks(messages));
    // FIX-04-03-06: when the caller passes no tools but the history
    // still contains tool_use/tool_result blocks (typical for the
    // hard-limit-recovery path in AgentTask), strip those blocks
    // to text markers. Otherwise AWS Converse returns 400
    // "toolConfig must be defined when using toolUse and toolResult
    // content blocks".
    const messagesForApi = tools.length === 0 && messagesHaveToolBlocks(thinkingFreeMessages)
        ? stripToolBlocksForNoToolsCall(thinkingFreeMessages)
        : thinkingFreeMessages;
    const bedrockMessages = convertToBedrockMessages(messagesForApi);

    // IMP-18-01-02 / ADR-111: Bedrock caches nothing without explicit cachePoint
    // markers. When the model supports it (Anthropic Claude on Bedrock) and the
    // toggle is on, split the system prompt at the cache breakpoint and place a
    // cachePoint after the stable prefix, after the tool list, and after the last
    // user message — the same shape as the Anthropic-direct provider.
    const cacheStyle = getCacheCapability(config.type, config.model).cacheStyle;
    const useCachePoint = (config.promptCachingEnabled ?? false) && cacheStyle === 'bedrock-cachepoint';

    let system: SystemContentBlock[];
    if (useCachePoint) {
        const { stable, volatile } = splitSystemPromptAtCacheBreakpoint(systemPrompt);
        system = volatile.trim().length > 0
            ? [{ text: stable }, { cachePoint: { type: 'default' } }, { text: volatile }]
            : [{ text: stable }, { cachePoint: { type: 'default' } }];
    } else {
        // D1: with cachePoint off nothing splits the prompt, so the sentinel has
        // to be removed here or it reaches the model.
        system = [{ text: stripCacheBreakpointMarker(systemPrompt) }];
    }

    if (useCachePoint) {
        // IMP-01-04-03 (Lever B): a rolling cachePoint on the last user message
        // (advances each turn) PLUS a stable one ~6 user-messages back, so the
        // history bulk stays a cache READ across turns instead of a full
        // cacheCreate every turn. Mirrors anthropicBlocks.markRollingHistory-
        // Breakpoints. Total cachePoints stay within Bedrock's limit of 4
        // (system + tools + these two).
        const STABLE_BACKOFF = 6;
        const pushCachePoint = (m: (typeof bedrockMessages)[number] | undefined): boolean => {
            if (m && m.role === 'user' && Array.isArray(m.content)) {
                m.content.push({ cachePoint: { type: 'default' } });
                return true;
            }
            return false;
        };
        let lastUser = -1;
        for (let i = bedrockMessages.length - 1; i >= 0; i--) {
            if (pushCachePoint(bedrockMessages[i])) { lastUser = i; break; }
        }
        if (lastUser >= 0) {
            for (let i = lastUser - STABLE_BACKOFF; i >= 0; i--) {
                if (pushCachePoint(bedrockMessages[i])) break;
            }
        }
    }

    const toolSpecs = tools.map<BedrockTool>((t) => ({
        toolSpec: {
            name: t.name,
            description: t.description,
            // AWS DocumentType is a JSON-compatible recursive union; JSON Schema
            // objects are valid DocumentType at runtime, but TS can't prove it.
            inputSchema: { json: t.input_schema as unknown as DocumentType },
        },
    }));

    // AP3b: pin the tools cachePoint on attempt_completion instead of appending
    // it after the whole list, the same way anthropicBlocks.ts does (FIX-PERF-21).
    //
    // Appending it last meant every tool added mid-run changed the content the
    // checkpoint covers. Measured in requests.jsonl 2026-08-22..28: three tasks
    // where the tool list grew (57 -> 58/59/60) lost the whole prefix on exactly
    // that turn -- 97,494 / 64,996 / 217,591 cacheWrite tokens with cacheRead 0,
    // about 0.95 USD in a week, 0.54 USD for the largest single turn.
    //
    // AWS states the mechanism (prompt-caching guide, checked 2026-08-28):
    // checkpoints are chained `tools` -> `system` -> `messages`, and "changing
    // content in an earlier section invalidates the cache for later sections".
    // attempt_completion holds its position across mode switches and find_tool
    // activations, so tools appended after the pin fall outside the cached
    // prefix and no longer move the boundary.
    //
    // Scope, stated honestly: this saves the TOOLS checkpoint (~30k tokens). The
    // system checkpoint still misses after a tool is added, because by the same
    // chaining rule the system prefix contains the full tool list. A mid-run
    // tool change gets cheaper, not free.
    let wireTools = toolSpecs;
    if (useCachePoint && toolSpecs.length > 0) {
        const attemptIdx = tools.findIndex((t) => t.name === 'attempt_completion');
        const pinAfter = attemptIdx !== -1 ? attemptIdx + 1 : toolSpecs.length;
        wireTools = [
            ...toolSpecs.slice(0, pinAfter),
            { cachePoint: { type: 'default' } },
            ...toolSpecs.slice(pinAfter),
        ];
    }

    const toolConfig: ConverseStreamCommandInput['toolConfig'] = tools.length > 0
        ? { tools: wireTools, toolChoice: { auto: {} } }
        : undefined;

    // Extended thinking on Bedrock for budget-tokens Claude (Sonnet 4.6,
    // Opus 4.6 and older): the thinking toggle sets thinkingEnabled and
    // Bedrock Converse takes the legacy reasoning_config budget_tokens shape.
    // Effort-capable Claude (Opus 4.7/4.8, Fable, Mythos) goes through the
    // effort branch below instead; non-Claude (Nova) never gets a thinking
    // field.
    const thinkingEnabled = config.thinkingEnabled ?? false;
    const sendBudgetThinking =
        thinkingEnabled
        && /claude/i.test(config.model)
        && modelUsesBudgetTokensThinking(config.model);
    // Auto by default: undefined -> model-scaled budget; clamped to the
    // model's output ceiling and to the room left in the context window.
    // Pass the thinking flag so resolveOutputBudget reserves the thinking
    // budget on top of the visible-output budget.
    const { maxTokens, thinkingBudgetTokens } = resolveOutputBudget(
        config.model,
        config.maxTokens,
        {
            enabled: thinkingEnabled,
            budgetTokens: config.thinkingBudgetTokens,
            estimatedInputTokens: estimatePromptTokens(systemPrompt, messages, tools),
        },
    );
    // FIX-04-03-02: omit temperature for default-only models (Opus 4.7+,
    // GPT-5.x on Bedrock if it ever ships there); Bedrock surfaces the same
    // provider 400 as direct calls when temperature is rejected. Extended
    // thinking additionally requires temperature == 1, mirroring the direct
    // Anthropic provider.
    const supportsTemperature = modelSupportsTemperature(config.model);
    const temperature = !supportsTemperature
        ? undefined
        : sendBudgetThinking
            ? 1
            : (config.temperature ?? 0.2);

    // Reasoning passthrough for Claude on Bedrock. Bedrock Converse exposes
    // Anthropic extended thinking via `additionalModelRequestFields` -- a
    // loose DocumentType the SDK does not type-check. Two mutually exclusive
    // Claude shapes:
    //   - effort-capable adaptive lineup (Opus 4.7/4.8, Fable/Mythos):
    //     mirror the direct Anthropic API surface --
    //       { thinking: { type: 'adaptive' },
    //         output_config: { effort: <level> } }
    //     The earlier `reasoning_config: { type: 'enabled', effort }` shape
    //     400s with `thinking.enabled.budget_tokens: Field required` because
    //     Bedrock partially translates `type: enabled` into the legacy
    //     thinking shape, then notices the missing budget_tokens (adaptive
    //     models do not accept budget_tokens at all). Sending the
    //     Anthropic-native pair via the passthrough sidesteps that
    //     translation entirely.
    //   - budget-tokens lineup (Sonnet 4.6, Opus 4.6 and older): a token
    //     budget driven by the thinking toggle. The Bedrock translation
    //     layer
    //       { reasoning_config: { type: 'enabled', budget_tokens: N } }
    //     is preserved verbatim here (live-verified on Sonnet
    //     4.6, see commit be611b4a).
    // Fail-safe: with no effort and thinking off the field is omitted
    // entirely (byte-identical to today), and if building it ever throws we
    // proceed WITHOUT the field rather than break the request.
    let additionalModelRequestFields: DocumentType | undefined;
    try {
        if (config.reasoningEffort && getModelEffortSupport(config.model, config.type)) {
            additionalModelRequestFields = {
                thinking: { type: 'adaptive' },
                output_config: { effort: config.reasoningEffort },
            };
        } else if (sendBudgetThinking && typeof thinkingBudgetTokens === 'number' && thinkingBudgetTokens > 0) {
            additionalModelRequestFields = {
                reasoning_config: {
                    type: 'enabled',
                    budget_tokens: thinkingBudgetTokens,
                },
            };
        }
    } catch (e) {
        // AUDIT-037 M-5: only swallow construction errors that are
        // structurally plausible for an object-literal builder
        // (TypeError if a registry helper returns the wrong shape,
        // RangeError if a numeric coercion overflows). Other thrown
        // values bubble up so a real bug stays visible instead of
        // silently degrading every Bedrock turn to no-thinking mode.
        if (!(e instanceof TypeError) && !(e instanceof RangeError)) {
            throw e;
        }
        console.warn('[Bedrock] additionalModelRequestFields construction failed, omitting field', {
            modelId: config.model,
            reasoningEffort: config.reasoningEffort,
            error: e instanceof Error ? e.message : String(e),
        });
        additionalModelRequestFields = undefined;
    }

    return {
        modelId: config.model,
        messages: bedrockMessages,
        system,
        inferenceConfig: {
            maxTokens,
            ...(temperature !== undefined ? { temperature } : {}),
        },
        toolConfig,
        ...(additionalModelRequestFields !== undefined ? { additionalModelRequestFields } : {}),
    };
}

/**
 * Parse Converse stream events into ApiStreamChunks. Bedrock streams toolUse
 * input as JSON deltas, same as Anthropic: accumulate and yield a single
 * complete tool_use chunk; hold parse failures until stopReason arrives
 * (truncation-aware recovery); emit usage + cache diagnostics at the end.
 */
export async function* parseBedrockConverseStream(
    stream: AsyncIterable<ConverseStreamOutput>,
    opts: { model: string; cachingEnabled: boolean },
): ApiStream {
    const toolAccumulator = new Map<number, { id: string; name: string; inputJson: string }>();
    let currentBlockIndex: number | undefined;

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;
    // stopReason arrives in messageStop, after the content blocks — hold parse
    // failures until then so the model gets a truncation-aware error.
    let stopReason: string | undefined;
    const failedToolParses: Array<{ id: string; name: string; rawError: string }> = [];

    for await (const event of stream) {
        if (event.messageStop?.stopReason) {
            stopReason = event.messageStop.stopReason;
            continue;
        }
        if (event.contentBlockStart) {
            const idx = event.contentBlockStart.contentBlockIndex ?? 0;
            currentBlockIndex = idx;
            const start = event.contentBlockStart.start;
            if (start?.toolUse) {
                toolAccumulator.set(idx, {
                    id: start.toolUse.toolUseId ?? '',
                    name: start.toolUse.name ?? '',
                    inputJson: '',
                });
            }
            continue;
        }

        if (event.contentBlockDelta) {
            const idx = event.contentBlockDelta.contentBlockIndex ?? currentBlockIndex ?? 0;
            const delta = event.contentBlockDelta.delta;
            if (delta?.text !== undefined) {
                yield { type: 'text', text: delta.text } satisfies ApiStreamChunk;
                continue;
            }
            if (delta?.toolUse?.input !== undefined) {
                const entry = toolAccumulator.get(idx);
                if (entry) entry.inputJson += delta.toolUse.input;
                continue;
            }
            if (delta?.reasoningContent?.text !== undefined) {
                yield { type: 'thinking', text: delta.reasoningContent.text } satisfies ApiStreamChunk;
                continue;
            }
            continue;
        }

        if (event.contentBlockStop) {
            const idx = event.contentBlockStop.contentBlockIndex ?? currentBlockIndex ?? 0;
            const tool = toolAccumulator.get(idx);
            if (tool) {
                let parsedInput: Record<string, unknown> | undefined;
                try {
                    parsedInput = tool.inputJson ? JSON.parse(tool.inputJson) as Record<string, unknown> : {};
                } catch (e) {
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
                toolAccumulator.delete(idx);
            }
            continue;
        }

        if (event.metadata?.usage) {
            const usage = event.metadata.usage;
            inputTokens = usage.inputTokens ?? 0;
            outputTokens = usage.outputTokens ?? 0;
            cacheReadTokens = usage.cacheReadInputTokens ?? 0;
            cacheCreationTokens = usage.cacheWriteInputTokens ?? 0;
        }
    }

    // Tools still accumulating means the stream ended mid-tool-call.
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

    if (inputTokens > 0 || outputTokens > 0) {
        logCacheStat({
            provider: 'bedrock',
            model: opts.model,
            caching: opts.cachingEnabled ? 'on' : 'OFF',
            nonCachedInputTokens: inputTokens,
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

function mediaTypeToBedrockFormat(mt: string): 'png' | 'jpeg' | 'gif' | 'webp' {
    switch (mt) {
        case 'image/png': return 'png';
        case 'image/jpeg': return 'jpeg';
        case 'image/gif': return 'gif';
        case 'image/webp': return 'webp';
        default: return 'png';
    }
}

function base64ToUint8Array(b64: string): Uint8Array {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}
