/**
 * CodeImportModal — Paste API code snippets to auto-create model configurations.
 *
 * [Experimental] Opens a modal with:
 *   - Large monospace textarea for pasting code
 *   - Auto-parse with preview (provider, base URL, API version, model names)
 *   - Temperature input with model-aware defaults
 *   - API key input field
 *   - Test Connection button to validate settings before import
 *   - Import button to create CustomModel entries in bulk
 */

import { App, Modal, Notice, setIcon } from 'obsidian';
import type { CustomModel, ProviderType } from '../../types/settings';
import { parseCodeSnippet, getModelDefaults, type ParsedCodeConfig } from '../../core/config/CodeConfigParser';
import { PROVIDER_LABELS, PROVIDER_COLORS } from './constants';
import { testModelConnection } from './testModelConnection';
import { t } from '../../i18n';

const PROVIDER_OPTIONS: ProviderType[] = [
    'anthropic', 'openai', 'azure', 'ollama', 'lmstudio', 'openrouter', 'custom',
];

export class CodeImportModal extends Modal {
    private existingKeys: Set<string>;
    private onImport: (models: CustomModel[]) => void;

    private parsed: ParsedCodeConfig | null = null;
    private apiKeyInput = '';
    private temperatureInput: number | undefined = undefined;
    private temperatureManuallySet = false;
    private providerOverride: ProviderType | null = null;

    private previewEl: HTMLElement | null = null;
    private warningsEl: HTMLElement | null = null;
    private importBtn: HTMLButtonElement | null = null;
    private testResultEl: HTMLElement | null = null;
    private testBtn: HTMLButtonElement | null = null;
    private tempInputEl: HTMLInputElement | null = null;
    private tempNoteEl: HTMLElement | null = null;

    constructor(
        app: App,
        existingModelKeys: Set<string>,
        onImport: (models: CustomModel[]) => void,
    ) {
        super(app);
        this.existingKeys = existingModelKeys;
        this.onImport = onImport;
    }

    onOpen(): void {
        this.buildUI();
    }

    onClose(): void {
        this.contentEl.empty();
    }

    // ── UI Build ──────────────────────────────────────────────────────────

    private buildUI(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('code-import-modal');

        // Title with experimental tag
        const titleRow = contentEl.createDiv('cim-title-row');
        titleRow.createEl('h3', { text: t('modal.codeImport.title'), cls: 'cim-title' });
        titleRow.createSpan({ cls: 'cim-experimental-tag', text: t('modal.codeImport.tag') });

        // Instructions
        contentEl.createDiv({
            cls: 'cim-instructions',
            text: t('modal.codeImport.instructions'),
        });

        // Textarea
        const textarea = contentEl.createEl('textarea', {
            cls: 'cim-textarea',
            attr: {
                rows: '12',
                spellcheck: 'false',
                placeholder: [
                    '# Paste your API code here. Examples:',
                    '',
                    '# Python (Azure OpenAI)',
                    'client = openai.AzureOpenAI(',
                    '    base_url="https://your-endpoint/openai",',
                    '    api_key=os.environ["AZURE_KEY"],',
                    '    api_version="2024-10-21"',
                    ')',
                    'client.chat.completions.create(model="gpt-5")',
                    '',
                    '# JavaScript',
                    'const client = new OpenAI({ apiKey: "sk-..." })',
                    '',
                    '# curl',
                    'curl https://api.openai.com/v1/chat/completions \\',
                    '  -H "Authorization: Bearer $KEY" \\',
                    '  -d \'{"model": "gpt-4o"}\'',
                ].join('\n'),
            },
        });

        // Auto-parse on debounced input
        let timer: ReturnType<typeof setTimeout>;
        textarea.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                if (textarea.value.trim().length > 15) {
                    this.runParse(textarea.value);
                } else {
                    this.clearPreview();
                }
            }, 400);
        });

        // Parse button
        const parseRow = contentEl.createDiv('cim-parse-row');
        const parseBtn = parseRow.createEl('button', { cls: 'cim-parse-btn', text: t('modal.codeImport.parse') });
        parseBtn.addEventListener('click', () => this.runParse(textarea.value));

        // Preview section (hidden until parsed)
        this.previewEl = contentEl.createDiv('cim-preview');
        this.previewEl.classList.add('agent-u-hidden');

        // Warnings section
        this.warningsEl = contentEl.createDiv('cim-warnings');
        this.warningsEl.classList.add('agent-u-hidden');

        // API Key input
        const akRow = contentEl.createDiv('cim-apikey-row');
        akRow.createDiv({ cls: 'cim-apikey-label', text: t('modal.codeImport.apiKey') });
        akRow.createDiv({
            cls: 'cim-apikey-desc',
            text: t('modal.codeImport.apiKeyDesc'),
        });
        const akInput = akRow.createEl('input', {
            cls: 'cim-apikey-input',
            attr: { type: 'password', placeholder: t('modal.codeImport.apiKeyPlaceholder') },
        });
        akInput.addEventListener('input', () => {
            this.apiKeyInput = akInput.value.trim();
        });

        // Temperature input
        const tempRow = contentEl.createDiv('cim-temp-row');
        tempRow.createDiv({ cls: 'cim-temp-label', text: t('modal.codeImport.temperature') });
        this.tempNoteEl = tempRow.createDiv({ cls: 'cim-temp-desc' });
        this.tempNoteEl.setText(t('modal.codeImport.temperatureDesc'));
        this.tempInputEl = tempRow.createEl('input', {
            cls: 'cim-temp-input',
            attr: { type: 'number', step: '0.1', min: '0', max: '2', value: '0.2' },
        });
        this.temperatureInput = 0.2;
        this.tempInputEl.addEventListener('input', () => {
            const val = parseFloat(this.tempInputEl!.value);
            if (!isNaN(val) && val >= 0 && val <= 2) {
                this.temperatureInput = val;
                this.temperatureManuallySet = true;
            }
        });

        // Test Connection section
        const testRow = contentEl.createDiv('cim-test-row');
        this.testBtn = testRow.createEl('button', {
            cls: 'cim-test-btn',
            text: t('modal.codeImport.testConnection'),
        });
        this.testBtn.disabled = true;
        this.testBtn.addEventListener('click', () => void this.runTestConnection());
        this.testResultEl = testRow.createDiv('cim-test-result');

        // Actions bar
        const actions = contentEl.createDiv('cim-actions');
        const cancelBtn = actions.createEl('button', { text: t('modal.codeImport.cancel') });
        cancelBtn.addEventListener('click', () => this.close());

        this.importBtn = actions.createEl('button', {
            cls: 'mod-cta cim-import-btn',
            text: t('modal.codeImport.import'),
        });
        this.importBtn.disabled = true;
        this.importBtn.addEventListener('click', () => this.doImport());
    }

    // ── Parse & Preview ───────────────────────────────────────────────────

    private runParse(code: string): void {
        this.parsed = parseCodeSnippet(code);
        this.providerOverride = null;
        this.temperatureManuallySet = false;
        this.updateTemperatureDefaults();
        this.renderPreview();
    }

    private clearPreview(): void {
        this.parsed = null;
        if (this.previewEl) {
            this.previewEl.empty();
            this.previewEl.classList.add('agent-u-hidden');
        }
        if (this.warningsEl) {
            this.warningsEl.empty();
            this.warningsEl.classList.add('agent-u-hidden');
        }
        if (this.importBtn) {
            this.importBtn.disabled = true;
            this.importBtn.setText(t('modal.codeImport.import'));
        }
        if (this.testBtn) this.testBtn.disabled = true;
        if (this.testResultEl) {
            this.testResultEl.empty();
            this.testResultEl.classList.add('agent-u-hidden');
        }
    }

    private updateTemperatureDefaults(): void {
        if (!this.parsed || this.temperatureManuallySet) return;
        const provider = this.parsed.provider ?? this.providerOverride;
        const models = this.parsed.modelNames;
        if (!provider || models.length === 0) return;

        const firstModel = models[0];
        const defaults = getModelDefaults(firstModel, provider);

        if (defaults.temperatureFixed && defaults.temperature !== undefined) {
            this.temperatureInput = defaults.temperature;
            if (this.tempInputEl) {
                this.tempInputEl.value = String(defaults.temperature);
                this.tempInputEl.disabled = true;
            }
            if (this.tempNoteEl) {
                this.tempNoteEl.setText(defaults.note ?? t('modal.codeImport.temperatureFixed', { temperature: String(defaults.temperature) }));
                this.tempNoteEl.addClass('cim-temp-fixed');
            }
        } else {
            this.temperatureInput = 0.2;
            if (this.tempInputEl) {
                this.tempInputEl.value = '0.2';
                this.tempInputEl.disabled = false;
            }
            if (this.tempNoteEl) {
                this.tempNoteEl.setText(t('modal.codeImport.temperatureDesc'));
                this.tempNoteEl.removeClass('cim-temp-fixed');
            }
        }
    }

    private renderPreview(): void {
        if (!this.previewEl || !this.parsed || !this.warningsEl || !this.importBtn) return;

        const p = this.parsed;
        this.previewEl.empty();
        this.warningsEl.empty();

        const hasAnything = p.provider || p.baseUrl || p.modelNames.length > 0;
        this.previewEl.classList.toggle('agent-u-hidden', !hasAnything);

        if (!hasAnything) {
            this.updateImportButton();
            return;
        }

        const box = this.previewEl.createDiv('cim-preview-box');

        // Header: format tag + provider badge
        const header = box.createDiv('cim-preview-header');
        if (p.detectedFormat !== 'unknown') {
            header.createSpan({ cls: 'cim-format-tag', text: p.detectedFormat });
        }
        if (p.provider) {
            const badge = header.createSpan({
                cls: 'provider-badge',
                text: PROVIDER_LABELS[p.provider] ?? p.provider,
            });
            badge.style.setProperty('background', PROVIDER_COLORS[p.provider] ?? '#607d8b');
        } else {
            // Manual provider selector fallback
            const sel = header.createEl('select', { cls: 'cim-provider-sel' });
            sel.createEl('option', { value: '', text: t('modal.codeImport.selectProviderDropdown') });
            for (const prov of PROVIDER_OPTIONS) {
                sel.createEl('option', { value: prov, text: PROVIDER_LABELS[prov] ?? prov });
            }
            sel.addEventListener('change', () => {
                this.providerOverride = (sel.value || null) as ProviderType | null;
                this.temperatureManuallySet = false;
                this.updateTemperatureDefaults();
                this.renderModelList(box);
                this.updateImportButton();
            });
        }

        // Config fields
        if (p.baseUrl) {
            const row = box.createDiv('cim-preview-field');
            row.createSpan({ cls: 'cim-field-label', text: t('modal.codeImport.baseUrl') });
            row.createSpan({ cls: 'cim-field-value', text: p.baseUrl });
        }
        if (p.apiVersion) {
            const row = box.createDiv('cim-preview-field');
            row.createSpan({ cls: 'cim-field-label', text: t('modal.codeImport.apiVersion') });
            row.createSpan({ cls: 'cim-field-value', text: p.apiVersion });
        }

        // Model list
        this.renderModelList(box);

        // Warnings
        if (p.warnings.length > 0) {
            this.warningsEl.classList.remove('agent-u-hidden');
            for (const w of p.warnings) {
                const wEl = this.warningsEl.createDiv('cim-warning-item');
                const wIcon = wEl.createSpan('cim-warning-icon');
                setIcon(wIcon, 'alert-triangle');
                wEl.createSpan({ text: w });
            }
        } else {
            this.warningsEl.classList.add('agent-u-hidden');
        }

        this.updateImportButton();
    }

    // ── Model list ────────────────────────────────────────────────────────

    private renderModelList(box: HTMLElement): void {
        if (!this.parsed) return;

        box.querySelector('.cim-models-section')?.remove();

        if (this.parsed.modelNames.length === 0) return;

        const section = box.createDiv('cim-models-section');
        section.createDiv({
            cls: 'cim-models-header',
            text: t('modal.codeImport.modelsFound', { count: this.parsed.modelNames.length }),
        });

        const list = section.createDiv('cim-models-list');
        const effectiveProvider = this.parsed.provider ?? this.providerOverride;

        for (const name of this.parsed.modelNames) {
            const isDuplicate = effectiveProvider
                ? this.existingKeys.has(`${name}|${effectiveProvider}`)
                : false;

            const item = list.createDiv('cim-model-item');
            const icon = item.createSpan('cim-model-icon');
            setIcon(icon, isDuplicate ? 'alert-triangle' : 'check');
            icon.addClass(isDuplicate ? 'cim-warn' : 'cim-ok');

            item.createSpan({ cls: 'cim-model-name', text: name });
            if (isDuplicate) {
                item.createSpan({ cls: 'cim-model-dup', text: t('modal.codeImport.duplicate') });
            }

            // Show model-specific constraint notes
            if (effectiveProvider) {
                const defaults = getModelDefaults(name, effectiveProvider);
                if (defaults.note) {
                    item.createSpan({ cls: 'cim-model-note', text: defaults.note });
                }
            }
        }
    }

    private updateImportButton(): void {
        if (!this.importBtn || !this.parsed) return;
        const count = this.parsed.modelNames.length;
        const hasProvider = !!(this.parsed.provider ?? this.providerOverride);

        if (count > 0 && hasProvider) {
            this.importBtn.disabled = false;
            this.importBtn.setText(t('modal.codeImport.importCount', { count }));
        } else {
            this.importBtn.disabled = true;
            if (!hasProvider) {
                this.importBtn.setText(t('modal.codeImport.selectProvider'));
            } else {
                this.importBtn.setText(t('modal.codeImport.noModels'));
            }
        }

        // Enable test button when we have at least one model + provider
        if (this.testBtn) {
            this.testBtn.disabled = !(count > 0 && hasProvider);
        }
    }

    // ── Test Connection ───────────────────────────────────────────────────

    private async runTestConnection(): Promise<void> {
        if (!this.parsed || !this.testBtn || !this.testResultEl) return;

        const provider = this.parsed.provider ?? this.providerOverride;
        const models = this.parsed.modelNames;
        if (!provider || models.length === 0) return;

        // Build a temporary CustomModel from the first model name
        const firstName = models[0];
        const defaults = getModelDefaults(firstName, provider);
        const testModel: CustomModel = {
            name: firstName,
            provider,
            displayName: firstName,
            apiKey: this.apiKeyInput || this.parsed.apiKey || undefined,
            baseUrl: this.parsed.baseUrl || undefined,
            apiVersion: this.parsed.apiVersion || undefined,
            enabled: true,
            isBuiltIn: false,
            maxTokens: defaults.maxTokens,
            temperature: defaults.temperatureFixed
                ? defaults.temperature
                : this.temperatureInput,
        };

        // UI: show loading state
        this.testBtn.disabled = true;
        this.testBtn.setText(t('modal.codeImport.testingConnection'));
        this.testResultEl.empty();
        this.testResultEl.classList.remove('agent-u-hidden');
        this.testResultEl.className = 'cim-test-result';

        try {
            const result = await testModelConnection(testModel);

            this.testResultEl.empty();
            const resultIcon = this.testResultEl.createSpan('cim-test-icon');

            if (result.ok) {
                setIcon(resultIcon, 'check');
                this.testResultEl.addClass('cim-test-ok');
                this.testResultEl.createSpan({ text: result.message });
            } else {
                setIcon(resultIcon, 'x');
                this.testResultEl.addClass('cim-test-fail');
                this.testResultEl.createSpan({ text: result.message });

                // Check if the error is about temperature — provide actionable hint
                const detail = result.detail ?? '';
                if (detail.includes('temperature') && detail.includes('unsupported')) {
                    const hint = this.testResultEl.createDiv('cim-test-hint');
                    hint.setText(t('modal.codeImport.tempHint'));

                    // Auto-fix: set temperature to 1.0
                    if (this.tempInputEl) {
                        this.tempInputEl.value = '1.0';
                        this.tempInputEl.disabled = false;
                        this.temperatureInput = 1.0;
                        this.temperatureManuallySet = true;
                    }
                } else if (detail) {
                    const detailEl = this.testResultEl.createDiv('cim-test-detail');
                    detailEl.setText(detail.length > 200 ? detail.substring(0, 200) + '...' : detail);
                }
            }
        } catch (err: unknown) {
            this.testResultEl.empty();
            const resultIcon = this.testResultEl.createSpan('cim-test-icon');
            setIcon(resultIcon, 'x');
            this.testResultEl.addClass('cim-test-fail');
            this.testResultEl.createSpan({ text: (err as { message?: string })?.message ?? t('modal.codeImport.testFailed') });
        }

        this.testBtn.disabled = false;
        this.testBtn.setText(t('modal.codeImport.testConnection'));
    }

    // ── Import ────────────────────────────────────────────────────────────

    private doImport(): void {
        if (!this.parsed) return;

        const provider = this.parsed.provider ?? this.providerOverride;
        if (!provider) {
            new Notice(t('modal.codeImport.selectProviderNotice'));
            return;
        }

        const modelNames = this.parsed.modelNames;
        if (modelNames.length === 0) {
            new Notice(t('modal.codeImport.noModelsNotice'));
            return;
        }

        const models: CustomModel[] = modelNames.map((name) => {
            const defaults = getModelDefaults(name, provider);
            const temperature = defaults.temperatureFixed
                ? defaults.temperature
                : this.temperatureInput;
            return {
                name,
                provider,
                displayName: name,
                apiKey: this.apiKeyInput || this.parsed!.apiKey || undefined,
                baseUrl: this.parsed!.baseUrl || undefined,
                apiVersion: this.parsed!.apiVersion || undefined,
                enabled: true,
                isBuiltIn: false,
                maxTokens: defaults.maxTokens,
                temperature,
            };
        });

        this.onImport(models);
        this.close();
    }
}
