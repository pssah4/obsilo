# ADR-006: Sliding Window für Tool-Repetition-Erkennung

**Status:** Akzeptiert
**Datum:** 2026-02-19
**Entscheider:** Sebastian Hanke

---

## Kontext

LLMs können in Endlosschleifen geraten — sie rufen dasselbe Tool mit identischen Parametern wiederholt auf, ohne Fortschritt zu machen. Der Agent muss solche Loops erkennen und unterbrechen.

Optionen:
1. **Konsekutiv-Zähler**: Loop wird erkannt wenn Tool N-mal direkt hintereinander aufgerufen wird
2. **Sliding Window**: Loop wird erkannt wenn Tool N-mal innerhalb der letzten M Calls auftritt (nicht notwendigerweise konsekutiv)
3. **Hash-basiert + Timeout**: Jede Tool+Input-Kombination erhält einen Zeitstempel, Loop wenn innerhalb X Sekunden N-mal

## Entscheidung

**Option 2 — Sliding Window** mit Fenstergröße 10 und Threshold 3.

```typescript
private recentCalls: string[] = []; // max 10 Einträge
check(toolName, input): boolean {
    const key = `${toolName}:${JSON.stringify(input)}`;
    this.recentCalls.push(key);
    if (this.recentCalls.length > 10) this.recentCalls.shift();
    return this.recentCalls.filter(k => k === key).length >= 3;
}
```

## Begründung

- **Robuster als konsekutiv**: Erkennt auch Loops die mit anderen Tools durchsetzt sind (A, B, A, B, A → A wird erkannt).
- **Einfache Implementierung**: Array als Ringpuffer, kein Zeitstempel, keine komplexe State-Machine.
- **Akzeptable False-Positive-Rate**: 3× gleicher Aufruf in 10 Calls ist fast immer ein Loop.

**Option 1 abgelehnt**: `edit_file` kann legitim 2× hintereinander aufgerufen werden (zwei unterschiedliche edits in derselben Datei). Konsekutiv-Erkennung würde das fälschlicherweise blockieren.

**Bekannte Limitation**: Error-Message sagt "in a row", aber Implementation ist Window-basiert — leichte Diskrepanz zwischen Meldung und Verhalten. Low priority fix.

## Konsequenzen

**Positiv:**
- Schützt gegen häufigste Loop-Muster
- Lightweight — kein Overhead
- Reset bei Mode-Wechsel und bei neuer AgentTask-Instanz

**Negativ:**
- Nur syntaktische Erkennung (JSON.stringify) — minimale Input-Variationen werden nicht erkannt
- Threshold 3 ist hardcoded — bei manchen Tools (z.B. append_to_file) könnte 2× legitim sein
- Sliding Window statt konsekutiv — "3× in 10" ist weniger intuitiv als "3× hintereinander"

## Implementierung

`src/core/tool-execution/ToolRepetitionDetector.ts`
Integration in `AgentTask.ts` — `runTool()` vor Tool-Ausführung
Reset: bei `pendingModeSwitch` und bei neuer `AgentTask`-Instanz
