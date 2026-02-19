import type { ProviderType } from '../../types/settings';

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

export { PROVIDER_LABELS, PROVIDER_COLORS, MODEL_SUGGESTIONS, EMBEDDING_PROVIDERS, EMBEDDING_SUGGESTIONS, TOOL_LABEL_MAP, TOOL_GROUP_META };
