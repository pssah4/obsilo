# FEATURE: Plugin API Bridge & Recipe System

**Status:** Implemented
**Source:** `src/core/tools/agent/CallPluginApiTool.ts`, `src/core/tools/agent/ExecuteRecipeTool.ts`

## Summary
Two tools that extend the agent's capabilities beyond vault operations: `call_plugin_api` calls JavaScript methods on installed Obsidian plugins (e.g., Dataview queries, Omnisearch), and `execute_recipe` runs pre-defined shell recipes (e.g., Pandoc PDF conversion) with strict security confinement.

## How It Works

### call_plugin_api — Plugin API Bridge

Calls JavaScript methods on plugin instances running inside Obsidian's JS sandbox.

**Parameters:**
- `plugin_id` — plugin identifier (e.g., `"dataview"`, `"omnisearch"`)
- `method` — API method name (e.g., `"query"`, `"search"`)
- `args` — array of arguments passed to the method

**Two-Tier Authorization:**

1. **Tier 1: Built-in Allowlist** (`pluginApiAllowlist.ts`)
   - Compile-time curated list of known-safe methods
   - Each entry specifies: `pluginId`, `method`, `isWrite`, `maxReturnSize`
   - Read methods do not require approval when `autoApproval.pluginApiRead` is enabled

2. **Tier 2: Dynamic Discovery** (VaultDNA Scanner)
   - Methods discovered at runtime via reflection on `plugin.api`
   - Always treated as write operations unless user explicitly overrides in `safeMethodOverrides`
   - Requires the plugin to be in the SkillRegistry

**Security:**
- **Blocked methods:** `execute`, `executeJs`, `render`, `register`, `unregister`, etc. — hardcoded blocklist
- **10s timeout** per API call (race between result and timeout promise)
- **Return value sanitization:** Custom JSON replacer filters circular references, DOM nodes, functions, symbols, and bigints
- **Return size cap:** Truncated to `maxReturnSize` (default 50,000 chars)
- **Master toggle:** `pluginApi.enabled` must be true

**API Resolution:** Tries `plugin.api` first, then falls back to the plugin instance itself.

### execute_recipe — Recipe Shell

Executes pre-defined shell commands using `child_process.spawn` with `shell: false`.

**Parameters:**
- `recipe_id` — recipe identifier (e.g., `"pandoc-pdf"`, `"pandoc-docx"`, `"check-dependency"`)
- `params` — key-value parameter map (e.g., `{ "input": "notes/report.md", "output": "exports/report.pdf" }`)

**7 Security Layers:**
1. Master toggle (`recipes.enabled`)
2. Per-recipe toggle (`recipeToggles`)
3. Parameter validation (type, length, charset, path confinement via `recipeValidator`)
4. No shell expansion (`spawn` with args array, `shell: false`)
5. Pipeline approval (`isWriteOperation = true`)
6. Process confinement: `cwd = vault root`, timeout, output size limit, SIGKILL fallback
7. Audit trail via OperationLogger

**Binary Resolution:** Resolves binary name to absolute path via `which` (macOS/Linux) or `where` (Windows) to prevent PATH hijacking.

**Process Environment:** Minimal env: only `PATH`, `HOME`, `LANG=en_US.UTF-8`.

**Output Handling:**
- stdout/stderr capped to `maxOutputSize`
- Truncated with `[output truncated]` marker
- SIGKILL sent 5s after timeout if process doesn't exit

## Key Files
- `src/core/tools/agent/CallPluginApiTool.ts` — Plugin API bridge tool
- `src/core/tools/agent/pluginApiAllowlist.ts` — Built-in method allowlist
- `src/core/tools/agent/ExecuteRecipeTool.ts` — Recipe shell tool
- `src/core/tools/agent/recipeRegistry.ts` — Built-in recipe definitions
- `src/core/tools/agent/recipeValidator.ts` — Parameter validation logic

## Dependencies
- `App.plugins.plugins` — access to loaded plugin instances
- `VaultDNAScanner` / `SkillRegistry` — dynamic API method discovery (Tier 2)
- `child_process.spawn` — recipe process execution (Node.js)
- `ToolExecutionPipeline` — approval flow for write operations
- `OperationLogger` — audit trail for recipe executions

## Configuration
| Key | Default | Description |
|-----|---------|-------------|
| `pluginApi.enabled` | true | Master toggle for Plugin API access |
| `pluginApi.safeMethodOverrides` | `{}` | Mark dynamically discovered methods as safe (read) |
| `autoApproval.pluginApiRead` | true | Auto-approve read-only plugin API calls |
| `autoApproval.pluginApiWrite` | false | Auto-approve write plugin API calls |
| `recipes.enabled` | true | Master toggle for recipe execution |
| `recipes.recipeToggles` | `{}` | Per-recipe enable/disable map |
| `recipes.customRecipes` | `[]` | User-defined recipe definitions |
| `autoApproval.recipes` | false | Auto-approve recipe execution |

## Known Limitations / Edge Cases
- Plugin API calls run in Obsidian's main thread — a long-running or blocking method can freeze the UI until the 10s timeout fires.
- Dynamic discovery only inspects `plugin.api` prototype methods — plugins that expose functions as direct properties (not on prototype) are not discovered.
- Recipe binary resolution uses `which`/`where` — if the binary is not in PATH, execution fails even if installed.
- Recipe parameters use template substitution (`{{param}}`) — no escaping or quoting is applied to parameter values within the args array (safe because `shell: false`).
- The `safeReplacer` for JSON serialization converts functions to `"[Function]"` and DOM nodes to `"[DOMNode]"` — some plugin return values may lose information.
- Custom recipes defined in settings share the same security validation as built-in recipes.
