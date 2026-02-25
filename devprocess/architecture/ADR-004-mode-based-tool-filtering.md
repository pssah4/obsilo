# ADR-004: Mode-basierte Tool-Filterung via Tool-Gruppen

**Status:** Akzeptiert
**Datum:** 2026-02-17
**Entscheider:** Sebastian Hanke

---

## Kontext

Der Agent hat 30+ Tools. Nicht jeder Mode soll Zugriff auf alle Tools haben (z.B. soll ein reiner "Ask"-Mode keine Schreiboperationen ausführen können). Wie wird Tool-Verfügbarkeit pro Mode gesteuert?

Optionen:
1. Pro-Tool-Whitelist in jedem Mode (explizite Liste aller erlaubten Tools)
2. Tool-Gruppen: Mode definiert erlaubte Gruppen, nicht einzelne Tools
3. Globale Whitelist mit Mode-spezifischen Ausnahmen

## Entscheidung

**Option 2 — Tool-Gruppen** (`TOOL_GROUP_MAP` in `builtinModes.ts`).

Jeder Mode definiert eine Liste von Tool-Gruppen (`toolGroups: string[]`). `ModeService.getToolDefinitions()` filtert Tools entsprechend. Zusätzlich: `sessionToolOverride` ermöglicht temporäre Overrides ohne Mode-Wechsel.

Gruppen: `read`, `vault`, `edit`, `web`, `agent`, `mcp`

## Begründung

- **Wartbarkeit**: Neues Tool nur in die richtige Gruppe eintragen — alle Modes, die diese Gruppe erlauben, unterstützen es automatisch.
- **Klare Semantik**: Gruppen-Namen kommunizieren Intention (ein "read"-Mode erlaubt keine "edit"-Gruppe).
- **Kilo Code Referenz**: Kilo Code nutzt Tool-Gruppen-Konzept für Modes.
- **Flexibilität**: `sessionToolOverride` für temporäre Overrides ohne vollständigen Mode-Wechsel.

**Option 1 abgelehnt**: Bei 30+ Tools und mehreren Modes unübersichtlich, jede Tool-Ergänzung muss in allen Modes aktualisiert werden.

## Konsequenzen

**Positiv:**
- Neue Tools: nur Gruppe zuordnen, automatisch in allen passenden Modes
- Klare Boundary zwischen read-only und write-fähigen Modes
- System Prompt zeigt LLM nur Tools des aktuellen Modes

**Negativ:**
- Fein-granulare Steuerung (einzelne Tools innerhalb einer Gruppe ein-/ausblenden) erfordert Gruppen-Split
- Gruppen-Semantik muss bei neuen Tools sorgfältig gewählt werden

## Implementierung

`src/core/modes/builtinModes.ts` — `TOOL_GROUP_MAP`
`src/core/modes/ModeService.ts` — `getToolDefinitions()`
Built-in Modes: `ask` (read, vault, agent), `agent` (alle Gruppen)
