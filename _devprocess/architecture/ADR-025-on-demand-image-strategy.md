# ADR-025: On-Demand Bild-Nachlade-Strategie

**Status:** Akzeptiert, geplant
**Date:** 2026-03-05
**Deciders:** Sebastian (Owner), Claude Code (Implementierung)

## Context

Unternehmens-Praesentationen transportieren wesentliche Informationen ueber Grafiken (Diagramme, Prozessbilder, Screenshots). Ein reiner Text-Extrakt erfasst nur ca. 70% des Informationsgehalts. Gleichzeitig sind Bilder token-intensiv (ein base64-Image Block kann 1.000-10.000 Token verbrauchen).

**Zwei-Stufen-Anforderung aus FEATURE-203:**
1. Stufe: Parser extrahiert Text + Bild-Metadaten (Platzhalter wie "[Bild 1: chart.png auf Folie 3]")
2. Stufe: Agent entscheidet autonom, ob er Bilder nachlaedt -- ueber ein Tool

**Offene Fragen aus dem RE-Handoff:**
- Wo werden extrahierte Bilder zwischengespeichert?
- Wie steuert der System Prompt das Nachlade-Verhalten?
- Welche Formate werden unterstuetzt?
- Soll das Tool auch fuer DOCX-Bilder funktionieren?

**Triggering ASRs:**
- ASR-1 (FEATURE-203): Text-first mit Bild-Nachlade (Critical)
- ASR-2 (FEATURE-203): Vision-Capability-Check (Moderate)

## Decision Drivers

- **Token-Effizienz:** Bilder nur wenn noetig senden (ca. 30% der Faelle)
- **Agent-Autonomie:** Agent entscheidet, nicht der Nutzer
- **Vision-Abhaengigkeit:** Nur bei Vision-faehigen Modellen (Claude, GPT-4V)
- **Performance:** Bild-Extraktion < 500ms pro Bild, < 5s fuer gesamte PPTX
- **Einfachheit:** Minimaler Speicher-Overhead, kein persistenter Cache

## Considered Options

### Option 1: In-Memory Bild-Cache (Session-gebunden)
Beim initialen Parsing werden Bilder direkt extrahiert und als Map<string, ArrayBuffer> im Speicher gehalten, bis die Chat-Session endet.

- Pro: Sofortiger Zugriff beim Nachlade (kein erneutes Parsing)
- Pro: Kein Dateisystem-Zugriff noetig
- Con: Speicherverbrauch bei grossen Praesentationen (30+ Bilder = 50-100MB)
- Con: Bilder werden extrahiert, auch wenn sie nie gebraucht werden

### Option 2: Lazy Extraction (Bilder erst bei Nachlade extrahieren)
Beim initialen Parsing werden nur Metadaten erfasst (Dateiname, Folie, Groesse). Die eigentliche Bild-Extraktion erfolgt erst wenn der Agent das Tool aufruft.

- Pro: Minimaler Speicherverbrauch beim initialen Parsing
- Pro: Bilder werden nur extrahiert wenn tatsaechlich gebraucht
- Con: Originaldatei muss beim Nachlade nochmals geoeffnet werden (erneutes ZIP-Entpacken)
- Con: Leicht hoeherer Latenz beim Nachlade-Aufruf

### Option 3: Hybrid -- Thumbnail-Cache + Lazy Full Extraction
Beim Parsing werden kleine Thumbnails (< 50KB) gecacht, volle Bilder erst on-demand.

- Pro: Agent koennte Thumbnails pruefen ohne volle Extraktion
- Con: Hohe Komplexitaet (Thumbnail-Generation, doppelte Extraktion)
- Con: Thumbnail-Qualitaet reicht fuer Vision-Analyse selten aus

## Decision

**Vorgeschlagene Option:** Option 2 -- Lazy Extraction

**Begruendung:**

Da laut BA nur ca. 30% der Faelle ueberhaupt Bild-Nachlade benoetigen, ist das Voraus-Extrahieren aller Bilder (Option 1) in 70% der Faelle verschwendeter Speicher. Der Mehraufwand des erneuten ZIP-Entpackens (Option 2) ist minimal (~200ms) und wird nur bei Bedarf bezahlt.

### ExtractDocumentImagesTool Design

```typescript
// Neuer ToolName: extract_document_images
// Registriert in ToolRegistry, Gruppe: vault-read

Tool Input:
{
  path: string,           // Vault-relativer Pfad zur Datei
  slides?: number[],      // Optional: nur bestimmte Folien (PPTX)
  maxImages?: number       // Optional: Limit (Default: 10)
}

Tool Output:
- image-ContentBlocks (base64, passendes media_type)
- Text-Summary: "Extrahiert: 5 Bilder von Folien 3, 7, 12, 15, 22"
```

### Ablauf im Detail

```
1. Nutzer haengt PPTX an / Agent erhaelt PPTX-Kontext
2. PptxParser.parse() extrahiert:
   - Strukturierten Text pro Folie
   - Bild-Metadaten: [{id: "img1", filename: "chart.png", slide: 3, width: 800, height: 600}]
   - KEINE Bild-Daten
3. Agent erhaelt Text mit Platzhaltern:
   "## Folie 3: Marktanalyse
    [Bild: chart.png (800x600) -- Diagramm nicht im Text beschrieben]
    Umsatzwachstum von 12% im Q3..."
4. Agent entscheidet: "Der Chart koennte wichtige Details enthalten"
5. Agent ruft extract_document_images(path: "report.pptx", slides: [3]) auf
6. Tool oeffnet PPTX erneut, extrahiert Bild(er), skaliert wenn noetig
7. Tool liefert image-ContentBlock(s) zurueck
8. Agent analysiert Text + Bilder gemeinsam
```

### System Prompt Steering

Im Power-Steering-Abschnitt des System Prompts:
```
Wenn du ein Dokument mit Bild-Platzhaltern analysierst:
- Pruefe zuerst, ob der Text allein die Frage beantwortet
- Lade Bilder nur nach, wenn der Text auf nicht-beschriebene Grafiken verweist
- Nutze extract_document_images mit spezifischen Foliennummern statt alle Bilder
- Vermeide Bild-Nachlade bei reinen Text-Fragen ("Wer ist der Autor?")
```

### Vision-Capability-Gate

```
- Vor Tool-Aufruf: Pruefe ModelInfo.supportsVision (neues Feld, siehe ADR-024)
- Wenn kein Vision: Tool liefert Fehler "Aktuelles Modell unterstuetzt keine Bild-Analyse.
  Wechsle zu einem Vision-faehigen Modell oder beschreibe die Frage textbasiert."
- Bild-Metadaten im Text bleiben trotzdem erhalten (Agent weiss, dass Bilder existieren)
```

**Hinweis:** Dies ist ein VORSCHLAG. Claude Code entscheidet final basierend auf dem realen Zustand der Codebase.

## Consequences

### Positive
- Minimaler Speicherverbrauch -- Bilder werden nur bei Bedarf extrahiert
- Token-effizient -- nur relevante Bilder werden an die API gesendet
- Agent-autonom -- Nutzer muss nicht entscheiden, ob Bilder noetig sind
- Erweiterbar auf DOCX/XLSX (gleicher Mechanismus, Bilder liegen auch in OOXML-Media-Ordnern)

### Negative
- Originaldatei muss bei Nachlade erneut geoeffnet werden (erneutes JSZip-Entpacken)
- System Prompt wird laenger durch Steering-Anweisungen
- Abhaengigkeit von Provider-seitigem Vision-Support (nicht alle Modelle)

### Risks
- **Risk:** Agent laedt zu oft/zu viele Bilder nach -> **Mitigation:** maxImages-Limit (Default 10), System Prompt Steering, Token-Budget aus FEATURE-202
- **Risk:** Bild-Skalierung verzerrt Diagramme -> **Mitigation:** Proportionales Downscaling, nur bei Ueberschreitung von 2048px Kantenlaenge
- **Risk:** PPTX-Datei wurde zwischen Parsing und Nachlade geaendert -> **Mitigation:** Warnung wenn mtime differiert, kein harter Fehler

## Implementation Notes

- ExtractDocumentImagesTool implementiert BaseTool-Interface
- Bilder werden aus OOXML `/ppt/media/` bzw. `/word/media/` extrahiert (reines ZIP-Lookup)
- Unterstuetzte Bildformate: PNG, JPEG, GIF, WebP (passend zu ImageMediaType in api/types.ts)
- Bilder > 2048px Kantenlaenge werden proportional herunterskaliert (Canvas API in Electron verfuegbar)
- Base64-Encoding erfolgt direkt am ArrayBuffer (kein Zwischenspeichern als Datei)
- ModelInfo in api/types.ts braucht neues Feld: supportsVision: boolean
- Tool wird bei Modellen ohne Vision in ToolRegistry ausgeblendet (oder liefert erklaerenden Fehler)

## Related Decisions

- ADR-023: Document Parser als wiederverwendbare Tools (Service-Kern + Tool-Wrapper)
- ADR-024: Parsing Library Selection (JSZip fuer OOXML-Zugriff)
- FEATURE-203: On-Demand Bild-Extraktion (Requirements)
- FEATURE-204: Model Compatibility Check (Vision-Gate)
