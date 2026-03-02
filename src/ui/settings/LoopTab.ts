import { App, Setting } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { t } from '../../i18n';
import { addInfoButton } from './utils';

export class LoopTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    build(containerEl: HTMLElement): void {
        containerEl.createEl('p', {
            cls: 'agent-settings-desc',
            text: t('settings.loop.desc'),
        });

        containerEl.createEl('h3', { cls: 'agent-settings-section', text: t('settings.loop.headingLoop') });

        new Setting(containerEl)
            .setName(t('settings.loop.errorLimit'))
            .setDesc(t('settings.loop.errorLimitDesc'))
            .addText((t) =>
                t
                    .setValue(String(this.plugin.settings.advancedApi.consecutiveMistakeLimit))
                    .onChange(async (v) => {
                        const n = parseInt(v);
                        if (!isNaN(n) && n >= 0) {
                            this.plugin.settings.advancedApi.consecutiveMistakeLimit = n;
                            await this.plugin.saveSettings();
                        }
                    }),
            );

        new Setting(containerEl)
            .setName(t('settings.loop.rateLimit'))
            .setDesc(t('settings.loop.rateLimitDesc'))
            .addText((t) =>
                t
                    .setValue(String(this.plugin.settings.advancedApi.rateLimitMs))
                    .onChange(async (v) => {
                        const n = parseInt(v);
                        if (!isNaN(n) && n >= 0) {
                            this.plugin.settings.advancedApi.rateLimitMs = n;
                            await this.plugin.saveSettings();
                        }
                    }),
            );

        containerEl.createEl('h3', { cls: 'agent-settings-section', text: t('settings.loop.headingCondensing') });

        const condensingSetting = new Setting(containerEl)
            .setName(t('settings.loop.enableCondensing'))
            .setDesc(t('settings.loop.enableCondensingDesc'));
        addInfoButton(condensingSetting, this.app, t('settings.loop.infoCondensingTitle'), t('settings.loop.infoCondensingBody'));
        condensingSetting.addToggle((t) =>
            t.setValue(this.plugin.settings.advancedApi.condensingEnabled ?? false).onChange(async (v) => {
                this.plugin.settings.advancedApi.condensingEnabled = v;
                await this.plugin.saveSettings();
                thresholdSetting.settingEl.classList.toggle('agent-u-hidden', !v);
            }),
        );

        const thresholdSetting = new Setting(containerEl)
            .setName(t('settings.loop.condensingThreshold'))
            .setDesc(t('settings.loop.condensingThresholdDesc'))
            .addSlider((s) =>
                s
                    .setLimits(50, 95, 5)
                    .setValue(this.plugin.settings.advancedApi.condensingThreshold ?? 80)
                    .setDynamicTooltip()
                    .onChange(async (v) => {
                        this.plugin.settings.advancedApi.condensingThreshold = v;
                        await this.plugin.saveSettings();
                    }),
            );
        thresholdSetting.settingEl.classList.toggle('agent-u-hidden',
            !(this.plugin.settings.advancedApi.condensingEnabled ?? false));

        containerEl.createEl('h3', { cls: 'agent-settings-section', text: t('settings.loop.headingPowerSteering') });

        const powerSteeringSetting = new Setting(containerEl)
            .setName(t('settings.loop.powerSteeringFreq'))
            .setDesc(t('settings.loop.powerSteeringFreqDesc'));
        addInfoButton(powerSteeringSetting, this.app, t('settings.loop.infoPowerSteeringTitle'), t('settings.loop.infoPowerSteeringBody'));
        powerSteeringSetting.addText((t) =>
            t
                .setValue(String(this.plugin.settings.advancedApi.powerSteeringFrequency ?? 0))
                .onChange(async (v) => {
                    const n = parseInt(v);
                    if (!isNaN(n) && n >= 0) {
                        this.plugin.settings.advancedApi.powerSteeringFrequency = n;
                        await this.plugin.saveSettings();
                        }
                    }),
            );

        new Setting(containerEl)
            .setName(t('settings.loop.maxIterations'))
            .setDesc(t('settings.loop.maxIterationsDesc'))
            .addSlider((s) =>
                s
                    .setLimits(5, 50, 5)
                    .setValue(this.plugin.settings.advancedApi.maxIterations ?? 25)
                    .setDynamicTooltip()
                    .onChange(async (v) => {
                        this.plugin.settings.advancedApi.maxIterations = v;
                        await this.plugin.saveSettings();
                    }),
            );

        new Setting(containerEl)
            .setName(t('settings.loop.maxSubtaskDepth'))
            .setDesc(t('settings.loop.maxSubtaskDepthDesc'))
            .addSlider((s) =>
                s
                    .setLimits(1, 3, 1)
                    .setValue(this.plugin.settings.advancedApi.maxSubtaskDepth ?? 2)
                    .setDynamicTooltip()
                    .onChange(async (v) => {
                        this.plugin.settings.advancedApi.maxSubtaskDepth = v;
                        await this.plugin.saveSettings();
                    }),
            );
    }

}
