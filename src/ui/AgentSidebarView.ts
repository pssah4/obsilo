import { ItemView, WorkspaceLeaf, setIcon, Menu } from 'obsidian';
import type ObsidianAgentPlugin from '../main';

export const VIEW_TYPE_AGENT_SIDEBAR = 'obsidian-agent-sidebar';

/**
 * Agent Sidebar View
 *
 * Matches Kilo Code's UI/UX patterns:
 * - Clean header with title
 * - Scrollable messages area
 * - Chat input with integrated toolbar (mode, settings, send)
 */
export class AgentSidebarView extends ItemView {
    plugin: ObsidianAgentPlugin;
    private chatContainer: HTMLElement | null = null;
    private inputArea: HTMLElement | null = null;
    private textarea: HTMLTextAreaElement | null = null;
    private modeButton: HTMLElement | null = null;

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
        return 'bot';
    }

    /**
     * Build the sidebar UI
     */
    async onOpen(): Promise<void> {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('obsidian-agent-sidebar');

        // Build UI components (Kilo Code pattern: header → messages → input)
        this.buildHeader(container);
        this.buildChatContainer(container);
        this.buildChatInput(container);

        // Show welcome message
        if (this.plugin.settings.showWelcomeMessage) {
            this.showWelcomeMessage();
        }
    }

    /**
     * Cleanup
     */
    async onClose(): Promise<void> {
        // Cleanup if needed
    }

    /**
     * Build clean header with title only
     */
    private buildHeader(container: HTMLElement): void {
        const header = container.createDiv('agent-header');

        const title = header.createDiv('agent-title');
        title.setText('Obsidian Agent');

        // Optional: Add metadata/context indicator
        const meta = header.createDiv('agent-meta');
        const currentMode = this.getModeDisplayName(this.plugin.settings.currentMode);
        meta.setText(currentMode);
    }

    /**
     * Build chat messages container
     */
    private buildChatContainer(container: HTMLElement): void {
        this.chatContainer = container.createDiv('chat-messages');
    }

    /**
     * Build chat input with integrated toolbar (Kilo Code pattern)
     */
    private buildChatInput(container: HTMLElement): void {
        this.inputArea = container.createDiv('chat-input-container');

        // Create bordered wrapper (like Kilo Code)
        const inputWrapper = this.inputArea.createDiv('chat-input-wrapper');

        // Textarea
        this.textarea = inputWrapper.createEl('textarea', {
            cls: 'chat-textarea',
            attr: {
                placeholder: 'Type your message here...',
                rows: '3',
            },
        });

        // Auto-resize textarea
        this.textarea.addEventListener('input', () => {
            this.autoResizeTextarea();
        });

        // Send on Enter (like Kilo Code, not Ctrl+Enter)
        this.textarea.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                this.handleSendMessage();
            }
        });

        // Bottom toolbar (like Kilo Code)
        const toolbar = inputWrapper.createDiv('chat-toolbar');

        // Left side: Context indicators (will show active file, etc.)
        const toolbarLeft = toolbar.createDiv('chat-toolbar-left');
        this.buildContextIndicator(toolbarLeft);

        // Right side: Mode, Settings, Send
        const toolbarRight = toolbar.createDiv('chat-toolbar-right');

        // Mode selector button
        this.modeButton = toolbarRight.createEl('button', {
            cls: 'toolbar-button mode-button',
            attr: { 'aria-label': 'Select mode' },
        });
        this.updateModeButton();

        this.modeButton.addEventListener('click', (e) => {
            this.showModeMenu(e);
        });

        // Settings button
        const settingsBtn = toolbarRight.createEl('button', {
            cls: 'toolbar-button',
            attr: { 'aria-label': 'Settings' },
        });
        const settingsIcon = settingsBtn.createSpan('toolbar-icon');
        setIcon(settingsIcon, 'settings');

        settingsBtn.addEventListener('click', () => {
            console.log('Settings clicked');
            // TODO: Open settings modal
        });

        // Send button
        const sendBtn = toolbarRight.createEl('button', {
            cls: 'toolbar-button send-button',
            attr: { 'aria-label': 'Send message' },
        });
        const sendIcon = sendBtn.createSpan('toolbar-icon');
        setIcon(sendIcon, 'send');

        sendBtn.addEventListener('click', () => {
            this.handleSendMessage();
        });
    }

    /**
     * Build context indicator in toolbar (shows active file)
     */
    private buildContextIndicator(container: HTMLElement): void {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) {
            const indicator = container.createDiv('context-badge');

            const iconEl = indicator.createSpan('context-icon');
            setIcon(iconEl, 'file-text');

            const labelEl = indicator.createSpan('context-label');
            labelEl.setText(activeFile.basename);
        }
    }

    /**
     * Update mode button display
     */
    private updateModeButton(): void {
        if (!this.modeButton) return;

        this.modeButton.empty();

        const currentMode = this.plugin.settings.currentMode;
        const modeIcon = this.getModeIcon(currentMode);
        const modeName = this.getModeDisplayName(currentMode);

        const iconEl = this.modeButton.createSpan('toolbar-icon');
        setIcon(iconEl, modeIcon);

        const labelEl = this.modeButton.createSpan('mode-label');
        labelEl.setText(modeName);

        const chevronEl = this.modeButton.createSpan('mode-chevron');
        setIcon(chevronEl, 'chevron-down');
    }

    /**
     * Show mode selection menu
     */
    private showModeMenu(event: MouseEvent): void {
        const menu = new Menu();

        const modes = [
            { id: 'ask', name: 'Ask', icon: 'help-circle', description: 'Read-only queries' },
            { id: 'writer', name: 'Writer', icon: 'pencil', description: 'Edit content' },
            {
                id: 'architect',
                name: 'Architect',
                icon: 'layout',
                description: 'Organize vault',
            },
        ];

        modes.forEach((mode) => {
            menu.addItem((item) => {
                item.setTitle(mode.name)
                    .setIcon(mode.icon)
                    .setChecked(this.plugin.settings.currentMode === mode.id)
                    .onClick(() => {
                        this.switchMode(mode.id);
                    });
            });
        });

        menu.showAtMouseEvent(event);
    }

    /**
     * Get mode icon
     */
    private getModeIcon(modeId: string): string {
        const icons: Record<string, string> = {
            ask: 'help-circle',
            writer: 'pencil',
            architect: 'layout',
        };
        return icons[modeId] || 'help-circle';
    }

    /**
     * Get mode display name
     */
    private getModeDisplayName(modeId: string): string {
        const names: Record<string, string> = {
            ask: 'Ask',
            writer: 'Writer',
            architect: 'Architect',
        };
        return names[modeId] || 'Ask';
    }

    /**
     * Auto-resize textarea based on content
     */
    private autoResizeTextarea(): void {
        if (!this.textarea) return;

        this.textarea.style.height = 'auto';
        const newHeight = Math.min(this.textarea.scrollHeight, 15 * 24); // Max 15 rows (~24px per row)
        this.textarea.style.height = newHeight + 'px';
    }

    /**
     * Show welcome message
     */
    private showWelcomeMessage(): void {
        if (!this.chatContainer) return;

        const welcomeMsg = this.chatContainer.createDiv('message assistant-message');
        const content = welcomeMsg.createDiv('message-content');

        const heading = content.createEl('h3');
        heading.setText('Welcome to Obsidian Agent');

        const intro = content.createEl('p');
        intro.setText('An agentic operating layer for vault operations with approval-based safety.');

        const capabilities = content.createEl('div', { cls: 'message-section' });
        const capHeading = capabilities.createEl('h4');
        capHeading.setText('Capabilities');

        const capList = capabilities.createEl('ul');
        const caps = [
            'Answer questions about your notes',
            'Edit and create content',
            'Organize and structure your vault',
            'Generate Canvas visualizations',
        ];
        caps.forEach((cap) => {
            const li = capList.createEl('li');
            li.setText(cap);
        });

        const safety = content.createEl('div', { cls: 'message-section' });
        const safetyHeading = safety.createEl('h4');
        safetyHeading.setText('Safety Features');

        const safetyList = safety.createEl('ul');
        const safetyFeatures = [
            'All write operations require approval',
            'Automatic checkpoints before changes',
            'Restore to previous states',
        ];
        safetyFeatures.forEach((feature) => {
            const li = safetyList.createEl('li');
            li.setText(feature);
        });

        const cta = content.createEl('p', { cls: 'message-cta' });
        cta.setText('Select a mode in the toolbar below and start chatting.');
    }

    /**
     * Handle sending a message
     */
    private async handleSendMessage(): Promise<void> {
        if (!this.textarea) return;

        const text = this.textarea.value.trim();
        if (!text) return;

        console.log('Sending message:', text);

        // Add user message to chat
        this.addUserMessage(text);

        // Clear input
        this.textarea.value = '';
        this.autoResizeTextarea();

        // TODO: Phase 4 - Start task with AgentProvider
        // await this.plugin.provider.startTask({ task: text });

        // For now, show placeholder
        this.addAssistantMessage(
            'Agent core functionality is not yet implemented. This is the UI shell for Phase 1.'
        );
    }

    /**
     * Add user message to chat
     */
    private addUserMessage(text: string): void {
        if (!this.chatContainer) return;

        const msgEl = this.chatContainer.createDiv('message user-message');
        const content = msgEl.createDiv('message-content');
        content.setText(text);

        // Scroll to bottom
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }

    /**
     * Add assistant message to chat
     */
    private addAssistantMessage(text: string): void {
        if (!this.chatContainer) return;

        const msgEl = this.chatContainer.createDiv('message assistant-message');
        const content = msgEl.createDiv('message-content');
        content.setText(text);

        // Scroll to bottom
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }

    /**
     * Switch to a different mode
     */
    private switchMode(modeId: string): void {
        console.log('Switching to mode:', modeId);

        this.plugin.settings.currentMode = modeId;
        this.plugin.saveSettings();

        // Update UI
        this.updateModeButton();

        // Update header meta
        const meta = this.containerEl.querySelector('.agent-meta');
        if (meta) {
            meta.setText(this.getModeDisplayName(modeId));
        }

        // TODO: Phase 5 - Notify ModeManager of mode change
    }
}
