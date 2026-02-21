/**
 * CodeImportModal — Paste API code snippets to auto-create model configurations.
 *
 * Opens a modal with:
 *   - Large monospace textarea for pasting code
 *   - Auto-parse with preview (provider, base URL, API version, model names)
 *   - API key input field
 *   - Import button to create CustomModel entries in bulk
 */

import { App, Modal, Notice, setIcon } from 'obsidian';
import type { CustomModel, ProviderType } from '../../types/settings';
import { getModelKey } from '../../types/settings';
import { parseCodeSnippet, type ParsedCodeConfig } from '../../core/config/CodeConfigParser';
import { PROVIDER_LABELS, PROVIDER_COLORS } from './constants';

const PROVIDER_OPTIONS: ProviderType[] = [
    'anthropic', 'openai', 'azure', 'ollama', 'lmstudio', 'openrouter', 'custom',
];

export class CodeImportModal extends Modal {
    private existingKeys: Set<string>;
    private onImport: (models: CustomModel[]) => void;

    private parsed: ParsedCodeConfig | null = null;
    private apiKeyInput = '';
    private providerOverride: ProviderType | null = null;

    private previewEl: HTMLElement | null = null;
    private warningsEl: HTMLElement | null = null;
    private importBtn: HTMLButtonElement | null = null;

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

        // Title
        contentEl.createEl('h3', { text: 'Import Models from Code', cls: 'cim-title' });

        // Instructions
        contentEl.createDiv({
            cls: 'cim-instructions',
            text: 'Paste an API code snippet (Python, JavaScript, or curl) to automatically extract model configuration.',
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
        const parseBtn = parseRow.createEl('button', { cls: 'cim-parse-btn', text: 'Parse Snippet' });
        parseBtn.addEventListener('click', () => this.runParse(textarea.value));

        // Preview section (hidden until parsed)
        this.previewEl = contentEl.createDiv('cim-preview');
        this.previewEl.style.display = 'none';

        // Warnings section
        this.warningsEl = contentEl.createDiv('cim-warnings');
        this.warningsEl.style.display = 'none';

        // API Key input
        const akRow = contentEl.createDiv('cim-apikey-row');
        akRow.createDiv({ cls: 'cim-apikey-label', text: 'API Key' });
        akRow.createDiv({
            cls: 'cim-apikey-desc',
            text: 'Optional. You can also add it later in each model\'s settings.',
        });
        const akInput = akRow.createEl('input', {
            cls: 'cim-apikey-input',
            attr: { type: 'password', placeholder: 'sk-...' },
        });
        akInput.addEventListener('input', () => {
            this.apiKeyInput = akInput.value.trim();
        });

        // Actions bar
        const actions = contentEl.createDiv('cim-actions');
        const cancelBtn = actions.createEl('button', { text: 'Cancel' });
        cancelBtn.addEventListener('click', () => this.close());

        this.importBtn = actions.createEl('button', {
            cls: 'mod-cta cim-import-btn',
            text: 'Import',
        }) as HTMLButtonElement;
        this.importBtn.disabled = true;
        this.importBtn.addEventListener('click', () => this.doImport());
    }

    // ── Parse & Preview ───────────────────────────────────────────────────

    private runParse(code: string): void {
        this.parsed = parseCodeSnippet(code);
        this.providerOverride = null;
        this.renderPreview();
    }

    private clearPreview(): void {
        this.parsed = null;
        if (this.previewEl) {
            this.previewEl.empty();
            this.previewEl.style.display = 'none';
        }
        if (this.warningsEl) {
            this.warningsEl.empty();
            this.warningsEl.style.display = 'none';
        }
        if (this.importBtn) {
            this.importBtn.disabled = true;
            this.importBtn.setText('Import');
        }
    }

    private renderPreview(): void {
        if (!this.previewEl || !this.parsed || !this.warningsEl || !this.importBtn) return;

        const p = this.parsed;
        this.previewEl.empty();
        this.warningsEl.empty();

        const hasAnything = p.provider || p.baseUrl || p.modelNames.length > 0;
        this.previewEl.style.display = hasAnything ? '' : 'none';

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
            badge.style.background = PROVIDER_COLORS[p.provider] ?? '#607d8b';
        } else {
            // Manual provider selector fallback
            const sel = header.createEl('select', { cls: 'cim-provider-sel' });
            sel.createEl('option', { value: '', text: '-- Select provider --' });
            for (const prov of PROVIDER_OPTIONS) {
                sel.createEl('option', { value: prov, text: PROVIDER_LABELS[prov] ?? prov });
            }
            sel.addEventListener('change', () => {
                this.providerOverride = (sel.value || null) as ProviderType | null;
                this.renderModelList(box);
                this.updateImportButton();
            });
        }

        // Config fields
        if (p.baseUrl) {
            const row = box.createDiv('cim-preview-field');
            row.createSpan({ cls: 'cim-field-label', text: 'Base URL' });
            row.createSpan({ cls: 'cim-field-value', text: p.baseUrl });
        }
        if (p.apiVersion) {
            const row = box.createDiv('cim-preview-field');
            row.createSpan({ cls: 'cim-field-label', text: 'API Version' });
            row.createSpan({ cls: 'cim-field-value', text: p.apiVersion });
        }

        // Model list
        this.renderModelList(box);

        // Warnings
        if (p.warnings.length > 0) {
            this.warningsEl.style.display = '';
            for (const w of p.warnings) {
                const wEl = this.warningsEl.createDiv('cim-warning-item');
                const wIcon = wEl.createSpan('cim-warning-icon');
                setIcon(wIcon, 'alert-triangle');
                wEl.createSpan({ text: w });
            }
        } else {
            this.warningsEl.style.display = 'none';
        }

        this.updateImportButton();
    }

    private renderModelList(box: HTMLElement): void {
        if (!this.parsed) return;

        // Remove existing model section if re-rendering
        const existing = box.querySelector('.cim-models-section');
        if (existing) existing.remove();

        if (this.parsed.modelNames.length === 0) return;

        const section = box.createDiv('cim-models-section');
        section.createDiv({
            cls: 'cim-models-header',
            text: `Models found (${this.parsed.modelNames.length}):`,
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
                item.createSpan({ cls: 'cim-model-dup', text: '(already exists)' });
            }
        }
    }

    private updateImportButton(): void {
        if (!this.importBtn || !this.parsed) return;
        const count = this.parsed.modelNames.length;
        const hasProvider = !!(this.parsed.provider ?? this.providerOverride);

        if (count > 0 && hasProvider) {
            this.importBtn.disabled = false;
            this.importBtn.setText(`Import ${count} Model${count > 1 ? 's' : ''}`);
        } else {
            this.importBtn.disabled = true;
            this.importBtn.setText(count === 0 ? 'No models found' : 'Select a provider');
        }
    }

    // ── Import ────────────────────────────────────────────────────────────

    private doImport(): void {
        if (!this.parsed) return;

        const provider = this.parsed.provider ?? this.providerOverride;
        if (!provider) {
            new Notice('Please select a provider.');
            return;
        }

        const models: CustomModel[] = this.parsed.modelNames.map((name) => ({
            name,
            provider,
            displayName: name,
            apiKey: this.apiKeyInput || this.parsed!.apiKey || undefined,
            baseUrl: this.parsed!.baseUrl || undefined,
            apiVersion: this.parsed!.apiVersion || undefined,
            enabled: true,
            isBuiltIn: false,
            maxTokens: 8192,
        }));

        this.onImport(models);
        this.close();
    }
}
