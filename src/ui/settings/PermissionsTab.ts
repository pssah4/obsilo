import { App, Notice, Setting, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { t } from '../../i18n';


export class PermissionsTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    build(containerEl: HTMLElement): void {
        containerEl.createEl('p', {
            cls: 'agent-settings-desc',
            text: t('settings.permissions.desc'),
        });

        containerEl.createEl('h3', { cls: 'agent-settings-section', text: t('settings.permissions.headingGeneral') });

        new Setting(containerEl)
            .setName(t('settings.permissions.enableAutoApprove'))
            .setDesc(t('settings.permissions.enableAutoApproveDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.enabled).onChange(async (v) => {
                    this.plugin.settings.autoApproval.enabled = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName(t('settings.permissions.showApprovalBar'))
            .setDesc(t('settings.permissions.showApprovalBarDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.showMenuInChat).onChange(async (v) => {
                    this.plugin.settings.autoApproval.showMenuInChat = v;
                    await this.plugin.saveSettings();
                }),
            );

        containerEl.createEl('h3', { cls: 'agent-settings-section', text: t('settings.permissions.headingPerCategory') });

        new Setting(containerEl)
            .setName(t('settings.permissions.readOps'))
            .setDesc(t('settings.permissions.readOpsDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.read).onChange(async (v) => {
                    this.plugin.settings.autoApproval.read = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName(t('settings.permissions.noteEdits'))
            .setDesc(t('settings.permissions.noteEditsDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.noteEdits).onChange(async (v) => {
                    this.plugin.settings.autoApproval.noteEdits = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName(t('settings.permissions.vaultChanges'))
            .setDesc(t('settings.permissions.vaultChangesDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.vaultChanges).onChange(async (v) => {
                    this.plugin.settings.autoApproval.vaultChanges = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName(t('settings.permissions.mcpCalls'))
            .setDesc(t('settings.permissions.mcpCallsDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.mcp).onChange(async (v) => {
                    this.plugin.settings.autoApproval.mcp = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName(t('settings.permissions.modeSwitching'))
            .setDesc(t('settings.permissions.modeSwitchingDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.mode).onChange(async (v) => {
                    this.plugin.settings.autoApproval.mode = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName(t('settings.permissions.subtasks'))
            .setDesc(t('settings.permissions.subtasksDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.subtasks).onChange(async (v) => {
                    this.plugin.settings.autoApproval.subtasks = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName(t('settings.permissions.followUp'))
            .setDesc(t('settings.permissions.followUpDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.question).onChange(async (v) => {
                    this.plugin.settings.autoApproval.question = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName(t('settings.permissions.todoUpdates'))
            .setDesc(t('settings.permissions.todoUpdatesDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.todo).onChange(async (v) => {
                    this.plugin.settings.autoApproval.todo = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName(t('settings.permissions.pluginSkills'))
            .setDesc(t('settings.permissions.pluginSkillsDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.skills).onChange(async (v) => {
                    this.plugin.settings.autoApproval.skills = v;
                    await this.plugin.saveSettings();
                }),
            );

        containerEl.createEl('h3', { cls: 'agent-settings-section', text: t('settings.permissions.headingPluginApi') });

        new Setting(containerEl)
            .setName(t('settings.permissions.pluginApiReads'))
            .setDesc(t('settings.permissions.pluginApiReadsDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.pluginApiRead ?? true).onChange(async (v) => {
                    this.plugin.settings.autoApproval.pluginApiRead = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName(t('settings.permissions.pluginApiWrites'))
            .setDesc(t('settings.permissions.pluginApiWritesDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.pluginApiWrite ?? false).onChange(async (v) => {
                    this.plugin.settings.autoApproval.pluginApiWrite = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName(t('settings.permissions.recipes'))
            .setDesc(t('settings.permissions.recipesDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.recipes ?? false).onChange(async (v) => {
                    this.plugin.settings.autoApproval.recipes = v;
                    await this.plugin.saveSettings();
                }),
            );
    }
}
