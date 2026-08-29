/**
 * TaskTelemetry -- Per-task token, cost, and tool-sequence logger (ADR-090, Lever 10)
 *
 * Records what the agent did for each task: prompt, iterations, tools used,
 * tokens consumed, EUR cost, outcome. Persists to a single JSON-lines file
 * so we can compare before/after when iterating on prompt heuristics.
 *
 * Storage: <agent data dir>/telemetry/{tasks,condense,requests}.jsonl
 * (FEAT-24-11). The caller passes the directory; without one the legacy
 * <vault>/.obsidian-agent/telemetry location is used so old readers and the
 * existing tests keep working. readRecent() merges the legacy file once so
 * the move loses no history.
 * Append-only. tasks.jsonl and condense.jsonl truncate to the last N entries
 * on each write; requests.jsonl is appended per request (cheap) and trimmed
 * once per task by the caller.
 */

import {
    computeCost,
    computeCostForBuckets,
    formatEur,
    shortModelLabel,
    unpricedBreakdown,
    type PriceSource,
    type UsageByModel,
} from '../pricing/ModelPricing';
import type { FileAdapter } from '../storage/types';
import { PerFileWriteQueue } from '../utils/perFileWriteQueue';
import { t } from '../../i18n';

/** Pre-FEAT-24-11 location, kept as the default and read once on the move. */
export const LEGACY_TELEMETRY_DIR = '.obsidian-agent/telemetry';
const TASKS_FILE = 'tasks.jsonl';
const CONDENSE_FILE = 'condense.jsonl';
const REQUESTS_FILE = 'requests.jsonl';
const MAX_ENTRIES = 1000;
const MAX_CONDENSE_ENTRIES = 2000;
/**
 * ~100 requests per long task, a handful of tasks a day: 20k lines is about a
 * month of history at ~300 bytes a line (6 MB). Trimmed once per task end.
 */
export const MAX_REQUEST_ENTRIES = 20_000;

/**
 * AUDIT L-4 (CWE-362): one queue for the three telemetry files, keyed by path.
 *
 * The writes below are read-modify-writes with three await points each, and
 * there was nothing to serialise on: every write builds a fresh TaskTelemetry
 * over a fresh adapter (TaskMonitor.makeTelemetry), so an instance field would
 * serialise nothing. Three surfaces write these files concurrently now (the
 * sidebar chat, the background task executor, the inline chat panel), and a
 * loser used to read the file before the winner wrote it and then put its own
 * stale-plus-one-line copy over the top: one run's whole cost row gone, both
 * writers reporting success. Atomic temp-plus-rename does not help, it stops a
 * torn file rather than a lost update.
 *
 * Module-level for the same reason InflightStore's is instance-level: the queue
 * has to live wherever the writers meet. Not a cross-process lock (nothing
 * outside this process writes these files).
 */
const telemetryWriteQueue = new PerFileWriteQueue();

/**
 * FIX-24-11-02: every tool that spawns a child AgentTask, i.e. every tool whose
 * call adds a second model's spend to the run.
 *
 * `subAgentCount` counted the string 'new_task' alone, so `investigate`,
 * `consult_flagship` and `invoke_skill` spawns were invisible. Measured on the
 * live logs 2026-08-27: every one of 685 task rows says 0 sub-agents, and 9 of
 * them name a spawn tool in their own toolSequence (5 investigate, 4
 * invoke_skill). Kept next to the counter rather than imported from the tool
 * modules, because this file must stay free of the tool graph; the guard against
 * drift is the test that walks src/core/tools for spawnSubtask users.
 */
export const SPAWN_TOOLS: ReadonlySet<string> = new Set([
    'new_task', 'investigate', 'consult_flagship', 'invoke_skill',
]);

/** How many of the calls in a tool sequence spawned a sub-agent. */
export function countSpawnedSubAgents(toolSequence: readonly string[]): number {
    return toolSequence.filter((name) => SPAWN_TOOLS.has(name)).length;
}

export interface TaskTelemetryOptions {
    /** Directory (adapter-relative) holding the three JSONL files. */
    dir?: string;
}

/**
 * FIX-COMPACT-07: persistable shape of a single condense pass.
 * Mirrors AgentTask.CondenseTelemetryEvent. Kept in this module to
 * avoid a dependency loop with AgentTask.
 */
export interface CondenseTelemetryEntry {
    startedAt: string;
    durationMs: number;
    success: boolean;
    prevTokens: number;
    newTokens: number;
    savedTokens: number;
    helperModelUsed: boolean;
    modelId: string;
    maxTailTokens: number;
    errorMessage?: string;
}

/**
 * FIX-24-11-02: why a call ran on the model it ran on. One union for the whole
 * chain (the usage callback, the request row, the task row). The four labels
 * were already spelled out inline twice, and this fix adds four consumers; six
 * copies of one union is how two of them end up disagreeing.
 *
 *  - `auto`     : the tier resolver picked the model (TaskRouter included, an
 *                 escalation is still the resolver deciding)
 *  - `override` : the user pinned a concrete model for this turn in the chat
 *                 header, which switches the resolver off
 *  - `advisor`  : a `consult_flagship` escalation subagent
 *  - `subagent` : any other spawned child that ran on its own model
 *
 * Reachability, so nobody reads more into a log than it says: a persisted row
 * carries the routing of the run that WROTE it, and only the top-level run
 * writes rows (a child task gets neither telemetry hook). So `advisor` and
 * `subagent` reach the console cost line but not, today, either file.
 */
export type RoutingMode = 'auto' | 'override' | 'advisor' | 'subagent';

/**
 * FEAT-24-11: one API request of the agent loop. The cache numbers are this
 * request's own (not cumulative), and the context columns say what could have
 * moved the cached prefix in that turn: the hashes of the stable and volatile
 * system-prompt parts, how many tool_result blocks were pruned, whether a
 * condense ran, whether steering text was injected. Together they let a
 * report attribute cache writes to a cause instead of guessing.
 */
export interface RequestTelemetryEntry {
    /** ISO timestamp when the request was issued */
    at: string;
    taskId: string;
    /** 0-based main-loop iteration */
    iteration: number;
    modelId: string;
    /**
     * FIX-24-11-02: why this request ran on `modelId`. Required: the loop knows
     * it for every request it issues, and an optional field would let a writer
     * skip it and put the unexplained row back on disk. Constant across a run
     * today (the flag is fixed for a task's lifetime), which is why the task row
     * carries it too; it sits on the request row so the per-request table is
     * readable without a join.
     */
    routingMode: RoutingMode;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    /** Messages in the history sent with this request */
    historyMessages: number;
    /** Tool schemas sent with this request */
    toolsSent: number;
    /** tool_result blocks microcompaction pruned since the previous request */
    prunedBlocksThisTurn: number;
    /** A condense (rolling summary or full) ran since the previous request */
    condensedThisTurn: boolean;
    /** The preamble appended messages (steering text or the soft-limit nudge) before this request */
    steeringInjected: boolean;
    /** Hash of the system prompt above the cache breakpoint */
    stableSystemHash: string;
    /** Hash of the system prompt below the cache breakpoint */
    volatileTailHash: string;
}

/**
 * Cheap, stable 32-bit FNV-1a hash as 8 hex chars. Not cryptographic; it only
 * has to say "this text is the same as last turn" in a log line.
 */
export function hashForTelemetry(text: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

export async function readRecentCondense(
    fs: FileAdapter,
    n: number = 200,
    dir: string = LEGACY_TELEMETRY_DIR,
): Promise<CondenseTelemetryEntry[]> {
    return readJsonLines<CondenseTelemetryEntry>(fs, `${dir}/${CONDENSE_FILE}`, n);
}

export interface TaskTelemetryEntry {
    /**
     * FIX-24-11-01: the run this record belongs to, the same id the request
     * rows carry (AgentTaskRunConfig.taskId, written by
     * AgentTask.emitRequestTelemetry). It is the ONLY thing that joins the two
     * files: without it requests.jsonl says which model served which iteration
     * and tasks.jsonl says what a run cost, and no report can pair them.
     */
    taskId: string;
    /**
     * FIX-24-11-02: why this run's model was chosen, from the run itself (the
     * same binding the request rows use), not from the last usage report. A run
     * that was stopped before any usage arrived still has a routing decision,
     * and a default of 'auto' would be indistinguishable from a measured one.
     */
    routingMode: RoutingMode;
    /** ISO timestamp when the task started */
    startedAt: string;
    /** Wall-clock duration in milliseconds */
    durationMs: number;
    /** First 200 chars of the user message (privacy: full message stays in the chat) */
    promptPreview: string;
    /** Model id used */
    modelId: string;
    /** Mode the task ran in (ask, agent, ...) */
    mode: string;
    /** Iterations of the main ReAct loop */
    iterations: number;
    /** Ordered list of tool names called (with sub-agent calls flattened) */
    toolSequence: string[];
    /** Number of sub-agents spawned, i.e. calls of any tool in SPAWN_TOOLS */
    subAgentCount: number;
    /** Token usage (totals across all iterations + sub-agents) */
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    /**
     * FIX-24-05-05: per-model breakdown of the totals. Present when the
     * task reported one; cost is then the sum of per-model costs.
     */
    usageByModel?: UsageByModel;
    /** Cost in USD and EUR */
    costUsd: number;
    costEur: number;
    /**
     * FIX-24-05-07: where the cost came from, and which models carried usage
     * that nothing could price. Without these a 0 in this file reads as "free"
     * rather than "unpriced", and a partial sum reads as a complete one.
     */
    priceSource?: PriceSource;
    unpricedModelIds?: string[];
    /**
     * Model ids that ran on the user's own machine. A 0 here means "free", not
     * "we have no rate", and the two must not read the same offline.
     */
    localModelIds?: string[];
    /** "completed" | "aborted" | "error" */
    outcome: 'completed' | 'aborted' | 'error';
    /** Optional error message if outcome=error */
    errorMessage?: string;
}

/**
 * FIX-24-11-01: a task record as it comes OFF DISK. Every row written before
 * FIX-24-11-01 predates the field (0 of 58 rows on the live file carried one),
 * and the file is append-only history that nothing rewrites or migrates. So the
 * reader promises no taskId even though every writer now supplies one, and a
 * consumer has to decide what an unjoinable legacy row means instead of
 * trusting a type that lies about the disk.
 *
 * FIX-24-11-02: `routingMode` is in the same position (0 of the 685 task rows
 * on disk carry one).
 */
export type PersistedTaskTelemetryEntry =
    Omit<TaskTelemetryEntry, 'taskId' | 'routingMode'>
    & { taskId?: string; routingMode?: RoutingMode };

/**
 * FIX-24-11-02: a request row as it comes OFF DISK, for the same reason as
 * PersistedTaskTelemetryEntry. The 703 request rows already written have no
 * routingMode, so a reader that promised one would invite a consumer to treat
 * `undefined` as a mode.
 */
export type PersistedRequestTelemetryEntry =
    Omit<RequestTelemetryEntry, 'routingMode'> & { routingMode?: RoutingMode };

async function readJsonLines<T>(fs: FileAdapter, file: string, n: number): Promise<T[]> {
    if (!(await fs.exists(file))) return [];
    const raw = await fs.read(file);
    const lines = raw.split('\n').filter(Boolean).slice(-n);
    const entries: T[] = [];
    for (const line of lines) {
        try { entries.push(JSON.parse(line) as T); } catch { /* skip corrupt line */ }
    }
    return entries;
}

export class TaskTelemetry {
    private fs: FileAdapter;
    private readonly dir: string;
    private startedAt = Date.now();
    private toolSequence: string[] = [];
    private subAgentCount = 0;
    private iterations = 0;

    constructor(fs: FileAdapter, opts: TaskTelemetryOptions = {}) {
        this.fs = fs;
        this.dir = opts.dir ?? LEGACY_TELEMETRY_DIR;
    }

    /** Call once per main-loop iteration (after the LLM responds). */
    bumpIteration(): void { this.iterations++; }

    /**
     * Record a tool call. FIX-24-11-02: the sub-agent counter follows the whole
     * spawn-tool list, not just `new_task`. (The bracketed
     * "new_task[:childTool1,childTool2]" form the old comment here described is
     * produced nowhere; the sequence holds plain tool names.)
     */
    recordTool(toolName: string): void {
        this.toolSequence.push(toolName);
        if (SPAWN_TOOLS.has(toolName)) this.subAgentCount++;
    }

    /**
     * Record a complete task at end of run. Best-effort persistence.
     *
     * FEAT-24-11: the caller may pass iterations/toolSequence/startedAt.
     * TaskMonitor constructs this object at persist time, so the instance
     * fields (bumpIteration/recordTool) are empty there and every record
     * read "iterations 0, toolSequence [], 0 ms" -- the caller's numbers win
     * whenever they are given.
     */
    async record(args: {
        promptPreview: string;
        modelId: string;
        mode: string;
        /**
         * FIX-24-11-01: the run's id, required. Every caller has it in scope
         * (the loop reports it, the monitor forwards it), and an optional field
         * here would let a writer skip it and reintroduce the unjoinable row.
         */
        taskId: string;
        /**
         * FIX-24-11-02: why the run's model was chosen. Required for the same
         * reason as taskId: the loop always knows it and hands it down, so an
         * optional field here would only make it skippable.
         */
        routingMode: RoutingMode;
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheCreationTokens: number;
        outcome: 'completed' | 'aborted' | 'error';
        errorMessage?: string;
        usageByModel?: UsageByModel;
        iterations?: number;
        toolSequence?: string[];
        /** Epoch ms when the task started; defaults to construction time. */
        startedAt?: number;
        /**
         * FIX-24-05-07 review: ids served from the user's own machine. Pricing
         * cannot know the provider, so the caller states it here; without it a
         * local id that matches a hosted rate ('llama-3.2-3b-instruct' hits the
         * 'llama-3' key) landed in tasks.jsonl as cloud spend.
         */
        localModelIds?: string[];
    }): Promise<TaskTelemetryEntry> {
        const localIds = new Set(args.localModelIds ?? []);
        // FIX-24-05-05: mixed-model tasks are priced as the sum of
        // per-model costs; without a breakdown fall back to single-id.
        const cost = (args.usageByModel && Object.keys(args.usageByModel).length > 0)
            ? computeCostForBuckets(args.usageByModel, (id) => localIds.has(id))
            : localIds.has(args.modelId)
                ? unpricedBreakdown([args.modelId])
                : computeCost(args.modelId, args.inputTokens, args.outputTokens, args.cacheReadTokens, args.cacheCreationTokens);
        const startedAt = args.startedAt ?? this.startedAt;
        const toolSequence = args.toolSequence ?? this.toolSequence;
        const subAgentCount = args.toolSequence
            ? countSpawnedSubAgents(args.toolSequence)
            : this.subAgentCount;
        const entry: TaskTelemetryEntry = {
            taskId: args.taskId,
            routingMode: args.routingMode,
            startedAt: new Date(startedAt).toISOString(),
            durationMs: Date.now() - startedAt,
            promptPreview: args.promptPreview.slice(0, 200),
            modelId: args.modelId,
            mode: args.mode,
            iterations: args.iterations ?? this.iterations,
            toolSequence,
            subAgentCount,
            inputTokens: args.inputTokens,
            outputTokens: args.outputTokens,
            cacheReadTokens: args.cacheReadTokens,
            cacheCreationTokens: args.cacheCreationTokens,
            usageByModel: args.usageByModel,
            costUsd: cost.totalUsd,
            costEur: cost.totalEur,
            // FIX-24-05-07: honest provenance in the offline record too.
            priceSource: cost.priceSource,
            unpricedModelIds: cost.unpricedModelIds,
            localModelIds: args.localModelIds,
            outcome: args.outcome,
            errorMessage: args.errorMessage,
        };

        try {
            await this.appendBounded(TASKS_FILE, entry, MAX_ENTRIES);
        } catch (e) {
            console.warn('[TaskTelemetry] persist failed (non-fatal):', e);
        }
        return entry;
    }

    /**
     * FIX-COMPACT-07: persist a per-condense event. Bounded JSONL at
     * <dir>/condense.jsonl. Best-effort, never throws. Datapoints for tuning
     * the threshold and helper-model selection over time.
     */
    async recordCondense(event: CondenseTelemetryEntry): Promise<void> {
        try {
            await this.appendBounded(CONDENSE_FILE, event, MAX_CONDENSE_ENTRIES);
        } catch (e) {
            console.warn('[TaskTelemetry] condense persist failed (non-fatal):', e);
        }
    }

    /**
     * FEAT-24-11: persist one API request. Plain append -- a long task issues
     * a hundred of these and must not re-read the file each time. Trimming
     * happens once per task via trimRequestLog(). Best-effort, never throws.
     *
     * AUDIT L-4: the append needs no lock of its own, but it shares the queue
     * with the trim below. Otherwise an append lands after a trim has read the
     * file and before the trim writes it, and the trim renames the row away.
     */
    async recordRequest(entry: RequestTelemetryEntry): Promise<void> {
        const file = `${this.dir}/${REQUESTS_FILE}`;
        try {
            await telemetryWriteQueue.run(file, async () => {
                await this.ensureDir();
                await this.fs.append(file, JSON.stringify(entry) + '\n');
            });
        } catch (e) {
            console.warn('[TaskTelemetry] request persist failed (non-fatal):', e);
        }
    }

    /**
     * FEAT-24-11: keep requests.jsonl bounded. Called once per task end.
     *
     * AUDIT L-4: read-modify-write, so it runs on the queue for this file. A
     * concurrent task appends to requests.jsonl per API request, and the window
     * here is the widest of the three (the whole file, read at task end).
     */
    async trimRequestLog(max: number = MAX_REQUEST_ENTRIES): Promise<void> {
        const file = `${this.dir}/${REQUESTS_FILE}`;
        try {
            await telemetryWriteQueue.run(file, async () => {
                if (!(await this.fs.exists(file))) return;
                const lines = (await this.fs.read(file)).split('\n').filter(Boolean);
                if (lines.length <= max) return;
                await this.fs.write(file, lines.slice(-max).join('\n') + '\n');
            });
        } catch (e) {
            console.warn('[TaskTelemetry] request trim failed (non-fatal):', e);
        }
    }

    private async ensureDir(): Promise<void> {
        if (!(await this.fs.exists(this.dir))) {
            await this.fs.mkdir(this.dir);
        }
    }

    /**
     * Read-modify-write with a line cap; fine for the once-per-task files.
     *
     * AUDIT L-4: the whole read-modify-write runs on the queue for this file, so
     * a second writer starts only once this one has written. The cap stays a
     * per-write invariant (an append plus an occasional trim would let the file
     * run over the bound between trims, and there is no trim scheduled for these
     * two files) -- the volume is one line per task, so the re-read is cheap.
     */
    private async appendBounded(name: string, entry: unknown, max: number): Promise<void> {
        const file = `${this.dir}/${name}`;
        await telemetryWriteQueue.run(file, async () => {
            await this.ensureDir();
            const line = JSON.stringify(entry) + '\n';
            let existing = '';
            if (await this.fs.exists(file)) {
                existing = await this.fs.read(file);
                // Truncate to last max-1 lines so we stay bounded
                const lines = existing.split('\n').filter(Boolean);
                if (lines.length >= max) {
                    existing = lines.slice(-(max - 1)).join('\n') + '\n';
                }
            }
            await this.fs.write(file, existing + line);
        });
    }

    /**
     * Read recent task entries for the analytics view. FEAT-24-11: when a
     * non-legacy dir is given, the legacy file is merged in (read-only) so
     * the history written before the move stays visible. Sorted by startedAt.
     *
     * FIX-24-11-01: the returned rows may predate `taskId`, hence the
     * Persisted... type. Nothing is rewritten or migrated on read.
     */
    static async readRecent(
        fs: FileAdapter,
        n: number = 100,
        dir: string = LEGACY_TELEMETRY_DIR,
    ): Promise<PersistedTaskTelemetryEntry[]> {
        const current = await readJsonLines<PersistedTaskTelemetryEntry>(fs, `${dir}/${TASKS_FILE}`, n);
        if (dir === LEGACY_TELEMETRY_DIR) return current;
        const legacy = await readJsonLines<PersistedTaskTelemetryEntry>(fs, `${LEGACY_TELEMETRY_DIR}/${TASKS_FILE}`, n);
        if (legacy.length === 0) return current;
        return [...legacy, ...current]
            .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
            .slice(-n);
    }

    /**
     * FEAT-24-11: read recent per-request entries, oldest first.
     *
     * FIX-24-11-02: rows written before that fix carry no routingMode, hence
     * the Persisted... type. Nothing is rewritten or defaulted on read.
     */
    static async readRecentRequests(
        fs: FileAdapter,
        n: number = 1000,
        dir: string = LEGACY_TELEMETRY_DIR,
    ): Promise<PersistedRequestTelemetryEntry[]> {
        return readJsonLines<PersistedRequestTelemetryEntry>(fs, `${dir}/${REQUESTS_FILE}`, n);
    }
}

/**
 * Prompt-cache hit rate: served-from-cache tokens over the total input-side
 * tokens (non-cached input + cache reads + cache writes). Mirrors the
 * computation in `src/api/logCacheStat.ts` so the sidebar number matches the
 * `[CacheStat:<provider>]` console line. Returns null when there is no cache
 * activity at all (so callers can omit the segment).
 */
export function cacheHitRate(inputTokens: number, cacheReadTokens: number, cacheCreationTokens = 0): number | null {
    const total = inputTokens + cacheReadTokens + cacheCreationTokens;
    if (total <= 0 || (cacheReadTokens <= 0 && cacheCreationTokens <= 0)) return null;
    return Math.round((cacheReadTokens / total) * 100);
}

/**
 * FIX-24-05-07: what the euro amount on the footer is worth.
 * Mirrors the provenance fields of CostBreakdown plus the one thing pricing
 * cannot know: whether the model ran on the user's own machine.
 */
export interface FooterPricing {
    priceSource: PriceSource;
    unpricedModelIds: string[];
    /**
     * The whole report ran locally, so there is nothing to bill at all and the
     * amount is dropped. Set without `localModelIds` it means "every id in
     * unpricedModelIds is a local one".
     */
    isLocal?: boolean;
    /**
     * The local ids of a MIXED report. The cloud half is real spend and keeps
     * its amount; these ids only get the local marker, and they are kept out
     * of the generic "no price for" marker so the line says each thing once.
     */
    localModelIds?: string[];
    /**
     * AUDIT-2026-08-27 I-5: models with at least one request that a long-context
     * tier bills above the base rate.
     *
     * costEur is a sum of per-model buckets, and a sum cannot carry a per-request
     * tier, so for these models the amount is a FLOOR: the vendor charged the
     * premium rate for those requests and the total charged the base rate. Absent
     * or empty means "no request crossed a threshold", which is the case for
     * every model in the table except the one tiered row.
     */
    longContextRequestModelIds?: string[];
}

/**
 * Price tiers whose number is an extrapolation rather than a published rate, so
 * the footer marks the amount. 'unknown' is not in here: it drops the amount
 * entirely and has its own markers.
 */
const GUESSED_PRICE_SOURCES = new Set<PriceSource>(['generation', 'estimated']);

/**
 * The bucket that spent the most money, plus how many other models
 * contributed. Ranked by cost because that is the one worth naming; ties (and
 * a run where nothing could be priced) fall back to token volume.
 *
 * `localIds` are ranked at zero cost: a local bucket whose id matches a hosted
 * rate would otherwise outrank the cloud model that actually spent the money.
 */
function dominantModel(
    models: UsageByModel | undefined,
    localIds: ReadonlySet<string>,
): { id: string; others: number } | null {
    const entries = models ? Object.entries(models) : [];
    if (entries.length === 0) return null;
    let bestId = entries[0][0];
    let bestUsd = -1;
    let bestTokens = -1;
    for (const [id, u] of entries) {
        const usd = localIds.has(id)
            ? 0
            : computeCost(id, u.input, u.output, u.cacheRead, u.cacheCreation).totalUsd;
        const tokens = u.input + u.output + u.cacheRead + u.cacheCreation;
        if (usd > bestUsd || (usd === bestUsd && tokens > bestTokens)) {
            bestId = id;
            bestUsd = usd;
            bestTokens = tokens;
        }
    }
    return { id: bestId, others: entries.length - 1 };
}

/** UI helper: build a one-line cost summary for the footer (FEAT-24-05). */
export function formatTelemetryFooter(args: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens?: number;
    costEur: number;
    /** When true, append "(sub)" -- the user pays a flat subscription, this is the would-be API cost. */
    isSubscription?: boolean;
    /**
     * FIX-24-05-07 (D7): per-model usage of this report. The line names the
     * model that spent the money; without this it named none at all.
     */
    models?: UsageByModel;
    /**
     * FIX-24-05-07 (D6): provenance of costEur. Absent means "amount as
     * given", which is what every pre-existing caller wants.
     */
    pricing?: FooterPricing;
}): string {
    const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    let s = `${stamp}  ·  ${args.inputTokens.toLocaleString()} in · ${args.outputTokens.toLocaleString()} out`;
    if (args.cacheReadTokens > 0) s += ` · ${args.cacheReadTokens.toLocaleString()} cached`;
    // FIX-18-01-10: name the writes too. The line printed reads and hid writes,
    // which was cosmetic while only Anthropic and Bedrock reported them (those
    // runs are read-dominated). IMP-18-01-03 made the OpenAI-shaped providers
    // report cache_write_tokens, and the first measured OpenRouter run wrote
    // 250,201 tokens: at the 1.25x write rate that is 0.63 of 2.81 USD, so 22%
    // of the amount printed two fields later had nothing explaining it.
    // Omitted at zero, so a provider that never writes does not grow a field the
    // user has to read past.
    if ((args.cacheCreationTokens ?? 0) > 0) {
        s += ` · ${(args.cacheCreationTokens ?? 0).toLocaleString()} written`;
    }
    const hit = cacheHitRate(args.inputTokens, args.cacheReadTokens, args.cacheCreationTokens ?? 0);
    if (hit !== null) s += ` · ${hit}% hit`;

    const pricing = args.pricing;
    // FIX-24-05-07 review: locality beats the price tier. A local id can match
    // a hosted rate ('llama-3.2-3b-instruct' hits the 'llama-3' key), and the
    // old gate looked at the tier alone, so a free run got an amount printed
    // next to the marker denying it. With no explicit id list, isLocal means
    // the whole report is local, so every unpriced id in it is a local one.
    const localIds = new Set(pricing?.localModelIds ?? (pricing?.isLocal ? pricing.unpricedModelIds : []));
    // "Entirely local" kills the amount. A single local bucket in a mixed run
    // does not: the cloud half is real spend and must stay visible.
    const allLocal = pricing?.isLocal === true;
    const anyLocal = allLocal || localIds.size > 0;

    // FIX-24-05-07 (D7): which model spent it. A mixed run names the dominant
    // one and counts the rest, so the line stays one line.
    const dominant = dominantModel(args.models, localIds);
    if (dominant) {
        s += ` · ${shortModelLabel(dominant.id)}`;
        if (dominant.others > 0) s += ` ${t('ui.cost.moreModels', { count: dominant.others })}`;
    }

    // v2.10.2: always show the EUR cost, even on subscription providers.
    // User asked for visibility into "what would this cost normally" so
    // they can spot expensive calls regardless of where they're billed.
    // The "(~ via Sub)" suffix flags that the displayed cost is the
    // would-be API spend, not what the user actually pays.
    //
    // FIX-24-05-07: the amount is dropped only when NOT ONE bucket could be
    // priced, or when the whole report ran on the user's own machine. A partial
    // sum is still worth showing, next to a marker naming what it misses.
    if (!pricing || (pricing.priceSource !== 'unknown' && !allLocal)) {
        s += ` · ${formatEur(args.costEur)}`;
        if (args.isSubscription) s += ' (~ via Sub)';
        // An extrapolated family rate is not a published one. Say so rather
        // than letting it read like a measured number. IMP-24-05-03 adds the
        // second kind of guess: a long-context premium rate nobody has checked
        // against a rate card. Same marker, because it is worth the same.
        if (GUESSED_PRICE_SOURCES.has(pricing?.priceSource ?? 'unknown')) {
            s += ` · ${t('ui.cost.estimatedRate')}`;
        }
        // AUDIT-2026-08-27 I-5: the amount is a sum, so it was priced at base
        // rates even where the vendor charged a long-context premium. Say that
        // next to the number rather than letting a floor read like a total. A
        // locally served id is excluded: there is no invoice behind it, and the
        // local marker already explains the silence.
        const tiered = (pricing?.longContextRequestModelIds ?? []).filter((id) => !localIds.has(id));
        if (tiered.length > 0) {
            const [first, ...rest] = tiered;
            const model = shortModelLabel(first);
            s += rest.length > 0
                ? ` · ${t('ui.cost.tierBlindMore', { model, count: rest.length })}`
                : ` · ${t('ui.cost.tierBlind', { model })}`;
        }
    }
    if (anyLocal) s += ` · ${t('ui.cost.localUnpriced')}`;
    // The local marker already accounts for the local ids; name the rest, so a
    // custom cloud id in a mixed run is not swallowed by it.
    const remaining = pricing?.unpricedModelIds.filter((id) => !localIds.has(id)) ?? [];
    if (remaining.length > 0) {
        const [first, ...rest] = remaining;
        s += rest.length > 0
            ? ` · ${t('ui.cost.unpricedMore', { model: first, count: rest.length })}`
            : ` · ${t('ui.cost.unpriced', { model: first })}`;
    }
    return s;
}
