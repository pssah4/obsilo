# FEATURE: Safe Storage (Encrypted API Keys)

**Status:** In Progress
**Source:** `src/core/security/SafeStorageService.ts`, `src/main.ts`

## Summary
API keys for chat models, embedding models, and web search providers are encrypted at rest using Electron's `safeStorage` API, which delegates to the OS keychain (macOS Keychain, Windows DPAPI, Linux libsecret). Keys are decrypted on plugin load and re-encrypted on every save, so in-memory they remain plaintext and all downstream consumers (providers, tools, UI) are unaffected.

## Problem
API keys stored as plaintext in `data.json` (CWE-312: Cleartext Storage of Sensitive Information). Risk vectors:
- Vault sync (iCloud, Git, Obsidian Sync) exposes keys to cloud storage
- Backup services include `.obsidian/` directory
- Local file access on shared or compromised devices

## How It Works

### Centralized Intercept Pattern
Encryption/decryption happens exclusively at the `loadSettings()`/`saveSettings()` boundary in `main.ts`:

```
[User enters key] --> this.settings.apiKey = "sk-abc" (plaintext in memory)
       |
       v
[saveSettings()] --> encryptSettingsForSave() creates deep copy
       |               "sk-abc" --> "enc:v1:R29vZC1tb3Ju..."
       v
[saveData(encryptedCopy)] --> data.json has encrypted values

=== On next load ===

[loadData()] --> raw data.json with encrypted values
       |
       v
[decryptSettings()] --> restores plaintext in memory
       |               "enc:v1:R29vZC1tb3Ju..." --> "sk-abc"
       v
[Providers, tools, UI read plaintext -- zero changes needed]
```

### Encrypted Value Format
```
enc:v1:<base64-encoded-ciphertext>
```
- `enc:v1:` prefix distinguishes encrypted from plaintext values
- Self-describing: no external marker needed per field
- `_encrypted: boolean` on settings marks whether migration has run

### Affected Fields
| Field | Interface | Location |
|-------|-----------|----------|
| `activeModels[].apiKey` | `CustomModel` | Per-model API keys |
| `embeddingModels[].apiKey` | `CustomModel` | Embedding model keys |
| `webTools.braveApiKey` | `WebToolsSettings` | Brave Search API key |
| `webTools.tavilyApiKey` | `WebToolsSettings` | Tavily Search API key |

### SafeStorageService
Stateless utility wrapping Electron's `safeStorage` module:
- `isAvailable()` -- checks `safeStorage.isEncryptionAvailable()`
- `encrypt(plainText)` -- returns `enc:v1:<base64>` or plaintext on failure
- `decrypt(value)` -- detects prefix, decrypts, returns plaintext

### Fallback Behavior
When OS keychain is unavailable (Linux without secret service, CI environments):
- `encrypt()` returns plaintext unchanged
- `decrypt()` returns plaintext unchanged
- Console warning logged once
- Plugin functions normally with plaintext storage (current behavior preserved)

### Automatic Migration
On first load with safeStorage available:
1. Detect existing plaintext keys (`_encrypted` absent or false)
2. Encrypt all keys via `encryptSettingsForSave()`
3. Write back to `data.json`
4. One-way, transparent, no user action required

## Key Files
- `src/core/security/SafeStorageService.ts` -- Encryption/decryption service
- `src/main.ts` -- Integration (loadSettings/saveSettings boundary)
- `src/types/settings.ts` -- `_encrypted` marker field

## Dependencies
- Electron `safeStorage` module (available at runtime in Obsidian)
- No external npm packages required

## Configuration
No user-facing configuration. Encryption is automatic when OS keychain is available.

## Known Limitations / Edge Cases
- Cross-device sync: encrypted keys from device A cannot be decrypted on device B (different OS keychain). Keys must be re-entered.
- Plugin downgrade: older versions without safeStorage support will see `enc:v1:...` strings instead of working keys.
- Backup/restore: exported settings contain plaintext (in-memory snapshot). Re-encrypted on import via normal `saveSettings()` path.
