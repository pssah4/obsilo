# Feature: create_xlsx Tool

> **Feature ID**: FEATURE-402
> **Epic**: EPIC-004 - Office Document Creation
> **Priority**: P0-Critical
> **Effort Estimate**: M

## Feature Description

Dediziertes Built-in Tool zur Erzeugung von Excel-Tabellenkalkulationen (XLSX) im Plugin-Kontext.
Der Agent uebergibt strukturierte Tabellendaten (Sheets, Zeilen, Spalten, Formatierung, Formeln),
das Tool erzeugt die Datei programmatisch und speichert sie im Vault.

## Benefits Hypothesis

**Wir glauben dass** ein dediziertes create_xlsx Tool
**Folgende messbare Outcomes liefert:**
- Zuverlaessige XLSX-Erzeugung in einem einzigen Tool-Call
- Korrekte Tabellenkalkulationen mit Formatierung und Formeln

**Wir wissen dass wir erfolgreich sind wenn:**
- XLSX-Dateien werden korrekt erzeugt und sind in Excel/LibreOffice oeffenbar
- Daten, Formatierung und Formeln sind korrekt

## User Stories

### Story 1: Tabelle aus Daten erstellen
**Als** Wissensarbeiter
**moechte ich** dem Agent sagen "Erstelle eine Excel-Tabelle mit diesen Daten"
**um** strukturierte Daten in einem universellen Tabellenformat zu exportieren

### Story 2: Budget/Kalkulation erzeugen
**Als** Berater
**moechte ich** dem Agent sagen "Erstelle eine Budgetuebersicht als Excel mit Summenformeln"
**um** eine kalkulationsfaehige Tabelle fuer den Kunden zu erzeugen

### Story 3: Vault-Daten als Tabelle exportieren
**Als** User
**moechte ich** dem Agent sagen "Exportiere alle meine Projektnotizen als Excel-Tabelle"
**um** eine Uebersicht meiner Projekte in einem teilbaren Format zu erhalten

---

## Success Criteria (Tech-Agnostic)

| ID | Criterion | Target | Measurement |
|----|-----------|--------|-------------|
| SC-01 | Erzeugte Tabellenkalkulationen lassen sich in gaengiger Software fehlerfrei oeffnen | 100% | Manuelle Pruefung in Excel, LibreOffice Calc, Google Sheets |
| SC-02 | Daten werden in korrekten Zeilen und Spalten abgelegt | Kein Datenverlust, keine Verschiebung | Vergleich Input vs. Output |
| SC-03 | Formeln werden korrekt berechnet | Ergebnisse stimmen | Formel-Pruefung in Tabellenkalkulation |
| SC-04 | Formatierung (Spaltenbreiten, Fettdruck, Zahlenformate) wird angewendet | Visuell korrekt | Visuelle Pruefung |
| SC-05 | Mehrere Sheets werden korrekt erstellt | Alle Sheets vorhanden | Pruefung in Tabellenkalkulation |
| SC-06 | Erzeugung gelingt beim ersten Versuch | >95% Erfolgsrate | Tool-Return ohne Fehler |

---

## Technical NFRs (fuer Architekt)

### Performance
- **Erzeugungszeit**: < 5s fuer Tabelle mit 1000 Zeilen und 20 Spalten
- **Memory**: < 80 MB zusaetzlicher Heap
- **Bundle-Groesse Zuwachs**: exceljs < 2 MB (minified)

### Kompatibilitaet
- **Output-Format**: OOXML (.xlsx) kompatibel mit Excel 2016+, LibreOffice Calc 7+, Google Sheets
- **Plattform**: Desktop zwingend, Mobile wuenschenswert
- **Obsidian**: v1.5+

### Sicherheit
- **Kein dynamischer Code**: Ausschliesslich reviewed Plugin-Code
- **Pfad-Validierung**: Output-Pfad innerhalb des Vaults
- **Keine Schreibzugriffe auf .obsidian/**
- **Keine Makros/VBA**: Nur Formeln, kein ausfuehrbarer Code in der XLSX

### Zuverlaessigkeit
- **Fehlerbehandlung**: Klarer Fehler bei ungueltigem Input
- **Keine korrumpierten Dateien**: Gueltige XLSX oder Fehler

---

## Architecture Considerations

### Architecturally Significant Requirements (ASRs)

**CRITICAL ASR #1: Plugin-Kontext-Ausfuehrung**
- **Warum ASR**: XLSX-Erzeugung benoetigt Node.js Buffer/Stream APIs
- **Impact**: Tool lebt in src/core/tools/
- **Quality Attribute**: Zuverlaessigkeit

**CRITICAL ASR #2: Formel-Support**
- **Warum ASR**: Excel-Formeln sind ein Kern-Feature von Tabellenkalkulationen. Ohne Formeln ist das Tool nur ein Daten-Exporteur.
- **Impact**: Bestimmt ob die Library Formel-Strings direkt durchreichen kann oder ob sie berechnet werden muessen
- **Quality Attribute**: Funktionalitaet

### Constraints
- **Review-Bot**: ES import, kein innerHTML, kein console.log
- **Pattern-Konsistenz**: Gleiches Wiring-Pattern wie andere create_*-Tools
- **Keine Makros**: Nur passive Formeln, kein VBA

### Open Questions fuer Architekt
- Soll das Schema rohe Zelldaten als 2D-Array akzeptieren oder als Array von Objekten (mit Spaltenheadern)?
- Wie werden Datentypen kommuniziert (Zahl vs. Text vs. Datum)?
- Auto-Fit fuer Spaltenbreiten oder explizite Breiten-Angabe?

---

## Definition of Done

### Functional
- [ ] Tool erzeugt gueltige XLSX-Dateien (oeffenbar in Excel, LibreOffice Calc, Google Sheets)
- [ ] Content-Typen: Text, Zahlen, Datumsangaben, Formeln, mehrere Sheets
- [ ] Formatierung: Spaltenbreiten, Fettdruck, Zahlenformate, Zellenfarben
- [ ] Output-Pfad frei waehlbar, Vault-Speicherung korrekt
- [ ] Registriert in ToolRegistry, toolMetadata, builtinModes

### Quality
- [ ] Fehlerbehandlung bei ungueltigem Input
- [ ] Keine korrumpierten Dateien bei Fehler

### Documentation
- [ ] Feature-Spec aktualisiert (Status: Implemented)

---

## Dependencies

- **Library**: exceljs (npm) -- muss im Plugin-Kontext funktionieren
- **Vault API**: Binary-Write-Capability
- **FEATURE-404**: Agent-Prompt-Update

## Assumptions

- exceljs laeuft in Electron/Node.js-Kontext
- esbuild kann exceljs korrekt bundlen
- Formel-Strings werden direkt in die XLSX geschrieben (keine Berechnung noetig)

## Out of Scope

- Pivot-Tabellen
- Diagramme/Charts in der XLSX
- Bearbeitung bestehender XLSX-Dateien
- Conditional Formatting (kann spaeter ergaenzt werden)
