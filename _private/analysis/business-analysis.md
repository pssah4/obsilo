# Business Analysis: Obsidian Agent (Obsidian Agentic Vault Operator)
Status: Draft
Scope: C (MVP)
Date: 2026-02-16

## 1. Executive Summary
### 1.1 Problem statement (2-3 sentences)
Knowledge work in Obsidian vaults is currently constrained by manual context assembly, repetitive workflows, and unsafe AI-driven edits that lack diff/restore safety. Users want an agent that can operate on the vault (not only write text) while remaining controllable, auditable, and local-only.

### 1.2 Proposed approach (non-technical, 2-3 sentences)
Provide an agentic “operating layer” inside Obsidian that uses controlled actions (tools), modes, and an approval-by-default workflow for any write/side-effect operation. All changes are protected by local checkpoints (diff/restore) and an operation log, with optional semantic retrieval to support vault-wide synthesis and analysis.

### 1.3 Expected outcomes (bullets)
- Reduced time spent on repetitive vault maintenance (summaries, consolidation, structured outputs)
- Lower risk of data loss or “AI corruption” via mandatory approval + checkpoint restore
- More reliable vault-wide synthesis/analysis using local-only retrieval and metadata traversal
- Reproducible workflows via reusable modes/workflows/skills

## 2. Business Context
### 2.1 Background
Obsidian Agent transfers the interaction and governance patterns of Kilo Code (tool-use, orchestrator, approval, modes, checkpoints) into Obsidian vault-based knowledge work.

**Source-of-truth note:** The task request references `/docs/*.md`, but the workspace contains equivalent source documents under `/context/*.md` (e.g., `context/01_product-vision.md`, `context/02_capability-scope.md`, `context/03_research-findings.md`, `context/04_decisions-adrs.md`, `context/05_constraints-nfrs.md`, `context/06_user-flows.md`, `context/08_deep-research-consolidated.md`). This analysis is grounded in those files, especially the binding feasibility constraints in `context/08_deep-research-consolidated.md`.

### 2.2 Current state (As-Is)
- Users manually gather context (notes, links, tags) for synthesis and documentation.
- AI assistance (where used) can produce unsafe edits without strong diff/restore mechanisms.
- Obsidian provides vault CRUD and some core-plugin capabilities, but advanced automation is uneven (Canvas is JSON-based; Bases lacks stable API; internal Graph is not accessible).

### 2.3 Desired state (To-Be)
- A desktop-first, local-only agent can read/analyze the vault and propose actions.
- Any write/destructive action requires explicit approval by default.
- Each tool action creates a local checkpoint enabling diff preview and restore.
- Users can generate structured outputs (summaries, tasks, consolidated docs) and project relationship maps (Canvas projection) without relying on internal Graph manipulation.

### 2.4 Gap analysis
- Safety gap: lack of standardized approvals, logs, and checkpoint restore across AI edits.
- Orchestration gap: users lack reusable workflows (modes/skills) and a consistent “tool” abstraction.
- Feasibility constraints: internal Graph manipulation is not available; Bases automation is high-risk; Canvas is feasible via JSON; performance on large vaults must be managed.

## 3. Stakeholders
| Stakeholder | Role | Interest (H/M/L) | Influence (H/M/L) | Needs |
|---|---|---|---|---|
| Primary Obsidian user (knowledge worker) | End user | H | H | Fast, safe vault edits; controllable automation; local-only privacy |
| Power user / workflow builder | Advanced end user | H | M | Custom modes/workflows; predictable behavior; auditability |
| Plugin maintainer (project owner) | Builder / maintainer | H | H | Clear scope, feasibility-aligned sequencing, risk containment |
| Obsidian ecosystem constraints | External dependency | M | H | Compatibility with plugin API boundaries; no core-plugin hacks |

## 4. Users / Personas
Persona:
- Role: Knowledge worker using Obsidian desktop for meeting notes, research notes, and project documentation
- Goals: Convert raw notes into structured outputs; synthesize across notes; keep vault consistent
- Pain points: Manual context gathering; repetitive refactoring; fear of AI edits damaging notes
- Frequency: Daily

Persona:
- Role: Obsidian power user managing a large vault
- Goals: Vault-wide analysis, relationship mapping, repeatable workflows
- Pain points: Performance issues; fragile automation; lack of safe bulk operations
- Frequency: Weekly to daily

## 5. Problem Analysis
- Root causes (or best hypotheses)
  - Obsidian workflows are flexible but mostly manual; automation capabilities vary by core plugin.
  - AI text generation lacks built-in operational governance (approval, checkpoints, logging) at vault level.
  - Some desired automations are not technically stable (Bases) or not accessible (internal Graph).
- Business impact (money/time/risk)
  - Time lost to repetitive work and rework; risk of irreversible content corruption.
  - Reduced trust in using AI for anything beyond small edits.
- User impact (friction/errors/delay)
  - High friction to synthesize information across a vault; fear of “bulk AI actions”.

## 6. Goals & Success Metrics
| KPI | Baseline | Target | Timeframe | Measurement |
|---|---:|---:|---|---|
| % of write actions executed with approval + checkpoint | Unknown | 100% | At launch | Instrumentation from operation log |
| Restore success rate (checkpoint restore completes without data loss) | Unknown | >=99% | At launch | Automated test scenarios + user telemetry (local log) |
| Time to complete “Meeting -> Summary -> Tasks” flow | Unknown | >=50% reduction vs baseline | 4 weeks after adoption | User self-report or timed task study |
| Vault-wide synthesis perceived quality | Unknown | Defined rubric + improvement over baseline | 4–8 weeks | Qualitative evaluation rubric |
| Indexing time for large vault | Unknown | Defined target (TBD) | Before 1.0 | Benchmark on representative vault sizes |

## 7. Scope Definition
### 7.1 In scope
**Non-negotiable product constraints (binding):**
- Desktop-first, local-only
- Approval-by-default for any write/side-effect operation
- Snapshot/checkpoint before write; diff + restore available
- Logging of all tool actions
- Ignore system (`.obsidian-agentignore`)
- Checkpoints implemented via isomorphic-git shadow repo under `.obsidian-agent/checkpoints`
- No direct internal Graph manipulation; any graph view is a projection based on accessible signals
- Canvas JSON manipulation is allowed (Canvas creation via `.canvas` JSON)

**Capabilities (from defined scope docs) — refined and sequenced:**
- Core interaction: sidebar chat; modes; model provider layer (BYO-model)
- Prompt & context: mentions-based context aggregation; prompt enhancement; language support
- Content operations: read tools; write tools; inline editing
- Vault operations: file system operations; dashboard/view automation (limited to file/canvas outputs); command execution (bounded + approved)
- Canvas: graph projection via `.canvas` generation
- Knowledge layer: semantic index (local vector DB) + vault-wide analysis (subject to performance gating)
- Workflows: workflow engine; skills; rules
- Orchestrator: subtasks
- Governance: approval system; checkpoints; ignore system

### 7.2 Out of scope
**Explicit out-of-scope for V1 and/or 1.0 (based on vision + research constraints):**
- Any cloud backend or server component
- Requiring the user to use external Git for their vault
- Core plugin deep hooks / internal APIs beyond stable plugin API
- Direct access to or manipulation of Obsidian internal Graph / “memory graph intern”
- Full UI automation outside executing existing commands
- Mobile-first / mobile MVP

**Defer (V2 / high risk):**
- Bases automation beyond safe command-level interactions (high-risk due to no stable API)

### 7.3 Assumptions
- Obsidian desktop Electron runtime provides sufficient Node capabilities for local DB and isomorphic-git.
- Canvas JSON spec remains stable enough for programmatic `.canvas` generation.
- Users accept an approval step for all writes in exchange for safety.
- “Dashboard/view automation” is interpreted as generating files/canvases/templates, not UI-driving.

### 7.4 Constraints
- Performance must remain acceptable for large vaults (exact vault size targets TBD).
- No data corruption: restore paths must be robust.
- Local-only privacy: no hidden network operations by default (BYO providers are user-configured).

## 8. Risks
| Risk | Probability | Impact | Mitigation |
|---|---|---|
| Bases automation proves unstable/unreliable | H | M/H | Keep as V2; constrain to explicit user-invoked commands only |
| Canvas JSON format changes or edge cases break generation | M | M | Keep Canvas operations isolated; validate JSON; version-guard |
| Performance issues on large vaults (indexing/search) | M/H | H | Performance gates; incremental indexing; user controls; benchmarking |
| Command execution enables unintended side effects | M | H | Approval-by-default; allowlist/categorization; clear previews |
| Checkpoint system overhead or repo corruption | M | H | Treat checkpoint as first-class; test restore; protect `.obsidian-agent/checkpoints` |
| PDFs / binary attachments in “Research -> Synthesis” flow not feasible | M | M | Clarify scope: notes-first; treat PDF ingestion as optional/deferred |

## 9. High-level Capability Candidates (for RE)
| Priority | Capability / Feature Candidate | Why it matters |
|---|---|---|
| P0 (MUST) | Approval system (approval-by-default; optional auto-approve categories) | Core safety and trust boundary |
| P0 (MUST) | Checkpoints per tool action (diff + restore) | Prevents irreversible AI edits; enables rollback |
| P0 (MUST) | Operation logging + ignore system (`.obsidian-agentignore`) | Auditability + safety + controllable scope |
| P0 (MUST) | Sidebar chat + modes | Primary user interaction model; reusable “agent personas” |
| P0 (MUST) | Read/write/inline editing tools (vault notes) | Core value: controlled vault operator |
| P0 (MUST) | Vault CRUD + bounded command execution (approved) | Enables safe operations beyond text generation |
| P0 (MUST) | Canvas graph projection via `.canvas` JSON generation | Feasible “graph view” without internal Graph access |
| P1 (SHOULD) | Mentions-based context aggregation + prompt enhancement | Improves reliability and reduces manual context work |
| P1 (SHOULD) | Workflow engine + skills + rules | Repeatability of multi-step knowledge workflows |
| P1 (SHOULD) | Orchestrator subtasks (isolation + merge) | Enables structured work decomposition |
| P1 (SHOULD) | Semantic index (local vector DB) + vault-wide analysis | Differentiation for synthesis/analysis; gated by performance |
| P2 (NICE / V2) | Template automation | Convenience; risk depends on command-level stability |
| P2 (NICE / V2) | Canvas auto-creation (beyond projection) | Higher automation; needs careful UX and safety |
| P2 (NICE / V2) | Explicit graph analysis (on plugin-built hybrid graph) | Advanced insights; must not rely on internal Graph |
| P2 (NICE / V2) | Parallel agents | Complexity; increases governance/merge risks |
| P2 (NICE / V2) | UX enhancements | Iterative improvements post-core safety |

## 10. Open Questions (for RE / Architecture)
- Release definition: Is “1.0” intended to include both V1 and V2 items, or should V2 become 1.1+ to protect delivery risk?
- What vault sizes define “large vaults” for performance targets (e.g., #files, total MB)?
- What is the minimum acceptable semantic layer for V1: metadata traversal only, or also vector retrieval?
- What commands are permitted for “command execution” and how are they categorized for approval/auto-approval?
- Is PDF ingestion/extraction required for V1 “Research -> Synthesis”, or is notes-only acceptable for V1?
- What are the first 3–5 “skills/workflows” to ship (from user flows) as opinionated defaults?

## 11. Handoff to Orchestrator (mandatory)
### What is decided
- Desktop-first, local-only, BYO-model, approval-by-default are binding.
- isomorphic-git checkpoint system in `.obsidian-agent/checkpoints` is binding.
- No internal Graph manipulation; Canvas JSON generation is the supported projection mechanism.
- Bases automation is high-risk and must be V2/deferred.

### What is still open / needs clarification
- What exactly constitutes 1.0 versus V2 (sequencing versus release scope).
- Performance targets and the minimal semantic layer for V1.
- Attachment/PDF support expectations.

### What RE must produce next
- Convert the refined MUST/SHOULD/NICE capability set into testable requirements and acceptance criteria.
- Define explicit in-scope/out-of-scope statements per capability (especially command execution and “dashboard/view automation”).
- Define measurable NFR targets (performance, reliability, safety) and validation approach.

## ORCHESTRATOR SUMMARY (<= 12 lines)
- Scope (A/B/C): C (MVP)
- Primary users: Obsidian desktop knowledge workers + power users
- Top goals: safe agentic vault operations; reduced manual context work; reproducible workflows
- Top KPIs: 100% approved writes with checkpoints; restore success >=99%; flow time reduction targets (TBD)
- P0 capabilities: approval system; checkpoints; logging+ignore; sidebar chat+modes; read/write/inline tools; vault ops; canvas projection
- Key constraints: local-only; desktop-first; isomorphic-git; no internal graph manipulation; approval-by-default
- Top risks: Bases automation; performance on large vaults; canvas spec drift; command side effects; checkpoint overhead
- Next step: switch to Requirements Engineer

## Memory Update Suggestions (stable facts only)
- Add non-negotiables as stable project constraints: desktop-first, local-only, approval-by-default, snapshot-before-write, operation logging, `.obsidian-agentignore`, isomorphic-git checkpoints in `.obsidian-agent/checkpoints`.
- Add explicit out-of-scope constraints: no internal Graph manipulation; no core-plugin deep hooks; no full UI automation; no cloud backend.
- Add sequencing guardrail: Bases automation is V2/high-risk; Canvas is feasible via JSON; Graph views must be projections only.
