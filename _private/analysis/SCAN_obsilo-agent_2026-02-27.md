# Codebase Security Scan Report

**Project:** obsilo-agent (Obsidian AI Agent Plugin)  
**Date:** 2026-02-27  
**Scanner:** Codebase Security Scanner (CodeQL + SonarQube-equiv + NexusIQ-equiv)  
**Language:** TypeScript (157 files, bundled via esbuild)  
**License:** Apache-2.0

---

## Executive Summary

| Domain | Critical | High | Medium | Low | Info |
|--------|----------|------|--------|-----|------|
| CodeQL (SAST) | 0 | 0 | 6 | 33 | 0 |
| SonarQube-equiv (Quality + Security) | 0 | 6 | 13 | 11 | 3 |
| NexusIQ-equiv (SCA) | 0 | 3 | 2 | 3 | 0 |
| **Total** | **0** | **9** | **21** | **47** | **3** |

## Risk Rating: **High**

Primary risk drivers: SSRF bypass via IPv6-mapped addresses, path traversal via symlinks, vulnerable transitive dependencies (`tar`, `minimatch`), significantly outdated SDKs (`@anthropic-ai/sdk` 48 major versions behind), and `AgentTask` god-class with 570-line method.

---

## 1. CodeQL Findings

### 1.1 Security Findings (6 warnings)

#### CWE-20 — Incomplete Multi-Character Sanitization (×3)

| # | File | Lines | Severity |
|---|------|-------|----------|
| CQL-S1 | [WebFetchTool.ts](src/core/tools/web/WebFetchTool.ts#L247) | 247:14–247:49 | Warning |
| CQL-S2 | [WebFetchTool.ts](src/core/tools/web/WebFetchTool.ts#L248) | 248:14–248:48 | Warning |
| CQL-S3 | [WebFetchTool.ts](src/core/tools/web/WebFetchTool.ts#L251) | 251:14–251:39 | Warning |

**Description:** HTML sanitizer removes `<script>` / `<style>` tags via `replace()`, but a single-pass replace can be bypassed by nested payloads like `<scr<script>ipt>`. After the inner `<script>` is removed, the outer fragments re-combine into `<script>`.

**Fix:** Use a loop that re-applies the replacement until no matches remain:
```typescript
function stripTag(html: string, tag: string): string {
    const re = new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, 'gi');
    let prev = '';
    while (prev !== html) { prev = html; html = html.replace(re, ''); }
    return html;
}
```

#### CWE-20 — Missing Regular Expression Anchor (×3)

| # | File | Lines | Severity |
|---|------|-------|----------|
| CQL-S4 | [CodeConfigParser.ts](src/core/config/CodeConfigParser.ts#L109) | 109:9–109:34 | Warning |
| CQL-S5 | [CodeConfigParser.ts](src/core/config/CodeConfigParser.ts#L111) | 111:9–111:33 | Warning |
| CQL-S6 | [CodeConfigParser.ts](src/core/config/CodeConfigParser.ts#L113) | 113:9–113:31 | Warning |

**Description:** Regexes used for URL matching lack `^` anchors, so `"evil.com/anthropic.com"` would pass a check intended for `anthropic.com`.

**Fix:** Add `^https?://` or `\b` anchors to ensure the pattern matches the host position.

### 1.2 Code Quality Findings (33 recommendations + 2 warnings)

#### Useless Assignments (Warning, ×3)

| File | Line | Variable |
|------|------|----------|
| [AgentTask.ts](src/core/AgentTask.ts#L552) | 552 | `hasStreamedText` — assigned but never read |
| [AgentSidebarView.ts](src/ui/AgentSidebarView.ts#L2570) | 2570 | `activityBadgeEl` — assigned but never read |
| [AgentSidebarView.ts](src/ui/AgentSidebarView.ts#L2580) | 2580 | `activityBadgeEl` — assigned but never read |

#### Useless Conditional (Warning, ×1)

| File | Line | Variable |
|------|------|----------|
| [QueryBaseTool.ts](src/core/tools/vault/QueryBaseTool.ts#L154) | 154 | `inTargetView` — always evaluates to `true` |

#### Unused Variables/Imports (Recommendation, ×29)

| File | Line(s) | Unused Entity |
|------|---------|---------------|
| [GitCheckpointService.ts](src/core/checkpoints/GitCheckpointService.ts#L97) | 97 | Variable `vaultRoot` |
| [ModeService.ts](src/core/modes/ModeService.ts#L14) | 14 | Import `TOOL_GROUP_MAP` |
| [SyncBridge.ts](src/core/storage/SyncBridge.ts#L22) | 22 | Variable `pathModule` |
| [CallPluginApiTool.ts](src/core/tools/agent/CallPluginApiTool.ts#L170) | 170–171 | Variables `overrideKey`, `overrides` |
| [DeleteFileTool.ts](src/core/tools/vault/DeleteFileTool.ts#L1) | 1 | Import `TFile` |
| [GetVaultStatsTool.ts](src/core/tools/vault/GetVaultStatsTool.ts#L8) | 8 | Import `TFile` |
| [ListFilesTool.ts](src/core/tools/vault/ListFilesTool.ts#L1) | 1 | Import `TFolder` |
| [MoveFileTool.ts](src/core/tools/vault/MoveFileTool.ts#L1) | 1 | Import `TFile` |
| [SearchByTagTool.ts](src/core/tools/vault/SearchByTagTool.ts#L8) | 8 | Import `TFile` |
| [SearchFilesTool.ts](src/core/tools/vault/SearchFilesTool.ts#L1) | 1 | Import `TFile` |
| [AgentSidebarView.ts](src/ui/AgentSidebarView.ts#L9) | 9 | Import `resolvePromptContent` |
| [DebugTab.ts](src/ui/settings/DebugTab.ts#L1) | 1 | Imports `Notice`, `setIcon` |
| [EmbeddingsTab.ts](src/ui/settings/EmbeddingsTab.ts#L5) | 5 | Import `EMBEDDING_SUGGESTIONS` |
| [InterfaceTab.ts](src/ui/settings/InterfaceTab.ts#L1) | 1 | Import `setIcon` |
| [LoopTab.ts](src/ui/settings/LoopTab.ts#L1) | 1 | Imports `Notice`, `setIcon` |
| [McpTab.ts](src/ui/settings/McpTab.ts#L1) | 1 | Imports `Notice`, `Setting` |
| [McpTab.ts](src/ui/settings/McpTab.ts#L3) | 3 | Import `ContentEditorModal` |
| [ModelConfigModal.ts](src/ui/settings/ModelConfigModal.ts#L3) | 3 | Import `PROVIDER_COLORS` |
| [ModelsTab.ts](src/ui/settings/ModelsTab.ts#L1) | 1 | Import `Setting` |
| [ModesTab.ts](src/ui/settings/ModesTab.ts#L5) | 5 | Import `TOOL_GROUP_MAP` |
| [ModesTab.ts](src/ui/settings/ModesTab.ts#L9) | 9 | Import `ContentEditorModal` |
| [ModesTab.ts](src/ui/settings/ModesTab.ts#L12) | 12 | Import `addInfoButton` |
| [ModesTab.ts](src/ui/settings/ModesTab.ts#L295) | 295 | Variable `allGroupTools` |
| [PermissionsTab.ts](src/ui/settings/PermissionsTab.ts#L1) | 1 | Imports `Notice`, `setIcon` |
| [PromptsTab.ts](src/ui/settings/PromptsTab.ts#L1) | 1 | Import `Setting` |
| [RulesTab.ts](src/ui/settings/RulesTab.ts#L1) | 1 | Import `Setting` |
| [ShellTab.ts](src/ui/settings/ShellTab.ts#L1) | 1 | Imports `Notice`, `setIcon` |
| [VaultTab.ts](src/ui/settings/VaultTab.ts#L1) | 1 | Imports `Notice`, `setIcon` |
| [WebSearchTab.ts](src/ui/settings/WebSearchTab.ts#L1) | 1 | Imports `Notice`, `setIcon` |
| [WorkflowsTab.ts](src/ui/settings/WorkflowsTab.ts#L1) | 1 | Import `Setting` |
| [ToolPickerPopover.ts](src/ui/sidebar/ToolPickerPopover.ts#L156) | 156 | Variable `subRow` |

---

## 2. Security Vulnerabilities (SonarQube-equiv)

### 2.1 OWASP A01 — Broken Access Control

#### SEC-1: SSRF Bypass via IPv6-Mapped IPv4 Addresses [HIGH]
- **File:** [WebFetchTool.ts](src/core/tools/web/WebFetchTool.ts#L75-L88)
- **CWE:** CWE-918
- **Code:**
```typescript
const isPrivate =
    host === 'localhost' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^0\./.test(host) ||
    host === '::1' ||
    /^fc[0-9a-f]{2}:/i.test(host);
```
- **Issue:** IPv6-mapped IPv4 (`::ffff:127.0.0.1`) bypasses all checks. `new URL('http://[::ffff:127.0.0.1]/').hostname` returns `::ffff:7f00:1`, matching none of the patterns. This enables access to `localhost`, internal services, and cloud metadata endpoints (e.g., `::ffff:169.254.169.254`).
- **Fix:** Add patterns for IPv6-mapped IPv4 and link-local:
```typescript
/^::ffff:/i.test(host) ||            // IPv6-mapped IPv4
/^f[cd][0-9a-f]{2}:/i.test(host) ||  // ULA (fc00::/7)
/^fe[89ab][0-9a-f]:/i.test(host)     // Link-local (fe80::/10)
```

#### SEC-2: Incomplete IPv6 ULA Range Block [HIGH]
- **File:** [WebFetchTool.ts](src/core/tools/web/WebFetchTool.ts#L86)
- **CWE:** CWE-918
- **Issue:** Regex `/^fc[0-9a-f]{2}:/i` only matches `fc00–fcff`, missing the commonly assigned `fd00::/8` range (`fd00–fdff`). Also missing IPv6 link-local `fe80::/10`.

#### SEC-3: Symlink-Based Path Traversal in Recipe Validator [HIGH]
- **File:** [recipeValidator.ts](src/core/tools/agent/recipeValidator.ts#L55-L62)
- **CWE:** CWE-59 (Improper Link Resolution)
- **Code:**
```typescript
const resolved = path.resolve(vaultRoot, strValue);
const normalizedRoot = path.resolve(vaultRoot);
if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
    return `Path "${param.name}" escapes vault root`;
}
```
- **Issue:** `path.resolve()` normalizes `..` but does not resolve symlinks. A symlink like `vault/link → /etc/` passes the check because `vault/link/passwd` starts with the vault root. The actual file access follows the symlink.
- **Fix:** Use `fs.realpathSync()` to resolve symlinks before the boundary check.

#### SEC-4: Path Traversal in MemoryService [HIGH]
- **File:** [MemoryService.ts](src/core/memory/MemoryService.ts#L121-L127)
- **CWE:** CWE-22 (Path Traversal)
- **Code:**
```typescript
async readFile(name: string): Promise<string> {
    const path = `${this.memoryDir}/${name}`;
    try { return await this.fs.read(path); } catch { return ''; }
}
```
- **Issue:** `name` is not sanitized. A value like `../../config` escapes the memory directory. Both `readFile()` and `writeFile()` are affected.
- **Fix:**
```typescript
if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    throw new Error(`Invalid memory file name: ${name}`);
}
```

### 2.2 OWASP A02 — Cryptographic Failures

#### SEC-5: Silent Plaintext Fallback for API Keys [MEDIUM]
- **File:** [SafeStorageService.ts](src/core/security/SafeStorageService.ts#L61-L68)
- **CWE:** CWE-312 (Cleartext Storage)
- **Code:**
```typescript
encrypt(plainText: string): string {
    if (!plainText || !this.available || !this.storage) return plainText;
    try {
        const encrypted = this.storage.encryptString(plainText);
        return ENCRYPTED_PREFIX + encrypted.toString('base64');
    } catch (e) {
        console.warn('[SafeStorage] Encryption failed, storing plaintext:', e);
        return plainText;
    }
}
```
- **Issue:** When encryption unavailable or fails, API keys stored in plaintext with no user notification.
- **Fix:** Surface a flag/notification to the UI. Consider refusing to store if encryption fails.

### 2.3 OWASP A03 — Injection

#### SEC-6: Pseudo-XML Attribute Injection [LOW]
- **File:** [WebFetchTool.ts](src/core/tools/web/WebFetchTool.ts#L129), [WebSearchTool.ts](src/core/tools/web/WebSearchTool.ts#L101)
- **CWE:** CWE-74
- **Code:**
```typescript
let result = `<web_fetch url="${url}" status="${statusCode}" chars="${totalLength}">\n`;
```
- **Issue:** URL containing `"` breaks the pseudo-XML envelope, enabling prompt injection.
- **Fix:** Escape `"`, `<`, `>` in interpolated values.

### 2.4 OWASP A04 — Insecure Design

#### SEC-7: Plugin API paramSchema Never Enforced [MEDIUM]
- **File:** [CallPluginApiTool.ts](src/core/tools/agent/CallPluginApiTool.ts#L108-L112)
- **CWE:** CWE-20
- **Issue:** `AllowedApiMethod.paramSchema` is declared in the allowlist but never validated at execution time. LLM can pass arbitrary types.

#### SEC-8: Custom Recipes Lack Schema Validation [MEDIUM]
- **File:** [recipeRegistry.ts](src/core/tools/agent/recipeRegistry.ts#L112-L115)
- **CWE:** CWE-20
- **Issue:** Custom recipes loaded from user settings without validation. Malformed or shared settings could inject arbitrary binaries/ args.

#### SEC-9: Incomplete Method Denylist [MEDIUM]
- **File:** [pluginApiAllowlist.ts](src/core/tools/agent/pluginApiAllowlist.ts#L30-L40)
- **CWE:** CWE-184
- **Issue:** `BLOCKED_METHODS` omits dangerous patterns: `registerEvent`, `registerCommand`, `addCommand`, `__proto__`, `constructor`, `loadData`, `saveData`.

#### SEC-10: Unknown Tools Default to `note-edit` Approval Group [MEDIUM]
- **File:** [ToolExecutionPipeline.ts](src/core/tool-execution/ToolExecutionPipeline.ts#L304)
- **CWE:** CWE-284 (Improper Access Control)
- **Code:**
```typescript
const group = TOOL_GROUPS[toolCall.name] ?? 'note-edit';
```
- **Issue:** Unclassified tools silently fall through to `note-edit` group. If `autoApproval.noteEdits` is enabled, unknown tools auto-approve.
- **Fix:** Default to a restrictive `'unknown'` group requiring explicit approval, or throw.

### 2.5 OWASP A05 — Security Misconfiguration

No findings — no CORS, no debug-mode leaks detected.

### 2.6 OWASP A09 — Logging & Monitoring Failures

#### SEC-11: Sensitive Data in Console Warnings [LOW]
- **File:** [SafeStorageService.ts](src/core/security/SafeStorageService.ts#L50)
- **Issue:** `console.warn('[SafeStorage] OS keychain not available -- API keys will be stored in plaintext')` — while not leaking keys directly, it confirms to an attacker with console access that plaintext storage is active.

---

## 3. Security Hotspots (SonarQube-equiv)

| # | Pattern | File | Line(s) | Triage | Justification |
|---|---------|------|---------|--------|---------------|
| HS-1 | `spawn()` | [ExecuteRecipeTool.ts](src/core/tools/agent/ExecuteRecipeTool.ts#L25) | 25, 215 | **Confirmed ✓ Mitigated** | Uses `shell: false`, recipes from validated registry, params validated by `recipeValidator`. Defense-in-depth adequate. |
| HS-2 | `new RegExp()` + user input | [SearchFilesTool.ts](src/core/tools/vault/SearchFilesTool.ts#L70) | 67–72 | **Confirmed ✓ Mitigated** | Falls back to `literalEscape()` on invalid regex. ReDoS risk limited by `try/catch`. |
| HS-3 | `new RegExp()` + user input | [IgnoreService.ts](src/core/governance/IgnoreService.ts#L158) | 158, 162 | **Won't Fix** | Input comes from `.obsilignore` file (user-controlled config, not attacker input). |
| HS-4 | `new RegExp()` | [UpdateBaseTool.ts](src/core/tools/vault/UpdateBaseTool.ts#L129) | 129, 132 | **Won't Fix** | View names from vault frontmatter, not direct user input at runtime. |
| HS-5 | `new RegExp()` | [LongTermExtractor.ts](src/core/memory/LongTermExtractor.ts#L234) | 234, 261 | **Won't Fix** | Input is `sectionLevel` (a computed integer), not user-controlled. |
| HS-6 | `JSON.parse()` untrusted | [openai.ts](src/api/providers/openai.ts#L241) | 241, 284 | **Confirmed ✓ Mitigated** | Wrapped in try/catch. Malformed JSON yields error chunk/log. |
| HS-7 | `JSON.parse()` untrusted | [VaultDNAScanner.ts](src/core/skills/VaultDNAScanner.ts#L961) | 961 | **Hotspot** | Parses remote API response (`response.text`). If upstream returns malformed JSON, the `catch` handles it, but no response-size limit is enforced. Could cause OOM on malicious response. |
| HS-8 | `eval` string | [pluginApiAllowlist.ts](src/core/tools/agent/pluginApiAllowlist.ts#L37) | 37 | **False Positive** | `'eval'` is a string in the denylist, not a call. |
| HS-9 | `eval` string | [VaultDNAScanner.ts](src/core/skills/VaultDNAScanner.ts#L320) | 320 | **False Positive** | `'eval'` is a string in an array of dangerous method names to detect. |
| HS-10 | `requestUrl` (SSRF surface) | [WebFetchTool.ts](src/core/tools/web/WebFetchTool.ts) | multiple | **Confirmed** | See SEC-1, SEC-2. Private IP checks incomplete for IPv6. |
| HS-11 | `createEl` (DOM injection surface) | [ChatHistoryModal.ts](src/ui/ChatHistoryModal.ts), [DiffReviewModal.ts](src/ui/DiffReviewModal.ts) | multiple | **False Positive** | Uses Obsidian's `createEl()` API with `text:` property (auto-escaped). Not raw `innerHTML`. |
| HS-12 | Timer leak pattern | [CallPluginApiTool.ts](src/core/tools/agent/CallPluginApiTool.ts#L146-L149) | 146–149 | **Confirmed** | `setTimeout` in `Promise.race` is never cleared. Timer fires after success, creating unhandled rejection. Also in WebFetchTool and WebSearchTool. |

---

## 4. Code Quality Issues (SonarQube-equiv)

### 4.1 Bugs & Reliability

| # | Severity | File | Line(s) | Finding |
|---|----------|------|---------|---------|
| BUG-1 | **High** | [openai.ts](src/api/providers/openai.ts#L268) | 268 | Tool name concatenation (`+=`) — if name arrives in multiple SSE chunks, it duplicates (e.g., `read_fileread_file`). Use assignment instead. |
| BUG-2 | **Medium** | [openai.ts](src/api/providers/openai.ts#L275-L292) | 275–292 | Tool calls only flushed on `finish_reason === 'tool_calls'`. Some providers (Azure, DeepSeek) return `'stop'` with tool calls present — accumulated calls are silently lost. |
| BUG-3 | **Medium** | [anthropic.ts](src/api/providers/anthropic.ts#L139-L145) | 139–145 | Tool JSON parse error yields `text` chunk. Caller treats it as display text — tool failure is silently lost, agent loop doesn't retry. |
| BUG-4 | **Medium** | [ToolExecutionPipeline.ts](src/core/tool-execution/ToolExecutionPipeline.ts#L219-L222) | 219–222 | Cache invalidation uses `key.includes(pathJson)` — overly broad. Write to `"notes"` invalidates `"my-notes"`. |
| BUG-5 | **Medium** | [McpClient.ts](src/core/mcp/McpClient.ts#L92-L97) | 92–97 | Connection timeout leaves orphaned transport (spawned child process / open connection). |
| BUG-6 | **Medium** | [MemoryService.ts](src/core/memory/MemoryService.ts#L132-L135) | 132–135 | Non-atomic read-modify-write in `appendToFile()` — concurrent calls cause lost writes. |
| BUG-7 | **Low** | [AgentTask.ts](src/core/AgentTask.ts#L153-L167) | 153–167 | Race condition on `completionResult`/`pendingModeSwitch` closures — concurrent tool callbacks overwrite without first-write-wins guard. |
| BUG-8 | **Low** | [ToolRepetitionDetector.ts](src/core/tool-execution/ToolRepetitionDetector.ts#L107) | 107 | Brittle `inputKey.slice(tool.length + 1)` — fails if tool name contains `:`. |
| BUG-9 | **Low** | [MemoryService.ts](src/core/memory/MemoryService.ts#L153-L156) | 153–156 | Template skip matches against ALL templates, not the file-specific one. |

### 4.2 Error Handling

| # | Severity | File | Line(s) | Finding |
|---|----------|------|---------|---------|
| ERR-1 | **Medium** | [MemoryService.ts](src/core/memory/MemoryService.ts) | 124, 139, 178, 185, 195 | Five silent exception swallowing (`catch {}`) — hides filesystem errors. |
| ERR-2 | **Medium** | [AgentTask.ts](src/core/AgentTask.ts#L676-L679) | 676–679 | Condensing failure silently swallowed. Network errors and token-limit exceedances go undiagnosed. |
| ERR-3 | **Low** | [McpClient.ts](src/core/mcp/McpClient.ts#L118-L120) | 118–120 | Empty catch in `disconnect()` — zombie child process errors hidden. |
| ERR-4 | **Low** | [McpClient.ts](src/core/mcp/McpClient.ts#L132-L143) | 132–143 | `callTool` returns error strings instead of throwing — fragile `"Error:"` prefix checking. |

### 4.3 Maintainability & Code Smells

| # | Severity | File | Line(s) | Finding |
|---|----------|------|---------|---------|
| MAINT-1 | **High** | [AgentTask.ts](src/core/AgentTask.ts#L63-L742) | 63–742 | **God class** — 742 LOC, `run()` method is ~570 lines. All agentic logic in one method. |
| MAINT-2 | **High** | [AgentTask.ts](src/core/AgentTask.ts#L88-L133) | 88–133 | **Excessive parameters** — constructor: 12 params, `run()`: 16 params. Should use option objects. |
| MAINT-3 | **Medium** | [AgentTask.ts](src/core/AgentTask.ts) | multiple | **`any` casts** — `(this.toolRegistry as any).plugin`, `(this.api as any).getModel?.()`. Type holes for critical operations. |
| MAINT-4 | **Medium** | [ToolExecutionPipeline.ts](src/core/tool-execution/ToolExecutionPipeline.ts) | 264, 347 | **`any` casts** — `(this.plugin as any).ignoreService`, `(this.plugin as any).operationLogger`. |
| MAINT-5 | **Medium** | [anthropic.ts](src/api/providers/anthropic.ts#L112) | 112, 122 | **`any` casts** — `(event.content_block as any).type === 'thinking'` — untyped SDK events for extended thinking. |
| MAINT-6 | **Low** | [AgentTask.ts](src/core/AgentTask.ts) | 315, 613, 647, 654 | **Magic numbers** — `0.6`, `7`, `4`, `4` — should be named constants. |
| MAINT-7 | **Low** | [AgentTask.ts](src/core/AgentTask.ts#L735-L738) | 735–738 | **Dynamic `require()`** — `require('./modes/builtinModes')` breaks tree-shaking. Use static import. |
| MAINT-8 | **Low** | [CallPluginApiTool.ts](src/core/tools/agent/CallPluginApiTool.ts#L131-L133) | 131–133 | **Dead code** — `overrideKey` and `overrides` computed but never used. |
| MAINT-9 | **Low** | [CallPluginApiTool.ts](src/core/tools/agent/CallPluginApiTool.ts#L175-L178) | 175–178 | **Inconsistent override logic** — `isWriteCall()` respects overrides but `execute()` ignores them. |

### 4.4 Duplications

No automated `jscpd` installed. Manual inspection identified:

| Pattern | Locations | Description |
|---------|-----------|-------------|
| Timer-leak `Promise.race` | `CallPluginApiTool.ts:146`, `WebFetchTool.ts:96`, `WebSearchTool.ts:129`, `McpClient.ts:92` | Same `Promise.race` + uncleared `setTimeout` pattern repeated 4×. Extract a `withTimeout(promise, ms, msg)` utility. |
| Unused import pattern | 17 settings tab files | Identical unused `Notice`, `setIcon`, `Setting` imports across settings tabs. Suggests copy-paste scaffolding. |
| `(adapter as any).basePath ?? (adapter as any).getBasePath?.()` | `ExecuteRecipeTool.ts:107`, likely elsewhere | Vault root resolution via unsafe casts duplicated. Extract to a utility. |

---

## 5. Dependency Vulnerabilities (NexusIQ-equiv)

### 5.1 CVE Findings (from `npm audit`)

| # | Package | Severity | CVSS | CVE / Advisory | Description | Fix |
|---|---------|----------|------|----------------|-------------|-----|
| DEP-1 | `tar` ≤7.5.7 | **High** | 8.8 | GHSA-r6q2-hw4h-h46w | Race condition in path reservations via Unicode ligature collisions on macOS APFS | Update `tar` |
| DEP-2 | `tar` <7.5.8 | **High** | 7.1 | GHSA-83g3-92jg-28cx | Arbitrary file read/write via hardlink target escape through symlink chain | Update `tar` |
| DEP-3 | `tar` ≤7.5.3 | **High** | — | GHSA-8qq5-rm4j-mr97 | Arbitrary file overwrite via insufficient path sanitization | Update `tar` |
| DEP-4 | `tar` <7.5.7 | **High** | 8.2 | GHSA-34x7-hfp2-rc4v | Arbitrary file creation/overwrite via hardlink path traversal | Update `tar` |
| DEP-5 | `minimatch` <3.1.4, 10.0.0–10.2.2 | **High** | 7.5 | GHSA-23c5-xmqv-rm74 | ReDoS: nested `*()` extglobs catastrophic backtracking | Update `minimatch` |
| DEP-6 | `minimatch` ≥10.0.0 <10.2.3 | **High** | 7.5 | GHSA-7r86-cg39-jmmj | ReDoS: `matchOne()` combinatorial backtracking | Update `minimatch` |
| DEP-7 | `@mapbox/node-pre-gyp` ≤1.0.11 | **High** | — | (via `tar`) | Transitive exposure through `tar` | Update `tar` |

**Note:** All 3 `npm audit` findings have `fixAvailable: true`. Run `npm audit fix` to resolve.

### 5.2 Outdated Dependencies (Major Version Lag)

| Package | Current | Latest | Version Lag | Risk |
|---------|---------|--------|-------------|------|
| `@anthropic-ai/sdk` | 0.30.1 | 0.78.0 | **48 minor versions** | ⚠️ Missing security patches, breaking changes accumulated |
| `openai` | 4.104.0 | 6.25.0 | **2 major versions** | ⚠️ Missing new API features, potential deprecations |
| `@orama/orama` | 2.1.1 | 3.1.18 | **1 major version** | ⚠️ Breaking changes, performance improvements missed |
| `pdfjs-dist` | 4.4.168 | 5.4.624 | **1 major version** | ⚠️ Security and rendering fixes |
| `pdf-parse` | 1.1.1 | 2.4.5 | **1 major version** | ⚠️ Parsing improvements, potential CVE fixes |
| `diff` | 5.2.2 | 8.0.3 | **3 major versions** | ⚠️ Significantly behind |
| `uuid` | 9.0.1 | 13.0.0 | **4 major versions** | ⚠️ Significantly behind |
| `typescript` | 5.3.3 | 5.9.3 | 6 minor versions | Low risk (same major) |

---

## 6. License Compliance (NexusIQ-equiv)

| License | Count | Policy |
|---------|-------|--------|
| MIT | 274 | ✅ Allowed |
| Apache-2.0 | 21 | ✅ Allowed |
| BSD-2-Clause | 20 | ✅ Allowed |
| ISC | 16 | ✅ Allowed |
| BSD-3-Clause | 5 | ✅ Allowed |
| 0BSD | 1 | ✅ Allowed |
| (MIT AND Zlib) | 1 | ✅ Allowed |
| (MIT AND BSD-3-Clause) | 1 | ✅ Allowed |
| (MIT OR CC0-1.0) | 1 | ✅ Allowed |
| BlueOak-1.0.0 | 1 | ✅ Allowed (permissive) |
| **MPL-2.0** | 1 | ⚠️ **Review** — `eslint-plugin-no-unsanitized` — weak copyleft, requires source disclosure if modified |
| **Python-2.0** | 1 | ⚠️ **Review** — `argparse@2.0.1` — permissive in practice but uncommon; verify compatibility |

**Verdict:** No GPL, AGPL, or SSPL licenses detected. Two packages require legal review but are low risk (both are dev-only tools, not shipped in the production bundle).

---

## 7. Component Hygiene (NexusIQ-equiv)

| Check | Finding |
|-------|---------|
| Deprecated packages | None detected |
| Lock file | ✅ `package-lock.json` tracked in git |
| Dependency count | 233 production, 143 dev (total 421) — moderate for this type of project |
| `lodash.debounce@4.0.8` | Last major release 2016. Consider replacing with native `AbortController`+`setTimeout` or a maintained alternative |
| `pdf-parse@1.1.1` | Published 2019, minimal maintenance. Consider `pdfjs-dist` only (already a dependency) |

---

## 8. Supply Chain Risk (NexusIQ-equiv)

| Check | Status |
|-------|--------|
| Lock file committed | ✅ Yes |
| Install scripts | esbuild (platform binaries, expected), others are `prepare` scripts (build step), not arbitrary execution |
| Typosquatting | No suspicious package names detected |
| Scope confusion | No mixed scoped/unscoped packages with same name |
| Version pinning | Uses `^` ranges (standard for npm). Lock file provides deterministic installs. |
| Supply chain attack indicators | None detected |

---

## Recommended Fix Priority

### Must Fix Before Release (Critical + High) — 9 items

| # | Finding | File | Fix |
|---|---------|------|-----|
| 1 | **SEC-1/SEC-2: SSRF bypass via IPv6** | [WebFetchTool.ts](src/core/tools/web/WebFetchTool.ts#L75-L88) | Add `::ffff:`, `fd**:`, `fe80:` patterns to private IP block list |
| 2 | **SEC-3: Symlink path traversal** | [recipeValidator.ts](src/core/tools/agent/recipeValidator.ts#L55-L62) | Use `fs.realpathSync()` after `path.resolve()` |
| 3 | **SEC-4: Memory path traversal** | [MemoryService.ts](src/core/memory/MemoryService.ts#L121-L127) | Validate `name` has no `..`, `/`, `\` |
| 4 | **BUG-1: OpenAI tool name concat** | [openai.ts](src/api/providers/openai.ts#L268) | Change `+=` to `=` for `acc.name` |
| 5 | **CQL-S1/S2/S3: Incomplete HTML sanitization** | [WebFetchTool.ts](src/core/tools/web/WebFetchTool.ts#L247-L251) | Loop `replace()` until stable |
| 6 | **CQL-S4/S5/S6: Unanchored regex** | [CodeConfigParser.ts](src/core/config/CodeConfigParser.ts#L109-L113) | Add `^https?://` anchors |
| 7 | **DEP-1–7: Vulnerable dependencies** | package.json | Run `npm audit fix`, update `tar` and `minimatch` |
| 8 | **MAINT-1/MAINT-2: God class** | [AgentTask.ts](src/core/AgentTask.ts) | Extract `run()` into smaller methods + option objects |
| 9 | **BUG-2: Tool calls lost on `stop`** | [openai.ts](src/api/providers/openai.ts#L275-L292) | Flush accumulators after stream loop ends |

### Should Fix (Medium) — 12 items

| # | Finding | File | Fix |
|---|---------|------|-----|
| 1 | SEC-5: Plaintext fallback | SafeStorageService.ts | Add UI notification when encryption unavailable |
| 2 | SEC-7: paramSchema not enforced | CallPluginApiTool.ts | Add runtime type-check using paramSchema |
| 3 | SEC-8: Custom recipe validation | recipeRegistry.ts | Add `validateRecipeDefinition()` |
| 4 | SEC-9: Incomplete denylist | pluginApiAllowlist.ts | Extend `BLOCKED_METHODS` + add pattern matching |
| 5 | SEC-10: Unknown tool default group | ToolExecutionPipeline.ts | Default to restrictive `'unknown'` group |
| 6 | BUG-3: Anthropic tool parse error | anthropic.ts | Yield error-typed chunk instead of text |
| 7 | BUG-4: Overly broad cache invalidation | ToolExecutionPipeline.ts | Use exact path comparison |
| 8 | BUG-5: MCP connection timeout leak | McpClient.ts | Clean up transport on timeout |
| 9 | BUG-6: Non-atomic append | MemoryService.ts | Add async mutex for file writes |
| 10 | ERR-1: Silent exception swallowing | MemoryService.ts | Add `console.warn` logging |
| 11 | ERR-2: Condensing failure silent | AgentTask.ts | Log condensing errors |
| 12 | MAINT-3/4/5: any casts | AgentTask.ts, ToolExecutionPipeline.ts, anthropic.ts | Add proper interface types |

### Consider Fixing (Low + Info) — 17+ items

| # | Finding | File | Fix |
|---|---------|------|-----|
| 1 | SEC-6: Pseudo-XML injection | WebFetchTool.ts, WebSearchTool.ts | Escape quotes/angles in attributes |
| 2 | SEC-11: Sensitive data in logs | SafeStorageService.ts | Reduce log verbosity |
| 3 | BUG-7: Race on closures | AgentTask.ts | Add first-write-wins guard |
| 4 | BUG-8: Brittle key slice | ToolRepetitionDetector.ts | Use `indexOf(':')` |
| 5 | BUG-9: Template skip logic | MemoryService.ts | Compare file-specific template only |
| 6 | ERR-3/4: McpClient error handling | McpClient.ts | Log close errors, return typed results |
| 7 | MAINT-6: Magic numbers | AgentTask.ts | Extract named constants |
| 8 | MAINT-7: Dynamic require | AgentTask.ts | Use static import |
| 9 | MAINT-8/9: Dead code / inconsistent overrides | CallPluginApiTool.ts | Wire up or remove |
| 10 | HS-12: Timer leak pattern (×4) | Multiple files | Extract `withTimeout()` utility |
| 11 | 29 unused imports/variables | Multiple files | Clean up with `eslint --fix` or manually |
| 12 | Outdated SDKs | package.json | Update `@anthropic-ai/sdk`, `openai`, `@orama/orama` |
| 13 | `lodash.debounce` age | package.json | Replace with native or maintained alternative |
| 14 | `pdf-parse` age | package.json | Consider using `pdfjs-dist` only |
| 15 | MPL-2.0 license review | eslint-plugin-no-unsanitized | Verify dev-only, not bundled |
| 16 | Python-2.0 license review | argparse | Verify dev-only, not bundled |
| 17 | QueryBaseTool useless conditional | QueryBaseTool.ts:154 | Remove dead branch |

---

*Report generated by Codebase Security Scanner — CodeQL 2.24.2 + manual static analysis*
