import { App, Notice, Setting, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';


export class PermissionsTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    build(containerEl: HTMLElement): void {
        containerEl.createEl('p', {
            cls: 'agent-settings-desc',
            text: 'Control which tool categories the agent can run without asking for your approval first.',
        });

        new Setting(containerEl)
            .setName('Enable auto-approve')
            .setDesc('When on, the agent can perform approved actions without stopping to ask you each time.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.enabled).onChange(async (v) => {
                    this.plugin.settings.autoApproval.enabled = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName('Show approval bar in chat')
            .setDesc('Show a row of quick-toggle buttons above the chat input for easy access.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.showMenuInChat).onChange(async (v) => {
                    this.plugin.settings.autoApproval.showMenuInChat = v;
                    await this.plugin.saveSettings();
                }),
            );

        containerEl.createEl('h3', { cls: 'agent-settings-section', text: 'Per-category' });

        new Setting(containerEl)
            .setName('Read operations')
            .setDesc('Reading and searching notes. These operations never change your vault, so they are safe to always allow.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.read).onChange(async (v) => {
                    this.plugin.settings.autoApproval.read = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName('Note edits')
            .setDesc('Writing or modifying note content. When off, you approve each change before it is saved.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.noteEdits).onChange(async (v) => {
                    this.plugin.settings.autoApproval.noteEdits = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName('Vault structure changes')
            .setDesc('Creating folders, moving files, or deleting notes. These structural changes are harder to undo.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.vaultChanges).onChange(async (v) => {
                    this.plugin.settings.autoApproval.vaultChanges = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName('Web access')
            .setDesc('Fetching pages or running web searches. Disable if you want to review every external request.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.web).onChange(async (v) => {
                    this.plugin.settings.autoApproval.web = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName('MCP tool calls')
            .setDesc('Calls to external tools connected via Model Context Protocol servers.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.mcp).onChange(async (v) => {
                    this.plugin.settings.autoApproval.mcp = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName('Mode switching')
            .setDesc('Let the agent switch between modes (e.g. from Librarian to Writer) on its own.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.mode).onChange(async (v) => {
                    this.plugin.settings.autoApproval.mode = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName('Subtasks')
            .setDesc('Allow the agent to spawn sub-agents to handle parts of a larger task independently.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.subtasks).onChange(async (v) => {
                    this.plugin.settings.autoApproval.subtasks = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName('Follow-up questions')
            .setDesc('Let the agent ask you clarifying questions during a task without needing separate approval.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.question).onChange(async (v) => {
                    this.plugin.settings.autoApproval.question = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName('Todo list updates')
            .setDesc('Allow the agent to update its task checklist while working.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.todo).onChange(async (v) => {
                    this.plugin.settings.autoApproval.todo = v;
                    await this.plugin.saveSettings();
                }),
            );
    }
}
