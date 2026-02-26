# ADR-020: Global Storage Architecture mit Sync Bridge

**Status:** Akzeptiert
**Datum:** 2026-02-26
**Entscheider:** Sebastian Hanke

---

## Kontext

Agent-Daten (Memory, Rules, Workflows, Skills, Recipes, History, Logs, Settings) werden aktuell per Vault gespeichert:
- Plugin-Ordner (`.obsidian/plugins/obsidian-agent/`): Memory, History, Logs, Recipes, Episodes, Patterns
- Vault-Root (`.obsidian-agent/`): Rules, Workflows, Skills
- Global (`~/.obsidian-agent/`): Nur Modes

Das fuehrt dazu, dass jeder Vault einen eigenen, isolierten Agent hat. Der Agent lernt nicht vault-uebergreifend, und Nutzer muessen Rules/Workflows/Skills in jedem Vault duplizieren. Zusaetzlich werden Einstellungen (API-Keys, Modelle) pro Vault konfiguriert.

**Anforderung:** EIN Agent ueber ALLE Vaults — gleiche Persoenlichkeit, gleiche Regeln, gleiches Gedaechtnis. Nur der Datenzugriff (Vault-Dateien, Semantic Index) und Checkpoints bleiben vault-spezifisch. Agent-Daten muessen zusaetzlich via Obsidian Sync cross-device verfuegbar sein.

## Optionen

### Option 1: Rein globaler Speicher (~/.obsidian-agent/)
- Alle Agent-Daten nach ~/.obsidian-agent/ verschieben
- Services nutzen Node.js `fs` statt `vault.adapter`
- **Pro:** Einfach, ein Speicherort
- **Contra:** Kein Obsidian Sync — Daten existieren nur lokal, kein Cross-Device-Support

### Option 2: Globaler Speicher + Sync Bridge
- Agent-Daten leben primaer in ~/.obsidian-agent/ (cross-vault truth)
- SyncBridge synchronisiert bidirektional mit dem Plugin-Ordner jedes Vaults
- Plugin-Ordner dient als Obsidian-Sync-Bridge fuer Cross-Device
- **Pro:** Cross-Vault UND Cross-Device, saubere Service-Architektur
- **Contra:** Doppelte Datenhaltung, Sync-Logik noetig

### Option 3: Symlink-basiert
- ~/.obsidian-agent/ als zentral, Symlinks aus jedem Vault
- **Pro:** Kein Duplikat
- **Contra:** Windows-Probleme, Obsidian Sync folgt keinen Symlinks, fragil

### Option 4: Primaerer Vault
- Ein Vault wird als "Master" deklariert, andere lesen von dort
- **Pro:** Kein globaler Ordner noetig
- **Contra:** Master muss immer erreichbar sein, komplex bei Vault-Wechsel

## Entscheidung

**Option 2 — Globaler Speicher + Sync Bridge**

### Begruendung
- **Cross-Vault auf dem Geraet:** ~/.obsidian-agent/ ist fuer alle Vaults sofort verfuegbar
- **Cross-Device via Obsidian Sync:** Plugin-Ordner wird als Sync-Bridge genutzt
- **Saubere Abstraktion:** FileAdapter-Interface entkoppelt Services von der Storage-Implementierung
- **Bestehender Pattern:** GlobalModeStore beweist den Node.js-fs-Ansatz bereits im Codebase

### Architektur

```
              +---------------------+
              |  ~/.obsidian-agent/  |  <-- Primaerer Speicher (cross-vault)
              |  (lokal)             |
              +---------+-----------+
                 read ^ | write
              +--------+------------+
              |   GlobalFileService  |  <-- FileAdapter-Implementierung
              +--------+------------+
                       |
           +-----------+-----------+
           | on load   | on save   |
     +-----+-----+  +--+----------+
     | pull from  |  | push to     |
     | plugin dir |  | plugin dir  |
     | (if newer) |  | (for sync)  |
     +-----+-----+  +--+----------+
           |            |
    +------+------------+-------------+
    | .obsidian/plugins/obsidian-agent/|  <-- Obsidian Sync Bridge
    +----------------------------------+
```

### FileAdapter Interface
```typescript
export interface FileAdapter {
    exists(path: string): Promise<boolean>;
    read(path: string): Promise<string>;
    write(path: string, data: string): Promise<void>;
    mkdir(path: string): Promise<void>;
    list(path: string): Promise<{ files: string[]; folders: string[] }>;
    remove(path: string): Promise<void>;
    append(path: string, data: string): Promise<void>;
    stat(path: string): Promise<{ mtime: number; size: number } | null>;
}
```

### Daten-Klassifizierung

**Global (nach ~/.obsidian-agent/):**
Memory, History, Logs, Recipes, Episodes, Patterns, Rules, Workflows, Skills, ExtractionQueue, Settings, Modes

**Per-Vault (bleibt):**
Semantic Index, Checkpoints, Vault-DNA, Plugin-Skills, IgnoreService

### SyncBridge
- `pullFromVault()`: Beim Plugin-Start — neuere Dateien aus dem Plugin-Ordner (von Obsidian Sync) nach global mergen
- `pushToVault()`: Bei Save/Unload — geaenderte globale Dateien zurueck in den Plugin-Ordner kopieren (fuer Obsidian Sync)
- Konfliktloesung: Neuerer mtime-Timestamp gewinnt

### Settings-Split
- `~/.obsidian-agent/settings.json`: API-Keys, Modelle, Modes, Auto-Approval, Memory-Config, Language, UI-Prefs
- `data.json` (per-Vault via Obsidian): Semantic-Index-Config, Checkpoint-Config, VaultDNA-Config, Migration-Flag

### Migration
- One-time pro Vault: `_globalStorageMigrated` Flag in data.json
- Erster Vault: Alle Daten nach global kopieren
- Weitere Vaults: Merge (neuerer mtime gewinnt, Union fuer Collections)
- Alte Daten bleiben fuer Rollback erhalten

## Konsequenzen

**Positiv:**
- Ein Agent mit durchgehendem Gedaechtnis ueber alle Vaults
- Rules, Workflows, Skills einmal definieren — ueberall verfuegbar
- API-Keys und Settings einmal konfigurieren
- Cross-Device-Sync via Obsidian Sync bleibt funktional
- Saubere FileAdapter-Abstraktion fuer zukuenftige Storage-Optionen

**Negativ:**
- Doppelte Datenhaltung (global + Plugin-Ordner als Sync-Bridge)
- Sync-Bridge-Logik muss robust gegen Konflikte und Race Conditions sein
- 10 Services muessen refactored werden (Constructor-Signatur-Aenderung)
- Migration-Logik fuer bestehende Vaults noetig
- Logs/History aus verschiedenen Vaults mischen sich (gewollt, aber ggf. unuebersichtlich)

## Referenzen
- ADR-019: Electron safeStorage (Settings-Verschluesselung an der Grenze)
- `src/core/modes/GlobalModeStore.ts` (bestehender Global-Pattern)
- Plan: `/Users/sebastianhanke/.claude/plans/lively-baking-parrot.md`
