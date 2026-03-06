# ADR-030: Library-Selection fuer Office-Format-Erzeugung

**Status:** Proposed
**Date:** 2026-03-06
**Deciders:** Sebastian Hanke

## Context

EPIC-004 benoetigt npm-Libraries fuer die programmatische Erzeugung von PPTX, DOCX, XLSX und PDF im Plugin-Kontext (Electron/Node.js). Die Libraries werden als Dependencies gebundelt (esbuild) und muessen mit der Obsidian-Plugin-Architektur kompatibel sein.

Die Sandbox-SKILL.md (bundled-skills/sandbox-environment/SKILL.md) hat bereits Library-Empfehlungen fuer die Sandbox-Umgebung dokumentiert. Im Plugin-Kontext gibt es keine Sandbox-Restriktionen (voller Node.js-Zugriff), sodass die Library-Wahl breiter ist.

**Triggering ASR:**
- Library-Kompatibilitaet (Risk aus EPIC-004)
- Quality Attribute: Kompatibilitaet, Bundle-Groesse, Zuverlaessigkeit

## Decision Drivers

- **Electron/esbuild-Kompatibilitaet:** Library muss mit esbuild bundlebar sein und in Electron laufen
- **Bundle-Groesse:** Gesamt-Zuwachs < 5 MB (minified)
- **API-Qualitaet:** Reichhaltige API fuer professionelle Ergebnisse
- **Maintenance:** Aktiv maintained, >1000 GitHub Stars, regelmaessige Releases
- **Pure JavaScript:** Bevorzugt (keine nativen Addons/C++ Bindings) fuer Mobile-Kompatibilitaet

## Considered Options

### PPTX: pptxgenjs vs. officegen vs. docxtemplater

| Kriterium | pptxgenjs | officegen | docxtemplater |
|-----------|-----------|-----------|---------------|
| GitHub Stars | ~2.5k | ~2.5k | ~2.8k |
| Letzes Update | Aktiv | 2021 (inaktiv) | Aktiv |
| Pure JS | Ja | Ja | Ja |
| API-Reichhaltigkeit | Hoch (Tabellen, Charts, Bilder, Master) | Mittel | Template-basiert |
| ArrayBuffer Output | `write({outputType:'arraybuffer'})` | Nein (Stream) | Ja |
| Bundle-Groesse | ~500 KB | ~300 KB | ~200 KB + Templates |

**Empfehlung: pptxgenjs** -- Reichhaltigste API, aktiv maintained, ArrayBuffer-Output, bereits in SKILL.md empfohlen.

### DOCX: docx vs. officegen vs. docxtemplater

| Kriterium | docx (npm) | officegen | docxtemplater |
|-----------|------------|-----------|---------------|
| GitHub Stars | ~3k | ~2.5k | ~2.8k |
| Letzes Update | Aktiv | 2021 (inaktiv) | Aktiv |
| Pure JS | Ja | Ja | Ja |
| API-Reichhaltigkeit | Hoch (Paragraphs, Tables, Images, Styles, Headers) | Mittel | Template-basiert |
| Buffer Output | `Packer.toBuffer()` | Stream | Ja |
| Bundle-Groesse | ~400 KB | ~300 KB | ~200 KB + Templates |

**Empfehlung: docx** -- Beste API fuer programmatische DOCX-Erzeugung, aktiv maintained, Buffer-Output.

### XLSX: exceljs vs. xlsx (SheetJS) vs. xlsx-populate

| Kriterium | exceljs | xlsx (SheetJS) | xlsx-populate |
|-----------|---------|----------------|---------------|
| GitHub Stars | ~14k | ~35k | ~1k |
| Letzes Update | Aktiv | Aktiv | 2022 |
| Pure JS | Ja | Ja | Ja |
| API-Reichhaltigkeit | Hoch (Styles, Formeln, Bilder, Streaming) | Hoch (aber Community-Edition limitiert) | Mittel |
| Buffer Output | `writeBuffer()` | `write({type:'buffer'})` | `outputAsync({type:'arraybuffer'})` |
| Lizenz | MIT | Apache-2.0 (Community) | MIT |
| Bundle-Groesse | ~1 MB | ~800 KB | ~400 KB |

**Empfehlung: exceljs** -- MIT-Lizenz, reichhaltige API inkl. Styles und Formeln, `writeBuffer()` liefert ArrayBuffer direkt, bereits in SKILL.md empfohlen.

### PDF: pdf-lib vs. jspdf vs. pdfkit

| Kriterium | pdf-lib | jspdf | pdfkit |
|-----------|---------|-------|--------|
| GitHub Stars | ~7k | ~29k | ~10k |
| Letzes Update | 2023 (stabil) | Aktiv | Aktiv |
| Pure JS | Ja | Ja (DOM optional) | Ja |
| DOM-Abhaengigkeit | Nein | Optional (html2canvas) | Nein |
| Font Embedding | Ja (Custom Fonts) | Ja | Ja |
| Bundle-Groesse | ~500 KB | ~400 KB | ~600 KB |
| API-Style | Functional | Imperative | Stream-basiert |

**Empfehlung: pdf-lib** -- Pure JS, kein DOM, Custom-Font-Embedding fuer Unicode/Umlaute, bereits in SKILL.md empfohlen, kleinster Bundle-Footprint.

## Decision

**Vorgeschlagene Libraries:**

| Format | Library | Version | Bundle-Groesse (est.) |
|--------|---------|---------|----------------------|
| PPTX | pptxgenjs | latest | ~500 KB |
| DOCX | docx | latest | ~400 KB |
| XLSX | exceljs | latest | ~1 MB |
| PDF | pdf-lib | latest | ~500 KB |
| **Gesamt** | | | **~2.4 MB** |

Alle vier sind pure JavaScript, keine nativen Addons, MIT/Apache-lizensiert, ArrayBuffer/Buffer-Output.

**Hinweis:** Dies ist ein VORSCHLAG. Claude Code entscheidet final basierend auf dem realen Zustand der Codebase und konkreten Kompatibilitaetstests.

## Consequences

### Positive
- Bewaehrte Libraries mit grosser Community
- Gesamt-Zuwachs ~2.4 MB (deutlich unter 5 MB Limit)
- Pure JS: Mobile-kompatibel (falls spaeter relevant)
- Konsistenz mit bestehenden SKILL.md-Empfehlungen

### Negative
- pdf-lib letztes Release 2023 -- stabil, aber keine aktive Entwicklung
- exceljs ist die groesste Library (~1 MB) -- akzeptabel fuer den Funktionsumfang
- 4 zusaetzliche Dependencies erhoehen Supply-Chain-Risiko

### Risks
- **esbuild-Bundling-Probleme:** Mitigation durch fruehzeitige Build-Tests pro Library
- **pdf-lib Maintenance-Risiko:** Mitigation durch Fallback auf pdfkit (aktiv maintained, aehnliche API)
- **Font-Embedding (PDF):** StandardFonts (Helvetica, Times, Courier) unterstuetzen kein Unicode. Fuer Umlaute muss ein Custom Font eingebettet werden. Mitigation: Im MVP einen Standard-Unicode-Font (z.B. Noto Sans) als Asset einbetten.

## Implementation Notes

- Libraries als `dependencies` in package.json (nicht devDependencies)
- Statischer Import zum Start, lazy loading in spaeterer Optimierung moeglich
- Alle Libraries erzeugen ArrayBuffer/Buffer -- einheitliches Binary-Write Pattern via `vault.createBinary()`

## Related Decisions

- ADR-029: Input-Schema-Design (bestimmt wie Libraries angesteuert werden)
- ADR-021: Sandbox OS-Level Isolation (bestaetigt Plugin-Kontext statt Sandbox)
- bundled-skills/sandbox-environment/SKILL.md (bisherige Library-Empfehlungen)

## References

- pptxgenjs: https://github.com/gitbrent/PptxGenJS
- docx: https://github.com/dolanmiri/docx
- exceljs: https://github.com/exceljs/exceljs
- pdf-lib: https://github.com/Hopding/pdf-lib
