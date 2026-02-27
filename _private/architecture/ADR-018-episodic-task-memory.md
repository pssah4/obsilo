# ADR-018: Episodic Task Memory

**Status**: Accepted
**Date**: 2026-02-25
**Feature**: FEATURE-skill-mastery (Phase 3)

## Context

Der Agent hat kein Gedaechtnis fuer erfolgreiche Task-Ausfuehrungen. Wenn er eine Aufgabe erfolgreich abschliesst, geht das Wissen "wie" er es getan hat nach der Session verloren. Die bestehende 3-Tier-Memory (ADR-013) speichert User-Profil, Projekte und Patterns — aber keine Ausfuehrungssequenzen.

## Decision

### Recording ohne extra API-Call

Nach Task-Completion wird eine `TaskEpisode` gespeichert:
- User-Message
- Tool-Sequenz (aus `ToolRepetitionDetector.getLedger()`)
- Erfolgs-Status
- Result-Summary

Alle Daten sind bereits im Speicher — kein zusaetzlicher API-Call noetig.

### Vectra-Reuse

Episoden werden im bestehenden SemanticIndexService indiziert:
- Neue Methoden `indexEpisode()` / `searchEpisodes()`
- Metadata-Feld `source: 'episode'` fuer Filterung
- Gleicher Vectra-Index, kein separater Index noetig

### Budget-Sharing

Episodischer Context teilt das bestehende Memory-Budget (4000 chars):
- Max 3 Episoden, je 400 chars
- Verdraengt am wenigsten relevante Session-Context-Eintraege
- `MemoryRetriever.retrieveContext()` wird erweitert

### Promotion zu Rezepten

Wenn ein Tool-Sequence-Pattern 3+ mal erfolgreich auftritt:
1. `RecipePromotionService` erkennt das Muster
2. EIN LLM-Call (Memory-Model) generiert Description + Trigger
3. Ergebnis wird via `RecipeStore` als Learned Recipe gespeichert
4. Ab der naechsten Anfrage: Recipe-Match statt Episode-Match

### Eviction

FIFO bei 500 Episoden. Aelteste Episoden werden geloescht. Promovierte Rezepte bleiben unabhaengig von der Episode erhalten.

## Alternatives Considered

1. **Separate Vector DB fuer Episoden**: Mehr Komplexitaet, kein Vorteil gegenueber Metadata-Filterung.
2. **API-Call fuer Episode-Summarization**: Zu teuer pro Task. Stattdessen nutzen wir den bereits vorhandenen Ledger-Text.
3. **Automatische Promotion ohne LLM-Validation**: Risiko schlechter Rezepte. Ein LLM-Call ist akzeptabel bei seltener Promotion.

## Consequences

- `EpisodicExtractor` und `RecipePromotionService` in `src/core/mastery/`
- `SemanticIndexService` erhaelt 2 neue Methoden
- `MemoryRetriever` wird um episodischen Context erweitert
- `ToolRepetitionDetector` erhaelt `getToolSequence()` Getter
- `AgentSidebarView` zeichnet Episoden nach Completion auf (async, fire-and-forget)
- Memory-Budget bleibt bei 4000 chars (Sharing, nicht Erweiterung)

## References

- Agent Workflow Memory (ICML 2025) — Online Learning mit +24-51% Success Rate
- LEGOMem (Microsoft, AAMAS 2026) — Full-Task + Subtask Memory
- CrewAI Memory — 3-Speicher-Architektur mit Composite Scoring
- Mem^p — Duale Repraesentation (Trajektorien + abstrahierte Skripte)
