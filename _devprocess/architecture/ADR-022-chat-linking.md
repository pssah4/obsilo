# ADR-022: Chat-Linking via Pipeline Post-Write Hook

**Status:** Akzeptiert
**Datum:** 2026-03-05
**Entscheider:** Sebastian Hanke

---

## Kontext

Chats werden im ConversationStore (`~/.obsidian-agent/history/`) gespeichert -- ausserhalb des Vaults. Wenn der Agent Notes erstellt oder bearbeitet, geht die Verbindung zum Chat-Kontext verloren. Der Nutzer moechte aus Notes heraus direkt in den zugehoerigen Chat zurueckspringen koennen, um Kontext fortzusetzen oder nachzuschlagen.

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
  |-- nach Schritt 5 (Execute), vor Return:
  |   if (isWrite && !error && chatLinking && conversationId && path.endsWith('.md'))
  |     -> stampChatLink(path, conversationId)
  |          -> processFrontMatter(file, fm => { fm['obsilo-chats'] = [...existing, link] })
```

### Deep-Link-Format

```
obsidian://obsilo-chat?id={conversationId}
```

Registriert via `registerObsidianProtocolHandler('obsilo-chat', ...)` in main.ts. Oeffnet die Sidebar und laedt die Conversation.

### Frontmatter-Format

```yaml
obsilo-chats:
  - obsidian://obsilo-chat?id=2026-03-05-a1b2c3
```

- Array-Feld, da eine Note von mehreren Chats bearbeitet werden kann
- URIs als Werte, damit Obsidian Properties-View sie klickbar rendert
- Duplikat-Pruefung: `existing.includes(link)` vor dem Append

## Konsequenzen

**Positiv:**
- Automatische Traceability ohne manuellen Aufwand
- Zentraler Hook -- neue Write-Tools profitieren automatisch
- Konsistent mit bestehenden Pipeline-Post-Write-Concerns
- Obsidian Properties-View rendert die Links klickbar (kein custom Rendering noetig)
- Abschaltbar via Setting (`chatLinking: false`)

**Negativ:**
- Pipeline bekommt eine weitere Verantwortung (nun 5 Post-Execution-Schritte)
- conversationId muss durch 3 Schichten gereicht werden
- Frontmatter wird bei jedem Write modifiziert (auch wenn der eigentliche Content-Write das Frontmatter nicht beruehrt)
- `processFrontMatter` ist asynchron -- wird fire-and-forget ausgefuehrt (non-blocking, aber theoretisch Race mit naechstem Write auf gleiche Datei)

**Risiken:**
- Race Condition bei schnellen aufeinanderfolgenden Writes auf gleiche Datei: `processFrontMatter` koennte kollidieren. Mitigation: fire-and-forget mit catch, Duplikat-Pruefung ist idempotent.
- Nutzer mit vielen Agent-Writes sehen viele `obsilo-chats`-Eintraege. Mitigation: Array waechst nur um unique Links, pro Chat maximal ein Eintrag.

## Referenzen

- Feature-Spec: [FEATURE-chat-linking.md](../requirements/features/FEATURE-chat-linking.md)
- ADR-001: Central Tool Execution Pipeline (bestehendes Pattern)
- `src/core/tool-execution/ToolExecutionPipeline.ts` (Hook-Point)
- `src/core/history/ConversationStore.ts` (Conversation-ID-Format)
- Plan: `/Users/sebastianhanke/.claude/plans/purring-dreaming-llama.md`
