# Analyse: Sandbox-Isolation -- Von iframe zu OS-Level Prozess-Sandbox

| Feld | Wert |
|------|------|
| **Bezug** | AUDIT-obsilo-2026-03-01.md, Finding H-1 |
| **Datum** | 2026-03-02 |
| **Urspruengliche Option** | "Langfristig: Electron BrowserWindow mit sandbox: true + IPC evaluieren" |
| **Ergebnis** | BrowserWindow verworfen. **Bessere Alternative gefunden: `child_process.fork()`** |

---

## 1. Kontext

Finding H-1 des Security Audits identifiziert die Chromium-Sandbox-Limitierung in Electron (CWE-693): Obsidians Renderer hat `nodeIntegration: true` und `contextIsolation: false`. Die aktuelle iframe-Sandbox (`sandbox="allow-scripts"`) bietet V8-Origin-Isolation, aber keine OS-Level-Prozess-Isolation. Ein V8-Exploit koennte theoretisch aus der iframe-Sandbox ausbrechen und Node.js-Zugriff erlangen.

Diese Analyse bewertet alle verfuegbaren Wege zu OS-Level-Isolation innerhalb der Obsidian-Plugin-Architektur.

---

## 2. Evaluierte Ansaetze

### 2.1 BrowserWindow mit sandbox: true -- VERWORFEN

Ein `BrowserWindow` mit `sandbox: true` erzeugt einen eigenstaendigen Chromium Renderer-Prozess mit Betriebssystem-Level Sandboxing (Windows: Untrusted Integrity Level, macOS: sandbox_init(), Linux: Seccomp-BPF).

**3 harte Blocker:**

1. **Main-Prozess-API:** `BrowserWindow` kann nur im Main-Prozess instanziiert werden. Obsidian Plugins laufen im Renderer. Der einzige Weg waere `@electron/remote` -- deprecated seit Electron 14, keine API-Garantie, kann bei jedem Obsidian-Update entfallen.

2. **IPC erfordert Main-Prozess-Handler:** `ipcMain.handle()` / `ipcRenderer.invoke()` setzt Main-Prozess-Registrierung voraus. Ein Plugin kann keine Main-Prozess-Handler registrieren. Der MessageChannel-Workaround erfordert ebenfalls `remote`.

3. **Kein Praezedenzfall:** Kein Community Plugin erstellt ein eigenes BrowserWindow. Selbst `electron-window-tweaker` beschraenkt sich auf `getCurrentWindow()`. Hohes Review-Ablehnungsrisiko.

### 2.2 Electron utilityProcess -- NICHT VERFUEGBAR

`utilityProcess.fork()` (seit Electron 22) ist exklusiv eine Main-Prozess-API. Ein Renderer-Prozess hat keinen Zugriff darauf. Obsidian exponiert keine API dafuer.

### 2.3 `<webview>` Tag -- NICHT EMPFOHLEN

Laeuft als Out-of-Process iframe (OOPIF) in eigenem Renderer-Prozess. Obsidian Surfing nutzt es erfolgreich.

**Gegen:**
- Electron-Team empfiehlt aktiv die Abkehr ("dramatic architectural changes")
- Obsidian hat Webview-Zugriff ab v1.8 eingeschraenkt
- Kein Electron auf Mobile
- Review-Risiko fuer Code-Execution-Kontext

### 2.4 Web Workers -- KEIN SICHERHEITSGEWINN

Thread-Level Isolation (eigener Thread, eigene V8-Isolate). Aber: gleicher Prozess, gleicher Adressraum. Schuetzt vor UI-Blocking, nicht vor Memory-Access-Attacken. Kein Sicherheitsgewinn gegenueber iframe-Sandbox.

### 2.5 Node.js worker_threads -- NICHT MOEGLICH

Native `worker_threads` funktionieren im Electron Renderer-Prozess nicht. Nur im Main-Prozess verfuegbar. Web Workers mit `nodeIntegrationInWorker` waeren moeglich, haben aber dieselben Limitierungen wie Punkt 2.4.

### 2.6 Node.js vm Modul -- SICHERHEITS-DOWNGRADE

Die Node.js-Dokumentation warnt explizit: "The node:vm module is not a security mechanism. Do not use it to run untrusted code." Triviale Escapes existieren ueber `this.constructor.constructor("return process")()`. Das wuerde ein Sicherheits-Downgrade gegenueber der aktuellen iframe-Sandbox sein.

### 2.7 child_process.fork() -- MACHBAR UND EMPFOHLEN

**Dies ist der ueberraschende Fund der vertieften Analyse.**

---

## 3. child_process.fork() -- Detailanalyse

### 3.1 Warum es funktioniert

Da Obsidian `nodeIntegration: true` setzt, hat jedes Plugin vollen Zugriff auf `require('child_process')`. Dies ist keine Theorie -- unser eigenes Projekt nutzt es bereits produktiv:

- **ExecuteRecipeTool** (`src/core/tools/agent/ExecuteRecipeTool.ts:17`) importiert `spawn` aus `child_process`
- **obsidian-git** (Community Plugin, 60k+ Downloads) nutzt `child_process` via SimpleGit seit Jahren
- Obsidian Forum bestaetigt: `child_process.exec()` funktioniert auf Desktop

### 3.2 Architektur

```
Obsidian Renderer (Plugin)
    |
    | child_process.fork() + eingebauter IPC-Kanal
    | env: { ELECTRON_RUN_AS_NODE: '1' }
    |
    v
Node.js Child Process (eigener OS-Prozess)
    - Eigener V8-Heap, eigener Event-Loop
    - KEIN Zugriff auf Electron APIs
    - KEIN Zugriff auf Obsidian APIs
    - Kommunikation ausschliesslich ueber IPC
    |
    | Fuehrt User-Code aus
    | Sendet Ergebnisse via process.send()
    |
    v
Isolierter Ausfuehrungskontext
```

`ELECTRON_RUN_AS_NODE=1` sorgt dafuer, dass der Kindprozess als reiner Node.js-Prozess startet -- kein Electron, kein Renderer, kein DOM.

### 3.3 Vergleich mit aktuellem iframe-Ansatz

| Eigenschaft | iframe sandbox (aktuell) | child_process.fork() |
|---|---|---|
| **Isolation** | V8 Origin (logisch, same-process) | **OS-Level Prozess** |
| **Speicher** | Shared address space | **Separate Heaps** |
| **Spectre/Meltdown** | Verwundbar (shared address space) | **Geschuetzt (eigener Prozess)** |
| **V8-Exploit** | Durchbricht Sandbox -> Node.js-Zugriff | **Crash im eigenen Prozess, kein Ausbruch** |
| **Crash-Isolation** | Kann Parent beeinflussen | **Komplett isoliert** |
| **CPU-Isolation** | Teilt Event Loop (async postMessage) | **Eigener Event Loop** |
| **Node.js im Sandbox** | Nicht verfuegbar | Verfuegbar (kontrolliert) |
| **IPC** | postMessage (Chromium) | process.send/on (Node.js, eingebaut) |
| **Abhaengigkeit** | Chromium iframe | Node.js child_process (stabil) |
| **Review-Bot** | OK | OK (Praezedenz: obsidian-git) |
| **Mobile** | Funktioniert (iframe) | Nicht verfuegbar (kein Node.js) |

### 3.4 Konkretes Pattern

```typescript
import { fork, ChildProcess } from 'child_process';
import path from 'path';

class ProcessSandbox {
    private worker: ChildProcess | null = null;

    async ensureReady(): Promise<void> {
        if (this.worker) return;

        // Einmalig starten, dauerhaft am Leben halten
        this.worker = fork(path.join(__dirname, 'sandbox-worker.js'), [], {
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
            stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        });

        // Warten auf Ready-Signal
        await new Promise<void>((resolve) => {
            this.worker!.once('message', (msg) => {
                if (msg.type === 'ready') resolve();
            });
        });
    }

    async execute(code: string, input: unknown): Promise<unknown> {
        await this.ensureReady();

        return new Promise((resolve, reject) => {
            const id = crypto.randomUUID();
            const timeout = setTimeout(() => {
                reject(new Error('Execution timeout'));
                this.worker?.kill('SIGKILL');
                this.worker = null;
            }, 30_000);

            const handler = (msg: { id: string; type: string; value?: unknown; error?: string }) => {
                if (msg.id !== id) return;
                this.worker?.off('message', handler);
                clearTimeout(timeout);
                if (msg.type === 'result') resolve(msg.value);
                else reject(new Error(msg.error));
            };

            this.worker!.on('message', handler);
            this.worker!.send({ type: 'execute', id, code, input });
        });
    }

    destroy(): void {
        this.worker?.kill();
        this.worker = null;
    }
}
```

### 3.5 IPC-Bridge fuer Vault-Zugriff

Analog zur aktuellen SandboxBridge, aber ueber Node.js IPC statt postMessage:

```typescript
// Plugin-Seite: Bridge-Requests vom Kindprozess behandeln
this.worker.on('message', async (msg) => {
    if (msg.type === 'vault-read') {
        const content = await this.plugin.app.vault.read(file);
        this.worker.send({ callId: msg.callId, result: content });
    }
    // ... weitere Bridge-Operationen
});
```

```typescript
// sandbox-worker.js: Bridge-Proxy fuer den User-Code
const vault = {
    read(path) {
        return bridgeCall('vault-read', { path });
    },
    write(path, content) {
        return bridgeCall('vault-write', { path, content });
    },
};

function bridgeCall(type, payload) {
    return new Promise((resolve, reject) => {
        const callId = nextCallId++;
        pending.set(callId, { resolve, reject });
        process.send({ type, callId, ...payload });
    });
}
```

### 3.6 Performance

**Erster Spawn:** ~300-3000ms auf macOS mit signierten Apps (Electron Issue #26143). Danach schneller.

**Mitigation:** Kindprozess beim Plugin-Start einmalig starten und dauerhaft am Leben halten. Erster `evaluate_expression`-Aufruf dann ohne Spawn-Overhead.

### 3.7 Node.js Permission Model -- Nicht verfuegbar (aktuell)

Das Node.js Permission Model (`--permission`, `--allow-fs-read`, `--allow-fs-write`) waere ideal fuer zusaetzliches OS-Level Filesystem-Sandboxing des Kindprozesses. Es ist stabil ab Node.js v23.5.

**Obsidians aktuelle Node.js-Versionen:**

| Obsidian | Electron | Node.js | Permission Model |
|----------|----------|---------|:---:|
| 1.8.x | 34 | v20.18 | Nein |
| 1.9.10+ | 37 | v22.16 | Nein |
| 1.11.x (Catalyst) | 39 | v22.20 | Nein |
| Zukuenftig | 41+ | v23.x+ | **Moeglich** |

**Aktuell nicht nutzbar.** Sobald Obsidian auf Electron 41+ (Node.js 23+) wechselt, koennte der Kindprozess zusaetzlich mit `--permission` Flags gestartet werden:

```typescript
spawn(process.execPath, [
    '--permission',
    '--allow-fs-read=' + vaultPath,
    'sandbox-worker.js'
], { env: { ELECTRON_RUN_AS_NODE: '1' } });
```

Bis dahin: Defense-in-Depth ueber AstValidator + SandboxBridge (Pfad-Validierung, URL-Allowlist, Rate-Limiting).

### 3.8 Limitierungen

1. **Mobile:** `child_process` ist auf Mobile (iOS/Android) nicht verfuegbar. Die iframe-Sandbox muss als Fallback erhalten bleiben.
2. **Kindprozess hat Node.js:** Anders als die iframe-Sandbox hat der Kindprozess vollen Node.js-Zugriff. User-Code muss innerhalb des Kindprozesses nochmals isoliert werden (z.B. via `new Function()` ohne globale Referenzen).
3. **Preload-Script als Datei:** `fork()` erwartet einen Dateipfad. Das Worker-Script muss als separate Datei im Plugin-Verzeichnis liegen, nicht im Bundle.
4. **Process Cleanup:** Kindprozesse muessen bei Plugin-Unload sauber beendet werden (`plugin.onunload()`).

---

## 4. Empfohlene Architektur: Hybrid-Ansatz

Da Mobile kein `child_process` unterstuetzt, empfiehlt sich ein Hybrid-Ansatz:

```
Desktop (Electron):
    evaluate_expression -> ProcessSandbox (child_process.fork)
        - OS-Level Prozess-Isolation
        - Node.js IPC
        - SandboxBridge fuer Vault-Zugriff

Mobile (iOS/Android):
    evaluate_expression -> SandboxExecutor (iframe sandbox, wie bisher)
        - V8 Origin Isolation
        - postMessage IPC
        - SandboxBridge fuer Vault-Zugriff
```

Beide Backends implementieren dasselbe Interface. Die SandboxBridge (Pfad-Validierung, URL-Allowlist, Rate-Limiting, Circuit Breaker) bleibt identisch.

---

## 5. Zusammenfassung

| Ansatz | OS-Level | Machbar | Stabil | Review-Bot | Mobile | Empfehlung |
|--------|:---:|:---:|:---:|:---:|:---:|---------|
| BrowserWindow sandbox:true | Ja | Fragil | Nein | Grauzone | Nein | **Verworfen** |
| utilityProcess | Ja | Nein | - | - | Nein | **Nicht verfuegbar** |
| `<webview>` Tag | Ja | Eingeschr. | Mittel | Grauzone | Nein | **Nicht empfohlen** |
| Node.js vm | Nein | Ja | Ja | OK | Nein | **Sicherheits-Downgrade** |
| worker_threads | Nein | Nein (Renderer) | - | - | Nein | **Nicht moeglich** |
| Web Workers | Nein | Ja | Ja | OK | Ja | **Kein Sicherheitsgewinn** |
| iframe sandbox (aktuell) | Nein | Ja | Ja | OK | Ja | **Fallback Mobile** |
| **child_process.fork()** | **Ja** | **Ja** | **Ja** | **OK** | **Nein** | **Empfohlen (Desktop)** |

---

## 6. Entscheidung

### BrowserWindow sandbox:true -- VERWORFEN

Erfordert Main-Prozess-Zugriff via deprecated `@electron/remote`. Nicht stabil, nicht zukunftssicher.

### child_process.fork() -- EMPFOHLEN als Langfrist-Upgrade

Bietet echte OS-Level Prozess-Isolation ohne Abhaengigkeit von deprecated APIs. Bereits im Projekt bewaehrt (`ExecuteRecipeTool`), Community-Praezedenz vorhanden (`obsidian-git`).

**Implementierung als Hybrid:**
- Desktop: `child_process.fork()` mit `ELECTRON_RUN_AS_NODE=1`
- Mobile: iframe sandbox (Fallback, wie bisher)
- Gemeinsame SandboxBridge fuer beide Backends

**Phasenplan:**
1. SandboxExecutor-Interface abstrahieren (Strategy Pattern)
2. ProcessSandbox implementieren (Desktop-Backend)
3. Runtime-Detection: Desktop vs. Mobile
4. Bestehende SandboxBridge wiederverwenden
5. Spaeter: Node.js `--permission` Flags wenn Obsidian auf Node 23+ wechselt

---

## 7. Auswirkung auf Finding H-1

Die Remediation-Zeile in H-1 sollte aktualisiert werden:

**Vorher:**
> Langfristig: Electron BrowserWindow mit sandbox: true + IPC evaluieren (Breaking Change)

**Nachher:**
> Langfristig: child_process.fork() mit ELECTRON_RUN_AS_NODE=1 als Desktop-Sandbox (OS-Level Prozess-Isolation). BrowserWindow-Ansatz evaluiert und verworfen -- siehe ANALYSE-electron-browserwindow-sandbox-2026-03-02.md. Hybrid mit iframe-Fallback fuer Mobile. Zusaetzlich: Node.js --permission Flags sobald Obsidian auf Node 23+ wechselt.
