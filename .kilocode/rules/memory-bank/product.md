# Product One-Pager: KiloNote

## What we build
An Obsidian plugin that transfers prioritized Kilo Code capabilities into Obsidian to support agent-driven knowledge work in a vault (notes + attachments) with strong safety controls.

## Who for
- Primary: Solo user for a personal Obsidian vault (initial phase)
- Later: Obsidian community users (public release when stable)

## Why now
Manual vault workflows (searching, collecting context, synthesizing, restructuring, drafting) do not scale well, and automation without approvals/rollback reduces trust.

## Success definition (KPIs)
- P0 capability completeness for Desktop: implement and validate the defined P0 set
- 0 unrecoverable data-loss incidents (restore/rollback available)
- Privacy constraints met (explicit context sharing; no telemetry)
- Typical usage cost guidance: $\leq 20\,€$/month (target)

## Scope (in/out)
In (MVP/P0):
- Modes + agent behavior
- @Mentions for vault context
- Vault CRUD tools with explicit approval
- Checkpoints/snapshots with restore
- Orchestrator/subtasks
- Indexing + semantic search

Out (MVP):
- Mobile parity (requires an extension path only)
- Multi-agent/parallelization (P1)

## Constraints
- Privacy-first; no telemetry; only explicitly selected context sent to LLM
- No silent writes; approval-first; restore-first
- Desktop-first; mobile later via feature flags/extension path
- No mandatory Git dependency for checkpoints

## Risks
- Scope creep from “full Kilo parity”
- Data-loss / unintended edits undermine trust
- Privacy leakage via provider context
- Performance issues (indexing on large vaults)
- Licensing/attribution constraints for public release
