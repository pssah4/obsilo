# Anthropic SDK Upgrade v0.30.1 -> v0.78.0

**Status:** Geplant (noch nicht umgesetzt)
**Branch:** `anthropicsdk-update`
**Risiko:** NIEDRIG
**Analyse:** `_private/analysis/anthropic-sdk-upgrade-analysis.md`

---

## Context

Das Anthropic SDK liegt 48 Minor-Versionen zurueck (v0.30.1, Oktober 2024). Der SCAN-Report identifiziert dies als MAINT-Issue. Kritische Gruende:

- **Memory-Leak-Fix** fuer AbortSignals (v0.73.0) — relevant fuer langlebige Agent-Loops
- **Typsichere Thinking-Events** (v0.37.0+) — eliminiert 3 `any`-Casts
- **Sicherheitspatches** aus 48 Releases
- **Extended Thinking** Streaming-Code ist bereits implementiert, aber nie aktiviert (API-Request sendet kein `thinking`-Param)
- SDK-Nutzung beschraenkt auf eine Datei (`src/api/providers/anthropic.ts`), isoliert durch `ApiStream`-Abstraktion

---

## Betroffene Dateien

| Datei | Aenderung |
|-------|-----------|
| `package.json` | SDK Version `^0.30.0` -> `^0.78.0` |
| `src/api/providers/anthropic.ts` | `any`-Casts entfernen, Thinking aktivieren, Caching, BUG-3 |
| `src/types/settings.ts` | `CustomModel` + `LLMProvider` um neue Felder erweitern |
| `src/ui/settings/ModelConfigModal.ts` | UI fuer Thinking + Caching Settings (Anthropic-spezifisch) |
| `src/api/types.ts` | `ApiStreamChunk` um Cache-Usage-Felder erweitern |

---

## Phase 1: SDK Update + Typ-Bereinigung (Kernschritt)

### Schritt 1.1 — Dependency aktualisieren

```bash
npm install @anthropic-ai/sdk@^0.78.0
```

### Schritt 1.2 — `any`-Casts entfernen (MAINT-5)

Datei: `src/api/providers/anthropic.ts`

**Zeile 98** — `content_block_start`:
```typescript
// VORHER:
} else if ((event.content_block as any).type === 'thinking') {
// NACHHER:
} else if (event.content_block.type === 'thinking') {
```

**Zeile 114** — `content_block_delta`:
```typescript
// VORHER:
if ((event.delta as any).type === 'thinking_delta') {
// NACHHER:
if (event.delta.type === 'thinking_delta') {
```

**Zeile 117** — Thinking-Text:
```typescript
// VORHER:
const chunk = (event.delta as any).thinking as string;
// NACHHER:
const chunk = event.delta.thinking;
```

Falls der TypeScript-Compiler die Thinking-Typen nicht in der Union erkennt, exakte Typnamen aus dem neuen SDK pruefen und Type-Guards anpassen.

### Schritt 1.3 — Build verifizieren

```bash
npm run build
```

---

## Phase 2: Extended Thinking aktivieren

**Erkenntnis:** Der Streaming-Parser fuer Thinking-Blocks existiert bereits (`thinkingAccumulator`, Zeilen 77-121), die UI zeigt "Reasoning"-Abschnitte (`AgentSidebarView.ts`), und `AgentTask` hat `onThinking`-Callback. **Aber**: Der API-Request aktiviert Extended Thinking nicht — es fehlt der `thinking`-Parameter im `.stream()`-Aufruf.

### Schritt 2.1 — Settings erweitern

Datei: `src/types/settings.ts`

Neue optionale Felder in `CustomModel` und `LLMProvider`:
```typescript
thinkingEnabled?: boolean;
thinkingBudgetTokens?: number;  // Default: 10000
```

`modelToLLMProvider()` aktualisieren, damit die Felder durchgereicht werden.

### Schritt 2.2 — UI erweitern

Datei: `src/ui/settings/ModelConfigModal.ts`

Zwei neue Formularfelder, nur sichtbar wenn `provider === 'anthropic'`:
- Toggle "Extended Thinking" (boolean)
- Slider/Input "Thinking Budget" (number, 1000-100000, Default 10000)

Muster: Gleicher Ansatz wie der bestehende Temperature-Toggle + Slider.

### Schritt 2.3 — Thinking im API-Request aktivieren

Datei: `src/api/providers/anthropic.ts`, im `.stream()`-Aufruf (Zeilen 57-68):

```typescript
const params: Record<string, any> = {
    model: this.config.model,
    max_tokens: this.config.maxTokens ?? 8192,
    temperature: Math.min(this.config.temperature ?? 0.2, 1.0),
    system: systemPrompt,
    messages: anthropicMessages,
    tools: anthropicTools.length > 0 ? anthropicTools : undefined,
    tool_choice: anthropicTools.length > 0 ? { type: 'auto' } : undefined,
};

if (this.config.thinkingEnabled) {
    params.thinking = {
        type: 'enabled',
        budget_tokens: this.config.thinkingBudgetTokens ?? 10000,
    };
    // Anthropic erfordert temperature=1 bei Extended Thinking
    params.temperature = 1;
}

const stream = await this.client.messages.stream(params, { signal: abortSignal });
```

**Wichtig:** Anthropic erzwingt `temperature: 1` wenn Extended Thinking aktiviert ist.

---

## Phase 3: Prompt Caching

Automatisches Prompt Caching (v0.78.0) senkt Token-Kosten bei iterativen Agent-Loops signifikant, da System-Prompt und fruehe Nachrichten gecacht werden.

### Schritt 3.1 — Settings erweitern

Neues optionales Feld in `CustomModel` und `LLMProvider`:
```typescript
promptCachingEnabled?: boolean;  // Default: true fuer Anthropic
```

### Schritt 3.2 — Cache-Control-Marker setzen

Datei: `src/api/providers/anthropic.ts`

In `convertMessages()` oder vor dem `.stream()`-Aufruf: `cache_control: { type: 'ephemeral' }` an den System-Prompt und die letzten N User-Nachrichten anhaengen.

```typescript
if (this.config.promptCachingEnabled !== false) {
    const systemWithCache = [{
        type: 'text' as const,
        text: systemPrompt,
        cache_control: { type: 'ephemeral' as const },
    }];
    params.system = systemWithCache;
}
```

### Schritt 3.3 — Cache-Nutzung in Usage-Chunk melden

`message_start`-Event enthaelt `usage.cache_read_input_tokens` und `usage.cache_creation_input_tokens`. Diese in den Usage-Chunk aufnehmen.

Datei: `src/api/types.ts` — `ApiStreamChunk` um optionale Cache-Felder erweitern:
```typescript
| { type: 'usage'; inputTokens: number; outputTokens: number;
    cacheReadTokens?: number; cacheCreationTokens?: number }
```

---

## Phase 4: BUG-3 Fix

### Schritt 4.1 — Tool-Parse-Error korrekt melden

Datei: `src/api/providers/anthropic.ts`, Zeilen 134-137

```typescript
// VORHER — Error als text-Chunk (falsch):
yield {
    type: 'text',
    text: `[Tool input parse error for "${tool.name}": ${(e as Error).message}]`,
} satisfies ApiStreamChunk;

// NACHHER — tool_use mit Fehler-Marker:
yield {
    type: 'tool_use',
    id: tool.id,
    name: tool.name,
    input: { __parse_error: (e as Error).message },
} satisfies ApiStreamChunk;
```

---

## Nicht in Scope (eigene Tickets)

- **Structured Outputs** (`output_config`) — erfordert agentur-weite Aenderungen
- **Autocompaction** — Alternative zu eigenem Condensing, Evaluierung noetig
- **MCP SDK Helpers** — erfordert Umbau der MCP-Integration
- **Effort-Steuerung** — sinnvoll erst nach Extended Thinking Erfahrungen
- **Web Search Tool, Code Execution Tool, Files API** — eigenstaendige Features

---

## Verifikation

1. `npm run build` — keine Typ-Fehler
2. Plugin in Obsidian deployen
3. Smoke-Tests:
   - Text-Streaming mit Anthropic-Modell
   - Tool-Aufruf (z.B. `read_file`) — korrekte Ausfuehrung
   - Extended Thinking einschalten — "Reasoning"-Section erscheint in UI
   - Thinking Budget aendern — Budget wird an API gesendet
   - Prompt Caching — Usage-Anzeige zeigt Cache-Hits
   - AbortSignal — Abbruch funktioniert ohne Memory Leak
   - Non-Anthropic-Provider (OpenAI) — keine Regression
