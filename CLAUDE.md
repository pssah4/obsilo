# Obsidian Agent — Project Manifest

## What this project is
Kilo Code clone reimplemented as an Obsidian plugin. See `devprocess/architecture/arc42.md` for the full architecture.

---

## Documentation Structure (mandatory)

### Workflow: BA → RE → Architecture → Implementation

```
devprocess/
├── analysis/          ← BA: Analysen, Ideations, historische Docs, Kontext-Research
│   └── context/       ← BA Research & Produktkontext
├── requirements/      ← RE: Feature-Specs und Epics
│   ├── features/      ← FEATURE-*.md (ein File pro Feature, implementiert + geplant)
│   └── epics/         ← EPIC-*.md
├── architecture/      ← Architect: arc42 + ADRs
│   ├── arc42.md       ← Immer aktuelles Architektur-Dokument
│   └── ADR-*.md       ← Architecture Decision Records
├── implementation/    ← Implementation Tracking
│   └── BACKLOG.md     ← Alle Features mit Status (Source of Truth)
└── scripts/           ← Operative Skripte und Prozess-Dokumentation
```

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

1. **New feature implemented** → Create or update `devprocess/requirements/features/FEATURE-{name}.md` AND update `devprocess/implementation/BACKLOG.md` AND update the relevant page in `docs/` if it is user-facing.

2. **Feature changed or extended** → Update the feature file, BACKLOG.md status, and docs page.

3. **Architecture decision made** → Create a new `devprocess/architecture/ADR-{NNN}-{slug}.md` and update `devprocess/architecture/arc42.md` to reflect the current state.

4. **Analysis or ideation from session** → Save in `devprocess/analysis/`.

5. **Before publishing** → Merge `dev → test → main` via PR. GitHub Actions syncs `main` to `obsilo` automatically (without CLAUDE.md).

---

## Build & Deploy

```bash
npm run build          # TypeScript check + esbuild production build
                       # Auto-deploys to Obsidian vault via vault-deploy
```

Build after every implementation step. Deploy script: `devprocess/scripts/publish.sh`.

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
