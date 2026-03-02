import { App, Modal, Notice, setIcon } from 'obsidian';
import type { CustomModel, ProviderType } from '../../types/settings';
import { PROVIDER_LABELS, MODEL_SUGGESTIONS, EMBEDDING_PROVIDERS, EMBEDDING_SUGGESTIONS } from './constants';
import { testModelConnection, testEmbeddingConnection, fetchProviderModels, fetchOllamaModels, fetchEmbeddingModels, isTemperatureFixed, maxTemperature } from './testModelConnection';
import { t } from '../../i18n';

export class ModelConfigModal extends Modal {
    private model: CustomModel;
    private isNew: boolean;
    private onSave: (model: CustomModel) => void;
    private forEmbedding: boolean;

    private formName: string;
    private formDisplayName: string;
    private formProvider: ProviderType;
    private formApiKey: string;
    private formBaseUrl: string;
    private formApiVersion: string;
    private formMaxTokens: number;
    private formTemperatureEnabled: boolean;
    private formTemperatureValue: number;
    private formPromptCachingEnabled: boolean;
    private formThinkingEnabled: boolean;
    private formThinkingBudgetTokens: number;

    private apiKeyRow: HTMLElement | null = null;
    private baseUrlRow: HTMLElement | null = null;
    private apiVersionRow: HTMLElement | null = null;
    private suggestRow: HTMLElement | null = null;
    private suggestSelEl: HTMLSelectElement | null = null;
    private ollamaBrowserRow: HTMLElement | null = null;
    private customBrowserRow: HTMLElement | null = null;
    private providerGuideEl: HTMLElement | null = null;
    private apiKeyDescEl: HTMLElement | null = null;
    private baseUrlDescEl: HTMLElement | null = null;
    private testResultEl: HTMLElement | null = null;
    private testBtn: HTMLButtonElement | null = null;
    private nameInputEl: HTMLInputElement | null = null;
    private dnInputEl: HTMLInputElement | null = null;
    private temperatureRow: HTMLElement | null = null;
    private temperatureSliderEl: HTMLInputElement | null = null;
    private temperatureValueEl: HTMLElement | null = null;
    private temperatureNoteEl: HTMLElement | null = null;
    private promptCachingRow: HTMLElement | null = null;
    private thinkingRow: HTMLElement | null = null;
    private thinkingBudgetRow: HTMLElement | null = null;
    private thinkingNoteEl: HTMLElement | null = null;

    constructor(app: App, model: CustomModel | null, onSave: (m: CustomModel) => void, forEmbedding = false) {
        super(app);
        this.forEmbedding = forEmbedding;
        this.isNew = model === null;
        this.model = model ?? {
            name: '',
            provider: 'openai',
            displayName: '',
            apiKey: '',
            baseUrl: '',
            enabled: true,
            isBuiltIn: false,
            maxTokens: 8192,
        };
        this.onSave = onSave;
        this.formName = this.model.name;
        this.formDisplayName = this.model.displayName ?? '';
        this.formProvider = this.model.provider;
        this.formApiKey = this.model.apiKey ?? '';
        this.formBaseUrl = this.model.baseUrl ?? '';
        this.formApiVersion = this.model.apiVersion ?? '2024-10-21';
        this.formMaxTokens = this.model.maxTokens ?? 8192;
        this.formTemperatureEnabled = this.model.temperature !== undefined;
        this.formTemperatureValue = this.model.temperature ?? 0.7;
        this.formPromptCachingEnabled = this.model.promptCachingEnabled ?? false;
        this.formThinkingEnabled = this.model.thinkingEnabled ?? false;
        this.formThinkingBudgetTokens = this.model.thinkingBudgetTokens ?? 10000;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('model-config-modal');
        contentEl.createEl('h3', {
            text: this.isNew
                ? (this.forEmbedding ? t('modal.modelConfig.addEmbedding') : t('modal.modelConfig.addModel'))
                : t('modal.modelConfig.configure', { name: this.model.displayName ?? this.model.name }),
            cls: 'modal-title',
        });
        this.buildForm(contentEl);
        this.buildActions(contentEl);
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private buildForm(el: HTMLElement): void {
        const form = el.createDiv('mcm-form');

        const row = (label: string, desc?: string): HTMLElement => {
            const r = form.createDiv('mcm-row');
            const labelEl = r.createDiv('mcm-label');
            labelEl.createSpan({ text: label });
            if (desc) labelEl.createSpan({ text: desc, cls: 'mcm-desc' });
            return r;
        };

        // ── Provider setup guide (dynamic, shown at top) ─────────────────
        this.providerGuideEl = form.createDiv('mcm-guide');

        // ── Provider ─────────────────────────────────────────────────────
        const provRow = row(t('modal.modelConfig.provider'));
        const provSel = provRow.createEl('select', { cls: 'mcm-select' });
        (this.forEmbedding ? EMBEDDING_PROVIDERS : ['anthropic', 'openai', 'ollama', 'lmstudio', 'openrouter', 'azure', 'custom'] as ProviderType[]).forEach((p) => {
            const opt = provSel.createEl('option', { value: p, text: PROVIDER_LABELS[p] });
            if (p === this.formProvider) opt.selected = true;
        });
        if (!this.isNew && this.model.isBuiltIn) provSel.disabled = true;
        provSel.addEventListener('change', () => {
            this.formProvider = provSel.value as ProviderType;
            this.updateFieldVisibility();
        });

        // ── Quick Pick (suggestions per provider) ─────────────────────────
        this.suggestRow = form.createDiv('mcm-row mcm-suggest-row');
        const suggestLabel = this.suggestRow.createDiv('mcm-label');
        suggestLabel.createSpan({ text: t('modal.modelConfig.quickPick') });
        suggestLabel.createSpan({ text: t('modal.modelConfig.quickPickDesc'), cls: 'mcm-desc' });
        const suggestControls = this.suggestRow.createDiv('mcm-suggest-controls');
        this.suggestSelEl = suggestControls.createEl('select', { cls: 'mcm-select mcm-suggest-sel' });
        this.suggestSelEl.createEl('option', { value: '', text: t('modal.modelConfig.pickModel'), attr: { disabled: '', selected: '' } });
        this.suggestSelEl.addEventListener('change', () => {
            const val = this.suggestSelEl!.value;
            if (!val) return;
            if (this.nameInputEl) {
                this.formName = val;
                this.nameInputEl.value = val;
            }
            const opt = this.suggestSelEl!.options[this.suggestSelEl!.selectedIndex];
            if (this.dnInputEl && !this.dnInputEl.value && opt) {
                const label = opt.text.split('  (')[0].trim();
                if (label && label !== val) {
                    this.formDisplayName = label;
                    this.dnInputEl.value = label;
                }
            }
            this.suggestSelEl!.selectedIndex = 0;
            this.updateTemperatureUI();
        });
        // Fetch button — fetches current model list from the provider's API
        const fetchBtn = suggestControls.createEl('button', { cls: 'mcm-fetch-btn', attr: { title: t('modal.modelConfig.fetchModels') } });
        setIcon(fetchBtn, 'refresh-cw');
        fetchBtn.addEventListener('click', () => { void (async () => {
            if (!this.suggestSelEl) return;
            fetchBtn.disabled = true;
            setIcon(fetchBtn, 'loader');
            try {
                const models = this.forEmbedding
                    ? await fetchEmbeddingModels(this.formProvider, this.formApiKey, this.formBaseUrl || undefined, this.formApiVersion || undefined)
                    : await fetchProviderModels(this.formProvider, this.formApiKey, this.formBaseUrl || undefined);
                this.suggestSelEl.options.length = 0;
                this.suggestSelEl.createEl('option', { value: '', text: t('modal.modelConfig.modelsFetched', { count: models.length }), attr: { disabled: '', selected: '' } });
                // For OpenRouter chat models, group by vendor prefix
                if (!this.forEmbedding && this.formProvider === 'openrouter') {
                    const groups = new Map<string, typeof models>();
                    models.forEach((m) => {
                        const grp = m.id.split('/')[0];
                        if (!groups.has(grp)) groups.set(grp, []);
                        groups.get(grp)!.push(m);
                    });
                    groups.forEach((items, grp) => {
                        const og = document.createElement('optgroup');
                        og.label = grp;
                        items.forEach((m) => {
                            const opt = document.createElement('option');
                            opt.value = m.id;
                            opt.text = `${m.label}  (${m.id})`;
                            og.appendChild(opt);
                        });
                        this.suggestSelEl!.appendChild(og);
                    });
                } else {
                    models.forEach((m) => {
                        this.suggestSelEl!.createEl('option', { value: m.id, text: m.label !== m.id ? `${m.label}  (${m.id})` : m.id });
                    });
                }
            } catch (e: unknown) {
                // requestUrl can throw a Response-like object (no .message) — handle both
                const errObj = e as { message?: string; status?: number };
                const errMsg = errObj?.message ?? (errObj?.status ? `HTTP ${errObj.status}` : String(e));
                new Notice(t('modal.modelConfig.fetchFailed', { error: errMsg }));
            } finally {
                fetchBtn.disabled = false;
                setIcon(fetchBtn, 'refresh-cw');
            }
        })(); });

        // ── Model ID ─────────────────────────────────────────────────────
        const nameRow = row(t('modal.modelConfig.modelId'), t('modal.modelConfig.modelIdDesc'));
        this.nameInputEl = nameRow.createEl('input', {
            cls: 'mcm-input',
            attr: { type: 'text', placeholder: t('modal.modelConfig.modelIdPlaceholder') },
        });
        this.nameInputEl.value = this.formName;
        this.nameInputEl.addEventListener('input', () => (this.formName = this.nameInputEl!.value.trim()));
        if (!this.isNew && this.model.isBuiltIn) this.nameInputEl.disabled = true;

        // ── Ollama model browser (shown only for Ollama) ──────────────────
        this.ollamaBrowserRow = form.createDiv('mcm-ollama-browser');
        this.buildOllamaBrowser(this.ollamaBrowserRow);

        // ── Custom / LM Studio / Mistral model browser ────────────────────
        this.customBrowserRow = form.createDiv('mcm-ollama-browser');
        this.buildCustomBrowser(this.customBrowserRow);

        // ── Display Name ──────────────────────────────────────────────────
        const dnRow = row(t('modal.modelConfig.displayName'), t('modal.modelConfig.displayNameDesc'));
        this.dnInputEl = dnRow.createEl('input', {
            cls: 'mcm-input',
            attr: { type: 'text', placeholder: this.formName || t('modal.modelConfig.displayNamePlaceholder', { name: 'GPT-4o' }) },
        });
        this.dnInputEl.value = this.formDisplayName;
        this.dnInputEl.addEventListener('input', () => (this.formDisplayName = this.dnInputEl!.value));

        // ── API Key ───────────────────────────────────────────────────────
        this.apiKeyRow = form.createDiv('mcm-row');
        const akLabel = this.apiKeyRow.createDiv('mcm-label');
        akLabel.createSpan({ text: t('modal.modelConfig.apiKey') });
        this.apiKeyDescEl = akLabel.createSpan({ cls: 'mcm-desc' });
        const akInput = this.apiKeyRow.createEl('input', {
            cls: 'mcm-input',
            attr: { type: 'password', placeholder: t('modal.modelConfig.apiKeyPlaceholder') },
        });
        akInput.value = this.formApiKey;
        akInput.addEventListener('input', () => (this.formApiKey = akInput.value.trim()));

        // ── Base URL ──────────────────────────────────────────────────────
        this.baseUrlRow = form.createDiv('mcm-row');
        const buLabel = this.baseUrlRow.createDiv('mcm-label');
        buLabel.createSpan({ text: t('modal.modelConfig.baseUrl') });
        this.baseUrlDescEl = buLabel.createSpan({ cls: 'mcm-desc' });
        const buInput = this.baseUrlRow.createEl('input', {
            cls: 'mcm-input',
            attr: { type: 'text', placeholder: 'http://localhost:11434' },
        });
        buInput.value = this.formBaseUrl;
        buInput.addEventListener('input', () => (this.formBaseUrl = buInput.value.trim()));

        // ── API Version (Azure + some enterprise gateways) ───────────────
        this.apiVersionRow = form.createDiv('mcm-row');
        const avLabel = this.apiVersionRow.createDiv('mcm-label');
        avLabel.createSpan({ text: t('modal.modelConfig.apiVersion') });
        avLabel.createSpan({ text: t('modal.modelConfig.apiVersionDesc'), cls: 'mcm-desc' });
        const avInput = this.apiVersionRow.createEl('input', {
            cls: 'mcm-input mcm-input-sm',
            attr: { type: 'text', placeholder: t('modal.modelConfig.apiVersionPlaceholder') },
        });
        avInput.value = this.formApiVersion;
        avInput.addEventListener('input', () => (this.formApiVersion = avInput.value.trim()));

        // ── Max Tokens ────────────────────────────────────────────────────
        const mtRow = row(t('modal.modelConfig.maxTokens'), t('modal.modelConfig.maxTokensDesc'));
        const mtInput = mtRow.createEl('input', {
            cls: 'mcm-input mcm-input-sm',
            attr: { type: 'number', placeholder: t('modal.modelConfig.maxTokensPlaceholder') },
        });
        mtInput.value = String(this.formMaxTokens);
        mtInput.addEventListener('input', () => {
            const n = parseInt(mtInput.value);
            if (!isNaN(n) && n > 0) this.formMaxTokens = n;
        });

        // ── Temperature ───────────────────────────────────────────────────
        if (!this.forEmbedding) {
            this.temperatureRow = form.createDiv('mcm-row mcm-temperature-row');
            const tempLabel = this.temperatureRow.createDiv('mcm-label');
            tempLabel.createSpan({ text: t('modal.modelConfig.temperature') });
            tempLabel.createSpan({ text: t('modal.modelConfig.temperatureDesc'), cls: 'mcm-desc' });

            const tempControls = this.temperatureRow.createDiv('mcm-temperature-controls');

            const toggleWrap = tempControls.createDiv('mcm-temperature-toggle');
            const toggleChk = toggleWrap.createEl('input', { attr: { type: 'checkbox' } });
            toggleChk.checked = this.formTemperatureEnabled;
            toggleWrap.createSpan({ text: t('modal.modelConfig.customTemperature'), cls: 'mcm-temperature-toggle-label' });

            const sliderWrap = tempControls.createDiv('mcm-temperature-slider-wrap');
            this.temperatureSliderEl = sliderWrap.createEl('input', {
                attr: { type: 'range', min: '0', max: '2', step: '0.05' },
                cls: 'mcm-temperature-slider',
            });
            this.temperatureSliderEl.value = String(this.formTemperatureValue);
            this.temperatureValueEl = sliderWrap.createSpan({
                cls: 'mcm-temperature-value',
                text: this.formTemperatureValue.toFixed(2),
            });
            this.temperatureNoteEl = tempControls.createDiv({ cls: 'mcm-temperature-note' });

            toggleChk.addEventListener('change', () => {
                this.formTemperatureEnabled = toggleChk.checked;
                this.updateTemperatureUI();
            });
            this.temperatureSliderEl.addEventListener('input', () => {
                this.formTemperatureValue = parseFloat(this.temperatureSliderEl!.value);
                if (this.temperatureValueEl) {
                    this.temperatureValueEl.setText(this.formTemperatureValue.toFixed(2));
                }
            });
        }

        // -- Prompt Caching (Anthropic only) --
        if (!this.forEmbedding) {
            this.promptCachingRow = form.createDiv('mcm-row');
            const cacheLabel = this.promptCachingRow.createDiv('mcm-label');
            cacheLabel.createSpan({ text: t('modal.modelConfig.promptCaching') });
            cacheLabel.createSpan({ text: t('modal.modelConfig.promptCachingDesc'), cls: 'mcm-desc' });
            const cacheChk = this.promptCachingRow.createEl('input', { attr: { type: 'checkbox' } });
            cacheChk.checked = this.formPromptCachingEnabled;
            cacheChk.addEventListener('change', () => {
                this.formPromptCachingEnabled = cacheChk.checked;
            });
        }

        // -- Extended Thinking (Anthropic only) --
        if (!this.forEmbedding) {
            this.thinkingRow = form.createDiv('mcm-row');
            const thinkLabel = this.thinkingRow.createDiv('mcm-label');
            thinkLabel.createSpan({ text: t('modal.modelConfig.thinking') });
            thinkLabel.createSpan({ text: t('modal.modelConfig.thinkingDesc'), cls: 'mcm-desc' });
            const thinkChk = this.thinkingRow.createEl('input', { attr: { type: 'checkbox' } });
            thinkChk.checked = this.formThinkingEnabled;
            thinkChk.addEventListener('change', () => {
                this.formThinkingEnabled = thinkChk.checked;
                this.updateThinkingUI();
                this.updateTemperatureUI();
            });
            this.thinkingNoteEl = this.thinkingRow.createDiv({ cls: 'mcm-temperature-note' });

            // Budget slider
            this.thinkingBudgetRow = form.createDiv('mcm-row');
            const budgetLabel = this.thinkingBudgetRow.createDiv('mcm-label');
            budgetLabel.createSpan({ text: t('modal.modelConfig.thinkingBudget') });
            budgetLabel.createSpan({ text: t('modal.modelConfig.thinkingBudgetDesc'), cls: 'mcm-desc' });
            const budgetControls = this.thinkingBudgetRow.createDiv('mcm-temperature-controls');
            const budgetSliderWrap = budgetControls.createDiv('mcm-temperature-slider-wrap');
            const budgetSlider = budgetSliderWrap.createEl('input', {
                attr: { type: 'range', min: '1024', max: '128000', step: '1024' },
                cls: 'mcm-temperature-slider',
            });
            budgetSlider.value = String(this.formThinkingBudgetTokens);
            const budgetValueEl = budgetSliderWrap.createSpan({
                cls: 'mcm-temperature-value',
                text: this.formThinkingBudgetTokens.toLocaleString(),
            });
            budgetSlider.addEventListener('input', () => {
                this.formThinkingBudgetTokens = parseInt(budgetSlider.value);
                budgetValueEl.setText(this.formThinkingBudgetTokens.toLocaleString());
            });
        }

        // Test result (inline)
        this.testResultEl = form.createDiv('mcm-test-result');
        this.testResultEl.classList.add('agent-u-hidden');

        this.updateFieldVisibility();
    }

    private buildActions(el: HTMLElement): void {
        const bar = el.createDiv('mcm-actions');

        this.testBtn = bar.createEl('button', { cls: 'mcm-btn-test', text: t('modal.modelConfig.testConnection') });
        this.testBtn.addEventListener('click', () => void this.runTest());

        const saveBtn = bar.createEl('button', { cls: 'mod-cta', text: this.isNew ? t('modal.modelConfig.add') : t('modal.modelConfig.save') });
        saveBtn.addEventListener('click', () => this.save());

        const cancelBtn = bar.createEl('button', { text: t('modal.modelConfig.cancel') });
        cancelBtn.addEventListener('click', () => this.close());
    }

    private updateFieldVisibility(): void {
        if (!this.apiKeyRow || !this.baseUrlRow || !this.providerGuideEl) return;
        const p = this.formProvider;

        // Show/hide fields per provider
        this.apiKeyRow.classList.toggle('agent-u-hidden', p === 'ollama' || p === 'lmstudio');
        this.baseUrlRow.classList.toggle('agent-u-hidden', p === 'openai' || p === 'openrouter');
        if (this.apiVersionRow) this.apiVersionRow.classList.toggle('agent-u-hidden', p !== 'azure');
        if (this.ollamaBrowserRow) this.ollamaBrowserRow.classList.toggle('agent-u-hidden', p !== 'ollama');
        if (this.customBrowserRow) this.customBrowserRow.classList.toggle('agent-u-hidden', p !== 'custom' && p !== 'lmstudio');
        if (this.promptCachingRow) this.promptCachingRow.classList.toggle('agent-u-hidden', p !== 'anthropic');
        if (this.thinkingRow) this.thinkingRow.classList.toggle('agent-u-hidden', p !== 'anthropic');
        if (this.thinkingBudgetRow) this.thinkingBudgetRow.classList.toggle('agent-u-hidden', p !== 'anthropic' || !this.formThinkingEnabled);

        // Quick Pick: use embedding suggestions or chat suggestions depending on mode
        const suggestions = this.forEmbedding
            ? (EMBEDDING_SUGGESTIONS[p] ?? [])
            : (MODEL_SUGGESTIONS[p] ?? []);
        const hasStaticSuggestions = suggestions.length > 0;
        // Fetch is available for embedding providers with live APIs (not azure — no list endpoint)
        const hasFetchFetch = this.forEmbedding
            ? (p === 'openai' || p === 'openrouter' || p === 'ollama' || p === 'lmstudio' || p === 'custom')
            : (p === 'anthropic' || p === 'openai' || p === 'openrouter' || p === 'lmstudio');
        if (this.suggestRow) {
            this.suggestRow.classList.toggle('agent-u-hidden', !hasStaticSuggestions && !hasFetchFetch);
            if (this.suggestSelEl) {
                // Rebuild static options (reset to defaults when provider changes)
                while (this.suggestSelEl.options.length > 1) this.suggestSelEl.remove(1);
                // Remove optgroups
                this.suggestSelEl.querySelectorAll('optgroup').forEach((og) => og.remove());
                const groups = [...new Set(suggestions.map((s) => s.group))];
                groups.forEach((grp) => {
                    const og = document.createElement('optgroup');
                    og.label = grp;
                    suggestions.filter((s) => s.group === grp).forEach((s) => {
                        const opt = document.createElement('option');
                        opt.value = s.id;
                        opt.text = `${s.label}  (${s.id})`;
                        og.appendChild(opt);
                    });
                    this.suggestSelEl!.appendChild(og);
                });
                this.suggestSelEl.selectedIndex = 0;
                // Show/hide the fetch button
                const fetchBtn = this.suggestRow.querySelector<HTMLButtonElement>('.mcm-fetch-btn');
                if (fetchBtn) fetchBtn.classList.toggle('agent-u-hidden', !hasFetchFetch);
            }
        }

        // Update inline field hints
        if (this.apiKeyDescEl) {
            const hints: Record<string, string> = {
                anthropic: t('modal.modelConfig.keyHint.anthropic'),
                openai: t('modal.modelConfig.keyHint.openai'),
                openrouter: t('modal.modelConfig.keyHint.openrouter'),
                azure: t('modal.modelConfig.keyHint.azure'),
                custom: t('modal.modelConfig.keyHint.local'),
            };
            this.apiKeyDescEl.setText(hints[p] ?? '');
        }
        if (this.baseUrlDescEl) {
            const hints: Record<string, string> = {
                ollama: t('modal.modelConfig.urlHint.ollama'),
                lmstudio: t('modal.modelConfig.urlHint.lmstudio'),
                azure: t('modal.modelConfig.urlHint.azure'),
                custom: t('modal.modelConfig.urlHint.custom'),
            };
            this.baseUrlDescEl.setText(hints[p] ?? '');
        }

        // Render provider setup guide
        this.providerGuideEl.empty();
        this.renderProviderGuide(this.providerGuideEl, p);
        this.updateTemperatureUI();
    }

    private updateTemperatureUI(): void {
        if (!this.temperatureRow || !this.temperatureSliderEl || this.forEmbedding) return;
        const fixed = isTemperatureFixed(this.formProvider, this.formName);
        const max = maxTemperature(this.formProvider);

        // Clamp current value to provider max
        if (this.formTemperatureValue > max) {
            this.formTemperatureValue = max;
            this.temperatureSliderEl.value = String(max);
            if (this.temperatureValueEl) this.temperatureValueEl.setText(max.toFixed(2));
        }
        this.temperatureSliderEl.max = String(max);

        if (fixed) {
            this.formTemperatureEnabled = false;
            this.formTemperatureValue = 1.0;
            this.temperatureSliderEl.value = '1';
            this.temperatureSliderEl.disabled = true;
            if (this.temperatureValueEl) this.temperatureValueEl.setText('1.00');
            if (this.temperatureNoteEl) {
                this.temperatureNoteEl.setText(t('modal.modelConfig.temperatureFixed'));
                this.temperatureNoteEl.classList.remove('agent-u-hidden');
            }
            this.temperatureRow.querySelectorAll('input[type=checkbox]').forEach((el: Element) => {
                (el as HTMLInputElement).checked = false;
                (el as HTMLInputElement).disabled = true;
            });
        } else if (this.formThinkingEnabled && this.formProvider === 'anthropic') {
            // Extended thinking forces temperature to 1
            if (this.temperatureNoteEl) {
                this.temperatureNoteEl.setText(t('modal.modelConfig.temperatureThinkingNote'));
                this.temperatureNoteEl.classList.remove('agent-u-hidden');
            }
        } else {
            if (this.temperatureNoteEl) this.temperatureNoteEl.classList.add('agent-u-hidden');
            this.temperatureRow.querySelectorAll('input[type=checkbox]').forEach((el: Element) => {
                (el as HTMLInputElement).disabled = false;
            });
            this.temperatureSliderEl.disabled = !this.formTemperatureEnabled;
        }

        const sliderWrap = this.temperatureSliderEl.closest<HTMLElement>('.mcm-temperature-slider-wrap');
        if (sliderWrap) sliderWrap.classList.toggle('agent-u-hidden', !this.formTemperatureEnabled);
    }

    private updateThinkingUI(): void {
        if (!this.thinkingBudgetRow || !this.thinkingNoteEl) return;
        this.thinkingBudgetRow.classList.toggle('agent-u-hidden', !this.formThinkingEnabled);
        if (this.formThinkingEnabled) {
            this.thinkingNoteEl.setText(t('modal.modelConfig.thinkingNote'));
            this.thinkingNoteEl.classList.remove('agent-u-hidden');
        } else {
            this.thinkingNoteEl.classList.add('agent-u-hidden');
        }
    }

    private renderProviderGuide(container: HTMLElement, provider: ProviderType): void {
        const guide = container.createDiv('mcm-guide-inner');

        if (provider === 'anthropic') {
            guide.createEl('strong', { text: t('guide.anthropic.heading') });
            const steps = guide.createEl('ol', { cls: 'mcm-guide-steps' });
            steps.createEl('li', { text: t('guide.anthropic.step1') });
            steps.createEl('li', { text: t('guide.anthropic.step2') });
            steps.createEl('li', { text: t('guide.anthropic.step3') });
            steps.createEl('li', { text: t('guide.anthropic.step4') });
            guide.createDiv({ cls: 'mcm-guide-tip', text: t('guide.anthropic.tip') });

        } else if (provider === 'openai') {
            guide.createEl('strong', { text: t('guide.openai.heading') });
            const steps = guide.createEl('ol', { cls: 'mcm-guide-steps' });
            steps.createEl('li', { text: t('guide.openai.step1') });
            steps.createEl('li', { text: t('guide.openai.step2') });
            steps.createEl('li', { text: t('guide.openai.step3') });
            steps.createEl('li', { text: t('guide.openai.step4') });
            guide.createDiv({ cls: 'mcm-guide-tip', text: t('guide.openai.tip') });

        } else if (provider === 'ollama') {
            guide.createEl('strong', { text: t('guide.ollama.heading') });
            const steps = guide.createEl('ol', { cls: 'mcm-guide-steps' });
            steps.createEl('li', { text: t('guide.ollama.step1') });
            steps.createEl('li', { text: t('guide.ollama.step2') });
            steps.createEl('li', { text: t('guide.ollama.step3') });
            steps.createEl('li', { text: t('guide.ollama.step4') });
            guide.createDiv({ cls: 'mcm-guide-tip', text: t('guide.ollama.tip') });

        } else if (provider === 'openrouter') {
            guide.createEl('strong', { text: t('guide.openrouter.heading') });
            const steps = guide.createEl('ol', { cls: 'mcm-guide-steps' });
            steps.createEl('li', { text: t('guide.openrouter.step1') });
            steps.createEl('li', { text: t('guide.openrouter.step2') });
            steps.createEl('li', { text: t('guide.openrouter.step3') });
            steps.createEl('li', { text: t('guide.openrouter.step4') });
            steps.createEl('li', { text: t('guide.openrouter.step5') });
            guide.createDiv({ cls: 'mcm-guide-tip', text: t('guide.openrouter.tip') });

        } else if (provider === 'azure') {
            guide.createEl('strong', { text: t('guide.azure.heading') });
            const steps = guide.createEl('ol', { cls: 'mcm-guide-steps' });
            steps.createEl('li', { text: t('guide.azure.step1') });
            steps.createEl('li', { text: t('guide.azure.step2') });
            steps.createEl('li', { text: t('guide.azure.step3') });
            steps.createEl('li', { text: t('guide.azure.step4') });
            steps.createEl('li', { text: t('guide.azure.step5') });
            guide.createDiv({ cls: 'mcm-guide-tip', text: t('guide.azure.tip') });

        } else if (provider === 'lmstudio') {
            guide.createEl('strong', { text: t('guide.lmstudio.heading') });
            const steps = guide.createEl('ol', { cls: 'mcm-guide-steps' });
            steps.createEl('li', { text: t('guide.lmstudio.step1') });
            steps.createEl('li', { text: t('guide.lmstudio.step2') });
            steps.createEl('li', { text: t('guide.lmstudio.step3') });
            steps.createEl('li', { text: t('guide.lmstudio.step4') });
            guide.createDiv({ cls: 'mcm-guide-tip', text: t('guide.lmstudio.tip') });

        } else if (provider === 'custom') {
            guide.createEl('strong', { text: t('guide.custom.heading') });
            const table = guide.createEl('table', { cls: 'mcm-guide-table' });
            const rows: [string, string, string][] = [
                ['Mistral', 'Get key at console.mistral.ai \u2192 API Keys', 'https://api.mistral.ai/v1'],
                ['Groq', 'Get key at console.groq.com \u2192 API Keys', 'https://api.groq.com/openai/v1'],
                ['OpenRouter', 'Get key at openrouter.ai \u2192 Keys', 'https://openrouter.ai/api/v1'],
            ];
            rows.forEach(([service, hint, url]) => {
                const tr = table.createEl('tr');
                tr.createEl('td', { text: service, cls: 'mcm-guide-service' });
                const td = tr.createEl('td');
                td.createSpan({ text: hint });
                tr.createEl('td', { cls: 'mcm-guide-url' }).createEl('code', { text: url });
            });
            guide.createDiv({ cls: 'mcm-guide-tip', text: t('guide.custom.tip') });
        }
    }

    private buildOllamaBrowser(container: HTMLElement): void {
        const browseBtn = container.createEl('button', { cls: 'mcm-browse-btn' });
        setIcon(browseBtn.createSpan('mcm-browse-icon'), 'list');
        const browseLabelEl = browseBtn.createSpan({ text: t('modal.modelConfig.browseInstalled') });

        const listEl = container.createDiv('mcm-model-list');
        listEl.classList.add('agent-u-hidden');

        browseBtn.addEventListener('click', () => { void (async () => {
            browseBtn.disabled = true;
            browseLabelEl.setText(t('modal.modelConfig.loadingModels'));
            listEl.empty();
            try {
                const baseUrl = this.formBaseUrl || 'http://localhost:11434';
                const models = await fetchOllamaModels(baseUrl);
                listEl.classList.remove('agent-u-hidden');
                if (models.length === 0) {
                    listEl.createDiv({ cls: 'mcm-model-empty', text: t('modal.modelConfig.noModelsOllama') });
                } else {
                    models.forEach((name) => {
                        const item = listEl.createEl('button', { cls: 'mcm-model-item', text: name });
                        item.addEventListener('click', () => {
                            this.formName = name;
                            if (this.nameInputEl) this.nameInputEl.value = name;
                            item.addClass('mcm-model-item-selected');
                            listEl.querySelectorAll('.mcm-model-item').forEach((el: Element) => {
                                if (el !== item) el.removeClass('mcm-model-item-selected');
                            });
                        });
                    });
                }
            } catch {
                listEl.classList.remove('agent-u-hidden');
                listEl.createDiv({
                    cls: 'mcm-model-empty',
                    text: t('modal.modelConfig.ollamaUnreachable'),
                });
            }
            browseBtn.disabled = false;
            browseLabelEl.setText(t('modal.modelConfig.browseInstalled'));
        })(); });
    }

    /** Browse models from an OpenAI-compatible local or remote server (LM Studio, Mistral, Groq...) */
    private buildCustomBrowser(container: HTMLElement): void {
        const browseBtn = container.createEl('button', { cls: 'mcm-browse-btn' });
        setIcon(browseBtn.createSpan('mcm-browse-icon'), 'list');
        const browseLabelEl = browseBtn.createSpan({ text: t('modal.modelConfig.browseAvailable') });

        const listEl = container.createDiv('mcm-model-list');
        listEl.classList.add('agent-u-hidden');

        browseBtn.addEventListener('click', () => { void (async () => {
            browseBtn.disabled = true;
            browseLabelEl.setText(t('modal.modelConfig.loadingModels'));
            listEl.empty();
            try {
                const models = await fetchProviderModels('custom', this.formApiKey, this.formBaseUrl || undefined);
                listEl.classList.remove('agent-u-hidden');
                if (models.length === 0) {
                    listEl.createDiv({ cls: 'mcm-model-empty', text: t('modal.modelConfig.noModelsUrl') });
                } else {
                    models.forEach(({ id }) => {
                        const item = listEl.createEl('button', { cls: 'mcm-model-item', text: id });
                        item.addEventListener('click', () => {
                            this.formName = id;
                            if (this.nameInputEl) this.nameInputEl.value = id;
                            item.addClass('mcm-model-item-selected');
                            listEl.querySelectorAll('.mcm-model-item').forEach((el: Element) => {
                                if (el !== item) el.removeClass('mcm-model-item-selected');
                            });
                        });
                    });
                }
            } catch (e: unknown) {
                listEl.classList.remove('agent-u-hidden');
                const errMsg = (e as { message?: string })?.message ?? 'Unknown error';
                listEl.createDiv({
                    cls: 'mcm-model-empty',
                    text: t('modal.modelConfig.serverUnreachable', { error: errMsg }),
                });
            }
            browseBtn.disabled = false;
            browseLabelEl.setText(t('modal.modelConfig.browseAvailable'));
        })(); });
    }

    private async runTest(): Promise<void> {
        if (!this.testBtn || !this.testResultEl) return;
        const m: CustomModel = {
            name: this.formName || this.model.name,
            provider: this.formProvider,
            apiKey: this.formApiKey || undefined,
            baseUrl: this.formBaseUrl || undefined,
            apiVersion: this.formApiVersion || undefined,
            enabled: true,
        };
        if (!m.name) { this.showTestResult(false, t('modal.modelConfig.enterModelIdFirst'), undefined); return; }
        this.testBtn.disabled = true;
        this.testBtn.setText(t('modal.modelConfig.testing'));
        this.testResultEl.classList.add('agent-u-hidden');
        const res = this.forEmbedding
            ? await testEmbeddingConnection(m)
            : await testModelConnection(m);
        this.testBtn.disabled = false;
        this.testBtn.setText(t('modal.modelConfig.testConnection'));
        this.showTestResult(res.ok, res.message, res.detail);
    }

    private showTestResult(ok: boolean, msg: string, detail: string | undefined): void {
        if (!this.testResultEl) return;
        this.testResultEl.empty();
        this.testResultEl.classList.remove('agent-u-hidden');
        this.testResultEl.className = `mcm-test-result ${ok ? 'mcm-ok' : 'mcm-err'}`;
        const header = this.testResultEl.createDiv('mcm-result-header');
        setIcon(header.createSpan('mcm-result-icon'), ok ? 'check-circle' : 'x-circle');
        header.createSpan({ text: msg });
        if (detail) {
            this.testResultEl.createDiv({ cls: 'mcm-result-detail', text: detail });
        }
    }

    private save(): void {
        const name = this.formName || this.model.name;
        if (!name) { new Notice(t('modal.modelConfig.modelIdRequired')); return; }
        this.onSave({
            ...this.model,
            name,
            provider: this.formProvider,
            displayName: this.formDisplayName || undefined,
            apiKey: this.formApiKey || undefined,
            baseUrl: this.formBaseUrl || undefined,
            apiVersion: this.formApiVersion || undefined,
            maxTokens: this.formMaxTokens,
            temperature: this.formTemperatureEnabled ? this.formTemperatureValue : undefined,
            promptCachingEnabled: this.formPromptCachingEnabled || undefined,
            thinkingEnabled: this.formThinkingEnabled || undefined,
            thinkingBudgetTokens: this.formThinkingEnabled ? this.formThinkingBudgetTokens : undefined,
        });
        this.close();
    }
}
