# Review-Bot /skip Liste

**Datum:** 2026-03-02
**PR:** obsidianmd/obsidian-releases#10565
**Bot-Kommentar:** #issuecomment-3980771849

---

## Kontext

Nach Implementierung aller sicheren Fixes (~470 Findings) verbleiben die folgenden
Findings, die bewusst nicht gefixt werden. Fuer diese wird `/skip` mit Begruendung
auf den PR gepostet.

---

## /skip Kommentar (englisch, zum Posten auf den PR)

```
/skip

The following remaining findings are intentional or cannot be changed without causing regressions:

**1. "Async method has no 'await' expression" (10 methods: handleError, execute x4, cleanup, vaultList, handleOpenTab, listNames)**

These methods implement interfaces or abstract base classes that require `Promise<void>` or `Promise<T>` return types (e.g. `BaseTool.execute()`, `ToolCallbacks.handleError()`). All call sites use `await`. Removing `async` would break the interface contract and cause TypeScript compilation errors. The methods are async because their contract requires it, not because they currently perform async operations -- future changes may add await expressions.

**2. "SSEClientTransport is deprecated" (McpClient.ts)**

The MCP SDK deprecation notice itself states: "clients may need to support both transports during the migration period." Our code already supports both SSE and StreamableHTTPClientTransport via a config toggle. Removing SSE support would break connections to MCP servers that only support SSE. We default to streamable-http for new connections and will remove SSE once the migration period ends.

**3. "Avoid setting styles directly via element.style.setProperty" (29 occurrences in UI code)**

All `style.setProperty()` calls are for dynamically computed positioning values (top, left, max-height, width) that depend on runtime measurements like `getBoundingClientRect()`. These cannot be replaced with static CSS classes because the values are calculated per-render. This is the standard Obsidian plugin pattern for floating UI elements like popovers and popups.

**4. "Promise-returning method provided where a void return was expected by extended/implemented type 'Plugin'" (main.ts onload)**

`async onload()` is the standard Obsidian plugin lifecycle pattern used by virtually all community plugins. The Plugin base class declares `onload(): void` but the async override is required for plugin initialization that involves async operations (loading settings, indexing). This is explicitly documented in the Obsidian developer docs.

**5. Deprecated settings fields: chatHistoryFolder, write, autoApprovalRules**

These fields are intentionally marked `@deprecated` with JSDoc annotations. They are migration shims kept for backwards compatibility with user settings from older plugin versions. The `loadSettings()` method migrates them to their replacements on first load. Removing them would cause data loss for users upgrading from earlier versions.

**6. "Async method 'onClose' has no 'await' expression"**

Same pattern as #1 -- the method overrides a base class lifecycle method that expects a specific return type. The method signature must match the parent class.

**7. "Unnecessary character escape `\[` in character class" (SemanticIndexService.ts:L525)**

The regex uses `\[` and `\]` inside a character class to match literal bracket characters. While the linter flags `\[` as unnecessary, removing the escape from `]` causes it to close the character class prematurely, turning the remainder into invalid syntax (`SyntaxError: Nothing to repeat`). Keeping both `\[` and `\]` escaped is required for correctness. Confirmed by runtime crash when the escapes were removed. (Note: the `\-` escape in the same regex was fixed separately by moving `-` to end of character class.)
```

---

## Betroffene Dateien (nicht geaendert)

| # | Finding | Dateien | Begruendung |
|---|---------|---------|-------------|
| 1 | async ohne await | `AttemptCompletionTool.ts`, `ReadAgentLogsTool.ts`, `SwitchModeTool.ts`, `UpdateTodoListTool.ts`, `UpdateSettingsTool.ts`, `SandboxBridge.ts`, `DynamicToolLoader.ts`, + 3 weitere | Interface-Contract erfordert `Promise` Return-Type |
| 2 | SSEClientTransport deprecated | `McpClient.ts` | Migrationsperiode, SSE-Server noch aktiv |
| 3 | style.setProperty | 29 Stellen in UI-Code | Dynamische Positionierung, Werte zur Laufzeit berechnet |
| 4 | async onload | `main.ts` | Standard Obsidian Plugin Pattern |
| 5 | Deprecated Settings | `types/settings.ts` | Migrations-Shims fuer Abwaertskompatibilitaet |
| 6 | async onClose | View-Klassen | Base-Class Lifecycle Override |
| 7 | Unnecessary escape `\[` | `SemanticIndexService.ts:L525` | Runtime-Crash bei Entfernung (`]` schliesst Character-Class vorzeitig) |
