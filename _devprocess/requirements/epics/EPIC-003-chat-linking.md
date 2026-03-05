# Epic: Chat-Linking (Provenienz & Nachvollziehbarkeit)

> **Epic ID**: EPIC-003
> **Business Alignment**: _devprocess/analysis/BA-chat-linking.md
> **Scope**: MVP

## Epic Hypothesis Statement

FÜR Knowledge Worker und Obsidian Power User
DIE iterativ an Konzepten und Ideen arbeiten und dabei auf frühere Agent-Diskussionen zurückgreifen wollen
IST Chat-Linking
EIN Provenienz- und Nachvollziehbarkeits-Feature
DAS automatisch den Entstehungsweg von Notes dokumentiert und den Rücksprung in den Chat ermöglicht
IM GEGENSATZ ZU manuellem Durchsuchen der Chat-History oder dem Verlust von Diskussionskontext
UNSERE LÖSUNG verknüpft Notes mit ihren Quell-Chats wie Fußnoten -- dezent, automatisch und klickbar

## Business Outcomes (messbar)

1. **Traceability**: 100% der vom Agent bearbeiteten Vault-.md-Dateien enthalten einen Chat-Link im Frontmatter
2. **Wiederaufnahme**: Rücksprung vom Frontmatter-Link in den zugehörigen Chat erfolgt mit einem Klick
3. **Erkennbarkeit**: Chat-Titel in der History und im Frontmatter sind semantisch aussagekräftig (3-8 Wörter, LLM-generiert)

## Leading Indicators (Frühindikatoren)

- **Link-Nutzung**: Nutzer klickt Frontmatter-Links, um Chats wiederzufinden (statt manuell in History zu scrollen)
- **Kontextübernahme**: Nutzer startet neue Chats basierend auf Erkenntnissen aus zurückverfolgten Chats
- **Titel-Erkennbarkeit**: Nutzer identifiziert den richtigen Chat anhand des Titels (kein Trial-and-Error)

## MVP Features

| Feature ID | Name | Priority | Effort | Status |
|------------|------|----------|--------|--------|
| FEATURE-300 | Protocol Handler (Deep-Links) | P0-Critical | S | Not Started |
| FEATURE-301 | Auto-Frontmatter-Linking | P0-Critical | M | Not Started |
| FEATURE-302 | Semantisches Chat-Titling | P1-High | S | Not Started |
| FEATURE-303 | Chat-Linking Setting | P2-Medium | S | Not Started |

**Priority Legend:**
- P0-Critical: Ohne geht MVP nicht (Linking + Deep-Link = Kernfunktion)
- P1-High: Wichtig für vollständige User Experience (Titel machen Links lesbar)
- P2-Medium: Wertsteigernd, aber nicht essentiell (An/Aus-Toggle)

**Effort:** S (1-2 Sprints), M (3-5 Sprints), L (6+ Sprints)

## Explizit Out-of-Scope

- **Chat-Export als Vault-Dateien**: Chats sind kein Vault-Content (bewusste Architektur-Entscheidung)
- **Rückrichtung (Chat -> Note)**: Kein automatischer Link vom Chat zur bearbeiteten Note
- **Subtask-Propagation**: Subtasks erben keine conversationId des Parent-Tasks
- **Re-Titling**: Titel wird einmal generiert, nicht bei späteren Nachrichten aktualisiert
- **Externe Deep-Links**: Protocol Handler nur innerhalb Obsidian (nicht für Browser/externe Apps)
- **Chat-Indexierung**: Chats werden nicht in den Semantic Index aufgenommen
- **Ordner-basierte Ausschlüsse**: Kein Blacklisting von Ordnern für Frontmatter-Stamping
- **Non-.md-Stamping**: Canvas, Bases, JSON, Config-Dateien erhalten kein Frontmatter

## Dependencies & Risks

### Dependencies
- **ConversationStore**: Liefert Conversation-IDs und Meta (Titel). Existiert bereits.
- **ToolExecutionPipeline**: Zentraler Hook-Point (ADR-001). Post-Write-Hook muss ergänzt werden.
- **memoryModelKey API-Handler**: Günstiges Modell für Titling-Calls. Existiert bereits (Memory-Extraktion).
- **Obsidian `processFrontMatter` API**: Für atomare YAML-Updates. Muss zuverlässig sein.
- **Obsidian `registerObsidianProtocolHandler` API**: Für URI-Handler. Muss Plugin-spezifische Prefixes unterstützen.

### Risks
| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Race Condition bei schnellen Writes auf gleiche Datei | M | M | Await statt fire-and-forget; sequentielle Verarbeitung |
| Frontmatter-Pollution bei vielen verschiedenen Chats | L | L | Deferred: In der Praxis wird derselbe Chat wiederverwendet |
| LLM-Titling-Kosten bei intensiver Nutzung | L | L | Günstiges Modell (memoryModelKey); ein Call pro Chat |
| `processFrontMatter` API-Änderung in Obsidian-Update | L | H | Defensives Error-Handling; Non-fatal bei Fehler |
| Chat-Titel verrät sensiblen Inhalt im Frontmatter | L | M | Akzeptiertes Risiko (Single-User-Vault); abschaltbar |
