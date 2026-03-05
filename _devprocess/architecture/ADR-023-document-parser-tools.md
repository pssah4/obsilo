# ADR-023: Document Parser als wiederverwendbare Tools

**Status:** Proposed
**Date:** 2026-03-05
**Deciders:** Sebastian (Owner), Claude Code (Implementierung)

## Context

Obsilo braucht die Faehigkeit, Office- und Datenformate (PPTX, XLSX, DOCX, PDF, JSON, XML, CSV) zu verarbeiten. Die BA fordert zwei Nutzungskontexte:

1. **Chat-Attachments:** Nutzer haengt Datei an -> automatisches Parsing -> Text als Kontext
2. **Agent-initiiert:** Agent liest proaktiv Dateien aus dem Vault (z.B. "Analysiere die Excel X")

Der bestehende Code hat bereits PDF-Parsing in `SemanticIndexService.ts:963` -- allerdings tief vergraben im Indexing-Code und nicht wiederverwendbar.

**Architektur-Problem:**
- `AgentSidebarView.ts` ist ein 3.200-Zeilen-Monolith -- neue Funktionalitaet darf ihn nicht weiter aufblaehen
- Parsing-Logik darf nicht an den Chat-View gekoppelt sein (Wiederverwendbarkeit)
- Bestehende Tool-Architektur (BaseTool + ToolRegistry) bietet ein erprobtes Pattern

**Triggering ASRs:**
- ASR-1: Sandbox-Kompatibilitaet (Critical)
- ASR-2: Parser-Erweiterbarkeit (Critical)

## Decision Drivers

- **Modularitaet:** SideView-Monolith nicht vergroessern
- **Wiederverwendbarkeit:** Parser in jedem Agent-Kontext nutzbar (Chat, Sub-Task, anderer Mode)
- **Performance:** Parsing muss schnell und non-blocking sein
- **Erweiterbarkeit:** Neue Formate ohne Architekturaenderung
- **Bestehende Patterns:** Konsistenz mit Tool-Registry und BaseTool-Architektur

## Considered Options

### Option 1: Parser als Agent-Tools (in Tool-Registry)
Document Parser werden als regulaere Tools implementiert (read_document + extract_document_images), registriert in der ToolRegistry, nutzbar durch den Agent in jedem Kontext.

- Pro: Agent kann Parser auch ausserhalb von Chat-Attachments nutzen
- Pro: Konsistent mit bestehendem Tool-Pattern (30+ Tools)
- Pro: Tool-Beschreibung erklaert dem Agent wann/wie er Parser nutzt
- Pro: Approval-System und Permissions greifen automatisch
- Con: Leichter Overhead durch Tool-Execution-Pipeline bei Chat-Attachments

### Option 2: Parser als Service-Schicht (ohne Tool-Integration)
Eigenstaendiger DocumentParserService ausserhalb der Tool-Registry, nur programmatisch aufrufbar.

- Pro: Kein Tool-Overhead bei Chat-Attachments
- Pro: Einfacheres Interface (kein Tool-Schema noetig)
- Con: Agent kann Parser nicht selbststaendig aufrufen
- Con: Neues Pattern neben dem bestehenden Tool-System
- Con: Wiederverwendbarkeit nur ueber Code-Kopplung

### Option 3: Hybrid -- Service-Kern + Tool-Wrapper
Parser-Logik in Service-Klassen, darueber Tool-Wrapper die den Service aufrufen.

- Pro: Schneller Direktaufruf fuer Chat-Attachments (Service)
- Pro: Agent-Zugriff ueber Tool-Wrapper
- Pro: Separation of Concerns
- Con: Zwei Aufrufwege fuer die gleiche Funktionalitaet
- Con: Mehr Code (Service + Tool + Wiring)

## Decision

**Vorgeschlagene Option:** Option 3 -- Hybrid (Service-Kern + Tool-Wrapper)

**Begruendung:**

Die Chat-Attachment-Verarbeitung braucht maximale Performance (kein Tool-Overhead), waehrend der Agent auch selbststaendig Dokumente lesen koennen soll. Der Hybrid-Ansatz liefert beides:

```
src/core/document-parsers/
  DocumentParserRegistry.ts    -- Registry: Format -> Parser (Service-Ebene)
  types.ts                     -- ParseResult, ParserOptions, ImageMetadata
  parsers/
    PptxParser.ts              -- PowerPoint
    XlsxParser.ts              -- Excel
    DocxParser.ts              -- Word
    PdfParser.ts               -- PDF (Refactoring aus SemanticIndexService)
    DataFormatParser.ts        -- JSON, XML, CSV

src/core/tools/vault/
  ReadDocumentTool.ts          -- Tool-Wrapper: Agent liest/parsed ein Dokument
  ExtractDocumentImagesTool.ts -- Tool-Wrapper: Agent fordert Bilder an (PPTX)
```

- **Chat-Attachments:** AttachmentHandler -> ruft DocumentParserRegistry.parse() direkt auf (kein Tool-Overhead)
- **Agent-initiiert:** Agent ruft read_document Tool auf -> Tool ruft DocumentParserRegistry.parse() auf
- **SemanticIndex:** Refactoring: extractPdfText() delegiert an PdfParser (Code-Deduplizierung)

**Hinweis:** Dies ist ein VORSCHLAG. Claude Code entscheidet final basierend auf dem realen Zustand der Codebase.

## Consequences

### Positive
- SideView-Monolith wird NICHT erweitert -- alle Parsing-Logik in eigenem Modul
- Agent kann Dokumente in jedem Kontext verarbeiten (Chat, Sub-Task, freier Dialog)
- PDF-Parsing wird aus SemanticIndexService herausgeloest (bessere Separation)
- Neue Parser (E-Mail, Visio) koennen ohne Architekturaenderung ergaenzt werden
- Bestehende Tool-Patterns (Approval, Permissions, Logging) greifen fuer Agent-Aufrufe

### Negative
- Zwei Aufrufwege (direkt + Tool) erfordern konsistente Fehlerbehandlung
- Mehr initialer Setup-Code (Registry + Tool-Wrapper + Wiring)

### Risks
- **Risk:** Tool-Wrapper und Service driften auseinander -> **Mitigation:** Tool-Wrapper delegiert 1:1 an Service, keine eigene Logik
- **Risk:** Performance-Regression bei PDF in SemanticIndex -> **Mitigation:** PdfParser nutzt gleichen Code, nur umgezogen

## Implementation Notes

- DocumentParserRegistry folgt dem gleichen Pattern wie ToolRegistry (Map-basiert)
- Jeder Parser implementiert ein IDocumentParser Interface mit parse(data: ArrayBuffer, options?: ParserOptions): Promise<ParseResult>
- ParseResult enthaelt: text (strukturiert), imageMetadata (Anzahl, Positionen), metadata (Seitenanzahl, Sheets, etc.)
- AttachmentHandler.processFile() ruft fuer Office-Formate DocumentParserRegistry.parse() auf statt die unsupported-Notice zu zeigen
- PdfParser uebernimmt den Code aus SemanticIndexService.ts:963-1023, aendert Input von fs.promises.readFile zu ArrayBuffer
- ReadDocumentTool und ExtractDocumentImagesTool erweitern BaseTool und werden in ToolRegistry registriert
- Neue ToolName-Eintraege: read_document, extract_document_images

## Related Decisions

- ADR-001: Central Tool Execution Pipeline (Tool-Pattern)
- ADR-003: Vectra Semantic Index (PDF-Parsing dort aktuell eingebettet)
- ADR-024: Parsing Library Selection (welche Libraries pro Format)
