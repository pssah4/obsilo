import { ItemView, WorkspaceLeaf, setIcon, Menu, MarkdownRenderer, MarkdownView, Notice, TFile } from 'obsidian';
import type { HistoryMessage } from '../core/ChatHistoryService';
import type ObsidianAgentPlugin from '../main';
import { AgentTask } from '../core/AgentTask';
import { ModeService } from '../core/modes/ModeService';
import type { MessageParam, ContentBlock, ImageMediaType } from '../api/types';
import { getModelKey, modelToLLMProvider } from '../types/settings';
import { buildApiHandler } from '../api/index';
import { resolvePromptContent } from '../core/context/SupportPrompts';
import { ToolPickerPopover } from './sidebar/ToolPickerPopover';
import { AttachmentHandler } from './sidebar/AttachmentHandler';
import type { AttachmentItem } from './sidebar/AttachmentHandler';
import { AutocompleteHandler } from './sidebar/AutocompleteHandler';
import { VaultFilePicker } from './sidebar/VaultFilePicker';

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

    // Feature 3: AbortController for cancelling in-flight requests
    private currentAbortController: AbortController | null = null;

    // Context: tracks whether user dismissed the auto-injected file for this turn
    private userDismissedContext = false;
    // Last user message text — used by "Regenerate" action
    private lastUserMessage = '';
    // Last known active MarkdownView — tracked because clicking sidebar loses getActiveViewOfType
    private lastMarkdownView: MarkdownView | null = null;

    // Tool picker (pocket-knife button)
    private toolPickerButton: HTMLElement | null = null;
    /** Manages tool/skill/workflow picker and session overrides */
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
        return 'Obsilo Agent';
    }

    getIcon(): string {
        return 'message-square-more';
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

        if (this.plugin.settings.showWelcomeMessage) {
            this.showWelcomeMessage();
        }
    }

    async onClose(): Promise<void> {
        this.currentAbortController?.abort();
        this.attachments.clear();
    }

    private buildHeader(container: HTMLElement): void {
        const header = container.createDiv('agent-header');

        const titleRow = header.createDiv('agent-title');
        titleRow.createSpan('agent-title-text').setText('Obsilo Agent');

        const headerRight = header.createDiv('agent-header-right');

        // Settings button — moved here from toolbar
        const settingsBtn = headerRight.createEl('button', {
            cls: 'header-button',
            attr: { 'aria-label': 'Settings' },
        });
        setIcon(settingsBtn.createSpan('toolbar-icon'), 'settings');
        settingsBtn.addEventListener('click', () => {
            (this.app as any).setting?.open();
            (this.app as any).setting?.openTabById('obsidian-agent');
        });

        // New Chat button — clears conversation history
        const newChatBtn = headerRight.createEl('button', {
            cls: 'header-button',
            attr: { 'aria-label': 'New chat' },
        });
        setIcon(newChatBtn.createSpan('toolbar-icon'), 'plus');
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

        // Attachment chip bar (below context chips, above textarea)
        const chipBar = inputWrapper.createDiv('chat-attachment-chips');
        this.attachments = new AttachmentHandler(this.app.vault, chipBar);

        this.textarea = inputWrapper.createEl('textarea', {
            cls: 'chat-textarea',
            attr: { placeholder: 'Type your message here...', rows: '3' },
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

        // Tool picker button (ghost style) — hidden for Ask mode
        this.toolPickerButton = toolbarLeft.createEl('button', {
            cls: 'toolbar-button toolbar-ghost tool-picker-button',
            attr: { 'aria-label': 'Select tools' },
        });
        setIcon(this.toolPickerButton.createSpan('toolbar-icon'), 'pocket-knife');
        this.toolPickerButton.addEventListener('click', (e) => this.toolPicker.show(e, this.toolPickerButton!, this.containerEl as HTMLElement));
        this.updateToolPickerButton();

        // Attach file button (ghost style)
        const attachBtn = toolbarLeft.createEl('button', {
            cls: 'toolbar-button toolbar-ghost attach-button',
            attr: { 'aria-label': 'Attach file' },
        });
        setIcon(attachBtn.createSpan('toolbar-icon'), 'paperclip');
        attachBtn.addEventListener('click', () => this.attachments.openFilePicker());

        // Vault file button — inserts @ and triggers autocomplete
        const vaultBtn = toolbarLeft.createEl('button', {
            cls: 'toolbar-button toolbar-ghost vault-attach-button',
            attr: { 'aria-label': 'Add vault file' },
        });
        setIcon(vaultBtn.createSpan('toolbar-icon'), 'at-sign');
        vaultBtn.addEventListener('click', () => {
            this.vaultFilePicker.show(vaultBtn);
        });

        // Ellipsis options menu button
        const ellipsisBtn = toolbarLeft.createEl('button', {
            cls: 'toolbar-button toolbar-ghost ellipsis-button',
            attr: { 'aria-label': 'More options' },
        });
        setIcon(ellipsisBtn.createSpan('toolbar-icon'), 'ellipsis');
        ellipsisBtn.addEventListener('click', (e) => this.showOptionsMenu(e));

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

    /** Returns the effective model key for the current mode (mode override → global fallback) */
    private getEffectiveModelKey(): string {
        const modeSlug = this.plugin.settings.currentMode;
        return this.plugin.settings.modeModelKeys?.[modeSlug] || this.plugin.settings.activeModelKey;
    }

    private updateModelButton(): void {
        if (!this.modelButton) return;
        this.modelButton.empty();
        const effectiveKey = this.getEffectiveModelKey();
        const model = this.plugin.settings.activeModels.find((m) => getModelKey(m) === effectiveKey);
        const label = model ? (model.displayName ?? model.name) : 'No model';
        const hasModeOverride = !!this.plugin.settings.modeModelKeys?.[this.plugin.settings.currentMode];
        this.modelButton.createSpan('model-label').setText(label);
        setIcon(this.modelButton.createSpan('mode-chevron'), 'chevron-down');
        (this.modelButton as HTMLButtonElement).title = hasModeOverride
            ? `${label} (mode override)`
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
                item.setTitle('No models enabled — open Settings').setIcon('settings').onClick(() => {
                    (this.app as any).setting?.open();
                    (this.app as any).setting?.openTabById('obsidian-agent');
                }),
            );
        } else {
            // Option to clear mode override (use global default)
            if (modeOverrideKey) {
                const globalModel = this.plugin.settings.activeModels.find((m) => getModelKey(m) === globalKey);
                const globalLabel = globalModel ? (globalModel.displayName ?? globalModel.name) : 'global default';
                menu.addItem((item) =>
                    item
                        .setTitle(`Use global default (${globalLabel})`)
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

    private async buildSkillsSection(userMessage: string, forcedSkillNames: string[]): Promise<string | undefined> {
        const skillsManager = (this.plugin as any).skillsManager;
        if (!skillsManager) return undefined;

        // For keyword-matched skills, use getRelevantSkills() which inlines full SKILL.md content.
        // This eliminates the read_file round-trip the agent would otherwise need.
        let section = await skillsManager.getRelevantSkills(userMessage) as string;

        // Also inject any forced skills that weren't keyword-matched
        if (forcedSkillNames.length > 0) {
            const allSkills = await skillsManager.discoverSkills() as any[];
            const keywordSection = section; // already built above
            const keywordNames = new Set(
                allSkills
                    .filter((s: any) => {
                        const msgWords = new Set((userMessage.toLowerCase().match(/\b\w{3,}\b/g) ?? []));
                        const descWords: string[] = s.description.toLowerCase().match(/\b\w{3,}\b/g) ?? [];
                        return descWords.some((w: string) => msgWords.has(w));
                    })
                    .map((s: any) => s.name as string)
            );
            const extraForced = allSkills.filter(
                (s: any) => forcedSkillNames.includes(s.name) && !keywordNames.has(s.name)
            );
            if (extraForced.length > 0) {
                // Build inline XML for forced-only skills
                const xmlEscape = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                const forcedLines: string[] = keywordSection ? [] : ['<available_skills>'];
                for (const s of extraForced) {
                    let fullContent = '';
                    try {
                        const raw = await this.app.vault.adapter.read(s.path);
                        fullContent = raw.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
                        if (fullContent.length > 4000) fullContent = fullContent.slice(0, 4000) + '\n…(truncated)';
                    } catch { /* skip */ }
                    forcedLines.push(`  <skill>`);
                    forcedLines.push(`    <name>${xmlEscape(s.name)}</name>`);
                    forcedLines.push(`    <description>${xmlEscape(s.description)}</description>`);
                    if (fullContent) forcedLines.push(`    <instructions>${xmlEscape(fullContent)}</instructions>`);
                    forcedLines.push(`  </skill>`);
                }
                if (keywordSection) {
                    // Insert forced skills before the closing tag
                    section = keywordSection.replace('</available_skills>', forcedLines.join('\n') + '\n</available_skills>');
                } else {
                    forcedLines.push('</available_skills>');
                    section = forcedLines.join('\n');
                }
            }
        }

        return section || undefined;
    }

    private autoResizeTextarea(): void {
        if (!this.textarea) return;
        this.textarea.style.height = 'auto';
        this.textarea.style.height = Math.min(this.textarea.scrollHeight, 15 * 24) + 'px';
    }

    private showWelcomeMessage(): void {
        if (!this.chatContainer) return;
        const welcomeMarkdown = `## Welcome to Obsilo Agent

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
        if (!text && this.attachments.pending.length === 0) return;
        if (this.currentAbortController) return; // Already running

        this.lastUserMessage = text;

        // Snapshot attachments, clear the chip bar, render user bubble with previews
        const attachments = [...this.attachments.pending];
        this.attachments.clear();
        const activeFileForBubble = (this.plugin.settings.autoAddActiveFileContext && !this.userDismissedContext)
            ? this.app.workspace.getActiveFile()
            : null;
        this.addUserMessage(text, attachments, activeFileForBubble);
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
        const modeModelKey = this.plugin.settings.modeModelKeys?.[currentModeSlug] || this.plugin.settings.activeModelKey;
        const resolvedModel = this.plugin.settings.activeModels.find((m) => getModelKey(m) === modeModelKey)
            ?? this.plugin.settings.activeModels.find((m) => getModelKey(m) === this.plugin.settings.activeModelKey);

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
            if (!activeKey || !activeModel) {
                this.addAssistantMessage(
                    'No model selected. Click the **model button** in the toolbar below, or go to **Settings → Obsilo Agent** to enable a model.',
                );
            } else if (activeModel.provider === 'ollama') {
                this.addAssistantMessage(
                    `**${activeModel.displayName ?? activeModel.name}** could not start. Make sure Ollama is running (\`ollama serve\`) and the model name is correct. Open **Settings → Obsilo Agent → Configure** to verify.`,
                );
            } else {
                this.addAssistantMessage(
                    `**${activeModel.displayName ?? activeModel.name}** has no API key. Add one in **Settings → Obsilo Agent → Configure**.`,
                );
            }
            return;
        }

        // Feature 3: Create AbortController, show stop button
        this.currentAbortController = new AbortController();
        this.setRunningState(true);

        // Prepare streaming message elements (thinking → tools → response text → footer)
        const { messageEl, thinkingEl, toolsEl, contentEl, footerEl } = this.createStreamingMessageEl();
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
            // Also remove any "analyzing" row between iterations
            toolsEl.querySelector('.tool-computing-row')?.remove();
        };

        const taskId = `task-${Date.now()}`;
        let taskWriteCount = 0;
        let lastTodoItems: import('../core/tools/agent/UpdateTodoListTool').TodoItem[] = [];

        const task = new AgentTask(
            resolvedApiHandler,
            this.plugin.toolRegistry,
            {
                onIterationStart: (iteration) => {
                    if (iteration > 0) {
                        // Between tool-execution and the next LLM call — show a brief "Analyzing…" pulse
                        toolsEl.querySelector('.tool-computing-row')?.remove();
                        const row = toolsEl.createDiv('tool-computing-row');
                        setIcon(row.createSpan('tool-computing-icon'), 'loader');
                        row.createSpan('tool-computing-text').setText('Analyzing results…');
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
                        header.createSpan('thinking-label').setText('Reasoning…');
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
                        if (label) (label as HTMLElement).setText('Reasoning');
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
                            accumulatedText = '';
                            contentEl.empty();
                        }
                    }

                    const brief = this.getToolBriefParam(input);
                    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                    if (GROUPABLE_TOOLS.has(name)) {
                        // ── Grouped tool ──────────────────────────────────────────────
                        // Break existing group when a different tool type arrives
                        if (activeToolGroup && activeToolGroup.name !== name) {
                            activeToolGroup = null;
                        }

                        if (!activeToolGroup) {
                            // Create new group container
                            const details = toolsEl.createEl('details', { cls: 'tool-call-details' });
                            const summary = details.createEl('summary', { cls: 'tool-call-summary' });
                            setIcon(summary.createSpan('tool-icon'), this.getToolIcon(name));
                            const nameEl = summary.createSpan('tool-name');
                            nameEl.setText(this.formatGroupedLabel(name, 1));
                            summary.createSpan('tool-time').setText(time);
                            const statusEl = summary.createSpan({ cls: 'tool-status tool-running' });
                            const bodyEl = details.createDiv('tool-group-body');
                            details.open = true;
                            activeToolGroup = { name, detailsEl: details, nameEl, statusEl, bodyEl, count: 1 };
                        } else {
                            // Group already exists from a previous iteration — reopen it and
                            // reset status to "running" so the user sees the new work arriving.
                            activeToolGroup.count++;
                            activeToolGroup.nameEl.setText(this.formatGroupedLabel(name, activeToolGroup.count));
                            activeToolGroup.detailsEl.open = true;
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

                        const details = toolsEl.createEl('details', { cls: 'tool-call-details' });
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
                    // Update activity badge in plan box (only if a plan is active).
                    // Use closest('.assistant-message') so the lookup works both before
                    // and after the DOM-move (toolsEl.parentElement changes on move).
                    activityActionCount++;
                    const actBadge = toolsEl.closest('.assistant-message')?.querySelector('.todo-activity-badge') as HTMLElement | null;
                    if (actBadge) actBadge.setText(`${activityActionCount} action${activityActionCount !== 1 ? 's' : ''}`);
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
                        badge.setText('context condensed');
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
                    new Notice(`Switched to ${this.getModeDisplayName(newModeSlug)} mode`);
                    // Auto-index on mode switch if configured
                    if (this.plugin.settings.semanticAutoIndex === 'mode-switch' && this.plugin.semanticIndex) {
                        this.plugin.semanticIndex.buildIndex().catch((e) =>
                            console.warn('[AgentSidebarView] Auto-index on mode switch failed:', e)
                        );
                    }
                },
                onQuestion: (question, options, resolve) => {
                    this.showQuestionCard(question, options, resolve);
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
                onComplete: () => {
                    // Auto-complete todos on natural task end (mirrors onAttemptCompletion)
                    if (lastTodoItems.length > 0) {
                        const allDone = lastTodoItems.map((i) => ({ ...i, status: 'done' as const }));
                        this.renderTodoBox(toolsEl, allDone);
                    }
                    // Refresh mode button — ensures it always reflects the final active mode
                    // even after an agent-initiated switch_mode call during this task.
                    this.updateModeButton();
                    // Replace the raw streaming text with the properly formatted Markdown.
                    // This fires exactly once — giving us instant streaming + clean final output.
                    streamingPara = null;
                    if (accumulatedText) {
                        contentEl.empty();
                        MarkdownRenderer.render(this.app, accumulatedText, contentEl, '', this);
                    }
                    // Show timestamp in footer even without token usage
                    if (footerEl.style.display === 'none') {
                        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        footerEl.setText(time);
                        footerEl.style.display = '';
                    }
                    // Make internal links in the response clickable
                    this.wireInternalLinks(contentEl);
                    // Add response action bar
                    this.addResponseActions(messageEl, accumulatedText);
                    messageEl.removeClass('message-streaming');
                    this.currentAbortController = null;
                    this.setRunningState(false);
                    scheduleScroll();
                    if (taskWriteCount > 0 && (this.plugin.settings.enableCheckpoints ?? true)) {
                        this.showUndoBar(taskId, taskWriteCount);
                    }
                    // Notify when sidebar is not the active (focused) view
                    if (this.app.workspace.getMostRecentLeaf()?.view !== this) {
                        new Notice('Agent task complete', 3000);
                    }
                    // Auto-save conversation to history (if folder configured)
                    const svc = this.plugin.chatHistoryService;
                    if (svc && this.conversationHistory.length > 0) {
                        const histMsgs: HistoryMessage[] = this.conversationHistory
                            .filter((m) => m.role === 'user' || m.role === 'assistant')
                            .map((m) => ({
                                role: m.role as 'user' | 'assistant',
                                content: typeof m.content === 'string'
                                    ? m.content
                                    : (m.content as any[])
                                        .filter((b: any) => b.type === 'text')
                                        .map((b: any) => b.text)
                                        .join(''),
                            }));
                        svc.save(histMsgs).catch((e) =>
                            console.warn('[ChatHistory] Save failed:', e)
                        );
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
            },
            this.modeService,
            this.plugin.settings.advancedApi.consecutiveMistakeLimit,
            this.plugin.settings.advancedApi.rateLimitMs,
            this.plugin.settings.advancedApi.condensingEnabled ?? false,
            this.plugin.settings.advancedApi.condensingThreshold ?? 80,
            this.plugin.settings.advancedApi.powerSteeringFrequency ?? 0,
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
        // Combines keyword-matched + forced skills from tool picker
        const userMessageText = typeof messageToSend === 'string'
            ? messageToSend
            : (messageToSend as any[]).find((b: any) => b.type === 'text')?.text ?? '';
        const forcedSkillNames = [
            ...(this.toolPicker.sessionForcedSkills.get(activeMode.slug) ?? this.plugin.settings.forcedSkills?.[activeMode.slug] ?? []),
        ];
        const skillsSection = await this.buildSkillsSection(userMessageText, forcedSkillNames);

        // Apply forced workflow from tool picker (when message doesn't start with slash command)
        const forcedWorkflowSlug = this.toolPicker.sessionForcedWorkflow.get(activeMode.slug)
            ?? this.plugin.settings.forcedWorkflow?.[activeMode.slug]
            ?? '';
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

        const sessionToolOverride = this.toolPicker.sessionToolOverrides.get(activeMode.slug);
        const allowedMcpServers = this.plugin.settings.modeMcpServers?.[activeMode.slug];
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
            sessionToolOverride,
            allowedMcpServers,
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
        this.conversationHistory = [];
        this.userDismissedContext = false;
        this.attachments.clear();
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
        loadingEl.createSpan('message-loading-text').setText('Working…');
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
            return 'Invalid API key — check Settings → Obsilo Agent';
        }
        if (status === 404 || msg.includes('not found')) {
            return 'Model not found — verify the Model ID in Settings → Obsilo Agent';
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
                chip.createSpan('attachment-current-badge').setText('Current');
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
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
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
            item.setTitle('Refresh Index (Current File)');
            item.setIcon('refresh-cw');
            item.onClick(async () => {
                const activeFile = this.app.workspace.getActiveFile();
                if (!activeFile) { new Notice('No active file'); return; }
                if (!this.plugin.semanticIndex) { new Notice('Semantic index is disabled'); return; }
                await this.plugin.semanticIndex.updateFile(activeFile.path);
                new Notice('Index refreshed for current file');
            });
        });

        // Force Reindex Vault
        menu.addItem((item) => {
            item.setTitle('Force Reindex Vault');
            item.setIcon('database');
            item.onClick(async () => {
                if (!this.plugin.semanticIndex) { new Notice('Semantic index is disabled'); return; }
                if (this.plugin.semanticIndex.building) { new Notice('Indexing already in progress'); return; }
                new Notice('Reindexing vault in background...');
                this.plugin.semanticIndex.buildIndex(undefined, true).then(() =>
                    new Notice('Vault index rebuilt')
                ).catch((e) => new Notice(`Reindex failed: ${e.message}`));
            });
        });

        // Cancel Indexing (only shown while building)
        if (this.plugin.semanticIndex?.building) {
            menu.addItem((item) => {
                item.setTitle('Cancel Indexing');
                item.setIcon('x-circle');
                item.onClick(() => {
                    this.plugin.semanticIndex?.cancelBuild();
                    new Notice('Indexing cancelled — partial progress saved.');
                });
            });
        }

        menu.addSeparator();

        // Add Open Note in Context (toggle)
        menu.addItem((item) => {
            const enabled = settings.autoAddActiveFileContext;
            item.setTitle('Add Open Note in Context');
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
            item.setTitle('Auto-accept Edits');
            item.setIcon(enabled ? 'check' : 'pencil');
            item.setChecked(enabled);
            item.onClick(async () => {
                const newVal = !enabled;
                settings.autoApproval.noteEdits = newVal;
                settings.autoApproval.vaultChanges = newVal;
                await this.plugin.saveSettings();
                new Notice(`Auto-accept edits: ${newVal ? 'on' : 'off'}`);
            });
        });

        menu.addSeparator();

        // Chat History (wired in F6)
        menu.addItem((item) => {
            item.setTitle('Chat History');
            item.setIcon('history');
            item.onClick(() => this.openChatHistory());
        });

        menu.showAtMouseEvent(e);
    }

    /** Open the Chat History modal. */
    openChatHistory(): void {
        const svc = this.plugin.chatHistoryService;
        if (!svc) {
            new Notice('Chat History: set a folder in Settings → Advanced → Interface first');
            return;
        }
        import('../ui/ChatHistoryModal').then(({ ChatHistoryModal }) => {
            new ChatHistoryModal(this.app, svc, (msgs) => this.loadConversationHistory(msgs)).open();
        });
    }

    /** Load a saved conversation into the current chat panel. */
    loadConversationHistory(messages: HistoryMessage[]): void {
        this.clearConversation();
        for (const msg of messages) {
            if (msg.role === 'user') {
                this.addUserMessage(msg.content);
            }
        }
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

    /**
     * Label for grouped tool calls — shows singular or plural form with count.
     * Used when consecutive same-type groupable tool calls are collapsed into one row.
     */
    private formatGroupedLabel(name: string, count: number): string {
        const labels: Record<string, [string, string]> = {
            read_file:        ['Reading file',       'Reading files'],
            list_files:       ['Listing files',      'Listing files'],
            search_files:     ['Searching',          'Searching'],
            get_frontmatter:  ['Reading metadata',   'Reading metadata'],
            get_linked_notes: ['Finding links',      'Finding links'],
            search_by_tag:    ['Searching by tag',   'Searching by tag'],
            get_vault_stats:  ['Vault overview',     'Vault overview'],
            get_daily_note:   ['Reading daily note', 'Reading daily notes'],
            web_fetch:        ['Fetching page',      'Fetching pages'],
            web_search:       ['Searching web',      'Searching web'],
            semantic_search:  ['Semantic search',    'Semantic searches'],
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

    /**
     * Add the response action icon bar below a completed assistant message.
     */
    private addResponseActions(messageEl: HTMLElement, responseText: string): void {
        const bar = messageEl.createDiv('message-actions');

        const makeBtn = (icon: string, tooltip: string, onClick: () => void) => {
            const btn = bar.createEl('button', { cls: 'message-action-btn', attr: { 'aria-label': tooltip } });
            setIcon(btn, icon);
            btn.title = tooltip;
            btn.addEventListener('click', onClick);
        };

        // Insert at cursor in active note
        // iterateAllLeaves with instanceof is the most reliable way to find a markdown editor
        // because getActiveViewOfType returns null when the sidebar has focus
        makeBtn('text-cursor-input', 'Insert at cursor', () => {
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
                new Notice('Inserted at cursor.');
            } else {
                new Notice('No open note found — open a note in the editor first.');
            }
        });

        // Create new note from response — open in a new leaf (not in sidebar)
        makeBtn('file-plus', 'Create note from response', async () => {
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
                new Notice(`Could not create note: ${(e as Error).message}`);
            }
        });

        // Copy to clipboard
        makeBtn('copy', 'Copy response', () => {
            navigator.clipboard.writeText(responseText).then(() => {
                new Notice('Copied to clipboard');
            });
        });

        // Regenerate
        makeBtn('refresh-cw', 'Regenerate response', () => {
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
        makeBtn('trash-2', 'Delete response', () => {
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
            header.createSpan('todo-box-title').setText('Plan');
            activityBadgeEl = header.createSpan('todo-activity-badge');

            planListEl = planBoxEl.createDiv('todo-box-list');

            const activityDetails = planBoxEl.createEl('details', { cls: 'todo-activity-log' });
            activityDetails.createEl('summary', { cls: 'todo-activity-summary', text: 'Activity' });
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
        // For note-edit tools, show the diff modal instead of the inline banner
        const DIFF_TOOLS = new Set(['write_file', 'edit_file', 'append_to_file']);
        if (DIFF_TOOLS.has(toolName)) {
            return this.showDiffApproval(toolName, input);
        }

        return new Promise((resolve) => {
            const target = container ?? this.chatContainer;
            if (!target) { resolve('approved'); return; }

            const group = this.getToolGroup(toolName);
            const groupLabels: Record<string, string> = {
                'note-edit': 'note edits', 'vault-change': 'vault changes',
                web: 'web', mcp: 'MCP', read: 'read',
            };

            // Compact inline row — appears within the tool call area
            const row = target.createDiv('tool-approval-row');
            const iconSpan = row.createSpan('tool-approval-icon');
            setIcon(iconSpan, 'shield-alert');
            row.createSpan('tool-approval-text').setText(
                `${this.formatToolLabel(toolName)} — ${groupLabels[group] ?? group} not enabled`
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
                const permKey = this.groupToPermKey(group);
                if (permKey) (this.plugin.settings.autoApproval as any)[permKey] = true;
                await this.plugin.saveSettings();
                cleanup();
                resolve('approved');
            });

            this.chatContainer?.scrollTo({ top: this.chatContainer!.scrollHeight });
        });
    }

    /**
     * Show a diff-based approval modal for note write/edit operations.
     * Computes old vs. new content and presents the diff to the user.
     */
    private async showDiffApproval(
        toolName: string,
        input: Record<string, any>,
    ): Promise<'auto' | 'approved' | 'rejected'> {
        const filePath: string = input.path ?? '';

        // Compute old content (empty string if file doesn't exist yet)
        let oldContent = '';
        try {
            const file = this.app.vault.getFileByPath(filePath);
            if (file) oldContent = await this.app.vault.read(file);
        } catch { /* new file */ }

        // Compute new content depending on tool
        let newContent = oldContent;
        if (toolName === 'write_file') {
            newContent = input.content ?? '';
        } else if (toolName === 'edit_file') {
            const oldStr: string = input.old_string ?? '';
            const newStr: string = input.new_string ?? '';
            newContent = oldContent.replace(oldStr, newStr);
        } else if (toolName === 'append_to_file') {
            newContent = oldContent + (input.content ?? '');
        }

        return new Promise((resolve) => {
            import('./ApproveEditModal').then(({ ApproveEditModal }) => {
                new ApproveEditModal(
                    this.app,
                    filePath,
                    oldContent,
                    newContent,
                    (accepted) => resolve(accepted ? 'approved' : 'rejected'),
                ).open();
            });
        });
    }

    private getToolGroup(toolName: string): 'note-edit' | 'vault-change' | 'web' | 'mcp' | 'read' {
        const webTools = ['web_fetch', 'web_search'];
        const mcpTools = ['use_mcp_tool'];
        const readTools = ['read_file', 'list_files', 'search_files', 'get_frontmatter', 'get_linked_notes', 'get_vault_stats', 'search_by_tag', 'get_daily_note', 'query_base'];
        const vaultChangeTools = ['create_folder', 'delete_file', 'move_file', 'generate_canvas', 'create_base', 'update_base'];
        if (webTools.includes(toolName)) return 'web';
        if (mcpTools.includes(toolName)) return 'mcp';
        if (readTools.includes(toolName)) return 'read';
        if (vaultChangeTools.includes(toolName)) return 'vault-change';
        return 'note-edit'; // write_file, edit_file, append_to_file, update_frontmatter
    }

    /** Map a tool group to the corresponding permission key in autoApproval config */
    private groupToPermKey(group: string): 'noteEdits' | 'vaultChanges' | 'web' | 'mcp' | null {
        if (group === 'note-edit') return 'noteEdits';
        if (group === 'vault-change') return 'vaultChanges';
        if (group === 'web') return 'web';
        if (group === 'mcp') return 'mcp';
        return null;
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
