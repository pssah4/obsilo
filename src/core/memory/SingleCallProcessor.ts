/**
 * SingleCallProcessor -- runs SingleCallExtractor + FactIntegrator end-to-end.
 *
 * Phase 4 (FEATURE-0318 / PLAN-007 task C.1). Replaces the old
 * SessionExtractor + LongTermExtractor pair behind one queue
 * processor: read delta state, run one tool-call, write facts +
 * session summary + new delta state.
 *
 * The processor is intentionally thin -- it stitches engine modules
 * together but does no I/O of its own beyond the MemoryService and
 * MemoryDB handles it already holds.
 *
 * Constructor-Injection only (host wires CustomModel + ApiHandler factory).
 */

import type { CustomModel } from '../../types/settings';
import { buildApiHandlerForModel } from '../../api/index';
import type { MemoryService } from './MemoryService';
import type { MemoryDB } from '../knowledge/MemoryDB';
import type { EmbeddingService } from './EmbeddingService';
import type { SemanticIndexService } from '../semantic/SemanticIndexService';
import { FactStore } from './FactStore';
import { EdgeStore } from './EdgeStore';
import { ThreadDeltaStore } from './ThreadDeltaStore';
import { FactIntegrator } from './FactIntegrator';
import { SingleCallExtractor, type SingleCallMessage } from './SingleCallExtractor';
import type { PendingExtraction } from './ExtractionQueue';
import type { TokenBudgetGuard } from './TokenBudgetGuard';
import type { MemoryV2Telemetry } from './MemoryV2Telemetry';

export interface SingleCallProcessorDeps {
    memoryService: MemoryService;
    memoryDB: MemoryDB;
    embeddingService: EmbeddingService | null;
    getMemoryModel: () => CustomModel | null;
    /** Optional -- session summaries get indexed when provided + initialized. */
    getSemanticIndex?: () => SemanticIndexService | null;
    /** Optional -- pre-call budget check, post-call record. */
    tokenBudget?: TokenBudgetGuard | null;
    /** Optional -- per-run jsonl telemetry. */
    telemetry?: MemoryV2Telemetry | null;
}

/**
 * FIX-32-03-03: thrown by SingleCallProcessor when the extractor returns no
 * new facts, no mentions and no session summary -- i.e. nothing worth writing.
 * ExtractionQueue.processQueue() catches this by name and dequeues the item
 * WITHOUT bumping failureCount or emitting drop telemetry: empty extraction
 * is a normal outcome (delta-window already covered, very short turn, ...)
 * and must not consume the retry budget.
 */
export class EmptyExtractionError extends Error {
    constructor(message = 'extractor returned empty result') {
        super(message);
        this.name = 'EmptyExtractionError';
    }
}

export class SingleCallProcessor {
    constructor(private readonly deps: SingleCallProcessorDeps) {}

    async process(item: PendingExtraction, signal?: AbortSignal): Promise<void> {
        const model = this.deps.getMemoryModel();
        if (!model) {
            console.warn('[SingleCall] No memory model configured, skipping extraction');
            return;
        }
        if (!this.deps.memoryDB.isOpen()) {
            console.warn('[SingleCall] memoryDB not open, skipping extraction');
            return;
        }
        if (!Array.isArray(item.messages) || item.messages.length === 0) {
            console.debug('[SingleCall] Empty messages, skipping');
            return;
        }

        const threadId = item.conversationId;
        const budget = this.deps.tokenBudget ?? null;
        if (budget) {
            const blocked = budget.blockReason();
            if (blocked) {
                console.warn(`[SingleCall] ${threadId}: token budget blocked -- ${blocked}`);
                await this.deps.telemetry?.budget({
                    reason: blocked,
                    usedTokens: budget.snapshot().inputTokens + budget.snapshot().outputTokens,
                    capTokens: 0,
                });
                return;
            }
        }

        const factStore = new FactStore(this.deps.memoryDB);
        const edgeStore = new EdgeStore(this.deps.memoryDB);
        const deltaStore = new ThreadDeltaStore(this.deps.memoryDB);
        const integrator = new FactIntegrator(
            factStore, edgeStore, this.deps.memoryDB, this.deps.embeddingService,
        );

        const messages: SingleCallMessage[] = item.messages.map((m, i) => ({
            role: m.role,
            text: m.text,
            index: i,
        }));

        const delta = deltaStore.get(threadId);
        const startMessageIndex = (delta?.lastExtractedMessageIndex ?? -1) + 1;
        if (startMessageIndex >= messages.length) {
            console.debug(`[SingleCall] ${threadId}: nothing new to extract`);
            return;
        }

        const api = buildApiHandlerForModel(model);
        const extractor = new SingleCallExtractor(api);
        const startedAt = Date.now();
        // FIX-32-03-02: thread the AbortSignal from ExtractionQueue through to
        // the API call so a plugin reload mid-extraction aborts the stream.
        const result = await extractor.extract({
            messages,
            startMessageIndex,
            conversationSoFar: delta?.deltaSummary ?? undefined,
            abortSignal: signal,
        });
        const durationMs = Date.now() - startedAt;

        // FIX-32-03-02: the API call may complete just as memoryDB.close() runs
        // in onunload. Re-check before any DB write so a closed-DB race becomes
        // a silent debug log instead of a noisy unhandled rejection.
        if (!this.deps.memoryDB.isOpen()) {
            console.debug('[SingleCall] memoryDB closed mid-extraction, skipping post-extract writes');
            return;
        }

        // FIX-32-03-03: empty extraction is a normal outcome but the queue
        // must distinguish it from real failures. Throw a typed error so
        // ExtractionQueue can dequeue without bumping failureCount.
        if (
            result.facts.length === 0
            && result.mentions.length === 0
            && result.sessionSummary.trim().length === 0
        ) {
            throw new EmptyExtractionError();
        }

        if (budget && result.usage) {
            await budget.record(result.usage.inputTokens, result.usage.outputTokens);
        }
        await this.deps.telemetry?.singleCall({
            threadId,
            factsExtracted: result.facts.length,
            factsRejected: result.rejected.length,
            topicDriftDetected: result.topicDriftDetected,
            inputTokens: result.usage?.inputTokens ?? null,
            outputTokens: result.usage?.outputTokens ?? null,
            // FIX-24-05-09 (D10): name the model, so the token counts in this
            // file can be priced instead of just counted.
            modelId: result.usage?.modelId ?? null,
            durationMs,
        });

        if (result.facts.length > 0) {
            const integration = await integrator.integrate({
                facts: result.facts,
                mentions: result.mentions,
                sessionId: threadId,
                threadId,
            });
            // FEATURE-0319 Phase 5 close-out: link each new fact back to
            // its source conversation via a thread:// edge. recall_memory
            // can render those as clickable backlinks so the user (and
            // the agent) can jump from a fact to the chat that produced it.
            try {
                for (const integrated of integration.integrated) {
                    if (integrated.relation !== 'new') continue;
                    edgeStore.addExternalEdge(
                        integrated.fact.id,
                        `thread://${threadId}`,
                        'extracted_from',
                        { sourceInterface: 'obsilo-self' },
                    );
                }
            } catch (e) {
                console.warn('[SingleCall] thread:// backlink edges skipped:', e);
            }
            await this.deps.telemetry?.integration({
                threadId,
                inserted: integration.stats.inserted,
                superseded: integration.stats.superseded,
                refines: integration.stats.refines,
                derives: integration.stats.derives,
                updateFallbacks: integration.stats.updateFallbacks,
                edgeFallbacks: integration.stats.edgeFallbacks,
                dedupedAsConfirm: integration.stats.dedupedAsConfirm,
                dedupedAsUpdate: integration.stats.dedupedAsUpdate,
                errors: integration.stats.errors.length,
            });
        }

        if (result.sessionSummary.trim().length > 0) {
            await this.deps.memoryService.writeSessionSummary(
                threadId,
                result.sessionSummary,
                item.title,
            );
            const semanticIndex = this.deps.getSemanticIndex?.();
            if (semanticIndex?.isIndexed) {
                await semanticIndex.indexSessionSummary(threadId, result.sessionSummary).catch((e) =>
                    console.warn('[SingleCall] Semantic indexing failed (non-fatal):', e),
                );
            }
        }

        deltaStore.save({
            threadId,
            lastExtractedMessageIndex: result.lastMessageIndex,
            deltaSummary: result.conversationSoFar || delta?.deltaSummary || null,
        });

        console.debug(
            `[SingleCall] ${threadId}: ${result.facts.length} facts (${result.rejected.length} rejected), ` +
            `drift=${result.topicDriftDetected}, tokens=${result.usage?.inputTokens ?? '?'}/${result.usage?.outputTokens ?? '?'}`,
        );
    }
}
