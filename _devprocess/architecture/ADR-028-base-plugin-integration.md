# ADR-028: Base-Erstellung und optionale Plugin-Integration fuer Task Extraction

**Status:** Akzeptiert, teilweise implementiert (Task-Notes ja, Base-Erstellung und Iconic-Integration ausstehend)
**Date:** 2026-03-06
**Deciders:** Architect Agent, Claude Code
**Feature:** FEATURE-0801 Task Extraction & Management

## Context

Task Extraction (FEATURE-0801) braucht zwei Integrations-Entscheidungen:

1. **Base-Erstellung**: Eine `.base`-Datei mit 3 Views (Offen, Erledigt, Alle) muss erstellt werden. Die Logik dafuer existiert bereits in `CreateBaseTool` — aber dieses Tool erstellt nur eine View pro Aufruf und ist als Agent-Tool (mit Pipeline, Approval, Checkpoint) konzipiert. Task Extraction braucht die YAML-Generierung ohne den Tool-Overhead.

2. **Iconic-Integration**: Task-Notes sollen optional mit Icons versehen werden wenn das Iconic-Plugin installiert ist. Die Erkennung installierter Plugins existiert bereits ueber VaultDNA (`VaultDNAScanner`), aber auch via simpler Obsidian-API (`app.plugins.enabledPlugins`).

Beide Entscheidungen definieren Patterns fuer zukuenftige Feature-Plugin-Interaktionen.

**Triggering ASR:** MODERATE ASR #3 (Optional Plugin Integration) + MODERATE ASR #4 (Base Code-Reuse) aus FEATURE-0801
**Quality Attribute:** Reusability, Resilience, Architecture Clarity

## Decision Drivers

- **Code-Reuse**: Base-YAML-Generierung nicht duplizieren
- **Separation of Concerns**: Tool-Pipeline (Governance, Approval) vs. interne Service-Nutzung
- **Graceful Degradation**: Alles muss ohne Iconic funktionieren
- **Minimale Kopplung**: Keine harte Abhaengigkeit zu Community-Plugins

## Considered Options

### Base-Erstellung

#### Option B1: CreateBaseTool direkt aufrufen (Tool-Invocation)

Task-Note-Creator ruft `CreateBaseTool.execute()` mit einem synthetischen Context auf.

- Pro: Maximaler Code-Reuse, eine Quelle der Wahrheit
- Con: Tool-Pipeline wird durchlaufen (Approval-Dialog fuer Base-Erstellung — unerwuenscht)
- Con: Checkpoint wird erstellt (unnoetig, Base ist neu)
- Con: Tool-Interface erwartet ToolExecutionContext — synthetischer Context ist ein Code Smell

#### Option B2: Base-YAML-Generierung als extrahierte Helper-Funktion

YAML-Generierungslogik aus `CreateBaseTool` in eine shared Helper-Funktion extrahieren. Beide nutzen den Helper: Tool fuer Agent-Aufrufe, TaskNoteCreator fuer interne Nutzung.

```
BaseYamlBuilder.buildView(config): string
  ↑ verwendet von:
  ├── CreateBaseTool.execute()      (via Pipeline, mit Approval)
  └── TaskNoteCreator.createBase()  (direkt, ohne Pipeline)
```

- Pro: Saubere Trennung zwischen Logik und Governance
- Pro: Kein synthetischer Context noetig
- Pro: Helper ist unabhaengig testbar
- Con: Refactoring von CreateBaseTool erforderlich (Logik extrahieren)
- Con: Zwei Aufrufwege fuer Base-Erstellung (muss dokumentiert werden)

#### Option B3: Eigene YAML-Generierung in TaskNoteCreator

Task-spezifische YAML-Generierung direkt im TaskNoteCreator, ohne Code-Sharing mit CreateBaseTool.

- Pro: Keine Abhaengigkeit zu bestehendem Tool-Code
- Pro: Task-Base hat andere Anforderungen (3 Views, feste Filter) als generische Bases
- Con: YAML-Format-Wissen dupliziert
- Con: Bei Obsidian-Base-Format-Aenderungen zwei Stellen anpassen

### Iconic-Detection

#### Option I1: Direkte Obsidian-API (`app.plugins.enabledPlugins`)

```typescript
const iconicEnabled = app.plugins.enabledPlugins.has('iconic');
```

- Pro: Einzeiler, keine Abhaengigkeit
- Pro: Immer aktuell (Set wird von Obsidian gepflegt)
- Con: Nutzt nicht das bestehende VaultDNA-System

#### Option I2: VaultDNA Scanner

```typescript
const plugins = vaultDNA.getDiscoveredPlugins();
const iconic = plugins.find(p => p.id === 'iconic');
```

- Pro: Konsistent mit bestehendem Plugin-Discovery-System
- Pro: Hat zusaetzliche Metadaten (Version, API-Methoden)
- Con: VaultDNA scannt mit 5s-Polling — koennte beim Plugin-Start noch nicht fertig sein
- Con: Schwerere Abhaengigkeit fuer eine einfache Boolean-Pruefung

## Decision

### Base-Erstellung: Option B3 — Eigene YAML-Generierung

**Begruendung:**

1. **Signifikant andere Anforderungen**: Die Task-Base hat 3 fixe Views mit vordefinierten Filtern (`Status.equals("Offen")`). CreateBaseTool ist fuer generische, Agent-gesteuerte Ein-View-Bases konzipiert. Ein gemeinsamer Helper muesste beide Faelle abstrahieren — das waere komplexer als zwei spezialisierte Implementierungen.
2. **Stabilitaet**: Das Task-Base-YAML aendert sich nur mit dem Frontmatter-Schema (ADR-027). Es ist ein festes Template, keine dynamische Generierung.
3. **Kein Refactoring-Risiko**: CreateBaseTool bleibt unangetastet — kein Regressionsrisiko fuer bestehende Agent-Funktionalitaet.

Die YAML-Generierung ist ~30 Zeilen Code fuer 3 Views. Der Duplikations-Nachteil ist minimal im Vergleich zum Abstraktions-Overhead von Option B2.

### Iconic-Detection: Option I1 — Direkte Obsidian-API

**Begruendung:**

1. **Einfachheit**: `app.plugins.enabledPlugins.has('iconic')` ist ein Einzeiler, immer aktuell, keine Timing-Probleme.
2. **Richtige Abstraktion**: Die Frage ist "ist Iconic gerade aktiv?" — nicht "was kann Iconic?". Fuer die einfache Boolean-Pruefung ist VaultDNA Over-Engineering.
3. **VaultDNA-Zweck**: VaultDNA ist fuer Plugin-Capability-Discovery (Methoden, Commands). Iconic-Detection braucht keine Capabilities — nur die Praesenz.

**Graceful Degradation Pattern:**

```typescript
// Bei Task-Note-Erstellung:
if (app.plugins.enabledPlugins.has('iconic')) {
    frontmatter.icon = 'lucide//check-square';
    frontmatter.iconColor = '#4CAF50';
}
// Ohne Iconic: Properties werden weggelassen, Note funktioniert normal
```

**Chat-Hinweis:** Wenn Iconic nicht installiert ist und Tasks erstellt werden, wird im Chat ein dezenter Hinweis angezeigt: "Tipp: Installiere das Iconic-Plugin fuer visuelle Task-Icons."

**Hinweis:** Dies ist ein VORSCHLAG. Claude Code entscheidet final basierend auf dem realen Zustand der Codebase.

## Base-Template (3 Views)

```yaml
views:
  - type: table
    name: Offene Aufgaben
    filters:
      and:
        - Typ.equals("Aufgabe")
        - Status.equals("Offen")
    order:
      - file.name
      - Zusammenfassung
      - Fälligkeit
      - Dringend
      - Wichtig
      - Quelle
    sort:
      - property: Fälligkeit
        direction: ASC
    rowHeight: medium
  - type: table
    name: Erledigte Aufgaben
    filters:
      and:
        - Typ.equals("Aufgabe")
        - Status.equals("Erledigt")
    order:
      - file.name
      - Zusammenfassung
      - Fälligkeit
      - Erstellt
    sort:
      - property: Erstellt
        direction: DESC
    rowHeight: medium
  - type: table
    name: Alle Aufgaben
    filters:
      and:
        - Typ.equals("Aufgabe")
    order:
      - file.name
      - Status
      - Zusammenfassung
      - Fälligkeit
      - Dringend
      - Wichtig
      - Quelle
    sort:
      - property: Status
        direction: ASC
    rowHeight: medium
```

## Consequences

### Positive
- Task-Base ist ein stabiles Template — keine dynamische Komplexitaet
- Iconic-Detection ist trivial und immer aktuell
- Keine Abhaengigkeit zu bestehenden Tools — kein Regressionsrisiko
- Graceful Degradation funktioniert in beide Richtungen (ohne Iconic, ohne Bases)

### Negative
- YAML-Format-Wissen liegt an zwei Stellen (CreateBaseTool + TaskNoteCreator)
- Bei Base-Format-Aenderung durch Obsidian muessen beide Stellen geprueft werden

### Risks
- **Obsidian Base-Format-Aenderung**: Wenn Obsidian das `.base` YAML-Format aendert, muessen beide Implementierungen aktualisiert werden. Mitigation: Das Format ist seit Obsidian 1.6 stabil; Aenderungen sind selten und wuerden auch CreateBaseTool betreffen.
- **Iconic-Deaktivierung zur Laufzeit**: Wenn Nutzer Iconic deaktiviert nachdem Tasks mit Icon-Properties erstellt wurden, bleiben die Properties im Frontmatter (harmlos, werden ignoriert). Mitigation: Kein Handlungsbedarf — Properties ohne Iconic sind inert.

## Implementation Notes

**Modul-Einordnung:**

```
src/core/tasks/
  TaskExtractor.ts       # Regex-Scan (ADR-026)
  TaskNoteCreator.ts     # Note-Erstellung + Base-Template
  types.ts               # Interfaces
```

`TaskNoteCreator.createTaskBase()` generiert das YAML inline (Template-String). Kein Import von CreateBaseTool.

**Settings:**

```typescript
interface TaskExtractionSettings {
    enabled: boolean;           // Feature an/aus
    taskFolder: string;         // Default: 'Tasks'
    basePath: string;           // Default: 'Tasks/Aufgaben.base'
    iconicHint: boolean;        // Hinweis zeigen wenn Iconic nicht installiert
}
```

Einordnung in `AgentSettingsTab` als eigener Abschnitt, nicht unter Tool-Settings (da kein Tool involviert).

## Related Decisions

- [ADR-026](ADR-026-post-processing-hook.md): Hook-Pattern das Task Extraction triggert
- [ADR-027](ADR-027-task-note-schema.md): Frontmatter-Schema der Task-Notes (bestimmt Base-Filter)
- [ADR-014](ADR-014-vault-dna-plugin-discovery.md): VaultDNA — hier NICHT genutzt (Iconic-Detection via direkte API)

## References

- FEATURE-0801: Task Extraction & Management
- `src/core/tools/vault/CreateBaseTool.ts`: Bestehende Base-Erstellungslogik (wird nicht wiederverwendet)
- Obsidian Bases YAML-Format: `views` Array mit `type`, `name`, `filters`, `order`, `sort`
- Iconic Plugin: liest `icon` und `iconColor` aus Note-Frontmatter
