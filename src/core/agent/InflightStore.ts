/**
 * In-flight task persistence (IMP-41-03-01, ADR-149).
 *
 * Running tasks used to exist only in memory: a plugin reload or Obsidian
 * crash mid-loop lost the entire turn (checkpoints cover files, not the
 * conversation). This store snapshots { loop state, history } at every turn
 * boundary into ONE JSON file in the GlobalFS data root (same placement as
 * price-catalog.json, outside the vault, excluded from sync). Clean task
 * ends clear their entry; the boot scan offers recovery for fresh entries
 * and sweeps stale ones.
 *
 * The snapshot never contains credentials; pending approvals are NOT
 * restored (fail-closed: they resume as rejected).
 */

import type { MessageParam } from '../../api/types';
import type { AgentLoopState, LoopPhase } from './LoopState';
import { createInitialLoopState, ledgerDivergence, parseUsageLedger } from './LoopState';
import { PerFileWriteQueue } from '../utils/perFileWriteQueue';

export const INFLIGHT_FILE = 'inflight-tasks.json';
const DEBOUNCE_MS = 2000;
export const INFLIGHT_MAX_AGE_MS = 24 * 3600 * 1000;

// AUDIT-EPIC-41 M-2: the boot parse is synchronous on the renderer thread
// and the file is cloud-syncable (FEATURE-1508), so an oversized (or
// hostile) file must not stall onload. A single snapshot is one
// conversation's history; the file holds at most one foreground task plus
// short-lived background ones.
export const MAX_SNAPSHOT_BYTES = 2_000_000;
export const MAX_FILE_BYTES = 8_000_000;
export const MAX_INFLIGHT_ENTRIES = 50;

export interface InflightSnapshot {
    taskId: string;
    conversationId: string;
    mode: string;
    savedAt: number;
    state: AgentLoopState;
    history: MessageParam[];
}

interface InflightFile {
    tasks: Record<string, InflightSnapshot>;
}

const LOOP_PHASES = new Set<string>([
    'preamble', 'streaming', 'executing-tools', 'condensing',
    'completing', 'done', 'aborted', 'failed',
]);
/** Numeric budget/usage fields: finite and clamped to >= 0 on load. */
const NUMERIC_STATE_KEYS: readonly (keyof AgentLoopState)[] = [
    'iteration', 'consecutiveMistakes', 'totalToolErrors', 'rateLimitRetries',
    'advisorCallsUsed', 'telemetryIterations', 'totalInputTokens',
    'totalOutputTokens', 'totalCacheReadTokens', 'totalCacheCreationTokens',
    'streamedTextChars',
];
const BOOLEAN_STATE_KEYS: readonly (keyof AgentLoopState)[] = [
    'attemptCompletionFired', 'fastPathFired', 'cleanNaturalExit',
    'emergencyRetried', 'outputCapRetried', 'effortToolsRetried', 'hasStreamedText',
    'hasRetriedEmpty', 'cacheInvalidated', 'recentPluginSkillUsage',
];

/**
 * The verdict of loop-state validation: a rebuilt state, or the reason it was
 * refused.
 *
 * AUDIT-2026-08-27 L-2: a bare null told the caller nothing, so every rejection
 * was silent -- while the same class already warns for an oversized file and an
 * oversized snapshot. A dropped snapshot means no crash recovery for that task
 * and the next flush erases it from disk, which is too much to lose without a
 * line naming the task and the reason.
 */
type LoopStateVerdict =
    | { state: AgentLoopState }
    | { rejected: string };

/**
 * AUDIT-EPIC-41 M-1: rebuild AgentLoopState from a raw parsed value, copying
 * ONLY known keys with a strict per-field type check. Missing fields fall
 * back to the fresh default (forward-compat for old snapshots, ASR-41-05);
 * a present field of the wrong type rejects the whole snapshot (tampering
 * signal); numeric budgets are clamped to >= 0 so a tampered file cannot
 * hand the loop negative guards. Unknown/injected keys (incl. __proto__) are
 * never copied, so the rebuilt object carries no attacker-controlled data.
 */
function validateLoopState(raw: unknown): LoopStateVerdict {
    if (typeof raw !== 'object' || raw === null) return { rejected: 'state is not an object' };
    const r = raw as Record<string, unknown>;
    const out = createInitialLoopState();

    for (const k of NUMERIC_STATE_KEYS) {
        const v = r[k];
        if (v === undefined || v === null) continue;
        if (typeof v !== 'number' || !Number.isFinite(v)) {
            return { rejected: `${k} is not a finite number` };
        }
        out[k] = Math.max(0, v) as never;
    }
    for (const k of BOOLEAN_STATE_KEYS) {
        const v = r[k];
        if (v === undefined || v === null) continue;
        if (typeof v !== 'boolean') return { rejected: `${k} is not a boolean` };
        out[k] = v as never;
    }
    if (r.phase !== undefined && r.phase !== null) {
        if (typeof r.phase !== 'string' || !LOOP_PHASES.has(r.phase)) {
            return { rejected: 'phase is not a known loop phase' };
        }
        out.phase = r.phase as LoopPhase;
    }
    if (r.turnOutcome !== undefined && r.turnOutcome !== null) {
        if (r.turnOutcome !== 'accept' && r.turnOutcome !== 'abandon') {
            return { rejected: 'turnOutcome is neither accept nor abandon' };
        }
        out.turnOutcome = r.turnOutcome;
    }
    for (const k of ['completionResult', 'pendingModeSwitch'] as const) {
        const v = r[k];
        if (v === undefined) continue;
        if (v !== null && typeof v !== 'string') return { rejected: `${k} is neither a string nor null` };
        out[k] = v;
    }
    // FEAT-24-13: the usage ledger. Copying known keys only means an unhandled
    // field is dropped in silence, and dropping the ledger while keeping the
    // token totals is the D2 mismatch reached through the recovery door: the
    // resumed run would display the whole conversation's tokens and price the
    // last leg only. parseUsageLedger type-guards every record (a count that
    // arrived as a string would turn the running sum into concatenation) and
    // rejects the snapshot rather than resuming with half a ledger.
    const usage = parseUsageLedger(r.usage);
    if (!usage) return { rejected: 'the usage ledger holds a record that is not a valid token booking' };
    out.usage = usage;
    // AUDIT-2026-08-27 L-3: the two halves have to describe the same moment.
    // Each was validated on its own and never against the other, so a file
    // written mid-drift (the snapshot site used to share the live ledger while
    // copying the scalars by value) resumed as a run whose footer prices more
    // tokens than it displays. Absence is not disagreement: a snapshot from
    // before the ledger existed has scalars and nothing to compare them with,
    // and initLoopStateForRun gives those a carry-over record on resume.
    if (r.usage !== undefined && r.usage !== null) {
        const drift = ledgerDivergence(out);
        if (drift) {
            return {
                rejected: 'the usage ledger does not sum to the token totals '
                    + `(scalars minus ledger: in=${drift.input} out=${drift.output} `
                    + `cacheR=${drift.cacheRead} cacheW=${drift.cacheCreation})`,
            };
        }
    }
    return { state: out };
}

/** Reject a history that is not an array of {role: user|assistant, content: string|array}. */
function validateHistory(raw: unknown): MessageParam[] | null {
    if (!Array.isArray(raw)) return null;
    for (const m of raw) {
        if (typeof m !== 'object' || m === null || Array.isArray(m)) return null;
        const msg = m as { role?: unknown; content?: unknown };
        if (msg.role !== 'user' && msg.role !== 'assistant') return null;
        if (typeof msg.content !== 'string' && !Array.isArray(msg.content)) return null;
    }
    return raw as MessageParam[];
}

/**
 * AUDIT-2026-08-27 L-2: name what a task lost and why.
 *
 * The entry is dropped from the loaded set and the next flush re-persists the
 * cleaned set, so the snapshot is gone from disk too. The oversize paths already
 * say so; this is the same event through a different door.
 */
function warnDropped(taskId: string, reason: string): null {
    console.warn(
        `[InflightStore] snapshot for ${taskId} failed validation and was dropped: ${reason}. `
        + 'That task has no crash recovery point any more.',
    );
    return null;
}

/** Rebuild a snapshot from raw parsed data, or null if it fails validation. */
function validateSnapshot(raw: unknown): InflightSnapshot | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const r = raw as Record<string, unknown>;
    // The four identity fields come first and stay silent on failure: without a
    // usable taskId there is nothing to name the loss after.
    if (typeof r.taskId !== 'string' || r.taskId.length === 0) return null;
    if (typeof r.conversationId !== 'string') return null;
    if (typeof r.mode !== 'string') return null;
    if (typeof r.savedAt !== 'number' || !Number.isFinite(r.savedAt)) return null;
    const verdict = validateLoopState(r.state);
    if ('rejected' in verdict) return warnDropped(r.taskId, verdict.rejected);
    const history = validateHistory(r.history);
    if (!history) return warnDropped(r.taskId, 'the history is not an array of user/assistant messages');
    return {
        taskId: r.taskId,
        conversationId: r.conversationId,
        mode: r.mode,
        savedAt: r.savedAt,
        state: verdict.state,
        history,
    };
}

export interface InflightFs {
    exists(path: string): Promise<boolean>;
    read(path: string): Promise<string>;
    write(path: string, content: string): Promise<void>;
}

export class InflightStore {
    private pending = new Map<string, InflightSnapshot>();
    private flushTimer: number | undefined;
    // FEAT-55-03 (ADR-171): serialize every load->mutate->persist on the
    // inflight file so two concurrent chats (or the stop/drain path racing a
    // save) cannot interleave and lose a snapshot.
    private readonly writeQueue = new PerFileWriteQueue();

    constructor(private fs: InflightFs) {}

    /** Debounced snapshot write; the latest snapshot per task wins. */
    // eslint-disable-next-line @typescript-eslint/require-await -- keeps the async store contract for callers; the body only arms the debounced flush timer
    async saveSnapshot(snapshot: InflightSnapshot): Promise<void> {
        this.pending.set(snapshot.taskId, snapshot);
        if (this.flushTimer !== undefined) return;
        this.flushTimer = window.setTimeout(() => {
            this.flushTimer = undefined;
            void this.flush();
        }, DEBOUNCE_MS);
    }

    /**
     * IMP-24-08-04 (stop=pause): flush the pending debounced snapshot
     * immediately. The abort path calls this so the Resume card can list
     * the stopped task without waiting out the debounce window.
     */
    async flushNow(): Promise<void> {
        if (this.flushTimer !== undefined) {
            window.clearTimeout(this.flushTimer);
            this.flushTimer = undefined;
        }
        await this.flush();
    }

    /** Remove a task's snapshot (clean end, discard, resume consumed). */
    async clear(taskId: string): Promise<void> {
        this.pending.delete(taskId);
        // FEAT-55-03: serialized read-modify-write.
        await this.writeQueue.run(INFLIGHT_FILE, async () => {
            const file = await this.load();
            if (!(taskId in file.tasks)) return;
            delete file.tasks[taskId];
            await this.persist(file);
        });
    }

    /** Fresh-enough snapshots for the boot recovery banner; sweeps stale ones. */
    async listRecoverable(maxAgeMs: number = INFLIGHT_MAX_AGE_MS, now: number = Date.now()): Promise<InflightSnapshot[]> {
        // FEAT-55-03: serialized so the stale-sweep persist does not race a
        // concurrent flush/clear on the same file.
        return this.writeQueue.run(INFLIGHT_FILE, async () => {
            const file = await this.load();
            const fresh: InflightSnapshot[] = [];
            let swept = false;
            for (const [taskId, snap] of Object.entries(file.tasks)) {
                if (now - snap.savedAt <= maxAgeMs) {
                    fresh.push(snap);
                } else {
                    delete file.tasks[taskId];
                    swept = true;
                }
            }
            if (swept) await this.persist(file);
            return fresh.sort((a, b) => b.savedAt - a.savedAt);
        });
    }

    private async flush(): Promise<void> {
        // FEAT-55-03: serialized read-modify-write against the shared file.
        await this.writeQueue.run(INFLIGHT_FILE, async () => {
            try {
                const file = await this.load();
                for (const [taskId, snap] of this.pending) {
                    // AUDIT-EPIC-41 M-2: never let an oversized snapshot reach
                    // disk (it would stall the next boot's synchronous parse).
                    // Dropping it only means that task cannot be resumed.
                    if (JSON.stringify(snap).length > MAX_SNAPSHOT_BYTES) {
                        console.warn(`[InflightStore] snapshot for ${taskId} exceeds ${MAX_SNAPSHOT_BYTES} bytes; not persisting.`);
                        continue;
                    }
                    file.tasks[taskId] = snap;
                }
                this.pending.clear();
                await this.persist(file);
            } catch (e) {
                console.warn('[InflightStore] flush failed (non-fatal):', e instanceof Error ? e.message : e);
            }
        });
    }

    private async load(): Promise<InflightFile> {
        try {
            if (!(await this.fs.exists(INFLIGHT_FILE))) return { tasks: {} };
            const rawText = await this.fs.read(INFLIGHT_FILE);
            // AUDIT-EPIC-41 M-2: refuse an oversized file BEFORE JSON.parse so
            // a huge (or hostile) synced file cannot stall the boot thread.
            if (rawText.length > MAX_FILE_BYTES) {
                console.warn(`[InflightStore] ${INFLIGHT_FILE} exceeds ${MAX_FILE_BYTES} bytes; ignoring.`);
                return { tasks: {} };
            }
            const parsed = JSON.parse(rawText) as { tasks?: unknown };
            if (typeof parsed?.tasks !== 'object' || parsed.tasks === null) return { tasks: {} };
            // AUDIT-EPIC-41 M-1: validate every entry; drop tampered/broken
            // ones. The cleaned set is what callers see and what flush() then
            // re-persists (self-healing).
            const cleaned: Array<[string, InflightSnapshot]> = [];
            for (const [taskId, rawSnap] of Object.entries(parsed.tasks as Record<string, unknown>)) {
                const snap = validateSnapshot(rawSnap);
                if (snap && snap.taskId === taskId) cleaned.push([taskId, snap]);
            }
            // AUDIT-EPIC-41 M-2: bound the entry count, keeping the newest.
            cleaned.sort((a, b) => b[1].savedAt - a[1].savedAt);
            const tasks: Record<string, InflightSnapshot> = {};
            for (const [taskId, snap] of cleaned.slice(0, MAX_INFLIGHT_ENTRIES)) {
                tasks[taskId] = snap;
            }
            return { tasks };
        } catch {
            return { tasks: {} };
        }
    }

    private async persist(file: InflightFile): Promise<void> {
        await this.fs.write(INFLIGHT_FILE, JSON.stringify(file));
    }
}
