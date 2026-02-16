# Business Analysis: KiloNote (Kilo Code Concepts for Obsidian)
Status: Draft
Scope: C (MVP)
Date: 2026-02-16

## 1. Executive Summary
### 1.1 Problem statement (2-3 sentences)
Work in Obsidian vaults (finding, referencing, restructuring, synthesizing, and drafting notes) is largely manual and becomes slower and error-prone as the vault grows. Existing AI assistance typically lacks a consistent “agentic” operating model (modes/personas, task/subtask orchestration) and—critically—safe, user-approved write operations with reliable rollback.
KiloNote aims to transfer the prioritized Kilo Code capabilities described in [`deep-research-report.md`](deep-research-report.md) into an Obsidian plugin so knowledge work can be performed faster with strong privacy and data-integrity guardrails.

### 1.2 Proposed approach (non-technical, 2-3 sentences)
Deliver an Obsidian plugin that provides an agent interaction surface and a capability set (modes, mentions, safe CRUD, checkpoints, orchestration, semantic search) comparable to Kilo Code, but adapted to a personal Obsidian vault. The user remains in control through explicit approvals for actions that read or modify vault content, and through a restore mechanism for any changes.

### 1.3 Expected outcomes (bullets)
- Faster and more structured knowledge workflows (research → structure → draft → revision) inside Obsidian.
- Reduced manual context copy/paste by using mention-like references to vault objects.
- Safer automated edits: no silent writes; ability to restore/revert changes.
- A “Desktop-first, mobile-later” product baseline with a defined extension path.

## 2. Business Context
### 2.1 Background
Kilo Code provides an “agentic engineering platform” experience (modes/personas, tools with approvals, orchestration via subtasks, checkpoints, mentions, indexing, extensibility). This project targets a domain shift: from codebases/IDEs to Obsidian vaults (notes/attachments).

### 2.2 Current state (As-Is)
- Knowledge work in Obsidian is primarily manual: searching, collecting context, summarizing, and restructuring notes requires repetitive effort.
- Vault write automation is risky without strong safeguards (explicit approval, rollback) and can lead to trust issues.
- There is no single, integrated “agentic platform” for Obsidian that mirrors Kilo’s breadth for personal vault usage (desired end state).

### 2.3 Desired state (To-Be)
- The user can work with an agent in Obsidian using different modes/personas and predictable workflows.
- The user can reference vault context quickly (notes, folders, attachments, URLs, metadata-derived constructs) without manual copy/paste.
- Any vault modifications happen only through explicit user approval, with reliable restore.
- Optional semantic retrieval helps locate and reuse existing vault content.

### 2.4 Gap analysis
Gap drivers:
- Lack of a unified interaction and governance model for “agent + tools” in Obsidian.
- Missing safety rails for write operations and reversible changes.
- Missing scalable context ingestion and retrieval patterns (mentions + semantic search).

## 3. Stakeholders
| Stakeholder | Role | Interest (H/M/L) | Influence (H/M/L) | Needs |
|---|---|---:|---:|---|
| Primary user (you) | Decision maker, user, tester | H | H | Productivity, privacy, safe edits, fast iteration |
| Future Obsidian community | Potential adopters (later) | M | M | Stability, UX clarity, documentation, trust |
| Obsidian plugin review ecosystem | Distribution gate (later) | M | M | Compliance with expectations, no harmful behavior, clear permissions |

## 4. Users / Personas
Persona:
- Role: Solo knowledge worker using a personal Obsidian vault.
- Goals: Draft and refine notes faster; synthesize across many notes; avoid losing/overwriting information.
- Pain points: Manual search + copy/paste; long notes; hard to keep context consistent; fear of automated destructive edits.
- Frequency: Regular (weekly to daily).

Secondary (future):
- Role: Community user with varying vault sizes and plugins.
- Goals: Similar outcomes with strong defaults.
- Pain points: Trust, onboarding complexity, performance.
- Frequency: Varies.

## 5. Problem Analysis
- Root causes / hypotheses
  - Manual context gathering is time-consuming and error-prone.
  - Unsafe automation reduces trust; without reversible operations, users avoid using agents for editing.
  - Vaults are heterogeneous (notes, attachments, metadata), requiring robust referencing patterns.
- Business impact (money/time/risk)
  - Time cost: repeated manual work.
  - Risk cost: accidental data loss or unwanted edits.
- User impact (friction/errors/delay)
  - Context switching, duplication of effort, inconsistent outputs.

## 6. Goals & Success Metrics
Note: The project’s primary success definition is “capability completeness” (feature parity with an explicitly defined, prioritized set). Timeframes/baselines are currently not specified and are tracked as open questions.

| KPI | Baseline | Target | Timeframe | Measurement |
|---|---:|---:|---|---|
| P0 capability completeness (Desktop) | 0 | 100% of defined P0 list implemented and functional | TBD | Feature checklist / acceptance validation |
| Data integrity incidents | Unknown | 0 unrecoverable data-loss incidents | TBD | Manual tracking; restore tests |
| Privacy compliance to stated constraints | N/A | Meets constraints (no telemetry; explicit context sharing) | Continuous | Design/behavior audit |
| Monthly operating cost | Unknown | $\leq 20\,€$/month (typical usage) | TBD | Provider usage reports / estimates |

## 7. Scope Definition
Scope is managed in releases.

### 7.1 In scope (MVP / P0)
P0 capabilities to be delivered for Desktop-first MVP:
- Modes + agent behavior (personas, tool permissions, sticky model selection)
- Mentions (@-style) for referencing vault context (notes/folders/attachments/URLs + metadata-derived references)
- Tool-based vault CRUD with explicit approval / optional auto-approve controls
- Checkpoints / snapshots for restore/rollback of agent-driven changes
- Orchestrator / subtasks for decomposing complex work with isolated context
- Indexing + semantic search for vault retrieval (privacy-first preference)

### 7.2 Out of scope (for MVP)
- Mobile parity implementation (only an extension path is required for MVP)
- Multi-agent / parallelization (planned after MVP; see P1)
- Public marketplace release readiness guarantees (security hardening, support commitments) beyond the MVP’s internal quality bar
- Non-vault “terminal command execution” equivalents (unless later explicitly required)

### 7.3 Assumptions
- User is willing to configure at least one LLM provider and provide API credentials.
- The vault contains sensitive content; therefore explicit approval and privacy controls are mandatory.
- Desktop environment is the initial target; mobile constraints will require capability flags or alternative implementations.
- Kilo Code can be used as a conceptual basis; legal/license compatibility and attribution requirements must be validated before a public release.

### 7.4 Constraints
Non-negotiable constraints (from stakeholder input):
- Privacy-first: process locally where possible; only explicitly selected context may be sent to an LLM; no telemetry.
- Data integrity: no silent writes; all changes go through approval and have a restore path.
- Offline baseline: core vault operations work offline; network required only for LLM and explicit URL fetch.
- Platform: Desktop first; mobile later via explicit migration/extension path.
- No mandatory Git dependency in the vault; checkpoints must work without Git or be strictly optional.
- Cost guidance: typical usage should fit within $\leq 20\,€$/month.
- Performance: UI responsiveness; indexing should not degrade interactive use.

## 8. Risks
| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Scope creep (“full Kilo feature set”) exceeds MVP window | H | H | Enforce P0/P1 gating; explicit “done” definitions; incremental releases |
| Data loss or unintended edits reduce trust | M | H | Approval-first UX; restore-first checkpoints; test restore scenarios |
| Privacy leakage via context sent to providers | M | H | Explicit context selection; clear UI indicators; documented rules |
| Obsidian platform constraints (esp. mobile) block parity | M | M | Desktop-first; define feature flags and alternative behaviors |
| Performance issues from indexing/large vaults | M | H | Background processing; throttling; user controls; staged indexing |
| License/attribution incompatibilities for using Kilo Code as basis | M | H | Early license review; attribution; avoid copying incompatible assets |

## 9. High-level Capability Candidates (for RE)
| Priority | Capability / Feature Candidate | Why it matters |
|---|---|---|
| P0 | Modes + agent behavior configuration | Enables consistent persona-based workflows |
| P0 | @-Mentions for vault context | Eliminates manual context copy/paste |
| P0 | Vault CRUD tools with approval controls | Enables safe automation of note edits |
| P0 | Checkpoints / restore | Trust + recoverability for automation |
| P0 | Orchestrator / subtasks | Supports complex, multi-step knowledge work |
| P0 | Indexing + semantic search | Scales retrieval and reuse in large vaults |
| P1 | Workflows | Repeatable, shareable processes |
| P1 | Skills | Portable knowledge/process packages |
| P1 | Multi-agent / parallel sessions | Throughput and isolation for bigger tasks |

## 10. Open Questions (for RE / Architecture)
- What is the intended MVP delivery timeframe (target date or effort budget)?
- What is the exact, testable definition of “functional” for each P0 capability (acceptance criteria)?
- What content types must be supported on day 1 (Markdown only vs attachments like PDF/DOCX)?
- What is the minimum viable mobile extension path (which features must be designed for mobile constraints even if disabled)?
- What is the licensing strategy and attribution plan if reusing Kilo Code concepts/code?

## 11. Handoff to Orchestrator (mandatory)
### What is decided
- Scope class: C (MVP, production-minded).
- Primary user: solo/personal vault (initially), later community distribution.
- Constraints: privacy-first, approval-first, restore-first, desktop-first with mobile path, no mandatory Git, cost guidance.
- Capability priority: P0 includes 6 items (Modes, Mentions, CRUD+Approval, Checkpoints, Orchestrator, Indexing+Semantic Search). P1 includes Workflows, Skills, Multi-agent/Parallel.

### What is still open / needs clarification
- MVP timeline and release milestones.
- Exact success metrics beyond “capability completeness”.
- Exact acceptance criteria per capability.
- Licensing implications for public release.

### What RE must produce next
- A feature catalog with testable acceptance criteria for each P0 capability.
- Non-functional requirements derived from constraints (privacy, integrity, performance, offline baseline).
- Scope slicing into releases (MVP vs P1) with explicit “done” checks.

## ORCHESTRATOR SUMMARY (<= 12 lines)
- Scope (A/B/C): C (MVP)
- Primary users: Solo Obsidian knowledge worker (personal vault); later community users
- Top goals: Transfer prioritized Kilo Code capabilities to Obsidian with trust/safety
- Top KPIs: P0 capability completeness; 0 unrecoverable data loss; privacy compliance; cost $\leq 20\,€$/month
- P0 capabilities: Modes; @Mentions; CRUD+Approval; Checkpoints; Orchestrator/Subtasks; Indexing+Semantic Search
- Key constraints: privacy-first, no telemetry, explicit context sharing, no silent writes, desktop-first + mobile path, no mandatory Git
- Top risks: scope creep; data-loss trust; privacy leakage; performance; license compatibility
- Next step: switch to Requirements Engineer

## Memory Update Suggestions (stable facts only)
- Project name: KiloNote (Obsidian plugin adapting Kilo Code concepts)
- Scope decision: MVP (C), Desktop-first with explicit mobile extension path
- Non-negotiables: privacy-first, approval-first, restore-first, no telemetry, no mandatory Git for checkpoints
