# ADR-022: Chat-Linking via Pipeline Post-Write Hook

**Status:** Akzeptiert (Rev. 2 -- 2026-03-05)
**Datum:** 2026-03-05
**Entscheider:** Sebastian Hanke

---

## Kontext

Chats werden im ConversationStore (`~/.obsidian-agent/history/`) gespeichert -- ausserhalb des Vaults. Wenn der Agent Notes erstellt oder bearbeitet, geht die Verbindung zum Chat-Kontext verloren. Der Nutzer moechte aus Notes heraus direkt in den zugehoerigen Chat zurueckspringen koennen, um Kontext fortzusetzen oder nachzuschlagen.

**Kern-Insight aus BA:** "Chats sind nicht Wissen, sondern der Entstehungsweg zum Wissen. Der Vault ist Single Source of Truth. Der Chat-Link ist eine Quellenangabe -- wie eine Fussnote."

**Anforderung:** Automatische, bidirektionale Traceability zwischen Agent-Chats und den dadurch erstellten/bearbeiteten Notes. Kein manuelles Verlinken noetig.

## Optionen

### Option 1: Pipeline Post-Write Hook (ToolExecutionPipeline)

Der zentrale Hook sitzt in `ToolExecutionPipeline.executeTool()`, direkt nach erfolgreicher Tool-Execution. Die `conversationId` wird ueber `ContextExtensions` durchgereicht.

- **Pro:** Zentraler Punkt, erfasst ALLE Write-Tools (write_file, edit_file, append_to_file, etc.) automatisch. Kein Code in einzelnen Tools noetig. Konsistent mit bestehendem Pipeline-Pattern (Checkpoint, Cache-Invalidation, Audit-Log).
- **Contra:** Pipeline wird um eine weitere Verantwortung erweitert. conversationId muss durch 3 Schichten durchgereicht werden (SidebarView -> AgentTaskRunConfig -> ContextExtensions).

### Option 2: Hook in jedem Write-Tool

Jedes Write-Tool (WriteFileTool, EditFileTool, AppendToFileTool, etc.) ruft nach erfolgreicher Ausfuehrung den Frontmatter-Stamp auf.

- **Pro:** Explizit, jedes Tool kontrolliert sein eigenes Verhalten.
- **Contra:** Code-Duplikation in 6+ Tools. Neue Write-Tools muessen den Hook manuell einbauen (vergessbar). Widerspricht dem zentralen Pipeline-Pattern.

### Option 3: Callback in AgentSidebarView (onToolResult)

Der `onToolResult`-Callback in der SidebarView erkennt Write-Results und fuegt das Frontmatter ein.

- **Pro:** Kein Pipeline-Change noetig. SidebarView hat die conversationId direkt.
- **Contra:** UI-Layer uebernimmt Daten-Verantwortung (Architektur-Verletzung). Subtask-Results wuerden nicht erfasst. Tool-Name-Matching ist fragil.

### Option 4: Vault-Event-Listener (vault.on('modify'))

Ein Vault-Event-Listener reagiert auf alle Datei-Aenderungen und stampt das Frontmatter.

- **Pro:** Erfasst auch manuelle Aenderungen. Unabhaengig von der Pipeline.
- **Contra:** Kein Zugang zur conversationId (Events haben keinen Task-Kontext). Wuerde auch Aenderungen ausserhalb des Agents erfassen. Performance-Risiko bei vielen Datei-Aenderungen.

## Entscheidung

**Option 1 -- Pipeline Post-Write Hook**

### Begruendung

Die ToolExecutionPipeline ist der zentrale Ort fuer Cross-Cutting Concerns nach Tool-Execution. Dort sitzen bereits:
- Checkpoint-Snapshots (vor Write, Schritt 4)
- Cache-Invalidation (nach Write, Schritt 5)
- Operation-Logging (nach Write, Schritt 6)

Chat-Linking ist ein weiterer Post-Write-Concern und gehoert an denselben Ort. Das Pattern ist bewaehrt und konsistent. Die Durchreichung der conversationId ueber ContextExtensions ist minimal-invasiv -- ein optionales Feld, das nur bei aktivem Chat-Linking ausgewertet wird.

### Datenfluss

```
AgentSidebarView (hat activeConversationId)
  |
  v
AgentTaskRunConfig { conversationId?: string }
  |
  v
AgentTask.run() destructures conversationId
  |
  v
pipeline.executeTool(toolCall, callbacks, { ...extensions, conversationId })
  |
  v
ToolExecutionPipeline.executeTool()
  |-- nach Schritt 6 (Log + Cache), vor Return:
  |   if (isWrite && !error && chatLinking && conversationId && isVaultMd(path))
  |     -> await stampChatLink(path, conversationId)
  |          -> conversationStore.getMeta(id) -> title
  |          -> processFrontMatter(file, fm => {
  |               const uri = `obsidian://obsilo-chat?id=${conversationId}`;
  |               const links: string[] = fm['obsilo-chats'] ?? [];
  |               const idx = links.findIndex(l => l.includes(conversationId));
  |               const entry = `[${title}](${uri})`;
  |               if (idx >= 0) links[idx] = entry;  // Titel-Update
  |               else links.push(entry);             // Neuer Eintrag
  |               fm['obsilo-chats'] = links;
  |          })
```

**Aenderung Rev. 2:** `await` statt fire-and-forget. Die Pipeline wartet auf das Frontmatter-Stamping, bevor sie das Tool-Result zurueckgibt. Da die Pipeline bereits sequentiell arbeitet (ein Tool nach dem anderen), gibt es keine parallelen Writes auf dieselbe Datei. Die zusaetzliche Latenz (< 50ms) ist akzeptabel.

**Vault-Scope-Check (`isVaultMd`):**
```typescript
function isVaultMd(path: string): boolean {
    const file = app.vault.getAbstractFileByPath(path);
    return file instanceof TFile && file.extension === 'md';
}
```
Schliesst `.obsidian/`-Config, Canvas, Bases, JSON und Dateien ausserhalb des Vaults aus.

### Deep-Link-Format

```
obsidian://obsilo-chat?id={conversationId}
```

Registriert via `registerObsidianProtocolHandler('obsilo-chat', ...)` in main.ts. Oeffnet die Sidebar und laedt die Conversation.

**Graceful Handling:** Wenn die Conversation nicht existiert (geloeschte History), zeigt der Handler eine `Notice` statt einer leeren Sidebar.

### Frontmatter-Format

```yaml
obsilo-chats:
  - "[Refactoring der Auth-Pipeline](obsidian://obsilo-chat?id=2026-03-05-a1b2c3)"
  - "[Feature-Spec Chat-Linking](obsidian://obsilo-chat?id=2026-03-06-d4e5f6)"
```

- Array-Feld, da eine Note von mehreren Chats bearbeitet werden kann
- **Markdown-Link-Syntax** `[Titel](URI)` -- wird von Obsidians Properties-View klickbar mit lesbarem Titel gerendert
- Duplikat-Pruefung ueber conversationId (nicht ueber den ganzen String, da der Titel sich aendern kann)
- **Titel-Update:** Wenn ein Fallback-Titel (60 Zeichen) existiert und inzwischen ein LLM-Titel verfuegbar ist, wird der bestehende Eintrag ersetzt (nicht ergaenzt)

### Semantisches Chat-Titling

**Aenderung Rev. 2:** Eigenes Setting `titlingModelKey` statt Binding an `memoryModelKey`. Der Nutzer waehlt ein guenstiges Modell (z.B. Haiku, Flash) ueber einen Modell-Dropdown in Settings > Interface.

```
Trigger: Nach erster Assistant-Antwort (uiMessages.length <= 2)
Modell:  settings.titlingModelKey (eigenes Setting, konfigurierbar)
Prompt:  User-Nachricht + erste Antwort -> 3-8 Woerter Titel
Fallback: Erste 60 Zeichen (sofort gespeichert vor LLM-Call)
Muster:  fire-and-forget (void) -- blockiert weder Chat noch UI
```

### Settings

| Key | Typ | Default | Beschreibung |
|-----|-----|---------|-------------|
| `chatLinking` | boolean | `true` | Auto-Link Chats im Frontmatter bearbeiteter Notes |
| `titlingModelKey` | string | `''` | Modell fuer semantische Titel-Generierung (Dropdown) |

## Konsequenzen

**Positiv:**
- Automatische Traceability ohne manuellen Aufwand
- Zentraler Hook -- neue Write-Tools profitieren automatisch
- Konsistent mit bestehenden Pipeline-Post-Write-Concerns
- Obsidian Properties-View rendert Markdown-Links klickbar mit lesbarem Titel (kein custom Rendering noetig)
- Abschaltbar via Setting (`chatLinking: false`)
- Titel-Modell frei waehlbar (`titlingModelKey`) -- Nutzer kontrolliert Kosten
- `await` statt fire-and-forget eliminiert Race-Condition-Risiko

**Negativ:**
- Pipeline bekommt eine weitere Verantwortung (nun 5 Post-Execution-Schritte)
- conversationId muss durch 3 Schichten gereicht werden (SidebarView -> AgentTaskRunConfig -> ContextExtensions)
- Frontmatter wird bei jedem Write modifiziert (auch wenn der eigentliche Content-Write das Frontmatter nicht beruehrt)
- `await stampChatLink()` addiert ~50ms pro Write-Operation (akzeptabel, da < Checkpoint-Overhead)

**Risiken:**
- Frontmatter-Pollution bei vielen verschiedenen Chats auf gleicher Note: Deferred -- in der Praxis wird derselbe Chat fuer dieselbe Note wiederverwendet. Bei Bedarf nachtraeglich Max-Links-Strategie ergaenzen.
- Nutzer mit vielen Agent-Writes sehen viele `obsilo-chats`-Eintraege: Array waechst nur um unique Links, pro Chat maximal ein Eintrag.
- Privacy: Chat-Titel im Frontmatter verrät Inhalt: Akzeptiertes Risiko (Single-User-Vault), abschaltbar via Setting.

## Referenzen

- Business Analysis: [BA-chat-linking.md](../analysis/BA-chat-linking.md)
- Epic: [EPIC-003-chat-linking.md](../requirements/epics/EPIC-003-chat-linking.md)
- Features: FEATURE-300 bis FEATURE-303
- ADR-001: Central Tool Execution Pipeline (bestehendes Pattern)
- `src/core/tool-execution/ToolExecutionPipeline.ts` (Hook-Point: nach Schritt 6, vor Return)
- `src/core/history/ConversationStore.ts` (Conversation-ID-Format, getMeta)
- Plan: `/Users/sebastianhanke/.claude/plans/purring-dreaming-llama.md`
