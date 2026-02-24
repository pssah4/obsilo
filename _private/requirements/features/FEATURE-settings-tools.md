# FEATURE: Agent Self-Configuration Tools

**Status:** Implemented
**Source:** `src/core/tools/agent/UpdateSettingsTool.ts`, `src/core/tools/agent/ConfigureModelTool.ts`

## Summary
Two tools that allow the agent to programmatically change plugin settings and manage LLM models. `update_settings` modifies individual settings by dot-path or applies permission presets. `configure_model` adds, selects, and tests LLM provider connections. Together they enable the agent to configure itself during onboarding or when the user requests changes.

## How It Works

### update_settings

**Actions:**

1. **`set`** — Change a single setting by dot-path
   - Path must be in the `WRITABLE_PATHS` allowlist (60+ paths covering auto-approval, advanced API, semantic index, checkpoints, memory, UI, web tools, VaultDNA, plugin API, recipes, onboarding, and debug)
   - Navigates the nested settings object via dot-path split
   - Saves settings and reinitializes API handler
   - When `webTools.*` paths change, invalidates the tool cache so tool definitions are rebuilt

2. **`apply_preset`** — Apply a named permission preset
   - `permissive` — all operations auto-approved
   - `balanced` — reads + skills auto-approved, writes require confirmation
   - `restrictive` — all operations require confirmation
   - Applies as a partial merge to `autoApproval` settings

3. **`open_tab`** — Open a specific settings tab for the user
   - Calls `plugin.openSettingsAt(tab, subTab)` to navigate the settings UI
   - Available tabs: `"providers"`, `"agent-behaviour"`, `"advanced"`
   - Sub-tabs: `"backup"`, `"models"`, `"permissions"`, `"interface"`

**Security:** API keys are explicitly NOT writable via `update_settings`. The `WRITABLE_PATHS` set controls exactly which settings can be modified.

### configure_model

**Actions:**

1. **`add`** — Add a new model with API key
   - Supports built-in models (Claude, GPT, Gemini, Llama, Qwen) — only needs API key
   - For custom providers: requires `provider`, `model_name`, `api_key`, optionally `base_url`
   - If model already exists in `activeModels`, updates the existing entry
   - Auto-selects as active model if no model is currently active

2. **`select`** — Switch the active model
   - Requires `model_key` (format: `"name|provider"`)
   - Sets `activeModelKey` and reinitializes API handler

3. **`test`** — Test API connectivity
   - Sends a minimal request: system prompt "Respond with exactly: OK", user message "Test connection"
   - Streams up to 50 characters to confirm the model responds
   - Reports success or failure with error details

**Built-in Model Support:** The tool checks `BUILT_IN_MODELS` for pre-configured entries. If a built-in model matches the `model_name`, the provider, base URL, and display name are auto-filled.

## Key Files
- `src/core/tools/agent/UpdateSettingsTool.ts` — settings modification tool
- `src/core/tools/agent/ConfigureModelTool.ts` — model management tool
- `src/types/settings.ts` — `ObsidianAgentSettings`, `CustomModel`, `BUILT_IN_MODELS`
- `src/api/index.ts` — `buildApiHandler()`, `buildApiHandlerForModel()`

## Dependencies
- `ObsidianAgentPlugin.settings` — direct settings object mutation
- `ObsidianAgentPlugin.saveSettings()` — persists to disk + reinitializes API handler
- `ObsidianAgentPlugin.openSettingsAt()` — navigates the Obsidian settings modal
- `buildApiHandlerForModel()` — creates a temporary API handler for connectivity testing
- `getModelKey()` — generates the `"name|provider"` key format

## Configuration
| Key | Default | Description |
|-----|---------|-------------|
| (none) | - | Both tools are always available when registered; no separate toggle |

## Known Limitations / Edge Cases
- `update_settings` with action `set` does minimal type validation — setting a string where a boolean is expected will succeed but may cause runtime errors.
- The `WRITABLE_PATHS` allowlist must be manually maintained when new settings are added.
- `configure_model` with action `test` creates a temporary API handler and fires a real API request — this counts against rate limits and billing.
- API keys set via `configure_model` are stored in `data.json` in the vault — they are not encrypted at rest.
- Both tools have `isWriteOperation = false` — they modify settings, not vault files, so they bypass the write approval pipeline.
- Preset application overwrites all `autoApproval` fields — there is no merge with user's partial customizations.
- The `open_tab` action requires the Obsidian settings modal to exist — calling it programmatically from a headless context will silently fail.
