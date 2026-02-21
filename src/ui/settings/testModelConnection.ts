import { requestUrl } from 'obsidian';
import type { CustomModel, ProviderType } from '../../types/settings';
import { buildApiHandler } from '../../api/index';
import { modelToLLMProvider } from '../../types/settings';


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
    apiVersion?: string,
): Promise<{ id: string; label: string }[]> {
    // Helper: Obsidian's requestUrl throws on 4xx/5xx — use throw:false to always get response
    const req = (url: string, headers: Record<string, string> = {}) =>
        requestUrl({ url, method: 'GET', headers, throw: false });

    if (provider === 'azure') {
        if (!baseUrl) throw new Error('Base URL required for Azure');
        if (!apiKey) throw new Error('API key required for Azure');
        // Parser normalizes Azure URLs to end with /openai — strip it to get the endpoint root
        const endpoint = baseUrl.replace(/\/+$/, '').replace(/\/openai$/i, '');
        const ver = apiVersion ?? '2024-10-21';
        const headers = { 'api-key': apiKey };

        // Try /openai/deployments first — returns actual deployment names the user can call
        const deplRes = await req(`${endpoint}/openai/deployments?api-version=${ver}`, headers);
        if (deplRes.status === 200) {
            const deplData = deplRes.json;
            const deployments: any[] = deplData.data ?? deplData.value ?? [];
            if (deployments.length > 0) {
                return deployments
                    .map((d: any) => {
                        const id: string = d.id ?? d.model ?? '';
                        const model: string = d.model ?? d.id ?? '';
                        const label = id !== model ? `${id} (${model})` : id;
                        return { id, label };
                    })
                    .filter((m) => m.id)
                    .sort((a, b) => a.id.localeCompare(b.id));
            }
        }

        // Fallback: /openai/models — lists base models available in the region
        const modRes = await req(`${endpoint}/openai/models?api-version=${ver}`, headers);
        if (modRes.status === 401) throw new Error('Invalid API key (401 Unauthorized)');
        if (modRes.status !== 200) throw new Error(`HTTP ${modRes.status} — Could not list models or deployments`);
        const modData = modRes.json;
        const models: any[] = modData.data ?? modData.value ?? [];
        return models
            .map((m: any) => ({ id: (m.id ?? m.model) as string, label: (m.id ?? m.model) as string }))
            .filter((m) => m.id)
            .sort((a, b) => a.id.localeCompare(b.id));
    }

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

/** Returns true for o-series models that enforce temperature=1.0 API-side */
function isTemperatureFixed(provider: ProviderType, modelName: string): boolean {
    if (provider === 'openai' || provider === 'azure') {
        return /^o[1-9]/.test(modelName);
    }
    return false;
}

/** Maximum temperature value accepted by provider */
function maxTemperature(provider: ProviderType): number {
    return provider === 'anthropic' ? 1.0 : 2.0;
}


export { testModelConnection, testEmbeddingConnection, fetchProviderModels, fetchOllamaModels, fetchEmbeddingModels, isTemperatureFixed, maxTemperature };
