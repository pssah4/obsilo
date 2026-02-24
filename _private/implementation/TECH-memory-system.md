# Memory System — Technical Documentation

Source files:
- `src/core/memory/MemoryService.ts`
- `src/core/memory/ExtractionQueue.ts`
- `src/core/memory/SessionExtractor.ts`
- `src/core/memory/LongTermExtractor.ts`
- `src/core/memory/MemoryRetriever.ts`
- `src/core/memory/OnboardingService.ts`

---

## 1. MemoryService

### Overview

`MemoryService` manages the persistent memory files that form the agent's long-term
knowledge about the user, projects, behavioral patterns, and its own identity. Memory
files are Markdown documents stored in the plugin directory.

**Storage path:** `{pluginDir}/memory/` (e.g. `.obsidian/plugins/obsidian-agent/memory/`)
**Sessions path:** `{pluginDir}/memory/sessions/`

### Constructor

```typescript
constructor(vault: Vault, pluginDir: string)
```

Creates the `memoryDir` and `sessionsDir` path strings. Actual directory creation
happens during `initialize()`.

### Initialization

`initialize()` performs two operations:
1. Ensure both `memoryDir` and `sessionsDir` directories exist (creates them if missing)
2. For each of the 6 memory files, create from template if the file does not yet exist

### Read/Write Operations

| Method | Description |
|--------|-------------|
| `loadMemoryFiles()` | Reads all 6 memory files into a `MemoryFiles` object |
| `readFile(name)` | Reads a single memory file; returns empty string on error |
| `writeFile(name, content)` | Overwrites a memory file completely |
| `appendToFile(name, content)` | Appends content to an existing memory file |
| `writeSessionSummary(id, content)` | Writes to `sessions/{conversationId}.md` |
| `readSessionSummary(id)` | Reads a session summary; returns empty string on error |

### buildMemoryContext()

Constructs the memory context string for injection into the system prompt.

**Algorithm:**
1. For each memory file (soul, userProfile, projects, patterns, learnings), check if
   content is non-empty and differs from the template default.
2. Wrap each qualifying file in XML tags (e.g. `<agent_identity>...</agent_identity>`).
3. Truncate each section to `MAX_CHARS_PER_FILE` (800 characters) with a
   `[...truncated]` suffix if exceeded.
4. Join all sections with double newlines.
5. Truncate the total output to `MAX_TOTAL_CHARS` (4000 characters).

**Tag mapping:**
| Memory File | XML Tag |
|-------------|---------|
| soul.md | `<agent_identity>` |
| user-profile.md | `<user_profile>` |
| projects.md | `<active_projects>` |
| patterns.md | `<behavioral_patterns>` |
| learnings.md | `<task_learnings>` |

**Note:** `knowledge.md` is intentionally excluded from the system prompt. It is
accessed on-demand only via semantic search.

### Limits

| Constant | Value | Purpose |
|----------|-------|---------|
| `MAX_CHARS_PER_FILE` | 800 | Maximum characters per memory file in the system prompt |
| `MAX_TOTAL_CHARS` | 4000 | Maximum total characters for combined memory context |

### Additional Methods

- `hasUserProfile()`: Checks if `user-profile.md` has meaningful content beyond the
  template (used by onboarding detection)
- `getStats()`: Returns file count, session count, and last-updated timestamp
- `resetAll()`: Deletes all session summaries and resets memory files to templates
- `getMemoryDir()`: Returns the memory directory path (for UI "open in editor")

---

## 2. Memory Files

Six Markdown files form the persistent memory. Each has a template that is created on
first initialization.

### user-profile.md
**Purpose:** Stores the user's identity, communication preferences, and desired agent
behavior.

**Template structure:**
```markdown
# User Profile

## Identity
- Name:
- Role:

## Communication
- Language:
- Style:

## Agent Behavior
```

Populated by the onboarding flow and updated by `LongTermExtractor` when new user
preferences are observed in sessions.

### projects.md
**Purpose:** Tracks the user's active projects, goals, and project context.

**Template:** Starts with `# Active Projects` and grows as the LongTermExtractor
identifies project-related information from session summaries.

### patterns.md
**Purpose:** Records behavioral patterns and workflow preferences observed across
sessions.

**Template:** Starts with `# Behavioral Patterns`. Updated when the extractor identifies
recurring workflow habits, tool preferences, or working patterns.

### knowledge.md
**Purpose:** Stores domain knowledge and factual information. Unlike other memory files,
this one is NOT injected into the system prompt. It is accessed on-demand via semantic
search, making it suitable for larger knowledge bases that would exceed prompt limits.

**Template:** Starts with `# Domain Knowledge`.

### soul.md
**Purpose:** Defines the agent's identity, personality, communication style, values,
and anti-patterns. Inspired by OpenClaw's SOUL.md concept.

**Default template:**
```markdown
# Agent Identity

## Name
Obsilo

## Communication
- Language: Deutsch
- Style: Warm, nahbar, auf Augenhoehe

## Values
- Nuetzlichkeit vor Hoeflichkeit
- Ehrlichkeit -- sage wenn ich etwas nicht weiss
- Respektiere die Arbeit des Nutzers
- Lerne aus Fehlern

## Anti-Patterns
- Keine leeren Floskeln
- Keine unnoetigen Entschuldigungen
- Keine Emojis
```

Updated by `LongTermExtractor` when sessions reveal user corrections to agent behavior,
tone preferences, name changes, or new expertise areas.

### learnings.md
**Purpose:** Stores task learnings — successful strategies, common mistakes, and tool
effectiveness insights. Entries follow an actionable format:
"When doing X, use Y because Z."

**Template:** Starts with `# Task Learnings`. Updated when the extractor identifies
strategies that worked well or poorly, tools that helped or hindered, user corrections
indicating recurring mistake patterns, or workflow optimizations.

---

## 3. ExtractionQueue

### Overview

A persistent FIFO queue for background memory extraction jobs. Survives Obsidian
restarts via a JSON file on disk.

**Persistence file:** `{pluginDir}/pending-extractions.json`

### Queue Item Structure

```typescript
interface PendingExtraction {
    conversationId: string;  // unique conversation identifier
    transcript: string;      // full conversation transcript (session type)
                             //   or session summary text (long-term type)
    title: string;           // conversation title
    queuedAt: string;        // ISO timestamp when queued
    type: 'session' | 'long-term';  // extraction type
}
```

### Operations

| Method | Description |
|--------|-------------|
| `enqueue(item)` | Add item to queue, persist to disk, kick off processing |
| `dequeue()` | Remove and return the first item |
| `peek()` | Return the first item without removing |
| `isEmpty()` / `size()` | Queue state queries |
| `load()` | Read pending items from disk (called on plugin startup) |
| `save()` | Write current items to disk as JSON |
| `setProcessor(fn)` | Register the function that processes each item |

### Processing Loop

`processQueue()` implements a sequential background processor:

1. Re-entrant guard: if already processing, return immediately
2. While queue is not empty:
   a. Peek at the front item (do not remove yet)
   b. Call `processor(item)`
   c. On success: `dequeue()` the item and `save()` to disk
   d. On failure: leave the item in the queue, log warning, break the loop
      (item will be retried on next startup or next enqueue)
   e. 2-second delay between items to avoid hammering the LLM
3. Set `processing = false` in the finally block

### Crash Recovery

Because items are only dequeued after successful processing, a crash during extraction
leaves the item at the front of the queue. On next plugin startup, `load()` restores
the queue from `pending-extractions.json`, and processing resumes from the failed item.

---

## 4. SessionExtractor

### Overview

LLM-based session summarization. Takes a conversation transcript and produces a
structured Markdown summary with YAML frontmatter.

### Constructor Dependencies

- `vault: Vault` — Obsidian vault
- `memoryService: MemoryService` — for writing session summaries
- `getMemoryModel: () => CustomModel | null` — lazy accessor for the configured
  memory extraction model
- `getAutoUpdateLongTerm: () => boolean` — whether to chain long-term extraction
- `extractionQueue: ExtractionQueue | null` — for chaining long-term items
- `getSemanticIndex: () => SemanticIndexService | null` — for indexing summaries

### Extraction Prompt

The system prompt instructs the LLM to extract 7 sections from the transcript:

1. **Summary** — What was accomplished (2-3 sentences)
2. **Decisions** — Key decisions made (bullet points)
3. **User Preferences Observed** — Communication style, workflow habits, tool preferences
4. **Task Outcome** — Was the result satisfactory? Did the user need corrections?
5. **Tool Effectiveness** — Which tools helped/hindered (format: "tool_name: helpful/unhelpful -- reason")
6. **Learnings** — What worked well, what should be done differently
7. **Open Questions** — Unresolved items or follow-ups

**Rules enforced by the prompt:**
- Under 400 words total
- Focus on durable facts, not transient details
- Omit empty sections entirely
- Output only Markdown (no code fences, no preamble)

### Output Format

```markdown
---
conversation: {conversationId}
title: {title}
date: {YYYY-MM-DD}
---

## Summary
...

## Decisions
- ...

## User Preferences Observed
- ...
```

### Processing Flow

1. Retrieve the configured memory model. If none, skip with a warning.
2. Build the system prompt, substituting `{CONVERSATION_ID}`, `{TITLE}`, `{DATE}`.
3. Create an API handler for the model and stream the LLM response.
4. Save the summary via `memoryService.writeSessionSummary()`.
5. If the semantic index is available and built, index the summary for cross-session
   retrieval via `semanticIndex.indexSessionSummary()`.
6. If `autoUpdateLongTerm` is enabled, enqueue a `'long-term'` extraction item
   with the session summary as the transcript.

---

## 5. LongTermExtractor

### Overview

Promotes durable facts from session summaries into long-term memory files. Operates
as a merge — reads current memory files, identifies new information, and applies
targeted updates.

### Extraction Prompt

The system prompt provides the LLM with the current content of all 5 updatable memory
files (user-profile, projects, patterns, soul, learnings) wrapped in XML tags. It then
receives the session summary as the user message.

**Target file descriptions in the prompt:**
- `user-profile.md`: User identity, preferences, communication style
- `projects.md`: Active projects, goals, context
- `patterns.md`: Behavioral patterns, workflow preferences
- `soul.md`: Agent personality — update when user corrects agent behavior, prefers
  different tone, renames the agent, or indicates new expertise areas
- `learnings.md`: Task learnings — update when strategies succeed/fail, tools
  help/hinder, user corrections indicate recurring mistakes

**Rules enforced:**
- Only output updates for files that actually need changes
- Never remove existing information unless explicitly contradicted
- One bullet point per fact
- Output valid JSON only

### Output Format

```json
{
  "updates": [
    {
      "file": "user-profile.md",
      "action": "append",
      "section": "## Communication",
      "content": "- Prefers concise responses"
    }
  ]
}
```

### Merge Strategy

Two actions are supported for each update:

**`append`:**
1. Find the section heading in the file
2. Locate the end of that section (next heading of same or higher level, or EOF)
3. Insert the new content before the next heading
4. If the section does not exist, append it at the end of the file

**`replace`:**
1. Find the section heading in the file
2. Replace all content between this heading and the next heading of same/higher level
3. If the section does not exist, append it at the end of the file

### Validation

The JSON response is parsed with tolerance for markdown code fences (`\`\`\`json`).
Each update is validated:
- `file` must be one of the 5 allowed files
- `action` must be `'append'` or `'replace'`
- `content` must be a string

Invalid entries are silently filtered out.

---

## 6. MemoryRetriever

### Overview

Provides cross-session context retrieval for new conversations. When a user starts
a new chat, the retriever finds relevant past session summaries to inject into the
system prompt.

### Primary Path: Semantic Search

When the semantic index is available and built:
1. Call `semanticIndex.searchSessions(firstMessage, topK)` — searches only items
   tagged with `source='session'`
2. Extract session IDs from the path format `session:{id}`
3. Return the matching excerpts

### Fallback Path: Recency-Based

When no semantic index is available:
1. List all `.md` files in the `sessions/` directory
2. Get modification times via `vault.adapter.stat()`
3. Sort by most recent first
4. Read the top `topK` files (default: 3)

### Output Format

Session context is formatted as XML for system prompt injection:

```xml
<relevant_sessions>
<session id="abc123">
[truncated session summary, max 600 chars]
</session>

<session id="def456">
[truncated session summary, max 600 chars]
</session>
</relevant_sessions>
```

Each excerpt is truncated to 600 characters with a `...` suffix if exceeded.

---

## 7. OnboardingService

### Overview

Manages a conversational onboarding flow for new users. The entire flow is driven by
a single monolithic prompt injected into the system prompt. The LLM follows a scripted
conversation, collecting all information before applying settings in a batch at the end.

### First-Contact Detection

`needsOnboarding()` returns `true` when `settings.onboarding.completed === false`.
This is checked on every new conversation start.

### Onboarding Steps (8-step flow)

The monolithic `ONBOARDING_PROMPT` defines these steps:

| Step | Topic | Input Method |
|------|-------|--------------|
| 1 | Greeting and introduction | Free text (user types name) |
| 2 | Agent naming | Options + optional free text |
| 3 | Backup import | Options; may open Settings tab |
| 4 | Language and formality | 5 predefined options |
| 5 | Vault usage | Multiple-select options (5 choices) |
| 6 | Communication tone | 3 predefined options |
| 7 | Permission level | 3 predefined options |
| 8 | Completion | Batch settings application |

### Step Management

| Method | Description |
|--------|-------------|
| `needsOnboarding()` | Check if onboarding is needed |
| `getOnboardingPrompt()` | Return the full prompt (or empty if completed) |
| `markCompleted()` | Set `onboarding.completed = true`, `currentStep = 'done'` |
| `reset()` | Reset all onboarding state for a fresh start |

### Settings Application (Step 8)

All settings changes are batched into the final step:
1. `update_settings action="apply_preset"` — applies permission preset based on
   user choice:
   - "Freie Hand" (free hand) -> `"permissive"`
   - "Ausgewogen" (balanced) -> `"balanced"`
   - "Vorsichtig" (cautious) -> `"restrictive"`
2. `update_settings action="set" path="onboarding.completed" value=true`
3. Personalized summary addressing the user by name

### Critical Rules (enforced in the prompt)

1. Every response must contain text BEFORE any tool call (the text is the conversation,
   the tool creates the input UI)
2. Every response except the final step must end with `ask_followup_question`
3. No `update_settings` calls between steps (only in step 3 for opening a tab, and
   step 8 for the batch apply)
4. Responses are 3-5 sentences long
5. Only `ask_followup_question` and `update_settings` tools are permitted
6. All vault/file/web tools are explicitly forbidden during onboarding
7. Language switches to user's preference starting from step 4

---

## 8. Soul and Personality

The `soul.md` file defines the agent's identity and shapes its behavior across all
conversations. It is injected into the system prompt as the `<agent_identity>` section,
appearing before user profile and project context.

**Default personality traits (Obsilo):**
- Language: German
- Style: Warm, approachable, at eye level
- Values: Usefulness over politeness, honesty, respect for user's work, learn from
  mistakes
- Anti-patterns: No empty phrases, no unnecessary apologies, no emojis

**How soul.md shapes behavior:**
- Injected as the first memory section in `buildMemoryContext()`, giving it highest
  priority in the context window
- The agent reads its own name, communication style, and behavioral constraints from
  this file at every conversation turn
- `LongTermExtractor` updates soul.md when sessions reveal user corrections to agent
  behavior, preferred tone changes, agent renaming, or new areas of expertise/avoidance

**Difference from user-profile.md:** The soul file describes the agent itself (identity,
values, anti-patterns), while user-profile describes the user (name, role, preferences).

---

## 9. Memory Extraction Pipeline — End-to-End Flow

The complete flow from conversation end to long-term storage:

```
Conversation Ends
       |
       v
[1] Transcript is packaged as PendingExtraction (type='session')
       |
       v
[2] ExtractionQueue.enqueue() — persisted to pending-extractions.json
       |
       v
[3] ExtractionQueue.processQueue() picks up the item
       |
       v
[4] SessionExtractor.process()
    - LLM call with SESSION_EXTRACTION_PROMPT
    - Extracts: Summary, Decisions, Preferences, Task Outcome,
      Tool Effectiveness, Learnings, Open Questions
    - Saves to memory/sessions/{conversationId}.md
    - Indexes summary in SemanticIndexService (source='session')
       |
       v
[5] If autoUpdateLongTerm enabled:
    - Enqueue new PendingExtraction (type='long-term')
    - Transcript = session summary from step 4
       |
       v
[6] ExtractionQueue picks up the long-term item
       |
       v
[7] LongTermExtractor.process()
    - Reads current state of all 5 memory files
    - LLM call with LONG_TERM_EXTRACTION_PROMPT
    - Identifies new durable facts from the session summary
    - Outputs JSON with targeted updates (file, action, section, content)
    - Applies updates via append/replace to specific sections
       |
       v
[8] Memory files updated:
    - user-profile.md  (identity, preferences)
    - projects.md      (active projects)
    - patterns.md      (workflow patterns)
    - soul.md          (agent personality)
    - learnings.md     (task strategies)
       |
       v
[9] Next conversation:
    - buildMemoryContext() injects updated memory into system prompt
    - MemoryRetriever searches session summaries for relevant context
```

**Timing:** The entire pipeline runs in the background after the conversation ends.
The 2-second delay between queue items prevents LLM API saturation. Session extraction
produces one LLM call; long-term extraction produces one additional LLM call. Total
pipeline cost per conversation: 2 LLM calls (when auto long-term update is enabled).

**Failure resilience:** If any step fails, the item remains in the queue and is retried
on the next plugin startup or the next enqueue event. The queue is persisted to disk
after every state change.
