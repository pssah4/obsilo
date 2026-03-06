# CrewAI Memory System -- Research Summary

> Research date: 2026-02-20
> Purpose: Evaluate CrewAI's memory architecture as reference for Obsidian Agent memory design

---

## 1. Memory Types

CrewAI provides **five memory types** (plus one compositional layer):

| Type | Persistence | Storage Backend | Purpose |
|------|------------|----------------|---------|
| **Short-Term Memory** | Session only | ChromaDB (vector) | Current execution context, recent interactions |
| **Long-Term Memory** | Cross-session | SQLite3 | Task results, quality scores, institutional knowledge |
| **Entity Memory** | Session | ChromaDB (vector) | Structured tracking of people, places, concepts |
| **Contextual Memory** | Compositional | Aggregates STM + LTM + Entity | Synthesizes all memory types into task context |
| **External Memory** | Cross-session | Mem0, custom backends | Third-party integrations (replaces deprecated UserMemory) |
| **User Memory** (deprecated) | Cross-session | External DB | Per-user preferences and interaction patterns |

### Evolution Note (2025+)

The latest CrewAI docs describe a **unified Memory class** that collapses the separate types into a single class with:
- **LanceDB** as default vector store (replacing ChromaDB)
- **Hierarchical scope paths** (filesystem-like: `/project/alpha`, `/agent/researcher`)
- **Composite scoring** blending semantic similarity, recency decay, and importance
- **LLM-assisted encoding** for automatic categorization and importance scoring

This appears to be a newer API that coexists with the legacy four-type system. The legacy system (ChromaDB + SQLite) remains the documented default for most users.

---

## 2. Storage Architecture

### 2.1 Short-Term Memory (RAGStorage + ChromaDB)

```
Storage: ChromaDB (chroma.sqlite3 in working directory)
Embeddings: Configurable (default: OpenAI text-embedding-3-small)
Lock files: chromadb-*.lock for concurrent access
```

**RAGStorage class** wraps ChromaDB with:
- `save(value, metadata)` -- embeds and stores content
- `search(query, score_threshold=0.35)` -- semantic similarity search
- `reset()` -- clears the collection

**ShortTermMemory** wraps RAGStorage:
```python
class ShortTermMemory(Memory):
    def __init__(self, crew=None, embedder_config=None):
        storage = RAGStorage(type="short_term",
                           embedder_config=embedder_config, crew=crew)
        super().__init__(storage)

    def save(self, value, metadata=None, agent=None):
        item = ShortTermMemoryItem(data=value, metadata=metadata, agent=agent)
        super().save(value=item.data, metadata=item.metadata, agent=item.agent)

    def search(self, query, score_threshold=0.35):
        return self.storage.search(query=query, score_threshold=score_threshold)
```

### 2.2 Long-Term Memory (SQLite)

```
Storage: SQLite at {db_storage_path()}/long_term_memory.db
No embeddings -- uses exact task_description matching
```

**SQLite schema:**
```sql
CREATE TABLE IF NOT EXISTS long_term_memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_description TEXT,
    metadata TEXT,       -- JSON: {agent, expected_output, quality, suggestions}
    datetime TEXT,       -- Unix timestamp
    score REAL           -- Quality score from task evaluation
)
```

**LTMSQLiteStorage** methods:
- `save(task_description, metadata, datetime, score)` -- INSERT
- `load(task_description, latest_n=3)` -- SELECT by exact task match, ORDER BY datetime DESC + score ASC
- `reset()` -- DROP + recreate

Key: LTM does **not** use embeddings. It matches on exact task descriptions and returns the latest N results. The metadata stores quality assessments and suggestions from task evaluation.

### 2.3 Entity Memory (RAGStorage + ChromaDB)

Same ChromaDB backend as STM but with `type="entities"`:
```python
class EntityMemory(Memory):
    def __init__(self, crew=None, embedder_config=None):
        storage = RAGStorage(type="entities", allow_reset=False,
                           embedder_config=embedder_config, crew=crew)
        super().__init__(storage)

    def save(self, item: EntityMemoryItem):
        data = f"{item.name}({item.type}): {item.description}"
        super().save(data, item.metadata)
```

**EntityMemoryItem** data model:
```python
class EntityMemoryItem:
    name: str           # "John Smith"
    type: str           # "person"
    description: str    # "Lead engineer on Project Alpha"
    relationships: str  # stored in metadata["relationships"]
```

### 2.4 External Memory (Mem0 / Custom)

- Replaces deprecated `UserMemory`
- Does **not** support default initialization -- must be explicitly provided
- Uses `Mem0Storage` as reference implementation
- Supports custom storage providers implementing the Storage interface

### 2.5 Unified Memory (newer API)

```
Storage: LanceDB at ./.crewai/memory/
Embeddings: Configurable (11+ providers)
```

**MemoryRecord** schema:
```python
{
  "content": str,
  "scope": str,           # hierarchical path, e.g. "/project/alpha"
  "categories": list[str],
  "importance": float,     # 0 to 1
  "created_at": datetime,
  "updated_at": datetime,
  "source": str,           # provenance tag, e.g. "user:alice"
  "private": bool,         # access control
  "embedding": list[float],
  "metadata": dict         # entities, dates, topics
}
```

---

## 3. How Memory Gets Populated

### 3.1 Automatic Population (after each task)

When `memory=True` on the Crew, memory is populated automatically at two points:

**A) After each task execution:**
1. Task output is saved to **Short-Term Memory** with metadata including the agent name
2. Entities mentioned in the output are extracted and saved to **Entity Memory**
3. Task results (with quality scores) are saved to **Long-Term Memory**

**B) Task-level extraction (unified API):**
- `extract_memories()` is called on task output
- LLM parses raw content into discrete atomic facts
- Example: Meeting notes become individual statements like "Migration from MySQL to PostgreSQL planned for next quarter"

### 3.2 Manual Population

- Direct `remember()` calls with explicit content
- `remember_many()` for batch operations (background thread, non-blocking)

### 3.3 Quality Scoring (LTM-specific)

Long-Term Memory items include a `score` field from task evaluation. This is an LLM-generated quality assessment of the task output, stored alongside the result for future reference.

---

## 4. How Memory Is Retrieved and Injected

### 4.1 The ContextualMemory Layer

The key integration point is `ContextualMemory.build_context_for_task()`:

```python
class ContextualMemory:
    def __init__(self, stm, ltm, em):
        self.stm = stm
        self.ltm = ltm
        self.em = em

    def build_context_for_task(self, task, context) -> str:
        query = f"{task.description} {context}".strip()
        if query == "":
            return ""
        context_list = []
        context_list.append(self._fetch_ltm_context(task.description))
        context_list.append(self._fetch_stm_context(query))
        context_list.append(self._fetch_entity_context(query))
        return "\n".join(filter(None, context_list))
```

**Retrieval per type:**
- **STM**: Semantic search (ChromaDB vector similarity) against query
- **LTM**: Exact task description match, returns latest N results with quality scores
- **Entity**: Semantic search for entities related to the query

### 4.2 Prompt Injection

1. Before each task, `build_context_for_task()` is called
2. The returned context string is injected via the **i18n system's "memory" slice**
3. This ensures consistent formatting across locales
4. The context is appended to the task prompt if non-empty

### 4.3 Unified API Retrieval (newer)

Two retrieval depths:

**Shallow mode (~200ms, no LLM calls):**
- Direct vector search with composite scoring

**Deep mode (default):**
1. Query analysis (LLM extracts keywords, time hints, scopes)
2. Scope selection
3. Parallel vector search across relevant scopes
4. Confidence-based routing
5. Optional recursive exploration when confidence is low

**Composite scoring formula:**
```
composite = semantic_weight * similarity
          + recency_weight * decay
          + importance_weight * importance

where:
  similarity = 1 / (1 + distance)        # 0 to 1
  decay = 0.5^(age_days / half_life_days) # exponential decay
  importance = record.importance           # 0 to 1
```

Default weights: semantic=0.5, recency=0.3, importance=0.2

---

## 5. Cross-Session Behavior

### Legacy System
- **STM**: Cleared after each `Crew.kickoff()` session
- **LTM**: Persists in SQLite across all sessions
- **Entity Memory**: Session-scoped (cleared between runs)
- **External Memory**: Fully persistent (Mem0 or custom backend)

### Unified API
- All memories persist in LanceDB on disk
- `memory.reset()` clears all scopes or a specific subtree
- `CREWAI_STORAGE_DIR` env var overrides default storage location
- Multiple Memory instances use serialized locking for concurrent access
- `drain_writes()` ensures background saves complete before reads

### Memory Consolidation (deduplication)

When saving, the pipeline checks for similar existing records:
- Above similarity threshold 0.85: LLM decides to keep, update, delete, or insert_new
- Intra-batch dedup at cosine similarity >= 0.98 (no LLM, pure vector math)
- Prevents duplicate accumulation over time

---

## 6. Configuration

### Basic Setup
```python
crew = Crew(
    agents=[...],
    tasks=[...],
    memory=True,          # enables default STM + LTM + Entity
    embedder={
        "provider": "openai",
        "config": {"model": "text-embedding-3-small"}
    }
)
```

### Custom Storage Backends
```python
crew = Crew(
    memory=True,
    long_term_memory=LongTermMemory(
        storage=LTMSQLiteStorage(db_path="custom_ltm.db")
    ),
    short_term_memory=ShortTermMemory(
        embedder_config={"provider": "ollama", "config": {"model": "mxbai-embed-large"}}
    ),
    entity_memory=EntityMemory(
        storage=RAGStorage(type="entities", embedder_config=...)
    ),
    external_memory=ExternalMemory(
        storage=Mem0Storage(config={...})
    )
)
```

### Supported Embedder Providers
OpenAI, Ollama, Azure OpenAI, Google Generative AI, Vertex AI, Cohere, HuggingFace, Watson, and more (11+ providers).

### Storage Locations (default)
- macOS: `~/Library/Application Support/CrewAI/{project_name}/`
- Linux: `~/.local/share/CrewAI/{project_name}/`
- Windows: `C:\Users\{username}\AppData\Local\CrewAI\{project_name}\`

Subdirectories: `knowledge/`, `short_term/`, `long_term/`, `entities/`

---

## 7. Key Architectural Decisions

1. **Separation of concerns**: Each memory type has a distinct storage backend optimized for its access pattern (vector search for semantic recall, SQL for structured historical data).

2. **Compositional Contextual Memory**: Rather than accessing memories individually, the ContextualMemory layer aggregates all types into a single context string per task.

3. **Automatic population**: Memory saving is a side effect of task execution -- no explicit agent action required.

4. **Quality scoring for LTM**: Task outputs are evaluated for quality, enabling future retrieval to prioritize high-quality historical results.

5. **Storage interface abstraction**: All storage backends implement `save()`, `search()`/`load()`, and `reset()`, allowing custom backends.

6. **Evolution toward unified model**: The newer Memory class with LanceDB, scopes, and composite scoring represents a more sophisticated approach, consolidating the separate types into one flexible system.

---

## 8. Relevance for Obsidian Agent

### What to adopt:
- **Contextual Memory pattern**: Aggregating multiple memory sources into a single context injection per task/turn
- **Automatic extraction**: Saving memories as a side effect of task completion
- **Composite scoring**: Blending semantic similarity with recency and importance
- **Storage abstraction**: Interface-based backends for flexibility
- **Memory consolidation**: Deduplication to prevent memory bloat

### What to adapt:
- **Vector store**: We already have vectra (SemanticIndexService) -- no need for ChromaDB/LanceDB
- **LTM storage**: Obsidian vault files are the natural persistent store, not SQLite
- **Scope hierarchy**: Could map to vault folder structure
- **Embeddings**: Already configurable in our system

### Key difference:
CrewAI's memory is **crew/task-scoped** (multi-agent workflow context), while Obsidian Agent needs **conversation-scoped** memory (chat sessions with a single agent that may spawn subtasks). The ContextualMemory pattern of aggregating STM + LTM + Entity into a single context string before each turn is directly applicable.
