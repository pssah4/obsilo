/**
 * MemoryTab — Settings sub-tab under Agent Behaviour
 *
 * Sections:
 * 1. Memory (master toggle, auto-extract toggles)
 * 2. Memory Model (dropdown from activeModels[])
 * 3. Extraction Threshold (slider 2-20)
 * 4. Chat History (enable toggle, clear button)
 * 5. Memory Files (stats, view, reset)
 */

import { App, Notice, Setting, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { getModelKey } from '../../types/settings';
import { OnboardingService } from '../../core/memory/OnboardingService';
import { t } from '../../i18n';

export class MemoryTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    private buildIntroSection(containerEl: HTMLElement): void {
        const infoBanner = containerEl.createDiv('agent-settings-info-banner');
        const infoIcon = infoBanner.createSpan({ cls: 'agent-settings-info-icon' });
        setIcon(infoIcon, 'lightbulb');
        const infoText = infoBanner.createDiv({ cls: 'agent-settings-info-text' });
        infoText.createEl('strong', { text: t('settings.memory.introTitle') });
        infoText.createDiv({ text: t('settings.memory.introDesc') });
    }

    build(containerEl: HTMLElement): void {
        this.buildIntroSection(containerEl);
        containerEl.createEl('p', {
            cls: 'agent-settings-desc',
            text: t('settings.memory.desc'),
        });

        // ─── Chat History ─────────────────────────────────────────────
        containerEl.createEl('h3', { cls: 'agent-settings-section', text: t('settings.memory.headingHistory') });

        new Setting(containerEl)
            .setName(t('settings.memory.enableHistory'))
            .setDesc(t('settings.memory.enableHistoryDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.enableChatHistory).onChange(async (v) => {
                    this.plugin.settings.enableChatHistory = v;
                    await this.plugin.saveSettings();
                }),
            );

        const store = this.plugin.conversationStore;
        if (store) {
            const count = store.count();
            new Setting(containerEl)
                .setName(t('settings.memory.storedConversations'))
                .setDesc(t('settings.memory.storedConversationsDesc', { count }))
                .addButton((b) =>
                    b.setButtonText(t('settings.memory.clearAll')).setWarning().onClick(async () => {
                        await store.deleteAll();
                        new Notice(t('settings.memory.allConversationsDeleted'));
                        this.rerender();
                    }),
                );
        }

        // ─── Memory ───────────────────────────────────────────────────
        containerEl.createEl('h3', { cls: 'agent-settings-section', text: t('settings.memory.headingMemory') });

        const mem = this.plugin.settings.memory;

        new Setting(containerEl)
            .setName(t('settings.memory.enableMemory'))
            .setDesc(t('settings.memory.enableMemoryDesc'))
            .addToggle((t) =>
                t.setValue(mem.enabled).onChange(async (v) => {
                    this.plugin.settings.memory.enabled = v;
                    await this.plugin.saveSettings();
                    this.rerender();
                }),
            );

        if (mem.enabled) {
            new Setting(containerEl)
                .setName(t('settings.memory.autoExtract'))
                .setDesc(t('settings.memory.autoExtractDesc'))
                .addToggle((t) =>
                    t.setValue(mem.autoExtractSessions).onChange(async (v) => {
                        this.plugin.settings.memory.autoExtractSessions = v;
                        await this.plugin.saveSettings();
                    }),
                );

            new Setting(containerEl)
                .setName(t('settings.memory.autoLongTerm'))
                .setDesc(t('settings.memory.autoLongTermDesc'))
                .addToggle((t) =>
                    t.setValue(mem.autoUpdateLongTerm).onChange(async (v) => {
                        this.plugin.settings.memory.autoUpdateLongTerm = v;
                        await this.plugin.saveSettings();
                    }),
                );

            // ─── Memory Model ─────────────────────────────────────────
            containerEl.createEl('h3', { cls: 'agent-settings-section', text: t('settings.memory.headingModel') });

            const models = this.plugin.settings.activeModels.filter((m) => m.enabled);
            const modelSetting = new Setting(containerEl)
                .setName(t('settings.memory.modelSelect'))
                .setDesc(t('settings.memory.modelSelectDesc'));

            if (models.length === 0) {
                modelSetting.setDesc(t('settings.memory.noModels'));
            }

            modelSetting.addDropdown((d) => {
                d.addOption('', t('settings.memory.selectModel'));
                for (const m of models) {
                    d.addOption(getModelKey(m), m.displayName ?? m.name);
                }
                d.setValue(mem.memoryModelKey);
                d.onChange(async (v) => {
                    this.plugin.settings.memory.memoryModelKey = v;
                    await this.plugin.saveSettings();
                });
            });

            // ─── Extraction Threshold ─────────────────────────────────
            containerEl.createEl('h3', { cls: 'agent-settings-section', text: t('settings.memory.headingThreshold') });

            new Setting(containerEl)
                .setName(t('settings.memory.minMessages'))
                .setDesc(t('settings.memory.minMessagesDesc'))
                .addSlider((s) =>
                    s
                        .setLimits(2, 20, 1)
                        .setValue(mem.extractionThreshold)
                        .setDynamicTooltip()
                        .onChange(async (v) => {
                            this.plugin.settings.memory.extractionThreshold = v;
                            await this.plugin.saveSettings();
                        }),
                );

            // ─── Memory Files ─────────────────────────────────────────
            containerEl.createEl('h3', { cls: 'agent-settings-section', text: t('settings.memory.headingFiles') });

            const memService = this.plugin.memoryService;
            if (memService) {
                void memService.getStats().then((stats) => {
                    const desc = [
                        t('settings.memory.statsFiles', { count: stats.fileCount }),
                        t('settings.memory.statsSessions', { count: stats.sessionCount }),
                    ];
                    if (stats.lastUpdated) {
                        desc.push(t('settings.memory.statsLastUpdated', { date: new Date(stats.lastUpdated).toLocaleDateString() }));
                    }
                    statsSetting.setDesc(desc.join(' | '));
                });
            }

            const statsSetting = new Setting(containerEl)
                .setName(t('settings.memory.memoryStorage'))
                .setDesc(t('settings.memory.memoryStorageLoading'))
                .addButton((b) =>
                    b.setButtonText(t('settings.memory.viewFiles')).onClick(() => {
                        if (memService) {
                            // Open the memory directory in Obsidian's file explorer
                            const dir = memService.getMemoryDir();
                            new Notice(t('settings.memory.memoryFilesLocation', { dir }));
                        }
                    }),
                )
                .addButton((b) =>
                    b.setButtonText(t('settings.memory.resetAll')).setWarning().onClick(async () => {
                        if (memService) {
                            await memService.resetAll();
                            new Notice(t('settings.memory.allMemoryReset'));
                            this.rerender();
                        }
                    }),
                );

            // ─── Onboarding ──────────────────────────────────────────
            containerEl.createEl('h3', { cls: 'agent-settings-section', text: t('settings.memory.headingOnboarding') });

            if (memService) {
                const onboarding = new OnboardingService(memService, this.plugin);
                const isComplete = !onboarding.needsOnboarding();

                const profileSetting = new Setting(containerEl)
                    .setName(t('settings.memory.userProfile'));

                if (!isComplete) {
                    profileSetting.setDesc(t('settings.memory.noProfile'));
                } else {
                    profileSetting.setDesc(t('settings.memory.profileActive'));
                }

                // Setup dialog controls
                const setupSetting = new Setting(containerEl)
                    .setName(t('settings.memory.setupDialog'))
                    .setDesc(
                        isComplete
                            ? t('settings.memory.setupCompleted')
                            : t('settings.memory.setupNotStarted'),
                    );

                setupSetting.addButton((b) =>
                    b.setButtonText(isComplete ? t('settings.memory.restartSetup') : t('settings.memory.startSetup')).setCta().onClick(async () => {
                        await onboarding.reset();
                        await this.plugin.startOnboarding();
                    }),
                );

                if (!isComplete) {
                    setupSetting.addButton((b) =>
                        b.setButtonText(t('settings.memory.skipSetup')).onClick(async () => {
                            await onboarding.markCompleted();
                            new Notice(t('settings.memory.setupSkipped'));
                            this.rerender();
                        }),
                    );
                }
            }
        }
    }
}
