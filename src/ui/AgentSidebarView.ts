import { ItemView, WorkspaceLeaf, setIcon, Menu, MarkdownRenderer, MarkdownView, Notice, TFile } from 'obsidian';
import type ObsidianAgentPlugin from '../main';
import { AgentTask } from '../core/AgentTask';
import { ModeService } from '../core/modes/ModeService';
import type { MessageParam, ContentBlock, ImageMediaType } from '../api/types';
import { getModelKey, getFirstEnabledModelKey, modelToLLMProvider, BUILT_IN_MODELS } from '../types/settings';
import type { CustomModel, ProviderType } from '../types/settings';
import { buildApiHandler, buildApiHandlerForModel } from '../api/index';
import { resolvePromptContent } from '../core/context/SupportPrompts';
import { ToolPickerPopover } from './sidebar/ToolPickerPopover';
import { TOOL_METADATA } from '../core/tools/toolMetadata';
import { AttachmentHandler } from './sidebar/AttachmentHandler';
import type { AttachmentItem } from './sidebar/AttachmentHandler';
import { AutocompleteHandler } from './sidebar/AutocompleteHandler';
import { VaultFilePicker } from './sidebar/VaultFilePicker';
import { HistoryPanel } from './sidebar/HistoryPanel';
import type { UiMessage } from '../core/history/ConversationStore';
import { MemoryRetriever } from '../core/memory/MemoryRetriever';
import { OnboardingService } from '../core/memory/OnboardingService';
import { t } from '../i18n';

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
    private modeService!: ModeService;
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
    // Chat History: active conversation tracking + UI messages for persistence
    private activeConversationId: string | null = null;
    private uiMessages: UiMessage[] = [];
    private historyPanel: HistoryPanel | null = null;

    // Feature 3: AbortController for cancelling in-flight requests
    private currentAbortController: AbortController | null = null;

    // Context: tracks whether user dismissed the auto-injected file for this turn
    private userDismissedContext = false;
    // Last user message text — used by "Regenerate" action
    private lastUserMessage = '';
    // Last known active MarkdownView — tracked because clicking sidebar loses getActiveViewOfType
    private lastMarkdownView: MarkdownView | null = null;
    // Hidden message flag — when true, skip user bubble rendering but still send to LLM
    private nextMessageHidden = false;
    // Onboarding key-setup state machine (chat-based flow, no LLM needed)
    private onboardingKeyState: 'awaiting_choice' | 'awaiting_key_free' | 'awaiting_provider' | 'awaiting_key_own' | 'testing' | null = null;
    private onboardingSelectedProvider: { label: string; provider: ProviderType; model: string } | null = null;

    // Tool picker (pocket-knife button)
    private toolPickerButton: HTMLElement | null = null;
    // Web search toggle button (globe icon)
    private webToggleButton: HTMLElement | null = null;
    /** Manages tool/skill/workflow picker */
    private toolPicker!: ToolPickerPopover;
    /** Manages pending attachments and chip bar UI */
    private attachments!: AttachmentHandler;
    /** Manages / and @ autocomplete dropdown */
    private autocomplete!: AutocompleteHandler;
    /** Vault file picker popover (@ button) */
    private vaultFilePicker!: VaultFilePicker;

    constructor(leaf: WorkspaceLeaf, plugin: ObsidianAgentPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.modeService = new ModeService(plugin, plugin.toolRegistry);
        this.toolPicker = new ToolPickerPopover(plugin, this.modeService);
        this.vaultFilePicker = new VaultFilePicker(
            this.app,
            async (files) => { for (const f of files) await this.attachments.addVaultFile(f); },
        );
    }

    getViewType(): string {
        return VIEW_TYPE_AGENT_SIDEBAR;
    }

    getDisplayText(): string {
        return t('ui.sidebar.title');
    }

    getIcon(): string {
        return 'obsilo-agent';
    }

    async onOpen(): Promise<void> {
        // Initialize ModeService — loads global modes from ~/.obsidian-agent/modes.json
        await this.modeService.initialize();

        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('obsidian-agent-sidebar');

        this.buildHeader(container);
        this.buildChatContainer(container);
        this.buildChatInput(container);

        // Feature 4: Update context badge when user switches files; reset dismiss on new file
        // Also track last active MarkdownView so "Insert at cursor" works from sidebar
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', (leaf) => {
                this.userDismissedContext = false;
                this.updateContextBadge();
                if (leaf?.view instanceof MarkdownView) {
                    this.lastMarkdownView = leaf.view;
                }
            })
        );
        this.registerEvent(
            this.app.workspace.on('file-open', () => {
                this.userDismissedContext = false;
                this.updateContextBadge();
            })
        );

        this.showWelcomeMessage();
    }

    async onClose(): Promise<void> {
        this.currentAbortController?.abort();
        this.saveCurrentConversation();
        this.enqueueMemoryExtraction();
        this.attachments.clear();
    }

    private buildHeader(container: HTMLElement): void {
        const header = container.createDiv('agent-header');

        const titleRow = header.createDiv('agent-title');
        titleRow.createSpan('agent-title-text').setText(t('ui.sidebar.title'));

        const headerRight = header.createDiv('agent-header-right');

        // Settings button — moved here from toolbar
        const settingsBtn = headerRight.createEl('button', {
            cls: 'header-button',
            attr: { 'aria-label': t('ui.sidebar.settings') },
        });
        setIcon(settingsBtn.createSpan('toolbar-icon'), 'settings');
        settingsBtn.addEventListener('click', () => {
            (this.app as any).setting?.open();
            (this.app as any).setting?.openTabById('obsidian-agent');
        });

        // History button — opens conversation history panel
        const historyBtn = headerRight.createEl('button', {
            cls: 'header-button',
            attr: { 'aria-label': t('ui.sidebar.chatHistory') },
        });
        setIcon(historyBtn.createSpan('toolbar-icon'), 'history');
        historyBtn.addEventListener('click', () => this.historyPanel?.toggle());

        // New Chat button — clears conversation history
        const newChatBtn = headerRight.createEl('button', {
            cls: 'header-button',
            attr: { 'aria-label': t('ui.sidebar.newChat') },
        });
        setIcon(newChatBtn.createSpan('toolbar-icon'), 'plus');
        newChatBtn.addEventListener('click', () => this.clearConversation());
    }

    private buildChatContainer(container: HTMLElement): void {
        // Chat container is wrapped in a relative parent so the history panel can overlay it
        const chatWrapper = container.createDiv('chat-wrapper');
        this.chatContainer = chatWrapper.createDiv('chat-messages');

        // History panel (absolute overlay inside the wrapper)
        const store = this.plugin.conversationStore;
        if (store) {
            this.historyPanel = new HistoryPanel(
                store,
                (id) => this.loadConversation(id),
                (id) => this.deleteConversation(id),
                this.activeConversationId,
            );
            this.historyPanel.mount(chatWrapper);
        }
    }

    private buildChatInput(container: HTMLElement): void {
        this.inputArea = container.createDiv('chat-input-container');
        const inputWrapper = this.inputArea.createDiv('chat-input-wrapper');

        // Context chips at the top of the input wrapper (like Kilo Code)
        this.contextBadgeContainer = inputWrapper.createDiv('chat-context-chips');
        this.updateContextBadge();

        // Attachment chip bar (below context chips, above textarea)
        const chipBar = inputWrapper.createDiv('chat-attachment-chips');
        this.attachments = new AttachmentHandler(this.app.vault, chipBar);

        this.textarea = inputWrapper.createEl('textarea', {
            cls: 'chat-textarea',
            attr: { placeholder: t('ui.sidebar.placeholder'), rows: '3' },
        });

        // Initialize autocomplete handler after textarea is created
        this.autocomplete = new AutocompleteHandler(
            this.plugin,
            this.app,
            () => this.textarea,
            () => this.inputArea,
            (file) => this.attachments.addVaultFile(file),
        );

        this.textarea.addEventListener('input', () => {
            this.autoResizeTextarea();
            this.autocomplete.handleInput();
        });

        this.textarea.addEventListener('keydown', (e: KeyboardEvent) => {
            // Autocomplete navigation takes priority
            if (this.autocomplete.handleKeyDown(e)) return;

            if (e.key === 'Enter') {
                const sendWithEnter = this.plugin.settings.sendWithEnter ?? true;
                if (sendWithEnter && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                    e.preventDefault();
                    this.handleSendMessage();
                } else if (!sendWithEnter && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    this.handleSendMessage();
                }
            }
        });

        // Paste handler — capture images pasted from clipboard (e.g. screenshots)
        this.textarea.addEventListener('paste', (e: ClipboardEvent) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            for (const item of Array.from(items)) {
                if (item.kind === 'file') {
                    e.preventDefault();
                    const file = item.getAsFile();
                    if (file) this.attachments.processFile(file);
                }
            }
        });

        // Drag-and-drop handler on the input wrapper
        inputWrapper.addEventListener('dragover', (e: DragEvent) => {
            e.preventDefault();
            inputWrapper.addClass('drag-over');
        });
        inputWrapper.addEventListener('dragleave', () => inputWrapper.removeClass('drag-over'));
        inputWrapper.addEventListener('drop', (e: DragEvent) => {
            e.preventDefault();
            inputWrapper.removeClass('drag-over');
            const files = e.dataTransfer?.files;
            if (files) {
                for (const file of Array.from(files)) this.attachments.processFile(file);
            }
        });

        const toolbar = inputWrapper.createDiv('chat-toolbar');
        const toolbarLeft = toolbar.createDiv('chat-toolbar-left');
        const toolbarRight = toolbar.createDiv('chat-toolbar-right');

        // Mode button (left)
        this.modeButton = toolbarLeft.createEl('button', {
            cls: 'toolbar-button mode-button',
            attr: { 'aria-label': t('ui.sidebar.selectMode') },
        });
        this.updateModeButton();
        this.modeButton.addEventListener('click', (e) => this.showModeMenu(e));

        // Model button (left, after mode)
        this.modelButton = toolbarLeft.createEl('button', {
            cls: 'toolbar-button model-button',
            attr: { 'aria-label': t('ui.sidebar.selectModel') },
        });
        this.updateModelButton();
        this.modelButton.addEventListener('click', (e) => this.showModelMenu(e));

        // Tool picker button (ghost style) — hidden for Ask mode
        this.toolPickerButton = toolbarLeft.createEl('button', {
            cls: 'toolbar-button toolbar-ghost tool-picker-button',
            attr: { 'aria-label': t('ui.sidebar.selectTools') },
        });
        setIcon(this.toolPickerButton.createSpan('toolbar-icon'), 'pocket-knife');
        this.toolPickerButton.addEventListener('click', (e) => this.toolPicker.show(e, this.toolPickerButton!, this.containerEl as HTMLElement));
        this.updateToolPickerButton();

        // Web search toggle (globe icon) — quick toggle for webTools.enabled
        this.webToggleButton = toolbarLeft.createEl('button', {
            cls: 'toolbar-button toolbar-ghost web-toggle-button',
            attr: { 'aria-label': t('ui.sidebar.toggleWebSearch') },
        });
        setIcon(this.webToggleButton.createSpan('toolbar-icon'), 'globe');
        this.webToggleButton.addEventListener('click', () => this.toggleWebSearch());
        this.updateWebToggleButton();

        // Attach file button (ghost style)
        const attachBtn = toolbarLeft.createEl('button', {
            cls: 'toolbar-button toolbar-ghost attach-button',
            attr: { 'aria-label': t('ui.sidebar.attachFile') },
        });
        setIcon(attachBtn.createSpan('toolbar-icon'), 'paperclip');
        attachBtn.addEventListener('click', () => this.attachments.openFilePicker());

        // Vault file button — inserts @ and triggers autocomplete
        const vaultBtn = toolbarLeft.createEl('button', {
            cls: 'toolbar-button toolbar-ghost vault-attach-button',
            attr: { 'aria-label': t('ui.sidebar.addVaultFile') },
        });
        setIcon(vaultBtn.createSpan('toolbar-icon'), 'at-sign');
        vaultBtn.addEventListener('click', () => {
            this.vaultFilePicker.show(vaultBtn);
        });

        // Ellipsis options menu button
        const ellipsisBtn = toolbarLeft.createEl('button', {
            cls: 'toolbar-button toolbar-ghost ellipsis-button',
            attr: { 'aria-label': t('ui.sidebar.moreOptions') },
        });
        setIcon(ellipsisBtn.createSpan('toolbar-icon'), 'ellipsis');
        ellipsisBtn.addEventListener('click', (e) => this.showOptionsMenu(e));

        // Feature 3: Stop button (hidden by default, shown when task is running)
        this.stopButton = toolbarRight.createEl('button', {
            cls: 'toolbar-button stop-button',
            attr: { 'aria-label': t('ui.sidebar.stop') },
        });
        setIcon(this.stopButton.createSpan('toolbar-icon'), 'square');
        this.stopButton.style.display = 'none';
        this.stopButton.addEventListener('click', () => this.handleStop());

        // Send button
        this.sendButton = toolbarRight.createEl('button', {
            cls: 'toolbar-button send-button',
            attr: { 'aria-label': t('ui.sidebar.send') },
        });
        setIcon(this.sendButton.createSpan('toolbar-icon'), 'send-horizontal');
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

    /** Resolve a model key for a mode, skipping disabled models: mode override → global → first enabled */
    private resolveEnabledModelKey(modeSlug: string): string {
        const models = this.plugin.settings.activeModels;

        // Check mode override — skip if model is disabled
        const modeOverrideKey = this.plugin.settings.modeModelKeys?.[modeSlug];
        if (modeOverrideKey) {
            const m = models.find((m) => getModelKey(m) === modeOverrideKey);
            if (m?.enabled) return modeOverrideKey;
        }

        // Check global default — skip if model is disabled
        const globalKey = this.plugin.settings.activeModelKey;
        if (globalKey) {
            const m = models.find((m) => getModelKey(m) === globalKey);
            if (m?.enabled) return globalKey;
        }

        // Fallback: first enabled model
        return getFirstEnabledModelKey(models);
    }

    /** Returns the effective model key for the current mode (mode override → global fallback) */
    private getEffectiveModelKey(): string {
        return this.resolveEnabledModelKey(this.plugin.settings.currentMode);
    }

    private updateModelButton(): void {
        if (!this.modelButton) return;
        this.modelButton.empty();
        const effectiveKey = this.getEffectiveModelKey();
        const model = this.plugin.settings.activeModels.find((m) => getModelKey(m) === effectiveKey);
        const label = model ? (model.displayName ?? model.name) : t('ui.sidebar.noModel');
        const hasModeOverride = !!this.plugin.settings.modeModelKeys?.[this.plugin.settings.currentMode];
        this.modelButton.createSpan('model-label').setText(label);
        setIcon(this.modelButton.createSpan('mode-chevron'), 'chevron-down');
        (this.modelButton as HTMLButtonElement).title = hasModeOverride
            ? t('ui.sidebar.modeOverride', { label })
            : label;
    }

    private showModelMenu(event: MouseEvent): void {
        const enabled = this.plugin.settings.activeModels.filter((m) => m.enabled);
        const menu = new Menu();
        const modeSlug = this.plugin.settings.currentMode;
        const modeOverrideKey = this.plugin.settings.modeModelKeys?.[modeSlug] ?? '';
        const globalKey = this.plugin.settings.activeModelKey;
        const effectiveKey = modeOverrideKey || globalKey;

        if (enabled.length === 0) {
            menu.addItem((item) =>
                item.setTitle(t('ui.sidebar.noModelsEnabled')).setIcon('settings').onClick(() => {
                    (this.app as any).setting?.open();
                    (this.app as any).setting?.openTabById('obsidian-agent');
                }),
            );
        } else {
            // Option to clear mode override (use global default)
            if (modeOverrideKey) {
                const globalModel = this.plugin.settings.activeModels.find((m) => getModelKey(m) === globalKey);
                const globalLabel = globalModel ? (globalModel.displayName ?? globalModel.name) : t('ui.sidebar.globalDefault');
                menu.addItem((item) =>
                    item
                        .setTitle(t('ui.sidebar.useGlobalDefault', { label: globalLabel }))
                        .setIcon('rotate-ccw')
                        .onClick(async () => {
                            if (this.plugin.settings.modeModelKeys) {
                                delete this.plugin.settings.modeModelKeys[modeSlug];
                            }
                            await this.plugin.saveSettings();
                            this.updateModelButton();
                        }),
                );
                menu.addSeparator();
            }

            enabled.forEach((model) => {
                const key = getModelKey(model);
                menu.addItem((item) =>
                    item
                        .setTitle(model.displayName ?? model.name)
                        .setChecked(effectiveKey === key)
                        .onClick(async () => {
                            // Set as mode-specific override (not global default)
                            if (!this.plugin.settings.modeModelKeys) this.plugin.settings.modeModelKeys = {};
                            this.plugin.settings.modeModelKeys[modeSlug] = key;
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
        this.updateToolPickerButton();
    }

    private updateToolPickerButton(): void {
        if (!this.toolPickerButton) return;
        const isAsk = this.plugin.settings.currentMode === 'ask';
        this.toolPickerButton.style.display = isAsk ? 'none' : '';
        this.updateWebToggleButton();
    }

    private async toggleWebSearch(): Promise<void> {
        const isEnabled = this.plugin.settings.webTools?.enabled ?? false;
        const newState = !isEnabled;
        if (!this.plugin.settings.webTools) {
            this.plugin.settings.webTools = { enabled: false, provider: 'none', braveApiKey: '', tavilyApiKey: '' };
        }
        this.plugin.settings.webTools.enabled = newState;
        await this.plugin.saveSettings();
        this.updateWebToggleButton();

        // Check for missing provider/API key and show notice
        if (newState) {
            const provider = this.plugin.settings.webTools.provider;
            if (!provider || provider === 'none') {
                new Notice(t('notice.webSearchEnabled'));
            }
        }
    }

    private updateWebToggleButton(): void {
        if (!this.webToggleButton) return;
        // Only show when the active mode supports web tools
        const mode = this.modeService.getMode(this.plugin.settings.currentMode);
        const modeHasWeb = mode?.toolGroups?.includes('web') ?? false;
        this.webToggleButton.style.display = modeHasWeb ? '' : 'none';
        // Visual state: active (highlighted) or inactive (ghost)
        const isEnabled = this.plugin.settings.webTools?.enabled ?? false;
        this.webToggleButton.classList.toggle('web-toggle-active', isEnabled);
    }

    private showModeMenu(event: MouseEvent): void {
        const menu = new Menu();
        const modes = this.modeService.getAllModes();
        modes.forEach((mode) => {
            menu.addItem((item) =>
                item
                    .setTitle(mode.name)
                    .setIcon(mode.icon)
                    .setChecked(this.plugin.settings.currentMode === mode.slug)
                    .onClick(() => this.switchMode(mode.slug))
            );
        });
        menu.showAtMouseEvent(event);
    }

    private getModeIcon(modeSlug: string): string {
        return this.modeService.getMode(modeSlug)?.icon ?? 'zap';
    }

    private getModeDisplayName(modeSlug: string): string {
        return this.modeService.getMode(modeSlug)?.name ?? modeSlug;
    }

    // ---------------------------------------------------------------------------

    /**
     * Build the skills section for the system prompt.
     * Combines keyword-matched skills with any forced skills from the tool picker.
     */
    /**
     * Build a compact vault-structure snapshot injected into every user message.
     * Gives the model immediate orientation (top-level folders, note count, recent files)
     * so it doesn't need to call list_files or get_vault_stats just to orient itself.
     * Mirrors the <environment_details> pattern used by Kilo Code and Craft Agents.
     */
    private buildVaultContext(): string {
        try {
            const root = this.app.vault.getRoot();
            const folders: string[] = [];
            const rootFiles: string[] = [];

            for (const child of root.children) {
                if ((child as any).children !== undefined) {
                    // It's a folder — skip hidden/system dirs
                    const name = child.name;
                    if (!name.startsWith('.')) folders.push(name);
                } else {
                    rootFiles.push(child.name);
                }
            }

            const allMd = this.app.vault.getMarkdownFiles();
            const noteCount = allMd.length;

            // 5 most recently modified notes (path only)
            const recent = [...allMd]
                .sort((a, b) => b.stat.mtime - a.stat.mtime)
                .slice(0, 5)
                .map((f) => f.path);

            const lines: string[] = ['<vault_context>'];
            lines.push(`Notes: ${noteCount}`);
            if (folders.length > 0) lines.push(`Top-level folders: ${folders.join(', ')}`);
            if (rootFiles.length > 0) lines.push(`Root files: ${rootFiles.join(', ')}`);
            if (recent.length > 0) lines.push(`Recently modified: ${recent.join(', ')}`);
            lines.push('</vault_context>');
            return lines.join('\n');
        } catch {
            return '';
        }
    }

    private async buildSkillsSection(userMessage: string, allowedSkillNames?: string[]): Promise<string | undefined> {
        const skillsManager = (this.plugin as any).skillsManager;
        if (!skillsManager) return undefined;

        // Build effective toggles: combine manual toggles with per-mode allow-list
        const toggles = { ...(this.plugin.settings.manualSkillToggles ?? {}) };
        if (allowedSkillNames) {
            // If mode has an explicit allow-list, disable any skill not in it
            const allSkills: { path: string; name: string }[] = await skillsManager.discoverSkills();
            const allowedSet = new Set(allowedSkillNames);
            for (const skill of allSkills) {
                if (!allowedSet.has(skill.name)) {
                    toggles[skill.path] = false;
                }
            }
        }

        // For keyword-matched skills, use getRelevantSkills() which inlines full SKILL.md content.
        // This eliminates the read_file round-trip the agent would otherwise need.
        const section = await skillsManager.getRelevantSkills(userMessage, toggles) as string;
        return section || undefined;
    }

    private autoResizeTextarea(): void {
        if (!this.textarea) return;
        this.textarea.style.height = 'auto';
        this.textarea.style.height = Math.min(this.textarea.scrollHeight, 15 * 24) + 'px';
    }

    /**
     * Show the onboarding welcome message (first activation only).
     * Chat-based flow: scripted assistant bubbles + buttons, no LLM needed.
     * User pastes API key in the normal chat textarea.
     */
    private showWelcomeMessage(): void {
        if (!this.chatContainer) return;

        const ob = this.plugin.settings.onboarding;
        if (ob.completed || ob.startedAt || !this.plugin.memoryService) return;

        const welcomeText = [
            `## ${t('onboarding.welcome.heading')}`,
            '',
            t('onboarding.welcome.modelNeeded'),
            t('onboarding.welcome.quickFree'),
        ].join('\n');

        const wrapper = this.chatContainer.createDiv('message assistant-message');
        const bubble = wrapper.createDiv('message-bubble');
        MarkdownRenderer.render(this.app, welcomeText, bubble, '', this);

        const btnRow = bubble.createDiv('setup-welcome-buttons');

        const freeBtn = btnRow.createEl('button', {
            cls: 'setup-welcome-btn setup-welcome-btn-primary',
            text: t('onboarding.welcome.freeButton'),
        });
        freeBtn.addEventListener('click', () => {
            this.disableOnboardingButtons(btnRow);
            this.showFreeKeyInstructions();
        });

        const ownBtn = btnRow.createEl('button', {
            cls: 'setup-welcome-btn setup-welcome-btn-secondary',
            text: t('onboarding.welcome.apiKeyButton'),
        });
        ownBtn.addEventListener('click', () => {
            this.disableOnboardingButtons(btnRow);
            this.showProviderSelection();
        });

        this.onboardingKeyState = 'awaiting_choice';
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }

    /** Show Google free key instructions as a chat bubble. */
    private showFreeKeyInstructions(): void {
        this.onboardingKeyState = 'awaiting_key_free';
        this.onboardingSelectedProvider = {
            label: 'Google (Gemini)',
            provider: 'custom' as ProviderType,
            model: 'gemini-2.5-flash',
        };

        const markdown = [
            t('onboarding.free.intro'),
            '',
            `**${t('onboarding.free.howTo')}**`,
            '',
            t('onboarding.free.step1'),
            t('onboarding.free.step2'),
            t('onboarding.free.step3'),
            t('onboarding.free.step4'),
            t('onboarding.free.step5'),
            '',
            `> ${t('onboarding.free.noCreditCard')}`,
            '',
            t('onboarding.free.pasteKey'),
        ].join('\n');

        this.addAssistantMessage(markdown);
    }

    /** Show provider selection buttons as a chat bubble. */
    private showProviderSelection(): void {
        if (!this.chatContainer) return;
        this.onboardingKeyState = 'awaiting_provider';

        const providers: { label: string; provider: ProviderType; model: string }[] = [
            { label: t('onboarding.provider.anthropic'), provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' },
            { label: t('onboarding.provider.openai'), provider: 'openai', model: 'gpt-4o' },
            { label: t('onboarding.provider.google'), provider: 'custom', model: 'gemini-2.5-flash' },
            { label: t('onboarding.provider.openrouter'), provider: 'openrouter', model: 'anthropic/claude-3.5-sonnet' },
        ];

        const wrapper = this.chatContainer.createDiv('message assistant-message');
        const bubble = wrapper.createDiv('message-bubble');
        MarkdownRenderer.render(this.app, t('onboarding.provider.selectPrompt'), bubble, '', this);

        const btnRow = bubble.createDiv('setup-welcome-buttons setup-provider-buttons');
        for (const p of providers) {
            const btn = btnRow.createEl('button', {
                cls: 'setup-welcome-btn setup-welcome-btn-secondary',
                text: p.label,
            });
            btn.addEventListener('click', () => {
                this.disableOnboardingButtons(btnRow);
                this.onboardingSelectedProvider = p;
                this.onboardingKeyState = 'awaiting_key_own';
                this.addAssistantMessage(t('onboarding.provider.pasteKey', { label: p.label }));
            });
        }

        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }

    /**
     * Show a helpful setup message when no model is configured.
     * Offers a free Google key path and a link to model settings.
     * Works regardless of onboarding state.
     */
    private showNoModelSetupMessage(): void {
        if (!this.chatContainer) return;

        const wrapper = this.chatContainer.createDiv('message assistant-message');
        const bubble = wrapper.createDiv('message-bubble');

        const markdown = [
            t('onboarding.noModel.heading'),
            '',
            t('onboarding.noModel.freeOffer'),
            '',
            t('onboarding.noModel.step1'),
            t('onboarding.noModel.step2'),
            t('onboarding.noModel.step3'),
            '',
            t('onboarding.noModel.orSettings'),
        ].join('\n');

        MarkdownRenderer.render(this.app, markdown, bubble, '', this);

        const btnRow = bubble.createDiv('setup-welcome-buttons');

        const freeBtn = btnRow.createEl('button', {
            cls: 'setup-welcome-btn setup-welcome-btn-primary',
            text: t('onboarding.noModel.googleButton'),
        });
        freeBtn.addEventListener('click', () => {
            this.disableOnboardingButtons(btnRow);
            this.onboardingSelectedProvider = {
                label: 'Google (Gemini)',
                provider: 'custom' as ProviderType,
                model: 'gemini-2.5-flash',
            };
            this.onboardingKeyState = 'awaiting_key_free';
            this.addAssistantMessage(t('onboarding.noModel.pasteMessage'));
        });

        const settingsBtn = btnRow.createEl('button', {
            cls: 'setup-welcome-btn setup-welcome-btn-secondary',
            text: t('onboarding.noModel.settingsButton'),
        });
        settingsBtn.addEventListener('click', () => {
            this.disableOnboardingButtons(btnRow);
            (this.app as any).setting?.open?.();
            (this.app as any).setting?.openTabById?.('obsidian-agent');
        });

        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }

    /**
     * Test an API key via chat flow. Returns true on success.
     * Extracted from testAndSaveKey() for the chat-based onboarding.
     */
    private async testAndSaveKeyChat(
        modelName: string,
        provider: ProviderType,
        apiKey: string,
    ): Promise<boolean> {
        const builtIn = BUILT_IN_MODELS.find((m) => m.name === modelName);
        const model: CustomModel = {
            name: modelName,
            provider,
            displayName: builtIn?.displayName ?? modelName,
            apiKey,
            baseUrl: builtIn?.baseUrl ?? (provider === 'custom'
                ? 'https://generativelanguage.googleapis.com/v1beta/openai'
                : undefined),
            enabled: true,
            isBuiltIn: builtIn?.isBuiltIn ?? false,
        };

        try {
            const handler = buildApiHandlerForModel(model);
            const stream = handler.createMessage(
                'Respond with exactly: "OK"',
                [{ role: 'user', content: 'Test' }],
                [],
            );
            let text = '';
            for await (const chunk of stream) {
                if (chunk.type === 'text') text += chunk.text;
            }
            if (!text.trim()) throw new Error('Empty response');

            const key = getModelKey(model);
            const existingIdx = this.plugin.settings.activeModels.findIndex(
                (m) => getModelKey(m) === key,
            );
            if (existingIdx >= 0) {
                this.plugin.settings.activeModels[existingIdx].apiKey = apiKey;
                this.plugin.settings.activeModels[existingIdx].enabled = true;
            } else {
                this.plugin.settings.activeModels.push(model);
            }
            this.plugin.settings.activeModelKey = key;
            await this.plugin.saveSettings();
            this.plugin.initApiHandler();
            return true;
        } catch {
            return false;
        }
    }

    /** Disable all buttons in a row (gray out after choice). */
    private disableOnboardingButtons(row: HTMLElement): void {
        row.querySelectorAll('button').forEach((btn) => {
            (btn as HTMLButtonElement).disabled = true;
            btn.addClass('setup-btn-disabled');
        });
    }

    /**
     * Start the LLM-driven onboarding conversation.
     * Sends a hidden trigger message; the onboarding system prompt guides the LLM.
     * Called from the welcome card, settings buttons, or programmatically.
     */
    startOnboardingChat(): void {
        this.onboardingKeyState = null;
        this.onboardingSelectedProvider = null;
        // Mark as started (prevents re-trigger on reload)
        this.plugin.settings.onboarding.startedAt = new Date().toISOString();
        this.plugin.saveSettings();
        // Clear welcome card, send hidden trigger
        if (this.chatContainer) this.chatContainer.empty();
        this.sendProgrammaticMessage(t('onboarding.trigger'), true);
    }

    /**
     * Programmatically send a message as if the user typed it.
     * Used by Settings buttons (e.g. "Start setup") to trigger agent actions.
     * When hidden=true, the user bubble is not rendered (the agent speaks first).
     */
    sendProgrammaticMessage(text: string, hidden = false): void {
        if (!this.textarea) return;
        this.nextMessageHidden = hidden;
        this.textarea.value = text;
        this.handleSendMessage();
    }

    /**
     * Feature 1+3: Handle sending a message with persistent history and cancellation
     */
    private async handleSendMessage(): Promise<void> {
        if (!this.textarea) return;

        const text = this.textarea.value.trim();
        if (!text && this.attachments.pending.length === 0) return;
        if (this.currentAbortController) return; // Already running

        const isHidden = this.nextMessageHidden;
        this.nextMessageHidden = false;

        // Onboarding key interception: treat input as API key when waiting
        if (this.onboardingKeyState === 'awaiting_key_free' || this.onboardingKeyState === 'awaiting_key_own') {
            const apiKey = text.trim();
            this.textarea.value = '';
            this.autoResizeTextarea();
            if (!apiKey) return;

            // Show masked key as user bubble (don't expose full key in chat)
            const masked = apiKey.length > 8
                ? apiKey.slice(0, 4) + '...' + apiKey.slice(-4)
                : '****';
            this.addUserMessage(masked);
            this.addAssistantMessage(t('onboarding.test.testing'));
            this.onboardingKeyState = 'testing';

            const provider = this.onboardingSelectedProvider!;
            const success = await this.testAndSaveKeyChat(provider.model, provider.provider, apiKey);

            if (success) {
                this.addAssistantMessage(
                    t('onboarding.test.success', { provider: provider.label }),
                );
                this.onboardingKeyState = null;
                this.onboardingSelectedProvider = null;
                this.updateModelButton();
                // Start LLM onboarding if not yet completed, otherwise just let user chat
                if (!this.plugin.settings.onboarding.completed) {
                    setTimeout(() => this.startOnboardingChat(), 800);
                }
            } else {
                this.addAssistantMessage(
                    t('onboarding.test.failed'),
                );
                this.onboardingKeyState = provider.model === 'gemini-2.5-flash' && provider.provider === 'custom'
                    ? 'awaiting_key_free'
                    : 'awaiting_key_own';
            }
            return;
        }

        this.lastUserMessage = text;

        // Create a new conversation on first message (if history enabled)
        if (!this.activeConversationId && this.plugin.conversationStore) {
            const mode = this.modeService.getActiveMode().slug;
            const modelKey = this.resolveEnabledModelKey(mode);
            const model = this.plugin.settings.activeModels.find((m) => getModelKey(m) === modelKey);
            this.activeConversationId = await this.plugin.conversationStore.create(
                mode,
                model?.displayName ?? model?.name ?? modelKey,
            );
        }

        // Track user UI message for history persistence (skip for hidden messages)
        if (!isHidden) {
            this.uiMessages.push({ role: 'user', text, ts: new Date().toISOString() });
        }

        // Snapshot attachments, clear the chip bar, render user bubble with previews
        const attachments = [...this.attachments.pending];
        this.attachments.clear();
        if (!isHidden) {
            const activeFileForBubble = (this.plugin.settings.autoAddActiveFileContext && !this.userDismissedContext)
                ? this.app.workspace.getActiveFile()
                : null;
            this.addUserMessage(text, attachments, activeFileForBubble);
        }
        this.textarea.value = '';
        this.autoResizeTextarea();

        // Feature 4: Inject active file context into the message sent to LLM
        // Only if setting is on and user hasn't dismissed the context for this turn
        const activeFile = (this.plugin.settings.autoAddActiveFileContext && !this.userDismissedContext)
            ? this.app.workspace.getActiveFile()
            : null;
        const vaultCtx = this.buildVaultContext();
        const textWithContext = text
            + (activeFile ? `\n\n<context>\nActive file in editor: ${activeFile.path}\n</context>` : '')
            + (vaultCtx ? `\n\n${vaultCtx}` : '');

        // Build ContentBlock[] when there are attachments, plain string otherwise
        let messageToSend: string | ContentBlock[];
        if (attachments.length > 0) {
            const blocks: ContentBlock[] = [];
            // Images first (Anthropic convention)
            for (const att of attachments) {
                if (att.block.type === 'image') blocks.push(att.block);
            }
            // User text
            blocks.push({ type: 'text', text: textWithContext });
            // Text file blocks after
            for (const att of attachments) {
                if (att.block.type === 'text') blocks.push(att.block);
            }
            messageToSend = blocks;
        } else {
            messageToSend = textWithContext;
        }

        // Process slash commands (Sprint 3.3) — if text starts with /workflow-slug,
        // replace with workflow content as explicit instructions (plain string only;
        // attachment blocks are passed through unchanged).
        if (typeof messageToSend === 'string' && text.startsWith('/')) {
            const workflowLoader = (this.plugin as any).workflowLoader;
            if (workflowLoader) {
                const processedText = await workflowLoader.processSlashCommand(
                    text,
                    this.plugin.settings.workflowToggles ?? {},
                );
                if (processedText !== text) {
                    // Re-add active file context after workflow expansion
                    messageToSend = processedText + (activeFile
                        ? `\n\n<context>\nActive file in editor: ${activeFile.path}\n</context>`
                        : '');
                }
            }
        }

        // Resolve mode-specific model (Sticky Models: each mode remembers its last-used model)
        const currentModeSlug = this.modeService.getActiveMode().slug;
        const modeModelKey = this.resolveEnabledModelKey(currentModeSlug);
        const resolvedModel = this.plugin.settings.activeModels.find((m) => getModelKey(m) === modeModelKey);

        let resolvedApiHandler = this.plugin.apiHandler;
        if (resolvedModel && modeModelKey !== this.plugin.settings.activeModelKey) {
            // Mode has a different model — build a fresh handler for it
            try {
                resolvedApiHandler = buildApiHandler(modelToLLMProvider(resolvedModel));
            } catch {
                resolvedApiHandler = this.plugin.apiHandler;
            }
        }

        if (!resolvedApiHandler) {
            const activeKey = this.plugin.settings.activeModelKey;
            const activeModel = this.plugin.settings.activeModels.find((m) => getModelKey(m) === activeKey);

            if (activeModel?.provider === 'ollama') {
                this.addAssistantMessage(
                    t('ui.error.ollamaNotRunning', { model: activeModel.displayName ?? activeModel.name }),
                );
            } else {
                // No model or no API key — show setup guidance
                this.showNoModelSetupMessage();
            }
            return;
        }

        // Feature 3: Create AbortController, show stop button
        this.currentAbortController = new AbortController();
        this.setRunningState(true);

        // Prepare streaming message elements (thinking → tools → response text → footer)
        // `let` so onQuestion can create fresh elements for each onboarding turn.
        let { messageEl, thinkingEl, toolsEl, contentEl, footerEl } = this.createStreamingMessageEl();
        let accumulatedText = '';       // text accumulated during/after tool phase
        let accumulatedThinking = '';   // full thinking text for collapse/expand
        let hasTools = false;           // have any tools been called in this task?
        let isThinking = false;         // thinking is currently active
        let activityActionCount = 0;    // number of completed tool calls (for activity badge)

        // Streaming text container: during Q&A streaming we append raw text chunks
        // directly into this element (O(1) per chunk, zero re-parses).
        // On completion a single MarkdownRenderer.render() replaces it with the
        // formatted result.  This gives instant first-character display and avoids
        // the previous 80 ms delay before the user saw anything.
        let streamingPara: HTMLElement | null = null;

        // rAF-throttled scroll: collapses many per-chunk scrollTo() calls into one
        // paint-cycle scroll, eliminating repeated forced reflows.
        let scrollPending = false;
        const scheduleScroll = () => {
            if (scrollPending) return;
            scrollPending = true;
            requestAnimationFrame(() => { scrollPending = false; this.chatContainer?.scrollTo({ top: this.chatContainer.scrollHeight }); });
        };

        // Map for O(1) tool-element lookup in onToolResult.
        // For groupable tools the values are item divs; for others they are details elements.
        const toolElsByName = new Map<string, HTMLElement[]>();

        // ── Agent steps block ─────────────────────────────────────────────────
        // All tool calls are wrapped in a single collapsible block with a thin
        // left border instead of individual boxes. Collapsed by default; the
        // summary line shows a live-updating action count + final status.
        let stepsBlockEl: HTMLDetailsElement | null = null;
        let stepsBodyEl: HTMLElement | null = null;
        let stepsSummaryIconEl: HTMLElement | null = null;
        let stepsSummaryLabelEl: HTMLElement | null = null;
        let stepsTotal = 0;
        let stepsCompleted = 0;
        let stepsHasError = false;

        const ensureStepsBlock = () => {
            if (stepsBlockEl) return;
            stepsBlockEl = toolsEl.createEl('details', { cls: 'agent-steps-block' });
            const summaryEl = stepsBlockEl.createEl('summary', { cls: 'agent-steps-summary' });
            stepsSummaryIconEl = summaryEl.createSpan('steps-icon');
            setIcon(stepsSummaryIconEl, 'loader');
            stepsSummaryLabelEl = summaryEl.createSpan('steps-label');
            stepsSummaryLabelEl.setText(t('ui.sidebar.working'));
            stepsBodyEl = stepsBlockEl.createDiv('agent-steps-body');
        };

        const updateStepsSummary = (allDone: boolean) => {
            if (!stepsSummaryLabelEl || !stepsSummaryIconEl) return;
            const n = stepsTotal;
            const label = n === 1 ? t('ui.sidebar.actionSingular') : t('ui.sidebar.actionPlural', { count: n });
            if (allDone) {
                stepsSummaryLabelEl.setText(label);
                setIcon(stepsSummaryIconEl, stepsHasError ? 'x' : 'check');
                stepsSummaryIconEl.removeClass('steps-icon-spinning');
            } else {
                stepsSummaryLabelEl.setText(label);
            }
        };

        // Tools that are safe to group visually — consecutive same-type calls collapse into one row.
        // Write tools are intentionally excluded so each destructive action stays visible individually.
        const GROUPABLE_TOOLS = new Set([
            'read_file', 'list_files', 'search_files', 'get_frontmatter',
            'get_linked_notes', 'search_by_tag', 'get_vault_stats', 'get_daily_note',
            'web_fetch', 'web_search', 'semantic_search',
        ]);

        // Active tool group — tracks the open <details> container for consecutive same-type tools.
        let activeToolGroup: {
            name: string;
            detailsEl: HTMLDetailsElement;
            nameEl: HTMLElement;
            statusEl: HTMLElement;
            bodyEl: HTMLElement;
            count: number;
        } | null = null;
        // Remove the "Working…" loading indicator and any "Analyzing…" row on first real content
        let loadingRemoved = false;
        const removeLoading = () => {
            if (!loadingRemoved) {
                loadingRemoved = true;
                contentEl.querySelector('.message-loading')?.remove();
            }
            // Also remove any "analyzing" row between iterations (lives inside stepsBodyEl)
            (stepsBodyEl ?? toolsEl).querySelector('.tool-computing-row')?.remove();
            if (stepsSummaryLabelEl && stepsTotal > 0) {
                const n = stepsTotal;
                stepsSummaryLabelEl.setText(n === 1 ? t('ui.sidebar.actionSingular') : t('ui.sidebar.actionPlural', { count: n }));
            }
        };

        const taskId = `task-${Date.now()}`;
        let taskWriteCount = 0;
        let hasRenderedCheckpoints = false;
        let lastTodoItems: import('../core/tools/agent/UpdateTodoListTool').TodoItem[] = [];

        const task = new AgentTask(
            resolvedApiHandler,
            this.plugin.toolRegistry,
            {
                onIterationStart: (iteration) => {
                    // Show the steps block immediately so the user can expand it from the start.
                    ensureStepsBlock();
                    if (iteration > 0) {
                        // Between iterations — add "Analyzing…" row inside stepsBodyEl (visible when expanded)
                        // and update the summary label so collapsed users also see the state.
                        (stepsBodyEl ?? toolsEl).querySelector('.tool-computing-row')?.remove();
                        const row = (stepsBodyEl ?? toolsEl).createDiv('tool-computing-row');
                        setIcon(row.createSpan('tool-computing-icon'), 'loader');
                        row.createSpan('tool-computing-text').setText(t('ui.sidebar.analyzing'));
                        if (stepsSummaryLabelEl) stepsSummaryLabelEl.setText(t('ui.sidebar.analyzingShort'));
                        scheduleScroll();
                    }
                },
                onThinking: (chunk) => {
                    removeLoading();
                    accumulatedThinking += chunk;
                    if (!isThinking) {
                        // First thinking chunk — build the collapsible section
                        isThinking = true;
                        thinkingEl.style.display = '';
                        thinkingEl.empty();
                        const header = thinkingEl.createDiv('thinking-header');
                        setIcon(header.createSpan('thinking-spinner'), 'loader');
                        header.createSpan('thinking-label').setText(t('ui.sidebar.reasoning'));
                        thinkingEl.createDiv('thinking-content');
                        header.addEventListener('click', () => {
                            const body = thinkingEl.querySelector('.thinking-content') as HTMLElement;
                            if (body) body.style.display = body.style.display === 'none' ? '' : 'none';
                        });
                    }
                    const body = thinkingEl.querySelector('.thinking-content') as HTMLElement;
                    if (body) body.setText(accumulatedThinking);
                    scheduleScroll();
                },
                onText: (chunk) => {
                    removeLoading();
                    // When text starts after thinking, collapse the thinking section
                    if (isThinking) {
                        isThinking = false;
                        const header = thinkingEl.querySelector('.thinking-header');
                        const spinner = thinkingEl.querySelector('.thinking-spinner');
                        const label = thinkingEl.querySelector('.thinking-label');
                        if (spinner) setIcon(spinner as HTMLElement, 'chevron-right');
                        if (label) (label as HTMLElement).setText(t('ui.sidebar.reasoningCollapsed'));
                        const body = thinkingEl.querySelector('.thinking-content') as HTMLElement;
                        if (body) body.style.display = 'none';
                        if (header) (header as HTMLElement).addEventListener('click', () => {
                            if (body) body.style.display = body.style.display === 'none' ? '' : 'none';
                        }, { once: true });
                    }
                    accumulatedText += chunk;
                    if (!hasTools) {
                        // Q&A streaming: append raw text directly — O(1), no re-parse.
                        // On first chunk, clear the loading state and create the container.
                        // On completion, the container is replaced by a full Markdown render.
                        if (!streamingPara) {
                            contentEl.empty();
                            streamingPara = contentEl.createEl('p', { cls: 'streaming-para' });
                        }
                        streamingPara.insertAdjacentText('beforeend', chunk);
                        scheduleScroll();
                    }
                    // Agentic mode: text is buffered and rendered once in onComplete.
                },
                onToolStart: (name, input) => {
                    removeLoading();
                    if (!hasTools) {
                        hasTools = true;
                        if (name !== 'attempt_completion') {
                            // Hide + clear the streaming UI — text will be re-rendered as
                            // Markdown in onQuestion/onComplete. Hide first to avoid the
                            // flash of raw streaming text disappearing.
                            contentEl.style.visibility = 'hidden';
                            contentEl.empty();
                            streamingPara = null;
                        }
                    }

                    // Ensure the outer steps block exists and track this tool call
                    ensureStepsBlock();
                    stepsTotal++;
                    updateStepsSummary(false);

                    const brief = this.getToolBriefParam(input);
                    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    // Tool calls render into the steps block body, not directly into toolsEl
                    const renderTarget = stepsBodyEl!;

                    if (GROUPABLE_TOOLS.has(name)) {
                        // ── Grouped tool ──────────────────────────────────────────────
                        // Break existing group when a different tool type arrives
                        if (activeToolGroup && activeToolGroup.name !== name) {
                            activeToolGroup = null;
                        }

                        if (!activeToolGroup) {
                            // Create new group container inside the steps block
                            const details = renderTarget.createEl('details', { cls: 'tool-call-details' });
                            const summary = details.createEl('summary', { cls: 'tool-call-summary' });
                            setIcon(summary.createSpan('tool-icon'), this.getToolIcon(name));
                            const nameEl = summary.createSpan('tool-name');
                            nameEl.setText(this.formatGroupedLabel(name, 1));
                            summary.createSpan('tool-time').setText(time);
                            const statusEl = summary.createSpan({ cls: 'tool-status tool-running' });
                            const bodyEl = details.createDiv('tool-group-body');
                            activeToolGroup = { name, detailsEl: details, nameEl, statusEl, bodyEl, count: 1 };
                        } else {
                            // Group already exists — update count and reset status
                            activeToolGroup.count++;
                            activeToolGroup.nameEl.setText(this.formatGroupedLabel(name, activeToolGroup.count));
                            activeToolGroup.statusEl.removeClass('tool-done', 'tool-error');
                            activeToolGroup.statusEl.addClass('tool-running');
                            activeToolGroup.statusEl.setText('');
                        }

                        // Add compact item row to group body
                        const itemEl = activeToolGroup.bodyEl.createDiv('tool-group-item');
                        setIcon(itemEl.createSpan('tool-item-icon'), 'loader');
                        itemEl.createSpan('tool-item-brief').setText(brief || '—');

                        const queue = toolElsByName.get(name) ?? [];
                        queue.push(itemEl);
                        toolElsByName.set(name, queue);

                    } else {
                        // ── Standalone tool ───────────────────────────────────────────
                        // Any non-groupable tool breaks the active group
                        activeToolGroup = null;

                        const details = renderTarget.createEl('details', { cls: 'tool-call-details' });
                        const summary = details.createEl('summary', { cls: 'tool-call-summary' });
                        setIcon(summary.createSpan('tool-icon'), this.getToolIcon(name));
                        summary.createSpan('tool-name').setText(this.formatToolLabel(name));
                        if (brief) summary.createSpan('tool-brief-param').setText(brief);
                        summary.createSpan('tool-time').setText(time);
                        summary.createSpan('tool-status tool-running');

                        if (name !== 'attempt_completion') {
                            const inputEl = details.createDiv('tool-call-input');
                            inputEl.createEl('pre').setText(JSON.stringify(input, null, 2));
                            details.createDiv('tool-call-output');
                            details.open = true;
                        }

                        const pendingEls = toolElsByName.get(name) ?? [];
                        pendingEls.push(details);
                        toolElsByName.set(name, pendingEls);
                    }

                    const writeOps = ['write_file', 'edit_file', 'append_to_file', 'create_folder', 'delete_file', 'move_file'];
                    if (writeOps.includes(name)) taskWriteCount++;
                    scheduleScroll();
                },
                onToolResult: (name, content, isError) => {
                    const queue = toolElsByName.get(name);
                    const el = queue?.shift() ?? null;
                    if (!el) return;

                    if (el.classList.contains('tool-group-item')) {
                        // ── Grouped item result ───────────────────────────────────────
                        const iconEl = el.querySelector('.tool-item-icon') as HTMLElement | null;
                        if (iconEl) {
                            iconEl.empty();
                            setIcon(iconEl, isError ? 'x' : 'check');
                        }
                        el.classList.add(isError ? 'item-error' : 'item-done');

                        // When all items in the group are settled, update the group header
                        const bodyEl = el.parentElement;
                        const detailsEl = bodyEl?.parentElement as HTMLDetailsElement | null;
                        if (bodyEl && detailsEl) {
                            const stillRunning = bodyEl.querySelectorAll(
                                '.tool-group-item:not(.item-done):not(.item-error)'
                            ).length;
                            if (stillRunning === 0) {
                                const groupStatus = detailsEl.querySelector('.tool-status') as HTMLElement | null;
                                if (groupStatus) {
                                    groupStatus.removeClass('tool-running');
                                    const anyError = bodyEl.querySelectorAll('.item-error').length > 0;
                                    groupStatus.addClass(anyError ? 'tool-error' : 'tool-done');
                                    groupStatus.setText(anyError ? '✗' : '✓');
                                }
                                // Keep group open so the user can see which files were processed.
                                // Only collapse on error so the user can inspect failures.
                                if (isError) detailsEl.open = false;
                            }
                        }

                    } else {
                        // ── Standalone tool result ────────────────────────────────────
                        const details = el as HTMLDetailsElement;

                        // Parse and strip <diff_stats added="X" removed="Y"/> tag
                        let displayContent = content;
                        const diffMatch = content.match(/<diff_stats added="(\d+)" removed="(\d+)"\/>/);
                        if (diffMatch && !isError) {
                            const diffAdded = parseInt(diffMatch[1], 10);
                            const diffRemoved = parseInt(diffMatch[2], 10);
                            displayContent = content.replace(/\n?<diff_stats[^/]*\/>/g, '');
                            if (diffAdded > 0 || diffRemoved > 0) {
                                const summary = details.querySelector('summary');
                                if (summary) {
                                    const badge = summary.createSpan('tool-diff-badge');
                                    const parts: string[] = [];
                                    if (diffAdded > 0) parts.push(`+${diffAdded}`);
                                    if (diffRemoved > 0) parts.push(`-${diffRemoved}`);
                                    badge.setText(parts.join(' / '));
                                }
                            }
                        }

                        const statusEl = details.querySelector('.tool-status');
                        if (statusEl) {
                            statusEl.removeClass('tool-running');
                            statusEl.addClass(isError ? 'tool-error' : 'tool-done');
                            statusEl.setText(isError ? '✗' : '✓');
                        }
                        const outputEl = details.querySelector('.tool-call-output');
                        if (outputEl && displayContent) {
                            const truncated = displayContent.length > 2000
                                ? displayContent.slice(0, 2000) + '\n…(truncated)'
                                : displayContent;
                            outputEl.createEl('pre').setText(truncated);
                        }
                        details.open = isError;
                    }
                    // Track step completion and update outer block summary
                    stepsCompleted++;
                    if (isError) stepsHasError = true;
                    updateStepsSummary(stepsCompleted === stepsTotal);

                    // Update activity badge in plan box (only if a plan is active).
                    // Use closest('.assistant-message') so the lookup works both before
                    // and after the DOM-move (toolsEl.parentElement changes on move).
                    activityActionCount++;
                    const actBadge = toolsEl.closest('.assistant-message')?.querySelector('.todo-activity-badge') as HTMLElement | null;
                    if (actBadge) actBadge.setText(t('ui.sidebar.activityCount', { count: activityActionCount }));
                    if (isError) {
                        const actDetails = toolsEl.closest('.todo-activity-log') as HTMLDetailsElement | null;
                        if (actDetails) actDetails.open = true;
                    }
                },
                onUsage: (inputTokens, outputTokens) => {
                    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    footerEl.setText(`${time}  ·  ${inputTokens.toLocaleString()} in · ${outputTokens.toLocaleString()} out`);
                    footerEl.style.display = '';
                },
                onTodoUpdate: (items) => {
                    lastTodoItems = items;
                    this.renderTodoBox(toolsEl, items);
                },
                onContextCondensed: () => {
                    // Show a subtle badge in the footer to indicate condensing happened
                    if (footerEl) {
                        const badge = footerEl.createSpan('context-condensed-badge');
                        badge.setText(t('ui.sidebar.contextCondensed'));
                        footerEl.style.display = '';
                    }
                },
                onModeSwitch: (newModeSlug) => {
                    // Explicitly sync settings before refreshing the button.
                    // ModeService.switchMode() sets this synchronously, but this
                    // ensures the button always shows the correct mode even if
                    // the async save is still in flight.
                    this.plugin.settings.currentMode = newModeSlug;
                    this.updateModeButton();
                    new Notice(t('notice.modeSwitched', { mode: this.getModeDisplayName(newModeSlug) }));
                    // Auto-index on mode switch if configured
                    if (this.plugin.settings.semanticAutoIndex === 'mode-switch' && this.plugin.semanticIndex) {
                        this.plugin.semanticIndex.buildIndex().catch((e) =>
                            console.warn('[AgentSidebarView] Auto-index on mode switch failed:', e)
                        );
                    }
                },
                onCheckpoint: (checkpoint) => {
                    this.renderCheckpointMarker(toolsEl, checkpoint);
                    hasRenderedCheckpoints = true;
                    scheduleScroll();
                },
                onQuestion: (question, options, resolve, allowMultiple) => {
                    // Render any accumulated text before the question card.
                    // This is critical for multi-turn flows like onboarding where
                    // onComplete only fires at the very end — the greeting text
                    // would otherwise stay invisible until the entire task finishes.
                    if (accumulatedText.trim()) {
                        // Hide during re-render to avoid flash of raw → markdown transition
                        contentEl.style.visibility = 'hidden';
                        contentEl.empty();
                        MarkdownRenderer.render(this.app, accumulatedText, contentEl, '', this);
                        requestAnimationFrame(() => { contentEl.style.visibility = ''; });
                    }
                    // Wrap resolve: after the user answers, show their answer as a
                    // chat bubble and create a fresh message element for the next
                    // agent response. This turns multi-turn flows (onboarding) into
                    // a real back-and-forth conversation in the UI.
                    const wrappedResolve = (answer: string) => {
                        // Finalize current assistant message
                        messageEl.removeClass('message-streaming');
                        if (accumulatedText) {
                            this.uiMessages.push({ role: 'assistant', text: accumulatedText, ts: new Date().toISOString() });
                        }
                        // Render user answer as a regular chat message
                        this.addUserMessage(answer);
                        this.uiMessages.push({ role: 'user', text: answer, ts: new Date().toISOString() });
                        // Create fresh assistant message element for the next response
                        ({ messageEl, thinkingEl, toolsEl, contentEl, footerEl } = this.createStreamingMessageEl());
                        // Reset per-turn state
                        accumulatedText = '';
                        hasTools = false;
                        streamingPara = null;
                        stepsBlockEl = null;
                        stepsBodyEl = null;
                        stepsSummaryIconEl = null;
                        stepsSummaryLabelEl = null;
                        stepsTotal = 0;
                        stepsCompleted = 0;
                        stepsHasError = false;
                        loadingRemoved = false;
                        activeToolGroup = null;
                        // Scroll and continue agent loop
                        scheduleScroll();
                        resolve(answer);
                    };
                    this.showQuestionCard(question, options, wrappedResolve, allowMultiple);
                },
                onApprovalRequired: async (toolName, input) => {
                    return this.showApprovalCard(toolName, input, toolsEl);
                },
                onAttemptCompletion: () => {
                    // Auto-complete any unfinished todo items — agent often skips
                    // a final update_todo_list call before attempt_completion
                    if (lastTodoItems.length > 0) {
                        const allDone = lastTodoItems.map((i) => ({ ...i, status: 'done' as const }));
                        this.renderTodoBox(toolsEl, allDone);
                    }
                    scheduleScroll();
                },
                onEpisodeData: (data) => {
                    // Episodic memory: record successful multi-tool task (ADR-018, fire-and-forget)
                    if (this.plugin.episodicExtractor && this.plugin.settings.mastery.enabled) {
                        const episode = {
                            userMessage: text,
                            mode: activeMode.slug,
                            toolSequence: data.toolSequence,
                            toolLedger: data.toolLedger,
                            success: true,
                            resultSummary: accumulatedText.slice(0, 300),
                        };
                        this.plugin.episodicExtractor.recordEpisode(episode).then((ep) => {
                            if (ep && this.plugin.recipePromotionService) {
                                this.plugin.recipePromotionService.checkForPromotion(ep).catch((e) =>
                                    console.warn('[Mastery] Promotion check failed:', e)
                                );
                            }
                        }).catch((e) => console.warn('[Mastery] Episode recording failed:', e));
                    }
                },
                onComplete: () => {
                    // Always clear the loading spinner — covers cases where no text was streamed.
                    removeLoading();
                    // Auto-complete todos on natural task end (mirrors onAttemptCompletion)
                    if (lastTodoItems.length > 0) {
                        const allDone = lastTodoItems.map((i) => ({ ...i, status: 'done' as const }));
                        this.renderTodoBox(toolsEl, allDone);
                    }
                    // Finalize the steps block: remove any trailing "Analyzing…" row,
                    // ensure the summary shows the final count + status icon, and
                    // remove open state from individual tool-call details so the block
                    // is tidy when the user expands it.
                    if (stepsBlockEl) {
                        if (stepsTotal === 0) {
                            // No tools were called — remove the empty block so it doesn't clutter the UI.
                            stepsBlockEl.remove();
                            stepsBlockEl = null;
                        } else {
                            stepsBodyEl?.querySelector('.tool-computing-row')?.remove();
                            updateStepsSummary(true);
                            // Collapse individual tool <details> that were left open during streaming
                            stepsBodyEl?.querySelectorAll('details.tool-call-details').forEach((d) => {
                                (d as HTMLDetailsElement).open = false;
                            });
                        }
                    }

                    // Refresh mode button — ensures it always reflects the final active mode
                    // even after an agent-initiated switch_mode call during this task.
                    this.updateModeButton();
                    // Replace the raw streaming text with the properly formatted Markdown.
                    // This fires exactly once — giving us instant streaming + clean final output.
                    streamingPara = null;
                    // Parse [sources] and [followups] blocks before rendering
                    let renderText = accumulatedText;
                    let parsedSources: { num: number; note: string; context: string }[] = [];
                    let parsedFollowups: string[] = [];
                    let followupHeading = '';
                    if (accumulatedText) {
                        const srcParsed = this.parseSources(accumulatedText);
                        renderText = srcParsed.cleanText;
                        parsedSources = srcParsed.sources;
                        const fuParsed = this.parseFollowups(renderText);
                        renderText = fuParsed.cleanText;
                        followupHeading = fuParsed.heading;
                        parsedFollowups = fuParsed.followups;
                    }
                    if (renderText) {
                        contentEl.empty();
                        MarkdownRenderer.render(this.app, renderText, contentEl, '', this);
                        contentEl.style.visibility = '';
                    } else if (hasTools) {
                        // Tools ran but the model returned no text — show a neutral placeholder
                        // so the user doesn't stare at an empty message bubble.
                        contentEl.empty();
                        contentEl.createEl('p', { cls: 'message-empty-response', text: t('ui.sidebar.emptyResponse') });
                    }
                    // Show timestamp in footer even without token usage
                    if (footerEl.style.display === 'none') {
                        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        footerEl.setText(time);
                        footerEl.style.display = '';
                    }
                    // Make internal links in the response clickable
                    this.wireInternalLinks(contentEl);
                    // Convert inline [N] to clickable citation badges
                    this.wireCitationBadges(contentEl, parsedSources);
                    // Add response action bar (with sources indicator)
                    this.addResponseActions(messageEl, accumulatedText, parsedSources);
                    // Render follow-up suggestions (parsed from [followups] block)
                    if (parsedFollowups.length > 0) {
                        const followupList = messageEl.createDiv('followup-list');
                        if (followupHeading) {
                            followupList.createEl('div', { cls: 'followup-heading', text: followupHeading });
                        }
                        for (const raw of parsedFollowups) {
                            // Clean [[wikilinks]] → display name only (no folder prefix)
                            const displayText = raw.replace(/\[\[([^\]]+)\]\]/g, (_m, link: string) => {
                                const name = link.contains('|') ? link.split('|').pop()! : link;
                                return name.contains('/') ? name.split('/').pop()! : name;
                            });
                            const item = followupList.createEl('button', { cls: 'followup-item', text: displayText });
                            item.addEventListener('click', () => {
                                if (this.textarea) {
                                    this.textarea.value = displayText;
                                    this.handleSendMessage();
                                }
                            });
                        }
                    }
                    messageEl.removeClass('message-streaming');
                    this.currentAbortController = null;
                    this.setRunningState(false);
                    scheduleScroll();
                    if (taskWriteCount > 0 && (this.plugin.settings.enableCheckpoints ?? true) && !hasRenderedCheckpoints) {
                        this.showUndoBar(taskId, taskWriteCount);
                    }
                    // Post-task review: show all changes for review/undo
                    if (taskWriteCount > 0 && (this.plugin.settings.enableCheckpoints ?? true)) {
                        this.showPostTaskReview(taskId);
                    }
                    // Notify when sidebar is not the active (focused) view
                    if (this.app.workspace.getMostRecentLeaf()?.view !== this) {
                        new Notice(t('notice.taskComplete'), 3000);
                    }
                    // Track assistant UI message for history persistence
                    if (accumulatedText) {
                        this.uiMessages.push({ role: 'assistant', text: accumulatedText, ts: new Date().toISOString() });
                    }
                    // Auto-save conversation to ConversationStore
                    this.saveCurrentConversation();
                    // Auto-title: update conversation title after first assistant response
                    if (this.activeConversationId && this.uiMessages.length <= 2 && this.plugin.conversationStore) {
                        const firstUserMsg = this.uiMessages.find((m) => m.role === 'user');
                        if (firstUserMsg) {
                            const title = firstUserMsg.text.slice(0, 60).replace(/\n/g, ' ').trim() || t('ui.sidebar.newConversation');
                            this.plugin.conversationStore.updateMeta(this.activeConversationId, { title }).catch(() => {});
                        }
                    }
                },
                // Feature 5: Error display inside steps dialog
                onError: (error) => {
                    // Clean up spinner and computing row
                    removeLoading();

                    // Show error inside the steps block (not as a separate red banner)
                    ensureStepsBlock();
                    const errorRow = (stepsBodyEl ?? toolsEl).createDiv('tool-step-row tool-step-error');
                    const iconEl = errorRow.createSpan('tool-step-icon');
                    setIcon(iconEl, 'x-circle');
                    const textEl = errorRow.createDiv('tool-step-text');
                    textEl.createDiv('error-title').setText(this.getErrorTitle(error));
                    textEl.createDiv('error-detail').setText(error.message);

                    // Update steps summary to error state
                    stepsHasError = true;
                    updateStepsSummary(true);
                    if (stepsBlockEl) stepsBlockEl.open = true;

                    // Clean up streaming/running state
                    messageEl.removeClass('message-streaming');
                    this.currentAbortController = null;
                    this.setRunningState(false);
                },
            },
            this.modeService,
            this.plugin.settings.advancedApi.consecutiveMistakeLimit,
            this.plugin.settings.advancedApi.rateLimitMs,
            this.plugin.settings.advancedApi.condensingEnabled ?? false,
            this.plugin.settings.advancedApi.condensingThreshold ?? 80,
            this.plugin.settings.advancedApi.powerSteeringFrequency ?? 0,
            this.plugin.settings.advancedApi.maxIterations ?? 25,
            0,  // depth: root task starts at 0
            this.plugin.settings.advancedApi.maxSubtaskDepth ?? 2,
        );

        // Load enabled rules for this task (Sprint 3.2)
        const rulesLoader = (this.plugin as any).rulesLoader;
        const rulesContent = rulesLoader
            ? await rulesLoader.loadEnabledRules(this.plugin.settings.rulesToggles ?? {})
            : undefined;

        // Feature 1: Pass the shared history — it accumulates across messages
        // Feature 4: Pass messageToSend (with active file context) instead of raw text
        const activeMode = this.modeService.getActiveMode();

        // Load relevant skills for this message (Sprint 3.4)
        // Skip during onboarding — the onboarding prompt has everything the LLM needs.
        // Loading skills would trigger keyword matches (e.g. "Setup") causing unnecessary delay.
        const isOnboarding = !this.plugin.settings.onboarding.completed;
        let skillsSection: string | undefined;
        if (!isOnboarding) {
            const userMessageText = typeof messageToSend === 'string'
                ? messageToSend
                : (messageToSend as any[]).find((b: any) => b.type === 'text')?.text ?? '';
            const modeAllowed = this.plugin.settings.modeSkillAllowList?.[activeMode.slug];
            // empty/undefined = all allowed; non-empty = only those skill names
            const allowedSkillNames = modeAllowed && modeAllowed.length > 0 ? modeAllowed : undefined;
            skillsSection = await this.buildSkillsSection(userMessageText, allowedSkillNames);
        }

        // Apply forced workflow from tool picker (when message doesn't start with slash command)
        const forcedWorkflowSlug = this.plugin.settings.forcedWorkflow?.[activeMode.slug] ?? '';
        if (typeof messageToSend === 'string' && !text.startsWith('/') && forcedWorkflowSlug) {
            const workflowLoader = (this.plugin as any).workflowLoader;
            if (workflowLoader) {
                const processedText = await workflowLoader.processSlashCommand(
                    `/${forcedWorkflowSlug} ${text}`,
                    this.plugin.settings.workflowToggles ?? {},
                );
                if (processedText !== `/${forcedWorkflowSlug} ${text}`) {
                    messageToSend = processedText + (activeFile
                        ? `\n\n<context>\nActive file in editor: ${activeFile.path}\n</context>`
                        : '');
                }
            }
        }

        // Build plugin skills section from VaultDNA (PAS-1) — skip during onboarding
        const pluginSkillsSection = isOnboarding ? undefined
            : (this.plugin as any).skillRegistry?.getPluginSkillsPromptSection() as string | undefined;

        const allowedMcpServers = this.plugin.settings.modeMcpServers?.[activeMode.slug];

        // Load memory context for system prompt injection
        let memoryContext: string | undefined;
        const isFirstMessage = this.conversationHistory.length === 0;
        if (this.plugin.settings.memory.enabled && this.plugin.memoryService) {
            try {
                const parts: string[] = [];

                // Long-term memory files (user-profile, projects, patterns)
                const files = await this.plugin.memoryService.loadMemoryFiles();
                const ctx = this.plugin.memoryService.buildMemoryContext(files);
                if (ctx) parts.push(ctx);

                // Onboarding: inject step-specific setup instructions when setup is incomplete
                if (this.plugin.memoryService) {
                    const onboarding = new OnboardingService(this.plugin.memoryService, this.plugin);
                    const onboardingPrompt = onboarding.getOnboardingPrompt();
                    if (onboardingPrompt) parts.unshift(onboardingPrompt);
                }

                // Session retrieval — only on first message, using raw user text
                // (not userMessageText which includes <context> and <vault_context> blocks).
                // Skipped entirely when no sessions exist to avoid a wasted embedding API call.
                if (isFirstMessage && text.trim()) {
                    const stats = await this.plugin.memoryService.getStats();
                    if (stats.sessionCount > 0) {
                        const retriever = new MemoryRetriever(
                            this.plugin.globalFs,
                            this.plugin.memoryService,
                            () => this.plugin.semanticIndex,
                        );
                        const sessionContext = await retriever.retrieveSessionContext(text);
                        if (sessionContext) parts.push(sessionContext);
                    }
                }

                if (parts.length > 0) memoryContext = parts.join('\n\n');
            } catch (e) {
                console.warn('[Memory] Failed to load memory context:', e);
            }
        }

        // Recipe matching (ADR-017) — find procedural recipes before starting the task
        let recipesSection: string | undefined;
        if (this.plugin.settings.mastery.enabled && this.plugin.recipeMatchingService) {
            try {
                const matches = this.plugin.recipeMatchingService.match(text, activeMode.slug);
                console.log(`[Mastery] Recipe matching: ${matches.length} match(es) for mode "${activeMode.slug}"`, matches.map(m => `${m.recipe.id} (${m.score.toFixed(2)})`));
                if (matches.length > 0) {
                    recipesSection = this.plugin.recipeMatchingService.buildPromptSection(matches);
                    console.log(`[Mastery] Recipe section injected (${recipesSection.length} chars)`);
                }
            } catch (e) {
                console.warn('[Mastery] Recipe matching failed (non-fatal):', e);
            }
        } else {
            console.log(`[Mastery] Skipped: enabled=${this.plugin.settings.mastery.enabled}, service=${!!this.plugin.recipeMatchingService}`);
        }

        await task.run(
            messageToSend,
            taskId,
            activeMode,
            this.conversationHistory,
            this.currentAbortController.signal,
            this.plugin.settings.globalCustomInstructions || undefined,
            this.plugin.settings.includeCurrentTimeInContext ?? true,
            rulesContent || undefined,
            skillsSection || undefined,
            this.plugin.mcpClient,
            allowedMcpServers,
            memoryContext,
            pluginSkillsSection || undefined,
            recipesSection,
        );
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
        // Save current conversation before clearing (if there is one)
        this.saveCurrentConversation();
        // Enqueue memory extraction (fire-and-forget, threshold-gated)
        this.enqueueMemoryExtraction();
        this.activeConversationId = null;
        this.uiMessages = [];
        this.conversationHistory = [];
        this.userDismissedContext = false;
        this.onboardingKeyState = null;
        this.onboardingSelectedProvider = null;
        this.attachments.clear();
        if (this.chatContainer) {
            this.chatContainer.empty();
        }
        this.showWelcomeMessage();
        this.updateContextBadge();
        this.historyPanel?.setActiveId(null);
    }

    /** Save the current conversation to ConversationStore (non-blocking). */
    private saveCurrentConversation(): void {
        const store = this.plugin.conversationStore;
        if (!store || !this.activeConversationId || this.uiMessages.length === 0) return;
        store.save(this.activeConversationId, this.conversationHistory, this.uiMessages).catch((e) =>
            console.warn('[History] Save failed:', e)
        );
    }

    /** Enqueue memory extraction if the conversation meets the threshold. Fire-and-forget. */
    private enqueueMemoryExtraction(): void {
        const mem = this.plugin.settings.memory;
        const queue = this.plugin.extractionQueue;
        if (!mem.enabled || !mem.autoExtractSessions || !queue) return;
        if (!this.activeConversationId || this.uiMessages.length < mem.extractionThreshold) return;

        // Build a minimal transcript from UI messages (~8000 chars max)
        const MAX_TRANSCRIPT = 8000;
        let transcript = '';
        for (const msg of this.uiMessages) {
            const prefix = msg.role === 'user' ? 'User: ' : 'Assistant: ';
            const line = prefix + msg.text + '\n\n';
            if (transcript.length + line.length > MAX_TRANSCRIPT) break;
            transcript += line;
        }

        const title = this.uiMessages.find((m) => m.role === 'user')?.text.slice(0, 60).replace(/\n/g, ' ').trim()
            || t('ui.sidebar.conversation');

        queue.enqueue({
            conversationId: this.activeConversationId,
            transcript,
            title,
            queuedAt: new Date().toISOString(),
            type: 'session',
        }).catch((e) => console.warn('[Memory] Enqueue failed:', e));
    }

    /** Load a conversation from history and restore it in the chat panel. */
    private async loadConversation(id: string): Promise<void> {
        const store = this.plugin.conversationStore;
        if (!store) return;

        const data = await store.load(id);
        if (!data) {
            new Notice(t('notice.loadConversationFailed'));
            return;
        }

        // Save current conversation before switching
        this.saveCurrentConversation();

        // Reset state
        this.conversationHistory = data.messages;
        this.uiMessages = data.uiMessages;
        this.activeConversationId = id;
        this.userDismissedContext = false;
        this.attachments.clear();

        // Re-render chat
        if (this.chatContainer) {
            this.chatContainer.empty();
            for (const msg of data.uiMessages) {
                if (msg.role === 'user') {
                    this.addUserMessage(msg.text);
                } else {
                    this.renderMarkdownMessage(msg.text, 'assistant');
                }
            }
        }
        this.historyPanel?.setActiveId(id);
        this.updateContextBadge();
    }

    /** Delete a conversation from history. */
    private async deleteConversation(id: string): Promise<void> {
        const store = this.plugin.conversationStore;
        if (!store) return;
        await store.delete(id);
        // If the deleted conversation is the active one, clear the chat
        if (this.activeConversationId === id) {
            this.activeConversationId = null;
            this.uiMessages = [];
            this.conversationHistory = [];
            if (this.chatContainer) {
                this.chatContainer.empty();
            }
            this.showWelcomeMessage();
        }
        this.historyPanel?.refresh();
    }

    /**
     * Create the streaming message container.
     * Structure: thinkingEl → toolsEl → contentEl → footerEl
     */
    private createStreamingMessageEl(): {
        messageEl: HTMLElement;
        thinkingEl: HTMLElement;
        toolsEl: HTMLElement;
        contentEl: HTMLElement;
        footerEl: HTMLElement;
    } {
        if (!this.chatContainer) throw new Error('Chat container not initialized');
        const messageEl = this.chatContainer.createDiv('message assistant-message message-streaming');
        // Reasoning/thinking section (hidden until thinking chunks arrive)
        const thinkingEl = messageEl.createDiv('thinking-block');
        thinkingEl.style.display = 'none';
        // Tool calls area (populated by onToolStart)
        const toolsEl = messageEl.createDiv('message-tools');
        // Text response (streamed directly for Q&A, rendered on complete for agentic)
        const contentEl = messageEl.createDiv('message-content');
        // Show a loading indicator immediately so the user sees something right away
        const loadingEl = contentEl.createDiv('message-loading');
        setIcon(loadingEl.createSpan('message-loading-icon'), 'loader');
        loadingEl.createSpan('message-loading-text').setText(t('ui.sidebar.working'));
        // Token usage + timestamp footer
        const footerEl = messageEl.createDiv('message-footer');
        footerEl.style.display = 'none';
        this.chatContainer.scrollTo({ top: this.chatContainer.scrollHeight });
        return { messageEl, thinkingEl, toolsEl, contentEl, footerEl };
    }

    /**
     * Feature 5: Map API error to a friendly title
     */
    private getErrorTitle(error: Error): string {
        const msg = error.message.toLowerCase();
        const status = (error as any).status ?? (error as any).statusCode;
        if (status === 401 || msg.includes('api key') || msg.includes('authentication')) {
            return t('ui.error.invalidKey');
        }
        if (status === 404 || msg.includes('not found')) {
            return t('ui.error.modelNotFound');
        }
        if (status === 429 || msg.includes('rate limit')) {
            return t('ui.error.rateLimit');
        }
        if (status === 529 || msg.includes('overload')) {
            return t('ui.error.overloaded');
        }
        if (msg.includes('network') || msg.includes('fetch') || msg.includes('econnrefused')) {
            return t('ui.error.network');
        }
        return t('ui.error.generic');
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

    private addUserMessage(text: string, attachments: AttachmentItem[] = [], activeFile?: TFile | null): void {
        if (!this.chatContainer) return;
        const msgEl = this.chatContainer.createDiv('message user-message');
        // Render attachment previews above the text bubble
        const hasAttachments = attachments.length > 0 || !!activeFile;
        if (hasAttachments) {
            const previewRow = msgEl.createDiv('message-attachment-previews');
            // "Current" chip for the auto-injected active file
            if (activeFile) {
                const chip = previewRow.createDiv('message-attachment-chip');
                setIcon(chip.createSpan('attachment-chip-icon'), 'file-text');
                chip.createSpan('attachment-chip-name').setText(activeFile.basename);
                chip.createSpan('attachment-current-badge').setText(t('ui.sidebar.currentFile'));
            }
            for (const att of attachments) {
                const chip = previewRow.createDiv('message-attachment-chip');
                if (att.objectUrl) {
                    const img = chip.createEl('img', { cls: 'attachment-chip-thumb' });
                    img.src = att.objectUrl;
                    img.alt = att.name;
                } else {
                    setIcon(chip.createSpan('attachment-chip-icon'), 'file-text');
                    chip.createSpan('attachment-chip-name').setText(att.name);
                }
            }
        }
        if (text) {
            msgEl.createDiv('message-content').setText(text);
        }
        // Action bar: copy + edit/resend
        this.addUserMessageActions(msgEl, text);
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }

    /** Add copy and edit+resend action buttons below a user message bubble. */
    private addUserMessageActions(msgEl: HTMLElement, text: string): void {
        const bar = msgEl.createDiv('user-message-actions');
        const makeBtn = (icon: string, tooltip: string, onClick: () => void) => {
            const btn = bar.createEl('button', { cls: 'message-action-btn', attr: { 'aria-label': tooltip } });
            setIcon(btn, icon);
            btn.title = tooltip;
            btn.addEventListener('click', onClick);
        };

        // Copy message text
        makeBtn('copy', t('ui.sidebar.copy'), () => {
            navigator.clipboard.writeText(text);
            new Notice(t('notice.copied'));
        });

        // Edit and resend: put text back in textarea, remove this message + all following
        makeBtn('pencil', t('ui.sidebar.editResend'), () => {
            if (!this.textarea || !this.chatContainer) return;
            this.textarea.value = text;
            this.autoResizeTextarea();
            this.textarea.focus();
            // Remove this message and everything after it
            const allMessages = Array.from(this.chatContainer.querySelectorAll('.message'));
            const idx = allMessages.indexOf(msgEl);
            if (idx >= 0) {
                for (let i = allMessages.length - 1; i >= idx; i--) {
                    allMessages[i].remove();
                }
            }
            // Also trim uiMessages and conversationHistory to match
            const userMsgIndices: number[] = [];
            this.uiMessages.forEach((m, i) => { if (m.role === 'user') userMsgIndices.push(i); });
            // Count which user message this is in the DOM
            const userBubblesBefore = allMessages.slice(0, idx).filter(el => el.classList.contains('user-message')).length;
            const uiIdx = userMsgIndices[userBubblesBefore];
            if (uiIdx !== undefined) {
                this.uiMessages.splice(uiIdx);
            }
            if (this.conversationHistory.length > 0) {
                let userCount = 0;
                for (let i = 0; i < this.conversationHistory.length; i++) {
                    if (this.conversationHistory[i].role === 'user') {
                        if (userCount === userBubblesBefore) {
                            this.conversationHistory.splice(i);
                            break;
                        }
                        userCount++;
                    }
                }
            }
        });
    }

    private addAssistantMessage(markdown: string): void {
        this.renderMarkdownMessage(markdown, 'assistant');
    }

    private switchMode(modeSlug: string): void {
        this.modeService.switchMode(modeSlug); // saves settings
        this.updateModeButton();
        this.updateModelButton(); // model may differ per mode
    }



    // ── Ellipsis options menu ─────────────────────────────────────────────────

    private showOptionsMenu(e: MouseEvent): void {
        const menu = new Menu();
        const settings = this.plugin.settings;

        // Refresh Index (current file)
        menu.addItem((item) => {
            item.setTitle(t('ui.menu.refreshIndex'));
            item.setIcon('refresh-cw');
            item.onClick(async () => {
                const activeFile = this.app.workspace.getActiveFile();
                if (!activeFile) { new Notice(t('notice.noActiveFile')); return; }
                if (!this.plugin.semanticIndex) { new Notice(t('notice.semanticDisabled')); return; }
                await this.plugin.semanticIndex.updateFile(activeFile.path);
                new Notice(t('notice.indexRefreshed'));
            });
        });

        // Force Reindex Vault
        menu.addItem((item) => {
            item.setTitle(t('ui.menu.forceReindex'));
            item.setIcon('database');
            item.onClick(async () => {
                if (!this.plugin.semanticIndex) { new Notice(t('notice.semanticDisabled')); return; }
                if (this.plugin.semanticIndex.building) { new Notice(t('notice.indexingInProgress')); return; }
                new Notice(t('notice.reindexingVault'));
                this.plugin.semanticIndex.buildIndex(undefined, true).then(() =>
                    new Notice(t('notice.vaultIndexRebuilt'))
                ).catch((e) => new Notice(t('notice.reindexFailed', { error: e.message })));
            });
        });

        // Cancel Indexing (only shown while building)
        if (this.plugin.semanticIndex?.building) {
            menu.addItem((item) => {
                item.setTitle(t('ui.menu.cancelIndexing'));
                item.setIcon('x-circle');
                item.onClick(() => {
                    this.plugin.semanticIndex?.cancelBuild();
                    new Notice(t('notice.indexingCancelled'));
                });
            });
        }

        menu.addSeparator();

        // Add Open Note in Context (toggle)
        menu.addItem((item) => {
            const enabled = settings.autoAddActiveFileContext;
            item.setTitle(t('ui.menu.addOpenNote'));
            item.setIcon(enabled ? 'check' : 'file-text');
            item.setChecked(enabled);
            item.onClick(async () => {
                settings.autoAddActiveFileContext = !enabled;
                await this.plugin.saveSettings();
                this.updateContextBadge();
            });
        });

        // Auto-accept Edits (toggle)
        menu.addItem((item) => {
            const enabled = settings.autoApproval.noteEdits && settings.autoApproval.vaultChanges;
            item.setTitle(t('ui.menu.autoAcceptEdits'));
            item.setIcon(enabled ? 'check' : 'pencil');
            item.setChecked(enabled);
            item.onClick(async () => {
                const newVal = !enabled;
                settings.autoApproval.noteEdits = newVal;
                settings.autoApproval.vaultChanges = newVal;
                await this.plugin.saveSettings();
                new Notice(t('notice.autoAcceptEdits', { value: newVal ? 'on' : 'off' }));
            });
        });

        menu.showAtMouseEvent(e);
    }


    // -------------------------------------------------------------------------
    // Tool display helpers (Kilo Code style)
    // -------------------------------------------------------------------------

    private getToolIcon(toolName: string): string {
        return TOOL_METADATA[toolName]?.icon ?? 'terminal';
    }

    private formatToolLabel(toolName: string): string {
        return TOOL_METADATA[toolName]?.label ?? toolName;
    }

    private getToolBriefParam(input: Record<string, any>): string {
        return input?.path ?? input?.url ?? input?.query ?? input?.question ?? '';
    }

    /**
     * Label for grouped tool calls — shows singular or plural form with count.
     * Used when consecutive same-type groupable tool calls are collapsed into one row.
     */
    private formatGroupedLabel(name: string, count: number): string {
        const labels: Record<string, [string, string]> = {
            read_file:        [t('ui.toolActivity.readFile'),       t('ui.toolActivity.readFiles')],
            list_files:       [t('ui.toolActivity.listFiles'),      t('ui.toolActivity.listFiles')],
            search_files:     [t('ui.toolActivity.searching'),      t('ui.toolActivity.searching')],
            get_frontmatter:  [t('ui.toolActivity.readingMetadata'),t('ui.toolActivity.readingMetadata')],
            get_linked_notes: [t('ui.toolActivity.findingLinks'),   t('ui.toolActivity.findingLinks')],
            search_by_tag:    [t('ui.toolActivity.searchingByTag'), t('ui.toolActivity.searchingByTag')],
            get_vault_stats:  [t('ui.toolActivity.vaultOverview'),  t('ui.toolActivity.vaultOverview')],
            get_daily_note:   [t('ui.toolActivity.readingDailyNote'),t('ui.toolActivity.readingDailyNotes')],
            web_fetch:        [t('ui.toolActivity.fetchingPage'),   t('ui.toolActivity.fetchingPages')],
            web_search:       [t('ui.toolActivity.searchingWeb'),   t('ui.toolActivity.searchingWeb')],
            semantic_search:  [t('ui.toolActivity.semanticSearch'), t('ui.toolActivity.semanticSearches')],
        };
        const [singular, plural] = labels[name] ?? [name, name];
        return count === 1 ? singular : `${plural} (${count})`;
    }

    // -------------------------------------------------------------------------
    // Response action bar + link wiring
    // -------------------------------------------------------------------------

    /**
     * Make internal [[wikilinks]] and note links in the rendered markdown clickable.
     * MarkdownRenderer handles most links, but we intercept to ensure sidebar context.
     */
    private wireInternalLinks(contentEl: HTMLElement): void {
        contentEl.querySelectorAll('a').forEach((anchor) => {
            const href = anchor.getAttribute('href') ?? '';
            // Internal links: [[Note]] renders as data-href or href without http
            if (!href.startsWith('http') && !href.startsWith('mailto')) {
                anchor.addEventListener('click', (e) => {
                    e.preventDefault();
                    const linkText = anchor.getAttribute('data-href') ?? href;
                    this.app.workspace.openLinkText(linkText, '', false);
                });
            }
        });
    }

    // -------------------------------------------------------------------------
    // Perplexity-style inline citations
    // -------------------------------------------------------------------------

    /**
     * Parse and extract [sources]...[/sources] block from the model's response.
     * Returns cleaned text (without the block) and an array of parsed sources.
     */
    private parseSources(text: string): { cleanText: string; sources: { num: number; note: string; context: string }[] } {
        const match = text.match(/\[sources\]\s*\n?([\s\S]*?)\[\/sources\]/);
        if (!match) return { cleanText: text, sources: [] };

        const cleanText = text.replace(/\[sources\]\s*\n?[\s\S]*?\[\/sources\]/, '').trimEnd();
        const sources: { num: number; note: string; context: string }[] = [];

        for (const line of match[1].split('\n')) {
            const lineMatch = line.trim().match(/^(\d+)\.\s+(.+?)(?:\s+[—\-]+\s+(.+))?$/);
            if (lineMatch) {
                sources.push({
                    num: parseInt(lineMatch[1]),
                    note: lineMatch[2].trim(),
                    context: lineMatch[3]?.trim() ?? '',
                });
            }
        }

        return { cleanText, sources };
    }

    /**
     * Parse and extract [followups]...[/followups] block from the model's response.
     * Returns cleaned text and an array of follow-up action strings.
     */
    private parseFollowups(text: string): { cleanText: string; heading: string; followups: string[] } {
        const match = text.match(/\[followups(?:\s+heading="([^"]*)")?\]\s*\n?([\s\S]*?)\[\/followups\]/);
        if (!match) return { cleanText: text, heading: '', followups: [] };

        const cleanText = text.replace(/\[followups(?:\s+heading="[^"]*")?\]\s*\n?[\s\S]*?\[\/followups\]/, '').trimEnd();
        const heading = match[1] || '';
        const followups = match[2].split('\n')
            .map(line => line.replace(/^[-*]\s*/, '').trim())
            .filter(line => line.length > 0);

        return { cleanText, heading, followups };
    }

    /**
     * Convert inline [N] references in rendered HTML to clickable citation badges.
     * Only converts numbers that match a parsed source.
     */
    private wireCitationBadges(contentEl: HTMLElement, sources: { num: number; note: string; context: string }[]): void {
        if (sources.length === 0) return;

        const sourceNums = new Set(sources.map(s => s.num));
        const walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT);
        const replacements: { node: Text; text: string }[] = [];

        while (walker.nextNode()) {
            const textNode = walker.currentNode as Text;
            // Skip text inside code blocks
            if (textNode.parentElement?.closest('code, pre')) continue;
            const text = textNode.textContent ?? '';
            if (/\[\d+\]/.test(text)) {
                replacements.push({ node: textNode, text });
            }
        }

        for (const { node, text } of replacements) {
            const fragment = document.createDocumentFragment();
            let lastIndex = 0;
            let replaced = false;

            for (const m of text.matchAll(/\[(\d+)\]/g)) {
                const num = parseInt(m[1]);
                if (!sourceNums.has(num)) continue;

                const source = sources.find(s => s.num === num)!;

                // Text before this match
                if (m.index! > lastIndex) {
                    fragment.appendChild(document.createTextNode(text.slice(lastIndex, m.index)));
                }

                // Citation badge
                const badge = document.createElement('span');
                badge.className = 'source-badge';
                badge.textContent = String(num);
                badge.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.showSourcePopup(badge, source);
                });
                fragment.appendChild(badge);

                lastIndex = m.index! + m[0].length;
                replaced = true;
            }

            if (replaced) {
                // Remaining text after last match
                if (lastIndex < text.length) {
                    fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
                }
                node.parentNode?.replaceChild(fragment, node);
            }
        }
    }

    /**
     * Clamp a fixed-position popup to the visible viewport.
     * Call after appending to document.body so dimensions are known.
     */
    private clampPopupToViewport(popup: HTMLElement): void {
        requestAnimationFrame(() => {
            const r = popup.getBoundingClientRect();
            const pad = 8;
            if (r.right > window.innerWidth) {
                popup.style.left = `${window.innerWidth - r.width - pad}px`;
            }
            if (r.left < 0) {
                popup.style.left = `${pad}px`;
            }
            if (r.bottom > window.innerHeight) {
                popup.style.top = `${window.innerHeight - r.height - pad}px`;
                popup.style.bottom = '';
            }
            if (r.top < 0) {
                popup.style.top = `${pad}px`;
                popup.style.bottom = '';
            }
        });
    }

    /**
     * Attach a click-outside close handler to a popup.
     */
    private attachPopupCloseHandler(popup: HTMLElement, anchor: HTMLElement): void {
        const close = (e: MouseEvent) => {
            if (!popup.contains(e.target as Node) && e.target !== anchor) {
                popup.remove();
                document.removeEventListener('click', close);
            }
        };
        setTimeout(() => document.addEventListener('click', close), 10);
    }

    /**
     * Show a popup card for a single source (badge click).
     */
    private showSourcePopup(anchor: HTMLElement, source: { num: number; note: string; context: string }): void {
        document.querySelectorAll('.source-popup').forEach(el => el.remove());

        const popup = document.createElement('div');
        popup.className = 'source-popup';

        const titleEl = document.createElement('div');
        titleEl.className = 'source-popup-title';
        const noteName = source.note.replace(/^\[\[|\]\]$/g, '');
        titleEl.textContent = noteName;
        titleEl.addEventListener('click', () => {
            this.app.workspace.openLinkText(noteName, '', false);
            popup.remove();
        });
        popup.appendChild(titleEl);

        if (source.context) {
            const ctxEl = document.createElement('div');
            ctxEl.className = 'source-popup-context';
            ctxEl.textContent = source.context;
            popup.appendChild(ctxEl);
        }

        const rect = anchor.getBoundingClientRect();
        popup.style.top = `${rect.bottom + 4}px`;
        popup.style.left = `${Math.max(4, rect.left - 40)}px`;

        document.body.appendChild(popup);
        this.clampPopupToViewport(popup);
        this.attachPopupCloseHandler(popup, anchor);
    }

    /**
     * Show a panel listing all sources (sources indicator click).
     */
    private showSourcesPanel(anchor: HTMLElement, sources: { num: number; note: string; context: string }[]): void {
        document.querySelectorAll('.source-popup').forEach(el => el.remove());

        const popup = document.createElement('div');
        popup.className = 'source-popup sources-panel';

        for (const source of sources) {
            const row = document.createElement('div');
            row.className = 'source-panel-row';

            const numEl = document.createElement('span');
            numEl.className = 'source-badge';
            numEl.textContent = String(source.num);
            row.appendChild(numEl);

            const titleEl = document.createElement('span');
            titleEl.className = 'source-panel-title';
            const noteName = source.note.replace(/^\[\[|\]\]$/g, '');
            titleEl.textContent = noteName;
            titleEl.addEventListener('click', () => {
                this.app.workspace.openLinkText(noteName, '', false);
                popup.remove();
            });
            row.appendChild(titleEl);

            if (source.context) {
                const ctxEl = document.createElement('div');
                ctxEl.className = 'source-panel-context';
                ctxEl.textContent = source.context;
                row.appendChild(ctxEl);
            }

            popup.appendChild(row);
        }

        const rect = anchor.getBoundingClientRect();
        popup.style.bottom = `${window.innerHeight - rect.top + 4}px`;
        popup.style.left = `${rect.left}px`;

        document.body.appendChild(popup);
        this.clampPopupToViewport(popup);
        this.attachPopupCloseHandler(popup, anchor);
    }

    /**
     * Add the response action icon bar below a completed assistant message.
     */
    private addResponseActions(messageEl: HTMLElement, responseText: string, sources?: { num: number; note: string; context: string }[]): void {
        const bar = messageEl.createDiv('message-actions');

        // Sources indicator (left-aligned, before action buttons)
        if (sources && sources.length > 0) {
            const indicator = bar.createEl('span', { cls: 'sources-indicator' });
            const iconEl = indicator.createSpan('sources-indicator-icon');
            setIcon(iconEl, 'book-open');
            indicator.createSpan({ text: t('ui.sidebar.sources', { count: sources.length }) });
            indicator.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showSourcesPanel(indicator, sources);
            });
        }

        const makeBtn = (icon: string, tooltip: string, onClick: () => void) => {
            const btn = bar.createEl('button', { cls: 'message-action-btn', attr: { 'aria-label': tooltip } });
            setIcon(btn, icon);
            btn.title = tooltip;
            btn.addEventListener('click', onClick);
        };

        // Insert at cursor in active note
        // iterateAllLeaves with instanceof is the most reliable way to find a markdown editor
        // because getActiveViewOfType returns null when the sidebar has focus
        makeBtn('text-cursor-input', t('ui.sidebar.insertAtCursor'), () => {
            let view: MarkdownView | null =
                this.app.workspace.getActiveViewOfType(MarkdownView) ?? this.lastMarkdownView;
            if (!view) {
                this.app.workspace.iterateAllLeaves((leaf) => {
                    if (!view && leaf.view instanceof MarkdownView) {
                        view = leaf.view;
                    }
                });
            }
            if (view?.editor) {
                view.editor.replaceSelection(responseText);
                new Notice(t('notice.insertedAtCursor'));
            } else {
                new Notice(t('notice.noOpenNote'));
            }
        });

        // Create new note from response — open in a new leaf (not in sidebar)
        makeBtn('file-plus', t('ui.sidebar.createNote'), async () => {
            const now = new Date();
            // Colons are forbidden in filenames on macOS/Windows — use dashes for HH-MM
            const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
            const fileName = `Agent response ${ts}.md`;
            try {
                const file = await this.app.vault.create(fileName, responseText);
                // getLeaf(true) always creates a new leaf in the main content area
                const leaf = this.app.workspace.getLeaf(true);
                await leaf.openFile(file);
            } catch (e) {
                new Notice(t('notice.createNoteFailed', { error: (e as Error).message }));
            }
        });

        // Copy to clipboard
        makeBtn('copy', t('ui.sidebar.copyResponse'), () => {
            navigator.clipboard.writeText(responseText).then(() => {
                new Notice(t('notice.copiedToClipboard'));
            });
        });

        // Regenerate
        makeBtn('refresh-cw', t('ui.sidebar.regenerate'), () => {
            // Remove this message and re-run
            messageEl.remove();
            // Remove last two history entries (assistant + tool_results if any)
            // and re-send the last user message
            if (this.lastUserMessage) {
                if (this.textarea) this.textarea.value = this.lastUserMessage;
                this.handleSendMessage();
            }
        });

        // Delete message
        makeBtn('trash-2', t('ui.sidebar.deleteResponse'), () => {
            messageEl.remove();
        });
    }

    // -------------------------------------------------------------------------
    // Completion, Question, Approval cards
    // -------------------------------------------------------------------------

    /**
     * Render (or update) the Plan box for a streaming message.
     *
     * First call: creates the plan box BEFORE toolsEl in the message, then
     * DOM-moves toolsEl (with any already-rendered tool calls) into a collapsed
     * <details> inside the plan box — making tool calls hidden by default.
     *
     * Subsequent calls: updates the todo items list and badge in place.
     */
    private renderTodoBox(
        toolsEl: HTMLElement,
        items: import('../core/tools/agent/UpdateTodoListTool').TodoItem[],
    ): void {
        const messageEl = toolsEl.closest('.assistant-message') as HTMLElement | null;
        if (!messageEl) return;

        let planBoxEl = messageEl.querySelector<HTMLElement>(':scope > .agent-todo-box');
        let planListEl: HTMLElement;
        let activityBadgeEl: HTMLElement | null;

        if (!planBoxEl) {
            // First call — build the plan box and move toolsEl into it
            planBoxEl = document.createElement('div');
            planBoxEl.className = 'agent-todo-box';
            // Insert before toolsEl (direct child of messageEl on first call)
            messageEl.insertBefore(planBoxEl, toolsEl);

            const header = planBoxEl.createDiv('todo-box-header');
            setIcon(header.createSpan('todo-box-icon'), 'list-checks');
            header.createSpan('todo-box-title').setText(t('ui.sidebar.plan'));
            activityBadgeEl = header.createSpan('todo-activity-badge');

            planListEl = planBoxEl.createDiv('todo-box-list');

            const activityDetails = planBoxEl.createEl('details', { cls: 'todo-activity-log' });
            activityDetails.createEl('summary', { cls: 'todo-activity-summary', text: t('ui.sidebar.activity') });
            // DOM-move: relocate toolsEl (with any already-rendered tool calls) into collapsed details
            activityDetails.appendChild(toolsEl);
        } else {
            planListEl = planBoxEl.querySelector<HTMLElement>('.todo-box-list')!;
            activityBadgeEl = planBoxEl.querySelector<HTMLElement>('.todo-activity-badge');
        }

        // Update the todo items list
        planListEl.empty();
        for (const item of items) {
            const row = planListEl.createDiv('todo-item');
            const icon = row.createSpan('todo-item-icon');
            if (item.status === 'done') {
                setIcon(icon, 'check-circle-2');
                row.addClass('todo-done');
            } else if (item.status === 'in_progress') {
                setIcon(icon, 'loader-2');
                row.addClass('todo-in-progress');
            } else {
                setIcon(icon, 'circle');
                row.addClass('todo-pending');
            }
            row.createSpan('todo-item-text').setText(item.text);
        }

        this.chatContainer?.scrollTo({ top: this.chatContainer.scrollHeight });
    }

    private showQuestionCard(
        question: string,
        options: string[] | undefined,
        resolve: (answer: string) => void,
        allowMultiple = false,
    ): void {
        if (!this.chatContainer) { resolve(''); return; }

        const card = this.chatContainer.createDiv('followup-list');
        card.createDiv('followup-heading').setText(question);
        const cleanup = () => card.remove();

        if (options && options.length > 0) {
            if (allowMultiple) {
                // Multi-select mode: checkboxes + confirm button
                const selected = new Set<string>();
                const optionEls: HTMLElement[] = [];
                options.forEach((opt) => {
                    const item = card.createEl('button', { cls: 'followup-item followup-item-multi', text: opt });
                    optionEls.push(item);
                    item.addEventListener('click', () => {
                        if (selected.has(opt)) {
                            selected.delete(opt);
                            item.removeClass('followup-item-selected');
                        } else {
                            selected.add(opt);
                            item.addClass('followup-item-selected');
                        }
                    });
                });
                const confirmBtn = card.createEl('button', {
                    cls: 'followup-confirm-btn',
                    text: t('ui.question.confirm'),
                });
                confirmBtn.addEventListener('click', () => {
                    if (selected.size === 0) return;
                    cleanup();
                    resolve([...selected].join(', '));
                });
            } else {
                // Single-select mode: click to answer
                options.forEach((opt) => {
                    const item = card.createEl('button', { cls: 'followup-item', text: opt });
                    item.addEventListener('click', () => { cleanup(); resolve(opt); });
                });
            }
        }

        const inputRow = card.createDiv('question-input-row');
        const input = inputRow.createEl('input', {
            cls: 'question-input',
            attr: { type: 'text', placeholder: t('ui.question.placeholder') },
        }) as HTMLInputElement;
        const submitBtn = inputRow.createEl('button', { cls: 'question-submit-btn', text: t('ui.question.answer') });
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
    ): Promise<import('../core/tool-execution/ToolExecutionPipeline').ApprovalResult> {
        // All tools use the same inline approval card during execution.
        // Post-task DiffReviewModal is shown in onComplete for collected review.
        return new Promise((resolve) => {
            const target = container ?? this.chatContainer;
            if (!target) { resolve({ decision: 'approved' }); return; }

            const group = this.getToolGroup(toolName);
            const groupLabels: Record<string, string> = {
                'note-edit': t('ui.approval.noteEdits'), 'vault-change': t('ui.approval.vaultChanges'),
                web: t('ui.approval.web'), mcp: t('ui.approval.mcp'), read: t('ui.approval.read'),
                mode: t('ui.approval.modeSwitching'), subtask: t('ui.approval.subAgents'),
                skill: t('ui.approval.pluginSkills'),
                'plugin-api': t('ui.approval.pluginApi'), recipe: t('ui.approval.recipes'),
            };

            // Compact inline row — appears within the tool call area
            const row = target.createDiv('tool-approval-row');
            const iconSpan = row.createSpan('tool-approval-icon');
            setIcon(iconSpan, 'shield-alert');
            row.createSpan('tool-approval-text').setText(
                t('ui.approval.notEnabled', { tool: this.formatToolLabel(toolName), group: groupLabels[group] ?? group })
            );

            const actions = row.createDiv('tool-approval-actions');
            const allowBtn = actions.createEl('button', { cls: 'tool-approval-btn approval-allow-once', text: t('ui.approval.allowOnce') });
            const enableBtn = actions.createEl('button', { cls: 'tool-approval-btn approval-enable', text: t('ui.approval.enableInSettings') });
            const denyBtn = actions.createEl('button', { cls: 'tool-approval-btn approval-deny-small', text: '✕' });

            const cleanup = () => row.remove();

            allowBtn.addEventListener('click', () => { cleanup(); resolve({ decision: 'approved' }); });
            denyBtn.addEventListener('click', () => { cleanup(); resolve({ decision: 'rejected' }); });
            enableBtn.addEventListener('click', async () => {
                this.plugin.settings.autoApproval.enabled = true;
                const permKey = this.groupToPermKey(group);
                if (permKey) (this.plugin.settings.autoApproval as any)[permKey] = true;
                await this.plugin.saveSettings();
                cleanup();
                resolve({ decision: 'approved' });
            });

            this.chatContainer?.scrollTo({ top: this.chatContainer!.scrollHeight });
        });
    }

    private getToolGroup(toolName: string): 'note-edit' | 'vault-change' | 'web' | 'mcp' | 'read' | 'mode' | 'subtask' | 'skill' | 'plugin-api' | 'recipe' {
        const readTools = ['read_file', 'list_files', 'search_files', 'get_frontmatter', 'get_linked_notes', 'get_vault_stats', 'search_by_tag', 'get_daily_note', 'query_base', 'semantic_search'];
        const vaultChangeTools = ['create_folder', 'delete_file', 'move_file', 'generate_canvas', 'create_base', 'update_base'];
        const skillTools = ['execute_command', 'enable_plugin', 'resolve_capability_gap'];
        if (['web_fetch', 'web_search'].includes(toolName)) return 'web';
        if (toolName === 'use_mcp_tool') return 'mcp';
        if (readTools.includes(toolName)) return 'read';
        if (vaultChangeTools.includes(toolName)) return 'vault-change';
        if (skillTools.includes(toolName)) return 'skill';
        if (toolName === 'call_plugin_api') return 'plugin-api';
        if (toolName === 'execute_recipe') return 'recipe';
        if (toolName === 'switch_mode') return 'mode';
        if (toolName === 'new_task') return 'subtask';
        return 'note-edit'; // write_file, edit_file, append_to_file, update_frontmatter
    }

    /** Map a tool group to the corresponding permission key in autoApproval config */
    private groupToPermKey(group: string): string | null {
        const map: Record<string, string> = {
            'note-edit': 'noteEdits',
            'vault-change': 'vaultChanges',
            web: 'web',
            mcp: 'mcp',
            mode: 'mode',
            subtask: 'subtasks',
            skill: 'skills',
            'plugin-api': 'pluginApiWrite', // "Enable" sets the broader write permission
            recipe: 'recipes',
        };
        return map[group] ?? null;
    }

    // -------------------------------------------------------------------------
    // Checkpoint markers (Kilo Code pattern: CheckpointSaved.tsx)
    // -------------------------------------------------------------------------

    private renderCheckpointMarker(
        container: HTMLElement,
        checkpoint: import('../core/checkpoints/GitCheckpointService').CheckpointInfo,
    ): void {
        const marker = container.createDiv('checkpoint-marker');

        const iconEl = marker.createSpan('checkpoint-icon');
        setIcon(iconEl, 'git-commit-vertical');

        const label = marker.createSpan('checkpoint-label');
        const files = checkpoint.filesChanged.map((f) => f.split('/').pop()).join(', ');
        const newFileNames = checkpoint.newFiles?.map((f) => f.split('/').pop()).join(', ');
        const allFiles = [files, newFileNames].filter(Boolean).join(', ');
        const time = new Date(checkpoint.timestamp).toLocaleTimeString('de-DE', {
            hour: '2-digit',
            minute: '2-digit',
        });
        label.setText(t('ui.checkpoint.label', { files: allFiles, time }));

        // Single restore button that expands into options
        const restoreBtn = marker.createEl('button', {
            cls: 'checkpoint-restore-btn',
            text: t('ui.checkpoint.restore'),
        });
        restoreBtn.addEventListener('click', () => {
            restoreBtn.style.display = 'none';

            const options = marker.createDiv('checkpoint-restore-options');

            const keepBtn = options.createEl('button', {
                cls: 'checkpoint-option-btn', text: t('ui.checkpoint.keepChat'),
            });
            const deleteBtn = options.createEl('button', {
                cls: 'checkpoint-option-btn checkpoint-option-delete', text: t('ui.checkpoint.deleteFromHere'),
            });
            const cancelBtn = options.createEl('button', {
                cls: 'checkpoint-option-btn', text: t('ui.checkpoint.cancel'),
            });

            cancelBtn.addEventListener('click', () => {
                options.remove();
                restoreBtn.style.display = '';
            });

            keepBtn.addEventListener('click', async () => {
                await this.restoreCheckpoint(checkpoint, marker, options, false);
            });

            deleteBtn.addEventListener('click', async () => {
                await this.restoreCheckpoint(checkpoint, marker, options, true);
            });
        });
    }

    /**
     * Execute a checkpoint restore with either "keep chat" or "delete chat from here".
     */
    private async restoreCheckpoint(
        checkpoint: import('../core/checkpoints/GitCheckpointService').CheckpointInfo,
        marker: HTMLElement,
        optionsEl: HTMLElement,
        deleteChatFromHere: boolean,
    ): Promise<void> {
        optionsEl.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = true));
        optionsEl.empty();
        optionsEl.setText(t('ui.checkpoint.restoring'));

        try {
            console.log('[Checkpoint] Restoring:', JSON.stringify(checkpoint, null, 2));
            const result = await this.plugin.checkpointService?.restore(checkpoint);
            console.log('[Checkpoint] Result:', JSON.stringify(result, null, 2));
            if (!result || result.restored.length === 0) {
                optionsEl.setText(result?.errors?.length ? t('ui.checkpoint.error') : t('ui.checkpoint.nothingToRestore'));
                return;
            }

            optionsEl.remove();
            const successEl = marker.createSpan('checkpoint-restored');
            successEl.setText(t('ui.checkpoint.restored', { count: result.restored.length }));

            if (deleteChatFromHere) {
                this.deleteChatFromCheckpoint(marker);
            } else {
                const restoredFiles = result.restored.join(', ');
                const deletedNote = checkpoint.newFiles?.length
                    ? ` Deleted: ${checkpoint.newFiles.join(', ')}.`
                    : '';
                this.conversationHistory.push({
                    role: 'user',
                    content: `[System] Checkpoint restored. Files: ${restoredFiles}.${deletedNote} Vault state changed.`,
                });
            }

            this.saveCurrentConversation();
        } catch (e) {
            console.error('[Checkpoint] Restore failed:', e);
            optionsEl.setText(t('ui.checkpoint.failed'));
        }
    }

    /**
     * Remove the assistant message containing this checkpoint and all subsequent
     * messages from the DOM, uiMessages, and conversationHistory.
     */
    private deleteChatFromCheckpoint(marker: HTMLElement): void {
        if (!this.chatContainer) return;

        const assistantMsg = marker.closest('.assistant-message') ?? marker.closest('.message');
        if (!assistantMsg) return;

        const allMessages = Array.from(this.chatContainer.querySelectorAll('.message'));
        const idx = allMessages.indexOf(assistantMsg as Element);
        if (idx < 0) return;

        // Count assistant bubbles before this one (for array truncation)
        const assistantBubblesBefore = allMessages
            .slice(0, idx)
            .filter((el) => el.classList.contains('assistant-message')).length;

        // Remove messages from DOM (this one + all after)
        for (let i = allMessages.length - 1; i >= idx; i--) {
            allMessages[i].remove();
        }

        // Truncate uiMessages at the corresponding assistant index
        const assistantIndices: number[] = [];
        this.uiMessages.forEach((m, i) => { if (m.role === 'assistant') assistantIndices.push(i); });
        const uiIdx = assistantIndices[assistantBubblesBefore];
        if (uiIdx !== undefined) {
            this.uiMessages.splice(uiIdx);
        }

        // Truncate conversationHistory at the corresponding assistant position
        let assistantCount = 0;
        for (let i = 0; i < this.conversationHistory.length; i++) {
            if (this.conversationHistory[i].role === 'assistant') {
                if (assistantCount === assistantBubblesBefore) {
                    this.conversationHistory.splice(i);
                    break;
                }
                assistantCount++;
            }
        }

        this.saveCurrentConversation();
    }

    /**
     * Open DiffReviewModal in checkpoint mode for a single checkpoint.
     * Shows the diff between snapshot (pre-write) and current vault state.
     */
    private async showCheckpointDiff(
        checkpoint: import('../core/checkpoints/GitCheckpointService').CheckpointInfo,
    ): Promise<void> {
        const service = this.plugin.checkpointService;
        if (!service) return;

        const { DiffReviewModal } = await import('./DiffReviewModal');
        const entries: import('./DiffReviewModal').FileDiffEntry[] = [];

        for (const filePath of checkpoint.filesChanged) {
            const before = await service.getSnapshotContent(checkpoint, filePath);
            if (before === null) continue;

            let after = '';
            try {
                const file = this.app.vault.getFileByPath(filePath);
                if (file) after = await this.app.vault.read(file);
            } catch { /* file deleted */ }

            entries.push({ filePath, oldContent: before, newContent: after });
        }

        if (entries.length === 0) return;

        new DiffReviewModal(
            this.app,
            entries,
            {
                mode: 'checkpoint',
                checkpointInfo: checkpoint,
                onRestore: async () => {
                    const result = await service.restore(checkpoint);
                    if (result && result.restored.length > 0) {
                        const restoredFiles = result.restored.join(', ');
                        const deletedNote = checkpoint.newFiles?.length
                            ? ` Deleted: ${checkpoint.newFiles.join(', ')}.`
                            : '';
                        this.conversationHistory.push({
                            role: 'user',
                            content: `[System] Checkpoint restored. Files: ${restoredFiles}.${deletedNote} Vault state changed.`,
                        });
                    }
                },
            },
        ).open();
    }

    // -------------------------------------------------------------------------
    // Post-task review: show all changes for review/undo after agent finishes
    // -------------------------------------------------------------------------

    private async showPostTaskReview(taskId: string): Promise<void> {
        const service = this.plugin.checkpointService;
        if (!service) return;

        const checkpoints = service.getCheckpointsForTask(taskId);
        if (checkpoints.length === 0) return;

        // Collect the earliest checkpoint content per file (pre-task state)
        const fileOldContent = new Map<string, string>();
        for (const cp of checkpoints) {
            for (const filePath of cp.filesChanged) {
                if (!fileOldContent.has(filePath)) {
                    const content = await service.getSnapshotContent(cp, filePath);
                    if (content !== null) {
                        fileOldContent.set(filePath, content);
                    }
                }
            }
        }

        // Build entries: old = earliest checkpoint, new = current vault
        const { DiffReviewModal } = await import('./DiffReviewModal');
        const entries: import('./DiffReviewModal').FileDiffEntry[] = [];

        for (const [filePath, oldContent] of fileOldContent) {
            let newContent = '';
            try {
                const file = this.app.vault.getFileByPath(filePath);
                if (file) newContent = await this.app.vault.read(file);
            } catch { /* file may have been deleted */ }

            // Skip files that haven't actually changed
            if (oldContent === newContent) continue;

            entries.push({ filePath, oldContent, newContent });
        }

        // Also handle newly created files (no checkpoint snapshot — oldContent is empty)
        const newFiles = new Set<string>();
        for (const cp of checkpoints) {
            if (cp.newFiles) {
                for (const f of cp.newFiles) newFiles.add(f);
            }
        }
        for (const filePath of newFiles) {
            let newContent = '';
            try {
                const file = this.app.vault.getFileByPath(filePath);
                if (file) newContent = await this.app.vault.read(file);
            } catch { continue; }
            if (newContent) {
                entries.push({ filePath, oldContent: '', newContent });
            }
        }

        if (entries.length === 0) return;

        new DiffReviewModal(
            this.app,
            entries,
            { mode: 'review' },
            async (decisions) => {
                // Apply user decisions: write back reverted/edited content
                for (const d of decisions) {
                    if (!d.hasChanges) continue;
                    try {
                        const file = this.app.vault.getFileByPath(d.filePath);
                        if (file instanceof TFile) {
                            await this.app.vault.modify(file, d.finalContent);
                        } else {
                            await this.app.vault.adapter.write(d.filePath, d.finalContent);
                        }
                    } catch (e) {
                        console.error(`[PostTaskReview] Failed to apply decision for ${d.filePath}:`, e);
                    }
                }
                if (decisions.length > 0) {
                    const files = decisions.map((d) => d.filePath).join(', ');
                    this.conversationHistory.push({
                        role: 'user',
                        content: `[System] Post-task review: User reverted changes in ${decisions.length} file(s): ${files}. Vault state changed.`,
                    });
                }
            },
        ).open();
    }

    // -------------------------------------------------------------------------
    // Undo bar (fallback when no checkpoint markers rendered)
    // -------------------------------------------------------------------------

    private showUndoBar(taskId: string, writeCount: number): void {
        if (!this.chatContainer) return;
        const bar = this.chatContainer.createDiv('undo-bar');
        bar.createSpan('undo-label').setText(
            t('ui.undo.modified', { count: writeCount })
        );
        const undoBtn = bar.createEl('button', { cls: 'undo-btn', text: t('ui.undo.undoAll') });
        undoBtn.addEventListener('click', async () => {
            (undoBtn as HTMLButtonElement).disabled = true;
            undoBtn.setText(t('ui.undo.restoring'));
            console.log(`[Undo] Attempting restore for taskId=${taskId} hasService=${!!this.plugin.checkpointService}`);
            try {
                const result = await this.plugin.checkpointService?.restoreLatestForTask(taskId);
                console.log('[Undo] Restore result:', result);
                bar.empty();
                if (result && result.restored.length > 0) {
                    bar.createSpan('undo-success').setText(
                        t('ui.undo.restored', { count: result.restored.length })
                    );
                } else {
                    bar.createSpan('undo-error').setText(t('ui.undo.noCheckpoint'));
                }
            } catch {
                bar.empty();
                bar.createSpan('undo-error').setText(t('ui.undo.restoreFailed'));
            }
        });
        this.chatContainer.scrollTo({ top: this.chatContainer.scrollHeight });
    }
}
