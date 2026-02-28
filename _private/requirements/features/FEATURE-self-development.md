# Feature-Spezifikation: Agent Self-Development (Meta-Agent)

> Detaillierte Implementierungsspezifikation mit Hinweisen fuer die Umsetzung

**Datum**: 2026-02-28
**Status**: Spezifiziert, Implementierung ausstehend
**Abhaengigkeit**: Bestehende Tool-Infrastruktur, Memory-System, MCP-Client

---

## Inhaltsverzeichnis

1. [Ueberblick](#1-ueberblick)
2. [Stufe 1: Skills als Markdown](#2-stufe-1-skills-als-markdown)
3. [Stufe 2: Dynamic Modules](#3-stufe-2-dynamic-modules)
4. [Stufe 3: Core Self-Modification](#4-stufe-3-core-self-modification)
5. [Console Observability + Error Self-Healing](#5-console-observability)
6. [MCP Self-Configuration](#6-mcp-self-configuration)
7. [Proactive Self-Improvement](#7-proactive-self-improvement)
8. [Implementation Phases](#8-implementation-phases)
9. [Verification Plan](#9-verification-plan)

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
  |-- Neue Capability?     --> Dynamic Module (TS kompilieren + laden)
  |-- Bug im Core?         --> Core Self-Modification (Source aendern + rebuild)
        |
Hot-Reload: Aenderung sofort im naechsten Turn verfuegbar
        |
Memory aktualisiert: learnings.md + errors.md + SemanticIndex
        |
Naechste Session: Agent weiss was er kann und was er gelernt hat
```

### Harte Constraints

- Alles laeuft innerhalb der Electron-App (kein Host-Zugriff, keine Shell)
- Community-Plugin-tauglich (keine native Dependencies, kein node-gyp)
- Review-Bot compliant (kein fetch, kein console.log, kein innerHTML)
- Kein Tier 2 — alle Faehigkeiten in Tier 1

---

## 2. Stufe 1: Skills als Markdown

### 2.1 SKILL.md Format

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

## Hinweise
- Ignoriere .obsidian/ und andere System-Ordner
- Formatiere als Bullet-Liste, gruppiert nach Projekt
```

**Frontmatter-Felder**:

| Feld | Typ | Pflicht | Beschreibung |
|------|-----|---------|-------------|
| name | string | ja | Anzeigename |
| description | string | ja | Kurzbeschreibung (fuer System Prompt) |
| trigger | string | ja | Regex-Pattern fuer Aktivierung |
| source | "learned" \| "user" \| "bundled" | ja | Herkunft des Skills |
| requiredTools | string[] | nein | Benoetigte Tools (Validation) |
| createdAt | ISO 8601 | ja | Erstellungszeitpunkt |
| successCount | number | nein | Erfolgreiche Ausfuehrungen |

### 2.2 Progressive Disclosure

| Ebene | Wann geladen | Budget | Implementierung |
|-------|-------------|--------|----------------|
| Metadata | Immer im System Prompt | ~100 Woerter/Skill | Frontmatter parsen, in systemPrompt.ts einbetten |
| Body | Wenn Skill getriggert | ~2000 Woerter | Voller Markdown-Body an Context anhaengen |
| References | On-demand durch Agent | Unbegrenzt | Dateien aus `references/` Unterordner lesen |

### 2.3 Hot-Reload

**Implementierung**: FileWatcher auf Skills-Verzeichnis.

```
Plugin-Start:
  → SelfAuthoredSkillLoader scannt skills/ Verzeichnis
  → Parst Frontmatter + Body fuer jede SKILL.md
  → Registriert in SkillRegistry

FileWatcher (Obsidian Vault Events):
  → Neuer/geaenderter SKILL.md → Re-parse + Re-register
  → Geloeschter SKILL.md → Deregister
  → Sofort im naechsten LLM Turn verfuegbar
```

**Implementierungshinweis**: Obsidian's `vault.on('modify', ...)` und `vault.on('create', ...)` Events nutzen. Pfad-Filter auf `skills/` Verzeichnis. Kein separater FileWatcher noetig.

### 2.4 Tool: `manage_skill`

**Actions**: create, update, delete, list, validate, read

```typescript
// Input-Schema
{
  action: 'create' | 'update' | 'delete' | 'list' | 'validate' | 'read',
  skill_name: string,       // fuer create/update/delete/validate/read
  content: string,           // fuer create/update (voller SKILL.md Inhalt)
  field: string,             // fuer update (einzelnes Frontmatter-Feld)
  value: unknown,            // fuer update (neuer Wert)
}
```

**Validation** (bei create/update/validate):
- Frontmatter-Pflichtfelder vorhanden?
- `trigger` ist gueltiges Regex?
- `requiredTools` existieren in ToolRegistry?
- `name` ist eindeutig?
- Keine Shell-Metazeichen in Feldern?

### 2.5 Bundled Meta-Skill: Skill Creator

Ein mitgelieferter Skill der dem Agent beibringt, wie er Skills erstellt:

```
skills/skill-creator/SKILL.md
```

Inhalt beschreibt das SKILL.md-Format, Best Practices, und Beispiele. Wird als `source: bundled` markiert und kann nicht geloescht werden.

### 2.6 Neue/geaenderte Dateien

| Datei | Typ | Beschreibung |
|-------|-----|-------------|
| `src/core/skills/SelfAuthoredSkillLoader.ts` | **NEU** | Laedt + parst SKILL.md Dateien, Hot-Reload |
| `src/core/tools/agent/ManageSkillTool.ts` | **NEU** | manage_skill Tool |
| `skills/skill-creator/SKILL.md` | **NEU** | Bundled Meta-Skill |
| `src/core/skills/SkillRegistry.ts` | AENDERUNG | Integration von SelfAuthoredSkills |
| `src/core/mastery/RecipeMatchingService.ts` | AENDERUNG | Self-Authored Skills in Matching einbeziehen |
| `src/core/systemPrompt.ts` | AENDERUNG | Skill-Metadata in System Prompt |
| `src/types/settings.ts` | AENDERUNG | Skills-Einstellungen |

### 2.7 Implementierungshinweise

- **SelfAuthoredSkillLoader** folgt dem Pattern von SkillRegistry (scan + parse + register)
- **SKILL.md Parsing**: `gray-matter` ist bereits als Dependency verfuegbar (pruefen, sonst einfachen YAML-Parser implementieren)
- **SkillRegistry-Integration**: Neue Methode `registerSelfAuthored(skill)` neben bestehender VaultDNA-Discovery
- **System Prompt**: Skill-Metadata als `## Available Skills` Section, aehnlich wie `## Available Tools`
- **ManageSkillTool**: Folgt dem Pattern von ConfigureModelTool (action-basiert, validiert Input, Feedback via pushToolResult)

---

## 3. Stufe 2: Dynamic Modules

### 3.1 Architektur

```
Agent schreibt TypeScript-Modul
        |
AstValidator prueft Source (blockiert unsichere Patterns)
        |
EsbuildWasmManager kompiliert TS → JS (in-process)
        |
VmSandbox laedt JS mit injizierten APIs (vm.createContext)
        |
DynamicToolFactory registriert neues Tool in ToolRegistry
        |
Sofort verfuegbar im naechsten LLM Turn
```

### 3.2 Dynamic Module Format

```typescript
// .obsidian/plugins/obsilo-agent/dynamic-tools/custom_csv_converter.ts
import type { DynamicToolDefinition, DynamicToolContext } from './types';

export const definition: DynamicToolDefinition = {
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

export function execute(
  input: Record<string, unknown>,
  ctx: DynamicToolContext
): string {
  const sep = (input.separator as string) ?? ',';
  const lines = (input.content as string).split('\n');
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

### 3.3 DynamicToolContext (injizierte APIs)

```typescript
interface DynamicToolContext {
  // Ergebnisse zurueck an den Agent
  pushResult(content: string): void;
  logError(msg: string): void;

  // Vault-Zugriff (read-only oder mit Approval)
  vault: {
    read(path: string): Promise<string>;
    list(path: string): Promise<string[]>;
    // write nur wenn isWriteOperation=true in Definition
    write?(path: string, content: string): Promise<void>;
  };

  // Sichere Builtins
  JSON: typeof JSON;
  Math: typeof Math;
  Date: typeof Date;
  RegExp: typeof RegExp;
  Array: typeof Array;
  Object: typeof Object;
  String: typeof String;
  Number: typeof Number;
  Boolean: typeof Boolean;
  Map: typeof Map;
  Set: typeof Set;
  Promise: typeof Promise;

  // Utilities
  console: { log: Function; warn: Function; error: Function }; // gemappt auf logError
  setTimeout: typeof setTimeout;  // mit maximalem Timeout begrenzt
}
```

**NICHT verfuegbar**: process, require, import, fs, child_process, net, http, os, electron, globalThis, fetch, XMLHttpRequest, document, window, eval, Function (constructor)

### 3.4 AST-Validation

**Implementierung**: Einfacher Regex-basierter Scanner + Token-Analyse (kein voller AST-Parser noetig).

**Blockierte Patterns**:

| Pattern | Grund |
|---------|-------|
| `eval(` | Arbitrary Code Execution |
| `new Function(` | Arbitrary Code Execution |
| `require(` | Module Loading |
| `import ` / `import(` | Module Loading |
| `process.` | Node.js Process Access |
| `__proto__` | Prototype Pollution |
| `this.constructor` | Sandbox Escape |
| `arguments.callee` | Sandbox Escape |
| `Proxy` | Meta-Programming |
| `Reflect` | Meta-Programming |
| `globalThis` | Global Access |
| `child_process` | Host Access |
| `fs.` / `'fs'` | File System Access |
| `net.` / `'net'` | Network Access |
| `http.` / `'http'` | Network Access |

**Implementierungshinweis**: Regex-Scan auf dem Source-String VOR Kompilierung. Zusaetzlich nach Kompilierung nochmal auf dem JS-Output scannen (Transpiler koennte Patterns umschreiben).

### 3.5 esbuild-wasm Manager

```
Erster Bedarf:
  1. Agent fragt User: "Entwicklungsumgebung einrichten (~11MB)?"
  2. User bestaetigt
  3. requestUrl laedt esbuild-wasm von npm CDN
  4. Speicherung in Plugin-Daten-Verzeichnis
  5. Laden in Worker/in-process

Folgende Aufrufe:
  1. Gecachte Version laden (kein Download)
  2. Kompilierung: ~100ms pro Modul
```

**Implementierungshinweis**:
- `requestUrl` (Obsidian API) statt `fetch` (Review-Bot!)
- CDN-URL: `https://unpkg.com/esbuild-wasm@<version>/esbuild.wasm`
- Versioning: esbuild-wasm Version in Plugin-Settings speichern fuer Updates
- Kompilierung: `esbuild.transform(source, { loader: 'ts', format: 'cjs' })`
- Kein Full-Bundle noetig fuer einzelne Module — nur `transform`

### 3.6 VmSandbox

```typescript
// Vereinfachte Darstellung
import vm from 'vm';

class VmSandbox {
  execute(compiledJs: string, context: DynamicToolContext): unknown {
    const sandbox = vm.createContext({
      // Nur erlaubte APIs
      JSON, Math, Date, RegExp, Array, Object, String, Number, Boolean,
      Map, Set, Promise,
      console: { log: context.logError, warn: context.logError, error: context.logError },
      setTimeout: (fn: Function, ms: number) => setTimeout(fn, Math.min(ms, 30000)),
      // Custom APIs
      vault: context.vault,
      pushResult: context.pushResult,
    });

    const timeout = 30000; // 30s max
    return vm.runInContext(compiledJs, sandbox, { timeout });
  }
}
```

**Implementierungshinweis**:
- `timeout` Parameter in `vm.runInContext` begrenzt CPU-Zeit
- Memory-Limit: Nicht direkt in vm moeglich, aber esbuild-wasm Modul-Groesse begrenzen (~100KB Source max)
- Async-Ausfuehrung: `execute()` muss Promise-basierte Module unterstuetzen

### 3.7 Tool: `create_dynamic_tool`

**Actions**: create, update, delete, list, test

```typescript
// Input-Schema
{
  action: 'create' | 'update' | 'delete' | 'list' | 'test',
  tool_name: string,       // MUSS mit 'custom_' beginnen
  source: string,          // TypeScript Source (fuer create/update)
  test_input: object,      // Test-Input (fuer test)
}
```

**create Flow**:
1. Validiere `custom_` Prefix
2. AstValidator prueft Source
3. EsbuildWasmManager kompiliert TS → JS
4. VmSandbox fuehrt Probe-Lauf aus (trocken, ohne Vault-Writes)
5. Speichert .ts + .js in dynamic-tools/
6. DynamicToolFactory registriert in ToolRegistry

**test Flow**:
1. Laedt kompiliertes Modul
2. VmSandbox fuehrt mit test_input aus
3. Gibt Ergebnis zurueck

### 3.8 evaluate_expression Tool

Gleiche Infrastruktur (vm + restricted context) fuer Einmal-Ausfuehrungen:

```typescript
// Input-Schema
{
  expression: string,    // JavaScript-Ausdruck
  context: object,       // Optionale Variablen
}
```

**Anwendungsfaelle**: Regex testen, Daten transformieren, Berechnungen, String-Manipulation.

### 3.9 Neue/geaenderte Dateien

| Datei | Typ | Beschreibung |
|-------|-----|-------------|
| `src/core/sandbox/VmSandbox.ts` | **NEU** | vm.createContext Wrapper |
| `src/core/sandbox/AstValidator.ts` | **NEU** | Source-Code Validation |
| `src/core/sandbox/EsbuildWasmManager.ts` | **NEU** | esbuild-wasm Download + Caching + Kompilierung |
| `src/core/tools/dynamic/DynamicToolLoader.ts` | **NEU** | Laedt kompilierte Module beim Start |
| `src/core/tools/dynamic/DynamicToolFactory.ts` | **NEU** | Erstellt BaseTool-Wrapper fuer Dynamic Modules |
| `src/core/tools/agent/CreateDynamicToolTool.ts` | **NEU** | create_dynamic_tool Tool |
| `src/core/tools/agent/EvaluateExpressionTool.ts` | **NEU** | evaluate_expression Tool |
| `src/core/tools/ToolRegistry.ts` | AENDERUNG | Dynamic Tools registrieren/deregistrieren |
| `src/main.ts` | AENDERUNG | DynamicToolLoader beim Start ausfuehren |
| `src/types/settings.ts` | AENDERUNG | Dynamic-Tool-Einstellungen |

### 3.10 Implementierungshinweise

- **DynamicToolFactory** erzeugt eine Subklasse von BaseTool die intern VmSandbox nutzt
- **ToolRegistry** braucht `registerDynamic()` und `unregisterDynamic()` Methoden
- **Naming Convention**: Tool-Name MUSS `custom_` Prefix haben, File-Name = Tool-Name
- **Persistenz**: .ts (Source) + .js (Compiled) + .json (Metadata/Definition) pro Tool
- **Hot-Reload**: Bei Plugin-Start alle `dynamic-tools/*.js` laden und registrieren
- **CallPluginApiTool Pattern referenzieren**: Zeigt wie In-Process-JS-Ausfuehrung mit Allowlist + Timeout funktioniert

---

## 4. Stufe 3: Core Self-Modification

### 4.1 Patch-Module (bevorzugt)

**Versuch immer erst einen Patch bevor ein Full Rebuild gemacht wird.**

```typescript
// dynamic-tools/patch_anthropic_timeout.ts
export const definition = {
  name: 'custom_patch_anthropic_timeout',
  type: 'startup-patch',  // Automatisch beim Start angewendet
  description: 'Fixes timeout handling in Anthropic provider',
  target: 'AnthropicProvider.createMessage'
};

export function patch(original: Function): Function {
  return async function(...args: unknown[]) {
    try {
      return await original.apply(this, args);
    } catch (e) {
      if (e instanceof Error && e.message.includes('timeout')) {
        // Graceful timeout handling
      }
      throw e;
    }
  };
}
```

**Wichtig**: Patch-Module laufen AUSSERHALB der vm-Sandbox (Zugriff auf Plugin-Internals noetig). Erfordert explizite User-Approval.

**Implementierungshinweis**:
- `type: 'startup-patch'` in Definition kennzeichnet Patch-Module
- DynamicToolLoader erkennt diesen Typ und wendet Patches beim Start an
- `target` spezifiziert die zu patchende Methode (Dot-Notation: `Class.method`)
- Plugin muss interne Methoden ueber ein Patch-Registry exponieren

### 4.2 Source-Embedding (Build-Zeit)

**esbuild-Plugin das bei jedem Build ausfuehrt**:

```javascript
// Erweiterung von esbuild.config.mjs
const embedSourcePlugin = {
  name: 'embed-source',
  setup(build) {
    build.onEnd(async (result) => {
      // Liest alle .ts Dateien
      // Komprimiert (base64 + optional gzip)
      // Injiziert als EMBEDDED_SOURCE Konstante in main.js
    });
  }
};
```

**Ergebnis in main.js**:
```javascript
const EMBEDDED_SOURCE = {
  version: "1.2.0",
  files: {
    "src/main.ts": "<base64-encoded-source>",
    "src/api/providers/anthropic.ts": "<base64-encoded-source>",
    // ... alle .ts Dateien
  },
  buildConfig: { /* esbuild options fuer Rebuild */ }
};
```

**Groesse**: ~200-500KB zusaetzlich in main.js (komprimiert).

### 4.3 ARCHITECTURE.md

Eingebettet im Plugin, beschreibt:

1. **Key Files + Aufgaben** (welche Datei macht was)
2. **TypeScript Interfaces** (BaseTool, ToolExecutionContext, ApiHandler, etc.)
3. **Import-Graph** (Abhaengigkeiten zwischen Modulen)
4. **Patterns + Konventionen** (Review-Bot Rules, Naming, Error Handling)
5. **Aktualisiert bei jedem Release**

**Fuer Dynamic Modules**: Agent braucht ARCHITECTURE.md NICHT — er kennt nur das DynamicToolDefinition Interface.
**Fuer Core Self-Modification**: Agent BRAUCHT ARCHITECTURE.md um zu verstehen wo ein Bug liegt.

### 4.4 Full Rebuild Flow

```
1. Agent erkennt Bug via read_agent_logs
2. Agent versucht erst Patch-Module (Stufe 2.5)
3. Wenn Patch nicht reicht:
   a. Agent extrahiert Source aus EMBEDDED_SOURCE
   b. Agent liest ARCHITECTURE.md → versteht Architektur
   c. Agent modifiziert Source im Speicher
   d. DiffReviewModal zeigt Aenderungen → User approves
   e. esbuild-wasm kompiliert gesamtes Plugin (~20-30s)
   f. Backup: main.js → main.js.bak
   g. Neues main.js geschrieben via Obsidian Vault Adapter
   h. Plugin Reload via app.plugins.disablePlugin/enablePlugin
   i. Verifikation: Agent prueft ob Error weg ist
   j. Bei Fehler: Rollback auf main.js.bak
```

### 4.5 Tool: `manage_source`

**Actions**: read, search, list, edit, build, reload, rollback

```typescript
// Input-Schema
{
  action: 'read' | 'search' | 'list' | 'edit' | 'build' | 'reload' | 'rollback',
  file_path: string,      // fuer read/edit
  pattern: string,         // fuer search
  old_content: string,     // fuer edit (zu ersetzender Text)
  new_content: string,     // fuer edit (neuer Text)
}
```

**Sicherheit**:
- Jede `edit` Action zeigt DiffReviewModal
- `build` erfordert explizite User-Bestaetigung
- `rollback` ist immer verfuegbar
- Alle Aenderungen werden geloggt

### 4.6 Neue/geaenderte Dateien

| Datei | Typ | Beschreibung |
|-------|-----|-------------|
| `src/core/self-development/EmbeddedSourceManager.ts` | **NEU** | Liest/schreibt embedded Source |
| `src/core/self-development/PluginBuilder.ts` | **NEU** | esbuild-wasm Full Rebuild |
| `src/core/self-development/PluginReloader.ts` | **NEU** | Plugin Reload + Rollback |
| `src/core/tools/agent/ManageSourceTool.ts` | **NEU** | manage_source Tool |
| `ARCHITECTURE.md` | **NEU** | Eingebettete Architektur-Beschreibung |
| `esbuild.config.mjs` | AENDERUNG | embed-source Plugin |

### 4.7 Implementierungshinweise

- **EmbeddedSourceManager**: Dekodiert base64 Source aus EMBEDDED_SOURCE Konstante. Stellt Files als Map<string, string> bereit.
- **PluginBuilder**: Nutzt EsbuildWasmManager fuer Full-Bundle. Build-Config aus EMBEDDED_SOURCE.buildConfig.
- **PluginReloader**: Pattern von bestehendem EnablePluginTool kopieren (disablePlugin → 500ms delay → enablePlugin)
- **Rollback**: main.js.bak wird VOR jedem Build erstellt. Bei Plugin-Start-Fehler (try/catch in onload) automatischer Rollback.
- **DiffReviewModal**: Neues Modal (extends Modal) das Diff zwischen Original und Modified Source anzeigt. "Apply" / "Cancel" Buttons.

---

## 5. Console Observability + Error Self-Healing

### 5.1 ConsoleRingBuffer

Intercepted `console.debug`, `console.warn`, `console.error` und speichert Eintraege in einem Ring Buffer.

```typescript
interface LogEntry {
  timestamp: number;
  level: 'debug' | 'warn' | 'error';
  message: string;
  source?: string;          // Stack Trace (erste Zeile)
  correlatedTool?: string;  // Tool das zum Zeitpunkt lief
}

class ConsoleRingBuffer {
  private entries: LogEntry[] = [];
  private readonly maxEntries = 500;

  install(): void {
    // Wrapped console.debug/warn/error
    // Originale Funktionen bleiben erhalten
  }

  query(filter: {
    level?: string;
    since?: number;
    pattern?: string;
    limit?: number;
  }): LogEntry[] { ... }
}
```

**Implementierungshinweis**:
- Nur `console.debug`, `console.warn`, `console.error` intercepten (NICHT console.log — ist verboten per Review-Bot)
- Original-Funktion via `.bind()` sichern und nach Logging aufrufen
- Ring Buffer: Aelteste Eintraege werden ueberschrieben wenn voll
- Korrelation: Aktuell ausgefuehrtes Tool aus ToolExecutionPipeline lesen

### 5.2 Tool: `read_agent_logs`

```typescript
// Input-Schema
{
  level: 'debug' | 'warn' | 'error' | 'all',
  since: string,           // ISO timestamp oder relative ("5m", "1h")
  pattern: string,         // Regex fuer Nachricht
  limit: number,           // Max Eintraege (default: 50)
}
```

### 5.3 Neue/geaenderte Dateien

| Datei | Typ | Beschreibung |
|-------|-----|-------------|
| `src/core/observability/ConsoleRingBuffer.ts` | **NEU** | Ring Buffer + Console Interception |
| `src/core/tools/agent/ReadAgentLogsTool.ts` | **NEU** | read_agent_logs Tool |
| `src/main.ts` | AENDERUNG | ConsoleRingBuffer beim Start installieren |

---

## 6. MCP Self-Configuration

### 6.1 Tool: `manage_mcp_server`

**Actions**: add, remove, update, list, status, reconnect, test

```typescript
// Input-Schema
{
  action: 'add' | 'remove' | 'update' | 'list' | 'status' | 'reconnect' | 'test',
  server_name: string,
  config: {
    type: 'sse' | 'streamable-http',  // KEIN stdio!
    url: string,
    headers: Record<string, string>,
    timeout: number,
    disabled: boolean,
  },
}
```

**Einschraenkung**: Nur SSE und streamable-http. Kein stdio (spawnt Host-Prozesse).

### 6.2 McpClient-Erweiterungen

```typescript
// Neue Methoden in McpClient
async reconnect(name: string): Promise<void> {
  await this.disconnect(name);
  const config = this.connections.get(name)?.config;
  if (config) await this.connect(name, config);
}

async testConnection(name: string): Promise<{ success: boolean; tools: number; error?: string }> {
  const conn = this.connections.get(name);
  if (!conn?.client) return { success: false, tools: 0, error: 'Not connected' };
  try {
    const result = await conn.client.listTools();
    return { success: true, tools: result.tools?.length ?? 0 };
  } catch (e) {
    return { success: false, tools: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
```

### 6.3 Neue/geaenderte Dateien

| Datei | Typ | Beschreibung |
|-------|-----|-------------|
| `src/core/tools/agent/ManageMcpServerTool.ts` | **NEU** | manage_mcp_server Tool |
| `src/core/mcp/McpClient.ts` | AENDERUNG | reconnect() + testConnection() |
| `src/types/settings.ts` | AENDERUNG | MCP-Settings Erweiterung |

### 6.4 Implementierungshinweise

- **ManageMcpServerTool**: Folgt ConfigureModelTool Pattern (action-basiert)
- **Settings-Persistenz**: MCP-Config in `settings.mcpServers` (bereits vorhanden)
- **Tool-Cache Invalidierung**: Nach add/remove `context.invalidateToolCache()` aufrufen
- **stdio-Block**: Harte Pruefung in `add`/`update` — wenn type === 'stdio' → Error

---

## 7. Proactive Self-Improvement

### 7.1 Neue Memory-Dateien

**`errors.md`** — Wiederkehrende Fehler + Loesungen:
```markdown
## Anthropic API Timeout (2026-02-28)
- Fehler: "Request timed out after 60s"
- Kontext: Grosse Dateien (>50KB) an API senden
- Loesung: Datei in Chunks aufteilen, max 30KB pro Request
- Behoben: Ja (Patch-Module custom_patch_chunk_upload)
```

**`custom-tools.md`** — Register erstellter Dynamic Tools + Skills:
```markdown
## Skills
- daily-summary: Erstellt Tagesbericht (source: learned, success: 12)
- meeting-processor: Extrahiert Action Items (source: user, success: 5)

## Dynamic Tools
- custom_csv_converter: CSV → Markdown Tabellen
- custom_bibtex_parser: BibTeX → Obsidian Literature Notes
```

### 7.2 LongTermExtractor-Erweiterung

Bestehender LongTermExtractor erkennt neue Fact-Typen:

| Fact-Typ | Ziel-Datei | Beispiel |
|----------|-----------|---------|
| skill_created | learnings.md + custom-tools.md | "Erstellt daily-summary Skill fuer taegliche Vault-Zusammenfassung" |
| error_fixed | errors.md | "Anthropic Timeout geloest durch Chunked Upload" |
| pattern_detected | patterns.md | "User bevorzugt Bullet-Listen statt Fliesstext" |
| tool_created | custom-tools.md | "Erstellt custom_csv_converter fuer Daten-Import" |

**Implementierungshinweis**: LongTermExtractor nutzt LLM zur Fact-Extraktion. Neue Fact-Typen zum bestehenden Prompt hinzufuegen. Routing nach Fact-Typ zu Ziel-Datei.

### 7.3 SuggestionService

Analysiert Episodes und schlaegt proaktiv Verbesserungen vor:

```typescript
class SuggestionService {
  // Prueft nach jeder Session:
  // 1. Gibt es 3+ aehnliche Episodes? → Skill-Vorschlag
  // 2. Gibt es wiederkehrende Fehler? → Fix-Vorschlag
  // 3. Gibt es Daten-Transformationen die sich wiederholen? → Tool-Vorschlag

  async analyzeSessions(): Promise<Suggestion[]> { ... }
}
```

**Integration**: Nach Session-Ende (in SessionExtractor) → SuggestionService pruefen → Vorschlaege in naechster Session anzeigen.

### 7.4 Pre-Compaction Memory Flush

**In AgentTask.ts, VOR Context-Condensing**:

```typescript
// Vor dem Condensing-Prompt
if (this.shouldCondense()) {
  // Erst Memory Flush
  const flushPrompt = `Before we compress context, please save any important
  learnings, patterns, or errors to memory using the appropriate tools.
  What have you learned in this conversation that should be remembered?`;

  await this.executeFlushTurn(flushPrompt);

  // Dann Condensing
  await this.condenseContext();
}
```

**Implementierungshinweis**: Neuer Turn im Conversation-Loop vor Condensing. Agent bekommt einen Prompt der ihn auffordert wichtige Erkenntnisse zu persistieren. Danach normales Condensing.

### 7.5 Neue/geaenderte Dateien

| Datei | Typ | Beschreibung |
|-------|-----|-------------|
| `src/core/mastery/SuggestionService.ts` | **NEU** | Proaktive Verbesserungsvorschlaege |
| `src/core/memory/LongTermExtractor.ts` | AENDERUNG | Neue Fact-Typen + Routing |
| `src/core/memory/MemoryService.ts` | AENDERUNG | errors.md + custom-tools.md als Memory-Dateien |
| `src/core/AgentTask.ts` | AENDERUNG | Pre-Compaction Memory Flush |

---

## 8. Implementation Phases

### Phase 1: Foundation (Observability + MCP)

**Scope**: ConsoleRingBuffer, read_agent_logs, manage_mcp_server, McpClient-Erweiterungen

**Neue Dateien** (3):
- `src/core/observability/ConsoleRingBuffer.ts`
- `src/core/tools/agent/ReadAgentLogsTool.ts`
- `src/core/tools/agent/ManageMcpServerTool.ts`

**Geaenderte Dateien** (4):
- `src/main.ts` (ConsoleRingBuffer installieren)
- `src/core/mcp/McpClient.ts` (reconnect + testConnection)
- `src/core/tools/ToolRegistry.ts` (neue Tools registrieren)
- `src/types/settings.ts` (Settings-Erweiterungen)

**Geschaetzter Aufwand**: ~500 LOC neu, ~100 LOC geaendert

### Phase 2: Skill Self-Authoring

**Scope**: SelfAuthoredSkillLoader, manage_skill, SKILL.md Format, Hot-Reload, Bundled Meta-Skill

**Neue Dateien** (3):
- `src/core/skills/SelfAuthoredSkillLoader.ts`
- `src/core/tools/agent/ManageSkillTool.ts`
- `skills/skill-creator/SKILL.md`

**Geaenderte Dateien** (4):
- `src/core/skills/SkillRegistry.ts`
- `src/core/mastery/RecipeMatchingService.ts`
- `src/core/systemPrompt.ts`
- `src/types/settings.ts`

**Geschaetzter Aufwand**: ~600 LOC neu, ~150 LOC geaendert

### Phase 3: Dynamic Modules

**Scope**: esbuild-wasm, VmSandbox, AstValidator, DynamicToolLoader/Factory, create_dynamic_tool, evaluate_expression

**Neue Dateien** (7):
- `src/core/sandbox/VmSandbox.ts`
- `src/core/sandbox/AstValidator.ts`
- `src/core/sandbox/EsbuildWasmManager.ts`
- `src/core/tools/dynamic/DynamicToolLoader.ts`
- `src/core/tools/dynamic/DynamicToolFactory.ts`
- `src/core/tools/agent/CreateDynamicToolTool.ts`
- `src/core/tools/agent/EvaluateExpressionTool.ts`

**Geaenderte Dateien** (3):
- `src/core/tools/ToolRegistry.ts`
- `src/main.ts`
- `src/types/settings.ts`

**Geschaetzter Aufwand**: ~1200 LOC neu, ~100 LOC geaendert

### Phase 4: Core Self-Modification

**Scope**: Source-Embedding, EmbeddedSourceManager, PluginBuilder, PluginReloader, manage_source, ARCHITECTURE.md

**Neue Dateien** (5):
- `src/core/self-development/EmbeddedSourceManager.ts`
- `src/core/self-development/PluginBuilder.ts`
- `src/core/self-development/PluginReloader.ts`
- `src/core/tools/agent/ManageSourceTool.ts`
- `ARCHITECTURE.md`

**Geaenderte Dateien** (1):
- `esbuild.config.mjs` (embed-source Plugin)

**Geschaetzter Aufwand**: ~800 LOC neu, ~100 LOC geaendert

### Phase 5: Proactive Self-Improvement

**Scope**: SuggestionService, Memory-Erweiterungen, Pre-Compaction Flush, neue Memory-Dateien

**Neue Dateien** (1):
- `src/core/mastery/SuggestionService.ts`

**Geaenderte Dateien** (4):
- `src/core/memory/LongTermExtractor.ts`
- `src/core/memory/MemoryService.ts`
- `src/core/AgentTask.ts`
- `src/core/systemPrompt.ts`

**Geschaetzter Aufwand**: ~400 LOC neu, ~200 LOC geaendert

### Gesamtuebersicht

| Phase | Neue Files | Geaenderte Files | ~LOC neu | ~LOC geaendert |
|-------|-----------|-----------------|---------|---------------|
| 1: Foundation | 3 | 4 | 500 | 100 |
| 2: Skills | 3 | 4 | 600 | 150 |
| 3: Dynamic Modules | 7 | 3 | 1200 | 100 |
| 4: Core Self-Mod | 5 | 1 | 800 | 100 |
| 5: Self-Improvement | 1 | 4 | 400 | 200 |
| **Gesamt** | **19** | **~12 unique** | **~3500** | **~650** |

---

## 9. Verification Plan

### Phase 1: Foundation

| Test | Erwartung |
|------|----------|
| Error provozieren → `read_agent_logs` | Agent findet Error im Ring Buffer |
| Agent schlaegt Fix via Patch-Module vor | Fix-Vorschlag korrekt |
| "Verbinde MCP Server auf localhost:3000" | manage_mcp_server konfiguriert + verbindet (SSE/HTTP) |
| stdio MCP Server versuchen | Harte Ablehnung mit Erklaerung |
| reconnect nach Verbindungsverlust | McpClient.reconnect() stellt Verbindung her |

### Phase 2: Skills

| Test | Erwartung |
|------|----------|
| "Erstelle Skill fuer Meeting Notes" | SKILL.md geschrieben mit korrektem Frontmatter |
| manage_skill validate | Frontmatter + requiredTools geprueft |
| SKILL.md manuell bearbeiten | Hot-Reload, sofort im naechsten Turn verfuegbar |
| Skill-Creator Meta-Skill | Bundled, nicht loeschbar |
| 50+ Skills geladen | System Prompt bleibt schlank (nur Metadata) |

### Phase 3: Dynamic Modules

| Test | Erwartung |
|------|----------|
| esbuild-wasm erstmals benoetigt | User-Abfrage → Download → lokal gespeichert |
| "Erstelle Tool das CSV→Markdown konvertiert" | TS geschrieben → kompiliert → geladen → funktioniert |
| Modul mit `require('fs')` | AstValidator blockiert vor Kompilierung |
| Modul mit `eval()` | AstValidator blockiert |
| evaluate_expression: Regex Test | Korrekte Ausfuehrung in vm-Sandbox |
| Tool mit >30s Ausfuehrung | Timeout, sauber abgebrochen |

### Phase 4: Core Self-Modification

| Test | Erwartung |
|------|----------|
| Agent liest embedded Source | EmbeddedSourceManager dekodiert korrekt |
| Agent liest ARCHITECTURE.md | Versteht Architektur |
| Bug provozieren → Agent fixt | Patch-Module zuerst, dann ggf. Full Rebuild |
| Full Rebuild | ~20-30s, DiffReview, main.js ersetzt |
| Build-Fehler | Agent bekommt esbuild Output → fixt → baut erneut |
| Fehlerhafter Build | Rollback auf main.js.bak |

### Phase 5: Self-Improvement

| Test | Erwartung |
|------|----------|
| 3x aehnlichen Task ausfuehren | Agent schlaegt Skill-Erstellung vor |
| Fehler wiederholt sich | Agent findet Loesung in errors.md |
| Lange Session vor Condensing | Pre-Compaction Flush → Wissen in Memory gespeichert |
| Skill erstellt | custom-tools.md + learnings.md aktualisiert |

---

## Appendix: Datei-Index

### Alle neuen Dateien (19)

```
src/core/observability/ConsoleRingBuffer.ts
src/core/tools/agent/ReadAgentLogsTool.ts
src/core/tools/agent/ManageMcpServerTool.ts
src/core/skills/SelfAuthoredSkillLoader.ts
src/core/tools/agent/ManageSkillTool.ts
skills/skill-creator/SKILL.md
src/core/sandbox/VmSandbox.ts
src/core/sandbox/AstValidator.ts
src/core/sandbox/EsbuildWasmManager.ts
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

### Alle geaenderten Dateien (~12 unique)

```
src/main.ts
src/core/AgentTask.ts
src/core/tools/ToolRegistry.ts
src/core/skills/SkillRegistry.ts
src/core/mastery/RecipeMatchingService.ts
src/core/systemPrompt.ts
src/core/mcp/McpClient.ts
src/core/memory/LongTermExtractor.ts
src/core/memory/MemoryService.ts
src/types/settings.ts
esbuild.config.mjs
```
