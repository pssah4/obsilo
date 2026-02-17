import { App, Modal, Notice, PluginSettingTab, Setting, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../main';
import type { CustomModel, ProviderType } from '../types/settings';
import { getModelKey, modelToLLMProvider } from '../types/settings';
import { buildApiHandler } from '../api/index';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROVIDER_LABELS: Record<string, string> = {
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    ollama: 'Ollama',
    openrouter: 'OpenRouter',
    azure: 'Azure OpenAI',
    custom: 'Custom',
};

const PROVIDER_COLORS: Record<string, string> = {
    anthropic: '#c27c4a',
    openai: '#10a37f',
    ollama: '#5c6bc0',
    openrouter: '#7c3aed',
    azure: '#0078d4',
    custom: '#78909c',
};

// Model suggestions shown in the Quick Pick dropdown per provider
// Grouped by provider → vendor → models (display label + exact API ID)
const MODEL_SUGGESTIONS: Record<string, { group: string; id: string; label: string }[]> = {
    anthropic: [
        { group: 'Anthropic', id: 'claude-opus-4-6',            label: 'Claude Opus 4.6' },
        { group: 'Anthropic', id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
        { group: 'Anthropic', id: 'claude-haiku-4-5-20251001',  label: 'Claude Haiku 4.5' },
    ],
    openai: [
        { group: 'GPT-4 family', id: 'gpt-4o',      label: 'GPT-4o' },
        { group: 'GPT-4 family', id: 'gpt-4o-mini',  label: 'GPT-4o mini' },
        { group: 'GPT-4 family', id: 'gpt-4.1',      label: 'GPT-4.1' },
        { group: 'GPT-4 family', id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
        { group: 'Reasoning',    id: 'o3',            label: 'o3' },
        { group: 'Reasoning',    id: 'o4-mini',       label: 'o4-mini' },
    ],
    openrouter: [
        { group: 'Anthropic',  id: 'anthropic/claude-opus-4',         label: 'Claude Opus 4' },
        { group: 'Anthropic',  id: 'anthropic/claude-sonnet-4-5',     label: 'Claude Sonnet 4.5' },
        { group: 'Anthropic',  id: 'anthropic/claude-3.5-sonnet',     label: 'Claude 3.5 Sonnet' },
        { group: 'OpenAI',     id: 'openai/gpt-4o',                   label: 'GPT-4o' },
        { group: 'OpenAI',     id: 'openai/gpt-4.1',                  label: 'GPT-4.1' },
        { group: 'OpenAI',     id: 'openai/o4-mini',                  label: 'o4-mini' },
        { group: 'Mistral',    id: 'mistralai/mistral-large-latest',  label: 'Mistral Large' },
        { group: 'Mistral',    id: 'mistralai/mistral-medium-3',      label: 'Mistral Medium 3' },
        { group: 'DeepSeek',   id: 'deepseek/deepseek-chat-v3-0324', label: 'DeepSeek V3' },
        { group: 'DeepSeek',   id: 'deepseek/deepseek-r1',           label: 'DeepSeek R1' },
        { group: 'Kimi',       id: 'moonshotai/kimi-k2',             label: 'Kimi K2' },
        { group: 'Kimi',       id: 'moonshotai/kimi-vl-a3b-thinking-preview:free', label: 'Kimi VL (free)' },
    ],
};

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

interface TestResult {
    ok: boolean;
    message: string;
    detail?: string;
}

async function testModelConnection(model: CustomModel): Promise<TestResult> {
    try {
        const lp = modelToLLMProvider({ ...model, maxTokens: 16 });
        const handler = buildApiHandler(lp);
        const abort = new AbortController();
        // Ollama needs to swap models into memory — allow up to 30 s
        const timeoutMs = model.provider === 'ollama' ? 30000 : 8000;
        const timer = setTimeout(() => abort.abort(), timeoutMs);
        try {
            const stream = handler.createMessage(
                'You are a test.',
                [{ role: 'user', content: 'Hi' }],
                [],
                abort.signal,
            );
            for await (const chunk of stream) {
                if (chunk.type === 'text' || chunk.type === 'usage') break;
            }
            return { ok: true, message: 'Connection successful ✓' };
        } finally {
            clearTimeout(timer);
        }
    } catch (err: any) {
        const isOllama = model.provider === 'ollama';
        const msg: string = err?.message ?? '';
        const s: number | undefined = err?.status;
        const isNetworkError = !s && (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('ECONNREFUSED') || msg.includes('ERR_CONNECTION_REFUSED'));

        if (err?.name === 'AbortError') {
            return {
                ok: false,
                message: isOllama ? 'Connection timed out (30 s)' : 'Connection timed out (8 s)',
                detail: isOllama
                    ? 'Ollama did not respond in time. Two possible causes:\n\n1. Ollama is not running → start it: ollama serve\n2. The model is large and still loading into memory → wait a moment and try again.'
                    : 'The server did not respond in time. Check your Base URL.',
            };
        }

        if (isNetworkError) {
            return {
                ok: false,
                message: 'Cannot connect to server',
                detail: isOllama
                    ? 'Ollama is not reachable at the Base URL. Make sure Ollama is running — it should start automatically after installation. You can also start it manually: ollama serve'
                    : 'Check that the Base URL is correct and the server is running.',
            };
        }

        if (s === 401) {
            return {
                ok: false,
                message: 'Invalid API key (401)',
                detail: model.provider === 'anthropic'
                    ? 'The key should start with sk-ant-... Get it from console.anthropic.com → API Keys.'
                    : model.provider === 'openai'
                    ? 'The key should start with sk-... Get it from platform.openai.com → API Keys.'
                    : 'Check that you copied the full API key from your provider dashboard.',
            };
        }

        if (s === 404) {
            if (isOllama) {
                return {
                    ok: false,
                    message: `Model "${model.name}" not found in Ollama`,
                    detail: `The model name must match exactly what Ollama has installed.\n\n1. Open a Terminal and run: ollama list\n2. Copy the exact name shown (e.g. llama3.2:latest)\n3. Paste it into the Model ID field above.\n\nIf the model is not installed yet: ollama pull ${model.name}`,
                };
            }
            return {
                ok: false,
                message: 'Model not found (404)',
                detail: 'The Model ID does not exist for this provider. Check the exact model name in your provider\'s documentation.',
            };
        }

        if (s === 429) {
            return { ok: false, message: 'Rate limit reached (429)', detail: 'You\'ve sent too many requests. Wait a moment and try again.' };
        }

        if (s === 403) {
            return { ok: false, message: 'Access denied (403)', detail: 'Your API key may not have permission to use this model, or billing is required.' };
        }

        return { ok: false, message: 'Connection failed', detail: msg || 'Unknown error' };
    }
}

/** Fetch model names installed in a local Ollama instance */
async function fetchOllamaModels(baseUrl: string): Promise<string[]> {
    // Native Ollama API is at root — strip /v1 suffix if present
    const root = (baseUrl || 'http://localhost:11434').replace(/\/v\d[^/]*\/?$/, '').replace(/\/+$/, '');
    const url = `${root}/api/tags`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return ((data.models ?? []) as any[]).map((m) => m.name as string).sort();
}

// ---------------------------------------------------------------------------
// Add / Configure Model Modal
// ---------------------------------------------------------------------------

export class ModelConfigModal extends Modal {
    private model: CustomModel;
    private isNew: boolean;
    private onSave: (model: CustomModel) => void;

    private formName: string;
    private formDisplayName: string;
    private formProvider: ProviderType;
    private formApiKey: string;
    private formBaseUrl: string;
    private formApiVersion: string;
    private formMaxTokens: number;

    private apiKeyRow: HTMLElement | null = null;
    private baseUrlRow: HTMLElement | null = null;
    private apiVersionRow: HTMLElement | null = null;
    private suggestRow: HTMLElement | null = null;
    private ollamaBrowserRow: HTMLElement | null = null;
    private providerGuideEl: HTMLElement | null = null;
    private apiKeyDescEl: HTMLElement | null = null;
    private baseUrlDescEl: HTMLElement | null = null;
    private testResultEl: HTMLElement | null = null;
    private testBtn: HTMLButtonElement | null = null;
    private nameInputEl: HTMLInputElement | null = null;
    private dnInputEl: HTMLInputElement | null = null;

    constructor(app: App, model: CustomModel | null, onSave: (m: CustomModel) => void) {
        super(app);
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
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('model-config-modal');
        contentEl.createEl('h3', {
            text: this.isNew ? 'Add Model' : `Configure — ${this.model.displayName ?? this.model.name}`,
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
        (['anthropic', 'openai', 'ollama', 'openrouter', 'azure', 'custom'] as ProviderType[]).forEach((p) => {
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
        const suggestSel = this.suggestRow.createEl('select', { cls: 'mcm-select' });
        suggestSel.createEl('option', { value: '', text: '— pick a model —', attr: { disabled: '', selected: '' } });
        suggestSel.addEventListener('change', () => {
            const val = suggestSel.value;
            const suggestions = MODEL_SUGGESTIONS[this.formProvider] ?? [];
            const found = suggestions.find((s) => s.id === val);
            if (found && this.nameInputEl) {
                this.formName = found.id;
                this.nameInputEl.value = found.id;
                if (this.dnInputEl && !this.dnInputEl.value) {
                    this.formDisplayName = found.label;
                    this.dnInputEl.value = found.label;
                }
            }
            // Reset to placeholder
            suggestSel.selectedIndex = 0;
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
        this.apiKeyRow.style.display = p === 'ollama' ? 'none' : '';
        this.baseUrlRow.style.display = (p === 'anthropic' || p === 'openai' || p === 'openrouter') ? 'none' : '';
        if (this.apiVersionRow) this.apiVersionRow.style.display = p === 'azure' ? '' : 'none';
        if (this.ollamaBrowserRow) this.ollamaBrowserRow.style.display = p === 'ollama' ? '' : 'none';

        // Quick Pick: show for providers that have suggestions, rebuild options
        const suggestions = MODEL_SUGGESTIONS[p] ?? [];
        if (this.suggestRow) {
            this.suggestRow.style.display = suggestions.length > 0 ? '' : 'none';
            const sel = this.suggestRow.querySelector('select');
            if (sel) {
                // Clear all but first placeholder option
                while (sel.options.length > 1) sel.remove(1);
                // Group options
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
                    sel.appendChild(og);
                });
                sel.selectedIndex = 0;
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
                azure: 'Your endpoint up to /openai, e.g. https://your-resource.openai.azure.com/openai',
                custom: 'Include /v1 suffix, e.g. http://localhost:1234/v1',
            };
            this.baseUrlDescEl.setText(hints[p] ?? '');
        }

        // Render provider setup guide
        this.providerGuideEl.empty();
        this.renderProviderGuide(this.providerGuideEl, p);
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

        } else if (provider === 'custom') {
            guide.createEl('strong', { text: 'OpenAI-compatible API (LM Studio, Mistral, Groq, etc.):' });
            const table = guide.createEl('table', { cls: 'mcm-guide-table' });
            const rows: [string, string, string][] = [
                ['LM Studio', 'Start "Local Server" in LM Studio → copy the URL shown', 'http://localhost:1234/v1'],
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
            guide.createDiv({ cls: 'mcm-guide-tip', text: '💡 LM Studio: leave API Key empty. For cloud services, enter the key from their dashboard.' });
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
                            listEl.querySelectorAll('.mcm-model-item').forEach((el) => {
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
        const res = await testModelConnection(m);
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
        });
        this.close();
    }
}

// ---------------------------------------------------------------------------
// Settings Tab
// ---------------------------------------------------------------------------

type TabId = 'models' | 'behavior';

export class AgentSettingsTab extends PluginSettingTab {
    plugin: ObsidianAgentPlugin;
    private activeTab: TabId = 'models';

    constructor(app: App, plugin: ObsidianAgentPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass('agent-settings');

        this.buildTabNav(containerEl);
        this.buildTabContent(containerEl);
    }

    // ---------------------------------------------------------------------------
    // Tab nav
    // ---------------------------------------------------------------------------

    private buildTabNav(container: HTMLElement): void {
        const nav = container.createDiv('agent-settings-nav');
        const tabs: { id: TabId; label: string }[] = [
            { id: 'models', label: 'Models' },
            { id: 'behavior', label: 'Behavior' },
        ];
        tabs.forEach(({ id, label }) => {
            const btn = nav.createEl('button', {
                cls: `agent-settings-tab${this.activeTab === id ? ' active' : ''}`,
                text: label,
            });
            btn.addEventListener('click', () => {
                this.activeTab = id;
                this.display();
            });
        });
    }

    // ---------------------------------------------------------------------------
    // Tab content router
    // ---------------------------------------------------------------------------

    private buildTabContent(container: HTMLElement): void {
        const content = container.createDiv('agent-settings-content');
        if (this.activeTab === 'models') this.buildModelsTab(content);
        if (this.activeTab === 'behavior') this.buildBehaviorTab(content);
    }

    // ---------------------------------------------------------------------------
    // Models tab
    // ---------------------------------------------------------------------------

    private buildModelsTab(container: HTMLElement): void {
        // Table header
        const table = container.createDiv('model-table');
        const header = table.createDiv('model-row model-row-header');
        header.createDiv({ cls: 'mc-name', text: 'Model' });
        header.createDiv({ cls: 'mc-provider', text: 'Provider' });
        header.createDiv({ cls: 'mc-key', text: 'Key' });
        header.createDiv({ cls: 'mc-enable', text: 'Enable' });
        header.createDiv({ cls: 'mc-actions' });

        // Rows
        const models = this.plugin.settings.activeModels;
        if (models.length === 0) {
            table.createDiv({ cls: 'model-table-empty', text: 'No models added yet. Click "+ Add Model" to get started.' });
        } else {
            models.forEach((model) => this.renderModelRow(table, model));
        }

        // Add model button
        const footer = container.createDiv('model-table-footer');
        const addBtn = footer.createEl('button', { cls: 'mod-cta model-add-btn', text: '+ Add Model' });
        addBtn.addEventListener('click', () => {
            new ModelConfigModal(this.app, null, async (newModel) => {
                const key = getModelKey(newModel);
                if (this.plugin.settings.activeModels.some((m) => getModelKey(m) === key)) {
                    new Notice(`"${newModel.name}" already exists`);
                    return;
                }
                this.plugin.settings.activeModels.push(newModel);
                await this.plugin.saveSettings();
                this.display();
            }).open();
        });
    }

    private renderModelRow(table: HTMLElement, model: CustomModel): void {
        const key = getModelKey(model);
        const hasKey = !!model.apiKey || model.provider === 'ollama';
        const isActive = this.plugin.settings.activeModelKey === key;

        const row = table.createDiv(`model-row${isActive ? ' model-row-active' : ''}`);

        // Name
        const nameEl = row.createDiv('mc-name');
        nameEl.createSpan({ text: model.displayName ?? model.name, cls: 'mc-name-text' });

        // Provider badge
        const provEl = row.createDiv('mc-provider');
        const badge = provEl.createSpan({ cls: 'provider-badge', text: PROVIDER_LABELS[model.provider] ?? model.provider });
        badge.style.background = PROVIDER_COLORS[model.provider] ?? '#607d8b';

        // Key indicator
        const keyEl = row.createDiv('mc-key');
        const keyIcon = keyEl.createSpan('mc-key-icon');
        setIcon(keyIcon, hasKey ? 'check' : 'minus');
        keyEl.addClass(hasKey ? 'mc-key-ok' : 'mc-key-missing');

        // Enable toggle
        const enableEl = row.createDiv('mc-enable');
        const toggle = enableEl.createEl('input', { attr: { type: 'checkbox' } });
        toggle.checked = model.enabled;
        toggle.addEventListener('change', async () => {
            const idx = this.plugin.settings.activeModels.findIndex((m) => getModelKey(m) === key);
            if (idx !== -1) this.plugin.settings.activeModels[idx].enabled = toggle.checked;
            await this.plugin.saveSettings();
            // Re-render just the row state without full redraw
            row.toggleClass('model-row-disabled', !toggle.checked);
        });

        // Actions
        const actionsEl = row.createDiv('mc-actions');
        const configBtn = actionsEl.createEl('button', { cls: 'mc-action-btn', attr: { title: 'Configure' } });
        setIcon(configBtn, 'settings');
        configBtn.addEventListener('click', () => {
            new ModelConfigModal(this.app, { ...model }, async (updated) => {
                const idx = this.plugin.settings.activeModels.findIndex((m) => getModelKey(m) === key);
                if (idx !== -1) this.plugin.settings.activeModels[idx] = updated;
                // If the active model was renamed, keep it active under the new key
                if (this.plugin.settings.activeModelKey === key) {
                    this.plugin.settings.activeModelKey = getModelKey(updated);
                }
                await this.plugin.saveSettings();
                this.display();
            }).open();
        });

        const delBtn = actionsEl.createEl('button', { cls: 'mc-action-btn mc-action-del', attr: { title: 'Remove model' } });
        setIcon(delBtn, 'trash');
        delBtn.addEventListener('click', async () => {
            this.plugin.settings.activeModels = this.plugin.settings.activeModels.filter(
                (m) => getModelKey(m) !== key,
            );
            if (this.plugin.settings.activeModelKey === key) this.plugin.settings.activeModelKey = '';
            await this.plugin.saveSettings();
            this.display();
        });
    }

    // ---------------------------------------------------------------------------
    // Behavior tab
    // ---------------------------------------------------------------------------

    private buildBehaviorTab(container: HTMLElement): void {
        new Setting(container)
            .setName('Auto-add active note as context')
            .setDesc('Automatically include the currently open note as context. Can be dismissed per-message via the × in the chat toolbar.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoAddActiveFileContext).onChange(async (v) => {
                    this.plugin.settings.autoAddActiveFileContext = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(container)
            .setName('Show Welcome Message')
            .setDesc('Show the welcome message when the sidebar opens')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.showWelcomeMessage).onChange(async (v) => {
                    this.plugin.settings.showWelcomeMessage = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(container)
            .setName('Debug Mode')
            .setDesc('Log detailed information to the browser console')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.debugMode).onChange(async (v) => {
                    this.plugin.settings.debugMode = v;
                    await this.plugin.saveSettings();
                }),
            );
    }
}
