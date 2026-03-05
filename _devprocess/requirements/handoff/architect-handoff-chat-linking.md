# Architect Handoff: Chat-Linking (Provenienz & Nachvollziehbarkeit)

> **Epic**: EPIC-003 - Chat-Linking
> **Erstellt**: 2026-03-05
> **Status**: Ready for Architect
> **BA-Referenz**: _devprocess/analysis/BA-chat-linking.md

---

## 1. Zusammenfassung für den Architekten

Obsilo braucht automatische Traceability zwischen Agent-Chats und bearbeiteten Notes. Nach jeder Write-Operation auf eine Vault-.md-Datei wird im Frontmatter ein Chat-Link mit LLM-generiertem Titel eingefügt. Ein Protocol Handler ermöglicht den Rücksprung per Klick. Das Feature soll wie eine Quellenangabe/Fußnote funktionieren -- dezent, automatisch, klickbar.

**Dein Hauptfokus:**
1. Pipeline Post-Write Hook: Integration in ToolExecutionPipeline (ADR-001 Erweiterung)
2. Race-Condition-Mitigation: await vs. Queue bei schnellen Writes auf gleiche Datei
3. conversationId-Durchreichung: UI -> AgentTask -> Pipeline (3 Schichten)
4. ADR-022 Review: Update bzgl. Race-Condition (BA fordert Mitigation statt fire-and-forget)

**Bestehender ADR:** ADR-022 ist akzeptiert, enthält aber fire-and-forget. Neue Anforderung: await/sequentiell statt fire-and-forget.

---

## 2. Architecturally Significant Requirements (ASRs)

### CRITICAL

| ID | ASR | Feature | Quality Attribute | Impact |
|----|-----|---------|-------------------|--------|
| ASR-1 | **Pipeline Post-Write Hook**: Zentraler Hook in ToolExecutionPipeline nach erfolgreicher Write-Op; darf bestehende Pipeline-Stabilität nicht beeinträchtigen | FEATURE-301 | Extensibility, Reliability | Pipeline bekommt 5. Post-Execution-Schritt; Pattern muss konsistent mit Checkpoint/Cache/Log sein |
| ASR-2 | **Race-Condition-Mitigation**: processFrontMatter bei schnellen aufeinanderfolgenden Writes auf gleiche Datei darf nicht kollidieren | FEATURE-301 | Data Integrity, Reliability | Entscheidung: await (sequentiell/sicher) vs. Queue (gepuffert); fire-and-forget ist nicht akzeptabel |

### MODERATE

| ID | ASR | Feature | Quality Attribute | Impact |
|----|-----|---------|-------------------|--------|
| ASR-3 | **conversationId-Durchreichung**: Optionales Feld muss durch 3 Schichten propagiert werden (SidebarView -> AgentTaskRunConfig -> ContextExtensions -> Pipeline) | FEATURE-301 | Maintainability | 3 Interfaces/Types erweitern; minimal-invasiv da optionales Feld |
| ASR-4 | **API-Erweiterung für Titling**: Neuer LLM-Aufruftyp (generateTitle) am per `titlingModelKey` konfigurierten Handler; braucht eigenen Prompt | FEATURE-302 | Extensibility | Neue Methode im API-Handler; Prompt-Design für konsistente 3-8-Wort-Titel; eigenes Setting `titlingModelKey` mit Modell-Dropdown (analog memoryModelKey) |
| ASR-5 | **Protocol Handler Lifecycle**: Registrierung in main.ts; Orchestrierung von Sidebar-Aktivierung + Conversation-Laden + Graceful Handling | FEATURE-300 | Usability, Resilience | Public loadConversationById() in AgentSidebarView; Existenz-Check für Conversations |

---

## 3. Aggregierte Non-Functional Requirements

### Performance

| Metrik | Target | Feature |
|--------|--------|---------|
| Frontmatter-Stamping Overhead pro Write | < 50ms | FEATURE-301 |
| Titel-Lookup (conversationStore.getMeta) | < 10ms | FEATURE-301 |
| Link-to-Chat-Öffnung (Sidebar + Conversation) | < 500ms | FEATURE-300 |
| LLM-Titling-Call | < 2.000ms (modellabhängig, konfigurierbar via `titlingModelKey`) | FEATURE-302 |

### Reliability

| Anforderung | Detail | Feature |
|-------------|--------|---------|
| Race-Condition-Safety | Await (sequentiell) oder Queue für processFrontMatter | FEATURE-301 |
| Non-fatal Stamping | Fehler beim Stamp bricht Write nicht ab (try-catch) | FEATURE-301 |
| Non-fatal Titling | LLM-Fehler -> Fallback (60 Zeichen) greift | FEATURE-302 |
| Graceful Missing Conversation | Protocol Handler zeigt Notice statt leere Sidebar | FEATURE-300 |

### Data Integrity

| Anforderung | Detail | Feature |
|-------------|--------|---------|
| Duplikat-Prüfung | Über conversationId, nicht über Link-String (Titel kann sich ändern) | FEATURE-301 |
| Titel-Update | Bestehender Fallback-Eintrag wird ersetzt, nicht ergänzt | FEATURE-301 |
| Bestehende Felder | processFrontMatter lässt alle anderen Frontmatter-Felder intakt | FEATURE-301 |
| Scope-Begrenzung | Nur Vault-interne .md-Dateien; kein .obsidian/, kein Canvas/Bases/JSON | FEATURE-301 |

### Compliance

| Anforderung | Detail | Feature |
|-------------|--------|---------|
| Obsidian Review-Bot | Kein innerHTML, kein console.log, kein fetch(), kein require() | Alle |
| DOM API | CSS-Klassen für Setting-Toggle, Obsidian createEl/createDiv | FEATURE-303 |
| i18n | Labels in 6 Sprachen | FEATURE-303 |

---

## 4. Constraints

| Constraint | Quelle | Impact |
|------------|--------|--------|
| Pipeline-Architektur (ADR-001) | Bestehende Architektur | Hook muss als Post-Write-Schritt in existierendes Pattern passen |
| Single-Threaded Electron | Runtime-Umgebung | Keine echte Parallelität; Race Conditions durch async |
| processFrontMatter API | Obsidian API | Einzige Methode für atomare YAML-Updates; Verhalten bei concurrent Calls unklar |
| memoryModelKey Verfügbarkeit | Nutzerkonfiguration | ~~Wenn nicht konfiguriert, kein Titling~~ Ersetzt durch eigenes `titlingModelKey` Setting |
| Nur innerhalb Obsidian | Stakeholder-Entscheidung | Protocol Handler muss keine externen Aufrufe unterstützen |

---

## 5. Datenfluss (Übersicht)

```
AgentSidebarView
  |-- activeConversationId
  |-- generateSemanticTitle() [FEATURE-302, fire-and-forget]
  |
  v
AgentTaskRunConfig { conversationId?: string }
  |
  v
AgentTask.run()
  |
  v
ContextExtensions { conversationId?: string }
  |
  v
ToolExecutionPipeline.executeTool()
  |-- if (isWrite && !error && chatLinking && conversationId && path.endsWith('.md'))
  |     -> stampChatLink() [FEATURE-301, await/sequential]
  |        -> conversationStore.getMeta(id) -> title
  |        -> processFrontMatter(file, fm => { ... })
  |
  v
Frontmatter: obsilo-chats: ["[Titel](obsidian://obsilo-chat?id=...)"]

Protocol Handler [FEATURE-300]:
  obsidian://obsilo-chat?id=... -> activateView() -> loadConversationById()
```

---

## 6. Open Questions (für Architekt priorisiert)

| Prio | Frage | Kontext |
|------|-------|---------|
| P0 | **Await vs. Queue für processFrontMatter?** ADR-022 sagt fire-and-forget, BA fordert Mitigation. Welche Strategie? | FEATURE-301, ASR-2 |
| P1 | **loadConversationById() und laufender Chat?** Soll ein laufender Chat abgebrochen oder der Nutzer gewarnt werden? | FEATURE-300, ASR-5 |
| P1 | **generateTitle() Platzierung?** Im bestehenden API-Handler oder als separate Utility? | FEATURE-302, ASR-4 |
| P1 | **titlingModelKey Dropdown?** Implementierung analog zu memoryModelKey möglich? Gleiche Modell-Resolution? | FEATURE-303, ASR-4 |
| P2 | **Prompt-Design für Titling?** Nur User-Nachricht oder User + Assistant für besseren Kontext? | FEATURE-302 |

---

## 7. Referenzen

| Dokument | Pfad |
|----------|------|
| Business Analysis | `_devprocess/analysis/BA-chat-linking.md` |
| Epic | `_devprocess/requirements/epics/EPIC-003-chat-linking.md` |
| Feature: Protocol Handler | `_devprocess/requirements/features/FEATURE-300-protocol-handler.md` |
| Feature: Auto-Frontmatter-Linking | `_devprocess/requirements/features/FEATURE-301-auto-frontmatter-linking.md` |
| Feature: Semantisches Chat-Titling | `_devprocess/requirements/features/FEATURE-302-semantic-chat-titling.md` |
| Feature: Setting | `_devprocess/requirements/features/FEATURE-303-chat-linking-setting.md` |
| ADR-022 (bestehend) | `_devprocess/architecture/ADR-022-chat-linking.md` |
| ADR-001 (Pipeline) | `_devprocess/architecture/ADR-001-central-tool-execution-pipeline.md` |
| Feature-Spec (alt, vor RE) | `_devprocess/requirements/features/FEATURE-chat-linking.md` |
