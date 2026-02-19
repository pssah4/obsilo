import { App, Modal, Notice, PluginSettingTab, Setting, requestUrl, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../main';
import type { CustomModel, CustomPrompt, ModeConfig, ProviderType } from '../types/settings';
import { getModelKey, modelToLLMProvider } from '../types/settings';
import { buildApiHandler } from '../api/index';
import { BUILT_IN_MODES, TOOL_GROUP_MAP } from '../core/modes/builtinModes';
import { buildSystemPromptForMode } from '../core/systemPrompt';
import { GlobalModeStore } from '../core/modes/GlobalModeStore';
import { DEFAULT_SETTINGS } from '../types/settings';

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

// Human-readable labels and descriptions for individual tools
const TOOL_LABEL_MAP: Record<string, { label: string; desc: string }> = {
    read_file:              { label: 'Read File',           desc: 'Read the contents of a vault file' },
    list_files:             { label: 'List Files',          desc: 'List files and folders in a directory' },
    search_files:           { label: 'Search Files',        desc: 'Search file contents by keyword or regex' },
    get_vault_stats:        { label: 'Vault Stats',         desc: 'Get overview stats (file count, tags, etc.)' },
    get_frontmatter:        { label: 'Frontmatter',         desc: 'Read YAML frontmatter from a note' },
    search_by_tag:          { label: 'Search by Tag',       desc: 'Find notes with specific tags' },
    get_linked_notes:       { label: 'Linked Notes',        desc: 'Find notes that link to or from a note' },
    get_daily_note:         { label: 'Daily Note',          desc: 'Get or create today\'s daily note' },
    open_note:              { label: 'Open Note',           desc: 'Open a note in the editor' },
    semantic_search:        { label: 'Semantic Search',     desc: 'Find notes by meaning using the vector index' },
    query_base:             { label: 'Query Base',          desc: 'Query an Obsidian Bases database' },
    write_file:             { label: 'Write File',          desc: 'Create a new file or overwrite completely' },
    edit_file:              { label: 'Edit File',           desc: 'Make targeted edits to a file' },
    append_to_file:         { label: 'Append to File',      desc: 'Add content at the end of a file' },
    create_folder:          { label: 'Create Folder',       desc: 'Create a new folder in the vault' },
    delete_file:            { label: 'Delete File',         desc: 'Permanently delete a file or folder' },
    move_file:              { label: 'Move / Rename',       desc: 'Move or rename a file' },
    update_frontmatter:     { label: 'Update Frontmatter',  desc: 'Set or update YAML frontmatter fields' },
    generate_canvas:        { label: 'Generate Canvas',     desc: 'Create an Obsidian Canvas file' },
    create_base:            { label: 'Create Base',         desc: 'Create an Obsidian Bases database' },
    update_base:            { label: 'Update Base',         desc: 'Modify an Obsidian Bases database' },
    web_fetch:              { label: 'Fetch URL',           desc: 'Download and read a web page' },
    web_search:             { label: 'Web Search',          desc: 'Search the web for current information' },
    ask_followup_question:  { label: 'Ask User',            desc: 'Ask the user a clarifying question' },
    attempt_completion:     { label: 'Complete Task',       desc: 'Signal that the task is done' },
    update_todo_list:       { label: 'Update Todos',        desc: 'Show a task checklist in the chat' },
    new_task:               { label: 'Spawn Sub-agent',     desc: 'Delegate a subtask to a fresh agent' },
    use_mcp_tool:           { label: 'MCP Tool',            desc: 'Call an external tool via an MCP server' },
};

// Human-readable tool group labels and individual tool lists (for per-tool selection UI)
const TOOL_GROUP_META: Record<string, { label: string; desc: string; tools: string[] }> = {
    read:  {
        label: 'Read Files',
        desc: 'Read and search vault files',
        tools: ['read_file', 'list_files', 'search_files'],
    },
    vault: {
        label: 'Vault Intelligence',
        desc: 'Frontmatter, tags, backlinks, daily notes, semantic search, canvas, bases',
        tools: [
            'get_vault_stats', 'get_frontmatter', 'search_by_tag', 'get_linked_notes',
            'get_daily_note', 'open_note', 'semantic_search', 'query_base',
        ],
    },
    edit:  {
        label: 'Edit Files',
        desc: 'Create, edit, move, and structure vault files and canvases',
        tools: [
            'write_file', 'edit_file', 'append_to_file', 'create_folder',
            'delete_file', 'move_file', 'update_frontmatter',
            'generate_canvas', 'create_base', 'update_base',
        ],
    },
    web:   {
        label: 'Web Access',
        desc: 'Fetch web pages and search the internet',
        tools: ['web_fetch', 'web_search'],
    },
    agent: {
        label: 'Agent Control',
        desc: 'Task planning, completion, clarification, and sub-agent spawning',
        tools: ['ask_followup_question', 'attempt_completion', 'update_todo_list', 'new_task'],
    },
    mcp:   {
        label: 'MCP Tools',
        desc: 'Call external tools via configured MCP servers',
        tools: ['use_mcp_tool'],
    },
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
            this.temperatureRow.querySelectorAll('input[type=checkbox]').forEach((el) => {
                (el as HTMLInputElement).checked = false;
                (el as HTMLInputElement).disabled = true;
            });
        } else {
            if (this.temperatureNoteEl) this.temperatureNoteEl.style.display = 'none';
            this.temperatureRow.querySelectorAll('input[type=checkbox]').forEach((el) => {
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
            temperature: this.formTemperatureEnabled ? this.formTemperatureValue : undefined,
        });
        this.close();
    }
}

// ---------------------------------------------------------------------------
// Settings Tab
// ---------------------------------------------------------------------------

type TabId = 'providers' | 'agent-behaviour' | 'vault' | 'advanced';

export class AgentSettingsTab extends PluginSettingTab {
    plugin: ObsidianAgentPlugin;
    private activeTab: TabId = 'providers';
    private activeProvidersSubTab: string = 'models';
    private activeAgentSubTab: string = 'modes';
    private activeAdvancedSubTab: string = 'interface';


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
        const tabs: { id: TabId; label: string; icon: string }[] = [
            { id: 'providers',       label: 'Providers',       icon: 'plug'         },
            { id: 'agent-behaviour', label: 'Agent Behaviour', icon: 'users-round'  },
            { id: 'vault',           label: 'Vault',           icon: 'hard-drive'   },
            { id: 'advanced',        label: 'Advanced',        icon: 'settings-2'   },
        ];
        tabs.forEach(({ id, label, icon }) => {
            const btn = nav.createEl('button', {
                cls: `agent-settings-tab${this.activeTab === id ? ' active' : ''}`,
            });
            const iconEl = btn.createSpan({ cls: 'agent-settings-tab-icon' });
            setIcon(iconEl, icon);
            btn.createSpan({ cls: 'agent-settings-tab-label', text: label });
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
        if (this.activeTab === 'providers')       this.buildProvidersTab(content);
        if (this.activeTab === 'agent-behaviour') this.buildAgentBehaviourTab(content);
        if (this.activeTab === 'vault')           this.buildVaultTab(content);
        if (this.activeTab === 'advanced')        this.buildAdvancedTab(content);
    }

    // ---------------------------------------------------------------------------
    // UI helpers
    // ---------------------------------------------------------------------------

    /**
     * Append a small info icon button to a setting's name cell.
     * Clicking it opens a Modal with a title and explanatory body text.
     */
    private addInfoButton(setting: Setting, title: string, body: string): void {
        setting.nameEl.createEl('button', {
            cls: 'setting-info-btn',
            attr: { 'aria-label': 'More information', title },
        }, (btn) => {
            setIcon(btn, 'info');
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const modal = new Modal(this.app);
                modal.titleEl.setText(title);
                modal.contentEl.createEl('p', { text: body, cls: 'setting-info-body' });
                modal.open();
            });
        });
    }

    // ---------------------------------------------------------------------------
    // Sub-tab infrastructure
    // ---------------------------------------------------------------------------

    private buildSubTabNav(
        container: HTMLElement,
        tabs: { id: string; label: string; icon?: string }[],
        activeId: string,
        onSelect: (id: string) => void,
    ): void {
        const nav = container.createDiv({ cls: 'agent-settings-subnav' });
        for (const tab of tabs) {
            const btn = nav.createEl('button', {
                cls: `agent-settings-subtab${tab.id === activeId ? ' active' : ''}`,
            });
            if (tab.icon) {
                const iconEl = btn.createSpan({ cls: 'subtab-icon' });
                setIcon(iconEl, tab.icon);
            }
            btn.createSpan({ text: tab.label });
            btn.addEventListener('click', () => onSelect(tab.id));
        }
    }

    private renderComingSoon(
        container: HTMLElement,
        icon: string,
        title: string,
        description: string,
    ): void {
        const wrap = container.createDiv({ cls: 'agent-settings-coming-soon' });
        const iconEl = wrap.createDiv({ cls: 'agent-settings-coming-soon-icon' });
        setIcon(iconEl, icon);
        wrap.createDiv({ cls: 'agent-settings-coming-soon-title', text: title });
        wrap.createDiv({ cls: 'agent-settings-coming-soon-desc', text: description });
    }

    // ---------------------------------------------------------------------------
    // Providers tab (Models + Embeddings)
    // ---------------------------------------------------------------------------

    private buildProvidersTab(container: HTMLElement): void {
        this.buildSubTabNav(
            container,
            [
                { id: 'models',      label: 'Models',     icon: 'cpu'      },
                { id: 'embeddings',  label: 'Embeddings', icon: 'database' },
                { id: 'web-search',  label: 'Web Search', icon: 'globe'    },
            ],
            this.activeProvidersSubTab,
            (id) => { this.activeProvidersSubTab = id; this.display(); },
        );
        const content = container.createDiv({ cls: 'agent-settings-subcontent' });
        if (this.activeProvidersSubTab === 'models')     this.buildModelsTab(content);
        if (this.activeProvidersSubTab === 'embeddings') this.buildEmbeddingsTab(content);
        if (this.activeProvidersSubTab === 'web-search') this.buildWebSearchTab(content);
    }

    // ---------------------------------------------------------------------------
    // Agent Behaviour tab (Modes + MCP + Rules + Workflows + Skills)
    // ---------------------------------------------------------------------------

    private buildAgentBehaviourTab(container: HTMLElement): void {
        const subTabs = [
            { id: 'modes',       label: 'Modes',       icon: 'braces'         },
            { id: 'permissions', label: 'Permissions', icon: 'shield-check'   },
            { id: 'loop',        label: 'Loop',        icon: 'repeat-2'       },
            { id: 'rules',       label: 'Rules',       icon: 'landmark'       },
            { id: 'workflows',   label: 'Workflows',   icon: 'route'          },
            { id: 'skills',      label: 'Skills',      icon: 'sparkles'       },
            { id: 'prompts',     label: 'Prompts',     icon: 'message-square' },
            { id: 'mcp-servers', label: 'MCP',         icon: 'unplug'         },
        ];
        this.buildSubTabNav(container, subTabs, this.activeAgentSubTab,
            (id) => { this.activeAgentSubTab = id; this.display(); });
        const content = container.createDiv({ cls: 'agent-settings-subcontent' });
        if (this.activeAgentSubTab === 'modes')       this.buildModesTab(content);
        if (this.activeAgentSubTab === 'permissions') this.buildPermissionsTab(content);
        if (this.activeAgentSubTab === 'loop')        this.buildLoopTab(content);
        if (this.activeAgentSubTab === 'rules')       this.buildRulesTab(content);
        if (this.activeAgentSubTab === 'workflows')   this.buildWorkflowsTab(content);
        if (this.activeAgentSubTab === 'skills')      this.buildSkillsTab(content);
        if (this.activeAgentSubTab === 'prompts')     this.buildPromptsTab(content);
        if (this.activeAgentSubTab === 'mcp-servers') this.buildMcpServersTab(content);
    }

    // ---------------------------------------------------------------------------
    // Prompts tab — custom prompt CRUD
    // ---------------------------------------------------------------------------

    private buildPromptsTab(container: HTMLElement): void {
        container.createEl('p', {
            cls: 'agent-settings-desc',
            text: 'Create your own prompt templates. Type / in the chat to trigger them. ' +
                  'Use {{userInput}} to insert your current message text, ' +
                  'and {{activeFile}} to insert the name of the active note.',
        });

        const listEl = container.createDiv({ cls: 'agent-rules-list' });
        let editingId: string | null = null;

        const savePrompts = async (prompts: CustomPrompt[]) => {
            this.plugin.settings.customPrompts = prompts;
            await this.plugin.saveSettings();
        };

        // Collect all available modes for the mode selector
        const allModes = [
            ...BUILT_IN_MODES,
            ...(this.plugin.settings.customModes ?? []),
        ];

        // ── Inline form (create / edit) ────────────────────────────────────────
        const formEl = container.createDiv({ cls: 'agent-prompt-form' });
        formEl.style.display = 'none';

        const formTitle = formEl.createEl('p', { cls: 'agent-prompt-form-title', text: 'New Prompt' });
        const nameInput = formEl.createEl('input', {
            type: 'text', placeholder: 'Name (e.g. "Daily report")',
            cls: 'agent-prompt-input',
        }) as HTMLInputElement;
        const slugInput = formEl.createEl('input', {
            type: 'text', placeholder: 'Slug (e.g. "daily-report")',
            cls: 'agent-prompt-input',
        }) as HTMLInputElement;

        // Auto-derive slug from name
        nameInput.addEventListener('input', () => {
            if (!editingId) {
                slugInput.value = nameInput.value
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-+|-+$/g, '');
            }
        });

        const contentInput = formEl.createEl('textarea', {
            placeholder: 'Prompt template — use {{userInput}} and {{activeFile}}',
            cls: 'agent-prompt-textarea',
        }) as HTMLTextAreaElement;
        contentInput.rows = 5;

        const formHint = formEl.createEl('p', {
            cls: 'agent-settings-desc',
            text: 'Variables: {{userInput}} = current chat message  |  {{activeFile}} = active note name',
        });
        formHint.style.fontSize = 'var(--font-smaller)';

        // Optional mode selector
        const modeRow = formEl.createDiv({ cls: 'agent-prompt-mode-row' });
        modeRow.createEl('label', { text: 'Mode (optional):', cls: 'agent-prompt-mode-label' });
        const modeSelect = modeRow.createEl('select', { cls: 'agent-prompt-input agent-prompt-mode-select' }) as HTMLSelectElement;
        modeSelect.createEl('option', { value: '', text: 'All modes' });
        for (const mode of allModes) {
            modeSelect.createEl('option', { value: mode.slug, text: mode.name });
        }
        modeRow.createEl('span', {
            cls: 'agent-settings-desc',
            text: 'Restrict this prompt to a specific mode. Leave blank to show in all modes.',
        }).style.fontSize = 'var(--font-smaller)';

        const formBtns = formEl.createDiv({ cls: 'agent-prompt-form-btns' });
        const saveBtn = formBtns.createEl('button', { text: 'Save', cls: 'mod-cta' });
        const cancelBtn = formBtns.createEl('button', { text: 'Cancel' });

        const openForm = (prompt?: CustomPrompt) => {
            editingId = prompt?.id ?? null;
            formTitle.setText(prompt ? 'Edit Prompt' : 'New Prompt');
            nameInput.value = prompt?.name ?? '';
            slugInput.value = prompt?.slug ?? '';
            contentInput.value = prompt?.content ?? '';
            modeSelect.value = prompt?.mode ?? '';
            formEl.style.display = '';
            nameInput.focus();
        };

        cancelBtn.addEventListener('click', () => {
            formEl.style.display = 'none';
            editingId = null;
        });

        saveBtn.addEventListener('click', async () => {
            const name = nameInput.value.trim();
            const slug = slugInput.value.trim().replace(/[^a-z0-9-]/g, '');
            const content = contentInput.value.trim();
            if (!name || !slug || !content) return;

            const mode = modeSelect.value || undefined;
            const prompts = [...(this.plugin.settings.customPrompts ?? [])];
            if (editingId) {
                const idx = prompts.findIndex((p) => p.id === editingId);
                if (idx !== -1) prompts[idx] = { ...prompts[idx], name, slug, content, mode };
            } else {
                prompts.push({ id: `custom-${Date.now()}`, name, slug, content, enabled: true, mode });
            }
            await savePrompts(prompts);
            formEl.style.display = 'none';
            editingId = null;
            renderList();
        });

        // ── New prompt button ──────────────────────────────────────────────────
        const addBtn = container.createEl('button', { text: 'New Prompt', cls: 'mod-cta agent-prompt-add-btn' });
        addBtn.addEventListener('click', () => openForm());

        // ── List rendering ─────────────────────────────────────────────────────
        const renderList = () => {
            listEl.empty();
            const prompts = this.plugin.settings.customPrompts ?? [];
            if (prompts.length === 0) {
                listEl.createEl('p', {
                    cls: 'agent-settings-desc',
                    text: 'No custom prompts yet. Click "New Prompt" to create one.',
                });
                return;
            }
            for (const p of prompts) {
                const row = listEl.createDiv({ cls: 'agent-rules-row' });
                const label = row.createSpan({ cls: 'agent-rules-label' });

                const toggle = label.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
                toggle.checked = p.enabled !== false;
                toggle.addEventListener('change', async () => {
                    const updated = (this.plugin.settings.customPrompts ?? []).map((cp) =>
                        cp.id === p.id ? { ...cp, enabled: toggle.checked } : cp
                    );
                    await savePrompts(updated);
                });

                label.createSpan({ text: p.name });
                label.createSpan({ cls: 'agent-workflow-slug', text: `/${p.slug}` });
                if (p.mode) {
                    const modeName = allModes.find((m) => m.slug === p.mode)?.name ?? p.mode;
                    label.createSpan({ cls: 'agent-prompt-mode-badge', text: modeName });
                }

                const actions = row.createDiv({ cls: 'agent-rules-actions' });

                const editBtn = actions.createEl('button', { cls: 'agent-rules-edit-btn' });
                setIcon(editBtn, 'pencil');
                editBtn.setAttribute('aria-label', 'Edit');
                editBtn.addEventListener('click', () => openForm(p));

                const delBtn = actions.createEl('button', { cls: 'agent-rules-delete-btn' });
                setIcon(delBtn, 'trash-2');
                delBtn.setAttribute('aria-label', 'Delete');
                delBtn.addEventListener('click', async () => {
                    const updated = (this.plugin.settings.customPrompts ?? []).filter((cp) => cp.id !== p.id);
                    await savePrompts(updated);
                    renderList();
                });
            }
        };

        // Insert form before list
        container.insertBefore(formEl, listEl);
        renderList();
    }

    private buildMcpServersTab(container: HTMLElement): void {
        container.createEl('p', {
            cls: 'agent-settings-desc',
            text: 'Connect external tools and data sources via the Model Context Protocol (MCP). ' +
                  'Each server exposes tools the agent can call using use_mcp_tool.',
        });

        const mcpClient = this.plugin.mcpClient;

        // ── Add server button ──────────────────────────────────────────────────
        const addBtn = container.createEl('button', { text: 'Add Server', cls: 'mod-cta agent-mcp-add-btn' });

        // ── Server list ────────────────────────────────────────────────────────
        const listEl = container.createDiv({ cls: 'agent-mcp-list' });

        const renderList = () => {
            listEl.empty();
            const servers = this.plugin.settings.mcpServers ?? {};
            const names = Object.keys(servers);
            if (names.length === 0) {
                listEl.createEl('p', {
                    cls: 'agent-settings-desc',
                    text: 'No MCP servers configured. Click "Add Server" to get started.',
                });
                return;
            }
            for (const name of names) {
                const config = servers[name];
                const conn = mcpClient?.getConnection(name);
                const status = conn?.status ?? 'disconnected';

                const row = listEl.createDiv({ cls: 'agent-mcp-server-row' });

                // Status dot
                const dot = row.createSpan({ cls: `agent-mcp-status-dot ${status}` });
                dot.setAttribute('title', status === 'error' ? (conn?.error ?? 'error') : status);

                // Name + type
                const info = row.createDiv({ cls: 'agent-mcp-server-info' });
                info.createSpan({ cls: 'agent-mcp-server-name', text: name });
                info.createSpan({ cls: 'agent-mcp-server-type', text: config.type });
                if (status === 'error' && conn?.error) {
                    info.createSpan({ cls: 'agent-mcp-server-error', text: conn.error });
                } else if (status === 'connected') {
                    const toolCount = conn?.tools.length ?? 0;
                    info.createSpan({
                        cls: 'agent-mcp-server-tools',
                        text: `${toolCount} tool${toolCount !== 1 ? 's' : ''}`,
                    });
                }

                // Actions
                const actions = row.createDiv({ cls: 'agent-rules-actions' });

                if (status === 'connected') {
                    const disconnBtn = actions.createEl('button', { text: 'Disconnect' });
                    disconnBtn.addEventListener('click', async () => {
                        await mcpClient?.disconnect(name);
                        renderList();
                    });
                } else if (status !== 'connecting') {
                    const connBtn = actions.createEl('button', { text: status === 'error' ? 'Retry' : 'Connect' });
                    connBtn.addEventListener('click', async () => {
                        if (mcpClient) {
                            await mcpClient.connect(name, config);
                            renderList();
                        }
                    });
                }

                const editBtn = actions.createEl('button', { cls: 'agent-rules-edit-btn' });
                setIcon(editBtn, 'pencil');
                editBtn.setAttribute('aria-label', 'Edit');
                editBtn.addEventListener('click', () => openAddModal(name, config));

                const delBtn = actions.createEl('button', { cls: 'agent-rules-delete-btn' });
                setIcon(delBtn, 'trash-2');
                delBtn.setAttribute('aria-label', 'Delete');
                delBtn.addEventListener('click', async () => {
                    if (mcpClient) await mcpClient.disconnect(name);
                    delete this.plugin.settings.mcpServers[name];
                    await this.plugin.saveSettings();
                    renderList();
                });
            }
        };

        // ── Add/Edit modal ─────────────────────────────────────────────────────
        const openAddModal = (editName?: string, editConfig?: import('../types/settings').McpServerConfig) => {
            const modal = new Modal(this.app);
            modal.titleEl.setText(editName ? `Edit Server: ${editName}` : 'Add MCP Server');

            const { contentEl } = modal;

            const nameInput = contentEl.createEl('input', {
                type: 'text', placeholder: 'Server name (e.g. "filesystem")',
                cls: 'agent-mcp-modal-input',
            }) as HTMLInputElement;
            nameInput.value = editName ?? '';
            if (editName) nameInput.disabled = true;

            const typeSelect = contentEl.createEl('select', { cls: 'agent-mcp-modal-input' }) as HTMLSelectElement;
            for (const opt of ['stdio', 'sse', 'streamable-http']) {
                const o = typeSelect.createEl('option', { text: opt, value: opt });
                if (opt === (editConfig?.type ?? 'stdio')) o.selected = true;
            }

            // stdio fields
            const stdioSection = contentEl.createDiv({ cls: 'agent-mcp-section' });
            stdioSection.createEl('label', { text: 'Command' });
            const cmdInput = stdioSection.createEl('input', {
                type: 'text', placeholder: 'e.g. npx',
                cls: 'agent-mcp-modal-input',
            }) as HTMLInputElement;
            cmdInput.value = editConfig?.command ?? '';

            stdioSection.createEl('label', { text: 'Args (space-separated)' });
            const argsInput = stdioSection.createEl('input', {
                type: 'text', placeholder: 'e.g. -y @modelcontextprotocol/server-filesystem /path',
                cls: 'agent-mcp-modal-input',
            }) as HTMLInputElement;
            argsInput.value = (editConfig?.args ?? []).join(' ');

            stdioSection.createEl('label', { text: 'Env (KEY=VALUE, one per line)' });
            const envInput = stdioSection.createEl('textarea', { cls: 'agent-mcp-modal-input' }) as HTMLTextAreaElement;
            envInput.rows = 3;
            envInput.value = Object.entries(editConfig?.env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n');

            // URL fields (sse / streamable-http)
            const urlSection = contentEl.createDiv({ cls: 'agent-mcp-section' });
            urlSection.createEl('label', { text: 'URL' });
            const urlInput = urlSection.createEl('input', {
                type: 'text', placeholder: 'e.g. http://localhost:3000/sse',
                cls: 'agent-mcp-modal-input',
            }) as HTMLInputElement;
            urlInput.value = editConfig?.url ?? '';

            urlSection.createEl('label', { text: 'Headers (KEY=VALUE, one per line)' });
            const headersInput = urlSection.createEl('textarea', { cls: 'agent-mcp-modal-input' }) as HTMLTextAreaElement;
            headersInput.rows = 3;
            headersInput.value = Object.entries(editConfig?.headers ?? {}).map(([k, v]) => `${k}=${v}`).join('\n');

            const updateSections = () => {
                const isStdio = typeSelect.value === 'stdio';
                stdioSection.style.display = isStdio ? '' : 'none';
                urlSection.style.display = isStdio ? 'none' : '';
            };
            updateSections();
            typeSelect.addEventListener('change', updateSections);

            contentEl.createEl('label', { text: 'Timeout (seconds)' });
            const timeoutInput = contentEl.createEl('input', {
                type: 'number', placeholder: '60',
                cls: 'agent-mcp-modal-input',
            }) as HTMLInputElement;
            timeoutInput.value = String(editConfig?.timeout ?? 60);

            // Save button
            const saveBtn = contentEl.createEl('button', { text: 'Save & Connect', cls: 'mod-cta agent-mcp-modal-save' });
            saveBtn.addEventListener('click', async () => {
                const serverName = (editName ?? nameInput.value.trim());
                if (!serverName) return;

                const type = typeSelect.value as 'stdio' | 'sse' | 'streamable-http';
                const parseKV = (text: string): Record<string, string> => {
                    const result: Record<string, string> = {};
                    for (const line of text.split('\n')) {
                        const eqIdx = line.indexOf('=');
                        if (eqIdx > 0) result[line.slice(0, eqIdx).trim()] = line.slice(eqIdx + 1).trim();
                    }
                    return result;
                };

                const newConfig: import('../types/settings').McpServerConfig = {
                    type,
                    ...(type === 'stdio' ? {
                        command: cmdInput.value.trim(),
                        args: argsInput.value.trim() ? argsInput.value.trim().split(/\s+/) : [],
                        env: parseKV(envInput.value),
                    } : {
                        url: urlInput.value.trim(),
                        headers: parseKV(headersInput.value),
                    }),
                    timeout: parseInt(timeoutInput.value) || 60,
                };

                this.plugin.settings.mcpServers ??= {};
                this.plugin.settings.mcpServers[serverName] = newConfig;
                await this.plugin.saveSettings();

                // Reconnect this specific server
                if (mcpClient) {
                    await mcpClient.disconnect(serverName);
                    await mcpClient.connect(serverName, newConfig);
                }

                modal.close();
                renderList();
            });

            modal.open();
        };

        addBtn.addEventListener('click', () => openAddModal());
        renderList();
    }

    // ---------------------------------------------------------------------------
    // Permissions tab — Auto-Approve
    // ---------------------------------------------------------------------------

    private buildPermissionsTab(container: HTMLElement): void {
        container.createEl('p', {
            cls: 'agent-settings-desc',
            text: 'Control which tool categories the agent can run without asking for your approval first.',
        });

        new Setting(container)
            .setName('Enable auto-approve')
            .setDesc('When on, the agent can perform approved actions without stopping to ask you each time.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.enabled).onChange(async (v) => {
                    this.plugin.settings.autoApproval.enabled = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(container)
            .setName('Show approval bar in chat')
            .setDesc('Show a row of quick-toggle buttons above the chat input for easy access.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.showMenuInChat).onChange(async (v) => {
                    this.plugin.settings.autoApproval.showMenuInChat = v;
                    await this.plugin.saveSettings();
                }),
            );

        container.createEl('h3', { cls: 'agent-settings-section', text: 'Per-category' });

        new Setting(container)
            .setName('Read operations')
            .setDesc('Reading and searching notes. These operations never change your vault, so they are safe to always allow.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.read).onChange(async (v) => {
                    this.plugin.settings.autoApproval.read = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(container)
            .setName('Note edits')
            .setDesc('Writing or modifying note content. When off, you approve each change before it is saved.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.noteEdits).onChange(async (v) => {
                    this.plugin.settings.autoApproval.noteEdits = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(container)
            .setName('Vault structure changes')
            .setDesc('Creating folders, moving files, or deleting notes. These structural changes are harder to undo.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.vaultChanges).onChange(async (v) => {
                    this.plugin.settings.autoApproval.vaultChanges = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(container)
            .setName('Web access')
            .setDesc('Fetching pages or running web searches. Disable if you want to review every external request.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.web).onChange(async (v) => {
                    this.plugin.settings.autoApproval.web = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(container)
            .setName('MCP tool calls')
            .setDesc('Calls to external tools connected via Model Context Protocol servers.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.mcp).onChange(async (v) => {
                    this.plugin.settings.autoApproval.mcp = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(container)
            .setName('Mode switching')
            .setDesc('Let the agent switch between modes (e.g. from Librarian to Writer) on its own.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.mode).onChange(async (v) => {
                    this.plugin.settings.autoApproval.mode = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(container)
            .setName('Subtasks')
            .setDesc('Allow the agent to spawn sub-agents to handle parts of a larger task independently.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.subtasks).onChange(async (v) => {
                    this.plugin.settings.autoApproval.subtasks = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(container)
            .setName('Follow-up questions')
            .setDesc('Let the agent ask you clarifying questions during a task without needing separate approval.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.question).onChange(async (v) => {
                    this.plugin.settings.autoApproval.question = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(container)
            .setName('Todo list updates')
            .setDesc('Allow the agent to update its task checklist while working.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.todo).onChange(async (v) => {
                    this.plugin.settings.autoApproval.todo = v;
                    await this.plugin.saveSettings();
                }),
            );
    }

    // ---------------------------------------------------------------------------
    // Loop tab — Agent loop tuning + context condensing + power steering
    // ---------------------------------------------------------------------------

    private buildLoopTab(container: HTMLElement): void {
        container.createEl('p', {
            cls: 'agent-settings-desc',
            text: 'Control how the agent loop runs, how long context is kept, and how reliably the agent stays on task.',
        });

        container.createEl('h3', { cls: 'agent-settings-section', text: 'Agent Loop' });

        new Setting(container)
            .setName('Consecutive error limit')
            .setDesc('Stop the task after this many tool errors in a row. Prevents the agent from getting stuck in a loop. Set to 0 to never stop automatically.')
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
            .setName('Pause between requests (ms)')
            .setDesc('Wait this many milliseconds between API calls. Useful if you hit rate limits on your API plan. Set to 0 for no delay.')
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

        container.createEl('h3', { cls: 'agent-settings-section', text: 'Context Condensing' });

        const condensingSetting = new Setting(container)
            .setName('Enable context condensing')
            .setDesc('When a conversation gets very long, automatically summarize older messages to stay within the model\'s memory limit. The summary replaces older messages but keeps key facts intact.');
        this.addInfoButton(condensingSetting, 'Context Condensing', 'AI models can only hold a limited amount of text in memory at once. When your conversation approaches that limit, Context Condensing automatically creates a summary of what was discussed so far, then continues the conversation with that summary instead of all the original messages. This lets you work on very large tasks without hitting context limits.');
        condensingSetting.addToggle((t) =>
            t.setValue(this.plugin.settings.advancedApi.condensingEnabled ?? false).onChange(async (v) => {
                this.plugin.settings.advancedApi.condensingEnabled = v;
                await this.plugin.saveSettings();
                thresholdSetting.settingEl.style.display = v ? '' : 'none';
            }),
        );

        const thresholdSetting = new Setting(container)
            .setName('Condensing threshold')
            .setDesc('Start condensing when the conversation reaches this percentage of the model\'s memory limit. Lower = condenses more often; higher = waits longer before condensing.')
            .addSlider((s) =>
                s
                    .setLimits(50, 95, 5)
                    .setValue(this.plugin.settings.advancedApi.condensingThreshold ?? 80)
                    .setDynamicTooltip()
                    .onChange(async (v) => {
                        this.plugin.settings.advancedApi.condensingThreshold = v;
                        await this.plugin.saveSettings();
                    }),
            );
        thresholdSetting.settingEl.style.display =
            (this.plugin.settings.advancedApi.condensingEnabled ?? false) ? '' : 'none';

        container.createEl('h3', { cls: 'agent-settings-section', text: 'Power Steering' });

        const powerSteeringSetting = new Setting(container)
            .setName('Power Steering frequency')
            .setDesc('Every N steps, remind the agent of its current mode instructions. Helps keep long tasks on track. Set to 0 to disable. Recommended: 4.');
        this.addInfoButton(powerSteeringSetting, 'Power Steering', 'During long tasks, the agent can gradually lose track of its role and instructions. Power Steering periodically re-injects the current mode\'s system prompt into the conversation, keeping the agent focused on its intended purpose. A frequency of 4 means the reminder is sent every 4 conversation turns.');
        powerSteeringSetting.addText((t) =>
            t
                .setValue(String(this.plugin.settings.advancedApi.powerSteeringFrequency ?? 0))
                .onChange(async (v) => {
                    const n = parseInt(v);
                    if (!isNaN(n) && n >= 0) {
                        this.plugin.settings.advancedApi.powerSteeringFrequency = n;
                        await this.plugin.saveSettings();
                        }
                    }),
            );
    }

    private buildRulesTab(container: HTMLElement): void {
        container.createEl('p', {
            cls: 'agent-settings-desc',
            text: 'Rules are injected into the system prompt of every agent session. ' +
                  'Store rule files as .md or .txt in your vault at .obsidian-agent/rules/.',
        });

        const rulesLoader = (this.plugin as any).rulesLoader;

        // ── Create new rule ────────────────────────────────────────────────
        const createRow = container.createDiv({ cls: 'agent-rules-create-row' });
        const nameInput = createRow.createEl('input', {
            type: 'text', placeholder: 'Rule name (e.g. "always-use-iso-dates")',
            cls: 'agent-rules-name-input',
        });
        const createBtn = createRow.createEl('button', { text: 'Create rule', cls: 'mod-cta' });

        // ── Rule list ──────────────────────────────────────────────────────
        const listEl = container.createDiv({ cls: 'agent-rules-list' });

        const refreshList = async () => {
            listEl.empty();
            if (!rulesLoader) {
                listEl.createEl('p', { cls: 'agent-settings-desc', text: 'Rules loader not available.' });
                return;
            }
            const paths: string[] = await rulesLoader.discoverRules();
            if (paths.length === 0) {
                listEl.createEl('p', { cls: 'agent-settings-desc', text: 'No rules yet. Create one above.' });
                return;
            }
            for (const rPath of paths) {
                const row = listEl.createDiv({ cls: 'agent-rules-row' });
                const label = row.createSpan({ cls: 'agent-rules-label' });

                const enabled = this.plugin.settings.rulesToggles?.[rPath] !== false;
                const toggle = label.createEl('input', { type: 'checkbox' });
                (toggle as HTMLInputElement).checked = enabled;
                toggle.addEventListener('change', async () => {
                    this.plugin.settings.rulesToggles ??= {};
                    this.plugin.settings.rulesToggles[rPath] = (toggle as HTMLInputElement).checked;
                    await this.plugin.saveSettings();
                });

                const { RulesLoader } = await import('../core/context/RulesLoader');
                label.createSpan({ text: RulesLoader.displayName(rPath) });

                const actions = row.createDiv({ cls: 'agent-rules-actions' });
                const editBtn = actions.createEl('button', { text: 'Edit', cls: 'agent-rules-edit-btn' });
                editBtn.addEventListener('click', async () => {
                    const content = await this.app.vault.adapter.read(rPath);
                    const { RulesLoader } = await import('../core/context/RulesLoader');
                    new ContentEditorModal(this.app, `Edit rule: ${RulesLoader.displayName(rPath)}`, content, async (newContent) => {
                        await this.app.vault.adapter.write(rPath, newContent);
                    }).open();
                });

                const delBtn = actions.createEl('button', { text: 'Delete', cls: 'agent-rules-delete-btn' });
                delBtn.addEventListener('click', async () => {
                    await rulesLoader.deleteRule(rPath);
                    this.plugin.settings.rulesToggles ??= {};
                    delete this.plugin.settings.rulesToggles[rPath];
                    await this.plugin.saveSettings();
                    await refreshList();
                });
            }
        };

        createBtn.addEventListener('click', async () => {
            const name = nameInput.value.trim();
            if (!name || !rulesLoader) return;
            const template = `# ${name}\n\n`;
            const rPath = await rulesLoader.createRule(name, template);
            nameInput.value = '';
            await refreshList();
            new ContentEditorModal(this.app, `Edit rule: ${name}`, template, async (content) => {
                await this.app.vault.adapter.write(rPath, content);
            }).open();
        });

        refreshList();
    }

    private buildWorkflowsTab(container: HTMLElement): void {
        container.createEl('p', {
            cls: 'agent-settings-desc',
            text: 'Workflows are triggered by typing /workflow-name in the chat. ' +
                  'Store workflow files as .md or .txt in your vault at .obsidian-agent/workflows/.',
        });

        const workflowLoader = (this.plugin as any).workflowLoader;

        // ── Create new workflow ────────────────────────────────────────────
        const createRow = container.createDiv({ cls: 'agent-rules-create-row' });
        const nameInput = createRow.createEl('input', {
            type: 'text', placeholder: 'Workflow name (e.g. "daily-review")',
            cls: 'agent-rules-name-input',
        });
        const createBtn = createRow.createEl('button', { text: 'Create workflow', cls: 'mod-cta' });

        // Import button
        const importWfBtn = createRow.createEl('button', { text: 'Import', cls: 'agent-rules-import-btn' });
        importWfBtn.addEventListener('click', () => {
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.md,.txt';
            fileInput.addEventListener('change', async () => {
                const file = fileInput.files?.[0];
                if (!file || !workflowLoader) return;
                const content = await file.text();
                const nameWithoutExt = file.name.replace(/\.[^.]+$/, '');
                await workflowLoader.createWorkflow(nameWithoutExt, content);
                await refreshList();
            });
            fileInput.click();
        });

        // ── Workflow list ──────────────────────────────────────────────────
        const listEl = container.createDiv({ cls: 'agent-rules-list' });

        const refreshList = async () => {
            listEl.empty();
            if (!workflowLoader) {
                listEl.createEl('p', { cls: 'agent-settings-desc', text: 'Workflow loader not available.' });
                return;
            }
            const workflows: { path: string; slug: string; displayName: string }[] =
                await workflowLoader.discoverWorkflows();
            if (workflows.length === 0) {
                listEl.createEl('p', { cls: 'agent-settings-desc', text: 'No workflows yet. Create one above.' });
                return;
            }
            for (const wf of workflows) {
                const row = listEl.createDiv({ cls: 'agent-rules-row' });
                const label = row.createSpan({ cls: 'agent-rules-label' });

                const enabled = this.plugin.settings.workflowToggles?.[wf.path] !== false;
                const toggle = label.createEl('input', { type: 'checkbox' });
                (toggle as HTMLInputElement).checked = enabled;
                toggle.addEventListener('change', async () => {
                    this.plugin.settings.workflowToggles ??= {};
                    this.plugin.settings.workflowToggles[wf.path] = (toggle as HTMLInputElement).checked;
                    await this.plugin.saveSettings();
                });

                const nameSpan = label.createSpan({ text: wf.displayName });
                const slugSpan = label.createSpan({ cls: 'agent-workflow-slug', text: `/${wf.slug}` });
                nameSpan; slugSpan; // suppress unused warnings

                const actions = row.createDiv({ cls: 'agent-rules-actions' });
                const editBtn = actions.createEl('button', { text: 'Edit', cls: 'agent-rules-edit-btn' });
                editBtn.addEventListener('click', async () => {
                    const content = await this.app.vault.adapter.read(wf.path);
                    new ContentEditorModal(this.app, `Edit workflow: ${wf.displayName}`, content, async (newContent) => {
                        await this.app.vault.adapter.write(wf.path, newContent);
                    }).open();
                });

                const exportWfBtn = actions.createEl('button', { text: 'Export', cls: 'agent-rules-export-btn' });
                exportWfBtn.addEventListener('click', async () => {
                    const content = await this.app.vault.adapter.read(wf.path);
                    const blob = new Blob([content], { type: 'text/markdown' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${wf.slug}.md`;
                    a.click();
                    URL.revokeObjectURL(url);
                });

                const delBtn = actions.createEl('button', { text: 'Delete', cls: 'agent-rules-delete-btn' });
                delBtn.addEventListener('click', async () => {
                    await workflowLoader.deleteWorkflow(wf.path);
                    this.plugin.settings.workflowToggles ??= {};
                    delete this.plugin.settings.workflowToggles[wf.path];
                    await this.plugin.saveSettings();
                    await refreshList();
                });
            }
        };

        createBtn.addEventListener('click', async () => {
            const name = nameInput.value.trim();
            if (!name || !workflowLoader) return;
            const template = `# ${name}\n\n`;
            const wPath = await workflowLoader.createWorkflow(name, template);
            nameInput.value = '';
            await refreshList();
            new ContentEditorModal(this.app, `Edit workflow: ${name}`, template, async (content) => {
                await this.app.vault.adapter.write(wPath, content);
            }).open();
        });

        refreshList();
    }

    private buildSkillsTab(container: HTMLElement): void {
        container.createEl('p', {
            cls: 'agent-settings-desc',
            text: 'Skills are automatically injected into the system prompt when relevant to the user\'s message. ' +
                  'Each skill lives in a subfolder at .obsidian-agent/skills/{name}/SKILL.md with frontmatter: name, description.',
        });

        const skillsManager = (this.plugin as any).skillsManager;

        // ── Create new skill ──────────────────────────────────────────────
        const createRow = container.createDiv({ cls: 'agent-rules-create-row' });
        const nameInput = createRow.createEl('input', {
            type: 'text', placeholder: 'Skill name (e.g. "daily-template")',
            cls: 'agent-rules-name-input',
        });
        const createBtn = createRow.createEl('button', { text: 'Create skill', cls: 'mod-cta' });

        // Import button
        const importSkillBtn = createRow.createEl('button', { text: 'Import', cls: 'agent-rules-import-btn' });
        importSkillBtn.addEventListener('click', () => {
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.md,.txt';
            fileInput.addEventListener('change', async () => {
                const file = fileInput.files?.[0];
                if (!file || !skillsManager) return;
                const content = await file.text();
                // Extract name from frontmatter if present, otherwise use filename
                let skillName = file.name.replace(/\.[^.]+$/, '');
                const fmMatch = content.match(/^---[\s\S]*?^name:\s*(.+)$/m);
                if (fmMatch) skillName = fmMatch[1].trim();
                const safeName = skillName.replace(/[^a-zA-Z0-9\-_ ]/g, '').trim();
                const dir = `${skillsManager.skillsDir}/${safeName}`;
                try {
                    const exists = await this.app.vault.adapter.exists(dir);
                    if (!exists) await this.app.vault.adapter.mkdir(dir);
                    await this.app.vault.adapter.write(`${dir}/SKILL.md`, content);
                    await refreshList();
                } catch {
                    new Notice('Could not import skill');
                }
            });
            fileInput.click();
        });

        // ── Skill list ─────────────────────────────────────────────────────
        const listEl = container.createDiv({ cls: 'agent-rules-list' });

        const refreshList = async () => {
            listEl.empty();
            if (!skillsManager) {
                listEl.createEl('p', { cls: 'agent-settings-desc', text: 'Skills manager not available.' });
                return;
            }
            const skills: { path: string; name: string; description: string }[] =
                await skillsManager.discoverSkills();
            if (skills.length === 0) {
                listEl.createEl('p', { cls: 'agent-settings-desc', text: 'No skills yet. Create one above.' });
                return;
            }
            for (const skill of skills) {
                const row = listEl.createDiv({ cls: 'agent-rules-row' });
                const label = row.createSpan({ cls: 'agent-rules-label' });
                label.createSpan({ text: skill.name });
                label.createSpan({ cls: 'agent-workflow-slug', text: skill.description });

                const actions = row.createDiv({ cls: 'agent-rules-actions' });
                const editBtn = actions.createEl('button', { text: 'Edit', cls: 'agent-rules-edit-btn' });
                editBtn.addEventListener('click', async () => {
                    const content = await this.app.vault.adapter.read(skill.path);
                    new ContentEditorModal(this.app, `Edit skill: ${skill.name}`, content, async (newContent) => {
                        await this.app.vault.adapter.write(skill.path, newContent);
                    }).open();
                });

                const exportSkillBtn = actions.createEl('button', { text: 'Export', cls: 'agent-rules-export-btn' });
                exportSkillBtn.addEventListener('click', async () => {
                    const content = await this.app.vault.adapter.read(skill.path);
                    const blob = new Blob([content], { type: 'text/markdown' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `SKILL-${skill.name}.md`;
                    a.click();
                    URL.revokeObjectURL(url);
                });

                const delBtn = actions.createEl('button', { text: 'Delete', cls: 'agent-rules-delete-btn' });
                delBtn.addEventListener('click', async () => {
                    try {
                        await this.app.vault.adapter.remove(skill.path);
                        await refreshList();
                    } catch {
                        new Notice('Could not delete skill file');
                    }
                });
            }
        };

        createBtn.addEventListener('click', async () => {
            const name = nameInput.value.trim();
            if (!name || !skillsManager) return;
            const safeName = name.replace(/[^a-zA-Z0-9\-_ ]/g, '').trim();
            const dir = `${skillsManager.skillsDir}/${safeName}`;
            const skillPath = `${dir}/SKILL.md`;
            const template = `---\nname: ${safeName}\ndescription: Describe when this skill applies\nkeywords: []\n---\n\n# ${safeName}\n\n<!-- Describe what this skill does and when to use it. The agent reads this file when the skill is relevant. -->\n\n`;
            try {
                const exists = await this.app.vault.adapter.exists(dir);
                if (!exists) await this.app.vault.adapter.mkdir(dir);
                await this.app.vault.adapter.write(skillPath, template);
                nameInput.value = '';
                await refreshList();
                new ContentEditorModal(this.app, `Edit skill: ${safeName}`, template, async (content) => {
                    await this.app.vault.adapter.write(skillPath, content);
                }).open();
            } catch {
                new Notice('Could not create skill');
            }
        });

        refreshList();
    }

    // ---------------------------------------------------------------------------
    // Modes tab
    // ---------------------------------------------------------------------------

    private buildModesTab(container: HTMLElement): void {
        // Collect all selectable modes (built-in + custom, not __custom instruction entries).
        // Vault entries with the same slug as a built-in are overrides — they are already
        // represented by the built-in entry in the dropdown, so exclude them here.
        const builtInSlugs = new Set(BUILT_IN_MODES.map((m) => m.slug));
        const getAllModes = (): ModeConfig[] => [
            ...BUILT_IN_MODES,
            ...((this.plugin as any).modeService?.getGlobalModes?.() ?? []),
            ...this.plugin.settings.customModes.filter(
                (m) => m.source === 'vault' && !m.slug.endsWith('__custom') && !builtInSlugs.has(m.slug),
            ),
        ];

        let selectedSlug = this.plugin.settings.currentMode;
        if (!getAllModes().find((m) => m.slug === selectedSlug)) {
            selectedSlug = BUILT_IN_MODES[0].slug;
        }

        // ── Top row: selector + action buttons ───────────────────────────────
        const topRow = container.createDiv('modes-top-row');

        const select = topRow.createEl('select', { cls: 'modes-select' });
        const refreshSelect = () => {
            select.empty();
            const groups: { label: string; modes: ModeConfig[] }[] = [
                { label: 'Built-in', modes: BUILT_IN_MODES },
                { label: 'Global (all vaults)', modes: (this.plugin as any).modeService?.getGlobalModes?.() ?? [] },
                { label: 'This Vault', modes: this.plugin.settings.customModes.filter((m) => m.source === 'vault' && !m.slug.endsWith('__custom') && !builtInSlugs.has(m.slug)) },
            ];
            for (const group of groups) {
                if (group.modes.length === 0) continue;
                const optgroup = select.createEl('optgroup');
                optgroup.label = group.label;
                for (const m of group.modes) {
                    const opt = optgroup.createEl('option', { value: m.slug, text: m.name });
                    if (m.slug === selectedSlug) opt.selected = true;
                }
            }
        };
        refreshSelect();

        const btnGroup = topRow.createDiv('modes-btn-group');
        const newBtn = btnGroup.createEl('button', { text: '+ New', cls: 'mod-cta modes-top-btn' });
        const importBtn = btnGroup.createEl('button', { text: 'Import', cls: 'modes-top-btn' });

        // ── Form area ─────────────────────────────────────────────────────────
        const formArea = container.createDiv('modes-form-area');

        const renderForm = (slug: string) => {
            formArea.empty();

            const builtIn = BUILT_IN_MODES.find((m) => m.slug === slug);
            // Vault override: same slug as built-in, stored in customModes with source 'vault'
            const vaultOverride = builtIn
                ? this.plugin.settings.customModes.find(
                      (m) => m.slug === slug && m.source === 'vault' && !m.slug.endsWith('__custom'),
                  )
                : undefined;
            // Vault custom mode (not a built-in at all)
            const vaultCustom = !builtIn
                ? this.plugin.settings.customModes.find(
                      (m) => m.slug === slug && m.source === 'vault',
                  )
                : undefined;
            // Global mode (not a built-in, not in customModes)
            const globalMode: ModeConfig | undefined = !builtIn && !vaultCustom
                ? ((this.plugin as any).modeService?.getGlobalModes?.() ?? []).find(
                      (m: ModeConfig) => m.slug === slug,
                  )
                : undefined;

            // Effective mode for display: override > built-in > vault custom > global
            const mode = vaultOverride ?? builtIn ?? vaultCustom ?? globalMode;
            if (!mode) return;

            const isBuiltIn = !!builtIn;
            const isGlobal = !!globalMode;

            /**
             * Returns the mutable reference for this mode's edits.
             * For built-in modes this lazily creates a vault override entry so
             * that changes are persisted without mutating the constant.
             */
            const getOrCreateEditable = (): ModeConfig => {
                if (isBuiltIn) {
                    let ov = this.plugin.settings.customModes.find(
                        (m) => m.slug === slug && m.source === 'vault' && !m.slug.endsWith('__custom'),
                    );
                    if (!ov) {
                        ov = { ...builtIn!, source: 'vault' };
                        this.plugin.settings.customModes.push(ov);
                    }
                    return ov;
                }
                if (isGlobal) return globalMode!;
                return vaultCustom!;
            };

            const saveMode = async () => {
                if (isGlobal) {
                    await GlobalModeStore.updateMode(globalMode!);
                    await (this.plugin as any).modeService?.reloadGlobalModes?.();
                } else {
                    await this.plugin.saveSettings();
                }
            };

            // ── Customized badge (built-in modes that have been overridden) ────
            if (isBuiltIn && vaultOverride) {
                const badge = formArea.createDiv('modes-customized-badge');
                setIcon(badge.createSpan('modes-customized-icon'), 'pencil');
                badge.createEl('span', { cls: 'modes-customized-text', text: 'This mode has been customised' });
            }

            // ── Model Selection ───────────────────────────────────────────────
            const modelSetting = new Setting(formArea)
                .setName('Model')
                .setDesc('Which model this mode uses. Falls back to the globally selected model if not set.');
            const models = this.plugin.settings.activeModels;
            const currentModeModelKey = this.plugin.settings.modeModelKeys?.[slug] ?? '';
            modelSetting.addDropdown((dd) => {
                dd.addOption('', '— Use global model —');
                for (const m of models) {
                    const key = getModelKey(m);
                    dd.addOption(key, m.displayName ?? m.name);
                }
                dd.setValue(currentModeModelKey);
                dd.onChange(async (v) => {
                    if (!this.plugin.settings.modeModelKeys) this.plugin.settings.modeModelKeys = {};
                    if (v) this.plugin.settings.modeModelKeys[slug] = v;
                    else delete this.plugin.settings.modeModelKeys[slug];
                    await this.plugin.saveSettings();
                });
            });

            // ── Name ─────────────────────────────────────────────────────────
            new Setting(formArea)
                .setName('Name')
                .addText((t) => {
                    t.setValue(mode.name);
                    // Name is read-only for built-in modes (slug must remain stable)
                    if (isBuiltIn) {
                        t.inputEl.disabled = true;
                    } else {
                        t.onChange(async (v) => {
                            getOrCreateEditable().name = v;
                            await saveMode();
                            refreshSelect();
                        });
                    }
                });

            // ── Slug (always read-only) ───────────────────────────────────────
            new Setting(formArea)
                .setName('Slug')
                .addText((t) => { t.setValue(mode.slug); t.inputEl.disabled = true; });

            // ── Short description ─────────────────────────────────────────────
            const descWrap = formArea.createDiv('modes-field');
            descWrap.createEl('div', { cls: 'modes-field-label', text: 'Short description (for humans)' });
            descWrap.createEl('div', { cls: 'modes-field-desc', text: 'Brief description shown in the mode selector dropdown.' });
            const descTextarea = descWrap.createEl('textarea', { cls: 'modes-textarea', attr: { placeholder: 'Brief description...' } });
            descTextarea.value = mode.description || '';
            descTextarea.rows = 2;
            descTextarea.addEventListener('input', async () => {
                const editable = getOrCreateEditable();
                editable.description = descTextarea.value;
                await saveMode();
            });

            // ── When to Use ───────────────────────────────────────────────────
            const wtuWrap = formArea.createDiv('modes-field');
            wtuWrap.createEl('div', { cls: 'modes-field-label', text: 'When to Use (optional)' });
            wtuWrap.createEl('div', {
                cls: 'modes-field-desc',
                text: 'Guidance for the Orchestrator when deciding which mode to delegate a subtask to.',
            });
            const wtuTextarea = wtuWrap.createEl('textarea', {
                cls: 'modes-textarea',
                attr: { placeholder: 'Describe when this mode should be chosen...' },
            });
            wtuTextarea.value = mode.whenToUse ?? '';
            wtuTextarea.rows = 3;
            wtuTextarea.addEventListener('input', async () => {
                const editable = getOrCreateEditable();
                editable.whenToUse = wtuTextarea.value;
                await saveMode();
            });

            // ── Available Tools ───────────────────────────────────────────────
            const toolsWrap = formArea.createDiv('modes-field');
            const toolsHeaderRow = toolsWrap.createDiv('modes-tools-header');
            toolsHeaderRow.createEl('div', { cls: 'modes-field-label', text: 'Available Tools' });

            let toolsEditMode = false;
            const toolsBody = toolsWrap.createDiv('modes-tools-body');

            const renderToolsReadOnly = () => {
                toolsBody.empty();
                const enabled = mode.toolGroups.filter((g) => g in TOOL_GROUP_META);
                if (enabled.length === 0) {
                    toolsBody.createEl('span', { cls: 'modes-tools-none', text: 'None' });
                } else {
                    toolsBody.createEl('span', {
                        cls: 'modes-tools-list',
                        text: enabled.map((g) => TOOL_GROUP_META[g]?.label ?? g).join(', '),
                    });
                }
            };

            const renderToolsEdit = () => {
                toolsBody.empty();
                // Current per-tool override for this mode (if any)
                const currentOverride: string[] | undefined =
                    this.plugin.settings.modeToolOverrides?.[slug];

                for (const [group, meta] of Object.entries(TOOL_GROUP_META)) {
                    const isGroupEnabled = mode.toolGroups.includes(group as any);

                    // --- Group accordion ---
                    const details = toolsBody.createEl('details', { cls: 'modes-tool-group-accordion' });
                    if (isGroupEnabled) details.open = true;

                    const summary = details.createEl('summary', { cls: 'modes-tool-group-summary' });

                    // Group enable/disable checkbox
                    const groupCb = summary.createEl('input', { type: 'checkbox' });
                    groupCb.checked = isGroupEnabled;
                    groupCb.addEventListener('click', (e) => e.stopPropagation()); // prevent accordion toggle
                    groupCb.addEventListener('change', async () => {
                        const editable = getOrCreateEditable();
                        if (groupCb.checked) {
                            if (!editable.toolGroups.includes(group as any)) editable.toolGroups.push(group as any);
                            details.open = true;
                        } else {
                            editable.toolGroups = editable.toolGroups.filter((g) => g !== group);
                            details.open = false;
                        }
                        (mode as any).toolGroups = [...editable.toolGroups];
                        await saveMode();
                        // Recount active tools badge
                        badgeEl.setText(getCountBadge(group, groupCb.checked));
                    });

                    summary.createEl('span', { cls: 'modes-tool-group-label', text: meta.label });

                    // Active tools count badge
                    const getCountBadge = (grp: string, enabled: boolean): string => {
                        if (!enabled) return '0 / ' + TOOL_GROUP_META[grp].tools.length;
                        const override = this.plugin.settings.modeToolOverrides?.[slug];
                        if (!override) return meta.tools.length + ' / ' + meta.tools.length;
                        const active = meta.tools.filter((t) => override.includes(t)).length;
                        return `${active} / ${meta.tools.length}`;
                    };
                    const badgeEl = summary.createEl('span', {
                        cls: 'modes-tool-count-badge',
                        text: getCountBadge(group, isGroupEnabled),
                    });

                    // --- Individual tool checkboxes ---
                    const toolsGrid = details.createDiv('modes-tool-checkboxes');
                    for (const toolName of meta.tools) {
                        const row = toolsGrid.createDiv('modes-tool-row');
                        const toolCb = row.createEl('input', { type: 'checkbox' });
                        const isEnabled = !currentOverride || currentOverride.includes(toolName);
                        toolCb.checked = isEnabled && isGroupEnabled;
                        toolCb.disabled = !isGroupEnabled;

                        const toolMeta = TOOL_LABEL_MAP[toolName];
                        const labelEl = row.createEl('label', { cls: 'modes-tool-name' });
                        labelEl.createSpan({ cls: 'modes-tool-label-text', text: toolMeta?.label ?? toolName });
                        if (toolMeta?.desc) {
                            labelEl.createSpan({ cls: 'modes-tool-label-desc', text: toolMeta.desc });
                        }

                        toolCb.addEventListener('change', async () => {
                            // Compute new override for this mode
                            const allGroupTools = meta.tools;
                            // Start from current override or all tools in all groups
                            let allActiveTools: string[] = this.plugin.settings.modeToolOverrides?.[slug]
                                ?? (this.plugin as any).modeService?.getToolNames(mode) ?? [];
                            if (toolCb.checked) {
                                if (!allActiveTools.includes(toolName)) allActiveTools = [...allActiveTools, toolName];
                            } else {
                                allActiveTools = allActiveTools.filter((t) => t !== toolName);
                            }
                            await (this.plugin as any).modeService?.setModeToolOverride(slug, allActiveTools);
                            badgeEl.setText(getCountBadge(group, isGroupEnabled));
                        });
                    }
                }
            };

            renderToolsReadOnly();

            // "Edit tools" button — hidden for Ask mode (protected)
            if (slug !== 'ask') {
                const editToolsBtn = toolsHeaderRow.createEl('button', {
                    text: 'Edit tools',
                    cls: 'modes-edit-tools-btn',
                });
                editToolsBtn.addEventListener('click', () => {
                    toolsEditMode = !toolsEditMode;
                    editToolsBtn.setText(toolsEditMode ? 'Done' : 'Edit tools');
                    if (toolsEditMode) renderToolsEdit();
                    else renderToolsReadOnly();
                });
            }

            // ── Forced Skills ────────────────────────────────────────────────
            const skillsMgrForMode = (this.plugin as any).skillsManager;
            if (skillsMgrForMode) {
                const skillsWrap = formArea.createDiv('modes-field');
                skillsWrap.createEl('div', { cls: 'modes-field-label', text: 'Forced Skills' });
                skillsWrap.createEl('div', {
                    cls: 'modes-field-desc',
                    text: 'Skills always injected into the system prompt for this mode, regardless of message keyword matching.',
                });
                const skillsCbList = skillsWrap.createDiv('modes-skills-list');
                skillsCbList.createEl('span', { cls: 'modes-loading-hint', text: 'Loading skills…' });
                (async () => {
                    skillsCbList.empty();
                    try {
                        const allSkills: { path: string; name: string; description: string }[] =
                            await skillsMgrForMode.discoverSkills();
                        if (allSkills.length === 0) {
                            skillsCbList.createEl('span', { cls: 'modes-loading-hint', text: 'No skills found. Create skills in the Skills tab.' });
                        } else {
                            const forcedSet = new Set<string>(this.plugin.settings.forcedSkills?.[slug] ?? []);
                            for (const skill of allSkills) {
                                const row = skillsCbList.createDiv('modes-skills-row');
                                const cb = row.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
                                cb.checked = forcedSet.has(skill.name);
                                const lbl = row.createEl('label', { cls: 'modes-skills-label' });
                                lbl.createSpan({ text: skill.name });
                                if (skill.description) lbl.createSpan({ cls: 'modes-skills-desc', text: skill.description });
                                cb.addEventListener('change', async () => {
                                    if (!this.plugin.settings.forcedSkills) this.plugin.settings.forcedSkills = {};
                                    const cur = new Set<string>(this.plugin.settings.forcedSkills[slug] ?? []);
                                    if (cb.checked) cur.add(skill.name);
                                    else cur.delete(skill.name);
                                    this.plugin.settings.forcedSkills[slug] = [...cur];
                                    await this.plugin.saveSettings();
                                });
                            }
                        }
                    } catch {
                        skillsCbList.createEl('span', { cls: 'modes-loading-hint', text: 'Error loading skills.' });
                    }
                })();
            }

            // ── Allowed MCP Servers ──────────────────────────────────────────
            const mcpServerNames = Object.keys(this.plugin.settings.mcpServers ?? {});
            if (mcpServerNames.length > 0) {
                const mcpWrap = formArea.createDiv('modes-field');
                mcpWrap.createEl('div', { cls: 'modes-field-label', text: 'Allowed MCP Servers' });
                mcpWrap.createEl('div', {
                    cls: 'modes-field-desc',
                    text: 'MCP servers available in this mode. All checked = all servers allowed (default).',
                });
                const mcpCbList = mcpWrap.createDiv('modes-skills-list');
                const modeMcpAllowed = this.plugin.settings.modeMcpServers?.[slug];
                // undefined or empty = all allowed
                const allowedSet = new Set<string>(modeMcpAllowed && modeMcpAllowed.length > 0 ? modeMcpAllowed : mcpServerNames);
                for (const serverName of mcpServerNames) {
                    const row = mcpCbList.createDiv('modes-skills-row');
                    const cb = row.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
                    cb.checked = allowedSet.has(serverName);
                    row.createEl('label', { cls: 'modes-skills-label', text: serverName });
                    cb.addEventListener('change', async () => {
                        if (!this.plugin.settings.modeMcpServers) this.plugin.settings.modeMcpServers = {};
                        const cur = new Set<string>(
                            this.plugin.settings.modeMcpServers[slug]?.length
                                ? this.plugin.settings.modeMcpServers[slug]
                                : mcpServerNames
                        );
                        if (cb.checked) cur.add(serverName);
                        else cur.delete(serverName);
                        // If all are checked, store empty array (= no restriction)
                        const next = [...cur];
                        this.plugin.settings.modeMcpServers[slug] = next.length === mcpServerNames.length ? [] : next;
                        await this.plugin.saveSettings();
                    });
                }
            }

            // ── Role Definition ───────────────────────────────────────────────
            const roleWrap = formArea.createDiv('modes-field');
            roleWrap.createEl('div', { cls: 'modes-field-label', text: 'Role Definition' });
            roleWrap.createEl('div', {
                cls: 'modes-field-desc',
                text: 'Core system prompt defining this agent\'s expertise and personality.',
            });
            const roleTextarea = roleWrap.createEl('textarea', { cls: 'modes-textarea' });
            roleTextarea.value = mode.roleDefinition || '';
            roleTextarea.rows = 8;
            roleTextarea.addEventListener('input', async () => {
                const editable = getOrCreateEditable();
                editable.roleDefinition = roleTextarea.value;
                (mode as any).roleDefinition = editable.roleDefinition;
                await saveMode();
            });

            // ── Mode-specific Custom Instructions ─────────────────────────────
            const ciWrap = formArea.createDiv('modes-field');
            ciWrap.createEl('div', { cls: 'modes-field-label', text: 'Mode-specific Custom Instructions (optional)' });
            ciWrap.createEl('div', {
                cls: 'modes-field-desc',
                text: `Behavioral guidelines appended after the role definition for ${mode.name} mode.`,
            });
            const ciTextarea = ciWrap.createEl('textarea', {
                cls: 'modes-textarea',
                attr: { placeholder: `Add behavioral guidelines specific to ${mode.name} mode...` },
            });
            // Read from override (preferred) or legacy __custom entry
            const legacyCi = this.plugin.settings.customModes.find((m) => m.slug === `${slug}__custom`);
            ciTextarea.value = isBuiltIn
                ? (vaultOverride?.customInstructions ?? legacyCi?.customInstructions ?? '')
                : (mode.customInstructions ?? '');
            ciTextarea.rows = 4;
            ciTextarea.addEventListener('input', async () => {
                const value = ciTextarea.value.trim();
                const editable = getOrCreateEditable();
                editable.customInstructions = value || undefined;
                if (isBuiltIn) {
                    // Migrate away from legacy __custom entry
                    const legacyIdx = this.plugin.settings.customModes.findIndex((m) => m.slug === `${slug}__custom`);
                    if (legacyIdx >= 0) this.plugin.settings.customModes.splice(legacyIdx, 1);
                }
                await saveMode();
            });

            // ── Bottom action bar ─────────────────────────────────────────────
            const bottomBar = formArea.createDiv('modes-bottom-bar');

            const isActive = this.plugin.settings.currentMode === slug;
            if (isActive) {
                bottomBar.createEl('span', { cls: 'modes-active-badge', text: '✓ Active mode' });
            } else {
                const setBtn = bottomBar.createEl('button', { text: 'Set Active', cls: 'mod-cta' });
                setBtn.addEventListener('click', async () => {
                    this.plugin.settings.currentMode = slug;
                    await this.plugin.saveSettings();
                    this.display();
                });
            }

            // Preview System Prompt
            const previewBtn = bottomBar.createEl('button', { text: 'Preview Prompt', cls: 'modes-preview-btn' });
            previewBtn.addEventListener('click', () => {
                const allModes = [
                    ...BUILT_IN_MODES,
                    ...((this.plugin as any).modeService?.getGlobalModes?.() ?? []),
                    ...this.plugin.settings.customModes.filter((m) => m.source === 'vault' && !m.slug.endsWith('__custom')),
                ];
                const prompt = buildSystemPromptForMode(
                    mode,
                    allModes,
                    this.plugin.settings.globalCustomInstructions || undefined,
                );
                new SystemPromptPreviewModal(this.app, mode.name, prompt).open();
            });

            // Export
            const exportBtn = bottomBar.createEl('button', { text: 'Export', cls: 'modes-export-btn' });
            exportBtn.addEventListener('click', () => {
                const exportData: Partial<ModeConfig> = { ...mode };
                delete (exportData as any).source;
                const json = JSON.stringify(exportData, null, 2);
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${mode.slug}.json`;
                a.click();
                URL.revokeObjectURL(url);
            });

            // Restore defaults (built-in modes only — visible, disabled unless there is an override)
            if (isBuiltIn) {
                const hasOverride = !!this.plugin.settings.customModes.find(
                    (m) => (m.slug === slug && m.source === 'vault') || m.slug === `${slug}__custom`,
                );
                const restoreBtn = bottomBar.createEl('button', {
                    text: 'Restore defaults',
                    cls: 'modes-restore-btn',
                });
                if (!hasOverride) restoreBtn.disabled = true;
                restoreBtn.addEventListener('click', async () => {
                    // Remove vault override + legacy __custom entry (restores role definition,
                    // tool groups, custom instructions, and agent instructions to built-in defaults)
                    this.plugin.settings.customModes = this.plugin.settings.customModes.filter(
                        (m) => !(m.slug === slug && m.source === 'vault') && m.slug !== `${slug}__custom`,
                    );
                    // Also clear the per-mode model override so global default is used again
                    if (this.plugin.settings.modeModelKeys) {
                        delete this.plugin.settings.modeModelKeys[slug];
                    }
                    await this.plugin.saveSettings();
                    new Notice(`${mode.name} restored to defaults`);
                    renderForm(slug);
                });
            }

            // Delete (non-built-in modes only)
            if (!isBuiltIn) {
                const deleteBtn = bottomBar.createEl('button', {
                    text: 'Delete',
                    cls: 'mod-warning modes-delete-btn',
                });
                deleteBtn.addEventListener('click', async () => {
                    if (isGlobal) {
                        await GlobalModeStore.removeMode(slug);
                        await (this.plugin as any).modeService?.reloadGlobalModes?.();
                    } else {
                        this.plugin.settings.customModes = this.plugin.settings.customModes.filter(
                            (m) => m.slug !== slug,
                        );
                        await this.plugin.saveSettings();
                    }
                    if (this.plugin.settings.currentMode === slug) {
                        this.plugin.settings.currentMode = 'librarian';
                        await this.plugin.saveSettings();
                    }
                    this.display();
                });
            }
        };

        // Initial render
        renderForm(selectedSlug);

        // Selector change
        select.addEventListener('change', () => {
            selectedSlug = select.value;
            renderForm(selectedSlug);
        });

        // New Mode
        newBtn.addEventListener('click', () => {
            new NewModeModal(this.app, this.plugin, () => this.display(), (this.plugin as any).modeService).open();
        });

        // Import
        importBtn.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.addEventListener('change', async () => {
                const file = input.files?.[0];
                if (!file) return;
                const text = await file.text();
                try {
                    // M-1: Validate JSON size and structure before accepting imported mode
                    if (text.length > 500_000) {
                        new Notice('Mode file too large (max 500 KB)');
                        return;
                    }
                    let parsed: any;
                    try {
                        parsed = JSON.parse(text);
                    } catch {
                        new Notice('Invalid mode file: not valid JSON');
                        return;
                    }
                    if (!parsed || typeof parsed !== 'object' ||
                        typeof parsed.slug !== 'string' ||
                        typeof parsed.name !== 'string' ||
                        typeof parsed.roleDefinition !== 'string') {
                        new Notice('Invalid mode file: missing slug, name, or roleDefinition');
                        return;
                    }
                    parsed.source = 'vault';
                    const allSlugs = [
                        ...BUILT_IN_MODES.map((m) => m.slug),
                        ...this.plugin.settings.customModes.map((m) => m.slug),
                    ];
                    if (allSlugs.includes(parsed.slug)) {
                        parsed.slug = `${parsed.slug}-imported`;
                    }
                    this.plugin.settings.customModes.push(parsed);
                    await this.plugin.saveSettings();
                    this.display();
                    new Notice(`Mode "${parsed.name}" imported`);
                } catch {
                    new Notice('Failed to parse mode file');
                }
            });
            input.click();
        });

        // ── Global Custom Instructions ────────────────────────────────────────
        const globalSection = container.createDiv('modes-global-section');
        globalSection.createEl('h3', { text: 'Custom Instructions for All Modes' });
        globalSection.createEl('p', {
            cls: 'modes-field-desc',
            text: 'These instructions are appended to the system prompt for every mode. Use them to set global behavior, language preferences, or formatting rules that apply across all agents.',
        });
        const globalTextarea = globalSection.createEl('textarea', {
            cls: 'modes-textarea',
            attr: { placeholder: 'e.g. Always respond in German. Never use bullet points with more than 5 items.' },
        });
        globalTextarea.value = this.plugin.settings.globalCustomInstructions ?? '';
        globalTextarea.rows = 5;
        globalTextarea.addEventListener('input', async () => {
            this.plugin.settings.globalCustomInstructions = globalTextarea.value;
            await this.plugin.saveSettings();
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
        header.createDiv({ cls: 'mc-default', text: 'Default' });
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

        // Enable — small toggle switch
        const enableEl = row.createDiv('mc-enable');
        const toggleLabel = enableEl.createEl('label', { cls: 'mc-toggle' });
        const toggleInput = toggleLabel.createEl('input', { attr: { type: 'checkbox' } });
        toggleLabel.createSpan({ cls: 'mc-toggle-track' });
        toggleInput.checked = model.enabled;
        toggleInput.addEventListener('change', async () => {
            const idx = this.plugin.settings.activeModels.findIndex((m) => getModelKey(m) === key);
            if (idx !== -1) this.plugin.settings.activeModels[idx].enabled = toggleInput.checked;
            await this.plugin.saveSettings();
            row.toggleClass('model-row-disabled', !toggleInput.checked);
        });

        // Default — radio button (single selection)
        const defaultEl = row.createDiv('mc-default');
        const defaultRadio = defaultEl.createEl('input', { attr: { type: 'radio', name: 'active-model' } });
        defaultRadio.checked = isActive;
        defaultRadio.addEventListener('change', async () => {
            if (defaultRadio.checked) {
                this.plugin.settings.activeModelKey = key;
                await this.plugin.saveSettings();
                this.display();
            }
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
        desc.setText('Embedding models power semantic search across your vault. Select exactly one model as the active index.');

        // Table header
        const table = container.createDiv('model-table embedding-table');
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

        // ── Semantic Index ────────────────────────────────────────────────────
        container.createEl('h3', { cls: 'agent-settings-section', text: 'Semantic Index' });

        const activeEmbModel = this.plugin.getActiveEmbeddingModel();
        const embModelDesc = activeEmbModel
            ? `Using ${activeEmbModel.displayName ?? activeEmbModel.name} (${activeEmbModel.provider}) for embeddings.`
            : 'No API model active above — falls back to local all-MiniLM-L6-v2 (no data leaves your device).';

        container.createEl('p', {
            cls: 'agent-settings-desc',
            text: `Builds a local vector index of all notes for semantic_search. ${embModelDesc}`,
        });

        const statusEl = container.createDiv('agent-semantic-status');
        const getIdx = () => (this.plugin as any).semanticIndex;

        const refreshStatus = () => {
            statusEl.empty();
            if (!this.plugin.settings.enableSemanticIndex) {
                statusEl.setText('Semantic index is disabled.');
                return;
            }
            const idx = getIdx();
            if (!idx) {
                statusEl.setText('Not initialized. Toggle off/on to reload.');
                return;
            }
            if (idx.building) {
                const p = idx.progressIndexed ?? idx.docCount;
                const t = idx.progressTotal ?? '?';
                statusEl.setText(`Building… (${p} / ${t} files)`);
                return;
            }
            if (idx.isIndexed) {
                statusEl.setText(`Ready: ${idx.docCount} notes · Built: ${(idx.lastBuiltAt as Date).toLocaleString()}`);
            } else {
                statusEl.setText('Not built yet. Click "Build Index" to start.');
            }
        };
        refreshStatus();

        // Poll every second so status stays current (e.g. when build was started
        // from the sidebar menu, not from this tab).
        const pollInterval = window.setInterval(refreshStatus, 1000);
        // Clean up when the container is removed from DOM (tab switch / close)
        const observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const node of Array.from(m.removedNodes)) {
                    if (node === container || (node as HTMLElement).contains?.(container)) {
                        window.clearInterval(pollInterval);
                        observer.disconnect();
                    }
                }
            }
        });
        if (container.parentElement) observer.observe(container.parentElement, { childList: true });

        const semanticEnableSetting = new Setting(container)
            .setName('Enable semantic index')
            .setDesc('Lets the agent find relevant notes by meaning, not just exact keywords. Requires an embedding model. First build may take a few minutes for large vaults.');
        this.addInfoButton(semanticEnableSetting, 'Semantic Index', 'The Semantic Index reads all your notes, breaks them into small sections, and converts each section into a mathematical representation of its meaning (called an "embedding"). When you ask the agent a question, it searches for notes with similar meaning rather than just matching words. This is called Retrieval-Augmented Generation (RAG) and makes the agent much better at finding relevant context in your vault.');
        semanticEnableSetting.addToggle((t) =>
            t.setValue(this.plugin.settings.enableSemanticIndex ?? false).onChange(async (v) => {
                this.plugin.settings.enableSemanticIndex = v;
                await this.plugin.saveSettings();
                if (v) {
                    const { SemanticIndexService } = await import('../core/semantic/SemanticIndexService');
                    const pluginDir = `.obsidian/plugins/${this.plugin.manifest.id}`;
                    const svc = new SemanticIndexService(this.plugin.app.vault, pluginDir);
                    const embModel = this.plugin.getActiveEmbeddingModel();
                    if (embModel) svc.setEmbeddingModel(embModel);
                    (this.plugin as any).semanticIndex = svc;
                    await svc.initialize().catch(console.warn);
                } else {
                    (this.plugin as any).semanticIndex = null;
                }
                refreshStatus();
            }),
        );

        new Setting(container)
            .setName('Index PDF attachments')
            .setDesc('Also index PDF files in your vault. Text is extracted from PDFs and indexed alongside your notes. Image-only (scanned) PDFs are skipped automatically.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.semanticIndexPdfs ?? false).onChange(async (v) => {
                    this.plugin.settings.semanticIndexPdfs = v;
                    getIdx()?.configure({ indexPdfs: v });
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(container)
            .setName('Build index')
            .setDesc('Index new and modified notes. Already-indexed notes are skipped. Use "Force Rebuild" to reindex everything from scratch.')
            .addButton((btn) => {
                btn.setButtonText('Build Index').onClick(async () => {
                    const idx = getIdx();
                    if (!idx) { new Notice('Enable semantic index first.'); return; }
                    if (idx.building) { new Notice('Already building…'); return; }
                    idx.setEmbeddingModel(this.plugin.getActiveEmbeddingModel() ?? null);
                    btn.setButtonText('Building…').setDisabled(true);
                    cancelBtn.setDisabled(false);
                    statusEl.setText('Building index…');
                    try {
                        await idx.buildIndex((indexed: number, total: number) => {
                            statusEl.setText(`Building… (${indexed}/${total})`);
                        });
                        refreshStatus();
                    } catch (e) {
                        statusEl.setText(`Build failed: ${(e as Error).message}`);
                    } finally {
                        btn.setButtonText('Build Index').setDisabled(false);
                        cancelBtn.setDisabled(true);
                    }
                });
            })
            .addButton((btn) => {
                btn.setButtonText('Force Rebuild').setWarning().onClick(async () => {
                    const idx = getIdx();
                    if (!idx) { new Notice('Enable semantic index first.'); return; }
                    if (idx.building) { new Notice('Already building…'); return; }
                    idx.setEmbeddingModel(this.plugin.getActiveEmbeddingModel() ?? null);
                    btn.setButtonText('Rebuilding…').setDisabled(true);
                    cancelBtn.setDisabled(false);
                    statusEl.setText('Force rebuild…');
                    try {
                        await idx.buildIndex((indexed: number, total: number) => {
                            statusEl.setText(`Rebuilding… (${indexed}/${total})`);
                        }, true);
                        refreshStatus();
                    } catch (e) {
                        statusEl.setText(`Rebuild failed: ${(e as Error).message}`);
                    } finally {
                        btn.setButtonText('Force Rebuild').setDisabled(false);
                        cancelBtn.setDisabled(true);
                    }
                });
            });

        let cancelBtn: any;
        new Setting(container)
            .setName('Cancel indexing')
            .setDesc('Stop the current indexing run. Progress is saved to disk — the next build will resume from where it left off.')
            .addButton((btn) => {
                cancelBtn = btn;
                btn.setButtonText('Cancel').setDisabled(true).onClick(() => {
                    getIdx()?.cancelBuild();
                    btn.setDisabled(true);
                    statusEl.setText('Cancelling…');
                });
            });

        new Setting(container)
            .setName('Delete index')
            .setDesc('Remove the on-disk index. Notes are not affected.')
            .addButton((btn) => {
                btn.setButtonText('Delete Index').setWarning().onClick(async () => {
                    const idx = getIdx();
                    if (idx) await idx.deleteIndex();
                    refreshStatus();
                });
            });

        // ── Index configuration ───────────────────────────────────────────────
        container.createEl('h3', { cls: 'agent-settings-section', text: 'Index Configuration' });

        const batchSetting = new Setting(container)
            .setName('Checkpoint interval')
            .setDesc('How many files to index before saving progress to disk. Smaller = more frequent checkpoints, safer on slow disks. Larger = fewer writes, slightly faster. Default: 20.');
        this.addInfoButton(batchSetting, 'Checkpoint Interval', 'The indexer saves a checkpoint to disk every N files. If indexing is interrupted (Obsidian closed, error), the next run resumes from the last checkpoint — only unindexed or modified files are processed. A smaller interval loses less progress on interruption but writes to disk more often. 10–30 is recommended for most vaults.');
        batchSetting.addSlider((s) =>
            s.setLimits(10, 200, 10)
                .setValue(this.plugin.settings.semanticBatchSize ?? 50)
                .setDynamicTooltip()
                .onChange(async (v) => {
                    this.plugin.settings.semanticBatchSize = v;
                    getIdx()?.configure({ batchSize: v });
                    await this.plugin.saveSettings();
                }),
        );

        const autoIndexSetting = new Setting(container)
            .setName('Auto-index strategy')
            .setDesc('When to automatically rebuild the index. "On Startup" is best for active vaults. "Never" lets you trigger it manually from the ellipsis menu in the chat.');
        this.addInfoButton(autoIndexSetting, 'Auto-Index Strategy', '"On Startup" rebuilds the index every time Obsidian opens — keeps the index fresh but adds a few seconds to startup time for large vaults. "On Mode Switch" rebuilds whenever you switch agent modes, useful if each mode works with different parts of your vault. "Never" means you control when to rebuild using the "Force Reindex Vault" option in the chat\'s ellipsis menu.');
        autoIndexSetting.addDropdown((d) =>
            d.addOptions({
                never: 'Never (manual only)',
                startup: 'On Startup',
                'mode-switch': 'On Mode Switch',
            })
                .setValue(this.plugin.settings.semanticAutoIndex ?? 'never')
                .onChange(async (v) => {
                    this.plugin.settings.semanticAutoIndex = v as 'startup' | 'mode-switch' | 'never';
                    await this.plugin.saveSettings();
                }),
        );

        const excludedSetting = new Setting(container)
            .setName('Excluded folders')
            .setDesc('Folders to skip when indexing. One folder path per line (e.g. Attachments, Templates, Archive).');
        this.addInfoButton(excludedSetting, 'Excluded Folders', 'Use this to skip folders that contain files you do not want the agent to search through — for example, attachment folders full of images or PDFs, template folders, or private journals. Enter the folder path relative to your vault root, one per line.');
        excludedSetting.addTextArea((t) =>
            t.setValue((this.plugin.settings.semanticExcludedFolders ?? []).join('\n'))
                .onChange(async (v) => {
                    const folders = v.split('\n').map((s) => s.trim()).filter(Boolean);
                    this.plugin.settings.semanticExcludedFolders = folders;
                    getIdx()?.configure({ excludedFolders: folders });
                    await this.plugin.saveSettings();
                }),
        );

        const storageSetting = new Setting(container)
            .setName('Storage location')
            .setDesc('"Obsidian Sync" stores the index inside the plugin folder and syncs it across your devices. "Local" stores it outside the vault so it is never synced.');
        this.addInfoButton(storageSetting, 'Storage Location', 'If you use Obsidian Sync, choose "Obsidian Sync" so the index is available on all your devices without rebuilding it. If you do not use Obsidian Sync, or if the index is too large to sync, choose "Local" to store it in a separate folder outside your vault.');
        storageSetting.addDropdown((d) =>
            d.addOptions({
                'obsidian-sync': 'Obsidian Sync (inside plugin folder)',
                local: 'Local (outside vault, no sync)',
            })
                .setValue(this.plugin.settings.semanticStorageLocation ?? 'obsidian-sync')
                .onChange(async (v) => {
                    this.plugin.settings.semanticStorageLocation = v as 'obsidian-sync' | 'local';
                    await this.plugin.saveSettings();
                }),
        );
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
    // Web Search tab (under Providers)
    // ---------------------------------------------------------------------------

    private buildWebSearchTab(container: HTMLElement): void {
        container.createEl('p', {
            cls: 'agent-settings-desc',
            text: 'Configure web_fetch (read any URL) and web_search (Brave / Tavily). web_fetch works without an API key; web_search requires one.',
        });

        new Setting(container)
            .setName('Enable web tools')
            .setDesc('Allow the agent to fetch web pages and run internet searches. Turn off to keep the agent working entirely within your vault.')
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
            .setDesc('Which service the agent uses for keyword searches. Choose "None" if you only need to fetch specific URLs, not run search queries.')
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
                .setDesc('Required for Brave Search. Get a free API key at brave.com/search/api (2,000 searches/month on the free plan).')
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
                .setDesc('Required for Tavily Search. Get a free API key at tavily.com (1,000 searches/month on the free plan).')
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
    // Vault tab
    // ---------------------------------------------------------------------------

    private buildVaultTab(container: HTMLElement): void {
        container.createEl('p', {
            cls: 'agent-settings-desc',
            text: 'Checkpoints snapshot each file before the agent first modifies it. After a task you can undo all changes with one click.',
        });

        new Setting(container)
            .setName('Enable checkpoints')
            .setDesc('Save a backup copy of each file before the agent changes it. After a task you can restore the originals with the Undo button.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.enableCheckpoints ?? true).onChange(async (v) => {
                    this.plugin.settings.enableCheckpoints = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(container)
            .setName('Snapshot timeout (seconds)')
            .setDesc('How long to wait for a file backup to finish before skipping it. Increase if you have very large files. Default: 30.')
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
            .setDesc('Delete the backup copies once a task finishes. Saves disk space. Disable if you want to review the backups manually after a task.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.checkpointAutoCleanup ?? true).onChange(async (v) => {
                    this.plugin.settings.checkpointAutoCleanup = v;
                    await this.plugin.saveSettings();
                }),
            );
    }

    // ---------------------------------------------------------------------------
    // Advanced tab — Interface, Log, Debug, Backup (as sub-tabs)
    // ---------------------------------------------------------------------------

    private buildAdvancedTab(container: HTMLElement): void {
        this.buildSubTabNav(
            container,
            [
                { id: 'interface', label: 'Interface', icon: 'monitor'      },
                { id: 'log',       label: 'Log',       icon: 'scroll-text'  },
                { id: 'debug',     label: 'Debug',     icon: 'bug'          },
                { id: 'backup',    label: 'Backup',    icon: 'download'     },
            ],
            this.activeAdvancedSubTab,
            (id) => { this.activeAdvancedSubTab = id; this.display(); },
        );
        const content = container.createDiv({ cls: 'agent-settings-subcontent' });
        if (this.activeAdvancedSubTab === 'interface') this.buildInterfaceTab(content);
        if (this.activeAdvancedSubTab === 'log')       this.buildLogTab(content);
        if (this.activeAdvancedSubTab === 'debug')     this.buildDebugTab(content);
        if (this.activeAdvancedSubTab === 'backup')    this.buildBackupTab(content);
    }

    private buildInterfaceTab(container: HTMLElement): void {
        new Setting(container)
            .setName('Auto-add active note as context')
            .setDesc('Automatically attach the note you have open in the editor to every message you send. The agent can see and reference its content.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoAddActiveFileContext).onChange(async (v) => {
                    this.plugin.settings.autoAddActiveFileContext = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(container)
            .setName('Show welcome message')
            .setDesc('Show an introductory message the first time the agent sidebar opens.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.showWelcomeMessage).onChange(async (v) => {
                    this.plugin.settings.showWelcomeMessage = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(container)
            .setName('Send with Enter')
            .setDesc('Press Enter to send a message (Shift+Enter for a line break). When off, use Ctrl+Enter (or Cmd+Enter on Mac) to send.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.sendWithEnter ?? true).onChange(async (v) => {
                    this.plugin.settings.sendWithEnter = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(container)
            .setName('Include current date and time in context')
            .setDesc('Tell the agent what day and time it is. Useful for tasks involving dates, schedules, or time-sensitive notes.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.includeCurrentTimeInContext ?? true).onChange(async (v) => {
                    this.plugin.settings.includeCurrentTimeInContext = v;
                    await this.plugin.saveSettings();
                }),
            );

        container.createEl('h3', { cls: 'agent-settings-section', text: 'Chat History' });

        new Setting(container)
            .setName('Chat history folder')
            .setDesc('Save each conversation as a JSON file in this vault folder. Leave empty to disable. Access saved conversations via the ellipsis menu in the chat. Example: Agent/History')
            .addText((t) =>
                t.setPlaceholder('Agent/History')
                    .setValue(this.plugin.settings.chatHistoryFolder ?? '')
                    .onChange(async (v) => {
                        const folder = v.trim();
                        this.plugin.settings.chatHistoryFolder = folder;
                        await this.plugin.saveSettings();
                        if (folder) {
                            const { ChatHistoryService } = await import('../core/ChatHistoryService');
                            (this.plugin as any).chatHistoryService = new ChatHistoryService(this.plugin.app.vault, folder);
                        } else {
                            (this.plugin as any).chatHistoryService = null;
                        }
                    }),
            );
    }

    private buildLogTab(container: HTMLElement): void {
        container.createEl('p', {
            cls: 'agent-settings-desc',
            text: 'Audit trail of all tool executions. Logs are stored per day (up to 30 days).',
        });

        const logControls = container.createDiv({ cls: 'agent-log-controls' });
        const dateSelect = logControls.createEl('select', { cls: 'agent-log-date-select dropdown' });
        const loadLogBtn = logControls.createEl('button', { text: 'Load', cls: 'mod-cta agent-log-load-btn' });
        const clearLogBtn = logControls.createEl('button', { text: 'Clear all logs', cls: 'agent-log-clear-btn' });
        const logTableWrap = container.createDiv({ cls: 'agent-log-table-wrap' });

        const logger = (this.plugin as any).operationLogger;
        if (logger) {
            logger.getLogDates().then((dates: string[]) => {
                if (dates.length === 0) {
                    const opt = dateSelect.createEl('option');
                    opt.value = '';
                    opt.text = 'No logs yet';
                    loadLogBtn.disabled = true;
                } else {
                    dates.forEach((d: string) => {
                        const opt = dateSelect.createEl('option');
                        opt.value = d;
                        opt.text = d;
                    });
                }
            });
        } else {
            const opt = dateSelect.createEl('option');
            opt.value = '';
            opt.text = 'Logger not available';
            loadLogBtn.disabled = true;
        }

        loadLogBtn.addEventListener('click', async () => {
            const date = dateSelect.value;
            if (!date || !logger) return;
            logTableWrap.empty();
            const entries = await logger.readLog(date);
            if (entries.length === 0) {
                logTableWrap.createEl('p', { cls: 'agent-settings-desc', text: 'No entries for this date.' });
                return;
            }
            const table = logTableWrap.createEl('table', { cls: 'agent-log-table' });
            const thead = table.createEl('thead');
            const hr = thead.createEl('tr');
            ['Time', 'Tool', 'Mode', 'Duration', 'Status'].forEach((h) => hr.createEl('th', { text: h }));
            const tbody = table.createEl('tbody');
            for (const e of entries) {
                const tr = tbody.createEl('tr');
                tr.createEl('td', { text: new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) });
                tr.createEl('td', { text: e.tool });
                tr.createEl('td', { text: e.mode });
                tr.createEl('td', { text: `${e.durationMs} ms` });
                const statusTd = tr.createEl('td');
                statusTd.createSpan({ cls: e.success ? 'agent-log-success' : 'agent-log-error', text: e.success ? 'ok' : 'error' });
                if (!e.success && e.error) statusTd.createEl('span', { cls: 'agent-log-error-msg', text: ` — ${e.error}` });
            }
        });

        clearLogBtn.addEventListener('click', async () => {
            if (!logger) return;
            await logger.clearLogs();
            logTableWrap.empty();
            dateSelect.empty();
            const opt = dateSelect.createEl('option');
            opt.value = '';
            opt.text = 'No logs yet';
            loadLogBtn.disabled = true;
            new Notice('All operation logs cleared');
        });
    }

    private buildDebugTab(container: HTMLElement): void {
        new Setting(container)
            .setName('Debug mode')
            .setDesc('Write detailed logs to the browser developer console. Only useful for troubleshooting. Open the console with Cmd+Option+I (Mac) or Ctrl+Shift+I (Windows).')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.debugMode).onChange(async (v) => {
                    this.plugin.settings.debugMode = v;
                    await this.plugin.saveSettings();
                }),
            );
    }

    private buildBackupTab(container: HTMLElement): void {
        container.createEl('p', {
            cls: 'agent-settings-desc',
            text: 'Export all plugin settings as a JSON file for backup or migration. Import to restore.',
        });
        const backupRow = container.createDiv('agent-backup-row');

        const exportSettingsBtn = backupRow.createEl('button', { text: 'Export settings', cls: 'mod-cta' });
        exportSettingsBtn.addEventListener('click', () => {
            const json = JSON.stringify(this.plugin.settings, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const date = new Date().toISOString().split('T')[0];
            a.download = `obsidian-agent-settings-${date}.json`;
            a.click();
            URL.revokeObjectURL(url);
            new Notice('Settings exported');
        });

        const importSettingsBtn = backupRow.createEl('button', { text: 'Import settings' });
        importSettingsBtn.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json,application/json';
            input.addEventListener('change', async () => {
                const file = input.files?.[0];
                if (!file) return;
                try {
                    const text = await file.text();
                    const parsed = JSON.parse(text);
                    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) ||
                        !('activeModels' in parsed || 'customModes' in parsed || 'autoApproval' in parsed)) {
                        new Notice('Invalid settings file — not recognized as Obsilo Agent settings');
                        return;
                    }
                    this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS, parsed);
                    await this.plugin.saveSettings();
                    new Notice('Settings imported. Refreshing…');
                    this.display();
                } catch (e) {
                    new Notice(`Import failed: ${(e as Error).message}`);
                }
            });
            input.click();
        });
    }
}

// ---------------------------------------------------------------------------
// System Prompt Preview Modal
// ---------------------------------------------------------------------------

class SystemPromptPreviewModal extends Modal {
    private modeName: string;
    private prompt: string;

    constructor(app: App, modeName: string, prompt: string) {
        super(app);
        this.modeName = modeName;
        this.prompt = prompt;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.addClass('system-prompt-preview-modal');
        contentEl.createEl('h2', { text: `System Prompt — ${this.modeName}` });

        const copyBtn = contentEl.createEl('button', { text: 'Copy to clipboard', cls: 'mod-cta' });
        copyBtn.style.marginBottom = '12px';
        copyBtn.addEventListener('click', async () => {
            await navigator.clipboard.writeText(this.prompt);
            copyBtn.setText('Copied!');
            setTimeout(() => copyBtn.setText('Copy to clipboard'), 2000);
        });

        const pre = contentEl.createEl('pre', { cls: 'system-prompt-preview-pre' });
        pre.setText(this.prompt);
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

// ---------------------------------------------------------------------------
// New Mode Modal
// ---------------------------------------------------------------------------

class NewModeModal extends Modal {
    private plugin: ObsidianAgentPlugin;
    private onSave: () => void;
    private modeService?: import('../core/modes/ModeService').ModeService;

    constructor(app: App, plugin: ObsidianAgentPlugin, onSave: () => void, modeService?: import('../core/modes/ModeService').ModeService) {
        super(app);
        this.plugin = plugin;
        this.onSave = onSave;
        this.modeService = modeService;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.addClass('new-mode-modal');
        contentEl.createEl('h2', { text: 'New Mode' });

        let slug = '';
        let name = '';
        let icon = 'sparkles';
        let description = '';
        let whenToUse = '';
        let roleDefinition = '';
        let customInstructions = '';
        let selectedGroups: Set<string> = new Set(['read', 'vault', 'agent']);
        let modelKey = '';
        let saveLocation: 'vault' | 'global' = 'vault';

        // ── Model ─────────────────────────────────────────────────────────────
        const modelSetting = new Setting(contentEl)
            .setName('Model')
            .setDesc('Which model this mode uses. Falls back to the global model if not set.');
        modelSetting.addDropdown((dd) => {
            dd.addOption('', '— Use global model —');
            for (const m of this.plugin.settings.activeModels) {
                const key = getModelKey(m);
                dd.addOption(key, m.displayName ?? m.name);
            }
            dd.setValue(modelKey);
            dd.onChange((v) => { modelKey = v; });
        });

        // ── Name ──────────────────────────────────────────────────────────────
        let slugInput: HTMLInputElement | null = null;
        new Setting(contentEl)
            .setName('Name')
            .setDesc('Display name (e.g. "Daily Planner")')
            .addText((t) => t.onChange((v) => {
                name = v;
                const computed = v.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
                slug = computed;
                if (slugInput) slugInput.value = computed;
            }));

        // ── Slug ──────────────────────────────────────────────────────────────
        const slugSetting = new Setting(contentEl)
            .setName('Slug')
            .setDesc('Auto-generated from name. Used internally and in file names.');
        slugSetting.addText((t) => {
            slugInput = t.inputEl;
            t.onChange((v) => { slug = v; });
        });

        // ── Short description ─────────────────────────────────────────────────
        contentEl.createEl('div', { cls: 'new-mode-field-label', text: 'Short description (for humans)' });
        contentEl.createEl('div', { cls: 'new-mode-field-desc', text: 'Brief description shown in the mode selector dropdown.' });
        const descTextarea = contentEl.createEl('textarea', {
            cls: 'new-mode-textarea',
            attr: { placeholder: 'Brief description...' },
        });
        descTextarea.rows = 2;
        descTextarea.addEventListener('input', () => { description = descTextarea.value; });

        // ── When to Use ───────────────────────────────────────────────────────
        contentEl.createEl('div', { cls: 'new-mode-field-label', text: 'When to Use (optional)' });
        contentEl.createEl('div', { cls: 'new-mode-field-desc', text: 'Guidance for the Orchestrator when deciding which mode to use.' });
        const wtuTextarea = contentEl.createEl('textarea', {
            cls: 'new-mode-textarea',
            attr: { placeholder: 'Describe when this mode should be chosen...' },
        });
        wtuTextarea.rows = 3;
        wtuTextarea.addEventListener('input', () => { whenToUse = wtuTextarea.value; });

        // ── Available Tools ───────────────────────────────────────────────────
        const toolsWrap = contentEl.createDiv('new-mode-groups');
        toolsWrap.createEl('label', { cls: 'new-mode-groups-label', text: 'Available Tools' });
        const groupGrid = toolsWrap.createDiv('new-mode-groups-grid');

        for (const [group, meta] of Object.entries(TOOL_GROUP_META)) {
            const row = groupGrid.createDiv('new-mode-group-row');
            const cb = row.createEl('input', { type: 'checkbox' });
            cb.checked = selectedGroups.has(group);
            cb.addEventListener('change', () => {
                if (cb.checked) selectedGroups.add(group);
                else selectedGroups.delete(group);
            });
            const label = row.createEl('label');
            label.createEl('strong', { text: meta.label });
            label.createEl('span', { text: ` — ${meta.desc}`, cls: 'modes-group-desc' });
        }

        // ── Role Definition ───────────────────────────────────────────────────
        contentEl.createEl('label', { cls: 'new-mode-field-label', text: 'Role Definition' });
        contentEl.createEl('div', { cls: 'new-mode-field-desc', text: "Define the agent's expertise and personality." });
        const roleTextarea = contentEl.createEl('textarea', {
            cls: 'new-mode-textarea',
            attr: { placeholder: "Describe the agent's identity, behavior, and focus area..." },
        });
        roleTextarea.rows = 6;
        roleTextarea.addEventListener('input', () => { roleDefinition = roleTextarea.value; });

        // ── Custom Instructions ───────────────────────────────────────────────
        contentEl.createEl('label', { cls: 'new-mode-field-label', text: 'Mode-specific Custom Instructions (optional)' });
        contentEl.createEl('div', { cls: 'new-mode-field-desc', text: 'Additional behavioral guidelines for this mode.' });
        const ciTextarea = contentEl.createEl('textarea', {
            cls: 'new-mode-textarea',
            attr: { placeholder: 'Additional guidelines...' },
        });
        ciTextarea.rows = 3;
        ciTextarea.addEventListener('input', () => { customInstructions = ciTextarea.value; });

        // ── Save Location ─────────────────────────────────────────────────────
        const locationWrap = contentEl.createDiv('new-mode-location');
        locationWrap.createEl('div', { cls: 'new-mode-field-label', text: 'Save Location' });
        locationWrap.createEl('div', { cls: 'new-mode-field-desc', text: 'Global modes are available in all your Obsidian vaults.' });
        const locGrid = locationWrap.createDiv('new-mode-loc-grid');

        for (const opt of [
            { value: 'vault' as const, label: 'This Vault', desc: 'Only in this vault' },
            { value: 'global' as const, label: 'Global', desc: 'All vaults on this machine' },
        ]) {
            const row = locGrid.createDiv('new-mode-loc-row');
            const radio = row.createEl('input', { type: 'radio', attr: { name: 'save-location', value: opt.value } });
            radio.checked = opt.value === saveLocation;
            radio.addEventListener('change', () => { if (radio.checked) saveLocation = opt.value; });
            const lbl = row.createEl('label');
            lbl.createEl('strong', { text: opt.label });
            lbl.createEl('span', { text: ` — ${opt.desc}`, cls: 'modes-group-desc' });
        }

        // ── Actions ───────────────────────────────────────────────────────────
        const actions = contentEl.createDiv('new-mode-actions');
        const saveBtn = actions.createEl('button', { text: 'Create Mode', cls: 'mod-cta' });
        saveBtn.addEventListener('click', async () => {
            if (!name.trim()) { new Notice('Name is required'); return; }
            if (!roleDefinition.trim()) { new Notice('Role definition is required'); return; }

            const allSlugs = [
                ...BUILT_IN_MODES.map((m) => m.slug),
                ...this.plugin.settings.customModes.map((m) => m.slug),
                ...(await GlobalModeStore.loadModes()).map((m) => m.slug),
            ];
            let finalSlug = slug.trim() || name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
            if (!finalSlug) finalSlug = `mode-${Date.now()}`;
            if (allSlugs.includes(finalSlug)) finalSlug = `${finalSlug}-${Date.now()}`;

            const newMode: ModeConfig = {
                slug: finalSlug,
                name: name.trim(),
                icon: icon.trim() || 'sparkles',
                description: description.trim(),
                whenToUse: whenToUse.trim() || undefined,
                roleDefinition: roleDefinition.trim(),
                customInstructions: customInstructions.trim() || undefined,
                toolGroups: Array.from(selectedGroups) as any,
                source: saveLocation,
            };

            if (saveLocation === 'global') {
                await GlobalModeStore.addMode(newMode);
                if (this.modeService) await this.modeService.reloadGlobalModes();
            } else {
                this.plugin.settings.customModes.push(newMode);
                await this.plugin.saveSettings();
            }

            if (modelKey) {
                if (!this.plugin.settings.modeModelKeys) this.plugin.settings.modeModelKeys = {};
                this.plugin.settings.modeModelKeys[finalSlug] = modelKey;
                await this.plugin.saveSettings();
            }

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

// ---------------------------------------------------------------------------
// ContentEditorModal — inline markdown editor for Skills, Workflows, Rules
// ---------------------------------------------------------------------------

class ContentEditorModal extends Modal {
    private readonly initialContent: string;
    private readonly onSave: (content: string) => void;
    private readonly modalTitle: string;

    constructor(app: App, title: string, initialContent: string, onSave: (content: string) => void) {
        super(app);
        this.modalTitle = title;
        this.initialContent = initialContent;
        this.onSave = onSave;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.addClass('content-editor-modal');
        contentEl.createEl('h3', { cls: 'content-editor-title', text: this.modalTitle });

        const textarea = contentEl.createEl('textarea', { cls: 'content-editor-textarea' });
        textarea.value = this.initialContent;
        textarea.setAttribute('rows', '20');
        textarea.setAttribute('spellcheck', 'false');

        const btnRow = contentEl.createDiv({ cls: 'content-editor-btn-row' });
        const saveBtn = btnRow.createEl('button', { text: 'Save', cls: 'mod-cta' });
        const cancelBtn = btnRow.createEl('button', { text: 'Cancel' });

        saveBtn.addEventListener('click', () => {
            this.onSave(textarea.value);
            this.close();
        });
        cancelBtn.addEventListener('click', () => this.close());

        setTimeout(() => {
            textarea.focus();
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        }, 50);
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
