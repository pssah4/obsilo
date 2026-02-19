import { App, Notice, Setting, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { DEFAULT_SETTINGS } from '../../types/settings';


export class BackupTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    build(containerEl: HTMLElement): void {
        containerEl.createEl('p', {
            cls: 'agent-settings-desc',
            text: 'Export all plugin settings as a JSON file for backup or migration. Import to restore.',
        });
        const backupRow = containerEl.createDiv('agent-backup-row');

        const exportSettingsBtn = backupRow.createEl('button', { text: 'Export settings', cls: 'mod-cta' });
        exportSettingsBtn.addEventListener('click', () => {
            const json = JSON.stringify(this.plugin.settings, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const date = new Date().toISOString().split('T')[0];
            a.download = `obsidian-agent-settings-${date}.json`;
            a.click();
            URL.revokeObjectURL(url);
            new Notice('Settings exported');
        });

        const importSettingsBtn = backupRow.createEl('button', { text: 'Import settings' });
        importSettingsBtn.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json,application/json';
            input.addEventListener('change', async () => {
                const file = input.files?.[0];
                if (!file) return;
                try {
                    const text = await file.text();
                    const parsed = JSON.parse(text);
                    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) ||
                        !('activeModels' in parsed || 'customModes' in parsed || 'autoApproval' in parsed)) {
                        new Notice('Invalid settings file — not recognized as Obsilo Agent settings');
                        return;
                    }
                    this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS, parsed);
                    await this.plugin.saveSettings();
                    new Notice('Settings imported. Refreshing…');
                    this.rerender();
                } catch (e) {
                    new Notice(`Import failed: ${(e as Error).message}`);
                }
            });
            input.click();
        });
    }
}
