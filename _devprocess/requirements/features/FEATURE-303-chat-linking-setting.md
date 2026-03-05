# Feature: Chat-Linking Setting

> **Feature ID**: FEATURE-303
> **Epic**: EPIC-003 - Chat-Linking
> **Priority**: P2-Medium
> **Effort Estimate**: S

## Feature Description

Zwei Settings für Chat-Linking:
1. **Globaler Toggle** (`chatLinking`): An/Aus für Frontmatter-Stamping und semantisches Titling. Default aktiviert.
2. **Modell-Auswahl** (`titlingModelKey`): Dropdown zur Wahl des Modells für Titel-Generierung. Der Nutzer kann ein besonders günstiges Modell (z.B. Haiku, Flash) wählen, um Kosten minimal zu halten.

Platzierung in Settings > Interface.

## Benefits Hypothesis

**Wir glauben dass** ein globaler Toggle für Chat-Linking
**folgende messbare Outcomes liefert:**
- Nutzer hat Kontrolle über Frontmatter-Modifikation
- Opt-out für Nutzer, die kein Frontmatter-Stamping wollen

**Wir wissen dass wir erfolgreich sind wenn:**
- Toggle schaltet Linking zuverlässig ab/an
- Bestehende Links bleiben bei Deaktivierung erhalten (kein Cleanup)

## User Stories

### Story 1: Linking deaktivieren
**Als** Nutzer
**möchte ich** Chat-Linking global abschalten können
**um** mein Frontmatter sauber zu halten, wenn ich das Feature nicht benötige

### Story 2: Linking aktivieren
**Als** Konzeptarbeiter
**möchte ich** Chat-Linking aktiviert haben (Default)
**um** automatisch Traceability zu bekommen, ohne es manuell einschalten zu müssen

### Story 3: Günstiges Modell wählen
**Als** kostenbewusster Nutzer
**möchte ich** selbst bestimmen, welches Modell für die Titel-Generierung verwendet wird
**um** ein möglichst günstiges Modell wie Haiku oder Flash einzusetzen und Kosten zu kontrollieren

---

## Success Criteria (Tech-Agnostic)

> KEINE Technologie-Begriffe erlaubt!

| ID | Criterion | Target | Measurement |
|----|-----------|--------|-------------|
| SC-01 | Deaktivierung verhindert neue Verweise im Frontmatter | 0 neue Links nach Deaktivierung | 3 Writes bei deaktiviertem Setting |
| SC-02 | Bestehende Verweise bleiben bei Deaktivierung erhalten | 0 gelöschte Links | Frontmatter vor/nach prüfen |
| SC-03 | Feature ist standardmäßig aktiviert | Default = aktiviert | Frische Installation prüfen |
| SC-04 | Toggle ist ohne Neustart wirksam | Sofortige Wirkung | Setting ändern, sofort Write testen |
| SC-05 | Nutzer kann das Modell für Titel-Generierung frei wählen | Dropdown mit allen konfigurierten Modellen | Settings öffnen, Modell wechseln, Titel prüfen |

---

## Technical NFRs (für Architekt) - MIT TECHNOLOGIE OK

> Diese Section DARF technische Details enthalten!

### Implementation
- **Setting-Key 1**: `chatLinking: boolean` (Default: `true`)
- **Setting-Key 2**: `titlingModelKey: string` (Default: leer / nicht konfiguriert)
- **Platzierung**: Settings > Interface, unterhalb des History-Bereichs
- **Wirkungsbereich Toggle**: Frontmatter-Stamping + Semantisches Titling
- **Wirkungsbereich Modell**: Nur semantisches Titling (FEATURE-302)

### Integration
- **Pipeline-Check**: `if (settings.chatLinking === true)` vor Stamp-Hook
- **AgentSidebarView-Check**: `if (settings.chatLinking === true)` vor `generateSemanticTitle()`
- **Modell-Resolution**: `titlingModelKey` -> Provider + Modell -> API-Handler (analog zu `memoryModelKey`)
- **Kein Cleanup**: Bestehende `obsilo-chats`-Einträge werden bei Deaktivierung nicht entfernt

---

## Architecture Considerations

Keine ASRs -- einfaches Boolean-Setting mit Standardpattern.

### Constraints
- **Plugin Review-Bot**: CSS-Klassen statt `element.style` für Toggle-UI
- **i18n**: Label und Description in allen 6 Sprachen

### Open Questions für Architekt
- Keine

---

## Definition of Done

### Functional
- [ ] Setting `chatLinking` in Settings > Interface vorhanden
- [ ] Setting `titlingModelKey` mit Modell-Dropdown in Settings > Interface vorhanden
- [ ] Default Toggle: `true`
- [ ] Default Modell: nicht konfiguriert (Fallback greift)
- [ ] Deaktivierung verhindert Frontmatter-Stamping
- [ ] Deaktivierung verhindert semantisches Titling
- [ ] Bestehende Links bleiben bei Deaktivierung erhalten
- [ ] Sofort wirksam (kein Neustart)
- [ ] Modell-Wechsel wirkt ab dem nächsten Chat

### Quality
- [ ] i18n: Labels in allen 6 Sprachen
- [ ] Regression: Settings-UI unverändert
- [ ] Build läuft fehlerfrei durch

### Documentation
- [ ] Feature-Spec aktualisiert (Status: Implemented)

---

## Dependencies

- **FEATURE-301 (Auto-Frontmatter-Linking)**: Setting steuert den Hook
- **FEATURE-302 (Semantisches Titling)**: Setting steuert die Titling-Logik
- **Settings-Infrastruktur**: `src/types/settings.ts`, `src/ui/settings/InterfaceTab.ts`

## Assumptions

- Boolean-Settings werden sofort aus dem Settings-Object gelesen (kein Cache)
- Modell-Dropdown kann analog zu `memoryModelKey` implementiert werden (Pattern existiert)

## Out of Scope

- Granulare Steuerung (pro Ordner, pro Mode)
- Separate Toggles für Titling und Linking
- Kostenvorschau oder Token-Tracking im UI
