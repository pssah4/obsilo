/**
 * SemanticIndexService v2
 *
 * Key improvements over v1:
 *  1. Batch embedding: N texts per API call (10-50x fewer requests)
 *  2. Resumable indexing: checkpoint file (index-meta.json) tracks mtime per
 *     file — interrupted builds continue from where they left off
 *  3. Heading-aware chunking: larger chunks (2000 chars default), split at
 *     Markdown headings before falling back to paragraph splitting
 *  4. Cancel support: cancelBuild() sets a flag checked between file batches
 *  5. Event-loop yielding: setTimeout(0) between disk commits avoids UI freeze
 *  6. Fixed vectra queryItems() signature (was passing string as topK → NaN)
 *
 * Index storage: {pluginDir}/semantic-index/   (obsidian-sync, default)
 *             or .obsidian-agent/semantic-index/ (local)
 * Checkpoint:   {indexDir}/index-meta.json
 */

import { requestUrl } from 'obsidian';
import type { Vault } from 'obsidian';
import type { CustomModel } from '../../types/settings';
import { LocalIndex } from 'vectra';
import * as path from 'path';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface SemanticResult {
    path: string;
    excerpt: string;
    score: number;
}

export interface SemanticIndexOptions {
    /** How many files to process before committing to disk. Default: 20 */
    batchSize?: number;
    /** How many texts to send per embedding API call. Default: 16 */
    embeddingBatchSize?: number;
    excludedFolders?: string[];
    storageLocation?: 'obsidian-sync' | 'local';
    /** Whether to also index PDF files. Default: false */
    indexPdfs?: boolean;
    /** Characters per chunk. Default: 2000. Changing this forces a full index rebuild. */
    chunkSize?: number;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface IndexCheckpoint {
    version: number;
    embeddingModel: string;
    chunkSize: number;
    /** path → { mtime, chunks } */
    files: Record<string, { mtime: number; chunks: number }>;
    builtAt: string;
    docCount: number;
}

const CHECKPOINT_VERSION = 1;
const DEFAULT_CHUNK_SIZE = 2000;   // chars — larger chunks → fewer API calls
const DEFAULT_COMMIT_EVERY = 20;   // files between disk commits
const DEFAULT_EMBED_BATCH = 16;    // texts per API request

// ---------------------------------------------------------------------------
// SemanticIndexService
// ---------------------------------------------------------------------------

export class SemanticIndexService {
    private vault: Vault;
    private pluginDir: string;
    private indexDir: string;          // absolute FS path for vectra
    private index: LocalIndex<Record<string, string | number | boolean>>;
    private pipeline: any = null;

    private isBuilding = false;
    private cancelled = false;
    private builtAt: Date | null = null;
    private checkpoint: IndexCheckpoint | null = null;

    private embeddingModel: CustomModel | null = null;
    private batchSize: number;
    private embeddingBatchSize: number;
    private excludedFolders: string[];
    private indexPdfs: boolean;
    private chunkSize: number;

    // Auto-update queue: process one file at a time so concurrent vault events
    // don't spawn dozens of simultaneous embedding calls (which freezes Obsidian).
    private autoUpdateQueue = new Set<string>();
    private autoIndexRunning = false;

    // pdfjs-dist circuit breaker: set to true on first fatal import/parse error.
    private pdfParseUnavailable = false;

    /** Number of unique files indexed (updated live during build). */
    docCount = 0;
    /** Live progress for external polling (e.g. Settings UI). */
    progressIndexed = 0;
    progressTotal = 0;

    constructor(vault: Vault, pluginDir: string, options: SemanticIndexOptions = {}) {
        this.vault = vault;
        this.pluginDir = pluginDir;
        this.batchSize = options.batchSize ?? DEFAULT_COMMIT_EVERY;
        this.embeddingBatchSize = options.embeddingBatchSize ?? DEFAULT_EMBED_BATCH;
        this.excludedFolders = options.excludedFolders ?? [];
        this.indexPdfs = options.indexPdfs ?? false;
        this.chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;

        const basePath = (vault.adapter as any).getBasePath?.() ?? '';
        this.indexDir = options.storageLocation === 'local'
            ? path.join(basePath, '.obsidian-agent', 'semantic-index')
            : path.join(basePath, pluginDir, 'semantic-index');

        this.index = new LocalIndex(this.indexDir);
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    configure(options: SemanticIndexOptions): void {
        if (options.batchSize !== undefined) this.batchSize = options.batchSize;
        if (options.embeddingBatchSize !== undefined) this.embeddingBatchSize = options.embeddingBatchSize;
        if (options.excludedFolders !== undefined) this.excludedFolders = options.excludedFolders;
        if (options.indexPdfs !== undefined) this.indexPdfs = options.indexPdfs;
        if (options.chunkSize !== undefined) this.chunkSize = options.chunkSize;
    }

    get isIndexed(): boolean { return this.builtAt !== null; }
    get building(): boolean { return this.isBuilding; }
    get lastBuiltAt(): Date | null { return this.builtAt; }

    setEmbeddingModel(model: CustomModel | null): void {
        this.embeddingModel = model;
        if (model) {
            console.log(`[SemanticIndex] Using API model: ${model.name} (${model.provider})`);
        } else {
            console.log('[SemanticIndex] Using local Xenova pipeline');
        }
    }

    /** Stop an in-progress buildIndex(). Partial progress is saved to checkpoint. */
    cancelBuild(): void {
        this.cancelled = true;
    }

    /** Pre-warm pipeline and restore state from checkpoint if available. */
    async initialize(): Promise<void> {
        if (!this.embeddingModel) {
            try { await this.loadPipeline(); } catch (e) {
                console.warn('[SemanticIndex] Pipeline warmup failed (non-fatal):', e);
            }
        }
        try {
            this.checkpoint = await this.loadCheckpoint();
            if (this.checkpoint) {
                this.docCount = this.checkpoint.docCount;
                this.builtAt = new Date(this.checkpoint.builtAt);
            }
        } catch { /* non-fatal */ }
    }

    /**
     * Build (or incrementally update) the index.
     *
     * @param onProgress  - Called with (indexed, total) after each file.
     * @param force       - Ignore checkpoint and rebuild from scratch.
     */
    async buildIndex(
        onProgress?: (indexed: number, total: number) => void,
        force = false,
    ): Promise<void> {
        if (this.isBuilding) return;
        this.isBuilding = true;
        this.cancelled = false;

        try {
            // ----------------------------------------------------------------
            // 1. Determine file list (Markdown + optionally PDFs)
            // ----------------------------------------------------------------
            const mdFiles = this.vault.getMarkdownFiles();
            const allFiles = this.indexPdfs
                ? [
                    ...mdFiles,
                    ...this.vault.getFiles().filter((f) => f.extension === 'pdf'),
                ]
                : mdFiles;
            const files = this.excludedFolders.length > 0
                ? allFiles.filter((f) => !this.excludedFolders.some(
                    (folder) => f.path.startsWith(folder + '/'),
                ))
                : allFiles;
            const total = files.length;

            const modelKey = this.modelKey();

            // ----------------------------------------------------------------
            // 2. Load checkpoint — detect model/chunkSize change
            // ----------------------------------------------------------------
            const existingCheckpoint = force ? null : await this.loadCheckpoint();
            const isModelChange = existingCheckpoint !== null
                && existingCheckpoint.embeddingModel !== modelKey;
            const isChunkSizeChange = existingCheckpoint !== null
                && existingCheckpoint.chunkSize !== this.chunkSize;
            const isFullRebuild = force || isModelChange || isChunkSizeChange || existingCheckpoint === null;

            if (isChunkSizeChange) {
                console.log(`[SemanticIndex] Chunk size changed (${existingCheckpoint!.chunkSize} → ${this.chunkSize}) — full rebuild.`);
            }

            if (isFullRebuild) {
                if (await this.index.isIndexCreated().catch(() => false)) {
                    await this.index.deleteIndex();
                }
                await this.index.createIndex({ version: 1, deleteIfExists: true });
                this.checkpoint = this.newCheckpoint(modelKey);
            } else {
                if (!await this.index.isIndexCreated().catch(() => false)) {
                    await this.index.createIndex({ version: 1, deleteIfExists: true });
                }
                this.checkpoint = existingCheckpoint!;
            }

            // ----------------------------------------------------------------
            // 3. Determine which files need (re)indexing
            // ----------------------------------------------------------------
            const toIndex = files.filter((f) => {
                if (isFullRebuild) return true;
                const stored = this.checkpoint!.files[f.path];
                return !stored || stored.mtime < (f.stat?.mtime ?? 0);
            });

            // Files already indexed (skipped this run)
            let indexed = isFullRebuild ? 0 : Object.keys(this.checkpoint.files).length;
            let errors = 0;

            this.progressIndexed = indexed;
            this.progressTotal = total;
            onProgress?.(indexed, total);

            if (toIndex.length === 0) {
                console.log('[SemanticIndex] Index up to date — nothing to index.');
                this.builtAt = new Date();
                return;
            }

            // ----------------------------------------------------------------
            // 4. Phase A: delete old chunks for modified files (outside tx)
            // ----------------------------------------------------------------
            if (!isFullRebuild) {
                const modifiedPaths = toIndex
                    .filter((f) => Boolean(this.checkpoint!.files[f.path]))
                    .map((f) => f.path);

                if (modifiedPaths.length > 0) {
                    await this.index.beginUpdate();
                    for (const p of modifiedPaths) {
                        const existing = await this.index.listItemsByMetadata({ path: p });
                        for (const item of existing) {
                            await this.index.deleteItem(item.id);
                        }
                    }
                    await this.index.endUpdate();
                }
            }

            // ----------------------------------------------------------------
            // 5. Phase B: embed + insert new chunks
            // ----------------------------------------------------------------
            await this.index.beginUpdate();
            let uncommitted = 0;

            for (const file of toIndex) {
                if (this.cancelled) {
                    console.log('[SemanticIndex] Build cancelled — saving partial checkpoint.');
                    break;
                }

                try {
                    const content = await this.readFileContent(file);
                    const chunks = this.splitIntoChunks(content, this.chunkSize);

                    if (chunks.length > 0) {
                        // --- KEY IMPROVEMENT: batch all chunks of this file ---
                        const vectors = await this.embedBatch(chunks);
                        for (let ci = 0; ci < chunks.length; ci++) {
                            await this.index.insertItem({
                                vector: vectors[ci],
                                metadata: {
                                    path: file.path,
                                    chunk: chunks[ci],
                                    chunkIndex: ci,
                                },
                            });
                        }
                    }

                    this.checkpoint.files[file.path] = {
                        mtime: file.stat?.mtime ?? 0,
                        chunks: chunks.length,
                    };
                    indexed++;
                    uncommitted++;
                    this.docCount = indexed;
                    this.progressIndexed = indexed;
                    onProgress?.(indexed, total);

                    // Checkpoint every N files: commit to disk + yield UI
                    if (uncommitted >= this.batchSize) {
                        await this.index.endUpdate();
                        this.checkpoint.docCount = indexed;
                        await this.saveCheckpoint(this.checkpoint);
                        uncommitted = 0;
                        await new Promise<void>((r) => setTimeout(r, 0)); // yield
                        await this.index.beginUpdate();
                    }
                } catch (e) {
                    errors++;
                    console.warn(`[SemanticIndex] Skipping "${file.path}":`, e);
                }
            }

            // Final commit
            await this.index.endUpdate();
            this.checkpoint.docCount = indexed;
            this.checkpoint.builtAt = new Date().toISOString();
            await this.saveCheckpoint(this.checkpoint);

            this.builtAt = new Date(this.checkpoint.builtAt);
            this.docCount = indexed;

            if (!this.cancelled) {
                console.log(`[SemanticIndex] Build complete: ${indexed}/${total} files, ${errors} skipped.`);
            }
        } catch (e) {
            console.error('[SemanticIndex] Build failed:', e);
            // Best-effort: close any open vectra transaction so the index isn't
            // left in a corrupted state on next startup.
            try { await this.index.endUpdate(); } catch { /* already closed */ }
            throw e;
        } finally {
            this.isBuilding = false;
        }
    }

    /**
     * Incrementally update a single file.
     * Removes its old chunks then re-embeds the current content.
     */
    async updateFile(filePath: string): Promise<void> {
        if (!await this.index.isIndexCreated().catch(() => false)) return;
        try {
            const file = this.vault.getFileByPath(filePath);
            if (!file) return;

            // Delete old chunks
            const existing = await this.index.listItemsByMetadata({ path: filePath });
            await this.index.beginUpdate();
            for (const item of existing) {
                await this.index.deleteItem(item.id);
            }

            // Embed + insert new chunks
            const content = await this.readFileContent(file);
            const chunks = this.splitIntoChunks(content, this.chunkSize);
            if (chunks.length > 0) {
                const vectors = await this.embedBatch(chunks);
                for (let ci = 0; ci < chunks.length; ci++) {
                    await this.index.insertItem({
                        vector: vectors[ci],
                        metadata: { path: filePath, chunk: chunks[ci], chunkIndex: ci },
                    });
                }
            }
            await this.index.endUpdate();

            // Update checkpoint
            if (this.checkpoint) {
                this.checkpoint.files[filePath] = {
                    mtime: file.stat?.mtime ?? 0,
                    chunks: chunks.length,
                };
                await this.saveCheckpoint(this.checkpoint);
            }
        } catch (e) {
            console.warn(`[SemanticIndex] updateFile failed for ${filePath}:`, e);
        }
    }

    /**
     * Queue a file for auto-index. Safe to call on every vault event.
     * Deduplicates: if the same file is queued multiple times before it's
     * processed, only the latest version is indexed. All files are processed
     * sequentially (concurrency = 1) to prevent concurrent embedding calls
     * from freezing Obsidian's main thread.
     */
    queueAutoUpdate(filePath: string): void {
        this.autoUpdateQueue.add(filePath);
        if (!this.autoIndexRunning) {
            this.autoIndexRunning = true;
            this.runAutoUpdateQueue();
        }
    }

    private async runAutoUpdateQueue(): Promise<void> {
        while (this.autoUpdateQueue.size > 0) {
            const paths = [...this.autoUpdateQueue];
            this.autoUpdateQueue.clear();
            for (const path of paths) {
                await this.updateFile(path).catch((e) =>
                    console.warn(`[SemanticIndex] Auto-update failed for ${path}:`, e)
                );
                // Pause between files so the Electron renderer can process user
                // input, paint frames, and run GC without freezing the UI.
                await this.sleep(2000);
            }
        }
        this.autoIndexRunning = false;
    }

    /**
     * Remove all chunks for a single file from the index.
     * Called on vault delete and rename (old path).
     */
    async removeFile(filePath: string): Promise<void> {
        if (!await this.index.isIndexCreated().catch(() => false)) return;
        try {
            const existing = await this.index.listItemsByMetadata({ path: filePath });
            if (existing.length === 0) return;
            await this.index.beginUpdate();
            for (const item of existing) {
                await this.index.deleteItem(item.id);
            }
            await this.index.endUpdate();
            if (this.checkpoint?.files[filePath]) {
                delete this.checkpoint.files[filePath];
                this.docCount = Math.max(0, this.docCount - 1);
                await this.saveCheckpoint(this.checkpoint);
            }
        } catch (e) {
            console.warn(`[SemanticIndex] removeFile failed for "${filePath}":`, e);
        }
    }

    /**
     * Keyword search over indexed chunks (in-memory, no file I/O).
     * Scores each chunk by term frequency, returns best chunk per file.
     * Used by hybrid search to catch exact names/tags the embedding model misses.
     */
    async keywordSearch(query: string, topK = 8): Promise<SemanticResult[]> {
        if (!await this.index.isIndexCreated().catch(() => false)) return [];
        try {
            const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length >= 3);
            if (terms.length === 0) return [];

            const allItems: any[] = await this.index.listItemsByMetadata({});

            // Score each chunk by total term occurrence count, keep best chunk per file
            const byPath = new Map<string, { excerpt: string; score: number }>();
            for (const item of allItems) {
                const chunk: string = (item.metadata?.chunk as string) ?? '';
                const filePath: string = (item.metadata?.path as string) ?? '';
                if (!chunk || !filePath) continue;
                const lower = chunk.toLowerCase();
                const termCount = terms.reduce((acc, term) => {
                    let n = 0, pos = 0;
                    while ((pos = lower.indexOf(term, pos)) !== -1) { n++; pos += term.length; }
                    return acc + n;
                }, 0);
                if (termCount === 0) continue;
                const existing = byPath.get(filePath);
                if (!existing || termCount > existing.score) {
                    byPath.set(filePath, { excerpt: chunk, score: termCount });
                }
            }

            // Normalize scores 0-1, sort by score, return topK
            const entries = Array.from(byPath.entries());
            const maxScore = entries.reduce((m, [, v]) => Math.max(m, v.score), 1);
            return entries
                .map(([filePath, v]) => ({ path: filePath, excerpt: v.excerpt, score: v.score / maxScore }))
                .sort((a, b) => b.score - a.score)
                .slice(0, topK);
        } catch {
            return [];
        }
    }

    /**
     * Return all indexed chunks for a specific file, sorted by chunk order.
     * Used by graph-augmented RAG to load linked-note context.
     */
    async getChunksByPath(filePath: string): Promise<string[]> {
        if (!await this.index.isIndexCreated().catch(() => false)) return [];
        try {
            const items: any[] = await this.index.listItemsByMetadata({ path: filePath });
            items.sort((a, b) => ((a.metadata?.chunkIndex as number) ?? 0) - ((b.metadata?.chunkIndex as number) ?? 0));
            return items.map((item) => (item.metadata?.chunk as string) ?? '').filter(Boolean);
        } catch {
            return [];
        }
    }

    /**
     * Search the index. Returns top-K most relevant chunks.
     * @param textForEmbedding - Optional override for what gets embedded (used by HyDE).
     *   When provided, this text is embedded instead of `query`, but `query` is still
     *   used for vectra's internal text-ranking and for logging.
     */
    async search(query: string, topK = 5, textForEmbedding?: string): Promise<SemanticResult[]> {
        if (!await this.index.isIndexCreated().catch(() => false)) {
            return [];
        }
        try {
            const embedText = textForEmbedding ?? query;
            const [vector] = await this.embedBatch([embedText]);
            // vectra signature: queryItems(vector, textQuery, topK)
            const results = await this.index.queryItems(vector, query, topK);
            return results.map((r: any) => ({
                path: r.item.metadata?.path as string ?? '',
                excerpt: r.item.metadata?.chunk as string ?? '',
                score: r.score,
            }));
        } catch (e) {
            console.error('[SemanticIndex] Search failed:', e);
            return [];
        }
    }

    /** Delete the on-disk index and reset state. */
    async deleteIndex(): Promise<void> {
        try {
            await this.index.deleteIndex();
        } catch { /* non-fatal */ }
        // Remove checkpoint file
        try {
            await fs.promises.unlink(this.checkpointPath());
        } catch { /* non-fatal */ }
        this.builtAt = null;
        this.docCount = 0;
        this.checkpoint = null;
    }

    // -----------------------------------------------------------------------
    // Batch embedding
    // -----------------------------------------------------------------------

    /**
     * Embed an array of texts.
     *
     * API path:   sends batches of `embeddingBatchSize` texts per request.
     *             → 10-50x fewer API calls vs. one call per text.
     * Xenova path: runs all texts in parallel (local, no rate limit concern).
     */
    private async embedBatch(texts: string[]): Promise<number[][]> {
        if (texts.length === 0) return [];

        if (this.embeddingModel) {
            const results: number[][] = [];
            for (let i = 0; i < texts.length; i += this.embeddingBatchSize) {
                const batch = texts.slice(i, i + this.embeddingBatchSize);
                const vectors = await this.embedBatchViaApiWithRetry(batch, this.embeddingModel);
                results.push(...vectors);
                // Throttle between requests (not within a batch)
                if (i + this.embeddingBatchSize < texts.length) {
                    await this.sleep(50);
                }
            }
            return results;
        }

        // Local Xenova — sequential to avoid OOM on long notes with many chunks
        await this.loadPipeline();
        const out: number[][] = [];
        for (const t of texts) {
            out.push(await this.embedXenova(t));
        }
        return out;
    }

    private async embedBatchViaApiWithRetry(
        texts: string[],
        model: CustomModel,
        maxRetries = 4,
    ): Promise<number[][]> {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                return await this.embedBatchViaApi(texts, model);
            } catch (e: any) {
                const status = e?.status ?? e?.statusCode;
                const msg = String(e?.message ?? e ?? '');
                const isRateLimit =
                    status === 429 ||
                    msg.includes('429') ||
                    msg.toLowerCase().includes('rate limit');
                if (isRateLimit && attempt < maxRetries - 1) {
                    const delay = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s, 8s
                    console.warn(`[SemanticIndex] Rate limited — retry in ${delay}ms`);
                    await this.sleep(delay);
                } else {
                    throw e;
                }
            }
        }
        throw new Error('[SemanticIndex] Max retries exceeded');
    }

    private async embedBatchViaApi(texts: string[], model: CustomModel): Promise<number[][]> {
        let url: string;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        // OpenAI-compatible batch: input is an array of strings
        const body: Record<string, any> = { input: texts };

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
            const base = (
                model.baseUrl ||
                (model.provider === 'lmstudio' ? 'http://localhost:1234' : 'http://localhost:11434')
            ).replace(/\/v1\/?$/, '').replace(/\/+$/, '');
            url = `${base}/v1/embeddings`;
            body.model = model.name;
            if (model.apiKey) headers['Authorization'] = `Bearer ${model.apiKey}`;
        } else {
            // custom provider
            const base = (model.baseUrl ?? '').replace(/\/+$/, '');
            url = `${base}/embeddings`;
            body.model = model.name;
            if (model.apiKey) headers['Authorization'] = `Bearer ${model.apiKey}`;
        }

        const TIMEOUT_MS = 30_000;
        const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`[SemanticIndex] API request timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS),
        );
        const res = await Promise.race([
            requestUrl({ url, method: 'POST', headers, body: JSON.stringify(body), throw: true }),
            timeoutPromise,
        ]);

        const data: Array<{ embedding: number[]; index: number }> = res.json?.data;
        if (!data || !Array.isArray(data)) {
            throw new Error(
                `[SemanticIndex] Invalid batch embedding response from ${model.provider}: ` +
                `missing data array`,
            );
        }
        // API returns items sorted by index — sort to be safe
        data.sort((a, b) => a.index - b.index);
        return data.map((d) => d.embedding);
    }

    private async embedXenova(text: string): Promise<number[]> {
        // Yield to the event loop before WASM inference so Obsidian can process
        // pending UI events (paint, keyboard, etc.) before the CPU-heavy part.
        await this.sleep(50);
        const output = await this.pipeline(text, { pooling: 'mean', normalize: true });
        return Array.from(output.data as Float32Array);
    }

    private async loadPipeline(): Promise<void> {
        if (this.pipeline) return;
        const { pipeline } = await import('@xenova/transformers');
        this.pipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    // -----------------------------------------------------------------------
    // Checkpoint management
    // -----------------------------------------------------------------------

    private checkpointPath(): string {
        return path.join(this.indexDir, 'index-meta.json');
    }

    private newCheckpoint(modelKey: string): IndexCheckpoint {
        return {
            version: CHECKPOINT_VERSION,
            embeddingModel: modelKey,
            chunkSize: this.chunkSize,
            files: {},
            builtAt: new Date().toISOString(),
            docCount: 0,
        };
    }

    private async loadCheckpoint(): Promise<IndexCheckpoint | null> {
        try {
            const raw = await fs.promises.readFile(this.checkpointPath(), 'utf8');
            // M-1: Guard against corrupted or maliciously crafted checkpoint files.
            if (raw.length > 50_000_000) return null; // 50 MB sanity limit
            const cp = JSON.parse(raw) as any;
            if (cp?.version !== CHECKPOINT_VERSION) return null;
            if (typeof cp.embeddingModel !== 'string') return null;
            if (typeof cp.chunkSize !== 'number') return null;
            if (!cp.files || typeof cp.files !== 'object' || Array.isArray(cp.files)) return null;
            if (typeof cp.docCount !== 'number') return null;
            return cp as IndexCheckpoint;
        } catch {
            return null;
        }
    }

    private async saveCheckpoint(cp: IndexCheckpoint): Promise<void> {
        try {
            await fs.promises.mkdir(this.indexDir, { recursive: true });
            await fs.promises.writeFile(this.checkpointPath(), JSON.stringify(cp), 'utf8');
        } catch (e) {
            console.warn('[SemanticIndex] Failed to save checkpoint:', e);
        }
    }

    private modelKey(): string {
        return this.embeddingModel
            ? `${this.embeddingModel.provider}:${this.embeddingModel.name}`
            : 'xenova:all-MiniLM-L6-v2';
    }

    // -----------------------------------------------------------------------
    // File reading (Markdown + PDF)
    // -----------------------------------------------------------------------

    /**
     * Read a file's text content.
     * - Markdown/plaintext: uses vault.cachedRead (fast, cached)
     * - PDF: extracts text via pdf-parse (Node.js, no web worker needed)
     */
    private async readFileContent(file: { path: string; extension: string }): Promise<string> {
        if (file.extension === 'pdf') {
            return this.extractPdfText(file.path);
        }
        // For all other types (md, txt, canvas, …) use the vault cache
        const vaultFile = this.vault.getFileByPath(file.path);
        if (!vaultFile) return '';
        return this.vault.cachedRead(vaultFile);
    }

    /**
     * Extract plain text from a PDF using pdfjs-dist (browser-compatible, no test-file issue).
     * Runs without a web worker (fake-worker mode) so it works in Obsidian's bundled environment.
     * Returns empty string for encrypted, image-only, or unreadable PDFs.
     */
    private async extractPdfText(filePath: string): Promise<string> {
        if (this.pdfParseUnavailable) return '';

        try {
            // Dynamically import pdfjs-dist to avoid bundling its worker at startup.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const pdfjsLib: any = await import('pdfjs-dist');

            // Disable the web worker — pdfjs falls back to in-process (fake-worker) mode,
            // which works correctly in Obsidian's Electron renderer without a separate worker URL.
            if (pdfjsLib.GlobalWorkerOptions) {
                pdfjsLib.GlobalWorkerOptions.workerSrc = '';
            }

            const basePath = (this.vault.adapter as any).getBasePath?.() ?? '';
            const absPath = path.join(basePath, filePath);
            const data = new Uint8Array(await fs.promises.readFile(absPath));

            const loadingTask = pdfjsLib.getDocument({ data, useWorkerFetch: false });
            const pdf = await loadingTask.promise;

            const parts: string[] = [];
            for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                const page = await pdf.getPage(pageNum);
                const content = await page.getTextContent();
                const pageText = content.items
                    .map((item: any) => ('str' in item ? item.str : ''))
                    .join(' ')
                    .replace(/\s+/g, ' ')
                    .trim();
                if (pageText) parts.push(pageText);
            }
            return parts.join('\n\n');
        } catch (e: any) {
            const msg = String(e?.message ?? '');
            if (msg.includes('PasswordException') || msg.includes('InvalidPDFException')) {
                // Expected for encrypted or corrupt PDFs — don't log noise
                return '';
            }
            // Unexpected error — log once, trip circuit breaker for remaining files
            console.warn('[SemanticIndex] PDF extraction unavailable:', msg);
            this.pdfParseUnavailable = true;
            return '';
        }
    }

    // -----------------------------------------------------------------------
    // Chunking
    // -----------------------------------------------------------------------

    /**
     * Split Markdown text into semantically meaningful chunks.
     *
     * Strategy (matches Obsidian Copilot's approach):
     *  1. Strip YAML frontmatter
     *  2. If whole note fits → single chunk (no splitting needed)
     *  3. Split at Markdown headings (##, ###, …)
     *  4. For oversized sections: split at paragraph boundaries (\n\n)
     *  5. For oversized paragraphs: hard split at maxChars
     */
    private splitIntoChunks(text: string, maxChars: number): string[] {
        // Extract YAML frontmatter content — keep the key:value lines so that
        // IDs, tags, and other frontmatter fields are searchable, but discard
        // the --- delimiters which carry no semantic meaning.
        let frontmatterContent = '';
        const bodyText = text.replace(/^---\n([\s\S]*?)\n---\n?/, (_, fm: string) => {
            frontmatterContent = fm.trim();
            return '';
        }).trim();

        // Prepend frontmatter (if any) to the body so IDs/tags appear in chunk 0
        const stripped = frontmatterContent ? `${frontmatterContent}\n\n${bodyText}` : bodyText;
        if (!stripped) return [];
        if (stripped.length <= maxChars) return [stripped];

        // Split at heading boundaries (keep heading with its content)
        const sections = stripped.split(/(?=^#{1,6} )/m);
        const result: string[] = [];

        for (const section of sections) {
            const trimmed = section.trim();
            if (!trimmed) continue;

            if (trimmed.length <= maxChars) {
                result.push(trimmed);
                continue;
            }

            // Section too large → split on paragraphs
            const paragraphs = trimmed.split(/\n\n+/);
            let current = '';
            for (const para of paragraphs) {
                if (!para.trim()) continue;
                if (current && current.length + para.length + 2 > maxChars) {
                    result.push(current.trim());
                    current = '';
                }
                if (para.length > maxChars) {
                    // Hard-split giant paragraph at word boundaries
                    if (current.trim()) result.push(current.trim());
                    current = '';
                    let i = 0;
                    while (i < para.length) {
                        let chunk = para.slice(i, i + maxChars);
                        if (i + maxChars < para.length) {
                            const b = Math.max(chunk.lastIndexOf(' '), chunk.lastIndexOf('\n'));
                            if (b > maxChars * 0.7) chunk = chunk.slice(0, b);
                        }
                        const t = chunk.trim();
                        if (t) result.push(t);
                        i += chunk.length || 1;
                    }
                } else {
                    current = current ? current + '\n\n' + para : para;
                }
            }
            if (current.trim()) result.push(current.trim());
        }

        const filtered = result.filter((c) => c.length > 0);

        // Add overlap: prepend the last 10% of the previous chunk to each
        // subsequent chunk so content at boundaries is not lost.
        const OVERLAP = Math.round(maxChars * 0.1);
        return filtered.map((chunk, i) => {
            if (i === 0) return chunk;
            const prev = filtered[i - 1];
            const tail = prev.slice(-OVERLAP).trim();
            if (!tail) return chunk;
            // Avoid duplicating content if the chunk already starts with the tail
            if (chunk.startsWith(tail)) return chunk;
            return `…${tail}\n\n${chunk}`;
        });
    }
}
