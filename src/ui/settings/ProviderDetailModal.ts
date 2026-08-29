/**
 * EPIC-26 / FEAT-26-03 -- provider configuration modal (new + existing).
 *
 * Uses Obsidian's native `Setting` API for the form rows so the layout
 * matches the rest of the settings pages (wide info column, description
 * inline next to the name, control on the right). Section headers stay
 * as custom `.mcm-section` markers; action buttons at the bottom stay
 * in a `.mcm-actions` flex bar so Save/Cancel sit together on the right.
 *
 * Draft state lives in `form*` fields; nothing persists until the user
 * clicks Save. Provider-type can be swapped via a dropdown at the top.
 * Discovery + tier-mapping appear only for already-saved providers (a
 * fresh draft has no model list to map).
 */

import { App, Modal, Notice, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { confirmModal } from '../modals/PromptModal';
import type {
    CustomModel,
    DiscoveredModel,
    ModelTier,
    ProviderConfig,
    ProviderType,
} from '../../types/settings';
import {
    getDefaultBaseUrlForProvider,
    getProviderBrandLabel,
    getTierBadgeLabel,
} from '../../types/settings';
import { purgeProviderLegacyState } from '../../core/security/providerLegacyPurge';
import { GitHubCopilotAuthService } from '../../core/security/GitHubCopilotAuthService';
import { ChatGptOAuthService } from '../../core/auth/ChatGptOAuthService';
import {
    CHATGPT_OAUTH_DEFAULT_TEST_MODEL,
    getLastChatGptOAuthModelFetch,
} from '../../api/providers/chatgpt-oauth';
import { isOpenAIChatCompletionModel } from './testModelConnection';
import { t } from '../../i18n';
import { openInfoPopover } from './utils';
import {
    MANUAL_TIER_INPUT_CLS,
    MANUAL_TIER_OPTION_VALUE,
    providerSupportsManualModelId,
    resolveTierSlotView,
} from './manualModelEntry';
import { buildEffortOptInView, type EffortOptInView } from './effortOptIn';
import { requiresRequestMarkers } from '../../api/capabilities';

const TIER_ORDER: ModelTier[] = ['fast', 'mid', 'flagship'];

const CLOUD_PROVIDER_TYPES: ProviderType[] = [
    'anthropic', 'openai', 'gemini', 'openrouter', 'azure', 'bedrock',
];
const OAUTH_PROVIDER_TYPES: ProviderType[] = ['github-copilot', 'chatgpt-oauth'];
const LOCAL_PROVIDER_TYPES: ProviderType[] = ['ollama', 'lmstudio', 'custom'];
const ALL_PROVIDER_TYPES: ProviderType[] = [
    ...CLOUD_PROVIDER_TYPES,
    ...OAUTH_PROVIDER_TYPES,
    ...LOCAL_PROVIDER_TYPES,
    'kilo-gateway',
];

export class ProviderDetailModal extends Modal {
    private isNew: boolean;
    private originalId: string | null;

    // Draft state
    private formType: ProviderType;
    private formDisplayName: string;
    private formEnabled: boolean;
    private formApiKey: string;
    private formBaseUrl: string;
    private formApiVersion: string;
    private formAwsRegion: string;
    private formAwsAuthMode: 'api-key' | 'access-key' | 'gateway';
    private formAwsApiKey: string;
    private formAwsAccessKey: string;
    private formAwsSecretKey: string;
    private formAwsSessionToken: string;
    /** FEAT-26-07: enterprise gateway header (Bedrock + Anthropic). */
    private formGatewayHeaderName: string;
    private formGatewayHeaderValue: string;
    private formUseGateway: boolean;

    private discoveredModels: DiscoveredModel[];
    private lastRefreshAt: number;
    private tierMapping: ProviderConfig['tierMapping'];
    private tierOverrides: ProviderConfig['tierOverrides'];

    /**
     * IMP-54-05b (issue #54): per-model reasoning-effort opt-in draft.
     * Only ids with an explicit true live in the map (toggling off deletes
     * the entry), so an empty map saves as undefined and untouched configs
     * stay byte-identical.
     */
    private effortOptIn: Record<string, boolean>;

    /**
     * IMP-20-06-01 W4-T2 / ADR-135. User-affirmed Zero-Data-Retention
     * flag. Off by default. Only providers with this flag enabled can
     * serve the freshness verifier's frontier-tier escalations.
     */
    private formZdrCapable: boolean;
    /**
     * D3: prompt-caching opt-out for this provider. Undefined in the stored
     * config means "on" (ADR-111 default-switch), so the form seeds to true.
     */
    private formPromptCachingEnabled: boolean;

    /**
     * Per-tier flag: the user picked "enter id manually" for a slot whose
     * override is still empty. Keeps the free-text input visible across the
     * re-render so it does not snap back to the dropdown before anything is
     * typed. Only relevant for providers without a model listing endpoint.
     */
    private manualTierRequested: Partial<Record<ModelTier, boolean>> = {};

    constructor(
        app: App,
        private readonly plugin: ObsidianAgentPlugin,
        provider: ProviderConfig | null,
        private readonly onAfterChange: () => void,
    ) {
        super(app);
        this.isNew = provider === null;
        this.originalId = provider?.id ?? null;
        const seed = provider ?? this.defaultDraftProvider();
        this.formType = seed.type;
        this.formDisplayName = seed.displayName ?? '';
        this.formEnabled = seed.enabled;
        this.formApiKey = seed.apiKey ?? '';
        // Local providers (ollama, lmstudio) only work with a concrete base URL.
        // The placeholder-only pattern that cloud providers use leaves an empty
        // draft, and Discovery then falls back to the wrong default port. Seed
        // the field with the known local default so Refresh works out-of-the-box.
        this.formBaseUrl = seed.baseUrl
            ?? (this.isNew ? getDefaultBaseUrlForProvider(seed.type) ?? '' : '');
        this.formApiVersion = seed.apiVersion ?? '';
        this.formAwsRegion = seed.awsRegion ?? '';
        this.formAwsAuthMode = seed.awsAuthMode ?? 'api-key';
        this.formAwsApiKey = seed.awsApiKey ?? '';
        this.formAwsAccessKey = seed.awsAccessKey ?? '';
        this.formAwsSecretKey = seed.awsSecretKey ?? '';
        this.formAwsSessionToken = seed.awsSessionToken ?? '';
        this.formGatewayHeaderName = seed.gatewayHeaderName ?? 'Ocp-Apim-Subscription-Key';
        this.formGatewayHeaderValue = seed.gatewayHeaderValue ?? '';
        this.formUseGateway = seed.useGateway ?? false;
        this.discoveredModels = seed.discoveredModels ?? [];
        this.lastRefreshAt = seed.lastRefreshAt ?? 0;
        this.tierMapping = { ...(seed.tierMapping ?? {}) };
        this.tierOverrides = { ...(seed.tierOverrides ?? {}) };
        this.effortOptIn = { ...(seed.effortOptIn ?? {}) };
        this.formZdrCapable = seed.zdrCapable ?? false;
        this.formPromptCachingEnabled = seed.promptCachingEnabled !== false;
    }

    private defaultDraftProvider(): ProviderConfig {
        return {
            id: '',
            type: 'anthropic',
            displayName: '',
            enabled: true,
            discoveredModels: [],
            lastRefreshAt: 0,
            tierMapping: {},
            tierOverrides: {},
        };
    }

    onOpen(): void {
        this.render();
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private mkSection(parent: HTMLElement, title: string): void {
        parent.createEl('h4', { cls: 'mcm-section', text: title });
    }

    /**
     * Compact form row matching ModelConfigModal's `.mcm-row` layout
     * (110px label, 1fr control, 12px font). When `desc` is provided,
     * a clean Lucide info-icon sits next to the label; clicking it
     * opens a small popover with the description text at the same
     * size as the settings info-banners (13px). No extra border or
     * background on the icon -- just the `i`-in-circle Lucide glyph
     * in muted color.
     */
    private compactRow(
        parent: HTMLElement,
        opts: { label: string; desc?: string; build: (controlEl: HTMLElement) => void },
    ): HTMLDivElement {
        const row = parent.createDiv('mcm-row');
        const labelEl = row.createDiv('mcm-label');
        const labelLine = labelEl.createDiv('mcm-label-line');
        labelLine.createSpan({ text: opts.label });
        if (opts.desc) {
            const infoBtn = labelLine.createEl('button', {
                cls: 'agent-info-btn',
                attr: {
                    type: 'button',
                    'aria-label': t('settings.providers.modal.infoAria', { label: opts.label }),
                },
            });
            setIcon(infoBtn, 'info');
            infoBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                openInfoPopover(opts.label, opts.desc!);
            });
        }
        const controlEl = row.createDiv('mcm-control');
        opts.build(controlEl);
        return row;
    }

    /** Helper: text/password input matching `.mcm-input` styling. */
    private compactInput(
        parent: HTMLElement,
        opts: {
            type?: 'text' | 'password';
            value: string;
            placeholder?: string;
            onInput: (v: string) => void;
        },
    ): HTMLInputElement {
        const input = parent.createEl('input', {
            cls: 'mcm-input',
            attr: { type: opts.type ?? 'text' },
        });
        input.value = opts.value;
        if (opts.placeholder) input.placeholder = opts.placeholder;
        input.addEventListener('input', () => opts.onInput(input.value));
        return input;
    }

    /** Helper: select dropdown matching `.mcm-select` styling. */
    private compactSelect(
        parent: HTMLElement,
        opts: {
            value: string;
            options: Array<{ value: string; label: string }>;
            onChange: (v: string) => void;
        },
    ): HTMLSelectElement {
        const select = parent.createEl('select', { cls: 'mcm-select' });
        for (const o of opts.options) {
            select.createEl('option', { value: o.value, text: o.label });
        }
        select.value = opts.value;
        select.addEventListener('change', () => opts.onChange(select.value));
        return select;
    }

    /** Helper: native checkbox toggle that visually matches `.mcm-toggle`. */
    private compactToggle(
        parent: HTMLElement,
        opts: { value: boolean; onChange: (v: boolean) => void },
    ): HTMLInputElement {
        const label = parent.createEl('label', { cls: 'mc-toggle' });
        const input = label.createEl('input', { attr: { type: 'checkbox' } });
        label.createSpan({ cls: 'mc-toggle-track' });
        input.checked = opts.value;
        input.addEventListener('change', () => opts.onChange(input.checked));
        return input;
    }

    /** Helper: button matching the compact ModelConfigModal action buttons. */
    private compactButton(
        parent: HTMLElement,
        opts: {
            text: string;
            variant?: 'default' | 'cta' | 'warning';
            onClick: (btn: HTMLButtonElement) => void;
        },
    ): HTMLButtonElement {
        const cls = ['mcm-btn'];
        if (opts.variant === 'cta') cls.push('mod-cta');
        if (opts.variant === 'warning') cls.push('mod-warning');
        const btn = parent.createEl('button', { cls: cls.join(' '), text: opts.text });
        btn.addEventListener('click', () => opts.onClick(btn));
        return btn;
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('model-config-modal', 'provider-detail-modal');

        contentEl.createEl('h3', {
            cls: 'modal-title',
            text: this.isNew
                ? t('settings.providers.modal.titleNew')
                : t('settings.providers.modal.title', {
                    name: this.formDisplayName || getProviderBrandLabel(this.formType),
                }),
        });

        // Wrap the form in `.mcm-form` so row spacing matches
        // ModelConfigModal's compact layout (12px font, 8px gap).
        const form = contentEl.createDiv('mcm-form');

        // ── Identity section ─────────────────────────────────────────────
        this.mkSection(form, t('settings.providers.modal.section.identity'));

        this.compactRow(form, {
            label: t('settings.providers.modal.providerType'),
            build: (ctrl) => this.compactSelect(ctrl, {
                value: this.formType,
                options: ALL_PROVIDER_TYPES.map((type) => ({
                    value: type,
                    label: getProviderBrandLabel(type),
                })),
                onChange: (v) => {
                    const previous = this.formType;
                    this.formType = v as ProviderType;
                    const prevDefault = getDefaultBaseUrlForProvider(previous) ?? '';
                    if (!this.formBaseUrl || this.formBaseUrl === prevDefault) {
                        this.formBaseUrl = LOCAL_PROVIDER_TYPES.includes(this.formType)
                            ? getDefaultBaseUrlForProvider(this.formType) ?? ''
                            : '';
                    }
                    // Audit L-4 mitigation (AUDIT-IMP-20-06-01-2026-06-19):
                    // the ZDR affirmation belongs to one specific
                    // provider type. Changing the type invalidates it
                    // and the user must re-confirm with the new vendor.
                    if (previous !== this.formType) {
                        this.formZdrCapable = false;
                    }
                    this.render();
                },
            }),
        });

        this.compactRow(form, {
            label: t('settings.providers.modal.displayName'),
            desc: t('settings.providers.modal.displayNameDesc'),
            build: (ctrl) => this.compactInput(ctrl, {
                value: this.formDisplayName,
                placeholder: getProviderBrandLabel(this.formType),
                onInput: (v) => { this.formDisplayName = v; },
            }),
        });

        this.compactRow(form, {
            label: t('settings.providers.enabled'),
            build: (ctrl) => this.compactToggle(ctrl, {
                value: this.formEnabled,
                onChange: (v) => { this.formEnabled = v; },
            }),
        });

        // ── Authentication section ──────────────────────────────────────
        this.mkSection(form, t('settings.providers.modal.section.auth'));
        this.renderAuthSection(form);

        // Discovery + Tier mapping only for already-saved providers.
        if (!this.isNew) {
            this.mkSection(form, t('settings.providers.modal.section.discovery'));
            this.renderDiscoverySection(form);

            this.mkSection(form, t('settings.providers.modal.section.tiers'));
            // Tier-mapping intro infobox -- mirrors the settings-tab info-banner
            // pattern so the user understands what these three slots are for.
            this.renderTierInfoBanner(form);
            for (const tier of TIER_ORDER) {
                this.renderTierRow(form, tier);
            }
            // Advisor-disabled callout when refresh ran but flagship slot is still empty.
            if (this.discoveredModels.length === 0) {
                form.createDiv({
                    cls: 'mcm-hint',
                    text: t('settings.providers.modal.tiersAfterRefresh'),
                });
            } else if (!this.resolveDraftTierSlot('flagship')) {
                const warn = form.createDiv({ cls: 'mcm-warn' });
                const icon = warn.createSpan({ cls: 'mcm-warn-icon' });
                setIcon(icon, 'alert-triangle');
                warn.createSpan({ text: ' ' + t('settings.providers.advisorDisabled') });
            }

            // IMP-54-05b (issue #54): reasoning-effort opt-in for custom /
            // OpenAI-compatible endpoints whose reasoning models the static
            // registry cannot know. Hidden entirely when the provider type
            // cannot carry the field or there is nothing to opt in.
            const effortView = this.buildEffortOptInDraftView();
            if (effortView && (effortView.optedIn.length > 0 || effortView.available.length > 0)) {
                this.mkSection(form, t('settings.providers.modal.section.effort'));
                this.renderEffortOptInSection(form, effortView);
            }

            // D3: prompt-caching switch on the path that is actually in use.
            // Only rendered when at least one tier model of this provider needs
            // markers FROM US: where a provider caches implicitly there is
            // nothing a switch could change, and a placebo control is what made
            // the old per-model toggle misleading in the first place.
            if (this.providerNeedsCacheMarkers()) {
                this.mkSection(form, t('settings.providers.modal.section.caching'));
                this.compactRow(form, {
                    label: t('settings.providers.promptCaching'),
                    desc: t('settings.providers.promptCachingDesc'),
                    build: (ctrl) => this.compactToggle(ctrl, {
                        value: this.formPromptCachingEnabled,
                        onChange: (v) => { this.formPromptCachingEnabled = v; },
                    }),
                });
            }

            // IMP-20-06-01 W4-T2: ZDR affirmation. Single toggle inside
            // a labelled sub-section. Frontier escalation for the
            // freshness verifier needs at least one provider with this
            // flag on.
            this.mkSection(form, t('settings.providers.modal.section.privacy'));
            this.compactRow(form, {
                label: t('settings.providers.zdrConfirmed'),
                desc: t('settings.providers.zdrConfirmedDesc'),
                build: (ctrl) => {
                    const label = ctrl.createEl('label', { cls: 'mc-toggle' });
                    const input = label.createEl('input', { attr: { type: 'checkbox' } });
                    label.createSpan({ cls: 'mc-toggle-track' });
                    input.checked = this.formZdrCapable;
                    input.addEventListener('change', () => {
                        this.formZdrCapable = input.checked;
                    });
                },
            });

            this.mkSection(form, t('settings.providers.modal.section.danger'));
            this.compactRow(form, {
                label: t('settings.providers.removeProvider'),
                desc: t('settings.providers.removeDesc'),
                build: (ctrl) => this.compactButton(ctrl, {
                    text: t('settings.providers.removeProvider'),
                    variant: 'warning',
                    onClick: () => { void this.handleRemove(); },
                }),
            });
        } else {
            this.mkSection(form, t('settings.providers.modal.section.discovery'));
            form.createDiv({
                cls: 'mcm-hint',
                text: t('settings.providers.modal.discoveryAfterSave'),
            });
        }

        // ── Footer actions ─────────────────────────────────────────────
        const actions = contentEl.createDiv('mcm-actions');
        const cancelBtn = actions.createEl('button', {
            text: t('settings.providers.modal.cancel'),
        });
        cancelBtn.addEventListener('click', () => this.close());
        const saveBtn = actions.createEl('button', {
            cls: 'mod-cta',
            text: this.isNew
                ? t('settings.providers.modal.addProvider')
                : t('settings.providers.modal.save'),
        });
        saveBtn.addEventListener('click', () => { void this.handleSave(); });
    }

    // ── Section helpers ───────────────────────────────────────────────

    private renderTierInfoBanner(parent: HTMLElement): void {
        const banner = parent.createDiv({ cls: 'vault-op-box vault-op-box--intro' });
        const icon = banner.createSpan({ cls: 'vault-op-box__icon' });
        setIcon(icon, 'info');
        const text = banner.createDiv({ cls: 'vault-op-box__text' });
        text.createEl('strong', { text: t('settings.providers.modal.tierInfoTitle') });
        text.createDiv({ text: t('settings.providers.modal.tierInfoBody') });
    }

    // ── Save / Remove / Test ──────────────────────────────────────────

    private async handleSave(): Promise<void> {
        const trimmedDisplayName = this.formDisplayName.trim() || getProviderBrandLabel(this.formType);
        const list = [...(this.plugin.settings.providerConfigs ?? [])];
        const credsChanged = this.isNew || this.hasUnsavedAuthChanges();

        if (this.isNew) {
            const id = this.allocateInstanceId(this.formType);
            const provider: ProviderConfig = {
                id,
                type: this.formType,
                displayName: trimmedDisplayName,
                enabled: this.formEnabled,
                apiKey: this.formApiKey.trim() || undefined,
                baseUrl: this.formBaseUrl.trim() || undefined,
                apiVersion: this.formApiVersion.trim() || undefined,
                awsRegion: this.formAwsRegion.trim() || undefined,
                awsAuthMode: this.formAwsAuthMode,
                awsApiKey: this.formAwsApiKey.trim() || undefined,
                awsAccessKey: this.formAwsAccessKey.trim() || undefined,
                awsSecretKey: this.formAwsSecretKey.trim() || undefined,
                awsSessionToken: this.formAwsSessionToken.trim() || undefined,
                gatewayHeaderName: this.formAwsAuthMode === 'gateway' || (this.formType === 'anthropic' && this.formUseGateway)
                    ? (this.formGatewayHeaderName.trim() || undefined)
                    : undefined,
                gatewayHeaderValue: this.formAwsAuthMode === 'gateway' || (this.formType === 'anthropic' && this.formUseGateway)
                    ? (this.formGatewayHeaderValue.trim() || undefined)
                    : undefined,
                useGateway: this.formType === 'anthropic' ? this.formUseGateway : undefined,
                discoveredModels: [],
                lastRefreshAt: 0,
                tierMapping: {},
                tierOverrides: {},
            };
            list.push(provider);
            this.plugin.settings.providerConfigs = list;
            if (this.plugin.settings.activeProviderId === null) {
                this.plugin.settings.activeProviderId = id;
            }
            await this.plugin.saveSettings();
            this.onAfterChange();
            this.isNew = false;
            this.originalId = id;
            this.render();
            await this.maybeAutoRefresh(id, trimmedDisplayName, credsChanged);
            return;
        }

        const idx = list.findIndex((p) => p.id === this.originalId);
        if (idx < 0) {
            new Notice(t('settings.providers.modal.notFound'));
            this.close();
            return;
        }
        list[idx] = {
            ...list[idx],
            type: this.formType,
            displayName: trimmedDisplayName,
            enabled: this.formEnabled,
            apiKey: this.formApiKey.trim() || undefined,
            baseUrl: this.formBaseUrl.trim() || undefined,
            apiVersion: this.formApiVersion.trim() || undefined,
            awsRegion: this.formAwsRegion.trim() || undefined,
            awsAuthMode: this.formAwsAuthMode,
            awsApiKey: this.formAwsApiKey.trim() || undefined,
            awsAccessKey: this.formAwsAccessKey.trim() || undefined,
            awsSecretKey: this.formAwsSecretKey.trim() || undefined,
            awsSessionToken: this.formAwsSessionToken.trim() || undefined,
            gatewayHeaderName: this.formAwsAuthMode === 'gateway' || (this.formType === 'anthropic' && this.formUseGateway)
                ? (this.formGatewayHeaderName.trim() || undefined)
                : undefined,
            gatewayHeaderValue: this.formAwsAuthMode === 'gateway' || (this.formType === 'anthropic' && this.formUseGateway)
                ? (this.formGatewayHeaderValue.trim() || undefined)
                : undefined,
            useGateway: this.formType === 'anthropic' ? this.formUseGateway : undefined,
            tierMapping: this.tierMapping,
            tierOverrides: this.tierOverrides,
            effortOptIn: Object.keys(this.effortOptIn).length > 0 ? this.effortOptIn : undefined,
            zdrCapable: this.formZdrCapable || undefined,
            // D3: only an explicit OFF is stored. Writing `true` would be
            // indistinguishable from the ADR-111 default and would grow every
            // config by a field that changes nothing.
            promptCachingEnabled: this.formPromptCachingEnabled ? undefined : false,
        };
        this.plugin.settings.providerConfigs = list;
        await this.plugin.saveSettings();
        this.onAfterChange();
        if (credsChanged && this.originalId) {
            this.render();
            await this.maybeAutoRefresh(this.originalId, trimmedDisplayName, true);
            return;
        }
        this.close();
    }

    private async maybeAutoRefresh(providerId: string, displayName: string, credsChanged: boolean): Promise<void> {
        if (!credsChanged) return;
        if (!this.hasAnyCredentials()) return;
        const discovery = this.plugin.modelDiscovery;
        if (!discovery) return;
        new Notice(t('settings.providers.modal.autoFetching', { name: displayName }));
        try {
            const result = await discovery.refreshProvider(providerId);
            const persisted = (this.plugin.settings.providerConfigs ?? []).find((p) => p.id === providerId);
            this.discoveredModels = result;
            this.lastRefreshAt = persisted?.lastRefreshAt ?? Date.now();
            this.tierMapping = { ...(persisted?.tierMapping ?? {}) };
            this.onAfterChange();
            new Notice(t('settings.providers.modal.autoFetched', {
                count: result.length,
                name: displayName,
            }));
            this.render();
        } catch (e) {
            console.warn('[ProviderDetailModal] auto-refresh failed:', e);
            new Notice(t('settings.providers.modal.autoFetchFailed', {
                msg: (e as Error).message,
            }));
        }
    }

    /**
     * EPIC-26 / FEAT-26-03 follow-up -- live credential probe. Builds a
     * CustomModel from the draft (no save required) and runs the existing
     * `testModelConnection` helper that the legacy ModelConfigModal uses.
     * Picks the highest-tier model the provider has discovered so far so
     * the probe exercises a model the user actually intends to use; falls
     * back to the first discovered model when no tier is set yet; falls
     * back further to a provider-default placeholder name for fresh drafts.
     */
    private async handleTestConnection(btn: HTMLButtonElement): Promise<void> {
        if (!this.hasAnyCredentials()) {
            new Notice(t('settings.providers.modal.testNoCreds'));
            return;
        }
        const modelId = this.pickModelForTest();
        const model: CustomModel = {
            name: modelId,
            provider: this.formType,
            displayName: this.formDisplayName || getProviderBrandLabel(this.formType),
            apiKey: this.formApiKey.trim() || undefined,
            baseUrl: this.formBaseUrl.trim() || undefined,
            apiVersion: this.formApiVersion.trim() || undefined,
            enabled: true,
            awsRegion: this.formAwsRegion.trim() || undefined,
            awsAuthMode: this.formAwsAuthMode,
            awsApiKey: this.formAwsApiKey.trim() || undefined,
            awsAccessKey: this.formAwsAccessKey.trim() || undefined,
            awsSecretKey: this.formAwsSecretKey.trim() || undefined,
            awsSessionToken: this.formAwsSessionToken.trim() || undefined,
            gatewayHeaderName: this.formAwsAuthMode === 'gateway' || (this.formType === 'anthropic' && this.formUseGateway)
                ? (this.formGatewayHeaderName.trim() || undefined)
                : undefined,
            gatewayHeaderValue: this.formAwsAuthMode === 'gateway' || (this.formType === 'anthropic' && this.formUseGateway)
                ? (this.formGatewayHeaderValue.trim() || undefined)
                : undefined,
            useGateway: this.formType === 'anthropic' ? this.formUseGateway : undefined,
        };
        btn.disabled = true;
        const originalLabel = btn.getText();
        btn.setText(t('settings.providers.modal.testing'));
        try {
            const { testModelConnection } = await import('./testModelConnection');
            const result = await testModelConnection(model);
            if (result.ok) {
                new Notice(t('settings.providers.modal.testOk', { msg: result.message }));
            } else {
                const detail = result.detail ? ` -- ${result.detail}` : '';
                new Notice(t('settings.providers.modal.testFail', {
                    msg: result.message + detail,
                }));
            }
        } catch (e) {
            console.warn('[ProviderDetailModal] testConnection failed:', e);
            new Notice(t('settings.providers.modal.testFail', { msg: (e as Error).message }));
        } finally {
            btn.disabled = false;
            btn.setText(originalLabel);
        }
    }

    private pickModelForTest(): string {
        // Collect tier candidates in priority order, then fall back to the
        // discovered list. For OpenAI we additionally filter out IDs that
        // are not callable via /v1/chat/completions (realtime, tts, audio,
        // image, search, deep-research, *-pro, *-codex). Without this the
        // test-connection picks a polluted tier entry from before the
        // EXCLUDE_RE was tightened, fires chat.completions, and returns
        // a confusing 404 / 400.
        const candidates: string[] = [];
        for (const tier of (['flagship', 'mid', 'fast'] as ModelTier[])) {
            const id = this.tierOverrides?.[tier] ?? this.tierMapping?.[tier];
            if (id) candidates.push(id);
        }
        for (const m of this.discoveredModels) candidates.push(m.id);
        const accept = this.formType === 'openai'
            ? isOpenAIChatCompletionModel
            : (_: string) => true;
        const picked = candidates.find(accept);
        if (picked) return picked;
        // ChatGPT OAuth has no `/v1/models` endpoint, so the legacy
        // "test-probe" fallback would surface the placeholder to the Codex
        // backend (HTTP 400 "model not found"). Use a known-good Codex model
        // instead so Test Connection still works right after sign-in, before
        // the background discovery has populated tierMapping/discoveredModels.
        // FIX-55-03: was the hardcoded 'gpt-5', an id the backend retired
        // (400s as "not supported"); the shared constant tracks the lineup.
        if (this.formType === 'chatgpt-oauth') return CHATGPT_OAUTH_DEFAULT_TEST_MODEL;
        // Provider-default placeholder for fresh drafts -- enough to ping the
        // /v1/models endpoint via testModelConnection which calls fetchProviderModels.
        return 'test-probe';
    }

    private async handleRemove(): Promise<void> {
        const ok = await confirmModal(this.app, {
            title: t('settings.providers.removeProvider'),
            message: t('settings.providers.removeConfirm', {
                name: this.formDisplayName || getProviderBrandLabel(this.formType),
            }),
            confirmLabel: t('settings.providers.remove'),
            destructive: true,
        });
        if (!ok) return;
        const list = this.plugin.settings.providerConfigs ?? [];
        const removedType = this.formType;
        this.plugin.settings.providerConfigs = list.filter((p) => p.id !== this.originalId);
        if (this.plugin.settings.activeProviderId === this.originalId) {
            this.plugin.settings.activeProviderId = null;
        }
        // EPIC-26 follow-up: when the LAST instance of an OAuth / gateway
        // provider type is removed, clear the plugin-level tokens too so
        // the next "Add provider" flow starts fresh. API-key-based
        // providers carry their credentials inside the ProviderConfig
        // entry and are already purged by the filter above.
        purgeProviderLegacyState(this.plugin.settings, removedType);
        await this.plugin.saveSettings();
        this.onAfterChange();
        this.close();
    }

    private allocateInstanceId(type: ProviderType): string {
        const existing = new Set((this.plugin.settings.providerConfigs ?? []).map((p) => p.id));
        const base = `${type}-main`;
        if (!existing.has(base)) return base;
        let n = 2;
        while (existing.has(`${type}-${n}`)) n++;
        return `${type}-${n}`;
    }

    // ── Auth rendering ─────────────────────────────────────────────────

    private renderAuthSection(parent: HTMLElement): void {
        if (OAUTH_PROVIDER_TYPES.includes(this.formType)) {
            this.renderOAuthAuth(parent);
            return;
        }
        if (this.formType === 'bedrock') {
            this.renderBedrockAuth(parent);
            this.renderTestConnectionRow(parent);
            return;
        }

        this.compactRow(parent, {
            label: t('settings.providers.apiKey'),
            desc: t('settings.providers.apiKeyDesc'),
            build: (ctrl) => this.compactInput(ctrl, {
                type: 'password',
                value: this.formApiKey,
                placeholder: '••••••',
                onInput: (v) => { this.formApiKey = v; },
            }),
        });

        const defaultBaseUrl = getDefaultBaseUrlForProvider(this.formType) ?? '';
        this.compactRow(parent, {
            label: t('settings.providers.baseUrl'),
            desc: t('settings.providers.baseUrlDesc'),
            build: (ctrl) => this.compactInput(ctrl, {
                value: this.formBaseUrl,
                placeholder: defaultBaseUrl || t('settings.providers.baseUrlSdkDefault'),
                onInput: (v) => { this.formBaseUrl = v; },
            }),
        });

        if (this.formType === 'azure') {
            this.compactRow(parent, {
                label: t('settings.providers.apiVersion'),
                desc: t('settings.providers.apiVersionDesc'),
                build: (ctrl) => this.compactInput(ctrl, {
                    value: this.formApiVersion,
                    placeholder: t('modal.modelConfig.apiVersionPlaceholder'),
                    onInput: (v) => { this.formApiVersion = v; },
                }),
            });
        }

        // FEAT-26-07: optional enterprise-gateway path for Anthropic via
        // Azure APIM. Toggle + two header fields (mirrors ModelConfigModal).
        if (this.formType === 'anthropic') {
            this.compactRow(parent, {
                label: t('settings.providers.gateway.title'),
                desc: t('settings.providers.gateway.anthropicDescLong'),
                build: (ctrl) => this.compactToggle(ctrl, {
                    value: this.formUseGateway,
                    onChange: (v) => { this.formUseGateway = v; this.render(); },
                }),
            });
            if (this.formUseGateway) {
                this.compactRow(parent, {
                    label: t('settings.providers.gateway.headerName'),
                    desc: t('settings.providers.gateway.headerNameDesc'),
                    build: (ctrl) => this.compactInput(ctrl, {
                        value: this.formGatewayHeaderName,
                        placeholder: 'Ocp-Apim-Subscription-Key',
                        onInput: (v) => { this.formGatewayHeaderName = v; },
                    }),
                });
                this.compactRow(parent, {
                    label: t('settings.providers.gateway.subscriptionKey'),
                    desc: t('settings.providers.gateway.subscriptionKeyDesc'),
                    build: (ctrl) => this.compactInput(ctrl, {
                        type: 'password',
                        value: this.formGatewayHeaderValue,
                        onInput: (v) => { this.formGatewayHeaderValue = v; },
                    }),
                });
            }
        }

        this.renderTestConnectionRow(parent);
    }

    private renderTestConnectionRow(parent: HTMLElement): void {
        this.compactRow(parent, {
            label: t('settings.providers.modal.testConnection'),
            desc: t('settings.providers.modal.testConnectionDesc'),
            build: (ctrl) => this.compactButton(ctrl, {
                text: t('settings.providers.modal.testConnection'),
                onClick: (btn) => { void this.handleTestConnection(btn); },
            }),
        });
    }

    private renderOAuthAuth(parent: HTMLElement): void {
        const isAuthed = (this.formType === 'github-copilot' && !!this.plugin.settings.githubCopilotAccessToken)
            || (this.formType === 'chatgpt-oauth' && !!this.plugin.settings.chatgptOAuthAccessToken);
        this.compactRow(parent, {
            label: t('settings.providers.oauthStatus'),
            desc: isAuthed
                ? t('settings.providers.oauthAuthed')
                : t('settings.providers.oauthNotAuthed'),
            build: (ctrl) => isAuthed
                ? this.compactButton(ctrl, {
                    text: t('settings.providers.oauthSignOut'),
                    variant: 'warning',
                    onClick: () => { void this.handleOAuthSignOut(); },
                })
                : this.compactButton(ctrl, {
                    text: t('settings.providers.oauthSignIn'),
                    variant: 'cta',
                    onClick: (btn) => { void this.handleOAuthSignIn(btn); },
                }),
        });
        if (this.formType === 'github-copilot') {
            this.compactRow(parent, {
                label: t('settings.providers.copilotClientId'),
                desc: t('settings.providers.copilotClientIdDesc'),
                build: (ctrl) => this.compactInput(ctrl, {
                    value: this.plugin.settings.githubCopilotCustomClientId ?? '',
                    placeholder: t('settings.providers.copilotClientIdPlaceholder'),
                    onInput: (v) => { void (async () => {
                        this.plugin.settings.githubCopilotCustomClientId = v.trim();
                        await this.plugin.saveSettings();
                    })(); },
                }),
            });
        }
        this.renderTestConnectionRow(parent);
    }

    private async handleOAuthSignIn(btn: HTMLButtonElement): Promise<void> {
        btn.disabled = true;
        const originalLabel = btn.getText();
        try {
            if (this.formType === 'github-copilot') {
                await this.runCopilotSignIn(btn);
            } else if (this.formType === 'chatgpt-oauth') {
                await this.runChatGptSignIn(btn);
            }
        } catch (e) {
            console.warn('[ProviderDetailModal] OAuth sign-in failed:', e);
            new Notice(t('settings.providers.oauthSignInFailed', {
                msg: (e as Error).message,
            }));
        } finally {
            btn.disabled = false;
            btn.setText(originalLabel);
            this.render();
        }
    }

    private async runCopilotSignIn(btn: HTMLButtonElement): Promise<void> {
        const authService = GitHubCopilotAuthService.getInstance();
        btn.setText(t('settings.providers.oauthRequestingCode'));
        const flow = await authService.startDeviceFlow();
        new Notice(
            t('settings.providers.oauthDeviceCode', {
                code: flow.userCode,
                url: flow.verificationUri,
            }),
            0,
        );
        window.open(flow.verificationUri);
        btn.setText(t('settings.providers.oauthPolling'));
        await authService.pollForAccessToken(flow.deviceCode, flow.interval);
        new Notice(t('settings.providers.oauthSignedIn'));
    }

    private async runChatGptSignIn(btn: HTMLButtonElement): Promise<void> {
        const auth = ChatGptOAuthService.getInstance();
        if (!auth.isPlatformSupported()) {
            new Notice(t('settings.providers.chatgptUnsupported'));
            return;
        }
        btn.setText(t('settings.providers.oauthRequestingCode'));
        const flow = await auth.startAuthFlow();
        // Force the OS default browser. Obsidian's built-in webview breaks
        // federated logins (Microsoft SSO, Google Workspace); shell.openExternal
        // hands the URL to the OS so it opens in the user's default browser.
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron shell is only loadable via dynamic require in the renderer
        const electron = require('electron') as { shell?: { openExternal: (url: string) => Promise<void> } };
        if (electron.shell?.openExternal) {
            await electron.shell.openExternal(flow.authorizeUrl);
        } else {
            window.open(flow.authorizeUrl);
        }
        btn.setText(t('settings.providers.oauthPolling'));
        await flow.completion;
        new Notice(t('settings.providers.oauthSignedIn'));
    }

    private async handleOAuthSignOut(): Promise<void> {
        try {
            if (this.formType === 'github-copilot') {
                await GitHubCopilotAuthService.getInstance().logout();
            } else if (this.formType === 'chatgpt-oauth') {
                await ChatGptOAuthService.getInstance().logout();
            }
            new Notice(t('settings.providers.oauthSignedOut'));
        } catch (e) {
            console.warn('[ProviderDetailModal] OAuth sign-out failed:', e);
            new Notice(t('settings.providers.oauthSignOutFailed', {
                msg: (e as Error).message,
            }));
        } finally {
            this.render();
        }
    }

    private renderBedrockAuth(parent: HTMLElement): void {
        this.compactRow(parent, {
            label: t('settings.providers.bedrockRegion'),
            desc: t('settings.providers.bedrockRegionDesc'),
            build: (ctrl) => this.compactInput(ctrl, {
                value: this.formAwsRegion,
                placeholder: t('settings.providers.bedrockRegionPlaceholder'),
                onInput: (v) => { this.formAwsRegion = v; },
            }),
        });

        this.compactRow(parent, {
            label: t('settings.providers.bedrockAuthMode'),
            desc: t('settings.providers.bedrockAuthModeDesc'),
            build: (ctrl) => this.compactSelect(ctrl, {
                value: this.formAwsAuthMode,
                options: [
                    { value: 'api-key', label: t('settings.providers.bedrockAuthApiKey') },
                    { value: 'access-key', label: t('settings.providers.bedrockAuthAccessKey') },
                    { value: 'gateway', label: t('settings.providers.bedrockAuthGateway') },
                ],
                onChange: (v) => {
                    this.formAwsAuthMode = v as 'api-key' | 'access-key' | 'gateway';
                    this.render();
                },
            }),
        });

        if (this.formAwsAuthMode === 'api-key') {
            this.compactRow(parent, {
                label: t('settings.providers.bedrockApiKey'),
                build: (ctrl) => this.compactInput(ctrl, {
                    type: 'password',
                    value: this.formAwsApiKey,
                    onInput: (v) => { this.formAwsApiKey = v; },
                }),
            });
        } else if (this.formAwsAuthMode === 'access-key') {
            this.compactRow(parent, {
                label: t('settings.providers.bedrockAccessKey'),
                build: (ctrl) => this.compactInput(ctrl, {
                    type: 'password',
                    value: this.formAwsAccessKey,
                    onInput: (v) => { this.formAwsAccessKey = v; },
                }),
            });
            this.compactRow(parent, {
                label: t('settings.providers.bedrockSecretKey'),
                build: (ctrl) => this.compactInput(ctrl, {
                    type: 'password',
                    value: this.formAwsSecretKey,
                    onInput: (v) => { this.formAwsSecretKey = v; },
                }),
            });
        } else {
            // FEAT-26-07 gateway mode: header-based subscription key.
            this.compactRow(parent, {
                label: t('settings.providers.gateway.baseUrl'),
                desc: t('settings.providers.gateway.baseUrlDesc'),
                build: (ctrl) => this.compactInput(ctrl, {
                    type: 'text',
                    value: this.formBaseUrl,
                    onInput: (v) => { this.formBaseUrl = v; },
                }),
            });
            this.compactRow(parent, {
                label: t('settings.providers.gateway.headerName'),
                desc: t('settings.providers.gateway.headerNameDescShort'),
                build: (ctrl) => this.compactInput(ctrl, {
                    type: 'text',
                    value: this.formGatewayHeaderName,
                    onInput: (v) => { this.formGatewayHeaderName = v; },
                }),
            });
            this.compactRow(parent, {
                label: t('settings.providers.gateway.subscriptionKey'),
                build: (ctrl) => this.compactInput(ctrl, {
                    type: 'password',
                    value: this.formGatewayHeaderValue,
                    onInput: (v) => { this.formGatewayHeaderValue = v; },
                }),
            });
        }
    }

    // ── Discovery (existing providers only) ────────────────────────────

    private renderDiscoverySection(parent: HTMLElement): void {
        const count = this.discoveredModels.length;
        const stamp = this.lastRefreshAt
            ? new Date(this.lastRefreshAt).toLocaleString()
            : t('settings.providers.discoveryNever');
        // Providers without a model-listing endpoint (ChatGPT OAuth / Codex)
        // get wording that does not imply the static list is exhaustive and
        // points at the manual-entry option in the tier slots.
        const isCodexLike = providerSupportsManualModelId(this.formType);
        let desc: string;
        if (isCodexLike) {
            desc = count > 0
                ? t('settings.providers.discoveryCodex', { count })
                : t('settings.providers.discoveryCodexEmpty');
        } else {
            desc = count > 0
                ? t('settings.providers.discoveryDesc', { count, stamp })
                : t('settings.providers.discoveryEmpty');
        }
        this.compactRow(parent, {
            label: t('settings.providers.discovery'),
            desc,
            build: (ctrl) => this.compactButton(ctrl, {
                text: t('settings.providers.refresh'),
                variant: 'cta',
                onClick: (btn) => { void this.handleRefresh(btn); },
            }),
        });
    }

    private async handleRefresh(btn: HTMLButtonElement): Promise<void> {
        if (!this.originalId) return;
        if (this.hasUnsavedAuthChanges()) {
            const ok = await confirmModal(this.app, {
                title: t('settings.providers.refresh'),
                message: t('settings.providers.modal.refreshDirtyConfirm'),
                confirmLabel: t('settings.providers.refresh'),
            });
            if (!ok) return;
        }
        const discovery = this.plugin.modelDiscovery;
        if (!discovery) {
            new Notice(t('settings.providers.refreshUnavailable'));
            return;
        }
        btn.disabled = true;
        btn.setText(t('settings.providers.refreshing'));
        try {
            const result = await discovery.refreshProvider(this.originalId);
            const persisted = (this.plugin.settings.providerConfigs ?? []).find((p) => p.id === this.originalId);
            this.discoveredModels = result;
            this.lastRefreshAt = persisted?.lastRefreshAt ?? Date.now();
            this.tierMapping = { ...(persisted?.tierMapping ?? {}) };
            // FIX-55-03 (issue #55): the ChatGPT OAuth live discovery used to
            // fall back to the static lineup silently, so a failed fetch
            // looked like a successful refresh. Tell the user when the list
            // shown is the built-in fallback, not the account's live lineup.
            if (this.formType === 'chatgpt-oauth' && getLastChatGptOAuthModelFetch().source === 'fallback') {
                new Notice(t('settings.providers.refreshCodexFallback'));
            } else {
                new Notice(t('settings.providers.refreshDone'));
            }
        } catch (e) {
            console.warn('[ProviderDetailModal] refresh failed:', e);
            new Notice(t('settings.providers.refreshFailed', { msg: (e as Error).message }));
        } finally {
            this.render();
        }
    }

    private hasUnsavedAuthChanges(): boolean {
        const persisted = (this.plugin.settings.providerConfigs ?? []).find((p) => p.id === this.originalId);
        if (!persisted) return false;
        return (persisted.apiKey ?? '') !== this.formApiKey.trim()
            || (persisted.baseUrl ?? '') !== this.formBaseUrl.trim()
            || (persisted.apiVersion ?? '') !== this.formApiVersion.trim()
            || (persisted.awsApiKey ?? '') !== this.formAwsApiKey.trim()
            || (persisted.awsAccessKey ?? '') !== this.formAwsAccessKey.trim()
            || (persisted.awsSecretKey ?? '') !== this.formAwsSecretKey.trim()
            || (persisted.gatewayHeaderName ?? '') !== this.formGatewayHeaderName.trim()
            || (persisted.gatewayHeaderValue ?? '') !== this.formGatewayHeaderValue.trim()
            || (persisted.useGateway ?? false) !== this.formUseGateway;
    }

    private hasAnyCredentials(): boolean {
        if (LOCAL_PROVIDER_TYPES.includes(this.formType)) {
            return !!this.formBaseUrl.trim();
        }
        if (this.formType === 'bedrock') {
            if (this.formAwsAuthMode === 'api-key') return !!this.formAwsApiKey.trim();
            if (this.formAwsAuthMode === 'gateway') {
                return !!this.formBaseUrl.trim() && !!this.formGatewayHeaderValue.trim();
            }
            return !!this.formAwsAccessKey.trim() && !!this.formAwsSecretKey.trim();
        }
        if (OAUTH_PROVIDER_TYPES.includes(this.formType)) {
            return (this.formType === 'github-copilot' && !!this.plugin.settings.githubCopilotAccessToken)
                || (this.formType === 'chatgpt-oauth' && !!this.plugin.settings.chatgptOAuthAccessToken);
        }
        return !!this.formApiKey.trim();
    }

    // ── Tier mapping (existing providers only) ─────────────────────────

    private renderTierRow(parent: HTMLElement, tier: ModelTier): void {
        // FEAT-26-03 Welle A follow-up: dropped the resolution-line
        // (`Auto-detected · ModelName`) because the dropdown selection
        // already shows the resolved model. Status (empty / manually-set /
        // auto-detected) lives as a tiny tag below the dropdown if useful.
        const row = parent.createDiv({ cls: 'mcm-tier-row' });
        const labelCol = row.createDiv({ cls: 'mcm-tier-label-col' });
        labelCol.createDiv({
            cls: 'mcm-tier-label',
            text: t(`settings.providers.tier.${tier}`),
        });
        labelCol.createDiv({
            cls: 'mcm-tier-desc',
            text: t(`settings.providers.tier.${tier}Desc`),
        });

        const controlCol = row.createDiv({ cls: 'mcm-tier-control-col' });
        const badge = controlCol.createSpan({
            cls: `chat-model-picker-tier chat-model-picker-tier-${tier} mcm-tier-badge-top`,
            text: getTierBadgeLabel(tier),
        });
        badge.setAttr('aria-label', t('settings.providers.tier.badgeAria', { label: getTierBadgeLabel(tier) }));

        const manualAllowed = providerSupportsManualModelId(this.formType);
        const view = resolveTierSlotView({
            override: this.tierOverrides?.[tier],
            discoveredIds: this.discoveredModels.map((m) => m.id),
            manualAllowed,
            manualRequested: this.manualTierRequested[tier],
        });

        if (view.mode === 'manual') {
            this.renderManualTierControl(controlCol, tier, view.manualValue);
            return;
        }

        const select = controlCol.createEl('select', { cls: 'dropdown mcm-tier-dropdown' });
        const autoSuggested = this.tierMapping?.[tier];
        const autoLabel = autoSuggested
            ? t('settings.providers.tier.autoLabel', {
                name: this.displayNameForId(autoSuggested),
            })
            : t('settings.providers.tier.autoEmpty');
        const autoOpt = select.createEl('option', { text: autoLabel });
        autoOpt.value = '';
        for (const m of this.sortedModelsForTier(tier)) {
            const opt = select.createEl('option', { text: this.modelOptionLabel(m, tier) });
            opt.value = m.id;
        }
        if (manualAllowed) {
            const manualOpt = select.createEl('option', {
                text: t('settings.providers.tier.manualOption'),
            });
            manualOpt.value = MANUAL_TIER_OPTION_VALUE;
        }
        select.value = this.tierOverrides?.[tier] ?? '';
        select.addEventListener('change', () => {
            const v = select.value;
            if (v === MANUAL_TIER_OPTION_VALUE) {
                this.manualTierRequested = { ...this.manualTierRequested, [tier]: true };
                this.render();
                return;
            }
            this.manualTierRequested = { ...this.manualTierRequested, [tier]: false };
            this.tierOverrides = { ...this.tierOverrides };
            if (!v) delete this.tierOverrides[tier];
            else this.tierOverrides[tier] = v;
            this.render();
        });
    }

    /**
     * Free-text model-id control for providers without a reliable model
     * listing endpoint (ChatGPT OAuth / Codex, and custom OpenAI-compatible
     * endpoints that may not expose /v1/models -- issue #40). Lets the user
     * type a model id we cannot enumerate. An unknown id degrades gracefully:
     * the provider falls back to default model info and the endpoint's own
     * error surfaces if the id is wrong.
     */
    private renderManualTierControl(parent: HTMLElement, tier: ModelTier, value: string): void {
        // FIX-55-02 (issue #55): no 'dropdown' class here -- Obsidian styles
        // it for <select> elements and breaks a text input visually.
        const input = parent.createEl('input', {
            cls: MANUAL_TIER_INPUT_CLS,
            attr: { type: 'text' },
        });
        input.value = value;
        input.placeholder = t('settings.providers.tier.manualPlaceholder');
        input.addEventListener('input', () => {
            const v = input.value.trim();
            this.tierOverrides = { ...this.tierOverrides };
            if (!v) delete this.tierOverrides[tier];
            else this.tierOverrides[tier] = v;
        });

        const back = parent.createEl('button', {
            cls: 'mcm-tier-manual-back',
            text: t('settings.providers.tier.manualBack'),
            attr: { type: 'button' },
        });
        back.addEventListener('click', () => {
            this.manualTierRequested = { ...this.manualTierRequested, [tier]: false };
            this.tierOverrides = { ...this.tierOverrides };
            delete this.tierOverrides[tier];
            this.render();
        });
    }

    private resolveDraftTierSlot(tier: ModelTier): string | undefined {
        return this.tierOverrides?.[tier] ?? this.tierMapping?.[tier];
    }

    // ── Reasoning-effort opt-in (IMP-54-05b, existing providers only) ──

    /** Assemble the current draft into the shape the pure view helper reads. */
    /**
     * D3: whether a prompt-caching switch would do anything for this provider.
     *
     * True when any model in the three tier slots needs cache markers from us
     * (`requiresRequestMarkers`). A provider that caches implicitly server-side
     * is deliberately excluded: `supportsPromptCache` is true for it, but no
     * request field changes, so a switch would be a control with no effect.
     * Falls back to the discovered models when no tier slot is filled yet, so a
     * freshly refreshed provider already offers the switch.
     */
    private providerNeedsCacheMarkers(): boolean {
        const tierIds = TIER_ORDER
            .map((tier) => this.resolveDraftTierSlot(tier))
            .filter((id): id is string => typeof id === 'string' && id.length > 0);
        const candidates = tierIds.length > 0
            ? tierIds
            : this.discoveredModels.map((m) => m.id);
        return candidates.some((id) => requiresRequestMarkers(this.formType, id));
    }

    private buildEffortOptInDraftView(): EffortOptInView | null {
        return buildEffortOptInView({
            id: this.originalId ?? 'draft',
            type: this.formType,
            enabled: this.formEnabled,
            discoveredModels: this.discoveredModels,
            lastRefreshAt: this.lastRefreshAt,
            tierMapping: this.tierMapping,
            tierOverrides: this.tierOverrides,
            effortOptIn: this.effortOptIn,
        });
    }

    /**
     * One compact toggle row per opted-in model (toggle off removes it) plus
     * a dropdown to opt in another candidate. Candidates are the pinnable
     * models whose static registry levels are [] -- models with native levels
     * never show up here. Persisted on Save like every other draft field.
     */
    private renderEffortOptInSection(parent: HTMLElement, view: EffortOptInView): void {
        parent.createDiv({
            cls: 'mcm-hint',
            text: t('settings.providers.effortOptInDesc'),
        });
        for (const id of view.optedIn) {
            this.compactRow(parent, {
                label: id,
                build: (ctrl) => this.compactToggle(ctrl, {
                    value: true,
                    onChange: () => {
                        this.effortOptIn = { ...this.effortOptIn };
                        delete this.effortOptIn[id];
                        this.render();
                    },
                }),
            });
        }
        if (view.available.length > 0) {
            this.compactRow(parent, {
                label: t('settings.providers.effortOptInAdd'),
                desc: t('settings.providers.effortOptInAddDesc'),
                build: (ctrl) => this.compactSelect(ctrl, {
                    value: '',
                    options: [
                        { value: '', label: t('settings.providers.effortOptInSelect') },
                        ...view.available.map((id) => ({ value: id, label: id })),
                    ],
                    onChange: (v) => {
                        if (!v) return;
                        this.effortOptIn = { ...this.effortOptIn, [v]: true };
                        this.render();
                    },
                }),
            });
        }
    }

    private displayNameForId(modelId: string): string {
        const m = this.discoveredModels.find((x) => x.id === modelId);
        return this.shortenDisplayName(m?.displayName ?? modelId);
    }

    /**
     * Strip a leading provider/brand prefix from a discovered-model
     * `displayName` so the dropdown doesn't repeat "Anthropic:" inside
     * a modal whose header already says "Configure Anthropic"
     * (and analogous for OpenRouter aggregator listings like
     * "Anthropic: Claude Haiku Latest"). Handles common separators
     * ("Foo: bar", "Foo / bar", "Foo - bar"). Leaves clean names alone.
     */
    private shortenDisplayName(name: string): string {
        const m = name.match(/^([\w][\w\s.&+-]{0,30})\s*[:/–—-]\s+(.+)$/);
        if (m) return m[2];
        return name;
    }

    private sortedModelsForTier(tier: ModelTier): DiscoveredModel[] {
        const inTier = this.discoveredModels.filter((m) => m.autoTier === tier);
        const otherTiers = this.discoveredModels.filter((m) => m.autoTier !== tier);
        return [...inTier, ...otherTiers];
    }

    private modelOptionLabel(m: DiscoveredModel, expectedTier: ModelTier): string {
        const base = this.shortenDisplayName(m.displayName ?? m.id);
        if (!m.autoTier) return base;
        const badge = getTierBadgeLabel(m.autoTier);
        if (m.autoTier === expectedTier) return `[${badge}]  ${base}`;
        return `[${badge}]  ${base}  (${t('settings.providers.tier.differentTier')})`;
    }
}
