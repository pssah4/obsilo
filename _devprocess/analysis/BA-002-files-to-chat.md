# Business Analysis: Files-to-Chat (Office-Format-Support)

> **Scope:** MVP (C)
> **Erstellt:** 2026-03-05
> **Status:** Draft
> **Branch:** add-files-to-chat

---

## 1. Executive Summary

### 1.1 Problem Statement
Obsilo unterstützt beim Dateianhang im Chat aktuell nur Bilder (PNG/JPG/GIF/WebP) und Textdateien. Office- und Datenformate (PowerPoint, Excel, Word, PDF, JSON, XML, CSV), die im beruflichen Alltag den Großteil der Informationsträger ausmachen, sind im OS File Picker ausgegraut und können nicht ausgewählt werden. Der Agent kann dadurch nicht in den vollständigen Arbeitsworkflow integriert werden.

### 1.2 Proposed Solution
Erweiterung des Attachment-Systems um lokales Parsing gängiger Office- und Datenformate. Dateien werden client-seitig in Text und (bei Bedarf) Bilder konvertiert und als strukturierter Kontext an die API übergeben. Der Agent verarbeitet die extrahierten Inhalte wie gewohnt und kann darauf basierend neue Inhalte generieren, zusammenfassen oder analysieren.

### 1.3 Expected Outcomes
- Alle gängigen Office- und Datenformate können per Büroklammer (OS File Picker) angehängt werden
- Der Agent versteht Struktur und Kernaussagen der angehängten Dateien (>= 95% Genauigkeit)
- Eingebettete Bilder in Präsentationen werden bei Bedarf als visueller Kontext mitgegeben
- Performance: Parsing innerhalb von maximal 5 Sekunden (Ziel: ~1 Sekunde)
- Keine externen Services nötig -- lokales Parsing im Plugin

---

## 2. Business Context

### 2.1 Background
Obsilo ist ein Obsidian Plugin mit Agent-Funktionalität (30+ Tools). Der Agent unterstützt Vault-Management, Semantic Search, Canvas-Generierung und Multi-Agent-Orchestrierung. Die Chat-basierte Interaktion ist die primäre Schnittstelle.

### 2.2 Current State ("As-Is")
- **Büroklammer (AttachmentHandler):** Nativer OS File Picker mit restriktivem `input.accept`-Filter -- Office-Formate sind ausgegraut und nicht auswählbar (src/ui/sidebar/AttachmentHandler.ts:34)
- **Vault-Button (VaultFilePicker):** Zeigt nur Markdown-Dateien (getMarkdownFiles() in src/ui/sidebar/VaultFilePicker.ts:176)
- **ContentBlock-Typen:** Nur text, image, tool_use, tool_result (src/api/types.ts:36-40)
- Kein Parsing oder Konvertierung binärer Formate implementiert
- JSON, XML, CSV sind technisch als Textdateien bereits unterstützt, aber nicht als strukturierte Datenformate verarbeitet

### 2.3 Desired State ("To-Be")
- Nutzer wählt beliebige Office- oder Datendatei im OS File Picker oder Vault File Picker
- Plugin parsed die Datei lokal (schnell, ohne externe Services)
- Extrahierter Text und Struktur wird als Kontext an den Agent übergeben
- Bei Bedarf (PowerPoint-Grafiken) werden eingebettete Bilder zusätzlich übergeben
- Agent entscheidet intelligent, ob er visuellen Kontext anfordern muss
- Bei Überschreitung des Token-Budgets wird der Nutzer informiert
- Wenn ein Modell bestimmte Features nicht unterstützt (z.B. kein Vision), wird dem Nutzer ein Hinweis mit Modell-Empfehlung gegeben

### 2.4 Gap Analysis

| Bereich | As-Is | To-Be | Gap |
|---------|-------|-------|-----|
| Datei-Typen | Bilder + Text | + PPTX, XLSX, DOCX, PDF, JSON, XML, CSV | Parsing-Pipeline fehlt |
| File Picker | Restriktiver Accept-Filter (Office ausgegraut) | Erweitert um Office- und Datenformate | Filter-Erweiterung |
| Vault Picker | Nur .md | Alle unterstützten Formate | Filter-Erweiterung |
| Content-Verarbeitung | Text direkt, Bilder als base64 | + strukturierte Extraktion | Konverter-Schicht fehlt |
| Token-Management | Kein Limit-Check | Intelligentes Limit pro Modell | Token-Budget-Logik fehlt |
| Bilder in Dokumenten | Nicht unterstützt | On-Demand Extraktion | Bild-Extraktion fehlt |

---

## 3. Stakeholder Analysis

### 3.1 Stakeholder Map

| Stakeholder | Role | Interest | Influence | Needs |
|-------------|------|----------|-----------|-------|
| Sebastian (Owner) | Entwickler & Primärnutzer | H | H | Vollständige Workflow-Integration mit Office-Dateien |
| Obsidian Community | Plugin-Nutzer | H | M | Zuverlässiges, performantes Feature |
| Obsidian Review-Bot | Gatekeeper (Plugin Store) | M | H | Compliance mit Plugin-Richtlinien |
| AI Provider (Claude, OpenAI) | API-Backend | L | H | Korrekte API-Nutzung, Token-Limits |

### 3.2 Key Stakeholders

**Primary:** Sebastian -- Entwickler, Primärnutzer, Entscheider
**Secondary:** Obsidian Community (repräsentiert durch Sebastians eigene Anforderungen)

---

## 4. User Analysis

### 4.1 User Personas

**Persona 1: Knowledge Worker (Sebastian)**
- **Rolle:** Berufstätig, arbeitet täglich mit Office-Dokumenten
- **Ziele:** Office-Dateien als Kontext für den Agent nutzen, Inhalte zusammenfassen, Daten analysieren, neue Inhalte generieren
- **Pain Points:** Muss aktuell Inhalte manuell kopieren oder abtippen; Agent ist vom Office-Workflow abgeschnitten
- **Nutzungshäufigkeit:** Daily
- **Typische Formate:** PowerPoint (sehr häufig, Hauptkommunikationsmedium im Unternehmen), Excel (häufig, Daten/Kalkulationen/Strukturierung), Word/PDF (regelmäßig)

**Persona 2: Community Power User**
- **Rolle:** Obsidian-Nutzer mit AI-Interesse
- **Ziele:** Agent mit externen Dokumenten füttern, Recherche-Ergebnisse verarbeiten
- **Pain Points:** Gleiche Limitierungen wie Persona 1
- **Nutzungshäufigkeit:** Weekly

### 4.2 User Journey (High-Level)
1. User hat eine Office-Datei (z.B. Strategie-Präsentation als .pptx)
2. User klickt Büroklammer im Chat -> OS File Picker öffnet sich
3. User wählt die Datei aus
4. Plugin parsed die Datei lokal, zeigt Attachment-Chip an
5. User gibt Prompt ein (z.B. "Fasse die Kernaussagen zusammen")
6. Agent erhält extrahierten Text + Struktur als Kontext
7. Agent erstellt gewünschten Output (Zusammenfassung als Obsidian Note)
8. Optional: Agent fordert eingebettete Bilder nach, falls der Text allein nicht ausreicht

---

## 5. Problem Analysis

### 5.1 Problem Statement (Detailed)
Im beruflichen Umfeld wird überwiegend über PowerPoint kommuniziert, Daten in Excel strukturiert und Dokumente als Word/PDF geteilt. Obsilo kann diese Dateien weder öffnen noch verarbeiten. Der Agent ist damit von einem Großteil des täglichen Informationsflusses abgeschnitten. Der Nutzer muss Inhalte manuell kopieren oder Screenshots erstellen -- ein Workflow-Bruch, der die Produktivität reduziert und den Nutzen des Agents fundamental einschränkt.

### 5.2 Root Causes
1. **AttachmentHandler** hat einen restriktiven `input.accept`-Filter -- Office-Formate sind im Finder ausgegraut
2. **Kein Parsing** für binäre Formate implementiert (OOXML, PDF)
3. **VaultFilePicker** filtert auf `getMarkdownFiles()` -- keine anderen Dateitypen sichtbar
4. **ContentBlock-Typ** kennt nur text und image -- keine spezielle Dokument-Struktur

### 5.3 Impact
- **Business Impact:** Agent kann nicht für zentrale Arbeitsaufgaben genutzt werden (Präsentation vorbereiten, Daten analysieren, Dokumente zusammenfassen)
- **User Impact:** Workflow-Bruch, manuelle Arbeit nötig, Agent wird als unvollständig wahrgenommen

---

## 6. Goals & Objectives

### 6.1 Business Goals
- Obsilo als vollständig in den Office-Workflow integrierbaren AI-Agenten positionieren
- Alleinstellungsmerkmal gegenüber anderen Obsidian AI-Plugins schaffen
- Community-Adoption erhöhen durch praktischen Alltagsnutzen

### 6.2 User Goals
- Jede gängige Office-Datei per Büroklammer oder File Picker in den Chat geben
- Agent versteht Kontext und Struktur der Datei zuverlässig
- Schnelles Parsing ohne merkbare Verzögerung im Workflow

### 6.3 Success Metrics (KPIs)

| KPI | Baseline | Target | Timeframe |
|-----|----------|--------|-----------|
| Unterstützte Formate | 2 (Bilder, Text) | 9 (+ PPTX, XLSX, DOCX, PDF, JSON, XML, CSV) | MVP |
| Parsing-Dauer (30 Folien PPTX) | nicht möglich | <= 5 Sekunden | MVP |
| Inhalts-Genauigkeit | nicht möglich | >= 95% | MVP |
| Fehlerrate bei Datei-Verarbeitung | 100% (rejected) | < 1% | MVP |
| Review-Bot Compliance | n/a | 100% | MVP |

---

## 7. Scope Definition

### 7.1 In Scope
- **PowerPoint (.pptx):** Text-Extraktion mit Folienstruktur (Titel, Aufzählungen, Sprechernotizen), eingebettete Bilder on-demand extrahierbar
- **Excel (.xlsx):** Zellwerte, Sheet-Struktur, Tabellen als Text/Markdown
- **Word (.docx):** Text mit Struktur (Überschriften, Absätze, Listen)
- **PDF:** Text-Extraktion (text-basierte PDFs)
- **Datenformate (.json, .xml, .csv):** Strukturierte Verarbeitung als Tabellen bzw. formatierter Text
- **Bilder:** Bereits implementiert (base64), keine Änderung nötig
- **OS File Picker:** Erweiterung des `input.accept`-Filters
- **Vault File Picker:** Erweiterung über `getMarkdownFiles()` hinaus
- **Token-Budget-Management:** Intelligentes Limit basierend auf Context Window des aktiven Modells
- **Modell-Kompatibilitäts-Hinweis:** Warnung + Empfehlung wenn Modell Feature nicht unterstützt (z.B. kein Vision)
- **Review-Bot-Compliance:** Alle Änderungen konform mit Obsidian Plugin Review-Bot Regeln
- **Sandbox-Kompatibilität:** Parsing muss innerhalb der Obsidian/Electron-Sandbox funktionieren

### 7.2 Out of Scope
- **Datei-Erzeugung:** Kein Erstellen von PPTX, XLSX, DOCX (separates Feature)
- **E-Mail-Formate (.msg, .eml):** Separates Feature
- **Visio-Dateien:** Separates Feature
- **OCR für gescannte PDFs:** Nur text-basierte PDFs im MVP
- **Drag-and-Drop auf Chat:** Nice-to-have, nicht MVP-kritisch
- **Cloud-Storage-Integration:** Dateien müssen lokal vorliegen

### 7.3 Assumptions
- Parsing-Libraries existieren, die in Electron/Obsidian-Sandbox laufen (kein nativer Code nötig)
- OOXML-Formate (PPTX/XLSX/DOCX) sind im Kern ZIP-Archive mit XML -- Parsing ist ohne Systemabhängigkeiten möglich
- PDF-Text-Extraktion ist ohne externe Services machbar (reine JS-Library)
- Das Context Window moderner Modelle (100k-200k Tokens) reicht für die meisten Dokumente
- Eingebettete Bilder in PPTX können als base64 extrahiert und als image-ContentBlock weitergegeben werden

### 7.4 Constraints
- **Obsidian Review-Bot:** Kein fetch() (nur requestUrl), kein innerHTML, kein console.log, kein require() (außer Electron), keine any-Types
- **Sandbox:** Kein Zugriff auf Systemtools (kein Aufruf von LibreOffice, pdftk, etc.)
- **Bundlegröße:** Parsing-Libraries müssen bundle-freundlich sein (kein 50MB-Dependency)
- **Performance:** Parsing muss < 5 Sekunden dauern (Ziel ~1s)
- **Token-Limit:** Extrahierter Inhalt darf Context Window nicht sprengen
- **Lokale Verarbeitung:** Keine Rohdateien an externe Services senden

---

## 8. Risk Assessment

### 8.1 Identified Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Parsing-Library nicht sandbox-kompatibel | M | H | Vorab-Evaluation, ggf. eigenes Parsing auf ZIP+XML-Basis |
| Bundlegröße durch Libraries zu groß | M | M | Tree-Shaking, nur minimal nötige Module importieren |
| PDF-Parsing ungenau (komplexe Layouts) | M | M | Auf text-basierte PDFs beschränken, Layout-PDFs als Bild |
| Token-Budget durch große Dateien überschritten | H | M | Intelligentes Truncation mit User-Warnung |
| PPTX-Grafiken tragen Info, Text-Extraktion reicht nicht | H | H | Bild-Extraktion on-demand, Agent entscheidet über Nachlade-Bedarf |
| Performance bei sehr großen Dateien (100+ Seiten) | M | M | Streaming/chunked Parsing, Progress-Anzeige |
| Review-Bot lehnt Library-Patterns ab | L | H | Compliance-Check vor Integration, Wrapper wo nötig |

---

## 9. Requirements Overview (High-Level)

### 9.1 Functional Requirements (Summary)
- Erweiterte Datei-Akzeptanz im OS File Picker und Vault File Picker
- Lokale Parsing-Pipeline für PPTX, XLSX, DOCX, PDF, JSON, XML, CSV
- Strukturierte Text-Extraktion (nicht Plaintext-Dump, sondern Folien/Sheets/Kapitel)
- Eingebettete Bild-Extraktion (on-demand, für PPTX)
- Token-Budget-Berechnung basierend auf aktivem Modell
- Modell-Kompatibilitäts-Check mit User-Hinweis
- Chip-Anzeige für angehängte Office-Dateien mit Format-Icon

### 9.2 Non-Functional Requirements (Summary)
- **Performance:** < 5s Parsing für 30-Folien PPTX, Ziel ~1s
- **Genauigkeit:** >= 95% der Kernaussagen korrekt erfasst
- **Compliance:** Obsidian Review-Bot konform
- **Sandbox:** Läuft komplett innerhalb Electron/Obsidian
- **Bundle:** Zusätzliche Dependencies < 5 MB (komprimiert)
- **Sicherheit:** Keine Rohdateien an externe Services, lokales Parsing

### 9.3 Key Features (für RE Agent)

| Priority | Feature | Description |
|----------|---------|-------------|
| P0 | PPTX-Parsing | Text + Struktur + eingebettete Bilder (on-demand) extrahieren |
| P0 | XLSX-Parsing | Zellwerte + Sheet-Struktur als Markdown-Tabellen |
| P0 | DOCX-Parsing | Text + Überschriften-Struktur extrahieren |
| P0 | PDF-Parsing | Text-Extraktion aus text-basierten PDFs |
| P0 | File Picker Erweiterung | OS File Picker und Vault Picker akzeptieren Office-Formate |
| P1 | Token-Budget-Management | Intelligentes Limit basierend auf Modell Context Window |
| P1 | Modell-Kompatibilitäts-Check | Warnung + Empfehlung bei fehlendem Vision-Support |
| P1 | On-Demand Bild-Nachlade | Agent entscheidet ob er Bilder aus PPTX braucht |
| P2 | Progress-Anzeige | Feedback während Parsing großer Dateien |
| P2 | Format-spezifische Chip-Icons | Unterschiedliche Icons für PPTX/XLSX/DOCX/PDF |

---

## 10. Next Steps

- [ ] Review durch Sebastian
- [ ] Übergabe an Requirements Engineer: Epics & Features definieren
- [ ] Technische Evaluation: Parsing-Libraries für Sandbox identifizieren
- [ ] Architektur-Entscheidung: Parsing-Pipeline Design (ADR)

---

## Appendix

### A. Glossar

| Begriff | Definition |
|---------|-----------|
| OOXML | Office Open XML -- das ZIP+XML-Format hinter .pptx, .xlsx, .docx |
| Context Window | Maximale Token-Anzahl die ein AI-Modell pro Request verarbeiten kann |
| On-Demand | Bilder werden nur dann extrahiert und mitgesendet, wenn der Agent entscheidet, dass der Text allein nicht ausreicht |
| Review-Bot | Automatisierter Prüf-Bot für Obsidian Community Plugins |
| Sandbox | Eingeschränkte Ausführungsumgebung innerhalb von Electron/Obsidian |

### B. Interview Notes

**Scope-Entscheidung:** MVP (C) -- vollständig nutzbar im Alltag, produktionsreif

**Kern-Einsichten:**
- PowerPoint ist das Hauptkommunikationsmedium im Unternehmen
- Grafiken in PPTX tragen eigenständige Information (nicht redundant zum Text)
- Reines Text-Extrahieren reicht bei PPTX nicht -- Bilder müssen verfügbar sein
- Excel: Zellwerte ausreichend, Agent kann über Sandbox eigene Analyse-Tools bauen
- Text-first Strategie: Erst Text extrahieren, Bilder nur on-demand nachreichen
- Agent soll selbst entscheiden ob visueller Kontext nötig ist (kein Halluzinationsrisiko)
- Qualitätsanspruch hoch (>= 95%) -- Entscheidungen basieren auf extrahierten Inhalten
- Review-Bot Compliance und Sandbox-Kompatibilität sind harte Constraints

### C. Code-Referenzen (As-Is)

| Datei | Relevanz |
|-------|----------|
| src/ui/sidebar/AttachmentHandler.ts | File Picker Filter (Zeile 34), Processing (Zeile 45-83), Unsupported-Ablehnung (Zeile 78) |
| src/ui/sidebar/VaultFilePicker.ts | Vault-Dateien nur Markdown (Zeile 176) |
| src/api/types.ts | ContentBlock-Definition (Zeile 36-40), ImageMediaType (Zeile 34) |
| src/ui/AgentSidebarView.ts | Attach-Button Wiring (Zeile 345), Vault-Button (Zeile 354) |
