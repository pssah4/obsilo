# FEATURE: Memory, Chat History & Personalization

**Status:** Complete (All Phases)
**Epic:** Cross-Session Awareness
**Sources:** CrewAI Memory, OpenClaw Memory, Claude Code Session Memory, ChatGPT Memory, Mem0
**ADR:** [ADR-007 — Event Separation](../../_private/architecture/ADR-007-event-separation.md)

## Summary

Persistent memory system that gives Obsilo awareness across sessions. Three pillars:
1. **Chat History** — stored conversations with compact history browser
2. **Memory** — short-term (session summaries) and long-term (user knowledge, patterns, preferences)
3. **Onboarding** — frictionless first-contact flow to bootstrap the user profile

The agent becomes more personal and context-aware over time by automatically extracting knowledge from conversations and maintaining structured memory files.

### Design Constraints (Performance & Cost)

- **Zero UX impact**: All memory extraction runs as fire-and-forget background process. The user must never notice delays or blocking.
- **Dedicated memory model**: A separate cheap model (e.g., Haiku) handles all extraction LLM calls. Configured via `memoryModelKey` in settings — dropdown picks from already-configured models.
- **Extraction threshold**: Configurable via slider in Memory settings (default: 6 messages). Only conversations meeting the threshold are queued for extraction.
- **Queue persistence**: Pending extractions saved to `pending-extractions.json`. Survives Obsidian restarts.
- **Retrieval is free**: Memory retrieval at session start = file reads + optional vector search. No LLM calls.
- **No cost display**: Extraction costs are negligible with a cheap model.

---

## Architecture Overview

### Storage Layout

```
.obsidian/plugins/obsidian-agent/
├── history/                          # Chat History
│   ├── index.json                    # Conversation index (id, title, created, updated, messageCount)
│   ├── 2026-02-20-a1b2c3.json       # Individual conversation (full messages)
│   └── ...
├── memory/                           # Long-Term Memory
│   ├── user-profile.md               # Identity, preferences, communication style
│   ├── projects.md                   # Active projects, goals, context
│   ├── patterns.md                   # Behavioral patterns, common requests, style preferences
│   ├── knowledge.md                  # Domain knowledge, expertise areas
│   └── sessions/                     # Short-Term / Session Memory
│       ├── 2026-02-20-a1b2c3.md      # Session summary (linked to history conversation)
│       └── ...
├── pending-extractions.json          # Persistent extraction queue
└── semantic-index/                   # (existing) Vectra index
```

### Memory Types

| Type | Scope | Storage | Loaded Into Context | Populated By |
|------|-------|---------|---------------------|--------------|
| **Working Memory** | Current session | In-context messages | Always (is the conversation) | User + Agent |
| **Session Memory** | Per conversation | `memory/sessions/*.md` | On demand (semantic search) | Auto-extraction at end of conversation |
| **User Profile** | Permanent | `memory/user-profile.md` | Always (system prompt) | Onboarding + auto-extraction |
| **Project Memory** | Permanent | `memory/projects.md` | Always (system prompt) | Auto-extraction |
| **Pattern Memory** | Permanent | `memory/patterns.md` | Always (system prompt) | Auto-extraction (after N sessions) |
| **Knowledge Memory** | Permanent | `memory/knowledge.md` | On demand (semantic search) | Auto-extraction |

### Context Injection Strategy

At session start, the system prompt includes:
1. **User Profile** (always, ~200 tokens max) — name, role, style preferences
2. **Project Memory** (always, ~300 tokens max) — active projects, current goals
3. **Pattern Memory** (always, ~200 tokens max) — known preferences, refinement patterns
4. **Relevant Session Summaries** (if available, ~500 tokens max) — semantic search over past sessions using the first user message as query

Total memory budget: ~1200 tokens in system prompt. Knowledge memory is retrieved on demand via semantic_search.

---

## Component 1: Chat History

### Conversation Lifecycle

1. **New Chat** — creates a new conversation entry in `index.json`
2. **During Chat** — messages saved to the conversation JSON file after each agent task
3. **Auto-Title** — after the first assistant response, generate a title via LLM (short, 3-8 words)
4. **End** — when user starts a new chat or closes Obsidian, trigger session memory extraction (if threshold met)

### Data Model

```typescript
interface ConversationMeta {
    id: string;                // "2026-02-20-a1b2c3"
    title: string;
    created: string;           // ISO 8601
    updated: string;
    messageCount: number;
    mode: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
}

interface ConversationData {
    meta: ConversationMeta;
    messages: MessageParam[];  // full API-level (tool_use, tool_result preserved)
    uiMessages: UiMessage[];   // display-level (text only, for rendering)
}

interface UiMessage {
    role: 'user' | 'assistant';
    text: string;
    ts: string;
}
```

### ConversationStore (`src/core/history/ConversationStore.ts`)

Persistence layer with in-memory index for fast listing:
- `initialize()` — ensure dir, load/create index
- `create(mode, model)` — new conversation entry
- `save(id, messages, uiMessages)` — write full conversation
- `updateMeta(id, patch)` — update title, tokens, etc.
- `load(id)` — load full conversation
- `list()` — return cached in-memory index (no disk I/O)
- `delete(id)` / `deleteAll()`

Storage: `.obsidian/plugins/obsidian-agent/history/` (index.json + {id}.json)

### History UI (`src/ui/sidebar/HistoryPanel.ts`)

- **Button**: Lucide `history` icon, placed left of the "New Chat" button in the header
- **Panel**: Absolute-positioned overlay sliding from left
- **Grouped by date**: Today / Yesterday / This Week / Older
- **Each entry**: Title (12px bold) + date + message count (11px muted) + delete on hover
- **Search**: Optional text filter at the top
- **Click** = load conversation, close panel

---

## Component 2: Memory System

### 2.1 Session Memory (Short-Term)

**Trigger:** Conversation ends (new chat / close) AND message count >= `extractionThreshold` (default: 6)

**Flow:**
1. Build minimal transcript from `uiMessages` (user+assistant text only, ~8000 chars max)
2. Enqueue `PendingExtraction { type: 'session' }` in `ExtractionQueue`
3. Queue processor runs asynchronously:
   a. LLM call using `memoryModelKey` model → structured summary
   b. Save as `memory/sessions/{conversation-id}.md` with YAML frontmatter
   c. If `autoUpdateLongTerm` enabled → enqueue follow-up `type: 'long-term'` item
4. Errors logged, never thrown. Failed items stay in queue for retry.

**Format:**
```markdown
---
conversation: 2026-02-20-a1b2c3
title: Vault Reorganization Plan
date: 2026-02-20
---

## Summary
User reorganized their vault into a Zettelkasten structure with MOCs.

## Decisions
- Use folder-per-topic with flat notes inside
- Tags for cross-cutting concerns, links for direct relationships

## User Preferences Observed
- Prefers concise explanations over verbose ones
- Wants callout boxes for important notes

## Open Questions
- Whether to migrate old daily notes into the new structure
```

### 2.2 Long-Term Memory (Automatic Extraction)

**Trigger:** `ExtractionQueue` processes a `type: 'long-term'` item (chained after session extraction)

**Process:**
1. Load current memory files + new session summary
2. LLM call using `memoryModelKey`: identify NEW information, output JSON updates
3. Parse JSON → apply section-level updates (add/update/remove)
4. Every 5 sessions: pattern detection over recent summaries → update patterns.md

### 2.3 Extraction Queue (`src/core/memory/ExtractionQueue.ts`)

Persistent FIFO queue for background memory extraction. Survives Obsidian restarts.

```typescript
interface PendingExtraction {
    conversationId: string;
    transcript: string;       // pre-built minimal transcript
    title: string;
    queuedAt: string;         // ISO 8601
    type: 'session' | 'long-term';
}
```

Storage: `.obsidian/plugins/obsidian-agent/pending-extractions.json`

Processing: One item at a time, delay between items, retry on failure at next startup.

### 2.4 Memory File Format

**user-profile.md:**
```markdown
# User Profile

## Identity
- Name: Sebastian
- Agent name: Obsilo (or custom)
- Role: Software developer
- Location: Germany

## Communication
- Language: German for conversation, English for code
- Style: Direct, concise, no emojis
- Prefers: Technical depth over simplification

## Agent Behavior
- Always build and deploy after changes
- Check Kilo Code patterns before implementing
```

**projects.md:**
```markdown
# Active Projects

## Obsilo (Obsidian Agent Plugin)
- Kilo Code clone as Obsidian plugin
- Tech: TypeScript, Obsidian API, esbuild
- Current phase: Memory system
```

**patterns.md:**
```markdown
# Behavioral Patterns

## Common Refinements
- Prefers flush-left alignment for all UI elements
- Settings UI: always add section headers with separator lines

## Workflow
- Build + deploy after every change
- German for discussion, English for code/docs
- Iterative UI refinement: implement, screenshot, adjust
```

---

## Component 3: Onboarding

### First Contact Detection

On plugin load, check if `memory/user-profile.md` exists. If not, trigger onboarding.

### Onboarding Flow

The agent starts with a friendly greeting and asks 3-5 questions progressively:

1. **Name**: "Hi! I'm your vault assistant. What should I call you?"
2. **Agent name**: "And what would you like to call me? (Default: Obsilo)"
3. **Role/Context**: "What do you mainly use your vault for?"
4. **Style**: "How should I communicate? (concise vs. detailed, formal vs. casual)"
5. **Anything else**: "Anything else I should know about how you like to work?"

Natural dialogue, not a form. Agent can skip questions if info is provided organically.

### Re-Onboarding

User can trigger via Settings button or `/introduce` command.

---

## Component 4: Settings

### New Sub-Tab: "Memory" (under Agent Behaviour)

**Section: Chat History**
- Toggle: Enable chat history (default: on)
- Button: Clear all history
- Display: Number of conversations stored

**Section: Memory**
- Toggle: Enable memory system (default: on)
- Toggle: Auto-extract session summaries (default: on)
- Toggle: Auto-update long-term memory (default: on)
- Dropdown: Memory model (picks from configured models)
- Slider: Extraction threshold (2-20, default: 6) — "Minimum messages before extraction"
- Button: View/edit memory files
- Button: Reset all memory
- Display: Memory file count, last updated

**Section: Onboarding**
- Button: Re-run onboarding conversation
- Display: Current user name, agent name

---

## Component 5: Retrieval & Indexing

### Vectra Extension for Sessions

The existing Vectra index handles session summaries alongside vault notes:
- Add `source: 'vault' | 'session'` metadata field to indexed items
- New method `indexSessionSummary(path, content)` — chunks + embeds + inserts with `source: 'session'`
- Extend `search()` to accept optional `source` filter (post-search, same pattern as folder/tags/since)
- `MemoryRetriever` calls `search(query, { source: 'session', topK: 3 })`

### Memory in Semantic Index

- Session summaries always indexed when semantic index is enabled
- Long-term memory files injected directly into system prompt (not searched)

---

## Implementation Phases

### Phase 1: Chat History + UI ✓
- ConversationStore (persistence layer with in-memory index)
- History panel UI (button + sliding overlay)
- Auto-title generation
- Load/restore previous conversation (full messages + continue)
- Settings migration from old `chatHistoryFolder`

### Phase 2: Memory Foundation ✓
- MemoryService (read/write memory files, build context for system prompt)
- ExtractionQueue (persistent FIFO, survives restarts)
- Memory settings (model, threshold, toggles)
- System prompt injection of memory context

### Phase 3: Session Memory Extraction ✓
- SessionExtractor (LLM-based session summary)
- Queue-based background processing
- Threshold-gated extraction trigger

### Phase 4: Long-Term Memory Extraction ✓
- LongTermExtractor (promote facts from sessions to long-term files)
- Deduplication and update logic
- Pattern detection across sessions

### Phase 5: Onboarding + Retrieval Integration ✓
- First-contact detection + onboarding conversation
- Vectra extension (source metadata + filter)
- Cross-session context injection at session start
- Memory-aware system prompt construction

---

## Post-Implementation Fix: Event Separation (ADR-007)

After initial deployment, a critical regression was identified: the `attempt_completion` tool result was always rendered as user-visible text via `onText()`. This caused:
- Models like GPT-5-mini showed only meta-log text ("Greeted user — available to help")
- Sonnet/Gemini appended internal log entries to correct responses

### Root Causes
1. **attempt_completion result always rendered** — `AgentTask.ts` unconditionally called `onText()` for the completion result
2. **System prompt contradiction** — Rule 1 said "no tools for Q&A" while Rule 6 said "ALWAYS call attempt_completion"
3. **Natural loop end already works** — `toolUses.length === 0` breaks the loop, making attempt_completion unnecessary for simple responses

### Structural Fix: Event Separation Pattern
Inspired by OpenClaw (discrete event types) and Kilo Code (tool-owned completion UI):

- **AgentTask.ts**: `hasStreamedText` flag tracks whether the model produced text; completion result only rendered as fallback when no text was streamed
- **systemPrompt.ts**: Rule 1 strengthened (no tools for Q&A), Rule 6 clarified (attempt_completion only for multi-step tool workflows)
- **AttemptCompletionTool.ts**: Description makes it clear it's only for tool workflows, result is an internal log entry

---

## Technical Notes

- All memory files are Markdown (human-readable, editable, syncable)
- History files are JSON (structured, fast to parse)
- Dedicated cheap model for extraction (separate from chat model)
- Memory extraction is async/background via persistent queue (zero UX impact)
- Total memory budget in system prompt: ~1200 tokens
- Files stored inside the plugin directory (syncs with Obsidian Sync if configured)
- No additional dependencies required (uses existing LLM API + Vectra index)
- Onboarding is handled via Settings UI only (not via system prompt injection — see ADR-007)
- Session retrieval only runs on first message when sessions exist

## Implemented Files

| File | Purpose |
|------|---------|
| `src/core/history/ConversationStore.ts` | Conversation persistence (index.json + per-conversation JSON) |
| `src/ui/sidebar/HistoryPanel.ts` | Sliding overlay panel with grouped conversation list |
| `src/core/memory/MemoryService.ts` | Read/write memory files, build context for system prompt |
| `src/core/memory/ExtractionQueue.ts` | Persistent FIFO queue for background extraction |
| `src/core/memory/SessionExtractor.ts` | LLM-based session summary extraction |
| `src/core/memory/LongTermExtractor.ts` | Promote facts from sessions to long-term files |
| `src/core/memory/OnboardingService.ts` | First-contact detection, profile bootstrapping |
| `src/core/memory/MemoryRetriever.ts` | Cross-session context via semantic search |
| `src/ui/settings/MemoryTab.ts` | Settings sub-tab for memory configuration |
