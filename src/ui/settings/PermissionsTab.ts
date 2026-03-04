import { App, Modal, Setting, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { t } from '../../i18n';


export class PermissionsTab {
    private permissiveWarning: HTMLElement | null = null;

    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    private buildIntroSection(containerEl: HTMLElement): void {
        const infoBanner = containerEl.createDiv('agent-settings-info-banner');
        const infoIcon = infoBanner.createSpan({ cls: 'agent-settings-info-icon' });
        setIcon(infoIcon, 'lightbulb');
        const infoText = infoBanner.createDiv({ cls: 'agent-settings-info-text' });
        infoText.createEl('strong', { text: t('settings.permissions.introTitle') });
        infoText.createDiv({ text: t('settings.permissions.introDesc') });
    }

    build(containerEl: HTMLElement): void {
        this.buildIntroSection(containerEl);
        containerEl.createEl('p', {
            cls: 'agent-settings-desc',
            text: t('settings.permissions.desc'),
        });

        // ── Auto-approve (master toggle + categories) ────────────────────
        containerEl.createEl('h3', { cls: 'agent-settings-section', text: t('settings.permissions.headingAutoApprove') });

        new Setting(containerEl)
            .setName(t('settings.permissions.enableAutoApprove'))
            .setDesc(t('settings.permissions.enableAutoApproveDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.enabled).onChange(async (v) => {
                    this.plugin.settings.autoApproval.enabled = v;
                    await this.plugin.saveSettings();
                    this.updateCategoryState(categoryContainer, v);
                    this.updatePermissiveWarning();
                }),
            );
        this.addWarning(containerEl, 'settings.permissions.enableAutoApproveWarning', true);

        new Setting(containerEl)
            .setName(t('settings.permissions.showApprovalBar'))
            .setDesc(t('settings.permissions.showApprovalBarDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.showMenuInChat).onChange(async (v) => {
                    this.plugin.settings.autoApproval.showMenuInChat = v;
                    await this.plugin.saveSettings();
                }),
            );

        // Container for all category toggles — disabled when master is off
        const categoryContainer = containerEl.createDiv('agent-approval-categories');

        categoryContainer.createEl('h3', {
            cls: 'agent-settings-section',
            text: t('settings.permissions.headingPerCategory'),
        });

        new Setting(categoryContainer)
            .setName(t('settings.permissions.readOps'))
            .setDesc(t('settings.permissions.readOpsDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.read).onChange(async (v) => {
                    this.plugin.settings.autoApproval.read = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(categoryContainer)
            .setName(t('settings.permissions.noteEdits'))
            .setDesc(t('settings.permissions.noteEditsDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.noteEdits).onChange(async (v) => {
                    this.plugin.settings.autoApproval.noteEdits = v;
                    await this.plugin.saveSettings();
                    this.updatePermissiveWarning();
                }),
            );
        this.addWarning(categoryContainer, 'settings.permissions.noteEditsWarning');

        new Setting(categoryContainer)
            .setName(t('settings.permissions.vaultChanges'))
            .setDesc(t('settings.permissions.vaultChangesDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.vaultChanges).onChange(async (v) => {
                    this.plugin.settings.autoApproval.vaultChanges = v;
                    await this.plugin.saveSettings();
                    this.updatePermissiveWarning();
                }),
            );
        this.addWarning(categoryContainer, 'settings.permissions.vaultChangesWarning');

        new Setting(categoryContainer)
            .setName(t('settings.permissions.webOps'))
            .setDesc(t('settings.permissions.webOpsDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.web).onChange(async (v) => {
                    this.plugin.settings.autoApproval.web = v;
                    await this.plugin.saveSettings();
                    this.updatePermissiveWarning();
                }),
            );
        this.addWarning(categoryContainer, 'settings.permissions.webOpsWarning');

        new Setting(categoryContainer)
            .setName(t('settings.permissions.mcpCalls'))
            .setDesc(t('settings.permissions.mcpCallsDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.mcp).onChange(async (v) => {
                    this.plugin.settings.autoApproval.mcp = v;
                    await this.plugin.saveSettings();
                }),
            );
        this.addWarning(categoryContainer, 'settings.permissions.mcpCallsWarning');

        new Setting(categoryContainer)
            .setName(t('settings.permissions.subtasks'))
            .setDesc(t('settings.permissions.subtasksDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.subtasks).onChange(async (v) => {
                    this.plugin.settings.autoApproval.subtasks = v;
                    await this.plugin.saveSettings();
                }),
            );
        this.addWarning(categoryContainer, 'settings.permissions.subtasksWarning');

        new Setting(categoryContainer)
            .setName(t('settings.permissions.pluginSkills'))
            .setDesc(t('settings.permissions.pluginSkillsDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.skills).onChange(async (v) => {
                    this.plugin.settings.autoApproval.skills = v;
                    await this.plugin.saveSettings();
                }),
            );

        categoryContainer.createEl('h3', { cls: 'agent-settings-section', text: t('settings.permissions.headingPluginApi') });

        new Setting(categoryContainer)
            .setName(t('settings.permissions.pluginApiReads'))
            .setDesc(t('settings.permissions.pluginApiReadsDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.pluginApiRead ?? true).onChange(async (v) => {
                    this.plugin.settings.autoApproval.pluginApiRead = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(categoryContainer)
            .setName(t('settings.permissions.pluginApiWrites'))
            .setDesc(t('settings.permissions.pluginApiWritesDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.pluginApiWrite ?? false).onChange(async (v) => {
                    this.plugin.settings.autoApproval.pluginApiWrite = v;
                    await this.plugin.saveSettings();
                }),
            );
        this.addWarning(categoryContainer, 'settings.permissions.pluginApiWritesWarning');

        new Setting(categoryContainer)
            .setName(t('settings.permissions.recipes'))
            .setDesc(t('settings.permissions.recipesDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.recipes ?? false).onChange(async (v) => {
                    this.plugin.settings.autoApproval.recipes = v;
                    await this.plugin.saveSettings();
                }),
            );
        this.addWarning(categoryContainer, 'settings.permissions.recipesWarning', true);

        categoryContainer.createEl('h3', { cls: 'agent-settings-section', text: t('settings.permissions.headingSandbox') });

        new Setting(categoryContainer)
            .setName(t('settings.permissions.sandbox'))
            .setDesc(t('settings.permissions.sandboxDesc'))
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.autoApproval.sandbox ?? false).onChange(async (v) => {
                    if (v) {
                        const confirmed = await this.confirmHighRisk(
                            t('settings.permissions.sandboxConfirmTitle'),
                            t('settings.permissions.sandboxConfirmMessage'),
                        );
                        if (!confirmed) {
                            toggle.setValue(false);
                            return;
                        }
                    }
                    this.plugin.settings.autoApproval.sandbox = v;
                    await this.plugin.saveSettings();
                }),
            );
        this.addWarning(categoryContainer, 'settings.permissions.sandboxWarning', true);

        // H-1: Permissive mode warning — shown when web + writes are both auto-approved
        this.permissiveWarning = containerEl.createDiv('agent-setting-warning agent-setting-warning--high-risk agent-u-hidden');
        const permissiveIcon = this.permissiveWarning.createSpan('agent-setting-warning-icon');
        setIcon(permissiveIcon, 'shield-alert');
        this.permissiveWarning.createSpan({ text: t('settings.permissions.permissiveWarning') });
        this.updatePermissiveWarning();

        // Set initial disabled state
        this.updateCategoryState(categoryContainer, this.plugin.settings.autoApproval.enabled);
    }

    /** H-1: Show/hide permissive mode warning when web + writes are both auto-approved. */
    private updatePermissiveWarning(): void {
        if (!this.permissiveWarning) return;
        const a = this.plugin.settings.autoApproval;
        const isPermissive = a.enabled && a.web && (a.noteEdits || a.vaultChanges);
        this.permissiveWarning.toggleClass('agent-u-hidden', !isPermissive);
    }

    /** Toggle the disabled state of all category toggles. */
    private updateCategoryState(container: HTMLElement, enabled: boolean): void {
        container.toggleClass('agent-approval-categories--disabled', !enabled);
    }

    /**
     * Show a confirmation dialog for high-risk settings.
     * Returns true if the user confirmed, false otherwise.
     */
    private confirmHighRisk(title: string, message: string): Promise<boolean> {
        return new Promise((resolve) => {
            const modal = new (class extends Modal {
                onOpen(): void {
                    const { contentEl } = this;
                    contentEl.createEl('h3', { text: title });
                    contentEl.createEl('p', { text: message, cls: 'agent-setting-confirm-message' });

                    const btnRow = contentEl.createDiv('agent-setting-confirm-buttons');
                    const cancelBtn = btnRow.createEl('button', { text: t('settings.permissions.sandboxConfirmCancel') });
                    const confirmBtn = btnRow.createEl('button', {
                        text: t('settings.permissions.sandboxConfirmAccept'),
                        cls: 'mod-warning',
                    });
                    cancelBtn.addEventListener('click', () => { this.close(); resolve(false); });
                    confirmBtn.addEventListener('click', () => { this.close(); resolve(true); });
                }
                onClose(): void {
                    resolve(false);
                }
            })(this.app);
            modal.open();
        });
    }

    /** Render a security warning callout below a settings toggle. */
    private addWarning(containerEl: HTMLElement, key: string, highRisk = false): void {
        const cls = highRisk ? 'agent-setting-warning agent-setting-warning--high-risk' : 'agent-setting-warning';
        const warnEl = containerEl.createDiv(cls);
        const iconEl = warnEl.createSpan('agent-setting-warning-icon');
        setIcon(iconEl, 'alert-triangle');
        warnEl.createSpan({ text: t(key) });
    }
}
