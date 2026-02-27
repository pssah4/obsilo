# Analyse: Upgrade @anthropic-ai/sdk auf v0.78.0

**Datum:** 27. Februar 2026
**Aktuell installiert:** 0.30.1 (veröffentlicht 23. Oktober 2024)
**Zielversion:** 0.78.0 (veröffentlicht 19. Februar 2026)
**Versionsdelta:** 48 Minor-Versionen

---

## 1. Zusammenfassung

Ein Update von `@anthropic-ai/sdk` 0.30.1 auf 0.78.0 ist **grundsätzlich rückwirkungsfrei möglich**, da die Anthropic SDK semantische Versionierung befolgt und in den 48 Minor-Releases keine Breaking Changes auf API-Ebene markiert wurden (der letzte Breaking Change war v0.14.0 — Messages API GA im Februar 2024, also weit vor unserer aktuellen Version).

**Risikobewertung: NIEDRIG**

Die drei zentralen Berührungspunkte unseres Codes mit dem SDK — Client-Konstruktor, `messages.stream()` und die Streaming-Event-Typen — sind vollständig stabil geblieben. Das Update würde sogar bestehende Code-Probleme lösen, insbesondere die `any`-Casts für Extended Thinking und den fehlenden Typ-Support für `thinking_delta`-Events.

---

## 2. Aktuelle SDK-Nutzung im Plugin

Unser Code nutzt das SDK ausschließlich in **einer einzigen Datei**: `src/api/providers/anthropic.ts` (~210 Zeilen).

### 2.1 Genutzte SDK-Oberflächen

| Stelle | SDK-API | Zeile |
|--------|---------|-------|
| Import | `import Anthropic from '@anthropic-ai/sdk'` | L11 |
| Client-Konstruktor | `new Anthropic({ apiKey, baseURL, dangerouslyAllowBrowser })` | L23–27 |
| Streaming | `this.client.messages.stream(params, { signal })` | L62–74 |
| Tool-Typen | `Anthropic.Tool`, `Anthropic.Tool.InputSchema` | L54-56 |
| Message-Typen | `Anthropic.MessageParam` | L172 |
| Stream-Events | `message_start`, `message_delta`, `content_block_start`, `content_block_delta`, `content_block_stop` | L86–152 |

### 2.2 Bekannte Workarounds im Code

```typescript
// anthropic.ts L108 — any-Cast für thinking
(event.content_block as any).type === 'thinking'

// anthropic.ts L122 — any-Cast für thinking_delta 
(event.delta as any).type === 'thinking_delta'
const chunk = (event.delta as any).thinking as string;
```

Diese `any`-Casts sind nötig, weil SDK v0.30.x keine Typen für Extended Thinking enthält. Ab v0.37.0 sind diese Typen first-class — das Update würde die Casts überflüssig machen.

---

## 3. Rückwirkungsfreiheit — Detailanalyse

### 3.1 Client-Konstruktor ✅ Kompatibel

```typescript
new Anthropic({
    apiKey: config.apiKey ?? '',
    baseURL: config.baseUrl,
    dangerouslyAllowBrowser: true,
})
```

Die Signatur ist stabil geblieben. Neue optionale Parameter wie `logLevel`, `logger`, `fetchOptions` und `maxRetries` erfordern keine Änderung.

### 3.2 `messages.stream()` ✅ Kompatibel

```typescript
this.client.messages.stream({
    model, max_tokens, temperature, system,
    messages, tools, tool_choice
}, { signal: abortSignal })
```

Die Methode und ihre Parameter sind unverändert. Neue optionale Felder (z.B. `output_config` für Structured Output) sind additiv.

### 3.3 Streaming-Events ✅ Kompatibel

| Event-Typ | Genutzt in v0.30 | Status in v0.78 |
|-----------|-------------------|-----------------|
| `message_start` | ✅ | Unverändert |
| `message_delta` | ✅ | Unverändert |
| `content_block_start` (text, tool_use) | ✅ | Unverändert |
| `content_block_delta` (text_delta, input_json_delta) | ✅ | Unverändert¹ |
| `content_block_stop` | ✅ | Unverändert |

¹ Ab v0.40.0 wurden ContentBlockDelta-Events in eigene Schemas extrahiert. Dies ist eine Typ-Refaktorierung; das Runtime-Verhalten (die JSON-Payloads) ist identisch.

### 3.4 Typ-Definitionen ✅ Kompatibel (mit Verbesserungen)

| Typ | v0.30 | v0.78 |
|-----|-------|-------|
| `Anthropic.Tool` | ✅ | ✅ Unverändert |
| `Anthropic.Tool.InputSchema` | ✅ | ✅ Unverändert |
| `Anthropic.MessageParam` | ✅ | ✅ Erweitert (neue Content-Block-Typen) |
| Thinking-Typen | ❌ (any-Casts nötig) | ✅ First-class seit v0.37.0 |

### 3.5 Potenzielles Risiko: Node.js-Version

Ab v0.50.0 wurde Support für EOL-Node-Versionen entfernt. Dies betrifft unser Plugin **nicht**, da es in Obsidians Electron-Runtime läuft (Chromium-basiert, Node 20+).

### 3.6 Agent Loop Auswirkung ✅ Keine

Die `AgentTask`-Klasse (`src/core/AgentTask.ts`) konsumiert ausschließlich unsere interne `ApiStream`-Abstraktion (Typen in `src/api/types.ts`):

```typescript
type ApiStreamChunk =
    | { type: 'text'; text: string }
    | { type: 'thinking'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, any> }
    | { type: 'usage'; inputTokens: number; outputTokens: number };
```

Die Anthropic-Provider-Klasse überführt SDK-Events in diese internen Typen. Solange diese Übersetzung funktioniert — und sie tut es, da die Events stabil blieben — ist die Agent Loop vollständig isoliert vom SDK-Update.

---

## 4. Neue Fähigkeiten und Verbesserungen

### 4.1 Sofort nutzbar (kein Code nötig)

| Feature | SDK-Version | Beschreibung |
|---------|-------------|--------------|
| **Memory-Leak-Fix für AbortSignals** | v0.73.0 | Behebt Memory Leak im Abort-Signal-Handling — kritisch für langlebige Agent-Loops |
| **Sicherheitspatches** | v0.31–0.78 | Diverse Bugfixes in Streaming-Serialisierung, Fehlerbehandlung, Credential-Handling |
| **Neue Modelle** | Diverse | Claude Sonnet 4.5, Opus 4.5, Opus 4.6, Sonnet 4.6 — alle direkt über Model-String nutzbar |

### 4.2 Mit minimalem Code nutzbar

| Feature | SDK-Version | Beschreibung | Aufwand |
|---------|-------------|--------------|---------|
| **Typsichere Thinking-Events** | v0.37.0 | `any`-Casts in anthropic.ts entfernen | 30 Min |
| **Automatic Caching (Cache Control)** | v0.78.0 | Top-Level Cache-Control-Header für automatisches Prompt-Caching | 1–2 Std |
| **Fast-Mode (Opus 4.6)** | v0.74.0 | Schnellere Responses für Opus 4.6 durch neuen Modus | 1 Std |
| **Structured Outputs** | v0.72.0 | JSON-Schema-basierte Output-Validierung über `output_config` | 2–4 Std |
| **Adaptive Thinking** | v0.73.0 | Budget-basiertes Thinking mit `thinking.budget_tokens` | 1–2 Std |

### 4.3 Mit moderatem Aufwand nutzbar

| Feature | SDK-Version | Beschreibung | Aufwand |
|---------|-------------|--------------|---------|
| **MCP SDK Helpers** | v0.72.0 | `mcpTools()`, `mcpMessages()`, `mcpResourceToContent()` — Konvertierung zwischen MCP- und Anthropic-Typen | 4–8 Std |
| **toolRunner() Helper** | v0.63.0 | SDK-seitiger automatischer Tool-Loop mit Zod-Schemas | Evaluierung nötig (Alternative zu unserem AgentTask) |
| **Web Search Tool** | v0.50.0 | Anthropic-native Web-Suche als Tool | 4–8 Std |
| **Code Execution Tool** | v0.52.0 | Server-seitige Code-Ausführung | 4–8 Std |
| **Documents in Tool Results** | v0.62.0 | PDF/Dokument-Inhalte direkt in Tool-Responses | 2–4 Std |
| **Files API** | v0.52.0 | Datei-Upload und -Referenzierung für große Kontexte | 4–8 Std |
| **Message Batches API** | v0.72.0 | Batch-Verarbeitung für asynchrone Workloads | 4–8 Std |
| **Autocompaction** | v0.71.0 | SDK-seitige Kontext-Komprimierung | Evaluierung nötig (Alternative zu unserer Condensing-Logik) |
| **Effort-Steuerung** | v0.71.0 | Steuerung des Reasoning-Aufwands pro Request | 1–2 Std |

---

## 5. Implementierungsplan

### Phase 1: SDK-Update (Low Risk, 1–2 Stunden)

1. **Dependency aktualisieren:**
   ```bash
   npm install @anthropic-ai/sdk@^0.78.0
   ```

2. **Build verifizieren:**
   ```bash
   npm run build
   ```

3. **`any`-Casts entfernen** in `src/api/providers/anthropic.ts`:
   ```typescript
   // VORHER (v0.30.x):
   if ((event.content_block as any).type === 'thinking') { ... }
   if ((event.delta as any).type === 'thinking_delta') { ... }
   
   // NACHHER (v0.78.0):
   if (event.content_block.type === 'thinking') { ... }
   if (event.delta.type === 'thinking_delta') { ... }
   ```

4. **Smoke-Test:** Agent Loop starten, Text-Streaming, Tool-Aufrufe und Thinking-Blocks manuell testen.

### Phase 2: Quick Wins (Optional, je 1–2 Stunden)

5. **BUG-3 Fix** (aus SCAN-Report): Tool-Parse-Error als error-typed Chunk anstatt Text-Chunk yielden — unabhängig vom SDK-Update, aber guter Zeitpunkt.

6. **Automatic Caching aktivieren:** Cache-Control-Header setzen, um bei wiederholten Iterationen im Agent Loop Token-Kosten zu senken.

7. **Effort-Parameter exponieren:** In den Plugin-Settings eine Option für "Thinking Effort" (low/medium/high) ergänzen.

### Phase 3: Feature-Evaluation (Optional, mehrere Sprints)

8. **Structured Outputs** evaluieren für deterministische Tool-Responses.
9. **Autocompaction** evaluieren als Alternative/Ergänzung zum bestehenden Condensing in `AgentTask`.
10. **MCP SDK Helpers** evaluieren für vereinfachte MCP-Tool-Integration.

---

## 6. Risikomatrix

| Risiko | Wahrscheinlichkeit | Auswirkung | Mitigation |
|--------|--------------------|-----------|----|
| Typ-Inkompatibilität bei ContentBlockDelta | Gering | Mittel | Build-Test vor Deployment; TypeScript-Compiler fängt Fehler |
| Runtime-Verhaltensänderung im Streaming | Sehr gering | Hoch | Manueller Smoke-Test mit allen Event-Typen |
| Bundle-Size-Erhöhung | Gering | Niedrig | SDK v0.78 ist ~3 MB unpacked vs. ~1.5 MB; Delta im Bundle ist kleiner |
| Electron/Browser-Kompatibilität | Sehr gering | Hoch | `dangerouslyAllowBrowser: true` ist weiterhin unterstützt |
| Transitive Dependency-Konflikte | Gering | Mittel | SDK hat nur 1 Dependency; Pre-Check mit `npm ls` |

---

## 7. Empfehlung

**Sofortige Umsetzung von Phase 1 empfohlen.**

Begründung:
- **Sicherheit:** 48 Versionen ohne Update akkumulieren Sicherheitsrisiken (im SCAN als MAINT-Issue identifiziert)
- **Memory Leak:** Der Fix für AbortSignal-Memory-Leaks in v0.73.0 ist direkt relevant für langlebige Agent-Loops
- **Code-Qualität:** Entfernung der `any`-Casts verbessert Typsicherheit und Wartbarkeit (MAINT-5 aus SCAN-Report)
- **Risikoarm:** Unsere SDK-Nutzung ist minimal und durch die interne `ApiStream`-Abstraktion gut isoliert
- **Kostensenkung:** Automatic Caching (v0.78.0) kann Token-Kosten in iterativen Agent-Loops signifikant senken

---

## 8. Referenzen

- [Anthropic SDK Changelog](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/CHANGELOG.md)
- [npm: @anthropic-ai/sdk](https://www.npmjs.com/package/@anthropic-ai/sdk)
- [SDK Releases](https://github.com/anthropics/anthropic-sdk-typescript/releases)
- SCAN-Report: `_private/analysis/SCAN_obsilo-agent_2026-02-27.md` (MAINT-5, BUG-3, Outdated SDKs)
