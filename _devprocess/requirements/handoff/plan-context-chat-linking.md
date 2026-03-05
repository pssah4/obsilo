# Plan Context: Chat-Linking (EPIC-003)

> **Purpose:** Technische Zusammenfassung fuer Claude Code
> **Created by:** Architect Agent
> **Date:** 2026-03-05

---

## Technical Stack

**Bestehendes System (kein neuer Stack):**
- Language: TypeScript (strict)
- Framework: Obsidian Plugin API
- Build: esbuild
- Runtime: Electron (via Obsidian, single-threaded)
- AI APIs: Anthropic SDK, OpenAI SDK (multi-provider)

**Neue Abhaengigkeiten:** Keine -- Feature nutzt ausschliesslich bestehende APIs.

## Architecture Style

- Pattern: Zentraler Pipeline Post-Write Hook (ToolExecutionPipeline, ADR-001/022)
- Kein neues Architekturpattern -- Erweiterung bestehender Cross-Cutting Concerns

## Key Architecture Decisions (ADR Summary)

| ADR | Title | Vorgeschlagene Entscheidung | Impact |
|-----|-------|-----------------------------|--------|
| ADR-022 (Rev. 2) | Chat-Linking via Pipeline Post-Write Hook | await stampChatLink() nach Tool-Execution | High -- Pipeline-Erweiterung |

**Detail:**

1. **ADR-022 (Rev. 2):** Pipeline Post-Write Hook mit await (nicht fire-and-forget)
   - Rationale: Pipeline arbeitet bereits sequentiell; await eliminiert Race Conditions; ~50ms Overhead akzeptabel
   - Aenderung gegenueber Rev. 1: fire-and-forget -> await; nackte URIs -> Markdown-Links mit Titel; memoryModelKey -> eigenes titlingModelKey

## Implementierungs-Komponenten

### Komponente 1: Protocol Handler (FEATURE-300, P0)

**Wo:** `src/main.ts` -- `onload()`

```typescript
this.registerObsidianProtocolHandler('obsilo-chat', (params) => {
    const id = params.id;
    if (id) {
        void this.activateView().then(() => {
            const view = this.getSidebarView();
            if (view) {
                view.loadConversationById(id);
            }
        });
    }
});
```

**Neue Methode:** `AgentSidebarView.loadConversationById(id: string): void`
- Prueft ob Conversation existiert (conversationStore)
- Wenn ja: laedt Conversation + stellt UI wieder her
- Wenn nein: `new Notice(t('ui.sidebar.chatNotFound'))`
- Wenn laufender Chat: aktuellen Chat beenden, dann neuen laden

**Dateien:**
- `src/main.ts` -- Protocol Handler registrieren
- `src/ui/AgentSidebarView.ts` -- `loadConversationById()` public Methode

### Komponente 2: Auto-Frontmatter-Linking (FEATURE-301, P0)

**Wo:** `src/core/tool-execution/ToolExecutionPipeline.ts` -- `executeTool()`, nach Schritt 6 (Log + Cache), vor Return

**Hook-Position im Code (nach Zeile ~278 in aktuellem Code):**
```typescript
// bestehend: Schritt 6 (Log + Cache)
await this.logOperation(toolCall, !executionHadError, durationMs, undefined, content);
if (!executionHadError && ToolExecutionPipeline.CACHEABLE.has(toolCall.name)) {
    this.resultCache.set(this.cacheKey(toolCall.name, toolCall.input), content);
}

// NEU: Schritt 7 -- Chat-Linking Frontmatter Stamp
if (tool.isWriteOperation && !executionHadError && extensions?.conversationId) {
    const chatLinking = this.plugin.settings.chatLinking ?? true;
    const filePath = toolCall.input?.path as string | undefined;
    if (chatLinking && filePath && this.isVaultMd(filePath)) {
        try {
            await this.stampChatLink(filePath, extensions.conversationId);
        } catch (e) {
            console.warn('[Pipeline] Chat-link stamp failed (non-fatal):', e);
        }
    }
}

return { ... };
```

**Neue Methode `stampChatLink`:**
```typescript
private async stampChatLink(filePath: string, conversationId: string): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) return;

    const store = this.plugin.conversationStore;
    const meta = store ? await store.getMeta(conversationId) : undefined;
    const title = meta?.title || conversationId;
    const uri = `obsidian://obsilo-chat?id=${conversationId}`;
    const entry = `[${title}](${uri})`;

    await this.plugin.app.fileManager.processFrontMatter(file, (fm) => {
        const links: string[] = fm['obsilo-chats'] ?? [];
        // Duplikat-Pruefung und Titel-Update ueber conversationId
        const idx = links.findIndex((l: string) => l.includes(conversationId));
        if (idx >= 0) {
            links[idx] = entry; // Titel-Update (Fallback -> LLM-Titel)
        } else {
            links.push(entry);  // Neuer Eintrag
        }
        fm['obsilo-chats'] = links;
    });
}

private isVaultMd(path: string): boolean {
    const file = this.plugin.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile && file.extension === 'md';
}
```

**conversationId-Durchreichung (3 Schichten):**

1. `ContextExtensions` (ToolExecutionPipeline.ts):
```typescript
export interface ContextExtensions {
    // ... bestehende Felder ...
    /** Conversation ID for chat-linking frontmatter stamps */
    conversationId?: string;
}
```

2. `AgentTaskRunConfig` (AgentTask.ts):
```typescript
export interface AgentTaskRunConfig {
    // ... bestehende Felder ...
    /** Conversation ID for chat-linking (passed to pipeline extensions) */
    conversationId?: string;
}
```

3. `AgentTask.run()` -- Destructuring + Extension-Weitergabe:
```typescript
const { ..., conversationId } = config;
// Im extensions-Objekt bei pipeline.executeTool():
const extensions: ContextExtensions = {
    // ... bestehende Extensions ...
    conversationId,
};
```

4. `AgentSidebarView` -- beim task.run() Call:
```typescript
await task.run({
    // ... bestehende Config ...
    conversationId: this.activeConversationId,
});
```

**Dateien:**
- `src/core/tool-execution/ToolExecutionPipeline.ts` -- ContextExtensions erweitern, stampChatLink(), isVaultMd(), Hook im executeTool()
- `src/core/AgentTask.ts` -- AgentTaskRunConfig erweitern, Destructuring, Extension-Weitergabe
- `src/ui/AgentSidebarView.ts` -- conversationId bei task.run() mitgeben

### Komponente 3: Semantisches Chat-Titling (FEATURE-302, P1)

**Wo:** `src/ui/AgentSidebarView.ts`

**Trigger:** Nach erster Assistant-Antwort, im Streaming-Callback wo bisher der 60-Zeichen-Fallback steht.

**Ablauf:**
1. Sofort: Fallback-Titel speichern (60 Zeichen) -- bestehende Logik
2. Fire-and-forget: `void this.generateSemanticTitle(conversationId, userMsg, assistantMsg)`

```typescript
private async generateSemanticTitle(conversationId: string, userMsg: string, assistantMsg: string): Promise<void> {
    try {
        const modelKey = this.plugin.settings.titlingModelKey;
        if (!modelKey) return; // Kein Modell konfiguriert -> nur Fallback
        const api = this.plugin.resolveApiHandler(modelKey);
        if (!api) return;

        const prompt = `Generate a concise title (3-8 words) that captures the core topic of this conversation. Return only the title, no quotes, no punctuation at the end.\n\nUser: ${userMsg.slice(0, 500)}\n\nAssistant: ${assistantMsg.slice(0, 500)}`;

        const title = await api.generateSimpleCompletion(prompt);
        if (title && this.plugin.conversationStore) {
            await this.plugin.conversationStore.updateMeta(conversationId, { title: title.trim() });
        }
    } catch {
        // Non-fatal: fallback title already set
    }
}
```

**API-Methode:** `generateSimpleCompletion(prompt: string): Promise<string>`
- Einfacher LLM-Call ohne Tool-Definitionen, ohne History
- Analog zu bestehenden Memory-Extraction-Calls
- Muss im API-Handler-Interface definiert werden (alle Provider implementieren)

**Modell-Konfiguration:**
- Neues Setting `titlingModelKey: string` -- verweist auf einen Eintrag in `activeModels[]`
- Dropdown in Settings > Interface, analog zum bestehenden `memoryModelKey` in MemoryTab
- Wenn leer: kein Titling, nur Fallback

**Dateien:**
- `src/ui/AgentSidebarView.ts` -- generateSemanticTitle(), Trigger im Streaming-Callback
- `src/api/types.ts` -- generateSimpleCompletion() im Handler-Interface (wenn nicht vorhanden)
- Provider-Handler (Anthropic, OpenAI, etc.) -- Implementierung von generateSimpleCompletion()

### Komponente 4: Settings (FEATURE-303, P2)

**Wo:** `src/types/settings.ts`, `src/ui/settings/InterfaceTab.ts`

**Neue Settings:**
```typescript
// In ObsidianAgentSettings:
/** Auto-link chats in frontmatter of edited notes (ADR-022) */
chatLinking: boolean;
/** Model key for semantic chat title generation (picks from activeModels[]) */
titlingModelKey: string;
```

**Defaults (in DEFAULT_SETTINGS):**
```typescript
chatLinking: true,
titlingModelKey: '',
```

**UI (InterfaceTab):**
- Toggle fuer `chatLinking` (unter History-Bereich)
- Modell-Dropdown fuer `titlingModelKey` (analog zu MemoryTab memoryModelKey)
- Dropdown zeigt alle Eintraege aus `activeModels[]`

**i18n Keys (6 Sprachen):**
```
settings.interface.chatLinking
settings.interface.chatLinkingDesc
settings.interface.titlingModel
settings.interface.titlingModelDesc
ui.sidebar.chatNotFound
```

**Dateien:**
- `src/types/settings.ts` -- chatLinking + titlingModelKey + Defaults
- `src/ui/settings/InterfaceTab.ts` -- Toggle + Dropdown
- `src/i18n/locales/*.ts` -- 6 Locale-Dateien

## Implementierungs-Reihenfolge

```
Phase 1: Infrastruktur (FEATURE-303 teilweise + FEATURE-300)
  1. Settings: chatLinking + titlingModelKey in settings.ts + Defaults
  2. Protocol Handler: main.ts registrieren
  3. loadConversationById(): AgentSidebarView
  -> Build + Test

Phase 2: Pipeline Hook (FEATURE-301)
  4. ContextExtensions.conversationId
  5. AgentTaskRunConfig.conversationId
  6. AgentTask.run() Destructuring + Extension-Weitergabe
  7. SidebarView: conversationId bei task.run()
  8. stampChatLink() + isVaultMd() in Pipeline
  9. Hook in executeTool() (Schritt 7)
  -> Build + Test

Phase 3: Titling (FEATURE-302)
  10. generateSimpleCompletion() im API-Handler
  11. generateSemanticTitle() in SidebarView
  12. Trigger im Streaming-Callback
  -> Build + Test

Phase 4: UI (FEATURE-303 Rest)
  13. InterfaceTab: Toggle + Dropdown
  14. i18n: 6 Locale-Dateien
  -> Build + Test
```

## Performance & Security

**Performance:**
- Frontmatter-Stamping: < 50ms pro Write (await, aber < Checkpoint-Overhead)
- Titel-Lookup: < 10ms (in-memory ConversationStore)
- Protocol Handler: < 500ms (Sidebar aktivieren + Conversation laden)
- LLM-Titling: < 2s (modellabhaengig, non-blocking)

**Security:**
- conversationId: Validierung gegen ConversationStore (keine willkuerlichen IDs)
- processFrontMatter: Obsidian-API-Guarantee fuer atomare Updates
- Kein fetch(), kein innerHTML, kein console.log -- Review-Bot konform
- Nur Vault-interne .md-Dateien (kein Stamping ausserhalb des Vaults)

---

## Kontext-Dokumente fuer Claude Code

Claude Code sollte folgende Dokumente als Kontext lesen:

1. `_devprocess/architecture/ADR-022-chat-linking.md` (aktualisierter ADR)
2. `_devprocess/requirements/features/FEATURE-300-protocol-handler.md`
3. `_devprocess/requirements/features/FEATURE-301-auto-frontmatter-linking.md`
4. `_devprocess/requirements/features/FEATURE-302-semantic-chat-titling.md`
5. `_devprocess/requirements/features/FEATURE-303-chat-linking-setting.md`
6. `src/core/tool-execution/ToolExecutionPipeline.ts` (Hook-Point)
7. `src/core/AgentTask.ts` (AgentTaskRunConfig, run())
8. `src/ui/AgentSidebarView.ts` (Streaming-Callback, loadConversation)
9. `src/types/settings.ts` (ObsidianAgentSettings, MemorySettings)
10. `src/ui/settings/MemoryTab.ts` (Referenz fuer memoryModelKey-Dropdown-Pattern)
