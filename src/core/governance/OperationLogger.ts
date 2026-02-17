/**
 * OperationLogger - Persistent JSONL audit trail (Sprint 1.7)
 *
 * Logs every tool execution to daily JSONL files.
 * Format: one JSON object per line, one file per day.
 * Rotation: keeps last 30 days, deletes older files.
 *
 * Storage: .obsidian/plugins/obsidian-agent/logs/YYYY-MM-DD.jsonl
 */

import type { Vault } from 'obsidian';

export interface LogEntry {
    timestamp: string;
    taskId: string;
    mode: string;
    tool: string;
    params: Record<string, any>;
    success: boolean;
    durationMs: number;
    error?: string;
}

export class OperationLogger {
    private vault: Vault;
    private logDir: string;
    private readonly MAX_LOG_DAYS = 30;
    private currentLogPath: string | null = null;

    constructor(vault: Vault, pluginDir: string) {
        this.vault = vault;
        this.logDir = `${pluginDir}/logs`;
    }

    /**
     * Initialize the log directory (create if needed).
     */
    async initialize(): Promise<void> {
        try {
            const exists = await this.vault.adapter.exists(this.logDir);
            if (!exists) {
                await this.vault.adapter.mkdir(this.logDir);
            }
        } catch (e) {
            console.warn('[OperationLogger] Failed to create log directory:', e);
        }
    }

    /**
     * Log a tool operation.
     */
    async log(entry: LogEntry): Promise<void> {
        try {
            const today = this.getToday();
            const logPath = `${this.logDir}/${today}.jsonl`;
            const line = JSON.stringify(entry) + '\n';

            const exists = await this.vault.adapter.exists(logPath);
            if (exists) {
                // Append to existing file
                const current = await this.vault.adapter.read(logPath);
                await this.vault.adapter.write(logPath, current + line);
            } else {
                await this.vault.adapter.write(logPath, line);
                // New day file created — rotate old logs
                this.rotateLogs().catch((e) =>
                    console.warn('[OperationLogger] Rotation error:', e)
                );
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
            const exists = await this.vault.adapter.exists(logPath);
            if (!exists) return [];
            const content = await this.vault.adapter.read(logPath);
            return content
                .split('\n')
                .filter((line) => line.trim().length > 0)
                .map((line) => JSON.parse(line) as LogEntry);
        } catch {
            return [];
        }
    }

    /**
     * Get available log dates (newest first).
     */
    async getLogDates(): Promise<string[]> {
        try {
            const listed = await this.vault.adapter.list(this.logDir);
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
     * Delete all log files.
     */
    async clearLogs(): Promise<void> {
        const dates = await this.getLogDates();
        for (const date of dates) {
            try {
                await this.vault.adapter.remove(`${this.logDir}/${date}.jsonl`);
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
                await this.vault.adapter.remove(`${this.logDir}/${date}.jsonl`);
                console.log(`[OperationLogger] Rotated old log: ${date}`);
            } catch {
                // Ignore
            }
        }
    }
}
