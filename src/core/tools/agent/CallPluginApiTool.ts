/**
 * CallPluginApiTool — Plugin API Bridge (PAS-1.5, ADR-108)
 *
 * Calls JavaScript methods on Plugin instances directly.
 * Runs entirely in Obsidian's JS sandbox — no shell, no process spawn.
 *
 * Two-tier allowlist:
 *   Tier 1: Built-in allowlist (compile-time, curated) — pluginApiAllowlist.ts
 *   Tier 2: Dynamic discovery (VaultDNA Scanner) — always isWrite until user override
 *
 * Security:
 *   - Blocked methods: execute, executeJs, render, register, unregister, etc.
 *   - 10s timeout per call
 *   - Return value truncated to maxReturnSize
 *   - Circular references and DOM nodes filtered from return value
 */

import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';
import {
    findAllowedMethod,
    BLOCKED_METHODS,
    type AllowedApiMethod,
} from './pluginApiAllowlist';

/** Default timeout for API calls (ms) */
const API_CALL_TIMEOUT = 10_000;

/** Default max return size when not specified in allowlist */
const DEFAULT_MAX_RETURN_SIZE = 50_000;

/**
 * Custom JSON replacer that filters out non-serializable values.
 * Prevents circular references, DOM nodes, and functions from crashing JSON.stringify.
 */
function safeReplacer(): (key: string, value: unknown) => unknown {
    const seen = new WeakSet();
    return (_key: string, value: unknown): unknown => {
        if (value === null || value === undefined) return value;
        if (typeof value === 'function') return '[Function]';
        if (typeof value === 'symbol') return value.toString();
        if (typeof value === 'bigint') return value.toString();
        if (typeof value === 'object') {
            // DOM node check
            if (typeof (value as any).nodeType === 'number') return '[DOMNode]';
            // Circular reference check
            if (seen.has(value as object)) return '[Circular]';
            seen.add(value as object);
        }
        return value;
    };
}

export class CallPluginApiTool extends BaseTool<'call_plugin_api'> {
    readonly name = 'call_plugin_api' as const;
    readonly isWriteOperation = true; // Pipeline always checks — differentiates in checkApproval

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'call_plugin_api',
            description:
                'Call a JavaScript API method on an Obsidian plugin instance. ' +
                'Use this to query Dataview, search with Omnisearch, read/update frontmatter with MetaEdit, ' +
                'or interact with any plugin that exposes a JavaScript API. ' +
                'The method must be in the built-in allowlist or discovered by VaultDNA Scanner. ' +
                'Check the PLUGIN SKILLS section for available plugin APIs and their methods.',
            input_schema: {
                type: 'object',
                properties: {
                    plugin_id: {
                        type: 'string',
                        description:
                            'The plugin ID (e.g., "dataview", "omnisearch", "metaedit").',
                    },
                    method: {
                        type: 'string',
                        description:
                            'The API method name to call (e.g., "query", "search", "getPropertyValue").',
                    },
                    args: {
                        type: 'array',
                        items: {},
                        description:
                            'Arguments to pass to the method, in order. ' +
                            'For example: ["TABLE file.name FROM #project"] for dataview.query.',
                    },
                },
                required: ['plugin_id', 'method'],
            },
        };
    }

    async execute(input: Record<string, any>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const pluginId = (input.plugin_id as string ?? '').trim();
        const method = (input.method as string ?? '').trim();
        const args: unknown[] = Array.isArray(input.args) ? input.args : [];

        // 1. Validate required params
        if (!pluginId) {
            callbacks.pushToolResult(this.formatError(new Error('plugin_id is required')));
            return;
        }
        if (!method) {
            callbacks.pushToolResult(this.formatError(new Error('method is required')));
            return;
        }

        // 2. Check blocked methods
        if (BLOCKED_METHODS.has(method)) {
            callbacks.pushToolResult(
                this.formatError(new Error(`Method "${method}" is blocked for security reasons`)),
            );
            return;
        }

        // 3. Check if plugin API feature is enabled
        if (!this.plugin.settings.pluginApi?.enabled) {
            callbacks.pushToolResult(
                this.formatError(new Error('Plugin API access is disabled in settings')),
            );
            return;
        }

        // 4. Resolve plugin instance and API
        const plugins = (this.app as any).plugins?.plugins;
        if (!plugins) {
            callbacks.pushToolResult(
                this.formatError(new Error('Cannot access Obsidian plugin registry')),
            );
            return;
        }

        const pluginInstance = plugins[pluginId];
        if (!pluginInstance) {
            callbacks.pushToolResult(
                this.formatError(new Error(
                    `Plugin "${pluginId}" is not loaded. Make sure it is installed and enabled.`,
                )),
            );
            return;
        }

        // Resolve API object — try plugin.api first, then plugin itself
        const api = pluginInstance.api ?? pluginInstance;
        if (typeof api[method] !== 'function') {
            callbacks.pushToolResult(
                this.formatError(new Error(
                    `Method "${method}" not found on plugin "${pluginId}". ` +
                    `Available methods can be found in the plugin's skill file.`,
                )),
            );
            return;
        }

        // 5. Authorization: built-in allowlist or dynamic discovery
        const allowedEntry = findAllowedMethod(pluginId, method);
        let maxReturnSize = DEFAULT_MAX_RETURN_SIZE;

        if (allowedEntry) {
            // Tier 1: Built-in allowlist — use configured maxReturnSize
            maxReturnSize = allowedEntry.maxReturnSize;
        } else {
            // Tier 2: Check dynamic discovery (safeMethodOverrides in settings)
            const overrideKey = `${pluginId}:${method}`;
            const overrides = this.plugin.settings.pluginApi?.safeMethodOverrides ?? {};
            const isDynamicallyKnown = this.isDynamicallyDiscovered(pluginId, method);

            if (!isDynamicallyKnown) {
                callbacks.pushToolResult(
                    this.formatError(new Error(
                        `Method "${method}" on plugin "${pluginId}" is not in the allowlist ` +
                        `and was not discovered by VaultDNA Scanner. Access denied.`,
                    )),
                );
                return;
            }

            // Dynamic methods are allowed but will be treated as write operations
            // unless the user has marked them as safe
            // (the pipeline handles approval based on the tool group)
        }

        // 6. Execute with timeout
        try {
            const resultPromise = Promise.resolve(api[method](...args));
            const timeoutPromise = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error(`API call timed out after ${API_CALL_TIMEOUT}ms`)), API_CALL_TIMEOUT),
            );

            const result = await Promise.race([resultPromise, timeoutPromise]);

            // 7. Serialize result safely
            const serialized = JSON.stringify(result, safeReplacer(), 2) ?? 'undefined';
            const truncated = serialized.length > maxReturnSize
                ? serialized.slice(0, maxReturnSize) + `\n... [truncated, ${serialized.length} total bytes]`
                : serialized;

            callbacks.pushToolResult(
                this.formatContent(truncated, {
                    plugin: pluginId,
                    method: method,
                }),
            );
            callbacks.log(`Plugin API call: ${pluginId}.${method}(${args.length} args)`);
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('call_plugin_api', error);
        }
    }

    /**
     * Check if a method was dynamically discovered by VaultDNA Scanner.
     * Looks at the skill files in memory for API method listings.
     */
    private isDynamicallyDiscovered(pluginId: string, method: string): boolean {
        // Check if the plugin has a registered skill with API methods
        const skillRegistry = (this.plugin as any).skillRegistry;
        if (!skillRegistry) return false;

        const skill = skillRegistry.getSkill?.(pluginId);
        if (!skill) return false;

        // Skills with discovered API methods have hasApi: true and apiMethods array
        if (skill.hasApi && Array.isArray(skill.apiMethods)) {
            return skill.apiMethods.includes(method);
        }

        return false;
    }

    /**
     * Determine if this specific call is a write operation.
     * Used by the pipeline for approval decisions.
     *
     * Built-in allowlist: use the isWrite flag from the entry.
     * Dynamic discovery: always true unless user override.
     */
    isWriteCall(pluginId: string, method: string): boolean {
        const allowedEntry = findAllowedMethod(pluginId, method);
        if (allowedEntry) return allowedEntry.isWrite;

        // Dynamic: check user overrides
        const overrideKey = `${pluginId}:${method}`;
        const overrides = this.plugin.settings.pluginApi?.safeMethodOverrides ?? {};
        if (overrides[overrideKey]) return false; // User marked as safe (read)

        return true; // Default: treat as write
    }
}
