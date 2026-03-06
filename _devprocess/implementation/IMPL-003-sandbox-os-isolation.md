# Implementierungsplan: Sandbox OS-Level Process Isolation

**Datum:** 2026-03-03
**Revision:** 5
**Branch:** `sandbox-hardening`
**ADR:** ADR-021-sandbox-os-isolation.md
**Feature:** FEATURE-sandbox-os-isolation.md
**Bezug:** AUDIT-obsilo-2026-03-01.md, Finding H-1
**Audit-Review:** Security-Audit Rev 2 (2026-03-03), 8 Findings; Re-Audit Rev 3 (2026-03-03), 3 Findings (M-4, L-3, L-4); Re-Audit Rev 4 (2026-03-03), 3 Findings (M-5, L-5, Info-2)

---

## 1. Kontext

**Problem:** Die aktuelle iframe-Sandbox (`sandbox="allow-scripts"`) bietet in Electrons Renderer nur V8-Origin-Isolation -- logische Grenze im gleichen Prozess mit shared address space. Bei `nodeIntegration: true` koennte ein V8-Exploit aus der Sandbox ausbrechen und vollen Node.js-Zugriff erlangen. Zusaetzlich blockt `SandboxBridge.validateVaultPath()` keine Writes nach `configDir/plugins/` -- das Shai-Hulud-Szenario (Self-Replicating Malware via Vault-Write) ist nur durch User Approval geschuetzt, nicht durch Code.

**Root Cause:** Obsidians Renderer laeuft mit `nodeIntegration: true` und `contextIsolation: false`. iframe-Sandbox ist fuer Web-Szenarien konzipiert, nicht fuer Desktop-Plugins in Electron.

**Loesung:** Hybrid-Architektur mit `child_process.fork()` auf Desktop (OS-Level Prozess-Isolation) und iframe als Mobile-Fallback. Defense-in-Depth im Worker durch `vm.createContext()` (Scope-Isolation) zusaetzlich zur OS-Prozess-Isolation. Vault-Path-Allowlist fuer Write-Operationen in der SandboxBridge.

**Defense-in-Depth Schichten (Worker):**

| Schicht | Mechanismus | Schuetzt gegen |
|---------|-------------|----------------|
| 1 | AstValidator (Regex-Pre-Check) | Offensichtlich boesartige Patterns |
| 2 | `vm.createContext()` (Scope-Isolation) | Zugriff auf `process`, `require`, `fs`, `globalThis` |
| 3 | OS-Prozess (`child_process.fork()`) | V8-Exploits, CPU/Memory-Exhaustion, Crash-Isolation |
| 4 | `--max-old-space-size=128` (Heap-Limit) | Memory-Exhaustion DoS |
| 5 | SandboxBridge configDir-Allowlist | Shai-Hulud (Self-Replicating Malware) |
| 6 | SandboxBridge Write-Size-Limit | Disk-Exhaustion DoS |

---

## 2. Implementierungs-Phasen

### Phase 1: Interface-Extraktion + Rename + Factory + Settings

#### 1.1 ISandboxExecutor Interface

**Datei NEU: `src/core/sandbox/ISandboxExecutor.ts`**

```typescript
// NACHHER
export interface ISandboxExecutor {
    ensureReady(): Promise<void>;
    execute(compiledJs: string, input: Record<string, unknown>): Promise<unknown>;
    destroy(): void;
}
```

#### 1.2 SandboxExecutor -> IframeSandboxExecutor

**Datei RENAME: `src/core/sandbox/SandboxExecutor.ts` -> `src/core/sandbox/IframeSandboxExecutor.ts`**

```typescript
// VORHER
export class SandboxExecutor {

// NACHHER
import type { ISandboxExecutor } from './ISandboxExecutor';
export class IframeSandboxExecutor implements ISandboxExecutor {
```

Gesamter Body bleibt identisch. Nur Klassenname + Interface-Klausel.

#### 1.3 Factory

**Datei NEU: `src/core/sandbox/createSandboxExecutor.ts`**

```typescript
// NACHHER
import { Platform } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import type { ISandboxExecutor } from './ISandboxExecutor';
import { IframeSandboxExecutor } from './IframeSandboxExecutor';

export function createSandboxExecutor(
    plugin: ObsidianAgentPlugin,
    mode: 'auto' | 'process' | 'iframe' = 'auto',
): ISandboxExecutor {
    if (mode === 'iframe' || (mode === 'auto' && !Platform.isDesktop)) {
        return new IframeSandboxExecutor(plugin);
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- child_process nur via dynamic require in Electron renderer
    const { ProcessSandboxExecutor } = require('./ProcessSandboxExecutor') as
        { ProcessSandboxExecutor: new (p: ObsidianAgentPlugin) => ISandboxExecutor };
    return new ProcessSandboxExecutor(plugin);
}
```

**Hinweis:** Dynamischer `require()` folgt dem gleichen Pattern wie `SafeStorageService` (`src/core/security/SafeStorageService.ts:37`). Verhindert, dass `child_process` auf Mobile geladen wird.

#### 1.4 Settings erweitern

**Datei: `src/types/settings.ts`**

```typescript
// NACHHER -- neues Feld in ObsidianAgentSettings
sandboxMode: 'auto' | 'process' | 'iframe';
```

Default in `DEFAULT_SETTINGS`:
```typescript
sandboxMode: 'auto',
```

- `'auto'`: Desktop = ProcessSandboxExecutor, Mobile = IframeSandboxExecutor
- `'process'`: Force ProcessSandboxExecutor (nur Desktop)
- `'iframe'`: Force IframeSandboxExecutor (alle Plattformen) -- Rollback-Option

#### Verifikation Phase 1
- `npm run build` fehlerfrei
- Plugin laden, `evaluate_expression` im iframe-Modus testen (Factory waehlt iframe solange ProcessSandboxExecutor noch nicht existiert)

---

### Phase 2: sandbox-worker.ts + ProcessSandboxExecutor

#### 2.1 Worker-Script (vm.createContext -- Audit-Finding H-1)

**Datei NEU: `src/core/sandbox/sandbox-worker.ts` (~150 Zeilen)**

Separater OS-Prozess mit `ELECTRON_RUN_AS_NODE=1`. Spiegelt das Message-Protokoll aus `sandboxHtml.ts`.

**Kritisch: `vm.createContext()` statt `new Function()`** -- Der Worker laeuft als vollstaendiger Node.js-Prozess. `new Function()` wuerde dem ausgefuehrten Code Zugriff auf `process`, `require('fs')`, `require('child_process')` etc. geben. Der AstValidator ist regex-basiert und bypassbar (z.B. via String-Concatenation: `globalThis['req' + 'uire']`). Daher nutzen wir `vm.createContext()` + `vm.runInNewContext()` fuer Scope-Isolation innerhalb des Workers.

| Komponente | Detail |
|------------|--------|
| Bridge-Proxies | `vault` (read/readBinary/list/write/writeBinary) + `requestUrl`, beide `Object.freeze()` |
| `bridgeCall()` | Unique `callId` (`bc_` + counter), 15s Timeout pro Call, via `process.send()` |
| Code-Execution | **`vm.createContext()` + `vm.runInNewContext()`** -- isolierter Scope ohne `process`/`require`/`fs` |
| VM-Allowlist | Nur explizit freigegebene Globals: `vault`, `requestUrl`, `console` (stub), `setTimeout`, `clearTimeout`, `Promise`, `JSON`, `Math`, `Date`, `Object` (vollstaendig -- npm-Pakete benoetigen `create`/`defineProperty`/`getPrototypeOf` etc.), `Array`, `Map`, `Set`, `RegExp`, `Error`, `TypeError`, `RangeError`, `parseInt`, `parseFloat`, `isNaN`, `isFinite`, `Number`, `String`, `Boolean`, `encodeURIComponent`, `decodeURIComponent`, `TextEncoder`, `TextDecoder`, `Uint8Array`, `Int8Array`, `Uint16Array`, `Int16Array`, `Uint32Array`, `Int32Array`, `Float32Array`, `Float64Array`, `ArrayBuffer`, `DataView`, `Symbol` |
| IPC | `process.send()` / `process.on('message')` statt postMessage |
| Ready-Signal | `process.send({ type: 'sandbox-ready' })` bei Start |
| Error-Handling | Promise-catch um `executeInSandbox()`, sendet `{ type: 'error', id, message }` |

```typescript
// NACHHER (Kernstruktur)
import { createContext, runInNewContext } from 'vm';

const vault = Object.freeze({
    read: (path: string) => bridgeCall('vault-read', { path }),
    readBinary: (path: string) => bridgeCall('vault-read-binary', { path }),
    list: (path: string) => bridgeCall('vault-list', { path }),
    write: (path: string, content: string) => bridgeCall('vault-write', { path, content }),
    writeBinary: (path: string, content: ArrayBuffer) =>
        bridgeCall('vault-write-binary', { path, content }),
});

const requestUrlProxy = Object.freeze(
    (url: string, options?: { method?: string; body?: string }) =>
        bridgeCall('request-url', { url, options })
);

// Isolierter VM-Context -- KEIN process, require, fs, globalThis, Buffer
// WICHTIG (Audit M-4): Object.freeze() NACH createContext() anwenden!
// createContext() muss das Objekt modifizieren koennen (interne V8-Slots).
// Freeze auf dem aeusseren Objekt VORHER wuerde TypeError verursachen.
const contextGlobals: Record<string, unknown> = {
    vault,
    requestUrl: requestUrlProxy,
    console: Object.freeze({
        log: () => {}, debug: () => {}, warn: () => {}, error: () => {},
    }),
    setTimeout, clearTimeout, Promise, JSON, Math, Date,
    // M-4: Volles Object-Konstrukt statt Subset -- npm-Pakete benoetigen
    // Object.create, Object.defineProperty, Object.getPrototypeOf, etc.
    Object, Array, Map, Set, RegExp,
    Error, TypeError, RangeError,
    Number, String, Boolean, Symbol,
    parseInt, parseFloat, isNaN, isFinite,
    encodeURIComponent, decodeURIComponent,
    TextEncoder, TextDecoder,
    // L-3: TypedArrays + ArrayBuffer fuer binaere Datenverarbeitung
    Uint8Array, Int8Array, Uint16Array, Int16Array,
    Uint32Array, Int32Array, Float32Array, Float64Array,
    ArrayBuffer, DataView,
};

// createContext() ZUERST -- danach freeze
const vmContext = createContext(contextGlobals);
// M-5: Freeze nach createContext. Der vmContext ist danach IMMUTABLE.
// Das bedeutet: KEINE Runtime-Properties setzen (vmContext.x = ...) oder
// loeschen (delete vmContext.x) -- beides wirft TypeError.
// Code-Injection erfolgt daher NICHT ueber Context-Properties, sondern
// ueber String-Concatenation mit JSON.stringify() (siehe executeInSandbox).
Object.freeze(vmContext);

async function executeInSandbox(id: string, code: string, input: Record<string, unknown>): Promise<void> {
    try {
        // L-4 + M-5: Code-Einbettung ohne Template-Literals und ohne Context-Mutation.
        //
        // Problem L-4: Template-Literal `${code}` bricht bei Backticks im User-Code.
        // Problem M-5: vmContext ist Object.freeze()'d -- Properties setzen/loeschen
        //              wirft TypeError (vmContext.__CODE__ = ... ist verboten).
        //
        // Loesung: JSON.stringify(code) erzeugt ein sicheres JS-String-Literal
        // (escaped ", \, Newlines, Control-Characters, Backticks). Dieses wird
        // per String-Concatenation (+) in den wrappedCode eingebettet.
        // new Function() innerhalb des vm-Contexts erbt den vm-Realm-Scope
        // (kein process, require) -- sicher trotz Function-Constructor.
        const escapedCode = JSON.stringify(code);
        const wrappedCode = '(function() {'
            + '\n    var exports = {};'
            + '\n    var __fn = new Function("exports", ' + escapedCode + ');'
            + '\n    __fn(exports);'
            + '\n    return exports;'
            + '\n})()';

        const moduleExports = runInNewContext(wrappedCode, vmContext, {
            timeout: 30000,
            filename: 'sandbox-module.js',
        });

        const result = await moduleExports.execute(input, { vault, requestUrl: requestUrlProxy });
        process.send!({ type: 'result', id, value: result });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        process.send!({ type: 'error', id, message });
    }
}

process.on('message', (msg: unknown) => {
    // Type-Guard: nur bekannte Message-Typen verarbeiten
    if (!msg || typeof msg !== 'object') return;
    const m = msg as Record<string, unknown>;

    // Bridge-Response (hat callId) -> resolve/reject pending bridgeCall
    if (typeof m['callId'] === 'string' && pendingCalls.has(m['callId'])) {
        // ... resolve/reject
        return;
    }

    // Execute-Command
    if (m['type'] === 'execute' && typeof m['id'] === 'string' && typeof m['code'] === 'string') {
        void executeInSandbox(
            m['id'] as string,
            m['code'] as string,
            (m['input'] as Record<string, unknown>) ?? {},
        );
    }
});

process.send!({ type: 'sandbox-ready' });
```

**Warum `vm.createContext()` und nicht `new Function()`:**

| Aspekt | `new Function()` | `vm.createContext()` |
|--------|-------------------|----------------------|
| Zugriff auf `process` | Ja (voller Node.js) | Nein (isolierter Scope) |
| Zugriff auf `require()` | Ja (kann `fs`, `child_process` laden) | Nein (nicht im Context) |
| `globalThis` Escape | `(function(){return this})()` | Gibt den VM-Context zurueck, nicht den echten |
| String-Concat-Bypass | `globalThis['req'+'uire']` funktioniert | Kein `require` im Scope, Bypass irrelevant |
| Object-Subset-Risiko | n/a | Volles `Object` exponiert (M-4: npm-Kompatibilitaet) -- `Object.constructor` Escape gedeckt durch OS-Prozess-Isolation |
| Timeout-Mechanismus | Kein V8-Level-Timeout | `timeout: 30000` unterbricht V8-Execution |
| V8-Exploit-Risiko | Voller Node.js-Zugriff bei Escape | OS-Prozess-Isolation als aeussere Schicht |

#### 2.2 ProcessSandboxExecutor

**Datei NEU: `src/core/sandbox/ProcessSandboxExecutor.ts` (~200 Zeilen)**

| Aspekt | Detail |
|--------|--------|
| Interface | `implements ISandboxExecutor` |
| Spawn | `child_process.fork(workerPath, [], { env: { ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore','ignore','ignore','ipc'], execArgv: ['--max-old-space-size=128'] })` |
| Worker-Pfad | `vault.adapter.getBasePath() + configDir/plugins/{id}/sandbox-worker.js` |
| Heap-Limit | **128 MB** via `--max-old-space-size=128` (Audit-Finding H-2: verhindert Memory-Exhaustion DoS) |
| Init | Wartet auf `sandbox-ready` Message, 10s Init-Timeout |
| readyPromise-Guard | **Explizites `readyPromise`-Pattern** wie in `IframeSandboxExecutor` -- verhindert doppelten Fork bei parallelen `ensureReady()`-Aufrufen (Audit-Finding M-3) |
| Keep-Alive | Worker bleibt am Leben zwischen Executions (lazy init, persistent) |
| Execution-Timeout | 30s pro Execution |
| Bridge-Routing | vault-read/write/list/request-url -> `SandboxBridge` -> IPC-Response zurueck |
| IPC-Validierung | **Type-Guards** auf allen eingehenden Worker-Messages (Audit-Finding L-1) |
| Crash-Recovery | Worker-Exit rejected alle Pending, Respawn bei naechstem `ensureReady()`, max 3x |
| Destroy | `SIGTERM` + 2s `SIGKILL` Fallback, rejected alle Pending |
| require() | `require('child_process')` -- erlaubte Ausnahme wie `SafeStorageService` (`src/core/security/SafeStorageService.ts:37`) |

```typescript
// NACHHER (Kernstruktur)

/** Messages FROM the worker TO the plugin (typed union) */
type WorkerToPluginMessage =
    | { type: 'sandbox-ready' }
    | { type: 'result'; id: string; value: unknown }
    | { type: 'error'; id: string; message: string }
    | { type: 'vault-read'; callId: string; path: string }
    | { type: 'vault-read-binary'; callId: string; path: string }
    | { type: 'vault-list'; callId: string; path: string }
    | { type: 'vault-write'; callId: string; path: string; content: string }
    | { type: 'vault-write-binary'; callId: string; path: string; content: ArrayBuffer }
    | { type: 'request-url'; callId: string; url: string; options?: { method?: string; body?: string } };

export class ProcessSandboxExecutor implements ISandboxExecutor {
    private worker: ChildProcess | null = null;
    private bridge: SandboxBridge;
    private pending = new Map<string, PendingExecution>();
    private respawnCount = 0;
    private readyPromise: Promise<void> | null = null;  // M-3: Race-Condition-Guard
    private ready = false;
    private static readonly MAX_RESPAWNS = 3;
    private static readonly HEAP_LIMIT_MB = 128;        // H-2: Memory-Limit

    constructor(private plugin: ObsidianAgentPlugin) {
        this.bridge = new SandboxBridge(plugin);
    }

    async ensureReady(): Promise<void> {
        // M-3: ReadyPromise-Guard -- verhindert doppelten Fork
        if (this.ready && this.worker) return;
        if (!this.readyPromise) {
            this.readyPromise = this.spawnWorker();
        }
        return this.readyPromise;
    }

    private async spawnWorker(): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- child_process nur via dynamic require in Electron renderer
        const cp = require('child_process') as typeof import('child_process');
        this.worker = cp.fork(this.getWorkerPath(), [], {
            env: { ELECTRON_RUN_AS_NODE: '1' },
            stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
            execArgv: [`--max-old-space-size=${ProcessSandboxExecutor.HEAP_LIMIT_MB}`],
        });

        this.worker.on('message', (msg: unknown) => {
            void this.handleMessage(msg);
        });

        this.worker.on('exit', () => {
            this.ready = false;
            this.readyPromise = null;
            // Reject all pending executions
            for (const p of this.pending.values()) {
                clearTimeout(p.timeout);
                p.reject(new Error('Worker process exited unexpectedly'));
            }
            this.pending.clear();
        });

        // Wait for sandbox-ready with 10s timeout
        await new Promise<void>((resolve, reject) => { /* ... */ });
        this.ready = true;
    }

    async execute(compiledJs: string, input: Record<string, unknown>): Promise<unknown> {
        await this.ensureReady();
        /* IPC send + Promise mit 30s Timeout */
    }

    destroy(): void { /* SIGTERM + SIGKILL fallback, reject all pending */ }

    // L-1: Type-Guard fuer IPC-Messages
    private isValidWorkerMessage(msg: unknown): msg is WorkerToPluginMessage {
        if (!msg || typeof msg !== 'object') return false;
        const m = msg as Record<string, unknown>;
        if (typeof m['type'] !== 'string') return false;
        const validTypes = [
            'sandbox-ready', 'result', 'error',
            'vault-read', 'vault-read-binary', 'vault-list',
            'vault-write', 'vault-write-binary', 'request-url',
        ];
        return validTypes.includes(m['type']);
    }

    private async handleMessage(msg: unknown): Promise<void> {
        // L-1: Validate message shape before processing
        if (!this.isValidWorkerMessage(msg)) return;

        // result/error -> resolve/reject pending execution
        // vault-read/write/request-url -> SandboxBridge -> IPC response
    }

    private getWorkerPath(): string {
        // vault.adapter.getBasePath() + configDir/plugins/{id}/sandbox-worker.js
    }

    private gracefulKill(proc: ChildProcess): void {
        // SIGTERM + setTimeout(SIGKILL, 2000)
    }
}
```

#### Verifikation Phase 2
- `sandboxMode: 'process'` setzen, `evaluate_expression` mit `return 2+2` testen
- Worker-PID im Activity Monitor sichtbar
- Worker manuell killen -> naechste Execution muss respawnen
- Build erfolgreich
- **V8-Scope-Isolation:** `return process.env` -> Error (process not defined)
- **V8-Scope-Isolation:** `return require('fs').readdirSync('/')` -> Error (require not defined)
- **V8-Scope-Isolation:** `return globalThis.process` -> undefined (vm-Context hat kein process)
- **V8-Scope-Isolation:** `const r = (function(){return this})(); return typeof r.require` -> "undefined"
- **Memory-Limit:** Allokation ueber 128MB -> Worker crasht, Plugin bleibt reaktiv
- **Parallel ensureReady():** Zwei gleichzeitige Calls erzeugen nur einen Worker

---

### Phase 3: Build-Konfiguration + Deploy

**Datei: `esbuild.config.mjs`**

Zweiter esbuild-Context nach dem bestehenden (nach Zeile 159, `});` schliesst die `context`-Definition):

```javascript
// NACHHER
const workerContext = await esbuild.context({
    entryPoints: ["src/core/sandbox/sandbox-worker.ts"],
    bundle: true,
    external: [],        // Standalone Node.js, keine Externals noetig
    platform: "node",
    format: "cjs",
    target: "es2022",
    outfile: "sandbox-worker.js",
    logLevel: "info",
    sourcemap: prod ? false : "inline",
    treeShaking: true,
});
```

vault-deploy Plugin erweitern (nach Zeile 149, nach dem `console.log('[vault-deploy]')`):
```javascript
// NACHHER (im vault-deploy onEnd, nach main.js + styles.css + logo copy)
if (existsSync("sandbox-worker.js")) {
    copyFileSync("sandbox-worker.js", `${VAULT_PLUGIN_DIR}/sandbox-worker.js`);
}
```

Build-Ende anpassen (Zeilen 161-166):
```javascript
// VORHER
if (prod) { await context.rebuild(); process.exit(0); }
else { await context.watch(); }

// NACHHER
if (prod) {
    await context.rebuild();
    await workerContext.rebuild();
    process.exit(0);
} else {
    await context.watch();
    await workerContext.watch();
}
```

#### Verifikation Phase 3
- `npm run build` erzeugt `main.js` UND `sandbox-worker.js` im Projekt-Root
- Beide Dateien im Deploy-Verzeichnis (`/Users/sebastianhanke/Obsidian/Obsilo/.obsidian/plugins/obsilo-agent/`)
- `npm run dev` ueberwacht beide Entry-Points (Watch-Mode)

---

### Phase 4: Residual Risk Mitigations

#### 4.1 configDir-Write-Allowlist + Write-Size-Limit (Audit-Findings M-1, M-2, L-2)

**Problem:** `SandboxBridge.validateVaultPath()` (`src/core/sandbox/SandboxBridge.ts:182-186`) blockt aktuell nur `..` und absolute Pfade. Writes nach `configDir/plugins/` sind erlaubt -- ein boesartiger Sandbox-Code koennte sich selbst als Obsidian-Plugin persistieren (Shai-Hulud-Szenario).

**Design-Entscheidung: Allowlist statt Blocklist** (Audit-Finding L-2)

Das Original sah eine Blocklist (`plugins/`, `themes/`) vor. Das Audit hat gezeigt, dass eine Blocklist strukturell unsicher ist -- jedes neue `configDir`-Subdirectory muss manuell ergaenzt werden. Stattdessen: **Alle Writes nach `configDir/` pauschal blocken.** Einfacher, sicherer, zukunftsfest.

Begruendung: Sandbox-Code hat keinen legitimen Use-Case fuer Writes nach `configDir/`. Vault-Content (`notes/`, `attachments/`, etc.) bleibt erlaubt.

**Datei: `src/core/sandbox/SandboxBridge.ts:182-186`**

```typescript
// VORHER
private validateVaultPath(path: string): void {
    if (path.includes('..') || path.startsWith('/') || path.startsWith('\\')) {
        throw new Error(`Invalid path: ${path}`);
    }
}
```

```typescript
// NACHHER
private static readonly MAX_WRITE_SIZE = 10 * 1024 * 1024; // 10 MB (Audit M-2)

private validateVaultPath(path: string, isWrite = false): void {
    if (path.includes('..') || path.startsWith('/') || path.startsWith('\\')) {
        throw new Error(`Invalid path: ${path}`);
    }

    // Shai Hulud Mitigation: Block ALL writes to configDir (Audit L-2: Allowlist statt Blocklist)
    if (isWrite) {
        const configDir = this.plugin.app.vault.configDir;  // vault.configDir, nicht hardcoded
        const normalized = path.replace(/\\/g, '/');

        if (normalized.startsWith(`${configDir}/`) || normalized === configDir) {
            throw new Error(`Sandbox write blocked: ${configDir}/ is protected`);
        }
    }
}
```

#### 4.2 Write-Size-Limits (Audit-Finding M-2)

**Problem:** Kein Groessenlimit fuer einzelne Write-Operationen. Ein Modul koennte `vault.write('notes/bomb.md', 'x'.repeat(500_000_000))` ausfuehren und die Disk fuellen.

**Datei: `src/core/sandbox/SandboxBridge.ts` -- `vaultWrite()` und `vaultWriteBinary()`**

```typescript
// NACHHER -- vaultWrite (Zeile ~73)
async vaultWrite(path: string, content: string): Promise<void> {
    this.checkCircuitBreaker();
    this.validateVaultPath(path, true);
    // M-2: Write-Size-Limit
    if (content.length > SandboxBridge.MAX_WRITE_SIZE) {
        throw new Error(`Write too large: ${content.length} bytes (max ${SandboxBridge.MAX_WRITE_SIZE})`);
    }
    this.checkWriteRateLimit();
    // ... rest unveraendert
}

// NACHHER -- vaultWriteBinary (Zeile ~87)
async vaultWriteBinary(path: string, content: ArrayBuffer): Promise<void> {
    this.checkCircuitBreaker();
    this.validateVaultPath(path, true);
    // M-2: Write-Size-Limit
    if (content.byteLength > SandboxBridge.MAX_WRITE_SIZE) {
        throw new Error(`Write too large: ${content.byteLength} bytes (max ${SandboxBridge.MAX_WRITE_SIZE})`);
    }
    this.checkWriteRateLimit();
    // ... rest unveraendert
}
```

#### 4.3 Write-Calls: isWrite-Flag anpassen

**Zeile 73 (`vaultWrite`):**
```typescript
// VORHER
this.validateVaultPath(path);
// NACHHER
this.validateVaultPath(path, true);
```

**Zeile 87 (`vaultWriteBinary`):**
```typescript
// VORHER
this.validateVaultPath(path);
// NACHHER
this.validateVaultPath(path, true);
```

Read-Calls bleiben unveraendert (`isWrite = false` Default) -- Reads ueberall erlaubt fuer legitime Use-Cases.

#### 4.4 Was die Allowlist schuetzt

| Szenario | Geschuetzt? | Grund |
|----------|-------------|-------|
| Write nach `configDir/plugins/evil/main.js` | Ja | configDir-Block |
| Write nach `configDir/themes/evil/theme.css` | Ja | configDir-Block |
| Write nach `configDir/app.json` | Ja | configDir-Block |
| Write nach `configDir/community-plugins.json` | Ja | configDir-Block |
| Write nach `configDir/snippets/evil.css` | Ja | configDir-Block (Audit M-1 geschlossen) |
| Write nach `configDir/core-plugins/X.json` | Ja | configDir-Block |
| Write nach `notes/test.md` | Erlaubt | Normaler Vault-Content |
| Write nach `attachments/image.png` (10 MB) | Erlaubt | Unter Size-Limit |
| Write nach `notes/bomb.md` (500 MB) | Blockiert | Size-Limit (Audit M-2) |
| Read von `configDir/plugins/obsilo-agent/manifest.json` | Erlaubt | Reads nicht eingeschraenkt |

**Vorteile gegenueber Blocklist:**
- Kein Risiko durch vergessene Subdirectories
- Zukunftssicher bei neuen Obsidian-Config-Verzeichnissen
- Weniger Code, einfacher zu auditieren

#### Verifikation Phase 4
- `vault.write('.obsidian/plugins/evil/main.js', 'x')` -> Error: "Sandbox write blocked"
- `vault.write('.obsidian/app.json', '{}')` -> Error: "Sandbox write blocked"
- `vault.write('.obsidian/snippets/evil.css', 'x')` -> Error: "Sandbox write blocked"
- `vault.write('.obsidian/themes/evil/theme.css', 'x')` -> Error: "Sandbox write blocked"
- `vault.write('notes/test.md', 'ok')` -> Erlaubt
- `vault.write('notes/big.md', 'x'.repeat(11_000_000))` -> Error: "Write too large"
- `vault.read('.obsidian/plugins/obsilo-agent/manifest.json')` -> Erlaubt
- Nutzt `vault.configDir` statt hardcoded `.obsidian` (Review-Bot Compliance)

---

### Phase 5: Consumer-Migration

Alle 8 Consumer-Dateien: `import type { SandboxExecutor }` -> `import type { ISandboxExecutor }`

| Datei | Zeilen | Aenderung |
|-------|--------|-----------|
| `src/main.ts` | L44, L100, L216 | Import + Typ `ISandboxExecutor` + `createSandboxExecutor(this, this.settings.sandboxMode)` |
| `src/core/tools/ToolRegistry.ts` | L74, L92, L117 | Import + Parameter-Typ |
| `src/core/tools/agent/EvaluateExpressionTool.ts` | L14, L38 | Import + Parameter-Typ |
| `src/core/tools/agent/ManageSkillTool.ts` | L22, L59 | Import + Parameter-Typ |
| `src/core/tools/dynamic/DynamicToolFactory.ts` | L13, L27, L65 | Import + Parameter-Typ |
| `src/core/tools/dynamic/DynamicToolLoader.ts` | L20, L43 | Import + Parameter-Typ |
| `src/core/skills/CodeModuleCompiler.ts` | L13, L40 | Import + Parameter-Typ |
| `src/core/skills/SelfAuthoredSkillLoader.ts` | L19, L54, L64, L79 | Import + Parameter-Typ |

Pattern ueberall identisch:
```typescript
// VORHER
import type { SandboxExecutor } from '../sandbox/SandboxExecutor';
// NACHHER
import type { ISandboxExecutor } from '../sandbox/ISandboxExecutor';
```

Alle nutzen `import type` -- reine Typ-Aenderung, kein Runtime-Impact.

#### Verifikation Phase 5
- `npm run build` fehlerfrei
- `grep -r "SandboxExecutor" src/` -> nur in `IframeSandboxExecutor.ts`
- Desktop: Worker-Prozess laeuft, evaluate_expression funktioniert
- Plugin unload: kein orphaned Worker (`ps aux | grep sandbox-worker`)

---

## 3. Dateien-Zusammenfassung

| Datei | Aenderung | Phase | Risiko |
|-------|-----------|-------|--------|
| `src/core/sandbox/ISandboxExecutor.ts` | **NEU** -- Interface | 1 | Gering |
| `src/core/sandbox/IframeSandboxExecutor.ts` | **RENAME** + implements ISandboxExecutor | 1 | Gering |
| `src/core/sandbox/createSandboxExecutor.ts` | **NEU** -- Platform-Factory (~25 LOC) | 1 | Mittel |
| `src/types/settings.ts` | sandboxMode Feld + Default | 1 | Gering |
| `src/core/sandbox/sandbox-worker.ts` | **NEU** -- Worker-Script mit `vm.createContext()` (~150 LOC) | 2 | Hoch |
| `src/core/sandbox/ProcessSandboxExecutor.ts` | **NEU** -- fork()-Backend mit Heap-Limit + readyPromise-Guard (~200 LOC) | 2 | Hoch |
| `esbuild.config.mjs` | Zweiter Entry-Point + Deploy | 3 | Mittel |
| `src/core/sandbox/SandboxBridge.ts` | configDir-Allowlist + Write-Size-Limit | 4 | Mittel |
| `src/main.ts` | Import + Typ + Factory-Call | 5 | Mittel |
| `src/core/tools/ToolRegistry.ts` | Type-Import Migration | 5 | Gering |
| `src/core/tools/agent/EvaluateExpressionTool.ts` | Type-Import Migration | 5 | Gering |
| `src/core/tools/agent/ManageSkillTool.ts` | Type-Import Migration | 5 | Gering |
| `src/core/tools/dynamic/DynamicToolFactory.ts` | Type-Import Migration | 5 | Gering |
| `src/core/tools/dynamic/DynamicToolLoader.ts` | Type-Import Migration | 5 | Gering |
| `src/core/skills/CodeModuleCompiler.ts` | Type-Import Migration | 5 | Gering |
| `src/core/skills/SelfAuthoredSkillLoader.ts` | Type-Import Migration | 5 | Gering |

---

## 4. Nicht betroffen (Blast Radius)

- `src/core/sandbox/sandboxHtml.ts` -- Unveraendert, weiterhin fuer IframeSandboxExecutor (Mobile)
- `src/core/sandbox/AstValidator.ts` -- Unveraendert, backend-unabhaengig
- `src/core/sandbox/EsbuildWasmManager.ts` -- Unveraendert, Compilation ist unabhaengig vom Execution-Backend
- Alle anderen 28+ Tools (`src/core/tools/`)
- UI-Komponenten (`src/ui/`)
- Provider (`src/providers/`)
- AgentTask, Pipeline, Context (`src/core/`)
- `styles.css` -- `.agent-sandbox-iframe` bleibt fuer Mobile-Fallback

---

## 5. Phasen-Abhaengigkeiten

```
Phase 1 (Interface + Rename + Factory + Settings)
    |
    v
Phase 2 (sandbox-worker.ts + ProcessSandboxExecutor) -- abhaengig von Phase 1
    |
    v
Phase 3 (Build-Config + Deploy) -- abhaengig von Phase 2
    |
    v
Phase 5 (Consumer-Migration) -- abhaengig von Phase 1-3

Phase 4 (Path Blacklist) -- UNABHAENGIG, kann parallel zu Phase 2/3
```

Phase 4 kann jederzeit umgesetzt werden -- die Path-Blacklist gilt fuer beide Backends.

---

## 6. Bekannte Herausforderungen

| Herausforderung | Mitigation |
|-----------------|------------|
| ArrayBuffer-Serialisierung ueber IPC | Node.js IPC nutzt structured clone -- ArrayBuffer wird korrekt uebertragen. Grosse Binaerdaten (>1MB) koennten langsam sein. |
| Worker-Pfad-Aufloesung auf Windows | `getWorkerPath()` nutzt `vault.adapter.getBasePath()`. Windows-Backslashes beachten. |
| ELECTRON_RUN_AS_NODE + ESM | Worker als CJS gebundelt (`format: 'cjs'`). Falls Obsidian zu ESM wechselt, bleibt Worker separat CJS. |
| First-Spawn-Latenz (~300-3000ms) | Mitigiert durch Keep-Alive. Worker bleibt persistent nach erstem Spawn. |
| Review-Bot: require() | `require('child_process')` mit eslint-disable + Reason-Kommentar. Gleich wie SafeStorageService. |
| Review-Bot: child_process generell | Community Plugin Review Bot koennte `child_process` in jeder Form ablehnen (nicht nur als `require()`). Rollback-Szenario (Factory liefert immer `IframeSandboxExecutor`) ist vorbereitet. (Audit Info-1) |
| vm.createContext() Limitations | `vm` ist KEINE vollstaendige Sandbox (Node.js Docs warnen explizit). Deshalb Defense-in-Depth: vm + OS-Prozess + AstValidator. Ein vm-Escape gibt Zugriff auf den Worker-Prozess, nicht auf den Renderer. |
| vm timeout + async Code | `vm.runInNewContext({ timeout })` greift nur fuer synchronen Code. Async Code (Promises, await bridgeCall) wird durch den 30s Execution-Timeout in ProcessSandboxExecutor abgefangen. |
| Heap-Limit vs. legitimate Use-Cases | 128 MB sollte fuer Datentransformationen und File-Generierung ausreichend sein. Falls nicht: Setting `sandboxHeapLimitMb` in Folge-Iteration. |
| Object.freeze Timing (M-4) | `createContext()` muss das Ziel-Objekt modifizieren koennen (V8-interne Slots). Freeze VOR `createContext()` wuerde `TypeError: Cannot add property [Symbol(nodejs.vm.contextified)], object is not extensible` werfen. Loesung: Freeze NACH `createContext()`. |
| Volles Object im VM-Context (M-4) | npm-Pakete nutzen `Object.create`, `Object.defineProperty`, `Object.getPrototypeOf` etc. Ein Subset (`keys/values/entries/assign/freeze`) wuerde viele Pakete brechen. Volles `Object` exponiert theoretisch `Object.constructor` -> `Function`, aber OS-Prozess-Isolation deckt diesen Escape-Pfad ab. |
| Template-Injection (L-4) | Code mit Backticks (Template-Literals) wuerde bei `${code}`-Interpolation das aeussere Template brechen. Loesung: `new Function()` innerhalb des vm-Contexts nutzen, Code als `JSON.stringify()`-escaped String per String-Concatenation (`+`) einbetten. `new Function()` im vm-Context erbt den vm-Scope (kein `process`/`require`). |
| Buffer nicht im VM-Context (L-3) | Node.js `Buffer` ist bewusst NICHT exponiert (haengt am `process`-Scope). Stattdessen `Uint8Array`, `ArrayBuffer`, `DataView` als Standards-konforme Alternativen fuer binaere Datenverarbeitung. |
| Object.freeze vs. Runtime-Properties (M-5) | `Object.freeze(vmContext)` macht den Context immutable. Jeder Versuch, zur Laufzeit Properties zu setzen (`vmContext.x = ...`) oder zu loeschen (`delete vmContext.x`) wirft `TypeError`. Code-Injection daher NICHT ueber Context-Properties, sondern ueber String-Concatenation mit `JSON.stringify()`. |
| Reflect nicht im VM-Context (L-5) | `Reflect` ist bewusst NICHT in der VM-Allowlist. Sandbox-Code der `Reflect.get()` nutzt erhaelt `ReferenceError`. Security-Vorteil: verhindert Meta-Programmierung auf dem Context-Objekt (`Reflect.ownKeys()`, `Reflect.getPrototypeOf()`). Kein Impact auf npm-Pakete -- `Reflect` wird in Bundled-Code fast nie direkt genutzt (Babel/TypeScript kompilieren Reflect-Aufrufe weg). |

---

## 7. Rollback-Strategie

### Feature-Flag (empfohlen)

Setting `sandboxMode: 'iframe'` schaltet sofort auf iframe-Backend um. Kein Neustart noetig (wirkt ab naechster Execution).

### Build-Zeit-Rollback

Falls Community Plugin Review `child_process` ablehnt:
1. `createSandboxExecutor()` aendern: immer `IframeSandboxExecutor` zurueckgeben
2. `sandbox-worker.ts` aus esbuild-Config entfernen
3. `ProcessSandboxExecutor.ts` bleibt im Code, wird aber nie geladen

### Monitoring-Trigger

OperationLogger erfasst:
- Worker-Spawn-Zeit (first + subsequent)
- Worker-Crash-Count
- IPC-Timeout-Count

Falls Crash-Rate >10% in 24h: Notice an User mit Empfehlung zu `sandboxMode: 'iframe'`.

---

## 8. Verifikation (End-to-End)

### V1: Build
- [ ] `npm run build` -> `main.js` + `sandbox-worker.js` fehlerfrei
- [ ] Beide Dateien im Deploy-Verzeichnis

### V2: Desktop -- ProcessSandboxExecutor
- [ ] `evaluate_expression` mit `return 2+2` -> Ergebnis 4
- [ ] Worker-PID im Activity Monitor sichtbar
- [ ] `vault.read('test.md')` ueber Bridge -> Inhalt zurueck
- [ ] `requestUrl` ueber Bridge -> HTTP-Response
- [ ] `dependencies: ['lodash']` -> npm-Paket funktioniert
- [ ] `while(true){}` -> 30s Timeout, Plugin bleibt reaktiv (CPU-Isolation!)
- [ ] AstValidator: `process.exit(1)` wird rejected
- [ ] Worker manuell killen -> naechste Execution respawnt

### V2b: vm.createContext Scope-Isolation (Audit H-1, M-4, L-3, L-4)
- [ ] `return process.env` -> Error: "process is not defined"
- [ ] `return require('fs').readdirSync('/')` -> Error: "require is not defined"
- [ ] `return globalThis.process` -> undefined (vm-Context)
- [ ] `const r = (function(){return this})(); return typeof r.require` -> "undefined"
- [ ] `return Reflect.get(globalThis, String.fromCharCode(112,114,111,99,101,115,115))` -> ReferenceError: "Reflect is not defined" (L-5: Reflect bewusst nicht im VM-Context)
- [ ] `const g = globalThis; g['req'+'uire']` -> undefined (kein require im Context)
- [ ] `return typeof Object.create` -> "function" (M-4: volles Object verfuegbar)
- [ ] `return typeof Object.defineProperty` -> "function" (M-4: npm-Kompatibilitaet)
- [ ] `return new Uint8Array([1,2,3]).length` -> 3 (L-3: TypedArrays verfuegbar)
- [ ] `return typeof ArrayBuffer` -> "function" (L-3: binaere Daten)
- [ ] Code mit Backticks: `` const x = `hello`; return x; `` -> "hello" (L-4: Template-Injection gefixt)
- [ ] `return typeof Buffer` -> "undefined" (L-3: Buffer bewusst nicht exponiert)

### V2c: Resource-Limits (Audit H-2)
- [ ] Memory-Bombe (`const a=[]; while(true) a.push(new ArrayBuffer(1024*1024*10))`) -> Worker crasht (OOM), Plugin bleibt reaktiv
- [ ] Naechster `evaluate_expression` Call nach OOM-Crash -> Worker respawnt erfolgreich

### V2d: Race Condition Guard (Audit M-3)
- [ ] Zwei parallele `evaluate_expression` Calls -> nur ein Worker-Prozess erzeugt

### V3: configDir-Allowlist (Shai Hulud) + Write-Size (Audit M-1, M-2, L-2)
- [ ] `vault.write('.obsidian/plugins/evil/main.js', 'x')` -> Error: "Sandbox write blocked"
- [ ] `vault.write('.obsidian/app.json', '{}')` -> Error: "Sandbox write blocked"
- [ ] `vault.write('.obsidian/snippets/evil.css', 'x')` -> Error: "Sandbox write blocked"
- [ ] `vault.write('.obsidian/core-plugins/graph.json', '{}')` -> Error: "Sandbox write blocked"
- [ ] `vault.write('notes/test.md', 'ok')` -> erlaubt
- [ ] `vault.write('notes/big.md', 'x'.repeat(11_000_000))` -> Error: "Write too large"
- [ ] `vault.writeBinary('attachments/ok.png', <5MB ArrayBuffer>)` -> erlaubt
- [ ] `vault.read('.obsidian/plugins/obsilo-agent/manifest.json')` -> erlaubt

### V4: Mobile-Fallback
- [ ] `sandboxMode: 'iframe'` -> IframeSandboxExecutor gewaehlt
- [ ] evaluate_expression funktioniert identisch wie bisher

### V5: Lifecycle
- [ ] Plugin-Unload beendet Child-Process (kein Zombie)
- [ ] Plugin-Reload startet neuen Worker on-demand

### V6: Regression
- [ ] DynamicToolFactory funktioniert
- [ ] CodeModuleCompiler Dry-Run funktioniert
- [ ] SelfAuthoredSkillLoader registriert Code-Module
- [ ] ManageSkillTool erstellt Skills mit Code-Modulen

### V7: Review-Bot-Compliance
- [ ] Kein `console.log()` / `console.info()`
- [ ] Kein `fetch()`
- [ ] Kein `innerHTML`
- [ ] Kein `any`-Typ
- [ ] Keine floating Promises
- [ ] `require()` mit eslint-disable + Reason
- [ ] `vault.configDir` statt hardcoded `.obsidian`

---

## 9. Audit-Finding-Traceability

Rueckverfolgung aller Audit-Findings aus dem Security-Audit Rev 2 (2026-03-03):

| Finding | Severity | Status | Phase | Aenderung |
|---------|----------|--------|-------|-----------|
| H-1: Worker ohne Scope-Isolation | Critical | **Adressiert** | 2.1 | `vm.createContext()` statt `new Function()` |
| H-2: Fehlende Memory-Limits | High | **Adressiert** | 2.2 | `--max-old-space-size=128` in `execArgv` |
| M-1: `snippets/` nicht geschuetzt | Medium | **Adressiert** | 4.1 | Allowlist statt Blocklist -- alle `configDir/` Writes blockiert |
| M-2: Keine Write-Size-Limits | Medium | **Adressiert** | 4.2 | `MAX_WRITE_SIZE = 10 MB` Check |
| M-3: `ensureReady()` Race Condition | Medium | **Adressiert** | 2.2 | Explizites `readyPromise`-Pattern |
| L-1: IPC-Message-Validierung | Low | **Adressiert** | 2.2 | `isValidWorkerMessage()` Type-Guard |
| L-2: Blocklist statt Allowlist | Low | **Adressiert** | 4.1 | Pauschal-Block aller `configDir/` Writes |
| Info-1: Review-Bot child_process | Info | **Dokumentiert** | 6, 7 | Rollback-Strategie vorbereitet |
| M-4: Object.freeze vor createContext | Medium | **Adressiert** | 2.1 | Freeze NACH `createContext()`, volles `Object` statt Subset |
| L-3: Buffer-Alternative fehlt | Low | **Adressiert** | 2.1 | `Uint8Array`, `ArrayBuffer`, `DataView` + weitere TypedArrays in VM-Allowlist |
| L-4: Template-Injection in wrappedCode | Low | **Adressiert** | 2.1 | `new Function()` im vm-Context + `JSON.stringify(code)` per String-Concatenation |
| M-5: Object.freeze vs. `__CODE__` Assignment | Medium | **Adressiert** | 2.1 | String-Concatenation statt Context-Property. Kein `vmContext.__CODE__`, kein `delete`. |
| L-5: Reflect Test-Erwartung falsch | Low | **Adressiert** | 8 (V2b) | Test erwartet jetzt `ReferenceError` statt `undefined`. Reflect bewusst nicht im Context. |
| Info-2: esbuild Zeilenreferenzen | Info | **Korrigiert** | 3 | Zeilen 158->159, 160-165->161-166, 144->149 korrigiert |
