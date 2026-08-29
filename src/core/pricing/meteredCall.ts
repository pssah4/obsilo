/**
 * meteredCall -- one way to spend money on an LLM call (FIX-24-05-09, D10).
 *
 * Before this, ten modules called `api.createMessage(...)` directly and none of
 * them reported what it cost. The chat footer, tasks.jsonl and the weekly
 * budget therefore described the main agent loop only, and everything else --
 * ingest summaries, memory extraction, template translation, the HyDE query
 * rewrite, contextual retrieval during an index build, chat titling -- was free
 * as far as the plugin was concerned. Contextual retrieval alone is one call
 * per chunk of every enriched note.
 *
 * Fixing the ten by hand fixes the ten. The eleventh, written next month, is
 * dark again on the day it lands. So the call itself is the fix: a caller says
 * WHICH path it is, out of a closed union, and the wrapper does the accounting.
 * Three properties make it worth using:
 *
 *  1. Transparent. The returned stream yields exactly the chunks the handler
 *     produced, in order, and an early `break` is fine. Swapping
 *     `api.createMessage(a, b, c, d)` for `runMeteredCall(api, source, {...})`
 *     is a mechanical edit with no behaviour change.
 *  2. Attributed. The reported model id is the chunk's own (stamped at the
 *     producer by withUsageAttribution, FIX-24-05-08), with the handler's id as
 *     the fallback for handlers built outside the factory.
 *  3. Never fatal. The accounting is a side effect of the call and cannot fail
 *     it: a throwing sink is logged and the stream continues.
 *
 * The ledger below is the second half of the fix. A call that hands its usage
 * to a sink is somebody's business already (a running task folds it into its
 * own totals via `ToolExecutionContext.reportAuxUsage`). A call with no sink
 * has nobody to charge, which is a fact worth being able to read rather than
 * one worth hiding, so it is counted per source and logged.
 */

import type { ApiHandler, ApiStream, MessageParam } from '../../api/types';
import type { ToolDefinition } from '../tools/types';
import {
    addUsage, computeCost, computeCostForBuckets, createUsageByModel, formatEur, shortModelLabel,
    type UsageByModel,
} from './ModelPricing';

/**
 * Every LLM call path that is not the agent loop itself. The loop, the
 * condensing pass and the FastPath planner keep their own accounting (they
 * report into the task totals directly and predate this helper), so they are
 * deliberately absent: a union member with no producer reads like coverage and
 * is not.
 *
 * Adding a call path means adding a member here, and a member without an entry
 * in USAGE_SOURCES does not compile. That is the whole enforcement mechanism.
 */
export type UsageSource =
    /** Semantic conversation title, once per finished chat. */
    | 'chat-title'
    /** Note summary written during vault ingest. */
    | 'ingest-summary'
    /** Inline quick actions in the editor (rewrite, translate, lookup, ...). */
    | 'inline-quick-action'
    /** Atomic-fact extraction for Memory v2. */
    | 'memory-atomize'
    /** Single-call conversation extraction for Memory v2. */
    | 'memory-extract'
    /** configure_model's connectivity probe. */
    | 'model-connection-test'
    /** plan_presentation's constrained deck planner. */
    | 'plan-presentation'
    /** Recipe generation when episodes cluster (mastery). */
    | 'recipe-promotion'
    /** Contextual retrieval: a context prefix per chunk during an index build. */
    | 'semantic-context-prefix'
    /** HyDE: the hypothetical document semantic_search embeds instead of the query. */
    | 'search-hyde'
    /** Localising a bundled template into the vault language. */
    | 'template-translation';

export interface UsageSourceMeta {
    /** Short human-readable name, used in the console line. */
    label: string;
    /**
     * Who owes the tokens.
     *
     *  - 'task':       the call happens inside a running agent task, so its
     *                  usage belongs in that task's totals (footer, telemetry)
     *                  and reaches them through a sink.
     *  - 'background': nothing is running that could be billed. There is no
     *                  footer to write to and no task record to join, so the
     *                  spend is counted in the ledger and logged.
     *
     * This is not decoration: it is the reason a call site passes a sink or
     * does not, and it is what a reader of the ledger needs in order to know
     * whether an unclaimed call is a bug or the expected case.
     */
    attribution: 'task' | 'background';
}

/** Exhaustive by construction: a new UsageSource without an entry fails tsc. */
export const USAGE_SOURCES: Record<UsageSource, UsageSourceMeta> = {
    'chat-title': { label: 'Chat title', attribution: 'background' },
    'ingest-summary': { label: 'Ingest summary', attribution: 'background' },
    'inline-quick-action': { label: 'Inline quick action', attribution: 'background' },
    'memory-atomize': { label: 'Memory atomizer', attribution: 'background' },
    'memory-extract': { label: 'Memory extraction', attribution: 'background' },
    'model-connection-test': { label: 'Model connection test', attribution: 'task' },
    'plan-presentation': { label: 'Presentation planner', attribution: 'task' },
    'recipe-promotion': { label: 'Recipe promotion', attribution: 'background' },
    'semantic-context-prefix': { label: 'Contextual retrieval prefix', attribution: 'background' },
    'search-hyde': { label: 'HyDE query rewrite', attribution: 'task' },
    'template-translation': { label: 'Template translation', attribution: 'background' },
};

/** One reported LLM call's usage. */
export interface MeteredUsage {
    source: UsageSource;
    /** The model that served the call. Never the empty string in practice. */
    modelId: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
}

/**
 * Where a metered call's usage goes. A running task passes
 * `ToolExecutionContext.reportAuxUsage`, which folds it into the task totals so
 * the footer and tasks.jsonl include it.
 */
export type UsageSink = (usage: MeteredUsage) => void;

/** The createMessage argument list, named. */
export interface MeteredRequest {
    systemPrompt: string;
    messages: MessageParam[];
    /** Defaults to no tools. */
    tools?: ToolDefinition[];
    abortSignal?: AbortSignal;
}

export interface UsageLedgerEntry {
    /** Calls that reported a usage chunk. */
    calls: number;
    /** How many of those a sink took responsibility for. */
    claimedCalls: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    /** Per-model split, so the totals can be priced the way the footer prices. */
    byModel: UsageByModel;
}

/**
 * AUDIT-2026-08-27 L-1: prototype-free, because `record` below opens an entry
 * with the same `map[key] ?? (map[key] = ...)` shape that the usage buckets used.
 * The key is a closed union here rather than a model id, so nothing hostile
 * reaches it today; a map with no prototype means nothing has to.
 */
const ledger: Partial<Record<UsageSource, UsageLedgerEntry>> =
    Object.create(null) as Partial<Record<UsageSource, UsageLedgerEntry>>;

/**
 * Session totals per source. A deep copy: the books are readable, not
 * writable, so a diagnostic view cannot corrupt them.
 */
export function getUsageLedger(): Partial<Record<UsageSource, UsageLedgerEntry>> {
    const out: Partial<Record<UsageSource, UsageLedgerEntry>> = {};
    for (const [source, entry] of Object.entries(ledger) as Array<[UsageSource, UsageLedgerEntry]>) {
        // AUDIT-2026-08-27 L-1: the copy is keyed by the same model ids as the
        // original, so it gets the same prototype-free map.
        const byModel = createUsageByModel();
        for (const [id, u] of Object.entries(entry.byModel)) byModel[id] = { ...u };
        out[source] = { ...entry, byModel };
    }
    return out;
}

/** Drop the session totals. Boot and tests. */
export function resetUsageLedger(): void {
    for (const key of Object.keys(ledger) as UsageSource[]) delete ledger[key];
}

function record(usage: MeteredUsage, claimed: boolean): UsageLedgerEntry {
    const entry = ledger[usage.source] ?? (ledger[usage.source] = {
        calls: 0, claimedCalls: 0,
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
        byModel: createUsageByModel(),
    });
    entry.calls += 1;
    if (claimed) entry.claimedCalls += 1;
    entry.inputTokens += usage.inputTokens;
    entry.outputTokens += usage.outputTokens;
    entry.cacheReadTokens += usage.cacheReadTokens;
    entry.cacheCreationTokens += usage.cacheCreationTokens;
    addUsage(entry.byModel, usage.modelId, usage.inputTokens, usage.outputTokens,
        usage.cacheReadTokens, usage.cacheCreationTokens);
    return entry;
}

/**
 * Wrap one createMessage call so its usage is reported instead of dropped.
 *
 * `sink` is the task-side channel when a task owns the call. Without one the
 * spend still lands in the ledger and in the console, which is the difference
 * between "unattributed" and "invisible".
 */
export function runMeteredCall(
    api: ApiHandler,
    source: UsageSource,
    request: MeteredRequest,
    sink?: UsageSink,
): ApiStream {
    return (async function* () {
        for await (const chunk of api.createMessage(
            request.systemPrompt,
            request.messages,
            request.tools ?? [],
            request.abortSignal,
        )) {
            if (chunk.type !== 'usage') {
                yield chunk;
                continue;
            }
            // FIX-24-05-08: the producer's own id wins. getModel() is the
            // fallback for a handler built outside buildApiHandler, which is
            // where the stamping decorator is applied.
            const usage: MeteredUsage = {
                source,
                modelId: chunk.modelId ?? api.getModel().id,
                inputTokens: chunk.inputTokens,
                outputTokens: chunk.outputTokens,
                cacheReadTokens: chunk.cacheReadTokens ?? 0,
                cacheCreationTokens: chunk.cacheCreationTokens ?? 0,
            };
            const entry = record(usage, sink !== undefined);
            logMeteredUsage(usage, entry, sink !== undefined);
            if (sink) {
                // The accounting is a side effect of the call. A broken
                // consumer must not be able to fail the call, the same way
                // FIX-24-05-06 guards the onUsage hook at the run exits.
                try { sink(usage); }
                catch (e) { console.warn(`[Usage] sink for ${source} threw (non-fatal):`, e); }
            }
            yield chunk;
        }
    })();
}

/**
 * How often a bulk source gets a line. Contextual retrieval calls the model once
 * per chunk of every enriched note, so a full index build is thousands of metered
 * calls; a line each would bury the paths that fire once or twice, and a log
 * nobody can read is worth as much as no log. Every line carries the source's
 * running total, so a throttled line still says what has been spent, and the
 * ledger counts all of them regardless.
 */
const LOG_EVERY_NTH_CALL = 25;

/**
 * A line per metered call, throttled for bulk sources. The point is that a path
 * which reported nothing at all now says what it spent, on which model, at which
 * price tier, and whether anybody is folding it into a bill.
 */
function logMeteredUsage(usage: MeteredUsage, entry: UsageLedgerEntry, claimed: boolean): void {
    if (entry.calls !== 1 && entry.calls % LOG_EVERY_NTH_CALL !== 0) return;
    // IMP-24-05-03: a metered call is exactly ONE request, so this is the site
    // that can answer a long-context tier. The line already claims to report the
    // price tier; quoting the small-prompt rate for a 300k prompt would make
    // that claim false.
    const cost = computeCost(usage.modelId, usage.inputTokens, usage.outputTokens,
        usage.cacheReadTokens, usage.cacheCreationTokens, 'request');
    const amount = cost.priceSource === 'unknown' ? 'unpriced' : formatEur(cost.totalEur);
    // The running total is a SUM of requests and stays on the base rate. Two
    // half-size calls must not be billed as one long one.
    const sourceCost = computeCostForBuckets(entry.byModel);
    const sourceTotal = sourceCost.priceSource === 'unknown' ? 'unpriced' : formatEur(sourceCost.totalEur);
    console.debug(
        `[Usage] ${USAGE_SOURCES[usage.source].label} model="${shortModelLabel(usage.modelId)}" `
        + `in=${usage.inputTokens} out=${usage.outputTokens} `
        + `cacheR=${usage.cacheReadTokens} cacheW=${usage.cacheCreationTokens} `
        + `${amount} priceSource=${cost.priceSource} attributed=${claimed} `
        + `calls=${entry.calls} sourceTotal=${sourceTotal}`,
    );
}
