# Obsidian Agent — Project Manifest

## What this project is
Kilo Code clone reimplemented as an Obsidian plugin. See `_private/docs/architecture/arc42.md` for the full architecture.

---

## Documentation Structure (mandatory)

### Private / Internal
All internal documentation lives under `_private/` (gitignored, never published).

| Path | Content |
|------|---------|
| `_private/requirements/features/` | One `FEATURE-*.md` per feature — implemented and planned. Source of truth for feature specs. |
| `_private/docs/implementation/BACKLOG.md` | All features with current status. Updated whenever a feature changes. |
| `_private/docs/implementation/ROADMAP.md` | Milestone and sprint overview. |
| `_private/docs/architecture/arc42.md` | Comprehensive, always-current architecture document (arc42 format). |
| `_private/docs/architecture/ADR-*.md` | Architecture Decision Records — one file per decision. |
| `_private/docs/analysis/` | Analyses, ideations, session notes, design explorations. |

### Public (GitHub Pages)
| Path | Content |
|------|---------|
| `docs/` | User-facing documentation (GitHub Pages). Updated when features change. |
| `README.md` | Project entry point. Links to docs. |

### Rule: No stray docs
**There are no descriptive files at the repo root or in `src/` except `README.md` and `CLAUDE.md`.**
All documentation belongs in one of the paths above.

---

## Documentation Maintenance Rules (mandatory for Claude)

1. **New feature implemented** → Create or update `_private/requirements/features/FEATURE-{name}.md` AND update `_private/docs/implementation/BACKLOG.md` AND update the relevant page in `docs/` if it is user-facing.

2. **Feature changed or extended** → Update the feature file, BACKLOG.md status, and docs page.

3. **Architecture decision made** → Create a new `_private/docs/architecture/ADR-{NNN}-{slug}.md` and update `_private/docs/architecture/arc42.md` to reflect the current state.

4. **Sprint completed or milestone reached** → Update `_private/docs/implementation/ROADMAP.md`.

5. **Analysis or ideation** → Save in `_private/docs/analysis/`.

6. **Before publishing** → Run `bash _private/scripts/publish.sh`. Private files are gitignored and excluded automatically.

---

## Build & Deploy

```bash
npm run build          # TypeScript check + esbuild production build
                       # Auto-deploys to Obsidian vault via vault-deploy
```

Build after every implementation step. Deploy script: `_private/scripts/publish.sh`.

---

## Code Conventions

- Tools: `src/core/tools/{category}/{ToolName}Tool.ts`
- Context loaders: `src/core/context/{Name}.ts`
- Settings types: always in `src/types/settings.ts`
- Every new tool: register in `ToolRegistry.registerInternalTools()`
- No emojis in code or UI

---

## Key Files

| File | Purpose |
|------|---------|
| `src/main.ts` | Plugin entry point |
| `src/core/AgentTask.ts` | Main agent loop |
| `src/core/tool-execution/ToolExecutionPipeline.ts` | Governance layer for all tool calls |
| `src/core/systemPrompt.ts` | System prompt construction |
| `src/types/settings.ts` | All settings types and defaults |
| `src/core/tools/ToolRegistry.ts` | Tool registration |
| `src/core/modes/builtinModes.ts` | Built-in mode definitions |
| `src/ui/AgentSidebarView.ts` | Main chat UI |

---

## Kilo Code Reference

Before implementing a feature, check `forked-kilocode/` for the reference implementation.
The fork is gitignored and device-local only.
