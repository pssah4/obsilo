# ADR-027: Task-Note Frontmatter Schema

**Status:** Akzeptiert, implementiert
**Date:** 2026-03-06
**Deciders:** Architect Agent, Claude Code
**Feature:** FEATURE-100 Task Extraction & Management

## Context

Task Extraction (FEATURE-100) erstellt eigenstaendige Notes fuer jede vom Nutzer ausgewaehlte Aufgabe. Diese Notes brauchen ein strukturiertes Frontmatter-Schema mit 10 Properties, das als Schnittstelle dient zwischen:

1. **Plugin → Note**: Task-Note-Erstellung mit Initialdaten
2. **Note → Base**: Base-Views filtern und sortieren anhand der Properties
3. **Note → Iconic**: Optionale visuelle Differenzierung via `icon`/`iconColor`
4. **Note → Nutzer**: Manuelles Editieren der Properties (Status, Prioritaet, Faelligkeit)

Das Schema muss von Anfang an stabil sein, da Aenderungen bestehende Task-Notes brechen wuerden (Bases-Filter, Iconic-Mappings). Deutsche Property-Namen sind gewuenscht (konsistent mit dem Obsidian-Oekosystem deutschsprachiger Nutzer).

**Triggering ASR:** CRITICAL ASR #2 aus FEATURE-100
**Quality Attribute:** Maintainability, Interoperability

## Decision Drivers

- **Schema-Stabilitaet**: Aenderungen brechen bestehende Base-Views und manuelle Workflows
- **Obsidian-Kompatibilitaet**: Frontmatter-Parser muss Unicode-Property-Namen korrekt verarbeiten
- **Interoperabilitaet**: Properties muessen mit Bases-Filter-Syntax (`containsAny`, `equals`) funktionieren
- **Nutzerfreundlichkeit**: Deutsche Property-Namen fuer deutschsprachige Vaults

## Considered Options

### Option 1: 10 Properties mit deutschen Namen (Feature-Spec)

```yaml
---
Typ: Aufgabe
Status: Offen
Zusammenfassung: "Kapitel 3 ueberarbeiten"
Erstellt: 2026-03-06
Fälligkeit: 2026-03-13
Dringend: false
Wichtig: true
Quelle: "[[Meeting Notes 2026-03-06]]"
Kontext: "Agent Task: Schreibe Meeting Summary"
icon: lucide//check-square
iconColor: "#4CAF50"
---
```

- Pro: Deutsche Bezeichnungen konsistent mit Vault-Sprache
- Pro: Eisenhower-kompatible Felder (Dringend/Wichtig)
- Pro: 10 Properties decken alle Use Cases ab (SC-04)
- Pro: Iconic-Properties (`icon`, `iconColor`) sind standardisiert
- Con: Unicode in Property-Name (`Fälligkeit`) — potenzielle Parser-Probleme
- Con: Gemischte Sprache (deutsche Properties + englische Iconic-Keys)

### Option 2: Englische Property-Namen

```yaml
---
type: task
status: open
summary: "Review chapter 3"
created: 2026-03-06
due: 2026-03-13
urgent: false
important: true
source: "[[Meeting Notes 2026-03-06]]"
context: "Agent Task: Write meeting summary"
icon: lucide//check-square
iconColor: "#4CAF50"
---
```

- Pro: Kein Unicode-Risiko in Property-Namen
- Pro: Konsistent mit Obsidian-Internals (englisch)
- Pro: Keine Mischsprache
- Con: Widerspricht Nutzer-Erwartung (deutschsprachiger Vault)
- Con: Feature-Spec definiert explizit deutsche Namen

### Option 3: Hybrid (deutsche Display + englische Keys)

Interne Keys englisch, aber Obsidian Property-Aliase oder Bases-Spaltenumbenennung fuer deutsches Display.

- Pro: Technisch sauber (ASCII Keys)
- Pro: Deutsch im UI
- Con: Obsidian hat kein Property-Alias-Feature — Workaround noetig
- Con: Komplexitaet ohne echten Nutzen

## Decision

**Vorgeschlagene Option:** Option 1 — Deutsche Property-Namen (mit `Fälligkeit`-Absicherung)

**Begruendung:**

1. **Feature-Spec**: Definiert explizit deutsche Namen und Nutzer-Assumption
2. **Obsidian-Realitaet**: Obsidian's Frontmatter-YAML-Parser handhabt Unicode-Keys korrekt (getestet in vielen Community-Plugins mit deutschen/japanischen Properties). `Fälligkeit` mit Umlaut ist kein technisches Problem.
3. **Nutzer-Perspektive**: Die Properties sind im Frontmatter-Editor sichtbar. Deutsche Nutzer erwarten `Status: Offen`, nicht `status: open`.
4. **Iconic-Keys bleiben englisch**: `icon` und `iconColor` sind Plugin-definierte Keys — die muessen englisch sein, damit Iconic sie erkennt. Das ist keine Mischsprache, sondern Plugin-API-Konformitaet.

**Schema-Versionierung:** Kein separates `schemaVersion`-Feld. Stattdessen ist `Typ: Aufgabe` (Wert, nicht Key) der Schema-Marker. Wenn je ein Schema-Update noetig wird, kann eine Migration `Typ: Aufgabe` Notes erkennen und aktualisieren.

**Hinweis:** Option 1 war der Vorschlag. Die Implementierung weicht in Details ab (siehe "Implementiertes Schema").

## Implementiertes Schema

Die Implementierung in `TaskNoteCreator.ts` verwendet folgendes Schema:

```typescript
interface TaskFrontmatter {
    Kategorie: string[];                   // ['Task'] — Array-Format fuer Bases-Filter
    Zusammenfassung: string;               // Aus Checkbox-Text extrahiert (toTitle)
    Status: 'Todo' | 'Doing' | 'Done' | 'Waiting';  // Mehr Zustaende als Vorschlag
    Dringend: boolean;                     // Eisenhower: urgent
    Wichtig: boolean;                      // Eisenhower: important
    Fälligkeit: string;                    // ISO-Datum oder leer
    Assignee: string;                      // Zugewiesen an (aus TaskItem)
    Quelle: string;                        // Wikilink zur Ursprungs-Note
    created: string;                       // ISO-Datum (englisch, Obsidian-Konvention)
    Notizen: string[];                     // Leeres Array fuer spaetere Ergaenzungen
}
```

**Abweichungen vom Vorschlag (Option 1):**

| Vorschlag | Implementierung | Begruendung |
|-----------|----------------|-------------|
| `Typ: Aufgabe` | `Kategorie: [Task]` | Array-Format besser fuer Bases-Filter (`containsAny`) |
| `Status: Offen/Erledigt` | `Status: Todo/Doing/Done/Waiting` | Mehr Granularitaet fuer Kanban-Workflows |
| `Erstellt` (deutsch) | `created` (englisch) | Konsistent mit Obsidian-Core-Property |
| `Kontext` | nicht implementiert | Entscheidung: Spart Token, Kontext ueber Quelle erreichbar |
| `icon`, `iconColor` | nicht implementiert | Deferred: Iconic-Integration als separates Feature |
| — | `Assignee` hinzugefuegt | Praxis-Anforderung fuer Team-Workflows |
| — | `Notizen: []` hinzugefuegt | Platzhalter fuer strukturierte Ergaenzungen |

## Consequences

### Positive
- Stabiles Schema von Tag 1 — keine Migration noetig
- Bases-Filter funktioniert direkt: `Status.equals("Offen")`
- Iconic zeigt automatisch Icons wenn installiert
- `Typ: Aufgabe` als Marker erlaubt Vault-weites Task-Query

### Negative
- Deutsche Property-Namen binden das Feature an deutschsprachige Vaults
- Spaetere Internationalisierung erfordert Schema-Migration (aufwendig)
- `Fälligkeit` mit Umlaut koennte in exotischen Sync-Setups Probleme machen

### Risks
- **i18n**: Wenn das Plugin international wird, muessten Task-Notes mit deutschen Properties migriert werden. Mitigation: Feature-Scope ist aktuell deutsch-only; i18n-Migration waere ein eigenes Feature.
- **Iconic-API-Aenderung**: Wenn Iconic die Frontmatter-Keys aendert, muessen wir nachziehen. Mitigation: Iconic-Keys sind seit Langem stabil (`icon`, `iconColor`).

## Implementation Notes

**Dateiname-Generierung:**

```
Tasks/{Zusammenfassung-slug}.md
```

- Slug: Sonderzeichen entfernen, Leerzeichen → Bindestrich, max 60 Zeichen
- Bei Duplikaten: Suffix `-2`, `-3` etc.
- Ordner `Tasks/` als konfigurierbarer Default in Settings

**Body-Template:**

```markdown
---
{frontmatter}
---

# {Zusammenfassung}

> Extrahiert aus Agent-Konversation am {Erstellt}

## Notizen

{Hier koennen eigene Notizen ergaenzt werden}
```

**Input Sanitization:**

- Task-Text wird vor Frontmatter-Einbettung escaped (Anführungszeichen, YAML-Sonderzeichen)
- Dateinamen werden von Dateisystem-unvertraeglichen Zeichen bereinigt (`/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`)

## Related Decisions

- [ADR-026](ADR-026-post-processing-hook.md): Hook-Pattern das die Task-Erstellung triggert
- [ADR-028](ADR-028-base-plugin-integration.md): Base-View fuer Task-Uebersicht und Iconic-Integration

## References

- FEATURE-100: Task Extraction & Management (SC-04: 10 definierte Felder)
- Iconic Plugin: Frontmatter-basierte Icon-Zuweisung
- Obsidian Bases: YAML `.base` Format mit Filter-Syntax
