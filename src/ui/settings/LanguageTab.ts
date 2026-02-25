import { App, Setting } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { t, setLanguage } from '../../i18n';
import { LANGUAGES, type Language } from '../../i18n/types';

export class LanguageTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    build(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName(t('settings.language.language'))
            .setDesc(t('settings.language.languageDesc'))
            .addDropdown((dd) => {
                for (const [code, label] of Object.entries(LANGUAGES)) {
                    dd.addOption(code, label);
                }
                dd.setValue(this.plugin.settings.language ?? 'en');
                dd.onChange(async (val) => {
                    this.plugin.settings.language = val as Language;
                    await this.plugin.saveSettings();
                    await setLanguage(val as Language);
                    this.rerender();
                });
            });

        containerEl.createEl('p', {
            cls: 'agent-settings-desc',
            text: t('settings.language.restartHint'),
        });
    }
}
