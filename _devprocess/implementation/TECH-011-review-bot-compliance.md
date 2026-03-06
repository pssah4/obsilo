# Obsidian Community Plugin Review-Bot Compliance

Dokumentation aller Aenderungen, die aufgrund des automatisierten Review-Bot-Scans
bei PR #10565 (obsidianmd/obsidian-releases) durchgefuehrt wurden.

**Datum:** 2026-02-28
**Scan-Basis:** Commit `1dad449` auf `pssah4/obsilo` main
**Fix-Commit:** `f43c9bd` (+ configDir-Nachfixes)
**Betroffene Dateien:** ~90 Source-Dateien

---

## Regeln und durchgefuehrte Fixes

### 1. console.log / console.info verboten
**Regel:** Nur `console.warn`, `console.error`, `console.debug` erlaubt.
**Fix:** Alle 69 `console.log(...)` durch `console.debug(...)` ersetzt.
**Betroffene Dateien:** main.ts (18x), GitCheckpointService.ts (14x), VaultDNAScanner.ts (9x),
AgentSidebarView.ts (7x), SemanticIndexService.ts (6x), AgentTask.ts (4x), + 7 weitere.

**Kuenftig beachten:** Niemals `console.log()` oder `console.info()` verwenden.
Immer `console.debug()` fuer Debug-Output, `console.warn()` fuer Warnungen,
`console.error()` fuer Fehler.

---

### 2. fetch() verboten
**Regel:** Obsidian-Plugins duerfen kein `fetch()` verwenden. Stattdessen `requestUrl` aus
dem Obsidian-SDK oder SDK-interne HTTP-Clients (Anthropic SDK, OpenAI SDK).
**Fixes:**
- `src/main.ts:735` — Warmup HEAD-Request: `fetch()` -> `requestUrl({ url, method: 'HEAD', throw: false })`
- `src/api/providers/openai.ts` — **Kompletter Rewrite**: Manuelles `fetch()` + SSE-Parsing
  ersetzt durch OpenAI SDK Streaming (`this.client.chat.completions.create({ stream: true })`).
  Das OpenAI SDK handhabt HTTP intern und braucht kein `fetch()` im User-Code.

**Kuenftig beachten:** Fuer HTTP-Requests immer `requestUrl` aus `'obsidian'` importieren.
Fuer LLM-API-Calls die jeweiligen SDKs verwenden (Anthropic SDK, OpenAI SDK).
Niemals `fetch()`, `XMLHttpRequest` oder `http.request()` direkt aufrufen.

---

### 3. require() verboten
**Regel:** Keine CommonJS `require()`-Aufrufe. ES-Module `import` verwenden.
**Fixes:**
- `GlobalFileService.ts` — 3x `require('fs'/'os'/'path')` -> `import fs from 'fs'` etc.
- `SyncBridge.ts` — `require('path')` -> `import pathModule from 'path'`
- `AgentTask.ts` — Inline `require('./modes/builtinModes')` -> Top-Level `import`
- `GitCheckpointService.ts` — `require('fs')` -> `import fs from 'fs'`
- `ExecuteRecipeTool.ts` — `require('child_process')` -> `import { spawn } from 'child_process'`

**Ausnahme:** `SafeStorageService.ts` behaelt `require('electron')` — Electron ist nur
zur Laufzeit im Renderer-Prozess verfuegbar und kann nicht statisch importiert werden.
Kommentar mit `eslint-disable-next-line @typescript-eslint/no-require-imports` + Begruendung.

**Kuenftig beachten:** Alle neuen Module mit ES `import` einbinden. Node-Built-ins
(`fs`, `path`, `os`, `child_process`) sind in esbuild als `external` konfiguriert —
ES-Imports funktionieren. Einzige Ausnahme: `electron` (dynamischer require noetig).

---

### 4. Hardcoded `.obsidian` Pfade verboten
**Regel:** Nicht `.obsidian` oder `.obsidian/plugins` direkt verwenden. Stattdessen
`Vault#configDir` (bzw. `this.app.vault.configDir`).
**Fixes:**
- `main.ts:120,408` — pluginDir: `` `.obsidian/plugins/${id}` `` -> `` `${this.app.vault.configDir}/plugins/${id}` ``
- `VaultDNAScanner.ts` — 6 Stellen: `.obsidian/` -> `${this.vault.configDir}/`
- `WriteFileTool.ts:65` — `path.startsWith('.obsidian/')` -> `path.startsWith(\`${cfgDir}/\`)`
- `EmbeddingsTab.ts:103` — pluginDir -> `${this.plugin.app.vault.configDir}/plugins/${id}`
- `toolDecisionGuidelines.ts` — Prompt-Template: configDir als Parameter akzeptiert
- `systemPrompt.ts` — configDir Parameter durchgereicht
- `IgnoreService.ts` — `ALWAYS_BLOCKED` von static zu instance field, baut Pfade dynamisch

**Kuenftig beachten:** Immer `this.app.vault.configDir` (oder `this.vault.configDir`)
verwenden. In Kommentaren/JSDoc ist `.obsidian` als Referenz OK, aber in String-Literals
die Pfade konstruieren, MUSS configDir verwendet werden.

---

### 5. Inline Styles verboten
**Regel:** Kein `element.style.display = '...'` etc. CSS-Klassen verwenden oder `setCssProps()`.
**Fixes (~90+ Stellen):**
- Utility-CSS-Klassen in `styles.css` erstellt:
  ```css
  .agent-u-hidden { display: none !important; }
  .agent-u-visible { display: block; }
  .agent-u-visible-flex { display: flex; }
  .agent-u-visibility-hidden { visibility: hidden; }
  .agent-u-height-auto { height: auto; }
  .agent-u-mb-12 { margin-bottom: 12px; }
  .agent-embed-guide { ... }
  ```
- Show/Hide Toggles: `el.style.display = 'none'/'block'` -> `el.classList.add/remove('agent-u-hidden')`
- Statische Styles (padding, background, border) -> eigene CSS-Klassen
- Dynamische Positionierung (top, left mit berechneten Werten) -> `style.setProperty()` (erlaubt)

**Betroffene Dateien:** AgentSidebarView.ts (~33x), ModelConfigModal.ts (~19x),
ToolPickerPopover.ts (~19x), CodeImportModal.ts (~10x), EmbeddingsTab.ts (~6x), + 9 weitere.

**Kuenftig beachten:** Niemals `element.style.X = Y` direkt setzen.
- Fuer Show/Hide: `classList.add/remove('agent-u-hidden')` verwenden
- Fuer statische Styles: CSS-Klasse in `styles.css` definieren
- Fuer dynamische berechnete Werte: `element.style.setProperty('--var', value)` oder
  `setCssProps()` ist erlaubt (CSS Custom Properties)

---

### 6. innerHTML verboten
**Regel:** Kein `element.innerHTML = '...'`. Obsidian DOM API verwenden.
**Fix:**
- `EmbeddingsTab.ts:81` — `guide.innerHTML = [...]` ersetzt durch `createEl()`/`appendText()`

**Kuenftig beachten:** Immer Obsidian DOM API verwenden:
`createEl('tag', { text, cls })`, `createDiv()`, `createSpan()`, `appendText()`.
Niemals `innerHTML`, `outerHTML` oder `insertAdjacentHTML()`.

---

### 7. Floating Promises
**Regel:** Async-Aufrufe ohne `await` muessen explizit mit `void` markiert oder
mit `.catch()` behandelt werden.
**Fixes (~69 Stellen):**
- Fire-and-forget Calls: `void this.someAsyncMethod()`
- Event-Callbacks: `setTimeout(() => { void this.asyncMethod(); }, ms)`
- Promise in void-Argument: `void` Prefix hinzugefuegt

**Kuenftig beachten:** Jeder async-Aufruf muss entweder:
1. `await`-ed werden, oder
2. mit `void` prefixed werden (bewusster fire-and-forget), oder
3. mit `.catch()` error-handled werden

---

### 8. `any` Types (~245 Stellen)
**Regel:** `@typescript-eslint/no-explicit-any` — kein `any` verwenden.
**Fixes:**
- **Obsidian Type Augmentation:** Neue Datei `src/types/obsidian-augments.d.ts`
  deklariert interne Obsidian-APIs (`App.plugins`, `App.commands`, `App.setting`,
  `Workspace.rightSplit`, `FileSystemAdapter.basePath`, `MetadataCache.getBacklinksForFile`).
  Eliminiert ~60 `as any` Casts.
- **Electron Type Declaration:** `src/types/electron.d.ts` fuer SafeStorageService.
- **Core Types:** `Record<string, any>` -> `Record<string, unknown>` in `api/types.ts`,
  `tools/types.ts`. Kaskadierend alle Tools und Provider angepasst.
- **UI-Dateien:** `(this.app as any).setting` -> `this.app.setting` (via Augmentation).
- **Provider:** SDK-Typen statt lokaler `any`-Typen.

**Kuenftig beachten:**
- Fuer Obsidian-interne APIs: Typen in `obsidian-augments.d.ts` erweitern
- Fuer externe Input-Daten: `unknown` statt `any`, dann mit Type Guards einengen
- Fuer SDK-Typen: Die Typen des jeweiligen SDK verwenden, nicht `any` casten
- Fuer generische Records: `Record<string, unknown>` statt `Record<string, any>`

---

### 9. SSE Transport Deprecation
**Regel:** `SSEClientTransport` ist deprecated im MCP SDK.
**Fix:** `McpClient.ts` — StreamableHTTPClientTransport als primaerer Transport,
SSEClientTransport als Fallback bei Verbindungsfehler.

**Kuenftig beachten:** Bei neuen MCP-Verbindungen immer `StreamableHTTPClientTransport`
bevorzugen. `SSEClientTransport` nur als Fallback fuer aeltere Server.

---

### 10. Diverse Regeln

| Regel | Fix | Kuenftig |
|-------|-----|----------|
| `TFile`/`TFolder` Casting | `as TFile` -> `instanceof TFile` Check | Immer `instanceof` verwenden |
| `Vault.delete()`/`trash()` | -> `FileManager.trashFile()` | Respektiert User-Einstellung |
| Unnecessary escape chars | `\[` -> `[` in Regex | Regex pruefen |
| Empty block statements | `// intentionally empty` Kommentar | Kommentar oder Code hinzufuegen |
| eslint-disable ohne Beschreibung | Beschreibung hinzugefuegt | Immer `-- reason` anhaengen |
| Unused vars/imports | Entfernt (~20 Stellen) | Regelmaessig aufraumen |
| Async ohne await | `async` entfernt oder `void` prefix | async nur wenn await vorhanden |
| Template Literal mit unknown | `String(value)` Wrapper | Explizit stringifizieren |
| Promise rejection nicht Error | `reject(new Error(...))` | Immer Error-Objekte rejecten |

---

## Neue Dateien

| Datei | Zweck |
|-------|-------|
| `src/types/obsidian-augments.d.ts` | Module Augmentation fuer interne Obsidian-APIs |
| `src/types/electron.d.ts` | Ambient Module fuer `'electron'` (safeStorage Subset) |

## Geaenderte CSS (styles.css)

Neue Utility-Klassen hinzugefuegt:
- `.agent-u-hidden` — display: none !important
- `.agent-u-visible` — display: block
- `.agent-u-visible-flex` — display: flex
- `.agent-u-visibility-hidden` — visibility: hidden
- `.agent-u-height-auto` — height: auto
- `.agent-u-mb-12` — margin-bottom: 12px
- `.agent-embed-guide` — Guide-Box Styling fuer EmbeddingsTab

---

## Checkliste fuer kuenftige Aenderungen

Vor jedem Push pruefen:

```bash
# Kein console.log/info
grep -r "console\.\(log\|info\)(" src/ --include="*.ts"

# Kein fetch()
grep -r "\bfetch(" src/ --include="*.ts"

# Kein require() (ausser SafeStorageService)
grep -r "\brequire(" src/ --include="*.ts" | grep -v SafeStorageService

# Kein hardcoded .obsidian in Code (Kommentare OK)
grep -rn "'.obsidian\|\.obsidian/" src/ --include="*.ts" | grep -v "//\|/\*\|\*"

# Kein innerHTML
grep -r "\.innerHTML\s*=" src/ --include="*.ts"

# Kein inline style.X = Y
grep -r "\.style\.\w\+\s*=" src/ --include="*.ts" | grep -v setProperty

# Kein explicit any
grep -r ": any\b\|as any\b" src/ --include="*.ts" | grep -v "\.d\.ts"

# Build
npm run build
```
