# ADR-002: isomorphic-git für Checkpoints (Shadow Repository)

**Status:** Akzeptiert
**Datum:** 2026-02-17
**Entscheider:** Sebastian Hanke

---

## Kontext

Der Agent muss vor Write-Operationen Snapshots erstellen, damit der Nutzer Änderungen rückgängig machen kann. Obsidian läuft als Electron-App — System-Git ist nicht garantiert vorhanden und nicht über die Plugin-API aufrufbar.

Optionen:
1. System-`git` via `child_process` aufrufen
2. `isomorphic-git` (Pure-TypeScript-Git-Implementierung)
3. Eigene Snapshot-Lösung (Dateikopien in einem Backup-Verzeichnis)
4. Obsidian Sync als Backup-Mechanismus

## Entscheidung

**Option 2 — isomorphic-git** mit einem Shadow-Repository in `.obsidian/plugins/obsidian-agent/checkpoints/`.

## Begründung

- **Keine System-Abhängigkeit**: isomorphic-git ist Pure TypeScript, läuft im Electron-Renderer ohne externen Prozess.
- **Vollständige Git-Semantik**: Commits, Diffs, Restore via Checkout — etabliertes Datenmodell.
- **Kilo Code Referenz**: Kilo Code nutzt dasselbe Muster für seine Shadow-Checkpoints.
- **Obsidian-Sync kompatibel**: Shadow-Repo liegt im `.obsidian/`-Verzeichnis und wird von Obsidian Sync mitgenommen.

**Option 1 abgelehnt**: System-Git nicht garantiert, Electron-Sandbox-Probleme.
**Option 3 abgelehnt**: Kein Diff, kein strukturiertes Restore, höherer Disk-Verbrauch.
**Option 4 abgelehnt**: Nicht zuverlässig, nur wenn Sync aktiv, keine sofortige Undo-Möglichkeit.

## Konsequenzen

**Positiv:**
- Zuverlässiges, bewährtes Undo-System
- Diff-Anzeige zwischen Zuständen möglich
- Kein Systemabhängigkeit → läuft auf allen Plattformen (incl. Windows)

**Negativ:**
- Disk-Overhead durch Shadow-Repo (akzeptabel für Desktop)
- isomorphic-git ist langsamer als natives Git — `withTimeout()` guards nötig
- Mobile Obsidian: isomorphic-git hat Einschränkungen (future concern)

## Implementierung

`src/core/checkpoints/GitCheckpointService.ts`
Shadow-Repo: `.obsidian/plugins/obsidian-agent/checkpoints/`
Scan der letzten 200 Commits bei Restore.
