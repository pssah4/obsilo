# FEATURE: Agent Skill Mastery

**Status**: In Progress
**Priority**: High
**Dependencies**: FEATURE-local-skills (PAS-1), FEATURE-memory-personalization, FEATURE-semantic-index
**ADRs**: ADR-016, ADR-017, ADR-018

---

## Problem

Der Agent kennt seine Faehigkeiten nicht wirklich — er sucht und entdeckt statt direkt zu handeln. Tools haben nur Einzeiler-Beschreibungen. Skills sind Plugin-Metadata statt Rezepte. Memory speichert Konzepte statt Ausfuehrungssequenzen.

Beispiel: "Erstelle eine Excalidraw-Visualisierung" fuehrt zu 10+ Tool Calls (Read .skill.md, Search, Discover commands, Fehler, Retry) statt 2-3 gezielten Calls.

## Loesung

Ein kohaerentes "Agent Knowledge System" mit drei Ebenen:

```
C) Episodic Task Memory     — Online Learning: Aufzeichnung + Promotion
B) Procedural Skill Recipes  — Operatives Wissen: Static + Learned
A) Rich Tool Descriptions    — Grundlagenwissen: Examples, When-to-use
```

---

## Phase 1: Rich Tool Descriptions

### Anforderung

Jedes der 36 Tools erhaelt neben der bestehenden Beschreibung:
- `example`: Konkretes Aufruf-Beispiel
- `whenToUse`: Wann dieses Tool gegenueber Alternativen bevorzugen
- `commonMistakes`: Haeufige Fehler die das LLM vermeiden soll

### Technische Umsetzung

- `ToolMeta` Interface in `src/core/tools/toolMetadata.ts` erweitern
- `buildToolPromptSection()` gibt Examples mode-gefiltert aus
- Subtask-Prompts ohne Examples (Token-Einsparung)
- Kein zusaetzliches Context-Budget — ersetzt bestehende Einzeiler

### Akzeptanzkriterien

- [ ] Alle 36 Tools haben `example` Felder
- [ ] High-Value Tools haben `whenToUse` und `commonMistakes`
- [ ] Agent Mode System Prompt enthaelt Examples
- [ ] Ask Mode filtert auf read/vault/agent Tools
- [ ] Prompt-Zuwachs < 3000 chars gemessen
- [ ] Build erfolgreich

---

## Phase 2: Procedural Skill Recipes

### Anforderung

Der Agent erhaelt Schritt-fuer-Schritt Rezepte fuer bekannte Task-Muster. Zwei Quellen:
1. **Static Recipes**: Bundled, human-curated, hohe Qualitaet
2. **Learned Recipes**: Aus erfolgreichen Ausfuehrungen extrahiert (Phase 3)

### Rezept-Format

```typescript
interface ProceduralRecipe {
    id: string;
    name: string;
    description: string;
    trigger: string;           // Pipe-separated Keywords
    steps: RecipeStep[];
    source: 'static' | 'learned';
    schemaVersion: number;
    successCount: number;
    lastUsed: string | null;
    modes: string[];
}
```

### Matching-Strategie

1. **Keyword-first** (< 1ms, kein API-Call): Jaccard-Overlap zwischen Trigger-Tokens und User-Message
2. **Semantic fallback** (nur wenn < maxResults): Vectra-Suche ueber Descriptions

### System Prompt Position

Zwischen Plugin Skills (5) und Tool Rules (6):
Tools → Plugins → **Rezepte (wie kombinieren)** → Regeln

### Budget

- 2000 chars dediziertes Budget
- Max 3 Rezepte pro Anfrage
- ~600 chars pro Rezept

### Initiale Rezepte

1. `create-excalidraw-visualization` — Read source → Write .excalidraw.md
2. `daily-note-summary` — Get daily note → Read linked → Write summary
3. `reorganize-notes-by-tag` — Search by tag → Create folder → Move files
4. `create-canvas-from-notes` — Search/list → generate_canvas
5. `export-note-pdf` — Read → check-dependency → execute_recipe
6. `create-base-from-tag` — Search by tag → create_base
7. `link-related-notes` — Semantic search → update_frontmatter
8. `process-voice-note` — Read → update_frontmatter → edit_file/write_file

### Settings

```typescript
interface MasterySettings {
    enabled: boolean;
    recipeBudget: number;
    learnedRecipesEnabled: boolean;
    recipeToggles: Record<string, boolean>;
}
```

### Akzeptanzkriterien

- [ ] 8 static Recipes bundled
- [ ] Matching liefert relevante Ergebnisse
- [ ] System Prompt enthaelt PROCEDURAL RECIPES bei Match
- [ ] Kein Overhead bei Nicht-Match
- [ ] Budget eingehalten
- [ ] Settings UI mit Toggle
- [ ] Build erfolgreich

---

## Phase 3: Episodic Task Memory

### Anforderung

Der Agent lernt aus erfolgreichen Ausfuehrungen. Task-Muster die sich wiederholen werden automatisch zu Rezepten promotet.

### Episode-Recording

Nach Task-Completion (attempt_completion oder natuerliches Ende):
- User-Message (Task-Beschreibung)
- Tool-Sequenz (aus ToolRepetitionDetector Ledger)
- Erfolgs-Status
- Result-Summary

**Kein extra API-Call** — alle Daten sind bereits im Speicher.

### Episode-Lifecycle

```
Task erfolgreich → recordEpisode() (persist + index in Vectra)
                         ↓
                checkForPromotion()
                         ↓
                Pattern 3+ Erfolge? → 1 LLM-Call → RecipeStore.save()
                         ↓
                Naechste Anfrage: Recipe-Match → System Prompt Injection
```

### Vectra-Integration

- Reuse bestehender SemanticIndexService
- `indexEpisode()` / `searchEpisodes()` mit `source: 'episode'` Metadata
- Budget-Sharing mit Session-Context (4000 chars total)

### Promotion-Kriterien

- Gleiches Tool-Sequence-Pattern 3+ mal
- Alle Instanzen erfolgreich
- Sequenz hat 2+ Schritte
- 1 LLM-Call fuer Description + Trigger

### Akzeptanzkriterien

- [ ] Episode nach Multi-Tool-Task gespeichert
- [ ] Episode in Vectra indiziert
- [ ] Aehnliche Episoden in Memory-Context sichtbar
- [ ] Promotion nach 3 Erfolgen
- [ ] Gelerntes Rezept in Settings togglebar
- [ ] Memory-Budget eingehalten
- [ ] FIFO-Eviction bei 500 Episoden
- [ ] Build erfolgreich

---

## Dateien

### Neue Dateien
- `src/core/mastery/types.ts`
- `src/core/mastery/staticRecipes.ts`
- `src/core/mastery/RecipeMatchingService.ts`
- `src/core/mastery/RecipeStore.ts`
- `src/core/mastery/EpisodicExtractor.ts`
- `src/core/mastery/RecipePromotionService.ts`
- `src/core/prompts/sections/recipes.ts`

### Geaenderte Dateien
- `src/core/tools/toolMetadata.ts` — ToolMeta erweitern + 36 Tools befuellen
- `src/core/systemPrompt.ts` — recipesSection Parameter + Injection
- `src/core/AgentTask.ts` — recipesSection Parameter durchreichen
- `src/ui/AgentSidebarView.ts` — Recipe Matching + Episode Recording
- `src/main.ts` — Service-Initialisierung
- `src/types/settings.ts` — MasterySettings
- `src/core/semantic/SemanticIndexService.ts` — Episode-Index/Search
- `src/core/context/MemoryRetriever.ts` — Episodic Context
- `src/core/tool-execution/ToolRepetitionDetector.ts` — getToolSequence()

---

## Forschungsgrundlage

Basiert auf Analyse von:
- Voyager Skill Library (NVIDIA) — Skill-Code + NL-Beschreibung + Embedding
- Agent Workflow Memory (AWM, ICML 2025) — Abstrahierte Workflows mit Variablen
- Kilo Code SKILL.md Pattern — Lazy-loaded prozedurale Instruktionen
- CrewAI Memory — 3-Speicher-Architektur (Semantic, Episodic, Procedural)
- Anthropic "Writing Tools for Agents" — Tool-Description Best Practices

Detaillierte Recherche: `devprocess/analysis/ai-agent-skill-mastery-research.md`
