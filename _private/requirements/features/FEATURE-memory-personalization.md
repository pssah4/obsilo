# FEATURE: Memory, Chat History & Personalization

**Status:** Planned
**Epic:** Cross-Session Awareness
**Sources:** CrewAI Memory, OpenClaw Memory, Claude Code Session Memory, ChatGPT Memory, Mem0

## Summary

Persistent memory system that gives Obsilo awareness across sessions. Three pillars:
1. **Chat History** — stored conversations with compact history browser
2. **Memory** — short-term (session summaries) and long-term (user knowledge, patterns, preferences)
3. **Onboarding** — frictionless first-contact flow to bootstrap the user profile

The agent becomes more personal and context-aware over time by automatically extracting knowledge from conversations and maintaining structured memory files.

---

## Architecture Overview

### Storage Layout

```
.obsidian/plugins/obsidian-agent/
├── history/                          # Chat History
│   ├── index.json                    # Conversation index (id, title, created, updated, messageCount)
│   ├── 2025-02-20-a1b2c3.json       # Individual conversation (full messages)
│   ├── 2025-02-20-d4e5f6.json
│   └── ...
├── memory/                           # Long-Term Memory
│   ├── user-profile.md               # Identity, preferences, communication style
│   ├── projects.md                   # Active projects, goals, context
│   ├── patterns.md                   # Behavioral patterns, common requests, style preferences
│   ├── knowledge.md                  # Domain knowledge, expertise areas
│   └── sessions/                     # Short-Term / Session Memory
│       ├── 2025-02-20-a1b2c3.md      # Session summary (linked to history conversation)
│       └── ...
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
2. **During Chat** — messages appended to the conversation JSON file
3. **Auto-Title** — after the first assistant response, generate a title via LLM (short, 3-8 words)
4. **End** — when user starts a new chat or closes Obsidian, trigger session memory extraction

### Conversation File Format (`history/*.json`)

```json
{
  "id": "2025-02-20-a1b2c3",
  "title": "Vault Reorganization Plan",
  "created": "2025-02-20T14:30:00Z",
  "updated": "2025-02-20T15:45:00Z",
  "mode": "agent",
  "model": "claude-sonnet-4-20250514",
  "messages": [
    { "role": "user", "content": "...", "ts": "..." },
    { "role": "assistant", "content": "...", "ts": "...", "toolCalls": [...] }
  ]
}
```

### History Index (`history/index.json`)

```json
{
  "conversations": [
    { "id": "2025-02-20-a1b2c3", "title": "Vault Reorganization Plan", "created": "...", "updated": "...", "messageCount": 12, "mode": "agent" }
  ]
}
```

### History UI

- **Button**: Lucide `history` icon, placed left of the "New Chat" button in the header
- **Panel**: Sliding panel or dropdown showing conversations grouped by date (Today, Yesterday, This Week, Older)
- **Each entry**: Title + timestamp + message count, compact font (11px)
- **Actions**: Click to load, swipe/button to delete
- **Search**: Optional text filter at the top

---

## Component 2: Memory System

### 2.1 Session Memory (Short-Term)

**Trigger:** When a conversation ends (new chat, close, or manual trigger)

**Process:**
1. Take the full conversation
2. LLM extraction prompt: "Summarize this conversation. Extract: (a) what was accomplished, (b) decisions made, (c) user preferences observed, (d) open questions, (e) notable context"
3. Save as `memory/sessions/{conversation-id}.md`

**Format:**
```markdown
---
conversation: 2025-02-20-a1b2c3
title: Vault Reorganization Plan
date: 2025-02-20
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

**Trigger:** After session memory is written, a background extraction step promotes durable facts to long-term memory files.

**Extraction Prompt:**
```
Given the following session summary and existing memory files,
identify NEW information that should be added to long-term memory.

Categories:
- user-profile: Name, role, location, communication preferences, how they want the agent to behave
- projects: Active projects, goals, deadlines, collaborators
- patterns: Recurring requests, common refinements, workflow habits
- knowledge: Domain expertise, technical skills, tools used

Rules:
- Only add genuinely new information (not already in memory)
- Update existing entries if information changed
- Remove outdated information
- Keep each file under 150 lines
- Use bullet points, not prose

Output as JSON: { "file": "user-profile.md", "action": "add|update|remove", "content": "..." }
```

### 2.3 Memory File Format

**user-profile.md:**
```markdown
# User Profile

## Identity
- Name: Sebastian
- Agent name: Obsilo (or custom name chosen by user)
- Role: Software developer
- Location: Germany

## Communication
- Language: German for conversation, English for code
- Style: Direct, concise, no emojis
- Prefers: Technical depth over simplification

## Agent Behavior
- Always build and deploy after changes
- Check Kilo Code patterns before implementing
- Use semantic search first for vault queries
```

**projects.md:**
```markdown
# Active Projects

## Obsilo (Obsidian Agent Plugin)
- Kilo Code clone as Obsidian plugin
- Tech: TypeScript, Obsidian API, esbuild
- Architecture: See _private/architecture/arc42.md
- Current phase: UI polish and memory system
```

**patterns.md:**
```markdown
# Behavioral Patterns

## Common Refinements
- User often asks for left-alignment fixes after layout changes
- User prefers flush-left alignment for all UI elements
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
3. **Role/Context**: "What do you mainly use your vault for? (e.g., work notes, research, journaling, project management)"
4. **Style**: "How should I communicate? (concise vs. detailed, formal vs. casual)"
5. **Anything else**: "Anything else I should know about you or how you like to work?"

After each answer, write to `user-profile.md`. The conversation flows naturally — not a form, but a dialogue. The agent can skip questions if the user provides enough info organically.

### Re-Onboarding

User can trigger re-onboarding via Settings or a slash command (`/introduce`).

---

## Component 4: Settings

### New Sub-Tab: "Memory" (under Agent Behaviour)

**Section: Chat History**
- Toggle: Enable chat history (default: on)
- Toggle: Include history in semantic index (default: off)
- Button: Clear all history
- Display: Number of conversations stored, disk usage

**Section: Memory**
- Toggle: Enable memory system (default: on)
- Toggle: Auto-extract session summaries (default: on)
- Toggle: Auto-update long-term memory (default: on)
- Button: View/edit memory files (opens in Obsidian editor)
- Button: Reset all memory
- Display: Memory file count, last updated

**Section: Onboarding**
- Button: Re-run onboarding conversation
- Display: Current user name, agent name

---

## Component 5: Retrieval & Indexing

### History in Semantic Index

When enabled in settings:
- History JSON files are chunked and indexed alongside vault notes
- Metadata tag `source: "chat-history"` to distinguish from vault content
- Agent can search past conversations via `semantic_search` with a filter

### Memory in Semantic Index

- Session summaries (`memory/sessions/*.md`) are always indexed when semantic index is enabled
- Long-term memory files are injected directly into system prompt (not searched)

---

## Implementation Phases

### Phase 1: Chat History + UI
- Conversation persistence (save/load JSON files)
- History index management
- History panel UI (button + sliding panel)
- Auto-title generation
- Load previous conversation

### Phase 2: Memory Foundation
- Settings types and UI (Memory sub-tab)
- Memory file structure and read/write utilities
- Session memory extraction (end-of-conversation trigger)
- Memory injection into system prompt

### Phase 3: Long-Term Memory + Extraction
- Background extraction pipeline (session → long-term)
- Memory deduplication and update logic
- Pattern detection across sessions
- Memory management UI (view/edit/reset)

### Phase 4: Onboarding
- First-contact detection
- Onboarding conversation flow
- User profile bootstrapping
- Re-onboarding command

### Phase 5: Retrieval Integration
- History indexing in semantic index
- Session summary indexing
- Cross-session context injection at session start
- Memory-aware system prompt construction

---

## Technical Notes

- All memory files are Markdown (human-readable, editable, syncable)
- History files are JSON (structured, fast to parse)
- LLM calls for extraction use the active model (not a separate model)
- Memory extraction is async/background (does not block UI)
- Total memory budget in system prompt: ~1200 tokens (configurable)
- Files stored inside the plugin directory (syncs with Obsidian Sync if configured)
- No additional dependencies required (uses existing LLM API + Vectra index)
