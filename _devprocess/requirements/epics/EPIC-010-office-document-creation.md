# Epic: Office Document Creation

> **Epic ID**: EPIC-010
> **Business Alignment**: _devprocess/analysis/BA-005-office-document-creation.md
> **Scope**: MVP

## Epic Hypothesis Statement

FUER Wissensarbeiter und Berater
DIE taeglich Office-Dokumente aus ihrem Wissensbestand erstellen muessen
IST DAS Office Document Creation Feature-Set
EIN Satz dedizierter Built-in Tools fuer binaere Dateierzeugung
DAS Praesentationen, Dokumente, Tabellenkalkulationen und PDFs direkt im Vault erzeugt
IM GEGENSATZ ZU manueller Copy-Paste-Arbeit in separaten Office-Programmen
UNSERE LOESUNG erzeugt professionelle Dateien in einem einzigen Tool-Call aus dem Chat heraus

## Business Outcomes (messbar)

1. **Erfolgsrate**: Binaere Office-Dateierzeugung steigt von 0% auf >95% innerhalb MVP-Release
2. **Effizienz**: Tool-Calls pro Erzeugung sinkt von 20+ (gescheiterte Sandbox-Versuche) auf 1 innerhalb MVP-Release
3. **Format-Abdeckung**: Erzeugte Formate steigt von 0 auf 4 (PPTX, DOCX, XLSX, PDF) innerhalb MVP-Release

## Leading Indicators (Fruehindikatoren)

- Library-Kompatibilitaet: Alle 4 Libraries (pptxgenjs, docx, exceljs, pdf-lib) laufen im Plugin-Kontext ohne Fehler
- Schema-Akzeptanz: LLM erzeugt valide Tool-Inputs bei >90% der Versuche
- Bundle-Groesse: Gesamtzuwachs durch Dependencies < 5 MB

## MVP Features

| Feature ID | Name | Priority | Effort | Status |
|------------|------|----------|--------|--------|
| FEATURE-400 | create_pptx Tool | P0 | M | Not Started |
| FEATURE-401 | create_docx Tool | P0 | M | Not Started |
| FEATURE-402 | create_xlsx Tool | P0 | M | Not Started |
| FEATURE-403 | create_pdf Tool | P0 | M | Not Started |
| FEATURE-404 | Agent Prompt & Skill Update | P1 | S | Not Started |

**Priority Legend:**
- P0-Critical: Ohne geht MVP nicht
- P1-High: Wichtig fuer vollstaendige User Experience

**Effort:** S (1-2 Sprints), M (3-5 Sprints), L (6+ Sprints)

## Explizit Out-of-Scope

- **Template-System:** User-definierte Templates fuer spaetere Phase
- **Format-Konvertierung:** DOCX-zu-PDF, PPTX-zu-PDF -- dafuer existiert Pandoc/execute_recipe
- **Bearbeitung bestehender Dateien:** "Oeffne PPTX und aendere Folie 3" -- nur Neuerstellung
- **Macro/VBA-Support:** Keine Makros in DOCX/XLSX/PPTX

## Dependencies & Risks

### Dependencies
- **Obsidian Vault API:** Binary-Write-Faehigkeit (vault.createBinary o.ae.), bei Verzoegerung: Fallback auf adapter.writeBinary
- **npm Libraries:** pptxgenjs, docx, exceljs, pdf-lib -- muessen mit esbuild bundlebar sein

### Risks
| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Library nicht Electron/esbuild-kompatibel | M | H | Vorab-Evaluation im Plugin-Kontext |
| Bundle-Groesse >10 MB | M | M | Tree-Shaking, lazy loading, Groessen-Audit |
| Review-Bot lehnt gebundelte Dependencies ab | L | H | Praezedenz pruefen, ggf. alternative Architektur |
| Output-Qualitaet unzureichend | M | H | Default-Styles, iteratives Tuning |
| Input-Schema zu komplex fuer LLM | M | M | Schema-Design mit Beispielen, Prompt-Guidance |
