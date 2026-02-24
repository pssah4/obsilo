# Semantic Search — Technical Documentation

Source files:
- `src/core/semantic/SemanticIndexService.ts`
- `src/core/tools/vault/SemanticSearchTool.ts`

---

## 1. SemanticIndexService Architecture

### Class Structure

`SemanticIndexService` is the central class that manages the vector index, embedding
pipeline, chunking, keyword search, and incremental build/update operations.

**Constructor parameters:**
- `vault: Vault` — Obsidian vault instance for file access
- `pluginDir: string` — Plugin directory path (e.g. `.obsidian/plugins/obsidian-agent`)
- `options: SemanticIndexOptions` — Configuration overrides

**Key instance fields:**
| Field | Type | Purpose |
|-------|------|---------|
| `index` | `LocalIndex` | Vectra HNSW vector index instance |
| `indexDir` | `string` | Absolute filesystem path where the index is stored |
| `pipeline` | `any` | Xenova transformers pipeline (lazy-loaded) |
| `isBuilding` | `boolean` | Guard flag to prevent concurrent builds |
| `cancelled` | `boolean` | Set by `cancelBuild()`, checked between file batches |
| `checkpoint` | `IndexCheckpoint \| null` | In-memory copy of the mtime-based checkpoint |
| `embeddingModel` | `CustomModel \| null` | API embedding model; null = use local Xenova |
| `autoUpdateQueue` | `Set<string>` | File paths queued for incremental re-indexing |
| `docCount` | `number` | Number of unique files indexed (live counter) |

**State management:**
- `isIndexed` (getter): true when `builtAt` is set (index has been built at least once)
- `building` (getter): true during an active build
- `progressIndexed` / `progressTotal`: live counters polled by the Settings UI

### Public API

| Method | Description |
|--------|-------------|
| `initialize()` | Pre-warms the embedding pipeline and restores state from checkpoint |
| `buildIndex(onProgress?, force?)` | Full or incremental index build |
| `cancelBuild()` | Sets the `cancelled` flag; partial progress is saved |
| `search(query, topK, textForEmbedding?)` | Semantic vector search with per-file deduplication |
| `keywordSearch(query, topK)` | TF-IDF keyword search over all indexed chunks |
| `updateFile(filePath)` | Incrementally re-index a single file |
| `removeFile(filePath)` | Remove all chunks for a file from the index |
| `queueAutoUpdate(filePath)` | Queue a file for sequential background re-indexing |
| `indexSessionSummary(sessionId, content)` | Index a session summary (tagged `source='session'`) |
| `searchSessions(query, topK)` | Search only session-tagged items |
| `getChunksByPath(filePath)` | Return all indexed chunks for a file, sorted by chunk order |
| `deleteIndex()` | Delete the on-disk index and reset all state |
| `configure(options)` | Live-update configuration without re-instantiating |
| `setEmbeddingModel(model)` | Switch between API and local Xenova embedding |

---

## 2. Vectra LocalIndex

The service uses the `vectra` npm package, which provides a `LocalIndex` backed by an
HNSW (Hierarchical Navigable Small World) graph stored on the local filesystem.

**Index storage location (configurable):**
- `obsidian-sync` (default): `{vaultBase}/{pluginDir}/semantic-index/`
- `local`: `{vaultBase}/.obsidian-agent/semantic-index/`

**Item structure** — each item inserted into vectra contains:
```typescript
{
    vector: number[],          // embedding vector
    metadata: {
        path: string,          // vault file path (e.g. "Notes/meeting.md")
                               //   or "session:{id}" for session summaries
        chunk: string,         // the original text chunk
        chunkIndex: number,    // position of this chunk in the file (0-based)
        source?: 'session',    // present only for session summary items
    }
}
```

**Query signature:** `index.queryItems(vector, textQuery, topK)` — vectra uses the
vector for cosine similarity and the text query for internal text-ranking. Results are
returned sorted by score descending.

**Per-file deduplication during search:** The `search()` method requests `min(topK * 3, 60)`
raw results from vectra, then keeps only the best-scored chunk per unique file path,
returning at most `topK` unique files.

---

## 3. Embedding Pipeline

Two embedding paths are supported, selected via `setEmbeddingModel()`:

### Local Xenova Pipeline (default when no API model configured)
- Model: `Xenova/all-MiniLM-L6-v2` (384-dimensional embeddings)
- Loaded lazily via dynamic `import('@xenova/transformers')`
- Pooling: `mean`, normalization enabled
- Texts are embedded sequentially (not batched) to avoid OOM on long notes
- A 50ms sleep before each inference yields the event loop to prevent UI freeze

### API Embedding (OpenAI-compatible)
- Supports providers: `openai`, `azure`, `openrouter`, `ollama`, `lmstudio`, custom
- Batch embedding: texts are sent in groups of `embeddingBatchSize` (default: 16) per
  HTTP request, reducing API calls by 10-50x
- Retry logic: exponential backoff (1s, 2s, 4s, 8s) on HTTP 429 rate-limit responses,
  up to 4 retries
- 30-second timeout per request via `Promise.race`
- 50ms throttle pause between batches

**Model key format** for checkpoint tracking: `{provider}:{modelName}` or
`xenova:all-MiniLM-L6-v2` for the local pipeline. A model change triggers a full rebuild.

---

## 4. Heading-Aware Chunking

The `splitIntoChunks(text, maxChars)` method splits Markdown text into semantically
meaningful chunks. Default `maxChars` is 2000 characters.

**Algorithm (5-stage):**

1. **Strip YAML frontmatter** — The `---` delimiters are removed, but the key-value
   content is preserved and prepended to the body so that tags, IDs, and other
   frontmatter fields appear in chunk 0.

2. **Single-chunk optimization** — If the entire text (with frontmatter) fits within
   `maxChars`, return it as a single chunk.

3. **Heading split** — Split at Markdown heading boundaries (`# `, `## `, etc.) using
   `(?=^#{1,6} )` regex. Each heading stays attached to its content.

4. **Paragraph split** — For sections exceeding `maxChars`, split at paragraph
   boundaries (`\n\n+`). Paragraphs are accumulated until adding the next would exceed
   the limit.

5. **Hard split** — For oversized paragraphs, split at word boundaries within
   `maxChars`. The split point is chosen at the last space/newline within 70% of the
   chunk size to avoid breaking mid-word.

**Overlap:** After splitting, each chunk (except the first) gets 10% of the previous
chunk's tail prepended with an ellipsis prefix (`...{tail}\n\n{chunk}`). This ensures
content at chunk boundaries is not lost during search. Duplication is avoided if the
chunk already starts with the tail text.

---

## 5. Hybrid Search

`SemanticSearchTool.execute()` runs semantic and keyword search in parallel, then fuses
results via Reciprocal Rank Fusion.

```typescript
const [semanticResults, keywordResults] = await Promise.all([
    semanticIndex.search(query, searchK, hydeText),
    semanticIndex.keywordSearch(query, searchK),
]);
```

The `searchK` is inflated beyond the final `topK` to compensate for per-file
deduplication and post-search filtering. With active metadata filters:
`min(topK * 4, 80)`. Without filters: `min(topK * 3, 40)`.

**Post-search metadata filters** (applied after fusion):
- `folder`: prefix match on file path
- `tags`: checks Obsidian's `metadataCache` frontmatter tags (any-match)
- `since`: file modification time threshold (ISO date)

Each result is tagged with its retrieval method: `'semantic'`, `'keyword'`, or `'hybrid'`
(when found by both).

---

## 6. BM25/TF-IDF with Stemming

The `keywordSearch()` method implements a TF-IDF scoring algorithm with stemming
over all indexed chunks.

### Tokenization (`tokenize()`)
- Lowercases the input text
- Splits on word boundaries: whitespace, hyphens, underscores, slashes, punctuation
  (`/[\s\-_/,.;:!?()\[\]{}"'\`|@#=+*<>~^]+/`)
- Filters tokens shorter than 3 characters
- Applies stemming to each token

### Stemmer (`stemWord()`)
A lightweight suffix stemmer handling common English and German inflectional suffixes.
No external dependency — intentionally simple to avoid over-stemming.

**Suffix rules (ordered longest-first to avoid partial matches):**

| Suffix | Min length | Action | Example |
|--------|-----------|--------|---------|
| `-ings` | >6 | remove | "meetings" -> "meet" |
| `-tion` | >6 | replace with `t` | "creation" -> "creat" |
| `-ness` | >6 | remove | "darkness" -> "dark" |
| `-ment` | >6 | remove | "movement" -> "move" |
| `-able` | >6 | remove | "readable" -> "read" |
| `-keit` | >6 | remove (German) | "Faehigkeit" -> "Faehig" |
| `-heit` | >6 | remove (German) | "Freiheit" -> "Frei" |
| `-lich` | >6 | remove (German) | "freundlich" -> "freund" |
| `-isch` | >6 | remove (German) | "historisch" -> "histor" |
| `-ies` | >4 | replace with `y` | "stories" -> "story" |
| `-ful` | >5 | remove | "helpful" -> "help" |
| `-ung` | >5 | remove (German) | "Planung" -> "Plan" |
| `-ing` | >5 | remove | "running" -> "runn" |
| `-ed` | >4 | remove | "created" -> "creat" |
| `-es` | >4 | remove | "boxes" -> "box" |
| `-er` | >4 | remove | "builder" -> "build" |
| `-en` | >4 | remove (German) | "schreiben" -> "schreib" |
| `-s` | >3 (not -ss) | remove | "notes" -> "note" |

### Scoring Algorithm

1. **Tokenize + stem** the query, deduplicate terms
2. **Load all indexed chunks** via `listItemsByMetadata({})`
3. **Compute document frequency (DF)** for each query term across all chunks
4. **Compute IDF** per term: `log((N + 1) / (df + 1))` where N = total chunk count.
   IDF naturally downweights frequent words regardless of language (no stop-word list).
5. **Score each chunk**: `sum(TF * IDF)` for all matching query terms. TF is the raw
   count of the stemmed term in the chunk's token list.
6. **Per-file deduplication**: keep only the best-scoring chunk per file path
7. **Normalize** scores to 0-1 range (divide by max score), sort descending, return topK

---

## 7. RRF Fusion (k=60)

Reciprocal Rank Fusion merges the ranked lists from semantic search and keyword search
into a single unified ranking.

**Formula:**
```
score(document) = sum( 1 / (k + rank_i) )
```
where `k = 60` and `rank_i` is the 1-based position in each result list.

**Implementation:**
1. Iterate semantic results: for each file path, compute `1 / (60 + rank)`. Store as
   initial RRF score with method `'semantic'`.
2. Iterate keyword results: for each file path, compute `1 / (60 + rank)`.
   - If the path already exists (from semantic), ADD the RRF score and change method
     to `'hybrid'`.
   - Otherwise, store as new entry with method `'keyword'`.
3. Sort all entries by fused RRF score descending.
4. Apply metadata filters (folder, tags, since), then truncate to `topK`.

Documents appearing in both lists naturally float to the top because their RRF scores
are summed.

---

## 8. HyDE (Hypothetical Document Expansion)

When `settings.hydeEnabled === true` and an API handler is available, the tool generates
a hypothetical document before embedding:

1. The LLM receives a prompt: "Write a 2-3 sentence Obsidian note excerpt that would
   directly answer this question: {query}"
2. System message: "You are a document generator for an Obsidian vault."
3. The generated text is passed as `textForEmbedding` to `semanticIndex.search()`.
4. The original `query` is still used for vectra's internal text-ranking and for
   keyword search.

HyDE is best-effort: any LLM error silently falls back to raw query embedding.

**Rationale:** Embedding a hypothetical answer gives the embedding model a much richer
semantic signal than a short question. The hypothetical document lives in the same
"space" as actual vault content, improving recall for conceptual queries.

---

## 9. Graph Augmentation (1-hop Wikilink Expansion)

After hybrid search returns the top-K results, the tool performs 1-hop wikilink
expansion:

1. Parse `[[wikilinks]]` from each result's excerpt using the regex
   `/\[\[([^\]|#\n]+?)(?:[|#][^\]]*?)?\]\]/g`
2. For each linked note NOT already in the top-K result set:
   - Resolve the link via `app.metadataCache.getFirstLinkpathDest()`
   - Load the first indexed chunk via `semanticIndex.getChunksByPath()`
   - Append as "Linked context" in the output
3. Maximum 5 linked notes are included.
4. Output is labeled: "Connected via [[wikilinks]] -- relevant by association, not
   semantic match"

This surfaces intentionally connected notes that may not have matched semantically
or via keywords.

---

## 10. Incremental Build

### Checkpoint File: `{indexDir}/index-meta.json`

```typescript
interface IndexCheckpoint {
    version: 1,
    embeddingModel: string,    // e.g. "openai:text-embedding-3-small"
    chunkSize: number,         // e.g. 2000
    files: Record<string, {    // keyed by vault file path
        mtime: number,         // file modification time at indexing
        chunks: number,        // number of chunks generated
    }>,
    builtAt: string,           // ISO timestamp
    docCount: number,          // total unique files indexed
}
```

### Build Algorithm

1. **Determine file list**: All markdown files + optionally PDFs, minus excluded folders.
2. **Load checkpoint**: Detect model change or chunk size change. Either triggers a full
   rebuild (existing index is deleted and recreated).
3. **Diff against checkpoint**: Files needing (re)indexing are those where
   `stored.mtime < file.stat.mtime` or not present in the checkpoint.
4. **Phase A** (incremental only): Delete old chunks for modified files using
   `listItemsByMetadata({ path })` + `deleteItem()`.
5. **Phase B**: For each file, read content, chunk, batch-embed, insert into vectra.
   Every `batchSize` files (default: 20), commit to disk via `endUpdate()`, save
   checkpoint, yield the event loop via `setTimeout(0)`, then `beginUpdate()` again.
6. **Cancellation**: The `cancelled` flag is checked between files. On cancel, partial
   progress is saved to the checkpoint.
7. **Error handling**: Individual file failures are logged and skipped (error counter).
   Fatal failures close the vectra transaction to prevent index corruption.

### Auto-Update Queue

`queueAutoUpdate(filePath)` adds a file to a `Set<string>` and triggers sequential
processing. The queue:
- Deduplicates: multiple events for the same file before processing = single re-index
- Concurrency = 1: prevents concurrent embedding calls from freezing Obsidian
- 2-second pause between files to let the Electron renderer process UI events

---

## 11. PDF Support

PDF indexing is opt-in via `options.indexPdfs` (default: `false`).

**Extraction pipeline:**
1. Dynamic import of `pdfjs-dist` (browser-compatible, no web worker)
2. Web worker disabled: `GlobalWorkerOptions.workerSrc = ''` (fake-worker mode)
3. Read the PDF as `Uint8Array` from the filesystem
4. Extract text page by page via `page.getTextContent()`
5. Join page texts with `\n\n` separators

**Circuit breaker:** On the first fatal import or parse error, `pdfParseUnavailable` is
set to `true`, disabling PDF extraction for all remaining files in the build. This
prevents repeated error logging for environments where pdfjs-dist is unavailable.

Encrypted (`PasswordException`) and corrupt (`InvalidPDFException`) PDFs silently
return empty strings without tripping the circuit breaker.

---

## 12. Configuration

All settings with defaults:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `batchSize` | number | 20 | Files processed between disk commits |
| `embeddingBatchSize` | number | 16 | Texts per API embedding request |
| `excludedFolders` | string[] | [] | Folder paths to skip during indexing |
| `storageLocation` | `'obsidian-sync' \| 'local'` | `'obsidian-sync'` | Where to store the index on disk |
| `indexPdfs` | boolean | false | Whether to include PDF files in the index |
| `chunkSize` | number | 2000 | Characters per chunk (change forces full rebuild) |
| `hydeEnabled` | boolean | false | Enable Hypothetical Document Expansion |
| `embeddingModel` | `CustomModel \| null` | null | API embedding model; null = local Xenova |

**Changing `chunkSize` or `embeddingModel`** invalidates the existing checkpoint and
triggers a full rebuild on the next `buildIndex()` call.
