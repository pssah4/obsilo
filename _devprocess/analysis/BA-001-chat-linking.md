# Business Analysis: Chat-Linking (Semantisches Titling + Auto-Frontmatter-Linking)

> **Scope:** MVP (C)
> **Erstellt:** 2026-03-05
> **Status:** Draft
> **Branch:** add-files-to-chat

---

## 1. Executive Summary

### 1.1 Problem Statement
Chats werden außerhalb des Vaults gespeichert (ConversationStore in `~/.obsidian-agent/history/`). Wenn der Agent Notes erstellt oder bearbeitet, geht die Verbindung zum Chat-Kontext verloren. Der Nutzer kann nicht nachvollziehen, welcher Chat zu einer Note geführt hat, und muss manuell in der History suchen, um frühere Diskussionen und Überlegungen wiederzufinden. Der Chat-Titel (erste 60 Zeichen) ist dabei wenig hilfreich ("Kannst du mir helfen mit..." statt "Refactoring der Auth-Pipeline").

### 1.2 Proposed Solution
Automatische, bidirektionale Traceability zwischen Agent-Chats und bearbeiteten Notes. Nach jeder Write-Operation auf eine Vault-Note wird ein Chat-Link mit aussagekräftigem Titel im Frontmatter eingefügt. LLM-generierte Titel ersetzen das aktuelle Abschneiden der ersten 60 Zeichen. Ein Protocol Handler ermöglicht das direkte Zurückspringen in den Chat per Klick.

### 1.3 Expected Outcomes
- Jede vom Agent bearbeitete Note enthält im Frontmatter einen klickbaren Link zum zugehörigen Chat
- Chat-Titel sind semantisch aussagekräftig (LLM-generiert, 3-8 Wörter)
- Ein Klick auf den Link öffnet den vollständigen Chat in der Sidebar
- Der Nutzer kann vergessene Gedanken und Überlegungen aus früheren Diskussionen wiederaufgreifen und iterativ in seine Konzepte einfließen lassen

---

## 2. Business Context

### 2.1 Background
Obsilo ist ein Obsidian Plugin mit 30+ Agent-Tools. Die Chat-basierte Interaktion ist die primäre Schnittstelle. Im Arbeitsalltag entstehen in den Chats Recherche-Ergebnisse, Entscheidungen und Diskussionen, die über mehrere Iterationen reifen. Der Vault ist die Single Source of Truth für Wissen -- aber der Entstehungsweg dieses Wissens (der Chat) ist derzeit nicht verknüpft.

### 2.2 Current State ("As-Is")
- **Chat-Storage:** ConversationStore speichert Chats außerhalb des Vaults in `~/.obsidian-agent/history/`
- **Chat-Titel:** Erste 60 Zeichen der User-Nachricht, abgeschnitten -- oft wenig aussagekräftig
- **Kein Link:** Vom Agent bearbeitete Notes enthalten keinen Verweis auf den zugehörigen Chat
- **Kein Deep-Link:** Es gibt keine Möglichkeit, einen Chat per URI zu öffnen
- **Nachvollziehbarkeit:** Der Nutzer muss manuell in der History suchen, um den Kontext einer Note-Bearbeitung zu finden

### 2.3 Desired State ("To-Be")
- Agent bearbeitet eine Note -> Frontmatter erhält automatisch einen Chat-Link mit lesbarem Titel
- Nutzer klickt den Link in Obsidians Properties-View -> Chat öffnet sich in der Sidebar
- Chat-Titel in der History sind semantisch (LLM-generiert), nicht abgeschnitten
- Der gesamte Entstehungsweg einer Note ist nachvollziehbar -- wie eine Quellenangabe
- Abschaltbar über ein globales Setting

### 2.4 Gap Analysis

| Bereich | As-Is | To-Be | Gap |
|---------|-------|-------|-----|
| Chat-Titel | Erste 60 Zeichen, abgeschnitten | LLM-generiert, semantisch | Titling-Logik fehlt |
| Note -> Chat Verbindung | Keine | Automatischer Frontmatter-Link | Pipeline-Hook + Stamping fehlt |
| Chat per URI öffnen | Nicht möglich | `obsidian://obsilo-chat?id=...` | Protocol Handler fehlt |
| Nachvollziehbarkeit | Manuelle History-Suche | Ein Klick vom Frontmatter | Alle drei Gaps oben |
| Konfiguration | n/a | Globaler An/Aus-Toggle | Setting fehlt |

---

## 3. Stakeholder Analysis

### 3.1 Stakeholder Map

| Stakeholder | Role | Interest | Influence | Needs |
|-------------|------|----------|-----------|-------|
| Sebastian (Owner) | Entwickler & Primärnutzer | H | H | Nachvollziehbarkeit, iteratives Weiterarbeiten, Vertrauen |
| Obsidian Community | Plugin-Nutzer | M | M | Dezente, nicht-invasive Integration ins Obsidian-Ökosystem |
| Obsidian Review-Bot | Gatekeeper (Plugin Store) | L | H | Compliance: keine verbotenen Patterns, kein innerHTML |

### 3.2 Key Stakeholders

**Primary:** Sebastian -- als einziger Entwickler und Primärnutzer definiert er den Standard für "ausreichend nachvollziehbar"
**Secondary:** Obsidian Community (zukünftige Nutzer, repräsentiert durch Sebastians Qualitätsanspruch)

---

## 4. User Analysis

### 4.1 User Personas

**Persona 1: Konzeptarbeiter (Sebastian)**
- **Rolle:** Entwickler, arbeitet iterativ an Konzepten und Ideen
- **Ziele:** Gedanken aus früheren Chat-Diskussionen wiederaufgreifen; Überlegungen, die über mehrere Iterationen entstanden, nachvollziehbar in Konzepte einfließen lassen; Agent als Sparringspartner für Verfeinerung
- **Pain Points:** Verliert den Faden, wenn er nicht mehr weiß, in welchem Chat die entscheidende Diskussion stattfand; muss manuell in der History scrollen und Chats durchlesen, um den richtigen zu finden
- **Nutzungshäufigkeit:** Daily
- **Typisches Szenario:** Arbeitet an einer Feature-Spec, hat vor 3 Tagen einen ausführlichen Chat dazu geführt, will jetzt den Gedankengang fortsetzen

**Persona 2: Vault-Organisator (Community Power User)**
- **Rolle:** Obsidian-Nutzer mit AI-Unterstützung für Vault-Pflege
- **Ziele:** Nachvollziehen, welche Notes vom Agent bearbeitet wurden und warum
- **Pain Points:** Vertrauen -- bei Batch-Operationen ("strukturiere alle Meeting-Notes") will er nachvollziehen können, was der Agent gemacht hat
- **Nutzungshäufigkeit:** Weekly

### 4.2 User Journey (High-Level)
1. User führt Chat mit dem Agent ("Überarbeite die Feature-Spec für Chat-Linking")
2. Agent bearbeitet die Note -> Frontmatter wird automatisch gestampt
3. Tage später: User öffnet die Note, sieht `obsilo-chats` im Properties-View
4. User klickt den Link -> Chat öffnet sich in der Sidebar
5. User liest die damalige Diskussion nach, gewinnt den Kontext zurück
6. User startet einen neuen Chat, der auf den vorherigen aufbaut

---

## 5. Problem Analysis

### 5.1 Problem Statement (Detailed)
Im Arbeitsalltag entstehen in Agent-Chats wertvolle Überlegungen: Abwägungen, verworfene Alternativen, Begründungen für Entscheidungen. Wenn der Agent daraus eine Note erstellt oder bearbeitet, geht dieser Kontext verloren. Der Vault enthält das Ergebnis, aber nicht den Weg dorthin. Anders als bei akademischen Quellen gibt es keine "Fußnote", die auf den Ursprung verweist.

Chats sind dabei bewusst kein Vault-Content -- sie enthalten unreife Gedanken, Brainstorming und Zwischenstände, die nicht als "Wissen" betrachtet werden sollen. Der Vault bleibt Single Source of Truth. Aber der Chat-Link als Quellenangabe ermöglicht es, den Entstehungsweg bei Bedarf nachzuvollziehen.

### 5.2 Root Causes
1. **Architektonische Trennung:** ConversationStore liegt außerhalb des Vaults -- by design, aber ohne Brücke
2. **Fehlendes Linking:** Die ToolExecutionPipeline hat keinen Post-Write-Hook für Metadaten-Anreicherung
3. **Schlechte Chat-Titel:** Abschneiden der ersten 60 Zeichen ist semantisch unbrauchbar für Wiederauffinden
4. **Kein Deep-Link-Mechanismus:** Obsidian Protocol Handler für Plugin-spezifische URIs ist nicht registriert

### 5.3 Impact
- **Business Impact:** Agent wird als "Black Box" wahrgenommen -- man sieht das Ergebnis, aber nicht den Prozess. Reduziert Vertrauen und erschwert iteratives Arbeiten.
- **User Impact:** Zeitverlust durch manuelles Suchen in der History; Kontextverlust bei längeren Projekten; vergessene Gedanken, die nicht mehr auffindbar sind

---

## 6. Goals & Objectives

### 6.1 Business Goals
- Obsilo als transparenten, nachvollziehbaren AI-Agenten positionieren
- Iteratives Arbeiten über Chat-Grenzen hinweg ermöglichen
- Vertrauen in Agent-Operationen durch Provenienz-Information stärken

### 6.2 User Goals
- Aus jeder vom Agent bearbeiteten Note mit einem Klick in den zugehörigen Chat zurückspringen
- Chat-Kontext (Diskussionen, Abwägungen, Entscheidungen) bei Bedarf nachvollziehen
- Vergessene Gedanken wiederaufgreifen und Konzepte iterativ verfeinern

### 6.3 Success Metrics (KPIs)

| KPI | Baseline | Target | Timeframe |
|-----|----------|--------|-----------|
| Frontmatter-Link-Präsenz | 0% der Agent-bearbeiteten Notes | 100% der .md-Writes | MVP |
| Deep-Link-Erfolgsrate | 0% (nicht möglich) | 100% bei existierender Conversation | MVP |
| Titel-Qualität | 60-Zeichen-Abschnitt | Semantisch, 3-8 Wörter (LLM) | MVP |
| Fallback-Zuverlässigkeit | n/a | 100% (bei LLM-Fehler greift Fallback) | MVP |
| Titel-Update-Rate | n/a | Fallback-Titel wird bei nächstem Write durch LLM-Titel ersetzt | MVP |

---

## 7. Scope Definition

### 7.1 In Scope
- LLM-generierte semantische Chat-Titel (3-8 Wörter)
- Protocol Handler `obsidian://obsilo-chat?id=...` für Deep-Links
- Automatisches Frontmatter-Stamping (`obsilo-chats`) bei Write-Operationen auf Vault-.md-Dateien
- Markdown-Link-Format mit Titel: `[Titel](obsidian://obsilo-chat?id=...)`
- Titel-Update: Bei erneutem Write auf dieselbe Note wird der Fallback-Titel durch den LLM-Titel ersetzt
- Globaler An/Aus-Toggle (`chatLinking: boolean`, Default: `true`)
- Graceful Handling bei gelöschter Conversation (Protocol Handler)

### 7.2 Out of Scope
- Chat-Export als Vault-Dateien (Chats sind kein Vault-Content)
- Rückrichtung: automatischer Link vom Chat zur Note
- Subtask-Propagation (Subtasks erben keine conversationId)
- Re-Titling (Titel wird nur einmal nach erster Antwort generiert)
- Externe Nutzung der Deep-Links (nur innerhalb Obsidian)
- Ordner-basierte Ausschlüsse oder Mode-basiertes Linking
- Indexierung von Chats für Semantic Search
- Stamping von Non-.md-Dateien (Canvas, Bases, JSON, Config)
- Stamping von Dateien außerhalb des Vaults (`.obsidian/`-Config, Assets)

### 7.3 Assumptions
- `processFrontMatter` ist zuverlässig für atomare YAML-Updates
- Das `memoryModelKey`-Modell ist günstig genug für Titling-Calls
- Obsidian Properties-View rendert Markdown-Links in YAML-Arrays klickbar
- ConversationStore-IDs sind stabil und ändern sich nicht nachträglich

### 7.4 Constraints
- **Obsidian Plugin Review-Bot:** Kein `innerHTML`, kein `console.log`, keine verbotenen Patterns
- **Pipeline-Architektur:** Hook muss in bestehende ToolExecutionPipeline passen (ADR-001)
- **Performance:** Frontmatter-Stamping darf Write-Operationen nicht merkbar verzögern
- **Single-Threaded:** Obsidian/Electron ist single-threaded; Race Conditions bei schnellen Writes müssen technisch mitigiert werden

---

## 8. Risk Assessment

### 8.1 Identified Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Race Condition bei schnellen Writes auf gleiche Datei | M | M | Await statt fire-and-forget; oder sequentielle Queue für Frontmatter-Updates |
| Frontmatter-Pollution (10+ Links bei häufig bearbeiteten Notes) | L | L | Bewusst deferred: In der Praxis wird derselbe Chat für dieselbe Note wiederverwendet, das Array wächst kaum. Bei Bedarf nachträglich mitigieren. |
| LLM-Titling-Kosten bei intensiver Nutzung (20+ Chats/Tag) | L | L | Günstiges Modell (memoryModelKey); ein Call pro Chat; bewusst akzeptiertes Kostenrisiko |
| Chat-Titel verrät sensiblen Inhalt im Frontmatter | L | M | Akzeptiertes Risiko (Single-User-Vault); Abschaltbar via Setting |
| `processFrontMatter` Verhalten ändert sich in Obsidian-Update | L | H | Obsidian API ist stabil; defensives Error-Handling |
| Protocol Handler kollidiert mit anderem Plugin | L | L | Unique Prefix `obsilo-chat` minimiert Risiko |

---

## 9. Requirements Overview (High-Level)

### 9.1 Functional Requirements (Summary)
1. LLM-generierte Chat-Titel nach erster Assistant-Antwort
2. Fallback auf erste 60 Zeichen bei LLM-Fehler
3. Protocol Handler für `obsidian://obsilo-chat?id=...`
4. Automatisches Frontmatter-Stamping bei Write auf Vault-.md-Dateien
5. Markdown-Link-Format mit Titel im Frontmatter
6. Titel-Update bei erneutem Write (wenn LLM-Titel inzwischen verfügbar)
7. Deduplizierung (ein Eintrag pro Chat pro Note)
8. Globaler An/Aus-Toggle

### 9.2 Non-Functional Requirements (Summary)
- **Performance:** Frontmatter-Stamping < 50ms zusätzlich pro Write
- **Reliability:** Race Conditions technisch mitigiert (kein Datenverlust)
- **Resilience:** LLM-Titling-Fehler sind non-fatal (Fallback greift)
- **Compliance:** Obsidian Plugin Review-Bot konform
- **Usability:** Links im Properties-View klickbar; keine manuelle Aktion nötig

### 9.3 Key Features (für RE Agent)

| Priority | Feature | Description |
|----------|---------|-------------|
| P0 | Protocol Handler | Deep-Link `obsidian://obsilo-chat?id=...` öffnet Chat in Sidebar |
| P0 | Auto-Frontmatter-Linking | Pipeline Post-Write Hook stampt `obsilo-chats` mit Titel-Link |
| P1 | Semantisches Chat-Titling | LLM-generierter Titel (3-8 Wörter) nach erster Antwort |
| P2 | Setting | Globaler Toggle `chatLinking` (Default: true) |

---

## 10. Next Steps

- [ ] Review durch Stakeholder (Sebastian)
- [ ] Übergabe an Requirements Engineer: Epic + Feature-Specs aktualisieren
- [ ] Architektur-Review: ADR-022 Aktualisierung (Race-Condition-Mitigation, Titel-Update-Logik)
- [x] ~~Klärung: Max-Anzahl-Strategie für Frontmatter-Links~~ -- Deferred: Problem vermutlich nicht real (gleicher Chat pro Note)

---

## Appendix

### A. Glossar

| Begriff | Definition |
|---------|-----------|
| ConversationStore | Persistenz-Schicht für Chat-Historien, speichert außerhalb des Vaults |
| Frontmatter | YAML-Metadaten am Anfang einer Markdown-Datei |
| Protocol Handler | Obsidian-Mechanismus für Custom-URI-Schemes (`obsidian://...`) |
| Properties-View | Obsidians UI für Frontmatter-Felder (rendert Links klickbar) |
| Pipeline Post-Write Hook | Code, der nach erfolgreicher Tool-Execution in der ToolExecutionPipeline läuft |
| memoryModelKey | Konfiguriertes günstiges Modell für Hintergrund-LLM-Calls |
| Provenienz | Herkunftsnachweis -- woher stammt eine Information? |

### B. Interview Notes (Zusammenfassung)

**Kern-Insight:** "Chats sind nicht Wissen, sondern der Entstehungsweg zum Wissen. Der Vault ist Single Source of Truth. Der Chat-Link ist eine Quellenangabe -- wie eine Fußnote."

**Motivation (alle drei):**
- Traceability: Nachvollziehen, welcher Chat eine Note verändert hat
- Wiederaufnahme: Aus einer Note direkt in den Chat zurückspringen und weiterarbeiten
- Vertrauen: Sehen, dass der Agent die Note bearbeitet hat

**Erfolgsbild:** "Der Agent hilft mir einen Gedanken, den ich vergessen hatte, wieder aufzugreifen und Überlegungen aus seiner vorherigen Diskussion, die in einem Dialog über mehrere Iterationen entstanden ist, wieder nachvollziehbar in meine Überlegungen einbeziehen zu können und so ein Konzept oder eine Idee nochmals zu verfeinern, zu verbessern."

**Nutzungsverhalten:**
- Agent bearbeitet 1-10+ Notes pro Session (aufgabenabhängig)
- Rücksprung in Chats: kontextabhängig, vergleichbar mit ChatGPT/Claude-Nutzung
- Nur innerhalb Obsidian (keine externen Deep-Links)

**Edge-Case-Entscheidungen:**
- Neue + bestehende Notes: beide bekommen Links
- Nur Vault-interne .md-Dateien (keine Config, keine .obsidian/)
- Dedupliziert: ein Eintrag pro Chat, egal wie oft bearbeitet
- Titel-Update bei erneutem Write ist Pflicht (kein kryptischer Fallback als Endzustand)

**Risiko-Bewertung:**
- Race Condition: muss technisch mitigiert werden (kein fire-and-forget)
- Frontmatter-Pollution: bewusst deferred (in der Praxis wird derselbe Chat wiederverwendet)
- LLM-Kosten: bewusst akzeptiert (günstiges Modell)
- Privacy: akzeptiertes Risiko (Single-User-Vault)

**Priorisierung der Komponenten:** Protocol Handler > Auto-Frontmatter-Linking > Semantisches Titling > Setting

### C. References
- Feature-Spec: `_devprocess/requirements/features/FEATURE-chat-linking.md`
- ADR-022: `_devprocess/architecture/ADR-022-chat-linking.md`
- Pipeline-Architektur: ADR-001 (Central Tool Execution Pipeline)
- ConversationStore: `src/core/history/ConversationStore.ts`
