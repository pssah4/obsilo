# Feature-Spezifikation: Sandbox OS-Level Process Isolation

**Datum**: 2026-03-02
**Revision**: 1
**Status**: Implementiert
**Abhaengigkeit**: Bestehende Sandbox-Infrastruktur (FEATURE-self-development.md Phase 3)
**ADR**: ADR-021-sandbox-os-isolation.md
**Bezug**: AUDIT-obsilo-2026-03-01.md, Finding H-1 (CWE-693)

---

## 1. Ueberblick

### Problem

Die aktuelle iframe-Sandbox (`sandbox="allow-scripts"`) bietet in Electrons Renderer nur V8-Origin-Isolation -- eine logische Grenze im gleichen Prozess mit shared address space. Bei `nodeIntegration: true` koennte ein V8-Exploit theoretisch aus der iframe-Sandbox ausbrechen und vollen Node.js-Zugriff erlangen (Spectre/Meltdown, V8 Use-After-Free).

### Loesung

Migration der Code-Ausfuehrung von iframe-basiert zu `child_process.fork()`-basiert auf Desktop. Der Kindprozess laeuft als eigenstaendiger OS-Prozess mit `ELECTRON_RUN_AS_NODE=1` -- eigener V8-Heap, eigener Event-Loop, kein Zugriff auf Electron oder Obsidian APIs. Kommunikation ausschliesslich ueber Node.js IPC.

### Hybrid-Architektur

```
                    ISandboxExecutor (Interface)
                   /                            \
    ProcessSandboxExecutor               IframeSandboxExecutor
    (Desktop: child_process.fork)        (Mobile: iframe sandbox)
           |                                    |
    sandbox-worker.js                    sandboxHtml.ts
    (eigener OS-Prozess)                (iframe srcdoc)
           |                                    |
    Node.js IPC                          postMessage
           \                                   /
            +--- SandboxBridge (identisch) ---+
                    |           |
             Vault Access   URL Allowlist
             Rate Limits    Circuit Breaker
```

Mobile (iOS/Android) hat kein `child_process` -- dort bleibt die iframe-Sandbox als Fallback.

---

## 2. Security-Architektur

### 2.1 Vergleich der Isolations-Ebenen

| Eigenschaft | iframe sandbox (Mobile) | child_process.fork (Desktop) |
|---|---|---|
| **Isolation** | V8 Origin (logisch, same-process) | **OS-Level Prozess** |
| **Speicher** | Shared address space | **Separate Heaps** |
| **Spectre/Meltdown** | Verwundbar | **Geschuetzt (eigener Prozess)** |
| **V8-Exploit** | Durchbricht Sandbox -> Node.js | **Crash im eigenen Prozess** |
| **Crash-Isolation** | Kann Parent beeinflussen | **Komplett isoliert** |
| **CPU-Isolation** | Teilt Event Loop | **Eigener Event Loop** |
| **IPC** | postMessage (Chromium) | process.send/on (Node.js) |

### 2.2 Defense-in-Depth (6 Schichten)

| Schicht | Mechanismus | Primaer/Sekundaer |
|---------|------------|-------------------|
| 1. OS-Prozess-Grenze | `child_process.fork()` mit `ELECTRON_RUN_AS_NODE=1` | **Primaer** |
| 2. Code-Scope-Einschraenkung | `new Function('exports', 'vault', 'requestUrl', code)` | Sekundaer |
| 3. AstValidator | Blockiert `process`, `require`, `child_process`, `globalThis` im Source | Sekundaer |
| 4. SandboxBridge | Pfad-Validierung, URL-Allowlist, Rate-Limiting, Circuit Breaker | Sekundaer |
| 5. User Approval | evaluate_expression erfordert explizite Freigabe | UX |
| 6. Audit Trail | OperationLogger zeichnet alle Ausfuehrungen auf | Monitoring |

### 2.3 Warum `new Function()` statt `vm.runInNewContext()`

Im Worker-Prozess wird Code via `new Function()` ausgefuehrt (identisch zum iframe-Ansatz):

- `vm.runInNewContext()` hat Promise-Realm-Probleme: async/await funktioniert nicht sauber cross-realm (verschiedene Promise-Konstruktoren)
- Die OS-Prozess-Grenze ist die primaere Sicherheitsbarriere
- AstValidator blockt gefaehrliche Patterns bereits vor Compilation
- `new Function()` ist getestet und bewaehrt im iframe-Kontext

### 2.4 Zukunft: Node.js Permission Model

Sobald Obsidian auf Electron 41+ (Node.js 23+) wechselt, kann der Kindprozess zusaetzlich mit `--permission` Flags gestartet werden:

```typescript
spawn(process.execPath, [
    '--permission',
    '--allow-fs-read=' + vaultPath,
    'sandbox-worker.js'
], { env: { ELECTRON_RUN_AS_NODE: '1' } });
```

Aktuelle Obsidian-Versionen liefern Node.js 20.18-22.20 -- Permission Model erst ab 23.5 stabil.

---

## 3. Architektur

### 3.1 ISandboxExecutor Interface

```typescript
export interface ISandboxExecutor {
    ensureReady(): Promise<void>;
    execute(compiledJs: string, input: Record<string, unknown>): Promise<unknown>;
    destroy(): void;
}
```

Beide Backends implementieren dieses Interface. Konsumenten (EvaluateExpressionTool, DynamicToolFactory, etc.) arbeiten nur gegen das Interface.

### 3.2 ProcessSandboxExecutor (Desktop)

- **Spawn:** `child_process.fork()` mit `ELECTRON_RUN_AS_NODE=1`, `stdio: ['pipe','pipe','pipe','ipc']`
- **Worker-Pfad:** `path.join(__dirname, 'sandbox-worker.js')` -- `__dirname` zeigt auf `.obsidian/plugins/obsilo-agent/`
- **Lazy Init:** Worker wird erst beim ersten Aufruf gestartet (~300-3000ms auf macOS), dann dauerhaft am Leben gehalten
- **IPC-Protokoll:** Identische Message-Typen wie iframe-Sandbox (execute, result, error, vault-read, vault-write, request-url)
- **Timeout:** 30s pro Execution, 15s pro Bridge-Call
- **Crash-Recovery:** Bei Worker-Exit werden alle Pending rejected, Respawn beim naechsten Aufruf (max 3x)
- **Destroy:** SIGTERM + 2s SIGKILL-Fallback bei Plugin-Unload

### 3.3 IframeSandboxExecutor (Mobile-Fallback)

Identisch zur bisherigen `SandboxExecutor`-Implementierung. Nur umbenannt und mit `implements ISandboxExecutor`.

### 3.4 Factory

```typescript
import { Platform } from 'obsidian';

export function createSandboxExecutor(plugin: ObsidianAgentPlugin): ISandboxExecutor {
    if (Platform.isDesktop) return new ProcessSandboxExecutor(plugin);
    return new IframeSandboxExecutor(plugin);
}
```

### 3.5 sandbox-worker.ts

Kompiliert als separater esbuild Entry Point zu `sandbox-worker.js`. Deployed neben `main.js`.

```
Obsidian Renderer (Plugin)
    |
    | child_process.fork() + IPC
    | env: { ELECTRON_RUN_AS_NODE: '1' }
    |
    v
sandbox-worker.js (eigener OS-Prozess)
    - Frozen bridge proxies (vault, requestUrl)
    - new Function() fuer Code-Execution
    - process.send() / process.on('message') fuer IPC
    - Kein Electron, kein DOM, kein Obsidian API
```

### 3.6 Build-Konfiguration

Zweiter esbuild-Context in `esbuild.config.mjs`:

```javascript
const workerContext = await esbuild.context({
    entryPoints: ["src/core/sandbox/sandbox-worker.ts"],
    bundle: true,
    external: [...builtins],
    format: "cjs",
    platform: "node",
    outfile: "sandbox-worker.js",
});
```

vault-deploy Plugin kopiert `sandbox-worker.js` neben `main.js`.

---

## 4. IPC-Protokoll

### 4.1 Parent -> Worker

```typescript
| { type: 'execute'; id: string; code: string; input: Record<string, unknown> }
| { callId: string; result: unknown }     // Bridge-Response
| { callId: string; error: string }       // Bridge-Error
```

### 4.2 Worker -> Parent

```typescript
| { type: 'sandbox-ready' }
| { type: 'result'; id: string; value: unknown }
| { type: 'error'; id: string; message: string }
| { type: 'vault-read'; callId: string; path: string }
| { type: 'vault-read-binary'; callId: string; path: string }
| { type: 'vault-list'; callId: string; path: string }
| { type: 'vault-write'; callId: string; path: string; content: string }
| { type: 'vault-write-binary'; callId: string; path: string; content: ArrayBuffer }
| { type: 'request-url'; callId: string; url: string; options?: { method?: string; body?: string } }
```

Identisch zum bestehenden postMessage-Protokoll in `SandboxExecutor.ts` / `sandboxHtml.ts`.

---

## 5. Abgrenzung

### Was aendert sich

- Neue Dateien: ISandboxExecutor, ProcessSandboxExecutor, sandbox-worker.ts, createSandboxExecutor
- Rename: SandboxExecutor -> IframeSandboxExecutor
- Import-Migration: 9 Consumer-Dateien (nur Typ-Aenderung)
- Build: Zweiter esbuild Entry Point + Deploy

### Was aendert sich NICHT

- SandboxBridge (identisch fuer beide Backends)
- sandboxHtml.ts (weiterhin fuer Mobile-Fallback)
- AstValidator (Validierung vor Compilation, backend-unabhaengig)
- EsbuildWasmManager (Compilation ist unabhaengig vom Execution-Backend)
- EvaluateExpressionTool (Interface bleibt gleich)
- Alle anderen 28+ Tools, UI, Provider, AgentTask

---

## 6. Key Files

| Datei | Rolle |
|-------|-------|
| `src/core/sandbox/ISandboxExecutor.ts` | Gemeinsames Interface |
| `src/core/sandbox/ProcessSandboxExecutor.ts` | Desktop-Backend (child_process.fork) |
| `src/core/sandbox/sandbox-worker.ts` | Worker-Script (eigener OS-Prozess) |
| `src/core/sandbox/createSandboxExecutor.ts` | Platform-basierte Factory |
| `src/core/sandbox/IframeSandboxExecutor.ts` | Mobile-Fallback (ex SandboxExecutor) |
| `src/core/sandbox/SandboxBridge.ts` | Security-Gatekeeper (unveraendert) |
| `esbuild.config.mjs` | Zweiter Build-Context |

---

## 7. Akzeptanzkriterien

- [ ] Desktop: evaluate_expression laeuft in separatem OS-Prozess (verifizierbar via PID)
- [ ] Desktop: Vault-Bridge-Operationen (read, write, list) funktionieren ueber IPC
- [ ] Desktop: requestUrl-Bridge funktioniert ueber IPC (Allowlist)
- [ ] Desktop: Dependencies (npm-Pakete) werden korrekt gebundelt und ausgefuehrt
- [ ] Desktop: Timeout nach 30s bei haengender Execution
- [ ] Desktop: Worker-Crash fuehrt zu Respawn beim naechsten Aufruf
- [ ] Desktop: Plugin-Unload beendet Worker-Prozess sauber (kein Zombie)
- [ ] Mobile: Automatischer Fallback auf iframe-Sandbox
- [ ] Build: main.js + sandbox-worker.js werden erzeugt und deployed
- [ ] Review-Bot: Kein console.log, kein fetch, kein innerHTML, kein any
- [ ] Regression: DynamicToolFactory, CodeModuleCompiler, SelfAuthoredSkillLoader funktionieren

---

## 8. Bekannte Limitierungen

1. **Mobile:** Kein child_process auf iOS/Android. iframe-Sandbox als Fallback.
2. **First-Spawn-Latenz:** ~300-3000ms auf macOS bei signierten Apps. Mitigiert durch Keep-Alive.
3. **Worker hat Node.js:** Der Kindprozess hat vollen Node.js-Zugriff. AstValidator + new Function() als Defense-in-Depth.
4. **Permission Model:** Node.js `--permission` Flags erst ab Node 23.5. Obsidian liefert aktuell Node 20-22.
5. **Separater Build-Output:** sandbox-worker.js muss neben main.js deployed werden. Erhoet Deployment-Komplexitaet.

---

## 9. Konkrete Bedrohungsszenarien

### 9.1 Was iframe-Sandbox NICHT blocken kann

Die iframe-Sandbox bietet **V8-Origin-Isolation** (logische Grenze im gleichen Prozess), aber **KEINE OS-Level-Isolation**. Folgende Angriffe sind theoretisch moeglich:

#### A. Memory-Disclosure via Side-Channel (Spectre/Meltdown)

**Angriff:** Code misst Timing-Unterschiede beim Speicherzugriff, um Speicher des Parent-Prozesses auszulesen.

**iframe-Sandbox:** ✗ Blockiert NICHT (shared address space)
**child_process.fork:** ✓ Blockiert (eigener Heap, keine shared memory)

**Realistisch:** Sehr gering. Erfordert V8-JIT-Optimierungen + Browser-spezifische Implementierungsdetails.

#### B. CPU-Denial-of-Service (Endlosschleife)

**Angriff:** `while(true) {}` blockiert den Event Loop.

**iframe-Sandbox:** ✗ Teilt Event Loop mit Plugin/Obsidian (kann UI einfrieren)
**child_process.fork:** ✓ Eigener Event Loop (Plugin unbeeintraechtigt)

**Realistisch:** Hoch. Wird durch Timeout (30s) begrenzt, aber UI bleibt bis Timeout reaktionslos.

#### C. V8 Use-After-Free Exploit

**Angriff:** Schwachstelle in V8 Engine (CVE-2024-XXXXX) erlaubt Arbitrary Code Execution.

**iframe-Sandbox:** ✗ Exploit kann aus Sandbox ausbrechen -> Node.js-Zugriff
**child_process.fork:** ✓ Exploit crasht nur Worker-Prozess, Plugin laeuft weiter

**Realistisch:** Gering. Erfordert 0-Day in V8, aber Chromium-Exploits existieren.

#### D. Shai Hulud Szenario (Self-Replicating Malware)

**Angriff:** Code schreibt sich selbst in `.obsidian/plugins/malicious-plugin/main.js`, wird beim naechsten Start geladen.

**iframe-Sandbox:** ✗ ctx.vault.write() ist erlaubt -> Persistenz moeglich
**child_process.fork:** ✗ ctx.vault.write() ebenfalls erlaubt -> Persistenz moeglich

**Realistisch:** Mittel. **Beide Sandboxes bieten keinen Schutz gegen Persistenz via Vault-Write**. Mitigation:
- SandboxBridge validiert Pfade (blockt `.obsidian/plugins/*`)
- User Approval erforderlich fuer jede Execution
- Audit Trail loggt alle Vault-Writes

**WICHTIG:** OS-Level-Isolation schuetzt NICHT gegen Vault-Manipulation, da `ctx.vault` absichtlich Zugriff gewaehrt. Die Sicherheit haengt von SandboxBridge-Validierung + User Approval ab.

### 9.2 Defense-in-Depth Zusammenfassung

| Bedrohung | iframe | child_process.fork | Mitigation |
|-----------|--------|-------------------|------------|
| Spectre/Meltdown | ✗ | ✓ | OS-Prozess-Grenze |
| CPU-DoS | ✗ | ✓ | Eigener Event Loop + Timeout |
| V8-Exploit | ✗ | ✓ | Crash-Isolation |
| Vault-Persistenz | ✗ | ✗ | SandboxBridge Pfad-Validierung + User Approval |

---

## 10. User-facing Kommunikation

### 10.1 Permission-Text Guidance

**Problem:** User muessen verstehen, was sie genehmigen und welche Risiken bestehen.

**Loesung:** Klare, mehrstufige Kommunikation:

#### Stufe 1: Tool-Label (kurz)
```
Execute Code
```

#### Stufe 2: Tool-Description (technisch korrekt)
```
Execute JavaScript/TypeScript code in a sandboxed environment.
Provides ctx.vault (full read/write/delete access to all vault files)
and ctx.requestUrl (HTTP requests).
```

#### Stufe 3: When-to-Use (mit Sicherheitshinweis)
```
For one-off computations or binary file generation.
IMPORTANT: Code runs with full vault access and internet access.
The sandbox provides isolation via iframe (same-origin policy, CSP),
but is NOT OS-level process isolation.
Only execute code you understand.
```

#### Stufe 4: Common-Mistakes (Security-Warnung)
```
SECURITY: Never execute untrusted code or code from external sources
without review.
```

### 10.2 Approval-Dialog-Text (UI)

**Aktueller Text:**
> "Evaluate (Sandbox) - sandbox nicht aktiviert"

**Verbesserter Text:**
> **Code ausfuehren (JavaScript/TypeScript)**
>
> Der Agent moechte Code ausfuehren mit folgenden Zugriffen:
> - ✓ Lesen/Schreiben/Loeschen aller Vault-Dateien
> - ✓ HTTP-Anfragen an externe URLs
>
> Sicherheit:
> - Code laeuft in isoliertem Prozess (Desktop) oder iframe (Mobile)
> - Execution wird nach 30 Sekunden abgebrochen
> - Alle Operationen werden im Audit-Log aufgezeichnet
>
> **Fuehren Sie nur Code aus, dessen Funktion Sie verstehen.**

**Implementierung:** Erfordert Anpassung in `src/ui/approval/ApprovalModal.ts`.

### 10.3 Settings-Beschreibung

**Empfohlen fuer Settings > Permissions:**
> **Code Execution (Sandbox)**
>
> Erlaubt dem Agent, JavaScript/TypeScript-Code auszufuehren (z.B. fuer PDF-Generierung oder Datenanalyse).
>
> - Desktop: Code laeuft in separatem OS-Prozess (sichere Isolation)
> - Mobile: Code laeuft in iframe-Sandbox (V8-Origin-Isolation)
>
> Code hat Zugriff auf:
> - Alle Dateien im Vault (lesen, schreiben, loeschen)
> - HTTP-Anfragen (konfigurierbare URL-Allowlist)
>
> **Empfehlung:** Nur aktivieren, wenn Sie die Funktionsweise verstehen.

---

## 11. Rollback-Strategie

### 11.1 Szenarien fuer Rollback

1. **First-Spawn-Latenz inakzeptabel:** >5s auf User-Systemen
2. **Worker-Crash-Loop:** Kind-Prozess crashed bei jedem Start (3x Retry-Limit erreicht)
3. **IPC-Deadlock:** Race-Condition zwischen Parent/Worker
4. **Review-Bot-Ablehnung:** Community Plugin Review lehnt child_process ab

### 11.2 Rollback-Mechanismus

**A. Feature-Flag (empfohlen)**

Neue Setting in `src/types/settings.ts`:

```typescript
export interface SandboxSettings {
    mode: 'auto' | 'process' | 'iframe';
    // 'auto': Platform.isDesktop ? process : iframe
    // 'process': Force ProcessSandboxExecutor (Desktop-only)
    // 'iframe': Force IframeSandboxExecutor (alle Platformen)
}
```

Factory aendert sich zu:

```typescript
export function createSandboxExecutor(plugin: ObsidianAgentPlugin): ISandboxExecutor {
    const mode = plugin.settings.sandbox.mode;
    if (mode === 'iframe') return new IframeSandboxExecutor(plugin);
    if (mode === 'process' && Platform.isDesktop) return new ProcessSandboxExecutor(plugin);
    // auto:
    if (Platform.isDesktop) return new ProcessSandboxExecutor(plugin);
    return new IframeSandboxExecutor(plugin);
}
```

User kann in Settings auf `mode: 'iframe'` umschalten, falls child_process Probleme macht.

**B. Build-Zeit-Rollback (falls Review-Bot blockiert)**

Kommentiere in `createSandboxExecutor.ts` aus:

```typescript
export function createSandboxExecutor(plugin: ObsidianAgentPlugin): ISandboxExecutor {
    // ROLLBACK: child_process disabled due to review feedback
    // if (Platform.isDesktop) return new ProcessSandboxExecutor(plugin);
    return new IframeSandboxExecutor(plugin);
}
```

Entferne `sandbox-worker.js` aus `esbuild.config.mjs` + Deploy-Script.

**C. Monitoring-Trigger**

OperationLogger erfasst:
- Worker-Spawn-Zeit (first + subsequent)
- Worker-Crash-Count
- IPC-Timeout-Count

Falls Worker-Crash-Rate >10% in 24h: Notice an User mit Empfehlung zu `mode: 'iframe'`.

### 11.3 Rollback-Timeline

| Phase | Action | Timeline |
|-------|--------|----------|
| 1. Detection | Monitoring erkennt Problem (Crash-Loop, Latenz >5s) | Immediate |
| 2. User Notice | Settings-Notice empfiehlt Rollback | +1 Minute |
| 3. User Action | User waehlt `mode: 'iframe'` in Settings | User-gesteuert |
| 4. Fallback | Plugin nutzt IframeSandboxExecutor | Sofort nach Reload |
| 5. Issue Filed | GitHub Issue mit Diagnostics | +1 Tag |
| 6. Build Rollback | Falls nicht loesbar: Build-Zeit-Deaktivierung | Hotfix Release |

---

## 12. Performance-Benchmarks

### 12.1 Messkriterien

| Metrik | Ziel | Kritisch bei |
|--------|------|--------------|
| First-Spawn-Latenz | <1s | >3s |
| Subsequent-Spawn-Latenz | <50ms | >500ms |
| Execution-Overhead vs. iframe | <10% | >50% |
| Memory-Overhead (Worker) | <50MB | >200MB |
| IPC-Roundtrip-Latenz | <5ms | >50ms |

### 12.2 Messverfahren

**Test-Setup:**
- macOS 14.x, Obsidian 1.7.7, M1 Pro
- Vault: ~1000 Notizen, 10MB total
- Code: `return 1+1` (minimal execution)

**Messung:**

```typescript
// First-Spawn
const start = Date.now();
await executor.ensureReady();
const firstSpawn = Date.now() - start;

// Subsequent-Execution
const execStart = Date.now();
await executor.execute('return 1+1', {});
const execTime = Date.now() - execStart;

// Memory
const workerPid = executor.getWorkerPid();
const mem = process.memoryUsage.rss; // via IPC message
```

**Baseline (iframe-Sandbox):**
- First-Spawn: ~5ms (srcdoc creation)
- Execution: ~2ms
- Memory: ~30MB (shared with Parent)

**Ziel (child_process.fork):**
- First-Spawn: <1000ms (acceptable for Keep-Alive)
- Execution: <10ms (±5ms overhead)
- Memory: <80MB (50MB Worker + 30MB Parent)

### 12.3 Performance-Regression-Tests

Neuer Test in `tests/sandbox/performance.test.ts`:

```typescript
test('ProcessSandboxExecutor meets latency targets', async () => {
    const executor = new ProcessSandboxExecutor(plugin);
    const start = Date.now();
    await executor.ensureReady();
    const firstSpawn = Date.now() - start;
    expect(firstSpawn).toBeLessThan(3000); // Critical threshold

    const execStart = Date.now();
    await executor.execute('return 1+1', {});
    const execTime = Date.now() - execStart;
    expect(execTime).toBeLessThan(50); // Overhead target
});
```

**CI-Integration:** Performance-Tests laufen auf jeder PR. Warnung bei Regression >20%.

---

## 13. Migration & Testing

### 13.1 Migrations-Pfad

**Phase 1: Vorbereitung**
- ISandboxExecutor Interface erstellen
- IframeSandboxExecutor (Rename von SandboxExecutor)
- Factory mit Feature-Flag (`mode: 'auto'`)

**Phase 2: ProcessSandboxExecutor**
- sandbox-worker.ts implementieren
- ProcessSandboxExecutor implementieren
- Build-Konfiguration (zweiter Entry Point)

**Phase 3: Testing**
- Unit-Tests (beide Executors)
- Integration-Tests (DynamicToolFactory, CodeModuleCompiler)
- Performance-Tests (Latenz, Memory)

**Phase 4: Rollout**
- Beta-Release mit `mode: 'auto'`
- Monitoring aktivieren (OperationLogger)
- 2 Wochen Feedback-Phase

**Phase 5: Stabilisierung**
- Falls Probleme: Rollback via `mode: 'iframe'`
- Sonst: Default bleibt `mode: 'auto'`

### 13.2 Test-Matrix

| Test | IframeSandboxExecutor | ProcessSandboxExecutor |
|------|----------------------|------------------------|
| Basic Execution | ✓ | ✓ |
| ctx.vault.read() | ✓ | ✓ |
| ctx.vault.write() | ✓ | ✓ |
| ctx.vault.writeBinary() | ✓ | ✓ |
| ctx.requestUrl() | ✓ | ✓ |
| Dependencies (npm) | ✓ | ✓ |
| Timeout (30s) | ✓ | ✓ |
| Worker-Crash-Recovery | N/A | ✓ |
| Plugin-Unload-Cleanup | ✓ | ✓ |
| Performance (<1s First-Spawn) | ✓ | ✓ |
