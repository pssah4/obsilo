# Implementierungsplan: Rename `.obsidian-agent` → `.obsilo-agent` + Cleanup

> **Status:** Geplant -- noch nicht umgesetzt
> **Branch:** Eigener Feature-Branch (z.B. `refactor/rename-obsilo-agent`)
> **Erstellt:** 2026-03-05
> **Risiko:** Mittel -- eigener Branch kapselt Änderungen, Rollback jederzeit möglich

---

## Kontext

Das Plugin wurde von `obsidian-agent` zu `obsilo-agent` umbenannt (manifest.json, package.json sind bereits korrekt). Aber der globale Storage-Pfad (`~/.obsidian-agent/`), der Vault-Root-Pfad (`.obsidian-agent/`), Governance-Dateien (`.obsidian-agentignore`/`.obsidian-agentprotected`), CSS-Klassen und der Sidebar-ViewType verwenden noch den alten Namen. Zusätzlich gibt es verwaiste Daten (altes Plugin, stale Indices, orphaned Config).

---

## Teil 1: Filesystem-Cleanup (manuell, vor Code-Änderung)

| Aktion | Pfad | Größe | Risiko |
|--------|------|-------|--------|
| Löschen | `NexusOS/.obsidian/plugins/obsidian-agent/` | ~350 MB | Niedrig -- altes Plugin, nicht in community-plugins.json aktiv |
| Löschen | `NexusOS/.obsidian-agent/semantic-index/` | 322 MB | Niedrig -- staler Index vom 27. Feb |
| Löschen | `/Users/sebastianhanke/Obsidian/.obsidian/` | <1 MB | Niedrig -- verwaistes Config, kein registrierter Vault |
| Umbenennen | `~/.obsidian-agent/` → `~/.obsilo-agent/` | -- | Mittel -- erst NACH Code-Änderung + Build |
| Umbenennen | `NexusOS/.obsidian-agent/` → `NexusOS/.obsilo-agent/` | -- | Mittel -- erst NACH Code-Änderung + Build |

**Reihenfolge:** Löschungen zuerst (risikoarm), Umbenennungen erst nach dem neuen Build.

---

## Teil 2: Code-Änderungen

### 2.1 GlobalFileService.ts (Zentrale Konstante)
**Datei:** `src/core/storage/GlobalFileService.ts:17`
- VORHER: `const GLOBAL_DIR_NAME = '.obsidian-agent';`
- NACHHER: `const GLOBAL_DIR_NAME = '.obsilo-agent';`
- Kommentare in Zeile 4, 38 anpassen

### 2.2 IgnoreService.ts (Governance-Dateien)
**Datei:** `src/core/governance/IgnoreService.ts`
- VORHER: `.obsidian-agentignore`, `.obsidian-agentprotected` (Zeilen 4, 26-27, 46-47, 90, 93)
- NACHHER: `.obsilo-agentignore`, `.obsilo-agentprotected`

### 2.3 VaultDNAScanner.ts (Vault-Root-Pfade)
**Datei:** `src/core/skills/VaultDNAScanner.ts:31-32`
- VORHER: `.obsidian-agent/plugin-skills`, `.obsidian-agent/vault-dna.json`
- NACHHER: `.obsilo-agent/plugin-skills`, `.obsilo-agent/vault-dna.json`

### 2.4 SyncBridge.ts (Legacy-Migration-Pfade)
**Datei:** `src/core/storage/SyncBridge.ts:104-107`
- Legacy-Pfade `.obsidian-agent/rules` etc. **bleiben** als Fallback fuer Migration
- Kommentare aktualisieren (Zeile 4, 24)

### 2.5 GlobalMigrationService.ts (Migration-Pfade)
**Datei:** `src/core/storage/GlobalMigrationService.ts:72-73, 181-183`
- Aktive Pfade: `.obsidian-agent/` → `.obsilo-agent/`
- Legacy `.obsidian-agent/` Pfade als zusätzliche Migrations-Quelle behalten

### 2.6 AgentSidebarView.ts (ViewType)
**Datei:** `src/ui/AgentSidebarView.ts:24`
- VORHER: `VIEW_TYPE_AGENT_SIDEBAR = 'obsidian-agent-sidebar'`
- NACHHER: `VIEW_TYPE_AGENT_SIDEBAR = 'obsilo-agent-sidebar'`
- **Achtung:** workspace.json im Vault referenziert den alten ViewType. Auto-Migration nötig.

### 2.7 styles.css (CSS-Klasse)
**Datei:** `styles.css`
- Alle `.obsidian-agent-sidebar` → `.obsilo-agent-sidebar`

### 2.8 SemanticIndexService.ts
**Datei:** `src/core/semantic/SemanticIndexService.ts:132`
- VORHER: `path.join(basePath, '.obsidian-agent', 'semantic-index')`
- NACHHER: `path.join(basePath, '.obsilo-agent', 'semantic-index')`

### 2.9 BackupTab.ts
**Datei:** `src/ui/settings/BackupTab.ts:478`
- VORHER: `const dir = '.obsidian-agent';`
- NACHHER: `const dir = '.obsilo-agent';`

### 2.10 Weitere Referenzen (~70 Vorkommen)
- Kommentare und Docstrings in: main.ts, types/settings.ts, ReadFileTool.ts, SkillRegistry.ts, CapabilityGapResolver.ts, SkillsManager.ts, RulesLoader.ts, WorkflowLoader.ts, ModeService.ts, i18n-Dateien
- README.md: Alle `.obsidian-agent` → `.obsilo-agent`, `.obsidian-agentignore` → `.obsilo-agentignore`, `.obsidian-agentprotected` → `.obsilo-agentprotected`

### 2.11 Auto-Migration im Code (Abwärtskompatibilität)
**Datei:** `src/main.ts` (onload-Bereich, nach GlobalFileService-Init)

Neue Funktion die beim Plugin-Start einmalig läuft:
1. Prüfen ob `~/.obsidian-agent/` existiert aber `~/.obsilo-agent/` nicht → automatisch umbenennen (`fs.rename`)
2. Vault-Root: `.obsidian-agent/` → `.obsilo-agent/` (via vault.adapter)
3. Governance-Dateien: `.obsidian-agentignore` → `.obsilo-agentignore` (via vault.adapter)
4. workspace.json: ViewType `obsidian-agent-sidebar` → `obsilo-agent-sidebar`

---

## Teil 3: Dateien-Zusammenfassung

| Datei | Änderung | Risiko |
|-------|----------|--------|
| `src/core/storage/GlobalFileService.ts` | Konstante + Kommentare | Niedrig |
| `src/core/governance/IgnoreService.ts` | Dateinamen + Kommentare | Niedrig |
| `src/core/skills/VaultDNAScanner.ts` | Pfade | Niedrig |
| `src/core/storage/SyncBridge.ts` | Kommentare (Legacy-Pfade bleiben) | Niedrig |
| `src/core/storage/GlobalMigrationService.ts` | Aktive Pfade + Legacy-Fallback | Mittel |
| `src/ui/AgentSidebarView.ts` | ViewType-Konstante | Mittel |
| `styles.css` | CSS-Klasse | Niedrig |
| `src/core/semantic/SemanticIndexService.ts` | Pfad | Niedrig |
| `src/ui/settings/BackupTab.ts` | Pfad | Niedrig |
| `src/main.ts` | Auto-Migration hinzufuegen | Mittel |
| ~20 weitere Dateien | Kommentare/Docstrings | Niedrig |
| `README.md` | Dokumentation | Niedrig |

## Nicht betroffen

- `manifest.json` -- bereits `obsilo-agent`
- `package.json` -- bereits `obsilo-agent`
- `esbuild.config.mjs` -- keine Referenz
- Deploy-Konfiguration -- nutzt manifest.id dynamisch

---

## Verifikation

1. **Build:** `npm run build` -- muss fehlerfrei durchlaufen
2. **Grep-Check:** `grep -rn 'obsidian-agent' src/ styles.css README.md` -- darf nur Legacy-Migration-Code zeigen
3. **Deploy + Starten:** Plugin in Obsidian laden, Sidebar muss sich öffnen
4. **Auto-Migration testen:** Prüfen ob `~/.obsilo-agent/` korrekt erstellt wird
5. **Governance-Test:** `.obsilo-agentignore` wird erkannt
6. **VaultDNA:** Plugin-Skills werden unter `.obsilo-agent/plugin-skills/` geschrieben

---

## Rollback-Strategie

Da alles in einem eigenen Branch passiert:
1. `git checkout dev` -- zurueck zum Entwicklungsbranch
2. Filesystem-Umbenennungen rueckgängig: `~/.obsilo-agent/` → `~/.obsidian-agent/` (falls bereits umbenannt)
3. Build + Deploy vom dev-Branch
