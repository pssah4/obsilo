# AI Agent Memory & Personalization -- Research (Feb 2026)

Research into modern AI memory systems, chat history persistence, and personalization patterns across ChatGPT, Claude, Gemini, Mem0, Letta/MemGPT, and LangGraph.

---

## 1. Chat History Persistence

### ChatGPT

**Storage**: All conversations stored server-side, retained indefinitely unless user deletes (purged within 30 days after deletion). Export available as ZIP with `conversations.json`.

**Organization**: Sidebar shows conversations chronologically ("Today", "Yesterday", "Previous 7 Days", etc.). No built-in search by date; third-party extensions add this.

**Auto-Titling**: Frontend calls `conversation/gen_title/<conversation-id>` endpoint. Uses a lighter model (gpt-3.5-turbo or gpt-4o) to generate concise titles from conversation content. Users have requested ability to lock titles.

**Metadata per conversation**:
- Conversation ID
- Timestamp (creation + last update)
- Auto-generated title
- Intent classification tags (auto-applied)
- Model used
- Message count / conversation depth

### Claude

**Storage**: Conversations stored server-side. Rolling window approach with ~190k token context budget (token-based, not message-based).

**Organization**: Similar chronological sidebar. Projects feature creates isolated memory contexts per project.

**Key difference**: Claude stores full messages (not summaries) in the rolling window and provides explicit search tools rather than pre-computed summaries.

### Gemini

**Storage**: Conversations tied to Google account. Memory feature requires Google One AI Premium subscription. English-only (as of late 2025).

**Organization**: Standard chronological listing integrated with Google ecosystem.

---

## 2. Memory / Personalization Systems

### 2.1 ChatGPT Memory (reverse-engineered architecture)

ChatGPT assembles context through **six sections** injected into every conversation:

#### Layer 1: Model Set Context (Manual Memories)
- User-created memories with timestamps
- Format: `[2025-05-02]. The user likes ice cream and cookies.`
- Numbered list, deletable by user

#### Layer 2: Assistant Response Preferences
- 8-15 automatically-generated entries
- Captures inferred communication style preferences
- Each entry includes a **confidence tag**
- Example: tone preference, verbosity level, code style

#### Layer 3: Notable Past Conversation Topics
- ~8 entries on active accounts
- Historical behavioral patterns identified over months
- Captures recurring interests and expertise areas

#### Layer 4: Helpful User Insights
- Personal details extracted automatically: name, location, expertise, affiliations
- ~14 entries on active accounts
- New accounts show "Nothing yet"

#### Layer 5: Recent Conversation Content
- ~40 recent chats with timestamps
- Contains **only user messages** (not assistant responses -- deliberate design to avoid carrying forward flawed reasoning)
- Top 5 entries have second-level timestamps; older entries hourly resolution
- Separated by `||||` delimiters
- Format: `Dec 8, 2025: 'Building a load balancer in Go' - asked about connection pooling`

#### Layer 6: User Interaction Metadata
- 17-20 automatically-generated data points
- Includes: device information, account age, model usage percentages, conversation depth metrics, activity patterns, location data

**Context assembly priority** (when space runs low):
1. Session metadata (injected once at session start)
2. User memory facts (present in every message -- **never trimmed**)
3. Conversation summaries (quick historical context)
4. Current session transcript (trimmed first)

**Key design**: Pre-computed summaries injected directly, avoiding RAG search overhead. "When space runs low, the current session messages get trimmed first. Your permanent facts and recent summaries stay."

**Memory updates**: Occur on regular cadences (not real-time). No user interface for inspecting learned profile information (layers 2, 3, 6).

### 2.2 Claude Memory

Fundamentally different approach: **on-demand tools + selective retrieval**.

**Architecture**:
- Starts every conversation with a **blank slate** -- no preloaded profiles
- Memory activates only when explicitly invoked via tool calls
- Tool calls are visible to user (transparency)

**Memory storage format** (XML):
```xml
<userMemories>
- User's name is [name].
- Previously worked at [companies].
- Prefers learning through [methods].
- Built [projects].
- Studying [topics].
</userMemories>
```

**Available tools**:
- `conversation_search` -- keyword/topic-based retrieval (query string, result limit 1-10, default 5)
- `recent_chats` -- retrieves conversations by timestamp with configurable sorting and date filters
- `memory_user_edits` -- explicit memory management ("Remember this", "Delete this")

**Memory updates**: Periodic background updates based on conversations (not immediate). Deleting conversations eventually removes related memory entries.

**Key difference from ChatGPT**: Claude searches raw conversation history without AI-generated summaries. The model decides when to activate memory, making it "more efficient but potentially less seamless."

**Project isolation**: Teams feature creates separate memory per project.

### 2.3 Google Gemini Memory

**Storage schema** (fixed structure):
- Demographic information (name, age, location)
- Interests and preferences (technologies, topics)
- Relationships (important people)
- Dated events/projects/plans

**Design philosophy**:
- Opt-in at prompt level (not silently inferred)
- Restricted to slower "thinking" Pro models (deciding whether to use memory requires non-trivial reasoning)
- Always announces when using a memory in its response
- Never uses memories for model training
- Users can view, edit, delete anytime
- Stored indefinitely unless manually deleted

**Conflict resolution**: Timestamps on memory entries. If a "current role" was last updated a year ago and user mentions a new job, the system overwrites the old entry.

### 2.4 Mem0 (Memory Layer for AI Apps)

Open-source + hosted memory service. Published research paper (arXiv:2504.19413).

**Four memory layers**:

| Layer | Scope | Lifetime | Purpose |
|-------|-------|----------|---------|
| Conversation Memory | Single turn | Current response only | In-flight messages, tool calls, reasoning steps |
| Session Memory | Current task/channel | Minutes to hours | Multi-step workflows, onboarding, debugging |
| User Memory | Person/account/workspace | Weeks to indefinite | Preferences, account details, compliance |
| Organizational Memory | Multiple agents/teams | Global | FAQs, product catalogs, policies |

**Memory lifecycle**:
1. **Capture**: Messages enter conversation storage while active
2. **Promote**: Relevant details escalate to session or user memory via `user_id`, `session_id`, and metadata
3. **Retrieve**: Search pipeline ranks results (user memories first, then session notes, then raw history)

**Key mechanisms**:
- **Intelligent Filtering**: Priority scoring + contextual tagging to decide what gets stored
- **Dynamic Forgetting**: Decays low-relevance entries over time
- **Graph Memory**: Enhanced variant uses graph-based representations to capture relational structures between entities

**Performance**: 26% improvement over OpenAI in LLM-as-Judge metric, 91% lower p95 latency, 90%+ token cost savings.

**Code example**:
```python
from mem0 import Memory

memory = Memory(api_key=os.environ["MEM0_API_KEY"])

memory.add(
    ["I'm Alex and I prefer boutique hotels."],
    user_id="alex",
    session_id="trip-planning-2025",
)

results = memory.search(
    "Any hotel preferences?",
    user_id="alex",
    session_id="trip-planning-2025",
)
```

### 2.5 Letta / MemGPT

OS-inspired memory management with virtual context. Published as academic paper.

**Four memory tiers** (analogous to computer memory hierarchy):

| Tier | Analogy | Description |
|------|---------|-------------|
| Core Memory | RAM | Always in-context. Compressed essential facts and personal info. Agent can read/write. |
| Message Buffer | CPU Cache | Recent conversation messages in context window |
| Recall Memory | Search Index | Searchable database of past conversations via semantic search |
| Archival Memory | Disk | Explicitly formulated knowledge in external databases (vector DB, graph DB) |

**Key innovation**: Agents autonomously move data between in-context core memory (RAM) and external archival/recall memory (disk), creating an **illusion of unlimited memory** while working within fixed context limits.

**Storage**: Uses LanceDB as default archival storage for semantic search across entire memory space.

### 2.6 LangGraph / LangChain Memory (2025 patterns)

Legacy LangChain memory classes deprecated in v0.3.1. All replaced by LangGraph's checkpointing system.

**Short-term memory**: Thread-scoped checkpoints. Conversation history stored as list of messages in agent state. Two strategies:
- **Message trimming**: Keep last k messages only
- **Summarization**: Maintain compressed representation + inject into system context

**Long-term memory**: JSON documents in a store, organized by:
- **Namespace** (similar to folders) -- often includes user/org IDs
- **Key** (like a filename)
- Hierarchical organization enabled

**LangMem toolkit**: Pre-built tools for extracting and managing:
- Procedural memories (how to do things)
- Episodic memories (what happened)
- Semantic memories (facts and knowledge)

---

## 3. Short-term vs Long-term Memory Patterns

### Industry-Standard Framework (CoALA)

| Memory Type | Scope | Storage | Persistence |
|-------------|-------|---------|-------------|
| Working Memory | Current context window contents | In-context | Session only |
| Semantic Memory | Facts and knowledge about users/domains | External DB | Long-term |
| Episodic Memory | Records of past agent actions and outcomes | External DB | Long-term |
| Procedural Memory | Instructions in system prompts, learned workflows | System prompt / DB | Long-term |

### Short-term Memory (within session)

**Standard approach**: Rolling message buffer in context window.

**Management strategies**:
1. **Sliding window**: Keep last N messages, drop oldest
2. **Token-based trimming**: Keep messages until token budget exhausted
3. **Summarization**: LLM generates compressed summary, replaces older messages
4. **Hybrid**: Keep recent messages verbatim + summary of older ones

**Best practice**: Prioritize user messages over assistant messages when trimming (ChatGPT's approach). Assistant responses can be regenerated; user intent cannot.

### Long-term Memory (across sessions)

**Standard approach**: External storage (vector DB, graph DB, key-value store) with retrieval at conversation start or on-demand.

**What gets stored long-term**:
- User identity (name, role, location)
- Preferences (communication style, technical level, language)
- Recurring topics and expertise areas
- Project context and goals
- Behavioral patterns

### Promotion: Short-term to Long-term

Two main approaches:

**1. Explicit (Hot Path)**:
- Agent autonomously recognizes important information during conversation
- Makes conscious decision to remember via tool call
- Example: User says "I'm a vegetarian" --> agent calls `save_memory()`
- More reliable but requires model judgment

**2. Implicit (Background/Cold Path)**:
- Memory management runs programmatically at defined intervals
- After each session, after N turns, or periodically
- LLM extracts key facts from conversation batch
- Less intrusive but may miss nuance

**Four core operations** for memory management:
- **ADD** -- Store new information
- **UPDATE** -- Modify outdated details (e.g., job change)
- **DELETE** -- Remove obsolete data
- **NOOP** -- Determine no action necessary

**Hardest challenge**: Automated forgetting -- deciding what information becomes permanently obsolete. "This seems to be the hardest challenge for developers at the moment."

### Filtering Heuristics (what deserves long-term storage)

- "I'm vegetarian" --> REMEMBER (personal fact)
- "hmm, let me think" --> IGNORE (filler)
- Priority scoring based on conversation context
- Contextual tagging to categorize information
- Confidence ratings on inferred vs stated facts
- Timestamp-based conflict resolution (newer info overwrites older for same topic)

---

## 4. Onboarding / Getting-to-Know-You Flows

### Approaches Observed in 2025

#### Zero-friction (Pi AI pattern)
- No account required to start first conversation
- Gets user talking in under 60 seconds
- Introduces itself: "I'm designed to be supportive, smart, and there for you"
- Learns through natural conversation, not explicit questionnaires
- Takes 10-30 conversation turns to discern user mood/personality
- Default mode "friendly" with alternatives: casual, witty, compassionate, devoted

#### Gradual Learning (Replika pattern)
- Choose relationship type: friend, romantic partner, mentor
- This choice influences AI personality and interaction style
- Learns from ongoing conversation (not upfront data collection)
- Stores in "Memory bank"
- Users can upvote/downvote responses to adjust style

#### Implicit Profiling (ChatGPT pattern)
- No explicit onboarding flow
- Automatically builds profile over time through layers 2-4, 6
- "Custom Instructions" section allows users to optionally provide:
  - What they want ChatGPT to know about them
  - How they want ChatGPT to respond
- Memory feature silently extracts facts from conversations

#### Opt-in Explicit (Gemini pattern)
- Memory feature must be manually activated
- User chooses when to let Gemini remember something
- Always announces when using a memory

### Common Information Collected

| Category | Examples |
|----------|----------|
| Identity | Name, role/profession, location |
| Communication preferences | Tone, verbosity, formality level |
| Domain expertise | Technical level, areas of knowledge |
| Goals/context | Current projects, learning objectives |
| Behavioral patterns | Usage times, preferred models, conversation depth |
| Relationships | Team members, organization context |

### Best Practices for Onboarding

1. **Start frictionless** -- let users talk immediately, learn gradually
2. **Offer optional "Custom Instructions"** -- power users can front-load preferences
3. **Be transparent** -- show what you remember, let users edit/delete
4. **Progressive disclosure** -- don't ask 20 questions upfront
5. **Separate stated vs inferred** -- different confidence levels for explicit vs implicit knowledge
6. **Project/context isolation** -- different memory contexts for different use cases

---

## 5. Architectural Comparison Summary

| Feature | ChatGPT | Claude | Gemini | Mem0 |
|---------|---------|--------|--------|------|
| Memory injection | Automatic, every message | On-demand via tools | Opt-in, announced | API-driven, layered |
| User visibility | Partial (can see/delete saved memories) | Full (tool calls visible) | Full (always announced) | API-controlled |
| Memory format | Numbered list with timestamps | XML-like structured facts | Fixed schema with categories | JSON with metadata |
| Retrieval | Pre-computed summaries | Real-time search of raw history | Schema-based lookup | Vector + graph search |
| Forgetting | Manual deletion only | Deleting convos removes related memories | Manual deletion | Automated decay + manual |
| Profile building | Automatic (17-20 metadata points) | Minimal (on-demand only) | Opt-in per-prompt | Configurable per layer |
| Title generation | Auto via separate model call | Auto | Auto | N/A (library) |

---

## Sources

- [ChatGPT Memory Deep Dive (Embrace The Red)](https://embracethered.com/blog/posts/2025/chatgpt-how-does-chat-history-memory-preferences-work/)
- [ChatGPT Memory Reverse Engineered (LLMRefs)](https://llmrefs.com/blog/reverse-engineering-chatgpt-memory)
- [Claude Memory Reverse Engineered (Manthan Gupta)](https://manthanguptaa.in/posts/claude_memory/)
- [Claude vs ChatGPT Memory Comparison (Simon Willison)](https://simonwillison.net/2025/Sep/12/claude-memory/)
- [OpenAI Memory FAQ](https://help.openai.com/en/articles/8590148-memory-faq)
- [Gemini Memory Feature (VCSolutions)](https://www.vcsolutions.com/blog/understanding-google-gemini-long-term-memory-features/)
- [Gemini Memory Schema (Shloked)](https://www.shloked.com/writing/gemini-memory)
- [Mem0 Research Paper (arXiv:2504.19413)](https://arxiv.org/abs/2504.19413)
- [Mem0 Memory Types Docs](https://docs.mem0.ai/core-concepts/memory-types)
- [Mem0 Agent Memory Blog](https://mem0.ai/blog/memory-in-agents-what-why-and-how)
- [LangGraph Memory Overview](https://docs.langchain.com/oss/python/langgraph/memory)
- [Letta/MemGPT Concepts](https://docs.letta.com/concepts/memgpt/)
- [Three Types of Long-term Memory for AI Agents (MLMastery)](https://machinelearningmastery.com/beyond-short-term-memory-the-3-types-of-long-term-memory-ai-agents-need/)
- [Memory in AI Agents (Leonie Monigatti)](https://www.leoniemonigatti.com/blog/memory-in-ai-agents.html)
- [Memory in the Age of AI Agents Survey (arXiv:2512.13564)](https://arxiv.org/abs/2512.13564)
- [Pi AI Onboarding](https://pi.ai/onboarding)
- [Pi AI Review (AI Founder Kit)](https://aifounderkit.com/ai-tools/pi-review-features-pricing-alternatives/)
- [Replika AI Overview (eesel.ai)](https://www.eesel.ai/blog/replika-ai)
- [AI Memory Comparison (Pieces)](https://pieces.app/blog/types-of-ai-memory)
- [Building Onboarding Flows with AI (Prototypr)](https://www.prototypr.ai/blog/insights-building-onboarding-flows-with-ai)
- [Redis Memory Management for AI Agents](https://redis.io/blog/build-smarter-ai-agents-manage-short-term-and-long-term-memory-with-redis/)
- [AWS AgentCore Long-term Memory Deep Dive](https://aws.amazon.com/blogs/machine-learning/building-smarter-ai-agents-agentcore-long-term-memory-deep-dive/)
