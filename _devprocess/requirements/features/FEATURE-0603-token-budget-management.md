# Feature: Token-Budget-Management

> **Feature ID**: FEATURE-0603
> **Epic**: EPIC-006 - Files-to-Chat
> **Priority**: P1-High
> **Effort Estimate**: M

## Feature Description

Intelligentes Token-Budget-Management, das vor dem Senden einer Nachricht prüft, ob die angehängten Dateiinhalte das Context Window des aktiven Modells überschreiten würden. Bei Überschreitung wird der Nutzer informiert und erhält Handlungsoptionen (z.B. Datei kürzen, andere Datei wählen, Modell mit größerem Context Window empfehlen).

## Benefits Hypothesis

**Wir glauben dass** intelligentes Token-Budget-Management
**folgende messbare Outcomes liefert:**
- Nutzer erhält keine kryptischen API-Fehler bei zu großen Dateien
- Nutzer versteht, warum eine Datei ggf. nicht vollständig verarbeitet werden kann

**Wir wissen dass wir erfolgreich sind wenn:**
- Nutzer wird vor dem Senden gewarnt, wenn das Token-Budget überschritten wird
- Kein API-Fehler durch zu große Kontextdaten auftritt
- Nutzer erhält verständliche Handlungsempfehlungen

## User Stories

### Story 1: Warnung bei großer Datei
**Als** Knowledge Worker
**möchte ich** eine Warnung erhalten, wenn meine angehängte Datei das Token-Limit übersteigt
**um** rechtzeitig reagieren zu können, bevor ich auf eine Fehlermeldung stoße

**Akzeptanzkriterien:**
- Warnung erscheint nach dem Parsing, bevor die Nachricht gesendet wird
- Warnung zeigt geschätzte Token-Anzahl vs. verfügbares Budget
- Nutzer kann trotzdem senden (mit Truncation) oder abbrechen

### Story 2: Automatische Zusammenfassung bei Überschreitung
**Als** Knowledge Worker
**möchte ich** dass zu große Dateien automatisch gekürzt werden
**um** auch große Dokumente nutzen zu können, ohne sie manuell kürzen zu müssen

**Akzeptanzkriterien:**
- Bei Überschreitung wird der Inhalt intelligent gekürzt (nicht blind abgeschnitten)
- Kürzungsstrategie: Strukturerhalt (Folien-Übersicht statt vollständiger Text)
- Nutzer sieht, dass der Inhalt gekürzt wurde und welcher Anteil verarbeitet wird

### Story 3: Modell-Empfehlung
**Als** Knowledge Worker
**möchte ich** eine Empfehlung für ein geeigneteres Modell erhalten
**um** bei Bedarf ein Modell mit größerem Context Window wählen zu können

**Akzeptanzkriterien:**
- Empfehlung wird nur angezeigt, wenn ein konfiguriertes Modell mit ausreichend Context Window existiert
- Empfehlung ist ein Hinweis, kein Zwang -- Nutzer behält die Kontrolle

---

## Success Criteria (Tech-Agnostic)

| ID | Criterion | Target | Measurement |
|----|-----------|--------|-------------|
| SC-01 | Nutzer wird bei Überschreitung vor dem Senden gewarnt | 100% der Fälle | Test: 100-Seiten-PDF mit kleinem Modell |
| SC-02 | Keine unerwarteten Fehler durch zu große Kontextdaten | 0 Fehler | Test: Verschiedene Dateigrößen mit verschiedenen Modellen |
| SC-03 | Warnung ist verständlich und actionable | Nutzer versteht sofort das Problem | Usability-Prüfung: Text der Warnung |
| SC-04 | Große Dateien können gekürzt verarbeitet werden | Gekürzte Fassung enthält Kernstruktur | Test: 100-Folien PPTX -> Folientitel-Übersicht statt Volltext |

---

## Technical NFRs (für Architekt) - MIT TECHNOLOGIE OK

### Performance
- **Token-Schätzung**: < 100ms für extrahierte Texte (Heuristik, nicht exakter Tokenizer)
- **Kein doppeltes Parsing**: Token-Schätzung arbeitet auf bereits extrahiertem Text

### Token-Estimation
- **Heuristik**: ~4 Zeichen pro Token als Schätzung (modellübergreifend brauchbar)
- **Context Window**: Aus `ModelInfo.contextWindow` des aktiven Modells
- **Reservierung**: 30% des Context Windows für System Prompt + Konversation + Agent-Antwort reservieren

### Truncation-Strategien
- **PPTX**: Erst Sprechernotizen entfernen, dann Detailtext pro Folie kürzen, zuletzt auf Folientitel reduzieren
- **XLSX**: Maximale Zeilenanzahl pro Sheet, dann Sheet-Summaries
- **DOCX/PDF**: Seitenweise kürzen von hinten, Inhaltsverzeichnis erhalten
- **Datenformate**: Maximale Zeilen-/Elementanzahl

---

## Architecture Considerations

### Architecturally Significant Requirements (ASRs)

**MODERATE ASR #1: Token-Budget-Berechnung**
- **Warum ASR**: Muss mit dem Context Window verschiedener Modelle (Claude, GPT, etc.) korrekt arbeiten und System-Prompt-Reservierung berücksichtigen
- **Impact**: Benötigt Zugriff auf `ModelInfo.contextWindow` und aktuelle Konversationslänge
- **Quality Attribute**: Reliability, Accuracy

### Constraints
- **Modellübergreifend**: Muss mit allen unterstützten Providern funktionieren
- **Keine externe Tokenizer-Library**: Heuristik statt exakter Berechnung (Bundlegröße)

### Open Questions für Architekt
- Soll der Token-Budget-Check ein Middleware-Schritt in der bestehenden Pipeline sein oder ein eigenständiger Pre-Send-Hook?
- Wie wird die aktuelle Konversationslänge in Token geschätzt (bestehende Messages)?
- Soll Truncation pro Datei oder über alle Attachments hinweg budgetiert werden?

---

## Definition of Done

### Functional
- [ ] Token-Schätzung für extrahierte Texte implementiert
- [ ] Warnung bei Überschreitung vor dem Senden
- [ ] Truncation-Strategien für alle Formate
- [ ] Modell-Empfehlung bei kleinem Context Window

### Quality
- [ ] Tests: Verschiedene Dateigrößen x verschiedene Modelle
- [ ] Kein false-positive (Warnung obwohl genug Budget)
- [ ] Kein false-negative (kein API-Fehler trotz fehlendem Budget)

### Documentation
- [ ] Feature-Spec aktualisiert (Status: Implemented)
- [ ] Truncation-Strategien dokumentiert

---

## Dependencies

- **FEATURE-0601**: Token-Budget arbeitet auf den extrahierten Texten der Parsing-Pipeline
- **Provider-Config**: Benötigt `ModelInfo.contextWindow` für das aktive Modell

## Assumptions

- ~4 Zeichen/Token ist eine brauchbare modellübergreifende Heuristik
- 30% Reservierung für System Prompt + Konversation reicht für typische Dialoge
- Truncation muss nicht perfekt sein -- besser gekürzt als gar nicht verarbeitet

## Out of Scope

- Exakter Tokenizer (tiktoken, etc.) -- zu große Library für Heuristik-Nutzen
- Streaming-basierte Token-Zählung während des Parsings
