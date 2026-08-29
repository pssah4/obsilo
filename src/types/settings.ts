/**
 * Plugin Settings
 */

import type { EffortLevel } from './model-registry';
import {
    DEFAULT_CONDENSING_ENABLED,
    DEFAULT_CONDENSING_THRESHOLD,
    DEFAULT_MICROCOMPACTION_ENABLED,
    DEFAULT_ROLLING_SUMMARY_THRESHOLD,
} from '../core/condensingDefaults';

// ---------------------------------------------------------------------------
// CustomModel — single unified model entry (replaces per-provider LLMProvider)
// Adapted from Obsidian Copilot's CustomModel pattern
// ---------------------------------------------------------------------------

export type ProviderType = 'anthropic' | 'openai' | 'gemini' | 'ollama' | 'lmstudio' | 'openrouter' | 'azure' | 'custom' | 'github-copilot' | 'kilo-gateway' | 'bedrock' | 'chatgpt-oauth';

export interface CustomModel {
    /** Model identifier used in API calls (e.g. "claude-sonnet-4-5-20250929") */
    name: string;
    /** LLM provider */
    provider: ProviderType;
    /** Human-readable name shown in UI */
    displayName?: string;
    /** API key for this model (stored per-model, not per-provider) */
    apiKey?: string;
    /** Custom base URL (required for ollama/custom/azure, optional for others) */
    baseUrl?: string;
    /** Whether the model appears in the chat model selector */
    enabled: boolean;
    /** True for pre-defined models shipped with the plugin */
    isBuiltIn?: boolean;
    maxTokens?: number;
    /**
     * Provider-reported context window (tokens) from discovery, if any.
     * ADR-158 stage 1: wins over the registry chain because the serving
     * endpoint is the source of truth. Absent = registry/inference/default.
     */
    contextWindow?: number;
    temperature?: number;
    /** API version string (required for Azure OpenAI and some enterprise gateways, e.g. "2024-10-21") */
    apiVersion?: string;
    /**
     * Enable prompt caching for providers that support it.
     * Default-on at runtime via modelToLLMProvider() (undefined !== false -> true).
     * UI-visibility is gated by the provider/model capability table
     * (see src/api/capabilities.ts). IMP-18-01-01.
     */
    promptCachingEnabled?: boolean;
    /** Enable extended thinking (Anthropic only). Forces temperature to 1. */
    thinkingEnabled?: boolean;
    /** Thinking budget in tokens (used when thinkingEnabled is true, default 10000) */
    thinkingBudgetTokens?: number;
    /** Native reasoning-effort level for effort-capable models; undefined sends no effort field. */
    reasoningEffort?: EffortLevel;
    /**
     * IMP-54-05b (issue #54): per-model effort opt-in threaded down from
     * ProviderConfig.effortOptIn. True marks a model on a custom /
     * OpenAI-compatible endpoint whose effort capability the static registry
     * cannot know (e.g. GLM-5.2); resolveEffortLevels then grants the
     * OpenAI-style level set. Undefined/false keeps the registry answer.
     */
    effortOptIn?: boolean;
    /** AWS region (Bedrock only), e.g. "eu-central-1", "us-east-1" */
    awsRegion?: string;
    /** Auth mode for Bedrock: 'api-key' uses a single bearer token (new AWS Bedrock API Keys),
     * 'access-key' uses the classic IAM access key + secret key pair with SigV4 signing,
     * 'gateway' (FEAT-26-07) routes through an enterprise API-Gateway that proxies the
     * Bedrock ConverseStream API and replaces AWS-signing with a configurable header. */
    awsAuthMode?: 'api-key' | 'access-key' | 'gateway';
    /** AWS Bedrock API key (bearer token). Used when awsAuthMode === 'api-key'. */
    awsApiKey?: string;
    /** AWS IAM access key ID. Used when awsAuthMode === 'access-key'. */
    awsAccessKey?: string;
    /** AWS IAM secret access key. Used when awsAuthMode === 'access-key'. */
    awsSecretKey?: string;
    /** Optional AWS session token for temporary credentials from SSO/STS (access-key mode only) */
    awsSessionToken?: string;
    /** FEAT-26-07: header name carrying the gateway subscription key (e.g. 'Ocp-Apim-Subscription-Key').
     * Used when awsAuthMode === 'gateway' (Bedrock) or useGateway === true (Anthropic). */
    gatewayHeaderName?: string;
    /** FEAT-26-07: subscription-key value sent in `gatewayHeaderName`.
     * Treated as a credential -- encrypted at rest like the AWS credentials. */
    gatewayHeaderValue?: string;
    /** FEAT-26-07 follow-up: opt into the enterprise-gateway code path for
     * non-AWS providers (e.g. Anthropic via Azure APIM). When true, the
     * provider switches to Node-fetch (CORS bypass) and sends the configured
     * `gatewayHeaderName`/`gatewayHeaderValue` pair as the auth header. */
    useGateway?: boolean;
}

/**
 * Brand labels for provider types. Used by the settings UI and the
 * EPIC-26 migration so display names are consistently the human-readable
 * brand string, not the lowercase enum value.
 */
const PROVIDER_BRAND_LABELS: Record<ProviderType, string> = {
    anthropic:        'Anthropic',
    openai:           'OpenAI',
    gemini:           'Google Gemini',
    ollama:           'Ollama',
    lmstudio:         'LM Studio',
    openrouter:       'OpenRouter',
    azure:            'Azure OpenAI',
    'github-copilot': 'GitHub Copilot',
    'kilo-gateway':   'Kilo Gateway',
    bedrock:          'Amazon Bedrock',
    'chatgpt-oauth':  'ChatGPT (OAuth)',
    custom:           'Custom',
};

export function getProviderBrandLabel(provider: ProviderType): string {
    return PROVIDER_BRAND_LABELS[provider] ?? provider;
}

/**
 * EPIC-26 / FEAT-26-02 -- user-facing labels for the three model tiers.
 * The internal ids (`fast` / `mid` / `flagship`) stay because they are
 * keyed in settings, profiles, telemetry, and the consult_flagship tool
 * name -- renaming them would be a breaking change. Only the display
 * labels switch to a more product-y "Budget / Premium / Frontier" framing.
 */
const TIER_BADGE_LABELS: Record<'fast' | 'mid' | 'flagship', string> = {
    fast:     'Budget',
    mid:      'Main',
    flagship: 'Frontier',
};

export function getTierBadgeLabel(tier: 'fast' | 'mid' | 'flagship'): string {
    return TIER_BADGE_LABELS[tier];
}

/** Provider-level default base URLs used for setup UX and built-in models. */
export function getDefaultBaseUrlForProvider(provider: ProviderType): string | undefined {
    switch (provider) {
        case 'anthropic':
            return 'https://api.anthropic.com';
        case 'ollama':
            return 'http://localhost:11434';
        case 'lmstudio':
            return 'http://localhost:1234';
        case 'gemini':
            return 'https://generativelanguage.googleapis.com/v1beta/openai';
        default:
            return undefined;
    }
}

/** Unique key for a model across all providers */
export function getModelKey(model: CustomModel): string {
    return `${model.name}|${model.provider}`;
}

/** Return the key of the first enabled model, or '' if none */
export function getFirstEnabledModelKey(models: CustomModel[]): string {
    const first = models.find((m) => m.enabled);
    return first ? getModelKey(first) : '';
}

/** Built-in models — shown in settings by default, user can add API keys & enable */
export const BUILT_IN_MODELS: CustomModel[] = [
    // Anthropic
    {
        name: 'claude-sonnet-4-5-20250929',
        provider: 'anthropic',
        displayName: 'Claude Sonnet 4.5',
        baseUrl: getDefaultBaseUrlForProvider('anthropic'),
        enabled: false,
        isBuiltIn: true,
        thinkingEnabled: true,
        thinkingBudgetTokens: 10000,
    },
    {
        name: 'claude-opus-4-6',
        provider: 'anthropic',
        displayName: 'Claude Opus 4.6',
        baseUrl: getDefaultBaseUrlForProvider('anthropic'),
        enabled: false,
        isBuiltIn: true,
        thinkingEnabled: true,
        thinkingBudgetTokens: 10000,
    },
    {
        name: 'claude-haiku-4-5-20251001',
        provider: 'anthropic',
        displayName: 'Claude Haiku 4.5',
        baseUrl: getDefaultBaseUrlForProvider('anthropic'),
        enabled: false,
        isBuiltIn: true,
        thinkingEnabled: true,
        thinkingBudgetTokens: 5000,
    },
    // OpenAI
    {
        name: 'gpt-4o',
        provider: 'openai',
        displayName: 'GPT-4o',
        enabled: false,
        isBuiltIn: true,
    },
    {
        name: 'gpt-4o-mini',
        provider: 'openai',
        displayName: 'GPT-4o mini',
        enabled: false,
        isBuiltIn: true,
    },
    {
        name: 'gpt-4.1',
        provider: 'openai',
        displayName: 'GPT-4.1',
        enabled: false,
        isBuiltIn: true,
    },
    // Ollama (local)
    {
        name: 'llama3.2',
        provider: 'ollama',
        displayName: 'Llama 3.2 (local)',
        baseUrl: 'http://localhost:11434',
        enabled: false,
        isBuiltIn: true,
    },
    {
        name: 'qwen2.5:7b',
        provider: 'ollama',
        displayName: 'Qwen 2.5 7B (local)',
        baseUrl: 'http://localhost:11434',
        enabled: false,
        isBuiltIn: true,
    },
    // OpenRouter (API key required, base URL pre-configured)
    {
        name: 'anthropic/claude-3.5-sonnet',
        provider: 'openrouter',
        displayName: 'Claude 3.5 Sonnet',
        enabled: false,
        isBuiltIn: true,
    },
    {
        name: 'openai/gpt-4o',
        provider: 'openrouter',
        displayName: 'GPT-4o',
        enabled: false,
        isBuiltIn: true,
    },
    {
        name: 'meta-llama/llama-3.2-3b-instruct:free',
        provider: 'openrouter',
        displayName: 'Llama 3.2 3B (free)',
        enabled: false,
        isBuiltIn: true,
    },
    // Google Gemini (OpenAI-compatible endpoint)
    {
        name: 'gemini-2.5-flash',
        provider: 'gemini',
        displayName: 'Gemini 2.5 Flash',
        enabled: false,
        isBuiltIn: true,
    },
    {
        name: 'gemini-2.5-pro',
        provider: 'gemini',
        displayName: 'Gemini 2.5 Pro',
        enabled: false,
        isBuiltIn: true,
    },
    // GitHub Copilot (unofficial API — requires active Copilot subscription)
    {
        name: 'gpt-4o',
        provider: 'github-copilot',
        displayName: 'GPT-4o (Copilot)',
        enabled: false,
        isBuiltIn: true,
    },
    {
        name: 'claude-sonnet-4',
        provider: 'github-copilot',
        displayName: 'Claude Sonnet 4 (Copilot)',
        enabled: false,
        isBuiltIn: true,
    },
    // Cohere (custom provider, OpenAI compatibility endpoint -- needs a Cohere API key)
    {
        name: 'command-a-03-2025',
        provider: 'custom',
        displayName: 'Cohere Command A',
        baseUrl: 'https://api.cohere.ai/compatibility/v1',
        enabled: false,
        isBuiltIn: true,
    },
];

// ---------------------------------------------------------------------------
// LLMProvider — kept for backwards compatibility with API handler layer
// ---------------------------------------------------------------------------

export interface LLMProvider {
    type: ProviderType;
    apiKey?: string;
    /** For openrouter: pre-set to https://openrouter.ai/api/v1; for ollama: http://localhost:11434 */
    baseUrl?: string;
    model: string;
    maxTokens?: number;
    /** Provider-reported context window (tokens); see CustomModel.contextWindow (ADR-158). */
    contextWindow?: number;
    temperature?: number;
    /** API version for Azure OpenAI and compatible enterprise gateways */
    apiVersion?: string;
    /** Enable prompt caching (Anthropic only) */
    promptCachingEnabled?: boolean;
    /** Enable extended thinking (Anthropic only) */
    thinkingEnabled?: boolean;
    /** Thinking budget in tokens */
    thinkingBudgetTokens?: number;
    /** Native reasoning-effort level for effort-capable models; undefined sends no effort field. */
    reasoningEffort?: EffortLevel;
    /** IMP-54-05b: per-model effort opt-in (see CustomModel.effortOptIn). */
    effortOptIn?: boolean;
    /** AWS region (Bedrock only) */
    awsRegion?: string;
    /** Bedrock auth mode (FEAT-26-07 adds 'gateway') */
    awsAuthMode?: 'api-key' | 'access-key' | 'gateway';
    /** Bedrock API key (bearer token) */
    awsApiKey?: string;
    /** AWS access key ID (Bedrock only) */
    awsAccessKey?: string;
    /** AWS secret access key (Bedrock only) */
    awsSecretKey?: string;
    /** AWS session token (Bedrock only, optional) */
    awsSessionToken?: string;
    /** FEAT-26-07: header name for enterprise gateway auth */
    gatewayHeaderName?: string;
    /** FEAT-26-07: subscription-key value sent in `gatewayHeaderName` */
    gatewayHeaderValue?: string;
    /** FEAT-26-07: enterprise gateway opt-in for non-AWS providers. */
    useGateway?: boolean;
}

/** Convert a CustomModel to LLMProvider for the API handler layer */
export function modelToLLMProvider(model: CustomModel): LLMProvider {
    return {
        type: model.provider,
        model: model.name,
        apiKey: model.apiKey,
        baseUrl: model.baseUrl,
        maxTokens: model.maxTokens,
        contextWindow: model.contextWindow,
        temperature: model.temperature,
        apiVersion: model.apiVersion,
        // Default-on: undefined acts as true. Explicit false stays false.
        // The actual UI-visibility and provider-side cache wiring is gated by
        // src/api/capabilities.ts; this only flips the user preference default.
        promptCachingEnabled: model.promptCachingEnabled !== false,
        thinkingEnabled: model.thinkingEnabled,
        thinkingBudgetTokens: model.thinkingBudgetTokens,
        reasoningEffort: model.reasoningEffort,
        effortOptIn: model.effortOptIn,
        awsRegion: model.awsRegion,
        awsAuthMode: model.awsAuthMode,
        awsApiKey: model.awsApiKey,
        awsAccessKey: model.awsAccessKey,
        awsSecretKey: model.awsSecretKey,
        awsSessionToken: model.awsSessionToken,
        gatewayHeaderName: model.gatewayHeaderName,
        gatewayHeaderValue: model.gatewayHeaderValue,
        useGateway: model.useGateway,
    };
}

// ---------------------------------------------------------------------------
// Custom Prompts — user-defined slash-command prompt templates
// ---------------------------------------------------------------------------

export interface CustomPrompt {
    /** Unique identifier */
    id: string;
    /** Display name, e.g. "Tagesbericht" */
    name: string;
    /** Slash-command trigger, e.g. "daily-report" → /daily-report */
    slug: string;
    /** Template text — supports {{userInput}} and {{activeFile}} variables */
    content: string;
    /** Whether this prompt appears in autocomplete */
    enabled: boolean;
    /** Optional: restrict this prompt to a specific mode slug. If unset, appears in all modes. */
    mode?: string;
    /** True for prompts shipped with the plugin (cannot be deleted, only disabled) */
    isBuiltIn?: boolean;
}

// ---------------------------------------------------------------------------
// MCP Server configuration
// ---------------------------------------------------------------------------

/**
 * Persisted OAuth session for an MCP connector (FEAT-04-10, ADR-155).
 *
 * Structurally compatible with the MCP SDK's `OAuthClientInformationFull`
 * and `OAuthTokens` so McpOAuthProvider can hand these straight to the SDK
 * (and store what the SDK hands back) without importing SDK types into this
 * widely-imported settings module. The secret-bearing fields
 * (`client_secret`, `access_token`, `refresh_token`) are encrypted at rest
 * by the settings encrypt/decrypt passes and redacted from backups.
 */
export interface McpOAuthSession {
    /** Result of dynamic (or static) client registration. Cached so the flow
     *  does not re-register on every connect (DCR endpoints are rate-limited). */
    clientInformation?: {
        client_id: string;
        client_secret?: string;
        client_id_issued_at?: number;
        client_secret_expires_at?: number;
        redirect_uris?: string[];
        [k: string]: unknown;
    };
    /** OAuth tokens from the authorization-code exchange or a later refresh. */
    tokens?: {
        access_token: string;
        token_type?: string;
        expires_in?: number;
        refresh_token?: string;
        scope?: string;
        [k: string]: unknown;
    };
}

export interface McpServerConfig {
    /** Transport type. `sse` and `streamable-http` are HTTP-based remote
     *  transports. `stdio` (FEAT-04-13, ADR-168) spawns a local host process
     *  and is Desktop-only; stdio configs are persisted in the device-local
     *  store (never synced, never cross-vault) and require a per-device trust
     *  confirmation before the first spawn. */
    type: 'sse' | 'streamable-http' | 'stdio';
    url?: string;
    /** stdio only (ADR-168): the command to spawn (MVP: node / npx only,
     *  enforced by spawnAllowlist). */
    command?: string;
    /** stdio only: arguments passed to `command`. */
    args?: string[];
    /** stdio only: extra environment variables merged over the filtered
     *  spawn env allowlist. Credentials the user opts to pass explicitly. */
    env?: Record<string, string>;
    headers?: Record<string, string>;
    disabled?: boolean;
    timeout?: number;
    alwaysAllow?: string[];
    /** True for servers shipped with the plugin (cannot be deleted, only disabled) */
    isBuiltIn?: boolean;
    /** Friendly service name for the settings UI (e.g. "GitHub" instead of the
     *  reverse-DNS registry key). Set when added from the discovery search. */
    displayName?: string;
    /** Curated first-party / official trust marker, carried over from the
     *  discovery result so the source label survives the add (IMP-04-10-02). */
    official?: boolean;
    /** AUDIT-034 M-14: opt out of the SSRF guard for this server (allow loopback / RFC 1918). */
    allowLocalUrls?: boolean;
    /** Authentication scheme (FEAT-04-10, ADR-154). 'oauth' routes the connect
     *  through the SDK authProvider (browser OAuth 2.1 + PKCE). Default/undefined
     *  keeps the header/URL token behaviour. */
    authType?: 'none' | 'oauth';
    /** OAuth session state for authType 'oauth'. Populated by the flow. */
    oauth?: McpOAuthSession;
}

/**
 * Force-seeded built-in MCP servers. Empty since the hidden-catalog model
 * (IMP-04-10-02): nothing is force-added to the visible server list anymore.
 * Curated connectors -- including icons8 (free PNG icons for canvas/diagrams) --
 * live in MCP_CONNECTOR_CATALOG and are added on demand via the discovery
 * search, so every server is user-owned and deletable. Existing installs keep
 * their seeded icons8 (migration preserves touched entries); it is now
 * deletable like any other connector.
 */
export const BUILTIN_MCP_SERVERS: Record<string, McpServerConfig> = {};

// ---------------------------------------------------------------------------
// Agent Mode configuration
// ---------------------------------------------------------------------------

/** Logical tool groups — controls which tools are available in a mode */
export type ToolGroup = 'read' | 'vault' | 'edit' | 'web' | 'agent' | 'mcp' | 'skill';

export interface ModeConfig {
    /** URL-safe identifier (e.g. "researcher", "daily-writer") */
    slug: string;
    /** Display name shown in UI */
    name: string;
    /** Lucide icon name */
    icon: string;
    /** Short description shown in mode selector */
    description: string;
    /** Core role definition injected into system prompt */
    roleDefinition: string;
    /** Hint for the Orchestrator when deciding which mode to delegate to */
    whenToUse?: string;
    /** User-editable extra instructions appended after roleDefinition */
    customInstructions?: string;
    /** Which tool groups are available in this mode */
    toolGroups: ToolGroup[];
    /**
     * 'built-in'  — ships with the plugin (not user-editable)
     * 'global'    — user-created, stored in ~/.obsidian-agent/modes.json (all vaults)
     * 'vault'     — user-created, stored in this vault's plugin settings (this vault only)
     */
    source: 'built-in' | 'global' | 'vault';
}

// ---------------------------------------------------------------------------
// Auto-approval config (Sprint 1.3)
// ---------------------------------------------------------------------------

export interface AutoApprovalConfig {
    /** Master toggle: when false, all write operations require manual approval */
    enabled: boolean;
    /**
     * @deprecated FIX-44-34: dead keys removed from the surface. `read` was
     * never consulted (reads are always auto, EFFECT_POLICY.read has key:null);
     * `showMenuInChat`/`mode`/`question`/`todo` had no consumer at all. `write`
     * migrated to noteEdits + vaultChanges. Kept optional ONLY so a one-time
     * migration in loadSettings() can read and then drop a stored value.
     */
    read?: boolean;
    showMenuInChat?: boolean;
    mode?: boolean;
    question?: boolean;
    todo?: boolean;
    write?: boolean;
    /** Auto-approve note content changes (write_file, edit_file, append_to_file, update_frontmatter) */
    noteEdits: boolean;
    /** Auto-approve vault structural changes (create_folder, delete_file, move_file) */
    vaultChanges: boolean;
    /** Auto-approve web operations (web_fetch, web_search) */
    web: boolean;
    /** Auto-approve MCP tool calls */
    mcp: boolean;
    /** Auto-approve spawning subtasks (new_task) */
    subtasks: boolean;
    /** Auto-approve skills injection into context (future) */
    skills: boolean;
    /** Auto-approve plugin API read calls (built-in allowlist, isWrite=false) */
    pluginApiRead: boolean;
    /** Auto-approve plugin API write calls (built-in allowlist, isWrite=true) */
    pluginApiWrite: boolean;
    /** Auto-approve recipe execution */
    recipes: boolean;
    /** Auto-approve sandbox code execution (evaluate_expression). Off by default — high risk. */
    sandbox: boolean;
    /**
     * Content-hash grant (M-1 follow-up): persistent "always allow THIS script"
     * approvals for vault-authored sandbox scripts, keyed on the SHA-256 of the
     * exact bytes. Deliberately NOT the `sandbox` category flag: that flag never
     * covers unverified vault code (the M-1 invariant), so a per-script grant is
     * the only persistent yes on offer for user- and pro-authored skills. Absent
     * field means an empty list — no migration needed.
     */
    sandboxScriptGrants?: SandboxScriptGrant[];
}

/**
 * One persisted content-hash grant. The `key` (incl. the SHA-256) is the
 * security anchor; `skill`/`script` ride along only for the settings list and
 * targeted revoke. A grant matches exactly one byte-state of one script.
 */
export interface SandboxScriptGrant {
    /** Full grant key incl. the content hash (sandboxScriptGrant.ts). */
    key: string;
    /** Skill folder name — display and revoke only. */
    skill: string;
    /** Script name — display and revoke only. */
    script: string;
    /** ISO timestamp of when the user granted it. */
    grantedAt: string;
}

/** Legacy — kept for backwards compat */
export interface AutoApprovalRules {
    readOperations: boolean;
    writeToTempFiles: boolean;
    maxRequestsPerSession?: number;
    whitelistedPaths?: string[];
}

// ---------------------------------------------------------------------------
// Web Tools Settings (Phase 1.1)
// ---------------------------------------------------------------------------

export type WebSearchProvider = 'brave' | 'tavily' | 'none';

export interface WebToolsSettings {
    /** Master toggle — when false, web_fetch and web_search are disabled */
    enabled: boolean;
    /** Search provider (required for web_search) */
    provider: WebSearchProvider;
    /** Brave Search API key */
    braveApiKey: string;
    /** Tavily Search API key */
    tavilyApiKey: string;
}

// ---------------------------------------------------------------------------
// Advanced API Settings (Sprint 1.5)
// ---------------------------------------------------------------------------

export interface AdvancedApiSettings {
    /** Stop agent after N consecutive errors (0 = disabled) */
    consecutiveMistakeLimit: number;
    /** Minimum milliseconds between API requests (0 = no limit) */
    rateLimitMs: number;
    /**
     * IMP-41-01-02: minutes before an unanswered approval card auto-denies
     * so the loop cannot hang forever on a walked-away user (0 = never).
     */
    approvalTimeoutMinutes: number;
    /** Automatically summarize conversation when estimated tokens exceed threshold */
    condensingEnabled: boolean;
    /** Percentage of model context window at which to trigger condensing (50-95) */
    condensingThreshold: number;
    /** Inject a mode-role reminder every N iterations to keep the model on track (0 = disabled) */
    powerSteeringFrequency: number;
    /** Maximum iterations per message before the agent stops (5-50, default 25) */
    maxIterations: number;
    /** Maximum sub-agent nesting depth (1 = no grandchildren, 2 = one level of grandchildren) */
    maxSubtaskDepth: number;
    /**
     * FEAT-24-04 / ADR-113: hard per-call token budget for the `new_task`
     * message payload. If the estimated tokens (chars / 4) of the spawn
     * message exceed this number, new_task returns a tool error with ist
     * and soll so the model can trim the message and retry. Prevents a
     * subagent from starting with an already overfull request. Default 8000.
     */
    subtaskTokenBudget: number;
    /**
     * FEAT-24-02 (ADR-12 amendment): prune old tool_result contents to skeletons
     * at turn boundaries. Stops the dominant history-growth driver (accumulating
     * read/search results). Additive to condensing. Default true.
     */
    microcompactionEnabled?: boolean;
    /**
     * FEAT-24-02: fold the oldest part of the conversation into a running summary
     * once estimated tokens exceed this % of the context window — earlier and
     * gentler than full condensing (`condensingThreshold`). Effective only below
     * `condensingThreshold`. Generous default (50) so short sessions are untouched.
     */
    rollingSummaryThreshold?: number;
    /**
     * FEAT-24-05: when a running task's (would-be) API cost reaches this many
     * EUR, the cost footer in the sidebar gets a visible warning style. 0
     * disables the warning. Default 0 (disabled) -- many users find the
     * orange warning more noisy than helpful for routine work; opt-in via
     * settings/update_settings if desired.
     */
    costWarnThresholdEur?: number;
    /**
     * FEAT-24-12: USD to EUR rate the cost footer converts with. Unset (or any
     * implausible value) means the documented default in
     * core/pricing/ModelPricing, which is the single home of that number.
     *
     * A setting rather than a fetch on purpose: a background FX refresh would
     * overwrite the rate the user typed. Card and corporate rates differ from
     * mid-market anyway, so only the user knows which one their invoice uses.
     */
    usdToEurRate?: number;
    /**
     * FEAT-24-12: per-model price overrides as the user writes them, one
     * `model-id = input/output[/cacheRead/cacheWrite]` per line in USD per
     * million tokens. Parsed by ModelPricing.parsePriceOverrideText.
     *
     * Stored as text, not as a parsed map, so a typo stays visible where the
     * user can fix it. This is also where a regional rate (Bedrock EU and
     * friends) belongs: the pricing table stays region-free because the base
     * rates are disputed, and the fetched catalog structurally cannot carry a
     * region (it strips the vendor prefix from every key).
     */
    priceOverridesText?: string;
    /**
     * Telemetry opt-in: persist a 200-char preview of the user's message
     * with each task's telemetry entry (.obsidian-agent/telemetry/tasks.jsonl).
     * AUDIT-013 M-2: defaults to false because the telemetry file lives
     * inside the vault and may be synced or shared. Tokens, cost, model id
     * and tool sequence are recorded regardless of this flag.
     */
    telemetryRecordPromptPreview?: boolean;
}

// ---------------------------------------------------------------------------
// Memory Settings
// ---------------------------------------------------------------------------

export interface MemorySettings {
    /** Master toggle — when false, no memory extraction happens */
    enabled: boolean;
    /** Automatically extract session summaries when a conversation ends */
    autoExtractSessions: boolean;
    /** Model key for extraction LLM calls (picks from activeModels[]) */
    memoryModelKey: string;
    /** Minimum total messages (user + assistant) before extraction triggers */
    extractionThreshold: number;
    /**
     * Memory v2 migration state (FEATURE-0316).
     * - `not-applicable`: fresh install, never had v1 memory MDs -> Memory v2 is the only path
     * - `pending`: v1 user upgraded but has not yet decided
     * - `completed`: migration ran successfully (timestamp + counts in v2MigrationReport)
     * - `skipped`: user chose "Later" in the upgrade modal
     */
    v2MigrationStatus: 'not-applicable' | 'pending' | 'completed' | 'skipped';
    /** ISO timestamp + counts of the last successful migration run (null if never). */
    v2MigrationReport: {
        completedAt: string;
        factsInserted: number;
        stylesInserted: number;
        backupFolder: string;
    } | null;
    /**
     * Persistent state for TokenBudgetGuard (FEATURE-0318). Holds the
     * current day's running tally of input + output tokens consumed by
     * the memory pipeline. Auto-resets at midnight via guard.snapshot().
     */
    tokenBudgetState?: {
        day: string;
        inputTokens: number;
        outputTokens: number;
    } | null;

    /**
     * Hash of the last-synced CapabilityManifest (FEATURE-0319b).
     * On each plugin onload the live manifest is hashed and compared;
     * mismatch triggers a soul-snapshot rebuild (deprecate old, insert new).
     */
    lastCapabilityHash?: string | null;

    /**
     * ISO timestamp of the last AgingService run (FEATURE-0319 Phase 5).
     * Aging short-circuits when called less than 24h after this stamp,
     * so a flurry of plugin reloads doesn't repeatedly decay facts.
     */
    lastAgingRunAt?: string | null;

    /**
     * Throttle window between automatic re-extracts of the same
     * conversation (FEATURE-0319 Phase 5). Manual saves (Star button,
     * mark_for_memory tool) bypass the throttle. Default 60_000 ms.
     */
    reExtractThrottleMs?: number;

    /**
     * BA-26 / FEAT-23-04: Cross-Surface AI Workflow settings.
     * Controls Auto-Sync vs Manual-Sync per provider for MCP-saved
     * conversations. Privacy-sichere Defaults: chatgpt + perplexity
     * + unknown auf manual (Familien-Account-Use-Case).
     * Optional: missing block reads as DEFAULT_CROSS_SURFACE_SETTINGS.
     */
    crossSurface?: import('../core/memory/SourceInterface').CrossSurfaceSettings;
}

// ---------------------------------------------------------------------------
// Chat-Linking settings (ADR-022)
// ---------------------------------------------------------------------------

export interface ChatLinkingSettings {
    /** Master toggle: auto-link chats in frontmatter of edited notes + semantic titling */
    enabled: boolean;
    /** Model key for semantic title generation (picks from activeModels[]) */
    titlingModelKey: string;
    /**
     * FEAT-07-06 (Issue #72): paths that never receive a chat link.
     *
     * Folder prefixes or `/regex/` entries, matched with the same semantics as
     * Obsidian's own "Excluded files" (see matchesObsidianExcluded). Intended
     * for notes whose frontmatter carries meaning to another tool -- Templater
     * templates, Dataview-driven notes, Bases -- where an injected `chats`
     * property is actively harmful rather than merely untidy.
     *
     * This is NOT an access rule: an excluded note stays fully readable and
     * writable, it just does not get stamped. Empty by default, so existing
     * installs behave exactly as before.
     */
    excludedPaths?: string[];
}

// ---------------------------------------------------------------------------
// EPIC-26 / ADR-122: Provider-only settings schema
// ---------------------------------------------------------------------------

/** Tier slot a model is assigned to. */
export type ModelTier = 'fast' | 'mid' | 'flagship';

/** Source flag for an auto-classified DiscoveredModel.autoTier. */
export type AutoTierSource = 'pattern' | 'capability' | 'pricing' | 'manual';

/**
 * One model returned by a provider's discovery endpoint, enriched with
 * an auto-classified tier. Read-only for the user except when they
 * manually pin it to a slot via tierOverrides.
 */
export interface DiscoveredModel {
    /** Model id as returned by the provider API. */
    id: string;
    /** Optional human-readable label (provider-supplied or derived). */
    displayName?: string;
    /** Context window in tokens (if known from the provider response). */
    contextWindow?: number;
    /** Max output tokens (if known). */
    maxOutputTokens?: number;
    /** USD per 1M prompt tokens (OpenRouter pricing sonderpfad). */
    pricingPromptUsd?: number;
    /** USD per 1M completion tokens. */
    pricingCompletionUsd?: number;
    /** Auto-classified tier (set by ModelTierClassifier on refresh). */
    autoTier?: ModelTier;
    /** How the autoTier was derived (pattern / capability / pricing). */
    autoTierSource?: AutoTierSource;
}

/**
 * One configured provider instance. Different from the legacy
 * `LLMProvider` record because this is per-instance (a user can have
 * two openrouter accounts side by side), and it owns the tier
 * mapping plus the discovered-model cache.
 */
export interface ProviderConfig {
    /** Stable instance id (uuid or slug, e.g. "anthropic-main"). */
    id: string;
    /** Underlying provider type. */
    type: ProviderType;
    /** Human-readable label for the settings UI (optional). */
    displayName?: string;
    /** Master switch for the entire provider instance. */
    enabled: boolean;

    /** Auth: api-key based providers. */
    apiKey?: string;
    /** Auth: custom base URL (azure, custom, ollama, lmstudio). */
    baseUrl?: string;
    /** Auth: Azure / enterprise gateway api-version. */
    apiVersion?: string;
    /** Auth: AWS Bedrock auth mode + credentials. FEAT-26-07 adds 'gateway'. */
    awsAuthMode?: 'api-key' | 'access-key' | 'gateway';
    awsRegion?: string;
    awsApiKey?: string;
    awsAccessKey?: string;
    awsSecretKey?: string;
    awsSessionToken?: string;
    /** FEAT-26-07: enterprise gateway auth header (name + key value). */
    gatewayHeaderName?: string;
    gatewayHeaderValue?: string;
    /** FEAT-26-07: enterprise gateway opt-in for non-AWS providers. */
    useGateway?: boolean;
    /** Auth: OAuth bearer token (chatgpt-oauth, github-copilot). */
    oauthToken?: string;

    /**
     * D3: prompt-caching opt-out for this provider, per ADR-111's default-switch
     * (undefined acts as true at the wire layer).
     *
     * Lives on the provider rather than per model because the marker decision is
     * made per (provider, model) pair by the capability table anyway; what the
     * user needs is one place to shut a provider's marker path off. Before this
     * field existed, `providerConfigToCustomModel` had nothing to copy, so the
     * runtime value on this path was unconditionally undefined -> enabled, and
     * the switch in ModelConfigModal only reached the legacy `activeModels`
     * path, which is empty on a migrated install.
     */
    promptCachingEnabled?: boolean;

    /** Discovered models from the last refresh. Empty until first refresh. */
    discoveredModels: DiscoveredModel[];
    /** Epoch ms of the last successful refresh. 0 = never. */
    lastRefreshAt: number;

    /**
     * Auto-tier slot assignment: maps tier to a discovered-model id.
     * Filled by the DiscoveryService when classifying; user-readable.
     */
    tierMapping: {
        fast?: string;
        mid?: string;
        flagship?: string;
    };
    /**
     * Manual user override per tier. Wins over tierMapping.
     */
    tierOverrides: {
        fast?: string;
        mid?: string;
        flagship?: string;
    };

    /**
     * IMP-54-05b (issue #54): per-model reasoning-effort opt-in for
     * custom / OpenAI-compatible endpoints. Key = model id (discovered or
     * manually typed tier-override id), value true = the endpoint accepts
     * an OpenAI-style reasoning_effort field for this model, so the effort
     * slider is offered and the field is sent. Lives on the provider (not
     * on DiscoveredModel) so a discovery refresh, which replaces the
     * discoveredModels array wholesale, cannot wipe it, and manual ids
     * that never appear in discovery are coverable. Only honoured for
     * provider types on the OpenAI-compatible wire path
     * (see providerSupportsEffortOptIn).
     */
    effortOptIn?: Record<string, boolean>;

    /**
     * IMP-20-06-01 W4-T2 / ADR-135: per-provider Zero-Data-Retention
     * affirmation. Default undefined (treated as not-ZDR). When the
     * user flips this on, they confirm with the provider that prompts
     * and completions are NOT retained or used for training. Required
     * before the freshness verifier can escalate to the frontier tier
     * on this provider.
     */
    zdrCapable?: boolean;
}

// ---------------------------------------------------------------------------
// Main plugin settings
// ---------------------------------------------------------------------------

export interface ObsidianAgentSettings {
    /**
     * Configured LLM models. Cloud providers (anthropic, openai, openrouter, azure)
     * send vault content to external servers. For privacy-sensitive vaults, prefer
     * local providers (ollama, lmstudio).
     */
    activeModels: CustomModel[];
    activeModelKey: string;
    /**
     * FEAT-24-07 / ADR-115: optional helper-model key for agent-internal
     * LLM calls (context condensing, fast-path planner/presenter,
     * plan_presentation, recipe-promotion). Empty string means no helper
     * configured; all internal calls run on the main model. Mirrors the
     * per-feature pattern of memoryModelKey / titlingModelKey but as a
     * generic catch-all routed via getHelperApi() in src/core/helper-api.ts.
     */
    helperModelKey: string;

    // Legacy provider settings (kept for backwards compat, not used in new UI)
    defaultProvider: string;
    providers: Record<string, LLMProvider>;

    // MCP Servers
    mcpServers: Record<string, McpServerConfig>;

    // Modes
    currentMode: string;
    customModes: ModeConfig[];
    /** Per-mode model override: maps mode slug → model key. Falls back to activeModelKey if not set. */
    modeModelKeys: Record<string, string>;
    /** Instructions appended to the system prompt for ALL modes */
    globalCustomInstructions: string;
    /**
     * Permanent per-mode tool overrides: maps mode slug → explicit list of enabled tool names.
     * When set, only the listed tools are available (intersection with mode's tool groups).
     * When absent, all tools in the mode's groups are available.
     */
    modeToolOverrides: Record<string, string[]>;
    /**
     * @deprecated ADR-161 (FEAT-04-12): replaced by the per-agent
     * `modeMcpOverrides`. Kept as a GLOBAL key so vaults that have not run
     * the one-time migration yet can still read it; no consumer writes it.
     */
    activeMcpServers: string[];
    /**
     * @deprecated ADR-161 (FEAT-04-12): replaced by an empty per-agent list
     * in `modeMcpOverrides`. Kept readable for the one-time migration only.
     */
    mcpDisabled?: boolean;
    /**
     * Per-agent MCP activation (FEAT-04-12, ADR-161), vault-local: maps mode
     * slug -> explicit server-key list. ABSENT key = all connected servers
     * active for that agent (future servers auto-included); list = only
     * those; EMPTY list = none. Single source of truth in
     * src/core/mcp/mcpActivation.ts. Distinct from the deprecated
     * `modeMcpServers` on purpose so stale pre-2026-05 data cannot resurrect.
     */
    modeMcpOverrides: Record<string, string[]>;
    /**
     * @deprecated Use modeSkillAllowList instead.
     * Permanent per-mode forced skill names: maps mode slug → skill names to always inject.
     */
    forcedSkills: Record<string, string[]>;
    /**
     * @deprecated Removed 2026-05-18. Per-mode skill filtering was redundant
     * with toolGroups (a skill cannot call tools its mode lacks) and added
     * UI surface without value. Field is kept for back-compat (loaded as
     * `{}` by the migration in main.ts loadSettings) so existing data.json
     * files do not error.
     */
    modeSkillAllowList: Record<string, string[]>;
    /**
     * Permanent per-mode forced workflow slug: maps mode slug → workflow slug.
     * When set, this workflow is applied to each message (unless message starts with /).
     */
    forcedWorkflow: Record<string, string>;
    /**
     * @deprecated Removed 2026-05-18. Per-agent MCP allow-listing was
     * replaced by the global `activeMcpServers` toggle in the chat-header
     * pocket knife. Field stays for back-compat with old data.json files;
     * loadSettings clears it to `{}` on every load.
     */
    modeMcpServers: Record<string, string[]>;

    // Approval (Sprint 1.3)
    autoApproval: AutoApprovalConfig;
    /**
     * FEAT-44-07 (kill switch, part b): "Always ask (paranoid mode)". While
     * true, every effect except read/ui asks for confirmation, regardless of
     * autoApproval, presets, and run-/session-scope grants. Checked FIRST in
     * checkApproval. Deliberately a plain top-level setting and NOT an
     * autoApproval category key: it is a clamp around all categories, so it
     * must stay outside the EFFECT_POLICY/preset drift contract. Persisted so
     * the brake survives a plugin reload; default off.
     */
    paranoidMode: boolean;
    /** @deprecated use autoApproval */
    autoApprovalRules: AutoApprovalRules;

    // Advanced API (Sprint 1.5)
    advancedApi: AdvancedApiSettings;

    // Semantic Index
    enableSemanticIndex: boolean;
    embeddingModel: string; // legacy — kept for backwards compat
    embeddingModels: CustomModel[];
    activeEmbeddingModelKey: string;
    semanticBatchSize: number;
    semanticAutoIndex: 'startup' | 'mode-switch' | 'never';
    semanticExcludedFolders: string[];
    semanticIndexPdfs: boolean;
    /**
     * IMP-06-01-01: post-fix flags so the EmbeddingsTab "Reindex PDFs
     * only" CTA + the post-fix hint modal know whether they need to be
     * shown. Both default false; flipped to true by the corresponding
     * user action (modal dismiss vs. reindex complete) and persisted
     * thereafter. Two flags because "modal dismissed" does NOT mean
     * "reindex done" -- the user may have closed the modal and never
     * actually run the cleanup.
     */
    /**
     * FEAT-29-01-02 (Issue #69): the storage-layout upgrade prompt has been
     * shown once. Vault-local (see VAULT_LOCAL_KEYS): each vault has its own
     * layout, so answering in one must not silence the question in another.
     */
    _layoutUpgradePromptShown?: boolean;
    _pdfReindexHintShown: boolean;
    _pdfReindexCompleted: boolean;
    /** Chunk size in characters. Changing this invalidates and rebuilds the index. */
    semanticChunkSize: number;
    /** Contextual Retrieval: prepend LLM-generated context prefix to each chunk before embedding (ADR-051 Stufe 0). */
    enableContextualRetrieval: boolean;
    /** Model key for contextual prefix generation (picks from activeModels[]). */
    contextualModelKey: string;
    /** HyDE: generate a hypothetical document before embedding the query. Off by default (costs 1 extra LLM call per search). */
    hydeEnabled: boolean;
    /** Weighted RRF fusion: downweight the tag arm (0.6) and blend dense cosine into the final ordering. Off reproduces plain RRF. */
    weightedFusionEnabled: boolean;
    /** Auto-index vault files as they change (modify/create/delete/rename). Off by default — can slow down Obsidian if using a local embedding model. */
    semanticAutoIndexOnChange: boolean;
    /**
     * Issue #62: opt-in Ollama keep_alive for embeddings. Empty leaves Ollama's
     * own 5min default (the model stays resident in VRAM between requests). A
     * value like "0" (unload right after embedding), "30s", or "5m" routes
     * Ollama embeddings to the native /api/embed endpoint that honours it.
     * Ollama only; ignored for other embedding providers.
     */
    embeddingKeepAlive: string;

    // Graph Expansion (FEATURE-1502)
    /** Enable graph-based search expansion via Wikilinks and MOC-Properties. */
    enableGraphExpansion: boolean;
    /** Number of hops to follow in the graph (1-3). Higher = more context but slower. */
    graphExpansionHops: number;
    /** Frontmatter property names to extract as MOC edges (OKF default: moc). */
    mocPropertyNames: string[];

    // Implicit Connections (FEATURE-1503)
    /** Enable implicit connection discovery (semantically similar notes without explicit links). */
    enableImplicitConnections: boolean;
    /** Minimum cosine similarity threshold for implicit connections (0.5-0.9). */
    implicitThreshold: number;
    /** Show implicit connection suggestions in the sidebar. */
    enableSuggestionBanner: boolean;

    // Knowledge Maintenance (FEATURE-1903)
    /** Frontmatter property name that defines the note category (OKF default: "type"). */
    categoryProperty: string;
    /**
     * Frontmatter property name that holds the reciprocal backlink
     * wikilinks (OKF default: "related"). Used by the Vault Health
     * repair pass to write the reverse edge into the right key.
     * FIX-19-01-01: was hardcoded to 'Notizen' inside the repair path,
     * causing repairs to land on a different property than the
     * original edge and re-detection on the next health check.
     */
    backlinksProperty: string;
    /** Frontmatter property name for the short summary (OKF default: "description"). */
    summaryProperty: string;
    /** Naming convention for source files (default: "Author-Year_Title"). */
    sourceNamingConvention: string;

    // Synthese → Zettel (FEATURE-1904)
    /** Show "Synthese → Zettel" button on agent messages to save responses as Zettel notes. */
    enableSynthesisButton: boolean;

    // Vault Health Check (FEATURE-1901)
    /** Enable automatic vault health check on startup (orphaned notes, missing links, inconsistencies). */
    enableVaultHealthCheck: boolean;

    // Local Reranking (FEATURE-1504)
    /** Enable local cross-encoder reranking of search results (requires ~23MB model download). */
    enableReranking: boolean;
    /** Number of candidates to rerank (more = better quality but slower). */
    rerankCandidates: number;

    // MCP Server (EPIC-014)
    /**
     * AUDIT 2026-07-26 M-18: when and how each grant was made, keyed by the
     * GrantEntry id from permissionInventory.
     *
     * Consent that cannot be reviewed is not consent. A toggle that reads
     * "Note edits: on" tells the user nothing about WHO turned it on; this map
     * is what lets the permissions list say "you allowed this from a card on
     * the 14th". Best-effort: a missing entry degrades to origin `unknown`,
     * never to a wrong claim.
     */
    grantProvenance?: Record<string, { origin: 'card' | 'settings' | 'preset' | 'onboarding' | 'unknown'; at?: number }>;
    /**
     * AUDIT 2026-07-26 M-5: hosts the user allowed web_fetch to reach without
     * asking again. Per host, not per URL: a grant for one page of a site is in
     * practice a grant for the site, and pretending otherwise produces a list
     * nobody can review.
     */
    webFetchAllowedHosts?: string[];
    /**
     * AUDIT 2026-07-26 M-8: Obsidian commands the user enabled for the agent,
     * beyond the built-in allowlist.
     *
     * Entries carry the display name they had at enrolment. A command ID is not
     * a capability: `obsidian-shellcommands:shell-command-0` is an index into a
     * per-vault list, so whatever the user later puts in slot 0 would inherit
     * the enrolment without the name check.
     */
    executeCommandAllowedIds?: Array<{ id: string; name: string; at?: number }>;
    /**
     * USER 2026-07-26: built-in allowlist entries the user switched OFF.
     *
     * The built-in tier used to be a read-only catalogue, which is a poor thing
     * to put in a settings screen: it showed four rows nobody could act on. If
     * someone does not want the agent exporting PDFs, there is no reason they
     * should not be able to say so.
     */
    executeCommandDisabledBuiltIns?: string[];
    /** Enable the MCP Server for Claude Desktop/Code integration. */
    enableMcpServer: boolean;
    /** MCP-2: allow write tools (write_vault) over MCP. Default off -- external
     *  MCP clients can read by default but must be explicitly permitted to
     *  create/edit/delete vault files. */
    mcpAllowWriteTools: boolean;
    /** Enable remote relay connection for claude.ai, ChatGPT, etc. */
    enableRemoteRelay: boolean;
    /** Cloudflare relay URL (e.g. https://obsilo-relay.xxx.workers.dev). */
    relayUrl: string;
    /** Shared secret token for relay authentication. */
    relayToken: string;
    /** Auth token for local MCP server (auto-generated, encrypted via SafeStorage). */
    mcpServerToken: string;
    /** Cloudflare API token for relay deployment. Encrypted via SafeStorage. */
    cloudflareApiToken: string;
    /** Cloudflare account ID (auto-detected during deploy). */
    cloudflareAccountId: string;

    // Checkpoints (Sprint 1.4)
    enableCheckpoints: boolean;
    checkpointTimeoutSeconds: number;
    checkpointAutoCleanup: boolean;

    // Governance / file access
    /**
     * Respect Obsidian's own "Excluded files" list (Settings > Files & Links,
     * stored as app.json userIgnoreFilters) as a hard VO ignore: excluded paths
     * are kept out of the semantic index, out of search, and out of tool access.
     * Lets the user maintain exclusions in one place (Obsidian's UI).
     */
    respectObsidianExcludedFiles: boolean;

    // Web Tools (Phase 1.1)
    webTools: WebToolsSettings;

    // Chat History & Memory
    /** Enable persistent chat history (conversations saved in plugin directory) */
    enableChatHistory: boolean;
    /** Memory system settings (session extraction, long-term memory, etc.) */
    memory: MemorySettings;
    /** Chat-Linking: auto-stamp frontmatter + semantic titling (ADR-022) */
    chatLinking: ChatLinkingSettings;
    /** @deprecated — migrated to enableChatHistory. Kept for migration. */
    chatHistoryFolder: string;

    // UI
    autoAddActiveFileContext: boolean;
    /** Press Enter to send (Shift+Enter for newline). When false, Ctrl/Cmd+Enter sends. */
    sendWithEnter: boolean;
    /**
     * Add the current time-of-day to the system prompt. The calendar date is
     * always included (daily granularity, KV-cache-safe); this opt-in adds the
     * exact time, which changes every call and defeats prompt caching. Default false.
     */
    includeCurrentTimeInContext: boolean;

    // Rules (Sprint 3.2) — per-file enabled/disabled toggles
    // key: vault-relative path, value: true=enabled (default), false=disabled
    rulesToggles: Record<string, boolean>;

    // Workflows (Sprint 3.3) — per-file enabled/disabled toggles
    workflowToggles: Record<string, boolean>;

    // Manual Skills — per-path enabled/disabled toggles
    manualSkillToggles: Record<string, boolean>;

    // Custom Prompts — user-defined slash-command templates
    customPrompts: CustomPrompt[];

    // VaultDNA — Plugin-as-Skill (PAS-1)
    vaultDNA: VaultDNASettings;

    // FEAT-29-09: per-skill versioning (snapshot + restore).
    skillVersioning?: { retentionCount: number };

    // FEAT-29-12: backup/export-tool. Selective ZIP export of plugin
    // state, opt-in auto-daily backup, conflict-aware import.
    backup?: BackupSettings;

    // Plugin API (PAS-1.5)
    pluginApi: PluginApiSettings;

    // Recipes (PAS-1.5)
    recipes: RecipeSettings;

    // Agent Skill Mastery (ADR-016/017/018)
    mastery: MasterySettings;

    // Onboarding
    onboarding: OnboardingSettings;

    /**
     * FEAT-42-05: locale code the language-pack download was last offered
     * for. Prevents re-prompting on every start when the user declined.
     * Empty string means never prompted.
     */
    localePackPromptedFor?: string;

    /**
     * FEAT-33-12 follow-up (2026-06-24): open the sidebar chat
     * automatically when the plugin loads / Obsidian starts. With the
     * inline chat the sidebar is no longer needed for every session,
     * so users can disable the auto-open to keep their workspace
     * clean. Default true to preserve the historical behaviour.
     * When false, the sidebar still opens on demand via the ribbon
     * icon, the command palette, "Send to sidebar chat" from the
     * inline panel, or any deep-link.
     */
    autoOpenSidebarOnStart?: boolean;

    // Optional assets (Phase 2)
    optionalAssets?: OptionalAssetsSettings;

    // Security
    /** Sandbox execution backend: auto (Desktop=process, Mobile=iframe), process, iframe (ADR-021) */
    sandboxMode: 'auto' | 'process' | 'iframe';
    /** Whether API keys in data.json are encrypted via Electron safeStorage (ADR-019) */
    _encrypted?: boolean;
    /**
     * AUDIT-034 M-5 / M-15: persistent ack flag for the plaintext-fallback
     * warning. Set to true when the user dismisses the warning banner in
     * ProvidersTab. Suppresses the one-time toast Notice on subsequent
     * plugin loads so the user is not nagged after acknowledging. The
     * persistent banner stays visible regardless so the degraded state is
     * never hidden.
     */
    safeStoragePlaintextFallbackAcknowledged?: boolean;
    /**
     * Whether the user has dismissed the one-time Frontmatter Operator plugin
     * recommendation notice. Set to true when the user clicks "Do not show
     * again" on the recommendation toast that fires after a successful
     * update_frontmatter call while the frontmatter-operator plugin is not
     * installed or not enabled. Once dismissed, the toast never fires again.
     */
    frontmatterOperatorHintDismissed?: boolean;
    /** Whether data has been migrated to global storage (~/.obsidian-agent/) — ADR-020 */
    _globalStorageMigrated?: boolean;
    /** Whether sync data has been migrated from plugin-dir to .obsilo-sync/ */
    _syncDirMigrated?: boolean;
    /** Whether forcedWorkflow has been migrated from global storage to vault-local (FEAT-02-12, ADR-160) */
    _forcedWorkflowVaultMigrated?: boolean;
    /** Whether the global MCP activation has been migrated to per-mode modeMcpOverrides (FEAT-04-12, ADR-161) */
    _mcpPerModeMigrated?: boolean;
    /** Whether data has been migrated from ~/.obsidian-agent/ to {vault-parent}/.obsidian-agent/ (FEATURE-1508) */
    _parentDirMigrated?: boolean;
    /** Whether the legacy in-vault folders (.obsilo, .obsilo-sync, .obsidian/.obsilo) have been cleaned up. */
    _legacyVaultDirsCleaned?: boolean;
    /** Whether checkpoints/ and dev-env/ have been migrated out of the vault
     *  into the cross-vault GlobalFileService root (2026-05-19 fix for iCloud
     *  sync stalls on mobile). */
    _pluginDataDirsMigrated?: boolean;

    /**
     * FIX-19-01-12: one-shot removal of the `Inbox/Orphans/` entry from
     * `vaultHealth.orphanExcludePathPrefixes`. That prefix was a default
     * back when the orphan "auto-fix" moved notes into that folder. The
     * move never created an incoming link, so the notes stayed orphans
     * and the exclude prefix then hid exactly the notes the broken fix
     * had relocated. Both are gone now; this clears the prefix out of
     * existing data.json files. Only the exact legacy entry is dropped,
     * so a user who deliberately excludes that folder for their own
     * reasons keeps it if they re-add it after the migration ran.
     */
    _orphanExcludeLegacyCleaned?: boolean;

    /**
     * W4 (IMP-19-01-03): einmalige Uebersetzung deutscher Verdict-Literale
     * in freshness.frontierSeverityFilter ('widerspricht' -> 'contradicts'
     * usw.). Die v12-Migration uebersetzte nur die DB-Seite; ein deutsches
     * Literal in der data.json haette den Filter nach Aktivierung still
     * nie matchen lassen (FreshnessVerifier vergleicht englisch).
     */
    _freshnessVerdictLiteralsMigrated?: boolean;

    /** FEAT-29-01: layout migration progress. Resumable across plugin reloads.
     *  Phase order: pending -> backup-done -> data-vault-done -> cache-vault-done
     *  -> data-shared-done -> cache-shared-done -> skills-resolved -> cleanup-done
     *  -> settings-done -> complete. */
    _layoutMigrationStatus?:
        | 'pending'
        | 'backup-done'
        | 'data-vault-done'
        | 'cache-vault-done'
        | 'data-shared-done'
        | 'cache-shared-done'
        | 'skills-resolved'
        | 'cleanup-done'
        | 'settings-done'
        | 'complete';

    /** FEAT-29-01: snapshot of chatHistoryFolder before the setting was removed.
     *  Used by the post-migration notice modal so the user can locate their old
     *  vault-folder copy of conversations if they want to clean it up. Cleared
     *  once the notice has been acknowledged. */
    _chatHistoryFolderLegacy?: string;

    /** FEAT-29-01: opt-in flag for the layout migration. The migration is
     *  destructive (moves files across roots, removes legacy folders) and
     *  must not run silently on plugin reload until the dependent services
     *  (GlobalFileService, rulesLoader, workflowLoader, skillsManager, etc.)
     *  have been migrated to the new sub-folder layout in a follow-up commit.
     *  Default false; user must explicitly enable in Settings before the
     *  trigger in plugin.onload picks it up. */
    _layoutMigrationOptIn?: boolean;

    /** History hardening phase A3 (FIX-03-20-02): one-time persistent repair
     *  of conversations damaged by the broken drain-owner gate (full API
     *  history, thin uiMessages). Undefined/'pending' -> the boot job runs
     *  (idempotent, resumable); 'complete' -> skipped. */
    _historyRepairStatus?: 'pending' | 'complete';

    // Task Extraction (FEATURE-100, ADR-026/027/028)
    taskExtraction: import('../core/tasks/types').TaskExtractionSettings;

    // GitHub Copilot (ADR-038)
    /** GitHub OAuth access token (long-lived, encrypted via SafeStorageService) */
    githubCopilotAccessToken: string;
    /** Copilot API token (short-lived, ~1h, encrypted via SafeStorageService) */
    githubCopilotToken: string;
    /** Copilot token expiry as epoch seconds (not encrypted) */
    githubCopilotTokenExpiresAt: number;
    /** Custom OAuth Client ID — escape hatch if the default stops working */
    githubCopilotCustomClientId: string;
    /**
     * FIX-45-03-01: modelId -> what the last Copilot model list reported, e.g.
     * { 'gpt-5.6-sol': { endpoints: ['/responses'], contextWindow: 1000000 } }.
     * Copilot serves the GPT-5.6 lineup only on /responses; without the route
     * the provider sends every model to /chat/completions and gets HTTP 400.
     * The limits are kept alongside so a model entered by hand (a tier override,
     * which never passes through discovery) still runs on its real window.
     * Absent means "unknown", which keeps the pre-fix behaviour. Not a
     * credential, so it is stored in the clear.
     */
    githubCopilotModelMeta: Record<string, import('../core/security/GitHubCopilotAuthService').CopilotModelMeta>;

    // Kilo Gateway (ADR-041)
    /** Kilo session token (encrypted via SafeStorageService) */
    kiloToken: string;
    /** Auth mode used to obtain the token */
    kiloAuthMode: 'device-auth' | 'manual-token' | '';
    /** Organization ID for X-KiloCode-OrganizationId header (optional) */
    kiloOrganizationId: string;
    /** Display label from Kilo profile (not sensitive, not encrypted) */
    kiloAccountLabel: string;
    /** Epoch seconds of last successful token validation */
    kiloLastValidatedAt: number;

    // ChatGPT OAuth (EPIC-021, ADR-088, ADR-089)
    /** OAuth access token, encrypted via SafeStorageService (enc:v1:<base64>) */
    chatgptOAuthAccessToken: string;
    /** OAuth refresh token, encrypted */
    chatgptOAuthRefreshToken: string;
    /** ID token (JWT) for account info, encrypted */
    chatgptOAuthIdToken: string;
    /** chatgpt-account-id from id_token claim, sent as request header. Not encrypted. */
    chatgptOAuthAccountId: string;
    /** Email address from the id_token claim, shown in the settings UI.
     *  AUDIT 2026-07-26 (P3): encrypted at rest in BOTH persistence paths
     *  (main.ts for the vault file, GlobalSettingsService for the global one);
     *  it used to be plaintext in the global file, which is the copy that
     *  travels. */
    chatgptOAuthEmail: string;
    /** Subscription plan tier. Not encrypted. */
    chatgptOAuthPlanTier: 'plus' | 'pro' | 'unknown' | '';
    /** Unix timestamp in milliseconds when access_token expires. Not encrypted. */
    chatgptOAuthExpiresAt: number;
    /** Active model id, default 'gpt-5-codex'. */
    chatgptOAuthModel: string;
    /** Unix milliseconds when user acknowledged the third-party-endpoint disclaimer. 0 = not yet. */
    chatgptOAuthDisclaimerAcknowledgedAt: number;

    // Advanced
    debugMode: boolean;
    /**
     * Vault-relative folder for agent-managed artefacts (plugin skills,
     * vault-dna.json, externalised tmp results, future user skills).
     * Default: ".obsidian-agent". Hidden folder, ignored by Obsidian's index.
     * Existing files are NOT auto-migrated when this changes — see ADR-072.
     * FEATURE-0507 / Issue #26.
     */
    agentFolderPath?: string;

    /**
     * v2.10.0: Default folder for files the agent creates (xlsx, docx, pptx,
     * drawio, excalidraw). When a tool's output_path is just a filename
     * (no slash), the helper resolveOutputPath() prepends this folder.
     * When the model provides a path with a slash, it's used as-is.
     * Default: "Inbox/" so generated files land in a known place.
     */
    defaultOutputFolder: string;

    /**
     * v2.10.0: Auto-route simple tool tasks to the helper model.
     *
     * When enabled (and a helperModel is configured), the TaskRouter
     * classifies the first user prompt of each task via regex heuristic;
     * "simple" tasks (office-file creation, single-file read/write) run
     * on the helper model. "Complex" tasks (research, multi-step
     * synthesis) and unclassifiable prompts stay on the main model.
     *
     * The router escalates back to the main model after two consecutive
     * tool errors so a weaker model never gets stuck.
     *
     * Default: true. When the user has no helperModel set, the router
     * silently does nothing.
     */
    autoTaskRouter: {
        enabled: boolean;
    };

    /**
     * Always use the compact system-prompt variants (EPIC-26 lean cost
     * heuristics + lean plugin-skill catalogue) to save tokens. When false,
     * the lean variants are chosen by routing heuristics only.
     *
     * Default: false (current behaviour preserved).
     */
    leanSystemPrompt: boolean;

    /** BA-25: Vault-Ingest-Pflege (Note-Summary, Frontmatter, Auto-Trigger, PDF). */
    vaultIngest: VaultIngestSettings;

    /** IMP-20-06-01: FEAT-20-06 Stage 4+5 verifier settings. */
    freshness: FreshnessSettings;

    /** IMP-19-01-01: FEAT-19-01 Vault Health auto-apply rule-based repairs. */
    vaultHealth: VaultHealthSettings;

    // ----------------------------------------------------------------------
    // EPIC-26: Advisor-Pattern + Provider-only setup (ADR-120 .. ADR-123)
    // ----------------------------------------------------------------------

    /**
     * EPIC-26 / ADR-122: configured providers in the new provider-only
     * schema. Each entry is a per-instance ProviderConfig with discovered
     * models and tier mapping. PLAN-25 fills this via auto-migration from
     * `activeModels[]`. Until the migration runs (or for fresh installs
     * pre-Welle-2), the array stays empty and tier-resolution falls back
     * to `getActiveModel()`.
     *
     * Naming note: this is `providerConfigs[]` (not `providers[]`) because
     * the legacy field `providers: Record<string, LLMProvider>` already
     * owns the key (PLAN-24 F-4).
     */
    providerConfigs: ProviderConfig[];

    /**
     * EPIC-26 / ADR-122: id of the currently selected provider for the
     * main chat. null = no provider chosen yet (pre-migration state or
     * fresh install).
     */
    activeProviderId: string | null;

    /**
     * Issue #54.3: last chat-header model override per providerId. Makes the
     * pinned model sticky across restarts and new chats. A stale id (model
     * deprovisioned) falls back to Auto on restore.
     */
    lastChatModelByProvider: Record<string, string>;

    /** Issue #54.3: toggle for the sticky chat-model behavior (default on). */
    persistChatModel: boolean;

    /**
     * EPIC-26 / ADR-122: schema version for the provider-only settings
     * shape. Once a user's data.json has this version, the plugin reads
     * tier-resolution exclusively from `providerConfigs[]`. Missing or
     * older versions stay on the legacy `activeModels[]` path until the
     * Welle-2 migration runs.
     */
    schemaVersion?: string;

    /**
     * EPIC-26 / ADR-115 amendment / ADR-120: default tier for the main
     * agent loop. `'mid'` is the cost-efficient default; setting this to
     * `'flagship'` is the rollback escape hatch when the Advisor-Pattern
     * regresses real-world tasks (H-01 validation).
     */
    defaultMainModelTier?: ModelTier;

    /**
     * EPIC-26 / ADR-123: pre-migration backup of `activeModels[]` so the
     * Welle-2 auto-migration is reversible. Populated by the migration
     * step in PLAN-25; the schema only reserves the field shape here so
     * data.json stays type-stable across the upgrade window.
     */
    legacy_active_models_backup?: CustomModel[];

    /**
     * EPIC-33 / FEAT-33-01: Inline-Editor-AI-Actions settings.
     * All fields are optional with sensible defaults so existing
     * data.json stays compatible. Defaults are applied via
     * resolveInlineActionsSettings() in src/core/inline/inlineSettings.ts.
     */
    inlineActions?: InlineActionsSettings;
}

/**
 * EPIC-33: Inline-Editor-AI-Actions settings. Each Inline-Action
 * trigger UX (Floating-Menu, Hotkey, Command-Palette) and per-action
 * model-pin live here. The struct is intentionally flat so the
 * settings UI in InlineActionsTab can render every option without
 * deep nesting.
 */
export interface InlineActionsSettings {
    /** Master kill-switch. Default true. */
    enabled?: boolean;
    /** Show the inline AI selection-affordance pill on selection. Default false. Key kept for backwards-compat with pre-FEAT-33-12 data.json files. */
    floatingMenuEnabled?: boolean;
    /**
     * FEAT-33-09: Use Vault-Knowledge-RAG in Lookup. Default true.
     * A/B-test toggle for Critical Hypothesis H-07.
     */
    vaultRagInLookup?: boolean;
    /**
     * FEAT-33-09: Confidence threshold for Vault-RAG hits (0.0..1.0).
     * Hits below the threshold fall back to LLM-only lookup. Default 0.7.
     */
    vaultRagConfidenceThreshold?: number;
    // FEAT-30-07: showVaultSourcesInTooltip, skillsTopN und
    // skillCapabilities (FEAT-33-08/-33-09-Reste) entfernt. Alle drei
    // bedienten den toten Legacy-Floating-Menu-Pfad oder wurden nie
    // ausgewertet.
    /**
     * FEAT-33-12: how the inline chat is rendered in the editor.
     * - 'cm-block-widget' (default): CodeMirror block widget inserted
     *   below the selection; surrounding text pushes down. Source +
     *   live-preview only.
     * - 'popover-overlay': absolute-positioned floating panel that
     *   overlays the editor content. Works in all modes including
     *   reading view. Equivalent to the FEAT-33-05 behaviour.
     */
    inlineChatDisplay?: 'cm-block-widget' | 'popover-overlay';
}

// ---------------------------------------------------------------------------
// Vault Ingest Settings (BA-25, PLAN-10 ff)
// ---------------------------------------------------------------------------

/**
 * Settings fuer den Karpathy-Wiki-Pattern (BA-25): Note-Summary-
 * Generierung, Frontmatter-Pflege, optionaler Auto-Trigger,
 * PDF-Strategie. Alle Toggles default OFF (User-Trust per
 * ADR-95). Standard-Prompt aus BA-25 Anhang B (des Nutzers Wortlaut).
 */
export interface VaultIngestSettings {
    /** FEAT-19-08: konfigurierbarer Standard-Prompt fuer Auto-Summary. */
    summaryPrompt: {
        /** Multi-Line String. Default = des Nutzers Standard-Prompt-Wortlaut. */
        template: string;
        // FEAT-30-07: `modelOverride` entfernt. War nie implementiert
        // (kein UI, kein Read); Summary-Modell ist das Memory-Model.
    };
    /** FEAT-19-09: Auto-Generierung beim Indexing. */
    autoSummary: {
        /**
         * Erzeugt beim Indexing (Note create/modify) eine Ein-Satz-Summary
         * per LLM. Sie landet in der knowledge.db (note_summaries) und
         * speist den Top-Hub-Block -- NICHT im Note-Frontmatter. Der
         * Frontmatter-Write passiert ausschliesslich im manuellen
         * Backfill-Job, gated ueber writeFrontmatter.
         */
        enabled: boolean;
        /**
         * Consent-Gate (ADR-95, FIX-30-07-01) fuer den manuellen
         * Backfill-Job: nur bei true schreibt er die Summary als
         * Frontmatter-Property in die Note. Default false.
         */
        writeFrontmatter: boolean;
        /**
         * Ziel-Property fuer den Backfill-Write. Default ist das
         * OKF-Feld `description` (1 Satz, max 25 Woerter -- exakt das,
         * was der Summary-Generator liefert). Frueher war hier
         * `Zusammenfassung` hart verdrahtet, was nicht zum OKF-Template
         * der Ingest-Skills passte. Leer = Default.
         */
        frontmatterProperty: string;
    };
    /** FEAT-19-27 (PLAN-12, Schema additiv vorbereitet). */
    autoTrigger: {
        enabled: boolean;
        propertyName: string;
        propertyValue: string | string[];
        notification: boolean;
    };
    /** FEAT-19-29 (PLAN-13). */
    pdfStrategy: 'page-refs' | 'markdown-mirror';

    /**
     * FEAT-03-26 Top-Hub-Block im KV-Cache.
     *
     * AUDIT-014 M-2 (FIX-03-26-01): Privacy-Trade-Off ist im Settings-UI
     * explizit ausgewiesen, weil Note-Summaries der Top-30 Hubs bei
     * jeder LLM-Conversation an den Provider gehen. Default OFF.
     */
    topHubBlock: {
        enabled: boolean;
        /** User hat Privacy-Hint gelesen und bestaetigt. Toggle deaktiviert wenn false. */
        privacyAcknowledged: boolean;
    };
    /**
     * FEAT-19-04-01: selbstbildender Rueckverweis-Block in Hub-Notes.
     *
     * Ersetzt den .base-Mechanismus: ein Auto-Block (id=incoming-links) im
     * Notiz-Body listet als echte [[Wikilinks]], welche Notizen auf die Hub
     * verweisen. "Hub" ist rein datengetrieben: eine Notiz mit mindestens
     * `threshold` eingehenden Links. Sichtbar, portabel, agent-lesbar.
     */
    incomingLinksBlock: {
        /** Default false: opt-in, weil es Notiz-Bodies materialisiert. */
        enabled: boolean;
        /**
         * Ab wie vielen eingehenden Links gilt eine Notiz als Hub und bekommt
         * einen Rueckverweis-Block. Default INCOMING_LINKS_DEFAULT_THRESHOLD (10).
         * ACHTUNG: strukturelle Hub-Typen (person/topic/concept/project/
         * organisation + DE-Synonyme) ignorieren diesen Wert und bekommen
         * hartkodiert Threshold 1 (siehe hubTypeThreshold.ts, FIX-19-09-01).
         */
        threshold: number;
    };
    /**
     * FEAT-19-19: Stufe-2 Activity-Trigger.
     *
     * Bei Note-Open/Modify in einem reifen Cluster zeigt das Plugin
     * dezent eine Notice mit Klick-Trigger fuer einen Light-Web-Search-
     * Update-Pass. Default OFF damit das User-Erlebnis nicht stoert.
     */
    stufe2Hint: {
        enabled: boolean;
        /** Score-Schwelle (0..100). Default 70. Niedriger Score loest Hint aus. */
        hintThresholdScore: number;
        /** Default 30: keine Hints wenn letzter externer Check juenger. */
        minDaysSinceCheck: number;
        /** Default 7: pro-Cluster Cooldown in Tagen. */
        perClusterCooldownDays: number;
        /** Default 5: globale Hints pro Tag (Cap). */
        maxHintsPerDay: number;
    };
    /**
     * FEAT-19-20 / FIX-19-20-01: Stufe-3 Periodic-Job dediziertes Gating.
     *
     * Vor dem Audit lief Stufe-3 an `autoTrigger.enabled` mit (stuendlicher
     * Check, woechentlicher Run). Audit fand: das war Co-Trigger fuer
     * mehrere unverwandte Auto-Trigger und damit unklar dokumentiert.
     * Eigenes Flag macht die Opt-in-Semantik explizit; `lastRunIso`
     * persistiert den letzten erfolgreichen Lauf (statt nur an
     * `rolloverIfNewWeek` zu haengen, das beim Plugin-Restart neu
     * berechnet wurde).
     */
    stufe3PeriodicJob: {
        /** Default false: User muss Stufe-3-Job explizit aktivieren (kostet LLM-Tokens). */
        enabled: boolean;
        /** ISO-Timestamp des letzten erfolgreichen Runs. Leer = nie gelaufen. */
        lastRunIso: string;
    };
    /**
     * FEAT-30-07: Die vier per-Skill-Template-Pfade (ingestNoteTemplate,
     * ingestDeepNoteTemplate, meetingSummaryTemplate, quellenNotizTemplate)
     * sind entfernt. Kein Code-Pfad hat die Werte je gelesen; die
     * Ingest-Skills lesen das OKF Template hardcoded (IMP-19-31-04 dokumentiert
     * die fehlende Settings-Interpolation in Skill-Subtasks).
     */
    templates: {
        /**
         * FEAT-29-14: Sprache des materialisierten Template-Sets.
         * Wird im FirstRunWizardModal abgefragt und steuert welche
         * Variante aus `BUNDLED_NOTE_TEMPLATES` gezogen wird. Werte
         * ausserhalb von 'de'/'en' triggern LLM-Uebersetzung bei
         * der Materialisierung. Default leer = noch nicht entschieden.
         */
        templatesLanguage: string;
    };
}

/**
 * BA-25 Anhang B: des Nutzers vorgegebener Standard-Prompt-Wortlaut.
 * Bleibt 1:1 als Default in Settings hinterlegt, vom User editierbar.
 */
export const DEFAULT_SUMMARY_PROMPT_TEMPLATE = `Write a single one-sentence summary of the active note.

The output must not exceed 25 words. Return only the sentence, no explanations.
If the summary would be longer, shorten it aggressively.

Also produce 5-10 keywords in hyphenated style ("word1-word2", max two joined words). Prefer the English form for technical terms (e.g. "AI-agent" not "KI-Agent"). Mixed-language vaults: stick to the language of the note for the keywords.

Suggest 2-3 entries for "Themen" (topics) and 2-3 entries for "Konzepte" (concepts) matching the note. Search the vault first for matching existing topics and concepts; only create a new entry if none fits.`;

/**
 * AUDIT-024 L-2: single source of truth for the ingest-templates sub-shape.
 * FEAT-30-07: nur noch templatesLanguage; die vier toten Pfad-Felder sind weg.
 */
export function DEFAULT_INGEST_TEMPLATES(): VaultIngestSettings['templates'] {
    return {
        templatesLanguage: '',
    };
}

/**
 * FIX-19-09-01: eine Wahrheit fuer den Default-Threshold des Rueckverweis-Blocks.
 * Frueher standen drei widerspruechliche Zahlen im Code (Interface-Kommentar 3,
 * Default 10, Fallback `?? 5` in main.ts). 10 haelt den ersten Lauf auf die
 * klarsten Hubs begrenzt; in den Settings absenkbar (Slider min 2). Strukturelle
 * Hub-Typen ignorieren diesen Wert (hartkodiert 1, siehe hubTypeThreshold.ts).
 */
export const INCOMING_LINKS_DEFAULT_THRESHOLD = 10;

export const DEFAULT_VAULT_INGEST_SETTINGS: VaultIngestSettings = {
    summaryPrompt: {
        template: DEFAULT_SUMMARY_PROMPT_TEMPLATE,
    },
    autoSummary: {
        enabled: false,
        writeFrontmatter: false,
        frontmatterProperty: 'description',
    },
    autoTrigger: {
        enabled: false,
        // 2026-05-18: english defaults for new installs. Existing
        // installs keep whatever the user persisted; the saved
        // settings overwrite these defaults on load.
        // OKF-Template: Source-Notes tragen `type: - source`.
        // Frueher 'category'/'source', was im OKF-Schema nichts matchte.
        propertyName: 'type',
        propertyValue: 'source',
        notification: false,
    },
    pdfStrategy: 'page-refs',
    topHubBlock: {
        enabled: false,
        privacyAcknowledged: false,
    },
    incomingLinksBlock: {
        // FEAT-19-04-01: Default AN (USER-Wahl). Beim ersten Lauf bekommen alle
        // Hubs >= threshold ihren Rueckverweis-Block; strukturelle Hub-Typen
        // schon ab dem ersten Backlink (hartkodiert 1). Der Settings-Threshold
        // begrenzt den Rest auf die klarsten Hubs; in den Settings absenkbar.
        enabled: true,
        threshold: INCOMING_LINKS_DEFAULT_THRESHOLD,
    },
    templates: DEFAULT_INGEST_TEMPLATES(),
    stufe2Hint: {
        enabled: false,
        hintThresholdScore: 70,
        minDaysSinceCheck: 30,
        perClusterCooldownDays: 7,
        maxHintsPerDay: 5,
    },
    stufe3PeriodicJob: {
        enabled: false,
        lastRunIso: '',
    },
};

// ---------------------------------------------------------------------------
// Plugin API Settings (PAS-1.5, ADR-108)
// ---------------------------------------------------------------------------

export interface PluginApiSettings {
    /** Master toggle for plugin API calls (default: true — runs in JS sandbox) */
    enabled: boolean;
    /**
     * Per-method safe overrides for dynamically discovered methods.
     * Key: "pluginId:methodName", value: true = treat as read (auto-approvable).
     * Only relevant for methods NOT in the built-in allowlist.
     */
    safeMethodOverrides: Record<string, boolean>;
    /**
     * FEAT-29-07: default timeout in ms for plugin API calls. Falls back
     * to 10000 when unset. Hard-capped at 300000 (5 min) by the resolver
     * to prevent endless hangs.
     */
    defaultTimeoutMs?: number;
    /**
     * FEAT-29-07: per-plugin timeout override in ms. Wins over default
     * when set. Same 5-min hard cap.
     * Key: pluginId (e.g. "dataview"), value: timeout in ms.
     */
    pluginTimeoutMs?: Record<string, number>;
    /**
     * FEAT-29-07: when true, every successful user-approval of a Tier-2
     * (dynamically discovered) method increments approvalCounts; once
     * the threshold is reached AND the method name matches the read
     * heuristic (get/list/find/query/..), the method is promoted into
     * safeMethodOverrides so subsequent calls no longer prompt.
     */
    autoPromotionEnabled?: boolean;
    /** FEAT-29-07: number of approvals before auto-promotion. Default 3. */
    autoPromotionThreshold?: number;
    /**
     * FEAT-29-07: per-method approval counter for auto-promotion.
     * Key: "pluginId:methodName", value: integer approval count.
     */
    approvalCounts?: Record<string, number>;
}

/**
 * FEAT-29-12 Backup/Export-Tool settings.
 *   (FEAT-30-07: exportSecretsAllowed entfernt. Der Key war tot; der
 *     manuelle Export strippt Secrets hardcoded und Auto-Backups sowieso.)
 *   autoDailyEnabled -- when true, the plugin runs one selective backup
 *     per 24h on plugin boot.
 *   autoDailyTargetPath -- vault-relative folder for auto-daily ZIPs.
 *     Defaults to .vault-operator/cache/backups so it stays out of
 *     Obsidian's vault view by default.
 *   retentionCount -- keep at most N auto-daily backups; older ones are
 *     pruned on the next auto-daily run.
 *   lastAutoBackupAt -- timestamp (ms epoch) of the last successful
 *     auto-daily backup. Used to gate the 24h interval.
 */
export interface BackupSettings {
    autoDailyEnabled: boolean;
    autoDailyTargetPath: string;
    retentionCount: number;
    lastAutoBackupAt: number;
}

// ---------------------------------------------------------------------------
// IMP-20-06-01: Note-Verifier settings (FEAT-20-06 Stage 4+5)
// ---------------------------------------------------------------------------

/**
 * Settings for the note-level claim-check pipeline. All defaults are
 * privacy-conservative per ADR-135 and the IMP body:
 * - `writeFrontmatter` is off so the vault stays clean by default
 * - `externalSources.enabled` is off so no third-party search runs in the
 *   background without explicit opt-in
 * - `allowFrontierEscalation` is off so verdicts stay mid-tier-only
 *   until the user actively turns it on AND the provider exposes ZDR
 */
export interface FreshnessSettings {
    writeFrontmatter: boolean;
    externalSources: {
        enabled: boolean;
    };
    allowFrontierEscalation: boolean;
    frontierConfidenceThreshold: number;
    frontierSeverityFilter: ('matches' | 'extends' | 'contradicts' | 'outdated' | 'no_external_source')[];
    excludePaths: string[];
    /**
     * FEAT-19-03-01: der Scan deckt den GANZEN Vault alterungsgesteuert ab
     * (keine manuelle Hot-Auswahl mehr). Diese Cluster werden NIE extern
     * geprueft -- das Opt-out anstelle des frueheren Opt-in.
     */
    excludeClusters: string[];
    /**
     * FEAT-19-03-01: Wochenbudget in USD, editierbar. Deckelt den
     * vault-weiten Lauf; hoeher = der Kaltstart-Rueckstand (nie geprueft)
     * ist schneller aufgeholt. Wird per Live-Getter gelesen (ADR-163),
     * damit eine Aenderung sofort greift.
     */
    weeklyBudgetUsd: number;
    /**
     * FIX-19-16-08: nach jedem Stufe-3-Lauf eine kompakte Markdown-Notiz
     * in den sichtbaren Vault schreiben (VaultHealth/Freshness-Report.md,
     * ueberschreibend). Vorher lebten die Ergebnisse nur in einem Modal-Tab
     * (auf Mobile aus), einer 6-Sekunden-Notice und console.debug. Auch ein
     * Lauf ohne Findings schreibt: "keine Findings, geprueft am" und "nie
     * geprueft" sind verschiedene Aussagen. Default an; optional, weil es
     * eine Datei im Nutzer-Vault ist.
     */
    writeReport?: boolean;
}

export const DEFAULT_FRESHNESS_SETTINGS: FreshnessSettings = {
    writeFrontmatter: false,
    externalSources: { enabled: false },
    allowFrontierEscalation: false,
    frontierConfidenceThreshold: 0.7,
    frontierSeverityFilter: ['contradicts', 'outdated'],
    excludePaths: ['Private/', 'Personal/', 'Medical/', 'Clients/'],
    excludeClusters: [],
    weeklyBudgetUsd: 2.0,
    writeReport: true,
};

// ---------------------------------------------------------------------------
// IMP-19-01-01: Vault Health auto-apply for deterministic rule-based repairs.
// ---------------------------------------------------------------------------

export interface VaultHealthSettings {
    /**
     * IMP-19-01-01 AC-05. When true, opening the Vault Health modal
     * via the sidebar badge auto-runs `runRepair()` over the three
     * deterministic rule checks (missing_backlinks, category_mismatch,
     * inconsistent_tags) before the modal renders. Findings that need
     * a real decision still surface in the modal as before. Default
     * off so existing users see no behaviour change until they opt in.
     */

    /**
     * FIX-19-01-05: silently drop the `with_context` orphan branch
     * when true. A `with_context` orphan is a note that has outgoing
     * MOC-property edges (Themen, Konzepte, ...) but no incoming
     * wikilink. Users who use embedded Bases in the hub notes (which
     * surface every note that points to the hub) do NOT need a
     * Findings entry telling them to add a reciprocal backlink — the
     * Base IS the backlink. Default true so the modal stays quiet
     * for that workflow; users who rely on property-reciprocity can
     * flip this off.
     */
    silenceWithContextOrphans: boolean;

    /**
     * FIX-19-01-05: extra path-prefix patterns to exclude from the
     * orphan check. The hardcoded excludes are Templates, Daily
     * Notes, Attachements (typo intentional, matches the user's
     * existing folder). This setting layers user-specific
     * exclusions on top — e.g. TaskNotes/ for the TaskNotes plugin,
     * or any folder that holds notes which intentionally do not
     * participate in the knowledge graph.
     */
    orphanExcludePathPrefixes: string[];

    /**
     * FIX-19-99-02 (cross-property reciprocity): pairs of frontmatter
     * properties that count as semantically equivalent backlink
     * relationships even though they have different names. Example:
     * `[['Notizen', 'Quellen']]` declares that a `Quelle.Notizen ->
     * Konzept` edge is satisfied when the `Konzept` has a reverse edge
     * under either `Notizen` OR `Quellen` pointing back at the source.
     *
     * Default `[['Notizen', 'Quellen']]` reflects the common
     * source-note-to-concept-note pattern (Quelle erwaehnt Konzept via
     * `Notizen:`, Konzept zitiert Quelle via `Quellen:`). Set to `[]`
     * to enforce strict same-property reciprocity.
     */
    reciprocalProperties: Array<[string, string]>;
}

export const DEFAULT_VAULT_HEALTH_SETTINGS: VaultHealthSettings = {
    silenceWithContextOrphans: true,
    orphanExcludePathPrefixes: ['TaskNotes/'],
    reciprocalProperties: [['Notizen', 'Quellen']],
};

// ---------------------------------------------------------------------------
// Visual Intelligence Settings (FEATURE-1115)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Recipe Settings (PAS-1.5, ADR-109)
// ---------------------------------------------------------------------------

export interface RecipeSettings {
    /** Master toggle, default true. User-Abwahl persistiert (FIX-30-07-02: kein Boot-Force-Enable mehr). */
    enabled: boolean;
    /** Per-recipe toggle: maps recipe id → boolean. Missing = enabled by default. */
    recipeToggles: Record<string, boolean>;
    /** User-defined custom recipes (validated on load) */
    /**
     * FEAT-30-07: persistierte Form (pattern als String, JSON-sicher).
     * Laufzeitform via materializeCustomRecipes; Validierung load-time
     * (validateStoredRecipe) und beim Speichern im Recipe-Editor.
     */
    customRecipes: import('../core/tools/agent/recipeRegistry').StoredRecipe[];
}

// ---------------------------------------------------------------------------
// Onboarding Settings
// ---------------------------------------------------------------------------

export type OnboardingStep = 'backup' | 'profile' | 'model' | 'permissions' | 'memory' | 'done';

export interface OnboardingSettings {
    /** true when setup has been fully completed */
    completed: boolean;
    /** Current step in the setup flow */
    currentStep: OnboardingStep;
    /** Steps the user chose to skip */
    skippedSteps: OnboardingStep[];
    /** ISO timestamp when setup was started */
    startedAt: string;
    /** Phase 2: how many times the first-run modal has been auto-opened
     *  (capped at 3 by the auto-open logic). Default 0. */
    firstRunModalShownCount?: number;
    /** Phase 2: user clicked "Don't show again" -- modal will not auto-open. */
    dontShowFirstRunAgain?: boolean;
    /** Phase 2: true after the wizard's final step finished. Distinct from
     *  `completed`, which is reserved for the post-modal Memory + Soul fill. */
    modalCompleted?: boolean;
}

// ---------------------------------------------------------------------------
// Optional Asset Settings (Phase 2 -- main.js diet)
// ---------------------------------------------------------------------------

/**
 * Status of each optional asset the user can choose to install. Assets
 * live in `<vault>/.vault-operator/assets/`; the plugin never writes to
 * its own pluginDir. Each entry tracks installed version + SHA256 so the
 * plugin can detect when a newer release ships a fresh binary.
 */
export interface OptionalAssetState {
    /** Version stamp of the installed asset (matches the plugin release tag). */
    installedVersion?: string;
    /** SHA256 of the installed asset, verified at install time. */
    sha256?: string;
    /** ISO timestamp of last successful install. */
    installedAt?: string;
}

export interface OptionalAssetsSettings {
    /** Semantic Reranker -- ONNX cross-encoder model (~12 MB). */
    reranker: OptionalAssetState;
    /** Self-Development source bundle (~5 MB) -- enables manage_source tool. */
    selfDevelopmentSource: OptionalAssetState;
}

// ---------------------------------------------------------------------------
// Mastery Settings (ADR-016/017/018 — Agent Skill Mastery)
// ---------------------------------------------------------------------------

export interface MasterySettings {
    /** Master toggle for the procedural recipe system */
    enabled: boolean;
    /** Maximum chars for recipe section in system prompt (default: 2000) */
    recipeBudget: number;
    /** Enable learned recipes from episodic memory */
    learnedRecipesEnabled: boolean;
    /** Per-recipe toggle: maps recipe id -> boolean. Missing = enabled by default. */
    recipeToggles: Record<string, boolean>;
}

// ---------------------------------------------------------------------------
// VaultDNA Settings (PAS-1)
// ---------------------------------------------------------------------------

export interface VaultDNASettings {
    /** Master toggle for plugin-as-skill discovery */
    enabled: boolean;
    /** Per-plugin agent-side toggle: maps plugin-id -> boolean (default: true) */
    skillToggles: Record<string, boolean>;
    /** ISO timestamp of last full scan */
    lastScanAt: string;
}

/**
 * OKF frontmatter vocabulary (FIX-42-01-01). These property names are vault
 * schema, not UI language: they follow the OKF standard the vault templates
 * use (title, description, resource, tags, type, moc, related, timestamp,
 * uid; see the PdfMarkdownMirror skeleton). Single source of truth for every
 * graph-expansion fallback; persisted user settings always win.
 * sourceNamingConvention is not OKF-defined, it is just the English default.
 */
export const OKF_DEFAULTS = {
    mocPropertyNames: ['moc'],
    categoryProperty: 'type',
    backlinksProperty: 'related',
    summaryProperty: 'description',
    sourceNamingConvention: 'Author-Year_Title',
} as const;

export const DEFAULT_SETTINGS: ObsidianAgentSettings = {
    activeModels: [],
    activeModelKey: '',
    helperModelKey: '',           // FEAT-24-07 / ADR-115

    defaultProvider: 'anthropic',
    providers: {},

    mcpServers: {},
    currentMode: 'agent',
    customModes: [],
    modeModelKeys: {},
    globalCustomInstructions: '',
    modeToolOverrides: {},
    activeMcpServers: [],
    forcedSkills: {},
    modeSkillAllowList: {},
    forcedWorkflow: {},
    modeMcpServers: {},
    modeMcpOverrides: {},

    autoApproval: {
        // FIX-44-34: read/showMenuInChat/mode/question/todo removed -- they had
        // no consumer. Reads are always auto (EFFECT_POLICY.read, key:null).
        enabled: false,
        noteEdits: false,
        vaultChanges: false,
        web: false,
        mcp: false,
        subtasks: false,
        skills: false,
        pluginApiRead: true,
        pluginApiWrite: false,
        recipes: false,
        sandbox: false,
    },
    paranoidMode: false,
    autoApprovalRules: {
        readOperations: true,
        writeToTempFiles: false,
        maxRequestsPerSession: undefined,
        whitelistedPaths: [],
    },

    advancedApi: {
        consecutiveMistakeLimit: 3,
        rateLimitMs: 0,
        approvalTimeoutMinutes: 10,         // IMP-41-01-02
        // FIX-COMPACT-03: route DEFAULT_SETTINGS through the shared
        // condensing-defaults module (Runner + Sidebar use the same).
        condensingEnabled: DEFAULT_CONDENSING_ENABLED,
        condensingThreshold: DEFAULT_CONDENSING_THRESHOLD,
        powerSteeringFrequency: 0,
        maxIterations: 25,
        maxSubtaskDepth: 2,
        subtaskTokenBudget: 8000,           // FEAT-24-04 / ADR-113
        microcompactionEnabled: DEFAULT_MICROCOMPACTION_ENABLED,       // FEAT-24-02
        rollingSummaryThreshold: DEFAULT_ROLLING_SUMMARY_THRESHOLD,    // FEAT-24-02
        costWarnThresholdEur: 0,            // FEAT-24-05 -- default disabled; opt-in
        telemetryRecordPromptPreview: false, // AUDIT-013 M-2: opt-in
    },

    enableSemanticIndex: false,
    embeddingModel: '',
    embeddingModels: [],
    activeEmbeddingModelKey: '',
    semanticBatchSize: 20,
    semanticAutoIndex: 'never',
    semanticExcludedFolders: [],
    semanticIndexPdfs: false,
    _layoutUpgradePromptShown: false,
    _pdfReindexHintShown: false,
    _pdfReindexCompleted: false,
    semanticChunkSize: 2000,
    enableContextualRetrieval: true,
    contextualModelKey: '',
    hydeEnabled: false,
    weightedFusionEnabled: true,
    semanticAutoIndexOnChange: false,
    embeddingKeepAlive: '',
    enableGraphExpansion: true,
    graphExpansionHops: 1,
    mocPropertyNames: [...OKF_DEFAULTS.mocPropertyNames],
    enableImplicitConnections: true,
    implicitThreshold: 0.7,
    enableSuggestionBanner: true,
    categoryProperty: OKF_DEFAULTS.categoryProperty,
    backlinksProperty: OKF_DEFAULTS.backlinksProperty,
    summaryProperty: OKF_DEFAULTS.summaryProperty,
    sourceNamingConvention: OKF_DEFAULTS.sourceNamingConvention,
    enableSynthesisButton: true,
    enableVaultHealthCheck: true,
    enableReranking: true,
    rerankCandidates: 20,
    grantProvenance: {},
    executeCommandAllowedIds: [],
    executeCommandDisabledBuiltIns: [],
    webFetchAllowedHosts: [],
    enableMcpServer: false,
    mcpAllowWriteTools: false,
    enableRemoteRelay: false,
    relayUrl: '',
    relayToken: '',
    mcpServerToken: '',
    cloudflareApiToken: '',
    cloudflareAccountId: '',

    enableCheckpoints: true,
    checkpointTimeoutSeconds: 30,
    checkpointAutoCleanup: true,

    respectObsidianExcludedFiles: true,

    webTools: {
        enabled: false,
        provider: 'none',
        braveApiKey: '',
        tavilyApiKey: '',
    },

    enableChatHistory: true,
    memory: {
        enabled: true,
        autoExtractSessions: true,
        memoryModelKey: '',
        extractionThreshold: 6,
        // Default for FRESH installs. Existing v1 users get bumped to 'pending'
        // by the detector in main.ts when memory/{file}.md is found and no
        // facts row exists yet. See `detectMemoryV2MigrationStatus`.
        v2MigrationStatus: 'not-applicable',
        v2MigrationReport: null,
        // BA-26 / FEAT-23-04: privacy-sichere Defaults fuer Cross-Surface MCP.
        // chatgpt + perplexity stehen auf manual, weil sie haeufig in
        // Familien-Accounts genutzt werden (user use case).
        crossSurface: {
            defaultSyncMode: 'auto',
            perProvider: {
                'obsilo': 'global',
                'claude-ai': 'global',
                'claude-code': 'global',
                'chatgpt': 'manual',
                'perplexity': 'manual',
                'unknown': 'manual',
            },
            // FIX-23-01-01: Living-Document-Default. true = Auto-Continuation.
            livingDocumentByDefault: true,
            // AUDIT-015 M-3: Cross-Source-ACL. Default OFF -- der Nutzer
            // kann das ON setzen wenn ChatGPT/Perplexity strikt von
            // claude-ai/claude-code getrennt sein muessen.
            strictSourceIsolation: false,
        },
    },
    chatLinking: {
        enabled: true,
        titlingModelKey: '',
        excludedPaths: [],
    },
    chatHistoryFolder: '',

    autoAddActiveFileContext: true,
    sendWithEnter: true,
    lastChatModelByProvider: {},
    persistChatModel: true,
    includeCurrentTimeInContext: false, // ADR-62 amendment: date is always present; time-of-day is opt-in (defeats caching)
    rulesToggles: {},
    workflowToggles: {},
    manualSkillToggles: {},
    customPrompts: [],
    vaultDNA: {
        enabled: true,
        skillToggles: {},
        lastScanAt: '',
    },
    skillVersioning: { retentionCount: 20 },
    backup: {
        autoDailyEnabled: false,
        autoDailyTargetPath: '.vault-operator/cache/backups',
        retentionCount: 7,
        lastAutoBackupAt: 0,
    },
    pluginApi: {
        enabled: true,
        safeMethodOverrides: {},
        defaultTimeoutMs: 10_000,
        pluginTimeoutMs: {},
        autoPromotionEnabled: true,
        autoPromotionThreshold: 3,
        approvalCounts: {},
    },
    recipes: {
        enabled: true,
        recipeToggles: {},
        customRecipes: [],
    },
    mastery: {
        enabled: true,
        recipeBudget: 2000,
        learnedRecipesEnabled: true,
        recipeToggles: {},
    },
    onboarding: {
        completed: false,
        currentStep: 'backup',
        skippedSteps: [],
        startedAt: '',
        firstRunModalShownCount: 0,
        dontShowFirstRunAgain: false,
        modalCompleted: false,
    },
    optionalAssets: {
        reranker: {},
        selfDevelopmentSource: {},
    },
    sandboxMode: 'auto',
    safeStoragePlaintextFallbackAcknowledged: false,
    frontmatterOperatorHintDismissed: false,
    taskExtraction: {
        enabled: true,
        taskFolder: 'Tasks',
        preferTaskNotesPlugin: true,
        taskNotesHintDismissed: false,
    },
    githubCopilotAccessToken: '',
    githubCopilotToken: '',
    githubCopilotTokenExpiresAt: 0,
    githubCopilotCustomClientId: '',
    githubCopilotModelMeta: {},
    kiloToken: '',
    kiloAuthMode: '',
    kiloOrganizationId: '',
    kiloAccountLabel: '',
    kiloLastValidatedAt: 0,
    chatgptOAuthAccessToken: '',
    chatgptOAuthRefreshToken: '',
    chatgptOAuthIdToken: '',
    chatgptOAuthAccountId: '',
    chatgptOAuthEmail: '',
    chatgptOAuthPlanTier: '',
    chatgptOAuthExpiresAt: 0,
    chatgptOAuthModel: 'gpt-5-codex',
    chatgptOAuthDisclaimerAcknowledgedAt: 0,
    debugMode: false,
    agentFolderPath: '.vault-operator',
    defaultOutputFolder: 'Inbox/',
    autoTaskRouter: { enabled: true },
    leanSystemPrompt: false,
    vaultIngest: DEFAULT_VAULT_INGEST_SETTINGS,
    freshness: DEFAULT_FRESHNESS_SETTINGS,
    vaultHealth: DEFAULT_VAULT_HEALTH_SETTINGS,

    // EPIC-26 / ADR-122: provider-only setup. Pre-migration defaults
    // (PLAN-25 will fill providerConfigs + flip schemaVersion).
    providerConfigs: [],
    activeProviderId: null,
    defaultMainModelTier: 'mid',
    // schemaVersion intentionally undefined — only the Welle-2 migration sets it.
};
