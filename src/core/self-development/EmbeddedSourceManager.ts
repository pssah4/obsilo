/**
 * EmbeddedSourceManager
 *
 * Manages the TypeScript source code embedded in main.js at build time.
 * Provides methods to read, search, and modify source files in memory
 * for Core Self-Modification (Phase 4).
 *
 * The embedded source is injected by the esbuild embed-source plugin
 * as a base64-encoded constant.
 */

import { safeRegex } from '../utils/safeRegex';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EmbeddedSource {
    version: string;
    files: Record<string, string>;
    buildConfig: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Global declaration for the embedded source constant
// ---------------------------------------------------------------------------

declare const EMBEDDED_SOURCE: EmbeddedSource | undefined;

// ---------------------------------------------------------------------------
// EmbeddedSourceManager
// ---------------------------------------------------------------------------

export class EmbeddedSourceManager {
    private files = new Map<string, string>();
    private version = '';
    private buildConfig: Record<string, unknown> = {};
    private loaded = false;

    /**
     * Load embedded source from the EMBEDDED_SOURCE constant.
     * Returns false if no embedded source is available.
     */
    load(): boolean {
        if (typeof EMBEDDED_SOURCE === 'undefined') {
            console.debug('[EmbeddedSourceManager] No embedded source available');
            return false;
        }

        try {
            this.version = EMBEDDED_SOURCE.version;
            this.buildConfig = EMBEDDED_SOURCE.buildConfig;

            for (const [path, content] of Object.entries(EMBEDDED_SOURCE.files)) {
                // Content may be base64-encoded
                try {
                    this.files.set(path, atob(content));
                } catch {
                    this.files.set(path, content);
                }
            }

            this.loaded = true;
            console.debug(`[EmbeddedSourceManager] Loaded ${this.files.size} source files (v${this.version})`);
            return true;
        } catch (e) {
            console.error('[EmbeddedSourceManager] Failed to load embedded source:', e);
            return false;
        }
    }

    /**
     * Check if embedded source is available and loaded.
     */
    get isLoaded(): boolean {
        return this.loaded;
    }

    /**
     * Get the embedded version string.
     */
    getVersion(): string {
        return this.version;
    }

    /**
     * Get the build configuration.
     */
    getBuildConfig(): Record<string, unknown> {
        return this.buildConfig;
    }

    /**
     * List all source file paths.
     */
    listFiles(): string[] {
        return [...this.files.keys()].sort();
    }

    /**
     * Read a source file by path.
     */
    readFile(path: string): string | undefined {
        return this.files.get(path);
    }

    /**
     * Search for a pattern across all source files.
     */
    searchFiles(pattern: string): { path: string; line: number; text: string }[] {
        const regex = safeRegex(pattern, 'gi');
        const results: { path: string; line: number; text: string }[] = [];

        for (const [path, content] of this.files) {
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
                if (regex.test(lines[i])) {
                    results.push({ path, line: i + 1, text: lines[i].trim() });
                    regex.lastIndex = 0;
                }
            }
        }

        return results;
    }

    /**
     * Edit a source file in memory. Does NOT persist — use PluginBuilder to
     * compile and write the result.
     */
    editFile(path: string, content: string): void {
        if (!this.files.has(path)) {
            console.warn(`[EmbeddedSourceManager] Creating new file: ${path}`);
        }
        this.files.set(path, content);
    }

    /**
     * Get all files as a Map for the build process.
     */
    getAllFiles(): Map<string, string> {
        return new Map(this.files);
    }
}
