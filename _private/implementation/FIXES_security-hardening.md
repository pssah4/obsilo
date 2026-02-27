# FIXES: Security Hardening

> Implementation guide for Claude Code.  
> Generated: 2025-02-25  
> Source: Full codebase security review (OWASP Top 10 + LLM Top 10 + Zero Trust)  
> Priority: Critical fixes first, then High, then Medium.

---

## Overview

| # | Priority | File | Issue |
|---|----------|------|-------|
| 1 | P1 Critical | `src/core/tool-execution/ToolExecutionPipeline.ts` | `update_settings` / `configure_model` auto-approved — privilege escalation via prompt injection |
| 2 | P1 Critical | `src/core/governance/IgnoreService.ts` | `.obsidian/` mostly unblocked — JS injection via plugin files |
| 3 | P2 High | `src/core/mcp/McpClient.ts` | SSE/HTTP URLs not checked for private IPs (SSRF) |
| 4 | P3 Medium | `src/core/governance/IgnoreService.ts` | Missing `?` glob wildcard support |
| 5 | P3 Medium | `src/core/tools/vault/EditFileTool.ts` | `tryNormalizedMatch()` destroys file indentation |

---

## Fix 1 — Settings Tool Group (P1 Critical)

**Problem:** `update_settings` and `configure_model` are mapped to the `'agent'` group, which is always auto-approved without user consent. A prompt-injection attack could silently change API keys, provider endpoints, or auto-approval settings.

**File:** `src/core/tool-execution/ToolExecutionPipeline.ts`

### Step 1.1 — Add `'settings'` to ToolGroup union (line 31)

```
FIND:
type ToolGroup = 'read' | 'note-edit' | 'vault-change' | 'web' | 'agent' | 'mode' | 'subtask' | 'mcp' | 'skill' | 'plugin-api' | 'recipe';

REPLACE WITH:
type ToolGroup = 'read' | 'note-edit' | 'vault-change' | 'web' | 'agent' | 'mode' | 'subtask' | 'mcp' | 'skill' | 'plugin-api' | 'recipe' | 'settings';
```

### Step 1.2 — Remap the two tools from `'agent'` to `'settings'` (lines ~82-83)

```
FIND:
    // Settings & Model configuration (Onboarding)
    update_settings: 'agent',
    configure_model: 'agent',

REPLACE WITH:
    // Settings & Model configuration (Onboarding) — always require explicit approval
    update_settings: 'settings',
    configure_model: 'settings',
```

### Step 1.3 — Add `'settings'` to `checkApproval()` — always require approval (after line ~265)

In `checkApproval()`, the `'settings'` group must NEVER be auto-approved. It must always go through the user-approval path. Add this right after the `if (group === 'agent')` early return:

```
FIND:
        // Agent tools (question, todo, completion, open_note) are always auto-approved
        if (group === 'agent') return { decision: 'auto' };

        // Check if auto-approved by settings

REPLACE WITH:
        // Agent tools (question, todo, completion, open_note) are always auto-approved
        if (group === 'agent') return { decision: 'auto' };

        // Settings/model changes always require explicit user approval (never auto)
        if (group === 'settings') {
            if (!extensions?.onApprovalRequired) {
                console.warn(`[Pipeline] Settings change via ${toolCall.name} — no approval callback, denying`);
                return { decision: 'rejected' };
            }
            return await extensions.onApprovalRequired(toolCall.name, toolCall.input);
        }

        // Check if auto-approved by settings
```

### Verification

After applying, confirm:
1. `update_settings` and `configure_model` are in the `'settings'` group in `TOOL_GROUPS`
2. The `checkApproval()` method has the `if (group === 'settings')` block
3. `npm run build` succeeds

---

## Fix 2 — Block `.obsidian/` Directory (P1 Critical)

**Problem:** `ALWAYS_BLOCKED` only blocks `.git/`, `.obsidian/workspace`, `.obsidian/workspace.json`, `.obsidian/cache`. This leaves `.obsidian/plugins/*/main.js` writable, enabling arbitrary JavaScript injection that runs next time Obsidian loads the plugin.

**File:** `src/core/governance/IgnoreService.ts`

### Step 2.1 — Replace ALWAYS_BLOCKED array (lines 23-28)

```
FIND:
    /** Paths always blocked regardless of config */
    private static readonly ALWAYS_BLOCKED: string[] = [
        '.git/',
        '.obsidian/workspace',
        '.obsidian/workspace.json',
        '.obsidian/cache',
    ];

REPLACE WITH:
    /** Paths always blocked regardless of config */
    private static readonly ALWAYS_BLOCKED: string[] = [
        '.git/',
        '.obsidian/',
    ];
```

**Note:** This blocks ALL reads and writes to `.obsidian/`. The `WriteFileTool` already has a `writeViaAdapter()` path for `.obsidian/` and `.obsidian-agent/` config files — but now the IgnoreService will block it at the pipeline level. If there are legitimate tool calls that need to write `.obsidian-agent/` config (not `.obsidian/`), you may need to keep `.obsidian-agent/` unblocked by NOT prefixing it. Since `.obsidian-agent/` does NOT start with `.obsidian/` (it starts with `.obsidian-agent/`), it is already a separate path and will NOT be affected by this change.

### Important — Verify `.obsidian-agent/` is unaffected

The `isIgnored()` method checks:
```typescript
if (normalPath === blocked || normalPath.startsWith(blocked)) return true;
```

- `.obsidian-agent/foo` does NOT startWith `.obsidian/` — SAFE, not blocked.
- `.obsidian/plugins/foo/main.js` DOES startWith `.obsidian/` — BLOCKED as intended.

### Verification

After applying, confirm:
1. `ALWAYS_BLOCKED` contains only `'.git/'` and `'.obsidian/'`
2. `npm run build` succeeds
3. Manual test: an agent task attempting to write to `.obsidian/plugins/` should be denied

---

## Fix 3 — MCP URL SSRF Warning (P2 High)

**Problem:** MCP `sse` and `streamable-http` transports accept arbitrary URLs from user config. A compromised LLM prompt could not configure these directly (the user does it in settings), but a defense-in-depth warning for private/internal URLs is worthwhile.

**File:** `src/core/mcp/McpClient.ts`

**Approach:** Warn-only (no blocking). MCP server URLs are user-configured in settings, so blocking would harm usability. A console warning for private IPs provides auditability.

### Step 3.1 — Add private IP check helper and call it (after `validateStdioCommand` method)

Find the end of the `validateStdioCommand` method and add a new method after it:

```
FIND:
    private validateStdioCommand(command: string, args: string[]): void {
        const DANGEROUS = /[;&|`$(){}[\]<>\\]/;
        if (DANGEROUS.test(command)) {
            throw new Error(`MCP stdio command contains shell metacharacters: "${command}"`);
        }

REPLACE WITH:
    private validateStdioCommand(command: string, args: string[]): void {
        const DANGEROUS = /[;&|`$(){}[\]<>\\]/;
        if (DANGEROUS.test(command)) {
            throw new Error(`MCP stdio command contains shell metacharacters: "${command}"`);
        }
```

Wait — the above would be a no-op. Instead, find the complete `validateStdioCommand` method and add the new method after it. Let me provide the proper anchor.

**Better approach:** Add the helper method AND call it at the transport creation sites.

### Step 3.1a — Add `warnIfPrivateUrl` method

Find the closing brace of `validateStdioCommand` (read the full method to find the exact end) and add the new method after it. The method should be placed after `validateStdioCommand`:

```
FIND (exact lines from file):
    private validateStdioCommand(command: string, args: string[]): void {
        const DANGEROUS = /[;&|`$(){}[\]<>\\]/;
        if (DANGEROUS.test(command)) {
            throw new Error(`MCP stdio command contains shell metacharacters: "${command}"`);
        }
        for (const arg of args) {
            if (DANGEROUS.test(arg)) {
                throw new Error(`MCP stdio argument contains shell metacharacters: "${arg}"`);
            }
        }
    }

REPLACE WITH:
    private validateStdioCommand(command: string, args: string[]): void {
        const DANGEROUS = /[;&|`$(){}[\]<>\\]/;
        if (DANGEROUS.test(command)) {
            throw new Error(`MCP stdio command contains shell metacharacters: "${command}"`);
        }
        for (const arg of args) {
            if (DANGEROUS.test(arg)) {
                throw new Error(`MCP stdio argument contains shell metacharacters: "${arg}"`);
            }
        }
    }

    /**
     * Log a warning if the URL points to a private/internal IP range.
     * Defense-in-depth measure against SSRF; does NOT block (URLs are user-configured).
     */
    private warnIfPrivateUrl(url: string, serverName: string): void {
        try {
            const parsed = new URL(url);
            const hostname = parsed.hostname;
            const isPrivate =
                hostname === 'localhost' ||
                hostname === '127.0.0.1' ||
                hostname === '::1' ||
                hostname === '0.0.0.0' ||
                hostname.startsWith('10.') ||
                hostname.startsWith('192.168.') ||
                /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
                hostname.endsWith('.local') ||
                hostname.endsWith('.internal');
            if (isPrivate) {
                console.warn(
                    `[McpClient] Server "${serverName}" uses private/internal URL: ${hostname}. ` +
                    `Ensure this is intentional.`
                );
            }
        } catch {
            // URL parsing already validated upstream
        }
    }
```

### Step 3.1b — Call `warnIfPrivateUrl` before SSE transport creation

```
FIND:
            } else if (config.type === 'sse') {
                if (!config.url) throw new Error(`SSE server "${name}" has no URL configured`);
                const sseOptions: Record<string, unknown> = {};

REPLACE WITH:
            } else if (config.type === 'sse') {
                if (!config.url) throw new Error(`SSE server "${name}" has no URL configured`);
                this.warnIfPrivateUrl(config.url, name);
                const sseOptions: Record<string, unknown> = {};
```

### Step 3.1c — Call `warnIfPrivateUrl` before streamable-http transport creation

```
FIND:
            } else {
                if (!config.url) throw new Error(`streamable-http server "${name}" has no URL configured`);
                const httpOptions: Record<string, unknown> = {};

REPLACE WITH:
            } else {
                if (!config.url) throw new Error(`streamable-http server "${name}" has no URL configured`);
                this.warnIfPrivateUrl(config.url, name);
                const httpOptions: Record<string, unknown> = {};
```

### Verification

After applying, confirm:
1. `warnIfPrivateUrl` method exists
2. It is called for both `sse` and `streamable-http` transport types
3. `npm run build` succeeds

---

## Fix 4 — IgnoreService `?` Glob Wildcard (P3 Medium)

**Problem:** The `matchPattern()` method converts `*` and `**` globs to regex but does not handle `?` (match single non-slash character). Users who write `.obsidian-agentignore` patterns with `?` will get incorrect behavior.

**File:** `src/core/governance/IgnoreService.ts`

### Step 4.1 — Add `?` conversion in glob-to-regex (in `matchPattern()`, after the `*` conversions)

```
FIND:
        // Convert glob to regex
        const regexStr = p
            .replace(/\./g, '\\.') // escape dots
            .replace(/\*\*/g, '§DOUBLESTAR§')
            .replace(/\*/g, '[^/]*')
            .replace(/§DOUBLESTAR§/g, '.*');

REPLACE WITH:
        // Convert glob to regex
        const regexStr = p
            .replace(/\./g, '\\.') // escape dots
            .replace(/\*\*/g, '§DOUBLESTAR§')
            .replace(/\*/g, '[^/]*')
            .replace(/§DOUBLESTAR§/g, '.*')
            .replace(/\?/g, '[^/]');  // ? matches single non-slash char
```

### Verification

After applying, confirm:
1. The `.replace(/\?/g, '[^/]')` line is present in `matchPattern()`
2. `npm run build` succeeds

---

## Fix 5 — EditFileTool Fuzzy Match (P3 Medium)

**Problem:** `tryNormalizedMatch()` normalizes the ENTIRE file content (collapses all whitespace), then does a replace on the normalized version, and returns the fully collapsed content. This destroys all indentation and formatting in the entire file, not just the edited region.

**File:** `src/core/tools/vault/EditFileTool.ts`

### Step 5.1 — Rewrite `tryNormalizedMatch()` to preserve surrounding content

```
FIND:
    /**
     * Fallback: try matching after normalizing whitespace differences
     * Returns the modified content if match found, null otherwise.
     */
    private tryNormalizedMatch(content: string, oldStr: string, newStr: string): string | null {
        // Normalize: collapse multiple spaces/tabs to single space, trim line endings
        const normalize = (s: string) => s.replace(/[ \t]+/g, ' ').replace(/\r\n/g, '\n').trim();
        const normContent = normalize(content);
        const normOld = normalize(oldStr);

        if (normContent.includes(normOld)) {
            // Find approximate position in original content
            // Simple approach: rebuild using the normalized replacement
            const normNew = normalize(newStr);
            const replaced = normContent.replace(normOld, normNew);
            // Use the normalized replacement — whitespace is collapsed but the edit succeeds
            return replaced;
        }
        return null;
    }

REPLACE WITH:
    /**
     * Fallback: try matching after normalizing whitespace differences.
     * Uses normalization to LOCATE the match, then replaces the corresponding
     * region in the ORIGINAL content to preserve all surrounding formatting.
     */
    private tryNormalizedMatch(content: string, oldStr: string, newStr: string): string | null {
        const normalize = (s: string) => s.replace(/[ \t]+/g, ' ').replace(/\r\n/g, '\n').trim();
        const normOld = normalize(oldStr);
        if (!normOld) return null;

        // Build a mapping from normalized-string index to original-string index
        // by walking both strings in parallel.
        const normChars: number[] = []; // normChars[i] = index in original content for normalized char i
        let ni = 0;
        const normContent = normalize(content);

        // Walk original content to find the character-level mapping
        // Simpler approach: scan original lines to find the matching region
        const lines = content.split('\n');
        const normOldLines = normOld.split('\n').map((l: string) => l.replace(/[ \t]+/g, ' ').trim());

        // Try to find a contiguous range of original lines whose normalized form matches normOld
        for (let startLine = 0; startLine <= lines.length - normOldLines.length; startLine++) {
            let match = true;
            for (let j = 0; j < normOldLines.length; j++) {
                const normOrigLine = lines[startLine + j].replace(/[ \t]+/g, ' ').trim();
                if (normOrigLine !== normOldLines[j]) {
                    match = false;
                    break;
                }
            }
            if (match) {
                // Found the matching region — replace those lines with newStr
                const before = lines.slice(0, startLine).join('\n');
                const after = lines.slice(startLine + normOldLines.length).join('\n');
                const prefix = before ? before + '\n' : '';
                const suffix = after ? '\n' + after : '';
                return prefix + newStr + suffix;
            }
        }

        // Single-line fallback: if normOld has no newlines, search line by line
        if (!normOld.includes('\n')) {
            for (let i = 0; i < lines.length; i++) {
                const normLine = lines[i].replace(/[ \t]+/g, ' ').trim();
                if (normLine.includes(normOld)) {
                    // Replace within original line preserving its leading whitespace
                    const leading = lines[i].match(/^([ \t]*)/)?.[1] ?? '';
                    const newLines = [...lines];
                    newLines[i] = leading + newStr;
                    return newLines.join('\n');
                }
            }
        }

        return null;
    }
```

### Verification

After applying, confirm:
1. `tryNormalizedMatch()` no longer calls `normalize()` on the full content for the return value
2. The method returns original content with only the matched region replaced
3. `npm run build` succeeds
4. Manual test: edit a Python or YAML file where indentation matters — the rest of the file should be unchanged

---

## Post-Fix Checklist

After all fixes are applied:

1. **Build:** `npm run build` must succeed with zero errors
2. **Lint:** `npx eslint src/` should show no new warnings
3. **Smoke test:** Load plugin in Obsidian, run a simple agent task (e.g., "list my notes")
4. **Security test Fix 1:** Ask the agent to call `update_settings` — it MUST prompt for approval
5. **Security test Fix 2:** Ask the agent to write to `.obsidian/plugins/test/main.js` — it MUST be denied
6. **Regression test Fix 5:** Use `edit_file` on a file with significant indentation (Python/YAML) — surrounding content must be preserved

---

## Dropped Findings (no action needed)

| # | Original Finding | Reason |
|---|-----------------|--------|
| 3 (was P2) | GlobalFileService path traversal | `src/core/storage/` directory no longer exists — code was removed |
| 5 (was P2) | WebFetchTool DNS rebinding SSRF | Accepted residual risk — runtime DNS resolution cannot be pre-checked without breaking UX |
| 8 (Info) | `dangerouslyAllowBrowser: true` | Acceptable in Electron/Obsidian runtime |
| 9 (Info) | Provider warm-up HEAD reveals provider | Low risk, acceptable |
