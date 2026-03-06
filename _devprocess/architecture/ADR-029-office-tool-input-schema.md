# ADR-029: Input-Schema-Design fuer Office-Creation-Tools

**Status:** Proposed
**Date:** 2026-03-06
**Deciders:** Sebastian Hanke

## Context

EPIC-004 fuehrt vier neue Built-in Tools ein (create_pptx, create_docx, create_xlsx, create_pdf). Jedes Tool nimmt strukturierten Input vom LLM entgegen und erzeugt die Datei programmatisch. Das Input-Schema ist die kritischste Designentscheidung: Es bestimmt die LLM-Zuverlaessigkeit (einfaches Schema = weniger Fehler) UND die Output-Qualitaet (reiches Schema = bessere Ergebnisse).

**Triggering ASR:**
- CRITICAL ASR #2 aus FEATURE-400 bis FEATURE-403
- Quality Attribute: Usability, Zuverlaessigkeit

## Decision Drivers

- **LLM-Zuverlaessigkeit:** LLMs generieren zuverlaessigeren Output bei flacheren, weniger verschachtelten Schemas
- **Expressive Power:** Professionelle Dokumente benoetigen Styling, Layout, verschachtelte Strukturen
- **Konsistenz:** Alle 4 Tools sollten das gleiche Schema-Pattern verwenden
- **Praezedenz:** CreateExcalidrawTool und GenerateCanvasTool haben bewaehrte Patterns

## Considered Options

### Option 1: Tiefes, voll typisiertes JSON-Schema

Jedes Element ist ein verschachteltes Objekt mit expliziten Typfeldern:

```json
{
  "output_path": "Report.pptx",
  "slides": [
    {
      "title": "Headline",
      "elements": [
        {
          "type": "text",
          "content": "Hello",
          "style": { "fontSize": 24, "bold": true, "color": "#333" },
          "position": { "x": 1, "y": 1, "width": 8, "height": 1 }
        },
        {
          "type": "table",
          "headers": ["A", "B"],
          "rows": [["1", "2"]],
          "style": { "headerColor": "#4472C4" }
        }
      ]
    }
  ]
}
```

- Pro: Maximale Kontrolle, praezise Positionierung
- Pro: Klare Typdiskriminierung
- Con: Tiefe Verschachtelung (4-5 Ebenen) -- LLMs produzieren haeufig Fehler
- Con: Position-Koordinaten sind fuer LLMs schwer zu schaetzen
- Con: Viel Boilerplate fuer einfache Faelle

### Option 2: Flaches, content-zentriertes Schema (gewaehlt)

Slides/Seiten als Arrays von Content-Bloecken. Styling ueber optionale Top-Level-Felder. Keine manuellen Koordinaten -- das Tool macht Auto-Layout:

```json
{
  "output_path": "Report.pptx",
  "theme": { "primaryColor": "#4472C4", "fontFamily": "Calibri" },
  "slides": [
    {
      "title": "Headline",
      "subtitle": "Optional subtitle",
      "body": "Paragraph text or **bold** markdown",
      "bullets": ["Point 1", "Point 2"],
      "table": { "headers": ["A", "B"], "rows": [["1", "2"]] },
      "image": "path/to/image.png",
      "notes": "Speaker notes"
    }
  ]
}
```

- Pro: Flache Struktur (2-3 Ebenen), LLM-freundlich
- Pro: Auto-Layout -- Tool entscheidet ueber Positionierung
- Pro: Optionale Felder -- minimales Schema fuer einfache Faelle
- Pro: Theme auf Top-Level statt pro Element -- weniger Wiederholung
- Con: Weniger Kontrolle ueber exakte Positionierung
- Con: Ein Slide kann nur eine Tabelle, ein Bild haben (Mitigation: mehrere Slides)

### Option 3: Markdown-Input mit Frontmatter

User schreibt Markdown, Tool konvertiert:

```json
{
  "output_path": "Report.pptx",
  "markdown": "# Slide 1\n\nBullet points:\n- Point 1\n- Point 2\n\n---\n\n# Slide 2\n\n..."
}
```

- Pro: Extrem einfach fuer das LLM
- Pro: User kann auch direkt Markdown schreiben
- Con: Kein Styling, keine Tabellen-Kontrolle, keine Bilder
- Con: Markdown-zu-PPTX-Mapping ist ambig (was ist ein Slide-Break?)
- Con: Fuer XLSX komplett ungeeignet (kein Tabellen-Formeln-Mapping)

## Decision

**Vorgeschlagene Option:** Option 2 (Flaches, content-zentriertes Schema)

**Begruendung:**

1. **LLM-Zuverlaessigkeit:** 2-3 Verschachtelungsebenen statt 4-5 reduziert Fehler signifikant
2. **Auto-Layout:** Das Tool uebernimmt Positionierung -- LLMs koennen keine sinnvollen Koordinaten schaetzen
3. **Praezedenz:** CreateExcalidrawTool folgt dem gleichen Pattern (LLM gibt Labels/Farben, Tool macht Layout)
4. **Progressive Complexity:** Einfache Faelle brauchen nur `title` + `body`, komplexe koennen `table` + `image` + `theme` hinzufuegen
5. **Konsistenz:** Alle 4 Tools folgen dem gleichen Schema-Muster (content-zentriert, Auto-Layout, optionale Styling-Felder)

**Hinweis:** Dies ist ein VORSCHLAG. Claude Code entscheidet final basierend auf dem realen Zustand der Codebase.

### Schema-Varianten pro Tool

**create_pptx:** `{ output_path, theme?, slides[{ title?, subtitle?, body?, bullets?, table?, image?, notes?, layout? }] }`

**create_docx:** `{ output_path, theme?, title?, sections[{ heading?, level?, body?, bullets?, numberedList?, table?, image? }] }`

**create_xlsx:** `{ output_path, sheets[{ name, headers?, rows[][], columnWidths?, formulas?{cell: formula}[], styles?{} }] }`

**create_pdf:** `{ output_path, theme?, title?, sections[{ heading?, body?, bullets?, numberedList?, table? }], pageSize? }`

## Consequences

### Positive
- LLM produziert validen Input bei >90% der Versuche
- Einfache Faelle erfordern minimalen Input (2-3 Felder)
- Konsistentes Pattern ueber alle 4 Tools

### Negative
- Kein Pixel-genaues Positionieren (bewusster Trade-off)
- Ein Content-Block pro Slide/Section (Mitigation: mehrere Slides/Sections)
- Styling begrenzt auf Theme + wenige optionale Felder

### Risks
- LLM nutzt nicht alle verfuegbaren Felder optimal: Mitigation durch gute Prompt-Guidance und Beispiele in der Tool-Description

## Implementation Notes

- Jedes Tool validiert den Input mit TypeScript-Interfaces (nicht mit JSON-Schema-Runtime-Validation)
- Ungueltige optionale Felder werden ignoriert (fail-soft), Pflichtfelder (output_path) erzeugen klaren Fehler
- Theme-Defaults: Office-Standard-Farben, Calibri/Arial als Font

## Related Decisions

- ADR-021: Sandbox OS-Level Isolation (bestaetigt Plugin-Kontext-Ausfuehrung)
- GLOSSAR-begriffe.md: Schicht 2 fuer binaere Dateiformate

## References

- FEATURE-400 bis FEATURE-403: Input-Schema-Design als Critical ASR
- CreateExcalidrawTool: Referenz-Pattern (Labels/Farben → Auto-Layout)
- GenerateCanvasTool: Referenz-Pattern (strukturierter JSON-Input)
