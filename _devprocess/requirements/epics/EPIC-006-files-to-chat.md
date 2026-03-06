# Epic: Files-to-Chat (Office-Format-Support)

> **Epic ID**: EPIC-006
> **Phase**: F
> **Business Alignment**: _devprocess/analysis/BA-002-files-to-chat.md
> **Scope**: MVP

## Epic Hypothesis Statement

FÜR Knowledge Worker und Obsidian Power User
DIE täglich mit Office-Dokumenten arbeiten und diese als Kontext für den AI-Agent nutzen wollen
IST Files-to-Chat
EIN Dokument-Parsing- und Kontext-Integrations-Feature
DAS Office- und Datenformate direkt im Chat als Kontext bereitstellt
IM GEGENSATZ ZU manuellem Copy-Paste oder Screenshot-basiertem Arbeiten
UNSERE LÖSUNG extrahiert Inhalte lokal, strukturiert und performant -- mit intelligentem Token-Budget und On-Demand-Bildern

## Business Outcomes (messbar)

1. **Format-Abdeckung**: Unterstützte Anhang-Formate steigt von 2 (Bilder, Text) auf 9 (+ PPTX, XLSX, DOCX, PDF, JSON, XML, CSV) innerhalb MVP
2. **Workflow-Integration**: 100% der gängigen Office-Dateien können ohne Workaround dem Chat hinzugefügt werden
3. **Inhalts-Genauigkeit**: >= 95% der Kernaussagen aus angehängten Dokumenten korrekt erfasst

## Leading Indicators (Frühindikatoren)

- **Parsing-Erfolgsrate**: Anteil erfolgreich verarbeiteter Dateien (Ziel: > 99%)
- **Parsing-Performance**: Durchschnittliche Verarbeitungsdauer pro Datei (Ziel: < 5s für 30-Folien PPTX)
- **User-Vertrauen**: Nutzer trifft Entscheidungen basierend auf Agent-Output ohne Rückprüfung am Originaldokument

## MVP Features

| Feature ID | Name | Priority | Effort | Status |
|------------|------|----------|--------|--------|
| FEATURE-0601 | Document Parsing Pipeline | P0-Critical | L | Implementiert |
| FEATURE-0602 | File Picker Erweiterung | P0-Critical | S | Implementiert |
| FEATURE-0603 | Token-Budget-Management | P1-High | M | Geplant |
| FEATURE-0604 | On-Demand Bild-Extraktion | P1-High | M | Geplant |
| FEATURE-0605 | Modell-Kompatibilitäts-Check | P1-High | S | Geplant |

**Priority Legend:**
- P0-Critical: Ohne geht MVP nicht
- P1-High: Wichtig für vollständige User Experience
- P2-Medium: Wertsteigernd, aber nicht essentiell

**Effort:** S (1-2 Sprints), M (3-5 Sprints), L (6+ Sprints)

## Explizit Out-of-Scope

- **Datei-Erzeugung**: Kein Erstellen von PPTX/XLSX/DOCX -- separates Feature
- **E-Mail-Formate (.msg, .eml)**: Andere Parsing-Anforderungen, geplant für spätere Phase
- **Visio-Dateien**: Spezialisiertes Format, geringe Priorität
- **OCR für gescannte PDFs**: Nur text-basierte PDFs im MVP
- **Drag-and-Drop auf Chat**: UX-Verbesserung, nicht MVP-kritisch
- **Cloud-Storage-Integration**: Dateien müssen lokal vorliegen

## Dependencies & Risks

### Dependencies
- **Parsing-Libraries**: Geeignete JS-Libraries für OOXML und PDF müssen sandbox-kompatibel sein. Blockiert FEATURE-0601 wenn keine geeignete Library gefunden wird.
- **Obsidian Plugin Review-Bot**: Compliance muss für alle Libraries sichergestellt sein. Blockiert Release.

### Risks
| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Parsing-Library nicht sandbox-kompatibel | M | H | Vorab-Evaluation, ggf. eigenes Parsing auf ZIP+XML-Basis |
| Bundlegröße durch Libraries zu groß | M | M | Tree-Shaking, nur minimal nötige Module importieren |
| PDF-Parsing ungenau (komplexe Layouts) | M | M | Auf text-basierte PDFs beschränken, Layout-PDFs als Bild |
| Token-Budget durch große Dateien überschritten | H | M | Intelligentes Truncation mit User-Warnung |
| PPTX-Grafiken tragen Info, Text-Extraktion reicht nicht | H | H | Bild-Extraktion on-demand, Agent entscheidet über Nachlade-Bedarf |
| Review-Bot lehnt Library-Patterns ab | L | H | Compliance-Check vor Integration, Wrapper wo nötig |
