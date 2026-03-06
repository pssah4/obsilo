# Plan Context: Files-to-Chat (Office-Format-Support)

> **Purpose:** Technische Zusammenfassung fuer Claude Code
> **Created by:** Architect Agent
> **Date:** 2026-03-05
> **Epic:** EPIC-006

---

## Technical Stack

**Bestehendes Projekt:**
- Language: TypeScript (strict)
- Framework: Obsidian Plugin API
- Build: esbuild mit Deploy-Plugin
- Runtime: Electron (via Obsidian)
- AI APIs: Anthropic SDK, OpenAI SDK

**Neue Dependencies:**
- JSZip (~30 KB): ZIP-Entpacken fuer OOXML-Formate (PPTX, XLSX, DOCX)
- pdfjs-dist (v4.4.168): bereits vorhanden, wird refactored

**Keine neue Dependency fuer:**
- JSON: natives `JSON.parse()`
- XML: nativer `DOMParser`
- CSV: Custom Parser (~100 Zeilen)

## Architecture Style

- Pattern: Hybrid Service-Kern + Tool-Wrapper (ADR-023)
- Bestehende Patterns werden wiederverwendet:
  - BaseTool + ToolRegistry (fuer neue Tools)
  - IDocumentParser Interface (neues Pattern, analog zu BaseTool)
  - DocumentParserRegistry (analog zu ToolRegistry)

## Key Architecture Decisions (ADR Summary)

| ADR | Title | Vorgeschlagene Entscheidung | Impact |
|-----|-------|-----------------------------|--------|
| ADR-023 | Document Parser als wiederverwendbare Tools | Hybrid: Service-Kern (DocumentParserRegistry) + Tool-Wrapper (ReadDocumentTool, ExtractDocumentImagesTool) | High |
| ADR-024 | Parsing-Library-Auswahl | JSZip + Custom OOXML Parser + pdfjs-dist (bestehend) + native APIs | High |
| ADR-025 | On-Demand Bild-Nachlade-Strategie | Lazy Extraction: Bilder erst bei Agent-Tool-Aufruf extrahieren | Medium |

**Detail pro ADR:**

1. **ADR-023 (Parser als Tools):** Parsing-Logik in eigenstaendigem Service-Modul (`src/core/document-parsers/`). Chat-Attachments rufen den Service direkt auf (Performance). Agent nutzt Tool-Wrapper (`read_document`, `extract_document_images`) in der ToolRegistry. SideView-Monolith wird NICHT erweitert.
   - Rationale: Wiederverwendbarkeit in jedem Agent-Kontext (Chat, Sub-Task, jeder Mode)

2. **ADR-024 (Library-Auswahl):** JSZip (~30 KB) als einzige neue Dependency. OOXML-Parsing ueber custom Parser die JSZip + nativen DOMParser nutzen. pdfjs-dist bleibt fuer PDF (bereits im Projekt). JSON/XML/CSV ohne externe Libraries.
   - Rationale: Minimale Bundle-Vergroesserung, Sandbox-kompatibel, Review-Bot-konform

3. **ADR-025 (Bild-Nachlade):** Beim initialen Parsing werden nur Bild-Metadaten erfasst (Dateiname, Folie, Groesse). Bilder werden erst extrahiert wenn der Agent das Tool `extract_document_images` aufruft. System Prompt definiert wann der Agent Bilder nachladen soll.
   - Rationale: Token-Effizienz (nur ~30% der Faelle brauchen Bilder)

## Neue Module und Dateien

### Service-Schicht (Document Parsers)

```
src/core/document-parsers/
  DocumentParserRegistry.ts    -- Map<Extension, IDocumentParser>, parse(path, data) Dispatcher
  types.ts                     -- IDocumentParser, ParseResult, ParserOptions, ImageMetadata
  parsers/
    PptxParser.ts              -- JSZip + DOMParser, Folien-Text + Bild-Metadaten
    XlsxParser.ts              -- JSZip + DOMParser, Sheet-Tab-Struktur
    DocxParser.ts              -- JSZip + DOMParser, Absaetze + Ueberschriften
    PdfParser.ts               -- pdfjs-dist (Refactoring aus SemanticIndexService.ts:963-1023)
    DataFormatParser.ts        -- JSON (JSON.parse), XML (DOMParser), CSV (custom RFC 4180)
```

### Tool-Wrapper

```
src/core/tools/vault/
  ReadDocumentTool.ts          -- Tool "read_document": Agent parsed ein Dokument aus dem Vault
  ExtractDocumentImagesTool.ts -- Tool "extract_document_images": Agent laedt Bilder nach (Vision-Gate)
```

### UI-Aenderungen (minimal, NICHT im SideView-Monolithen)

```
src/ui/sidebar/AttachmentHandler.ts  -- processFile() erweitern: Office-Formate -> DocumentParserRegistry
src/ui/sidebar/VaultFilePicker.ts    -- getMarkdownFiles() -> getFiles() mit Typ-Filter
```

### Type-Erweiterungen

```
src/core/tools/types.ts   -- ToolName Union: + "read_document" | "extract_document_images"
src/api/types.ts           -- ModelInfo: + supportsVision: boolean
```

## Bestehende Dateien die geaendert werden

| Datei | Aenderung | Risiko |
|-------|-----------|--------|
| `src/ui/sidebar/AttachmentHandler.ts` | processFile() erweitern fuer Office-Formate, input.accept Filter anpassen | Low |
| `src/ui/sidebar/VaultFilePicker.ts` | getMarkdownFiles() -> getFiles() mit Extension-Filter | Low |
| `src/core/tools/ToolRegistry.ts` | Import + Registration von ReadDocumentTool, ExtractDocumentImagesTool | Low |
| `src/core/tools/types.ts` | ToolName Union erweitern | Low |
| `src/core/semantic/SemanticIndexService.ts` | extractPdfText() -> delegiert an PdfParser (Refactoring) | Medium |
| `src/api/types.ts` | ModelInfo + supportsVision Feld | Low |
| `src/core/prompts/sections/` | Power Steering fuer Bild-Nachlade | Low |
| `src/core/tools/toolMetadata.ts` | Metadata fuer read_document, extract_document_images | Low |

## Bestehende Dateien die NICHT geaendert werden

| Datei | Grund |
|-------|-------|
| `src/ui/AgentSidebarView.ts` | Monolith (3.200 Zeilen) -- KEINE Aenderungen, neue Logik in eigene Module |
| `src/core/AgentTask.ts` | Tool-Execution laeuft ueber bestehende Pipeline, keine AgentTask-Aenderung |
| `src/core/tool-execution/ToolExecutionPipeline.ts` | Bestehende Pipeline reicht fuer neue Tools |
| `sandbox-worker.js` | Parsing laeuft im Main Thread (nicht in der Sandbox) |

## PDF-Refactoring (Kritischer Pfad)

Der bestehende Code in `SemanticIndexService.ts:963-1023` muss in einen eigenstaendigen PdfParser extrahiert werden:

**Vorher (SemanticIndexService):**
- `extractPdfText(filePath: string)` liest via `fs.promises.readFile`
- Direkt im SemanticIndexService eingebettet
- Fake-worker Modus, `disableAutoFetch: true`, `isEvalSupported: false`

**Nachher (PdfParser):**
- `PdfParser.parse(data: ArrayBuffer): Promise<ParseResult>` -- eigenstaendiges Modul
- SemanticIndexService ruft `PdfParser.parse()` auf (delegiert, keine Code-Duplikation)
- Gleicher fake-worker Modus bleibt erhalten
- Input aendert sich von `fs.promises.readFile` zu `ArrayBuffer` (universeller)

## Performance & Security

**Performance (NFR-Targets aus FEATURE-0601):**
- PPTX-Parsing (30 Folien): < 5.000ms (Ziel < 1.000ms)
- XLSX-Parsing (10 Sheets, je 1.000 Zeilen): < 3.000ms
- DOCX-Parsing (100 Seiten): < 2.000ms
- PDF-Parsing (100 Seiten): < 5.000ms
- Bild-Extraktion (einzeln): < 500ms
- Token-Schaetzung: < 100ms
- Memory Peak waehrend Parsing: < 200 MB zusaetzlich

**Security:**
- ZIP-Bomb-Protection: Max. Decompressed Size pruefen (500 MB Limit)
- Path Traversal: ZIP-Eintraege mit `../` oder absoluten Pfaden ablehnen
- Input Validation: Magic Bytes pruefen (ZIP: `PK\x03\x04`, PDF: `%PDF-`)
- Lokale Verarbeitung: Keine Rohdateien an externe Services

**Compliance (Review-Bot):**
- Kein `fetch()`, kein `innerHTML`, kein `console.log`, kein `require()`
- Keine `any`-Types (-> `unknown` + Type Guards)
- `vault.adapter.readBinary()` statt `fs.promises.readFile` fuer Vault-Dateien
- CSS-Klassen statt inline styles

## Wiring-Pattern (How to integrate)

Neue Module folgen das bestehende Wiring-Pattern:
1. Parser-Dateien erstellen in `src/core/document-parsers/parsers/`
2. In DocumentParserRegistry registrieren (Extension -> Parser Map)
3. Tool-Dateien erstellen in `src/core/tools/vault/`
4. In ToolRegistry importieren und registrieren
5. ToolName-Union in types.ts erweitern
6. Tool-Metadata in toolMetadata.ts eintragen
7. In Mode-Definitionen einhaengen (vault-read Gruppe)

## Implementation Priorities

| Phase | Features | Abhaengigkeiten |
|-------|----------|-----------------|
| 1 | FEATURE-0601 (Parser Pipeline) + FEATURE-0602 (File Picker) | Keine -- Basis fuer alles |
| 2 | FEATURE-0603 (Token-Budget) + FEATURE-0605 (Model-Compat) | Phase 1 |
| 3 | FEATURE-0604 (Bild-Extraktion) | Phase 1 + Phase 2 (supportsVision) |

---

## Kontext-Dokumente fuer Claude Code

Claude Code sollte folgende Dokumente als Kontext lesen:

1. `_devprocess/architecture/ADR-023-document-parser-tools.md` (Service-Kern + Tool-Wrapper)
2. `_devprocess/architecture/ADR-024-parsing-library-selection.md` (Library-Auswahl)
3. `_devprocess/architecture/ADR-025-on-demand-image-strategy.md` (Bild-Nachlade)
4. `_devprocess/requirements/features/FEATURE-0601-document-parsing-pipeline.md` (P0)
5. `_devprocess/requirements/features/FEATURE-0602-file-picker-extension.md` (P0)
6. `_devprocess/requirements/features/FEATURE-0603-token-budget-management.md` (P1)
7. `_devprocess/requirements/features/FEATURE-0604-on-demand-image-extraction.md` (P1)
8. `_devprocess/requirements/features/FEATURE-0605-model-compatibility-check.md` (P1)
9. `_devprocess/requirements/epics/EPIC-006-files-to-chat.md`

**Bestehende Code-Referenzen (zum Lesen VOR Implementierung):**
- `src/ui/sidebar/AttachmentHandler.ts` (Integrationspunkt File Picker)
- `src/ui/sidebar/VaultFilePicker.ts` (Integrationspunkt Vault Picker)
- `src/core/semantic/SemanticIndexService.ts:963-1023` (PDF-Code zum Refactoren)
- `src/core/tools/BaseTool.ts` (Tool-Pattern)
- `src/core/tools/ToolRegistry.ts` (Tool-Registration)
- `src/core/tools/types.ts` (ToolName Union)
- `src/core/tools/toolMetadata.ts` (Tool-Beschreibungen)
- `src/api/types.ts` (ContentBlock, ModelInfo)
