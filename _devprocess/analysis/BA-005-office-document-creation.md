# Business Analysis: Office Document Creation Tools

> **Scope:** MVP
> **Erstellt:** 2026-03-06
> **Status:** Draft

---

## 1. Executive Summary

### 1.1 Problem Statement

Obsilo kann Office-Dokumente (PPTX, DOCX, XLSX, PDF) lesen und als Kontext bereitstellen (EPIC-006), aber nicht erzeugen. Versuche, die Erzeugung ueber die Sandbox (`evaluate_expression` mit npm-Paketen wie pptxgenjs) umzusetzen, sind gescheitert: Die Sandbox-Umgebung hat kein `Blob`, kein `Buffer`, kein DOM -- essenzielle APIs fuer binaere Dateierzeugung fehlen strukturell. Im konkreten Fall scheiterte eine PPTX-Erstellung nach ueber 20 Code-Executions, weil pptxgenjs intern Blob-APIs erwartet, die in der iframe-Sandbox nicht verfuegbar sind.

### 1.2 Proposed Solution

Vier dedizierte Built-in Tools (`create_pptx`, `create_docx`, `create_xlsx`, `create_pdf`), die direkt im Plugin-Kontext (Schicht 2) laufen. Der Agent uebergibt strukturierte Daten, das Tool erzeugt die Datei programmatisch mit vollem Node.js-Zugriff. Kein dynamisch generierter Code, keine Sandbox-Ausfuehrung.

### 1.3 Expected Outcomes

- Der Agent kann hochwertige Praesentationen, Dokumente, Tabellenkalkulationen und PDFs erzeugen
- Zuverlaessige Erzeugung in einem einzigen Tool-Call (statt 20+ fehlgeschlagene Sandbox-Versuche)
- Konsistentes Pattern analog zu bestehenden Built-in Tools (`create_excalidraw`, `generate_canvas`, `create_base`)
- Klare Rollentrennung: Sandbox fuer Kalkulationen/Batch-Operationen, Built-in Tools fuer binaere Formate

---

## 2. Business Context

### 2.1 Background

Obsilo ist ein AI-Agent-Plugin fuer Obsidian mit 30+ Tools fuer Vault-Management. Das Plugin kann bereits komplexe Formate programmatisch erzeugen (Canvas, Excalidraw, Base), liest Office-Formate (PPTX, XLSX, DOCX, PDF via `read_document`), kann aber keine Office-Dateien erstellen.

Die bestehende Sandbox-Architektur (ADR-021) definiert eine klare Abgrenzung:
- **Sandbox (Schicht 3):** Agent-generierter Code fuer Kalkulationen, Batch-Operationen, Datenanalyse
- **Built-in Tools (Schicht 2):** Reviewed Plugin-Code fuer Operationen, die Node.js APIs benoetigen

Im Glossar (GLOSSAR-begriffe.md) ist explizit dokumentiert: *"Fuer Faehigkeiten die Node.js APIs benoetigen (binaere Dateiformate), muessen Built-in Tools in Schicht 2 implementiert werden."*

### 2.2 Current State ("As-Is")

- Agent kann Office-Dateien **lesen** (`read_document`)
- Agent kann Office-Dateien **nicht erzeugen**
- Sandbox-basierte Erzeugung scheitert strukturell (fehlende Browser-APIs: Blob, Buffer, DOM)
- Der Agent-Mode-Prompt verweist auf npm-Pakete in der Sandbox (pptxgenjs, xlsx, pdf-lib), die in der Praxis nicht funktionieren
- Fuer PDF-Export existiert ein Workaround ueber `execute_recipe` (Pandoc), aber nur fuer Markdown-zu-PDF-Konvertierung

### 2.3 Desired State ("To-Be")

- Vier Built-in Tools (`create_pptx`, `create_docx`, `create_xlsx`, `create_pdf`) im Plugin-Kontext
- Agent uebergibt strukturierte JSON-Parameter, Tool erzeugt die Datei
- Full-Scale-Qualitaet: professionelle Praesentationen, formatierte Dokumente, korrekte Tabellenkalkulationen, saubere PDFs
- Output-Pfad frei waehlbar durch den Agent (basierend auf User-Anweisung, Memory-Konventionen oder eigenem Urteil)
- Agent-Prompts aktualisiert: Sandbox-Referenzen fuer binaere Dateien entfernt, Built-in Tools als primaerer Weg

### 2.4 Gap Analysis

| Luecke | Beschreibung |
|--------|-------------|
| Keine PPTX-Erzeugung | Praesentationen koennen nicht erstellt werden |
| Keine DOCX-Erzeugung | Word-Dokumente koennen nicht erstellt werden |
| Keine XLSX-Erzeugung | Tabellenkalkulationen koennen nicht erstellt werden |
| Keine native PDF-Erzeugung | PDFs nur ueber Pandoc-Workaround (Markdown-Konvertierung), nicht programmatisch |
| Falsche Sandbox-Referenzen | Agent-Prompts suggerieren Sandbox-Erzeugung, die in der Praxis scheitert |

---

## 3. Stakeholder Analysis

### 3.1 Stakeholder Map

| Stakeholder | Role | Interest | Influence | Needs |
|-------------|------|----------|-----------|-------|
| Sebastian Hanke | Entwickler + Primaer-User | H | H | Zuverlaessige Office-Erzeugung, professionelle Qualitaet |
| Obsilo-Enduser (kuenftig) | Endanwender | H | M | Einfache Nutzung via Chat, hochwertige Ergebnisse |
| Obsidian Community Plugin Review | Gatekeeper | L | H | Review-Bot-Compliance, keine verbotenen APIs |

### 3.2 Key Stakeholders

**Primary:** Sebastian Hanke (Entwickler, einziger Entscheider)
**Secondary:** Kuenftige Enduser (nach Community-Release)

---

## 4. User Analysis

### 4.1 User Personas

**Persona 1: Knowledge Worker**
- **Rolle:** Wissensarbeiter mit Obsidian als Haupt-Notiz-System
- **Ziele:** Aus Vault-Inhalten direkt Praesentationen, Reports und Tabellenkalkulationen erzeugen
- **Pain Points:** Manueller Export und Formatierung in separaten Programmen (PowerPoint, Word, Excel)
- **Nutzungshaeufigkeit:** Weekly

**Persona 2: Consultant/Freelancer**
- **Rolle:** Berater, der Wissen in Kunden-Deliverables umwandeln muss
- **Ziele:** Schnelle Erstellung professioneller Dokumente direkt aus dem Knowledge-Base
- **Pain Points:** Zeitaufwand fuer Format-Wechsel; inkonsistente Formatierung bei manuellem Copy-Paste
- **Nutzungshaeufigkeit:** Daily

---

## 5. Problem Analysis

### 5.1 Problem Statement (Detailed)

Die Sandbox-Architektur von Obsilo bietet eine isolierte Ausfuehrungsumgebung fuer Agent-generierten Code. Diese Umgebung hat bewusst keinen Zugriff auf Node.js APIs (Buffer, stream, fs) und Browser-APIs (Blob, DOM). Binaere Dateiformate wie OOXML (PPTX, DOCX, XLSX) und PDF benoetigen jedoch genau diese APIs fuer die Erzeugung von ZIP-Containern, XML-Serialisierung und Binaer-Streams.

### 5.2 Root Causes

1. **Architektur-Limitierung:** Die Sandbox ist auf Textverarbeitung und leichtgewichtige Operationen ausgelegt, nicht auf binaere Dateierzeugung
2. **Fehlende APIs:** `Blob`, `Buffer`, `JSZip`, DOM-basierte Rendering-Engines sind in der Sandbox nicht verfuegbar
3. **Library-Inkompatibilitaet:** npm-Pakete fuer Office-Formate (pptxgenjs, docx, exceljs) setzen Node.js- oder Browser-Globals voraus, die in der Sandbox fehlen
4. **Falsches Tool fuer den Job:** Die Sandbox ist fuer Kalkulationen/Batch-Operationen konzipiert, nicht fuer Format-Erzeugung

### 5.3 Impact

- **User Impact:** Feature-Wunsch "erstelle eine Praesentation" fuehrt zu frustrierenden, gescheiterten Versuchen (20+ Tool-Calls ohne Ergebnis)
- **Vertrauensverlust:** User erlebt den Agent als inkompetent, obwohl das Problem architektonischer Natur ist
- **Zeitverlust:** Manueller Workaround (Copy-Paste in PowerPoint/Word) konterkariert den Automatisierungsanspruch

---

## 6. Goals & Objectives

### 6.1 Business Goals

- Luecke "Lesen ja, Schreiben nein" bei Office-Formaten schliessen
- Differenzierungsmerkmal gegenueber anderen Obsidian-AI-Plugins (keines bietet native Office-Erzeugung)

### 6.2 User Goals

- "Erstelle eine Praesentation ueber X" -- fertige PPTX-Datei im Vault
- "Exportiere diese Tabelle als Excel" -- korrekte XLSX mit Daten und Formatierung
- "Schreibe einen Report als Word-Dokument" -- formatiertes DOCX mit Ueberschriften, Absaetzen, Listen
- "Erstelle ein PDF mit diesen Inhalten" -- sauberes A4-PDF mit Text und Layout

### 6.3 Success Metrics (KPIs)

| KPI | Baseline | Target | Timeframe |
|-----|----------|--------|-----------|
| Erfolgsrate Office-Erzeugung | 0% (scheitert immer) | >95% (ein Tool-Call genuegt) | Sofort nach Implementierung |
| Tool-Calls pro Erzeugung | 20+ (Sandbox-Versuche) | 1 (dediziertes Tool) | Sofort nach Implementierung |
| Format-Abdeckung Erzeugung | 0 von 4 Formaten | 4 von 4 (PPTX, DOCX, XLSX, PDF) | MVP-Release |
| Output-Qualitaet | N/A | Professionell nutzbar ohne Nachbearbeitung | MVP-Release |

---

## 7. Scope Definition

### 7.1 In Scope

- **create_pptx:** Praesentationen mit Slides, Text, Aufzaehlungen, Tabellen, Bildern, Styling (Farben, Fonts, Layout)
- **create_docx:** Word-Dokumente mit Ueberschriften, Absaetzen, Listen, Tabellen, Bildern, Formatierung
- **create_xlsx:** Tabellenkalkulationen mit Sheets, Daten, Formatierung, Formeln, Spaltenbreiten
- **create_pdf:** PDF-Dokumente (A4) mit Text, Ueberschriften, Absaetzen, Listen, Tabellen, Styling
- Tool-Registrierung in ToolRegistry, toolMetadata, builtinModes
- Agent-Prompt-Aktualisierung (Sandbox-Referenzen fuer binaere Dateien korrigieren)
- Output-Pfad frei waehlbar durch den Agent

### 7.2 Out of Scope

- **Template-System:** Keine User-definierten Templates (spaeteres Feature)
- **Bilder in PDFs:** Kein Bild-Embedding in PDF (Text-basiert im MVP)
- **Konvertierung zwischen Formaten:** Kein DOCX-zu-PDF, kein PPTX-zu-PDF (dafuer existiert Pandoc/execute_recipe)
- **Bearbeitung bestehender Dateien:** Kein "oeffne PPTX und aendere Folie 3" -- nur Neuerstellung
- **OCR/Scan-Integration:** Keine gescannten Dokumente
- **Macro/VBA-Support:** Keine Makros in DOCX/XLSX/PPTX

### 7.3 Assumptions

- npm-Pakete (pptxgenjs, docx, exceljs, pdf-lib) sind im Plugin-Kontext (Node.js/Electron) funktionsfaehig
- Die Pakete koennen als Dependencies im Plugin gebundelt werden (esbuild)
- Die Review-Bot-Regeln erlauben gebundelte npm-Dependencies
- Binaer-Dateien koennen ueber die Obsidian Vault API (`vault.createBinary()` o.ae.) geschrieben werden

### 7.4 Constraints

- **Review-Bot-Compliance:** Alle Obsidian Community Plugin Review-Bot-Regeln muessen eingehalten werden (kein `innerHTML`, kein `console.log`, kein `require()` etc.)
- **Bundle-Groesse:** npm-Dependencies erhoehen die Plugin-Groesse -- muss akzeptabel bleiben
- **Obsidian Vault API:** Binaer-Dateien muessen ueber die offizielle API geschrieben werden, nicht direkt ueber `fs`
- **Keine dynamische Code-Ausfuehrung:** Die Tools fuehren ausschliesslich reviewed Plugin-Code aus, keinen Agent-generierten Code

---

## 8. Risk Assessment

### 8.1 Identified Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Library nicht mit Electron/esbuild kompatibel | M | H | Vorab-Evaluation jeder Library im Plugin-Kontext |
| Bundle-Groesse explodiert (>10 MB) | M | M | Tree-Shaking, lazy loading, Groessen-Audit pro Library |
| Review-Bot lehnt gebundelte Dependencies ab | L | H | Praezedenz pruefen (andere Plugins mit npm-deps), ggf. alternative Architektur |
| Output-Qualitaet unzureichend (haessliche Praesentationen) | M | H | Sorgfaeltige Default-Styles, iteratives Tuning, User-Feedback |
| Input-Schema zu komplex fuer LLM | M | M | Schema-Design mit konkreten Beispielen, gute Prompt-Guidance |
| Vault-API unterstuetzt keine grossen Binaer-Dateien | L | H | Groessen-Limits dokumentieren, progressives Schreiben evaluieren |

---

## 9. Requirements Overview (High-Level)

### 9.1 Functional Requirements (Summary)

- Je ein Tool pro Format (create_pptx, create_docx, create_xlsx, create_pdf)
- Strukturierter JSON-Input (Slides/Paragraphs/Rows/Pages)
- Full-Scale Output-Qualitaet (professionell nutzbar)
- Freie Output-Pfad-Wahl durch den Agent
- Korrekte Binary-Dateierzeugung und Vault-Speicherung
- Integration in Tool-Registry, Metadata, Mode-Konfiguration

### 9.2 Non-Functional Requirements (Summary)

- **Performance:** Erzeugung einer 30-Folien-PPTX in < 10s
- **Zuverlaessigkeit:** >95% Erfolgsrate beim ersten Tool-Call
- **Bundle-Groesse:** Zusaetzliche Dependencies < 5 MB (komprimiert)
- **Kompatibilitaet:** Desktop (Electron) und Mobile (falls Libraries rein JS sind)

### 9.3 Key Features (fuer RE Agent)

| Priority | Feature | Description |
|----------|---------|-------------|
| P0 | create_pptx | Praesentationen mit Slides, Text, Listen, Tabellen, Bildern, Styling |
| P0 | create_docx | Word-Dokumente mit Ueberschriften, Absaetzen, Listen, Tabellen, Bildern |
| P0 | create_xlsx | Tabellenkalkulationen mit Sheets, Daten, Formatierung, Formeln |
| P0 | create_pdf | PDF-Dokumente (A4) mit Text, Ueberschriften, Listen, Tabellen, Styling |
| P1 | Agent-Prompt-Update | Sandbox-Referenzen fuer binaere Dateien korrigieren, Tool-Guidance einfuegen |
| P1 | Skill-Update | bundled-skills/sandbox-environment/SKILL.md aktualisieren -- Binary-Generation-Abschnitt ersetzen |

---

## 10. Next Steps

- [ ] Review durch Stakeholder (Sebastian)
- [ ] Uebergabe an Requirements Engineer -- Epics und Features definieren
- [ ] Library-Evaluation im Plugin-Kontext (Architect-Aufgabe, nicht BA)

---

## Appendix

### A. Glossar

| Begriff | Definition |
|---------|-----------|
| Built-in Tool | Von uns geschriebenes und reviewtes Tool, laeuft im Plugin-Kontext (Schicht 2) |
| Sandbox | Isolierte Laufzeitumgebung fuer Agent-generierten Code (Schicht 3) |
| OOXML | Office Open XML -- ZIP-basiertes Format fuer PPTX, DOCX, XLSX |
| Plugin-Kontext | Node.js-Laufzeitumgebung innerhalb des Obsidian-Plugins mit vollem API-Zugriff |
| SandboxBridge | Kontrollierte Schnittstelle zwischen Sandbox und Plugin (vault.read/write, requestUrl) |

### B. Interview Notes

- **Scope:** MVP (full-scale, voll einsatzbereit)
- **Namenskonvention:** `create_pptx`, `create_docx`, `create_xlsx`, `create_pdf` (analog zu `create_excalidraw`)
- **Output-Pfad:** Frei waehlbar durch Agent (basierend auf User-Anweisung, Memory-Konventionen oder eigenem Urteil)
- **Sandbox-Rolle bestaetigt:** Sandbox fuer Kalkulationen, Batch-Operationen, Datentransformation. Built-in Tools fuer binaere Dateiformate. Dokumentiert in: GLOSSAR-begriffe.md, toolDecisionGuidelines.ts, builtinModes.ts, FEATURE-0502-sandbox-os-isolation.md
- **Vorgeschichte:** PPTX-Erzeugung ueber Sandbox gescheitert (20+ Code Executions, Blob-API fehlt). Erkenntnis: Dediziertes Built-in Tool noetig.

### C. References

- `_devprocess/architecture/GLOSSAR-begriffe.md` -- Begriffsabgrenzung Tools/Skills/Sandbox
- `_devprocess/architecture/ADR-021-sandbox-os-isolation.md` -- Sandbox-Architektur-Entscheidung
- `_devprocess/analysis/security/ANALYSE-electron-browserwindow-sandbox-2026-03-02.md` -- Sandbox-Limitierungen
- `_devprocess/requirements/epics/EPIC-006-files-to-chat.md` -- Explizit: "Datei-Erzeugung separates Feature"
- `src/core/prompts/sections/toolDecisionGuidelines.ts` -- Regel 9: Built-in Tools First
- `src/core/modes/builtinModes.ts` -- Agent-Mode Sandbox-Guidance
- `bundled-skills/sandbox-environment/SKILL.md` -- Sandbox-API-Referenz mit bekannten Limitierungen

---

## Validierung

```
CHECK fuer MVP:

1. Business Context vollstaendig?                    [x]
2. Stakeholder Map vorhanden?                        [x]
3. Mind. 2 User Personas?                            [x]
4. KPIs mit Baseline + Target?                       [x]
5. In-Scope vs Out-of-Scope explizit?                [x]
6. Constraints dokumentiert?                          [x]
7. Risiken identifiziert?                             [x]
8. Key Features priorisiert (P0/P1/P2)?              [x]

Score: 8/8 -- RE-Ready
```
