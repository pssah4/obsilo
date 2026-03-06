# FEATURE: VaultDNA — Automatic Plugin Discovery

**Status:** Implemented
**Source:** `src/core/skills/VaultDNAScanner.ts`, `src/core/skills/SkillRegistry.ts`, `src/core/skills/types.ts`

## Summary
Automatically discovers all installed Obsidian plugins (core + community), classifies them by command count, generates `.skill.md` files with usage instructions, discovers JavaScript APIs via reflection, fetches README documentation from GitHub, and continuously syncs with plugin enable/disable changes. The SkillRegistry builds a compact system prompt section so the agent knows which plugins and commands are available.

## How It Works

### VaultDNAScanner — Discovery & Classification

**Initialization (deferred to `onLayoutReady`):**
1. Ensures `.obsidian-agent/plugin-skills/` directory exists
2. Loads existing `vault-dna.json` if present
3. Runs full scan
4. Schedules a 3-second delayed reclassification pass (catches plugins that register commands late)
5. Starts continuous sync polling (5-second interval)

**Full Scan Process:**

1. **Core Plugins** — scanned from `app.internalPlugins.plugins` using a built-in library (`CorePluginLibrary`). Each core plugin has pre-defined commands, classification, and instructions.

2. **Community Plugins** — scanned from `app.plugins.manifests`. For each plugin:
   - Determines enabled/disabled status from `app.plugins.enabledPlugins`
   - Classifies based on agentifiable command count (skipping UI-only commands like toggle/show/focus)
   - Discovers JavaScript API methods via reflection on `plugin.api`

**Classification:**
| Classification | Criteria |
|---------------|----------|
| `FULL` | 3+ meaningful (non-UI-only) commands |
| `PARTIAL` | 1-2 meaningful commands, or API-only |
| `NONE` | No agentifiable commands and no API |

**UI-Only Command Patterns (filtered out):**
- `toggle*`, `*toggle`, `show-*`, `focus*`, `*settings`, `*-panel`, `*-sidebar`, `*-pane`, `open-settings*`, `show-settings*`

### API Discovery (Tier 2)

For enabled plugins, the scanner inspects `plugin.api` via `Object.getPrototypeOf()`:
- Blocked methods: `constructor`, `execute`, `executeJs`, `render`, `register`, `unregister`, `onload`, `onunload`, `destroy`, `eval`
- Private-by-convention methods (starting with `_`) are skipped
- Only actual functions are included

Discovered API methods are stored in `PluginSkillMeta.apiMethods` and listed in the generated `.skill.md` file.

### .skill.md Generation

For each classified plugin (not NONE), a skill file is generated at `.obsidian-agent/plugin-skills/{id}.skill.md`:

**Frontmatter:**
```yaml
id: plugin-id
name: Plugin Name
source: vault-native
plugin-type: community
status: enabled
class: FULL
description: "Plugin description from manifest"
has-settings: true
commands:
  - id: "plugin-id:command-name"
    name: "Human-readable command name"
```

**Body sections:**
- Description, status, plugin ID
- Setup Required (if plugin needs configuration)
- Available Commands (with `execute_command` IDs)
- Plugin API (with `call_plugin_api` method signatures)
- Configuration File (path to `data.json` + read/write instructions)
- Current Configuration (sanitized settings — secrets redacted)
- Documentation reference (`.readme.md` file)
- Usage instructions (tool selection guidance)

### Settings Sanitization

Plugin settings from `data.json` are processed before inclusion in `.skill.md`:
- **Sensitive fields redacted:** API keys, secrets, passwords, tokens, credentials (17 regex patterns)
- **Excluded keys:** Internal state like `lastSync`, `cache`, `__*`, `version`
- **Value size cap:** Strings truncated at 500 chars, arrays summarized
- **Nesting depth cap:** 3 levels
- **Total output cap:** 8,000 chars

### README Fetch

Community plugin README files are fetched from GitHub:
1. Plugin registry loaded from `obsidianmd/obsidian-releases` (maps plugin ID to repo)
2. README.md fetched from `raw.githubusercontent.com/{repo}/HEAD/README.md`
3. Cached at `.obsidian-agent/plugin-skills/{id}.readme.md`
4. Cache TTL: 7 days
5. Max length: 20,000 chars
6. Rate-limited: 1 request per second

### Continuous Sync (Polling)

Every 5 seconds, `checkForChanges()` compares `app.plugins.enabledPlugins` against the last known set:
- **Newly enabled:** reclassified, skill file written, README fetched
- **Newly disabled:** status updated, skill file regenerated with disabled notice

### SkillRegistry — System Prompt Integration

Combines VaultDNA skills with user toggle settings (`vaultDNA.skillToggles`):
- `getActivePluginSkills()` — enabled plugins not toggled off by user
- `getPluginSkillsPromptSection()` — builds the `PLUGIN SKILLS` section for the system prompt

The prompt section includes:
- Tool selection rules (execute_command vs execute_recipe vs call_plugin_api)
- Active plugin list with commands and descriptions
- Common mistake disambiguation examples
- Disabled plugin list with enable_plugin guidance

## Key Files
- `src/core/skills/VaultDNAScanner.ts` — scanner, classifier, skill file generator, README fetcher
- `src/core/skills/SkillRegistry.ts` — system prompt builder, toggle management
- `src/core/skills/types.ts` — `VaultDNA`, `VaultDNAEntry`, `PluginSkillMeta` types
- `src/core/skills/CorePluginLibrary.ts` — built-in core plugin definitions
- `src/core/prompts/sections/pluginSkills.ts` — prompt section injection
- `src/ui/settings/SkillsTab.ts` — settings UI for skill toggles

## Dependencies
- `App.plugins` — plugin manifests, enabled set, plugin instances
- `App.commands` — command registry for classification
- `Vault.adapter` — file I/O for skill files and vault-dna.json
- `requestUrl` (Obsidian) — GitHub README fetch
- `SkillRegistry` — consumed by system prompt builder
- `CallPluginApiTool` — uses SkillRegistry for Tier 2 authorization

## Configuration
| Key | Default | Description |
|-----|---------|-------------|
| `vaultDNA.enabled` | true | Enable automatic plugin discovery |
| `vaultDNA.skillToggles` | `{}` | Per-plugin enable/disable for system prompt inclusion |
| `vaultDNA.lastScanAt` | `""` | Timestamp of last full scan |

## Known Limitations / Edge Cases
- Polling-based sync (5s interval) may miss rapid enable/disable toggles. A Workspace event-based approach would be more responsive.
- Some plugins register commands asynchronously after load — the 3-second reclassification pass catches most but not all late registrations.
- API discovery via reflection only inspects the prototype chain of `plugin.api` — methods added directly to the instance (not via class definition) are missed.
- README fetch requires network access — offline vaults get no documentation. Cache is per-file, not atomic.
- Settings sanitization regex patterns may over-match (e.g., `token` in `tokenize`) — a negative lookahead for `tokenize` is included but other false positives are possible.
- The plugin registry fetch from GitHub is a single point of failure — if the URL changes or is rate-limited, no READMEs are fetched.
- Generated `.skill.md` files are overwritten on every scan — manual edits are lost.
