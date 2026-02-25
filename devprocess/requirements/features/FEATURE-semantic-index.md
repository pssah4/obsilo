# FEATURE: Semantic Search & Index

**Status:** Implemented (replaces old requirements spec)
**Source:** `src/core/semantic/SemanticIndexService.ts`, `src/core/tools/vault/SemanticSearchTool.ts`

## Summary
Vector-based semantic search across the vault. Files are chunked, embedded via a local Xenova model or API, and stored in a Vectra HNSW index. Search queries are matched by meaning (not just keywords), with hybrid keyword fusion, HyDE, graph augmentation, and metadata filters.

## How It Works

### Index Storage
- Default (`obsidian-sync`): `.obsidian/plugins/obsidian-agent/semantic-index/` (syncs with Obsidian Sync)
- Local: `.obsidian-agent/semantic-index/` (device-only)
- Checkpoint file: `{indexDir}/index-meta.json` — tracks `mtime` per file for resumable incremental builds

### Chunking (Heading-Aware)
Files are split into chunks before embedding:
1. Split at Markdown headings (`#`, `##`, etc.) first
2. Fall back to paragraph splitting (`\n\n`) if sections are too large
3. Target chunk size: `semanticChunkSize` chars (default 2000)
4. Each chunk stored with metadata: `path`, `heading`, `chunkIndex`

### Embedding
- **Local (Xenova):** `@xenova/transformers` — ONNX runtime, downloads model once (~23-90MB), runs in Electron renderer
- **API:** OpenAI-compatible embedding endpoint (e.g., `text-embedding-3-small`)
- **Batch embedding:** Multiple texts per API call (10-50x fewer requests vs. one-at-a-time)
- Default model: `Xenova/all-MiniLM-L6-v2` (384 dimensions, English)

### Vector Store
- Library: `vectra` — pure TypeScript HNSW implementation
- Storage: `LocalIndex` at the index directory
- Each vector entry: `{ vector: float32[], metadata: { path, heading, chunkIndex, text } }`

### Indexing Process (`buildIndex()`)
1. Load checkpoint (`index-meta.json`)
2. Get all vault Markdown files (+ PDFs if `semanticIndexPdfs = true`)
3. Filter files changed since last index (by mtime comparison)
4. For each batch (`semanticBatchSize`, default 20 files):
   - Chunk each file
   - Embed all chunks in one batch API call
   - Upsert vectors into LocalIndex
   - Write checkpoint to disk
   - `setTimeout(0)` to yield event loop (prevent UI freeze)
5. Check cancel flag between batches (`cancelBuild()`)
6. Emit progress events for UI

**Resumable:** Interrupted builds continue from the last checkpoint on next run.

### Auto-Index Triggers
- `semanticAutoIndex`:
  - `'startup'` — rebuild on plugin load
  - `'mode-switch'` — rebuild when switching to a mode (if enabled)
  - `'never'` — manual only
- `semanticAutoIndexOnChange`: debounced (2s) re-index on vault modify/create/delete/rename events. Disabled by default (can cause lag with local models on large vaults).

### Search: SemanticSearchTool

**Parameters:**
- `query: string` — natural language query
- `top_k?: number` — results to return (default 5)
- `folder?: string` — filter to a subfolder
- `tags?: string[]` — filter by frontmatter tags
- `since?: string` — filter by modification date (`YYYY-MM-DD`)

**Search Pipeline:**

1. **HyDE (optional, `hydeEnabled = true`):**
   - Generate a "hypothetical document" via LLM call: "Write a short Obsidian note that would answer: {query}"
   - Embed the hypothetical document instead of the raw query
   - Cost: 1 extra LLM API call per search

2. **Semantic search:**
   - Embed the query (or HyDE document)
   - `vectra.queryItems(queryVector, top_k * 3)` — over-fetch for post-filtering

3. **Keyword search (hybrid) — TF-IDF with stemming:**
   - Tokenization with word boundaries (splits hyphens, underscores, punctuation)
   - Lightweight suffix stemmer (English + German morphology)
   - TF-IDF scoring: `sum(TF * IDF)` per stemmed query term
   - IDF provides language-agnostic stop-word handling (no hardcoded list)
   - Compound-word splitting: "Meeting-Notiz" → ["meeting", "notiz"]
   - Returns top_k candidates, best chunk per file

4. **Reciprocal Rank Fusion (RRF):**
   - Merge semantic + keyword rankings: `score += 1 / (k + rank)` where `k=60`
   - Deduplicate by path

5. **Metadata filtering:**
   - `folder` → path starts-with filter
   - `tags` → frontmatter tags intersection
   - `since` → file modification time >= date

6. **Graph augmentation (1-hop):**
   - For each result: fetch outgoing wikilinks via `MetadataCache.resolvedLinks`
   - If linked note is NOT already in results: add it as a lower-scored bonus result
   - Capped to `top_k` total results

7. **Excerpt truncation:**
   - Each result chunk truncated to 500 chars
   - Returns: `path`, `score`, `excerpt`, `heading`

### PDF Support
When `semanticIndexPdfs = true`: extracts text from PDF files using `pdfjs-dist` before chunking. Requires the PDF.js library to be bundled.

## Key Files
- `src/core/semantic/SemanticIndexService.ts` — full service (~43KB)
- `src/core/tools/vault/SemanticSearchTool.ts` — 251 lines, full search pipeline
- `src/ui/settings/EmbeddingsTab.ts` — model config UI
- `src/ui/settings/VaultTab.ts` — index settings

## Dependencies
- `vectra` npm package — HNSW vector index
- `@xenova/transformers` — local embedding models (ONNX)
- `pdfjs-dist` — PDF text extraction (when `semanticIndexPdfs = true`)
- `AgentTask.api` — used for HyDE generation
- `app.metadataCache.resolvedLinks` — graph augmentation
- `ObsidianAgentPlugin.semanticIndexService` — singleton

## Configuration
| Key | Default | Description |
|-----|---------|-------------|
| `enableSemanticIndex` | false | Master toggle |
| `activeEmbeddingModelKey` | `''` | Active embedding model |
| `semanticChunkSize` | 2000 | Target chars per chunk |
| `semanticBatchSize` | 20 | Files per disk commit |
| `semanticAutoIndex` | `'never'` | Auto-rebuild trigger |
| `semanticAutoIndexOnChange` | false | Re-index on file changes |
| `semanticExcludedFolders` | `[]` | Folders to skip |
| `semanticStorageLocation` | `'obsidian-sync'` | Index storage location |
| `semanticIndexPdfs` | false | Include PDF files |
| `semanticChunkSize` | 2000 | Chars per chunk |
| `hydeEnabled` | false | HyDE query expansion |

## Known Limitations / Edge Cases
- Changing `semanticChunkSize` or the embedding model requires a full rebuild (vectors are incompatible).
- `vectra` HNSW index loads entirely into memory — very large vaults (>10k notes) may cause high RAM usage.
- `semanticAutoIndexOnChange` with a local embedding model (Xenova) can cause noticeable Obsidian lag on save.
- HyDE adds a full LLM round-trip per search — increases latency by 2-5 seconds.
- Keyword search is a live scan (not indexed) — slow on large vaults for the keyword component.
- Graph augmentation can surface loosely related notes via wikilinks — adds noise if vault is densely linked.
- PDF extraction quality depends on PDF structure — scanned PDFs (image-based) produce no text.
