# Business Analysis: Task Extraction & Management
Status: Draft
Scope: B (Proof of Concept)
Date: 2026-03-03
Parent: BA-obsidian-agent (business-analysis.md)

## 1. Executive Summary

### 1.1 Problem Statement
Agent-generierte Tasks (z.B. aus Meeting Summaries) werden als `- [ ]` Checkboxen am Ende von Notes erstellt. Diese Items sind kontextgebunden, nicht aggregierbar und werden in der Praxis vergessen -- der Nutzer sieht sie nur wenn er die jeweilige Note oeffnet. Es fehlt ein zentraler Ort fuer Task-Tracking aehnlich Microsoft To-Do.

### 1.2 Proposed Approach
Ein deterministischer Post-Processing Hook im Plugin erkennt `- [ ]` Items in Agent-Antworten automatisch per Regex, zeigt dem Nutzer ein Selection Modal mit Checkboxen, und erstellt fuer ausgewaehlte Tasks eigenstaendige Task-Notes mit strukturiertem Frontmatter. Eine Obsidian Base (`.base` Datei) dient als zentrale Task-Uebersicht mit drei Views (Offen, Erledigt, Alle). Das Community Plugin "Iconic" formatiert Task-Notes visuell mit Icons -- mit normalem Text als Fallback. Keine AI-Inferenz noetig -- der gesamte Flow ist regelbasiert.

### 1.3 Expected Outcomes
- Tasks aus Agent-Antworten werden sichtbar und nachverfolgbar
- Zentrale Task-Uebersicht als Obsidian Base mit 3 Views und reichem Property-Set
- Eisenhower-kompatible Priorisierung ueber Dringend/Wichtig Checkboxen
- Visuelle Differenzierung von Task-Notes durch Iconic-Icons (mit Fallback)
- Keine zusaetzlichen Inferenzkosten fuer Task-Erstellung
- Nutzer behaelt volle Kontrolle ueber welche Tasks erstellt werden

## 2. Business Context

### 2.1 Background
Das Obsidian Agent Plugin generiert regelmaessig Content der `- [ ]` Task Items enthaelt -- insbesondere der Meeting Summary Prompt, der Insights & Relevance Prompt, und Workflows die Action Items extrahieren. Diese Tasks sind semantisch wertvoll, gehen aber im Vault unter weil sie nur inline in der jeweiligen Note existieren.

Bestehender Meeting Summary Prompt (Auszug):
> "Create a todo list at the end with tasks from the meeting, if these were clearly discussed."

Der Output ist typischerweise:
```
- [ ] @Sebastian: Budget-Analyse fuer Q2 erstellen (due: 2026-03-10)
- [ ] @Maria: Feedback von Sales einholen
- [ ] Design-Review Meeting ansetzen
```

**Bestehende Plugin-Infrastruktur (relevant):**
- `create_base` / `update_base` / `query_base` Tools fuer Obsidian Bases (implementiert)
- VaultDNA Scanner erkennt installierte Plugins automatisch (implementiert)
- `enable_plugin` Tool kann deaktivierte Plugins aktivieren (implementiert)
- `CapabilityGapResolver` schlaegt passende Plugins vor (implementiert)

### 2.2 Current State (As-Is)
- Agent erstellt `- [ ]` Items als Teil des Antwort-Contents
- Items landen als Markdown in der Note (Meeting Note, Summary, etc.)
- Kein systematischer Weg diese Items wiederzufinden
- Kein zentrales Task-Tracking innerhalb des Vaults
- Nutzer muss jede Note einzeln oeffnen um offene Tasks zu sehen
- Bases-Tools existieren, werden aber nicht fuer Task-Management genutzt

### 2.3 Desired State (To-Be)
- Agent-Antworten mit `- [ ]` Items werden automatisch erkannt
- Nutzer waehlt in einem Modal aus welche Items zu Task-Notes werden
- Jede Task-Note hat strukturiertes Frontmatter mit reichem Property-Set
- Tasks-Ordner im Vault mit einer `.base` Datei als zentrale Uebersicht
- 3 Views: "Offen" (Todo+Doing+Waiting), "Erledigt" (Done), "Alle"
- Eisenhower-Matrix durch Dringend/Wichtig-Checkboxen abbildbar
- Iconic-Plugin formatiert Task-Notes mit visuellen Icons (optional)
- Fallback ohne Iconic: normaler Text, volle Funktionalitaet erhalten
- Backlinks von Task-Notes zur Quell-Note erhalten den Kontext
- Bestehende `- [ ]` Items in der Quell-Note bleiben erhalten (kein Datenverlust)

### 2.4 Gap Analysis
- **Detection Gap**: Kein Mechanismus erkennt Tasks in Agent-Output automatisch
- **Elevation Gap**: Kein Workflow hebt inline-Tasks zu eigenstaendigen Notes hoch
- **Tracking Gap**: Kein zentraler Ort fuer Task-Aggregation im Vault
- **Control Gap**: Nutzer hat keine Moeglichkeit zu entscheiden welche Tasks formalisiert werden
- **Visual Gap**: Task-Notes sehen aus wie jede andere Note -- keine visuelle Differenzierung
- **Property Gap**: Keine strukturierten Felder fuer Prioritaet, Faelligkeit, Zusammenfassung

## 3. Stakeholders

| Stakeholder | Role | Interest | Influence | Needs |
|---|---|---|---|---|
| Knowledge Worker | Primary User | H | H | Keine Tasks vergessen; schneller Ueberblick |
| Meeting-Teilnehmer | Indirect User | M | L | Zugewiesene Tasks nachverfolgbar |
| Plugin Maintainer | Builder | H | H | Deterministisch, wartbar, keine Inferenzkosten |

## 4. Users / Personas

**Persona 1: Meeting-Organisator**
- Role: Wissensarbeiter der regelmaessig Meetings zusammenfasst
- Goals: Action Items aus Meetings systematisch verfolgen
- Pain Points: Vergisst Tasks die in Meeting Notes stehen; kein zentrales Board
- Frequency: 3-5x pro Woche (pro Meeting eine Summary)
- Trigger: Nach jeder Meeting Summary mit dem Agent

**Persona 2: Projekt-Manager im Vault**
- Role: Nutzer der den Vault als Projekt-Hub verwendet
- Goals: Alle offenen Tasks aus verschiedenen Quellen an einem Ort sehen
- Pain Points: Tasks verstreut ueber dutzende Notes; manuelles Zusammensuchen
- Frequency: Taeglich (Task Review)
- Trigger: Morgens beim Tagesstart, Weekly Review

## 5. Problem Analysis

### Root Causes
1. **Architektonisch**: Agent-Output wird als reiner Text behandelt -- es gibt keinen Post-Processing-Schritt der strukturierte Elemente erkennt
2. **Format-bedingt**: `- [ ]` ist ein generisches Markdown-Pattern ohne Semantik auf Vault-Ebene (anders als Frontmatter)
3. **Workflow-Luecke**: Kein Uebergang von "Task erwaehnt" zu "Task formalisiert"
4. **Visuelle Gleichfoermigkeit**: Task-Notes heben sich nicht von regulaeren Notes ab
5. **Fehlende Struktur**: Kein standardisiertes Property-Schema fuer Tasks im Vault

### Business Impact
- Geschaetzte 5-15 Tasks pro Woche werden generiert aber nicht nachverfolgt
- Zeitverlust durch manuelles Durchsuchen von Notes nach offenen Items
- Vertrauensverlust: Nutzer hoeren auf Tasks vom Agent generieren zu lassen wenn sie sowieso untergehen

### User Impact
- Hohe Friktion: Muss sich merken in welcher Note Tasks standen
- Fehleranfaellig: Items werden vergessen oder doppelt erledigt
- Kein Ueberblick: Unmoeglich alle offenen Tasks auf einen Blick zu sehen
- Keine Priorisierung: Keine Unterscheidung zwischen dringend/wichtig

## 6. Goals & Success Metrics

| KPI | Baseline | Target | Timeframe | Measurement |
|---|---|---|---|---|
| Task Detection Rate | 0% (keine Erkennung) | >95% der `- [ ]` Items erkannt | Launch | Automatisierter Test mit Sample-Outputs |
| Task Note Erstellung | 0 (manuell) | <3s pro Task | Launch | Timing im Plugin |
| Zentrale Uebersicht | keine | Base mit 3 Views (Offen, Erledigt, Alle) | Launch | Automatisierter Test |
| Property-Vollstaendigkeit | keine | Alle 10 Properties im Frontmatter | Launch | Template-Validierung |
| User Adoption: Selection | -- | >60% der erkannten Tasks werden ausgewaehlt | 4 Wochen | Opt-in Telemetrie (lokal) |
| Inferenzkosten | variabel | 0 API-Calls fuer Task-Erstellung | Launch | Architektur-Validierung |
| Task Recovery Rate | <20% (geschaetzt) | >80% nachverfolgt | 8 Wochen | User Self-Report |

## 7. Scope Definition

### 7.1 In Scope (PoC)

**Core Feature: Post-Processing Task Extraction**
- Regex-basierter Scanner fuer `- [ ]` Pattern in Agent-Antworten
- Parsing von Assignee (`@Person`), Due Date (`due: YYYY-MM-DD` oder `(due: YYYY-MM-DD)`), und Task-Text
- `TaskSelectionModal` (Obsidian Modal) mit Checkbox-Liste aller erkannten Tasks
- Batch-Erstellung von Task-Notes fuer ausgewaehlte Items

**Task-Note Frontmatter Schema**

| Property | Typ | Werte | Beschreibung |
|---|---|---|---|
| `type` | text | `task` | Identifiziert die Note als Task |
| `Zusammenfassung` | text | Freitext | Kurzbeschreibung der Aufgabe (aus Task-Text) |
| `Status` | text | `Todo`, `Doing`, `Done`, `Waiting` | Aktueller Bearbeitungsstatus |
| `Dringend` | checkbox | true/false | Eisenhower-Dimension: zeitkritisch |
| `Wichtig` | checkbox | true/false | Eisenhower-Dimension: wertbeitragend |
| `Fälligkeit` | date | YYYY-MM-DD | Deadline (geparst aus `due:` oder leer) |
| `assignee` | text | @Person | Zustaendige Person (geparst aus `@`) |
| `source` | text | `[[Note]]` | Wikilink zur Quell-Note |
| `created` | date | YYYY-MM-DD | Erstellungsdatum |
| `Notizen` | list | `[[Note1]]`, `[[Note2]]` | Verwandte Notes zur Aufgabe |

Beispiel Frontmatter:
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
---
```

Default-Werte bei Erstellung: `Status: Todo`, `Dringend: false`, `Wichtig: false`, `Notizen: []`

**Task-Uebersicht als Obsidian Base**
- Automatische Erstellung einer `Tasks/Tasks.base` beim ersten Task-Create
- **View 1 "Offen"**: Filter `Status` ist `Todo`, `Doing`, oder `Waiting`; sortiert nach `Fälligkeit` ASC
- **View 2 "Erledigt"**: Filter `Status == Done`; sortiert nach `Fälligkeit` DESC
- **View 3 "Alle"**: Kein Filter; sortiert nach `Fälligkeit` ASC
- Spalten (alle Views): file.name, Zusammenfassung, Status, Dringend, Wichtig, Fälligkeit, assignee, Notizen
- Nutzung der bestehenden `create_base` Logik (nicht Tool-Call, sondern interner Code-Reuse)

**Iconic Plugin Integration**
- Check ob `iconic` Community Plugin installiert + aktiviert ist (via `app.plugins.enabledPlugins`)
- Wenn aktiv: Iconic-konforme Frontmatter-Properties setzen fuer Task-Notes:
  - `icon` Property mit passendem Icon (z.B. `circle-check` fuer Tasks)
  - `iconColor` basierend auf Priority/Status
- Wenn NICHT installiert/aktiviert:
  - Agent-Hinweis im Chat: "Fuer visuelle Task-Icons empfehle ich das Iconic Plugin. Soll ich es aktivieren?"
  - Nutzt `CapabilityGapResolver` bzw. `enable_plugin` Flow falls Plugin installiert aber deaktiviert
  - Falls nicht installiert: Hinweis mit Link zu Community Plugins
  - Funktionalitaet vollstaendig ohne Iconic nutzbar (normaler Dateiname als Fallback)

**Settings**
- Task Extraction an/aus (Default: an)
- Task-Ordner Pfad (Default: `Tasks/`)
- Auto-detect Threshold: Minimum Anzahl Tasks fuer Modal (Default: 1)

**Integration mit bestehendem Plugin**
- Hook nach `renderAssistantMessage()` in AgentSidebarView
- Respektiert bestehende Vault-Struktur (erstellt Task-Ordner nur bei Bedarf)
- File-Erstellung ueber Obsidian Vault API (`vault.create()`)
- Base-Erstellung ueber internen Code-Reuse von CreateBaseTool-Logik

### 7.2 Out of Scope (PoC)

- **Task-Status-Updates via Plugin**: Automatisches Aendern von `Status` Frontmatter -- manuell durch Nutzer in der Note
- **Recurring Tasks**: Wiederkehrende Tasks oder Erinnerungen
- **Due Date Reminders**: Benachrichtigungen bei faelligen Tasks
- **Task-Prioritaeten-UI im Modal**: Dringend/Wichtig direkt im Selection Modal setzen (PoC: nur Standard-Defaults)
- **AI-basierte Task-Extraktion**: Semantische Erkennung von Tasks die nicht als `- [ ]` formatiert sind
- **Bidirektionale Sync**: Aenderungen an Task-Notes zurueck in die Quell-Note spiegeln
- **Tasks Plugin Kompatibilitaet**: Spezifisches Format fuer Obsidian Tasks Community Plugin
- **Tool `create_task`**: Separates Agent-Tool fuer explizite Task-Erstellung (Phase 2)
- **Kanban-View**: Kanban-Board-Ansicht fuer Tasks (Obsidian Kanban Plugin)
- **Weitere Base Views**: Ueber die 3 Standard-Views hinaus (By Assignee, Overdue, etc.)
- **Eisenhower-Matrix View**: Visuelle 2x2 Matrix -- PoC bietet nur die Checkboxen als Datengrundlage

### 7.3 Assumptions
- Agent-Output enthaelt `- [ ]` im Standard-Markdown-Format
- Nutzer akzeptiert ein Modal nach relevanten Agent-Antworten
- Task-Ordner + Base im Vault ist akzeptabel als Organisationsprinzip
- Frontmatter-basiertes Schema ist kompatibel mit Iconic Plugin
- Obsidian Bases Core Plugin ist aktiviert (Standard seit Obsidian 1.6+)
- Iconic Plugin Format: `icon` und `iconColor` Properties im Frontmatter
- Agent kann Iconic-Status per `app.plugins.enabledPlugins.has('iconic')` pruefen
- Deutsche Property-Namen mit Grossbuchstaben (Zusammenfassung, Status, Dringend, Wichtig, Fälligkeit, Notizen)

### 7.4 Constraints
- **Keine Inferenzkosten**: Gesamter Flow deterministisch (Regex + Template)
- **Obsidian API**: Nur `vault.create()`, `vault.createFolder()`, Obsidian DOM API fuer Modal
- **Review-Bot Compliance**: Kein `innerHTML`, kein `console.log()`, kein `any` Type
- **Performance**: Modal muss in <100ms erscheinen; Task-Note-Erstellung <500ms pro Note
- **Bestehender Content**: `- [ ]` Items in der Quell-Note werden NICHT veraendert
- **Iconic Dependency**: Feature funktioniert vollstaendig OHNE Iconic -- Icons sind Enhancement only
- **Base Format**: Muss kompatibel sein mit Obsidian's nativem `.base` Format
- **Property-Namen**: Exakte Schreibweise: Zusammenfassung, Status, Dringend, Wichtig, Fälligkeit, Notizen

## 8. Risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Regex erkennt nicht alle Task-Formate (verschachtelt, custom Syntax) | M | M | Robustes Pattern; Fallback fuer Edge Cases; User kann manuell triggern |
| Modal stoert den Workflow wenn zu haeufig | M | H | Einstellung zum Deaktivieren; nur bei >0 Tasks; "Nicht nochmal fragen" Option |
| Task-Note Spam bei vielen kleinen Tasks | L | M | Selection Modal als Gate; kein Auto-Create |
| Naming-Konflikte bei Task-Notes | L | M | Slug-Generierung mit Date-Prefix; Conflict-Check vor Create |
| Nutzer erwartet bidirektionale Sync | M | L | Klar kommunizieren: One-Way Extraction; Phase 2 fuer Sync |
| Iconic Plugin aendert Frontmatter-Schema | L | M | Version-Check; Fallback auf normalen Text |
| Base-Datei wird vom Nutzer manuell geloescht/geaendert | L | L | Re-Create bei naechstem Task-Create; Base ist append-only |
| Obsidian Bases Core Plugin deaktiviert | L | M | Check beim Setup; Hinweis an Nutzer; Tasks funktionieren auch ohne Base |
| Deutsche Property-Namen mit Umlauten (Fälligkeit) | M | M | Obsidian unterstuetzt Unicode in Properties; testen auf allen Plattformen |

## 9. Hypothesis (PoC)

**Wir glauben dass** ein deterministischer Post-Processing Hook der `- [ ]` Items in Agent-Antworten erkennt und ueber ein Selection Modal zu eigenstaendigen Task-Notes mit reichem Property-Set, 3-View-Base-Uebersicht und optionaler Iconic-Formatierung macht,

**Dazu fuehrt dass** Nutzer ihre agent-generierten Tasks tatsaechlich nachverfolgen und abarbeiten statt sie in Notes zu vergessen,

**Wir wissen dass die Hypothese stimmt wenn:**
- >60% der erkannten Tasks vom Nutzer zur Erstellung ausgewaehlt werden
- Nutzer die Feature-Einstellung nach 2 Wochen nicht deaktiviert haben
- Task-Base wird regelmaessig geoeffnet (>3x pro Woche)
- Qualitatives Feedback: "Ich vergesse weniger Tasks"

## 10. Acceptable Technical Debt (PoC)

| Shortcut | Description | Cleanup fuer MVP |
|---|---|---|
| Einfaches Regex-Parsing | Nur `- [ ] text` Format, kein Nested | Robusterer Parser mit AST |
| Statisches Template | Festes Frontmatter-Schema | Konfigurierbares Template-System |
| 3 Base Views fix | Offen, Erledigt, Alle -- nicht konfigurierbar | View-Editor in Settings |
| Iconic Check nur bei Note-Create | Kein Live-Monitoring | Reagiert auf Plugin-Enable/Disable Events |
| Slug aus erstem Wort + Datum | Simples Naming ohne Intelligenz | Bessere Slug-Generierung |
| Kein Status-Tracking im Plugin | Status nur manuell im Frontmatter | Task-Status-UI in Sidebar |
| Dringend/Wichtig immer false | Kein Parsing, nur manuelle Aenderung | Agent erkennt Dringlichkeit aus Kontext |
| Notizen-Feld leer bei Erstellung | Nur source-Link gesetzt | Agent fuellt Related Notes |

## 11. Handoff to Orchestrator (mandatory)

### What is decided
- Deterministischer Post-Processing Hook (kein AI-Tool)
- Regex-basierte Erkennung von `- [ ]` Pattern
- Selection Modal als User-Gate
- Task-Notes mit 10 Frontmatter-Properties:
  type, Zusammenfassung, Status, Dringend, Wichtig, Fälligkeit, assignee, source, created, Notizen
- Status-Werte: Todo, Doing, Done, Waiting
- Obsidian Base mit 3 Views: Offen, Erledigt, Alle
- Iconic Plugin fuer visuelle Icons (optional, mit Fallback)
- Kein Eingriff in bestehende Note-Inhalte
- Deutsche Property-Namen (exakte Schreibweise wie spezifiziert)

### What is still open / needs clarification
- Exaktes Iconic Frontmatter-Schema (welche `icon` + `iconColor` Werte pro Status)
- Ob Base-Erstellung ueber Code-Reuse von CreateBaseTool oder eigene Helper-Funktion
- Integration-Point: Hook in `renderAssistantMessage()` vs. separater Observer
- Ob Task-Ordner konfigurierbar sein soll oder fest `Tasks/`
- Ob `Notizen` Property automatisch mit der aktiven Note befuellt werden soll

### What RE must produce next
- Feature-Spec mit tech-agnostischen Success Criteria
- NFRs fuer Architekt (Performance, Vault-Compliance, Iconic-Integration)
- ASRs identifizieren (Hook-Architektur, Modal-Pattern, Base-Integration)

## ORCHESTRATOR SUMMARY (<= 12 lines)
- Scope (A/B/C): B (PoC)
- Primary users: Knowledge Worker die Agent-generierte Tasks nachverfolgen wollen
- Top goal: `- [ ]` Items erkennen -> Task-Notes (10 Properties) -> 3-View Base -> Iconic-Icons
- Top KPIs: >95% Detection Rate; 0 Inferenzkosten; >60% User Selection Rate; Base mit 3 Views
- Properties: type, Zusammenfassung, Status (Todo/Doing/Done/Waiting), Dringend, Wichtig, Fälligkeit, assignee, source, created, Notizen
- Key capabilities: Regex-Scanner, TaskSelectionModal, Template-Notes, 3-View-Base, Iconic-Integration
- Key constraints: Deterministisch (kein AI); Obsidian API only; Review-Bot compliant; Iconic optional
- Top risks: Regex Edge Cases; Modal-Fatigue; Iconic Schema Drift; Umlaut-Properties
- Hypothesis: Formalisierte Task-Notes + Base-Uebersicht + Iconic-Icons -> hoeherer Task-Follow-Through
- Bestehendes: create_base/update_base Tools, VaultDNA Scanner, enable_plugin, CapabilityGapResolver
- Next step: Switch to Requirements Engineer

## CHECK fuer PoC

1. Hypothesis klar formuliert? -- JA (Section 9)
2. Technische Risiken identifiziert? -- JA (Section 8, 9 Risiken)
3. Erfolgskriterien messbar? -- JA (Section 6, 7 KPIs mit Targets)
4. Out-of-Scope explizit? -- JA (Section 7.2, 11 Items)
5. Akzeptable Shortcuts dokumentiert? -- JA (Section 10, 8 Shortcuts)

Score: 5/5 -- RE-Ready
