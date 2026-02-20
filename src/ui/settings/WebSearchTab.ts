import { App, Notice, Setting, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';


export class WebSearchTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    build(containerEl: HTMLElement): void {
        containerEl.createEl('p', {
            cls: 'agent-settings-desc',
            text: 'Configure web_fetch (read any URL) and web_search (Brave / Tavily). web_fetch works without an API key; web_search requires one.',
        });

        containerEl.createEl('h3', { cls: 'agent-settings-section', text: 'General' });

        new Setting(containerEl)
            .setName('Enable web tools')
            .setDesc('Allow the agent to fetch web pages and run internet searches. Turn off to keep the agent working entirely within your vault.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.webTools?.enabled ?? false).onChange(async (v) => {
                    if (!this.plugin.settings.webTools) this.plugin.settings.webTools = { enabled: false, provider: 'none', braveApiKey: '', tavilyApiKey: '' };
                    this.plugin.settings.webTools.enabled = v;
                    await this.plugin.saveSettings();
                    this.rerender();
                }),
            );

        containerEl.createEl('h3', { cls: 'agent-settings-section', text: 'Search provider' });

        new Setting(containerEl)
            .setName('Provider')
            .setDesc('Which service the agent uses for keyword searches. Choose "None" if you only need to fetch specific URLs, not run search queries.')
            .addDropdown((d) =>
                d
                    .addOption('none', 'None (web_fetch only)')
                    .addOption('brave', 'Brave Search')
                    .addOption('tavily', 'Tavily')
                    .setValue(this.plugin.settings.webTools?.provider ?? 'none')
                    .onChange(async (v) => {
                        if (!this.plugin.settings.webTools) this.plugin.settings.webTools = { enabled: true, provider: 'none', braveApiKey: '', tavilyApiKey: '' };
                        this.plugin.settings.webTools.provider = v as 'brave' | 'tavily' | 'none';
                        await this.plugin.saveSettings();
                        this.rerender();
                    }),
            );

        const provider = this.plugin.settings.webTools?.provider ?? 'none';

        if (provider === 'brave' || provider === 'none') {
            const braveKey = new Setting(containerEl)
                .setName('Brave Search API key')
                .setDesc('Required for Brave Search. Get a free API key at brave.com/search/api (2,000 searches/month on the free plan).')
                .addText((t) => {
                    t.inputEl.type = 'password';
                    t
                        .setPlaceholder('BSA...')
                        .setValue(this.plugin.settings.webTools?.braveApiKey ?? '')
                        .onChange(async (v) => {
                            if (!this.plugin.settings.webTools) this.plugin.settings.webTools = { enabled: true, provider: 'brave', braveApiKey: '', tavilyApiKey: '' };
                            this.plugin.settings.webTools.braveApiKey = v.trim();
                            await this.plugin.saveSettings();
                        });
                });
            if (provider === 'none') braveKey.setDisabled(true);
        }

        if (provider === 'tavily' || provider === 'none') {
            const tavilyKey = new Setting(containerEl)
                .setName('Tavily API key')
                .setDesc('Required for Tavily Search. Get a free API key at tavily.com (1,000 searches/month on the free plan).')
                .addText((t) => {
                    t.inputEl.type = 'password';
                    t
                        .setPlaceholder('tvly-...')
                        .setValue(this.plugin.settings.webTools?.tavilyApiKey ?? '')
                        .onChange(async (v) => {
                            if (!this.plugin.settings.webTools) this.plugin.settings.webTools = { enabled: true, provider: 'tavily', braveApiKey: '', tavilyApiKey: '' };
                            this.plugin.settings.webTools.tavilyApiKey = v.trim();
                            await this.plugin.saveSettings();
                        });
                });
            if (provider === 'none') tavilyKey.setDisabled(true);
        }
    }
}
