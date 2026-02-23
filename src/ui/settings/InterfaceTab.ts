import { App, Notice, Setting, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { OnboardingService } from '../../core/memory/OnboardingService';


export class InterfaceTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    build(containerEl: HTMLElement): void {
        // ─── Setup Dialog ─────────────────────────────────────────────
        containerEl.createEl('h3', { cls: 'agent-settings-section', text: 'Setup Dialog' });

        if (this.plugin.memoryService) {
            const onboarding = new OnboardingService(this.plugin.memoryService, this.plugin);
            const isComplete = !onboarding.needsOnboarding();
            const isInProgress = !isComplete && onboarding.getSetupStep() !== 'backup';

            const setupSetting = new Setting(containerEl)
                .setName('Guided setup')
                .setDesc(
                    isComplete
                        ? 'Setup completed. Restart to re-configure model, permissions, and profile.'
                        : isInProgress
                            ? `Setup in progress (Step ${onboarding.getStepIndex()}/${onboarding.getTotalSteps()} — ${onboarding.getStepLabel()}). Open the chat to continue.`
                            : 'Setup not started yet. Open the chat to begin.',
                );

            // Start / Restart Setup — triggers agent message with explicit setup instruction
            setupSetting.addButton((b) =>
                b.setButtonText(isComplete ? 'Restart setup' : 'Start setup').setCta().onClick(async () => {
                    await onboarding.reset();
                    await this.plugin.sendMessageToAgent(
                        'Starte den Setup-Prozess. Folge den Onboarding-Anweisungen im System-Prompt.',
                        true,
                    );
                }),
            );

            // Continue Setup (only when in progress) — opens chat at current step
            if (isInProgress) {
                setupSetting.addButton((b) =>
                    b.setButtonText('Continue setup').onClick(async () => {
                        await this.plugin.sendMessageToAgent(
                            'Setze den Setup-Prozess fort. Folge den Onboarding-Anweisungen im System-Prompt.',
                            true,
                        );
                    }),
                );
            }

            // Skip Setup (only when not complete)
            if (!isComplete) {
                setupSetting.addButton((b) =>
                    b.setButtonText('Skip setup').onClick(async () => {
                        await onboarding.markCompleted();
                        new Notice('Setup skipped. You can restart it anytime from settings.');
                        this.rerender();
                    }),
                );
            }
        } else {
            new Setting(containerEl)
                .setName('Guided setup')
                .setDesc('Memory service not available. Enable memory to use the setup dialog.');
        }

        // ─── Interface Settings ───────────────────────────────────────
        containerEl.createEl('h3', { cls: 'agent-settings-section', text: 'Interface' });
        new Setting(containerEl)
            .setName('Auto-add active note as context')
            .setDesc('Automatically attach the note you have open in the editor to every message you send. The agent can see and reference its content.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoAddActiveFileContext).onChange(async (v) => {
                    this.plugin.settings.autoAddActiveFileContext = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName('Show welcome message')
            .setDesc('Show an introductory message the first time the agent sidebar opens.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.showWelcomeMessage).onChange(async (v) => {
                    this.plugin.settings.showWelcomeMessage = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName('Send with Enter')
            .setDesc('Press Enter to send a message (Shift+Enter for a line break). When off, use Ctrl+Enter (or Cmd+Enter on Mac) to send.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.sendWithEnter ?? true).onChange(async (v) => {
                    this.plugin.settings.sendWithEnter = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName('Include current date and time in context')
            .setDesc('Tell the agent what day and time it is. Useful for tasks involving dates, schedules, or time-sensitive notes.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.includeCurrentTimeInContext ?? true).onChange(async (v) => {
                    this.plugin.settings.includeCurrentTimeInContext = v;
                    await this.plugin.saveSettings();
                }),
            );

        containerEl.createEl('h3', { cls: 'agent-settings-section', text: 'Chat History' });

        new Setting(containerEl)
            .setName('Chat history folder')
            .setDesc('Save each conversation as a JSON file in this vault folder. Leave empty to disable. Access saved conversations via the ellipsis menu in the chat. Example: Agent/History')
            .addText((t) =>
                t.setPlaceholder('Agent/History')
                    .setValue(this.plugin.settings.chatHistoryFolder ?? '')
                    .onChange(async (v) => {
                        const folder = v.trim();
                        this.plugin.settings.chatHistoryFolder = folder;
                        await this.plugin.saveSettings();
                        if (folder) {
                            const { ChatHistoryService } = await import('../../core/ChatHistoryService');
                            (this.plugin as any).chatHistoryService = new ChatHistoryService(this.plugin.app.vault, folder);
                        } else {
                            (this.plugin as any).chatHistoryService = null;
                        }
                    }),
            );
    }

}
