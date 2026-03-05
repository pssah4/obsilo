# Feature: Auto-Frontmatter-Linking

> **Feature ID**: FEATURE-301
> **Epic**: EPIC-003 - Chat-Linking
> **Priority**: P0-Critical
> **Effort Estimate**: M

## Feature Description

Nach jeder erfolgreichen Write-Operation auf eine Vault-.md-Datei fügt die zentrale Tool-Execution-Pipeline automatisch einen Chat-Link im Frontmatter ein. Der Link enthält einen lesbaren Titel und eine klickbare Referenz zum Chat. Bei erneutem Write auf dieselbe Note wird ein bestehender Fallback-Titel durch den vollwertigen Titel aktualisiert. Duplikate werden über die Chat-Identität geprüft (nicht über den Titeltext). Nur Vault-interne .md-Dateien werden gestampt.

## Benefits Hypothesis

**Wir glauben dass** automatisches Verlinken von Chats im Frontmatter bearbeiteter Notes
**folgende messbare Outcomes liefert:**
- Lückenlose Provenienz: Jede Agent-bearbeitete Note zeigt ihren Entstehungs-Chat
- Kein manueller Aufwand: Linking passiert transparent im Hintergrund
- Nachvollziehbarkeit wie bei Quellenangaben: Der Weg zum Wissen ist dokumentiert

**Wir wissen dass wir erfolgreich sind wenn:**
- 100% der .md-Writes einen Frontmatter-Link erzeugen
- Bestehende Write-Operationen nicht beeinträchtigt werden

## User Stories

### Story 1: Automatischer Link bei Note-Erstellung
**Als** Konzeptarbeiter
**möchte ich** dass beim Erstellen einer neuen Note durch den Agent automatisch der Chat-Link im Frontmatter steht
**um** später nachvollziehen zu können, in welchem Gespräch die Note entstanden ist

### Story 2: Automatischer Link bei Note-Bearbeitung
**Als** Konzeptarbeiter
**möchte ich** dass beim Bearbeiten einer bestehenden Note der Chat-Link ergänzt wird
**um** zu sehen, welche Chats die Note beeinflusst haben

### Story 3: Titel-Aktualisierung
**Als** Nutzer
**möchte ich** dass ein vorläufiger Titel im Frontmatter beim nächsten Write durch den endgültigen Titel ersetzt wird
**um** immer aussagekräftige Link-Texte zu sehen

### Story 4: Deduplizierung
**Als** Nutzer
**möchte ich** dass derselbe Chat nur einmal im Frontmatter erscheint, egal wie oft die Note bearbeitet wird
**um** ein sauberes Frontmatter zu behalten

---

## Success Criteria (Tech-Agnostic)

> KEINE Technologie-Begriffe erlaubt!

| ID | Criterion | Target | Measurement |
|----|-----------|--------|-------------|
| SC-01 | Jede vom Agent erstellte oder bearbeitete Note enthält einen Chat-Verweis | 100% der Vault-internen Textdateien | Stichprobe: 10 Write-Operationen prüfen |
| SC-02 | Der Chat-Verweis zeigt einen lesbaren Titel (kein kryptischer Bezeichner) | 100% nach Titelverfügbarkeit | Frontmatter visuell prüfen |
| SC-03 | Ein vorläufiger Titel wird beim nächsten Schreibvorgang durch den endgültigen ersetzt | Titel-Update bei 100% der Fälle | Write-Rewrite-Szenario testen |
| SC-04 | Gleicher Chat erscheint nur einmal pro Note | 0 Duplikate | Note 3x im gleichen Chat bearbeiten |
| SC-05 | Bestehende Felder in der Note bleiben unverändert | 0 verlorene/veränderte Felder | Frontmatter vor/nach vergleichen |
| SC-06 | Konfigurationsdateien und nicht-textbasierte Dateien erhalten keinen Verweis | 0 fehlerhafte Stamps | Canvas, Config-Dateien bearbeiten |
| SC-07 | Fehlende Verweisanlage unterbricht die eigentliche Schreiboperation nicht | 0 abgebrochene Writes | Error-Injection-Test |

---

## Technical NFRs (für Architekt) - MIT TECHNOLOGIE OK

> Diese Section DARF technische Details enthalten!

### Performance
- **Frontmatter-Stamping**: < 50ms zusätzlich pro Write-Operation
- **Titel-Lookup**: `conversationStore.getMeta()` < 10ms (in-memory)
- **Gesamt-Impact**: Write-Operationen nicht merkbar langsamer

### Reliability
- **Race Condition**: Await statt fire-and-forget bei `processFrontMatter`; oder sequentielle Queue
- **Atomic Updates**: `processFrontMatter` garantiert keine partielle YAML-Korruption
- **Non-fatal**: Fehler beim Stamping brechen die Tool-Execution nicht ab (try-catch)

### Data Integrity
- **Duplikat-Prüfung**: Über conversationId (nicht über den gesamten Link-String, da Titel sich ändern kann)
- **Titel-Update**: Bestehender Eintrag wird ersetzt (nicht neuer Eintrag + alter bleibt)
- **Bestehende Felder**: `processFrontMatter` lässt alle anderen Frontmatter-Felder intakt

### Compatibility
- **Nur Vault-interne .md-Dateien**: `vault.getAbstractFileByPath()` muss `TFile` mit `.extension === 'md'` zurückgeben
- **Nicht in `.obsidian/`**: Config-Dateien ausschließen
- **Plugin Review-Bot**: Kein `innerHTML`, kein `console.log`, keine verbotenen Patterns

---

## Architecture Considerations

### Architecturally Significant Requirements (ASRs)

CRITICAL ASR #1: Pipeline Post-Write Hook
- **Warum ASR**: Erweitert die zentrale ToolExecutionPipeline um eine weitere Verantwortung; betrifft ALLE Write-Tools automatisch
- **Impact**: Pipeline-Architektur (ADR-001) bekommt einen 5. Post-Execution-Schritt; `conversationId` muss durch 3 Schichten durchgereicht werden
- **Quality Attribute**: Extensibility, Reliability, Performance

CRITICAL ASR #2: Race-Condition-Mitigation
- **Warum ASR**: Bei schnellen aufeinanderfolgenden Writes auf gleiche Datei könnte `processFrontMatter` kollidieren
- **Impact**: Entscheidung zwischen await (sequentiell, sicher) und fire-and-forget (performant, riskant)
- **Quality Attribute**: Reliability, Data Integrity

MODERATE ASR #3: conversationId-Durchreichung
- **Warum ASR**: Neues Feld muss von der UI-Schicht (AgentSidebarView) durch AgentTask und ContextExtensions bis zur Pipeline propagiert werden
- **Impact**: Drei Interfaces/Types müssen erweitert werden
- **Quality Attribute**: Maintainability

### Constraints
- **Pipeline-Architektur**: Hook muss in bestehende ToolExecutionPipeline passen (ADR-001)
- **Plugin Review-Bot**: Alle Obsidian-Compliance-Regeln
- **Single-Threaded Electron**: Kein echtes Multithreading; Race Conditions durch async

### Open Questions für Architekt
- Await vs. Queue für `processFrontMatter` -- welche Strategie für Race-Condition-Mitigation?
- Soll das Hook als eigene Methode oder als Teil des bestehenden Post-Write-Flows implementiert werden?
- ADR-022 sagt fire-and-forget -- BA-Analyse fordert Mitigation. Update nötig?

---

## Definition of Done

### Functional
- [ ] Write auf .md-Datei erzeugt `obsilo-chats` Frontmatter-Eintrag
- [ ] Link-Format: `[Titel](obsidian://obsilo-chat?id=...)` 
- [ ] Neuerstellte Notes bekommen Link
- [ ] Bestehende Notes bekommen Link ergänzt
- [ ] Fallback-Titel wird bei nächstem Write durch LLM-Titel ersetzt
- [ ] Deduplizierung: ein Eintrag pro Chat
- [ ] Non-.md-Dateien erhalten kein Frontmatter
- [ ] Dateien außerhalb des Vaults erhalten kein Frontmatter
- [ ] Fehler beim Stamping brechen Write nicht ab

### Quality
- [ ] Performance-Test: Write + Stamp < 50ms Overhead
- [ ] Race-Condition-Test: 3 schnelle Writes auf gleiche Datei
- [ ] Regression: Bestehende Write-Operationen unverändert
- [ ] Build läuft fehlerfrei durch

### Documentation
- [ ] Feature-Spec aktualisiert (Status: Implemented)
- [ ] ADR-022 ggf. aktualisiert (Race-Condition-Mitigation)

---

## Dependencies

- **FEATURE-300 (Protocol Handler)**: Links im Frontmatter müssen funktionieren -> Protocol Handler muss registriert sein
- **FEATURE-302 (Semantisches Titling)**: Für vollwertige Titel; ohne Titling funktioniert der Fallback (60 Zeichen)
- **ToolExecutionPipeline**: Hook-Point (ADR-001)
- **ConversationStore**: Conversation-Metadaten (Titel)
- **Obsidian `processFrontMatter` API**: Atomare YAML-Updates

## Assumptions

- `processFrontMatter` ist thread-safe bei sequentieller Ausführung (keine parallelen Calls auf gleiche Datei)
- Obsidian Properties-View rendert Markdown-Links in YAML-Arrays als klickbare Links
- `ContextExtensions` kann um optionale Felder erweitert werden, ohne Breaking Changes

## Out of Scope

- Stamping von Canvas, Bases, JSON, Config-Dateien
- Rückrichtung (Chat -> Note Link)
- Frontmatter-Cleanup / Link-Rotation bei vielen Einträgen (deferred)
