import { App, Notice, Setting, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { addInfoButton } from './utils';

export class LoopTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    build(containerEl: HTMLElement): void {
        containerEl.createEl('p', {
            cls: 'agent-settings-desc',
            text: 'Control how the agent loop runs, how long context is kept, and how reliably the agent stays on task.',
        });

        containerEl.createEl('h3', { cls: 'agent-settings-section', text: 'Agent Loop' });

        new Setting(containerEl)
            .setName('Consecutive error limit')
            .setDesc('Stop the task after this many tool errors in a row. Prevents the agent from getting stuck in a loop. Set to 0 to never stop automatically.')
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
            .setName('Pause between requests (ms)')
            .setDesc('Wait this many milliseconds between API calls. Useful if you hit rate limits on your API plan. Set to 0 for no delay.')
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

        containerEl.createEl('h3', { cls: 'agent-settings-section', text: 'Context Condensing' });

        const condensingSetting = new Setting(containerEl)
            .setName('Enable context condensing')
            .setDesc('When a conversation gets very long, automatically summarize older messages to stay within the model\'s memory limit. The summary replaces older messages but keeps key facts intact.');
        addInfoButton(condensingSetting, this.app, 'Context Condensing', 'AI models can only hold a limited amount of text in memory at once. When your conversation approaches that limit, Context Condensing automatically creates a summary of what was discussed so far, then continues the conversation with that summary instead of all the original messages. This lets you work on very large tasks without hitting context limits.');
        condensingSetting.addToggle((t) =>
            t.setValue(this.plugin.settings.advancedApi.condensingEnabled ?? false).onChange(async (v) => {
                this.plugin.settings.advancedApi.condensingEnabled = v;
                await this.plugin.saveSettings();
                thresholdSetting.settingEl.style.display = v ? '' : 'none';
            }),
        );

        const thresholdSetting = new Setting(containerEl)
            .setName('Condensing threshold')
            .setDesc('Start condensing when the conversation reaches this percentage of the model\'s memory limit. Lower = condenses more often; higher = waits longer before condensing.')
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
        thresholdSetting.settingEl.style.display =
            (this.plugin.settings.advancedApi.condensingEnabled ?? false) ? '' : 'none';

        containerEl.createEl('h3', { cls: 'agent-settings-section', text: 'Power Steering' });

        const powerSteeringSetting = new Setting(containerEl)
            .setName('Power Steering frequency')
            .setDesc('Every N steps, remind the agent of its current mode instructions. Helps keep long tasks on track. Set to 0 to disable. Recommended: 4.');
        addInfoButton(powerSteeringSetting, this.app, 'Power Steering', 'During long tasks, the agent can gradually lose track of its role and instructions. Power Steering periodically re-injects the current mode\'s system prompt into the conversation, keeping the agent focused on its intended purpose. A frequency of 4 means the reminder is sent every 4 conversation turns.');
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
            .setName('Max iterations per message')
            .setDesc('Maximum number of tool-call rounds the agent can take for a single message. Higher values allow more complex tasks. Default: 25.')
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
    }

}
