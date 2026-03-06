# Feature-Spezifikation: Agent Self-Development (Meta-Agent)

> Detaillierte Implementierungsspezifikation mit Hinweisen fuer die Umsetzung

**Datum**: 2026-03-01
**Revision**: 3 (CDN-Strategie: esm.sh primaer, rekursive Dependency-Aufloesung, parallele Downloads)
**Status**: Implementiert (alle 5 Phasen abgeschlossen)
**Abhaengigkeit**: Bestehende Tool-Infrastruktur, Memory-System, MCP-Client

---

## Inhaltsverzeichnis

1. [Ueberblick](#1-ueberblick)
2. [Security-Architektur](#2-security-architektur)
3. [Stufe 1: Skills als Markdown](#3-stufe-1-skills-als-markdown)
4. [Stufe 2: Dynamic Modules](#4-stufe-2-dynamic-modules)
5. [Stufe 3: Core Self-Modification](#5-stufe-3-core-self-modification)
6. [Console Observability](#6-console-observability)
7. [MCP Self-Configuration](#7-mcp-self-configuration)
8. [Proactive Self-Improvement](#8-proactive-self-improvement)
9. [Performance und UX](#9-performance-und-ux)
10. [Implementation Phases](#10-implementation-phases)
11. [Verification Plan](#11-verification-plan)

---

## 1. Ueberblick

### Self-Improvement Loop

```
User interagiert mit Agent
        |
Agent fuehrt Tools aus (Episodes werden aufgezeichnet)
        |
Pattern Detection / Error Detection / User Request
        |
Agent waehlt die passende Stufe:
  |-- Workflow/Instruktion? --> Skill (SKILL.md schreiben)
  |-- Neue Capability?     --> Dynamic Module (TS → JS → iframe Sandbox)
  |-- Bug im Core?         --> Core Self-Modification (Source aendern + rebuild)
        |
Hot-Reload: Aenderung sofort im naechsten Turn verfuegbar
        |
Memory aktualisiert: learnings.md + errors.md + custom-tools.md
        |
Naechste Session: Agent weiss was er kann und was er gelernt hat
```

### Harte Constraints

- Alles laeuft innerhalb der Electron-App (kein Host-Zugriff, keine Shell)
- Community-Plugin-tauglich (keine native Dependencies, kein node-gyp)
- Review-Bot compliant (kein fetch, kein console.log, kein innerHTML)
- Kein Tier 2 — alle Faehigkeiten in Tier 1
- **Echte Code-Isolation** — dynamischer Code kann unter keinen Umstaenden auf Host-Ressourcen zugreifen

---

## 2. Security-Architektur

### 2.1 Warum NICHT vm.createContext()

Node.js Dokumentation: *"The vm module is not a security mechanism. Do not use it to run untrusted code."*

Bekannte Breakouts:
```javascript
({}).constructor.constructor('return process')()
try { null.x } catch(e) { e.constructor.constructor('return process')() }
Promise.resolve().then.constructor('return process')()
```

Obsidian-Plugins laufen mit `nodeIntegration: true`. Code der aus vm ausbricht hat **vollen Zugriff auf Dateisystem, Netzwerk, Prozesse**.

### 2.2 Sandbox-Architektur (Hybrid, aktualisiert 2026-03-02)

> **Update:** Die iframe-Sandbox ist jetzt das Mobile-Fallback. Desktop nutzt
> `child_process.fork()` mit OS-Level Prozess-Isolation (eigener OS-Prozess,
> eigener V8-Heap, ELECTRON_RUN_AS_NODE=1). Siehe ADR-021 und
> FEATURE-0502-sandbox-os-isolation.md fuer die vollstaendige Spezifikation.

Die **Mobile**-Sicherheitsgrenze bleibt `<iframe sandbox="allow-scripts">`:

```
Plugin (main.js, privilegiert)
    |
    |-- erstellt <iframe sandbox="allow-scripts" srcdoc="...">
    |-- injiziert kompilierten Code via postMessage
    |-- empfaengt Ergebnisse via postMessage
    |
    |====== postMessage Bridge (EINZIGER Kanal) ======|
    |
    v
iframe (Chromium Sandbox)
    |-- Kein Node.js, kein require, kein fs
    |-- Kein Netzwerk (kein fetch, kein XMLHttpRequest)
    |-- Kein Zugriff auf Parent-DOM
    |-- Nur Standard-Browser-JS (Array, Map, Promise, etc.)
    |-- Kommunikation NUR ueber postMessage
```

**Garantie**: Chromium's Sandbox ist seit 15+ Jahren kampferprobt. Google zahlt Millionen fuer Escape-Bugs. `sandbox="allow-scripts"` OHNE `allow-same-origin` verhindert jeden Parent-Zugriff.

### 2.3 Controlled Bridge (Plugin-Seite)

```typescript
class SandboxBridge {
  // Vault-Zugriff — Plugin kontrolliert Pfade
  async handleVaultRead(path: string): Promise<string> {
    if (!this.isInsideVault(path)) throw new Error('Path outside vault');
    return await this.vault.read(path);
  }

  async handleVaultWrite(path: string, content: string | ArrayBuffer): Promise<void> {
    if (!this.isInsideVault(path)) throw new Error('Path outside vault');
    if (!await this.requestApproval('vault-write', path)) throw new Error('Denied');
    // Text oder Binary
    if (content instanceof ArrayBuffer) {
      await this.vault.createBinary(path, content);
    } else {
      await this.vault.create(path, content);
    }
  }

  // Netzwerk — Plugin kontrolliert URL-Allowlist
  async handleRequestUrl(url: string): Promise<string> {
    if (!this.isAllowedUrl(url)) throw new Error('URL not allowed');
    const response = await requestUrl({ url });
    return response.text;
  }

  private isAllowedUrl(url: string): boolean {
    const allowed = ['unpkg.com', 'cdn.jsdelivr.net', 'registry.npmjs.org', 'esm.sh'];
    try {
      return allowed.some(a => new URL(url).hostname.endsWith(a));
    } catch { return false; }
  }
}
```

### 2.4 Fuenf Sicherheitsschichten

| Schicht | Schuetzt gegen | Umgehbar? |
|---------|---------------|-----------|
| 1. User Review (Code-Modal) | Offensichtlich boesartiger Code | Ja (User liest nicht) |
| 2. AST/Pattern Validation | Einfache Angriffe (eval, require) | Ja (Obfuskierung) |
| **3. Chromium Sandbox (iframe)** | **ALLE Code-Breakouts** | **Nein (OS-Level)** |
| 4. Controlled Bridge | Privilege Escalation | Nein (Plugin kontrolliert) |
| 5. Rate Limiting + Monitoring | Exfiltration, DoS | Nein (serverseitig) |

### 2.5 Prompt Injection Mitigationen

- **Instruktionshierarchie**: System Prompt > Tool-Ergebnisse > Vault-Inhalte
- **Tool-Call Validation**: ApprovalGate in ToolExecutionPipeline
- **MCP-Response Sanitization**: Ergebnisse als Daten, nicht als Instruktionen
- **Code-Review vor Ausfuehrung**: Jedes Dynamic Module zeigt Code-Modal

---

## 3. Stufe 1: Skills als Markdown

### 3.1 SKILL.md Format

**Speicherort**: `.obsidian/plugins/obsilo-agent/skills/<skill-name>/SKILL.md`

```markdown
---
name: Daily Summary
description: Erstellt Zusammenfassung der taeglichen Vault-Aktivitaet
trigger: "daily|summary|zusammenfassung|tagesbericht"
source: learned
requiredTools: [list_files, read_file, write_file]
createdAt: 2026-02-28T14:30:00Z
successCount: 5
---

# Daily Summary Skill

## Schritte
1. list_files sortiert nach modification time, letzte 24h
2. Fuer jede geaenderte Datei: read_file, notiere Aenderungen
3. Gruppiere nach Ordner/Projekt
4. write_file unter "Daily Summaries/YYYY-MM-DD.md"
```

### 3.2 Progressive Disclosure

| Ebene | Wann geladen | Budget |
|-------|-------------|--------|
| Metadata (Name+Desc+Trigger) | Immer im System Prompt | ~100 Woerter/Skill |
| Body (Instruktionen) | Wenn Skill getriggert | ~2000 Woerter |
| References (Zusatz-Docs) | On-demand durch Agent | Unbegrenzt |

### 3.3 Hot-Reload

Obsidian's `vault.on('modify'/'create'/'delete')` Events. Pfad-Filter auf `skills/`. Sofort im naechsten LLM Turn verfuegbar.

### 3.4 Tool: `manage_skill`

**Actions**: create, update, delete, list, validate, read

**Validation**: Frontmatter-Pflichtfelder, gueltiges Regex fuer trigger, requiredTools existieren in ToolRegistry, eindeutiger Name.

### 3.5 Bundled Meta-Skill: Skill Creator

Mitgelieferter Skill der das SKILL.md-Format, Best Practices, und Beispiele beschreibt. `source: bundled`, nicht loeschbar.

### 3.6 Dateien

| Datei | Typ |
|-------|-----|
| `src/core/skills/SelfAuthoredSkillLoader.ts` | **NEU** |
| `src/core/tools/agent/ManageSkillTool.ts` | **NEU** |
| `skills/skill-creator/SKILL.md` | **NEU** |
| `src/core/skills/SkillRegistry.ts` | AENDERUNG |
| `src/core/mastery/RecipeMatchingService.ts` | AENDERUNG |
| `src/core/systemPrompt.ts` | AENDERUNG |
| `src/types/settings.ts` | AENDERUNG |

---

## 4. Stufe 2: Dynamic Modules

### 4.1 Architektur

```
Agent schreibt TypeScript-Modul
        |
AstValidator prueft Source (ergaenzende Schicht, nicht primaer)
        |
EsbuildWasmManager kompiliert:
  - transform() fuer einfache Module
  - build() + virtuelles Dateisystem fuer Module mit Libraries
        |
Kompiliertes JS an iframe-Sandbox via postMessage
        |
iframe fuehrt Code aus, kommuniziert via Bridge
        |
Ergebnisse zurueck an Plugin via postMessage
        |
DynamicToolFactory registriert Tool in ToolRegistry
```

### 4.2 Dynamic Module Format

```typescript
// Modul-Source den der Agent schreibt
// .obsidian/plugins/obsilo-agent/dynamic-tools/custom_csv_converter.ts

export const definition = {
  name: 'custom_csv_converter',
  description: 'Konvertiert CSV-Daten in Markdown-Tabellen',
  input_schema: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'CSV-Inhalt' },
      separator: { type: 'string', description: 'Trennzeichen (default: ,)' }
    },
    required: ['content']
  }
};

export async function execute(input, ctx) {
  const sep = input.separator ?? ',';
  const lines = input.content.split('\n');
  const header = lines[0].split(sep);
  const divider = header.map(() => '---').join(' | ');
  const rows = lines.slice(1).map(l => l.split(sep).join(' | '));
  return [
    `| ${header.join(' | ')} |`,
    `| ${divider} |`,
    ...rows.map(r => `| ${r} |`)
  ].join('\n');
}
```

### 4.3 Sandbox-Bridge API (verfuegbar im iframe)

```typescript
// Diese APIs stehen im iframe via postMessage-Bridge zur Verfuegung
interface SandboxContext {
  // Vault-Zugriff (async, geht ueber Bridge)
  vault: {
    read(path: string): Promise<string>;
    readBinary(path: string): Promise<ArrayBuffer>;
    list(path: string): Promise<string[]>;
    write(path: string, content: string): Promise<void>;          // Approval required
    writeBinary(path: string, content: ArrayBuffer): Promise<void>; // Approval required
  };

  // Netzwerk (nur URLs auf der Allowlist, async)
  requestUrl(url: string, options?: { method?: string; body?: string }): Promise<{
    status: number;
    text: string;
    arrayBuffer: ArrayBuffer;
  }>;

  // Standard-Builtins (direkt verfuegbar, keine Bridge noetig)
  // JSON, Math, Date, RegExp, Array, Object, String, Number, Boolean,
  // Map, Set, Promise, TextEncoder, TextDecoder, ArrayBuffer, Uint8Array,
  // crypto.randomUUID(), setTimeout (max 30s), console (geloggt)
}
```

**NICHT verfuegbar im iframe**: Node.js APIs, DOM des Parents, fetch (sandbox blockiert), WebSocket, localStorage, IndexedDB mit Parent-Origin.

### 4.4 AST-Validation (ergaenzende Schicht)

Blockiert offensichtliche Gefahren VOR Kompilierung. Laeuft auf Plugin-Seite (privilegiert).

**Blockierte Patterns**: eval, new Function, require, import, process, __proto__, constructor.constructor, globalThis, child_process, fs, net, http

**Wichtig**: AST-Validation ist NICHT die Sicherheitsgrenze. Sie verhindert versehentliche Fehler und macht offensichtliche Angriffe sichtbar. Die iframe-Sandbox ist die echte Grenze.

### 4.5 esbuild-wasm Manager

**Zwei Kompilierungsmodi:**

```typescript
// Modus 1: transform() — einzelne Module ohne Dependencies
const result = await esbuild.transform(source, {
  loader: 'ts', format: 'iife', target: 'es2022'
});

// Modus 2: build() — Module mit Library-Dependencies
const result = await esbuild.build({
  stdin: { contents: source, loader: 'ts' },
  bundle: true, format: 'iife', target: 'es2022',
  plugins: [{
    name: 'virtual-packages',
    setup(build) {
      build.onResolve({ filter: /^[^.]/ }, args => ({
        path: args.path, namespace: 'pkg'
      }));
      build.onLoad({ filter: /.*/, namespace: 'pkg' }, async args => {
        const content = await loadCachedPackage(args.path);
        return { contents: content, loader: 'js' };
      });
    }
  }]
});
```

**On-Demand Bootstrapping:**
1. Agent braucht erstmals Kompilierung
2. Fragt User: "Entwicklungsumgebung einrichten (~11MB)?"
3. Download via `requestUrl` (Obsidian API) von npm CDN
4. Lokal gespeichert, danach sofort verfuegbar

### 4.6 In-Process Package Manager (CDN-Strategie)

Pakete werden als vorkompilierte Browser ES Modules von CDN geladen. **esm.sh** ist der primaere CDN (mit `?bundle` Flag fuer transitive Dependencies), **jsdelivr** der Fallback.

```typescript
// Primaer: esm.sh mit ?bundle (transitiv gebundelt)
const bundleUrl = `https://esm.sh/${name}?bundle`;
// Fallback: jsdelivr /+esm
const fallbackUrl = `https://cdn.jsdelivr.net/npm/${name}/+esm`;
```

**Rekursive Dependency-Aufloesung (`resolveInternalImports`):**
CDN-Bundles enthalten haeufig absolute-path Imports auf Node-Polyfills und Sub-Pakete:
```javascript
// esm.sh pptxgenjs Bundle importiert z.B.:
import buffer from "/node/buffer.mjs";
import process from "/node/process.mjs";
// process.mjs importiert weiter (MINIFIZIERT, kein Leerzeichen nach from):
import events from"/node/events.mjs";
import tty from"/node/tty.mjs";
```

`resolveInternalImports()` erkennt diese Imports per Regex (`/(?:from|import)\s*["'](\/[^"']+)["']/g` — `\s*` statt `\s+` wegen minifiziertem CDN-Code) und laedt sie rekursiv herunter (max Tiefe: 5).

**Parallele Downloads:** Dependencies werden mit `Promise.all()` parallel geladen.

```typescript
// Parallel statt sequentiell
await Promise.all(dependencies.map(dep => this.ensurePackage(dep)));
```

**Wichtig:** Pakete wie pptxgenjs, xlsx, d3, pdf-lib, chart.js funktionieren als Browser-Bundles in der iframe-Sandbox — sie benoetigen KEIN Node.js, npm install oder Shell-Zugriff.

### 4.7 iframe Sandbox Executor

```typescript
class SandboxExecutor {
  private iframe: HTMLIFrameElement;
  private pending = new Map<string, { resolve, reject, timeout }>();

  // Einmalig beim Plugin-Start
  initialize(): void {
    this.iframe = document.createElement('iframe');
    this.iframe.sandbox = 'allow-scripts'; // NUR Scripts
    this.iframe.style.cssText = 'display:none;width:0;height:0';
    this.iframe.srcdoc = SANDBOX_HTML; // Vorbereitetes HTML mit Message-Handler
    document.body.appendChild(this.iframe);
    window.addEventListener('message', (e) => this.handleMessage(e));
  }

  // Modul ausfuehren
  async execute(compiledJs: string, input: Record<string, unknown>): Promise<unknown> {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Sandbox execution timeout (30s)'));
      }, 30000);
      this.pending.set(id, { resolve, reject, timeout });
      this.iframe.contentWindow?.postMessage(
        { type: 'execute', id, code: compiledJs, input }, '*'
      );
    });
  }

  // Bridge-Anfragen aus dem iframe
  private async handleMessage(event: MessageEvent): void {
    const msg = event.data;
    if (msg.type === 'result') {
      const p = this.pending.get(msg.id);
      if (p) { clearTimeout(p.timeout); p.resolve(msg.value); this.pending.delete(msg.id); }
    }
    if (msg.type === 'error') {
      const p = this.pending.get(msg.id);
      if (p) { clearTimeout(p.timeout); p.reject(new Error(msg.message)); this.pending.delete(msg.id); }
    }
    if (msg.type === 'vault-read') {
      const content = await this.bridge.handleVaultRead(msg.path);
      this.iframe.contentWindow?.postMessage(
        { type: 'vault-read-result', callId: msg.callId, content }, '*'
      );
    }
    if (msg.type === 'vault-write') {
      await this.bridge.handleVaultWrite(msg.path, msg.content);
      this.iframe.contentWindow?.postMessage(
        { type: 'vault-write-result', callId: msg.callId }, '*'
      );
    }
    if (msg.type === 'request-url') {
      const result = await this.bridge.handleRequestUrl(msg.url, msg.options);
      this.iframe.contentWindow?.postMessage(
        { type: 'request-url-result', callId: msg.callId, result }, '*'
      );
    }
  }
}
```

### 4.8 Tool: `create_dynamic_tool`

**Actions**: create, update, delete, list, test

**create Flow:**
1. Validiere `custom_` Prefix
2. AstValidator prueft Source (ergaenzend)
3. EsbuildWasmManager kompiliert (transform oder build)
4. Optional: User-Review-Modal zeigt Code
5. SandboxExecutor fuehrt Probe-Lauf aus
6. Speichert .ts + .js in dynamic-tools/
7. DynamicToolFactory registriert in ToolRegistry

### 4.9 evaluate_expression Tool

Gleiche iframe-Sandbox fuer Einmal-Ausfuehrungen (Regex testen, Berechnungen, Daten transformieren).

### 4.10 Dateien

| Datei | Typ |
|-------|-----|
| `src/core/sandbox/SandboxExecutor.ts` | **NEU** — iframe + postMessage + Bridge |
| `src/core/sandbox/SandboxBridge.ts` | **NEU** — Controlled Bridge (Vault, URL, Rate Limit) |
| `src/core/sandbox/AstValidator.ts` | **NEU** — Ergaenzende Pattern-Validation |
| `src/core/sandbox/EsbuildWasmManager.ts` | **NEU** — esbuild-wasm + Package Manager |
| `src/core/sandbox/sandbox.html` | **NEU** — iframe srcdoc Template |
| `src/core/tools/dynamic/DynamicToolLoader.ts` | **NEU** |
| `src/core/tools/dynamic/DynamicToolFactory.ts` | **NEU** |
| `src/core/tools/agent/CreateDynamicToolTool.ts` | **NEU** |
| `src/core/tools/agent/EvaluateExpressionTool.ts` | **NEU** |
| `src/core/tools/ToolRegistry.ts` | AENDERUNG |
| `src/main.ts` | AENDERUNG |
| `src/types/settings.ts` | AENDERUNG |

---

## 5. Stufe 3: Core Self-Modification

### 5.1 Patch-Module (bevorzugt, AUSSERHALB Sandbox)

Patch-Module laufen im privilegierten Plugin-Kontext (nicht in der iframe-Sandbox) da sie Zugriff auf Plugin-Internals brauchen.

**Sicherheit**: Explizites User-Approval + Code-Review-Modal. Jeder Patch wird vollstaendig angezeigt bevor er angewendet wird.

### 5.2 Source-Embedding + ARCHITECTURE.md + Full Rebuild

Keine Aenderung gegenueber Entwurf 1 — diese Teile waren bereits korrekt spezifiziert.

### 5.3 Dateien

| Datei | Typ |
|-------|-----|
| `src/core/self-development/EmbeddedSourceManager.ts` | **NEU** |
| `src/core/self-development/PluginBuilder.ts` | **NEU** |
| `src/core/self-development/PluginReloader.ts` | **NEU** |
| `src/core/tools/agent/ManageSourceTool.ts` | **NEU** |
| `ARCHITECTURE.md` | **NEU** |
| `esbuild.config.mjs` | AENDERUNG |

---

## 6. Console Observability

### 6.1 ConsoleRingBuffer

Ring Buffer (500 Eintraege) intercepted console.debug/warn/error. Korrelation mit aktuellem Tool.

### 6.2 Tool: `read_agent_logs`

Filter: level, since (relativ/absolut), pattern (Regex), limit.

### 6.3 Dateien

| Datei | Typ |
|-------|-----|
| `src/core/observability/ConsoleRingBuffer.ts` | **NEU** |
| `src/core/tools/agent/ReadAgentLogsTool.ts` | **NEU** |
| `src/main.ts` | AENDERUNG |

---

## 7. MCP Self-Configuration

### 7.1 Tool: `manage_mcp_server`

Actions: add, remove, update, list, status, reconnect, test.
Nur SSE + streamable-http. Kein stdio.

### 7.2 Dateien

| Datei | Typ |
|-------|-----|
| `src/core/tools/agent/ManageMcpServerTool.ts` | **NEU** |
| `src/core/mcp/McpClient.ts` | AENDERUNG |
| `src/types/settings.ts` | AENDERUNG |

---

## 8. Proactive Self-Improvement

### 8.1 Neue Memory-Dateien

- `errors.md` — Wiederkehrende Fehler + Loesungen
- `custom-tools.md` — Register erstellter Skills + Dynamic Tools

### 8.2 LongTermExtractor-Erweiterung

Neue Fact-Typen: skill_created, error_fixed, pattern_detected, tool_created.

### 8.3 SuggestionService

3+ aehnliche Episodes → Skill-Vorschlag. Wiederkehrende Fehler → Fix-Vorschlag.

### 8.4 Pre-Compaction Memory Flush

Vor Context-Condensing: Agent persistiert Erkenntnisse in Memory.

### 8.5 Dateien

| Datei | Typ |
|-------|-----|
| `src/core/mastery/SuggestionService.ts` | **NEU** |
| `src/core/memory/LongTermExtractor.ts` | AENDERUNG |
| `src/core/memory/MemoryService.ts` | AENDERUNG |
| `src/core/AgentTask.ts` | AENDERUNG |

---

## 9. Performance und UX

### 9.1 Wartezeiten

| Operation | Dauer | UX |
|-----------|-------|-----|
| Skill erstellen | <100ms | Sofort |
| iframe starten | ~50ms | Einmalig bei Plugin-Start |
| Modul kompilieren (einfach) | ~100ms | Kaum spuerbar |
| Modul kompilieren (mit Libraries) | ~500ms-2s | Spinner |
| Modul ausfuehren | <100ms sync | Sofort |
| npm-Paket Download | ~1-5s | Progress-Bar, einmalig |
| esbuild-wasm Download | ~5-15s | Progress-Bar, einmalig |
| Full Rebuild | ~20-30s | Progress-Bar, selten |

### 9.2 Optimierungen

- **iframe-Pool**: 1 iframe beim Start erstellt, wiederverwendet. Kein Overhead pro Ausfuehrung.
- **Paket-Cache**: Einmal heruntergeladen, lokal gespeichert. custom-tools.md als Index.
- **esbuild-wasm Cache**: Einmal heruntergeladen, im Plugin-Daten-Verzeichnis.
- **Streaming-Output**: Fuer laenger laufende Module: Teilergebnisse via postMessage an Chat.
- **Lazy iframe**: iframe wird erst erstellt wenn erstmals ein Dynamic Module ausgefuehrt wird (nicht beim Plugin-Start wenn nie gebraucht).
- **Kompilierungs-Cache**: Bereits kompilierte Module (.js) werden gecacht. Nur bei Source-Aenderung neu kompiliert.

### 9.3 UX-Flow fuer den User

```
User: "Erstelle mir ein Tool das CSV in Markdown konvertiert"
  |
  Agent: "Ich erstelle ein custom_csv_converter Tool."
  Agent: [Schreibt TypeScript-Code]
  Agent: [Zeigt Code-Review-Modal] "Diesen Code ausfuehren?"
  |
  User: [Approve]
  |
  Agent: [Kompiliert ~100ms] [Testet in Sandbox] [Registriert]
  Agent: "Tool custom_csv_converter ist jetzt verfuegbar."
  Agent: [Speichert in custom-tools.md + learnings.md]
  |
  Naechste Session: Agent sieht Tool in seinem Repertoire
```

---

## 10. Implementation Phases

### Phase 1: Foundation (Observability + MCP)

**Scope**: ConsoleRingBuffer, read_agent_logs, manage_mcp_server, McpClient-Erweiterungen

**Neue Dateien** (3):
- `src/core/observability/ConsoleRingBuffer.ts`
- `src/core/tools/agent/ReadAgentLogsTool.ts`
- `src/core/tools/agent/ManageMcpServerTool.ts`

**Geaenderte Dateien** (4):
- `src/main.ts`, `src/core/mcp/McpClient.ts`, `src/core/tools/ToolRegistry.ts`, `src/types/settings.ts`

**~500 LOC neu, ~100 LOC geaendert**

### Phase 2: Skill Self-Authoring

**Scope**: SelfAuthoredSkillLoader, manage_skill, SKILL.md Format, Hot-Reload, Meta-Skill

**Neue Dateien** (3):
- `src/core/skills/SelfAuthoredSkillLoader.ts`
- `src/core/tools/agent/ManageSkillTool.ts`
- `skills/skill-creator/SKILL.md`

**Geaenderte Dateien** (4):
- `src/core/skills/SkillRegistry.ts`, `src/core/mastery/RecipeMatchingService.ts`, `src/core/systemPrompt.ts`, `src/types/settings.ts`

**~600 LOC neu, ~150 LOC geaendert**

### Phase 3: Sandbox + Dynamic Modules

**Scope**: iframe Sandbox, Bridge, AstValidator, esbuild-wasm, Package Manager, DynamicToolLoader/Factory, create_dynamic_tool, evaluate_expression

**Neue Dateien** (9):
- `src/core/sandbox/SandboxExecutor.ts`
- `src/core/sandbox/SandboxBridge.ts`
- `src/core/sandbox/AstValidator.ts`
- `src/core/sandbox/EsbuildWasmManager.ts`
- `src/core/sandbox/sandbox.html`
- `src/core/tools/dynamic/DynamicToolLoader.ts`
- `src/core/tools/dynamic/DynamicToolFactory.ts`
- `src/core/tools/agent/CreateDynamicToolTool.ts`
- `src/core/tools/agent/EvaluateExpressionTool.ts`

**Geaenderte Dateien** (3):
- `src/core/tools/ToolRegistry.ts`, `src/main.ts`, `src/types/settings.ts`

**~1500 LOC neu, ~100 LOC geaendert**

### Phase 4: Core Self-Modification

**Scope**: Source-Embedding, EmbeddedSourceManager, PluginBuilder, PluginReloader, manage_source, ARCHITECTURE.md

**Neue Dateien** (5):
- `src/core/self-development/EmbeddedSourceManager.ts`
- `src/core/self-development/PluginBuilder.ts`
- `src/core/self-development/PluginReloader.ts`
- `src/core/tools/agent/ManageSourceTool.ts`
- `ARCHITECTURE.md`

**Geaenderte Dateien** (1): `esbuild.config.mjs`

**~800 LOC neu, ~100 LOC geaendert**

### Phase 5: Proactive Self-Improvement

**Scope**: SuggestionService, Memory-Erweiterungen, Pre-Compaction Flush

**Neue Dateien** (1): `src/core/mastery/SuggestionService.ts`

**Geaenderte Dateien** (4):
- `src/core/memory/LongTermExtractor.ts`, `src/core/memory/MemoryService.ts`, `src/core/AgentTask.ts`, `src/core/systemPrompt.ts`

**~400 LOC neu, ~200 LOC geaendert**

### Gesamtuebersicht

| Phase | Neue Files | Geaenderte Files | ~LOC neu | ~LOC geaendert |
|-------|-----------|-----------------|---------|---------------|
| 1: Foundation | 3 | 4 | 500 | 100 |
| 2: Skills | 3 | 4 | 600 | 150 |
| 3: Sandbox + Dynamic | 9 | 3 | 1500 | 100 |
| 4: Core Self-Mod | 5 | 1 | 800 | 100 |
| 5: Self-Improvement | 1 | 4 | 400 | 200 |
| **Gesamt** | **21** | **~12 unique** | **~3800** | **~650** |

---

## 11. Verification Plan

### Phase 1: Foundation
- Error provozieren → read_agent_logs findet Error
- "Verbinde MCP Server auf localhost:3000" → konfiguriert + verbindet
- stdio MCP Server → harte Ablehnung

### Phase 2: Skills
- "Erstelle Skill fuer Meeting Notes" → SKILL.md mit korrektem Frontmatter
- SKILL.md manuell bearbeiten → Hot-Reload
- 50+ Skills → System Prompt bleibt schlank

### Phase 3: Sandbox + Dynamic Modules
- Code mit `require('fs')` → AstValidator blockiert
- Code mit `process.exit()` → In iframe: ReferenceError (process nicht definiert)
- Code mit Prototype-Chain-Exploit → In iframe: Kein process verfuegbar, Exploit laeuft ins Leere
- CSV→Markdown Tool → Kompiliert, getestet, registriert
- PPTX-Generator mit pptxgenjs → Library gebundelt, Binary-Output via vault.writeBinary
- Timeout (>30s) → Sauber abgebrochen
- requestUrl auf nicht-allowlisted URL → Bridge blockiert

### Phase 4: Core Self-Modification
- Agent liest embedded Source → Dekodiert korrekt
- Full Rebuild → DiffReview → main.js ersetzt → Rollback bei Fehler

### Phase 5: Self-Improvement
- 3x aehnlicher Task → Skill-Vorschlag
- Lange Session → Pre-Compaction Flush

---

## Appendix: Alle neuen Dateien (21)

```
src/core/observability/ConsoleRingBuffer.ts
src/core/tools/agent/ReadAgentLogsTool.ts
src/core/tools/agent/ManageMcpServerTool.ts
src/core/skills/SelfAuthoredSkillLoader.ts
src/core/tools/agent/ManageSkillTool.ts
skills/skill-creator/SKILL.md
src/core/sandbox/SandboxExecutor.ts
src/core/sandbox/SandboxBridge.ts
src/core/sandbox/AstValidator.ts
src/core/sandbox/EsbuildWasmManager.ts
src/core/sandbox/sandbox.html
src/core/tools/dynamic/DynamicToolLoader.ts
src/core/tools/dynamic/DynamicToolFactory.ts
src/core/tools/agent/CreateDynamicToolTool.ts
src/core/tools/agent/EvaluateExpressionTool.ts
src/core/self-development/EmbeddedSourceManager.ts
src/core/self-development/PluginBuilder.ts
src/core/self-development/PluginReloader.ts
src/core/tools/agent/ManageSourceTool.ts
ARCHITECTURE.md
src/core/mastery/SuggestionService.ts
```
