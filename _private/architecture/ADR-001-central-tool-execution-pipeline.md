# ADR-001: Zentrale ToolExecutionPipeline für alle Tool-Aufrufe

**Status:** Akzeptiert
**Datum:** 2026-02-17
**Entscheider:** Sebastian Hanke

---

## Kontext

Der Agent muss Vault-Operationen ausführen können — sowohl intern definierte Tools (read_file, write_file, ...) als auch externe Tools über MCP-Server. Die kritische Frage ist: Wie wird sichergestellt, dass jede Tool-Ausführung die Sicherheits- und Governance-Anforderungen (Approval, Checkpoints, Logging) erfüllt?

Optionen:
1. Jedes Tool implementiert seine eigene Approval/Checkpoint-Logik
2. Eine zentrale Pipeline, durch die alle Tool-Aufrufe fließen
3. Dekoratoren/Middleware pro Tool-Kategorie

## Entscheidung

**Option 2 — Zentrale ToolExecutionPipeline** als einziger Einstiegspunkt für alle Tool-Ausführungen.

`src/core/tool-execution/ToolExecutionPipeline.ts` implementiert eine 6-stufige Pipeline:
1. Tool-Lookup (ToolRegistry)
2. Pfad-Validierung (IgnoreService)
3. Approval-Check (fail-closed)
4. Checkpoint-Snapshot (vor Write-Ops)
5. Tool-Execution
6. Operation-Logging

## Begründung

- **Vollständige Governance-Abdeckung**: Kein Tool kann die Pipeline umgehen. Auch MCP-Tools fließen durch dieselbe Pipeline.
- **Single Point of Control**: Änderungen an Approval-Logik oder Logging betreffen automatisch alle Tools.
- **Kilo Code Referenz**: Entspricht dem Kilo-Code-Muster (`ToolExecutor` als zentraler Governance-Layer).
- **Fail-Closed by Default**: Fehlt der Approval-Callback → Ablehnung. Kein versehentliches Bypass möglich.

## Konsequenzen

**Positiv:**
- 100% Governance-Abdeckung garantiert
- Einfaches Hinzufügen neuer Governance-Regeln (nur Pipeline ändern)
- Konsistentes Audit-Log für alle Operationen

**Negativ:**
- Single Point of Failure: Pipeline-Bug betrifft alle Tools
- Leichte Performance-Overhead durch Pipeline-Schritte (akzeptabel)

## Implementierung

`src/core/tool-execution/ToolExecutionPipeline.ts` — 297 Zeilen
