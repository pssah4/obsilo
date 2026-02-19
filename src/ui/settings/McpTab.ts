import { App, Modal, Notice, Setting, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { ContentEditorModal } from './ContentEditorModal';
import type { McpServerConfig } from '../../types/settings';

export class McpTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    build(containerEl: HTMLElement): void {
        containerEl.createEl('p', {
            cls: 'agent-settings-desc',
            text: 'Connect external tools and data sources via the Model Context Protocol (MCP). ' +
                  'Each server exposes tools the agent can call using use_mcp_tool.',
        });

        const mcpClient = this.plugin.mcpClient;

        // ── Add server button ──────────────────────────────────────────────────
        const addBtn = containerEl.createEl('button', { text: 'Add Server', cls: 'mod-cta agent-mcp-add-btn' });

        // ── Server list ────────────────────────────────────────────────────────
        const listEl = containerEl.createDiv({ cls: 'agent-mcp-list' });

        const renderList = () => {
            listEl.empty();
            const servers = this.plugin.settings.mcpServers ?? {};
            const names = Object.keys(servers);
            if (names.length === 0) {
                listEl.createEl('p', {
                    cls: 'agent-settings-desc',
                    text: 'No MCP servers configured. Click "Add Server" to get started.',
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
                        text: `${toolCount} tool${toolCount !== 1 ? 's' : ''}`,
                    });
                }

                // Actions
                const actions = row.createDiv({ cls: 'agent-rules-actions' });

                if (status === 'connected') {
                    const disconnBtn = actions.createEl('button', { text: 'Disconnect' });
                    disconnBtn.addEventListener('click', async () => {
                        await mcpClient?.disconnect(name);
                        renderList();
                    });
                } else if (status !== 'connecting') {
                    const connBtn = actions.createEl('button', { text: status === 'error' ? 'Retry' : 'Connect' });
                    connBtn.addEventListener('click', async () => {
                        if (mcpClient) {
                            await mcpClient.connect(name, config);
                            renderList();
                        }
                    });
                }

                const editBtn = actions.createEl('button', { cls: 'agent-rules-edit-btn' });
                setIcon(editBtn, 'pencil');
                editBtn.setAttribute('aria-label', 'Edit');
                editBtn.addEventListener('click', () => openAddModal(name, config));

                const delBtn = actions.createEl('button', { cls: 'agent-rules-delete-btn' });
                setIcon(delBtn, 'trash-2');
                delBtn.setAttribute('aria-label', 'Delete');
                delBtn.addEventListener('click', async () => {
                    if (mcpClient) await mcpClient.disconnect(name);
                    delete this.plugin.settings.mcpServers[name];
                    await this.plugin.saveSettings();
                    renderList();
                });
            }
        };

        // ── Add/Edit modal ─────────────────────────────────────────────────────
        const openAddModal = (editName?: string, editConfig?: import('../../types/settings').McpServerConfig) => {
            const modal = new Modal(this.app);
            modal.titleEl.setText(editName ? `Edit Server: ${editName}` : 'Add MCP Server');

            const { contentEl } = modal;

            const nameInput = contentEl.createEl('input', {
                type: 'text', placeholder: 'Server name (e.g. "filesystem")',
                cls: 'agent-mcp-modal-input',
            }) as HTMLInputElement;
            nameInput.value = editName ?? '';
            if (editName) nameInput.disabled = true;

            const typeSelect = contentEl.createEl('select', { cls: 'agent-mcp-modal-input' }) as HTMLSelectElement;
            for (const opt of ['stdio', 'sse', 'streamable-http']) {
                const o = typeSelect.createEl('option', { text: opt, value: opt });
                if (opt === (editConfig?.type ?? 'stdio')) o.selected = true;
            }

            // stdio fields
            const stdioSection = contentEl.createDiv({ cls: 'agent-mcp-section' });
            stdioSection.createEl('label', { text: 'Command' });
            const cmdInput = stdioSection.createEl('input', {
                type: 'text', placeholder: 'e.g. npx',
                cls: 'agent-mcp-modal-input',
            }) as HTMLInputElement;
            cmdInput.value = editConfig?.command ?? '';

            stdioSection.createEl('label', { text: 'Args (space-separated)' });
            const argsInput = stdioSection.createEl('input', {
                type: 'text', placeholder: 'e.g. -y @modelcontextprotocol/server-filesystem /path',
                cls: 'agent-mcp-modal-input',
            }) as HTMLInputElement;
            argsInput.value = (editConfig?.args ?? []).join(' ');

            stdioSection.createEl('label', { text: 'Env (KEY=VALUE, one per line)' });
            const envInput = stdioSection.createEl('textarea', { cls: 'agent-mcp-modal-input' }) as HTMLTextAreaElement;
            envInput.rows = 3;
            envInput.value = Object.entries(editConfig?.env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n');

            // URL fields (sse / streamable-http)
            const urlSection = contentEl.createDiv({ cls: 'agent-mcp-section' });
            urlSection.createEl('label', { text: 'URL' });
            const urlInput = urlSection.createEl('input', {
                type: 'text', placeholder: 'e.g. http://localhost:3000/sse',
                cls: 'agent-mcp-modal-input',
            }) as HTMLInputElement;
            urlInput.value = editConfig?.url ?? '';

            urlSection.createEl('label', { text: 'Headers (KEY=VALUE, one per line)' });
            const headersInput = urlSection.createEl('textarea', { cls: 'agent-mcp-modal-input' }) as HTMLTextAreaElement;
            headersInput.rows = 3;
            headersInput.value = Object.entries(editConfig?.headers ?? {}).map(([k, v]) => `${k}=${v}`).join('\n');

            const updateSections = () => {
                const isStdio = typeSelect.value === 'stdio';
                stdioSection.style.display = isStdio ? '' : 'none';
                urlSection.style.display = isStdio ? 'none' : '';
            };
            updateSections();
            typeSelect.addEventListener('change', updateSections);

            contentEl.createEl('label', { text: 'Timeout (seconds)' });
            const timeoutInput = contentEl.createEl('input', {
                type: 'number', placeholder: '60',
                cls: 'agent-mcp-modal-input',
            }) as HTMLInputElement;
            timeoutInput.value = String(editConfig?.timeout ?? 60);

            // Save button
            const saveBtn = contentEl.createEl('button', { text: 'Save & Connect', cls: 'mod-cta agent-mcp-modal-save' });
            saveBtn.addEventListener('click', async () => {
                const serverName = (editName ?? nameInput.value.trim());
                if (!serverName) return;

                const type = typeSelect.value as 'stdio' | 'sse' | 'streamable-http';
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
                    ...(type === 'stdio' ? {
                        command: cmdInput.value.trim(),
                        args: argsInput.value.trim() ? argsInput.value.trim().split(/\s+/) : [],
                        env: parseKV(envInput.value),
                    } : {
                        url: urlInput.value.trim(),
                        headers: parseKV(headersInput.value),
                    }),
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
            });

            modal.open();
        };

        addBtn.addEventListener('click', () => openAddModal());
        renderList();
    }

    // ---------------------------------------------------------------------------
    // Permissions tab — Auto-Approve
    // ---------------------------------------------------------------------------

}
