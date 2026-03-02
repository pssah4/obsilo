import { Notice } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import type { OperationLogger, LogEntry } from '../../core/governance/OperationLogger';
import { t } from '../../i18n';


export class LogTab {
    constructor(private plugin: ObsidianAgentPlugin, private _app: unknown, private rerender: () => void) {}

    build(containerEl: HTMLElement): void {
        containerEl.createEl('p', {
            cls: 'agent-settings-desc',
            text: t('settings.log.desc'),
        });

        const logControls = containerEl.createDiv({ cls: 'agent-log-controls' });
        const dateSelect = logControls.createEl('select', { cls: 'agent-log-date-select dropdown' });
        const loadLogBtn = logControls.createEl('button', { text: t('settings.log.load'), cls: 'mod-cta agent-log-load-btn' });
        const downloadBtn = logControls.createEl('button', { text: t('settings.log.download'), cls: 'agent-log-download-btn' });
        const clearLogBtn = logControls.createEl('button', { text: t('settings.log.clearAll'), cls: 'agent-log-clear-btn' });
        const logTableWrap = containerEl.createDiv({ cls: 'agent-log-table-wrap' });

        downloadBtn.disabled = true;

        const logger: OperationLogger | undefined = this.plugin.operationLogger;
        if (logger) {
            void logger.getLogDates().then((dates: string[]) => {
                if (dates.length === 0) {
                    const opt = dateSelect.createEl('option');
                    opt.value = '';
                    opt.text = t('settings.log.noLogs');
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
            opt.text = t('settings.log.loggerNotAvailable');
            loadLogBtn.disabled = true;
        }

        loadLogBtn.addEventListener('click', () => { void (async () => {
            const date = dateSelect.value;
            if (!date || !logger) return;
            logTableWrap.empty();
            const entries = await logger.readLog(date);
            if (entries.length === 0) {
                logTableWrap.createEl('p', { cls: 'agent-settings-desc', text: t('settings.log.noEntries') });
                downloadBtn.disabled = true;
                return;
            }
            downloadBtn.disabled = false;
            this.renderLogTable(logTableWrap, entries);
        })(); });

        downloadBtn.addEventListener('click', () => { void (async () => {
            const date = dateSelect.value;
            if (!date || !logger) return;
            const raw = await logger.readRawLog(date);
            if (!raw) {
                new Notice(t('settings.log.noData'));
                return;
            }
            const blob = new Blob([raw], { type: 'application/jsonl' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `obsilo-log-${date}.jsonl`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            new Notice(t('settings.log.downloaded', { date }));
        })(); });

        clearLogBtn.addEventListener('click', () => { void (async () => {
            if (!logger) return;
            await logger.clearLogs();
            logTableWrap.empty();
            dateSelect.empty();
            const opt = dateSelect.createEl('option');
            opt.value = '';
            opt.text = t('settings.log.noLogs');
            loadLogBtn.disabled = true;
            downloadBtn.disabled = true;
            new Notice(t('settings.log.cleared'));
        })(); });
    }

    private renderLogTable(container: HTMLElement, entries: LogEntry[]): void {
        const table = container.createEl('table', { cls: 'agent-log-table' });
        const thead = table.createEl('thead');
        const hr = thead.createEl('tr');
        [t('settings.log.headerTime'), t('settings.log.headerTool'), t('settings.log.headerMode'), t('settings.log.headerDuration'), t('settings.log.headerStatus')].forEach((h) => hr.createEl('th', { text: h }));

        const tbody = table.createEl('tbody');
        for (const e of entries) {
            const hasDetails = (e.params && Object.keys(e.params).length > 0)
                || e.result
                || e.error;

            // Main row
            const tr = tbody.createEl('tr', { cls: hasDetails ? 'agent-log-row-expandable' : '' });
            tr.createEl('td', {
                text: new Date(e.timestamp).toLocaleTimeString([], {
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                }),
            });
            tr.createEl('td', { text: e.tool });
            tr.createEl('td', { text: e.mode });
            tr.createEl('td', { text: t('settings.log.durationMs', { ms: e.durationMs }) });
            const statusTd = tr.createEl('td');
            statusTd.createSpan({
                cls: e.success ? 'agent-log-success' : 'agent-log-error',
                text: e.success ? t('settings.log.statusOk') : t('settings.log.statusError'),
            });
            if (!e.success && e.error) {
                statusTd.createEl('span', {
                    cls: 'agent-log-error-msg',
                    text: ` -- ${this.truncate(e.error, 80)}`,
                });
            }

            // Detail row (hidden by default)
            if (hasDetails) {
                const detailRow = tbody.createEl('tr', { cls: 'agent-log-detail-row agent-log-hidden' });
                const detailTd = detailRow.createEl('td');
                detailTd.setAttribute('colspan', '5');

                // Params
                if (e.params && Object.keys(e.params).length > 0) {
                    detailTd.createEl('div', { cls: 'agent-log-detail-label', text: t('settings.log.detailParams') });
                    const paramsPre = detailTd.createEl('pre', { cls: 'agent-log-detail-content' });
                    paramsPre.setText(JSON.stringify(e.params, null, 2));
                }

                // Result
                if (e.result) {
                    detailTd.createEl('div', { cls: 'agent-log-detail-label', text: t('settings.log.detailResult') });
                    const resultPre = detailTd.createEl('pre', { cls: 'agent-log-detail-content' });
                    resultPre.setText(e.result);
                }

                // Error details
                if (e.error) {
                    detailTd.createEl('div', { cls: 'agent-log-detail-label', text: t('settings.log.detailError') });
                    const errorPre = detailTd.createEl('pre', { cls: 'agent-log-detail-content agent-log-detail-error' });
                    errorPre.setText(e.error);
                }

                tr.addEventListener('click', () => {
                    detailRow.classList.toggle('agent-log-hidden');
                    tr.classList.toggle('agent-log-row-expanded');
                });
            }
        }
    }

    private truncate(str: string, maxLen: number): string {
        return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
    }
}
