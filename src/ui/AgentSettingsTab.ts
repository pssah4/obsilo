import { App, Modal, Notice, PluginSettingTab, Setting, requestUrl, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../main';
import type { CustomModel, ModeConfig, ProviderType } from '../types/settings';
import { getModelKey, modelToLLMProvider } from '../types/settings';
import { buildApiHandler } from '../api/index';
import { BUILT_IN_MODES, TOOL_GROUP_MAP } from '../core/modes/builtinModes';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROVIDER_LABELS: Record<string, string> = {
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    ollama: 'Ollama',
    lmstudio: 'LM Studio',
    openrouter: 'OpenRouter',
    azure: 'Azure OpenAI',
    custom: 'Custom',
};

const PROVIDER_COLORS: Record<string, string> = {
    anthropic: '#c27c4a',
    openai: '#10a37f',
    ollama: '#5c6bc0',
    lmstudio: '#e05c2c',
    openrouter: '#7c3aed',
    azure: '#0078d4',
    custom: '#78909c',
};

// Model suggestions shown in the Quick Pick dropdown per provider
// Grouped by provider → vendor → models (display label + exact API ID)
const MODEL_SUGGESTIONS: Record<string, { group: string; id: string; label: string }[]> = {
    anthropic: [
        // Claude 4 family
        { group: 'Claude 4',   id: 'claude-opus-4-6',            label: 'Claude Opus 4.6' },
        { group: 'Claude 4',   id: 'claude-sonnet-4-5',          label: 'Claude Sonnet 4.5' },
        { group: 'Claude 4',   id: 'claude-haiku-4-5-20251001',  label: 'Claude Haiku 4.5' },
        // Claude 3.7 / 3.5
        { group: 'Claude 3.x', id: 'claude-3-7-sonnet-20250219', label: 'Claude 3.7 Sonnet' },
        { group: 'Claude 3.x', id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
        { group: 'Claude 3.x', id: 'claude-3-5-haiku-20241022',  label: 'Claude 3.5 Haiku' },
    ],
    openai: [
        // GPT-5 family (2025–2026)
        { group: 'GPT-5',      id: 'gpt-5',          label: 'GPT-5' },
        { group: 'GPT-5',      id: 'gpt-5-mini',     label: 'GPT-5 mini' },
        // GPT-4.1 family
        { group: 'GPT-4.1',    id: 'gpt-4.1',        label: 'GPT-4.1' },
        { group: 'GPT-4.1',    id: 'gpt-4.1-mini',   label: 'GPT-4.1 mini' },
        { group: 'GPT-4.1',    id: 'gpt-4.1-nano',   label: 'GPT-4.1 nano' },
        // GPT-4o (still widely used)
        { group: 'GPT-4o',     id: 'gpt-4o',         label: 'GPT-4o' },
        { group: 'GPT-4o',     id: 'gpt-4o-mini',    label: 'GPT-4o mini' },
        // Reasoning (o-series)
        { group: 'Reasoning',  id: 'o3',              label: 'o3' },
        { group: 'Reasoning',  id: 'o4-mini',         label: 'o4-mini' },
        { group: 'Reasoning',  id: 'o1',              label: 'o1' },
        // Codex
        { group: 'Codex',      id: 'codex-mini-latest', label: 'Codex Mini' },
    ],
    openrouter: [
        { group: 'Anthropic',  id: 'anthropic/claude-opus-4-6',           label: 'Claude Opus 4.6' },
        { group: 'Anthropic',  id: 'anthropic/claude-sonnet-4-5',         label: 'Claude Sonnet 4.5' },
        { group: 'Anthropic',  id: 'anthropic/claude-3-7-sonnet-20250219',label: 'Claude 3.7 Sonnet' },
        { group: 'Anthropic',  id: 'anthropic/claude-3.5-sonnet',         label: 'Claude 3.5 Sonnet' },
        { group: 'OpenAI',     id: 'openai/gpt-5',                        label: 'GPT-5' },
        { group: 'OpenAI',     id: 'openai/gpt-4.1',                      label: 'GPT-4.1' },
        { group: 'OpenAI',     id: 'openai/gpt-4o',                       label: 'GPT-4o' },
        { group: 'OpenAI',     id: 'openai/o3',                           label: 'o3' },
        { group: 'OpenAI',     id: 'openai/o4-mini',                      label: 'o4-mini' },
        { group: 'Mistral',    id: 'mistralai/mistral-large-latest',       label: 'Mistral Large' },
        { group: 'Mistral',    id: 'mistralai/mistral-medium-3',           label: 'Mistral Medium 3' },
        { group: 'DeepSeek',   id: 'deepseek/deepseek-chat-v3-0324',      label: 'DeepSeek V3' },
        { group: 'DeepSeek',   id: 'deepseek/deepseek-r1',                label: 'DeepSeek R1' },
        { group: 'Kimi',       id: 'moonshotai/kimi-k2',                  label: 'Kimi K2' },
    ],
};

// Providers that support embedding APIs (Anthropic has none)
const EMBEDDING_PROVIDERS: ProviderType[] = ['openai', 'openrouter', 'azure', 'ollama', 'lmstudio', 'custom'];

// Embedding model suggestions per provider (exact API IDs)
const EMBEDDING_SUGGESTIONS: Record<string, { group: string; id: string; label: string }[]> = {
    openai: [
        { group: 'OpenAI',  id: 'text-embedding-3-small', label: 'text-embedding-3-small  (1 536 dims, recommended)' },
        { group: 'OpenAI',  id: 'text-embedding-3-large', label: 'text-embedding-3-large  (3 072 dims, highest quality)' },
        { group: 'Legacy',  id: 'text-embedding-ada-002', label: 'text-embedding-ada-002  (1 536 dims, legacy)' },
    ],
    azure: [
        // Azure uses deployment names — these are the common model IDs deployed on Azure
        { group: 'Azure',   id: 'text-embedding-3-small', label: 'text-embedding-3-small  (deployment name)' },
        { group: 'Azure',   id: 'text-embedding-3-large', label: 'text-embedding-3-large  (deployment name)' },
        { group: 'Legacy',  id: 'text-embedding-ada-002', label: 'text-embedding-ada-002  (deployment name)' },
    ],
    ollama: [
        { group: 'Ollama',  id: 'nomic-embed-text',         label: 'nomic-embed-text  (768 dims, popular)' },
        { group: 'Ollama',  id: 'mxbai-embed-large',        label: 'mxbai-embed-large  (1 024 dims)' },
        { group: 'Ollama',  id: 'all-minilm',               label: 'all-minilm  (384 dims, fast)' },
        { group: 'Ollama',  id: 'bge-large-en-v1.5',        label: 'bge-large-en-v1.5  (1 024 dims)' },
        { group: 'Ollama',  id: 'snowflake-arctic-embed2',  label: 'snowflake-arctic-embed2  (1 024 dims)' },
    ],
    openrouter: [
        { group: 'OpenAI',  id: 'openai/text-embedding-3-small', label: 'text-embedding-3-small  (1 536 dims)' },
        { group: 'OpenAI',  id: 'openai/text-embedding-3-large', label: 'text-embedding-3-large  (3 072 dims)' },
        { group: 'OpenAI',  id: 'openai/text-embedding-ada-002', label: 'text-embedding-ada-002  (1 536 dims, legacy)' },
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

/**
 * Test an embedding model connection by calling the /embeddings endpoint.
 * Azure uses: {base}/deployments/{model}/embeddings?api-version={version}
 * OpenAI uses: https://api.openai.com/v1/embeddings
 */
async function testEmbeddingConnection(model: CustomModel): Promise<TestResult> {
    try {
        let url: string;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        const body: Record<string, any> = { input: 'test' };

        if (model.provider === 'azure') {
            const base = (model.baseUrl ?? '').replace(/\/+$/, '');
            const apiVersion = model.apiVersion ?? '2024-10-21';
            url = `${base}/deployments/${model.name}/embeddings?api-version=${apiVersion}`;
            if (model.apiKey) headers['api-key'] = model.apiKey;
        } else if (model.provider === 'openai') {
            url = 'https://api.openai.com/v1/embeddings';
            body.model = model.name;
            if (model.apiKey) headers['Authorization'] = `Bearer ${model.apiKey}`;
        } else if (model.provider === 'openrouter') {
            url = 'https://openrouter.ai/api/v1/embeddings';
            body.model = model.name;
            if (model.apiKey) headers['Authorization'] = `Bearer ${model.apiKey}`;
        } else if (model.provider === 'ollama' || model.provider === 'lmstudio') {
            const base = (model.baseUrl || (model.provider === 'lmstudio' ? 'http://localhost:1234' : 'http://localhost:11434'))
                .replace(/\/v1\/?$/, '').replace(/\/+$/, '');
            url = `${base}/v1/embeddings`;
            body.model = model.name;
            if (model.apiKey) headers['Authorization'] = `Bearer ${model.apiKey}`;
        } else {
            // custom
            const base = (model.baseUrl ?? '').replace(/\/+$/, '');
            url = `${base}/embeddings`;
            body.model = model.name;
            if (model.apiKey) headers['Authorization'] = `Bearer ${model.apiKey}`;
        }

        const res = await requestUrl({
            url,
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            throw: false,
        });

        if (res.status === 200) {
            const data = res.json;
            const dims = data?.data?.[0]?.embedding?.length;
            return {
                ok: true,
                message: 'Embedding successful ✓' + (dims ? ` (${dims} dimensions)` : ''),
            };
        }
        if (res.status === 401) return { ok: false, message: 'Invalid API key (401)' };
        if (res.status === 404) return { ok: false, message: 'Deployment / model not found (404)', detail: 'Check that the Model ID matches the exact deployment name.' };
        if (res.status === 400) {
            const errText = (() => { try { return JSON.stringify(res.json); } catch { return res.text; } })();
            return { ok: false, message: `Bad request (400)`, detail: errText };
        }
        return { ok: false, message: `HTTP ${res.status}`, detail: (() => { try { return JSON.stringify(res.json); } catch { return res.text; } })() };
    } catch (err: any) {
        const msg: string = err?.message ?? String(err);
        return { ok: false, message: 'Connection failed', detail: msg };
    }
}

/**
 * Fetch the current model list from a provider's API.
 * Returns { id, label } pairs for display in the Quick Pick dropdown.
 */
async function fetchProviderModels(
    provider: ProviderType,
    apiKey: string,
    baseUrl?: string,
): Promise<{ id: string; label: string }[]> {
    // Helper: Obsidian's requestUrl throws on 4xx/5xx — use throw:false to always get response
    const req = (url: string, headers: Record<string, string> = {}) =>
        requestUrl({ url, method: 'GET', headers, throw: false });

    if (provider === 'anthropic') {
        if (!apiKey) throw new Error('API key required for Anthropic');
        const res = await req('https://api.anthropic.com/v1/models',
            { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' });
        if (res.status === 401) throw new Error('Invalid API key (401 Unauthorized)');
        if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
        const data = res.json;
        const CHAT_RE = /^claude-/;
        return (data.data ?? [])
            .filter((m: any) => CHAT_RE.test(m.id))
            .map((m: any) => ({ id: m.id as string, label: (m.display_name ?? m.id) as string }))
            .sort((a: any, b: any) => b.id.localeCompare(a.id));
    }

    if (provider === 'openai') {
        if (!apiKey) throw new Error('API key required for OpenAI');
        const res = await req('https://api.openai.com/v1/models',
            { 'Authorization': `Bearer ${apiKey}` });
        if (res.status === 401) throw new Error('Invalid API key (401 Unauthorized)');
        if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
        const data = res.json;
        // Keep only chat-capable models; exclude fine-tunes, TTS, embeddings, DALL-E
        const CHAT_RE = /^(gpt-|o[1-9]|chatgpt-|codex-)/;
        const EXCLUDE_RE = /-(instruct|vision-preview|0314|0301|0613|0914|32k)$|:ft-/;
        return (data.data ?? [])
            .filter((m: any) => CHAT_RE.test(m.id) && !EXCLUDE_RE.test(m.id))
            .map((m: any) => ({ id: m.id as string, label: m.id as string }))
            .sort((a: any, b: any) => (b.created ?? 0) - (a.created ?? 0));
    }

    if (provider === 'openrouter') {
        const headers: Record<string, string> = apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {};
        const res = await req('https://openrouter.ai/api/v1/models', headers);
        if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
        const data = res.json;
        // Only include models that support tool calling (function calling)
        return (data.data ?? [])
            .filter((m: any) => {
                const caps: string[] = m.supported_parameters ?? [];
                // If the API doesn't expose capabilities, include all (older API format)
                if (caps.length === 0) return true;
                return caps.includes('tools') || caps.includes('tool_choice');
            })
            .map((m: any) => ({ id: m.id as string, label: (m.name ?? m.id) as string }))
            .sort((a: any, b: any) => a.id.localeCompare(b.id));
    }

    // lmstudio — OpenAI-compatible local server, default port 1234
    if (provider === 'lmstudio') {
        const root = (baseUrl || 'http://localhost:1234').replace(/\/v1\/?$/, '').replace(/\/+$/, '');
        const res = await req(`${root}/v1/models`);
        if (res.status !== 200) throw new Error(`HTTP ${res.status} — Is LM Studio running with "Local Server" enabled?`);
        const data = res.json;
        return (data.data ?? [])
            .map((m: any) => ({ id: m.id as string, label: m.id as string }))
            .sort((a: any, b: any) => a.id.localeCompare(b.id));
    }

    // custom — any OpenAI-compatible /v1/models endpoint
    const root = (baseUrl || 'http://localhost:1234').replace(/\/v1\/?$/, '').replace(/\/+$/, '');
    const headers: Record<string, string> = {};
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const res = await requestUrl({ url: `${root}/v1/models`, method: 'GET', headers, throw: false });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const data = res.json;
    return (data.data ?? [])
        .map((m: any) => ({ id: m.id as string, label: m.id as string }))
        .sort((a: any, b: any) => a.id.localeCompare(b.id));
}

/** Fetch model names installed in a local Ollama instance */
async function fetchOllamaModels(baseUrl: string): Promise<string[]> {
    // Native Ollama API is at root — strip /v1 suffix if present
    const root = (baseUrl || 'http://localhost:11434').replace(/\/v\d[^/]*\/?$/, '').replace(/\/+$/, '');
    const url = `${root}/api/tags`;
    const res = await requestUrl({ url, method: 'GET', throw: false });
    if (res.status !== 200) throw new Error(`HTTP ${res.status} — Is Ollama running?`);
    const data = res.json;
    return ((data.models ?? []) as any[]).map((m) => m.name as string).sort();
}

/**
 * Fetch embedding models from a provider's API.
 * Filters to only embedding-capable models (no chat/TTS/image models).
 */
async function fetchEmbeddingModels(
    provider: ProviderType,
    apiKey: string,
    baseUrl?: string,
    apiVersion?: string,
): Promise<{ id: string; label: string }[]> {
    const req = (url: string, headers: Record<string, string> = {}) =>
        requestUrl({ url, method: 'GET', headers, throw: false });

    if (provider === 'openai') {
        // OpenAI's /v1/models requires auth — return the known stable embedding model list instead
        return [
            { id: 'text-embedding-3-small', label: 'text-embedding-3-small  (1 536 dims, recommended)' },
            { id: 'text-embedding-3-large', label: 'text-embedding-3-large  (3 072 dims, highest quality)' },
            { id: 'text-embedding-ada-002', label: 'text-embedding-ada-002  (1 536 dims, legacy)' },
        ];
    }

    if (provider === 'azure') {
        // Azure doesn't have a REST endpoint to list available deployments generically.
        // Suggest the known embedding model IDs (user fills in deployment name).
        throw new Error('Azure does not provide a model list API — use the Quick Pick suggestions or enter the deployment name manually.');
    }

    if (provider === 'ollama') {
        // Ollama API: filter model names that look like embedding models
        const root = (baseUrl || 'http://localhost:11434').replace(/\/v\d[^/]*\/?$/, '').replace(/\/+$/, '');
        const res = await req(`${root}/api/tags`);
        if (res.status !== 200) throw new Error(`HTTP ${res.status} — Is Ollama running?`);
        const EMBED_NAMES = /embed|bge|minilm|arctic-embed|e5-|gte-/i;
        const all: string[] = ((res.json.models ?? []) as any[]).map((m: any) => m.name as string);
        const embeds = all.filter((n) => EMBED_NAMES.test(n));
        // If no matches, return all (user might have custom names)
        const list = embeds.length > 0 ? embeds : all;
        return list.sort().map((id) => ({ id, label: id }));
    }

    if (provider === 'lmstudio') {
        const root = (baseUrl || 'http://localhost:1234').replace(/\/v1\/?$/, '').replace(/\/+$/, '');
        const res = await req(`${root}/v1/models`);
        if (res.status !== 200) throw new Error(`HTTP ${res.status} — Is LM Studio running?`);
        return (res.json.data ?? [])
            .map((m: any) => ({ id: m.id as string, label: m.id as string }))
            .sort((a: any, b: any) => a.id.localeCompare(b.id));
    }

    if (provider === 'openrouter') {
        // OpenRouter proxies OpenAI embeddings — their /v1/models only lists chat models.
        // Return the known embedding models available via OpenRouter.
        return [
            { id: 'openai/text-embedding-3-small', label: 'text-embedding-3-small  (1 536 dims, recommended)' },
            { id: 'openai/text-embedding-3-large', label: 'text-embedding-3-large  (3 072 dims, highest quality)' },
            { id: 'openai/text-embedding-ada-002', label: 'text-embedding-ada-002  (1 536 dims, legacy)' },
        ];
    }

    // custom — OpenAI-compatible endpoint
    const base = (baseUrl || '').replace(/\/+$/, '');
    const headers: Record<string, string> = {};
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const res = await req(`${base}/v1/models`, headers);
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const EMBED_RE = /embed/i;
    const all = (res.json.data ?? []).map((m: any) => ({ id: m.id as string, label: m.id as string }));
    const filtered = all.filter((m: any) => EMBED_RE.test(m.id));
    return (filtered.length > 0 ? filtered : all).sort((a: any, b: any) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Add / Configure Model Modal
// ---------------------------------------------------------------------------

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
                            listEl.querySelectorAll('.mcm-model-item').forEach((el) => {
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
        });
        this.close();
    }
}

// ---------------------------------------------------------------------------
// Settings Tab
// ---------------------------------------------------------------------------

type TabId = 'models' | 'embeddings' | 'modes' | 'behaviour' | 'web' | 'checkpoints' | 'advanced';

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
            { id: 'models',      label: 'Models' },
            { id: 'embeddings',  label: 'Embeddings' },
            { id: 'modes',       label: 'Modes' },
            { id: 'behaviour',   label: 'Behaviour' },
            { id: 'web',         label: 'Web' },
            { id: 'checkpoints', label: 'Checkpoints' },
            { id: 'advanced',    label: 'Advanced' },
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
        if (this.activeTab === 'models')      this.buildModelsTab(content);
        if (this.activeTab === 'embeddings')  this.buildEmbeddingsTab(content);
        if (this.activeTab === 'modes')       this.buildModesTab(content);
        if (this.activeTab === 'behaviour')   this.buildBehaviourTab(content);
        if (this.activeTab === 'web')         this.buildWebTab(content);
        if (this.activeTab === 'checkpoints') this.buildCheckpointsTab(content);
        if (this.activeTab === 'advanced')    this.buildAdvancedTab(content);
    }

    // ---------------------------------------------------------------------------
    // Modes tab
    // ---------------------------------------------------------------------------

    private buildModesTab(container: HTMLElement): void {
        container.createEl('p', {
            cls: 'agent-settings-desc',
            text: 'Choose and configure agent modes. Built-in modes ship with the plugin; you can add custom instructions to each. Custom modes can be created and exported.',
        });

        // Built-in modes
        const builtinSection = container.createDiv('agent-settings-section');
        builtinSection.createEl('h3', { text: 'Built-in Modes' });

        for (const mode of BUILT_IN_MODES) {
            const modeCard = builtinSection.createDiv('mode-card');
            const modeHeader = modeCard.createDiv('mode-card-header');

            // Icon + name + description
            const modeInfo = modeHeader.createDiv('mode-card-info');
            const modeTitle = modeInfo.createDiv('mode-card-title');
            setIcon(modeTitle.createSpan('mode-card-icon'), mode.icon);
            modeTitle.createSpan('mode-card-name').setText(mode.name);

            // Active badge
            if (this.plugin.settings.currentMode === mode.slug) {
                modeTitle.createSpan('mode-card-badge').setText('active');
            }

            modeInfo.createDiv('mode-card-description').setText(mode.description);

            // Tool groups
            const groupsEl = modeCard.createDiv('mode-card-groups');
            for (const group of mode.toolGroups) {
                groupsEl.createSpan({ cls: 'mode-group-chip', text: group });
            }

            // "Set Active" button
            const actions = modeCard.createDiv('mode-card-actions');
            if (this.plugin.settings.currentMode !== mode.slug) {
                const setActiveBtn = actions.createEl('button', { text: 'Set Active', cls: 'mod-cta mode-set-active-btn' });
                setActiveBtn.addEventListener('click', async () => {
                    this.plugin.settings.currentMode = mode.slug;
                    await this.plugin.saveSettings();
                    this.display();
                });
            }

            // Custom instructions expander
            const customHeader = modeCard.createDiv('mode-custom-header');
            const customToggle = customHeader.createEl('button', {
                cls: 'mode-custom-toggle',
                text: 'Custom instructions',
            });
            setIcon(customHeader.createSpan('mode-custom-chevron'), 'chevron-down');
            const customBody = modeCard.createDiv('mode-custom-body');
            customBody.style.display = 'none';

            customToggle.addEventListener('click', () => {
                const isOpen = customBody.style.display !== 'none';
                customBody.style.display = isOpen ? 'none' : '';
            });

            // Find or create a custom-mode entry for this slug to store custom instructions
            const existingCustom = this.plugin.settings.customModes.find(
                (m) => m.slug === `${mode.slug}__custom`
            );
            const textarea = customBody.createEl('textarea', {
                cls: 'mode-custom-textarea',
                attr: { placeholder: 'Add extra instructions for this mode...' },
            });
            textarea.value = existingCustom?.customInstructions ?? '';
            textarea.rows = 4;
            textarea.addEventListener('input', async () => {
                const value = textarea.value.trim();
                const idx = this.plugin.settings.customModes.findIndex(
                    (m) => m.slug === `${mode.slug}__custom`
                );
                if (value) {
                    const customEntry: ModeConfig = {
                        slug: `${mode.slug}__custom`,
                        name: mode.name,
                        icon: mode.icon,
                        description: mode.description,
                        roleDefinition: mode.roleDefinition,
                        toolGroups: mode.toolGroups,
                        source: 'built-in',
                        customInstructions: value,
                    };
                    if (idx >= 0) {
                        this.plugin.settings.customModes[idx] = customEntry;
                    } else {
                        this.plugin.settings.customModes.push(customEntry);
                    }
                } else {
                    if (idx >= 0) this.plugin.settings.customModes.splice(idx, 1);
                }
                await this.plugin.saveSettings();
            });
        }

        // Custom modes section
        const customSection = container.createDiv('agent-settings-section');
        customSection.createEl('h3', { text: 'Custom Modes' });

        const customModes = this.plugin.settings.customModes.filter((m) => m.source === 'custom');

        if (customModes.length === 0) {
            customSection.createEl('p', {
                cls: 'agent-settings-desc',
                text: 'No custom modes yet. Click "New Mode" to create one.',
            });
        } else {
            for (const mode of customModes) {
                const card = customSection.createDiv('mode-card');
                const header = card.createDiv('mode-card-header');
                const info = header.createDiv('mode-card-info');
                const title = info.createDiv('mode-card-title');
                setIcon(title.createSpan('mode-card-icon'), mode.icon || 'sparkles');
                title.createSpan('mode-card-name').setText(mode.name);
                if (this.plugin.settings.currentMode === mode.slug) {
                    title.createSpan('mode-card-badge').setText('active');
                }
                info.createDiv('mode-card-description').setText(mode.description);

                const groupsEl = card.createDiv('mode-card-groups');
                for (const group of mode.toolGroups) {
                    groupsEl.createSpan({ cls: 'mode-group-chip', text: group });
                }

                const actions = card.createDiv('mode-card-actions');
                if (this.plugin.settings.currentMode !== mode.slug) {
                    const setActiveBtn = actions.createEl('button', { text: 'Set Active', cls: 'mod-cta mode-set-active-btn' });
                    setActiveBtn.addEventListener('click', async () => {
                        this.plugin.settings.currentMode = mode.slug;
                        await this.plugin.saveSettings();
                        this.display();
                    });
                }
                const deleteBtn = actions.createEl('button', { text: 'Delete', cls: 'mod-warning' });
                deleteBtn.addEventListener('click', async () => {
                    this.plugin.settings.customModes = this.plugin.settings.customModes.filter(
                        (m) => m.slug !== mode.slug
                    );
                    if (this.plugin.settings.currentMode === mode.slug) {
                        this.plugin.settings.currentMode = 'librarian';
                    }
                    await this.plugin.saveSettings();
                    this.display();
                });
            }
        }

        // New Mode button
        const addBtn = customSection.createEl('button', { text: '+ New Mode', cls: 'mod-cta' });
        addBtn.addEventListener('click', () => {
            new NewModeModal(this.app, this.plugin, () => this.display()).open();
        });
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
        const hasKey = !!model.apiKey || model.provider === 'ollama' || model.provider === 'lmstudio';
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
    // Embeddings tab
    // ---------------------------------------------------------------------------

    private buildEmbeddingsTab(container: HTMLElement): void {
        const desc = container.createDiv('model-table-desc');
        desc.createSpan({ text: 'Embedding models are used for semantic search. Select one model as active — it will be used to index your vault.' });

        // Table header
        const table = container.createDiv('model-table');
        const header = table.createDiv('model-row model-row-header');
        header.createDiv({ cls: 'mc-name', text: 'Model' });
        header.createDiv({ cls: 'mc-provider', text: 'Provider' });
        header.createDiv({ cls: 'mc-key', text: 'Key' });
        header.createDiv({ cls: 'mc-enable', text: 'Active' });
        header.createDiv({ cls: 'mc-actions' });

        const models = this.plugin.settings.embeddingModels ?? [];
        if (models.length === 0) {
            table.createDiv({ cls: 'model-table-empty', text: 'No embedding models added yet. Click "+ Add Embedding Model" to get started.' });
        } else {
            models.forEach((model) => this.renderEmbeddingRow(table, model));
        }

        const footer = container.createDiv('model-table-footer');
        const addBtn = footer.createEl('button', { cls: 'mod-cta model-add-btn', text: '+ Add Embedding Model' });
        addBtn.addEventListener('click', () => {
            new ModelConfigModal(this.app, null, async (newModel) => {
                const key = getModelKey(newModel);
                if ((this.plugin.settings.embeddingModels ?? []).some((m) => getModelKey(m) === key)) {
                    new Notice(`"${newModel.name}" already exists`);
                    return;
                }
                if (!this.plugin.settings.embeddingModels) this.plugin.settings.embeddingModels = [];
                this.plugin.settings.embeddingModels.push(newModel);
                if (!this.plugin.settings.activeEmbeddingModelKey) {
                    this.plugin.settings.activeEmbeddingModelKey = key;
                }
                await this.plugin.saveSettings();
                this.display();
            }, true /* forEmbedding */).open();
        });
    }

    private renderEmbeddingRow(table: HTMLElement, model: CustomModel): void {
        const key = getModelKey(model);
        const hasKey = !!model.apiKey || model.provider === 'ollama' || model.provider === 'lmstudio';
        const isActive = this.plugin.settings.activeEmbeddingModelKey === key;

        const row = table.createDiv(`model-row${isActive ? ' model-row-active' : ''}`);

        row.createDiv('mc-name').createSpan({ text: model.displayName ?? model.name, cls: 'mc-name-text' });

        const provEl = row.createDiv('mc-provider');
        const badge = provEl.createSpan({ cls: 'provider-badge', text: PROVIDER_LABELS[model.provider] ?? model.provider });
        badge.style.background = PROVIDER_COLORS[model.provider] ?? '#607d8b';

        const keyEl = row.createDiv('mc-key');
        const keyIcon = keyEl.createSpan('mc-key-icon');
        setIcon(keyIcon, hasKey ? 'check' : 'minus');
        keyEl.addClass(hasKey ? 'mc-key-ok' : 'mc-key-missing');

        // Active radio-style toggle
        const enableEl = row.createDiv('mc-enable');
        const toggle = enableEl.createEl('input', { attr: { type: 'radio', name: 'active-embedding' } });
        toggle.checked = isActive;
        toggle.addEventListener('change', async () => {
            if (toggle.checked) {
                this.plugin.settings.activeEmbeddingModelKey = key;
                await this.plugin.saveSettings();
                this.display();
            }
        });

        const actionsEl = row.createDiv('mc-actions');
        const configBtn = actionsEl.createEl('button', { cls: 'mc-action-btn', attr: { title: 'Configure' } });
        setIcon(configBtn, 'settings');
        configBtn.addEventListener('click', () => {
            new ModelConfigModal(this.app, { ...model }, async (updated) => {
                const idx = (this.plugin.settings.embeddingModels ?? []).findIndex((m) => getModelKey(m) === key);
                if (idx !== -1) this.plugin.settings.embeddingModels[idx] = updated;
                if (this.plugin.settings.activeEmbeddingModelKey === key) {
                    this.plugin.settings.activeEmbeddingModelKey = getModelKey(updated);
                }
                await this.plugin.saveSettings();
                this.display();
            }, true /* forEmbedding */).open();
        });

        const delBtn = actionsEl.createEl('button', { cls: 'mc-action-btn mc-action-del', attr: { title: 'Remove' } });
        setIcon(delBtn, 'trash');
        delBtn.addEventListener('click', async () => {
            this.plugin.settings.embeddingModels = (this.plugin.settings.embeddingModels ?? []).filter(
                (m) => getModelKey(m) !== key,
            );
            if (this.plugin.settings.activeEmbeddingModelKey === key) {
                this.plugin.settings.activeEmbeddingModelKey = this.plugin.settings.embeddingModels[0]
                    ? getModelKey(this.plugin.settings.embeddingModels[0])
                    : '';
            }
            await this.plugin.saveSettings();
            this.display();
        });
    }

    // ---------------------------------------------------------------------------
    // Behaviour tab — Auto-Approve
    // ---------------------------------------------------------------------------

    private buildBehaviourTab(container: HTMLElement): void {
        container.createEl('p', {
            cls: 'agent-settings-desc',
            text: 'Control which tool categories the agent can run without asking for your approval first.',
        });

        new Setting(container)
            .setName('Enable auto-approve')
            .setDesc('Master switch. When on, approved categories run without a confirmation prompt.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.enabled).onChange(async (v) => {
                    this.plugin.settings.autoApproval.enabled = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(container)
            .setName('Show quick-toggle bar in chat')
            .setDesc('Display the Auto-Approve toggle bar above the chat input for quick access.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.showMenuInChat).onChange(async (v) => {
                    this.plugin.settings.autoApproval.showMenuInChat = v;
                    await this.plugin.saveSettings();
                }),
            );

        container.createEl('h3', { cls: 'agent-settings-section', text: 'Per-category toggles' });

        new Setting(container)
            .setName('Read operations')
            .setDesc('read_file, list_files, search_files — always safe to auto-approve.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.read).onChange(async (v) => {
                    this.plugin.settings.autoApproval.read = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(container)
            .setName('Write operations')
            .setDesc('write_file, edit_file, append_to_file, create_folder, delete_file, move_file.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.write).onChange(async (v) => {
                    this.plugin.settings.autoApproval.write = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(container)
            .setName('Web operations')
            .setDesc('web_fetch, web_search — fetches external content.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.web).onChange(async (v) => {
                    this.plugin.settings.autoApproval.web = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(container)
            .setName('MCP tool calls')
            .setDesc('use_mcp_tool — calls to external tool servers.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.mcp).onChange(async (v) => {
                    this.plugin.settings.autoApproval.mcp = v;
                    await this.plugin.saveSettings();
                }),
            );
    }

    // ---------------------------------------------------------------------------
    // Web tab
    // ---------------------------------------------------------------------------

    private buildWebTab(container: HTMLElement): void {
        container.createEl('p', {
            cls: 'agent-settings-desc',
            text: 'Configure web_fetch (read any URL) and web_search (Brave / Tavily). web_fetch works without an API key; web_search requires one.',
        });

        new Setting(container)
            .setName('Enable web tools')
            .setDesc('When off, the agent cannot access the internet at all.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.webTools?.enabled ?? false).onChange(async (v) => {
                    if (!this.plugin.settings.webTools) this.plugin.settings.webTools = { enabled: false, provider: 'none', braveApiKey: '', tavilyApiKey: '' };
                    this.plugin.settings.webTools.enabled = v;
                    await this.plugin.saveSettings();
                    this.display();
                }),
            );

        container.createEl('h3', { cls: 'agent-settings-section', text: 'Search provider' });

        new Setting(container)
            .setName('Provider')
            .setDesc('Used for web_search. Select "None" if you only need web_fetch.')
            .addDropdown((d) =>
                d
                    .addOption('none', 'None (web_fetch only)')
                    .addOption('brave', 'Brave Search')
                    .addOption('tavily', 'Tavily')
                    .setValue(this.plugin.settings.webTools?.provider ?? 'none')
                    .onChange(async (v) => {
                        if (!this.plugin.settings.webTools) this.plugin.settings.webTools = { enabled: true, provider: 'none', braveApiKey: '', tavilyApiKey: '' };
                        this.plugin.settings.webTools.provider = v as 'brave' | 'tavily' | 'none';
                        await this.plugin.saveSettings();
                        this.display();
                    }),
            );

        const provider = this.plugin.settings.webTools?.provider ?? 'none';

        if (provider === 'brave' || provider === 'none') {
            const braveKey = new Setting(container)
                .setName('Brave Search API key')
                .setDesc('Get a free key at brave.com/search/api — 2 000 queries/month on the free tier.')
                .addText((t) => {
                    t.inputEl.type = 'password';
                    t
                        .setPlaceholder('BSA...')
                        .setValue(this.plugin.settings.webTools?.braveApiKey ?? '')
                        .onChange(async (v) => {
                            if (!this.plugin.settings.webTools) this.plugin.settings.webTools = { enabled: true, provider: 'brave', braveApiKey: '', tavilyApiKey: '' };
                            this.plugin.settings.webTools.braveApiKey = v.trim();
                            await this.plugin.saveSettings();
                        });
                });
            if (provider === 'none') braveKey.setDisabled(true);
        }

        if (provider === 'tavily' || provider === 'none') {
            const tavilyKey = new Setting(container)
                .setName('Tavily API key')
                .setDesc('Get a key at tavily.com — 1 000 free searches/month.')
                .addText((t) => {
                    t.inputEl.type = 'password';
                    t
                        .setPlaceholder('tvly-...')
                        .setValue(this.plugin.settings.webTools?.tavilyApiKey ?? '')
                        .onChange(async (v) => {
                            if (!this.plugin.settings.webTools) this.plugin.settings.webTools = { enabled: true, provider: 'tavily', braveApiKey: '', tavilyApiKey: '' };
                            this.plugin.settings.webTools.tavilyApiKey = v.trim();
                            await this.plugin.saveSettings();
                        });
                });
            if (provider === 'none') tavilyKey.setDisabled(true);
        }
    }

    // ---------------------------------------------------------------------------
    // Checkpoints tab
    // ---------------------------------------------------------------------------

    private buildCheckpointsTab(container: HTMLElement): void {
        container.createEl('p', {
            cls: 'agent-settings-desc',
            text: 'Checkpoints snapshot each file before the agent first modifies it. After a task you can undo all changes with one click.',
        });

        new Setting(container)
            .setName('Enable checkpoints')
            .setDesc('Snapshot files before the agent modifies them. Enables the Undo button after each task.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.enableCheckpoints ?? true).onChange(async (v) => {
                    this.plugin.settings.enableCheckpoints = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(container)
            .setName('Snapshot timeout (seconds)')
            .setDesc('Maximum time to wait for a single snapshot operation before giving up. Default: 30.')
            .addText((t) =>
                t
                    .setValue(String(this.plugin.settings.checkpointTimeoutSeconds ?? 30))
                    .onChange(async (v) => {
                        const n = parseInt(v);
                        if (!isNaN(n) && n > 0) {
                            this.plugin.settings.checkpointTimeoutSeconds = n;
                            await this.plugin.saveSettings();
                        }
                    }),
            );

        new Setting(container)
            .setName('Auto-cleanup after task')
            .setDesc('Remove snapshot data once the task completes. Keeps the shadow repo small. Disable if you want to inspect snapshots manually.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.checkpointAutoCleanup ?? true).onChange(async (v) => {
                    this.plugin.settings.checkpointAutoCleanup = v;
                    await this.plugin.saveSettings();
                }),
            );
    }

    // ---------------------------------------------------------------------------
    // Advanced tab — API tuning + UI preferences
    // ---------------------------------------------------------------------------

    private buildAdvancedTab(container: HTMLElement): void {
        // ── API Tuning ────────────────────────────────────────────────────────
        container.createEl('h3', { cls: 'agent-settings-section', text: 'API Tuning' });

        new Setting(container)
            .setName('Use custom temperature')
            .setDesc('Override the model\'s default temperature. Leave off to use the provider default.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.advancedApi.useCustomTemperature).onChange(async (v) => {
                    this.plugin.settings.advancedApi.useCustomTemperature = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(container)
            .setName('Temperature')
            .setDesc('0.0 = deterministic · 1.0 = default · 2.0 = very creative. Only applied when "Use custom temperature" is on.')
            .addSlider((s) =>
                s
                    .setLimits(0, 2, 0.05)
                    .setValue(this.plugin.settings.advancedApi.temperature)
                    .setDynamicTooltip()
                    .onChange(async (v) => {
                        this.plugin.settings.advancedApi.temperature = v;
                        await this.plugin.saveSettings();
                    }),
            );

        new Setting(container)
            .setName('Consecutive error limit')
            .setDesc('Stop the agent after N consecutive tool errors and show a warning. Set to 0 to disable.')
            .addText((t) =>
                t
                    .setValue(String(this.plugin.settings.advancedApi.consecutiveMistakeLimit))
                    .onChange(async (v) => {
                        const n = parseInt(v);
                        if (!isNaN(n) && n >= 0) {
                            this.plugin.settings.advancedApi.consecutiveMistakeLimit = n;
                            await this.plugin.saveSettings();
                        }
                    }),
            );

        new Setting(container)
            .setName('Rate limit between requests (ms)')
            .setDesc('Minimum pause between API calls. Useful for providers with strict rate limits. Set to 0 to disable.')
            .addText((t) =>
                t
                    .setValue(String(this.plugin.settings.advancedApi.rateLimitMs))
                    .onChange(async (v) => {
                        const n = parseInt(v);
                        if (!isNaN(n) && n >= 0) {
                            this.plugin.settings.advancedApi.rateLimitMs = n;
                            await this.plugin.saveSettings();
                        }
                    }),
            );

        // ── UI ────────────────────────────────────────────────────────────────
        container.createEl('h3', { cls: 'agent-settings-section', text: 'Interface' });

        new Setting(container)
            .setName('Auto-add active note as context')
            .setDesc('Automatically include the currently open note as context when sending a message.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoAddActiveFileContext).onChange(async (v) => {
                    this.plugin.settings.autoAddActiveFileContext = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(container)
            .setName('Show welcome message')
            .setDesc('Show the welcome message when the sidebar opens for the first time.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.showWelcomeMessage).onChange(async (v) => {
                    this.plugin.settings.showWelcomeMessage = v;
                    await this.plugin.saveSettings();
                }),
            );

        // ── Debug ─────────────────────────────────────────────────────────────
        container.createEl('h3', { cls: 'agent-settings-section', text: 'Debug' });

        new Setting(container)
            .setName('Debug mode')
            .setDesc('Log detailed tool execution information to the developer console (Cmd+Option+I).')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.debugMode).onChange(async (v) => {
                    this.plugin.settings.debugMode = v;
                    await this.plugin.saveSettings();
                }),
            );
    }
}

// ---------------------------------------------------------------------------
// New Mode Modal
// ---------------------------------------------------------------------------

class NewModeModal extends Modal {
    private plugin: ObsidianAgentPlugin;
    private onSave: () => void;

    constructor(app: App, plugin: ObsidianAgentPlugin, onSave: () => void) {
        super(app);
        this.plugin = plugin;
        this.onSave = onSave;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.addClass('new-mode-modal');
        contentEl.createEl('h2', { text: 'New Mode' });

        let slug = '';
        let name = '';
        let icon = 'sparkles';
        let description = '';
        let roleDefinition = '';
        let selectedGroups: Set<string> = new Set(['read', 'vault', 'agent']);

        new Setting(contentEl)
            .setName('Name')
            .setDesc('Display name (e.g. "Daily Planner")')
            .addText((t) => t.onChange((v) => {
                name = v;
                slug = v.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
            }));

        new Setting(contentEl)
            .setName('Icon')
            .setDesc('Lucide icon name (e.g. "calendar", "sparkles", "brain")')
            .addText((t) => {
                t.setValue(icon).onChange((v) => { icon = v; });
            });

        new Setting(contentEl)
            .setName('Description')
            .setDesc('Short description shown in the mode selector')
            .addText((t) => t.onChange((v) => { description = v; }));

        // Tool groups checkboxes
        const groupSetting = contentEl.createDiv('new-mode-groups');
        groupSetting.createEl('label', { cls: 'new-mode-groups-label', text: 'Tool Groups' });
        const groupGrid = groupSetting.createDiv('new-mode-groups-grid');

        for (const group of Object.keys(TOOL_GROUP_MAP)) {
            const row = groupGrid.createDiv('new-mode-group-row');
            const cb = row.createEl('input', { type: 'checkbox' });
            cb.checked = selectedGroups.has(group);
            cb.addEventListener('change', () => {
                if (cb.checked) selectedGroups.add(group);
                else selectedGroups.delete(group);
            });
            row.createEl('label', { text: group });
        }

        contentEl.createEl('label', { cls: 'new-mode-field-label', text: 'Role Definition' });
        const roleTextarea = contentEl.createEl('textarea', {
            cls: 'new-mode-textarea',
            attr: { placeholder: 'Describe the agent\'s identity, behavior, and focus area...' },
        });
        roleTextarea.rows = 6;
        roleTextarea.addEventListener('input', () => { roleDefinition = roleTextarea.value; });

        const actions = contentEl.createDiv('new-mode-actions');
        const saveBtn = actions.createEl('button', { text: 'Create Mode', cls: 'mod-cta' });
        saveBtn.addEventListener('click', async () => {
            if (!name.trim()) {
                new Notice('Name is required');
                return;
            }
            if (!roleDefinition.trim()) {
                new Notice('Role definition is required');
                return;
            }
            // Ensure slug uniqueness
            const allSlugs = [
                ...BUILT_IN_MODES.map((m) => m.slug),
                ...this.plugin.settings.customModes.map((m) => m.slug),
            ];
            let finalSlug = slug || name.toLowerCase().replace(/\s+/g, '-');
            if (allSlugs.includes(finalSlug)) {
                finalSlug = `${finalSlug}-${Date.now()}`;
            }

            const newMode: ModeConfig = {
                slug: finalSlug,
                name: name.trim(),
                icon: icon.trim() || 'sparkles',
                description: description.trim(),
                roleDefinition: roleDefinition.trim(),
                toolGroups: Array.from(selectedGroups) as any,
                source: 'custom',
            };

            this.plugin.settings.customModes.push(newMode);
            await this.plugin.saveSettings();
            this.onSave();
            this.close();
        });

        const cancelBtn = actions.createEl('button', { text: 'Cancel' });
        cancelBtn.addEventListener('click', () => this.close());
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
