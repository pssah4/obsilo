# FEATURE: Chat-Linking

**Status:** Spezifiziert (Pre-Implementation)
**Branch:** add-files-to-chat
**ADR:** [ADR-022](../../architecture/ADR-022-chat-linking.md)

## Summary

Zwei zusammenhaengende Verbesserungen:
1. **Semantisches Chat-Titling** -- LLM-generierte, aussagekraeftige Titel fuer Chats (statt Abschnitt der ersten User-Nachricht)
2. **Auto-Frontmatter-Linking** -- Wenn der Agent eine Note bearbeitet, wird der Chat mit Titel und Deep-Link im Frontmatter verlinkt

Der Nutzer sieht in der History und im Frontmatter sofort, worum es im Chat ging, und kann jederzeit zurueckspringen.

## Motivation

Im Arbeitsalltag entsteht viel Kontext innerhalb eines Agent-Chats: Recherche-Ergebnisse, Entscheidungen, Diskussionen. Wenn der Agent daraus Notes erstellt oder bestehende Notes bearbeitet, geht die Verbindung zum Chat-Kontext verloren. Der Nutzer muss manuell in der History suchen, um den Chat wiederzufinden.

Aktuell wird der Chat-Titel aus den ersten 60 Zeichen der User-Nachricht abgeschnitten -- das ist oft wenig aussagekraeftig (z.B. "Kannst du mir helfen mit..." statt "Refactoring der Auth-Pipeline"). ChatGPT und Claude.ai loesen das mit LLM-generierten Titeln, die den semantischen Kern der Konversation erfassen.

## How It Works

### Komponente 1: Semantisches Chat-Titling

Ersetzt das aktuelle Titling (erste 60 Zeichen der User-Nachricht) durch einen LLM-generierten Titel.

**Trigger:** Nach der ersten Assistant-Antwort (wenn `uiMessages.length <= 2`).

**Ablauf:**
1. User sendet erste Nachricht, Agent antwortet
2. Im Hintergrund (fire-and-forget, non-blocking): Mini-LLM-Call mit User-Nachricht + erster Antwort
3. Prompt: "Generate a concise title (3-8 words) that captures the core topic of this conversation. Return only the title, no quotes."
4. Ergebnis wird via `conversationStore.updateMeta(id, { title })` gespeichert
5. HistoryPanel aktualisiert sich beim naechsten Oeffnen

**Fallback:** Wenn der LLM-Call fehlschlaegt (Netzwerk, Rate-Limit), bleibt der bisherige Fallback (erste 60 Zeichen) bestehen.

**Modell:** Nutzt `memoryModelKey` (dasselbe guenstige Modell wie Memory-Extraktion), nicht das Hauptmodell.

**Implementierung in AgentSidebarView (ersetzt Zeilen 1714-1721):**
```typescript
// Auto-title: generate semantic title after first assistant response
if (this.activeConversationId && this.uiMessages.length <= 2 && this.plugin.conversationStore) {
    const firstUserMsg = this.uiMessages.find((m) => m.role === 'user');
    if (firstUserMsg) {
        // Sofort-Fallback: erste 60 Zeichen (wie bisher)
        const fallbackTitle = firstUserMsg.text.slice(0, 60).replace(/\n/g, ' ').trim()
            || t('ui.sidebar.newConversation');
        void this.plugin.conversationStore.updateMeta(this.activeConversationId, { title: fallbackTitle });
        // Async: LLM-generierter Titel (non-blocking)
        void this.generateSemanticTitle(this.activeConversationId, firstUserMsg.text, accumulatedText);
    }
}
```

**Neue private Methode `generateSemanticTitle`:**
```typescript
private async generateSemanticTitle(conversationId: string, userMsg: string, assistantMsg: string): Promise<void> {
    try {
        const api = this.resolveMemoryApi();
        if (!api) return;
        const title = await api.generateTitle(userMsg, assistantMsg);
        if (title && this.plugin.conversationStore) {
            await this.plugin.conversationStore.updateMeta(conversationId, { title });
        }
    } catch {
        // Non-fatal: fallback title already set
    }
}
```

### Komponente 2: Protocol Handler (Deep-Links)

Obsidian registriert einen Protocol Handler `obsilo-chat`, der Chats ueber URIs oeffnet:

```
obsidian://obsilo-chat?id=2026-03-05-a1b2c3
```

**Flow:**
1. Nutzer klickt den Link (aus Frontmatter, Browser, anderer App)
2. Obsidian oeffnet sich / kommt in den Vordergrund
3. Plugin aktiviert die Sidebar
4. Sidebar laedt die Conversation mit der angegebenen ID
5. Chat wird vollstaendig wiederhergestellt (History + UI Messages)

**Registrierung in main.ts:**
```typescript
this.registerObsidianProtocolHandler('obsilo-chat', (params) => {
    const id = params.id;
    if (id) {
        void this.activateView().then(() => {
            const view = this.getSidebarView();
            if (view) view.loadConversationById(id);
        });
    }
});
```

### Komponente 3: Auto-Frontmatter-Linking (mit Titel)

Nach jeder erfolgreichen Write-Operation auf eine `.md`-Datei fuegt die ToolExecutionPipeline automatisch den Chat-Link **mit Titel** im Frontmatter ein.

**Frontmatter-Format:**
```yaml
---
obsilo-chats:
  - "[Refactoring der Auth-Pipeline](obsidian://obsilo-chat?id=2026-03-05-a1b2c3)"
  - "[Feature-Spec Chat-Linking](obsidian://obsilo-chat?id=2026-03-06-d4e5f6)"
---
```

Die Markdown-Link-Syntax `[Titel](URI)` wird von Obsidians Properties-View als klickbarer Link mit lesbarem Titel gerendert. So sieht der Nutzer auf einen Blick, welcher Chat die Note bearbeitet hat.

**Verhalten:**
- Feld `obsilo-chats` ist ein Array von Markdown-Link-Strings
- Duplikate werden ueber die conversationId geprueft (nicht ueber den ganzen String, da der Titel sich aendern kann)
- Titel wird aus `ConversationMeta.title` gelesen (zum Zeitpunkt des Writes)
- Bestehende Frontmatter-Felder bleiben intakt (atomare Updates via `processFrontMatter`)
- Nur `.md`-Dateien erhalten Frontmatter (keine Canvas, Bases, JSON etc.)
- Non-fatal: Fehler beim Stamping brechen die Tool-Execution nicht ab

**Datenfluss:**
```
AgentSidebarView.activeConversationId
  -> AgentTaskRunConfig.conversationId
    -> ContextExtensions.conversationId
      -> ToolExecutionPipeline (nach erfolgreicher Write-Op)
        -> conversationStore.getMeta(id) -> title
        -> app.fileManager.processFrontMatter()
          -> obsilo-chats: ["[title](uri)", ...]
```

**Hook-Position:** Nach Schritt 5 (Execute) in `ToolExecutionPipeline.executeTool()`, vor dem Return. Bedingungen:
1. `tool.isWriteOperation === true`
2. `!executionHadError`
3. `settings.chatLinking === true`
4. `extensions.conversationId` vorhanden
5. Dateipfad endet auf `.md`

### Komponente 4: Setting

| Key | Typ | Default | Beschreibung |
|-----|-----|---------|-------------|
| `chatLinking` | boolean | `true` | Auto-Link Chats im Frontmatter bearbeiteter Notes |

Toggle in Settings > Interface, unterhalb des History-Bereichs.

## Key Files

| Datei | Aenderung |
|-------|-----------|
| `src/main.ts` | Protocol Handler `obsilo-chat` registrieren |
| `src/core/AgentTask.ts` | `conversationId` in `AgentTaskRunConfig` + Destructuring + Extension-Durchreichung |
| `src/core/tool-execution/ToolExecutionPipeline.ts` | `ContextExtensions.conversationId`, Auto-Frontmatter-Hook, `stampChatLink()` Methode (mit Titel-Lookup) |
| `src/ui/AgentSidebarView.ts` | Public `loadConversationById()`, `conversationId` bei `task.run()`, `generateSemanticTitle()` |
| `src/api/types.ts` (oder Provider-spezifisch) | `generateTitle()` Methode im API-Handler |
| `src/types/settings.ts` | `chatLinking` Setting + Default |
| `src/ui/settings/InterfaceTab.ts` | Toggle UI |
| `src/i18n/locales/*.ts` | Uebersetzungen (6 Locale-Dateien) |

## Dependencies

- `ConversationStore` -- liefert Conversation-ID, Meta (Titel) und Lade-Logik
- `ToolExecutionPipeline` -- zentraler Hook-Punkt fuer Post-Write-Aktionen
- `app.fileManager.processFrontMatter()` -- Obsidian API fuer atomare Frontmatter-Updates
- `registerObsidianProtocolHandler()` -- Obsidian API fuer URI-Handler
- `memoryModelKey` API-Handler -- fuer den LLM-generierten Titel (guenstiges Modell)

## Abgrenzung

- **Kein Vault-Export:** Chats werden NICHT als Dateien im Vault gespeichert. Der ConversationStore bleibt in `~/.obsidian-agent/history/`.
- **Keine Rueckrichtung:** Es gibt keinen automatischen Link vom Chat zur Note (nur Note -> Chat).
- **Keine Subtask-Propagation:** Subtasks (new_task) erhalten keine conversationId des Parent-Tasks.
- **Kein Re-Titling:** Der Titel wird einmalig nach der ersten Antwort generiert. Spaetere Nachrichten aktualisieren den Titel nicht.

## Akzeptanzkriterien

1. `obsidian://obsilo-chat?id=<id>` oeffnet den Chat in der Sidebar
2. Nach Agent-Write auf `.md`-Datei erscheint `obsilo-chats` im Frontmatter als Markdown-Link mit Titel
3. Erneuter Write auf gleiche Note: kein Duplikat-Link (Pruefung ueber conversationId)
4. `chatLinking: false` unterdrueckt das Frontmatter-Stamping
5. Non-.md Dateien (Canvas, Base, JSON) erhalten kein Frontmatter
6. Chat-Titel in der History ist semantisch aussagekraeftig (LLM-generiert, 3-8 Woerter)
7. Bei LLM-Titling-Fehler greift der Fallback (erste 60 Zeichen)
8. Build laeuft fehlerfrei durch
9. Bestehende Write-Operationen funktionieren unveraendert (Regression)
