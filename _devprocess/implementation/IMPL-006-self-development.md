# Implementierungsplan: Agent Self-Development

> Detaillierter, phasenweiser Plan mit Security, Performance und UX im Fokus

**Datum**: 2026-02-28
**Referenz**: [Analyse](../analysis/self-development-analysis.md), [Feature-Spec](../requirements/features/FEATURE-0501-self-development.md)

---

## Leitprinzipien

1. **Security-First**: iframe-Sandbox ist die primaere Sicherheitsgrenze, nicht AST-Validation
2. **UX-First**: Wartezeiten unter 200ms wo moeglich, Progress-Feedback wo nicht
3. **Inkrementell**: Jede Phase ist eigenstaendig nutzbar und testbar
4. **Review-Bot compliant**: Kein fetch, kein console.log, kein innerHTML, kein `any`

---

## Phase 1: Foundation (Observability + MCP Self-Config)

### 1.1 ConsoleRingBuffer

**Datei**: `src/core/observability/ConsoleRingBuffer.ts`

```typescript
// Kernstruktur
interface LogEntry {
  timestamp: number;
  level: 'debug' | 'warn' | 'error';
  message: string;
  source?: string;           // Erste Zeile des Stack Trace
  correlatedTool?: string;   // Tool das zum Zeitpunkt lief
}

export class ConsoleRingBuffer {
  private entries: LogEntry[] = [];
  private maxEntries = 500;
  private currentTool: string | null = null;

  install(): void { /* wrap console.debug/warn/error, call original after logging */ }
  uninstall(): void { /* restore originals */ }
  setCurrentTool(name: string | null): void { /* fuer Korrelation */ }
  query(filter: { level?, since?, pattern?, limit? }): LogEntry[] { ... }
  clear(): void { ... }
}
```

**Implementierungshinweise:**
- `console.debug/warn/error` wrappen. NICHT console.log (Review-Bot!)
- Originale via `const origDebug = console.debug.bind(console)` sichern
- In `install()`: `console.debug = (...args) => { this.push('debug', args); origDebug(...args); }`
- Stack Trace: `new Error().stack?.split('\n')[2]` fuer source-Feld
- Ring Buffer: Wenn `entries.length >= maxEntries` → `entries.shift()`
- `setCurrentTool()` wird von ToolExecutionPipeline aufgerufen

**UX**: Kein User-Impact. Laeuft im Hintergrund.

### 1.2 ReadAgentLogsTool

**Datei**: `src/core/tools/agent/ReadAgentLogsTool.ts`

- Folgt BaseTool Pattern
- Input: `{ level, since, pattern, limit }`
- `since` unterstuetzt ISO-Timestamp und relative Angaben ("5m", "1h", "30s")
- Relative Zeit parsen: Regex `^(\d+)(s|m|h)$` → `Date.now() - value * multiplier`
- Output: Formatierte Log-Eintraege als Text

**Aenderung in main.ts**: ConsoleRingBuffer als Service instanziieren, in ToolRegistry injizieren.
**Aenderung in ToolExecutionPipeline**: `ringBuffer.setCurrentTool(toolName)` vor Ausfuehrung, `null` danach.

### 1.3 ManageMcpServerTool

**Datei**: `src/core/tools/agent/ManageMcpServerTool.ts`

**Orientierung**: ConfigureModelTool Pattern (action-basiert).

**Actions und Logik:**

```
add:
  1. Validiere: type MUSS 'sse' oder 'streamable-http' sein
     → wenn 'stdio': Fehler "stdio servers spawn host processes and are not allowed"
  2. Validiere: url ist gueltige URL
  3. Speichere in settings.mcpServers[name] = config
  4. await plugin.saveSettings()
  5. await mcpClient.connect(name, config)
  6. Rueckmeldung: "Server X connected, Y tools available"
  7. context.invalidateToolCache()

remove:
  1. await mcpClient.disconnect(name)
  2. delete settings.mcpServers[name]
  3. await plugin.saveSettings()
  4. context.invalidateToolCache()

update:
  1. Gleiche Validierung wie add
  2. await mcpClient.disconnect(name)
  3. Update config in settings
  4. await mcpClient.connect(name, updatedConfig)
  5. context.invalidateToolCache()

list:
  1. mcpClient.getConnections()
  2. Formatiere: Name, Status, Tool-Count, Error

status:
  1. mcpClient.getConnection(name)
  2. Detaillierter Status + Tools-Liste

reconnect:
  1. await mcpClient.reconnect(name) // neue Methode

test:
  1. await mcpClient.testConnection(name) // neue Methode
```

**Aenderung McpClient.ts**: Neue Methoden `reconnect()` und `testConnection()` hinzufuegen (siehe Feature-Spec Section 7.2).

**Aenderung settings.ts**: Typ-Erweiterung falls noetig (McpServerConfig sollte bereits vorhanden sein).

### 1.4 Phase 1 Reihenfolge

1. `ConsoleRingBuffer.ts` schreiben + installieren in main.ts
2. `ReadAgentLogsTool.ts` schreiben + registrieren
3. McpClient um reconnect/testConnection erweitern
4. `ManageMcpServerTool.ts` schreiben + registrieren
5. Build + Deploy + Test

**Test-Szenario**: `read_agent_logs` aufrufen → sieht Plugin-Start-Logs. MCP-Server auf bekannter URL hinzufuegen → verbinden → testen.

---

## Phase 2: Skill Self-Authoring

### 2.1 SelfAuthoredSkillLoader

**Datei**: `src/core/skills/SelfAuthoredSkillLoader.ts`

```typescript
interface SelfAuthoredSkill {
  name: string;
  description: string;
  trigger: RegExp;
  source: 'learned' | 'user' | 'bundled';
  requiredTools: string[];
  createdAt: Date;
  successCount: number;
  body: string;             // Markdown-Body (ohne Frontmatter)
  filePath: string;         // Pfad zur SKILL.md
}

export class SelfAuthoredSkillLoader {
  private skills = new Map<string, SelfAuthoredSkill>();
  private skillsDir: string;

  constructor(private plugin: ObsidianAgentPlugin) {
    // skillsDir = configDir + '/plugins/obsilo-agent/skills'
    this.skillsDir = `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}/skills`;
  }

  async loadAll(): Promise<void> { /* scan skillsDir, parse each SKILL.md */ }
  async loadSkill(filePath: string): Promise<SelfAuthoredSkill | null> { /* parse frontmatter + body */ }

  // Hot-Reload via Vault Events
  setupWatcher(): void {
    this.plugin.registerEvent(
      this.plugin.app.vault.on('modify', (file) => {
        if (file.path.startsWith(this.skillsDir) && file.name === 'SKILL.md') {
          void this.reloadSkill(file.path);
        }
      })
    );
    // Analog fuer 'create' und 'delete'
  }

  // Fuer System Prompt: nur Metadata
  getMetadataSummary(): string {
    return [...this.skills.values()]
      .map(s => `- ${s.name}: ${s.description} [trigger: ${s.trigger.source}]`)
      .join('\n');
  }

  // Fuer Skill-Aktivierung: voller Body
  getSkillBody(name: string): string | undefined {
    return this.skills.get(name)?.body;
  }
}
```

**Frontmatter-Parsing**: Einfacher YAML-Parser (kein gray-matter noetig — zu gross). Split an `---` Delimitern, dann key-value Parsing fuer die bekannten Felder.

**UX**: Skills laden in <10ms. Hot-Reload ist instant. User merkt nichts.

### 2.2 ManageSkillTool

**Datei**: `src/core/tools/agent/ManageSkillTool.ts`

**Orientierung**: ConfigureModelTool Pattern.

**Besonderheiten:**
- `create`: Schreibt SKILL.md via `vault.create()` (nutzt Vault Adapter, nicht fs!)
- `validate`: Prueft Frontmatter-Felder, Regex-Syntax, requiredTools-Existenz
- `delete`: Nutzt `fileManager.trashFile()` (Review-Bot: kein vault.delete!)
- Bundled Skills (`source: bundled`) koennen nicht geloescht werden

### 2.3 Bundled Skill-Creator

**Datei**: `skills/skill-creator/SKILL.md`

Inhalt: SKILL.md Format-Beschreibung, Frontmatter-Felder, Best Practices, 3 Beispiele. `source: bundled`.

Wird als Asset ins Plugin-Verzeichnis kopiert (via esbuild oder manuell im Build-Schritt).

### 2.4 Integration in System Prompt

**Aenderung systemPrompt.ts**: Neue Section `## Self-Authored Skills` mit Metadata-Summary. Zwischen "Available Tools" und "Memory Context".

```typescript
// In buildSystemPrompt()
const skillsSummary = skillLoader.getMetadataSummary();
if (skillsSummary) {
  sections.push(`## Self-Authored Skills\n${skillsSummary}`);
}
```

### 2.5 Integration in SkillRegistry

**Aenderung SkillRegistry.ts**: Methode `matchSelfAuthored(userMessage)` die Trigger-Regex gegen User-Nachricht prueft. Bei Match: Skill-Body an Context anhaengen.

### 2.6 Phase 2 Reihenfolge

1. Frontmatter-Parser schreiben (einfach, keine Dependency)
2. `SelfAuthoredSkillLoader.ts` + Hot-Reload
3. `ManageSkillTool.ts` + Validation
4. `skills/skill-creator/SKILL.md` (Bundled Meta-Skill)
5. systemPrompt.ts Integration
6. SkillRegistry.ts Integration
7. Build + Deploy + Test

**Test-Szenario**: "Erstelle einen Skill fuer Meeting Notes" → Agent nutzt manage_skill → SKILL.md erscheint → Hot-Reload → Skill verfuegbar.

---

## Phase 3: Sandbox + Dynamic Modules

### 3.1 iframe Sandbox Setup (KRITISCHSTE Komponente)

**Datei**: `src/core/sandbox/sandbox.html`

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
<script>
// === SANDBOX-SEITE: Kein Node.js, kein Parent-Zugriff ===

// Bridge-Proxy fuer async Aufrufe zum Plugin
const pendingCalls = new Map();
let callCounter = 0;

function bridgeCall(type, payload) {
  return new Promise((resolve, reject) => {
    const callId = 'bc_' + (++callCounter);
    const timeout = setTimeout(() => {
      pendingCalls.delete(callId);
      reject(new Error('Bridge call timeout'));
    }, 15000);
    pendingCalls.set(callId, { resolve, reject, timeout });
    parent.postMessage({ ...payload, type, callId }, '*');
  });
}

// Vault-API (Bridge)
const vault = {
  read: (path) => bridgeCall('vault-read', { path }),
  readBinary: (path) => bridgeCall('vault-read-binary', { path }),
  list: (path) => bridgeCall('vault-list', { path }),
  write: (path, content) => bridgeCall('vault-write', { path, content }),
  writeBinary: (path, content) => bridgeCall('vault-write-binary', { path, content }),
};

// requestUrl (Bridge, URL-Allowlist auf Plugin-Seite)
const requestUrl = (url, options) => bridgeCall('request-url', { url, options });

// Message-Handler fuer Bridge-Responses und Execute-Befehle
window.addEventListener('message', async (event) => {
  const msg = event.data;

  // Bridge-Response
  if (msg.callId && pendingCalls.has(msg.callId)) {
    const p = pendingCalls.get(msg.callId);
    clearTimeout(p.timeout);
    pendingCalls.delete(msg.callId);
    if (msg.error) p.reject(new Error(msg.error));
    else p.resolve(msg.result);
    return;
  }

  // Execute-Befehl vom Plugin
  if (msg.type === 'execute') {
    try {
      // Modul laden: erwartet IIFE das { definition, execute } exportiert
      const moduleExports = {};
      const moduleFunc = new Function('exports', 'vault', 'requestUrl', msg.code);
      moduleFunc(moduleExports, vault, requestUrl);

      // Execute aufrufen
      const result = await moduleExports.execute(msg.input, { vault, requestUrl });
      parent.postMessage({ type: 'result', id: msg.id, value: result }, '*');
    } catch (e) {
      parent.postMessage({ type: 'error', id: msg.id, message: e.message || String(e) }, '*');
    }
  }
});

// Signal: Sandbox ist bereit
parent.postMessage({ type: 'sandbox-ready' }, '*');
</script>
</body>
</html>
```

**Sicherheits-Analyse dieser HTML:**
- `new Function()` im iframe: Sicher! Im iframe gibt es kein Node.js, kein process, kein require
- Prototype-Chain-Exploits: Laufen ins Leere — es gibt nichts zu escapen
- `parent.postMessage` ist der EINZIGE Kommunikationskanal
- Kein fetch (sandbox blockiert Netzwerk), kein localStorage, kein IndexedDB

### 3.2 SandboxExecutor (Plugin-Seite)

**Datei**: `src/core/sandbox/SandboxExecutor.ts`

```typescript
export class SandboxExecutor {
  private iframe: HTMLIFrameElement | null = null;
  private ready = false;
  private readyPromise: Promise<void>;
  private pending = new Map<string, { resolve, reject, timeout: ReturnType<typeof setTimeout> }>();
  private bridge: SandboxBridge;

  constructor(private plugin: ObsidianAgentPlugin) {
    this.bridge = new SandboxBridge(plugin);
  }

  // Lazy initialization — erst wenn erstmals gebraucht
  async ensureReady(): Promise<void> {
    if (this.ready) return;
    if (!this.readyPromise) {
      this.readyPromise = this.initialize();
    }
    return this.readyPromise;
  }

  private async initialize(): Promise<void> {
    this.iframe = document.createElement('iframe');
    this.iframe.sandbox.add('allow-scripts');
    // Review-Bot: CSS-Klasse statt inline style
    this.iframe.addClass('agent-sandbox-iframe'); // display:none in styles.css
    this.iframe.srcdoc = SANDBOX_HTML; // importiert aus sandbox.html
    document.body.appendChild(this.iframe);

    // Warte auf 'sandbox-ready' Message
    await new Promise<void>((resolve) => {
      const handler = (e: MessageEvent) => {
        if (e.data?.type === 'sandbox-ready') {
          window.removeEventListener('message', handler);
          this.ready = true;
          resolve();
        }
      };
      window.addEventListener('message', handler);
    });

    // Globaler Message-Handler fuer alle Sandbox-Kommunikation
    window.addEventListener('message', (e) => this.handleMessage(e));
  }

  async execute(compiledJs: string, input: Record<string, unknown>): Promise<unknown> {
    await this.ensureReady();
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Sandbox execution timeout (30s)'));
      }, 30000);
      this.pending.set(id, { resolve, reject, timeout });
      this.iframe?.contentWindow?.postMessage(
        { type: 'execute', id, code: compiledJs, input }, '*'
      );
    });
  }

  private async handleMessage(event: MessageEvent): Promise<void> {
    const msg = event.data;
    if (!msg?.type) return;

    // Ergebnis/Fehler von execute()
    if (msg.type === 'result' || msg.type === 'error') {
      const p = this.pending.get(msg.id);
      if (!p) return;
      clearTimeout(p.timeout);
      this.pending.delete(msg.id);
      if (msg.type === 'error') p.reject(new Error(msg.message));
      else p.resolve(msg.value);
      return;
    }

    // Bridge-Anfragen aus dem iframe
    try {
      let result: unknown;
      if (msg.type === 'vault-read') result = await this.bridge.vaultRead(msg.path);
      else if (msg.type === 'vault-list') result = await this.bridge.vaultList(msg.path);
      else if (msg.type === 'vault-write') { await this.bridge.vaultWrite(msg.path, msg.content); result = true; }
      else if (msg.type === 'vault-write-binary') { await this.bridge.vaultWriteBinary(msg.path, msg.content); result = true; }
      else if (msg.type === 'request-url') result = await this.bridge.requestUrl(msg.url, msg.options);
      else return;

      this.iframe?.contentWindow?.postMessage(
        { type: msg.type + '-result', callId: msg.callId, result }, '*'
      );
    } catch (e) {
      this.iframe?.contentWindow?.postMessage(
        { type: msg.type + '-result', callId: msg.callId, error: e instanceof Error ? e.message : String(e) }, '*'
      );
    }
  }

  destroy(): void {
    this.iframe?.remove();
    this.iframe = null;
    this.ready = false;
    for (const p of this.pending.values()) {
      clearTimeout(p.timeout);
      p.reject(new Error('Sandbox destroyed'));
    }
    this.pending.clear();
  }
}
```

**Performance-Hinweis**: `ensureReady()` macht iframe lazy — wird erst beim ersten Dynamic-Module-Aufruf erstellt (~50ms). Danach wiederverwendet.

**Review-Bot**: `addClass()` statt `style.display = 'none'`. CSS-Klasse `.agent-sandbox-iframe` in styles.css definieren.

### 3.3 SandboxBridge (Plugin-Seite)

**Datei**: `src/core/sandbox/SandboxBridge.ts`

```typescript
export class SandboxBridge {
  // Rate Limiting
  private writeCount = 0;
  private requestCount = 0;
  private lastReset = Date.now();
  private readonly MAX_WRITES_PER_MIN = 10;
  private readonly MAX_REQUESTS_PER_MIN = 5;

  private readonly URL_ALLOWLIST = [
    'unpkg.com', 'cdn.jsdelivr.net', 'registry.npmjs.org', 'esm.sh'
  ];

  constructor(private plugin: ObsidianAgentPlugin) {}

  async vaultRead(path: string): Promise<string> {
    this.validateVaultPath(path);
    const file = this.plugin.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`Not a file: ${path}`);
    return await this.plugin.app.vault.read(file);
  }

  async vaultList(path: string): Promise<string[]> {
    this.validateVaultPath(path);
    const folder = this.plugin.app.vault.getAbstractFileByPath(path);
    if (!(folder instanceof TFolder)) throw new Error(`Not a folder: ${path}`);
    return folder.children.map(c => c.path);
  }

  async vaultWrite(path: string, content: string): Promise<void> {
    this.validateVaultPath(path);
    this.checkWriteRateLimit();
    // Approval via bestehendes System
    const file = this.plugin.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.plugin.app.vault.modify(file, content);
    } else {
      await this.plugin.app.vault.create(path, content);
    }
  }

  async vaultWriteBinary(path: string, content: ArrayBuffer): Promise<void> {
    this.validateVaultPath(path);
    this.checkWriteRateLimit();
    const file = this.plugin.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.plugin.app.vault.modifyBinary(file, content);
    } else {
      await this.plugin.app.vault.createBinary(path, content);
    }
  }

  async requestUrl(url: string, options?: { method?: string; body?: string }): Promise<unknown> {
    this.checkRequestRateLimit();
    if (!this.isAllowedUrl(url)) {
      throw new Error(`URL not on allowlist: ${url}. Allowed: ${this.URL_ALLOWLIST.join(', ')}`);
    }
    const response = await requestUrl({ url, method: options?.method, body: options?.body });
    return { status: response.status, text: response.text };
  }

  private validateVaultPath(path: string): void {
    // Kein Path Traversal
    if (path.includes('..') || path.startsWith('/') || path.startsWith('\\')) {
      throw new Error(`Invalid path: ${path}`);
    }
  }

  private isAllowedUrl(url: string): boolean {
    try {
      const host = new URL(url).hostname;
      return this.URL_ALLOWLIST.some(a => host === a || host.endsWith('.' + a));
    } catch { return false; }
  }

  private checkWriteRateLimit(): void {
    this.resetIfMinuteElapsed();
    if (++this.writeCount > this.MAX_WRITES_PER_MIN) {
      throw new Error('Write rate limit exceeded (max 10/min)');
    }
  }

  private checkRequestRateLimit(): void {
    this.resetIfMinuteElapsed();
    if (++this.requestCount > this.MAX_REQUESTS_PER_MIN) {
      throw new Error('Request rate limit exceeded (max 5/min)');
    }
  }

  private resetIfMinuteElapsed(): void {
    if (Date.now() - this.lastReset > 60000) {
      this.writeCount = 0;
      this.requestCount = 0;
      this.lastReset = Date.now();
    }
  }
}
```

### 3.4 AstValidator

**Datei**: `src/core/sandbox/AstValidator.ts`

Ergaenzende Schicht (NICHT primaere Sicherheit). Blockiert offensichtliche Patterns vor Kompilierung UND nach Kompilierung (auf JS-Output).

```typescript
export class AstValidator {
  private static BLOCKED = [
    /\beval\s*\(/, /\bnew\s+Function\b/, /\brequire\s*\(/,
    /\bimport\s+/, /\bimport\s*\(/, /\bprocess\b/,
    /\b__proto__\b/, /\.constructor\.constructor/, /\barguments\.callee\b/,
    /\bProxy\b/, /\bReflect\b/, /\bglobalThis\b/,
    /\bchild_process\b/, /\bexecSync\b/, /\bspawnSync\b/,
  ];

  static validate(source: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    for (const pattern of this.BLOCKED) {
      if (pattern.test(source)) {
        errors.push(`Blocked pattern: ${pattern.source}`);
      }
    }
    return { valid: errors.length === 0, errors };
  }
}
```

### 3.5 EsbuildWasmManager

**Datei**: `src/core/sandbox/EsbuildWasmManager.ts`

```typescript
export class EsbuildWasmManager {
  private esbuild: typeof import('esbuild-wasm') | null = null;
  private packageCache = new Map<string, string>();
  private cacheDir: string;

  constructor(private plugin: ObsidianAgentPlugin) {
    this.cacheDir = `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}/dev-env`;
  }

  async ensureReady(): Promise<void> {
    if (this.esbuild) return;
    // Pruefen ob esbuild-wasm lokal gecacht ist
    // Falls nicht: requestUrl Download von CDN (~11MB)
    // esbuild.initialize({ wasmURL: localPath })
  }

  // Modus 1: Einfaches Modul (kein import)
  async transform(source: string): Promise<string> {
    await this.ensureReady();
    const result = await this.esbuild!.transform(source, {
      loader: 'ts', format: 'iife', target: 'es2022',
      // Export-Wrapper: IIFE das exports-Objekt befuellt
      banner: 'void function(exports) {',
      footer: '}(typeof exports !== "undefined" ? exports : {});',
    });
    return result.code;
  }

  // Modus 2: Modul mit npm-Libraries
  async build(source: string, dependencies: string[]): Promise<string> {
    await this.ensureReady();
    // Dependencies sicherstellen (download falls noetig)
    for (const dep of dependencies) {
      await this.ensurePackage(dep);
    }

    const result = await this.esbuild!.build({
      stdin: { contents: source, loader: 'ts', resolveDir: '.' },
      bundle: true, format: 'iife', target: 'es2022', write: false,
      plugins: [{
        name: 'virtual-packages',
        setup: (build) => {
          build.onResolve({ filter: /^[^.]/ }, (args) => ({
            path: args.path, namespace: 'pkg'
          }));
          build.onLoad({ filter: /.*/, namespace: 'pkg' }, async (args) => ({
            contents: this.packageCache.get(args.path) ?? '',
            loader: 'js'
          }));
        }
      }]
    });

    return result.outputFiles?.[0]?.text ?? '';
  }

  private async ensurePackage(name: string): Promise<void> {
    if (this.packageCache.has(name)) return;
    // Lade von CDN — URL geht ueber SandboxBridge (Allowlist!)
    const url = `https://cdn.jsdelivr.net/npm/${name}/+esm`;
    const response = await requestUrl({ url });
    this.packageCache.set(name, response.text);
    // Persistieren im Plugin-Daten-Verzeichnis
  }
}
```

**UX**:
- Erstdownload esbuild-wasm: Progress-Bar via Agent-Chat-Message ("Lade Entwicklungsumgebung... 45%")
- transform(): ~100ms — nicht spuerbar
- build(): ~500ms-2s — kurzer Spinner

### 3.6 DynamicToolFactory + DynamicToolLoader

**Datei**: `src/core/tools/dynamic/DynamicToolFactory.ts`

Erzeugt BaseTool-Subklasse die intern SandboxExecutor.execute() aufruft.

```typescript
export class DynamicToolFactory {
  static create(
    definition: DynamicToolDefinition,
    compiledJs: string,
    sandboxExecutor: SandboxExecutor,
    plugin: ObsidianAgentPlugin
  ): BaseTool<string> {
    return new DynamicTool(definition, compiledJs, sandboxExecutor, plugin);
  }
}

class DynamicTool extends BaseTool<string> {
  readonly name: string;
  readonly isWriteOperation: boolean;

  constructor(
    private definition: DynamicToolDefinition,
    private compiledJs: string,
    private sandboxExecutor: SandboxExecutor,
    plugin: ObsidianAgentPlugin
  ) {
    super(plugin);
    this.name = definition.name;
    this.isWriteOperation = definition.isWriteOperation ?? false;
  }

  getDefinition(): ToolDefinition {
    return {
      name: this.definition.name,
      description: this.definition.description,
      input_schema: this.definition.input_schema,
    };
  }

  async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
    try {
      const result = await this.sandboxExecutor.execute(this.compiledJs, input);
      context.callbacks.pushToolResult(this.formatSuccess(
        typeof result === 'string' ? result : JSON.stringify(result, null, 2)
      ));
    } catch (error) {
      context.callbacks.pushToolResult(this.formatError(error));
    }
  }
}
```

**Datei**: `src/core/tools/dynamic/DynamicToolLoader.ts`

Laedt alle `dynamic-tools/*.json` (Definitionen) + `*.js` (kompilierter Code) beim Plugin-Start.

### 3.7 CreateDynamicToolTool + EvaluateExpressionTool

**Datei**: `src/core/tools/agent/CreateDynamicToolTool.ts`

create-Flow:
1. Validiere `custom_` Prefix
2. AstValidator auf Source (ergaenzend)
3. AstValidator auf kompilierten Output (ergaenzend)
4. Kompiliere via EsbuildWasmManager
5. Teste in SandboxExecutor (Dry-Run)
6. Speichere .ts + .js + .json im dynamic-tools/ Verzeichnis
7. Registriere via DynamicToolFactory in ToolRegistry

**Datei**: `src/core/tools/agent/EvaluateExpressionTool.ts`

Gleiche Sandbox, einmalige Ausfuehrung. Input: `{ expression, context }`.

### 3.8 Phase 3 Reihenfolge

1. `sandbox.html` schreiben + als String-Konstante einbetten
2. `SandboxBridge.ts` (Vault-Zugriff, URL-Allowlist, Rate Limits)
3. `SandboxExecutor.ts` (iframe + postMessage + lazy init)
4. `AstValidator.ts` (ergaenzende Pattern-Checks)
5. `EsbuildWasmManager.ts` (transform + build + Package Manager)
6. `DynamicToolFactory.ts` + `DynamicToolLoader.ts`
7. `CreateDynamicToolTool.ts` + `EvaluateExpressionTool.ts`
8. ToolRegistry-Erweiterung (registerDynamic/unregisterDynamic)
9. main.ts Integration (DynamicToolLoader beim Start)
10. Build + Deploy + Test

**Kritischer Test**: Code mit `({}).constructor.constructor('return process')()` in die Sandbox schicken → muss fehlschlagen (ReferenceError: process is not defined) statt Process-Zugriff zu geben.

---

## Phase 4: Core Self-Modification

### 4.1 Source-Embedding (Build-Zeit)

**Aenderung**: `esbuild.config.mjs`

Neues esbuild-Plugin das nach dem Build alle .ts Dateien liest, base64-encoded, und als `EMBEDDED_SOURCE` Konstante in main.js injiziert.

### 4.2 EmbeddedSourceManager

**Datei**: `src/core/self-development/EmbeddedSourceManager.ts`

Dekodiert Source aus EMBEDDED_SOURCE. Stellt Files als `Map<string, string>` bereit. Erlaubt In-Memory-Editing.

### 4.3 PluginBuilder

**Datei**: `src/core/self-development/PluginBuilder.ts`

Nutzt EsbuildWasmManager fuer Full-Bundle. Build-Config aus EMBEDDED_SOURCE.buildConfig. Output → neues main.js.

### 4.4 PluginReloader

**Datei**: `src/core/self-development/PluginReloader.ts`

```typescript
async reload(): Promise<void> {
  const id = this.plugin.manifest.id;
  await this.plugin.app.plugins.disablePlugin(id);
  await new Promise(resolve => setTimeout(resolve, 500));
  await this.plugin.app.plugins.enablePlugin(id);
}

async rollback(): Promise<void> {
  // main.js.bak → main.js
  // Dann reload()
}
```

### 4.5 ManageSourceTool

**Datei**: `src/core/tools/agent/ManageSourceTool.ts`

Actions: read, search, list, edit, build, reload, rollback. Jede edit-Action zeigt DiffReviewModal. build erfordert explizite User-Bestaetigung.

### 4.6 ARCHITECTURE.md

Eingebettet im Plugin. Beschreibt Key Files, Interfaces, Import-Graph, Patterns. Aktualisiert bei jedem Release.

### 4.7 Phase 4 Reihenfolge

1. esbuild.config.mjs: embed-source Plugin
2. `EmbeddedSourceManager.ts`
3. `PluginBuilder.ts`
4. `PluginReloader.ts`
5. `ManageSourceTool.ts` + DiffReviewModal
6. `ARCHITECTURE.md` schreiben
7. Build + Deploy + Test

---

## Phase 5: Proactive Self-Improvement

### 5.1 SuggestionService

**Datei**: `src/core/mastery/SuggestionService.ts`

Analysiert Episodes nach Session-Ende. 3+ aehnliche → Skill-Vorschlag. Wiederkehrende Fehler → Fix-Vorschlag.

### 5.2 Memory-Erweiterungen

- `errors.md` + `custom-tools.md` als neue Memory-Dateien in MemoryService registrieren
- LongTermExtractor: Neue Fact-Typen (skill_created, error_fixed, tool_created)
- Routing: Fact-Typ → Ziel-Datei

### 5.3 Pre-Compaction Memory Flush

**Aenderung AgentTask.ts**: Vor condenseContext() einen Flush-Turn einfuegen.

```typescript
if (this.shouldCondense()) {
  // Memory Flush
  this.conversationHistory.push({
    role: 'user',
    content: '[System] Save important learnings before context compression.'
  });
  await this.runSingleTurn(); // Agent nutzt Memory-Tools
  // Dann Condensing
  await this.condenseContext();
}
```

### 5.4 Phase 5 Reihenfolge

1. Memory-Dateien registrieren (errors.md, custom-tools.md)
2. LongTermExtractor erweitern
3. `SuggestionService.ts`
4. Pre-Compaction Flush in AgentTask.ts
5. Build + Deploy + Test

---

## Zusammenfassung: Alle Dateien

### Neue Dateien (21)

| Phase | Datei | LOC (geschaetzt) |
|-------|-------|-----------------|
| 1 | `src/core/observability/ConsoleRingBuffer.ts` | ~120 |
| 1 | `src/core/tools/agent/ReadAgentLogsTool.ts` | ~100 |
| 1 | `src/core/tools/agent/ManageMcpServerTool.ts` | ~250 |
| 2 | `src/core/skills/SelfAuthoredSkillLoader.ts` | ~200 |
| 2 | `src/core/tools/agent/ManageSkillTool.ts` | ~250 |
| 2 | `skills/skill-creator/SKILL.md` | ~100 |
| 3 | `src/core/sandbox/SandboxExecutor.ts` | ~200 |
| 3 | `src/core/sandbox/SandboxBridge.ts` | ~180 |
| 3 | `src/core/sandbox/AstValidator.ts` | ~60 |
| 3 | `src/core/sandbox/EsbuildWasmManager.ts` | ~250 |
| 3 | `src/core/sandbox/sandbox.html` | ~80 |
| 3 | `src/core/tools/dynamic/DynamicToolLoader.ts` | ~120 |
| 3 | `src/core/tools/dynamic/DynamicToolFactory.ts` | ~150 |
| 3 | `src/core/tools/agent/CreateDynamicToolTool.ts` | ~250 |
| 3 | `src/core/tools/agent/EvaluateExpressionTool.ts` | ~80 |
| 4 | `src/core/self-development/EmbeddedSourceManager.ts` | ~150 |
| 4 | `src/core/self-development/PluginBuilder.ts` | ~200 |
| 4 | `src/core/self-development/PluginReloader.ts` | ~80 |
| 4 | `src/core/tools/agent/ManageSourceTool.ts` | ~300 |
| 4 | `ARCHITECTURE.md` | ~500 |
| 5 | `src/core/mastery/SuggestionService.ts` | ~200 |

### Geaenderte Dateien (~12)

| Datei | Phasen | Art der Aenderung |
|-------|--------|------------------|
| `src/main.ts` | 1,3 | Services instanziieren + registrieren |
| `src/core/tools/ToolRegistry.ts` | 1,2,3 | registerDynamic/unregisterDynamic |
| `src/core/mcp/McpClient.ts` | 1 | reconnect() + testConnection() |
| `src/types/settings.ts` | 1,2,3 | Neue Settings-Felder |
| `src/core/skills/SkillRegistry.ts` | 2 | Self-Authored-Skill-Integration |
| `src/core/mastery/RecipeMatchingService.ts` | 2 | Self-Authored Skills matchen |
| `src/core/systemPrompt.ts` | 2,5 | Skills-Section + Suggestions |
| `src/core/memory/LongTermExtractor.ts` | 5 | Neue Fact-Typen |
| `src/core/memory/MemoryService.ts` | 5 | Neue Memory-Dateien |
| `src/core/AgentTask.ts` | 5 | Pre-Compaction Flush |
| `src/core/tool-execution/ToolExecutionPipeline.ts` | 1 | setCurrentTool fuer Korrelation |
| `esbuild.config.mjs` | 4 | embed-source Plugin |
| `src/ui/styles.css` | 3 | .agent-sandbox-iframe { display:none } |
