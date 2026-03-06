# Feature: Modell-Kompatibilitäts-Check

> **Feature ID**: FEATURE-0605
> **Epic**: EPIC-006 - Files-to-Chat
> **Priority**: P1-High
> **Effort Estimate**: S

## Feature Description

Prüft ob das aktive Modell die benötigten Capabilities für die angehängten Dateien unterstützt. Wenn z.B. eine PPTX mit Bildern angehängt wird, aber das aktive Modell kein Vision unterstützt, erhält der Nutzer einen informativen Hinweis mit einer Empfehlung für ein geeignetes Modell. Der Check ist rein beratend -- der Nutzer kann trotzdem senden (Text-Verarbeitung funktioniert immer).

## Benefits Hypothesis

**Wir glauben dass** ein Modell-Kompatibilitäts-Check
**folgende messbare Outcomes liefert:**
- Nutzer versteht sofort, warum bestimmte Funktionen eingeschränkt sind
- Nutzer kann proaktiv das passende Modell wählen, statt auf ein unvollständiges Ergebnis zu stoßen

**Wir wissen dass wir erfolgreich sind wenn:**
- Nutzer mit inkompatiblem Modell erhält einen Hinweis vor dem Senden
- Hinweis enthält eine konkrete Modell-Empfehlung
- Kein Nutzer wird am Senden gehindert (Hinweis, kein Blocker)

## User Stories

### Story 1: Vision-Hinweis bei PPTX mit Bildern
**Als** Knowledge Worker
**möchte ich** einen Hinweis erhalten, wenn mein Modell die Bilder in meiner Präsentation nicht auswerten kann
**um** entscheiden zu können, ob ich das Modell wechsle oder mit reiner Textanalyse zufrieden bin

**Akzeptanzkriterien:**
- Hinweis erscheint nach dem Anhängen einer PPTX mit Bildern bei Nicht-Vision-Modell
- Hinweis benennt das fehlende Capability (Vision)
- Hinweis schlägt ein konfiguriertes Vision-fähiges Modell vor
- Nutzer kann den Hinweis schließen und trotzdem senden

### Story 2: Allgemeiner Capability-Check
**Als** Community Power User
**möchte ich** dass das Plugin mir sagt, wenn mein Modell bestimmte Funktionen nicht unterstützt
**um** nicht auf kryptische API-Fehler zu stoßen

**Akzeptanzkriterien:**
- Check prüft relevante Capabilities: Vision, Context Window Größe
- Hinweis ist nicht-blockierend (Notice/Banner, kein Modal)
- Hinweis verschwindet wenn Nutzer Modell wechselt oder Attachment entfernt

---

## Success Criteria (Tech-Agnostic)

| ID | Criterion | Target | Measurement |
|----|-----------|--------|-------------|
| SC-01 | Nutzer wird bei inkompatiblem Modell informiert | 100% der erkennbaren Fälle | Test: Nicht-Vision-Modell + PPTX mit Bildern |
| SC-02 | Hinweis enthält konkrete Handlungsempfehlung | Modell-Name im Hinweis | Manueller Test: Hinweis-Text prüfen |
| SC-03 | Hinweis blockiert den Workflow nicht | Senden trotzdem möglich | Test: Hinweis schließen und senden |
| SC-04 | Falscher Alarm vermieden | 0 false positives | Test: Vision-Modell + PPTX -> kein Hinweis |

---

## Technical NFRs (für Architekt) - MIT TECHNOLOGIE OK

### Performance
- **Check-Dauer**: < 10ms (reine Konfig-Abfrage, kein API-Call)

### Provider-Capabilities
- **Vision-Support**: Aus ModelInfo oder Provider-Konfiguration ableitbar
- **Context Window**: Bereits in `ModelInfo.contextWindow` vorhanden
- **Erweiterbarkeit**: Neue Capabilities (z.B. Tool-Use, Structured Output) ohne Code-Änderung hinzufügbar

### UI
- **Hinweis-Typ**: Obsidian `Notice` oder dezenter Banner im Chat-Input-Bereich
- **Dismissable**: Nutzer kann Hinweis schließen

---

## Architecture Considerations

### Architecturally Significant Requirements (ASRs)

**MODERATE ASR #1: Provider-Capability-Registry**
- **Warum ASR**: Capabilities müssen pro Provider/Modell-Kombination bekannt sein, ohne hardcoded Listen
- **Impact**: Benötigt eine erweiterbare Capability-Map in der Provider-Konfiguration
- **Quality Attribute**: Extensibility, Maintainability

### Constraints
- **Kein API-Call**: Check muss rein lokal auf Basis der Konfiguration funktionieren
- **Multi-Provider**: Muss mit Allen unterstützten Providern (Anthropic, OpenAI, etc.) funktionieren

### Open Questions für Architekt
- Wo wird die Capability-Map gespeichert? In `ModelInfo` erweitert oder separate Registry?
- Soll der Hinweis im Chat-Input-Bereich oder als Obsidian Notice erscheinen?
- Ist `supportsVision` ein neues Feld in `ModelInfo` oder wird es aus dem Model-Namen heuristisch abgeleitet?

---

## Definition of Done

### Functional
- [ ] Vision-Check bei PPTX mit eingebetteten Bildern
- [ ] Context-Window-Check (Überschneidung mit FEATURE-0603)
- [ ] Modell-Empfehlung basierend auf konfigurierten Modellen
- [ ] Nicht-blockierender Hinweis mit Schließen-Option

### Quality
- [ ] Test: Verschiedene Modell/Datei-Kombinationen
- [ ] Kein false positive
- [ ] Review-Bot Compliance geprüft

### Documentation
- [ ] Feature-Spec aktualisiert (Status: Implemented)

---

## Dependencies

- **Provider-Config**: `ModelInfo` muss um Vision-Capability erweiterbar sein
- **FEATURE-0604**: On-Demand Bild-Extraktion nutzt den Capability-Check

## Assumptions

- Vision-Fähigkeit kann aus Modellname/Provider zuverlässig abgeleitet werden
- Die Liste konfigurierter Modelle ist aus den Settings abrufbar
- Claude 3.5 Sonnet+ und GPT-4V+ unterstützen Vision

## Out of Scope

- Automatischer Modell-Wechsel (Nutzer entscheidet immer selbst)
- Provider/Modell-spezifische Feature-Matrix-UI in den Settings
