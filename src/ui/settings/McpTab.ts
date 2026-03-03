import { App, Modal, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { t } from '../../i18n';

export class McpTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    private buildIntroSection(containerEl: HTMLElement): void {
        const infoBanner = containerEl.createDiv('agent-settings-info-banner');
        const infoIcon = infoBanner.createSpan({ cls: 'agent-settings-info-icon' });
        setIcon(infoIcon, 'lightbulb');
        const infoText = infoBanner.createDiv({ cls: 'agent-settings-info-text' });
        infoText.createEl('strong', { text: t('settings.mcp.introTitle') });
        infoText.createDiv({ text: t('settings.mcp.introDesc') });
    }

    build(containerEl: HTMLElement): void {
        this.buildIntroSection(containerEl);
        containerEl.createEl('p', {
            cls: 'agent-settings-desc',
            text: t('settings.mcp.desc'),
        });

        const mcpClient = this.plugin.mcpClient;

        // ── Add server button ──────────────────────────────────────────────────
        const addBtn = containerEl.createEl('button', { text: t('settings.mcp.addServer'), cls: 'mod-cta agent-mcp-add-btn' });

        // ── Server list ────────────────────────────────────────────────────────
        const listEl = containerEl.createDiv({ cls: 'agent-mcp-list' });

        const renderList = () => {
            listEl.empty();
            const servers = this.plugin.settings.mcpServers ?? {};
            const names = Object.keys(servers);
            if (names.length === 0) {
                listEl.createEl('p', {
                    cls: 'agent-settings-desc',
                    text: t('settings.mcp.empty'),
                });
                return;
            }
            for (const name of names) {
                const config = servers[name];
                const conn = mcpClient?.getConnection(name);
                const status = conn?.status ?? 'disconnected';

                const row = listEl.createDiv({ cls: 'agent-mcp-server-row' });

                // Status dot
                const dot = row.createSpan({ cls: `agent-mcp-status-dot ${status}` });
                dot.setAttribute('title', status === 'error' ? (conn?.error ?? 'error') : status);

                // Name + type
                const info = row.createDiv({ cls: 'agent-mcp-server-info' });
                info.createSpan({ cls: 'agent-mcp-server-name', text: name });
                info.createSpan({ cls: 'agent-mcp-server-type', text: config.type });
                if (status === 'error' && conn?.error) {
                    info.createSpan({ cls: 'agent-mcp-server-error', text: conn.error });
                } else if (status === 'connected') {
                    const toolCount = conn?.tools.length ?? 0;
                    info.createSpan({
                        cls: 'agent-mcp-server-tools',
                        text: t('settings.mcp.toolCount', { count: toolCount }),
                    });
                }

                // Actions
                const actions = row.createDiv({ cls: 'agent-rules-actions' });

                if (status === 'connected') {
                    const disconnBtn = actions.createEl('button', { text: t('settings.mcp.disconnect') });
                    disconnBtn.addEventListener('click', () => { void (async () => {
                        await mcpClient?.disconnect(name);
                        renderList();
                    })(); });
                } else if (status !== 'connecting') {
                    const connBtn = actions.createEl('button', { text: status === 'error' ? t('settings.mcp.retry') : t('settings.mcp.connect') });
                    connBtn.addEventListener('click', () => { void (async () => {
                        if (mcpClient) {
                            await mcpClient.connect(name, config);
                            renderList();
                        }
                    })(); });
                }

                const editBtn = actions.createEl('button', { cls: 'agent-rules-edit-btn' });
                setIcon(editBtn, 'pencil');
                editBtn.setAttribute('aria-label', t('settings.mcp.edit'));
                editBtn.addEventListener('click', () => openAddModal(name, config));

                const delBtn = actions.createEl('button', { cls: 'agent-rules-delete-btn' });
                setIcon(delBtn, 'trash-2');
                delBtn.setAttribute('aria-label', t('settings.mcp.delete'));
                delBtn.addEventListener('click', () => { void (async () => {
                    if (mcpClient) await mcpClient.disconnect(name);
                    delete this.plugin.settings.mcpServers[name];
                    await this.plugin.saveSettings();
                    renderList();
                })(); });
            }
        };

        // ── Add/Edit modal ─────────────────────────────────────────────────────
        const openAddModal = (editName?: string, editConfig?: import('../../types/settings').McpServerConfig) => {
            const modal = new Modal(this.app);
            modal.titleEl.setText(editName ? t('settings.mcp.editServer', { name: editName }) : t('settings.mcp.addServerTitle'));

            const { contentEl } = modal;

            const nameInput = contentEl.createEl('input', {
                type: 'text', placeholder: t('settings.mcp.namePlaceholder'),
                cls: 'agent-mcp-modal-input',
            });
            nameInput.value = editName ?? '';
            if (editName) nameInput.disabled = true;

            const typeSelect = contentEl.createEl('select', { cls: 'agent-mcp-modal-input' });
            for (const opt of ['sse', 'streamable-http']) {
                const o = typeSelect.createEl('option', { text: opt, value: opt });
                if (opt === (editConfig?.type ?? 'sse')) o.selected = true;
            }

            // URL fields (sse / streamable-http)
            contentEl.createEl('label', { text: t('settings.mcp.labelUrl') });
            const urlInput = contentEl.createEl('input', {
                type: 'text', placeholder: t('settings.mcp.urlPlaceholder'),
                cls: 'agent-mcp-modal-input',
            });
            urlInput.value = editConfig?.url ?? '';

            contentEl.createEl('label', { text: t('settings.mcp.labelHeaders') });
            const headersInput = contentEl.createEl('textarea', { cls: 'agent-mcp-modal-input' });
            headersInput.rows = 3;
            headersInput.value = Object.entries(editConfig?.headers ?? {}).map(([k, v]) => `${k}=${v}`).join('\n');

            contentEl.createEl('label', { text: t('settings.mcp.labelTimeout') });
            const timeoutInput = contentEl.createEl('input', {
                type: 'number', placeholder: t('settings.mcp.timeoutPlaceholder'),
                cls: 'agent-mcp-modal-input',
            });
            timeoutInput.value = String(editConfig?.timeout ?? 60);

            // Save button
            const saveBtn = contentEl.createEl('button', { text: t('settings.mcp.saveConnect'), cls: 'mod-cta agent-mcp-modal-save' });
            saveBtn.addEventListener('click', () => { void (async () => {
                const serverName = (editName ?? nameInput.value.trim());
                if (!serverName) return;

                const type = typeSelect.value as 'sse' | 'streamable-http';
                const parseKV = (text: string): Record<string, string> => {
                    const result: Record<string, string> = {};
                    for (const line of text.split('\n')) {
                        const eqIdx = line.indexOf('=');
                        if (eqIdx > 0) result[line.slice(0, eqIdx).trim()] = line.slice(eqIdx + 1).trim();
                    }
                    return result;
                };

                const newConfig: import('../../types/settings').McpServerConfig = {
                    type,
                    url: urlInput.value.trim(),
                    headers: parseKV(headersInput.value),
                    timeout: parseInt(timeoutInput.value) || 60,
                };

                this.plugin.settings.mcpServers ??= {};
                this.plugin.settings.mcpServers[serverName] = newConfig;
                await this.plugin.saveSettings();

                // Reconnect this specific server
                if (mcpClient) {
                    await mcpClient.disconnect(serverName);
                    await mcpClient.connect(serverName, newConfig);
                }

                modal.close();
                renderList();
            })(); });

            modal.open();
        };

        addBtn.addEventListener('click', () => openAddModal());
        renderList();
    }

    // ---------------------------------------------------------------------------
    // Permissions tab — Auto-Approve
    // ---------------------------------------------------------------------------

}
