import { App, Modal, Notice, setIcon } from 'obsidian';
import type { CustomModel, ProviderType } from '../../types/settings';
import { PROVIDER_LABELS, PROVIDER_COLORS, MODEL_SUGGESTIONS, EMBEDDING_PROVIDERS, EMBEDDING_SUGGESTIONS } from './constants';
import { testModelConnection, testEmbeddingConnection, fetchProviderModels, fetchOllamaModels, fetchEmbeddingModels, isTemperatureFixed, maxTemperature } from './testModelConnection';

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
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('model-config-modal');
        contentEl.createEl('h3', {
            text: this.isNew
                ? (this.forEmbedding ? 'Add Embedding Model' : 'Add Model')
                : `Configure — ${this.model.displayName ?? this.model.name}`,
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
        const provRow = row('Provider');
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
        suggestLabel.createSpan({ text: 'Quick Pick' });
        suggestLabel.createSpan({ text: 'Select to pre-fill Model ID', cls: 'mcm-desc' });
        const suggestControls = this.suggestRow.createDiv('mcm-suggest-controls');
        this.suggestSelEl = suggestControls.createEl('select', { cls: 'mcm-select mcm-suggest-sel' });
        this.suggestSelEl.createEl('option', { value: '', text: '— pick a model —', attr: { disabled: '', selected: '' } });
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
        // ↻ Fetch button — fetches current model list from the provider's API
        const fetchBtn = suggestControls.createEl('button', { cls: 'mcm-fetch-btn', attr: { title: 'Fetch current models from provider API' } });
        setIcon(fetchBtn, 'refresh-cw');
        fetchBtn.addEventListener('click', async () => {
            if (!this.suggestSelEl) return;
            fetchBtn.disabled = true;
            setIcon(fetchBtn, 'loader');
            try {
                const models = this.forEmbedding
                    ? await fetchEmbeddingModels(this.formProvider, this.formApiKey, this.formBaseUrl || undefined, this.formApiVersion || undefined)
                    : await fetchProviderModels(this.formProvider, this.formApiKey, this.formBaseUrl || undefined);
                this.suggestSelEl.options.length = 0;
                this.suggestSelEl.createEl('option', { value: '', text: `— ${models.length} models fetched —`, attr: { disabled: '', selected: '' } });
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
            } catch (e: any) {
                // requestUrl can throw a Response-like object (no .message) — handle both
                const errMsg = e?.message ?? (e?.status ? `HTTP ${e.status}` : String(e));
                new Notice(`Failed to fetch models: ${errMsg}`);
            } finally {
                fetchBtn.disabled = false;
                setIcon(fetchBtn, 'refresh-cw');
            }
        });

        // ── Model ID ─────────────────────────────────────────────────────
        const nameRow = row('Model ID', 'Exact ID used in API calls');
        this.nameInputEl = nameRow.createEl('input', {
            cls: 'mcm-input',
            attr: { type: 'text', placeholder: 'gpt-4o' },
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
        const dnRow = row('Display Name', 'Label in chat toolbar');
        this.dnInputEl = dnRow.createEl('input', {
            cls: 'mcm-input',
            attr: { type: 'text', placeholder: this.formName || 'e.g. My GPT-4o' },
        });
        this.dnInputEl.value = this.formDisplayName;
        this.dnInputEl.addEventListener('input', () => (this.formDisplayName = this.dnInputEl!.value));

        // ── API Key ───────────────────────────────────────────────────────
        this.apiKeyRow = form.createDiv('mcm-row');
        const akLabel = this.apiKeyRow.createDiv('mcm-label');
        akLabel.createSpan({ text: 'API Key' });
        this.apiKeyDescEl = akLabel.createSpan({ cls: 'mcm-desc' });
        const akInput = this.apiKeyRow.createEl('input', {
            cls: 'mcm-input',
            attr: { type: 'password', placeholder: 'sk-...' },
        });
        akInput.value = this.formApiKey;
        akInput.addEventListener('input', () => (this.formApiKey = akInput.value.trim()));

        // ── Base URL ──────────────────────────────────────────────────────
        this.baseUrlRow = form.createDiv('mcm-row');
        const buLabel = this.baseUrlRow.createDiv('mcm-label');
        buLabel.createSpan({ text: 'Base URL' });
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
        avLabel.createSpan({ text: 'API Version' });
        avLabel.createSpan({ text: 'Required by Azure OpenAI (e.g. 2024-10-21)', cls: 'mcm-desc' });
        const avInput = this.apiVersionRow.createEl('input', {
            cls: 'mcm-input mcm-input-sm',
            attr: { type: 'text', placeholder: '2024-10-21' },
        });
        avInput.value = this.formApiVersion;
        avInput.addEventListener('input', () => (this.formApiVersion = avInput.value.trim()));

        // ── Max Tokens ────────────────────────────────────────────────────
        const mtRow = row('Max Tokens', 'Max length of the response');
        const mtInput = mtRow.createEl('input', {
            cls: 'mcm-input mcm-input-sm',
            attr: { type: 'number', placeholder: '8192' },
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
            tempLabel.createSpan({ text: 'Temperature' });
            tempLabel.createSpan({ text: 'Randomness of responses (0 = deterministic, higher = creative)', cls: 'mcm-desc' });

            const tempControls = this.temperatureRow.createDiv('mcm-temperature-controls');

            const toggleWrap = tempControls.createDiv('mcm-temperature-toggle');
            const toggleChk = toggleWrap.createEl('input', { attr: { type: 'checkbox' } });
            toggleChk.checked = this.formTemperatureEnabled;
            toggleWrap.createSpan({ text: 'Custom temperature', cls: 'mcm-temperature-toggle-label' });

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

        // Test result (inline)
        this.testResultEl = form.createDiv('mcm-test-result');
        this.testResultEl.style.display = 'none';

        this.updateFieldVisibility();
    }

    private buildActions(el: HTMLElement): void {
        const bar = el.createDiv('mcm-actions');

        this.testBtn = bar.createEl('button', { cls: 'mcm-btn-test', text: 'Test Connection' });
        this.testBtn.addEventListener('click', () => this.runTest());

        const saveBtn = bar.createEl('button', { cls: 'mod-cta', text: this.isNew ? 'Add' : 'Save' });
        saveBtn.addEventListener('click', () => this.save());

        const cancelBtn = bar.createEl('button', { text: 'Cancel' });
        cancelBtn.addEventListener('click', () => this.close());
    }

    private updateFieldVisibility(): void {
        if (!this.apiKeyRow || !this.baseUrlRow || !this.providerGuideEl) return;
        const p = this.formProvider;

        // Show/hide fields per provider
        this.apiKeyRow.style.display = (p === 'ollama' || p === 'lmstudio') ? 'none' : '';
        this.baseUrlRow.style.display = (p === 'anthropic' || p === 'openai' || p === 'openrouter') ? 'none' : '';
        if (this.apiVersionRow) this.apiVersionRow.style.display = p === 'azure' ? '' : 'none';
        if (this.ollamaBrowserRow) this.ollamaBrowserRow.style.display = p === 'ollama' ? '' : 'none';
        if (this.customBrowserRow) this.customBrowserRow.style.display = (p === 'custom' || p === 'lmstudio') ? '' : 'none';

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
            this.suggestRow.style.display = (hasStaticSuggestions || hasFetchFetch) ? '' : 'none';
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
                const fetchBtn = this.suggestRow.querySelector('.mcm-fetch-btn') as HTMLButtonElement | null;
                if (fetchBtn) fetchBtn.style.display = hasFetchFetch ? '' : 'none';
            }
        }

        // Update inline field hints
        if (this.apiKeyDescEl) {
            const hints: Record<string, string> = {
                anthropic: 'Starts with sk-ant-...',
                openai: 'Starts with sk-...',
                openrouter: 'Starts with sk-or-...',
                azure: 'Your Azure OpenAI API key',
                custom: 'Leave empty for local services',
            };
            this.apiKeyDescEl.setText(hints[p] ?? '');
        }
        if (this.baseUrlDescEl) {
            const hints: Record<string, string> = {
                ollama: 'Default: http://localhost:11434',
                lmstudio: 'Default: http://localhost:1234 (no /v1 needed)',
                azure: 'Your endpoint up to /openai, e.g. https://your-resource.openai.azure.com/openai',
                custom: 'Include /v1 suffix, e.g. http://localhost:1234/v1',
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
                this.temperatureNoteEl.setText('This model only accepts temperature = 1.0 (enforced by the API).');
                this.temperatureNoteEl.style.display = '';
            }
            this.temperatureRow.querySelectorAll('input[type=checkbox]').forEach((el: Element) => {
                (el as HTMLInputElement).checked = false;
                (el as HTMLInputElement).disabled = true;
            });
        } else {
            if (this.temperatureNoteEl) this.temperatureNoteEl.style.display = 'none';
            this.temperatureRow.querySelectorAll('input[type=checkbox]').forEach((el: Element) => {
                (el as HTMLInputElement).disabled = false;
            });
            this.temperatureSliderEl.disabled = !this.formTemperatureEnabled;
        }

        const sliderWrap = this.temperatureSliderEl.closest('.mcm-temperature-slider-wrap') as HTMLElement | null;
        if (sliderWrap) sliderWrap.style.display = this.formTemperatureEnabled ? '' : 'none';
    }

    private renderProviderGuide(container: HTMLElement, provider: ProviderType): void {
        const guide = container.createDiv('mcm-guide-inner');

        const link = (text: string, url: string): HTMLElement => {
            const a = createEl('a', { text, href: url });
            a.setAttribute('target', '_blank');
            a.setAttribute('rel', 'noopener noreferrer');
            return a;
        };

        if (provider === 'anthropic') {
            guide.createEl('strong', { text: 'How to get your Anthropic API key:' });
            const steps = guide.createEl('ol', { cls: 'mcm-guide-steps' });
            const s1 = steps.createEl('li');
            s1.appendText('Go to ');
            s1.appendChild(link('console.anthropic.com', 'https://console.anthropic.com'));
            s1.appendText(' and sign in (or create an account).');
            steps.createEl('li', { text: 'Click "API Keys" in the left sidebar.' });
            steps.createEl('li', { text: 'Click "Create Key", give it a name, and copy it.' });
            steps.createEl('li', { text: 'Paste the key (starts with sk-ant-...) into the API Key field above.' });
            guide.createDiv({ cls: 'mcm-guide-tip', text: '💡 Recommended model: claude-sonnet-4-5-20250929 (good balance of speed and quality).' });

        } else if (provider === 'openai') {
            guide.createEl('strong', { text: 'How to get your OpenAI API key:' });
            const steps = guide.createEl('ol', { cls: 'mcm-guide-steps' });
            const s1 = steps.createEl('li');
            s1.appendText('Go to ');
            s1.appendChild(link('platform.openai.com', 'https://platform.openai.com'));
            s1.appendText(' and sign in.');
            steps.createEl('li', { text: 'Click your name (top right) → "API keys".' });
            steps.createEl('li', { text: 'Click "Create new secret key" and copy it immediately (you can\'t see it again).' });
            steps.createEl('li', { text: 'Paste the key (starts with sk-...) into the API Key field above.' });
            guide.createDiv({ cls: 'mcm-guide-tip', text: '💡 Recommended model: gpt-4o. Budget alternative: gpt-4o-mini.' });

        } else if (provider === 'ollama') {
            guide.createEl('strong', { text: 'How to use Ollama (runs locally, no cost):' });
            const steps = guide.createEl('ol', { cls: 'mcm-guide-steps' });
            const s1 = steps.createEl('li');
            s1.appendText('Install Ollama from ');
            s1.appendChild(link('ollama.ai', 'https://ollama.ai'));
            s1.appendText('.');
            const s2 = steps.createEl('li');
            s2.appendText('Open a Terminal and pull a model, e.g.: ');
            s2.createEl('code', { text: 'ollama pull llama3.2' });
            const s3 = steps.createEl('li');
            s3.appendText('Ollama starts automatically. The Base URL is ');
            s3.createEl('code', { text: 'http://localhost:11434' });
            s3.appendText(' by default.');
            steps.createEl('li', { text: 'Enter the model name exactly as pulled (e.g. llama3.2) into Model ID above.' });
            guide.createDiv({ cls: 'mcm-guide-tip', text: '💡 Not all models support tool use. Recommended: qwen2.5:7b, llama3.2, mistral.' });

        } else if (provider === 'openrouter') {
            guide.createEl('strong', { text: 'How to use OpenRouter (access 100+ models with one key):' });
            const steps = guide.createEl('ol', { cls: 'mcm-guide-steps' });
            const s1 = steps.createEl('li');
            s1.appendText('Go to ');
            s1.appendChild(link('openrouter.ai', 'https://openrouter.ai'));
            s1.appendText(' and create a free account.');
            steps.createEl('li', { text: 'Click your avatar (top right) → Keys → Create Key.' });
            steps.createEl('li', { text: 'Copy the key (starts with sk-or-...) and paste it into the API Key field above.' });
            steps.createEl('li', { text: 'Enter the Model ID — use the exact OpenRouter model name, e.g. anthropic/claude-3.5-sonnet or openai/gpt-4o.' });
            const s5 = steps.createEl('li');
            s5.appendText('Browse all available models at ');
            s5.appendChild(link('openrouter.ai/models', 'https://openrouter.ai/models'));
            s5.appendText('.');
            guide.createDiv({ cls: 'mcm-guide-tip', text: '💡 The Base URL is pre-configured. Many models have a free tier — look for ":free" in the model name.' });

        } else if (provider === 'azure') {
            guide.createEl('strong', { text: 'How to use Azure OpenAI (enterprise deployments):' });
            const steps = guide.createEl('ol', { cls: 'mcm-guide-steps' });
            steps.createEl('li', { text: 'In the Azure Portal, open your Azure OpenAI resource.' });
            const s2 = steps.createEl('li');
            s2.appendText('Under "Resource Management" → "Keys and Endpoint", copy the ');
            s2.createEl('strong', { text: 'Key' });
            s2.appendText(' and the ');
            s2.createEl('strong', { text: 'Endpoint' });
            s2.appendText(' URL.');
            const s3 = steps.createEl('li');
            s3.appendText('In ');
            s3.createEl('strong', { text: 'Base URL' });
            s3.appendText(', enter: ');
            s3.createEl('code', { text: '{endpoint}/openai' });
            s3.appendText(' (e.g. ');
            s3.createEl('code', { text: 'https://my-resource.openai.azure.com/openai' });
            s3.appendText(').');
            const s4 = steps.createEl('li');
            s4.appendText('In ');
            s4.createEl('strong', { text: 'Model ID' });
            s4.appendText(', enter the exact ');
            s4.createEl('strong', { text: 'deployment name' });
            s4.appendText(' from Azure AI Studio (e.g. ');
            s4.createEl('code', { text: 'gpt-4o' });
            s4.appendText(').');
            steps.createEl('li', { text: 'Set the API Version to match what your deployment supports (default: 2024-10-21).' });
            guide.createDiv({ cls: 'mcm-guide-tip', text: '💡 For enterprise API gateways that route to Azure OpenAI: use the gateway base URL (up to /openai), deployment name as Model ID, and your gateway API key.' });

        } else if (provider === 'lmstudio') {
            guide.createEl('strong', { text: 'How to use LM Studio (local models, no cost, no API key):' });
            const steps = guide.createEl('ol', { cls: 'mcm-guide-steps' });
            const s1 = steps.createEl('li');
            s1.appendText('Download LM Studio from ');
            s1.appendChild(link('lmstudio.ai', 'https://lmstudio.ai'));
            s1.appendText(' and install a model of your choice.');
            const s2 = steps.createEl('li');
            s2.appendText('In LM Studio, go to the ');
            s2.createEl('strong', { text: 'Developer' });
            s2.appendText(' tab (left sidebar) and start the Local Server.');
            steps.createEl('li', { text: 'The default Base URL is http://localhost:1234 — no API key needed.' });
            steps.createEl('li', { text: 'Click "Browse available models" below to pick a loaded model.' });
            guide.createDiv({ cls: 'mcm-guide-tip', text: '💡 Make sure to load a model in LM Studio before starting the server, otherwise no models will appear.' });

        } else if (provider === 'custom') {
            guide.createEl('strong', { text: 'OpenAI-compatible API (Mistral, Groq, etc.):' });
            const table = guide.createEl('table', { cls: 'mcm-guide-table' });
            const rows: [string, string, string][] = [
                ['Mistral', 'Get key at console.mistral.ai → API Keys', 'https://api.mistral.ai/v1'],
                ['Groq', 'Get key at console.groq.com → API Keys', 'https://api.groq.com/openai/v1'],
                ['OpenRouter', 'Get key at openrouter.ai → Keys', 'https://openrouter.ai/api/v1'],
            ];
            rows.forEach(([service, hint, url]) => {
                const tr = table.createEl('tr');
                tr.createEl('td', { text: service, cls: 'mcm-guide-service' });
                const td = tr.createEl('td');
                td.createSpan({ text: hint });
                tr.createEl('td', { cls: 'mcm-guide-url' }).createEl('code', { text: url });
            });
            guide.createDiv({ cls: 'mcm-guide-tip', text: '💡 Any OpenAI-compatible endpoint. Enter the base URL with /v1 suffix and your API key.' });
        }
    }

    private buildOllamaBrowser(container: HTMLElement): void {
        const browseBtn = container.createEl('button', { cls: 'mcm-browse-btn' });
        setIcon(browseBtn.createSpan('mcm-browse-icon'), 'list');
        const browseLabelEl = browseBtn.createSpan({ text: 'Browse installed models' });

        const listEl = container.createDiv('mcm-model-list');
        listEl.style.display = 'none';

        browseBtn.addEventListener('click', async () => {
            browseBtn.disabled = true;
            browseLabelEl.setText('Loading…');
            listEl.empty();
            try {
                const baseUrl = this.formBaseUrl || 'http://localhost:11434';
                const models = await fetchOllamaModels(baseUrl);
                listEl.style.display = '';
                if (models.length === 0) {
                    listEl.createDiv({ cls: 'mcm-model-empty', text: 'No models found. Pull one first, e.g.: ollama pull llama3.2' });
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
                listEl.style.display = '';
                listEl.createDiv({
                    cls: 'mcm-model-empty',
                    text: 'Cannot reach Ollama. Make sure it is running, then try again.',
                });
            }
            browseBtn.disabled = false;
            browseLabelEl.setText('Browse installed models');
        });
    }

    /** Browse models from an OpenAI-compatible local or remote server (LM Studio, Mistral, Groq…) */
    private buildCustomBrowser(container: HTMLElement): void {
        const browseBtn = container.createEl('button', { cls: 'mcm-browse-btn' });
        setIcon(browseBtn.createSpan('mcm-browse-icon'), 'list');
        const browseLabelEl = browseBtn.createSpan({ text: 'Browse available models' });

        const listEl = container.createDiv('mcm-model-list');
        listEl.style.display = 'none';

        browseBtn.addEventListener('click', async () => {
            browseBtn.disabled = true;
            browseLabelEl.setText('Loading…');
            listEl.empty();
            try {
                const models = await fetchProviderModels('custom', this.formApiKey, this.formBaseUrl || undefined);
                listEl.style.display = '';
                if (models.length === 0) {
                    listEl.createDiv({ cls: 'mcm-model-empty', text: 'No models found at this Base URL.' });
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
            } catch (e: any) {
                listEl.style.display = '';
                listEl.createDiv({
                    cls: 'mcm-model-empty',
                    text: `Cannot reach server: ${e?.message ?? 'Unknown error'}. Check Base URL and try again.`,
                });
            }
            browseBtn.disabled = false;
            browseLabelEl.setText('Browse available models');
        });
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
        if (!m.name) { this.showTestResult(false, 'Enter a Model ID first', undefined); return; }
        this.testBtn.disabled = true;
        this.testBtn.setText('Testing…');
        this.testResultEl.style.display = 'none';
        const res = this.forEmbedding
            ? await testEmbeddingConnection(m)
            : await testModelConnection(m);
        this.testBtn.disabled = false;
        this.testBtn.setText('Test Connection');
        this.showTestResult(res.ok, res.message, res.detail);
    }

    private showTestResult(ok: boolean, msg: string, detail: string | undefined): void {
        if (!this.testResultEl) return;
        this.testResultEl.empty();
        this.testResultEl.style.display = '';
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
        if (!name) { new Notice('Model ID is required'); return; }
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
        });
        this.close();
    }
}
