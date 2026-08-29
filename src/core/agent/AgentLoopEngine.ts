/**
 * AgentLoopEngine (IMP-41-02-01b, ADR-145) — extraction stage 1.
 *
 * Owns the stream-consume phase of the agent loop: classifying provider
 * chunks into text, thinking segments, tool uses, tool errors and usage,
 * with the exact side-effect order the inline loop had. No Obsidian types;
 * UI feedback goes through the StreamPorts callbacks, durable state through
 * the serializable AgentLoopState.
 *
 * Extraction roadmap (ADR-145 "migration in steps, each step green"):
 *   stage 1: stream consume                                    (done)
 *   stage 2: iteration preamble with interceptor dispatch      (done)
 *   stage 3: tool batch execution + condense trigger           (done)
 * Each stage moves ownership without behaviour change; the full test suite
 * is the parity gate per stage.
 */

import type { ApiStreamChunk, ContentBlock, MessageParam, ToolResultContentBlock } from '../../api/types';
import type { AgentLoopState } from './LoopState';
import type { LoopInterceptor, LoopInterceptorContext } from './interceptors/types';
import { ThinkingSegmentCollector } from './thinkingSegments';
import { splitToolBatch } from './splitToolBatch';
import { applyAggregateBudget } from './toolResultBudget';

/** UI/host feedback ports for one streamed turn. */
export interface StreamPorts {
    onText(text: string): void;
    onThinking(text: string): void;
    onToolStart(name: string, input: Record<string, unknown>): void;
    /** Fired for tool_error chunks (isError=true), mirroring the legacy loop. */
    onToolResult(name: string, content: string, isError: boolean): void;
    /**
     * Raw usage numbers of this turn (state totals are updated by the engine).
     *
     * FIX-24-05-08: `modelId` is the serving model the chunk names, forwarded
     * verbatim. undefined means the producer did not stamp one and the host
     * falls back to its own current handler.
     */
    onUsage(
        inputTokens: number,
        outputTokens: number,
        cacheRead: number,
        cacheCreation: number,
        modelId?: string,
    ): void;
}

/** Classified result of one streamed assistant turn. */
export interface StreamTurnResult {
    textParts: string[];
    thinking: ThinkingSegmentCollector;
    toolUses: Array<Extract<ContentBlock, { type: 'tool_use' }>>;
    /** tool_use id -> actionable provider error (truncated JSON etc.). */
    toolErrors: Map<string, string>;
}

/** Host ports for the iteration preamble (stage 2). */
export interface PreamblePorts {
    isAborted(): boolean;
    maxIterations: number;
    /** ADR-114 steering hook: mid-run user messages for this iteration. */
    consumeSteeringMessages?: (iteration: number) => string[];
}

export type PreambleOutcome = 'proceed' | 'abort';

export type ToolUseBlock = Extract<ContentBlock, { type: 'tool_use' }>;

/** Result shape of one executed tool (the facade's runTool closure). */
export interface ToolExecResult {
    content: string | ToolResultContentBlock[];
    is_error?: boolean;
}

/** Host ports for the tool-batch phase (stage 3a). */
export interface ToolBatchPorts {
    isAborted(): boolean;
    /**
     * The facade's runTool closure: pipeline dispatch plus host guards
     * (repetition detector, deferred-tool gate, ledger recording).
     */
    executeTool(toolUse: ToolUseBlock): Promise<ToolExecResult>;
    /** UI callback per finished tool (FIFO order contract with the sidebar). */
    onToolResult(name: string, content: string, isError: boolean): void;
    /** TOOL_METADATA quality-gate lookup (host-side table). */
    qualityGateFor(toolName: string): string | undefined;
    consecutiveMistakeLimit: number;
    parallelSafe: ReadonlySet<string>;
    /**
     * Present only when an InflightStore is wired. The engine sets
     * state.phase = 'executing-tools' before calling it (IMP-41-03-01
     * quirk: the phase is only stamped when a store exists).
     */
    saveInflightSnapshot?: () => void;
    /**
     * FIX-24-03-05 / ADR-157 defence line 1: remaining char budget for
     * THIS turn's aggregated tool results (window minus estimated history
     * minus reserve, host-computed). When wired, the batch is shrunk to
     * fit before it enters history; within budget the exact same block
     * references pass through untouched.
     */
    getResultBudgetChars?: () => number;
}

/** Host ports for the condense triggers (stage 3b). */
export interface CondensePorts {
    condensingEnabled: boolean;
    /** condensingThreshold setting in percent of the context window. */
    thresholdPercent: number;
    estimateTokens(history: MessageParam[]): number;
    /** Live lookup -- the model (and its window) can switch mid-loop. */
    getContextWindow(): number;
    /** FEAT-24-02 skeleton prune; cheap, idempotent, no LLM call. */
    microcompact(history: MessageParam[]): void;
    /**
     * Pre-Compaction Memory Flush (Phase 5). Raw host callback; the engine
     * treats rejections as non-fatal.
     */
    preCompactionFlush?: (history: MessageParam[]) => Promise<void>;
    /**
     * Bound condenseHistory: the facade closes over systemPrompt and
     * abortSignal and MUST fetch the tool-call ledger lazily per call
     * (FIX-COMPACT-01 -- retries see the current ledger, never a stale copy).
     */
    condense(history: MessageParam[], maxTailTokens?: number): Promise<boolean>;
    /** FEAT-24-02 second stage: earlier, gentler rolling summary. */
    rollingSummary(
        history: MessageParam[],
        estimatedTokens: number,
        threshold: number,
        contextWindow: number,
    ): Promise<unknown>;
    /** FIX-PERF-20 feature flag (advancedApi.cacheAwareCondensing). */
    cacheAwareDeferEnabled(): boolean;
}

/** Extract display text from a tool result (string or multimodal array). */
function extractTextContent(content: string | ToolResultContentBlock[]): string {
    if (typeof content === 'string') return content;
    return content
        .filter((b): b is ToolResultContentBlock & { type: 'text' } => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
}

/** Append a quality-gate string to tool result content (LLM history only). */
function appendQualityGate(
    content: string | ToolResultContentBlock[],
    gate: string | undefined,
): string | ToolResultContentBlock[] {
    if (!gate) return content;
    if (typeof content === 'string') return content + '\n\n' + gate;
    // For multimodal content, append gate as an additional text block
    return [...content, { type: 'text' as const, text: '\n\n' + gate }];
}

export class AgentLoopEngine {
    /**
     * Stage 2: generic top-of-iteration work. Abort check first (nothing
     * fires on a stopped task), then interceptors in registration order,
     * then the soft-limit nudge (60 percent of max iterations) and the
     * ADR-114 steering drain. Mode-switch handling and rate-limiter
     * configuration stay in the facade — they are wired to host services,
     * not loop state.
     */
    runIterationPreamble(
        state: AgentLoopState,
        history: MessageParam[],
        activeMode: LoopInterceptorContext['activeMode'],
        ports: PreamblePorts,
        interceptors: LoopInterceptor[],
    ): PreambleOutcome {
        state.phase = 'preamble';
        if (ports.isAborted()) {
            console.debug('[AgentLoopEngine] Abort signal detected at iteration start');
            return 'abort';
        }
        state.telemetryIterations++;

        const ctx: LoopInterceptorContext = { state, history, activeMode };
        for (const interceptor of interceptors) {
            interceptor.onIterationStart?.(ctx);
        }

        // Soft limit: nudge the agent to wrap up at 60% of max iterations
        const softLimit = Math.floor(ports.maxIterations * 0.6);
        if (state.iteration === softLimit) {
            history.push({
                role: 'user',
                content: '[System] You have used ' + state.iteration + ' of ' + ports.maxIterations +
                    ' iterations. Wrap up now: deliver your final answer or call attempt_completion.',
            });
        }

        // FEAT-24-08 / ADR-114 Steering-Hook: drain any user-typed mid-run
        // messages and prepend them to the next assistant turn. Order is
        // preserved (one history entry per queued message). Cache is
        // invalidated because the volatile tail changed (stable prefix is
        // unaffected per ADR-62).
        const steering = ports.consumeSteeringMessages?.(state.iteration) ?? [];
        if (steering.length > 0) {
            for (const msg of steering) {
                history.push({ role: 'user', content: msg });
            }
            state.cacheInvalidated = true;
        }

        return 'proceed';
    }

    /**
     * Apply every interceptor's request-history transform in registration
     * order (recency anchors etc.). Inputs are never mutated.
     */
    transformRequestHistory(
        safeHistory: MessageParam[],
        ctx: LoopInterceptorContext,
        interceptors: LoopInterceptor[],
    ): MessageParam[] {
        let out = safeHistory;
        for (const interceptor of interceptors) {
            if (interceptor.transformRequestHistory) {
                out = interceptor.transformRequestHistory(out, ctx);
            }
        }
        return out;
    }

    /**
     * Consume one provider stream. Mutates `state` exactly like the inline
     * loop did: hasStreamedText on first text, mistake counters on
     * tool_error, usage totals on the usage chunk. Mid-stream throws
     * propagate to the caller (the loop-level error policy owns them).
     */
    async consumeStream(
        stream: AsyncIterable<ApiStreamChunk>,
        state: AgentLoopState,
        ports: StreamPorts,
    ): Promise<StreamTurnResult> {
        state.phase = 'streaming';
        const result: StreamTurnResult = {
            textParts: [],
            thinking: new ThinkingSegmentCollector(),
            toolUses: [],
            toolErrors: new Map(),
        };

        for await (const chunk of stream) {
            if (chunk.type === 'thinking') {
                ports.onThinking(chunk.text);
                if (chunk.requiresPassback) result.thinking.push(chunk.text);
            } else if (chunk.type === 'thinking_signature') {
                result.thinking.seal(chunk.signature);
            } else if (chunk.type === 'text') {
                state.hasStreamedText = true;
                state.streamedTextChars += chunk.text.length;
                result.textParts.push(chunk.text);
                ports.onText(chunk.text);
            } else if (chunk.type === 'tool_use') {
                result.toolUses.push({
                    type: 'tool_use',
                    id: chunk.id,
                    name: chunk.name,
                    input: chunk.input,
                });
                ports.onToolStart(chunk.name, chunk.input);
            } else if (chunk.type === 'tool_error') {
                // BUG-3 / BUG-032: unparseable or truncated tool JSON — record
                // in history, skip execution, and count it as a mistake so a
                // repeated broken write trips consecutiveMistakeLimit instead
                // of looping until the context overflows.
                result.toolErrors.set(chunk.id, chunk.error);
                result.toolUses.push({ type: 'tool_use', id: chunk.id, name: chunk.name, input: {} });
                ports.onToolStart(chunk.name, {});
                ports.onToolResult(chunk.name, chunk.error, true);
                state.consecutiveMistakes++;
                state.totalToolErrors++;
            } else if (chunk.type === 'usage') {
                state.totalInputTokens += chunk.inputTokens;
                state.totalOutputTokens += chunk.outputTokens;
                state.totalCacheReadTokens += chunk.cacheReadTokens ?? 0;
                state.totalCacheCreationTokens += chunk.cacheCreationTokens ?? 0;
                ports.onUsage(
                    chunk.inputTokens,
                    chunk.outputTokens,
                    chunk.cacheReadTokens ?? 0,
                    chunk.cacheCreationTokens ?? 0,
                    // FIX-24-05-08: attribution travels with the numbers.
                    chunk.modelId,
                );
            }
        }
        return result;
    }

    /**
     * Stage 3a: execute one turn's tool batch and push the combined
     * tool_result user message. Semantics are byte-identical to the inline
     * loop it replaces:
     *  - stream-side tool_error blocks first (provider message verbatim),
     *  - maximal parallel-safe prefix via Promise.all, results processed in
     *    MODEL order (FIFO contract with the sidebar UI queue),
     *  - sequential rest with an abort check between tools and a break
     *    after the tool that set completionResult,
     *  - per-tool mistake accounting with the >= 2 escalation trigger and
     *    the consecutiveMistakeLimit breaker (throws BEFORE the push),
     *  - malformed-tool-call breaker for error-only turns (throws AFTER
     *    the push -- the paired error results must reach the history),
     *  - optional inflight snapshot after the push (phase quirk, see port).
     */
    async executeToolBatch(
        validToolUses: ToolUseBlock[],
        toolErrors: Map<string, string>,
        state: AgentLoopState,
        history: MessageParam[],
        ports: ToolBatchPorts,
        interceptorDispatch?: {
            interceptors: LoopInterceptor[];
            activeMode: LoopInterceptorContext['activeMode'];
        },
    ): Promise<void> {
        const toolResultBlocks: ContentBlock[] = [];
        // Parallel to toolResultBlocks: the tool name per block, so the
        // aggregate budget can pick the right truncation strategy
        // (read tools get an offset hint into the original file).
        const resultToolNames: string[] = [];

        // BUG-3 / BUG-032: error results for tools with unparseable/truncated
        // JSON input — forward the provider's actionable message verbatim so
        // the model knows to split the write instead of retrying it.
        for (const [errId, errMsg] of toolErrors) {
            toolResultBlocks.push({
                type: 'tool_result',
                tool_use_id: errId,
                content: errMsg,
                is_error: true,
            });
            resultToolNames.push('');
        }

        // Shared per-result bookkeeping: UI callback, mistake counter,
        // router escalation, circuit breaker, quality-gate append.
        // Identical for parallel and sequential paths.
        const processToolResult = (toolUse: ToolUseBlock, result: ToolExecResult): void => {
            ports.onToolResult(toolUse.name, extractTextContent(result.content), result.is_error ?? false);

            if (result.is_error) { state.consecutiveMistakes++; state.totalToolErrors++; } else { state.consecutiveMistakes = 0; }
            // Contract v2: executed-tool hook fires after mistake accounting
            // and before the breaker check (RouterEscalation lives here).
            if (interceptorDispatch) {
                const ctx: LoopInterceptorContext = {
                    state, history, activeMode: interceptorDispatch.activeMode,
                };
                for (const interceptor of interceptorDispatch.interceptors) {
                    interceptor.onToolResult?.(
                        { toolName: toolUse.name, isError: result.is_error ?? false }, ctx,
                    );
                }
            }
            if (ports.consecutiveMistakeLimit > 0 && state.consecutiveMistakes >= ports.consecutiveMistakeLimit) {
                throw new Error(
                    `Agent stopped after ${state.consecutiveMistakes} consecutive errors. ` +
                    `Check the tool results above or raise the limit in Settings → Advanced.`,
                );
            }

            // Append quality gate checklist to LLM history (not UI)
            const gate = !result.is_error ? ports.qualityGateFor(toolUse.name) : undefined;
            toolResultBlocks.push({
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: appendQualityGate(result.content, gate),
                is_error: result.is_error,
            });
            resultToolNames.push(toolUse.name);
        };

        // IMP-41-02-02: maximal parallel-safe PREFIX runs concurrently,
        // the rest sequentially in model order (a read AFTER a write may
        // depend on that write — only the prefix is split).
        const { parallelPrefix, sequentialRest } = splitToolBatch(validToolUses, ports.parallelSafe);

        if (parallelPrefix.length > 0) {
            // Results are processed in original order after all finish so
            // the FIFO queue in AgentSidebarView assigns results to the
            // correct UI elements.
            const results = await Promise.all(parallelPrefix.map((t) => ports.executeTool(t)));
            for (let i = 0; i < parallelPrefix.length; i++) {
                processToolResult(parallelPrefix[i], results[i]);
            }
        }

        for (const toolUse of sequentialRest) {
            // Abort between sequential tools: a long write chain should
            // stop at the next boundary, not run to batch end.
            if (ports.isAborted()) break;
            const result = await ports.executeTool(toolUse);
            processToolResult(toolUse, result);
            if (state.completionResult !== null) break;
        }

        // FIX-24-03-05 / ADR-157 defence line 1: bound the SUM of this
        // turn's results before they enter history (two parallel large
        // reads used to produce ~808k chars in one message, issue #61).
        // Within budget: same references, byte-identical fast path.
        let finalResultBlocks = toolResultBlocks;
        if (ports.getResultBudgetChars) {
            const outcome = applyAggregateBudget(
                toolResultBlocks.map((block, i) => ({ block, toolName: resultToolNames[i] ?? '' })),
                ports.getResultBudgetChars(),
            );
            if (outcome.truncatedCount > 0) {
                console.debug(
                    `[AgentLoopEngine] aggregate result budget: shrank ${outcome.truncatedCount} `
                    + `result(s), ${outcome.totalCharsBefore} -> ${outcome.totalCharsAfter} chars`,
                );
            }
            finalResultBlocks = outcome.blocks;
        }

        // Add tool results as the next user message.
        // IMPORTANT: condensing runs AFTER this push so history is always consistent
        // (every assistant tool_call has a matching tool_result before condensing)
        history.push({ role: 'user', content: finalResultBlocks });
        // IMP-41-03-01: turn-boundary snapshot (debounced in the store).
        // Fire-and-forget on the host side -- persistence must never stall the loop.
        if (ports.saveInflightSnapshot) {
            state.phase = 'executing-tools';
            ports.saveInflightSnapshot();
        }

        // Circuit breaker for malformed/truncated tool calls. The result
        // loops above only check the limit for tools that actually ran; a
        // turn whose only output was a broken tool call (the classic
        // "write_file cut off mid-JSON" loop) never reaches that check, so
        // do it here. state.consecutiveMistakes was already bumped per
        // tool_error in the streaming loop; it is reset by the first
        // successful tool.
        if (toolErrors.size > 0 && ports.consecutiveMistakeLimit > 0
            && state.consecutiveMistakes >= ports.consecutiveMistakeLimit) {
            throw new Error(
                `Agent stopped after ${state.consecutiveMistakes} consecutive errors -- the last was a malformed or truncated tool call. `
                + `The model's tool call kept getting cut off before it finished. `
                + `Fix: have the model split a large write into write_file (header + first section) then append_to_file for the rest, `
                + `reduce the attached input, or raise Max output tokens in Settings -> Models.`,
            );
        }
    }

    /**
     * Stage 3b, text-final trigger: microcompact always (the persisted
     * conversation must not carry verbatim bulk), then -- behind the
     * iteration>0 + condensingEnabled gate -- either the FIX-PERF-20
     * cache-aware defer (condensing now would invalidate a prefix that
     * mostly served from cache, for marginal gain) or the full condense
     * pass with retries. Both callers break the loop afterwards; the
     * method itself has no exit semantics.
     */
    async maybeCondenseAtTextFinal(
        state: AgentLoopState,
        history: MessageParam[],
        ports: CondensePorts,
    ): Promise<void> {
        // FEAT-24-02: prune old tool_result contents before the task ends
        // so the persisted conversation does not carry verbatim bulk.
        ports.microcompact(history);
        if (state.iteration > 0 && ports.condensingEnabled) {
            const estimatedTokens = ports.estimateTokens(history);
            const contextWindow = ports.getContextWindow();
            const threshold = Math.floor(contextWindow * (ports.thresholdPercent / 100));
            // FIX-PERF-20: cache-aware defer. When the previous turn served
            // mostly from prefix cache (read > create), condensing now would
            // invalidate the expensive prefix for marginal gain. Defer once,
            // re-evaluate next turn. Feature-flag default off in 3.x.
            const cacheAware = ports.cacheAwareDeferEnabled();
            const cacheBeatsThisTurn = state.totalCacheReadTokens > state.totalCacheCreationTokens
                && state.totalCacheReadTokens > 0;
            if (cacheAware && cacheBeatsThisTurn && estimatedTokens < threshold * 1.05) {
                console.debug(
                    `[AgentLoopEngine] Cache-aware condense defer at ~${estimatedTokens}t `
                    + `(threshold ${threshold}t, cacheRead ${state.totalCacheReadTokens}t > `
                    + `cacheCreate ${state.totalCacheCreationTokens}t)`,
                );
            } else if (estimatedTokens > threshold) {
                await this.flushNonFatal(ports, history);
                await this.condenseWithRetries(history, threshold, ports);
            }
        }
    }

    /**
     * Stage 3b, post-tool-batch trigger: runs only on a fully consistent
     * history (assistant tool_calls + tool_results both pushed). Over the
     * threshold it condenses with retries; under it, the gentler rolling
     * summary gets its chance. No cache-aware defer on this path.
     */
    async maybeCondenseAfterToolBatch(
        state: AgentLoopState,
        history: MessageParam[],
        ports: CondensePorts,
    ): Promise<void> {
        // FEAT-24-02 (ADR-12 amendment): prune old tool_result contents to
        // skeletons now that the turn is closed and the history is
        // consistent -- the condensing checks then see the pruned estimate.
        ports.microcompact(history);
        if (state.iteration > 0 && ports.condensingEnabled && state.completionResult === null) {
            const estimatedTokens = ports.estimateTokens(history);
            const contextWindow = ports.getContextWindow();
            const threshold = Math.floor(contextWindow * (ports.thresholdPercent / 100));
            if (estimatedTokens > threshold) {
                await this.flushNonFatal(ports, history);
                await this.condenseWithRetries(history, threshold, ports);
            } else {
                await ports.rollingSummary(history, estimatedTokens, threshold, contextWindow);
            }
        }
    }

    /** Pre-Compaction Memory Flush -- rejections are non-fatal by contract. */
    private async flushNonFatal(ports: CondensePorts, history: MessageParam[]): Promise<void> {
        await ports.preCompactionFlush?.(history).catch((e) =>
            console.warn('[AgentLoopEngine] Pre-compaction flush failed (non-fatal):', e),
        );
    }

    /**
     * Shared condense pass (deduplicates the verbatim-doubled inline block):
     * one full pass, then -- only if it succeeded (FIX-COMPACT-02, a failed
     * pass already fired the failure callback) -- up to two retries with a
     * halved tail per FIX-COMPACT-06 (10k -> 5k -> 2.5k, floor 1k) while the
     * estimate stays over the threshold.
     */
    private async condenseWithRetries(
        history: MessageParam[],
        threshold: number,
        ports: CondensePorts,
    ): Promise<void> {
        const firstOk = await ports.condense(history);
        if (!firstOk) return;

        let condensingRetries = 0;
        const MAX_CONDENSING_RETRIES = 2;
        let nextTail = 10_000;

        while (condensingRetries < MAX_CONDENSING_RETRIES) {
            const postTokens = ports.estimateTokens(history);
            if (postTokens <= threshold) break;

            nextTail = Math.max(1_000, Math.floor(nextTail / 2));
            console.warn(
                `[AgentLoopEngine] Still over threshold after condensing (${postTokens} > ${threshold}). ` +
                `Retry ${condensingRetries + 1}/${MAX_CONDENSING_RETRIES} with tail=${nextTail} tokens`
            );

            const retryOk = await ports.condense(history, nextTail);
            if (!retryOk) break;
            condensingRetries++;
        }

        if (condensingRetries > 0) {
            console.debug(`[AgentLoopEngine] Required ${condensingRetries + 1} condensing passes to stay under threshold`);
        }
    }
}
