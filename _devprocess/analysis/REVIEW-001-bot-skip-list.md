# Review-Bot /skip Liste

**Datum:** 2026-03-02 (aktualisiert 2026-03-02 18:52 UTC)
**PR:** obsidianmd/obsidian-releases#10565
**Letzter Bot-Kommentar:** #issuecomment-3986230479

---

## Kontext

Nach 3 Runden Fixes (~500 -> ~200 -> ~116 -> 103 Findings) verbleiben 103 Findings,
die bewusst nicht gefixt werden können ohne Funktionsverlust oder Regressionen.
Fuer diese wird `/skip` mit Begruendung auf den PR gepostet.

---

## PR-Kommentar (Copy & Paste)

Der folgende Text kann direkt auf den PR gepostet werden:

---

## /skip Kommentar (englisch)

```
/skip

The following remaining findings are intentional or cannot be changed without causing regressions:

**1. "Async method has no 'await' expression" (11 methods: handleError x2, cleanup, vaultList, execute x4, handleOpenTab, listNames, onClose)**

These methods implement interfaces or abstract base classes that require `Promise<void>` or `Promise<T>` return types (e.g. `BaseTool.execute()`, `ToolCallbacks.handleError()`, `View.onClose()`). All call sites use `await`. Removing `async` would break the interface contract and cause TypeScript compilation errors. The methods are async because their contract requires it, not because they currently perform async operations -- future changes may add await expressions.

**2. "SSEClientTransport is deprecated" (McpClient.ts)**

The MCP SDK deprecation notice itself states: "clients may need to support both transports during the migration period." Our code already supports both SSE and StreamableHTTPClientTransport via a config toggle. Removing SSE support would break connections to MCP servers that only support SSE. We default to streamable-http for new connections and will remove SSE once the migration period ends.

**3. "Avoid setting styles directly via element.style.setProperty" (6 occurrences in AgentSidebarView + ToolPickerPopover)**

All `style.setProperty()` calls are for dynamically computed positioning values (top, left, max-height, width) that depend on runtime measurements like `getBoundingClientRect()`. These cannot be replaced with static CSS classes because the values are calculated per-render. This is the standard Obsidian plugin pattern for floating UI elements like popovers and popups.

**4. "Promise-returning method provided where a void return was expected by extended/implemented type 'Plugin'" (main.ts onunload)**

`async onunload()` is the standard Obsidian plugin lifecycle pattern used by virtually all community plugins. The Plugin base class declares `onunload(): void` but the async override is required for cleanup operations that involve async work (disconnecting MCP servers, syncing data). This matches the same pattern as `async onload()` which is explicitly documented in the Obsidian developer docs.

**5. Deprecated settings fields: chatHistoryFolder, write**

These fields are intentionally marked `@deprecated` with JSDoc annotations. They are migration shims kept for backwards compatibility with user settings from older plugin versions. The `loadSettings()` method migrates them to their replacements on first load. Removing them would cause data loss for users upgrading from earlier versions.

**6. "Unnecessary character escape `\[` in character class" (SemanticIndexService.ts:L525)**

The regex uses `\[` and `\]` inside a character class to match literal bracket characters. While the linter flags `\[` as unnecessary, removing the escape from `]` causes it to close the character class prematurely, turning the remainder into invalid syntax (`SyntaxError: Nothing to repeat`). Keeping both `\[` and `\]` escaped is required for correctness. Confirmed by runtime crash when the escapes were removed.

**7. "Use sentence case for UI text" (74 occurrences in en.ts + ModelConfigModal.ts)**

The remaining flagged strings contain proper nouns (Ollama, LM Studio, Anthropic, OpenAI, Google AI Studio, Azure, Gemini, Mistral, Groq, Brave, Tavily, Pandoc), standard acronyms (API, MCP, LLM, AI, URL, PDF, SDK, HTTP, CDN), tool names (web_fetch, web_search, semantic_search, use_mcp_tool), and technical identifiers (gpt-4o, http://localhost:11434). All generic UI labels have been converted to sentence case; only brand names, acronyms, and technical identifiers remain uppercase. Lowercasing these would be factually incorrect.
```

---

## Betroffene Dateien (nicht geaendert)

| # | Finding | Dateien | Stellen | Begruendung |
|---|---------|---------|---------|-------------|
| 1 | async ohne await | `AgentTask.ts`, `main.ts`, Tools (4x), `SandboxBridge.ts`, `DynamicToolLoader.ts`, `GitCheckpointService.ts`, `AgentSidebarView.ts` | 11 | Interface-Contract erfordert `Promise<T>` Return-Type |
| 2 | SSEClientTransport deprecated | `McpClient.ts` | 1 | Migrationsperiode, SSE-Server noch aktiv |
| 3 | style.setProperty | `AgentSidebarView.ts`, `ToolPickerPopover.ts` | 6 | Dynamische Positionierung, runtime-berechnet |
| 4 | async onunload | `main.ts` | 1 | Standard Obsidian Plugin Pattern |
| 5 | Deprecated Settings | `main.ts` (8x), `InterfaceTab.ts` (1x) | 9 | Migrations-Shims fuer Abwaertskompatibilitaet |
| 6 | Unnecessary escape `\[` | `SemanticIndexService.ts:L525` | 1 | Runtime-Crash bei Entfernung (verifiziert) |
| 7 | Sentence case | `en.ts` (73x), `ModelConfigModal.ts` (1x) | 74 | Proper Nouns, Akronyme, Tool-Namen, technische Identifier |

**Gesamt Skip: 103 Findings**

---

## Fix-Historie

| Runde | Datum | Commit | Findings vorher | Findings nachher | Gefixt |
|-------|-------|--------|-----------------|------------------|--------|
| R1 | 2026-03-02 | mehrere | ~500 | ~200 | ~300 (sentence case, floating promises, type assertions, innerHTML, console.log, fetch, require, configDir, etc.) |
| R2 | 2026-03-02 | 368b0f8 | ~200 | ~116 | ~84 (regex escapes, type assertions, floating promises) |
| R3 | 2026-03-02 | mehrere | ~116 | 103 (final) | ~13 (type assertions, unused imports, sentence case duplicates) |

**Verbleibende 103 Findings:** Alle mit `/skip` begründet (siehe oben)
