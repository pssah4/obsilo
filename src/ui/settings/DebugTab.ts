import { App, Notice, Setting, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';


export class DebugTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    build(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName('Debug mode')
            .setDesc('Write detailed logs to the browser developer console. Only useful for troubleshooting. Open the console with Cmd+Option+I (Mac) or Ctrl+Shift+I (Windows).')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.debugMode).onChange(async (v) => {
                    this.plugin.settings.debugMode = v;
                    await this.plugin.saveSettings();
                }),
            );
    }
}
