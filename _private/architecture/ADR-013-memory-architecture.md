# ADR-013: 3-Tier Memory Architecture (Chat → Session → Long-Term)

**Status:** Akzeptiert
**Datum:** 2026-02-24
**Entscheider:** Sebastian Hanke

---

## Kontext

Der Agent soll den Nutzer ueber Sessions hinweg kennenlernen — Praeferenzen, Projekte, Kommunikationsstil. Ohne persistentes Memory startet jede Session bei Null. Die Frage ist, wie Wissen aus Gespraechen extrahiert und langfristig gespeichert wird.

Optionen:
1. Manuelles Memory (Nutzer pflegt Dateien selbst)
2. Rule-basierte Extraktion (Regex/Keyword-Matching auf Gespraeche)
3. LLM-basierte Extraktion mit 3-Tier-Pipeline
4. Embedding-basiertes Memory (alles in Vektoren)

## Entscheidung

**Option 3 — 3-Tier-Pipeline mit LLM-basierter Extraktion.**

```
Tier 1: Chat History (ConversationStore)
  - Volle Konversationen als JSON
  - Kurzfristig, pro Session

Tier 2: Session Summaries (SessionExtractor)
  - LLM-generierte Zusammenfassung nach Gespraechsende
  - Mittelfristig, eine pro Konversation
  - Semantisch durchsuchbar (MemoryRetriever)

Tier 3: Long-Term Memory (LongTermExtractor)
  - Fakten aus Sessions in persistente Dateien promoviert
  - user-profile.md, projects.md, patterns.md, soul.md
  - Langfristig, kumulativ
```

Asynchrone Verarbeitung via `ExtractionQueue` (persistente FIFO, ueberlebt Neustarts).

## Begruendung

- **LLM-Qualitaet**: LLM-Extraktion erkennt Nuancen, die Rule-based-Ansaetze verpassen (z.B. implizite Praeferenzen).
- **3-Tier-Separation**: Volle History fuer Debugging, Summaries fuer Cross-Session-Kontext, Long-Term fuer Identitaet.
- **Persistente Queue**: Wenn Obsidian waehrend der Extraktion schliesst, wird beim naechsten Start fortgesetzt.
- **Budgetierter System Prompt**: Long-Term Memory ist auf 4000 Zeichen begrenzt (800/Datei), um den System Prompt nicht zu ueberladen.
- **On-Demand Knowledge**: `knowledge.md` wird nicht in den System Prompt injiziert, sondern nur via `semantic_search` abgerufen.

## Konsequenzen

**Positiv:**
- Agent lernt organisch aus Gespraechen
- Keine manuelle Pflege noetig
- Crash-sicher dank persistenter Queue
- Memory-Dateien sind Plaintext (inspizierbar, editierbar)

**Negativ:**
- 2 LLM-Calls pro Konversation (Session + Long-Term Extraction)
- Extraktionsqualitaet haengt vom Memory-Modell ab
- Merge-Konflikte moeglich wenn Long-Term-Dateien manuell editiert werden

## Implementierung

- `src/core/memory/MemoryService.ts` — Dateien lesen/schreiben, Context Builder
- `src/core/memory/ExtractionQueue.ts` — Persistente FIFO
- `src/core/memory/SessionExtractor.ts` — Session-Zusammenfassung
- `src/core/memory/LongTermExtractor.ts` — Fakten-Promotion
- `src/core/memory/MemoryRetriever.ts` — Semantische Suche ueber Sessions
- `src/core/memory/OnboardingService.ts` — Erster Kontakt, Setup-Flow
- Storage: `.obsidian/plugins/obsidian-agent/memory/`
