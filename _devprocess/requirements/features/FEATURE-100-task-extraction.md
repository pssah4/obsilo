# Feature: Task Extraction & Management

> **Feature ID**: FEATURE-100
> **Epic**: EPIC-010 - Agent Intelligence & Workflow
> **Priority**: P1-High
> **Effort Estimate**: M (3-5 Sprints)

## Feature Description

Deterministischer Post-Processing Hook der `- [ ]` Items in Agent-Antworten automatisch erkennt, dem Nutzer ein Selection Modal praesentiert, und ausgewaehlte Tasks als eigenstaendige Notes mit strukturiertem Frontmatter (10 Properties), einer Obsidian Base mit 3 Views (Offen, Erledigt, Alle) und optionaler Iconic-Plugin-Integration erstellt. Kein AI-Inferenzaufwand -- der gesamte Flow ist regelbasiert (Regex + Template).

## Benefits Hypothesis

**Wir glauben dass** ein deterministischer Task-Extraction-Flow mit TaskSelectionModal, Task-Notes (10 Frontmatter-Properties) und 3-View-Base-Uebersicht
**Folgende messbare Outcomes liefert:**
- Task-Verlustrate sinkt von geschaetzten 80% auf unter 20%
- Zeitaufwand fuer Task-Suche sinkt von mehreren Minuten auf einen Klick (Base oeffnen)
- Zentrale Task-Uebersicht mit Eisenhower-kompatiblen Feldern (Dringend/Wichtig)

**Wir wissen dass wir erfolgreich sind wenn:**
- >60% der erkannten Tasks vom Nutzer im Modal zur Erstellung ausgewaehlt werden
- Task-Feature nach 2 Wochen nicht deaktiviert wird
- Base-Datei regelmaessig geoeffnet wird (>3x pro Woche)

## User Stories

### Story 1: Task-Erkennung nach Agent-Antwort
**Als** Knowledge Worker der Meeting Summaries erstellt
**moechte ich** dass agent-generierte Aufgaben automatisch erkannt werden
**um** keine Action Items mehr zu uebersehen

### Story 2: Selektive Task-Erstellung
**Als** Nutzer der Agent-generierte Listen erhaelt
**moechte ich** auswaehlen welche Items zu eigenstaendigen Task-Notes werden
**um** nur relevante Tasks zu formalisieren und Task-Spam zu vermeiden

### Story 3: Zentrale Task-Uebersicht
**Als** Projekt-Manager der den Vault als Hub nutzt
**moechte ich** alle offenen Tasks in einer sortierten Uebersicht sehen
**um** morgens beim Tagesstart schnell priorisieren zu koennen

### Story 4: Visuelle Task-Differenzierung
**Als** Nutzer mit vielen Notes im Vault
**moechte ich** Task-Notes visuell von normalen Notes unterscheiden koennen
**um** schneller zu navigieren

### Story 5: Task-Faelligkeit und Priorisierung
**Als** Nutzer mit mehreren parallelen Aufgaben
**moechte ich** Tasks nach Faelligkeit, Dringendheit und Wichtigkeit filtern koennen
**um** fokussiert die richtigen Tasks als naechstes zu bearbeiten

---

## Success Criteria (Tech-Agnostic)

> KEINE Technologie-Begriffe erlaubt!

| ID | Criterion | Target | Measurement |
|----|-----------|--------|-------------|
| SC-01 | Aufgaben in Agent-Antworten werden automatisch erkannt | >95% Erkennungsrate | Vergleich erkannte vs. tatsaechliche Items in Test-Szenarien |
| SC-02 | Nutzer kann waehlen welche Aufgaben formalisiert werden | Alle erkannten Items als selektierbare Liste | Manueller Test: Modal zeigt alle Items mit Auswahlmoeglichkeit |
| SC-03 | Jede formalisierte Aufgabe wird als eigenstaendige Notiz erstellt | 1 Notiz pro ausgewaehltem Item | Automatisierter Test: Dateizaehlung nach Erstellung |
| SC-04 | Aufgaben-Notizen enthalten strukturierte Eigenschaften | 10 definierte Felder pro Notiz | Template-Validierung gegen Schema |
| SC-05 | Zentrale Uebersicht zeigt alle Aufgaben sortiert | 3 Ansichten (Offen, Erledigt, Alle) | Manueller Test: Views oeffnen und validieren |
| SC-06 | Aufgaben-Erstellung verursacht keine zusaetzlichen KI-Kosten | 0 externe Anfragen | Architektur-Review: kein API-Call im Flow |
| SC-07 | Auswahl-Dialog erscheint schnell nach Agent-Antwort | Nutzer erlebt keine spuerbare Verzoegerung | Timing-Messung: Antwort bis Dialog |
| SC-08 | Aufgaben-Notizen sind visuell differenziert (bei verfuegbarer Erweiterung) | Icons sichtbar in Dateiliste | Manueller Test mit aktivierter Erweiterung |
| SC-09 | Ohne visuelle Erweiterung funktioniert alles | Volle Funktionalitaet ohne Icons | Manueller Test ohne Erweiterung |
| SC-10 | Bestehende Notiz-Inhalte bleiben unveraendert | 0 Aenderungen an Quell-Notizen | Vorher/Nachher-Vergleich der Quell-Note |
| SC-11 | Nutzer kann das Feature deaktivieren | Ein/Aus-Schalter in Einstellungen | Manueller Test: Toggle prueft Verhalten |
| SC-12 | Verweis zur Quell-Notiz bleibt erhalten | Jede Aufgabe verlinkt zurueck | Automatisierter Test: Source-Feld geprueft |

---

## Technical NFRs (fuer Architekt) - MIT TECHNOLOGIE OK

> Diese Section DARF technische Details enthalten!

### Performance
- **Modal Render Time**: <100ms nach Message-Render
- **Task-Note Creation**: <500ms pro Note (inkl. Frontmatter + Vault.create)
- **Base Creation/Update**: <1000ms fuer initiale Base-Datei mit 3 Views
- **Regex Scan**: <50ms fuer typische Agent-Antwort (bis 5000 Zeichen)
- **Batch Creation**: 10 Tasks gleichzeitig in <5s
- **Resource Usage**: Kein zusaetzlicher Memory-Footprint im Idle-Zustand

### Security & Data Integrity
- **Keine Remote-Calls**: Gesamter Flow lokal im Vault (kein fetch, kein API-Call)
- **File Creation**: Nur ueber Obsidian Vault API (`vault.create()`, `vault.createFolder()`)
- **No Data Mutation**: Bestehende Notes werden nicht veraendert (append-only Pattern)
- **Input Sanitization**: Task-Text wird escaped bevor er in Frontmatter/Filename landet
- **Conflict Prevention**: Dateiname-Pruefung vor Create; Suffix bei Duplikaten

### Compatibility
- **Obsidian API**: Nur offizielle API (vault, workspace, modal, DOM helpers)
- **Review-Bot Compliance**: Kein innerHTML, kein console.log, kein any, kein fetch
- **Iconic Plugin**: Optionale Integration via Frontmatter (`icon`, `iconColor`)
- **Bases Core Plugin**: Verwendet nativen .base YAML-Format
- **Mobile**: Task-Notes funktionieren auf Obsidian Mobile (kein Desktop-only API)

### Scalability
- **Concurrent Tasks**: Bis zu 50 Tasks pro Agent-Antwort handhabbar
- **Vault Size**: Funktioniert in Vaults mit 10.000+ Notes ohne Performance-Einbussen
- **Base Size**: Base-View bleibt performant bis 500+ Task-Notes

### Availability
- **Graceful Degradation**: Ohne Iconic -> normaler Text; ohne Bases -> nur Task-Notes
- **Error Recovery**: Teilweiser Batch-Fehler erstellt bereits angelegte Notes; Modal zeigt Fehlerstatus
- **Settings Persistence**: Feature-Toggle persistent in Plugin-Settings (data.json)



---

## Architecture Considerations

### Architecturally Significant Requirements (ASRs)

**CRITICAL ASR #1: Post-Processing Hook Pattern**
- **Warum ASR**: Neues architektonisches Konzept -- erster deterministischer Post-Processing Hook im Plugin
- **Impact**: Definiert Pattern fuer alle zukuenftigen Post-Processing Features (z.B. Auto-Tag, Citation Extraction)
- **Quality Attribute**: Extensibility, Performance
- **Constraint**: Hook darf Message-Rendering nicht blockieren; muss asynchron nach Render ausfuehren

**CRITICAL ASR #2: Task-Note Frontmatter Schema**
- **Warum ASR**: Schema wird zur Schnittstelle zwischen Plugin-Features (Base, Iconic, Future Search)
- **Impact**: Schema-Aenderungen brechen bestehende Task-Notes; muss von Anfang an stabil sein
- **Quality Attribute**: Maintainability, Interoperability
- **Constraint**: 10 Properties mit exakten deutschen Namen; Unicode-Support fuer Umlaute (Fälligkeit)

**MODERATE ASR #3: Optional Plugin Integration Pattern**
- **Warum ASR**: Erstes Feature das sich an externe Community Plugins (Iconic) anpasst
- **Impact**: Definiert Pattern fuer Plugin-Awareness (detect -> suggest -> integrate -> fallback)
- **Quality Attribute**: Resilience, User Experience
- **Constraint**: Muss ohne externe Plugins vollstaendig funktional sein

**MODERATE ASR #4: Base Integration Pattern**
- **Warum ASR**: Erster Nicht-Tool-Gebrauch der Base-Erstellungslogik (Code-Reuse statt Tool-Call)
- **Impact**: Trennung zwischen Tool-Invocation und internem Code-Reuse Pattern
- **Quality Attribute**: Reusability, Architecture Clarity
- **Constraint**: Base-YAML-Format muss mit Obsidian's nativem Parser kompatibel sein

### Constraints
- **Technology**: TypeScript, Obsidian Plugin API, esbuild
- **Platform**: Electron (Desktop) + Capacitor (Mobile) via Obsidian
- **Compliance**: Obsidian Community Plugin Review-Bot Rules (siehe CLAUDE.md)
- **No AI**: Kein LLM-Call im Task-Extraction-Flow -- deterministisch only

### Open Questions fuer Architekt
1. Hook-Pattern: Observer/EventEmitter vs. direkter Callback nach `renderAssistantMessage()`?
2. Task-Module Struktur: Eigener Ordner `src/core/tasks/` oder Teil von `src/core/hooks/`?
3. Base Code-Reuse: Import der CreateBaseTool-Logik vs. eigene Base-Helper-Klasse?
4. Modal: Obsidian `Modal` subclass vs. `SuggestModal` mit Checkboxen?
5. Schema-Versionierung: Brauchen wir ein `schemaVersion` Feld im Frontmatter fuer Migration?
6. Iconic-Detection: `app.plugins.enabledPlugins.has('iconic')` vs. VaultDNA Scanner?
7. Settings-Integration: Eigene Settings-Section oder Teil der bestehenden Tool-Settings?

---

## Definition of Done

### Functional
- [ ] Regex-Scanner erkennt >95% der `- [ ]` Patterns in Test-Suite
- [ ] TaskSelectionModal zeigt alle erkannten Tasks mit Checkboxen
- [ ] Task-Notes mit 10 Frontmatter-Properties werden korrekt erstellt
- [ ] Base-Datei mit 3 Views (Offen, Erledigt, Alle) wird erstellt
- [ ] Iconic-Properties werden gesetzt wenn Iconic aktiviert
- [ ] Ohne Iconic: volle Funktionalitaet, Hinweis im Chat
- [ ] Settings: Task Extraction an/aus + Ordner-Pfad konfigurierbar
- [ ] Bestehende Note-Inhalte bleiben unangetastet

### Quality
- [ ] Unit Tests fuer Regex-Scanner (Edge Cases: nested, multiline, assignee, due date)
- [ ] Integration Tests: End-to-End Task-Creation Flow
- [ ] Review-Bot Compliance geprueft (keine verbotenen Patterns)
- [ ] Performance Tests: Modal <100ms, Note-Creation <500ms
- [ ] TypeScript strict: keine `any` Types

### Documentation
- [ ] Feature-Spec aktualisiert (Status: Implemented)
- [ ] Backlog aktualisiert
- [ ] Settings-Dokumentation in docs/

---

## Dependencies

- **Obsidian Bases Core Plugin**: Muss aktiviert sein fuer Base-Views (Standard seit 1.6+)
- **Iconic Community Plugin**: Optional; Feature degradiert graceful ohne es
- **CreateBaseTool Logik**: Code-Reuse der Base-YAML-Generierung
- **VaultDNA Scanner oder Plugin-API**: Fuer Iconic-Detection
- **AgentSidebarView**: Hook-Point fuer Post-Processing

## Assumptions

- Agent-Output verwendet Standard-Markdown `- [ ]` Format
- Nutzer akzeptiert Modals als Interaktions-Pattern (konsistent mit Approval-Flow)
- Obsidian Frontmatter-Parser handhabt Unicode Property-Namen korrekt (Fälligkeit)
- Iconic Plugin liest `icon` und `iconColor` aus Frontmatter (aktuelle Version)
- Task-Ordner `Tasks/` als Default ist fuer die meisten Vaults passend
- Nutzer moechte deutsche Property-Namen sehen (Zusammenfassung, nicht Summary)

## Out of Scope

- Automatisches Status-Update via Plugin (nutzt Frontmatter manuell)
- Recurring Tasks / Erinnerungen
- AI-basierte Task-Erkennung (nur Regex, kein LLM)
- Bidirektionale Sync zwischen Task-Note und Quell-Note
- Kanban-Board-View
- Mehr als 3 Base-Views
- Eisenhower-Matrix als visuelle Darstellung
- `create_task` Agent-Tool (Phase 2)
