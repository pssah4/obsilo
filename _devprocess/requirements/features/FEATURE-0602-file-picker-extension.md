# Feature: File Picker Erweiterung

> **Feature ID**: FEATURE-201
> **Epic**: EPIC-002 - Files-to-Chat
> **Priority**: P0-Critical
> **Effort Estimate**: S
> **Status**: Implementiert

## Feature Description

Erweiterung beider File-Picker-Mechanismen (OS File Picker via Büroklammer und Vault File Picker via Vault-Button), damit Office- und Datenformate auswählbar sind. Aktuell sind Office-Formate im OS-Finder ausgegraut und der Vault-Picker zeigt nur Markdown-Dateien. Zusätzlich werden format-spezifische Chip-Icons für angehängte Office-Dateien eingeführt.

## Benefits Hypothesis

**Wir glauben dass** die Erweiterung der File Picker
**folgende messbare Outcomes liefert:**
- Nutzer können alle unterstützten Formate ohne Workaround auswählen
- Bisherige UX (Bilder, Text) bleibt unverändert

**Wir wissen dass wir erfolgreich sind wenn:**
- Alle 7 neuen Formate im OS-Finder auswählbar sind (nicht mehr ausgegraut)
- Office-Dateien im Vault über den Vault-Picker sichtbar und auswählbar sind
- Angehängte Dateien mit passendem Icon im Chip-Bar angezeigt werden

## User Stories

### Story 1: Office-Datei über Büroklammer anhängen
**Als** Knowledge Worker
**möchte ich** über die Büroklammer im Chat eine PowerPoint/Excel/Word/PDF-Datei auswählen
**um** sie als Kontext für den Agent bereitzustellen

**Akzeptanzkriterien:**
- Office-Formate (.pptx, .xlsx, .docx, .pdf) sind im OS-Finder nicht mehr ausgegraut
- Datenformate (.json, .xml, .csv) sind ebenfalls auswählbar
- Bestehende Formate (Bilder, Textdateien) funktionieren weiterhin
- Mehrfachauswahl bleibt möglich

### Story 2: Office-Datei aus dem Vault anhängen
**Als** Knowledge Worker
**möchte ich** über den Vault-Button eine Office-Datei aus meinem Vault auswählen
**um** Dateien direkt aus meinem Arbeitsbereich als Kontext zu nutzen

**Akzeptanzkriterien:**
- Vault-Picker zeigt neben Markdown auch Office- und Datenformate
- Suche filtert auch nach Office-Dateinamen
- Dateityp ist visuell erkennbar (Icon oder Suffix)

### Story 3: Chip-Anzeige für Office-Dateien
**Als** Knowledge Worker
**möchte ich** angehängte Office-Dateien mit einem passenden Icon im Chat sehen
**um** auf einen Blick zu erkennen, welche Dateien ich angehängt habe

**Akzeptanzkriterien:**
- Office-Dateien zeigen ein format-spezifisches Icon (nicht das Text-Icon)
- Dateiname wird angezeigt
- Entfernen-Button (X) funktioniert wie bei bestehenden Attachments

---

## Success Criteria (Tech-Agnostic)

| ID | Criterion | Target | Measurement |
|----|-----------|--------|-------------|
| SC-01 | Office-Dateien sind im Dateiauswahl-Dialog auswählbar | Nicht mehr ausgegraut | Manueller Test: PPTX/XLSX/DOCX/PDF im Finder auswählen |
| SC-02 | Vault-Dateien aller unterstützten Formate sind sichtbar | Alle Formate durchsuchbar | Manueller Test: Office-Datei im Vault über Suche finden |
| SC-03 | Bestehende Funktionalität unverändert | Keine Regression | Test: Bilder und Textdateien anhängen wie bisher |
| SC-04 | Angehängte Dateien visuell unterscheidbar | Auf einen Blick erkennbar | Manueller Test: Verschiedene Formate anhängen, Icons prüfen |

---

## Technical NFRs (für Architekt) - MIT TECHNOLOGIE OK

### Performance
- **File Picker Öffnung**: Keine zusätzliche Verzögerung durch erweiterten Accept-Filter
- **Vault Picker Suche**: < 200ms Filterung auch bei 10.000+ Vault-Dateien

### Compliance
- **Obsidian Review-Bot**: CSS-Klassen statt `element.style`, Obsidian DOM API (`createEl`, `createDiv`)
- **Keine any-Types**: Dateityp-Prüfungen mit Type Guards

### UI
- **Chip Icons**: Obsidian-eigene Icons verwenden (Lucide-Set), keine externen Assets
- **Responsive**: Chip-Bar muss bei vielen Attachments scrollbar bleiben

---

## Architecture Considerations

### Architecturally Significant Requirements (ASRs)

**MODERATE ASR #1: Vault File Picker - Dateiabfrage**
- **Warum ASR**: `getMarkdownFiles()` muss durch `getFiles()` oder eine alternative Abfrage ersetzt werden, die aber performant genug für große Vaults ist
- **Impact**: Filtermechanismus muss effizient sein, da Vaults 10.000+ Dateien haben können
- **Quality Attribute**: Performance, Usability

### Constraints
- **Obsidian API**: Vault-Dateien nur über offizielle API abrufen
- **Review-Bot**: DOM-Manipulation nur über Obsidian DOM API

### Open Questions für Architekt
- Soll der Vault Picker eine Dateiendungs-Filter-Option bekommen (z.B. "Nur Office-Dateien")?
- Wie werden binäre Dateien aus dem Vault gelesen (`vault.readBinary()` statt `vault.read()`)?

---

## Definition of Done

### Functional
- [ ] OS File Picker: `.pptx`, `.xlsx`, `.docx`, `.pdf`, `.json`, `.xml`, `.csv` auswählbar
- [ ] Vault Picker: Alle unterstützten Formate sichtbar und durchsuchbar
- [ ] Chip-Bar: Format-spezifische Icons für Office-Dateien
- [ ] Bestehende Funktionalität (Bilder, Text) unverändert

### Quality
- [ ] Regressionstests: Bilder und Textdateien weiterhin funktional
- [ ] Performance: Vault Picker mit 10.000+ Dateien noch flüssig
- [ ] Review-Bot Compliance geprüft

### Documentation
- [ ] Feature-Spec aktualisiert (Status: Implemented)

---

## Dependencies

- **FEATURE-200**: Parsing-Pipeline muss die ausgewählten Dateien verarbeiten können (kann parallel entwickelt werden, Integration am Ende)

## Assumptions

- Obsidian Vault API bietet `getFiles()` oder äquivalent für alle Dateitypen
- `vault.readBinary()` kann für binäre Dateien verwendet werden
- Obsidian-eigene Icon-Library (Lucide) enthält passende Icons für Office-Formate

## Out of Scope

- Drag-and-Drop Support (Nice-to-have, nicht MVP)
- Dateivorschau im Picker (nur Name + Icon)
