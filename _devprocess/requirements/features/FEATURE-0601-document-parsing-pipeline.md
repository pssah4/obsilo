# Feature: Document Parsing Pipeline

> **Feature ID**: FEATURE-0601
> **Epic**: EPIC-006 - Files-to-Chat
> **Priority**: P0-Critical
> **Effort Estimate**: L
> **Status**: Implementiert

## Feature Description

Lokale Parsing-Pipeline für Office- und Datenformate innerhalb der Obsidian/Electron-Sandbox. Unterstützt PPTX, XLSX, DOCX, PDF sowie strukturierte Datenformate (JSON, XML, CSV). Jeder Parser extrahiert Text mit erhaltener Dokumentstruktur (Folien, Sheets, Überschriften, Tabellen) und gibt das Ergebnis als strukturierten Textblock zurück, der als Kontext an die API gesendet wird.

Bilder werden in diesem Feature nur als Metadaten erfasst (Anzahl, Position). Die eigentliche Bild-Extraktion und -Übergabe erfolgt in FEATURE-0604 (On-Demand Bild-Extraktion).

## Benefits Hypothesis

**Wir glauben dass** eine lokale Parsing-Pipeline für Office- und Datenformate
**folgende messbare Outcomes liefert:**
- Nutzer können 7 zusätzliche Dateiformate als Chat-Kontext nutzen
- Die Notwendigkeit für manuelles Copy-Paste entfällt vollständig

**Wir wissen dass wir erfolgreich sind wenn:**
- Alle 7 Formate (PPTX, XLSX, DOCX, PDF, JSON, XML, CSV) fehlerfrei geparst werden
- Mindestens 95% der Kernaussagen eines Dokuments im extrahierten Text enthalten sind
- Parsing einer 30-Folien-Präsentation unter 5 Sekunden dauert

## User Stories

### Story 1: PowerPoint als Kontext
**Als** Knowledge Worker
**möchte ich** eine PowerPoint-Datei an den Chat anhängen
**um** die Kernaussagen zusammenfassen zu lassen oder basierend darauf neue Inhalte zu erstellen

**Akzeptanzkriterien:**
- Folienstruktur wird erkannt (Titel, Aufzählungen, Sprechernotizen)
- Jede Folie ist als eigener Block im extrahierten Text identifizierbar
- Tabellen auf Folien werden als Markdown-Tabellen dargestellt
- Anzahl und Position eingebetteter Bilder werden als Metadaten erfasst

### Story 2: Excel zur Datenanalyse
**Als** Knowledge Worker
**möchte ich** eine Excel-Datei an den Chat anhängen
**um** Daten analysieren oder Tabellen in meine Notes übernehmen zu lassen

**Akzeptanzkriterien:**
- Alle Sheets werden extrahiert, jedes als eigener Block
- Zellwerte (nicht Formeln) werden als Markdown-Tabellen dargestellt
- Leere Zeilen/Spalten am Rand werden ignoriert
- Sheet-Namen sind als Überschriften erkennbar

### Story 3: Word-Dokument verarbeiten
**Als** Knowledge Worker
**möchte ich** eine Word-Datei an den Chat anhängen
**um** den Inhalt zusammenfassen oder als Basis für neue Dokumente nutzen zu lassen

**Akzeptanzkriterien:**
- Überschriften-Hierarchie bleibt erhalten (H1-H6 -> Markdown ##)
- Absätze, Listen (nummeriert + Aufzählung) werden korrekt extrahiert
- Tabellen werden als Markdown-Tabellen dargestellt
- Fußnoten werden als Referenzen am Ende dargestellt

### Story 4: PDF-Text extrahieren
**Als** Knowledge Worker
**möchte ich** ein PDF an den Chat anhängen
**um** den Textinhalt als Kontext für den Agent bereitzustellen

**Akzeptanzkriterien:**
- Text aus text-basierten PDFs wird vollständig extrahiert
- Seitenumbrüche werden als Trenner dargestellt
- Bei rein bild-basierten PDFs (gescannt) wird der Nutzer informiert, dass OCR nicht unterstützt wird
- Mehrspaltige Layouts werden bestmöglich linearisiert

### Story 5: Datenformate verarbeiten
**Als** Knowledge Worker
**möchte ich** JSON-, XML- und CSV-Dateien strukturiert anhängen
**um** Daten analysieren oder in Markdown-Tabellen überführen zu lassen

**Akzeptanzkriterien:**
- JSON wird formatiert (pretty-print) mit Syntax-Highlighting-Hinweisen dargestellt
- XML wird als formatierter Text mit Tag-Struktur dargestellt
- CSV wird als Markdown-Tabelle dargestellt (mit Header-Erkennung)

---

## Success Criteria (Tech-Agnostic)

| ID | Criterion | Target | Measurement |
|----|-----------|--------|-------------|
| SC-01 | Alle unterstützten Formate werden fehlerfrei verarbeitet | < 1% Fehlerrate | Test mit je 10 Dateien pro Format |
| SC-02 | Dokumentstruktur bleibt erkennbar | Folien/Sheets/Kapitel als eigene Blöcke | Manuelle Prüfung: Struktur im Output nachvollziehbar |
| SC-03 | Kernaussagen vollständig erfasst | >= 95% | Vergleich: Original vs. extrahierter Text (Stichprobe) |
| SC-04 | Verarbeitungsdauer wahrnehmbar schnell | < 5 Sekunden für typische Dateien | Zeitmessung: 30-Folien PPTX, 50-Seiten PDF |
| SC-05 | Nutzer wird bei nicht verarbeitbaren Dateien informiert | Klare Meldung statt Fehler | Test: Gescanntes PDF -> informativer Hinweis |
| SC-06 | Zusatzkomponenten erhöhen Installationsgröße nicht wesentlich | Spürbar nicht größer | Vergleich Vorher/Nachher-Bundlegröße |

---

## Technical NFRs (für Architekt) - MIT TECHNOLOGIE OK

### Performance
- **Parsing PPTX (30 Folien)**: < 5.000 ms (Ziel < 1.000 ms)
- **Parsing XLSX (10 Sheets, je 1000 Zeilen)**: < 3.000 ms
- **Parsing DOCX (100 Seiten)**: < 2.000 ms
- **Parsing PDF (100 Seiten, text-basiert)**: < 5.000 ms
- **Memory Peak**: < 200 MB zusätzlich während Parsing

### Security
- **Lokale Verarbeitung**: Parsing komplett im Electron-Prozess, keine Rohdateien an externe Services
- **Input Validation**: ZIP-Bomb-Protection für OOXML-Formate (max. Decompressed Size)
- **Path Traversal**: Schutz gegen bösartige Pfade in ZIP-Archiven

### Compliance
- **Obsidian Review-Bot**: Kein `fetch()`, kein `innerHTML`, kein `console.log`, kein `require()` (außer Electron), keine `any`-Types
- **Sandbox**: Kein Zugriff auf Systemtools, keine nativen Binaries
- **Bundlegröße**: Zusätzliche Dependencies < 5 MB (komprimiert/gzipped)

### Scalability
- **Dateigröße**: Bis 50 MB Eingabedateien (darüber hinaus: User-Warnung)
- **Erweiterbarkeit**: Parser-Architektur muss neue Formate ohne Umbau erlauben

---

## Architecture Considerations

### Architecturally Significant Requirements (ASRs)

**CRITICAL ASR #1: Sandbox-Kompatibilität**
- **Warum ASR**: Parsing-Libraries müssen ohne native Binaries, ohne `require()`, ohne `fetch()` in der Electron-Sandbox laufen
- **Impact**: Schränkt Library-Wahl massiv ein; möglicherweise eigenes Parsing auf ZIP+XML-Basis nötig
- **Quality Attribute**: Compatibility, Compliance

**CRITICAL ASR #2: Parser-Erweiterbarkeit**
- **Warum ASR**: Weitere Formate (CSV ist P0 Datenformat, E-Mail etc. später) müssen ohne Architekturänderung hinzufügbar sein
- **Impact**: Benötigt Plugin-artiges Parser-Interface mit Registry
- **Quality Attribute**: Extensibility, Maintainability

**MODERATE ASR #3: Performance bei großen Dateien**
- **Warum ASR**: 100-Seiten-PDFs oder XLSX mit 10k+ Zeilen dürfen den UI-Thread nicht blockieren
- **Impact**: Parsing muss ggf. in Web Worker oder chunked verarbeitet werden
- **Quality Attribute**: Performance, Responsiveness

### Constraints
- **Platform**: Electron/Obsidian Sandbox (kein Node.js fs-Zugriff für Libraries)
- **Compliance**: Obsidian Community Plugin Review-Bot Regeln
- **Bundlegröße**: < 5 MB zusätzlich

### Open Questions für Architekt
- Welche Libraries bieten das beste Verhältnis aus Funktionalität, Bundlegröße und Sandbox-Kompatibilität?
- Soll Parsing im Haupt-Thread oder in einem Web Worker laufen?
- Wie wird das strukturierte Parse-Ergebnis als ContentBlock abgebildet -- ein großer Textblock oder mehrere (pro Folie/Sheet)?
- OOXML-Formate sind ZIP-Archive -- kann die existierende Sandbox-Worker-Infrastruktur (`sandbox-worker.js`) genutzt werden?

---

## Definition of Done

### Functional
- [ ] PPTX-Parser: Text + Struktur + Sprechernotizen
- [ ] XLSX-Parser: Alle Sheets + Zelldaten als Markdown-Tabellen
- [ ] DOCX-Parser: Text + Überschriften + Listen + Tabellen
- [ ] PDF-Parser: Textextraktion text-basierter PDFs
- [ ] JSON/XML/CSV: Strukturierte Darstellung
- [ ] Fehler-Handling: Informative Meldung bei nicht verarbeitbaren Dateien

### Quality
- [ ] Unit Tests für jeden Parser (min. 5 Testdateien pro Format)
- [ ] Performance-Tests bestanden (alle Formate < 5s)
- [ ] Security: ZIP-Bomb-Protection getestet
- [ ] Review-Bot Compliance geprüft

### Documentation
- [ ] Feature-Spec aktualisiert (Status: Implemented)
- [ ] Parser-Interface dokumentiert (für zukünftige Erweiterungen)

---

## Dependencies

- **Parsing-Libraries**: Geeignete JS-Libraries müssen identifiziert und evaluiert werden (Architekt-Aufgabe)
- **FEATURE-0602**: File Picker muss die neuen Formate anbieten, damit Dateien überhaupt in die Pipeline gelangen

## Assumptions

- OOXML (PPTX/XLSX/DOCX) kann als ZIP+XML ohne native Dependencies geparst werden
- PDF-Text-Extraktion ist mit reiner JS-Library in akzeptabler Qualität machbar
- Die extrahierten Inhalte werden als `text`-ContentBlock an die API gesendet (kein neuer Block-Typ nötig)

## Out of Scope

- Bild-Extraktion und -Übergabe an API (siehe FEATURE-0604)
- Token-Budget-Prüfung (siehe FEATURE-0603)
- Erzeugung von Office-Dateien (separates Feature, nicht in diesem Epic)
