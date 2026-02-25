# ADR-012: Context Condensing Strategy (Keep-First-Last)

**Status:** Akzeptiert
**Datum:** 2026-02-24
**Entscheider:** Sebastian Hanke

---

## Kontext

Lange Agent-Sessions koennen das Context Window des LLM ueberschreiten. Ohne Gegenmassnahme bricht der API-Call mit einem Token-Limit-Fehler ab. Es braucht eine Strategie, um die Konversationshistorie zu komprimieren, ohne kritischen Kontext zu verlieren.

Optionen:
1. Sliding Window (aelteste Nachrichten entfernen)
2. LLM-basierte Zusammenfassung des mittleren Teils
3. RAG-basierter Kontext-Abruf (nur relevante Nachrichten)
4. Kombiniert: Keep-First + Keep-Last + LLM-Summarize-Middle

## Entscheidung

**Option 4 — Keep-First-Last mit LLM-Summarize-Middle.**

Trigger: Geschaetzte Token-Zahl > `condensingThreshold` % des Context Windows (Default: 80%).

Algorithmus:
1. Behalte die erste User-Nachricht (Original-Aufgabe)
2. Behalte die letzten 4 Nachrichten (aktueller Kontext)
3. Komprimiere den mittleren Teil via LLM-Call in eine Zusammenfassung
4. Ersetze die History mit: [erste Nachricht, Zusammenfassung als User-Message, letzte 4 Nachrichten]

## Begruendung

- **Aufgaben-Kontext bleibt erhalten**: Die erste Nachricht definiert die Aufgabe — ihr Verlust fuehrt zu Orientierungsverlust.
- **Aktueller Zustand bleibt erhalten**: Die letzten 4 Nachrichten enthalten den aktuellen Arbeitskontext und letzte Tool-Results.
- **LLM-Qualitaet**: Eine LLM-Zusammenfassung ist deutlich besser als simples Abschneiden.
- **Token-Schaetzung statt exakter Zaehlung**: `estimateTokenCount()` nutzt eine 4-Chars-pro-Token-Heuristik. Exaktes Tokenizing waere zu langsam fuer Echtzeit-Checks.
- **Kilo Code Referenz**: Uebernimmt die Strategie aus der Kilo-Code-Referenz.

## Konsequenzen

**Positiv:**
- Agent kann beliebig lange Sessions fuehren
- Kein abrupter Abbruch bei vollem Kontext
- Nutzer wird benachrichtigt (onContextCondensed Callback)

**Negativ:**
- Ein LLM-Call fuer die Zusammenfassung (Latenz + Kosten)
- Detail-Verlust in der Mitte der Konversation
- Token-Schaetzung kann ungenau sein (besonders bei nicht-lateinischen Sprachen)

## Implementierung

- `src/core/AgentTask.ts` — `maybeCondenseContext()`, Token-Schaetzung, Threshold-Check
- Settings: `condensingEnabled` (boolean), `condensingThreshold` (50-95, Default 80)
