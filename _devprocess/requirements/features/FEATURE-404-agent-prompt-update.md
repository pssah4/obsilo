# Feature: Agent Prompt & Skill Update

> **Feature ID**: FEATURE-404
> **Epic**: EPIC-004 - Office Document Creation
> **Priority**: P1-High
> **Effort Estimate**: S

## Feature Description

Aktualisierung der Agent-Prompts und des Sandbox-Skills, um die neuen create_*-Tools
korrekt zu referenzieren und die veralteten Sandbox-basierte Binaerdateierzeugung
zu entfernen. Stellt sicher, dass der Agent die neuen Tools konsistent nutzt statt
gescheiterte Sandbox-Versuche zu unternehmen.

## Benefits Hypothesis

**Wir glauben dass** aktualisierte Agent-Prompts und Skills
**Folgende messbare Outcomes liefert:**
- Agent waehlt die richtigen Tools fuer Office-Erzeugung (create_* statt evaluate_expression)
- Keine gescheiterten Sandbox-Versuche mehr fuer binaere Dateien

**Wir wissen dass wir erfolgreich sind wenn:**
- Agent nutzt create_pptx/docx/xlsx/pdf bei entsprechenden Anfragen
- Agent schlaegt nie mehr evaluate_expression fuer Office-Erzeugung vor

## User Stories

### Story 1: Korrekte Tool-Wahl
**Als** User
**moechte ich** dass der Agent bei "Erstelle eine Praesentation" sofort create_pptx nutzt
**um** nicht durch gescheiterte Sandbox-Versuche frustriert zu werden

---

## Success Criteria (Tech-Agnostic)

| ID | Criterion | Target | Measurement |
|----|-----------|--------|-------------|
| SC-01 | Agent waehlt das korrekte create_*-Tool bei Office-Erstellungsanfragen | >95% korrekte Tool-Wahl | Manuelle Tests mit typischen Prompts |
| SC-02 | Kein Verweis auf Sandbox-basierte Binaerdateierzeugung in Prompts | 0 verbleibende Referenzen | Code-Review der Prompt-Dateien |
| SC-03 | Skill-Dokumentation reflektiert die aktuelle Architektur | Sandbox-Skill aktualisiert | Dokumenten-Review |

---

## Technical NFRs (fuer Architekt)

### Betroffene Dateien (Scope)
- `src/core/modes/builtinModes.ts` -- Sandbox-Referenzen fuer binaere Dateien ersetzen durch create_*-Tool-Guidance
- `src/core/prompts/sections/toolDecisionGuidelines.ts` -- Regel 1c erweitern fuer Office-Formate
- `src/core/tools/toolMetadata.ts` -- Metadata fuer die 4 neuen Tools
- `bundled-skills/sandbox-environment/SKILL.md` -- Binary-Generation-Abschnitt aktualisieren

### Keine Breaking Changes
- Bestehende Sandbox-Funktionalitaet (Kalkulationen, Batch-Ops) bleibt unberuehrt
- Nur die binaere Dateierzeugung wird umgeroutet

---

## Architecture Considerations

### Architecturally Significant Requirements (ASRs)

**MODERATE ASR #1: Prompt-Konsistenz**
- **Warum ASR**: Inkonsistente Prompts fuehren zu falscher Tool-Wahl. Alle Prompt-Stellen muessen synchron aktualisiert werden.
- **Impact**: Betrifft mehrere Dateien (Modes, Guidelines, Skills)
- **Quality Attribute**: Zuverlaessigkeit

### Open Questions fuer Architekt
- Sollen die neuen Tools in die edit-Gruppe eingehaengt werden (konsistent mit write_file, create_excalidraw)?
- Soll toolDecisionGuidelines.ts eine neue Regel 1g fuer Office-Formate erhalten (analog zu 1c fuer Plugin-Formate)?

---

## Definition of Done

### Functional
- [ ] builtinModes.ts: create_*-Tools in edit-Gruppe, Sandbox-Referenzen fuer binaere Dateien entfernt
- [ ] toolDecisionGuidelines.ts: Regel fuer Office-Format-Routing ergaenzt
- [ ] toolMetadata.ts: Metadata fuer alle 4 neuen Tools
- [ ] SKILL.md: Binary-Generation-Abschnitt aktualisiert (Verweis auf Built-in Tools)

### Quality
- [ ] Agent waehlt korrekte Tools in Tests

### Documentation
- [ ] Feature-Spec aktualisiert (Status: Implemented)

---

## Dependencies

- **FEATURE-400-403**: Die create_*-Tools muessen existieren, bevor Prompts auf sie verweisen

## Assumptions

- Prompt-Aenderungen erfordern keinen neuen Build (werden zur Laufzeit generiert)

## Out of Scope

- Aenderungen an der Sandbox selbst (nur Prompt/Skill-Referenzen)
