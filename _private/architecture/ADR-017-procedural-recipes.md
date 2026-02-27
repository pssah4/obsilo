# ADR-017: Procedural Skill Recipes

**Status**: Accepted
**Date**: 2026-02-25
**Feature**: FEATURE-skill-mastery (Phase 2)

## Context

Der Agent hat strategisches Wissen (Tool Decision Guidelines) aber kein taktisches Wissen (Schritt-fuer-Schritt Rezepte). Bei bekannten Tasks wie "Excalidraw erstellen" oder "Sprachnotiz aufbereiten" muss der Agent die Tool-Sequenz jedes Mal von Grund auf herleiten.

## Decision

### Rezept-Format

Typisierte Datenstruktur `ProceduralRecipe` mit:
- `trigger` (Pipe-separated Keywords fuer Matching)
- `steps` (geordnete Tool-Aufrufe mit Variablen)
- `source` ('static' | 'learned')
- `modes` (Mode-Filterung)

### Matching-Strategie

1. **Keyword-first** (< 1ms): Jaccard-Overlap zwischen Trigger-Tokens und User-Message-Tokens. Kein API-Call.
2. **Semantic fallback** (nur bei < maxResults): Vectra-Suche ueber Recipe-Descriptions.

### Prompt-Position

Zwischen Plugin Skills (Sektion 5) und Tool Rules (Sektion 6): Tools → Plugins → **Rezepte** → Regeln. Der Agent sieht erst was existiert, dann wie man es kombiniert, dann die Regeln.

### Zwei Quellen

- **Static Recipes**: TypeScript-Konstanten in `staticRecipes.ts`. Typ-sicher, gebuendelt, migrierbar via `schemaVersion`.
- **Learned Recipes**: JSON in `.obsidian/plugins/obsidian-agent/recipes/`. Vault-spezifisch (abhaengig von installierten Plugins und Vault-Struktur).

### Budget

- 2000 chars dediziert (unabhaengig vom Memory-Budget)
- Max 3 Rezepte pro Anfrage
- ~600 chars pro serialisiertem Rezept
- Subtasks erhalten keine Rezepte

## Alternatives Considered

1. **Rezepte als SKILL.md Dateien** (Kilo Code Pattern): Flexibler, aber zu viele I/O-Operationen bei Matching. Keyword-Matching ueber TS-Konstanten ist schneller.
2. **Rezepte im Mode-System**: Modes sind Rollen, nicht Prozeduren. Vermischung wuerde das Mode-System ueberlasten.
3. **Rezepte als Workflows**: Bestehende Workflows sind user-facing (Slash-Commands). Rezepte sind agent-internal.

## Consequences

- Neuer Ordner `src/core/mastery/` mit 4 Dateien
- Neue Prompt-Sektion `recipes.ts`
- `systemPrompt.ts` erhaelt neuen Parameter `recipesSection`
- `AgentTask.run()` Signatur erweitert
- `MasterySettings` in `settings.ts`
- Kein Konflikt mit Context Condensing (Rezepte leben im System Prompt)

## References

- Voyager Skill Library (NeurIPS 2023)
- Agent Workflow Memory (ICML 2025) — +24-51% Success Rate
- Kilo Code SKILL.md Pattern
