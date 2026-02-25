import { App, Notice, Setting, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { t } from '../../i18n';


export class WebSearchTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    build(containerEl: HTMLElement): void {
        containerEl.createEl('p', {
            cls: 'agent-settings-desc',
            text: t('settings.webSearch.desc'),
        });

        containerEl.createEl('h3', { cls: 'agent-settings-section', text: t('settings.webSearch.headingGeneral') });

        new Setting(containerEl)
            .setName(t('settings.webSearch.enableWebTools'))
            .setDesc(t('settings.webSearch.enableWebToolsDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.webTools?.enabled ?? false).onChange(async (v) => {
                    if (!this.plugin.settings.webTools) this.plugin.settings.webTools = { enabled: false, provider: 'none', braveApiKey: '', tavilyApiKey: '' };
                    this.plugin.settings.webTools.enabled = v;
                    await this.plugin.saveSettings();
                    this.rerender();
                }),
            );

        containerEl.createEl('h3', { cls: 'agent-settings-section', text: t('settings.webSearch.headingProvider') });

        new Setting(containerEl)
            .setName(t('settings.webSearch.provider'))
            .setDesc(t('settings.webSearch.providerDesc'))
            .addDropdown((d) =>
                d
                    .addOption('none', t('settings.webSearch.providerNone'))
                    .addOption('brave', t('settings.webSearch.providerBrave'))
                    .addOption('tavily', t('settings.webSearch.providerTavily'))
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
                .setName(t('settings.webSearch.braveKey'))
                .setDesc(t('settings.webSearch.braveKeyDesc'))
                .addText((txt) => {
                    txt.inputEl.type = 'password';
                    txt
                        .setPlaceholder(t('settings.webSearch.bravePlaceholder'))
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
                .setName(t('settings.webSearch.tavilyKey'))
                .setDesc(t('settings.webSearch.tavilyKeyDesc'))
                .addText((txt) => {
                    txt.inputEl.type = 'password';
                    txt
                        .setPlaceholder(t('settings.webSearch.tavilyPlaceholder'))
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
