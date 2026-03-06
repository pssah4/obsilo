# FEATURE: Chat History

**Status:** Implemented
**Source:** `src/core/history/ConversationStore.ts`, `src/ui/sidebar/HistoryPanel.ts`

## Summary
Persistent chat history that stores conversations as JSON files in the plugin directory. Conversations are indexed in memory for fast listing and grouped by date in a sliding overlay panel. Users can browse, filter, load, and delete past conversations.

## How It Works

### Storage Layer: ConversationStore

**Location:** `.obsidian/plugins/obsidian-agent/history/`
- `index.json` — metadata index (conversation list with titles, timestamps, token counts)
- `{id}.json` — individual conversation data (full message history + UI messages)

**ID Generation:** Date-prefixed random hex: `"2026-02-20-a1b2c3"`

**Data Model:**
```typescript
interface ConversationMeta {
    id: string;
    title: string;
    created: string;       // ISO timestamp
    updated: string;       // ISO timestamp
    messageCount: number;
    mode: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
}

interface ConversationData {
    meta: ConversationMeta;
    messages: MessageParam[];    // LLM conversation history (for resume)
    uiMessages: UiMessage[];    // Rendered UI messages (role + text + timestamp)
}
```

**CRUD Operations:**
- `create(mode, model)` — creates a new conversation, returns id
- `save(id, messages, uiMessages)` — overwrites full conversation data + updates index
- `updateMeta(id, patch)` — updates metadata fields (e.g., title, token counts)
- `load(id)` — reads full conversation from disk
- `list()` — returns cached index (no disk I/O)
- `delete(id)` — removes from index + deletes JSON file
- `deleteAll()` — clears all conversations

**Performance:** The index is kept in memory after initialization. `list()` returns the cached array directly — no filesystem access needed for the history panel to render.

### UI Layer: HistoryPanel

A sliding overlay panel mounted inside the chat container:

**Date Grouping:** Conversations are grouped into:
- Today
- Yesterday
- This Week
- Older

**Features:**
- **Filter:** Live text search by conversation title
- **Active highlighting:** Current conversation is highlighted in the list
- **Delete:** Per-conversation delete button (visible on hover)
- **Load:** Click a row to load the conversation and close the panel
- **Slide animation:** CSS transition on open/close (200ms)

**Metadata Display:** Each row shows:
- Conversation title
- Time (Today/Yesterday) or date (This Week/Older)
- Message count

### Initialization
The ConversationStore is initialized in `main.ts` when `settings.enableChatHistory` is true:
```typescript
this.conversationStore = new ConversationStore(this.app.vault, pluginDir);
await this.conversationStore.initialize();
```

## Key Files
- `src/core/history/ConversationStore.ts` — persistence layer (CRUD, index management)
- `src/ui/sidebar/HistoryPanel.ts` — UI panel (date grouping, filter, load/delete)
- `src/main.ts` — initialization and lifecycle

## Dependencies
- `Vault.adapter` — low-level file I/O (read, write, remove, mkdir, exists)
- `AgentSidebarView` — mounts the HistoryPanel, wires load/delete callbacks
- `MessageParam` — LLM conversation format for history resume

## Configuration
| Key | Default | Description |
|-----|---------|-------------|
| `enableChatHistory` | true | Enable persistent conversation storage |
| `chatHistoryFolder` | `""` | Legacy: vault folder for old-style chat history export |

## Known Limitations / Edge Cases
- Conversation data includes the full LLM message history (including tool results), which can be large for tool-heavy conversations. No compression or pruning is applied.
- The index is loaded fully into memory on startup. Vaults with thousands of conversations may see increased memory usage.
- Title is set to "New Conversation" on creation and must be updated separately (e.g., via auto-titling after the first exchange).
- No pagination — all conversations are rendered in the panel list. Very long histories may cause scroll performance issues.
- No export functionality — conversations can only be viewed/deleted within the plugin.
- File-level locking is not implemented — concurrent access from multiple Obsidian instances (sync) could corrupt the index.
