# ADR-005: Fail-Closed Approval (kein Callback = Ablehnung)

**Status:** Akzeptiert
**Datum:** 2026-02-17
**Entscheider:** Sebastian Hanke

---

## Kontext

Die `ToolExecutionPipeline` muss entscheiden, was passiert wenn eine Write-Operation genehmigt werden soll, aber kein Approval-Callback registriert ist (z.B. bei programmatischem Tool-Aufruf ohne UI-Kontext, oder bei Subtasks in bestimmten Konfigurationen).

Optionen:
1. **Fail-Open**: Kein Callback → automatisch genehmigen
2. **Fail-Closed**: Kein Callback → automatisch ablehnen
3. **Fehler werfen**: Exception bei fehlendem Callback

## Entscheidung

**Option 2 — Fail-Closed**: Fehlt der `onApprovalRequired`-Callback, wird die Operation mit einem Fehler-Result abgelehnt.

```typescript
if (!this.context.onApprovalRequired) {
    return { content: '<error>No approval callback registered</error>', is_error: true };
}
```

## Begründung

- **Safety by Default**: Im Zweifel keine Aktion. Datenverlust durch versehentliche Write-Ops ist schwerwiegender als eine verweigerte Operation.
- **Explizite Konfiguration erforderlich**: Jede Umgebung, die Write-Ops erlauben soll, muss explizit einen Approval-Callback bereitstellen (oder Auto-Approve konfigurieren).
- **Subtask-Sicherheit**: Subtasks erben den Approval-Callback des Parent-Tasks — kein Subtask kann durch Weglassen des Callbacks Governance umgehen.

**Option 1 abgelehnt**: Würde Governance-Layer effektiv aushebeln in Konfigurationen ohne UI.
**Option 3 abgelehnt**: Exception würde Agent-Loop abbrechen statt graceful degradation.

## Konsequenzen

**Positiv:**
- Kein versehentlicher Bypass der Approval-Logik möglich
- Subtasks und programmatische Nutzung sind sicher by default
- LLM sieht den Fehler im Tool-Result und kann reagieren

**Negativ:**
- Kann zu Verwirrung führen wenn Callback vergessen wird (Debug-Aufwand)
- Tool-Result enthält Fehlermeldung statt Exception — Fehler muss im LLM-Loop sichtbar sein

## Implementierung

`src/core/tool-execution/ToolExecutionPipeline.ts` — `checkApproval()` Methode
