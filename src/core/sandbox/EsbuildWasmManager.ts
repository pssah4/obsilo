/**
 * EsbuildWasmManager
 *
 * On-demand TypeScript compilation via esbuild-wasm. Both the JS module
 * and the WASM binary are downloaded from CDN on first use and cached
 * in the plugin data directory.
 *
 * Two compilation modes:
 * - transform(): Single file, no imports (~100ms)
 * - build(): Bundle with npm dependencies via virtual filesystem (~500ms-2s)
 *
 * Loading strategy:
 * 1. Check if JS + WASM are already cached locally
 * 2. If not, download via requestUrl (Obsidian API, no fetch)
 * 3. Load JS module via CommonJS evaluation (not dynamic import)
 * 4. Initialize esbuild with local WASM binary as ArrayBuffer
 *
 * Part of Self-Development Phase 3: Sandbox + Dynamic Modules.
 */

import { Notice, requestUrl } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ESBUILD_VERSION = '0.24.2';
const JS_CDN_URL = `https://cdn.jsdelivr.net/npm/esbuild-wasm@${ESBUILD_VERSION}/lib/browser.js`;
const WASM_CDN_URL = `https://cdn.jsdelivr.net/npm/esbuild-wasm@${ESBUILD_VERSION}/esbuild.wasm`;

const CACHE_DIR_NAME = 'dev-env';
const JS_CACHE_FILE = `esbuild-browser-${ESBUILD_VERSION}.js`;
const WASM_CACHE_FILE = `esbuild-${ESBUILD_VERSION}.wasm`;

/**
 * SHA-256 hashes for integrity verification of CDN downloads.
 * Generated from the official esbuild-wasm@0.24.2 npm package.
 * To update: download the files, then run:
 *   shasum -a 256 browser.js esbuild.wasm
 */
const INTEGRITY_HASHES: Record<string, string> = {
    [JS_CACHE_FILE]: '9eed236d35e2e5b5fecc079c5e34f7e46effa2a3b8b9e40a9fdcaf54f9a43684',
    [WASM_CACHE_FILE]: '6cb75da1a8652a84c8468c779e1dce06e70e5d2e5e22096e6a6828aee0a6510a',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** esbuild-wasm module interface (subset we use) */
interface EsbuildModule {
    initialize(options: { wasmModule: WebAssembly.Module }): Promise<void>;
    transform(
        source: string,
        options: Record<string, unknown>,
    ): Promise<{ code: string; warnings: unknown[] }>;
    build(
        options: Record<string, unknown>,
    ): Promise<{ outputFiles?: { text: string }[]; errors: unknown[]; warnings: unknown[] }>;
}

// ---------------------------------------------------------------------------
// EsbuildWasmManager
// ---------------------------------------------------------------------------

export class EsbuildWasmManager {
    private esbuild: EsbuildModule | null = null;
    private packageCache = new Map<string, string>();
    private readonly cacheDir: string;
    private initializing = false;
    /** Track packages for which a CDN download notice has already been shown (per session). */
    private notifiedPackages = new Set<string>();

    constructor(private plugin: ObsidianAgentPlugin) {
        const configDir = plugin.app.vault.configDir;
        const pluginId = plugin.manifest.id;
        this.cacheDir = `${configDir}/plugins/${pluginId}/${CACHE_DIR_NAME}`;
    }

    // -----------------------------------------------------------------------
    // Initialization
    // -----------------------------------------------------------------------

    /**
     * Ensure esbuild-wasm is downloaded and initialized.
     * Downloads JS (~150KB) + WASM (~11MB) from CDN on first use.
     */
    async ensureReady(): Promise<void> {
        if (this.esbuild) return;
        if (this.initializing) {
            while (this.initializing) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            if (this.esbuild) return;
            throw new Error('esbuild-wasm initialization failed in another call');
        }

        this.initializing = true;
        try {
            await this.ensureCacheDir();

            // Step 1: Get the JS module (from cache or CDN)
            const jsCode = await this.getCachedOrDownloadText(JS_CACHE_FILE, JS_CDN_URL);

            // Step 2: Get the WASM binary (from cache or CDN)
            const wasmBuffer = await this.getCachedOrDownloadBinary(WASM_CACHE_FILE, WASM_CDN_URL);

            // Step 3: Load the JS module via CommonJS evaluation
            // esbuild-wasm browser.js is: (module => { ... module.exports = ... })(module)
            const esbuildModule = this.loadCommonJsModule(jsCode);

            // Step 4: Compile WASM and initialize esbuild
            const wasmModule = await WebAssembly.compile(wasmBuffer);
            await esbuildModule.initialize({ wasmModule });

            this.esbuild = esbuildModule;
            console.debug('[EsbuildWasmManager] Initialized successfully');
        } catch (e) {
            console.error('[EsbuildWasmManager] Initialization failed:', e);
            throw new Error(`Failed to initialize esbuild-wasm: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            this.initializing = false;
        }
    }

    // -----------------------------------------------------------------------
    // Compilation
    // -----------------------------------------------------------------------

    /**
     * Mode 1: Transform a single TypeScript file (no imports).
     * Fast (~100ms). Output is an IIFE that populates an exports object.
     */
    async transform(source: string): Promise<string> {
        await this.ensureReady();

        const result = await this.esbuild!.transform(source, {
            loader: 'ts',
            format: 'iife',
            target: 'es2022',
            globalName: '__module',
        });

        return `${result.code}\nif (typeof __module !== 'undefined') { Object.assign(exports, __module); }`;
    }

    /**
     * Mode 2: Bundle TypeScript with npm dependencies.
     * Uses a virtual filesystem plugin to resolve imports from cached packages.
     * Slower (~500ms-2s) but supports libraries.
     */
    async build(source: string, dependencies: string[]): Promise<string> {
        await this.ensureReady();

        await Promise.all(dependencies.map(dep => this.ensurePackage(dep)));

        const packageCache = this.packageCache;

        const result = await this.esbuild!.build({
            stdin: { contents: source, loader: 'ts', resolveDir: '.' },
            bundle: true,
            format: 'iife',
            globalName: '__module',
            target: 'es2022',
            write: false,
            plugins: [{
                name: 'virtual-packages',
                setup(build: { onResolve: (...args: unknown[]) => unknown; onLoad: (...args: unknown[]) => unknown }) {
                    build.onResolve(
                        { filter: /^[^.]/ },
                        (args: { path: string }) => ({
                            path: args.path,
                            namespace: 'pkg',
                        })
                    );
                    build.onLoad(
                        { filter: /.*/, namespace: 'pkg' },
                        (args: { path: string }) => ({
                            contents: packageCache.get(args.path) ?? `export default {};`,
                            loader: 'js',
                        })
                    );
                },
            }],
        });

        const output = result.outputFiles?.[0]?.text ?? '';
        return `${output}\nif (typeof __module !== 'undefined') { Object.assign(exports, __module); }`;
    }

    /**
     * Check if the manager is initialized.
     */
    get isReady(): boolean {
        return this.esbuild !== null;
    }

    // -----------------------------------------------------------------------
    // Module Loading
    // -----------------------------------------------------------------------

    /**
     * Load a CommonJS module from source code.
     * esbuild-wasm's browser.js is: (module => { ... module.exports = ... })(module)
     */
    private loadCommonJsModule(jsCode: string): EsbuildModule {
        const mod: { exports: Record<string, unknown> } = { exports: {} };
        // eslint-disable-next-line @typescript-eslint/no-implied-eval -- required to load esbuild-wasm JS at runtime without npm install
        const factory = new Function('module', 'exports', jsCode);
        factory(mod, mod.exports);
        return mod.exports as unknown as EsbuildModule;
    }

    // -----------------------------------------------------------------------
    // Cache Management
    // -----------------------------------------------------------------------

    private async ensureCacheDir(): Promise<void> {
        const adapter = this.plugin.app.vault.adapter;
        if (!await adapter.exists(this.cacheDir)) {
            await adapter.mkdir(this.cacheDir);
        }
    }

    /**
     * Get a text file from local cache, or download from CDN and cache it.
     * Verifies SHA-256 integrity hash on download.
     */
    private async getCachedOrDownloadText(filename: string, cdnUrl: string): Promise<string> {
        const path = `${this.cacheDir}/${filename}`;
        const adapter = this.plugin.app.vault.adapter;

        if (await adapter.exists(path)) {
            console.debug(`[EsbuildWasmManager] Loading cached: ${filename}`);
            return await adapter.read(path);
        }

        console.debug(`[EsbuildWasmManager] Downloading: ${cdnUrl}`);
        const response = await requestUrl({ url: cdnUrl });
        if (response.status !== 200) {
            throw new Error(`Failed to download ${cdnUrl}: HTTP ${response.status}`);
        }

        // Integrity verification
        await this.verifyIntegrity(filename, response.arrayBuffer);

        await adapter.write(path, response.text);
        console.debug(`[EsbuildWasmManager] Cached: ${filename}`);
        return response.text;
    }

    /**
     * Get a binary file from local cache, or download from CDN and cache it.
     * Verifies SHA-256 integrity hash on download.
     */
    private async getCachedOrDownloadBinary(filename: string, cdnUrl: string): Promise<ArrayBuffer> {
        const path = `${this.cacheDir}/${filename}`;
        const adapter = this.plugin.app.vault.adapter;

        if (await adapter.exists(path)) {
            console.debug(`[EsbuildWasmManager] Loading cached: ${filename}`);
            return await adapter.readBinary(path);
        }

        console.debug(`[EsbuildWasmManager] Downloading: ${cdnUrl} (this may take a moment)`);
        const response = await requestUrl({ url: cdnUrl });
        if (response.status !== 200) {
            throw new Error(`Failed to download ${cdnUrl}: HTTP ${response.status}`);
        }

        // Integrity verification
        await this.verifyIntegrity(filename, response.arrayBuffer);

        await adapter.writeBinary(path, response.arrayBuffer);
        console.debug(`[EsbuildWasmManager] Cached: ${filename}`);
        return response.arrayBuffer;
    }

    /**
     * Verify SHA-256 integrity hash of downloaded content.
     * Throws if the hash does not match the expected value.
     */
    private async verifyIntegrity(filename: string, data: ArrayBuffer): Promise<void> {
        const expectedHash = INTEGRITY_HASHES[filename];
        if (!expectedHash) {
            console.warn(`[EsbuildWasmManager] No integrity hash for ${filename}, skipping verification`);
            return;
        }

        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const actualHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        if (actualHash !== expectedHash) {
            throw new Error(
                `Integrity check failed for ${filename}. ` +
                `Expected SHA-256: ${expectedHash}, got: ${actualHash}. ` +
                `The file may have been tampered with. Delete the cache and retry.`
            );
        }
        console.debug(`[EsbuildWasmManager] Integrity verified: ${filename}`);
    }

    /**
     * Download an npm package from CDN and cache it in memory.
     * Prefers esm.sh ?bundle which includes all transitive dependencies.
     * Falls back to jsdelivr +esm for packages not available on esm.sh.
     *
     * After downloading, resolves absolute-path imports recursively so that
     * sub-dependencies (e.g. pptxgenjs → jszip, or esm.sh Node polyfills)
     * are also available in the virtual filesystem.
     *
     * SECURITY (M-5): Downloads run arbitrary third-party code in the sandbox.
     * A Notice is shown on first download of each package so the user is aware.
     */
    private async ensurePackage(name: string): Promise<void> {
        if (this.packageCache.has(name)) return;

        // M-5: Notify user about CDN download (once per package per session)
        if (!this.notifiedPackages.has(name)) {
            this.notifiedPackages.add(name);
            console.warn(`[EsbuildWasmManager] Downloading npm package "${name}" from CDN for sandbox execution`);
            new Notice(`Sandbox: Downloading "${name}" from CDN`, 5000);
        }

        // Prefer esm.sh ?bundle — includes all transitive dependencies in one file
        const bundleUrl = `https://esm.sh/${name}?bundle`;
        try {
            const response = await requestUrl({ url: bundleUrl });
            if (response.status === 200) {
                this.packageCache.set(name, response.text);
                // Resolve esm.sh internal imports (Node polyfills, actual bundle URLs)
                await this.resolveInternalImports(response.text, 'https://esm.sh');
                console.debug(`[EsbuildWasmManager] Cached package (esm.sh bundle): ${name}`);
                return;
            }
        } catch {
            console.debug(`[EsbuildWasmManager] esm.sh bundle failed for "${name}", falling back to jsdelivr`);
        }

        // Fallback: jsdelivr +esm (may lack transitive deps for complex packages)
        const fallbackUrl = `https://cdn.jsdelivr.net/npm/${name}/+esm`;
        try {
            const response = await requestUrl({ url: fallbackUrl });
            this.packageCache.set(name, response.text);
            // Resolve jsdelivr sub-dependency imports (e.g. /npm/jszip@3.10.1/+esm)
            await this.resolveInternalImports(response.text, 'https://cdn.jsdelivr.net');
            console.debug(`[EsbuildWasmManager] Cached package (jsdelivr): ${name}`);
        } catch (e) {
            console.warn(`[EsbuildWasmManager] Failed to download package "${name}":`, e);
            throw new Error(`Failed to download npm package "${name}": ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    /**
     * Resolve absolute-path imports found in CDN-hosted packages.
     *
     * CDN modules use internal absolute paths for sub-dependencies:
     * - esm.sh: `/node/buffer.mjs`, `/pptxgenjs@4.0.1/es2022/pptxgenjs.bundle.mjs`
     * - jsdelivr: `/npm/jszip@3.10.1/+esm`
     *
     * The virtual-packages esbuild plugin catches these paths (filter `/^[^.]/`),
     * so we download and store them in packageCache with their path as key.
     * Resolves recursively with a depth limit to handle transitive chains.
     */
    private async resolveInternalImports(
        code: string,
        cdnBase: string,
        depth = 0,
    ): Promise<void> {
        if (depth > 5) return;

        // Match absolute-path imports: import "/path", from "/path", export * from "/path"
        // Uses \s* (not \s+) because minified CDN code often omits spaces: from"/path"
        const importRegex = /(?:from|import)\s*["'](\/[^"']+)["']/g;
        let match;
        const paths: string[] = [];

        while ((match = importRegex.exec(code)) !== null) {
            const path = match[1];
            if (!this.packageCache.has(path) && !paths.includes(path)) {
                paths.push(path);
            }
        }

        for (const path of paths) {
            if (this.packageCache.has(path)) continue;

            const fullUrl = `${cdnBase}${path}`;
            try {
                const resp = await requestUrl({ url: fullUrl });
                if (resp.status === 200) {
                    this.packageCache.set(path, resp.text);
                    await this.resolveInternalImports(resp.text, cdnBase, depth + 1);
                } else {
                    console.warn(`[EsbuildWasmManager] HTTP ${resp.status} for ${fullUrl}`);
                    this.packageCache.set(path, 'export default {};');
                }
            } catch (e) {
                console.warn(`[EsbuildWasmManager] Failed to resolve ${path}:`, e);
                this.packageCache.set(path, 'export default {};');
            }
        }
    }
}
