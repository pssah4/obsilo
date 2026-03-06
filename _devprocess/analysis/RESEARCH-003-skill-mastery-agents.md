# AI Agent Skill Mastery -- Research Analysis

**Date**: 2026-02-25
**Purpose**: Practical patterns for agents that truly KNOW their capabilities instead of rediscovering them each time.

---

## Table of Contents

1. [Tool/Skill Awareness Across Frameworks](#1-toolskill-awareness-across-frameworks)
2. [Procedural Memory -- Remembering HOW to Do Tasks](#2-procedural-memory----remembering-how-to-do-tasks)
3. [Learned Workflows -- Faster the Second Time](#3-learned-workflows----faster-the-second-time)
4. [Agent Memory Beyond RAG](#4-agent-memory-beyond-rag)
5. [Muscle Memory -- Pre-Compiled Action Sequences](#5-muscle-memory----pre-compiled-action-sequences)
6. [Synthesis: Applicable Patterns for Obsidian Agent](#6-synthesis-applicable-patterns-for-obsidian-agent)

---

## 1. Tool/Skill Awareness Across Frameworks

### Pattern A: System Prompt Embedding (All Frameworks)

Every major framework embeds tool knowledge directly into the system prompt. The model sees tool names, descriptions, and parameter schemas as part of its context window. This is the baseline -- there is no framework that relies on runtime discovery alone.

**LangChain / LangGraph**: Tool descriptions are injected into the system prompt as part of composable prompt assembly. The final prompt = base instructions + custom system prompt + dynamic middleware injections. Tools have JSON schemas for parameters. The ReAct pattern (Reason-Act-Observe) drives tool selection iteratively.

**OpenAI Responses API** (successor to Assistants API): Functions are described as JSON schemas. The model selects functions by comparing the user request against registered tool descriptions. Full conversation context is maintained so the model always knows what happened before.

**AutoGen (Microsoft)**: Python functions, CLI tools, or external APIs are registered directly into agent configuration. Agents invoke tools conditionally with automatic tool selection and parameter inference. Memory is managed via ChromaDB or Redis vector stores.

**Anthropic / Claude Code**: Tool descriptions are treated as "system prompts for agent behavior." Anthropic's key insight: "think of how you would describe your tool to a new hire on your team." Even small refinements to tool descriptions yield dramatic improvements -- Claude Sonnet 3.5 achieved state-of-the-art on SWE-bench Verified after precise description refinements.

### Pattern B: Progressive Disclosure / Skills (Anthropic, LangChain)

Instead of loading all tool knowledge upfront, these frameworks reveal capabilities on demand.

**Claude Agent Skills**: The most sophisticated implementation found.
- Skills are SKILL.md files with YAML frontmatter (name, description, allowed-tools, model override)
- Only minimal metadata (names + descriptions) loads into initial context
- On invocation, the full SKILL.md content is injected as a hidden user message (`isMeta: true`)
- Skills can reference sub-files that load progressively (scripts/, references/, assets/)
- Selection uses pure LLM reasoning against the `<available_skills>` section -- no regex, no keyword matching
- Skills create "temporary, scoped behavior" -- they activate, run, and revert

**LangChain Skills**: Similar but simpler. A `load_skill` tool returns a specialized prompt. Skills are "prompt-driven specializations" that an agent can invoke on-demand. Supports hierarchical sub-skills and dynamic tool registration.

### Pattern C: Multi-Agent Specialization (LangGraph, CrewAI, AutoGen)

Instead of one agent knowing everything, specialize agents with focused toolsets.

**LangGraph Multi-Agent**: Each agent has its own prompt, LLM, tools, and custom code. "An agent is more likely to succeed on a focused task than if it has to select from dozens of tools." Agents are grouped by tool category and responsibility.

**CrewAI**: Agents have roles, goals, and backstory. Tools are assigned per-agent. Memory is scoped per-agent via path-based hierarchy (`/agent/researcher`).

### Key Takeaway for Implementation

Tool descriptions are the single highest-leverage intervention. Anthropic proved this empirically. The second highest leverage is progressive disclosure (load detailed knowledge only when needed). The third is multi-agent specialization to reduce tool selection complexity.

---

## 2. Procedural Memory -- Remembering HOW to Do Tasks

### Pattern A: Voyager Skill Library (NVIDIA / MineDojo)

The gold standard for "learned procedures as reusable code."

**Architecture**:
```
Skill = {
  code:        executable function (JS/Python),
  description: natural language docstring,
  embedding:   vector of description via text-embedding-ada-002
}
```

**Storage**: Vector database. Key = embedding of description. Value = executable code.

**Retrieval**: Given a new task:
1. GPT-3.5 generates a "general suggestion" for solving the task
2. Suggestion + environment state = query
3. Top-5 skills retrieved via cosine similarity
4. Retrieved skill code provided to GPT-4 during generation

**Verification Loop** (up to 4 rounds):
1. Execute generated code in environment
2. Capture: environment feedback + execution errors + critic assessment
3. Self-verification agent (separate GPT-4 call) determines success/failure
4. If failed: feedback fed back into next generation round
5. If succeeded: code + description stored in skill library

**Compositionality**: "Your function will be reused for building more complex functions. Therefore, you should make it generic and reusable." Complex skills call simpler skills as nested functions. This compounds capabilities over time.

### Pattern B: LEGOMem (Microsoft, AAMAS 2026)

Modular procedural memory for multi-agent systems.

**Memory Decomposition**:
- **Full-Task Memory**: complete task description + high-level plan + orchestration trace. Given to orchestrator agents.
- **Subtask Memory**: subtask description + localized agent behavior + tool-use + observations. Given to task agents.

**Data Structure**:
```json
{
  "high_level_plan": ["step1 -> agent_A", "step2 -> agent_B"],
  "subtasks": [
    {
      "agent": "agent_A",
      "description": "extract data from PDF",
      "steps": [{"think": "...", "action": "..."}],
      "observations": "found 3 tables"
    }
  ],
  "reflections": "next time check encoding first"
}
```

**Storage**: FAISS vector DB with OpenAI text-embedding-3-large. Full-task memories indexed by task description embedding. Subtask memories indexed by subtask description embedding.

**Retrieval Variants**:
1. *Vanilla*: Retrieve top-K full-task memories by task similarity, extract subtasks
2. *Dynamic*: Query agent-specific memory banks during execution as subtasks emerge
3. *QueryRewrite*: LLM generates draft plan first, rewrites subtasks, then retrieves

**Key Finding**: Orchestrator memory is critical for planning. Agent memory improves execution. Both together yield best results. Even weak models (small LLMs) narrow the gap with strong models when given procedural memory.

### Pattern C: Mem^p (Procedural Memory Paper, 2025)

**Dual Representation**: Stores both full historical trajectories AND script-like abstractions. Memory unit: `m = B(trajectory, reward)`.

**Retrieval**: Cosine similarity on task description embeddings. Two strategies tested: query-based (task description similarity) and AveFact (keyword extraction with averaged similarity).

**Update Strategies**:
1. *Vanilla addition*: All trajectories appended
2. *Validation filtering*: Only successes stored
3. *Reflection adjustment*: Failed executions combined with original memory for correction

Reflection-based updates delivered +0.7 accuracy and 14 fewer steps by the final task group.

**Cross-Model Transfer**: Procedures learned by GPT-4o transferred to Qwen2.5-14B yielding 5% completion increase.

---

## 3. Learned Workflows -- Faster the Second Time

### Pattern A: Agent Workflow Memory (AWM, ICML 2025)

The most directly applicable pattern for "agent learns from success."

**Workflow Representation**:
```
Workflow = {
  description: "enter_flight_locations",   // NL summary
  steps: [                                 // abstracted trajectory
    { state: "form visible", action: "CLICK [textbox] Origin" },
    { state: "textbox focused", action: "TYPE: {origin-city}" },
    { state: "popup shown",    action: "CLICK [popup-option]" }
  ]
}
```

Variables like `{origin-city}` abstract away example-specific values, enabling generalization.

**Offline Learning**:
```
Training: I(examples_train) -> workflows_offline
Test:     L(query, memory + workflows_offline, observation) -> action
```
Induced once from canonical examples. Same workflow set used for all test tasks.

**Online Learning** (no training data needed):
```
For each task t:
  1. Agent generates trajectory
  2. Evaluator judges success (LLM-based, no human)
  3. If success: extract reusable workflows from trajectory
  4. Append to memory: M^t + {new_workflows} -> M^(t+1)
```
Memory accumulates over time. Each success adds new workflow patterns.

**Injection**: Workflows are injected into system/context prompts as structured step sequences. The LLM attends to relevant workflows contextually.

**Results**: +24.6% and +51.1% relative success rate on Mind2Web and WebArena. Fewer steps to complete tasks. Generalizes across websites and domains.

### Pattern B: Reflexion (NeurIPS 2023)

Learning from failure rather than success.

**Architecture**:
- Short-term memory: current attempt trajectory
- Long-term memory: distilled reflections from all past attempts

**Process**:
1. Attempt task, generate trajectory
2. Evaluate (success/failure)
3. If failed: self-reflection generates insight ("I should have checked X before Y")
4. Store reflection in long-term memory
5. Next attempt includes all past reflections in prompt

**Key Property**: No model fine-tuning required. Learning is purely in-context via accumulated verbal reflections. Lightweight and framework-agnostic.

### Pattern C: Mengram Procedural Evolution

Procedures evolve automatically when they fail.

**Versioning**:
```
v1: build -> push -> deploy
v2: build -> run migrations -> push -> deploy          (after DB failure)
v3: build -> run migrations -> check memory -> push -> deploy  (after OOM)
```

**API**:
```python
m.procedure_feedback(proc_id, success=False,
    context="OOM error on step 3", failed_at_step=3)
# -> Creates new version with remediation step inserted
```

Complete version history maintained. Each evolution includes the failure context that triggered it.

---

## 4. Agent Memory Beyond RAG

### The Three-Memory Architecture (Consensus Across Research)

Every serious framework now implements some variant of the human cognitive memory model:

| Memory Type | What It Stores | How It's Used | Analogy |
|-------------|---------------|---------------|---------|
| **Semantic** | Facts, knowledge, entity relationships | Retrieved by similarity search | "I know that..." |
| **Episodic** | Past events, task executions, outcomes | Retrieved by temporal/contextual query | "Last time I did X..." |
| **Procedural** | Step-by-step workflows, action sequences | Retrieved by task similarity, replayed | "The way to do X is..." |

### CrewAI Memory (Production Implementation)

**Storage Backends**: LanceDB (vector, default) for semantic/episodic. SQLite3 for long-term structured memory. Path: `.crewai/memory/`.

**Unified Memory API**:
```python
memory = Memory()
memory.remember("The API rate limit is 1000 req/min")  # auto-classified
matches = memory.recall("rate limit?")                   # composite scored
```

**Composite Scoring**:
```
score = 0.5 * semantic_similarity + 0.3 * recency_decay + 0.2 * importance
```
Where: similarity = `1/(1+distance)`, decay = `0.5^(age/half_life)`, importance = 0-1 score.

**Scope Hierarchy**: Path-based (`/project/alpha`, `/agent/researcher`). Queries only search within the relevant scope subtree. Enables multi-agent isolation.

**LLM-Assisted Indexing**: On save (if scope/categories omitted), the LLM analyzes content to suggest scope, categories, importance, entities, dates. On recall (complex queries), the LLM analyzes the query for keywords, time hints, scopes.

**Auto-Consolidation**: When similarity > 0.85, the LLM decides whether to keep, update, delete, or insert new records. Prevents duplication.

### Letta/MemGPT (OS-Like Memory Hierarchy)

**Core Insight**: Treat the context window like RAM and external storage like disk.

**Two-Tier Architecture**:
- **In-Context (Core Memory)**: System instructions + read-write memory blocks + recent conversation. Analogous to RAM.
- **Out-of-Context**: Archival memory (vector DB) + recall memory (conversation history on disk). Analogous to disk.

**Self-Editing Memory**: Agents use tool calls to modify their own memory blocks. The model decides what to keep in context and what to evict. When context fills up, conversation history is compacted into recursive summaries stored as memory blocks.

**Memory Blocks**: Each block has a label, description, value (tokens), and character limit. Agents can update their own blocks based on new information. External "sleep-time agents" can also modify blocks for context optimization.

### Mengram (Three-Type Memory API)

**Unique Feature**: Single API call auto-extracts all three memory types from a message.

**Cognitive Profile**: `/v1/profile` endpoint synthesizes all memory into a ready-to-use system prompt:
```
"You are talking to Ali, a developer in Almaty. Uses Python, PostgreSQL.
Recently debugged pgvector deployment. Prefers direct communication."
```

**Procedure Evolution**: Procedures version automatically on failure feedback. Each version includes failure context and remediation. Bidirectional traceability between episodes and procedures.

---

## 5. Muscle Memory -- Pre-Compiled Action Sequences

### Pattern A: muscle-mem Library (pig-dot-dev)

The only production library found specifically for "caching agent tool-calling patterns."

**Core Mechanism**:
```python
engine = Engine()
engine.set_agent(your_agent).finalize()

engine("do some task")   # cache miss -> invokes agent, records trajectory
engine("do some task")   # cache hit  -> replays recorded tool calls
```

**Check System** (Cache Validation):
```python
Check(
    capture: Callable -> T,           # extract environment features
    compare: Callable[[T, T]] -> bool  # compare current vs cached state
)
```

Pre-checks validate before execution. Post-checks validate after. Developer defines what makes a cached trajectory safe to replay.

**Dynamic Parameters**: Runtime argument substitution without breaking cache:
```python
engine("fill form: John", params={"name": "John"})  # records
engine("fill form: Jane", params={"name": "Jane"})  # replays with substitution
```

**Task Tagging**: Trajectories organized into buckets. Same task string with different tags = separate caches.

**Key Design Decision**: The developer must explicitly define validation logic. The library does NOT try to automatically determine when replay is safe. This is pragmatic -- false cache hits in agent systems can be catastrophic.

### Pattern B: Voyager-Style Skill Replay

When a similar task is encountered:
1. Retrieve top-5 matching skills from vector DB
2. Provide retrieved code directly to the LLM
3. The LLM can call existing skills without regenerating them
4. If exact match: skip reasoning entirely, call the function

This is not "skip the LLM" but rather "give the LLM a shortcut." The model sees working code for a similar task and adapts it rather than reasoning from scratch.

### Pattern C: AWM Online -- Workflow Injection as Muscle Memory

When the agent encounters a task matching a stored workflow:
1. The workflow (step-by-step recipe) is injected into the prompt
2. The agent follows the recipe rather than reasoning from first principles
3. This reduces both token usage and error rate

The "muscle memory" here is in the prompt, not in compiled code. But the effect is the same: the agent acts faster and more reliably because it has a proven recipe.

---

## 6. Synthesis: Applicable Patterns for Obsidian Agent

### What Already Exists in Our Architecture

- Tool registration with descriptions (ToolRegistry)
- System prompt with mode-specific tool knowledge
- Semantic index (vectra) for content search
- Context condensing for conversation management
- Multi-agent via new_task / spawnSubtask

### Patterns Worth Implementing (Ordered by Impact)

#### Tier 1: High Impact, Low Effort

**1. Tool Description Engineering** (Anthropic pattern)
- Audit all 30+ tool descriptions for clarity, examples, and workflow context
- Add "when to use" and "when NOT to use" guidance to each tool
- Add few-shot examples to complex tools
- Test iteratively against real tasks

**2. Workflow Templates as Skills** (Claude Skills + AWM pattern)
- Define common workflows as SKILL.md-like templates
- Store step-by-step recipes for frequent tasks (e.g., "create a new feature", "debug an error", "refactor a file")
- Inject relevant workflow into system prompt when task matches
- Start with manually authored workflows, evolve to auto-captured

#### Tier 2: Medium Impact, Medium Effort

**3. Episodic Memory -- Task Execution Log** (CrewAI + Mengram pattern)
- After each successful task: store task description + steps taken + outcome
- Index by task description embedding (use existing vectra index)
- Before new task: retrieve similar past executions, inject as context
- Data structure:
```typescript
interface TaskEpisode {
  taskDescription: string;
  steps: { tool: string; input: string; result: string }[];
  outcome: "success" | "failure";
  reflection?: string;
  timestamp: number;
  embedding: number[];
}
```

**4. Procedural Memory -- Learned Tool Sequences** (Voyager + LEGOMem pattern)
- When a tool sequence succeeds: extract as reusable procedure
- Store: description (NL) + tool sequence (structured) + prerequisites
- Retrieve by task similarity before execution
- Data structure:
```typescript
interface Procedure {
  name: string;
  description: string;
  steps: { tool: string; parameterTemplate: Record<string, string> }[];
  prerequisites: string[];
  successCount: number;
  version: number;
  embedding: number[];
}
```

#### Tier 3: High Impact, High Effort

**5. Online Workflow Learning** (AWM Online + Reflexion pattern)
- After each task: evaluate success (self-assessment or user feedback)
- If success: extract reusable workflow patterns, abstract away specifics
- If failure: generate reflection, store for future avoidance
- Accumulated workflows injected into system prompt for matching tasks
- This creates genuine "learning from experience"

**6. Muscle Memory Cache** (muscle-mem pattern)
- For highly repetitive operations: cache the exact tool call sequence
- Define validation checks per task type
- On cache hit: replay tool calls without LLM reasoning
- Significant cost/latency reduction for common operations
- Risk: must define safe replay conditions carefully

### Architecture Sketch

```
                    +------------------+
                    |   System Prompt  |
                    | + Tool Descs     |
                    | + Active Mode    |
                    | + Workflow (if   |
                    |   matched)       |
                    +--------+---------+
                             |
                    +--------v---------+
                    |    Agent Loop    |
                    |  (AgentTask.ts)  |
                    +--------+---------+
                             |
              +--------------+--------------+
              |              |              |
     +--------v---+  +------v------+  +----v--------+
     | Tool Exec  |  | Memory Svc  |  | Workflow    |
     | Pipeline   |  |             |  | Matcher     |
     +--------+---+  +------+------+  +----+--------+
              |              |              |
              |    +---------+---------+    |
              |    |                   |    |
         +----v---v--+  +--------+  +-v----v-----+
         | Episodic  |  |Semantic|  | Procedural |
         | Memory    |  |Memory  |  | Memory     |
         | (vectra)  |  |(vectra)|  | (vectra +  |
         |           |  |        |  |  JSON)     |
         +-----------+  +--------+  +------------+
```

### Implementation Priority for Obsidian Agent

1. **Tool description audit** -- zero new code, immediate improvement
2. **Workflow templates** -- extends existing Skills/modes system
3. **Episodic memory** -- leverages existing vectra infrastructure
4. **Procedural memory** -- new data structure but familiar storage pattern
5. **Online learning** -- requires evaluation loop (biggest architectural change)
6. **Muscle memory cache** -- only for proven high-frequency patterns

---

## Sources

### Papers
- [Voyager: An Open-Ended Embodied Agent with LLMs](https://arxiv.org/abs/2305.16291) -- Skill library pattern
- [Agent Workflow Memory (AWM)](https://arxiv.org/abs/2409.07429) -- Reusable workflow induction, ICML 2025
- [LEGOMem: Modular Procedural Memory](https://arxiv.org/abs/2510.04851) -- Role-aware memory decomposition, AAMAS 2026
- [Mem^p: Exploring Agent Procedural Memory](https://arxiv.org/html/2508.06433) -- Procedural memory retrieval and update
- [Reflexion: Language Agents with Verbal Reinforcement Learning](https://arxiv.org/abs/2303.11366) -- Learning from failure, NeurIPS 2023
- [Agentic Memory: Learning Unified LTM and STM](https://arxiv.org/pdf/2601.01885) -- Unified memory architecture

### Framework Documentation
- [CrewAI Memory Documentation](https://docs.crewai.com/en/concepts/memory) -- Unified Memory API with composite scoring
- [LangChain Skills Pattern](https://docs.langchain.com/oss/python/langchain/multi-agent/skills) -- Prompt-driven specializations
- [Letta/MemGPT Agent Memory](https://www.letta.com/blog/agent-memory) -- OS-like memory hierarchy
- [AutoGen Memory and RAG](https://microsoft.github.io/autogen/stable//user-guide/agentchat-user-guide/memory.html) -- Vector DB memory stores
- [OpenAI Function Calling](https://developers.openai.com/api/docs/guides/function-calling/) -- Tool awareness via JSON schemas

### Implementation Libraries
- [muscle-mem](https://github.com/pig-dot-dev/muscle-mem) -- Behavior cache for AI agent tool-calling replay
- [Mengram](https://github.com/alibaizhanov/mengram) -- Three-type memory API (semantic, episodic, procedural)
- [Voyager Skill Library](https://github.com/MineDojo/Voyager/tree/main/skill_library) -- Reference skill library implementation
- [AWM Code](https://github.com/zorazrw/agent-workflow-memory) -- Agent Workflow Memory implementation

### Best Practices
- [Anthropic: Writing Tools for Agents](https://www.anthropic.com/engineering/writing-tools-for-agents) -- Tool description engineering
- [Claude Agent Skills Deep Dive](https://leehanchung.github.io/blogs/2025/10/26/claude-skills-deep-dive/) -- Progressive disclosure architecture
- [Anthropic: Agent Skills Overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) -- SKILL.md structure
- [Three Types of Long-Term Memory AI Agents Need](https://machinelearningmastery.com/beyond-short-term-memory-the-3-types-of-long-term-memory-ai-agents-need/) -- Memory taxonomy
- [Memory in AI Agents Survey](https://www.leoniemonigatti.com/blog/memory-in-ai-agents.html) -- Comprehensive overview
