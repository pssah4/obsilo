# Reviewer notes

This document describes what Vault Operator does on your machine, the trust
boundaries that govern its behaviour, and the mitigations in place for each
capability the Obsidian community plugin scanner flags. It is written for two
audiences: the community plugin reviewer who has to decide whether the plugin
behaves as advertised, and the security-aware user who wants to verify before
installing.

Vulnerability reporting contact and SLA: see [SECURITY.md](SECURITY.md).

The reviewer-oriented short version: there is no path from chat output (LLM
text) to `fs.*`, and no path by which the LLM can spawn a *new* process or
choose *what* is spawned. One narrow, deliberately human-gated exception exists
since FEAT-04-13: the LLM can ask to reconnect an MCP server the user has
already added and trusted; for a local (stdio) server this refuses (the agent
cannot reconnect/test stdio servers, only the user manages them in Settings),
so the LLM cannot re-spawn even a trusted local process. Every stdio spawn
requires a per-device human "Trust and run" confirmation before its first launch,
and the command is restricted to `node`/`npx` as a bare name (no path, no shell
metacharacters). Filesystem access goes through
[src/core/security/safeFs.ts](src/core/security/safeFs.ts) with a hard
root-directory allowlist; process spawning goes through
[src/core/security/spawnAllowlist.ts](src/core/security/spawnAllowlist.ts)
with a hard binary allowlist (six logical binaries plus their platform
variants). Dynamic code execution lives only inside a Chromium iframe
sandbox (`sandbox="allow-scripts"`, CSP `default-src 'none'`) on every
platform, with a supplementary regex deny-list as a pre-compile filter.
(The earlier Node `vm.runInNewContext` worker was removed at audit finding
SBX-1; there is no `vm`-based execution path anymore.) Internal audit
history is summarised in the "Audit history" section below; the audit
reports themselves live in a private development tree and can be shared
with the community plugin maintainer on request.

## Threat model

### Actors and trust assumptions

| Actor | Trust level | Why |
|------|-------------|-----|
| The user | Trusted | Configures providers, approves writes, installs the plugin |
| The Obsidian host | Trusted | Plugin runs in the same renderer process |
| The LLM provider (Anthropic, OpenAI, etc.) | Untrusted output | LLM responses are treated as adversarial input |
| Third-party MCP servers | Untrusted | The user can configure remote MCP servers (HTTP / SSE) and, since FEAT-04-13, local stdio servers (Desktop-only, device-local config, per-device human trust -- see "Shell execution"); their responses are treated as adversarial |
| npm packages loaded from `esm.sh` / `cdn.jsdelivr.net` / `unpkg.com` / `registry.npmjs.org` | Untrusted | User-initiated; mitigated by sandbox + SHA-256 integrity pinning (TOFU + build-time) |
| The public skill registry (`raw.githubusercontent.com/pssah4/vault-operator-skill-registry`, EPIC-31) | Untrusted | User-initiated (never fetched on boot); each package is size-capped and SHA-256-pinned against the catalogue before any file is written, then installs as the `registry` MANAGED tier, which runs through the same approval chain as a user-authored skill and grants no elevated trust (see [SkillProvenanceStore](src/core/skills/SkillProvenanceStore.ts)) |
| Local files outside the vault and outside the plugin data dir | Out of scope | The plugin must never read or write them |

### Primary trust boundaries

1. **Plugin <-> LLM provider.** Every byte of LLM output is treated as
   untrusted. Tool arguments parsed from LLM output are checked against each
   tool's declared `input_schema` before execution (required fields, declared
   types, enum constraints) via a lightweight in-tree validator
   ([src/core/tool-execution/inputSchemaValidator.ts](src/core/tool-execution/inputSchemaValidator.ts),
   no `ajv`/`zod` dependency; defense-in-depth only, not a full JSON Schema
   validator -- no nested-object / `pattern` / `oneOf` / `min`/`max` checks).
   Path-traversal and write-target governance are enforced separately
   (see "Direct filesystem access" and "Vault enumeration" below). The
   vault tool API only accepts vault-relative paths.
2. **Plugin <-> vault.** Vault reads and writes go through the Obsidian
   `vault.*` API. The community plugin scanner correctly marks Vault Read
   and Vault Write as Pass.
3. **Plugin <-> sandbox.** Code executed via `evaluate_expression`,
   `run_skill_script`, or a dynamic `custom_*` skill tool runs in a Chromium
   iframe sandbox (browser sandbox, no Node, no `require`, no `process`, no
   filesystem unless explicitly bridged). Vault access via the bridge is
   governed exactly like the tools: IgnoreService, a checkpoint before each
   write, and a deny-zone over the agent's own config folder (FIX-44-04).
4. **Plugin <-> system.** Everything outside the vault, including the system
   temp directory, the user-home Claude/Codex desktop config directories,
   and the plugin data directory, is gated by `safeFs` and `spawnAllowlist`.

## Capability disclosure

The Obsidian community plugin scanner reports five behaviour findings on the
v2.11.x release. Each is necessary for a specific plugin feature; each is
gated by a specific mitigation.

### Direct filesystem access (`fs`)

**Why we use it.** The plugin maintains a local knowledge database, a
semantic search index, a shadow-git checkpoint store, an office document
pipeline (PPTX, DOCX, XLSX, PDF), a persistence layer with atomic writes and
daily snapshots, and a token store for OAuth and MCP credentials. None of
these can be implemented through the Obsidian vault API alone (sql.js needs
deterministic file handles for WAL-style writes; office tools need temp
files for binary pipelines; checkpoints need a git binary which itself needs
a real filesystem).

**Mitigation.** Every `fs` operation in the plugin goes through
[src/core/security/safeFs.ts](src/core/security/safeFs.ts). At plugin
startup, `safeFs.initialize(allowlist)` is called with the following root
directories:

```
1. <vault>                                      -- the Obsidian vault root
2. <vault>/.obsidian/plugins/vault-operator/    -- plugin data dir
3. <vault>/.obsilo-vault/                       -- agent config dir
                                                   (default, user-configurable)
4. <os.tmpdir()>                                -- system temp dir
5. Desktop config dirs (MCP / OAuth):
   ~/.config/Claude/, ~/Library/Application Support/Claude/,
   %APPDATA%\Claude\, ~/.obsidian-agent/
6. <vault-parent>/obsilo-shared/                -- cross-vault shared dir
                                                   (optional, only when enabled)
```

Every read and write goes through `assertAllowed(path)`, which uses
`path.resolve(path)` (lexical, no symlink resolution) and `path.relative(root,
path)` to verify the path falls under at least one of the roots. Paths
that escape via `..` or absolute paths outside the allowlist throw
`SafeFsViolation` and the operation is rejected.

**Why this is enough.** The LLM cannot construct an `fs` call directly. Tools
that take vault paths (`read_file`, `write_file`, `edit_file`, etc.) use the
Obsidian `vault.*` API, not `fs`. The only paths that ever reach `fs` are
hard-coded by the plugin author at compile time (database filenames, index
filenames, checkpoint subfolder, etc.) or constructed from the vault path
plus a fixed suffix.

**What would break this.** A new feature that takes a user-controlled path
and passes it to `safeFs` without confining it to a fixed subdirectory, or
a new `import 'fs'` outside the wrapper. The test suite includes
path-traversal cases against `assertAllowed` (see
[src/core/security/__tests__/safeFs.test.ts](src/core/security/__tests__/safeFs.test.ts));
the "one file owns the wrapper" rule is enforced by code-review discipline
plus the file-header comment in `safeFs.ts`, not by an automated CI grep.

### Shell execution (`child_process`)

**Why we use it.** `evaluate_expression` no longer spawns a child process --
it runs in the Chromium iframe sandbox on every platform (the Node worker was
removed at SBX-1). Vault checkpoints spawn nothing either: they run on
isomorphic-git, a pure-JS implementation, so no `git` binary is involved. The
remaining spawns are: the remote-MCP-server feature spawns a Cloudflare Tunnel
(`cloudflared`) for inbound HTTPS exposure. The office pipeline spawns
LibreOffice (`soffice`) for headless conversion. The optional
document-conversion recipes spawn `pandoc`. Binary discovery uses
`which`/`where`, and the MCP settings tab asks a candidate `node` for its
version when it looks for a Node runtime.

**Mitigation.** Every spawn goes through
[src/core/security/spawnAllowlist.ts](src/core/security/spawnAllowlist.ts).
The allowlist is hard-coded; below are the six logical binaries and their
platform variants:

```
node, node.exe                                   -- node runtime version probe (FEAT-04-13)
npx, npx.cmd                                     -- stdio MCP servers, launched by the MCP SDK, never through this wrapper
which, where, where.exe                          -- binary discovery
soffice, soffice.exe, soffice.bin,
libreoffice, libreoffice.exe                     -- LibreOffice headless conversion
cloudflared, cloudflared.exe                     -- remote MCP server tunnel
pandoc, pandoc.exe                               -- ExecuteRecipeTool document conversion
```

`spawnAllowed(command, args, options)` rejects:

- A `command` whose `path.basename` is not an own entry of the allowlist
  (own properties only, so inherited names like `constructor` are not entries)
- A `command` containing shell metacharacters (regex
  `/[;&|`$<>(){}\\\n\r]/` -- covers `;`, `&`, `|`, backtick, `$`, `<`, `>`,
  `(`, `)`, `{`, `}`, `\`, CR, LF)
- A `command` given as a relative path (`./node`, `bin/pandoc`), for every
  entry. A binary is named either bare, resolved via `PATH`, or by absolute
  path. Recipes run with `cwd` = vault root, so a relative command would
  resolve inside the directory the agent can write to
- A `command` given as any path when the entry is launched by name only
  (`cloudflared`, `npx`) -- the rule `assertStdioCommandAllowed` applies to
  stdio commands, now applied by the wrapper as well
- Arguments the binary may not carry. Each entry declares an argv predicate,
  written from the call sites that exist: `node` may only run a version probe;
  `which`/`where` take exactly one bare program name; LibreOffice takes
  `--version` or a `--headless` conversion and no URI argument, so
  `macro:///Standard.Module.Main` cannot reach it; `cloudflared` takes
  `tunnel --url` with a loopback port; `pandoc` may not carry the options that
  make it run code (`--lua-filter`, `--filter`, `-F`, `--custom-writer`,
  `--defaults`, a `.lua` argument) and its `--pdf-engine` must name a known
  engine; `npx` is never spawned through the wrapper at all
- An `options.shell` set to `true` or any truthy value; `options.shell` is
  unconditionally overwritten to `false` for both `spawn` and `spawnSync`

`cp.exec` and `cp.execSync` are not re-exported. Shell-string interfaces
have no place in this codebase.

**Why this is enough.** The LLM cannot construct a spawn directly.
`ExecuteRecipeTool` only resolves recipes from a fixed in-bundle
`BUILT_IN_RECIPES` list plus a user-editable `customRecipes` list
([Settings > Advanced > Shell](src/ui/settings/ShellTab.ts)); both kinds run
through the same parameter validator (`validateRecipeParams` against the
recipe's typed `parameters` schema -- types include `vault-file`,
`vault-output`, `enum`, `safe-string` with regex `pattern`, `number` with
`min`/`max`) before substitution. The recipe binary is always resolved via
the spawn allowlist, so a custom recipe with a non-allowlisted binary
(e.g. `rm`) cannot spawn, and the composed argv still has to satisfy that
binary's predicate. Recipe execution has a master toggle plus a per-recipe
toggle in settings (default: disabled).

The MCP **client** (`McpClient`) connects via Streamable-HTTP, SSE, and --
since FEAT-04-13 / ADR-168 -- local stdio servers. The stdio path is
deliberately narrow and defense-layered: it is Desktop-only (no Node on
mobile); the config lives in a device-local store outside the vault
(`~/.obsidian-agent/devices/<id>/`) so a sync-injected config never reaches
another device; a spawn requires an explicit per-device human "Trust and run"
confirmation before its first launch (fail-closed: untrusted = no spawn); and
the command is gated by `assertStdioCommandAllowed` (bare `node`/`npx` only, no
path separator so a `/tmp/evil/node` basename spoof is rejected, no shell
metacharacters). The actual process launch is the MCP SDK's
`StdioClientTransport` (cross-spawn with `shell:false`), so args are never
shell-interpreted. The agent (LLM) cannot add, modify, or trust a stdio server
and cannot reconnect/test one (`manage_mcp_server` refuses stdio for those
actions); only the user configures stdio servers in Settings. Users who want OS
isolation can still run stdio servers externally and connect via an HTTP
gateway. The child env is the VO allowlist (paths/locale/CLI-config locations,
no credentials) plus the SDK's own default env; secret-named `config.env` values
are encrypted at rest via the OS keychain and decrypted only at spawn.

**What would break this.** A new feature that takes a user-controlled binary
name and passes it to `spawnAllowed`, a new entry in `ALLOWED_BINARIES` that
is not strictly necessary, or an existing entry widened to `form: absolute` or
to a predicate that accepts more argv than its call sites need. The allowlist
is small enough that every such change is a deliberate diff and visible in
code review, and the tests in
[src/core/security/__tests__/spawnAllowlist.test.ts](src/core/security/__tests__/spawnAllowlist.test.ts)
compare this section against the module, so the prose cannot drift away from
the code unnoticed.

### Vault enumeration

**Why we use it.** Semantic search builds an index over every markdown file
in the vault. `list_files` lets the user inspect vault structure. Map-of-
Content (MOC) generation and ingest-workflow tools iterate vault contents.

**Mitigation.** All vault enumeration goes through Obsidian's `vault.*` API.
The plugin only sees file paths and their contents on demand; it does not
upload the vault. Network usage is documented separately in the README.

### Clipboard access

**Why we use it.** Several "Copy" buttons across the UI (chat reply,
system-prompt preview, history-panel markdown link, MCP token, plugin path,
soak-report JSON) write generated text to the clipboard via
`navigator.clipboard.writeText`. The chat textarea also has a standard
browser `paste` event listener that captures images pasted from the
clipboard (e.g. screenshots) and attaches them to the next message.

**Mitigation.** Clipboard access is only triggered from user UI actions
(button clicks for writes; the `paste` listener only fires when the user
explicitly pastes into the chat textarea). `navigator.clipboard.readText()`
is **never** called -- the plugin does not poll or background-read the
clipboard.

### Dynamic code execution

**Why we use it.** The `evaluate_expression` tool runs LLM-generated
JavaScript inside a sandboxed runtime. This is a deliberate feature: it
lets the agent perform bulk transformations, generate office documents,
and call utility code -- optionally pulling npm packages from the
documented CDN allowlist (`esm.sh`, `cdn.jsdelivr.net`, `unpkg.com`,
`registry.npmjs.org`).

**Mitigation.** Generated code never executes directly in the plugin
context. Multiple layers stand between LLM output and code execution:

```
LLM output (untrusted)
  -> Tool input_schema check (inputSchemaValidator.ts -- required/type/enum;
                              defense-in-depth, see Threat-model boundary 1)
  -> AstValidator.ts -- supplementary regex deny-list applied to the source
                        BEFORE compilation. Patterns: eval (literal,
                        indirect (0,eval), computed ["eval"]),
                        new Function, require(), dynamic import(),
                        process, __proto__, .constructor.constructor,
                        arguments.callee, globalThis, child_process,
                        execSync, spawnSync, setTimeout/setInterval with
                        string argument, .prototype.constructor,
                        [].constructor, WebAssembly. Comments are stripped
                        first. Self-characterised as "supplementary, NOT
                        the primary security boundary" -- the boundary is
                        the sandbox itself.
  -> esbuild transform (TypeScript -> ES2022 IIFE) or esbuild bundle for
     npm imports
  -> IframeSandboxExecutor (all platforms, since SBX-1)
       -> sandboxed iframe in the renderer (`sandbox="allow-scripts"`,
          CSP `default-src 'none'`); the bridge protocol runs via
          `postMessage`, validated by an `event.source` identity check;
          the parent-side SandboxBridge performs all security checks.
          (The desktop `ProcessSandboxExecutor` / Node `vm.runInNewContext`
          path was removed at SBX-1; there is no `vm`-based path anymore.)
       -> realm exposes only language primitives plus the frozen bridge
          proxies `vault` and `requestUrl`; user code's `.execute(input, ctx)`
          is called with `ctx = { vault, requestUrl }`.
       -> 30 s execution timeout; heap sampled and torn down over a limit.

  The parent-side SandboxBridge governs every bridge call:
   -> URL allowlist (`unpkg.com`, `cdn.jsdelivr.net`, `registry.npmjs.org`,
      `esm.sh`); HTTPS-only; no IP literals / `localhost`; no non-443 ports
   -> Vault path validation (rejects `..`, leading `/`, leading `\`,
      drive-letter and UNC prefixes, and any path under `vault.configDir/`)
   -> FIX-44-04: reads/writes obey the IgnoreService (ignored = no access,
      protected = read-only), exactly like the vault tools
   -> FIX-44-22: the agent config folder (`.vault-operator/`, except the
      skill workspace `skills/` and `skill-data/`) is a deny-zone, so a
      script cannot write `settings.json` and grant itself permissions
   -> FIX-44-04: a checkpoint is taken before each sandbox vault write, so
      an unwanted write is recoverable via restore_checkpoint
   -> Prototype-pollution check on request payloads (rejects keys
      `__proto__`, `constructor`, `prototype`)
   -> Per-write size limit: 10 MB
   -> Per-minute rate limits: 10 writes/min, 5 outbound HTTP requests/min
   -> Circuit breaker: 20 consecutive errors trips the bridge for 30 s
```

npm packages used inside the sandbox are resolved by
`EsbuildWasmManager.ts`. Versions come from `https://registry.npmjs.org/`,
content is fetched from `esm.sh` or `cdn.jsdelivr.net`, and every fetched
artifact is SHA-256-hashed: the hash of an esbuild-wasm asset is matched
against a build-time pinned constant
(`INTEGRITY_HASHES` in `EsbuildWasmManager.ts`); the hashes of npm packages
are persisted on first download (TOFU) in `dev-env/package-hashes.json`
and re-checked on every subsequent load.

`new Function(...)` appears in plugin source in three well-scoped places
(the former fourth site, the `vm.runInNewContext` Node worker, was removed
at SBX-1 and no longer exists in the source or the shipped bundle):

1. [src/core/sandbox/sandboxHtml.ts](src/core/sandbox/sandboxHtml.ts)
   -- inside the iframe runtime, executing the LLM-supplied code after
   the regex deny-list and esbuild transform have run.
2. [src/core/sandbox/EsbuildWasmManager.ts](src/core/sandbox/EsbuildWasmManager.ts)
   -- loads the SHA-256-verified esbuild-wasm CommonJS bundle, via the
   indirect form `Object.getPrototypeOf(function(){}).constructor` so the
   literal does not appear in the file.
3. [src/core/assets/BundleLoader.ts](src/core/assets/BundleLoader.ts)
   -- loads SHA-256-verified optional asset bundles (e.g. office, pdfjs),
   same indirect form, same trust argument (hash-verified before
   loading).

## Sandbox architecture

```
                        +-----------------------------+
                        |  Obsidian renderer process  |
                        |                             |
   chat input  -------->|  AgentTask + tool registry  |
                        |                             |
                        +--------------+--------------+
                                       |
                                       v
                        +-----------------------------+
                        |       iframe sandbox        |
                        |  (Chromium SOP, in-process, |
                        |   sandbox="allow-scripts",  |
                        |   CSP default-src 'none')   |
                        |                             |
                        |  vault + http via postMessage|
                        +--------------+--------------+
                                       |
                                       v
                                 Chromium SOP
```

Since SBX-1 there is exactly ONE sandbox: the Chromium iframe. The former
desktop `ProcessSandboxExecutor` (a Node child process running
`vm.runInNewContext`) was removed after a confirmed vm escape and is absent
from the source and the shipped bundle. The parent-side `SandboxBridge`
governs the single sandbox and exposes two bridge proxies to user code:
`ctx.vault` and `ctx.requestUrl` (both `Object.freeze()`-d). The pre-compile
regex deny-list (`AstValidator`, patterns listed under "Dynamic code
execution" above) is applied to the user source before dispatch. Per-write
size limits, per-minute rate limits, and the circuit breaker live in
`SandboxBridge`.

## Audit history

| Audit | Date | Scope | Verdict |
|-------|------|-------|---------|
| AUDIT-001 | 2026-03-01 | Initial baseline | Green |
| AUDIT-002 | 2026-03-04 | Pre-release sanity | Green |
| AUDIT-003 | 2026-03-06 | First public-release audit (full SAST + OWASP Top 10 + OWASP LLM Top 10) | Green |
| AUDIT-004 | 2026-03-23 | Office pipeline addition | Green |
| AUDIT-005 | 2026-04-01 | Remote MCP transport | Green |
| AUDIT-006 | 2026-04-02 | MCP token encryption hardening | Green |
| AUDIT-007 | 2026-04-09 | Knowledge maintenance epic delta | Green |
| AUDIT-008 | 2026-04-11 | Ingest workflow delta | Green |
| AUDIT-2026-07-23 | 2026-07-23 | stdio MCP client (FEAT-04-13 / ADR-168) delta | Green (Low) |
| AUDIT-2026-07-26 | 2026-07-26 | Full-codebase (guards: skillScriptGuard, denyZoneFilter, commandAllowlist) | Green (High resolved to Low) |
| AUDIT-2026-07-27 | 2026-07-27 | Full-codebase | Green (Low) |
| AUDIT-2026-07-29 | 2026-07-29 | Full-codebase (this audit; M-1 openExternal scheme fixed) | Green (Low) |
| AUDIT-009 | 2026-04-12 | Plugin-source self-development | Green |
| AUDIT-027 | 2026-05-16 | EPIC-26 advisor-pattern + provider-only setup | Green (after H-1 plaintext credential fix) |
| AUDIT-028 | 2026-05-16 | v2.11.2 delta (FIX-28 safeFs hang) | Green |
| AUDIT-029 | 2026-05-16 | v2.11.3 delta (provider polish + GPT-5 reasoning + security tightening) | Green |
| AUDIT-030 | 2026-05-19 | v2.11.5 full re-audit baseline | Green |
| AUDIT-031 | 2026-05-24 | v2.12.3 targeted (qs DoS override + FIX-01-07-03 editor-refresh surface) | Green |
| AUDIT-032 | 2026-05-29 | v2.12.5 targeted (tmp symlink CVE override + FIX-04-03-07 reasoning passback) | Green |
| AUDIT-033 | 2026-05-30 | v2.12.6 / v2.12.7 delta (Review-bot ESLint cleanup pass + i18n hint update) | Green |

Audit reports live in a private development tree and are not part of the
public release output by design (they reference internal incidents and
mitigations not yet shipped). Summaries can be requested by the community
plugin maintainer. The full archive is markdown only and contains no
binaries.

Dependency audit: `npm audit --omit=dev` reports zero across the production
dependency tree. That number is narrower than it reads, so it comes with the
full-tree number next to it. `npm audit --json` over the whole tree reports two
high advisories as of 2026-08-28, both CWE-835 infinite loops in `image-size`,
which enters the tree only through `pptxgenjs`. The lockfile marks that path
`dev:true`, which is the only reason the production audit does not see it, and
`pptxgenjs` code does ship, inside the optional `office-bundle.js` asset. The
`dev` label is therefore not the argument. The argument is that the vulnerable
parser is in no import graph we build, which the `image-size` row below states
in full and `src/core/assets/__tests__/pptxgenjsImageSizeUnreachable.test.ts`
enforces on every test run. Both advisories are accepted per advisory id, each
with the reason and the enforcing test recorded next to the id, and the
development repo's audit workflow fails on any high or critical advisory id that
has no such record.

Vulnerability reporting contact and SLA: see [SECURITY.md](SECURITY.md).

## Compliance notes

Mapping of community plugin scanner findings (Obsidian Releases v2.11.x and
v2.12.x) to the mitigations in this document:

| Scanner finding | Severity | Mitigation in this document |
|-----------------|----------|----------------------------|
| Direct filesystem access (`fs`) | Warning | "Direct filesystem access (`fs`)" section above, `safeFs` wrapper |
| Shell execution (`child_process`) | Warning | "Shell execution (`child_process`)" section above, `spawnAllowlist` |
| Vault enumeration | Recommendation | "Vault enumeration" section, Obsidian `vault.*` API only |
| Clipboard access | Recommendation | "Clipboard access" section, user-trigger only |
| Dynamic code execution | Recommendation | "Dynamic code execution" section, two-layer sandbox + AST allowlist |
| Plugin assembles domain names at runtime (split/join) | Warning | Three sites, none of which constructs a network endpoint. (1) [registryDiscovery.ts](src/core/mcp/registryDiscovery.ts) reverses the MCP registry's reverse-DNS namespace (`com.notion` -> `notion.com`) for the publisher badge and for an anti-spoofing comparison against the server URL's actual hostname; the only URL requested is the literal `remote.url` from the registry response, validated by `validateProviderUrl`. (2) [Stufe3Hooks.ts](src/core/health/Stufe3Hooks.ts) joins an eTLD+1 counting key for the update heuristic (added to a local Set, never fetched). (3) [providerUrlGuard.ts](src/api/providers/providerUrlGuard.ts) rebuilds a caller-supplied IP into canonical dotted-quad so the private-IP deny-check catches octal/hex obfuscation. Every fetched URL in the plugin is a literal, a validated user setting, or a validated registry entry; each site carries an inline scanner note. |
| Vault read / vault write | Pass | Standard `vault.read` / `vault.modify` API |
| `uuid` reachable through `exceljs` (GHSA-w5hq-g745-h8pq) | Warning | False positive. Installed `uuid@14.0.0` is past the advisory's vulnerable ranges (`< 11.1.1`, `>= 12.0.0 < 12.0.1`, `>= 13.0.0 < 13.0.1`), pinned via `"uuid": ">= 11.1.1"` in `package.json#overrides`. The advisory affects `v3()`/`v5()`/`v6()` with a caller-provided `buf`; `exceljs` only calls `v4()`, which the advisory explicitly excludes. `npm audit` confirms zero. |
| `tmp` reachable through `exceljs` (GHSA-ph9p-34f9-6g65) | Warning | Resolved. `"tmp": ">= 0.2.6"` override in place, resolves to `tmp@0.2.7`. The vulnerable code path is the streaming `WorkbookReader` (with caller-controlled `prefix`/`postfix`/`dir`); the plugin only uses the writer side of `exceljs` (`create_xlsx`). See AUDIT-032. |
| `authorUrl` not reachable | Warning | Transient. `https://github.com/pssah4` returns HTTP 200 in live checks; the bot occasionally hits a GitHub Pages or CDN 5xx during its scan. No code change resolves a transient probe; the warning is expected to disappear on the next scan. |
| `display()` is deprecated / `getSettingDefinitions()` not implemented (`src/ui/AgentSettingsTab.ts`) | Warning | Deferred, with a dated trigger. Adopting the declarative API is all-or-nothing: `obsidian.d.ts` documents on `display()` that it is "Not called when getSettingDefinitions returns a non-empty array; the tab is rendered declaratively from those definitions instead." A minimal stub that only feeds the settings search is therefore not possible, since any non-empty return replaces the whole tab UI on 1.13+. Hiding such a stub is no way around it either: `SettingDefinitionBase.visible` excludes a hidden item from search as well. Meanwhile `manifest.minAppVersion` is 1.8.7, so a non-empty return means carrying two settings surfaces side by side for as long as pre-1.13 installs are supported. The migration itself is manual work: 186 `new Setting(...)` rows in `src/`, 166 of them spread over 16 modules in `src/ui/settings/` (VaultTab 48, EmbeddingsTab 27, PermissionsTab 19, McpTab 17, MemoryTab 15), of which 55 are button rows that the `SettingControl` union has no member for (only `SettingDefinitionAction` / `SettingDefinitionRender` come close). Nothing can generate them: `src/types/settings.ts` holds types and defaults, while labels and help texts live as TSDoc prose and as i18n dot keys with no mapping between the two. Re-evaluation trigger: when `minAppVersion` is raised to 1.13 or later. At that point the imperative fallback can be dropped and the port is a single move instead of a permanent double surface. Until then `display()` stays supported and the deprecation tag is informational. |
| `image-size` pulled in by `pptxgenjs` (GHSA-w3rx-r6r6-pgpr, GHSA-5p2g-fcmc-qvqq) | Warning | Accepted on unreachability, not on a dependency label. Both advisories are CWE-835 infinite loops in the ICNS, JXL and HEIF parsers of `image-size` at range `<= 2.0.2`. 2.0.2 is the newest published version (`npm view image-size dist-tags` returns `latest: 2.0.2`, `legacy: 1.2.1`), so there is nothing to upgrade to, and npm's only proposed remediation is a major downgrade to `pptxgenjs@1.1.5`. The `"image-size": "2.0.2"` entry in `package.json#overrides` is an exact pin on that newest version and is not a fix. It is deliberately spelled as a pin rather than as the `>=` range the `uuid` and `tmp` rows above use, because those two really do resolve past their advisory and this one cannot. What carries the acceptance is the import graph. `pptxgenjs` is bundled into `office-bundle.js`, an optional asset published on a separate release tag and downloaded on demand, and building that entry (`src/core/assets/bundle-entries/office-entry.ts`) with the flags the real build uses resolves five input modules: `exceljs`, `docx`, `jszip`, `pptxgenjs` and the entry itself. `image-size` is not among them, because `pptxgen.es.js` imports `jszip` and nothing else. Three further checks anyone can repeat: (1) none of the four dist files that `pptxgenjs@4.0.1` ships contains the string `image-size`; (2) the library's only dimension helper, `getSizeFromImage`, sits inside a block comment marked "FIXME: TODO: currently unused", its single call site is commented out as well, and the commented body calls `require('sizeof')`, a package that is not in the tree at all; (3) `pptxgenjs/package.json` maps `"image-size": false` in its `browser` field and `office-bundle.js` is built with esbuild `platform: "browser"`, so even a restored import would resolve to an empty stub. What is deliberately not part of the argument: `npm audit --omit=dev` returns zero here, but only because the lockfile marks the `pptxgenjs` path `dev:true`, while `pptxgenjs` code does ship, so that zero says nothing about reachability. The import graph, checks (1) to (3) and the exact pin are all pinned by `src/core/assets/__tests__/pptxgenjsImageSizeUnreachable.test.ts`, and the graph assertion was verified by mutation: adding an `image-size` import back into the installed `pptxgen.es.js` turns it red even while the browser stub still holds, because a stubbed edge is still an edge. If that test goes red, the answer is a magic-byte prefilter at the single point where image bytes reach `pptxgenjs` (`CreatePptxTool.addImage`), not a downgrade. The input class is filtered twice in front of the parser anyway: `CreatePptxTool` maps only png, jpg, jpeg, gif, svg, webp and avif to a MIME type and returns early when the extension is not one of them, and `imageClipper` sniffs magic bytes instead of trusting the remote `Content-Type`, so ICNS and HEIF bytes cannot arrive under a permitted extension. |
