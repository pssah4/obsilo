# ADR-024: Parsing-Library-Auswahl fuer Office-Formate

**Status:** Akzeptiert, implementiert
**Date:** 2026-03-05
**Deciders:** Sebastian (Owner), Claude Code (Implementierung)

## Context

FEATURE-200 benoetigt Libraries zum Parsen von PPTX, XLSX, DOCX und PDF innerhalb der Electron/Obsidian-Sandbox. Die Constraints sind streng:

- Kein `require()` (Review-Bot)
- Kein `fetch()` (Review-Bot)
- Kein nativer Code (Sandbox)
- Bundlegroesse < 5 MB gesamt
- Performance: < 5s fuer 30-Folien PPTX

**Triggering ASR:**
- ASR-1: Sandbox-Kompatibilitaet (Critical)

## Decision Drivers

- **Sandbox-Kompatibilitaet:** Muss in Electron/Obsidian ohne native Binaries laufen
- **Bundlegroesse:** Jedes MB zaehlt fuer Plugin-Nutzererfahrung
- **Parsing-Qualitaet:** >= 95% der Kernaussagen muessen erfasst werden
- **Review-Bot-Compliance:** Keine verbotenen Patterns
- **Wartbarkeit:** Aktiv gepflegte Libraries bevorzugt

## Considered Options

### Option 1: Monolithische Libraries (SheetJS, mammoth.js, pdf.js)
Fuer jedes Format eine spezialisierte, feature-reiche Library.

- SheetJS (xlsx): ~1.2 MB, liest XLSX/CSV/ODS, sehr ausgereift
- mammoth.js: ~150 KB, DOCX -> HTML, gut fuer Text-Extraktion
- pdfjs-dist: ~2.5 MB (mit Worker), bereits im Projekt vorhanden

- Pro: Hohe Parsing-Qualitaet dank ausgereifter Libraries
- Pro: pdfjs-dist bereits installiert und im SemanticIndexService getestet
- Con: SheetJS hat grosse Bundle-Size (~1.2 MB)
- Con: Drei verschiedene APIs und Paradigmen
- Con: mammoth.js produziert HTML (muss nach Text konvertiert werden)

### Option 2: JSZip + Custom OOXML Parser (Leichtgewicht)
Eine ZIP-Library (JSZip ~30KB) plus eigene XML-Parser fuer PPTX/XLSX/DOCX. OOXML-Formate sind ZIP-Archive mit XML-Dateien. PDF weiterhin via pdfjs-dist.

- Pro: Minimale Bundlegroesse (~30 KB fuer JSZip, pdfjs-dist existiert bereits)
- Pro: Einheitliche Architektur (alle OOXML-Parser teilen JSZip als Basis)
- Pro: Volle Kontrolle ueber Ausgabeformat (direkt strukturierter Text statt HTML)
- Pro: Keine Abhaengigkeit von externen Library-Updates
- Con: Eigene OOXML-Parser benoetigen Entwicklungsaufwand
- Con: Edge Cases bei komplexen Formatierungen
- Con: Eigener Code = eigene Bugs (keine Community-Tests)

### Option 3: Hybrid (Custom OOXML + bestehende PDF)
JSZip + Custom fuer OOXML (PPTX/XLSX/DOCX), pdfjs-dist fuer PDF (bereits vorhanden), native APIs fuer JSON/XML/CSV.

- Pro: Beste Balance zwischen Bundlegroesse und Qualitaet
- Pro: Nutzt pdfjs-dist das bereits bewaehrt im Projekt laeuft
- Pro: JSON/XML/CSV brauchen keine externen Libraries (DOMParser, native JSON)
- Pro: Gesamtzusatzgroesse nur ~30 KB (JSZip)
- Con: Eigene OOXML-Parser benoetigen Iterationen
- Con: Eigener Code = eigene Bugs (keine Community fuer OOXML-Parser)

## Decision

**Vorgeschlagene Option:** Option 3 -- Hybrid (Custom OOXML + bestehende PDF + native Datenformate)

**Vorgeschlagene Kombination:**

| Format | Library | Bundlegroesse | Begruendung |
|--------|---------|---------------|-------------|
| PPTX | JSZip + Custom PptxParser | ~30 KB (JSZip) | OOXML ist ZIP+XML, eigener Parser extrahiert strukturiert |
| XLSX | JSZip + Custom XlsxParser | (shared JSZip) | Shared Strings + Sheet-XML parsen, DOMParser fuer XML |
| DOCX | JSZip + Custom DocxParser | (shared JSZip) | document.xml parsen, Absaetze + Ueberschriften extrahieren |
| PDF | pdfjs-dist (v4.4.168) | 0 KB (bereits installiert) | Bewaehrter Code aus SemanticIndexService, Refactoring in PdfParser |
| JSON | Native JSON.parse() | 0 KB | Eingebaut, formatierte Ausgabe mit Struktur-Summary |
| XML | Native DOMParser | 0 KB | Eingebaut im Browser/Electron |
| CSV | Custom CSVParser | 0 KB (< 100 Zeilen) | RFC 4180 konform, Header-Erkennung, Tab-Delimiter-Support |

**Gesamtzusatz-Bundle:** ~30 KB (nur JSZip als neue npm-Dependency)

### OOXML-Parsing-Strategie

OOXML-Formate (PPTX, XLSX, DOCX) sind ZIP-Archive mit definierter Verzeichnisstruktur:

```
PPTX:
  ppt/slides/slide1.xml, slide2.xml, ...  (Folieninhalt)
  ppt/media/image1.png, image2.jpg, ...   (eingebettete Bilder)
  [Content_Types].xml                      (Format-Registry)

XLSX:
  xl/worksheets/sheet1.xml, ...            (Tabelleninhalt)
  xl/sharedStrings.xml                     (String-Pool)
  xl/styles.xml                            (Formatierung)

DOCX:
  word/document.xml                        (Hauptinhalt)
  word/media/...                           (eingebettete Bilder)
```

Parsing-Ablauf pro Format:
1. JSZip oeffnet die Datei (ArrayBuffer -> ZIP)
2. Custom Parser navigiert die OOXML-Verzeichnisstruktur
3. DOMParser (nativ in Electron) extrahiert Inhalte aus XML
4. Parser liefert strukturierten Text (pro Folie/Sheet/Abschnitt)

### PDF-Refactoring

pdfjs-dist ist bereits in `package.json` (v4.4.168) und funktioniert im SemanticIndexService (fake-worker Modus, kein Web Worker). Der bestehende Code aus `SemanticIndexService.ts:963-1023` wird refactored:

- **Vorher:** `extractPdfText()` in SemanticIndexService, liest via `fs.promises.readFile`
- **Nachher:** `PdfParser.parse(data: ArrayBuffer)` als eigenstaendiger Parser
- SemanticIndexService delegiert an PdfParser (keine Code-Duplikation)
- Gleicher fake-worker Modus (`disableAutoFetch`, `isEvalSupported: false`)

### Sicherheitsmassnahmen

- **ZIP-Bomb-Protection:** `JSZip.loadAsync()` mit `decodeFileName: true`, maximale Decompressed Size pruefen (z.B. 500 MB Limit)
- **Path Traversal:** ZIP-Eintraege mit `../` oder absoluten Pfaden ablehnen
- **Input Validation:** Magic Bytes pruefen vor Parsing (ZIP: `PK\x03\x04`, PDF: `%PDF-`)

**Hinweis:** Dies ist ein VORSCHLAG. Claude Code entscheidet final basierend auf dem realen Zustand der Codebase.

## Consequences

### Positive
- Minimale Bundle-Vergroesserung (~30 KB)
- Kein neues Paradigma -- pdfjs-dist bleibt fuer PDF, JSZip ist Standard fuer ZIP
- Eigene OOXML-Parser liefern exakt das gewuenschte Ausgabeformat (kein HTML-Umweg)
- DOMParser ist in Electron nativ verfuegbar (kein externer XML-Parser noetig)
- JSON/XML/CSV brauchen null zusaetzliche Dependencies

### Negative
- Eigene OOXML-Parser benoetigen ggf. Iterationen bei Edge Cases
- Eigener Code = eigene Bugs (keine Community die Patterns testet)

### Risks
- **Risk:** Komplexe OOXML-Features (verschachtelte Tabellen, SmartArt, Pivot-Tables) werden nicht korrekt geparst -> **Mitigation:** MVP fokussiert auf Text + Basis-Struktur; komplexe Features koennen spaeter ergaenzt werden
- **Risk:** JSZip hat Sicherheitsluecke -> **Mitigation:** npm audit, regelmaessige Updates, ZIP-Bomb-Protection implementieren
- **Risk:** pdfjs-dist fake-worker Modus hat Performance-Limits bei grossen PDFs -> **Mitigation:** Performance-Tests mit 100-Seiten PDFs, ggf. page-range Einschraenkung

## Implementation Notes

- JSZip als einzige neue npm-Dependency hinzufuegen (`npm install jszip`)
- JSZip ist ~30 KB minified+gzipped, MIT-lizenziert, Sandbox-kompatibel
- Alle OOXML-Parser nutzen `new DOMParser().parseFromString(xml, 'text/xml')` fuer XML-Parsing
- Custom OOXML-Parser: Fokus auf Text-Extraktion, keine Layout-Rekonstruktion
- PptxParser extrahiert: Folientitel, Textfelder, Notizen, Bild-Metadaten (Dateiname, Groesse, Foliennummer)
- XlsxParser extrahiert: Sheet-Namen, Zelleninhalte mit Header-Zuordnung (Row 1 = Header)
- DocxParser extrahiert: Absaetze mit Ueberschriften-Hierarchie, Listen, Tabellen als Markdown
- CSVParser: Einfacher RFC-4180-Parser (~100 Zeilen), erkennt Delimiter automatisch (Komma, Tab, Semikolon)

## Related Decisions

- ADR-023: Document Parser als wiederverwendbare Tools (Service-Kern + Tool-Wrapper)
- ADR-025: On-Demand Bild-Nachlade-Strategie (Bilder aus OOXML-Media-Ordnern)
- ADR-003: Vectra Semantic Index (pdfjs-dist dort eingefuehrt)
