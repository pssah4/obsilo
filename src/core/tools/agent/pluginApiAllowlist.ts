/**
 * Plugin API Allowlist — Built-in curated list of safe Plugin API methods (PAS-1.5)
 *
 * Tier 1 of the two-tier allowlist system.
 * Methods listed here have been manually reviewed for safety.
 * The isWrite flag is set correctly per method.
 *
 * Tier 2 (dynamic discovery) is handled by VaultDNAScanner at runtime.
 * Dynamically discovered methods are ALWAYS isWrite = true until the user
 * explicitly marks them as safe in settings.
 */

export interface AllowedApiMethod {
    pluginId: string;
    method: string;
    isWrite: boolean;
    description: string;
    /** Simple parameter schema for validation. Keys are param names, values are types. */
    paramSchema?: Record<string, 'string' | 'number' | 'boolean' | 'string[]'>;
    /** Maximum size of the JSON-stringified return value (bytes). */
    maxReturnSize: number;
}

/**
 * Methods that are ALWAYS blocked regardless of allowlist or discovery.
 * These methods can manipulate DOM, lifecycle, or execute arbitrary code.
 */
export const BLOCKED_METHODS: ReadonlySet<string> = new Set([
    'execute',
    'executeJs',
    'render',
    'register',
    'unregister',
    'onload',
    'onunload',
    'destroy',
    'eval',
]);

export const PLUGIN_API_ALLOWLIST: AllowedApiMethod[] = [
    // ── Dataview — read-only ────────────────────────────────────────────────
    {
        pluginId: 'dataview',
        method: 'query',
        isWrite: false,
        description: 'Execute a DQL query and return structured results',
        paramSchema: { source: 'string' },
        maxReturnSize: 50_000,
    },
    {
        pluginId: 'dataview',
        method: 'tryQueryMarkdown',
        isWrite: false,
        description: 'Execute a DQL query and return results as markdown',
        paramSchema: { source: 'string' },
        maxReturnSize: 50_000,
    },
    {
        pluginId: 'dataview',
        method: 'pages',
        isWrite: false,
        description: 'Get pages matching a DQL source expression',
        paramSchema: { source: 'string' },
        maxReturnSize: 50_000,
    },
    {
        pluginId: 'dataview',
        method: 'page',
        isWrite: false,
        description: 'Get metadata for a single page by path',
        paramSchema: { path: 'string' },
        maxReturnSize: 10_000,
    },

    // ── Omnisearch — read-only ──────────────────────────────────────────────
    {
        pluginId: 'omnisearch',
        method: 'search',
        isWrite: false,
        description: 'Full-text vault search via Omnisearch',
        paramSchema: { query: 'string' },
        maxReturnSize: 50_000,
    },

    // ── MetaEdit — read ─────────────────────────────────────────────────────
    {
        pluginId: 'metaedit',
        method: 'getPropertyValue',
        isWrite: false,
        description: 'Read a frontmatter property value from a file',
        paramSchema: { propertyName: 'string', file: 'string' },
        maxReturnSize: 10_000,
    },
    {
        pluginId: 'metaedit',
        method: 'getFilesWithProperty',
        isWrite: false,
        description: 'Find all files that have a specific frontmatter property',
        paramSchema: { propertyName: 'string' },
        maxReturnSize: 50_000,
    },

    // ── MetaEdit — write (requires approval) ────────────────────────────────
    {
        pluginId: 'metaedit',
        method: 'update',
        isWrite: true,
        description: 'Update a frontmatter property value in a file',
        paramSchema: { propertyName: 'string', propertyValue: 'string', file: 'string' },
        maxReturnSize: 1_000,
    },
];

/**
 * Look up a method in the built-in allowlist.
 * Returns the AllowedApiMethod if found, undefined otherwise.
 */
export function findAllowedMethod(pluginId: string, method: string): AllowedApiMethod | undefined {
    return PLUGIN_API_ALLOWLIST.find(
        (entry) => entry.pluginId === pluginId && entry.method === method,
    );
}
