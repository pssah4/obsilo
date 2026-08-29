/**
 * Real executor for background research tasks (IMP-41-03-05).
 *
 * Builds a headless AgentTaskRunner constrained by the research subagent
 * profile (read-only tool surface, no further subagents) on the helper
 * model when one is configured. The collected report is saved as a NEW
 * conversation in the history and announced with a Notice — the
 * foreground chat stays untouched.
 */

import { Notice } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { AgentTaskRunner } from '../agent/AgentTaskRunner';
import { getSubagentProfile } from '../agent/subagent-profiles';
import { getHelperApi } from '../helper-api';
import type { MessageParam } from '../../api/types';
import type { BackgroundTaskExecutor } from './BackgroundTaskRunner';
import { TaskMonitor } from '../../ui/sidebar/TaskMonitor';
import { getModelKey } from '../../types/settings';
import { t } from '../../i18n';

const BACKGROUND_MAX_ITERATIONS = 15;

/** First chars of the request, for the telemetry row. Same cap the sidebar uses. */
const PROMPT_PREVIEW_CHARS = 200;

export function createBackgroundTaskExecutor(plugin: ObsidianAgentPlugin): BackgroundTaskExecutor {
    return async ({ taskId, message, abortSignal }) => {
        if (!plugin.apiHandler) {
            new Notice(t('notice.backgroundTask.noModel'));
            return '';
        }
        const profile = getSubagentProfile('research');
        const api = getHelperApi(plugin, plugin.apiHandler);

        const textParts: string[] = [];
        const history: MessageParam[] = [];

        // FIX-24-05-09 (D10): a background task runs up to 15 iterations of the
        // real loop and used to report none of it. No footer element is passed:
        // this surface is headless, so the monitor's job here is the priced
        // [Cost] console line plus the tasks.jsonl and requests.jsonl records.
        const monitor = new TaskMonitor({
            plugin,
            app: plugin.app,
            apiHandler: api,
            getEffectiveModelKey: () => {
                const model = plugin.getHelperModel?.() ?? plugin.getActiveModel?.() ?? null;
                return model ? getModelKey(model) : '';
            },
            promptPreview: message.slice(0, PROMPT_PREVIEW_CHARS),
            mode: 'background',
        });

        const runner = new AgentTaskRunner({
            api,
            toolRegistry: plugin.toolRegistry,
            // No modeService: AgentTask falls back to BUILT_IN_MODES for the
            // 'agent' slug; the research profile overrides role + tools anyway.
            maxIterations: BACKGROUND_MAX_ITERATIONS,
            // depth 1: the background task cannot fork further subtasks or
            // background tasks — combined with the read-only profile below.
            depth: 1,
            callbacks: {
                onText: (text) => { textParts.push(text); },
                onThinking: () => { /* headless */ },
                onToolStart: () => { /* headless */ },
                onToolResult: () => { /* headless */ },
                onComplete: () => { /* resolved below */ },
                onError: (err) => {
                    textParts.push(`\n\n[Background task error] ${err.message}`);
                },
                // FIX-24-05-09 (D10): the three reporting hooks. Same monitor
                // methods the sidebar uses, so a background run is priced and
                // persisted by exactly the same code as a foreground one.
                onUsage: (i, o, cr, cc, modelId, routingMode, usageByModel, longContextIds) => {
                    monitor.onUsage(i, o, cr, cc, modelId, routingMode, usageByModel, longContextIds);
                },
                onTaskTelemetry: (data) => { monitor.onTaskTelemetry(data); },
                onRequestTelemetry: (data) => { monitor.onRequestTelemetry(data); },
                onCondenseTelemetry: (event) => { monitor.onCondenseTelemetry(event); },
            },
        });

        await runner.execute({
            userMessage: message,
            taskId,
            initialMode: 'agent',
            history,
            abortSignal,
            subagentRoleOverride: profile?.roleDefinition,
            subagentAllowedTools: profile?.allowedTools,
            configDir: plugin.app.vault.configDir,
        });

        const report = textParts.join('').trim();
        const aborted = abortSignal.aborted;

        // Persist the report as its own conversation so it shows up in the
        // history panel; skip when aborted or empty.
        if (report && !aborted && plugin.conversationStore) {
            try {
                const id = await plugin.conversationStore.create('agent', api.getModel().id);
                await plugin.conversationStore.save(id, history, [
                    { role: 'user', text: t('ui.backgroundTask.historyUserMessage', { message }), ts: new Date().toISOString() },
                    { role: 'assistant', text: report, ts: new Date().toISOString() },
                ]);
                plugin.app.workspace.containerEl.dispatchEvent(
                    new CustomEvent('vault-operator:conversation-list-changed'),
                );
            } catch (e) {
                console.warn('[BackgroundTask] saving report failed (non-fatal):', e);
            }
        }

        new Notice(aborted
            ? t('notice.backgroundTask.stopped')
            : report
                ? t('notice.backgroundTask.finished')
                : t('notice.backgroundTask.noReport'));
        return report;
    };
}
