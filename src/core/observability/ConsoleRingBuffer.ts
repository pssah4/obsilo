/**
 * ConsoleRingBuffer
 *
 * Captures console.debug/warn/error output in a fixed-size ring buffer
 * for agent self-observability. Correlates log entries with the currently
 * executing tool for debugging.
 *
 * Review-Bot: Uses console.debug/warn/error only (no console.log).
 */

import { safeRegex } from '../utils/safeRegex';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogLevel = 'debug' | 'warn' | 'error';

export interface LogEntry {
    timestamp: number;
    level: LogLevel;
    message: string;
    source?: string;
    correlatedTool?: string;
}

export interface LogQueryFilter {
    level?: LogLevel;
    since?: number;
    pattern?: string;
    limit?: number;
}

// ---------------------------------------------------------------------------
// ConsoleRingBuffer
// ---------------------------------------------------------------------------

export class ConsoleRingBuffer {
    private entries: LogEntry[] = [];
    private readonly maxEntries: number;
    private currentTool: string | null = null;

    private origDebug: ((...args: unknown[]) => void) | null = null;
    private origWarn: ((...args: unknown[]) => void) | null = null;
    private origError: ((...args: unknown[]) => void) | null = null;
    private installed = false;

    constructor(maxEntries = 500) {
        this.maxEntries = maxEntries;
    }

    /**
     * Wrap console.debug/warn/error to capture output.
     * Originals are called after capture.
     */
    install(): void {
        if (this.installed) return;

        this.origDebug = console.debug.bind(console);
        this.origWarn = console.warn.bind(console);
        this.origError = console.error.bind(console);

        console.debug = (...args: unknown[]) => {
            this.push('debug', args);
            this.origDebug!(...args);
        };
        console.warn = (...args: unknown[]) => {
            this.push('warn', args);
            this.origWarn!(...args);
        };
        console.error = (...args: unknown[]) => {
            this.push('error', args);
            this.origError!(...args);
        };

        this.installed = true;
    }

    /**
     * Restore original console methods.
     */
    uninstall(): void {
        if (!this.installed) return;
        if (this.origDebug) console.debug = this.origDebug;
        if (this.origWarn) console.warn = this.origWarn;
        if (this.origError) console.error = this.origError;
        this.origDebug = null;
        this.origWarn = null;
        this.origError = null;
        this.installed = false;
    }

    /**
     * Set the currently executing tool name for log correlation.
     */
    setCurrentTool(name: string | null): void {
        this.currentTool = name;
    }

    /**
     * Query log entries with optional filters.
     */
    query(filter?: LogQueryFilter): LogEntry[] {
        let results = [...this.entries];

        if (filter?.level) {
            results = results.filter(e => e.level === filter.level);
        }
        if (filter?.since) {
            results = results.filter(e => e.timestamp >= filter.since!);
        }
        if (filter?.pattern) {
            const regex = safeRegex(filter.pattern, 'i');
            results = results.filter(e => regex.test(e.message));
        }
        if (filter?.limit && filter.limit > 0) {
            results = results.slice(-filter.limit);
        }

        return results;
    }

    /**
     * Clear all entries.
     */
    clear(): void {
        this.entries = [];
    }

    /**
     * Get current entry count.
     */
    get size(): number {
        return this.entries.length;
    }

    // -----------------------------------------------------------------------
    // Private
    // -----------------------------------------------------------------------

    private push(level: LogLevel, args: unknown[]): void {
        const message = args
            .map(a => {
                if (typeof a === 'string') return a;
                try { return JSON.stringify(a); }
                catch { return String(a); }
            })
            .join(' ');

        // Extract source from stack trace (caller of console.X)
        let source: string | undefined;
        try {
            const stack = new Error().stack;
            if (stack) {
                const lines = stack.split('\n');
                // lines[0] = "Error", [1] = this.push, [2] = console.X wrapper, [3] = actual caller
                source = lines[3]?.trim();
            }
        } catch {
            // Stack trace extraction is best-effort
        }

        const entry: LogEntry = {
            timestamp: Date.now(),
            level,
            message,
            source,
            correlatedTool: this.currentTool ?? undefined,
        };

        if (this.entries.length >= this.maxEntries) {
            this.entries.shift();
        }
        this.entries.push(entry);
    }
}
