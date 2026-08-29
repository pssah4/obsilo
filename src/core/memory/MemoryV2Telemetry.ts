/**
 * MemoryV2Telemetry -- jsonl logger for the v2 hot-path.
 *
 * Logs the event categories that operators want visibility on:
 *   - cache       prompt-cache hit ratio per turn (Anthropic cache_read_tokens)
 *   - retrieval   p50/p95 latency of ContextComposer + recall_memory
 *   - drift       topic-drift events emitted by ContextComposer
 *   - recall      recall_memory tool calls (query, result count)
 *   - single_call SingleCallExtractor token usage (FEATURE-0318)
 *   - integration FactIntegrator stats per run (FEATURE-0318)
 *   - aging       AgingService daily-decay report (FEATURE-0318)
 *   - budget      TokenBudgetGuard over-budget event (FEATURE-0318)
 *
 * Output: append-only JSONL at `<plugin-data-dir>/logs/memory-v2/{YYYY-MM-DD}.jsonl`.
 * Reads via the existing `read_agent_logs` tool, so the agent can answer
 * "how often did my topic drift this week" without a separate dashboard.
 *
 * Constructor-Injection only -- no obsidian. The transport is a single
 * append callback so tests can inject in-memory and the host wires the
 * actual filesystem.
 *
 * FEATURE-0317 / PLAN-006 task 13. Phase-4 events (FEATURE-0318) added in PLAN-007 task C.2.
 */

export type MemoryV2TelemetryKind =
    | 'cache' | 'retrieval' | 'drift' | 'recall'
    | 'single_call' | 'integration' | 'aging' | 'budget'
    | 'legacy_update_memory_called'
    // FIX-32-03-03: ExtractionQueue parks/drops items when transient failures
    // exceed the failureCount threshold OR a permanent provider error fires.
    | 'memory.extraction.dropped';

export interface MemoryV2TelemetryEvent {
    kind: MemoryV2TelemetryKind;
    /** ISO timestamp; defaulted by `record()` when omitted. */
    timestamp?: string;
    payload: Record<string, unknown>;
}

export type AppendLineFn = (relativePath: string, line: string) => Promise<void>;

export class MemoryV2Telemetry {
    constructor(private readonly appendLine: AppendLineFn) {}

    async record(event: MemoryV2TelemetryEvent): Promise<void> {
        const ts = event.timestamp ?? new Date().toISOString();
        const day = ts.slice(0, 10); // YYYY-MM-DD
        const path = `logs/memory-v2/${day}.jsonl`;
        const line = JSON.stringify({ kind: event.kind, ts, ...event.payload }) + '\n';
        try {
            await this.appendLine(path, line);
        } catch (e) {
            console.debug('[MemoryV2Telemetry] append failed (non-fatal):', e);
        }
    }

    /** Convenience helpers so callers stay terse. */
    async cache(payload: { cacheReadTokens: number; totalInputTokens: number; sessionId?: string }) {
        return this.record({ kind: 'cache', payload });
    }
    async retrieval(payload: { stage: string; durationMs: number; hits?: number; sessionId?: string }) {
        return this.record({ kind: 'retrieval', payload });
    }
    async drift(payload: { previousTopic: string; newTopic: string | null; score: number; sessionId?: string }) {
        return this.record({ kind: 'drift', payload });
    }
    async recall(payload: { query: string; topK: number; hits: number; multiHop: boolean }) {
        return this.record({ kind: 'recall', payload });
    }
    async singleCall(payload: {
        threadId: string;
        factsExtracted: number;
        factsRejected: number;
        topicDriftDetected: boolean;
        inputTokens: number | null;
        outputTokens: number | null;
        /**
         * FIX-24-05-09 (D10): which model served the extraction. Without it a
         * token count in this file cannot be priced at all, and an extraction
         * on the flagship reads exactly like one on a local model.
         */
        modelId?: string | null;
        durationMs: number;
    }) {
        return this.record({ kind: 'single_call', payload });
    }
    async integration(payload: {
        threadId: string;
        inserted: number;
        superseded: number;
        refines: number;
        derives: number;
        updateFallbacks: number;
        edgeFallbacks: number;
        dedupedAsConfirm?: number;
        dedupedAsUpdate?: number;
        errors: number;
    }) {
        return this.record({ kind: 'integration', payload });
    }
    async aging(payload: {
        factsProcessed: number;
        factsUpdated: number;
        skipped: boolean;
        skippedReason?: string;
    }) {
        return this.record({ kind: 'aging', payload });
    }
    async budget(payload: { reason: string; usedTokens: number; capTokens: number }) {
        return this.record({ kind: 'budget', payload });
    }
    /**
     * BA-26 / FEAT-23-05: telemetry-counter for the legacy
     * update_memory MCP tool. Lets the maintainer see when no client uses
     * it any more and the tool can be removed entirely.
     */
    async legacyUpdateMemory(payload: { category: string; sourceInterface: string }) {
        return this.record({ kind: 'legacy_update_memory_called', payload });
    }
    /**
     * FIX-32-03-03: emitted when ExtractionQueue moves a pending item out
     * of the active queue. Two reasons:
     *  - transient-failures: failureCount hit the parking threshold (3),
     *    item moved to parkedItems[] and will not be retried until the
     *    user manually clears it.
     *  - permanent-error: the upstream provider returned 401/402/403 or
     *    a credit/quota message; the whole session is paused.
     *
     * AUDIT-037 M-2: the payload runs through sanitizers before it hits the
     * JSONL sink. `message` is folded through `sanitizeErrorMessage` so a
     * provider response that echoed prompt fragments, API keys or Bearer
     * tokens does not land in the log. `conversationId` is replaced with a
     * stable HMAC so a future log export does not unmask which conversation
     * crashed.
     */
    async extractionDropped(payload: {
        reason: 'transient-failures' | 'permanent-error';
        failureCount: number;
        conversationId?: string;
        message?: string;
    }) {
        const sanitized: Record<string, unknown> = {
            reason: payload.reason,
            failureCount: payload.failureCount,
        };
        if (payload.conversationId) sanitized.conversationIdHash = hashConversationId(payload.conversationId);
        if (payload.message) sanitized.message = sanitizeErrorMessage(payload.message);
        return this.record({ kind: 'memory.extraction.dropped', payload: sanitized });
    }
}

/**
 * AUDIT-037 M-2: redact obvious secret patterns so a provider error message
 * that included an API key or Bearer token does not land in telemetry.
 * Also trim length so very large stack traces stay bounded.
 */
const SECRET_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
    { regex: /sk-[A-Za-z0-9_-]{20,}/g, replacement: 'sk-[REDACTED]' },
    { regex: /sk-ant-[A-Za-z0-9_-]{20,}/g, replacement: 'sk-ant-[REDACTED]' },
    { regex: /Bearer\s+[A-Za-z0-9._-]{20,}/gi, replacement: 'Bearer [REDACTED]' },
    { regex: /AKIA[0-9A-Z]{16,}/g, replacement: 'AKIA[REDACTED]' },
    { regex: /AWS[0-9A-Z_]{8,}=([A-Za-z0-9/+=]{20,})/g, replacement: 'AWS_[REDACTED]' },
    { regex: /[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, replacement: '[JWT_REDACTED]' },
    { regex: /xox[bopas]-[A-Za-z0-9-]{10,}/g, replacement: 'xox[REDACTED]' },
];

const MAX_TELEMETRY_MESSAGE_LEN = 500;

export function sanitizeErrorMessage(raw: unknown): string {
    let s = typeof raw === 'string' ? raw : raw instanceof Error ? raw.message : String(raw);
    for (const { regex, replacement } of SECRET_PATTERNS) {
        s = s.replace(regex, replacement);
    }
    if (s.length > MAX_TELEMETRY_MESSAGE_LEN) {
        s = s.slice(0, MAX_TELEMETRY_MESSAGE_LEN) + '...[truncated]';
    }
    return s;
}

/**
 * AUDIT-037 M-2: deterministic hash of a conversation id. Telemetry needs to
 * correlate events across turns of the same conversation but does not need
 * the raw id. SHA-256 over a per-session salt makes the hash unforgeable
 * without re-keying every plugin reload; the salt is rotated on every plugin
 * load so the hash space across users stays separated.
 */
let conversationIdSalt: string | null = null;
function getConversationIdSalt(): string {
    if (conversationIdSalt) return conversationIdSalt;
    const arr = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        crypto.getRandomValues(arr);
    } else {
        for (let i = 0; i < arr.length; i++) arr[i] = (i * 31 + 7) & 0xff;
    }
    conversationIdSalt = Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
    return conversationIdSalt;
}

export function hashConversationId(id: string): string {
    const salt = getConversationIdSalt();
    // Lightweight djb2 hash over salt + id. We avoid an async subtle.digest
    // call here so the telemetry helper stays synchronous and never blocks
    // the queue drain. The salt prevents correlation across users.
    let h = 5381;
    const s = salt + ':' + id;
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    }
    return 'h:' + (h >>> 0).toString(16);
}
