import { App, Notice, Setting, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { BUILT_IN_RECIPES } from '../../core/tools/agent/recipeRegistry';
import { PLUGIN_API_ALLOWLIST } from '../../core/tools/agent/pluginApiAllowlist';


export class ShellTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    build(containerEl: HTMLElement): void {
        containerEl.createEl('p', {
            cls: 'agent-settings-desc',
            text: 'Configure how the agent interacts with plugin APIs and external tools. Plugin API calls run in Obsidian\'s JavaScript sandbox. Recipes execute external programs (like Pandoc) with strict parameter validation and no shell expansion.',
        });

        // ── Plugin API Section ──────────────────────────────────────────────
        containerEl.createEl('h3', { cls: 'agent-settings-section', text: 'Plugin API' });

        new Setting(containerEl)
            .setName('Enable plugin API calls')
            .setDesc('Allow the agent to call JavaScript APIs on installed plugins (Dataview queries, Omnisearch, MetaEdit). Runs entirely in Obsidian\'s JS sandbox.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.pluginApi?.enabled ?? true).onChange(async (v) => {
                    if (!this.plugin.settings.pluginApi) {
                        this.plugin.settings.pluginApi = { enabled: true, safeMethodOverrides: {} };
                    }
                    this.plugin.settings.pluginApi.enabled = v;
                    await this.plugin.saveSettings();
                    this.rerender();
                }),
            );

        // Show built-in allowlist as read-only info
        if (this.plugin.settings.pluginApi?.enabled !== false) {
            const allowlistEl = containerEl.createDiv({ cls: 'agent-settings-info-block' });
            allowlistEl.createEl('h4', { text: 'Built-in Allowlist' });
            allowlistEl.createEl('p', {
                cls: 'agent-settings-desc',
                text: 'These plugin methods are pre-approved and can be called by the agent. Read methods can be auto-approved; write methods require explicit approval unless configured otherwise.',
            });

            // Group by plugin
            const byPlugin = new Map<string, typeof PLUGIN_API_ALLOWLIST>();
            for (const entry of PLUGIN_API_ALLOWLIST) {
                const list = byPlugin.get(entry.pluginId) ?? [];
                list.push(entry);
                byPlugin.set(entry.pluginId, list);
            }

            for (const [pluginId, methods] of byPlugin) {
                const group = allowlistEl.createDiv({ cls: 'agent-settings-allowlist-group' });
                group.createEl('strong', { text: pluginId });
                const list = group.createEl('ul');
                for (const m of methods) {
                    const li = list.createEl('li');
                    li.createEl('code', { text: m.method });
                    li.appendText(` — ${m.description}`);
                    if (m.isWrite) {
                        li.createEl('span', { cls: 'agent-settings-badge-write', text: ' write' });
                    }
                }
            }

            // Dynamic overrides
            const overrides = this.plugin.settings.pluginApi?.safeMethodOverrides ?? {};
            const overrideKeys = Object.keys(overrides).filter((k) => overrides[k]);
            if (overrideKeys.length > 0) {
                allowlistEl.createEl('h4', { text: 'User Safe-Marked Methods' });
                allowlistEl.createEl('p', {
                    cls: 'agent-settings-desc',
                    text: 'Dynamically discovered methods you marked as safe (read-only). Remove to require approval again.',
                });
                for (const key of overrideKeys) {
                    new Setting(allowlistEl)
                        .setName(key)
                        .setDesc('Marked as safe (read) — auto-approvable')
                        .addButton((btn) =>
                            btn.setButtonText('Remove').onClick(async () => {
                                delete this.plugin.settings.pluginApi.safeMethodOverrides[key];
                                await this.plugin.saveSettings();
                                this.rerender();
                            }),
                        );
                }
            }
        }

        // ── Recipe Section ──────────────────────────────────────────────────
        containerEl.createEl('h3', { cls: 'agent-settings-section', text: 'Recipes (External Tools)' });

        new Setting(containerEl)
            .setName('Enable recipes')
            .setDesc('Allow the agent to run pre-defined recipes for external tools like Pandoc. Programs run via spawn (no shell expansion). Each recipe must be individually enabled below.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.recipes?.enabled ?? false).onChange(async (v) => {
                    if (!this.plugin.settings.recipes) {
                        this.plugin.settings.recipes = { enabled: false, recipeToggles: {}, customRecipes: [] };
                    }
                    this.plugin.settings.recipes.enabled = v;
                    await this.plugin.saveSettings();
                    this.rerender();
                }),
            );

        if (this.plugin.settings.recipes?.enabled) {
            containerEl.createEl('h4', { text: 'Built-in Recipes' });

            const toggles = this.plugin.settings.recipes?.recipeToggles ?? {};

            for (const recipe of BUILT_IN_RECIPES) {
                const isEnabled = toggles[recipe.id] !== false; // default: enabled when master is on
                new Setting(containerEl)
                    .setName(recipe.name)
                    .setDesc(`${recipe.description} (binary: ${recipe.binary})`)
                    .addToggle((t) =>
                        t.setValue(isEnabled).onChange(async (v) => {
                            if (!this.plugin.settings.recipes) {
                                this.plugin.settings.recipes = { enabled: true, recipeToggles: {}, customRecipes: [] };
                            }
                            this.plugin.settings.recipes.recipeToggles[recipe.id] = v;
                            await this.plugin.saveSettings();
                        }),
                    );
            }
        }
    }
}
