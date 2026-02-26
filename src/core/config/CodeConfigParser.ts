/**
 * CodeConfigParser — Extract model configuration from API code snippets.
 *
 * Pure parsing logic with zero UI/Obsidian dependencies.
 * Supports Python, JavaScript/TypeScript, and curl snippets.
 *
 * Usage:
 *   const result = parseCodeSnippet(pastedCode);
 *   // result.provider, result.baseUrl, result.apiVersion, result.modelNames
 */

import type { ProviderType } from '../../types/settings';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ParsedCodeConfig {
    /** Detected LLM provider, or undefined if unknown */
    provider?: ProviderType;
    /** Extracted base URL (trailing slash stripped) */
    baseUrl?: string;
    /** API version string (e.g., "2024-10-21") */
    apiVersion?: string;
    /** Extracted API key (only if a literal value, not an env var) */
    apiKey?: string;
    /** True when the snippet references an env var for the key */
    apiKeyIsEnvVar: boolean;
    /** All model names found (deduplicated, order preserved) */
    modelNames: string[];
    /** Which snippet format was detected */
    detectedFormat: 'python' | 'javascript' | 'curl' | 'unknown';
    /** Human-readable warnings for partial/ambiguous results */
    warnings: string[];
}

// ---------------------------------------------------------------------------
// Env-var detection
// ---------------------------------------------------------------------------

const ENV_VAR_PATTERNS = [
    /os\.environ/,
    /os\.getenv\s*\(/,
    /process\.env\./,
    /\$\{?\w+\}?/,
    /getenv\s*\(/,
];

function isEnvVarReference(value: string): boolean {
    return ENV_VAR_PATTERNS.some((p) => p.test(value));
}

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

function detectFormat(code: string): ParsedCodeConfig['detectedFormat'] {
    if (/^\s*curl\s/m.test(code)) return 'curl';
    if (
        /(?:import\s+openai|from\s+(?:openai|anthropic)|openai\.(?:Azure)?OpenAI|Anthropic\s*\()/.test(
            code,
        )
    )
        return 'python';
    if (
        /(?:new\s+(?:OpenAI|AzureOpenAI|Anthropic)|require\s*\(\s*['"]openai|import\s+.*from\s+['"]openai)/.test(
            code,
        )
    )
        return 'javascript';
    return 'unknown';
}

// ---------------------------------------------------------------------------
// Provider detection
// ---------------------------------------------------------------------------

const PYTHON_PROVIDERS: { pattern: RegExp; provider: ProviderType }[] = [
    { pattern: /openai\.AzureOpenAI/, provider: 'azure' },
    { pattern: /AzureOpenAI\s*\(/, provider: 'azure' },
    { pattern: /openai\.OpenAI/, provider: 'openai' },
    { pattern: /Anthropic\s*\(/, provider: 'anthropic' },
];

const JS_PROVIDERS: { pattern: RegExp; provider: ProviderType }[] = [
    { pattern: /new\s+AzureOpenAI/, provider: 'azure' },
    { pattern: /new\s+OpenAI/, provider: 'openai' },
    { pattern: /new\s+Anthropic/, provider: 'anthropic' },
];

function detectProviderPython(code: string): ProviderType | undefined {
    for (const { pattern, provider } of PYTHON_PROVIDERS) {
        if (pattern.test(code)) return provider;
    }
    return undefined;
}

function detectProviderJS(code: string): ProviderType | undefined {
    for (const { pattern, provider } of JS_PROVIDERS) {
        if (pattern.test(code)) return provider;
    }
    return undefined;
}

function detectProviderCurl(code: string): ProviderType | undefined {
    // URL-path-based detection (most specific — enterprise gateways, Bedrock proxies)
    // These are intentionally substring matches within multi-line curl commands, not URL validators.
    if (/\/anthropic\/model\//i.test(code) || /anthropic\.claude/i.test(code)) return 'anthropic';
    if (/\bapi\.anthropic\.com\b/i.test(code)) return 'anthropic'; // lgtm[js/regex-missing-anchor]
    // Azure-specific domain or URL path patterns
    if (/\bopenai\.azure\.com\b/i.test(code)) return 'azure'; // lgtm[js/regex-missing-anchor]
    if (/\/openai\/deployments\//i.test(code)) return 'azure';
    if (/\bapi\.openai\.com\b/i.test(code)) return 'openai'; // lgtm[js/regex-missing-anchor]
    if (/openrouter\.ai/i.test(code)) return 'openrouter';
    // Header-based fallback — api-key header alone is NOT enough for Azure
    // (enterprise gateways also use api-key headers). Require Azure-specific URL pattern.
    if (/api-key\s*:/i.test(code) && /azure/i.test(code)) return 'azure';
    return undefined;
}

// ---------------------------------------------------------------------------
// Base URL normalization
// ---------------------------------------------------------------------------

function normalizeBaseUrl(url: string, provider?: ProviderType): string {
    let result = url.replace(/\/+$/, '');

    // Azure: trim path after /openai
    if (provider === 'azure') {
        const idx = result.indexOf('/openai');
        if (idx !== -1) result = result.substring(0, idx + '/openai'.length);
    }

    // Bedrock-style gateways: /anthropic/model/{id}/converse → strip to gateway root
    result = result.replace(
        /\/(anthropic|bedrock|openai)\/model\/[^/]+\/(converse|invoke)(\/.*)?$/,
        '',
    );

    // Strip known API path suffixes (for curl URLs)
    result = result.replace(
        /\/(chat\/completions|completions|v1\/messages|v1\/chat\/completions|embeddings)(\/.*)?$/,
        '',
    );

    return result;
}

// ---------------------------------------------------------------------------
// Model name collection
// ---------------------------------------------------------------------------

function collectModels(matches: RegExpMatchArray[] | string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const raw of matches) {
        const name = (typeof raw === 'string' ? raw : raw[1] ?? raw[0]).trim();
        if (name && !seen.has(name)) {
            seen.add(name);
            result.push(name);
        }
    }
    return result;
}

// ---------------------------------------------------------------------------
// Format-specific extractors
// ---------------------------------------------------------------------------

function extractPython(code: string, r: ParsedCodeConfig): void {
    r.provider = detectProviderPython(code);

    // base_url
    const baseUrlMatch = code.match(/base_url\s*=\s*["']([^"']+)["']/);
    if (baseUrlMatch) r.baseUrl = normalizeBaseUrl(baseUrlMatch[1], r.provider);

    // api_key
    const apiKeyMatch = code.match(/api_key\s*=\s*(?:["']([^"']+)["']|([^,\s)]+))/);
    if (apiKeyMatch) {
        const val = apiKeyMatch[1] ?? apiKeyMatch[2] ?? '';
        if (isEnvVarReference(val)) {
            r.apiKeyIsEnvVar = true;
        } else if (val) {
            r.apiKey = val;
        }
    }

    // api_version
    const versionMatch = code.match(/api_version\s*=\s*["']([^"']+)["']/);
    if (versionMatch) r.apiVersion = versionMatch[1];

    // models — from .create(model="...")
    const modelMatches = [...code.matchAll(/\.create\s*\([^)]*model\s*=\s*["']([^"']+)["']/g)];
    r.modelNames = collectModels(modelMatches.map((m) => m[1]));
}

function extractJavaScript(code: string, r: ParsedCodeConfig): void {
    r.provider = detectProviderJS(code);

    // baseURL or endpoint
    const baseUrlMatch =
        code.match(/base[Uu][Rr][Ll]\s*:\s*["']([^"']+)["']/) ??
        code.match(/endpoint\s*:\s*["']([^"']+)["']/);
    if (baseUrlMatch) r.baseUrl = normalizeBaseUrl(baseUrlMatch[1], r.provider);

    // apiKey
    const apiKeyMatch = code.match(/api[Kk]ey\s*:\s*(?:["']([^"']+)["']|([^,\s}]+))/);
    if (apiKeyMatch) {
        const val = apiKeyMatch[1] ?? apiKeyMatch[2] ?? '';
        if (isEnvVarReference(val)) {
            r.apiKeyIsEnvVar = true;
        } else if (val) {
            r.apiKey = val;
        }
    }

    // apiVersion
    const versionMatch = code.match(/api[Vv]ersion\s*:\s*["']([^"']+)["']/);
    if (versionMatch) r.apiVersion = versionMatch[1];

    // models
    const modelMatches = [...code.matchAll(/model\s*:\s*["']([^"']+)["']/g)];
    r.modelNames = collectModels(modelMatches.map((m) => m[1]));
}

function extractCurl(code: string, r: ParsedCodeConfig): void {
    r.provider = detectProviderCurl(code);

    // Collect ALL URLs from the snippet (multiple curl commands)
    const allUrls = [...code.matchAll(/https?:\/\/[^\s"'\\]+/g)].map((m) => m[0]);

    if (allUrls.length > 0) {
        // Use first URL for base URL extraction
        const firstUrl = allUrls[0].replace(/\?.*$/, '');
        r.baseUrl = normalizeBaseUrl(firstUrl, r.provider);

        // Extract api-version from any URL's query string
        for (const url of allUrls) {
            const qsMatch = url.match(/[?&]api-version=([^&\s"']+)/);
            if (qsMatch) {
                r.apiVersion = qsMatch[1];
                break;
            }
        }
    }

    // API key from headers
    const azureKeyMatch = code.match(/-H\s+["']api-key:\s*([^"']+)["']/i);
    const bearerMatch = code.match(/-H\s+["']Authorization:\s*Bearer\s+([^"']+)["']/i);
    const keyVal = azureKeyMatch?.[1]?.trim() ?? bearerMatch?.[1]?.trim();
    if (keyVal) {
        if (isEnvVarReference(keyVal)) {
            r.apiKeyIsEnvVar = true;
        } else {
            r.apiKey = keyVal;
        }
    }

    // Models — collect from multiple sources
    const modelCandidates: string[] = [];

    // 1. From JSON body: "model": "..."
    const bodyMatches = [...code.matchAll(/["']model["']\s*:\s*["']([^"']+)["']/g)];
    for (const m of bodyMatches) modelCandidates.push(m[1]);

    // 2. From URL paths: /model/{id}/converse or /model/{id}/invoke (Bedrock-style gateways)
    for (const url of allUrls) {
        const pathMatch = url.match(/\/model\/([^/\s"'?]+)\//);
        if (pathMatch) modelCandidates.push(pathMatch[1]);
    }

    // 3. From Azure deployment URLs: /deployments/{name}/
    for (const url of allUrls) {
        const deplMatch = url.match(/\/deployments\/([^/\s"'?]+)\//);
        if (deplMatch) modelCandidates.push(deplMatch[1]);
    }

    r.modelNames = collectModels(modelCandidates);
}

// ---------------------------------------------------------------------------
// Model-aware defaults
// ---------------------------------------------------------------------------

export interface ModelDefaults {
    /** Recommended temperature, or undefined to use provider default */
    temperature?: number;
    /** Whether temperature is fixed by the API (cannot be changed) */
    temperatureFixed: boolean;
    /** Recommended maxTokens */
    maxTokens: number;
    /** Human-readable note about this model's constraints */
    note?: string;
}

/**
 * Return model-aware defaults based on model name and provider.
 * Detects constraints like o-series fixed temperature, Anthropic max 1.0, etc.
 */
export function getModelDefaults(modelName: string, provider: ProviderType): ModelDefaults {
    const name = modelName.toLowerCase();

    // o-series reasoning models (o1, o2, o3, o4, o1-mini, o3-mini, o4-mini, etc.)
    // These enforce temperature=1 API-side and reject any other value.
    if (/^o[1-9]/.test(name)) {
        return {
            temperature: 1.0,
            temperatureFixed: true,
            maxTokens: 16384,
            note: 'Reasoning model: temperature fixed at 1.0 by the API.',
        };
    }

    // Anthropic models: max temperature is 1.0
    if (provider === 'anthropic') {
        return {
            temperature: undefined,
            temperatureFixed: false,
            maxTokens: 16384,
        };
    }

    // OpenAI models: support 16384 output tokens
    if (provider === 'openai') {
        return {
            temperature: undefined,
            temperatureFixed: false,
            maxTokens: 16384,
        };
    }

    // Default for all other models (Ollama, custom, etc.)
    return {
        temperature: undefined,
        temperatureFixed: false,
        maxTokens: 8192,
    };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a code snippet and extract model configuration.
 * Never throws — returns partial results with warnings.
 */
export function parseCodeSnippet(code: string): ParsedCodeConfig {
    const result: ParsedCodeConfig = {
        apiKeyIsEnvVar: false,
        modelNames: [],
        detectedFormat: 'unknown',
        warnings: [],
    };

    if (!code.trim()) return result;

    result.detectedFormat = detectFormat(code);

    switch (result.detectedFormat) {
        case 'python':
            extractPython(code, result);
            break;
        case 'javascript':
            extractJavaScript(code, result);
            break;
        case 'curl':
            extractCurl(code, result);
            break;
        case 'unknown':
            // Try all extractors, pick the one that finds the most
            extractPython(code, result);
            if (!result.provider && result.modelNames.length === 0) {
                extractJavaScript(code, result);
            }
            if (!result.provider && result.modelNames.length === 0) {
                extractCurl(code, result);
            }
            if (!result.provider) {
                result.warnings.push(
                    'Could not detect provider. Please select manually.',
                );
            }
            break;
    }

    // Post-extraction warnings
    if (!result.provider && result.detectedFormat !== 'unknown') {
        result.warnings.push('Could not detect provider. Please select manually.');
    }
    if (result.modelNames.length === 0) {
        result.warnings.push('No model names found. You can add models manually after import.');
    }
    if (
        !result.baseUrl &&
        result.provider &&
        !['anthropic', 'openai', 'openrouter'].includes(result.provider)
    ) {
        result.warnings.push('No base URL found. Required for this provider.');
    }
    if (result.apiKeyIsEnvVar) {
        result.warnings.push(
            'API key references an environment variable. Enter your key manually below.',
        );
    }

    return result;
}
