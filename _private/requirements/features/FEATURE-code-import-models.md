# FEATURE: Import Models from Code Snippet

**Status:** Implemented
**Source:** `src/core/config/CodeConfigParser.ts`, `src/ui/settings/CodeImportModal.ts`

## Summary

Enterprise users receive API access credentials as code snippets in documentation (Python, JavaScript, curl). These contain base URL, API version, and model names — but manually transferring each value into Obsilo's model configuration is error-prone and tedious. This feature adds an "Import from Code" button that opens a modal where users paste their code snippet. A parser automatically extracts provider, base URL, API version, and all model names. The user only needs to add their API key.

## Motivation

### Problem
Adding models from enterprise API gateways (e.g., Azure OpenAI) requires:
1. Identifying the correct provider type (azure vs. openai vs. custom)
2. Copying the base URL exactly (long, error-prone)
3. Setting the correct API version
4. Creating a separate model entry for each available model (often 3-5 models per endpoint)

Users receive documentation with ready-to-use code snippets, but must manually decompose them into individual form fields. This is the #1 friction point for enterprise onboarding.

### Solution
A code parser that extracts configuration from pasted snippets and creates multiple `CustomModel` entries in bulk. The parser supports Python (most common in API docs), JavaScript/TypeScript, and curl commands.

## User Stories

- As an enterprise user, I want to paste my API code snippet and have all models auto-configured, so I only need to add my API key.
- As a user, I want to see a preview of what will be imported before committing, so I can verify the configuration is correct.
- As a user, I want duplicate detection, so I don't accidentally create model entries that already exist.
- As a user, I want the parser to handle partial matches gracefully, so incomplete snippets still provide useful configuration.

## Acceptance Criteria

- [x] "Import from Code" button visible in Models tab footer next to "+ Add Model"
- [x] Modal opens with large monospace textarea, placeholder with example snippets
- [x] **Python snippets parsed**: `openai.AzureOpenAI(base_url=..., api_version=...)` + `.create(model=...)`
- [x] **JS/TS snippets parsed**: `new AzureOpenAI({ endpoint: ..., apiVersion: ... })` + `model: "..."`
- [x] **curl commands parsed**: URL, `-H "api-key: ..."`, `"model": "..."` from JSON body
- [x] **Provider auto-detected**: Azure, OpenAI, Anthropic from client class names or URL patterns
- [x] **Env var references detected**: `os.environ[...]`, `process.env.`, `$VAR` — flagged, not extracted as values
- [x] **Preview section** shows: format tag, provider badge, base URL, API version, model list with duplicate indicators
- [x] **Manual provider selection** when auto-detection fails (dropdown fallback)
- [x] **API Key input** in modal — optional, can also be added later via model settings
- [x] **Bulk import**: One click creates N models sharing the same base config
- [x] **Duplicate detection**: Models already in `activeModels` shown with warning, skipped on import
- [x] **Auto-parse**: Debounced (500ms) on textarea input for instant feedback
- [x] Parser never throws — partial results returned with warnings

## Technical Design

### New Files

| File | Purpose |
|------|---------|
| `src/core/config/CodeConfigParser.ts` | Pure parsing logic — zero UI/Obsidian dependencies. Takes string, returns `ParsedCodeConfig` |
| `src/ui/settings/CodeImportModal.ts` | Obsidian `Modal` subclass. Textarea + parse preview + API key field + import button |

### Modified Files

| File | Change |
|------|--------|
| `src/ui/settings/ModelsTab.ts` | Add "Import from Code" button, wire `CodeImportModal` |
| `styles.css` | Add `.cim-*` CSS classes for modal |

### Parser Design

3-phase approach:
1. **Format detection**: Regex markers for Python, JS, curl
2. **Provider detection**: Client class names (`AzureOpenAI`, `OpenAI`, `Anthropic`) or URL/header patterns
3. **Field extraction**: Format-specific regex for base_url, api_key, api_version, model names

Supports:
- Multiple models per snippet (e.g., 3 `.create(model=...)` calls → 3 models)
- Base URL normalization (strip trailing slash, Azure path truncation)
- Model name deduplication (Set-based, preserves order)
- Graceful partial matching (warnings, never errors)

### Modal Design

```
+------------------------------------------------------+
|  Import Models from Code                             |
+------------------------------------------------------+
|  [Textarea: 15 lines, monospace, placeholder]        |
+------------------------------------------------------+
|  Preview:                                            |
|  [python] [Azure OpenAI]                             |
|  Base URL: https://api.example.com/openai            |
|  API Version: 2024-10-21                             |
|  Models (3): gpt-5 (ok), gpt-5-mini (ok), gpt-4.1   |
+------------------------------------------------------+
|  API Key: [____________]                             |
|  [Cancel]                      [Import 3 Models]     |
+------------------------------------------------------+
```

### Integration Pattern

Modal receives `existingModelKeys: Set<string>` for duplicate detection and `onImport: (models: CustomModel[]) => void` callback. ModelsTab handles persistence (push to `activeModels`, save settings, rerender).

## Key Files

- `src/core/config/CodeConfigParser.ts` — parser (new)
- `src/ui/settings/CodeImportModal.ts` — modal (new)
- `src/ui/settings/ModelsTab.ts` — integration point
- `src/ui/settings/constants.ts` — `PROVIDER_LABELS`, `PROVIDER_COLORS` (reused)
- `src/types/settings.ts` — `CustomModel`, `getModelKey()` (reused)

## Dependencies

- `CustomModel` interface and `getModelKey()` from `src/types/settings.ts`
- `PROVIDER_LABELS`, `PROVIDER_COLORS` from `src/ui/settings/constants.ts`
- Obsidian `Modal` API, `setIcon()` for UI rendering

## Configuration

No new settings required. The feature uses existing `activeModels` array and `getModelKey()` for storage and duplicate detection.

## Known Limitations

- Parser uses regex, not a full AST — may not handle complex multi-line string interpolation or deeply nested code
- Only the three most common snippet formats (Python, JS/TS, curl) are supported
- Environment variable detection covers common patterns but may miss custom patterns
- API key validation is not performed during import — user should use "Test Connection" in model settings after import
