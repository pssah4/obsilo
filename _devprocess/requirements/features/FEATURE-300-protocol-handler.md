# Feature: Protocol Handler (Deep-Links)

> **Feature ID**: FEATURE-300
> **Epic**: EPIC-003 - Chat-Linking
> **Priority**: P0-Critical
> **Effort Estimate**: S

## Feature Description

Obsidian registriert einen Protocol Handler für das URI-Schema `obsidian://obsilo-chat?id=...`. Wenn der Nutzer einen solchen Link klickt (z.B. im Properties-View einer Note), öffnet sich die Sidebar und der zugehörige Chat wird vollständig wiederhergestellt. Der Handler reagiert graceful, wenn die referenzierte Conversation nicht mehr existiert (z.B. nach History-Löschung).

## Benefits Hypothesis

**Wir glauben dass** ein klickbarer Deep-Link-Mechanismus für Chats
**folgende messbare Outcomes liefert:**
- Rücksprung in Chat-Kontexte ohne manuelles History-Durchsuchen
- Nahtlose Fortführung von Diskussionen über Sessions hinweg

**Wir wissen dass wir erfolgreich sind wenn:**
- Ein Klick auf den Link den richtigen Chat öffnet
- Der Nutzer den Chat sofort fortsetzen oder nachschlagen kann

## User Stories

### Story 1: Chat per Link öffnen
**Als** Konzeptarbeiter
**möchte ich** einen Link im Frontmatter einer Note anklicken können
**um** direkt in den Chat zurückzuspringen, in dem die Note bearbeitet wurde

### Story 2: Graceful Handling bei gelöschtem Chat
**Als** Vault-Organisator
**möchte ich** eine verständliche Rückmeldung sehen, wenn ein Chat nicht mehr existiert
**um** nicht vor einer leeren Sidebar zu stehen

---

## Success Criteria (Tech-Agnostic)

> KEINE Technologie-Begriffe erlaubt!

| ID | Criterion | Target | Measurement |
|----|-----------|--------|-------------|
| SC-01 | Klick auf Chat-Verweis in einer Note öffnet den zugehörigen Chat | 100% Erfolgsrate bei existierender Conversation | Manueller Test: 5 verschiedene Conversations |
| SC-02 | Chat wird vollständig wiederhergestellt (Verlauf sichtbar, fortsetzbar) | Alle Nachrichten sichtbar, Eingabefeld aktiv | Visueller Check nach Öffnung |
| SC-03 | Bei nicht existierender Conversation erscheint verständliche Rückmeldung | Kein leerer Zustand, keine Fehlermeldung | Test mit gelöschter History |
| SC-04 | Kein manuelles Suchen in der History nötig | 0 Schritte zwischen Klick und Chat-Ansicht | User-Journey-Vergleich |

---

## Technical NFRs (für Architekt) - MIT TECHNOLOGIE OK

> Diese Section DARF technische Details enthalten!

### Performance
- **Link-to-Chat-Öffnung**: < 500ms (Sidebar aktivieren + Conversation laden)
- **Conversation-Restore**: Bestehende `loadConversation`-Performance (bereits implementiert)

### Resilience
- **Fehlende Conversation**: Graceful Notice statt Error/leerer Zustand
- **Malformed ID**: Ignorieren, kein Crash

### Compatibility
- **Obsidian API**: `registerObsidianProtocolHandler('obsilo-chat', ...)` -- nur innerhalb Obsidian
- **Plugin Review-Bot**: Kein `innerHTML`, keine verbotenen Patterns

---

## Architecture Considerations

### Architecturally Significant Requirements (ASRs)

MODERATE ASR #1: Protocol Handler Registrierung
- **Warum ASR**: Neuer Plugin-Lifecycle-Hook in main.ts; muss Sidebar-Aktivierung und Conversation-Laden orchestrieren
- **Impact**: Erfordert public `loadConversationById()` Methode in AgentSidebarView
- **Quality Attribute**: Usability, Resilience

### Constraints
- **Nur innerhalb Obsidian**: Keine Unterstützung für externe Aufrufe (Browser, andere Apps)
- **Plugin Review-Bot**: Compliance mit allen Obsidian-Richtlinien

### Open Questions für Architekt
- Soll `loadConversationById()` einen laufenden Chat abbrechen oder den Nutzer warnen?

---

## Definition of Done

### Functional
- [ ] Link `obsidian://obsilo-chat?id=<id>` öffnet den Chat in der Sidebar
- [ ] Chat wird vollständig wiederhergestellt (History + UI Messages)
- [ ] Graceful Handling bei nicht existierender Conversation
- [ ] Graceful Handling bei malformed/leerer ID

### Quality
- [ ] Manueller Test mit 5+ verschiedenen Conversations
- [ ] Regression: Bestehende Chat-History-Funktionalität unverändert
- [ ] Build läuft fehlerfrei durch

### Documentation
- [ ] Feature-Spec aktualisiert (Status: Implemented)

---

## Dependencies

- **ConversationStore**: `loadConversation()` und Existenz-Check
- **AgentSidebarView**: Neue public Methode `loadConversationById()`
- **main.ts**: Plugin-Lifecycle-Integration

## Assumptions

- `registerObsidianProtocolHandler` unterstützt custom Prefixes wie `obsilo-chat`
- Sidebar kann programmatisch aktiviert werden (`activateView()`)
- ConversationStore hat eine Methode zur Existenz-Prüfung (oder `loadConversation` gibt null zurück)

## Out of Scope

- Externe Deep-Links (Browser, andere Apps)
- Navigation innerhalb des Chats (z.B. zu einer bestimmten Nachricht)
