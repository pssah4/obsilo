/**
 * OperationLogger - Persistent JSONL audit trail (Sprint 1.7)
 *
 * Logs every tool execution to daily JSONL files.
 * Format: one JSON object per line, one file per day.
 * Rotation: keeps last 30 days, deletes older files.
 *
 * Storage: .obsidian/plugins/obsilo-agent/logs/YYYY-MM-DD.jsonl
 */

import type { FileAdapter } from '../storage/types';

export interface LogEntry {
    timestamp: string;
    taskId: string;
    mode: string;
    tool: string;
    params: Record<string, any>;
    result?: string;
    success: boolean;
    durationMs: number;
    error?: string;
}

export class OperationLogger {
    private fs: FileAdapter;
    private logDir: string;
    private readonly MAX_LOG_DAYS = 30;
    private readonly MAX_RESULT_LEN = 2000;


    constructor(fs: FileAdapter) {
        this.fs = fs;
        this.logDir = 'logs';
    }

    /**
     * Initialize the log directory (create if needed).
     */
    async initialize(): Promise<void> {
        try {
            const exists = await this.fs.exists(this.logDir);
            if (!exists) {
                await this.fs.mkdir(this.logDir);
            }
        } catch (e) {
            console.warn('[OperationLogger] Failed to create log directory:', e);
        }
    }

    /**
     * H-5: Sanitize tool parameters before persisting to audit log.
     * Prevents sensitive data (file contents, credentials, long strings) from
     * being stored in plain-text JSONL files.
     */
    private sanitizeParams(tool: string, params: Record<string, any>): Record<string, any> {
        const MAX_VALUE_LEN = 500;
        const SENSITIVE_KEYS = new Set(['password', 'token', 'api_key', 'secret', 'key', 'auth', 'authorization']);
        const CONTENT_KEYS = new Set(['content', 'new_str', 'old_str']); // file content fields
        const result: Record<string, any> = {};
        for (const [k, v] of Object.entries(params)) {
            const lk = k.toLowerCase();
            if (SENSITIVE_KEYS.has(lk)) {
                result[k] = '[REDACTED]';
            } else if (CONTENT_KEYS.has(lk)) {
                // Log only length — content can be many KB
                result[k] = `[${typeof v === 'string' ? v.length : '?'} chars]`;
            } else if (lk === 'url' && typeof v === 'string') {
                // Strip auth credentials from URLs
                try {
                    const u = new URL(v);
                    u.username = '';
                    u.password = '';
                    result[k] = u.toString();
                } catch {
                    result[k] = '[INVALID_URL]';
                }
            } else if (typeof v === 'string' && v.length > MAX_VALUE_LEN) {
                result[k] = v.slice(0, MAX_VALUE_LEN) + '…';
            } else {
                result[k] = v;
            }
        }
        return result;
    }

    /**
     * Log a tool operation.
     * Uses adapter.append() for true O(1) appends — no full-file rewrite needed.
     */
    async log(entry: LogEntry): Promise<void> {
        try {
            const today = this.getToday();
            const logPath = `${this.logDir}/${today}.jsonl`;
            const sanitizedResult = entry.result
                ? (entry.result.length > this.MAX_RESULT_LEN
                    ? entry.result.slice(0, this.MAX_RESULT_LEN) + '...[truncated]'
                    : entry.result)
                : undefined;
            const sanitized = {
                ...entry,
                params: this.sanitizeParams(entry.tool, entry.params),
                result: sanitizedResult,
            };
            const line = JSON.stringify(sanitized) + '\n';

            const exists = await this.fs.exists(logPath);
            if (!exists) {
                // New day file: create it and rotate old logs asynchronously
                await this.fs.write(logPath, line);
                this.rotateLogs().catch((e) =>
                    console.warn('[OperationLogger] Rotation error:', e)
                );
            } else {
                await this.fs.append(logPath, line);
            }
        } catch (e) {
            // Logging must never break agent execution
            console.warn('[OperationLogger] Failed to write log entry:', e);
        }
    }

    /**
     * Read log entries for a specific date (YYYY-MM-DD).
     */
    async readLog(date: string): Promise<LogEntry[]> {
        const logPath = `${this.logDir}/${date}.jsonl`;
        try {
            const exists = await this.fs.exists(logPath);
            if (!exists) return [];
            const content = await this.fs.read(logPath);
            return content
                .split('\n')
                .filter((line) => line.trim().length > 0)
                .map((line) => { try { return JSON.parse(line) as LogEntry; } catch { return null; } })
                .filter((entry): entry is LogEntry => entry !== null);
        } catch {
            return [];
        }
    }

    /**
     * Get available log dates (newest first).
     */
    async getLogDates(): Promise<string[]> {
        try {
            const listed = await this.fs.list(this.logDir);
            return listed.files
                .map((f) => f.replace(`${this.logDir}/`, '').replace('.jsonl', ''))
                .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
                .sort()
                .reverse();
        } catch {
            return [];
        }
    }

    /**
     * Read raw JSONL content for a specific date (for download).
     */
    async readRawLog(date: string): Promise<string | null> {
        const logPath = `${this.logDir}/${date}.jsonl`;
        try {
            const exists = await this.fs.exists(logPath);
            if (!exists) return null;
            return await this.fs.read(logPath);
        } catch {
            return null;
        }
    }

    /**
     * Delete all log files.
     */
    async clearLogs(): Promise<void> {
        const dates = await this.getLogDates();
        for (const date of dates) {
            try {
                await this.fs.remove(`${this.logDir}/${date}.jsonl`);
            } catch {
                // Ignore individual delete failures
            }
        }
    }

    // -------------------------------------------------------------------------

    private getToday(): string {
        const now = new Date();
        return now.toISOString().slice(0, 10); // YYYY-MM-DD
    }

    private async rotateLogs(): Promise<void> {
        const dates = await this.getLogDates();
        if (dates.length <= this.MAX_LOG_DAYS) return;

        // Delete oldest files beyond retention limit
        const toDelete = dates.slice(this.MAX_LOG_DAYS);
        for (const date of toDelete) {
            try {
                await this.fs.remove(`${this.logDir}/${date}.jsonl`);
                console.log(`[OperationLogger] Rotated old log: ${date}`);
            } catch {
                // Ignore
            }
        }
    }
}
