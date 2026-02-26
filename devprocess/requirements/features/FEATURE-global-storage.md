# FEATURE: Global Storage Architecture

**Status:** In Progress
**ADR:** ADR-020-global-storage.md
**Source:** `src/core/storage/GlobalFileService.ts`, `src/core/storage/SyncBridge.ts`, `src/main.ts`

## Summary
All agent data (memory, rules, workflows, skills, recipes, history, logs, settings) is stored globally at `~/.obsidian-agent/` and shared across all Obsidian vaults. A SyncBridge keeps the data synchronized with each vault's plugin directory for cross-device sync via Obsidian Sync. Only vault-specific data (semantic index, checkpoints, vault-DNA) remains per-vault.

## Problem
Agent data is currently siloed per vault:
- Each vault has its own memory, history, rules, and settings
- Agent does not learn continuously across vaults
- Users must duplicate rules, workflows, and skills manually
- API keys and model settings must be configured per vault

## How It Works

### Three-Layer Architecture
```
~/.obsidian-agent/                  Global (cross-vault truth)
     ^  |
     |  v
GlobalFileService                   FileAdapter abstraction
     ^  |
     |  v
SyncBridge <--> plugin dir          Obsidian Sync bridge (cross-device)
```

### FileAdapter Interface
New `FileAdapter` interface mirrors Obsidian's `vault.adapter` API surface:
- `exists`, `read`, `write`, `mkdir`, `list`, `remove`, `append`, `stat`
- `GlobalFileService` implements this using Node.js `fs` at `~/.obsidian-agent/`
- 10 services refactored from `vault.adapter` to `FileAdapter`

### SyncBridge
Bidirectional sync between global storage and vault plugin directory:
- **pullFromVault()** (on plugin load): Merges newer files from plugin dir (arriving via Obsidian Sync) into global storage
- **pushToVault()** (on save/unload): Copies changed global files back to plugin dir for Obsidian Sync pickup
- **Conflict resolution**: Newer mtime wins

### Data Classification

| Data | Storage | Sync |
|------|---------|------|
| Memory (profiles, sessions) | Global | Via bridge |
| Rules | Global | Via bridge |
| Workflows | Global | Via bridge |
| Skills (manual) | Global | Via bridge |
| Recipes (learned) | Global | Via bridge |
| Episodes (episodic memory) | Global | Via bridge |
| Patterns (recipe promotion) | Global | Via bridge |
| History (conversations) | Global | Via bridge |
| Logs (audit trail) | Global | Via bridge |
| Settings (API keys, prefs) | Global + data.json | Via bridge |
| Modes | Global (existing) | Via bridge |
| Semantic Index | Per-vault | Obsidian Sync |
| Checkpoints | Per-vault | Not synced |
| Vault-DNA / Plugin Skills | Per-vault | Not synced |

### Settings Globalization
- Global keys (API keys, models, modes, auto-approval, memory, language, UI prefs) stored in `~/.obsidian-agent/settings.json`
- Vault-local keys (semantic index, checkpoints, VaultDNA config) remain in `data.json`
- On load: merge global settings into vault-local (global wins for shared keys)
- On save: split and write to both locations
- SafeStorage encryption applied to global settings.json

### One-Time Migration
- Flag: `_globalStorageMigrated` in data.json
- First vault: copies all data to `~/.obsidian-agent/`
- Subsequent vaults: merges with existing global data (newer mtime wins, union for collections)
- Old data preserved for rollback

## Refactored Services (10)

| Service | Old Constructor | New Constructor |
|---------|----------------|-----------------|
| RulesLoader | `(vault: Vault)` | `(fs: FileAdapter)` |
| WorkflowLoader | `(vault: Vault)` | `(fs: FileAdapter)` |
| SkillsManager | `(vault: Vault)` | `(fs: FileAdapter)` |
| MemoryService | `(vault, pluginDir)` | `(fs: FileAdapter)` |
| ExtractionQueue | `(vault, pluginDir)` | `(fs: FileAdapter)` |
| ConversationStore | `(vault, pluginDir)` | `(fs: FileAdapter)` |
| OperationLogger | `(vault, pluginDir)` | `(fs: FileAdapter)` |
| RecipeStore | `(vault, pluginDir)` | `(fs: FileAdapter)` |
| EpisodicExtractor | `(vault, pluginDir, ...)` | `(fs: FileAdapter, ...)` |
| RecipePromotionService | `(vault, pluginDir, ...)` | `(fs: FileAdapter, ...)` |

## Key Files
- `src/core/storage/types.ts` -- FileAdapter interface
- `src/core/storage/GlobalFileService.ts` -- Node.js fs implementation at ~/.obsidian-agent/
- `src/core/storage/SyncBridge.ts` -- Bidirectional vault<->global sync
- `src/core/storage/GlobalSettingsService.ts` -- Global settings load/save/split
- `src/core/storage/GlobalMigrationService.ts` -- One-time migration logic
- `src/main.ts` -- Service wiring and migration integration

## Dependencies
- Node.js `fs`, `os`, `path` modules (Electron runtime, same as GlobalModeStore)
- Electron `safeStorage` (for global settings encryption, via ADR-019)

## Configuration
No user-facing configuration required. Migration is automatic on first load.

## Known Limitations / Edge Cases
- Conversations and logs from different vaults mix in global storage (by design)
- Cross-device: encrypted API keys (safeStorage) must be re-entered per device (OS keychain is device-specific)
- Two vaults open simultaneously: SyncBridge uses lockfile during migration to prevent race conditions
- No mobile support (plugin uses Electron-only features)
