import { App, Setting } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { BUILT_IN_RECIPES } from '../../core/tools/agent/recipeRegistry';
import { PLUGIN_API_ALLOWLIST } from '../../core/tools/agent/pluginApiAllowlist';
import { t } from '../../i18n';


export class ShellTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    build(containerEl: HTMLElement): void {
        containerEl.createEl('p', {
            cls: 'agent-settings-desc',
            text: t('settings.shell.desc'),
        });

        // ── Plugin API Section ──────────────────────────────────────────────
        containerEl.createEl('h3', { cls: 'agent-settings-section', text: t('settings.shell.headingPluginApi') });

        new Setting(containerEl)
            .setName(t('settings.shell.enablePluginApi'))
            .setDesc(t('settings.shell.enablePluginApiDesc'))
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

        // Show built-in allowlist as Setting items
        if (this.plugin.settings.pluginApi?.enabled !== false) {
            containerEl.createEl('h4', { cls: 'agent-settings-section', text: t('settings.shell.headingAllowlist') });
            containerEl.createEl('p', {
                cls: 'agent-settings-desc',
                text: t('settings.shell.allowlistDesc'),
            });

            // Group by plugin
            const byPlugin = new Map<string, typeof PLUGIN_API_ALLOWLIST>();
            for (const entry of PLUGIN_API_ALLOWLIST) {
                const list = byPlugin.get(entry.pluginId) ?? [];
                list.push(entry);
                byPlugin.set(entry.pluginId, list);
            }

            for (const [pluginId, methods] of byPlugin) {
                for (const m of methods) {
                    const badge = m.isWrite ? t('settings.shell.badgeWrite') : t('settings.shell.badgeRead');
                    new Setting(containerEl)
                        .setName(`${pluginId}.${m.method}`)
                        .setDesc(`${m.description}${badge}`);
                }
            }

            // Dynamic overrides
            const overrides = this.plugin.settings.pluginApi?.safeMethodOverrides ?? {};
            const overrideKeys = Object.keys(overrides).filter((k) => overrides[k]);
            if (overrideKeys.length > 0) {
                containerEl.createEl('h4', { cls: 'agent-settings-section', text: t('settings.shell.headingUserSafe') });
                containerEl.createEl('p', {
                    cls: 'agent-settings-desc',
                    text: t('settings.shell.userSafeDesc'),
                });
                for (const key of overrideKeys) {
                    new Setting(containerEl)
                        .setName(key)
                        .setDesc(t('settings.shell.markedSafe'))
                        .addButton((btn) =>
                            btn.setButtonText(t('settings.shell.remove')).onClick(async () => {
                                delete this.plugin.settings.pluginApi.safeMethodOverrides[key];
                                await this.plugin.saveSettings();
                                this.rerender();
                            }),
                        );
                }
            }
        }

        // ── Recipe Section ──────────────────────────────────────────────────
        containerEl.createEl('h3', { cls: 'agent-settings-section', text: t('settings.shell.headingRecipes') });

        new Setting(containerEl)
            .setName(t('settings.shell.enableRecipes'))
            .setDesc(t('settings.shell.enableRecipesDesc'))
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
            containerEl.createEl('h4', { cls: 'agent-settings-section', text: t('settings.shell.headingBuiltinRecipes') });

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
