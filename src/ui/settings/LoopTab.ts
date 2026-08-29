import { App, Notice, Setting, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { t } from '../../i18n';
import { DEFAULT_CONDENSING_ENABLED } from '../../core/condensingDefaults';
import {
    DEFAULT_USD_TO_EUR,
    USD_TO_EUR_LAST_UPDATED,
    getUsdToEur,
    isPlausibleUsdToEur,
} from '../../core/pricing/ModelPricing';
import { addInfoButton, addSectionHeading, addSliderInput } from './utils';

export class LoopTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    private buildIntroSection(containerEl: HTMLElement): void {
        const infoBanner = containerEl.createDiv('vault-op-box vault-op-box--intro');
        const infoIcon = infoBanner.createSpan({ cls: 'vault-op-box__icon' });
        setIcon(infoIcon, 'lightbulb');
        const infoText = infoBanner.createDiv({ cls: 'vault-op-box__text' });
        infoText.createEl('strong', { text: t('settings.loop.introTitle') });
        infoText.createDiv({ text: t('settings.loop.introDesc') });
    }

    private section(containerEl: HTMLElement, headingKey: string, descKey: string): void {
        addSectionHeading(containerEl, t(headingKey), { body: t(descKey) });
    }

    build(containerEl: HTMLElement): void {
        this.buildIntroSection(containerEl);

        // ── Limits & retries ─────────────────────────────────────────────
        this.section(containerEl, 'settings.loop.headingLoop', 'settings.loop.sectionLoopDesc');

        const errorLimitSetting = new Setting(containerEl)
            .setName(t('settings.loop.errorLimit'))
            .setDesc(t('settings.loop.errorLimitDesc'));
        addSliderInput(errorLimitSetting, {
            min: 0, max: 10, step: 1,
            value: this.plugin.settings.advancedApi.consecutiveMistakeLimit ?? 3,
            onChange: async (v) => {
                this.plugin.settings.advancedApi.consecutiveMistakeLimit = v;
                await this.plugin.saveSettings();
            },
        });

        const rateLimitSetting = new Setting(containerEl)
            .setName(t('settings.loop.rateLimit'))
            .setDesc(t('settings.loop.rateLimitDesc'));
        addSliderInput(rateLimitSetting, {
            min: 0, max: 3000, step: 100,
            value: this.plugin.settings.advancedApi.rateLimitMs ?? 0,
            onChange: async (v) => {
                this.plugin.settings.advancedApi.rateLimitMs = v;
                await this.plugin.saveSettings();
            },
        });

        // FEAT-30-07: Approval timeout lebt jetzt bei den Permissions
        // (Agent behaviour > Auto-approve), er gehoert zum Approval-System.

        const maxIterSetting = new Setting(containerEl)
            .setName(t('settings.loop.maxIterations'))
            .setDesc(t('settings.loop.maxIterationsDesc'));
        addInfoButton(maxIterSetting, t('settings.loop.maxIterations'), t('settings.loop.maxIterationsInfo'));
        addSliderInput(maxIterSetting, {
            min: 5, max: 50, step: 5,
            value: this.plugin.settings.advancedApi.maxIterations ?? 25,
            onChange: async (v) => {
                this.plugin.settings.advancedApi.maxIterations = v;
                await this.plugin.saveSettings();
            },
        });

        const maxDepthSetting = new Setting(containerEl)
            .setName(t('settings.loop.maxSubtaskDepth'))
            .setDesc(t('settings.loop.maxSubtaskDepthDesc'));
        addInfoButton(maxDepthSetting, t('settings.loop.maxSubtaskDepth'), t('settings.loop.maxSubtaskDepthInfo'));
        addSliderInput(maxDepthSetting, {
            min: 1, max: 3, step: 1,
            value: this.plugin.settings.advancedApi.maxSubtaskDepth ?? 2,
            onChange: async (v) => {
                this.plugin.settings.advancedApi.maxSubtaskDepth = v;
                await this.plugin.saveSettings();
            },
        });

        // ── Auto-summarise ──────────────────────────────────────────────
        this.section(containerEl, 'settings.loop.headingCondensing', 'settings.loop.sectionCondensingDesc');

        const condensingSetting = new Setting(containerEl)
            .setName(t('settings.loop.enableCondensing'))
            .setDesc(t('settings.loop.enableCondensingDesc'));
        condensingSetting.addToggle((c) =>
            c.setValue(this.plugin.settings.advancedApi.condensingEnabled ?? DEFAULT_CONDENSING_ENABLED).onChange(async (v) => {
                this.plugin.settings.advancedApi.condensingEnabled = v;
                await this.plugin.saveSettings();
                thresholdSetting.settingEl.classList.toggle('agent-u-hidden', !v);
            }),
        );

        const thresholdSetting = new Setting(containerEl)
            .setName(t('settings.loop.condensingThreshold'))
            .setDesc(t('settings.loop.condensingThresholdDesc'));
        addSliderInput(thresholdSetting, {
            min: 50, max: 95, step: 5,
            value: this.plugin.settings.advancedApi.condensingThreshold ?? 80,
            onChange: async (v) => {
                this.plugin.settings.advancedApi.condensingThreshold = v;
                await this.plugin.saveSettings();
            },
        });
        thresholdSetting.settingEl.classList.toggle('agent-u-hidden',
            !(this.plugin.settings.advancedApi.condensingEnabled ?? DEFAULT_CONDENSING_ENABLED));

        // ── Power steering ──────────────────────────────────────────────
        this.section(containerEl, 'settings.loop.headingPowerSteering', 'settings.loop.sectionPowerSteeringDesc');

        const powerSteeringSetting = new Setting(containerEl)
            .setName(t('settings.loop.powerSteeringFreq'))
            .setDesc(t('settings.loop.powerSteeringFreqDesc'));
        addSliderInput(powerSteeringSetting, {
            min: 0, max: 10, step: 1,
            value: this.plugin.settings.advancedApi.powerSteeringFrequency ?? 0,
            onChange: async (v) => {
                this.plugin.settings.advancedApi.powerSteeringFrequency = v;
                await this.plugin.saveSettings();
            },
        });

        // ── Task routing ────────────────────────────────────────────────
        this.section(containerEl, 'settings.loop.headingHelperModel', 'settings.loop.sectionRoutingDesc');

        const routerSetting = new Setting(containerEl)
            .setName(t('settings.loop.autoTaskRouterName'))
            .setDesc(t('settings.loop.autoTaskRouterDesc'));
        routerSetting.addToggle((toggle) =>
            toggle
                .setValue(this.plugin.settings.autoTaskRouter?.enabled ?? true)
                .onChange(async (v) => {
                    this.plugin.settings.autoTaskRouter = { enabled: v };
                    await this.plugin.saveSettings();
                }),
        );

        const leanPromptSetting = new Setting(containerEl)
            .setName(t('settings.loop.leanSystemPromptName'))
            .setDesc(t('settings.loop.leanSystemPromptDesc'));
        leanPromptSetting.addToggle((toggle) =>
            toggle
                .setValue(this.plugin.settings.leanSystemPrompt ?? false)
                .onChange(async (v) => {
                    this.plugin.settings.leanSystemPrompt = v;
                    await this.plugin.saveSettings();
                }),
        );

        this.buildCostSection(containerEl);
    }

    /**
     * FEAT-24-12: the numbers behind the euro amount in the chat footer.
     *
     * All three were unreachable before: the conversion rate was a module
     * constant with a comment claiming it was configurable, the override map had
     * a setter with no caller, and the fetched catalog carried a timestamp
     * nothing displayed, so no part of the UI said how old the prices were.
     */
    private buildCostSection(containerEl: HTMLElement): void {
        this.section(containerEl, 'settings.loop.headingCost', 'settings.loop.sectionCostDesc');

        const advanced = this.plugin.settings.advancedApi;

        // ── USD to EUR ───────────────────────────────────────────────────
        const rateSetting = new Setting(containerEl)
            .setName(t('settings.loop.usdToEur'))
            .setDesc(t('settings.loop.usdToEurDesc', {
                rate: String(DEFAULT_USD_TO_EUR),
                date: USD_TO_EUR_LAST_UPDATED,
            }));
        addInfoButton(rateSetting, t('settings.loop.usdToEur'), t('settings.loop.usdToEurInfo'));
        // A stored value outside the band (hand-edited data.json, or the
        // cross-vault settings file) is NOT the rate the footer converts with.
        // Flag it on render rather than showing it as if it were in effect.
        rateSetting.settingEl.classList.toggle('agent-settings-invalid',
            advanced.usdToEurRate !== undefined && !isPlausibleUsdToEur(advanced.usdToEurRate));
        rateSetting.addText((text) => {
            text.setPlaceholder(String(DEFAULT_USD_TO_EUR))
                .setValue(String(advanced.usdToEurRate ?? getUsdToEur()))
                .onChange(async (raw) => {
                    const trimmed = raw.trim();
                    // Empty means "use the documented default", which is a
                    // valid answer and must clear the stored value.
                    const parsed = trimmed === '' ? undefined : Number(trimmed);
                    if (parsed !== undefined && !isPlausibleUsdToEur(parsed)) {
                        // Mid-typing states ('0.', '') and slipped decimal
                        // points land here. Flag the field and keep the last
                        // good value; never persist a NaN into the money math.
                        rateSetting.settingEl.classList.add('agent-settings-invalid');
                        return;
                    }
                    rateSetting.settingEl.classList.remove('agent-settings-invalid');
                    advanced.usdToEurRate = parsed;
                    await this.plugin.saveSettings();
                    // saveSettings applies the config too. Stated again here so
                    // the tab does not depend on that detail staying true: an
                    // unapplied rate is invisible until the next reload.
                    this.plugin.applyPricingSettings();
                });
        });

        // ── Per-model overrides ──────────────────────────────────────────
        const overrideSetting = new Setting(containerEl)
            .setName(t('settings.loop.priceOverrides'))
            .setDesc(t('settings.loop.priceOverridesDesc'));
        addInfoButton(overrideSetting, t('settings.loop.priceOverrides'), t('settings.loop.priceOverridesInfo'));
        const overrideStatus = containerEl.createEl('p', { cls: 'agent-settings-desc' });
        const showInvalid = (invalidLines: string[]): void => {
            overrideStatus.setText(invalidLines.length === 0
                ? ''
                : t('settings.loop.priceOverridesInvalid', { lines: invalidLines.join(' | ') }));
            overrideStatus.classList.toggle('agent-settings-invalid', invalidLines.length > 0);
        };
        // No placeholder here on purpose: an example model id is lowercase by
        // nature and the sentence-case lint rule (rightly) cannot tell that
        // from a badly capitalised label. The format is in the description and
        // the info popover instead.
        overrideSetting.addTextArea((text) => {
            text.setValue(advanced.priceOverridesText ?? '')
                .onChange(async (raw) => {
                    advanced.priceOverridesText = raw;
                    await this.plugin.saveSettings();
                    // saveSettings applies the config too; the return value is
                    // what the user needs, so read it here.
                    showInvalid(this.plugin.applyPricingSettings());
                });
        });
        showInvalid(this.plugin.applyPricingSettings());

        // ── Fetched catalog: age plus a manual refresh ───────────────────
        const fetchedAt = this.plugin.priceCatalog?.getLastFetchedAt() ?? null;
        const catalogSetting = new Setting(containerEl)
            .setName(t('settings.loop.priceCatalog'))
            .setDesc(fetchedAt === null
                ? t('settings.loop.priceCatalogNever')
                : t('settings.loop.priceCatalogUpdated', { when: new Date(fetchedAt).toLocaleString() }));
        catalogSetting.addButton((btn) =>
            btn.setButtonText(t('settings.loop.priceCatalogRefresh'))
                .onClick(() => { void this.refreshPriceCatalog(); }),
        );
    }

    /**
     * Force a catalog fetch, TTL be damned: the boot refresh is capped at once
     * per 24h, and a user who presses a button now wants prices now. The
     * outcome is reported either way, so a silent failure cannot look like a
     * successful update.
     */
    private async refreshPriceCatalog(): Promise<void> {
        const ok = await this.plugin.priceCatalog?.refresh({ force: true });
        new Notice(ok ? t('notice.priceCatalogRefreshed') : t('notice.priceCatalogRefreshFailed'));
        // Re-render so the timestamp above reflects the fetch.
        this.rerender();
    }
}
