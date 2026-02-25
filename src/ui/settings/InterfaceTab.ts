import { App, Notice, Setting, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { OnboardingService } from '../../core/memory/OnboardingService';
import { t } from '../../i18n';


export class InterfaceTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    build(containerEl: HTMLElement): void {
        // ─── Setup Dialog ─────────────────────────────────────────────
        containerEl.createEl('h3', { cls: 'agent-settings-section', text: t('settings.interface.headingSetup') });

        if (this.plugin.memoryService) {
            const onboarding = new OnboardingService(this.plugin.memoryService, this.plugin);
            const isComplete = !onboarding.needsOnboarding();

            const setupSetting = new Setting(containerEl)
                .setName(t('settings.interface.guidedSetup'))
                .setDesc(
                    isComplete
                        ? t('settings.interface.setupCompleted')
                        : t('settings.interface.setupNotStarted'),
                );

            setupSetting.addButton((b) =>
                b.setButtonText(isComplete ? t('settings.interface.restartSetup') : t('settings.interface.startSetup')).setCta().onClick(async () => {
                    await onboarding.reset();
                    await this.plugin.startOnboarding();
                }),
            );

            if (!isComplete) {
                setupSetting.addButton((b) =>
                    b.setButtonText(t('settings.interface.skipSetup')).onClick(async () => {
                        await onboarding.markCompleted();
                        new Notice(t('settings.interface.setupSkipped'));
                        this.rerender();
                    }),
                );
            }
        } else {
            new Setting(containerEl)
                .setName(t('settings.interface.guidedSetup'))
                .setDesc(t('settings.interface.memoryNotAvailable'));
        }

        // ─── Interface Settings ───────────────────────────────────────
        containerEl.createEl('h3', { cls: 'agent-settings-section', text: t('settings.interface.headingInterface') });
        new Setting(containerEl)
            .setName(t('settings.interface.autoAddActiveNote'))
            .setDesc(t('settings.interface.autoAddActiveNoteDesc'))
            .addToggle((tog) =>
                tog.setValue(this.plugin.settings.autoAddActiveFileContext).onChange(async (v) => {
                    this.plugin.settings.autoAddActiveFileContext = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName(t('settings.interface.sendWithEnter'))
            .setDesc(t('settings.interface.sendWithEnterDesc'))
            .addToggle((tog) =>
                tog.setValue(this.plugin.settings.sendWithEnter ?? true).onChange(async (v) => {
                    this.plugin.settings.sendWithEnter = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName(t('settings.interface.includeTime'))
            .setDesc(t('settings.interface.includeTimeDesc'))
            .addToggle((tog) =>
                tog.setValue(this.plugin.settings.includeCurrentTimeInContext ?? true).onChange(async (v) => {
                    this.plugin.settings.includeCurrentTimeInContext = v;
                    await this.plugin.saveSettings();
                }),
            );

        containerEl.createEl('h3', { cls: 'agent-settings-section', text: t('settings.interface.headingHistory') });

        new Setting(containerEl)
            .setName(t('settings.interface.historyFolder'))
            .setDesc(t('settings.interface.historyFolderDesc'))
            .addText((txt) =>
                txt.setPlaceholder(t('settings.interface.historyPlaceholder'))
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
