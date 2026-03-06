# Feature: create_pdf Tool

> **Feature ID**: FEATURE-403
> **Epic**: EPIC-004 - Office Document Creation
> **Priority**: P0-Critical
> **Effort Estimate**: M

## Feature Description

Dediziertes Built-in Tool zur Erzeugung von PDF-Dokumenten im Plugin-Kontext.
Der Agent uebergibt strukturierte Seiteninhalte (Text, Ueberschriften, Listen, Tabellen, Styling),
das Tool erzeugt die Datei programmatisch und speichert sie im Vault. Unterscheidet sich von der
bestehenden Pandoc-basierten PDF-Konvertierung: Dieses Tool erzeugt PDFs programmatisch ohne
externe Abhaengigkeiten.

## Benefits Hypothesis

**Wir glauben dass** ein dediziertes create_pdf Tool
**Folgende messbare Outcomes liefert:**
- Native PDF-Erzeugung ohne externe Abhaengigkeiten (kein Pandoc noetig)
- Volle Kontrolle ueber Layout, Schriften und Formatierung

**Wir wissen dass wir erfolgreich sind wenn:**
- PDF-Dateien werden korrekt erzeugt und sind in jedem PDF-Viewer oeffenbar
- Agent nutzt das Tool konsistent bei PDF-Erstellungsanfragen

## User Stories

### Story 1: PDF aus Inhalt erstellen
**Als** Wissensarbeiter
**moechte ich** dem Agent sagen "Erstelle ein PDF mit diesem Inhalt"
**um** ein universell lesbares Dokument zu erhalten

### Story 2: Formatierter Report als PDF
**Als** Berater
**moechte ich** dem Agent sagen "Erstelle einen PDF-Report mit Ueberschriften und Tabellen"
**um** ein professionelles, nicht-editierbares Deliverable zu erzeugen

### Story 3: PDF aus Vault-Notizen
**Als** User
**moechte ich** dem Agent sagen "Exportiere meine Meeting-Notizen als PDF"
**um** eine druckfertige Version meiner Notizen zu erhalten

---

## Success Criteria (Tech-Agnostic)

| ID | Criterion | Target | Measurement |
|----|-----------|--------|-------------|
| SC-01 | Erzeugte PDFs lassen sich in gaengigen PDF-Viewern fehlerfrei oeffnen | 100% | Pruefung in Vorschau (macOS), Adobe Reader, Browser |
| SC-02 | Text ist lesbar und korrekt formatiert (Ueberschriften, Absaetze, Listen) | Alle Inhalte korrekt | Visuelle Pruefung |
| SC-03 | Tabellen werden mit korrekten Zeilen/Spalten dargestellt | Kein Datenverlust | Visuelle Pruefung |
| SC-04 | Seitenformat ist Standard (A4 oder Letter) mit angemessenen Raendern | Professionelles Layout | Visuelle Pruefung |
| SC-05 | Erzeugung gelingt beim ersten Versuch | >95% Erfolgsrate | Tool-Return ohne Fehler |
| SC-06 | Erzeugung funktioniert ohne dass der User externe Programme installieren muss | Keine externen Abhaengigkeiten | Funktionstest auf frischem System |

---

## Technical NFRs (fuer Architekt)

### Performance
- **Erzeugungszeit**: < 5s fuer 20-seitiges Dokument
- **Memory**: < 80 MB zusaetzlicher Heap
- **Bundle-Groesse Zuwachs**: pdf-lib < 1 MB (minified)

### Kompatibilitaet
- **Output-Format**: PDF 1.7+ kompatibel mit allen gaengigen Viewern
- **Plattform**: Desktop zwingend, Mobile wuenschenswert (pdf-lib ist pure JS)
- **Obsidian**: v1.5+

### Sicherheit
- **Kein dynamischer Code**: Ausschliesslich reviewed Plugin-Code
- **Pfad-Validierung**: Output-Pfad innerhalb des Vaults
- **Keine Schreibzugriffe auf .obsidian/**

### Zuverlaessigkeit
- **Fehlerbehandlung**: Klarer Fehler bei ungueltigem Input
- **Keine korrumpierten Dateien**: Gueltige PDF oder Fehler

---

## Architecture Considerations

### Architecturally Significant Requirements (ASRs)

**CRITICAL ASR #1: Plugin-Kontext-Ausfuehrung**
- **Warum ASR**: Konsistenz mit den anderen create_*-Tools; vermeidet Sandbox-Limitierungen
- **Impact**: Tool lebt in src/core/tools/
- **Quality Attribute**: Zuverlaessigkeit, Konsistenz

**MODERATE ASR #2: Font-Handling**
- **Warum ASR**: PDF-Erzeugung erfordert Font-Einbettung. StandardFonts (Helvetica, Times, Courier) sind begrenzt (kein Unicode-Support fuer Umlaute etc.)
- **Impact**: Bestimmt ob Custom Fonts gebundelt werden muessen oder ob Standard-PDF-Fonts ausreichen
- **Quality Attribute**: Qualitaet, Internationalisierung

**MODERATE ASR #3: Abgrenzung zu Pandoc-Export**
- **Warum ASR**: Es existiert bereits execute_recipe (pandoc-pdf) fuer Markdown-zu-PDF. Das neue Tool muss klar positioniert sein.
- **Impact**: Bestimmt Prompt-Guidance (wann create_pdf vs. execute_recipe)
- **Quality Attribute**: Usability

### Constraints
- **Review-Bot**: ES import, kein innerHTML, kein console.log
- **Pattern-Konsistenz**: Gleiches Wiring-Pattern wie andere create_*-Tools
- **Kein Bild-Embedding im MVP**: Text-basierte PDFs (Bilder in spaeterer Iteration)

### Open Questions fuer Architekt
- StandardFonts (Helvetica etc.) vs. Custom Font Embedding -- was im MVP?
- Seitennummerierung und Header/Footer im MVP oder spaeter?
- Soll das Tool auch Markdown-Input akzeptieren (als Convenience)?

---

## Definition of Done

### Functional
- [ ] Tool erzeugt gueltige PDF-Dateien (oeffenbar in allen gaengigen Viewern)
- [ ] Content-Typen: Ueberschriften, Absaetze, nummerierte Listen, Aufzaehlungen, Tabellen, Styling (fett, kursiv)
- [ ] Seitenformat A4 mit angemessenen Raendern
- [ ] Output-Pfad frei waehlbar, Vault-Speicherung korrekt
- [ ] Registriert in ToolRegistry, toolMetadata, builtinModes

### Quality
- [ ] Fehlerbehandlung bei ungueltigem Input
- [ ] Keine korrumpierten Dateien bei Fehler

### Documentation
- [ ] Feature-Spec aktualisiert (Status: Implemented)

---

## Dependencies

- **Library**: pdf-lib (npm) -- pure JavaScript, keine nativen Abhaengigkeiten
- **Vault API**: Binary-Write-Capability
- **FEATURE-404**: Agent-Prompt-Update

## Assumptions

- pdf-lib laeuft in Electron/Node.js-Kontext (bestaetigt: pure JS)
- StandardFonts (Helvetica, Times, Courier) reichen fuer MVP (ASCII + basisches Latin)
- esbuild kann pdf-lib korrekt bundlen

## Out of Scope

- Bild-Embedding in PDFs (spaetere Iteration)
- Interaktive PDF-Formulare
- Bearbeitung bestehender PDFs
- PDF/A-Compliance (Archivierungsformat)
- Digitale Signaturen
