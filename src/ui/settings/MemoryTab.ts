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

import { App, Notice, Setting } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { getModelKey } from '../../types/settings';
import { OnboardingService } from '../../core/memory/OnboardingService';

export class MemoryTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    build(containerEl: HTMLElement): void {
        containerEl.createEl('p', {
            cls: 'agent-settings-desc',
            text: 'Configure how the agent remembers conversations and learns from past interactions. Memory is extracted in the background using a dedicated model.',
        });

        // ─── Chat History ─────────────────────────────────────────────
        containerEl.createEl('h3', { cls: 'agent-settings-section', text: 'Chat History' });

        new Setting(containerEl)
            .setName('Enable chat history')
            .setDesc('Save conversations to the plugin directory for later browsing and restoration.')
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
                .setName('Stored conversations')
                .setDesc(`${count} conversation${count !== 1 ? 's' : ''} saved`)
                .addButton((b) =>
                    b.setButtonText('Clear all').setWarning().onClick(async () => {
                        await store.deleteAll();
                        new Notice('All conversations deleted');
                        this.rerender();
                    }),
                );
        }

        // ─── Memory ───────────────────────────────────────────────────
        containerEl.createEl('h3', { cls: 'agent-settings-section', text: 'Memory' });

        const mem = this.plugin.settings.memory;

        new Setting(containerEl)
            .setName('Enable memory')
            .setDesc('Allow the agent to build long-term memory from conversations. Disable to stop all extraction.')
            .addToggle((t) =>
                t.setValue(mem.enabled).onChange(async (v) => {
                    this.plugin.settings.memory.enabled = v;
                    await this.plugin.saveSettings();
                    this.rerender();
                }),
            );

        if (mem.enabled) {
            new Setting(containerEl)
                .setName('Auto-extract session summaries')
                .setDesc('Automatically create a summary when a conversation ends.')
                .addToggle((t) =>
                    t.setValue(mem.autoExtractSessions).onChange(async (v) => {
                        this.plugin.settings.memory.autoExtractSessions = v;
                        await this.plugin.saveSettings();
                    }),
                );

            new Setting(containerEl)
                .setName('Auto-update long-term memory')
                .setDesc('Promote durable facts from session summaries to long-term memory files.')
                .addToggle((t) =>
                    t.setValue(mem.autoUpdateLongTerm).onChange(async (v) => {
                        this.plugin.settings.memory.autoUpdateLongTerm = v;
                        await this.plugin.saveSettings();
                    }),
                );

            // ─── Memory Model ─────────────────────────────────────────
            containerEl.createEl('h3', { cls: 'agent-settings-section', text: 'Memory Model' });

            const models = this.plugin.settings.activeModels.filter((m) => m.enabled);
            const modelSetting = new Setting(containerEl)
                .setName('Model for memory extraction')
                .setDesc('Select a small, fast model (e.g., Haiku) for cost-efficient background extraction.');

            if (models.length === 0) {
                modelSetting.setDesc('No models configured. Add and enable a model in Providers first.');
            }

            modelSetting.addDropdown((d) => {
                d.addOption('', '-- Select model --');
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
            containerEl.createEl('h3', { cls: 'agent-settings-section', text: 'Extraction Threshold' });

            new Setting(containerEl)
                .setName('Minimum messages before extraction')
                .setDesc('Conversations shorter than this are not saved to memory.')
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
            containerEl.createEl('h3', { cls: 'agent-settings-section', text: 'Memory Files' });

            const memService = this.plugin.memoryService;
            if (memService) {
                memService.getStats().then((stats) => {
                    const desc = [
                        `${stats.fileCount} memory file${stats.fileCount !== 1 ? 's' : ''}`,
                        `${stats.sessionCount} session summar${stats.sessionCount !== 1 ? 'ies' : 'y'}`,
                    ];
                    if (stats.lastUpdated) {
                        desc.push(`last updated ${new Date(stats.lastUpdated).toLocaleDateString()}`);
                    }
                    statsSetting.setDesc(desc.join(' | '));
                });
            }

            const statsSetting = new Setting(containerEl)
                .setName('Memory storage')
                .setDesc('Loading...')
                .addButton((b) =>
                    b.setButtonText('View files').onClick(() => {
                        if (memService) {
                            // Open the memory directory in Obsidian's file explorer
                            const dir = memService.getMemoryDir();
                            new Notice(`Memory files: ${dir}`);
                        }
                    }),
                )
                .addButton((b) =>
                    b.setButtonText('Reset all').setWarning().onClick(async () => {
                        if (memService) {
                            await memService.resetAll();
                            new Notice('All memory files reset');
                            this.rerender();
                        }
                    }),
                );

            // ─── Onboarding ──────────────────────────────────────────
            containerEl.createEl('h3', { cls: 'agent-settings-section', text: 'Onboarding' });

            if (memService) {
                const onboarding = new OnboardingService(memService, this.plugin);
                const isComplete = !onboarding.needsOnboarding();

                const profileSetting = new Setting(containerEl)
                    .setName('User profile');

                if (!isComplete) {
                    profileSetting.setDesc('No profile yet. Start a conversation and the agent will guide you through setup.');
                } else {
                    profileSetting.setDesc('Profile active. The agent uses your preferences to personalize responses.');
                }

                // Setup dialog controls
                const setupSetting = new Setting(containerEl)
                    .setName('Setup dialog')
                    .setDesc(
                        isComplete
                            ? 'Setup completed. Restart to re-configure model, permissions, and profile.'
                            : 'Setup not started yet. Open the chat to begin.',
                    );

                setupSetting.addButton((b) =>
                    b.setButtonText(isComplete ? 'Restart setup' : 'Start setup').setCta().onClick(async () => {
                        await onboarding.reset();
                        await this.plugin.startOnboarding();
                    }),
                );

                if (!isComplete) {
                    setupSetting.addButton((b) =>
                        b.setButtonText('Skip setup').onClick(async () => {
                            await onboarding.markCompleted();
                            new Notice('Setup skipped. You can restart it anytime from settings.');
                            this.rerender();
                        }),
                    );
                }
            }
        }
    }
}
