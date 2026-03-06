# Feature: create_docx Tool

> **Feature ID**: FEATURE-401
> **Epic**: EPIC-004 - Office Document Creation
> **Priority**: P0-Critical
> **Effort Estimate**: M

## Feature Description

Dediziertes Built-in Tool zur Erzeugung von Word-Dokumenten (DOCX) im Plugin-Kontext.
Der Agent uebergibt strukturierte Dokument-Daten (Ueberschriften, Absaetze, Listen, Tabellen, Bilder),
das Tool erzeugt die Datei programmatisch und speichert sie im Vault.

## Benefits Hypothesis

**Wir glauben dass** ein dediziertes create_docx Tool
**Folgende messbare Outcomes liefert:**
- Zuverlaessige DOCX-Erzeugung in einem einzigen Tool-Call
- Professionelle Dokumentenqualitaet mit korrekter Formatierung

**Wir wissen dass wir erfolgreich sind wenn:**
- DOCX-Dateien werden korrekt erzeugt und sind in Word/LibreOffice oeffenbar
- Formatierung (Ueberschriften-Hierarchie, Listen, Tabellen) ist korrekt

## User Stories

### Story 1: Report erstellen
**Als** Wissensarbeiter
**moechte ich** dem Agent sagen "Schreibe einen Report ueber X als Word-Dokument"
**um** ein formatiertes Dokument zu erhalten, das ich direkt weiterleiten kann

### Story 2: Dokument aus Vault-Inhalten
**Als** Berater
**moechte ich** dem Agent sagen "Erstelle ein Angebot basierend auf meinen Notizen zu Projekt Y"
**um** mein Vault-Wissen in ein professionelles Kundendokument umzuwandeln

### Story 3: Strukturiertes Dokument mit Gliederung
**Als** User
**moechte ich** dem Agent Ueberschriften-Struktur, Absaetze und Tabellen definieren koennen
**um** ein praezise gegliedertes Dokument zu erhalten

---

## Success Criteria (Tech-Agnostic)

| ID | Criterion | Target | Measurement |
|----|-----------|--------|-------------|
| SC-01 | Erzeugte Dokumente lassen sich in gaengiger Office-Software fehlerfrei oeffnen | 100% | Manuelle Pruefung in Word, LibreOffice, Google Docs |
| SC-02 | Ueberschriften-Hierarchie wird korrekt abgebildet | Alle Ebenen korrekt | Vergleich Input-Struktur vs. Output |
| SC-03 | Listen (nummeriert und unnummeriert) werden korrekt dargestellt | 100% | Visuelle Pruefung |
| SC-04 | Tabellen werden mit korrekten Zeilen/Spalten erzeugt | Kein Datenverlust | Vergleich Input-Daten vs. Output |
| SC-05 | Erzeugung gelingt beim ersten Versuch | >95% Erfolgsrate | Tool-Return ohne Fehler |
| SC-06 | Bilder aus dem Vault koennen eingebettet werden | Bilder erscheinen korrekt | Visuelle Pruefung |

---

## Technical NFRs (fuer Architekt)

### Performance
- **Erzeugungszeit**: < 5s fuer 20-seitiges Dokument mit Text + Tabellen
- **Memory**: < 80 MB zusaetzlicher Heap
- **Bundle-Groesse Zuwachs**: docx-Library < 1 MB (minified)

### Kompatibilitaet
- **Output-Format**: OOXML (.docx) kompatibel mit Word 2016+, LibreOffice 7+, Google Docs
- **Plattform**: Desktop zwingend, Mobile wuenschenswert
- **Obsidian**: v1.5+

### Sicherheit
- **Kein dynamischer Code**: Ausschliesslich reviewed Plugin-Code
- **Pfad-Validierung**: Output-Pfad innerhalb des Vaults
- **Keine Schreibzugriffe auf .obsidian/**

### Zuverlaessigkeit
- **Fehlerbehandlung**: Klarer Fehler bei ungueltigem Input
- **Keine korrumpierten Dateien**: Gueltige DOCX oder Fehler

---

## Architecture Considerations

### Architecturally Significant Requirements (ASRs)

**CRITICAL ASR #1: Plugin-Kontext-Ausfuehrung**
- **Warum ASR**: DOCX-Erzeugung benoetigt Node.js Buffer/Stream APIs (OOXML = ZIP mit XML)
- **Impact**: Tool lebt in src/core/tools/, hat vollen Node.js-Zugriff
- **Quality Attribute**: Zuverlaessigkeit

**CRITICAL ASR #2: Input-Schema-Design**
- **Warum ASR**: Schema muss die volle Breite eines Word-Dokuments abbilden (Ueberschriften, Absaetze, Listen, Tabellen, Bilder, Formatierung) ohne das LLM zu ueberfordern
- **Impact**: Bestimmt LLM-Zuverlaessigkeit und Output-Qualitaet
- **Quality Attribute**: Usability

### Constraints
- **Review-Bot**: ES import, kein innerHTML, kein console.log
- **Pattern-Konsistenz**: Gleiches Wiring-Pattern wie andere create_*-Tools

### Open Questions fuer Architekt
- Soll das Schema Markdown-aehnlichen Input unterstuetzen (z.B. "# Heading" statt verschachtelter Objekte)?
- Wie werden Seitenumbrueche und Seitenzahlen gesteuert?
- Header/Footer-Support im MVP oder spaetere Iteration?

---

## Definition of Done

### Functional
- [ ] Tool erzeugt gueltige DOCX-Dateien (oeffenbar in Word, LibreOffice, Google Docs)
- [ ] Content-Typen: Ueberschriften (H1-H6), Absaetze, nummerierte Listen, Aufzaehlungen, Tabellen, Bilder, Formatierung (fett, kursiv)
- [ ] Output-Pfad frei waehlbar, Vault-Speicherung korrekt
- [ ] Registriert in ToolRegistry, toolMetadata, builtinModes

### Quality
- [ ] Fehlerbehandlung bei ungueltigem Input
- [ ] Keine korrumpierten Dateien bei Fehler

### Documentation
- [ ] Feature-Spec aktualisiert (Status: Implemented)

---

## Dependencies

- **Library**: docx (npm) -- muss im Plugin-Kontext funktionieren
- **Vault API**: Binary-Write-Capability
- **FEATURE-404**: Agent-Prompt-Update

## Assumptions

- docx-Library laeuft in Electron/Node.js-Kontext
- esbuild kann docx korrekt bundlen

## Out of Scope

- Template-System mit Dokumentvorlagen
- Bearbeitung bestehender DOCX-Dateien
- Kommentar/Tracking-System
- Inhaltsverzeichnis-Generierung (kann spaeter ergaenzt werden)
