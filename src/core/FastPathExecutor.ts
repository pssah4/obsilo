/**
 * FastPathExecutor — ADR-061: Two-Stage Recipe-based Batch Execution
 *
 * When a learned recipe matches the user's intent, executes the tool
 * steps as a two-stage batch instead of iterating through the ReAct loop.
 *
 * Two-Stage Flow:
 *   Stage 1 (Search): Planner parametrizes search tools → parallel batch execution
 *   Stage 2 (Read):   Planner sees search results → parametrizes read tools → parallel batch
 *   Stage 3 (Loop):   Normal loop for write/present (1-2 iterations)
 *
 * This solves the single-planner problem: a one-shot planner cannot predict
 * file paths for read_file because it hasn't seen search results yet.
 *
 * Design principles (Manus Context Engineering):
 * - Tool list NEVER changes (no filtering, no tool_choice)
 * - History is append-only (batch results are appended)
 * - Externalization disabled during batch (Presenter needs full content)
 * - Fallback to normal loop on any error
 */

import type { ApiHandler, MessageParam } from '../api/types';
import type { ToolExecutionPipeline, ContextExtensions } from './tool-execution/ToolExecutionPipeline';
import type { ProceduralRecipe } from './mastery/types';
import type { ToolCallbacks, ToolName, ToolDefinition } from './tools/types';
import { getHelperApi } from './helper-api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PlannedToolCall {
    tool: string;
    input: Record<string, unknown>;
}

/** Tools allowed in Stage 1 (search/discovery). Hard allowlist — planner output is filtered. */
const STAGE1_ALLOWED = new Set([
    'semantic_search', 'search_files', 'search_by_tag', 'list_files',
    'get_vault_stats', 'web_search',
    // FEATURE-0320: cross-source recall. Broad "what do I have about X"
    // questions should fan out across vault notes AND past conversations.
    'search_history', 'recall_memory',
]);

/** Tools allowed in Stage 2 (read). Hard allowlist. */
const STAGE2_ALLOWED = new Set([
    'read_file', 'read_document', 'get_frontmatter', 'get_linked_notes',
]);

/** Tools safe for parallel execution (no side effects). */
const READ_SAFE = new Set([
    'read_file', 'read_document', 'list_files', 'search_files',
    'get_frontmatter', 'get_linked_notes', 'search_by_tag',
    'get_vault_stats', 'semantic_search', 'query_base',
    'web_search', 'web_fetch',
]);

export interface FastPathResult {
    success: boolean;
    historyEntries: MessageParam[];
    toolCallsExecuted: number;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const SEARCH_PLANNER = `You have a proven recipe for this task. Stage 1: parametrize the SEARCH steps only.

RECIPE STEPS:
{STEPS}

USER REQUEST:
{USER_MESSAGE}

Output ONLY search/discovery tool calls as a JSON array. No markdown.
Include ONLY: semantic_search, search_files, search_by_tag, list_files, web_search, search_history, recall_memory.
Do NOT include read_file, write_file, or other tools — those come in stage 2.

CROSS-SOURCE RECALL: For broad "what do I have / know about X" questions, run search_history in PARALLEL to the vault searches so past conversation context surfaces alongside notes. Vault and chats are equally valid sources.

{TOOL_SCHEMAS}

Example: [
  {"tool": "semantic_search", "input": {"query": "Kant ethics philosophy"}},
  {"tool": "search_history", "input": {"query": "Kant", "top_k": 10}}
]`;

const READ_PLANNER = `Stage 2: Based on the search results below, parametrize the READ steps.

SEARCH RESULTS:
{SEARCH_RESULTS}

USER REQUEST:
{USER_MESSAGE}

Output ONLY read tool calls as a JSON array. No markdown.
Include ONLY: read_file, read_document.
Pick the most relevant files from the search results (max 5).
Do NOT include write_file or search tools — the loop handles writing.

{TOOL_SCHEMAS}

Example: [{"tool": "read_file", "input": {"path": "Notes/Kant Summary.md"}}]`;

// ---------------------------------------------------------------------------
// FastPathExecutor
// ---------------------------------------------------------------------------

export class FastPathExecutor {
    /**
     * IMP-41-02-05: trust level of the recipe currently executing, derived
     * from recipe.source at the top of execute(). Threaded into every
     * pipeline dispatch of this batch.
     */
    private currentTrust: 'user' | 'learned' = 'user';

    constructor(
        private api: ApiHandler,
        private pipeline: ToolExecutionPipeline,
        /**
         * FIX-24-05-04: reports planner-call token usage to the owning task
         * so those tokens land in the task totals (footer + telemetry).
         */
        private onUsage?: (
            inputTokens: number,
            outputTokens: number,
            cacheReadTokens?: number,
            cacheCreationTokens?: number,
            /** FIX-24-05-05: model that served the planner call (helper or main). */
            modelId?: string,
        ) => void,
    ) {}

    /** FIX-44-33: approval + checkpoint callbacks for the current run (set in execute()). */
    private gate?: Pick<ContextExtensions, 'onApprovalRequired' | 'onCheckpoint' | 'onUnreviewedWrite'>;

    /** FEAT-55-02 (ADR-170): run-scoped attachments for the current execute() run. */
    private runAttachmentTexts?: string[];

    /** Build the extensions object for a pipeline dispatch, merging readFiles + the gate. */
    private buildExtensions(readFiles?: Set<string>): ContextExtensions | undefined {
        const ext: ContextExtensions = {};
        if (readFiles) ext.readFiles = readFiles;
        // FEAT-55-02 (ADR-170): forward the run's attachments so a recipe step
        // calling read_document/ingest_document sees this run's own attachments.
        if (this.runAttachmentTexts && this.runAttachmentTexts.length > 0) {
            ext.attachmentTexts = this.runAttachmentTexts;
        }
        if (this.gate?.onApprovalRequired) ext.onApprovalRequired = this.gate.onApprovalRequired;
        if (this.gate?.onCheckpoint) ext.onCheckpoint = this.gate.onCheckpoint;
        // FIX-44-44: recipe writes that were not individually diff-approved
        // count toward the post-task review, same as model dispatches.
        if (this.gate?.onUnreviewedWrite) ext.onUnreviewedWrite = this.gate.onUnreviewedWrite;
        // FIX-24-05-09 (D10): a recipe step can dispatch a tool that makes its
        // own LLM call. Route it into the same report the planner call uses, so
        // the FastPath route is not the one that stays free.
        if (this.onUsage) {
            ext.reportAuxUsage = (u) => this.onUsage?.(
                u.inputTokens, u.outputTokens, u.cacheReadTokens, u.cacheCreationTokens, u.modelId,
            );
        }
        return Object.keys(ext).length > 0 ? ext : undefined;
    }

    /**
     * FEAT-24-07 / ADR-115: resolve the helper handler for internal
     * planner/presenter calls. Uses the parent plugin reachable through
     * the pipeline's tool registry. Falls back to `this.api` if no
     * helper model is configured or the build fails.
     */
    private getInternalApi(): ApiHandler {
        const plugin = this.pipeline.getPlugin();
        return getHelperApi(plugin, this.api);
    }

    async execute(
        recipe: ProceduralRecipe,
        userMessage: string,
        systemPrompt: string,
        callbacks: ToolCallbacks,
        abortSignal?: AbortSignal,
        tools?: ToolDefinition[],
        // FIX-H (ADR-090 follow-up): forward the parent task's readFiles set so
        // FastPath stage-2 reads contribute to todo-verification.
        readFiles?: Set<string>,
        // FEAT-32-02 PR 2.2 / ADR-133: optional callback invoked for every
        // successful FastPath tool dispatch so AgentTask can record the call
        // into the episodic ToolRepetitionDetector (`recordForEpisodeOnly`),
        // independent of the Pipeline-driven repetition window.
        onToolRecorded?: (
            tool: string,
            input: Record<string, unknown>,
            summary: string,
            source: 'fastpath',
        ) => void,
        // FIX-44-33: the approval + checkpoint callbacks from the owning task.
        // Without them a recipe step whose effect is not auto-approved was denied
        // fail-closed with only a console.warn, instead of asking the user.
        gate?: Pick<ContextExtensions, 'onApprovalRequired' | 'onCheckpoint' | 'onUnreviewedWrite'>,
        // FEAT-55-02 (ADR-170): run-scoped attachments forwarded to recipe
        // steps that call read_document / ingest_document.
        attachmentTexts?: string[],
    ): Promise<FastPathResult> {
        this.gate = gate;
        this.runAttachmentTexts = attachmentTexts;
        const failed: FastPathResult = { success: false, historyEntries: [], toolCallsExecuted: 0 };

        // IMP-41-02-05 / ADR-151: machine-promoted recipes run the full
        // pipeline gates; only genuinely user-authored ones keep the bypass.
        this.currentTrust = recipe.source === 'learned' ? 'learned' : 'user';

        try {
            console.debug(`[FastPath] Starting two-stage for recipe: ${recipe.name} (${recipe.steps.length} steps, trust=${this.currentTrust})`);

            const externalizer = this.pipeline.getExternalizer();
            const allResults: Array<{ tool: string; input: Record<string, unknown>; content: string; isError: boolean }> = [];
            let toolCallsExecuted = 0;

            // ── Stage 1: Search (externalization ENABLED — search results are large
            //    and the Presenter doesn't need them, only the Read-Planner does) ────
            const searchCalls = await this.plannerCall(
                SEARCH_PLANNER, recipe, userMessage, systemPrompt, abortSignal, tools,
            );

            // Capture full search content for the Read-Planner BEFORE externalization
            // (the planner needs full results to pick the right files)
            let searchContentForPlanner = '';

            if (searchCalls && searchCalls.length > 0) {
                // S-2: Hard allowlist — reject any tools the planner shouldn't have generated
                const filteredSearch = searchCalls.filter((c) => STAGE1_ALLOWED.has(c.tool));
                if (filteredSearch.length !== searchCalls.length) {
                    console.warn(`[FastPath] Stage 1: filtered ${searchCalls.length - filteredSearch.length} disallowed tool(s)`);
                }
                console.debug(`[FastPath] Stage 1: ${filteredSearch.length} search calls`);
                const searchResults = await this.executeBatch(filteredSearch, callbacks, abortSignal, readFiles);

                // Save full content for Read-Planner before it gets externalized in history
                searchContentForPlanner = searchResults
                    .filter((r) => !r.isError)
                    .map((r) => `[${r.tool}]\n${r.content}`)
                    .join('\n\n---\n\n');

                allResults.push(...searchResults);
                toolCallsExecuted += searchResults.length;
                // FEAT-32-02 PR 2.2 / ADR-133: feed successful FastPath tools
                // into the episodic detector so the toolSequence is complete.
                if (onToolRecorded) {
                    for (const r of searchResults) {
                        if (!r.isError) {
                            onToolRecorded(r.tool, r.input, r.content.slice(0, 200), 'fastpath');
                        }
                    }
                }

                // ── Stage 2: Read (externalization DISABLED — Presenter needs full
                //    file content to write a quality summary) ──────────────────────
                if (searchContentForPlanner.length > 0) {
                    externalizer?.disable();

                    const readCalls = await this.plannerCall(
                        READ_PLANNER, recipe, userMessage, systemPrompt, abortSignal, tools,
                        searchContentForPlanner,
                    );

                    if (readCalls && readCalls.length > 0) {
                        // S-2: Hard allowlist for Stage 2
                        let filteredRead = readCalls.filter((c) => STAGE2_ALLOWED.has(c.tool));
                        if (filteredRead.length !== readCalls.length) {
                            console.warn(`[FastPath] Stage 2: filtered ${readCalls.length - filteredRead.length} disallowed tool(s)`);
                        }
                        // Block re-reading of externalised stage-1 tmp files.
                        // The planner already saw the full payload via
                        // searchContentForPlanner; pulling it back in via
                        // read_file just doubles the agent's input tokens.
                        const beforeTmpFilter = filteredRead.length;
                        filteredRead = filteredRead.filter((c) => {
                            const path = (c.input?.path as string | undefined) ?? '';
                            return !(path.includes('/tmp/task-') || path.includes('.obsilo-vault/tmp/'));
                        });
                        if (filteredRead.length !== beforeTmpFilter) {
                            console.debug(`[FastPath] Stage 2: dropped ${beforeTmpFilter - filteredRead.length} read(s) targeting externalize tmp -- already in planner context`);
                        }
                        // FIX-G (ADR-090 follow-up, 2026-04-29): dynamic cap.
                        // Static cap=3 silently dropped the 4th and 5th read for tasks
                        // that explicitly say "alle/all/jede/list of N notes" -- the
                        // user's "konsolidierte Insights aus ALLEN GenAI-Notes" lost
                        // 2 sources, leading to a halluzinated synthesis claiming 12
                        // interviews from 3 actually-read files. Detect "wide scope"
                        // intent in the user message and lift the cap to 8.
                        const wideScope = /\b(alle|all|jede[rsn]?|every|each|complete|vollst(ä|ae)ndig|s(ä|ae)mtlich|liste|list of \d+|\d+\s*(meeting|interview|note))\b/i.test(userMessage);
                        const FANOUT_CAP = wideScope ? 8 : 3;
                        if (filteredRead.length > FANOUT_CAP) {
                            console.debug(`[FastPath] Stage 2: capping fanout from ${filteredRead.length} to ${FANOUT_CAP} (wideScope=${wideScope})`);
                            filteredRead = filteredRead.slice(0, FANOUT_CAP);
                        } else if (wideScope) {
                            console.debug(`[FastPath] Stage 2: wideScope detected, keeping all ${filteredRead.length} reads`);
                        }
                        console.debug(`[FastPath] Stage 2: ${filteredRead.length} read calls`);
                        const readResults = await this.executeBatch(filteredRead, callbacks, abortSignal, readFiles);
                        allResults.push(...readResults);
                        toolCallsExecuted += readResults.length;
                        // FEAT-32-02 PR 2.2 / ADR-133: episodic recording for
                        // stage-2 reads (same gate as stage 1).
                        if (onToolRecorded) {
                            for (const r of readResults) {
                                if (!r.isError) {
                                    onToolRecorded(r.tool, r.input, r.content.slice(0, 200), 'fastpath');
                                }
                            }
                        }
                    }

                    externalizer?.enable();
                }
            }

            if (toolCallsExecuted === 0) {
                console.debug('[FastPath] No tools executed, falling back to normal loop');
                return failed;
            }

            // Build history entries
            const historyEntries = this.buildHistory(allResults);

            console.debug(`[FastPath] Completed: ${toolCallsExecuted} tools (${allResults.filter(r => r.isError).length} errors)`);

            return { success: true, historyEntries, toolCallsExecuted };
        } catch (e) {
            // Re-enable externalization on error (might have been disabled for Stage 2)
            this.pipeline.getExternalizer()?.enable();
            console.warn('[FastPath] Execution failed, falling back to normal loop:', e);
            return failed;
        }
    }

    // -----------------------------------------------------------------------
    // Planner Call
    // -----------------------------------------------------------------------

    private async plannerCall(
        template: string,
        recipe: ProceduralRecipe,
        userMessage: string,
        systemPrompt: string,
        abortSignal?: AbortSignal,
        tools?: ToolDefinition[],
        searchResults?: string,
    ): Promise<PlannedToolCall[] | null> {
        const stepsText = recipe.steps
            .map((s, i) => `${i + 1}. ${s.tool} — ${s.note}${s.conditional ? ' [optional]' : ''}`)
            .join('\n');

        // Include input schemas for recipe-relevant tools
        const recipeToolNames = new Set(recipe.steps.map((s) => s.tool));
        let toolSchemaHint = '';
        if (tools && tools.length > 0) {
            const relevant = tools.filter((t) => recipeToolNames.has(t.name));
            if (relevant.length > 0) {
                toolSchemaHint = 'TOOL PARAMETER SCHEMAS:\n' +
                    relevant.map((t) => `${t.name}: ${JSON.stringify(t.input_schema?.properties ?? {})}`).join('\n');
            }
        }

        let prompt = template
            .replace('{STEPS}', stepsText)
            .replace('{USER_MESSAGE}', userMessage)
            .replace('{TOOL_SCHEMAS}', toolSchemaHint);

        if (searchResults) {
            prompt = prompt.replace('{SEARCH_RESULTS}', searchResults);
        }

        try {
            let responseText = '';
            // FEAT-24-07 / ADR-115: route planner/presenter through the optional helper model.
            const internalApi = this.getInternalApi();
            for await (const chunk of internalApi.createMessage(
                systemPrompt,
                [{ role: 'user', content: prompt }],
                [], // No tools -- want JSON output, not tool calls
                abortSignal,
            )) {
                if (chunk.type === 'text') responseText += chunk.text;
                // FIX-24-05-04: planner tokens cost money too.
                else if (chunk.type === 'usage') {
                    // FIX-24-05-08: the chunk's own id wins; the handler lookup
                    // is the fallback for a handler built outside the factory.
                    this.onUsage?.(chunk.inputTokens, chunk.outputTokens, chunk.cacheReadTokens, chunk.cacheCreationTokens,
                        chunk.modelId ?? internalApi.getModel().id);
                }
            }

            // BUG-024: tolerant JSON extraction. Some LLMs (Copilot Sonnet
            // variants seen in production) wrap the JSON in prose preambles
            // or add trailing commentary. Strip fences first, then scan for
            // the first balanced JSON array or object and parse only that
            // slice. Unsalvageable output still lands in the catch below and
            // falls back to the normal agent loop.
            const extracted = extractFirstJsonDocument(responseText);
            if (!extracted) return null;
            const parsed: unknown = JSON.parse(extracted);
            if (!Array.isArray(parsed)) return null;

            const valid: PlannedToolCall[] = [];
            for (const item of parsed) {
                if (
                    typeof item === 'object' && item !== null &&
                    typeof (item as Record<string, unknown>).tool === 'string' &&
                    typeof (item as Record<string, unknown>).input === 'object'
                ) {
                    valid.push({
                        tool: String((item as Record<string, unknown>).tool),
                        input: (item as Record<string, unknown>).input as Record<string, unknown>,
                    });
                }
            }
            return valid.length > 0 ? valid : null;
        } catch (e) {
            console.warn('[FastPath] Planner call failed:', e);
            return null;
        }
    }

    // -----------------------------------------------------------------------
    // Batch Execution
    // -----------------------------------------------------------------------

    private async executeBatch(
        calls: PlannedToolCall[],
        callbacks: ToolCallbacks,
        abortSignal?: AbortSignal,
        readFiles?: Set<string>,
    ): Promise<Array<{ tool: string; input: Record<string, unknown>; content: string; isError: boolean }>> {
        const results: Array<{ tool: string; input: Record<string, unknown>; content: string; isError: boolean }> = [];

        // Read-safe tools in parallel, write tools sequential
        const readCalls = calls.filter((c) => this.isReadSafe(c.tool));
        const writeCalls = calls.filter((c) => !this.isReadSafe(c.tool));

        if (readCalls.length > 0) {
            const readResults = await Promise.all(
                readCalls.map(async (call) => {
                    const id = `fp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                    const result = await this.pipeline.executeTool(
                        { type: 'tool_use', id, name: call.tool as ToolName, input: call.input },
                        callbacks,
                        this.buildExtensions(readFiles),
                        { source: 'fastpath', trust: this.currentTrust },
                    );
                    return {
                        tool: call.tool,
                        input: call.input,
                        content: this.extractText(result.content),
                        isError: result.is_error ?? false,
                    };
                }),
            );
            results.push(...readResults);
        }

        for (const call of writeCalls) {
            if (abortSignal?.aborted) break;
            const id = `fp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const result = await this.pipeline.executeTool(
                { type: 'tool_use', id, name: call.tool as ToolName, input: call.input },
                callbacks,
                this.buildExtensions(readFiles),
                { source: 'fastpath', trust: this.currentTrust },
            );
            results.push({
                tool: call.tool,
                input: call.input,
                content: this.extractText(result.content),
                isError: result.is_error ?? false,
            });
        }

        return results;
    }

    // -----------------------------------------------------------------------
    // History Builder
    // -----------------------------------------------------------------------

    private buildHistory(
        results: Array<{ tool: string; input: Record<string, unknown>; content: string; isError: boolean }>,
    ): MessageParam[] {
        const entries: MessageParam[] = [];

        const toolUseBlocks = results.map((r, i) => ({
            type: 'tool_use' as const,
            id: `fp-batch-${i}`,
            name: r.tool,
            input: r.input,
        }));

        entries.push({ role: 'assistant', content: toolUseBlocks });

        const toolResultBlocks = results.map((r, i) => ({
            type: 'tool_result' as const,
            tool_use_id: `fp-batch-${i}`,
            content: r.content,
            is_error: r.isError,
        }));

        entries.push({ role: 'user', content: toolResultBlocks });

        return entries;
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private isReadSafe(toolName: string): boolean {
        return READ_SAFE.has(toolName);
    }

    private extractText(content: unknown): string {
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) {
            return (content as Array<{ type: string; text?: string }>)
                .filter((b) => b.type === 'text')
                .map((b) => b.text ?? '')
                .join('\n');
        }
        return String(content);
    }
}

// ---------------------------------------------------------------------------
// Tolerant JSON extraction (BUG-024)
// ---------------------------------------------------------------------------

/**
 * Scans raw LLM output and returns the first balanced JSON array or object
 * substring, or null when no complete document is found. Strips markdown
 * fences first and respects string literals + escape sequences so braces
 * inside strings do not unbalance the counter.
 *
 * Exported for unit tests.
 */
export function extractFirstJsonDocument(raw: string): string | null {
    let text = raw.trim();

    // Strip the common ```json / ``` fence, with or without the language tag.
    if (text.startsWith('```')) {
        text = text.replace(/^```(?:json)?\n?/i, '');
        const closingFence = text.lastIndexOf('```');
        if (closingFence !== -1) text = text.slice(0, closingFence);
        text = text.trim();
    }

    const start = firstJsonStart(text);
    if (start === -1) return null;

    const opening = text[start];
    const closing = opening === '[' ? ']' : '}';
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escape) { escape = false; continue; }
            if (ch === '\\') { escape = true; continue; }
            if (ch === '"') { inString = false; }
            continue;
        }
        if (ch === '"') { inString = true; continue; }
        if (ch === opening) depth++;
        else if (ch === closing) {
            depth--;
            if (depth === 0) return text.slice(start, i + 1);
        }
    }
    return null; // never balanced -- let caller bail
}

function firstJsonStart(text: string): number {
    const firstArray = text.indexOf('[');
    const firstObject = text.indexOf('{');
    if (firstArray === -1) return firstObject;
    if (firstObject === -1) return firstArray;
    return Math.min(firstArray, firstObject);
}
