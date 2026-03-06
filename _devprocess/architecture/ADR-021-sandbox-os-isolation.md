# ADR-021: OS-Level Sandbox via child_process.fork()

**Status:** Akzeptiert
**Datum:** 2026-03-02
**Entscheider:** Sebastian Hanke

---

## Kontext

Finding H-1 des Security Audits (AUDIT-obsilo-2026-03-01.md) identifiziert eine fundamentale Limitierung der aktuellen Sandbox-Architektur: Die iframe-Sandbox (`sandbox="allow-scripts"`) bietet in Electrons Renderer nur V8-Origin-Isolation -- eine logische Grenze im gleichen Prozess mit shared address space.

Obsidians Renderer laeuft mit `nodeIntegration: true` und `contextIsolation: false`. Ein V8-Exploit (Spectre/Meltdown, Use-After-Free) koennte theoretisch aus der iframe-Sandbox ausbrechen und vollen Node.js-Zugriff erlangen.

Die detaillierte Analyse (ANALYSE-electron-browserwindow-sandbox-2026-03-02.md) hat 7 Optionen evaluiert.

---

## Optionen

### Option 1: BrowserWindow mit sandbox: true

Electron BrowserWindow mit Chromium-OS-Sandbox.

- (+) Echte OS-Level Chromium-Sandbox
- (-) BrowserWindow ist Main-Prozess-API, Plugin laeuft im Renderer
- (-) Erfordert `@electron/remote` (deprecated seit Electron 14)
- (-) Kein Community-Praezedenzfall, hohes Review-Ablehnungsrisiko
- (-) Fragil: `@electron/remote` kann bei jedem Obsidian-Update entfallen

**Verworfen:** 3 harte Blocker (Main-Prozess, IPC, kein Praezedenzfall).

### Option 2: Electron utilityProcess

Electron Utility Process (seit Electron 22) mit OS-Level Isolation.

- (+) OS-Level Isolation, MessagePort-Kommunikation
- (-) Exklusiv Main-Prozess-API, kein Renderer-Zugriff

**Verworfen:** Nicht verfuegbar aus Plugin-Kontext.

### Option 3: `<webview>` Tag

Electron Webview laeuft als Out-of-Process iframe (eigener Renderer-Prozess).

- (+) OS-Level Isolation, Obsidian Surfing nutzt es erfolgreich
- (-) Electron-Team empfiehlt aktiv die Abkehr ("dramatic architectural changes")
- (-) Obsidian hat Webview-Zugriff ab v1.8 eingeschraenkt
- (-) Kein Electron auf Mobile

**Nicht empfohlen:** Abkuendigungs-Risiko.

### Option 4: Web Workers

Thread-Level Isolation innerhalb des gleichen Prozesses.

- (+) Stabil, Review-Bot-kompatibel
- (-) Gleicher Prozess, gleicher Adressraum -- kein Sicherheitsgewinn vs. iframe

**Verworfen:** Kein Sicherheitsgewinn.

### Option 5: Node.js vm Modul

V8-Kontexte via `vm.createContext()` / `vm.runInContext()`.

- (-) Node.js-Dokumentation warnt explizit: "not a security mechanism"
- (-) Triviale Escapes via `this.constructor.constructor("return process")()`
- (-) Waere ein Sicherheits-Downgrade gegenueber iframe-Sandbox

**Verworfen:** Sicherheits-Downgrade.

### Option 6: child_process.fork() (gewaehlt)

Eigenstaendiger Node.js-Kindprozess mit `ELECTRON_RUN_AS_NODE=1`.

- (+) **Echte OS-Level Prozess-Isolation** (eigener Heap, eigener Event-Loop)
- (+) Kein `@electron/remote` noetig -- rein ueber Node.js APIs
- (+) Crash-Isolation (Kind-Crash beeinflusst Plugin nicht)
- (+) Eingebauter IPC-Kanal (process.send/on)
- (+) Community-Praezedenz (obsidian-git, eigenes ExecuteRecipeTool)
- (+) Review-Bot-kompatibel (`child_process` nicht verboten)
- (+) Zukunftssicher (Node.js `--permission` Flags spaeter moeglich)
- (-) ~300-3000ms First-Spawn auf macOS (mitigiert durch Keep-Alive)
- (-) Separater Build-Output (sandbox-worker.js)
- (-) Nicht auf Mobile verfuegbar (Fallback noetig)

---

## Entscheidung

**Option 6: Hybrid mit child_process.fork() (Desktop) + iframe (Mobile)**

- Desktop: `child_process.fork()` mit `ELECTRON_RUN_AS_NODE=1` fuer OS-Level Prozess-Isolation
- Mobile: iframe-Sandbox (`sandbox="allow-scripts"`) als Fallback (kein child_process auf iOS/Android)
- Strategy Pattern: `ISandboxExecutor` Interface, zwei Implementierungen
- Factory: `createSandboxExecutor()` waehlt basierend auf `Platform.isDesktop`
- SandboxBridge bleibt unveraendert (beide Backends)
- Worker-Script als separater esbuild Entry Point (`sandbox-worker.js`)

---

## Konsequenzen

### Positiv

- Echte OS-Level-Isolation auf Desktop (eigener Prozess, eigener Heap)
- Crash-Isolation: Worker-Crash beeinflusst Plugin/Obsidian nicht
- CPU-Isolation: Endlosschleifen blockieren nicht den UI-Thread
- Zukunftssicher: Node.js `--permission` Flags wenn Obsidian auf Node 23+ wechselt
- Kein Breaking Change fuer Konsumenten (gleiches Interface)

### Negativ

- ~300-3000ms First-Spawn auf macOS bei signierten Apps (mitigiert durch Keep-Alive)
- Separater Build-Output (`sandbox-worker.js`) erhoet Deployment-Komplexitaet
- Worker hat Node.js-Zugriff (Defense-in-Depth via AstValidator + new Function)
- Mobile bleibt bei V8-Origin-Isolation (Architektur-Limitierung von iOS/Android)

---

## Bedrohungsszenarien

### Was iframe-Sandbox NICHT blocken kann

| Bedrohung | iframe | child_process.fork | Realistisch |
|-----------|--------|-------------------|-------------|
| **Spectre/Meltdown** (Memory-Disclosure via Side-Channel) | ✗ Shared address space | ✓ Eigener Heap | Sehr gering |
| **CPU-DoS** (Endlosschleife blockiert UI) | ✗ Shared Event Loop | ✓ Eigener Event Loop | Hoch |
| **V8-Exploit** (Use-After-Free -> Node.js-Zugriff) | ✗ Escape moeglich | ✓ Crash isoliert | Gering (0-Day noetig) |
| **Vault-Persistenz** (Shai Hulud Szenario) | ✗ ctx.vault erlaubt | ✗ ctx.vault erlaubt | Mittel (mitigiert via SandboxBridge) |

**Kritische Einsicht:** OS-Level-Isolation schuetzt NICHT gegen Vault-Manipulation, da `ctx.vault` absichtlich Zugriff gewaehrt. Die Sicherheit haengt von SandboxBridge-Pfad-Validierung + User Approval ab.

**Trade-off:** child_process.fork bietet Schutz gegen V8-Exploits und CPU-DoS, aber nicht gegen absichtliche Vault-Manipulation. Die Hauptverbesserung ist **Crash-Isolation** und **CPU-Isolation**, nicht Sandbox-Escape-Prevention.

---

## Rollback-Plan

### Rollback-Trigger

1. First-Spawn-Latenz >5s auf User-Systemen (inakzeptabel)
2. Worker-Crash-Loop (3x Retry-Limit reached)
3. IPC-Deadlock (Race-Condition zwischen Parent/Worker)
4. Community Plugin Review lehnt child_process ab

### Rollback-Mechanismus

**Option A: Feature-Flag (empfohlen)**

Neue Setting: `sandbox.mode: 'auto' | 'process' | 'iframe'`

- `'auto'`: Desktop=process, Mobile=iframe (Default)
- `'iframe'`: Force IframeSandboxExecutor (alle Platformen)
- `'process'`: Force ProcessSandboxExecutor (Desktop-only)

User kann in Settings zu `'iframe'` wechseln bei Problemen.

**Option B: Build-Zeit-Rollback**

Falls Review-Bot blockiert: Deaktiviere ProcessSandboxExecutor in `createSandboxExecutor.ts`, entferne `sandbox-worker.js` aus Build.

### Monitoring

OperationLogger erfasst:
- Worker-Spawn-Zeit (first + subsequent)
- Worker-Crash-Count
- IPC-Timeout-Count

Falls Crash-Rate >10% in 24h: Notice an User mit Empfehlung zu `mode: 'iframe'`.

---

## Performance-Trade-offs

### Messkriterien

| Metrik | iframe (Baseline) | child_process.fork (Ziel) | Kritisch bei |
|--------|------------------|---------------------------|--------------|
| First-Spawn | ~5ms | <1000ms (Keep-Alive) | >3000ms |
| Execution-Overhead | ~2ms | <10ms | >50ms |
| Memory-Overhead | ~30MB (shared) | <80MB (isolated) | >200MB |
| IPC-Roundtrip | N/A | <5ms | >50ms |

### Entscheidungs-Begrundung

**Warum diese Trade-offs akzeptabel:**

1. **First-Spawn-Latenz (~1s):** Einmalig pro Plugin-Load, Worker bleibt dann am Leben. Keep-Alive mitigiert.
2. **Execution-Overhead (~5ms):** Vernachlaessigbar vs. LLM-API-Latenz (500-3000ms).
3. **Memory-Overhead (50MB):** Akzeptabel fuer Desktop-Systeme mit 8GB+ RAM.

**Warum diese Trade-offs NICHT akzeptabel waeren:**

- First-Spawn >5s: User-Experience inakzeptabel
- Execution-Overhead >50ms: Merkbar bei iterativen Workflows
- Memory-Overhead >200MB: Problematisch auf low-end Systemen

**Rollback bei Nichterreichen:** Falls Performance-Tests zeigen, dass Ziele nicht erreichbar -> Rollback zu iframe-only via Feature-Flag.

---

## Referenzen

- `_devprocess/analysis/security/AUDIT-obsilo-2026-03-01.md` -- Security Audit, Finding H-1
- `_devprocess/analysis/security/ANALYSE-electron-browserwindow-sandbox-2026-03-02.md` -- Detaillierte Optionen-Analyse
- `_devprocess/requirements/features/FEATURE-0502-sandbox-os-isolation.md` -- Feature-Spezifikation
- `_devprocess/requirements/features/FEATURE-0501-self-development.md` -- Urspruengliche Sandbox-Spezifikation (Phase 3)
