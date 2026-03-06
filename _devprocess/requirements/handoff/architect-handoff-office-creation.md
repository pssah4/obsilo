# Architect Handoff: Office Document Creation (EPIC-004)

> **Datum**: 2026-03-06
> **Von**: Requirements Engineer
> **An**: Architect Agent
> **Business Alignment**: BA-office-document-creation.md
> **Epic**: EPIC-004-office-document-creation.md

---

## 1. Zusammenfassung

Vier dedizierte Built-in Tools (`create_pptx`, `create_docx`, `create_xlsx`, `create_pdf`) sollen
Office-Dokumente im Plugin-Kontext (Schicht 2) erzeugen. Die Sandbox-basierte Erzeugung (Schicht 3)
ist strukturell gescheitert (fehlende APIs: Blob, Buffer, DOM). Die Architektur-Entscheidung fuer
Plugin-Level-Ausfuehrung ist bereits in GLOSSAR-begriffe.md und ADR-021 verankert.

---

## 2. Aggregierte ASRs

### CRITICAL

| ASR | Feature | Impact | Quality Attribute |
|-----|---------|--------|-------------------|
| Plugin-Kontext-Ausfuehrung | Alle 4 Tools | Tools muessen in Schicht 2 laufen (Node.js APIs noetig) | Zuverlaessigkeit |
| Input-Schema-Design | Alle 4 Tools | Schema-Komplexitaet bestimmt LLM-Zuverlaessigkeit | Usability |

### MODERATE

| ASR | Feature | Impact | Quality Attribute |
|-----|---------|--------|-------------------|
| Binary Write via Vault API | Alle 4 Tools | Mechanismus fuer binaere Datei-Speicherung | Kompatibilitaet |
| Font-Handling (PDF) | FEATURE-403 | StandardFonts vs. Custom Fonts fuer Umlaute | Qualitaet |
| Abgrenzung Pandoc-Export (PDF) | FEATURE-403 | Wann create_pdf vs. execute_recipe | Usability |
| Formel-Support (XLSX) | FEATURE-402 | Formel-Strings direkt in XLSX schreiben | Funktionalitaet |
| Prompt-Konsistenz | FEATURE-404 | Alle Prompt-Stellen synchron aktualisieren | Zuverlaessigkeit |

---

## 3. Aggregierte NFRs

### Performance

| Metrik | Target | Feature |
|--------|--------|---------|
| PPTX-Erzeugung (30 Folien) | < 10s | FEATURE-400 |
| DOCX-Erzeugung (20 Seiten) | < 5s | FEATURE-401 |
| XLSX-Erzeugung (1000 Zeilen, 20 Spalten) | < 5s | FEATURE-402 |
| PDF-Erzeugung (20 Seiten) | < 5s | FEATURE-403 |
| Memory pro Erzeugung | < 100 MB | Alle |

### Bundle-Groesse

| Library | Max. Groesse (minified) | Feature |
|---------|------------------------|---------|
| pptxgenjs | < 2 MB | FEATURE-400 |
| docx | < 1 MB | FEATURE-401 |
| exceljs | < 2 MB | FEATURE-402 |
| pdf-lib | < 1 MB | FEATURE-403 |
| **Gesamt-Zuwachs** | **< 5 MB** | |

### Kompatibilitaet

| Format | Ziel-Kompatibilitaet |
|--------|---------------------|
| PPTX | PowerPoint 2016+, LibreOffice 7+, Google Slides |
| DOCX | Word 2016+, LibreOffice 7+, Google Docs |
| XLSX | Excel 2016+, LibreOffice Calc 7+, Google Sheets |
| PDF | PDF 1.7+, alle gaengigen Viewer |

### Sicherheit

- Kein dynamischer Code: Ausschliesslich reviewed Plugin-Code
- Pfad-Validierung: Output-Pfad muss innerhalb des Vaults liegen
- Keine Schreibzugriffe auf .obsidian/
- Keine Makros/VBA in XLSX/DOCX/PPTX

---

## 4. Constraints

| Constraint | Quelle | Impact |
|-----------|--------|--------|
| Review-Bot-Compliance | Obsidian Community Guidelines | Kein require(), kein innerHTML, kein console.log, ES import only |
| Obsidian Vault API fuer Binary Write | Plugin-Architektur | Kein direkter fs-Zugriff, nur vault.createBinary / adapter.writeBinary |
| Pattern-Konsistenz | Bestehende Architektur | Gleiches Wiring wie CreateExcalidrawTool, GenerateCanvasTool |
| Keine dynamische Code-Ausfuehrung | Sicherheitsmodell (GLOSSAR) | Tools fuehren nur reviewed Code aus |
| Bundle-Groesse | Plugin-Distribution | Gesamtzuwachs < 5 MB |

---

## 5. Open Questions (priorisiert)

### Hoch (vor Implementierung zu klaeren)

1. **Input-Schema-Design:** Flach vs. verschachtelt? Markdown-aehnlicher Textinput vs. strukturierte JSON-Objekte? Trade-off: LLM-Zuverlaessigkeit vs. Ausdrucksfaehigkeit.

2. **Binary Write Mechanismus:** `vault.createBinary()` vs. `vault.adapter.writeBinary()` vs. `DataAdapter.write(path, data)`. Welcher ist der stabile, offizielle Weg?

3. **Gemeinsame Basisklasse:** Sollen die 4 Tools eine gemeinsame Basisklasse oder Utility-Funktionen teilen (z.B. Pfad-Validierung, Binary-Write, Fehlerbehandlung)?

### Mittel (waehrend Implementierung klaerenbar)

4. **Lazy Loading:** Dynamischer import der Libraries (Code-Splitting) vs. statischer Import? Auswirkung auf Bundle-Groesse und Startup-Zeit.

5. **Font-Handling (PDF):** StandardFonts (Helvetica, Times, Courier) reichen fuer ASCII. Fuer Umlaute/Unicode noetig: Custom Font Embedding. Im MVP oder spaeter?

6. **Tool-Gruppe:** edit-Gruppe (konsistent mit write_file, create_excalidraw) oder eigene Gruppe?

### Niedrig (nach MVP)

7. **Template-System:** User-definierte Templates fuer spaetere Phase.
8. **Bearbeitung bestehender Dateien:** Modify-statt-Recreate in spaeterer Phase.

---

## 6. Bestehende Architektur-Referenzen

| Dokument | Relevanz |
|----------|----------|
| GLOSSAR-begriffe.md | Definiert Schicht 2 vs. Schicht 3, explizit: "binaere Dateiformate muessen als Built-in Tools implementiert werden" |
| ADR-021-sandbox-os-isolation.md | Sandbox-Architektur, Abgrenzung Desktop/Mobile |
| toolDecisionGuidelines.ts | Regel 1c (Plugin-Formate), Regel 9 (Built-in Tools First) |
| builtinModes.ts | Agent-Mode Prompt, Tool-Gruppen-Mapping |
| CreateExcalidrawTool.ts | Referenz-Pattern fuer format-erzeugende Built-in Tools |
| GenerateCanvasTool.ts | Referenz-Pattern mit strukturiertem JSON-Input |

---

## 7. Empfohlene ADR-Kandidaten

1. **ADR: Input-Schema-Design fuer Office-Tools** -- Flach vs. verschachtelt, Markdown-Input vs. JSON
2. **ADR: Library-Selection Office-Formate** -- pptxgenjs/docx/exceljs/pdf-lib bestaetigen oder Alternativen
3. **ADR: Binary Write Pattern** -- Offizieller Vault-API-Weg fuer binaere Dateien

---

## 8. Feature-Uebersicht

| Feature | Datei | Priority | Effort |
|---------|-------|----------|--------|
| FEATURE-400: create_pptx | FEATURE-400-create-pptx.md | P0 | M |
| FEATURE-401: create_docx | FEATURE-401-create-docx.md | P0 | M |
| FEATURE-402: create_xlsx | FEATURE-402-create-xlsx.md | P0 | M |
| FEATURE-403: create_pdf | FEATURE-403-create-pdf.md | P0 | M |
| FEATURE-404: Prompt & Skill Update | FEATURE-404-agent-prompt-update.md | P1 | S |
