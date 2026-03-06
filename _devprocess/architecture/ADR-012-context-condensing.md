# ADR-012: Context Condensing Strategy (Keep-First-Last)

**Status:** Akzeptiert (aktualisiert 2026-03-01: Default=true, Emergency Condensing)
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

Trigger: Geschaetzte Token-Zahl > `condensingThreshold` % des Context Windows (Default: 70%).

Algorithmus:
1. Behalte die erste User-Nachricht (Original-Aufgabe)
2. Smart Tail: Behalte die letzten Nachrichten (bis zu 10k Tokens, min. 2 Nachrichten)
3. Komprimiere den mittleren Teil via LLM-Call in eine Zusammenfassung (mit Tool-Call-Ledger)
4. Ersetze die History mit: [erste Nachricht, Zusammenfassung als User-Message, ...tail]
5. Multi-pass: Bis zu 2 Retries falls nach erstem Pass immer noch ueber Threshold

## Begruendung

- **Aufgaben-Kontext bleibt erhalten**: Die erste Nachricht definiert die Aufgabe — ihr Verlust fuehrt zu Orientierungsverlust.
- **Aktueller Zustand bleibt erhalten**: Smart Tail (bis zu 10k Tokens, min 2 Nachrichten) enthaelt den aktuellen Arbeitskontext und letzte Tool-Results.
- **LLM-Qualitaet**: Eine LLM-Zusammenfassung ist deutlich besser als simples Abschneiden.
- **Token-Schaetzung statt exakter Zaehlung**: `estimateTokenCount()` nutzt eine 4-Chars-pro-Token-Heuristik. Exaktes Tokenizing waere zu langsam fuer Echtzeit-Checks.
- **Kilo Code Referenz**: Uebernimmt die Strategie aus der Kilo-Code-Referenz.

## Emergency Condensing (Ergaenzung 2026-03-01)

Zusaetzlich zum proaktiven Threshold-Check gibt es einen reaktiven Catch-Block:

Wenn der API-Call mit einem 400-Fehler fehlschlaegt (Patterns: `context_length_exceeded`, `prompt too long`, `too many tokens`, `token limit`, `request too large`), und die History mindestens 7 Nachrichten hat, wird `condenseHistory()` als Notfall-Massnahme ausgefuehrt. Bei Erfolg wird der User informiert ("Konversation wurde komprimiert — bitte letzte Nachricht erneut senden"). Bei Fehlschlag greift der normale Error-Handler.

Dies verhindert den Totalabbruch des Tasks bei unvorhergesehener Context-Ueberschreitung (z.B. sehr grosse Tool-Results in einem einzigen Turn).

## Konsequenzen

**Positiv:**
- Agent kann beliebig lange Sessions fuehren
- Kein abrupter Abbruch bei vollem Kontext
- Nutzer wird benachrichtigt (onContextCondensed Callback)
- Emergency Condensing faengt unvorhergesehene 400-Fehler ab

**Negativ:**
- Ein LLM-Call fuer die Zusammenfassung (Latenz + Kosten)
- Detail-Verlust in der Mitte der Konversation
- Token-Schaetzung kann ungenau sein (besonders bei nicht-lateinischen Sprachen)

## Implementierung

- `src/core/AgentTask.ts` — `condenseHistory()`, Token-Schaetzung, Threshold-Check, Emergency Condensing im Catch-Block
- Settings: `condensingEnabled` (boolean, Default: true), `condensingThreshold` (50-95, Default 70)
- Emergency Condensing: Auto-Retry statt Abbruch — nach erfolgreicher Notfall-Komprimierung wird der Agent-Loop automatisch fortgesetzt (max. 1 Retry)
- Pre-Compaction Memory Flush wird auch vor Emergency Condensing ausgefuehrt
