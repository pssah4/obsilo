# ADR-016: Rich Tool Descriptions in ToolMeta

**Status**: Accepted
**Date**: 2026-02-25
**Feature**: FEATURE-skill-mastery (Phase 1)

## Context

Die 36 Tools haben nur Einzeiler-Beschreibungen in `toolMetadata.ts`. Das LLM muss bei jedem Aufruf raten, welches Tool fuer eine Aufgabe geeignet ist und wie es korrekt aufgerufen wird. Anthropics "Writing Tools for Agents" Forschung zeigt: "Kleine Verfeinerungen an Tool-Beschreibungen koennen dramatische Verbesserungen bringen."

## Decision

Tool-Beschreibungen werden direkt im bestehenden `ToolMeta` Interface erweitert statt eine separate Prompt-Sektion zu erstellen.

Neue optionale Felder:
- `example: string` — Konkreter Aufruf mit realistischen Parametern
- `whenToUse: string` — Wann dieses Tool gegenueber Alternativen bevorzugen
- `commonMistakes: string` — Haeufige LLM-Fehler die vermieden werden sollen

## Alternatives Considered

1. **Separate Prompt-Sektion "Tool Examples"**: Wuerde doppelte Datenhaltung erzeugen und ist nicht mode-gefiltert.
2. **Few-Shot Examples in Conversation History**: Verbraucht Context-Budget und wird bei Condensing geloescht.
3. **Separate JSON/YAML-Dateien pro Tool**: Fragmentiert die Single Source of Truth.

## Consequences

- `toolMetadata.ts` bleibt Single Source of Truth fuer alle Tool-Informationen
- Mode-Filterung funktioniert automatisch (Ask-Mode sieht nur read/vault/agent Examples)
- Subtask-Prompts koennen Examples via Flag deaktivieren (Token-Einsparung)
- `buildToolPromptSection()` wird erweitert, keine neue Funktion noetig
- Geschaetzter Prompt-Zuwachs: ~2000-3000 chars bei Agent-Mode

## References

- Anthropic: "Writing Tools for Agents" (2025)
- Voyager: Tool descriptions with NL examples (NeurIPS 2023)
