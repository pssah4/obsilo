import { ItemView, WorkspaceLeaf, setIcon, Menu, MarkdownRenderer } from 'obsidian';
import type ObsidianAgentPlugin from '../main';
import { AgentTask } from '../core/AgentTask';
import type { MessageParam } from '../api/types';
import { getModelKey } from '../types/settings';

export const VIEW_TYPE_AGENT_SIDEBAR = 'obsidian-agent-sidebar';

/**
 * Agent Sidebar View
 *
 * Matches Kilo Code's UI/UX patterns:
 * - Clean header with title + New Chat button
 * - Scrollable messages area with Markdown rendering
 * - Chat input with integrated toolbar (mode, settings, send/stop)
 * - Persistent conversation history across messages
 * - Cancel running requests
 */
export class AgentSidebarView extends ItemView {
    plugin: ObsidianAgentPlugin;
    private chatContainer: HTMLElement | null = null;
    private inputArea: HTMLElement | null = null;
    private textarea: HTMLTextAreaElement | null = null;
    private modeButton: HTMLElement | null = null;
    private modelButton: HTMLElement | null = null;
    private sendButton: HTMLElement | null = null;
    private stopButton: HTMLElement | null = null;
    private contextBadgeContainer: HTMLElement | null = null;

    // Feature 1: Persistent conversation history (survives across messages)
    private conversationHistory: MessageParam[] = [];

    // Feature 3: AbortController for cancelling in-flight requests
    private currentAbortController: AbortController | null = null;

    // Context: tracks whether user dismissed the auto-injected file for this turn
    private userDismissedContext = false;

    constructor(leaf: WorkspaceLeaf, plugin: ObsidianAgentPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE_AGENT_SIDEBAR;
    }

    getDisplayText(): string {
        return 'Obsidian Agent';
    }

    getIcon(): string {
        return 'obsidian-agent';
    }

    async onOpen(): Promise<void> {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('obsidian-agent-sidebar');

        this.buildHeader(container);
        this.buildChatContainer(container);
        this.buildChatInput(container);

        // Feature 4: Update context badge when user switches files; reset dismiss on new file
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', () => {
                this.userDismissedContext = false;
                this.updateContextBadge();
            })
        );
        this.registerEvent(
            this.app.workspace.on('file-open', () => {
                this.userDismissedContext = false;
                this.updateContextBadge();
            })
        );

        if (this.plugin.settings.showWelcomeMessage) {
            this.showWelcomeMessage();
        }
    }

    async onClose(): Promise<void> {
        this.currentAbortController?.abort();
    }

    private buildHeader(container: HTMLElement): void {
        const header = container.createDiv('agent-header');

        const title = header.createDiv('agent-title');
        title.setText('Obsidian Agent');

        const headerRight = header.createDiv('agent-header-right');

        // Settings button — moved here from toolbar
        const settingsBtn = headerRight.createEl('button', {
            cls: 'header-button',
            attr: { 'aria-label': 'Settings' },
        });
        setIcon(settingsBtn, 'settings');
        settingsBtn.addEventListener('click', () => {
            (this.app as any).setting?.open();
            (this.app as any).setting?.openTabById('obsidian-agent');
        });

        // New Chat button — clears conversation history
        const newChatBtn = headerRight.createEl('button', {
            cls: 'header-button',
            attr: { 'aria-label': 'New chat' },
        });
        setIcon(newChatBtn, 'square-pen');
        newChatBtn.addEventListener('click', () => this.clearConversation());
    }

    private buildChatContainer(container: HTMLElement): void {
        this.chatContainer = container.createDiv('chat-messages');
    }

    private buildChatInput(container: HTMLElement): void {
        this.inputArea = container.createDiv('chat-input-container');
        const inputWrapper = this.inputArea.createDiv('chat-input-wrapper');

        // Context chips at the top of the input wrapper (like Kilo Code)
        this.contextBadgeContainer = inputWrapper.createDiv('chat-context-chips');
        this.updateContextBadge();

        this.textarea = inputWrapper.createEl('textarea', {
            cls: 'chat-textarea',
            attr: { placeholder: 'Type your message here...', rows: '3' },
        });

        this.textarea.addEventListener('input', () => this.autoResizeTextarea());

        this.textarea.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                this.handleSendMessage();
            }
        });

        const toolbar = inputWrapper.createDiv('chat-toolbar');
        const toolbarLeft = toolbar.createDiv('chat-toolbar-left');
        const toolbarRight = toolbar.createDiv('chat-toolbar-right');

        // Mode button (left)
        this.modeButton = toolbarLeft.createEl('button', {
            cls: 'toolbar-button mode-button',
            attr: { 'aria-label': 'Select mode' },
        });
        this.updateModeButton();
        this.modeButton.addEventListener('click', (e) => this.showModeMenu(e));

        // Model button (left, after mode)
        this.modelButton = toolbarLeft.createEl('button', {
            cls: 'toolbar-button model-button',
            attr: { 'aria-label': 'Select model' },
        });
        this.updateModelButton();
        this.modelButton.addEventListener('click', (e) => this.showModelMenu(e));

        // Feature 3: Stop button (hidden by default, shown when task is running)
        this.stopButton = toolbarRight.createEl('button', {
            cls: 'toolbar-button stop-button',
            attr: { 'aria-label': 'Stop' },
        });
        setIcon(this.stopButton.createSpan('toolbar-icon'), 'square');
        this.stopButton.style.display = 'none';
        this.stopButton.addEventListener('click', () => this.handleStop());

        // Send button
        this.sendButton = toolbarRight.createEl('button', {
            cls: 'toolbar-button send-button',
            attr: { 'aria-label': 'Send message' },
        });
        setIcon(this.sendButton.createSpan('toolbar-icon'), 'send');
        this.sendButton.addEventListener('click', () => this.handleSendMessage());
    }

    private updateContextBadge(): void {
        if (!this.contextBadgeContainer) return;
        this.contextBadgeContainer.empty();

        if (!this.plugin.settings.autoAddActiveFileContext) return;

        const activeFile = this.userDismissedContext ? null : this.app.workspace.getActiveFile();
        if (activeFile) {
            const chip = this.contextBadgeContainer.createDiv('chat-context-chip');
            chip.title = activeFile.path;
            setIcon(chip.createSpan('context-chip-icon'), 'file-text');
            chip.createSpan('context-chip-label').setText(activeFile.basename);
            const removeBtn = chip.createSpan('context-chip-remove');
            setIcon(removeBtn, 'x');
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.userDismissedContext = true;
                this.updateContextBadge();
            });
        }
    }

    private updateModelButton(): void {
        if (!this.modelButton) return;
        this.modelButton.empty();
        const activeKey = this.plugin.settings.activeModelKey;
        const activeModel = this.plugin.settings.activeModels.find((m) => getModelKey(m) === activeKey);
        const label = activeModel ? (activeModel.displayName ?? activeModel.name) : 'No model';
        setIcon(this.modelButton.createSpan('toolbar-icon'), 'cpu');
        this.modelButton.createSpan('model-label').setText(label);
        setIcon(this.modelButton.createSpan('mode-chevron'), 'chevron-down');
        // Full name as tooltip for when label is truncated
        (this.modelButton as HTMLButtonElement).title = label;
    }

    private showModelMenu(event: MouseEvent): void {
        const enabled = this.plugin.settings.activeModels.filter((m) => m.enabled);
        const menu = new Menu();

        if (enabled.length === 0) {
            menu.addItem((item) =>
                item.setTitle('No models enabled — open Settings').setIcon('settings').onClick(() => {
                    (this.app as any).setting?.open();
                    (this.app as any).setting?.openTabById('obsidian-agent');
                }),
            );
        } else {
            enabled.forEach((model) => {
                const key = getModelKey(model);
                menu.addItem((item) =>
                    item
                        .setTitle(model.displayName ?? model.name)
                        .setChecked(this.plugin.settings.activeModelKey === key)
                        .onClick(async () => {
                            this.plugin.settings.activeModelKey = key;
                            await this.plugin.saveSettings();
                            this.updateModelButton();
                        }),
                );
            });
        }

        menu.showAtMouseEvent(event);
    }

    private updateModeButton(): void {
        if (!this.modeButton) return;
        this.modeButton.empty();
        const currentMode = this.plugin.settings.currentMode;
        setIcon(this.modeButton.createSpan('toolbar-icon'), this.getModeIcon(currentMode));
        this.modeButton.createSpan('mode-label').setText(this.getModeDisplayName(currentMode));
        setIcon(this.modeButton.createSpan('mode-chevron'), 'chevron-down');
    }

    private showModeMenu(event: MouseEvent): void {
        const menu = new Menu();
        const modes = [
            { id: 'ask', name: 'Ask', icon: 'help-circle' },
            { id: 'writer', name: 'Writer', icon: 'pencil' },
            { id: 'architect', name: 'Architect', icon: 'layout' },
        ];
        modes.forEach((mode) => {
            menu.addItem((item) =>
                item
                    .setTitle(mode.name)
                    .setIcon(mode.icon)
                    .setChecked(this.plugin.settings.currentMode === mode.id)
                    .onClick(() => this.switchMode(mode.id))
            );
        });
        menu.showAtMouseEvent(event);
    }

    private getModeIcon(modeId: string): string {
        return { ask: 'help-circle', writer: 'pencil', architect: 'layout' }[modeId] ?? 'help-circle';
    }

    private getModeDisplayName(modeId: string): string {
        return { ask: 'Ask', writer: 'Writer', architect: 'Architect' }[modeId] ?? 'Ask';
    }

    private autoResizeTextarea(): void {
        if (!this.textarea) return;
        this.textarea.style.height = 'auto';
        this.textarea.style.height = Math.min(this.textarea.scrollHeight, 15 * 24) + 'px';
    }

    private showWelcomeMessage(): void {
        if (!this.chatContainer) return;
        const welcomeMarkdown = `## Welcome to Obsidian Agent

An agentic AI assistant integrated into your vault.

**Capabilities**
- Answer questions about your notes
- Edit and create content
- Organize and structure your vault

**How to use**
Select a mode in the toolbar below and start chatting. The agent can read and write files in your vault.`;

        this.renderMarkdownMessage(welcomeMarkdown, 'assistant');
    }

    /**
     * Feature 1+3: Handle sending a message with persistent history and cancellation
     */
    private async handleSendMessage(): Promise<void> {
        if (!this.textarea) return;

        const text = this.textarea.value.trim();
        if (!text) return;
        if (this.currentAbortController) return; // Already running

        this.addUserMessage(text);
        this.textarea.value = '';
        this.autoResizeTextarea();

        // Feature 4: Inject active file context into the message sent to LLM
        // Only if setting is on and user hasn't dismissed the context for this turn
        const activeFile = (this.plugin.settings.autoAddActiveFileContext && !this.userDismissedContext)
            ? this.app.workspace.getActiveFile()
            : null;
        const messageToSend = activeFile
            ? `${text}\n\n<context>\nActive file in editor: ${activeFile.path}\n</context>`
            : text;

        if (!this.plugin.apiHandler) {
            const activeKey = this.plugin.settings.activeModelKey;
            const activeModel = this.plugin.settings.activeModels.find((m) => getModelKey(m) === activeKey);
            if (!activeKey || !activeModel) {
                this.addAssistantMessage(
                    'No model selected. Click the **model button** in the toolbar below, or go to **Settings → Obsidian Agent** to enable a model.',
                );
            } else if (activeModel.provider === 'ollama') {
                this.addAssistantMessage(
                    `**${activeModel.displayName ?? activeModel.name}** could not start. Make sure Ollama is running (\`ollama serve\`) and the model name is correct. Open **Settings → Obsidian Agent → Configure** to verify.`,
                );
            } else {
                this.addAssistantMessage(
                    `**${activeModel.displayName ?? activeModel.name}** has no API key. Add one in **Settings → Obsidian Agent → Configure**.`,
                );
            }
            return;
        }

        // Feature 3: Create AbortController, show stop button
        this.currentAbortController = new AbortController();
        this.setRunningState(true);

        // Prepare streaming message elements (tools above response text)
        const { messageEl, toolsEl, contentEl, footerEl } = this.createStreamingMessageEl();
        let accumulatedText = '';   // text accumulated during/after tool phase
        let hasTools = false;       // have any tools been called in this task?

        const taskId = `task-${Date.now()}`;
        const mode = this.plugin.settings.currentMode;
        let taskWriteCount = 0;

        const task = new AgentTask(
            this.plugin.apiHandler,
            this.plugin.toolRegistry,
            {
                onText: (chunk) => {
                    if (!hasTools) {
                        // Q&A mode: stream text directly as it arrives
                        accumulatedText += chunk;
                        contentEl.empty();
                        MarkdownRenderer.render(this.app, accumulatedText, contentEl, '', this);
                        this.chatContainer?.scrollTo({ top: this.chatContainer.scrollHeight });
                    } else {
                        // Agentic mode: buffer text, render after complete
                        accumulatedText += chunk;
                    }
                },
                onToolStart: (name, input) => {
                    if (!hasTools) {
                        // First tool call: clear any pre-tool "I'll..." boilerplate text
                        hasTools = true;
                        accumulatedText = '';
                        contentEl.empty();
                    }
                    // Kilo Code-style compact row: icon + label + brief param + time
                    const details = toolsEl.createEl('details', { cls: 'tool-call-details' });
                    const summary = details.createEl('summary', { cls: 'tool-call-summary' });
                    setIcon(summary.createSpan('tool-icon'), this.getToolIcon(name));
                    summary.createSpan('tool-name').setText(this.formatToolLabel(name));
                    const brief = this.getToolBriefParam(input);
                    if (brief) summary.createSpan('tool-brief-param').setText(brief);
                    summary.createSpan('tool-time').setText(
                        new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    );
                    summary.createSpan('tool-status tool-running');

                    const inputEl = details.createDiv('tool-call-input');
                    inputEl.createEl('pre').setText(JSON.stringify(input, null, 2));
                    details.createDiv('tool-call-output');

                    (details as any)._toolName = name;
                    // Track write operations for undo bar
                    const writeOps = ['write_file', 'edit_file', 'append_to_file', 'create_folder', 'delete_file', 'move_file'];
                    if (writeOps.includes(name)) taskWriteCount++;
                    this.chatContainer?.scrollTo({ top: this.chatContainer.scrollHeight });
                },
                onToolResult: (name, content, isError) => {
                    // Update status icon in toolsEl
                    toolsEl.querySelectorAll('.tool-call-details').forEach((el) => {
                        if ((el as any)._toolName !== name) return;
                        const statusEl = el.querySelector('.tool-status');
                        if (statusEl) {
                            statusEl.removeClass('tool-running');
                            statusEl.addClass(isError ? 'tool-error' : 'tool-done');
                            statusEl.setText(isError ? '✗' : '✓');
                        }
                        const outputEl = el.querySelector('.tool-call-output');
                        if (outputEl && content) {
                            const truncated = content.length > 500
                                ? content.slice(0, 500) + '\n…(truncated)'
                                : content;
                            outputEl.createEl('pre').setText(truncated);
                        }
                        // Only auto-open on error so the user sees what went wrong
                        if (isError) (el as HTMLDetailsElement).open = true;
                    });
                },
                // Feature 6: Show token usage in message footer
                onUsage: (inputTokens, outputTokens) => {
                    footerEl.setText(`${inputTokens.toLocaleString()} in · ${outputTokens.toLocaleString()} out`);
                    footerEl.style.display = '';
                },
                onAttemptCompletion: (result) => {
                    this.showCompletionCard(result, messageEl);
                },
                onQuestion: (question, options, resolve) => {
                    this.showQuestionCard(question, options, resolve);
                },
                onApprovalRequired: async (toolName, input) => {
                    return this.showApprovalCard(toolName, input, toolsEl);
                },
                onComplete: () => {
                    // If tools were used, render the buffered response text now (ordered after tools)
                    if (hasTools && accumulatedText) {
                        contentEl.empty();
                        MarkdownRenderer.render(this.app, accumulatedText, contentEl, '', this);
                    }
                    messageEl.removeClass('message-streaming');
                    this.currentAbortController = null;
                    this.setRunningState(false);
                    this.chatContainer?.scrollTo({ top: this.chatContainer.scrollHeight });
                    if (taskWriteCount > 0 && this.plugin.settings.enableCheckpoints) {
                        this.showUndoBar(taskId, taskWriteCount);
                    }
                },
                // Feature 5: Styled error display with friendly messages
                onError: (error) => {
                    contentEl.empty();
                    const errEl = messageEl.createDiv('message-error');
                    setIcon(errEl.createSpan('error-icon'), 'alert-triangle');
                    const errBody = errEl.createDiv('error-body');
                    errBody.createDiv('error-title').setText(this.getErrorTitle(error));
                    errBody.createDiv('error-detail').setText(error.message);
                    messageEl.removeClass('message-streaming');
                    this.currentAbortController = null;
                    this.setRunningState(false);
                },
            }
        );

        // Feature 1: Pass the shared history — it accumulates across messages
        // Feature 4: Pass messageToSend (with active file context) instead of raw text
        await task.run(messageToSend, taskId, mode, this.conversationHistory, this.currentAbortController.signal);
    }

    /**
     * Feature 3: Cancel the running request
     */
    private handleStop(): void {
        this.currentAbortController?.abort();
        this.currentAbortController = null;
        this.setRunningState(false);
    }

    /**
     * Toggle between send and stop button states
     */
    private setRunningState(running: boolean): void {
        if (this.sendButton) this.sendButton.style.display = running ? 'none' : '';
        if (this.stopButton) this.stopButton.style.display = running ? '' : 'none';
        if (this.textarea) this.textarea.disabled = running;
        if (this.modelButton) (this.modelButton as HTMLButtonElement).disabled = running;
    }

    /**
     * Clear conversation history and chat UI (New Chat)
     */
    private clearConversation(): void {
        this.conversationHistory = [];
        this.userDismissedContext = false;
        if (this.chatContainer) {
            this.chatContainer.empty();
        }
        if (this.plugin.settings.showWelcomeMessage) {
            this.showWelcomeMessage();
        }
        this.updateContextBadge();
    }

    /**
     * Create the streaming message container.
     * Structure: toolsEl (tool calls, shown during execution) → contentEl (text response, shown after) → footerEl
     */
    private createStreamingMessageEl(): { messageEl: HTMLElement; toolsEl: HTMLElement; contentEl: HTMLElement; footerEl: HTMLElement } {
        if (!this.chatContainer) throw new Error('Chat container not initialized');
        const messageEl = this.chatContainer.createDiv('message assistant-message message-streaming');
        // Tool calls area (populated by onToolStart, always visible during execution)
        const toolsEl = messageEl.createDiv('message-tools');
        // Text response (populated after tools complete, or streamed directly for Q&A)
        const contentEl = messageEl.createDiv('message-content');
        // Feature 6: Token usage footer (hidden until onUsage fires)
        const footerEl = messageEl.createDiv('message-footer');
        footerEl.style.display = 'none';
        this.chatContainer.scrollTo({ top: this.chatContainer.scrollHeight });
        return { messageEl, toolsEl, contentEl, footerEl };
    }

    /**
     * Feature 5: Map API error to a friendly title
     */
    private getErrorTitle(error: Error): string {
        const msg = error.message.toLowerCase();
        const status = (error as any).status ?? (error as any).statusCode;
        if (status === 401 || msg.includes('api key') || msg.includes('authentication')) {
            return 'Invalid API key — check Settings → Obsidian Agent';
        }
        if (status === 404 || msg.includes('not found')) {
            return 'Model not found — verify the Model ID in Settings → Obsidian Agent';
        }
        if (status === 429 || msg.includes('rate limit')) {
            return 'Rate limit reached — please wait a moment';
        }
        if (status === 529 || msg.includes('overload')) {
            return 'API overloaded — try again shortly';
        }
        if (msg.includes('network') || msg.includes('fetch') || msg.includes('econnrefused')) {
            return 'Network error — check your connection and that Ollama is running';
        }
        return 'Error';
    }

    /**
     * Feature 2: Render markdown into a new assistant message (for static messages)
     */
    private renderMarkdownMessage(markdown: string, role: 'assistant' | 'user'): void {
        if (!this.chatContainer) return;
        const msgEl = this.chatContainer.createDiv(`message ${role}-message`);
        const contentEl = msgEl.createDiv('message-content');
        MarkdownRenderer.render(this.app, markdown, contentEl, '', this);
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }

    private addUserMessage(text: string): void {
        if (!this.chatContainer) return;
        const msgEl = this.chatContainer.createDiv('message user-message');
        msgEl.createDiv('message-content').setText(text);
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }

    private addAssistantMessage(markdown: string): void {
        this.renderMarkdownMessage(markdown, 'assistant');
    }

    private switchMode(modeId: string): void {
        this.plugin.settings.currentMode = modeId;
        this.plugin.saveSettings();
        this.updateModeButton();
    }

    // -------------------------------------------------------------------------
    // Tool display helpers (Kilo Code style)
    // -------------------------------------------------------------------------

    private getToolIcon(toolName: string): string {
        const icons: Record<string, string> = {
            read_file: 'file-text',
            write_file: 'file-edit',
            edit_file: 'pencil',
            append_to_file: 'file-plus',
            list_files: 'list',
            search_files: 'search',
            create_folder: 'folder-plus',
            delete_file: 'trash-2',
            move_file: 'move',
            web_fetch: 'globe',
            web_search: 'search',
            use_mcp_tool: 'plug',
            ask_followup_question: 'help-circle',
            attempt_completion: 'check-circle-2',
            update_todo_list: 'list-checks',
        };
        return icons[toolName] ?? 'terminal';
    }

    private formatToolLabel(toolName: string): string {
        const labels: Record<string, string> = {
            read_file: 'Read file',
            write_file: 'Write file',
            edit_file: 'Edit file',
            append_to_file: 'Append',
            list_files: 'List files',
            search_files: 'Search',
            create_folder: 'Create folder',
            delete_file: 'Delete file',
            move_file: 'Move file',
            web_fetch: 'Fetch URL',
            web_search: 'Web search',
            use_mcp_tool: 'MCP tool',
            ask_followup_question: 'Question',
            attempt_completion: 'Complete',
            update_todo_list: 'Update todos',
        };
        return labels[toolName] ?? toolName;
    }

    private getToolBriefParam(input: Record<string, any>): string {
        return input?.path ?? input?.url ?? input?.query ?? input?.question ?? '';
    }

    // -------------------------------------------------------------------------
    // Completion, Question, Approval cards
    // -------------------------------------------------------------------------

    private showCompletionCard(result: string, messageEl: HTMLElement): void {
        const card = messageEl.createDiv('completion-card');
        const header = card.createDiv('completion-card-header');
        setIcon(header.createSpan('completion-icon'), 'check-circle-2');
        header.createSpan('completion-title').setText('Task complete');
        if (result) {
            const body = card.createDiv('completion-body');
            MarkdownRenderer.render(this.app, result, body, '', this);
        }
        this.chatContainer?.scrollTo({ top: this.chatContainer.scrollHeight });
    }

    private showQuestionCard(
        question: string,
        options: string[] | undefined,
        resolve: (answer: string) => void,
    ): void {
        if (!this.chatContainer) { resolve(''); return; }

        const card = this.chatContainer.createDiv('question-card');
        card.createDiv('question-text').setText(question);
        const cleanup = () => card.remove();

        if (options && options.length > 0) {
            const optionsEl = card.createDiv('question-options');
            options.forEach((opt) => {
                const btn = optionsEl.createEl('button', { cls: 'question-option-btn', text: opt });
                btn.addEventListener('click', () => { cleanup(); resolve(opt); });
            });
        }

        const inputRow = card.createDiv('question-input-row');
        const input = inputRow.createEl('input', {
            cls: 'question-input',
            attr: { type: 'text', placeholder: 'Type your answer…' },
        }) as HTMLInputElement;
        const submitBtn = inputRow.createEl('button', { cls: 'question-submit-btn', text: 'Answer' });
        const submit = () => {
            const val = input.value.trim();
            if (!val) return;
            cleanup();
            resolve(val);
        };
        submitBtn.addEventListener('click', submit);
        input.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Enter') submit(); });
        this.chatContainer.scrollTo({ top: this.chatContainer.scrollHeight });
    }

    private async showApprovalCard(
        toolName: string,
        input: Record<string, any>,
        container?: HTMLElement,
    ): Promise<'auto' | 'approved' | 'rejected'> {
        return new Promise((resolve) => {
            const target = container ?? this.chatContainer;
            if (!target) { resolve('approved'); return; }

            const group = this.getToolGroup(toolName);
            const groupLabels: Record<string, string> = { write: 'write', web: 'web', mcp: 'MCP', read: 'read' };

            // Compact inline row — appears within the tool call area
            const row = target.createDiv('tool-approval-row');
            const iconSpan = row.createSpan('tool-approval-icon');
            setIcon(iconSpan, 'shield-alert');
            row.createSpan('tool-approval-text').setText(
                `${this.formatToolLabel(toolName)} — ${groupLabels[group]} not enabled`
            );

            const actions = row.createDiv('tool-approval-actions');
            const allowBtn = actions.createEl('button', { cls: 'tool-approval-btn approval-allow-once', text: 'Allow once' });
            const enableBtn = actions.createEl('button', { cls: 'tool-approval-btn approval-enable', text: 'Enable in Settings' });
            const denyBtn = actions.createEl('button', { cls: 'tool-approval-btn approval-deny-small', text: '✕' });

            const cleanup = () => row.remove();

            allowBtn.addEventListener('click', () => { cleanup(); resolve('approved'); });
            denyBtn.addEventListener('click', () => { cleanup(); resolve('rejected'); });
            enableBtn.addEventListener('click', async () => {
                this.plugin.settings.autoApproval.enabled = true;
                if (group === 'write') this.plugin.settings.autoApproval.write = true;
                else if (group === 'web') this.plugin.settings.autoApproval.web = true;
                else if (group === 'mcp') this.plugin.settings.autoApproval.mcp = true;
                await this.plugin.saveSettings();
                cleanup();
                resolve('approved');
            });

            this.chatContainer?.scrollTo({ top: this.chatContainer!.scrollHeight });
        });
    }

    private getToolGroup(toolName: string): 'write' | 'web' | 'mcp' | 'read' {
        const webTools = ['web_fetch', 'web_search'];
        const mcpTools = ['use_mcp_tool'];
        const readTools = ['read_file', 'list_files', 'search_files', 'get_frontmatter', 'get_linked_notes', 'get_vault_stats', 'search_by_tag', 'get_daily_note'];
        if (webTools.includes(toolName)) return 'web';
        if (mcpTools.includes(toolName)) return 'mcp';
        if (readTools.includes(toolName)) return 'read';
        return 'write';
    }

    // -------------------------------------------------------------------------
    // Undo bar
    // -------------------------------------------------------------------------

    private showUndoBar(taskId: string, writeCount: number): void {
        if (!this.chatContainer) return;
        const bar = this.chatContainer.createDiv('undo-bar');
        bar.createSpan('undo-label').setText(
            `Agent modified ${writeCount} file${writeCount !== 1 ? 's' : ''}.`
        );
        const undoBtn = bar.createEl('button', { cls: 'undo-btn', text: '↩ Undo all changes' });
        undoBtn.addEventListener('click', async () => {
            (undoBtn as HTMLButtonElement).disabled = true;
            undoBtn.setText('Restoring…');
            try {
                const result = await this.plugin.checkpointService?.restoreLatestForTask(taskId);
                bar.empty();
                if (result && result.restored.length > 0) {
                    bar.createSpan('undo-success').setText(
                        `Restored ${result.restored.length} file${result.restored.length !== 1 ? 's' : ''}.`
                    );
                } else {
                    bar.createSpan('undo-error').setText('No checkpoint found to restore.');
                }
            } catch {
                bar.empty();
                bar.createSpan('undo-error').setText('Restore failed — see console.');
            }
        });
        this.chatContainer.scrollTo({ top: this.chatContainer.scrollHeight });
    }
}
