# TECH: Plugin Skills (VaultDNA and Plugin-as-Skill)

Technical reference for the Plugin-as-Skill (PAS) system in Obsidian Agent. Covers VaultDNA scanning, plugin command execution, API bridging, capability gap resolution, and the recipe system.

Source files:
- `src/core/skills/VaultDNAScanner.ts` -- Plugin discovery, classification, skill file generation
- `src/core/skills/SkillRegistry.ts` -- Unified skill registry, system prompt section
- `src/core/skills/CapabilityGapResolver.ts` -- 3-stage gap resolution
- `src/core/skills/types.ts` -- VaultDNA types (VaultDNAEntry, PluginSkillMeta, etc.)
- `src/core/tools/agent/ExecuteCommandTool.ts` -- Obsidian command execution
- `src/core/tools/agent/EnablePluginTool.ts` -- Plugin enable/disable
- `src/core/tools/agent/ResolveCapabilityGapTool.ts` -- Tool wrapper for gap resolution
- `src/core/tools/agent/CallPluginApiTool.ts` -- Plugin API bridge
- `src/core/tools/agent/pluginApiAllowlist.ts` -- Built-in API method allowlist
- `src/core/tools/agent/ExecuteRecipeTool.ts` -- Recipe shell execution
- `src/core/tools/agent/recipeRegistry.ts` -- Built-in recipe definitions

---

## 1. VaultDNA Scanner

File: `src/core/skills/VaultDNAScanner.ts`

The VaultDNA Scanner discovers all installed Obsidian plugins (core and community), classifies them, and generates skill files that teach the agent how to use each plugin.

### Plugin Discovery

Two phases during `fullScan()`:

**Phase 1 -- Core plugins**: Scanned from `app.internalPlugins.plugins`. Uses a static `CorePluginLibrary` that provides hand-written definitions (commands, instructions, descriptions) for each core plugin. Plugins not in `internalPlugins` are assumed always-available (workspace, editor, app).

**Phase 2 -- Community plugins**: Scanned from `app.plugins.manifests` (all installed). Enabled status checked against `app.plugins.enabledPlugins`. Skips `obsidian-agent` itself and core plugin IDs.

### Classification System

Plugins are classified into three tiers based on command count:

```typescript
type PluginClassification = 'FULL' | 'PARTIAL' | 'NONE';

classify(pluginId: string): PluginClassification {
    const commands = this.getPluginCommands(pluginId);
    const meaningful = commands.filter(c => !isUIOnlyCommand(c.name));
    if (meaningful.length === 0) return 'NONE';
    if (meaningful.length >= 3) return 'FULL';
    return 'PARTIAL';
}
```

UI-only commands (toggle, show-, focus, settings, -panel, -sidebar, -pane) are excluded from classification counting.

Disabled plugins receive `'PARTIAL'` classification by default since their commands are not loaded and cannot be counted.

### API Discovery (Tier 2)

For enabled community plugins, the scanner performs runtime reflection:

1. Access `plugins[id].api` (the conventional API object).
2. Get method names from the prototype chain via `Object.getOwnPropertyNames(proto)`.
3. Filter out blocked methods: `constructor`, `execute`, `executeJs`, `render`, `register`, `unregister`, `onload`, `onunload`, `destroy`, `eval`.
4. Filter out private-by-convention methods (starting with `_`).

Plugins with no commands but a discovered API are promoted from `NONE` to `PARTIAL`.

### Skill File Generation

For each classified plugin (not NONE), a `.skill.md` file is written to `.obsidian-agent/plugin-skills/`:

**Frontmatter**: id, name, source, plugin-type, status, class, description, has-settings, needs-setup, commands list.

**Body sections**:
- Description and status
- Setup Required (if `detectSetupStatus()` finds issues)
- Available Commands (command IDs with names)
- Plugin API (if API methods were discovered)
- Configuration File (path to data.json, read/write instructions)
- Current Configuration (sanitized settings snapshot)
- Documentation (reference to `.readme.md` file)
- Usage (contextual instructions based on enabled/disabled state)

Core plugins use `enrichCoreBody()` which appends configuration and settings sections to the hand-written instructions from `CorePluginLibrary`.

### Settings Sanitization

Plugin settings are read from disk and sanitized before inclusion:

- **Sensitive fields redacted**: Patterns matching api-key, secret, password, token, credential, oauth, etc.
- **Internal state excluded**: Keys matching lastSync, cache, version, __prefix, etc.
- **Size limits**: String values capped at 500 chars, arrays previewed with first 3 items, nesting limited to depth 3.
- **Total output**: Capped at 8,000 characters.
- **Setup detection**: Missing data.json, empty settings, or disabled status trigger setup hints.

### README Fetching

The scanner fetches README files from GitHub for community plugins:

1. Downloads the official Obsidian community plugin registry from `obsidianmd/obsidian-releases`.
2. Maps plugin IDs to GitHub `owner/repo`.
3. Fetches `README.md` from each repo's HEAD branch.
4. Caches for 7 days (skips re-fetch if younger).
5. Truncates at 20,000 characters.
6. Rate-limited to 1 request per second.
7. Stored as `{plugin-id}.readme.md` in the plugin-skills directory.

Core plugins get static README files generated from `CorePluginLibrary` definitions.

### Continuous Sync (Polling)

After initial scan, the scanner polls every 5 seconds for plugin enable/disable changes:

```
checkForChanges():
  currentEnabled = app.plugins.enabledPlugins
  for each newly enabled plugin:
    handlePluginEnabled() -- reclassify, update DNA, regenerate skill file, fetch README
  for each newly disabled plugin:
    handlePluginDisabled() -- update status, regenerate skill file
  lastKnownEnabledSet = currentEnabled
```

A delayed reclassification runs 3 seconds after initial scan to catch plugins that register commands late.

---

## 2. SkillRegistry

File: `src/core/skills/SkillRegistry.ts`

Combines VaultDNA-discovered skills with user toggle settings and generates the system prompt section.

### Active Skills
`getActivePluginSkills()`: Returns enabled plugins that are not toggled off by the user.

### System Prompt Section
`getPluginSkillsPromptSection()` builds the PLUGIN SKILLS block:

1. Critical rules: Which tool type to use per plugin type (CLI --> execute_recipe, native --> execute_command, API --> call_plugin_api).
2. Active plugins with descriptions, commands, and setup warnings.
3. Common mistakes to avoid (disambiguation examples).
4. Disabled plugins list with enable_plugin instructions.
5. Instructions to always read `.skill.md` before using a plugin.

---

## 3. execute_command

File: `src/core/tools/agent/ExecuteCommandTool.ts`

Executes any Obsidian command by its command ID.

### Behavior
1. Validates `command_id` parameter.
2. Looks up command in `app.commands.commands`.
3. If not found, suggests similar commands with the same plugin prefix.
4. Executes via `app.commands.executeCommandById(commandId)`.
5. Reports success with command name and ID.

### Write Classification
`isWriteOperation = true` -- Obsidian commands can modify vault state (create files, change settings, trigger actions).

---

## 4. enable_plugin

File: `src/core/tools/agent/EnablePluginTool.ts`

Enables or disables installed Obsidian community plugins.

### Enable Flow
1. Validates plugin exists in `app.plugins.manifests`.
2. If not found, suggests similar plugin IDs.
3. Checks current enabled state to avoid no-ops.
4. Calls `app.plugins.enablePlugin(pluginId)`.
5. Waits 500ms for command registration.
6. Triggers `scanner.handlePluginEnabled()` to update VaultDNA and regenerate skill file.
7. Returns success with instruction to read the skill file.

### Disable Flow
1. Calls `app.plugins.disablePlugin(pluginId)`.
2. Triggers `scanner.handlePluginDisabled()`.
3. Returns confirmation.

### Write Classification
`isWriteOperation = true` -- Requires user approval since it changes plugin state.

---

## 5. resolve_capability_gap

File: `src/core/tools/agent/ResolveCapabilityGapTool.ts`
Logic: `src/core/skills/CapabilityGapResolver.ts`

A 3-stage resolution system for when no active tool or skill matches the user's request.

### Stage 1 -- Active Skills
Keyword-match against enabled plugins with `FULL` or `PARTIAL` classification. If found, directs the agent to the plugin's `.skill.md` file.

### Stage 2 -- Disabled Plugins
Keyword-match against disabled but installed plugins. If found, returns message to use `enable_plugin()`.

### Stage 3 -- Archived
Keyword-match against previously installed plugins (stored in `vaultDNA.archived`). If found, informs that the user needs to reinstall via Community Plugins.

### Keyword Extraction
Simple word extraction: `text.toLowerCase().match(/\b\w{3,}\b/g)`. Matches against a concatenation of plugin id, name, and description.

### No Match
Returns message suggesting the user install a community plugin via Obsidian Settings.

---

## 6. call_plugin_api

File: `src/core/tools/agent/CallPluginApiTool.ts`

Calls JavaScript API methods on Obsidian plugin instances directly. This is the Plugin API Bridge.

### Two-Tier Allowlist

**Tier 1 -- Built-in allowlist** (`pluginApiAllowlist.ts`):
Compile-time curated list of reviewed methods with explicit `isWrite` flags and `maxReturnSize` limits.

Current built-in entries:
- `dataview.query` (read, 50KB)
- `dataview.tryQueryMarkdown` (read, 50KB)
- `dataview.pages` (read, 50KB)
- `dataview.page` (read, 10KB)
- `omnisearch.search` (read, 50KB)
- `metaedit.getPropertyValue` (read, 10KB)
- `metaedit.getFilesWithProperty` (read, 50KB)
- `metaedit.update` (write, 1KB)

**Tier 2 -- Dynamic discovery**:
Methods discovered by VaultDNA Scanner via reflection. Always treated as write operations unless the user explicitly marks them as safe in `settings.pluginApi.safeMethodOverrides`.

### Blocked Methods
Always blocked regardless of allowlist: `execute`, `executeJs`, `render`, `register`, `unregister`, `onload`, `onunload`, `destroy`, `eval`.

### Execution Flow
1. Validate `plugin_id` and `method` parameters.
2. Check blocked methods list.
3. Verify `settings.pluginApi.enabled` is true.
4. Resolve plugin instance from `app.plugins.plugins`.
5. Resolve API object: try `plugin.api` first, then `plugin` itself.
6. Authorization: check built-in allowlist, then dynamic discovery.
7. Execute with 10-second timeout via `Promise.race`.
8. Serialize return value with safe JSON replacer (handles circular refs, DOM nodes, functions).
9. Truncate to `maxReturnSize`.

### Safe JSON Replacer
Custom replacer prevents crashes during serialization:
- Functions: `'[Function]'`
- Symbols: `.toString()`
- BigInts: `.toString()`
- DOM nodes: `'[DOMNode]'`
- Circular references: `'[Circular]'`

---

## 7. execute_recipe

File: `src/core/tools/agent/ExecuteRecipeTool.ts`

Executes pre-defined shell recipes via `child_process.spawn` with `shell: false`.

### Security Layers (7 total)

1. **Master toggle**: `settings.recipes.enabled` must be true.
2. **Per-recipe toggle**: `settings.recipes.recipeToggles[id]` must not be false.
3. **Parameter validation**: Type, length, charset, and path confinement checks via `recipeValidator.ts`.
4. **No shell expansion**: `spawn()` called with `shell: false` and args array.
5. **Pipeline approval**: `isWriteOperation = true` triggers the governance layer.
6. **Process confinement**: `cwd = vault root`, timeout, output size limit, SIGKILL fallback.
7. **Audit trail**: Operations logged via OperationLogger.

### Built-in Recipes

| Recipe ID | Binary | Description |
|-----------|--------|-------------|
| `pandoc-pdf` | pandoc | Markdown to PDF via XeLaTeX |
| `pandoc-docx` | pandoc | Markdown to DOCX |
| `pandoc-convert` | pandoc | Any-to-any format conversion |
| `check-dependency` | which | Check if a program is installed |

### Recipe Parameter Types

- `vault-file` -- Input file path (must exist within vault)
- `vault-output` -- Output file path (must be within vault)
- `enum` -- One of a set of allowed values
- `safe-string` -- Validated against a regex pattern
- `number` -- Numeric with optional min/max bounds

### Binary Resolution
Binaries are resolved to absolute paths via `which` (macOS/Linux) or `where` (Windows) before execution. This prevents PATH hijacking attacks.

### Process Confinement
```typescript
spawn(binaryPath, args, {
    cwd: vaultRoot,
    shell: false,
    timeout: recipe.timeout,
    env: { PATH, HOME, LANG: 'en_US.UTF-8' },
    stdio: ['ignore', 'pipe', 'pipe'],
});
```

- Minimal environment: only PATH, HOME, and LANG.
- stdin ignored (no interactive input).
- stdout/stderr capped at `maxOutputSize`.
- SIGKILL sent if process does not exit within `timeout + 5000ms`.

### Custom Recipes
Users can define custom recipes via `settings.recipes.customRecipes`. These follow the same `Recipe` interface and are subject to all security layers.

---

## 8. Configuration Reference

### Plugin API Settings
```typescript
settings.pluginApi = {
    enabled: boolean;                             // Master toggle
    safeMethodOverrides: Record<string, boolean>; // "pluginId:method" -> safe flag
}
```

### Recipe Settings
```typescript
settings.recipes = {
    enabled: boolean;                       // Master toggle
    recipeToggles: Record<string, boolean>; // Per-recipe enable/disable
    customRecipes: Recipe[];                // User-defined recipes
}
```

### Skill Toggles
```typescript
settings.skillToggles: Record<string, boolean>  // Plugin ID -> enabled
```

---

## 9. Data Flow Summary

```
Plugin Startup
    |
    v
VaultDNAScanner.initialize()
    |
    +-- Load existing vault-dna.json
    +-- Full scan: core + community plugins
    +-- API discovery (reflection on .api objects)
    +-- Fetch READMEs from GitHub
    +-- Write .skill.md files
    +-- Persist vault-dna.json
    +-- Start 5s polling for changes
    |
    v
SkillRegistry
    |
    +-- Builds PLUGIN SKILLS prompt section
    +-- Active plugins with commands + descriptions
    +-- Disabled plugins with enable instructions
    |
    v
Agent Loop
    |
    +-- execute_command(command_id)     --> app.commands.executeCommandById()
    +-- call_plugin_api(plugin, method) --> plugin.api[method](...args)
    +-- execute_recipe(recipe_id)       --> child_process.spawn(binary, args)
    +-- enable_plugin(plugin_id)        --> app.plugins.enablePlugin()
    +-- resolve_capability_gap(query)   --> 3-stage keyword search in VaultDNA
```
