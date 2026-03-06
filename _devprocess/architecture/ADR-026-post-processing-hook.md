# ADR-026: Post-Processing Hook fuer Task Extraction

**Status:** Akzeptiert, implementiert
**Date:** 2026-03-06
**Deciders:** Architect Agent, Claude Code
**Feature:** FEATURE-100 Task Extraction & Management

## Context

Das Plugin hat keinen definierten Extension Point fuer deterministische Nachverarbeitung von Agent-Antworten. Der erste Anwendungsfall ist Task Extraction: `- [ ]` Items in Agent-Antworten automatisch erkennen und dem Nutzer zur Erstellung als Task-Notes anbieten.

Aktuell endet der Agent-Zyklus in `AgentSidebarView.onComplete()` (ca. Zeile 1604). Dort wird:
1. Markdown final gerendert
2. Response Actions hinzugefuegt
3. History gespeichert
4. Post-Task DiffReview gezeigt

Ein neuer Hook muss sich in diesen Flow einfuegen, ohne das Rendering zu blockieren oder die bestehende Logik zu verkomplizieren.

**Triggering ASR:** CRITICAL ASR #1 aus FEATURE-100
**Quality Attribute:** Extensibility, Performance

## Decision Drivers

- **Performance**: Hook darf Message-Rendering nicht blockieren (<100ms bis Modal)
- **Separation of Concerns**: Regex-Scan-Logik gehoert nicht in die UI-Schicht
- **Konsistenz**: Bestehende Post-Processing Patterns (Chat-Linking in Pipeline, DiffReview in onComplete) beruecksichtigen
- **YAGNI**: Kein Over-Engineering fuer hypothetische zukuenftige Hooks

## Considered Options

### Option 1: Direct Call in onComplete (mit Method Extraction)

Neuer Methodenaufruf in `onComplete()` nach Markdown-Rendering und History-Save. Extraktionslogik in eigener Klasse `TaskExtractor` (pure function, kein UI). Modal-Anzeige ueber Callback.

```
onComplete:
  ... bestehendes Rendering ...
  ... History-Save ...
  → this.maybeExtractTasks(accumulatedText)
      → TaskExtractor.scan(text)  // Pure: Regex → TaskItem[]
      → if items.length > 0: new TaskSelectionModal(items)
```

- Pro: Minimal-invasiv, ein Methodenaufruf in bestehendem Flow
- Pro: Gleicht dem DiffReview-Pattern (auch direkt in onComplete)
- Pro: Extraktionslogik ist testbar (Pure Function in `src/core/tasks/`)
- Con: Kein formaler Extension Point fuer zukuenftige Hooks

### Option 2: PostProcessorRegistry (EventEmitter-artig)

Neue Registry-Klasse `PostProcessorRegistry` mit `register(hook)` / `runAll(context)`. AgentSidebarView ruft `registry.runAll()` in onComplete auf.

```
PostProcessorRegistry
  .register('task-extraction', TaskExtractionHook)
  .register('future-hook', FutureHook)
  .runAll({ text, messageEl, conversationId })
```

- Pro: Sauber erweiterbar fuer beliebig viele Hooks
- Pro: Hooks koennen unabhaengig getestet und (de-)aktiviert werden
- Con: Mehr Infrastruktur fuer aktuell genau einen Hook
- Con: Registry muss Lifecycle-Management loesen (Reihenfolge, Fehler-Isolation)
- Con: Kein bestehendes Pattern im Plugin (Chat-Linking nutzt direkte Pipeline-Methode)

### Option 3: Obsidian Events (app.workspace.trigger)

Custom Event via Obsidian's internem Event-System:

```
this.app.workspace.trigger('obsilo:agent-complete', { text, conversationId });
// Listener in Plugin.onload():
this.registerEvent(app.workspace.on('obsilo:agent-complete', handler));
```

- Pro: Nutzt Obsidian-eigenes Event-System
- Pro: Lose Kopplung zwischen UI und Hooks
- Con: Events sind fire-and-forget — kein Return-Wert moeglich
- Con: Debugging schwieriger (indirekte Aufrufkette)
- Con: Obsidian-Events sind fuer Workspace-Events gedacht, nicht fuer Plugin-interne Logik

## Decision

**Vorgeschlagene Option:** Option 1 — Direct Call mit Method Extraction

**Begruendung:**

1. **Konsistenz**: Chat-Linking (ADR-022) ist ein direkter Aufruf in der Pipeline. DiffReview ist ein direkter Aufruf in onComplete. Task Extraction folgt dem gleichen Pattern.
2. **YAGNI**: Wir haben genau einen Post-Processing Hook. Eine Registry fuer einen Eintrag ist Over-Engineering. Wenn ein zweiter Hook kommt, refactoren wir zu Option 2 — das ist ein kleiner, lokaler Umbau.
3. **Testbarkeit**: Die Kernlogik (Regex-Scan) liegt in `TaskExtractor` als Pure Function — vollstaendig unit-testbar ohne UI-Abhaengigkeiten.
4. **Performance**: `TaskExtractor.scan()` ist synchron (<50ms); erst wenn Items gefunden werden, wird asynchron das Modal geoeffnet. Kein Rendering-Block.

**Hinweis:** Dies ist ein VORSCHLAG. Claude Code entscheidet final basierend auf dem realen Zustand der Codebase.

## Consequences

### Positive
- Minimale Aenderung am bestehenden Code (ein Methodenaufruf in onComplete)
- Klare Trennung: Regex-Logik in `src/core/tasks/`, Modal in `src/ui/`, Hook-Point in AgentSidebarView
- Kein neuer Infrastruktur-Overhead
- Pattern ist konsistent mit bestehenden Post-Processing Ansaetzen

### Negative
- Kein formaler Extension Point — weitere Hooks erfordern manuelle Integration in onComplete
- Bei >3 Hooks wuerde onComplete unuebersichtlich (dann Refactoring zu Registry)

### Risks
- **Future Hook Proliferation**: Wenn viele Post-Processing Features kommen, wird onComplete zum Bottleneck. Mitigation: Refactoring-Grenze bei 3 Hooks definieren, dann Registry einfuehren.

## Implementation Notes

**Vorgeschlagene Modulstruktur:**

```
src/core/tasks/
  TaskExtractor.ts       # scan(text): TaskItem[] — Pure Regex-Logik
  TaskNoteCreator.ts     # createNotes(items, settings): Promise — Vault-API Calls
  types.ts               # TaskItem, TaskSettings Interfaces

src/ui/
  TaskSelectionModal.ts  # Obsidian Modal mit Checkbox-Liste
```

**Hook-Point in AgentSidebarView.onComplete():**

```typescript
// Nach History-Save, vor Post-Task DiffReview:
if (this.plugin.settings.taskExtraction?.enabled && accumulatedText) {
    void this.maybeExtractTasks(accumulatedText);
}
```

**Asynchronitaet**: `maybeExtractTasks()` ist async (wegen Modal), aber mit `void` prefix (fire-and-forget), damit onComplete nicht blockiert wird. Modal-Ergebnis triggered dann Task-Note-Erstellung.

## Related Decisions

- [ADR-022](ADR-022-chat-linking.md): Chat-Linking nutzt ebenfalls einen direkten Hook (in der Pipeline statt in onComplete)
- [ADR-007](ADR-007-event-separation.md): Event Separation — onComplete vs. onAttemptCompletion Unterscheidung relevant fuer Hook-Timing
- [ADR-027](ADR-027-task-note-schema.md): Schema der erstellten Task-Notes

## References

- FEATURE-100: Task Extraction & Management
- `src/ui/AgentSidebarView.ts`: onComplete Callback (~Zeile 1604)
