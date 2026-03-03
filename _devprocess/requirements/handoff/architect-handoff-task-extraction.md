# Architect Handoff: Task Extraction & Management

> **Source**: FEATURE-100-task-extraction.md
> **BA Reference**: BA-task-extraction.md
> **Date**: 2026-03-03
> **Status**: Ready for Architecture

---

## 1. Feature Summary

Deterministischer Post-Processing Hook der `- [ ]` Items in Agent-Antworten erkennt, ein Selection Modal zeigt, und Task-Notes mit 10 Frontmatter-Properties + Obsidian Base (3 Views) + optionaler Iconic-Integration erstellt. Kein LLM-Call im gesamten Flow.

---

## 2. Aggregierte ASRs

### CRITICAL

**ASR-1: Post-Processing Hook Pattern**
- Erstes Post-Processing Feature im Plugin
- Definiert architektonisches Pattern fuer zukuenftige Hooks (Auto-Tag, Citation Extraction, etc.)
- Muss asynchron nach Message-Render ausfuehren, darf UI nicht blockieren
- **ADR noetig**: Hook-Pattern (Observer vs. Callback vs. EventEmitter)

**ASR-2: Task-Note Frontmatter Schema**
- 10 Properties mit exakten deutschen Namen (inkl. Unicode: Fälligkeit)
- Schema wird Schnittstelle zwischen Features (Base, Iconic, Future Search)
- Schema-Aenderungen brechen bestehende Notes -- muss von Anfang an stabil sein
- **ADR noetig**: Schema-Design + Versionierungsstrategie

### MODERATE

**ASR-3: Optional Plugin Integration Pattern**
- Erstes Feature mit Community-Plugin-Awareness (Iconic)
- Pattern: detect -> suggest -> integrate -> fallback
- Muss ohne externes Plugin vollstaendig funktional sein
- **ADR noetig**: Plugin-Integration-Pattern (mit VaultDNA/CapabilityGapResolver)

**ASR-4: Base Integration Pattern**
- Erster Nicht-Tool-Gebrauch der Base-Logik (Code-Reuse statt Tool-Call)
- Trennung: Tool-Invocation (Agent) vs. interner Code-Reuse (Plugin-Feature)
- Base-YAML muss mit Obsidian's nativem Parser kompatibel sein

---

## 3. NFR Summary

| Category | Requirement | Target |
|----------|------------|--------|
| Performance | Modal Render | <100ms nach Message-Render |
| Performance | Note Creation | <500ms pro Note |
| Performance | Regex Scan | <50ms fuer bis zu 5000 Zeichen |
| Performance | Base Creation | <1000ms fuer 3-View Base |
| Performance | Batch (10 Tasks) | <5s gesamt |
| Security | Remote Calls | 0 (komplett lokal) |
| Security | Data Mutation | Keine bestehenden Notes aendern |
| Compatibility | Review-Bot | Vollstaendig compliant |
| Compatibility | Mobile | Obsidian Mobile kompatibel |
| Compatibility | Iconic | Optional, graceful degradation |
| Scalability | Tasks pro Antwort | Bis 50 handhabbar |
| Scalability | Vault Size | Bis 10.000+ Notes performant |

---

## 4. Constraints

- **Deterministisch**: Kein LLM-Call im gesamten Task-Flow
- **Obsidian API only**: vault.create, vault.createFolder, Modal, DOM helpers
- **Review-Bot Rules**: Kein innerHTML, console.log, any, fetch, Vault.delete
- **TypeScript strict**: Keine any-Types
- **Unicode Properties**: Fälligkeit als Property-Name muss funktionieren
- **Bestehende Notes**: NICHT veraendern (append-only Pattern)
- **Base Format**: Natives .base YAML-Format von Obsidian

---

## 5. Open Architecture Questions

1. **Hook-Pattern**: Observer/EventEmitter vs. direkter Callback in `renderAssistantMessage()`? Empfehlung fuer Extensibility?

2. **Module-Struktur**: `src/core/tasks/` (eigener Domain-Ordner) vs. `src/core/hooks/` (generisches Hook-System) vs. `src/core/post-processing/` (Feature-uebergreifend)?

3. **Base Code-Reuse**: Import von CreateBaseTool-Logik (extracting shared function) vs. eigene Base-Helper-Klasse? Wie trennt man Tool-Interface von Business-Logik?

4. **Modal-Typ**: Obsidian `Modal` subclass mit manuellem DOM vs. `SuggestModal<TaskItem>` mit Checkbox-Extension? Was ist Obsidian-idiomatischer?

5. **Schema-Versionierung**: `schemaVersion: 1` im Frontmatter fuer spaetere Migration? Oder YAGNI fuer PoC?

6. **Iconic-Detection**: Direkt `app.plugins.enabledPlugins.has('iconic')` oder ueber VaultDNA Scanner (der bereits Plugin-Detection kann)?

7. **Settings-Architektur**: Eigene Settings-Section in Plugin-Settings vs. Integration in bestehende Tool-Settings-Struktur?

8. **Error-Handling**: Was passiert bei partiellem Batch-Fehler (3 von 10 Notes erstellt, Note 4 failt)? Rollback vs. Continue-and-Report?

---

## 6. Vorgeschlagene ADRs

| ADR | Titel | Prioritaet |
|-----|-------|------------|
| ADR-XXX | Post-Processing Hook Pattern | Critical |
| ADR-XXX | Task-Note Frontmatter Schema Design | Critical |
| ADR-XXX | Optional Community Plugin Integration Pattern | Moderate |

---

## 7. Context fuer Architektur-Entscheidungen

### Bestehende Patterns im Codebase

**Tool-Pattern** (Referenz, nicht direkt anwendbar):
- Jedes Tool ist eine eigene Datei in `src/core/tools/`
- Tools haben `definition()` und `execute()` Methoden
- Pipeline: ToolExecutionPipeline mit Approval-Flow

**Relevante bestehende Dateien:**
- `src/core/tools/vault/CreateBaseTool.ts` -- Base-YAML-Generierung
- `src/ui/AgentSidebarView.ts` -- `renderAssistantMessage()` als Hook-Point
- `src/core/skills/VaultDNAScanner.ts` -- Plugin-Detection
- `src/core/skills/CapabilityGapResolver.ts` -- Plugin-Vorschlaege
- `src/core/tools/vault/EnablePluginTool.ts` -- Plugin-Aktivierung

**Settings-Pattern:**
- Zentrale ObsiloSettingTab in `src/ui/settings/`
- data.json fuer Persistenz

### Task-Note Schema (verbindlich)

```yaml
---
type: task
Zusammenfassung: Budget-Analyse fuer Q2 erstellen
Status: Todo
Dringend: false
Wichtig: false
Fälligkeit: 2026-03-10
assignee: "@Sebastian"
source: "[[2026-03-03 Team Meeting]]"
created: 2026-03-03
Notizen: []
icon: lucide//circle-check        # nur wenn Iconic aktiv
iconColor: "#4CAF50"              # nur wenn Iconic aktiv
---
```

**Status-Werte:** Todo | Doing | Done | Waiting
**Base Views:** Offen (Todo+Doing+Waiting) | Erledigt (Done) | Alle (kein Filter)

---

## 8. Naechste Schritte

1. **Architekt**: ADR-Vorschlaege fuer die 3 identifizierten Entscheidungen erstellen
2. **Architekt**: arc42-Bausteinansicht fuer Task-Extraction-Modul
3. **Architekt**: Sequenzdiagramm fuer den Post-Processing-Flow
4. **Dann**: Claude Code Plan-Mode fuer Implementierung
