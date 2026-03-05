# Feature: Semantisches Chat-Titling

> **Feature ID**: FEATURE-302
> **Epic**: EPIC-003 - Chat-Linking
> **Priority**: P1-High
> **Effort Estimate**: S

## Feature Description

Ersetzt das aktuelle Chat-Titling (erste 60 Zeichen der User-Nachricht) durch einen LLM-generierten semantischen Titel (3-8 Wörter). Der Titel-Call läuft im Hintergrund nach der ersten Assistant-Antwort. Bei Fehlern (Netzwerk, Rate-Limit) bleibt der bestehende Fallback aktiv. Das Modell ist über ein eigenes Setting (`titlingModelKey`) frei wählbar, sodass der Nutzer ein besonders günstiges Modell (z.B. Haiku, Flash) dafür einsetzen kann.

## Benefits Hypothesis

**Wir glauben dass** semantische Chat-Titel
**folgende messbare Outcomes liefert:**
- Schnelleres Wiederfinden von Chats in der History (Titel beschreibt den Kern)
- Lesbare Frontmatter-Links (Titel statt kryptischer Abschnitte)
- Vergleichbare UX wie ChatGPT/Claude.ai

**Wir wissen dass wir erfolgreich sind wenn:**
- Chat-Titel den Kern der Konversation in 3-8 Wörtern erfassen
- Bei LLM-Fehlern der Fallback zuverlässig greift

## User Stories

### Story 1: Aussagekräftiger Titel
**Als** Konzeptarbeiter
**möchte ich** dass meine Chats automatisch einen beschreibenden Titel bekommen
**um** in der History und im Frontmatter sofort zu erkennen, worum es im Chat ging

### Story 2: Zuverlässiger Fallback
**Als** Nutzer
**möchte ich** dass auch bei Netzwerkproblemen ein sinnvoller Titel angezeigt wird
**um** nie einen Chat ohne Titel zu sehen

---

## Success Criteria (Tech-Agnostic)

> KEINE Technologie-Begriffe erlaubt!

| ID | Criterion | Target | Measurement |
|----|-----------|--------|-------------|
| SC-01 | Chat-Titel erfasst den semantischen Kern der Konversation | 3-8 Wörter, inhaltlich treffend | 10 Chats starten, Titel auf Aussagekraft prüfen |
| SC-02 | Titel erscheint ohne merkbare Verzögerung in der History | < 3 Sekunden nach erster Antwort | Stopwatch-Messung |
| SC-03 | Bei Fehler greift automatisch ein Ersatztitel | 100% der Fälle zeigen einen Titel | Netzwerk unterbrechen, Chat starten |
| SC-04 | Titelvergabe läuft im Hintergrund und blockiert nicht den Chat | 0 wahrnehmbare Verzögerung | Chat weitertippen während Titel generiert wird |
| SC-05 | Titel-Generierung verursacht keine spürbare Kostensteigerung | < 300 Tokens pro Titel | Provider-Dashboard prüfen |

---

## Technical NFRs (für Architekt) - MIT TECHNOLOGIE OK

> Diese Section DARF technische Details enthalten!

### Performance
- **LLM-Call-Dauer**: Abhängig vom Modell (memoryModelKey), erwartbar < 2s
- **Non-blocking**: Fire-and-forget (void), blockiert weder Chat noch UI
- **Ein Call pro Chat**: Nur bei `uiMessages.length <= 2` (nach erster Antwort)

### Resilience
- **Fallback**: Erste 60 Zeichen der User-Nachricht, sofort gespeichert vor LLM-Call
- **Error-Handling**: try-catch, non-fatal, Fallback bleibt bestehen
- **Kein Retry**: Bei Fehler kein automatischer Wiederholungsversuch

### Cost
- **Modell**: Eigenes Setting `titlingModelKey` (frei wählbar, z.B. Haiku/Flash)
- **Prompt-Size**: ~200-300 Tokens (User-Nachricht + erste Antwort + System-Prompt)
- **Frequency**: 1x pro Chat-Session

### Integration
- **AgentSidebarView**: Neue private Methode `generateSemanticTitle()`
- **ConversationStore**: `updateMeta(id, { title })` für Titelupdate
- **API-Handler**: Neue `generateTitle()` Methode am per `titlingModelKey` konfigurierten Handler
- **Settings**: Neues Setting `titlingModelKey` mit Modell-Dropdown (analog zu `memoryModelKey`)

---

## Architecture Considerations

### Architecturally Significant Requirements (ASRs)

MODERATE ASR #1: API-Erweiterung für Titling
- **Warum ASR**: Neuer LLM-Aufruftyp (weder Chat-Completion noch Memory-Extraktion); braucht eigenen Prompt und Antwort-Parsing
- **Impact**: `generateTitle()` Methode im API-Handler; Prompt-Design für konsistente Titel
- **Quality Attribute**: Extensibility, Usability

### Constraints
- **titlingModelKey**: Muss konfiguriert sein; wenn nicht, kein Titling (nur Fallback)
- **Plugin Review-Bot**: Kein `console.log` für Debugging; `console.debug` verwenden

### Open Questions für Architekt
- Soll `generateTitle()` in den bestehenden API-Handler oder als separate Utility?
- Prompt-Design: Nur User-Nachricht oder User + Assistant für besseren Kontext?

---

## Definition of Done

### Functional
- [ ] Chat erhält nach erster Antwort einen LLM-generierten Titel
- [ ] Titel ist 3-8 Wörter lang und semantisch aussagekräftig
- [ ] Fallback (60 Zeichen) greift bei LLM-Fehler
- [ ] Fallback ist sofort gespeichert, bevor LLM-Call startet
- [ ] Titling blockiert nicht die Chat-Interaktion
- [ ] Titling nutzt das über `titlingModelKey` konfigurierte Modell, nicht das Hauptmodell

### Quality
- [ ] 10 Test-Chats: Titel auf Aussagekraft prüfen
- [ ] Regression: Bestehende Chat-History unverändert
- [ ] Build läuft fehlerfrei durch

### Documentation
- [ ] Feature-Spec aktualisiert (Status: Implemented)

---

## Dependencies

- **FEATURE-303 (Setting)**: Stellt `titlingModelKey` Modell-Dropdown bereit
- **ConversationStore**: `updateMeta()` existiert bereits
- **FEATURE-301 (Auto-Frontmatter-Linking)**: Nutzt den generierten Titel; ohne Titling funktioniert der Fallback
- **Bestehende Modell-Infrastruktur**: Analog zu `memoryModelKey` (Dropdown, Provider-Resolution)

## Assumptions

- `titlingModelKey` ist in den meisten Setups konfiguriert (Nutzer wählt günstiges Modell)
- Ein Mini-Prompt von ~200 Tokens reicht für gute Titelqualität
- Obsidian Properties-View zeigt den Titel korrekt an (Markdown-Link-Syntax)

## Out of Scope

- Re-Titling nach weiteren Nachrichten
- Nutzereditor für manuelle Titelanpassung
- Titel-Generierung für bestehende (alte) Chats
