import type { ProviderType } from '../../types/settings';
import { t } from '../../i18n';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Provider labels — computed at call time so t() picks up the active locale.
 */
function getProviderLabels(): Record<string, string> {
    return {
        anthropic: t('provider.anthropic'),
        openai: t('provider.openai'),
        ollama: t('provider.ollama'),
        lmstudio: t('provider.lmstudio'),
        openrouter: t('provider.openrouter'),
        azure: t('provider.azure'),
        custom: t('provider.custom'),
    };
}

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
// Grouped by provider -> vendor -> models (display label + exact API ID)
// Note: model display names are product names and stay untranslated.
const MODEL_SUGGESTIONS: Record<string, { group: string; id: string; label: string }[]> = {
    anthropic: [
        { group: 'Claude 4',   id: 'claude-opus-4-6',            label: 'Claude Opus 4.6' },
        { group: 'Claude 4',   id: 'claude-sonnet-4-5',          label: 'Claude Sonnet 4.5' },
        { group: 'Claude 4',   id: 'claude-haiku-4-5-20251001',  label: 'Claude Haiku 4.5' },
        { group: 'Claude 3.x', id: 'claude-3-7-sonnet-20250219', label: 'Claude 3.7 Sonnet' },
        { group: 'Claude 3.x', id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
        { group: 'Claude 3.x', id: 'claude-3-5-haiku-20241022',  label: 'Claude 3.5 Haiku' },
    ],
    openai: [
        { group: 'GPT-5',      id: 'gpt-5',          label: 'GPT-5' },
        { group: 'GPT-5',      id: 'gpt-5-mini',     label: 'GPT-5 mini' },
        { group: 'GPT-4.1',    id: 'gpt-4.1',        label: 'GPT-4.1' },
        { group: 'GPT-4.1',    id: 'gpt-4.1-mini',   label: 'GPT-4.1 mini' },
        { group: 'GPT-4.1',    id: 'gpt-4.1-nano',   label: 'GPT-4.1 nano' },
        { group: 'GPT-4o',     id: 'gpt-4o',         label: 'GPT-4o' },
        { group: 'GPT-4o',     id: 'gpt-4o-mini',    label: 'GPT-4o mini' },
        { group: 'Reasoning',  id: 'o3',              label: 'o3' },
        { group: 'Reasoning',  id: 'o4-mini',         label: 'o4-mini' },
        { group: 'Reasoning',  id: 'o1',              label: 'o1' },
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
function getToolLabelMap(): Record<string, { label: string; desc: string }> {
    return {
        read_file:              { label: t('tool.read_file'),              desc: t('tool.read_file.desc') },
        list_files:             { label: t('tool.list_files'),             desc: t('tool.list_files.desc') },
        search_files:           { label: t('tool.search_files'),           desc: t('tool.search_files.desc') },
        get_vault_stats:        { label: t('tool.get_vault_stats'),        desc: t('tool.get_vault_stats.desc') },
        get_frontmatter:        { label: t('tool.get_frontmatter'),        desc: t('tool.get_frontmatter.desc') },
        search_by_tag:          { label: t('tool.search_by_tag'),          desc: t('tool.search_by_tag.desc') },
        get_linked_notes:       { label: t('tool.get_linked_notes'),       desc: t('tool.get_linked_notes.desc') },
        get_daily_note:         { label: t('tool.get_daily_note'),         desc: t('tool.get_daily_note.desc') },
        open_note:              { label: t('tool.open_note'),              desc: t('tool.open_note.desc') },
        semantic_search:        { label: t('tool.semantic_search'),        desc: t('tool.semantic_search.desc') },
        query_base:             { label: t('tool.query_base'),             desc: t('tool.query_base.desc') },
        write_file:             { label: t('tool.write_file'),             desc: t('tool.write_file.desc') },
        edit_file:              { label: t('tool.edit_file'),              desc: t('tool.edit_file.desc') },
        append_to_file:         { label: t('tool.append_to_file'),         desc: t('tool.append_to_file.desc') },
        create_folder:          { label: t('tool.create_folder'),          desc: t('tool.create_folder.desc') },
        delete_file:            { label: t('tool.delete_file'),            desc: t('tool.delete_file.desc') },
        move_file:              { label: t('tool.move_file'),              desc: t('tool.move_file.desc') },
        update_frontmatter:     { label: t('tool.update_frontmatter'),     desc: t('tool.update_frontmatter.desc') },
        generate_canvas:        { label: t('tool.generate_canvas'),        desc: t('tool.generate_canvas.desc') },
        create_base:            { label: t('tool.create_base'),            desc: t('tool.create_base.desc') },
        update_base:            { label: t('tool.update_base'),            desc: t('tool.update_base.desc') },
        web_fetch:              { label: t('tool.web_fetch'),              desc: t('tool.web_fetch.desc') },
        web_search:             { label: t('tool.web_search'),             desc: t('tool.web_search.desc') },
        ask_followup_question:  { label: t('tool.ask_followup_question'),  desc: t('tool.ask_followup_question.desc') },
        attempt_completion:     { label: t('tool.attempt_completion'),     desc: t('tool.attempt_completion.desc') },
        update_todo_list:       { label: t('tool.update_todo_list'),       desc: t('tool.update_todo_list.desc') },
        new_task:               { label: t('tool.new_task'),               desc: t('tool.new_task.desc') },
        use_mcp_tool:           { label: t('tool.use_mcp_tool'),           desc: t('tool.use_mcp_tool.desc') },
    };
}

// Human-readable tool group labels and individual tool lists (for per-tool selection UI)
function getToolGroupMeta(): Record<string, { label: string; desc: string; tools: string[] }> {
    return {
        read:  {
            label: t('toolGroup.read'),
            desc: t('toolGroup.read.desc'),
            tools: ['read_file', 'list_files', 'search_files'],
        },
        vault: {
            label: t('toolGroup.vault'),
            desc: t('toolGroup.vault.desc'),
            tools: [
                'get_vault_stats', 'get_frontmatter', 'search_by_tag', 'get_linked_notes',
                'get_daily_note', 'open_note', 'semantic_search', 'query_base',
            ],
        },
        edit:  {
            label: t('toolGroup.edit'),
            desc: t('toolGroup.edit.desc'),
            tools: [
                'write_file', 'edit_file', 'append_to_file', 'create_folder',
                'delete_file', 'move_file', 'update_frontmatter',
                'generate_canvas', 'create_base', 'update_base',
            ],
        },
        web:   {
            label: t('toolGroup.web'),
            desc: t('toolGroup.web.desc'),
            tools: ['web_fetch', 'web_search'],
        },
        agent: {
            label: t('toolGroup.agent'),
            desc: t('toolGroup.agent.desc'),
            tools: ['ask_followup_question', 'attempt_completion', 'update_todo_list', 'new_task'],
        },
        mcp:   {
            label: t('toolGroup.mcp'),
            desc: t('toolGroup.mcp.desc'),
            tools: ['use_mcp_tool'],
        },
    };
}

/**
 * Lazy accessors — re-evaluated each call so translations reflect the current locale.
 * Usage sites that previously used PROVIDER_LABELS directly should use PROVIDER_LABELS instead.
 * The getter is wrapped in a Proxy for backward compatibility.
 */
const PROVIDER_LABELS: Record<string, string> = new Proxy({} as Record<string, string>, {
    get(_target, prop: string) { return getProviderLabels()[prop]; },
    ownKeys() { return Object.keys(getProviderLabels()); },
    getOwnPropertyDescriptor(_target, prop: string) {
        const labels = getProviderLabels();
        if (prop in labels) return { configurable: true, enumerable: true, value: labels[prop] };
        return undefined;
    },
});

const TOOL_LABEL_MAP: Record<string, { label: string; desc: string }> = new Proxy({} as Record<string, { label: string; desc: string }>, {
    get(_target, prop: string) { return getToolLabelMap()[prop]; },
    ownKeys() { return Object.keys(getToolLabelMap()); },
    getOwnPropertyDescriptor(_target, prop: string) {
        const map = getToolLabelMap();
        if (prop in map) return { configurable: true, enumerable: true, value: map[prop] };
        return undefined;
    },
});

const TOOL_GROUP_META: Record<string, { label: string; desc: string; tools: string[] }> = new Proxy({} as Record<string, { label: string; desc: string; tools: string[] }>, {
    get(_target, prop: string) { return getToolGroupMeta()[prop]; },
    ownKeys() { return Object.keys(getToolGroupMeta()); },
    getOwnPropertyDescriptor(_target, prop: string) {
        const map = getToolGroupMeta();
        if (prop in map) return { configurable: true, enumerable: true, value: map[prop] };
        return undefined;
    },
});

export { PROVIDER_LABELS, PROVIDER_COLORS, MODEL_SUGGESTIONS, EMBEDDING_PROVIDERS, EMBEDDING_SUGGESTIONS, TOOL_LABEL_MAP, TOOL_GROUP_META };
