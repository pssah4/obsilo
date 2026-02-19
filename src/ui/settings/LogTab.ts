import { App, Notice, Setting, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';


export class LogTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    build(containerEl: HTMLElement): void {
        containerEl.createEl('p', {
            cls: 'agent-settings-desc',
            text: 'Audit trail of all tool executions. Logs are stored per day (up to 30 days).',
        });

        const logControls = containerEl.createDiv({ cls: 'agent-log-controls' });
        const dateSelect = logControls.createEl('select', { cls: 'agent-log-date-select dropdown' });
        const loadLogBtn = logControls.createEl('button', { text: 'Load', cls: 'mod-cta agent-log-load-btn' });
        const clearLogBtn = logControls.createEl('button', { text: 'Clear all logs', cls: 'agent-log-clear-btn' });
        const logTableWrap = containerEl.createDiv({ cls: 'agent-log-table-wrap' });

        const logger = (this.plugin as any).operationLogger;
        if (logger) {
            logger.getLogDates().then((dates: string[]) => {
                if (dates.length === 0) {
                    const opt = dateSelect.createEl('option');
                    opt.value = '';
                    opt.text = 'No logs yet';
                    loadLogBtn.disabled = true;
                } else {
                    dates.forEach((d: string) => {
                        const opt = dateSelect.createEl('option');
                        opt.value = d;
                        opt.text = d;
                    });
                }
            });
        } else {
            const opt = dateSelect.createEl('option');
            opt.value = '';
            opt.text = 'Logger not available';
            loadLogBtn.disabled = true;
        }

        loadLogBtn.addEventListener('click', async () => {
            const date = dateSelect.value;
            if (!date || !logger) return;
            logTableWrap.empty();
            const entries = await logger.readLog(date);
            if (entries.length === 0) {
                logTableWrap.createEl('p', { cls: 'agent-settings-desc', text: 'No entries for this date.' });
                return;
            }
            const table = logTableWrap.createEl('table', { cls: 'agent-log-table' });
            const thead = table.createEl('thead');
            const hr = thead.createEl('tr');
            ['Time', 'Tool', 'Mode', 'Duration', 'Status'].forEach((h) => hr.createEl('th', { text: h }));
            const tbody = table.createEl('tbody');
            for (const e of entries) {
                const tr = tbody.createEl('tr');
                tr.createEl('td', { text: new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) });
                tr.createEl('td', { text: e.tool });
                tr.createEl('td', { text: e.mode });
                tr.createEl('td', { text: `${e.durationMs} ms` });
                const statusTd = tr.createEl('td');
                statusTd.createSpan({ cls: e.success ? 'agent-log-success' : 'agent-log-error', text: e.success ? 'ok' : 'error' });
                if (!e.success && e.error) statusTd.createEl('span', { cls: 'agent-log-error-msg', text: ` — ${e.error}` });
            }
        });

        clearLogBtn.addEventListener('click', async () => {
            if (!logger) return;
            await logger.clearLogs();
            logTableWrap.empty();
            dateSelect.empty();
            const opt = dateSelect.createEl('option');
            opt.value = '';
            opt.text = 'No logs yet';
            loadLogBtn.disabled = true;
            new Notice('All operation logs cleared');
        });
    }
}
