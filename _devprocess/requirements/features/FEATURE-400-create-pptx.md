# Feature: create_pptx Tool

> **Feature ID**: FEATURE-400
> **Epic**: EPIC-004 - Office Document Creation
> **Priority**: P0-Critical
> **Effort Estimate**: M

## Feature Description

Dediziertes Built-in Tool zur Erzeugung von PowerPoint-Praesentationen (PPTX) im Plugin-Kontext.
Der Agent uebergibt strukturierte Slide-Daten, das Tool erzeugt die Datei programmatisch mit vollem
Node.js-Zugriff und speichert sie im Vault. Kein dynamisch generierter Code, keine Sandbox.

## Benefits Hypothesis

**Wir glauben dass** ein dediziertes create_pptx Tool
**Folgende messbare Outcomes liefert:**
- Zuverlaessige PPTX-Erzeugung in einem einzigen Tool-Call (statt 20+ gescheiterte Sandbox-Versuche)
- Professionelle Praesentationsqualitaet ohne Nachbearbeitung

**Wir wissen dass wir erfolgreich sind wenn:**
- PPTX-Dateien werden korrekt erzeugt und sind in PowerPoint/LibreOffice oeffenbar
- Agent nutzt das Tool konsistent bei Praesentation-Anfragen

## User Stories

### Story 1: Praesentation aus Thema erstellen
**Als** Wissensarbeiter
**moechte ich** dem Agent sagen "Erstelle eine Praesentation ueber X"
**um** eine fertige PPTX-Datei im Vault zu erhalten, ohne PowerPoint oeffnen zu muessen

### Story 2: Praesentation aus Vault-Inhalten generieren
**Als** Berater
**moechte ich** dem Agent sagen "Erstelle eine Praesentation basierend auf meinen Notizen zu Projekt Y"
**um** mein Wissen schnell in ein Kunden-Deliverable umzuwandeln

### Story 3: Gestaltete Praesentation
**Als** User
**moechte ich** dem Agent Farben, Schriftarten und Layout angeben koennen
**um** eine Praesentation im gewuenschten Design zu erhalten

---

## Success Criteria (Tech-Agnostic)

| ID | Criterion | Target | Measurement |
|----|-----------|--------|-------------|
| SC-01 | Erzeugte Praesentationen lassen sich in gaengiger Office-Software fehlerfrei oeffnen | 100% der erzeugten Dateien | Manuelle Pruefung in PowerPoint, LibreOffice, Google Slides |
| SC-02 | Praesentationen enthalten alle vom Agent uebergebenen Inhalte (Text, Listen, Tabellen) | Kein Inhaltsverlust | Vergleich Input vs. Output |
| SC-03 | Erzeugung gelingt beim ersten Versuch | >95% Erfolgsrate | Automatische Erfolgsmessung (Tool-Return ohne Fehler) |
| SC-04 | Eine umfangreiche Praesentation (30 Folien) wird zeitnah erzeugt | User wartet nicht laenger als wenige Sekunden | Zeitmessung |
| SC-05 | Praesentationen sehen professionell aus (Farben, Schriften, Abstaende) | Nutzbar ohne Nachbearbeitung | User-Feedback |
| SC-06 | Bilder aus dem Vault koennen in Folien eingebettet werden | Bilder erscheinen korrekt | Visuelle Pruefung |

---

## Technical NFRs (fuer Architekt)

### Performance
- **Erzeugungszeit**: < 10s fuer 30-Folien-Praesentation mit Text + Listen
- **Memory**: < 100 MB zusaetzlicher Heap waehrend Erzeugung
- **Bundle-Groesse Zuwachs**: pptxgenjs < 2 MB (minified)

### Kompatibilitaet
- **Output-Format**: OOXML (.pptx) kompatibel mit PowerPoint 2016+, LibreOffice 7+, Google Slides
- **Plattform**: Desktop (Electron) zwingend, Mobile wuenschenswert (falls Library pure JS)
- **Obsidian**: v1.5+ (Vault API mit Binary-Write)

### Sicherheit
- **Kein dynamischer Code**: Tool fuehrt ausschliesslich reviewed Plugin-Code aus
- **Pfad-Validierung**: Output-Pfad muss innerhalb des Vaults liegen
- **Keine Schreibzugriffe auf .obsidian/**: Plugin-Konfigurationsverzeichnis geschuetzt

### Zuverlaessigkeit
- **Fehlerbehandlung**: Klarer Fehler-Output bei ungueltigem Input (fehlende Pflichtfelder, ungueltiger Pfad)
- **Keine korrumpierten Dateien**: Entweder vollstaendige gueltige PPTX oder Fehler -- kein Zwischenzustand

---

## Architecture Considerations

### Architecturally Significant Requirements (ASRs)

**CRITICAL ASR #1: Plugin-Kontext-Ausfuehrung**
- **Warum ASR**: Tool muss in Schicht 2 (Plugin-Kontext) laufen, nicht in Schicht 3 (Sandbox), da PPTX-Erzeugung Node.js Buffer/Stream APIs benoetigt
- **Impact**: Bestimmt wo der Code lebt (src/core/tools/), welche APIs verfuegbar sind, wie das Tool registriert wird
- **Quality Attribute**: Zuverlaessigkeit, Funktionalitaet

**CRITICAL ASR #2: Input-Schema-Design**
- **Warum ASR**: Das JSON-Schema definiert die Schnittstelle zwischen LLM und Tool. Zu komplex = LLM macht Fehler. Zu einfach = keine professionellen Ergebnisse.
- **Impact**: Bestimmt die gesamte Interaktion LLM ↔ Tool
- **Quality Attribute**: Usability, Zuverlaessigkeit

**MODERATE ASR #3: Binary Write via Vault API**
- **Warum ASR**: PPTX ist eine binaere Datei. Die Vault API muss Binary-Writes unterstuetzen.
- **Impact**: Bestimmt ob `vault.createBinary()`, `vault.adapter.writeBinary()` oder ein anderer Mechanismus verwendet wird
- **Quality Attribute**: Kompatibilitaet

### Constraints
- **Review-Bot**: Kein `require()` (ES import), kein `innerHTML`, kein `console.log`
- **Obsidian Vault API**: Binary-Dateien ueber offizielle API, nicht direkt ueber `fs`
- **Pattern-Konsistenz**: Folgt dem gleichen Wiring-Pattern wie CreateExcalidrawTool, GenerateCanvasTool

### Open Questions fuer Architekt
- Welches Input-Schema-Design (flach vs. verschachtelt) optimiert LLM-Zuverlaessigkeit bei gleichzeitiger Audrucksfaehigkeit?
- Sollen die 4 Tools eine gemeinsame Basisklasse oder Utility-Funktionen teilen?
- Lazy Loading der Libraries (dynamischer import) vs. statischer Import -- Auswirkung auf Bundle-Groesse und Startup-Zeit?

---

## Definition of Done

### Functional
- [ ] Tool erzeugt gueltige PPTX-Dateien (oeffenbar in PowerPoint, LibreOffice, Google Slides)
- [ ] Alle Content-Typen unterstuetzt: Text, Aufzaehlungen, Tabellen, Bilder, Styling
- [ ] Output-Pfad frei waehlbar, Vault-Speicherung korrekt
- [ ] Registriert in ToolRegistry, toolMetadata, builtinModes (edit-Gruppe)

### Quality
- [ ] Fehlerbehandlung bei ungueltigem Input
- [ ] Keine korrumpierten Dateien bei Fehler
- [ ] Performance < 10s fuer 30 Folien

### Documentation
- [ ] Feature-Spec aktualisiert (Status: Implemented)

---

## Dependencies

- **Library**: pptxgenjs (npm) -- muss im Plugin-Kontext funktionieren
- **Vault API**: Binary-Write-Capability
- **FEATURE-404**: Agent-Prompt-Update (P1, kann parallel)

## Assumptions

- pptxgenjs laeuft in Electron/Node.js-Kontext ohne DOM-Abhaengigkeit
- esbuild kann pptxgenjs korrekt bundlen
- Obsidian Vault API unterstuetzt Binary-Write fuer beliebige Dateierweiterungen

## Out of Scope

- Template-System mit Masterfolien
- Bearbeitung bestehender PPTX-Dateien
- Animation/Transition-Support
- Speaker Notes (kann in spaeterer Iteration ergaenzt werden)
