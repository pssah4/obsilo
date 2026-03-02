# Analyse: Electron BrowserWindow mit sandbox: true + IPC

| Feld | Wert |
|------|------|
| **Bezug** | AUDIT-obsilo-2026-03-01.md, Finding H-1 |
| **Datum** | 2026-03-02 |
| **Option** | "Langfristig: Electron BrowserWindow mit sandbox: true + IPC evaluieren (Breaking Change)" |
| **Ergebnis** | Verworfen -- architekturbedingt nicht umsetzbar |

---

## 1. Kontext

Finding H-1 des Security Audits identifiziert die Chromium-Sandbox-Limitierung in Electron (CWE-693): Obsidians Renderer hat `nodeIntegration: true` und `contextIsolation: false`. Die iframe-Sandbox (`sandbox="allow-scripts"`) bietet V8-Origin-Isolation, aber keine OS-Level-Prozess-Isolation. Als langfristige Remediation wurde die Evaluation von `BrowserWindow` mit `sandbox: true` vorgeschlagen.

Diese Analyse bewertet die technische Machbarkeit dieser Option.

---

## 2. Was BrowserWindow sandbox: true bieten wuerde

Ein `BrowserWindow` mit `sandbox: true` erzeugt einen eigenstaendigen Chromium Renderer-Prozess mit Betriebssystem-Level Sandboxing -- dieselbe Technologie die Chrome fuer Tabs verwendet:

- **Windows:** Renderer auf niedrigstem "Untrusted" Integrity Level, eigener Desktop
- **macOS:** `sandbox_init()` mit restriktiven Policies
- **Linux:** Seccomp-BPF und Namespace-basierte Isolation

Ein sandboxed Renderer-Prozess kann ausschliesslich CPU-Zyklen und Speicher nutzen. Kein Dateisystem, keine Subprozesse, keine Fenster -- nur IPC mit dem Main-Prozess.

### Vergleich mit aktuellem Ansatz

| Eigenschaft | iframe sandbox (aktuell) | BrowserWindow sandbox:true |
|-------------|--------------------------|---------------------------|
| Isolation | V8 Origin (logisch, same-process) | OS-Level Prozess-Sandbox |
| Spectre/Meltdown | Verwundbar (shared address space) | Geschuetzt (eigener Prozess) |
| V8-Exploit-Risiko | Durchbricht Sandbox -> Node.js-Zugriff | Eigener Prozess, kein Ausbruch moeglich |
| Crash-Isolation | Kann Parent beeinflussen | Komplett isoliert |
| Memory | Shared address space | Eigener Adressraum |

---

## 3. Blocker-Analyse

### Blocker 1: Kein stabiler Zugang zum Main-Prozess

`BrowserWindow` ist eine Main-Prozess-API. Obsidian Plugins laufen im Renderer-Prozess. Der einzige Weg waere `@electron/remote`:

```typescript
// Theoretisch moeglich (falls remote verfuegbar):
const { BrowserWindow } = window.require('@electron/remote');
const sandbox = new BrowserWindow({
  show: false,
  webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true }
});
```

**Problem:** `@electron/remote` ist deprecated seit Electron 14. Obsidian bindet es aktuell ein, kann es aber jederzeit entfernen. Keine API-Garantie. Ein Plugin das darauf aufbaut ist fragil und kann bei jedem Obsidian-Update brechen.

### Blocker 2: IPC erfordert Main-Prozess-Handler

Die Standard-IPC-Architektur (`ipcMain.handle` / `ipcRenderer.invoke`) setzt voraus, dass im Main-Prozess Handler registriert werden. Ein Obsidian Plugin hat keinen Zugriff auf den Main-Prozess und kann keine Handler registrieren.

**Workaround-Versuch:** `MessageChannel` API (Renderer-to-Renderer) koennte `ipcMain` umgehen:

```typescript
const channel = new MessageChannel();
win.webContents.postMessage('port', null, [channel.port2]);
// Plugin kommuniziert ueber channel.port1
```

Aber `webContents.postMessage` erfordert wiederum Zugriff auf das `BrowserWindow`-Objekt -- also wieder `remote`.

### Blocker 3: Kein Praezedenzfall, hohes Review-Risiko

- **Kein einziges Community Plugin** erstellt ein eigenes `BrowserWindow`
- Selbst Electron-nutzende Plugins wie `electron-window-tweaker` beschraenken sich auf `getCurrentWindow()`
- Die manuelle Review wuerde ein verstecktes BrowserWindow mit hoher Wahrscheinlichkeit ablehnen
- `require('electron')` erfordert `isDesktopOnly: true`

---

## 4. Alternativen-Bewertung

### 4.1 `<webview>` Tag

Der `<webview>` Tag laeuft wie BrowserWindow in einem separaten Renderer-Prozess und bietet OS-Level Isolation.

**Vorteile:**
- Obsidian nutzt `<webview>` selbst im Web Viewer Core Plugin (ab v1.8.0)
- Community Plugin `Obsidian-Surfing` nutzt `<webview>` erfolgreich
- Cure53-Audit hat Obsidians WebView-Implementierung als sicher bewertet

**Nachteile:**
- Electron-Team empfiehlt aktiv die Abkehr: "The webview tag is based on Chromium's webview, which is undergoing dramatic architectural changes"
- Obsidian hat Webview-Zugriff ab v1.8 eingeschraenkt
- Kein Electron auf Mobile = kein `<webview>`
- Review-Risiko: Ungewoehnliches Pattern fuer Code-Execution

**Bewertung:** Bedingt moeglich, aber keine stabile Langfrist-Loesung.

### 4.2 Web Workers

Web Workers bieten Thread-Level Isolation innerhalb des gleichen Prozesses.

| Eigenschaft | iframe sandbox | Web Worker |
|-------------|---------------|------------|
| Prozess-Isolation | Nein | Nein |
| Thread-Isolation | Nein | Ja |
| DOM-Zugriff | Eigener DOM (eingeschraenkt) | Kein DOM |
| `new Function()` | Ja (mit CSP) | Ja |
| Kommunikation | postMessage | postMessage |
| UI Blocking | Nein (async) | Nein (eigener Thread) |

**Bewertung:** Kein Sicherheitsgewinn gegenueber iframe-Sandbox. Thread-Isolation schuetzt vor UI-Blocking, nicht vor Memory-Access-Attacken. Gleicher Prozess, gleicher Adressraum.

### 4.3 Referenz: VS Code Utility Processes

VS Code loeste das identische Problem durch Electron Utility Processes -- einen neuen Prozess-Typ mit voller OS-Level Sandbox. Das erforderte Aenderungen an Electron selbst und Kontrolle ueber den Main-Prozess. Als Plugin-Entwickler in einer fremden Electron-App (Obsidian) ist dieser Weg verschlossen.

---

## 5. Zusammenfassung

| Option | OS-Level Sandbox | Machbar in Obsidian | Stabil | Review-Bot | Empfehlung |
|--------|:---:|:---:|:---:|:---:|---------|
| BrowserWindow sandbox:true | Ja | Fragil (remote) | Nein | Grauzone | Verworfen |
| `<webview>` Tag | Ja | Eingeschraenkt (v1.8+) | Mittel | Grauzone | Nicht empfohlen |
| Web Worker | Nein | Ja | Ja | OK | Kein Sicherheitsgewinn |
| **iframe sandbox (aktuell)** | **Nein** | **Ja** | **Ja** | **OK** | **Beste verfuegbare Option** |

---

## 6. Entscheidung

Die Option "Electron BrowserWindow mit sandbox: true + IPC" wird **verworfen**.

**Begruendung:**
1. BrowserWindow erfordert Main-Prozess-Zugriff via deprecated `@electron/remote` -- keine API-Garantie, kann bei jedem Obsidian-Update brechen
2. IPC-Setup erfordert Main-Prozess-Handler, die ein Plugin nicht registrieren kann
3. Kein Community-Praezedenzfall, hohes Review-Ablehnungsrisiko
4. Keine der evaluierten Alternativen bietet einen praktikablen Weg zu OS-Level Sandbox

**Aktueller Ansatz bleibt korrekt:** Die iframe-Sandbox mit SandboxBridge (`src/core/sandbox/SandboxExecutor.ts`, `src/core/sandbox/SandboxBridge.ts`) ist die beste verfuegbare Isolation innerhalb der Obsidian-Plugin-Architektur.

**Reale Langfrist-Optionen:**
- Obsidian Feature Request fuer eine Plugin-Sandbox-API (analog zu VS Code Utility Processes)
- Obsidian stellt `sandbox: true` BrowserWindows als offizielle Plugin-API bereit
- Beides liegt ausserhalb unserer Kontrolle

---

## 7. Auswirkung auf Finding H-1

Die Remediation-Zeile in H-1 sollte aktualisiert werden:

**Vorher:**
> Langfristig: Electron BrowserWindow mit sandbox: true + IPC evaluieren (Breaking Change)

**Nachher:**
> Langfristig: Evaluiert und verworfen (siehe ANALYSE-electron-browserwindow-sandbox-2026-03-02.md). Reale Langfrist-Option: Obsidian Feature Request fuer Plugin-Sandbox-API. Bis dahin: iframe-Sandbox mit SandboxBridge als beste verfuegbare Loesung beibehalten.
