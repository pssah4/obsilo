/**
 * Explicit, serializable agent-loop state (IMP-41-02-01a, ADR-145).
 *
 * AgentTask.run() held its runtime state in ~20 closure variables scattered
 * across an 1800-line function — unserializable (blocks task resume,
 * IMP-41-03-01), untestable in isolation, and invisible when debugging a
 * stuck loop. This object replaces them 1:1. Field semantics and reset
 * points are IDENTICAL to the closure variables they replace; the engine
 * extraction (IMP-41-02-01b) then moves ownership into AgentLoopEngine.
 *
 * Everything here must stay JSON-serializable: no functions, no class
 * instances, no AbortSignal/Map/Set. Plain records in a plain array are fine
 * (FEAT-24-13's usage ledger).
 *
 * AUDIT-2026-08-27 L-3: a reference-typed field means a spread of this object is
 * NOT a copy of it. Every field was a primitive until the ledger arrived, so
 * `{ ...loopState }` was a complete copy and the inflight snapshot relied on
 * that: it froze the four token scalars by value while sharing the live ledger
 * array, and serialisation happens up to two seconds later. Both halves of one
 * snapshot therefore have to be copied at the same instant, which is what
 * cloneLoopState is for. Callers taking a snapshot use it; the resume path
 * deep-copies through JSON.
 */

import {
    addUsage, createUsageByModel, crossesLongContextTier, promptTokensOf,
    UNKNOWN_MODEL_KEY, type UsageByModel,
} from '../pricing/ModelPricing';

export type LoopPhase =
    | 'preamble'
    | 'streaming'
    | 'executing-tools'
    | 'condensing'
    | 'completing'
    | 'done'
    | 'aborted'
    | 'failed';

export interface AgentLoopState {
    /** Coarse phase for diagnostics and (W3) resume. */
    phase: LoopPhase;
    /** Current iteration of the inner for-loop (0-based). */
    iteration: number;

    // --- exit / completion ---
    /** Set by attempt_completion; non-null ends the loop after the turn. */
    completionResult: string | null;
    attemptCompletionFired: boolean;
    /** True when a FastPath recipe pre-ran before the loop. */
    fastPathFired: boolean;
    /** Natural end without cap/error (episode outcome grading). */
    cleanNaturalExit: boolean;
    /** Turn outcome, resolved at the return sites. */
    turnOutcome: 'accept' | 'abandon';

    // --- guards / budgets ---
    consecutiveMistakes: number;
    totalToolErrors: number;
    /** Loop-level transient-error retries used (rate-limit/5xx/network). */
    rateLimitRetries: number;
    emergencyRetried: boolean;
    /** ADR-148: one corrective retry per task after an output-cap 400. */
    outputCapRetried: boolean;
    /** FIX-54-10: one corrective retry per task after an effort-with-tools 400. */
    effortToolsRetried: boolean;
    advisorCallsUsed: number;

    // --- stream / reply bookkeeping ---
    hasStreamedText: boolean;
    /**
     * FIX-41-03-01: total characters of narration/answer text streamed this
     * run. The completion gate compares attempt_completion.result against
     * this so an answer that only lives in the result param (model streamed
     * a few narration sentences, put the deliverable into the tool input)
     * is rendered instead of silently discarded.
     */
    streamedTextChars: number;
    hasRetriedEmpty: boolean;

    // --- mode / prompt-cache ---
    pendingModeSwitch: string | null;
    cacheInvalidated: boolean;
    recentPluginSkillUsage: boolean;

    // --- telemetry / usage totals ---
    telemetryIterations: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheReadTokens: number;
    totalCacheCreationTokens: number;
    /**
     * FEAT-24-13: every LLM spend this run booked, in order.
     *
     * The four scalars above say HOW MANY tokens the run used; this says which
     * model used them, so the money and the token counts can no longer describe
     * different halves of the run (D2). It lives here, in the state the resume
     * path already deep-copies, rather than beside it on the task object, which
     * is why a resumed run gets its history of spend back for free.
     */
    usage: UsageRecord[];
}

/**
 * FEAT-24-13: which part of a run booked a spend. Coarse on purpose: the fine
 * grain of an out-of-loop call (which tool, which background job) is the
 * business of the meteredCall ledger, this one only has to explain a footer.
 *
 *  - 'main'      a main-loop turn
 *  - 'recovery'  the hard-limit recovery call after the iteration cap
 *  - 'condense'  a context-condensing pass (often on the helper model)
 *  - 'fastpath'  the FastPath recipe planner
 *  - 'tool'      an LLM call a tool made and reported (reportAuxUsage)
 *  - 'subtask'   forwarded from a child task's own report
 *  - 'compacted' an aggregate of older records, folded away by the bound
 */
export type UsageOrigin =
    | 'main' | 'recovery' | 'condense' | 'fastpath' | 'tool' | 'subtask' | 'compacted';

const USAGE_ORIGINS = new Set<string>([
    'main', 'recovery', 'condense', 'fastpath', 'tool', 'subtask', 'compacted',
]);

/** One booked LLM spend. Plain JSON by contract; see AgentLoopState.usage. */
export interface UsageRecord {
    /** The model that served the call. Empty only when nothing attributed it. */
    modelId: string;
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
    source: UsageOrigin;
    /** Main-loop iteration it was booked in; -1 when none was in scope. */
    iteration: number;
}

/** The four scalars, as a shape both halves of the invariant can be read into. */
export interface UsageTotals {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
}

/**
 * FEAT-24-13: cap on the ledger.
 *
 * The state is deep-copied at every turn boundary and written to the inflight
 * snapshot file, which is refused above MAX_SNAPSHOT_BYTES (2 MB) -- and a
 * refused snapshot means no crash recovery for that task. A record serializes to
 * roughly 160 bytes, so 1000 of them is about 160 KB: a fraction of the snapshot
 * budget, and far more bookings than a real conversation makes (one per API
 * call, plus condensing, tools and subtasks). Beyond it the oldest are folded,
 * never dropped: no token is lost at any cardinality. What a fold can lose,
 * and only past MAX_FOLD_AGGREGATES distinct model ids in one batch, is which
 * model the overflow ran on (AUDIT-2026-08-27 I-1).
 */
export const MAX_USAGE_RECORDS = 1000;
/** How many of the oldest records one compaction pass folds away. */
export const USAGE_COMPACT_BATCH = 500;
/**
 * AUDIT-2026-08-27 I-1: how many aggregates one in-memory fold may leave behind.
 *
 * Folding groups on the model id, so a batch of 500 records naming 500 different
 * models used to fold to 500 records: the ledger came back over the cap and the
 * next append folded again, an O(batch) splice-fold-unshift per booked call for
 * the rest of the run. Requiring a fold to at least halve its batch turns that
 * into one fold per 250 appends, whatever the cardinality. A real run names a
 * handful of models, so this never binds there and the per-model detail the fold
 * used to keep is kept unchanged.
 */
const MAX_FOLD_AGGREGATES = USAGE_COMPACT_BATCH / 2;

/**
 * Append a record without touching the scalars.
 *
 * For the main loop the engine has already added the chunk to the scalars by
 * the time the port fires (AgentLoopEngine.consumeStream), so adding them again
 * here would double-book. Every other site uses bookUsage.
 */
export function appendUsageRecord(state: AgentLoopState, record: UsageRecord): void {
    state.usage.push(record);
    if (state.usage.length > MAX_USAGE_RECORDS) compactUsageLedger(state);
}

/** Append a record AND add it to the scalars, so the two cannot drift apart. */
export function bookUsage(state: AgentLoopState, record: UsageRecord): void {
    state.totalInputTokens += record.input;
    state.totalOutputTokens += record.output;
    state.totalCacheReadTokens += record.cacheRead;
    state.totalCacheCreationTokens += record.cacheCreation;
    appendUsageRecord(state, record);
}

/**
 * Fold records into at most `maxAggregates` aggregates, one per model.
 *
 * Dropping them instead would make a long run look cheaper the longer it ran,
 * and would break the invariant the exits assert. The aggregate keeps every
 * token; what it loses is the per-iteration detail of the early part of the run,
 * which is diagnostic, not financial.
 *
 * AUDIT-2026-08-27 I-1: grouping on the id is only a bound while the ids repeat,
 * and MAX_USAGE_RECORDS claimed to be a bound unconditionally. Once the aggregate
 * count is used up, further ids fold into the UNKNOWN_MODEL_KEY bucket, which the
 * pricing already reads as "no rate for this" rather than guessing one. That
 * trades the per-model split of the overflow for the record bound, and only for a
 * ledger with more distinct model ids than a run can plausibly have; the tokens
 * still all arrive, which is the property the exits check.
 */
function foldByModel(
    records: readonly UsageRecord[],
    maxAggregates = Number.POSITIVE_INFINITY,
): UsageRecord[] {
    const byModel = new Map<string, UsageRecord>();
    const fold = (key: string, r: UsageRecord): void => {
        const into = byModel.get(key);
        if (!into) {
            byModel.set(key, { ...r, modelId: key, source: 'compacted', iteration: -1 });
            return;
        }
        into.input += r.input;
        into.output += r.output;
        into.cacheRead += r.cacheRead;
        into.cacheCreation += r.cacheCreation;
    };
    for (const r of records) {
        // A new id may take a slot only while one is left over for the overflow
        // bucket -- unless that bucket is already open, in which case every slot
        // is fair game. Without the reservation the overflow bucket itself would
        // push the result one over `maxAggregates`.
        const budget = byModel.has(UNKNOWN_MODEL_KEY) ? maxAggregates : maxAggregates - 1;
        const roomForANewId = byModel.has(r.modelId) || byModel.size < budget;
        fold(roomForANewId ? r.modelId : UNKNOWN_MODEL_KEY, r);
    }
    return [...byModel.values()];
}

/**
 * How many aggregates a fold may produce when `kept` records stay in place.
 * At least one, so a fold always has somewhere to put the tokens.
 */
function foldRoom(kept: number, ceiling = Number.POSITIVE_INFINITY): number {
    return Math.max(1, Math.min(ceiling, MAX_USAGE_RECORDS - kept));
}

/** Bring an over-long ledger back under the cap, keeping every token. */
function compactUsageLedger(state: AgentLoopState): void {
    const foldCount = Math.min(USAGE_COMPACT_BATCH, state.usage.length);
    const kept = state.usage.length - foldCount;
    const batch = state.usage.splice(0, foldCount);
    const distinctIds = new Set(batch.map((r) => r.modelId)).size;
    const folded = foldByModel(batch, foldRoom(kept, MAX_FOLD_AGGREGATES));
    state.usage.unshift(...folded);
    // A fold that had to open the overflow bucket names the total it could not
    // fit, because that is the one case where the ledger stops being able to say
    // which model the tokens ran on.
    const merged = folded.length < distinctIds
        ? `; ${distinctIds} distinct model ids did not fit ${folded.length} aggregates, `
          + `so the overflow is booked under "${UNKNOWN_MODEL_KEY}"`
        : '';
    console.debug(
        `[Usage] ledger over ${MAX_USAGE_RECORDS} records: compacted the oldest `
        + `${foldCount} into ${folded.length} per-model aggregate(s); tokens kept, `
        + `per-iteration detail dropped${merged}`,
    );
    // The arithmetic above is what holds the cap, so re-checking it is how the
    // cap stays a bound rather than an intention. It fires when `kept` alone is
    // already at the cap, which a ledger written by a build with a larger cap
    // and resumed in-memory (no parse pass) can be.
    if (state.usage.length > MAX_USAGE_RECORDS) {
        const all = foldByModel(state.usage, MAX_USAGE_RECORDS);
        state.usage.length = 0;
        state.usage.push(...all);
    }
}

/**
 * AUDIT-2026-08-27 L-3: a copy that holds for the whole state, not only for its
 * primitives.
 *
 * The inflight snapshot is handed to a store that serialises it later (a 2000 ms
 * debounce), so the object it holds has to stop tracking the live run at the
 * moment it is taken. A spread alone leaves the ledger shared, which let a
 * booking made after the snapshot land in the persisted ledger while the
 * persisted scalars stayed behind: the resumed run then priced more tokens than
 * it displayed, the mismatch the ledger exists to remove. The records are flat,
 * so one level of copying is the whole job.
 */
export function cloneLoopState(state: AgentLoopState): AgentLoopState {
    return { ...state, usage: state.usage.map((r) => ({ ...r })) };
}

/** Sum of the ledger. */
export function ledgerTotals(records: readonly UsageRecord[]): UsageTotals {
    const totals: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
    for (const r of records) {
        totals.input += r.input;
        totals.output += r.output;
        totals.cacheRead += r.cacheRead;
        totals.cacheCreation += r.cacheCreation;
    }
    return totals;
}

/**
 * FEAT-24-13 invariant: the ledger sums to the scalars. Returns null when it
 * holds, otherwise the per-field difference (scalar minus ledger).
 *
 * Asserted at the run exits. A booking site that updates one half and forgets
 * the other now shows up as a named number instead of as a footer whose tokens
 * and money describe different halves of the run.
 */
export function ledgerDivergence(state: AgentLoopState): UsageTotals | null {
    const sum = ledgerTotals(state.usage);
    const diff: UsageTotals = {
        input: state.totalInputTokens - sum.input,
        output: state.totalOutputTokens - sum.output,
        cacheRead: state.totalCacheReadTokens - sum.cacheRead,
        cacheCreation: state.totalCacheCreationTokens - sum.cacheCreation,
    };
    const drifted = diff.input !== 0 || diff.output !== 0
        || diff.cacheRead !== 0 || diff.cacheCreation !== 0;
    return drifted ? diff : null;
}

/**
 * The per-model buckets the pricing needs, derived instead of accumulated.
 *
 * This used to be a second accumulator on the task (`usageByModel`) that run()
 * reset while the scalars survived the resume. Deriving it means there is
 * nothing left to reset.
 */
export function usageByModelFromLedger(records: readonly UsageRecord[]): UsageByModel {
    const buckets = createUsageByModel();
    for (const r of records) {
        addUsage(buckets, r.modelId, r.input, r.output, r.cacheRead, r.cacheCreation);
    }
    return buckets;
}

/**
 * AUDIT-2026-08-27 I-5: record sources that describe exactly ONE request.
 *
 * A long-context tier is charged per request, so only these can answer whether
 * one was charged. 'main', 'recovery' and 'condense' book one usage chunk each,
 * 'fastpath' is the planner's single call, and 'tool' is one metered call (see
 * meteredCall, which documents that a metered call is exactly one request).
 *
 * 'subtask' and 'compacted' are sums: a forwarded child report is the child's
 * per-model total, a compacted record is many requests folded together. 300k
 * tokens in either can be one long request or fifty short ones, which is the same
 * blindness the task total has, so they are excluded rather than tested. A child
 * discloses its own crossings through its own report.
 */
const SINGLE_REQUEST_ORIGINS = new Set<UsageOrigin>([
    'main', 'recovery', 'condense', 'fastpath', 'tool',
]);

/**
 * AUDIT-2026-08-27 I-5: the models this run sent at least one request to that a
 * long-context tier bills above the base rate.
 *
 * The task total is priced off bucket sums and therefore cannot apply such a tier
 * (see computeCostForBuckets, where that limit is deliberate). This is the part
 * of the ledger that still knows the request boundary, so the footer can say the
 * total is a floor instead of presenting it as the invoice. Sorted, so the same
 * ledger always produces the same line.
 */
export function longContextRequestModelIds(records: readonly UsageRecord[]): string[] {
    const ids = new Set<string>();
    for (const r of records) {
        if (!SINGLE_REQUEST_ORIGINS.has(r.source)) continue;
        if (ids.has(r.modelId)) continue;
        if (crossesLongContextTier(r.modelId, promptTokensOf(r.input, r.cacheRead, r.cacheCreation))) {
            ids.add(r.modelId);
        }
    }
    return [...ids].sort();
}

/** Non-negative finite number, i.e. a token count and not a credit note. */
function isAmount(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/**
 * FEAT-24-13: type guard for a record read back from JSON.
 *
 * A resumed ledger comes from a file that is cloud-synced and hand-editable,
 * and `JSON.parse(x) as UsageRecord` checks nothing: an input of "66" would
 * turn the running sum into string concatenation, and a negative amount would
 * let a tampered file talk a run's cost down. Only known keys are copied, so an
 * injected one (including __proto__) cannot ride along.
 */
export function parseUsageRecord(raw: unknown): UsageRecord | null {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.modelId !== 'string') return null;
    if (typeof r.source !== 'string' || !USAGE_ORIGINS.has(r.source)) return null;
    if (!isAmount(r.input) || !isAmount(r.output)) return null;
    if (!isAmount(r.cacheRead) || !isAmount(r.cacheCreation)) return null;
    if (typeof r.iteration !== 'number' || !Number.isInteger(r.iteration) || r.iteration < -1) return null;
    return {
        modelId: r.modelId,
        input: r.input,
        output: r.output,
        cacheRead: r.cacheRead,
        cacheCreation: r.cacheCreation,
        source: r.source as UsageOrigin,
        iteration: r.iteration,
    };
}

/**
 * Rebuild a whole ledger, dropping nothing silently: one bad record rejects the
 * ledger, because a partial ledger is exactly the mismatch this feature exists
 * to prevent. Absent (old snapshot) means an empty ledger, not a rejection.
 */
export function parseUsageLedger(raw: unknown): UsageRecord[] | null {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) return null;
    const out: UsageRecord[] = [];
    for (const entry of raw) {
        const record = parseUsageRecord(entry);
        if (!record) return null;
        out.push(record);
    }
    // A file that carries more than the cap (hand-grown, or written by a build
    // with a larger cap) is folded, not truncated: cutting the oldest rows off
    // would quietly reduce what the resumed run says it spent. The caller
    // already refuses an oversized FILE before parsing, which bounds this.
    if (out.length <= MAX_USAGE_RECORDS) return out;
    const keep = out.splice(-USAGE_COMPACT_BATCH);
    // AUDIT-2026-08-27 I-1: bounded by the room the kept records leave, not by
    // how many distinct ids the file happens to name. This runs once per resume,
    // so it spends the whole remaining budget on per-model detail instead of
    // halving like the in-memory path does.
    const folded = foldByModel(out, foldRoom(keep.length));
    const ledger = [...folded, ...keep];
    return ledger.length <= MAX_USAGE_RECORDS ? ledger : foldByModel(ledger, MAX_USAGE_RECORDS);
}

/**
 * AUDIT-2026-08-27 L-3: give carried scalars a ledger to be carried in.
 *
 * A snapshot written before the ledger existed has token totals and no records.
 * The resumed run therefore starts diverged: its footer would display those
 * tokens and price nothing, and every snapshot it then writes carries the same
 * gap, which load-time validation now refuses. One carry-over record closes it.
 * The record names no model, because nothing in the file does; addUsage reads a
 * blank id as the unknown bucket, which the pricing already treats as "no rate
 * for this" instead of guessing one.
 *
 * Only for an EMPTY ledger. A non-empty ledger that disagrees with its scalars is
 * a booking-site bug, and papering over it here would hide the very thing the
 * exit-time check exists to surface.
 */
function carryUnledgeredSpend(state: AgentLoopState): void {
    if (state.usage.length > 0) return;
    const drift = ledgerDivergence(state);
    if (!drift) return;
    if (drift.input < 0 || drift.output < 0 || drift.cacheRead < 0 || drift.cacheCreation < 0) return;
    state.usage.push({
        modelId: '',
        input: drift.input,
        output: drift.output,
        cacheRead: drift.cacheRead,
        cacheCreation: drift.cacheCreation,
        source: 'compacted',
        iteration: -1,
    });
}

/**
 * IMP-41-03-01: loop-state initialization for fresh AND resumed runs.
 * Snapshots are taken AFTER the tool-results push (the iteration
 * completed), so a resume continues with the NEXT iteration. Budgets,
 * mistake counters and usage totals carry over — no double billing, no
 * budget reset; per-turn stream flags reset because the resumed run
 * streams its own turns.
 *
 * `maxIterations` is the caller's loop bound. Passing it stops the resume from
 * starting where the loop would run nothing (AUDIT-2026-08-27 L-6); leaving it
 * out keeps the old behaviour for callers that have no bound to offer.
 */
export function initLoopStateForRun(
    resumeFrom?: AgentLoopState,
    maxIterations?: number,
): AgentLoopState {
    if (!resumeFrom) return createInitialLoopState();
    const state: AgentLoopState = JSON.parse(JSON.stringify(resumeFrom)) as AgentLoopState;
    // FEAT-24-13: the deep copy carries the ledger, which is the point of
    // putting it here. A snapshot written before the ledger existed has none.
    if (!Array.isArray(state.usage)) state.usage = [];
    state.iteration = resumeFrom.iteration + 1;
    // AUDIT-2026-08-27 L-6: the loop runs while `iteration < maxIterations`, so a
    // snapshot from the last iteration -- or any snapshot at all once the vault
    // owner lowers "Steps per message" -- would execute zero loop bodies and
    // still report a completed run. The sidebar clears the snapshot before the
    // run starts, so that empty run also consumes the recovery point it claims to
    // resume from. Clamping hands the resumed run its last iteration instead,
    // which is enough for the hard-limit recovery to deliver an answer. A
    // non-positive bound is left alone: it says no iteration may run at all,
    // which is a different statement, and clamping it would go negative.
    if (maxIterations !== undefined && maxIterations > 0 && state.iteration >= maxIterations) {
        console.warn(
            `[LoopState] resuming at iteration ${state.iteration} would leave nothing to run `
            + `(limit ${maxIterations}); continuing at iteration ${maxIterations - 1} instead. `
            + 'This run has one iteration to finish the task.',
        );
        state.iteration = maxIterations - 1;
    }
    carryUnledgeredSpend(state);
    state.phase = 'preamble';
    state.hasStreamedText = false;
    state.streamedTextChars = 0;
    state.hasRetriedEmpty = false;
    // FIX-41-03-01 follow-on: snapshots are stamped right after the
    // completion tool_result push, so a resumed run would otherwise hit the
    // completion break before its first own iteration and insta-complete.
    state.completionResult = null;
    state.attemptCompletionFired = false;
    return state;
}

export function createInitialLoopState(opts: { fastPathFired?: boolean } = {}): AgentLoopState {
    return {
        phase: 'preamble',
        iteration: 0,
        completionResult: null,
        attemptCompletionFired: false,
        fastPathFired: opts.fastPathFired ?? false,
        cleanNaturalExit: false,
        turnOutcome: 'abandon',
        consecutiveMistakes: 0,
        totalToolErrors: 0,
        rateLimitRetries: 0,
        emergencyRetried: false,
        outputCapRetried: false,
        effortToolsRetried: false,
        advisorCallsUsed: 0,
        hasStreamedText: false,
        streamedTextChars: 0,
        hasRetriedEmpty: false,
        pendingModeSwitch: null,
        cacheInvalidated: false,
        recentPluginSkillUsage: false,
        telemetryIterations: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheReadTokens: 0,
        totalCacheCreationTokens: 0,
        usage: [],
    };
}
