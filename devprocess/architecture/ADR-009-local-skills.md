# ADRs: PAS-1 – Local Skills

Dieses Dokument enthält alle Architekturentscheidungen für PAS-1.
Entscheidungen die erst in PAS-2 oder PAS-3 relevant werden, sind dort dokumentiert.

---

## ADR-101: CorePluginSkillLibrary als gebündeltes statisches Asset

**Status:** `ACCEPTED`

**Kontext**

Core Plugins (Obsidian Built-ins) haben kein öffentliches GitHub-Repository, keinen Eintrag im Community Plugin-Registry und keine zur Laufzeit leicht auslesbare Command-Liste. Dennoch sind sie die stabilste und zuverlässigste Basis für Agent-Skills. Optionen:

- (A) Core Plugins ignorieren
- (B) Core Plugin Commands zur Laufzeit aus `app.commands` extrahieren und Skeleton generieren
- (C) Vordefinierte Skill-Dateien manuell pflegen und im Plugin-Bundle mitliefern

**Entscheidung**

Option C. Die `CorePluginSkillLibrary` ist ein statisches Verzeichnis im Plugin-Bundle mit je einer `.skill.md` und `.adapter.json` pro agentifizierbarem Core Plugin. 11 Plugins werden abgedeckt (FULL oder PARTIAL). Die Dateien sind manuell gepflegt, werden mit dem Plugin versioniert und mit Obsidian-Releases bei Bedarf aktualisiert.

**Begründung**

Option A schließt die wertvollsten und stabilsten Skills aus. Option B liefert nur Commands für *aktive* Core Plugins – deaktivierte Core Plugins hätten keinen Skill, obwohl der Agent sie kennen sollte. Außerdem produziert Option B nur Skeletons ohne semantischen Inhalt. Option C ermöglicht sofort vollständige, qualitativ hochwertige Skill-Definitionen ohne Netzwerk, ohne LLM und ohne Latenz. Der Pflegeaufwand ist gering: Core Plugin APIs ändern sich selten.

**Konsequenzen**

- Skill-Dateien für Core Plugins sind < 100ms nach Plugin-Load verfügbar
- Kein Netzwerkzugriff, kein LLM-Call, keine Abhängigkeit von externen Services
- Maintenance: Bei Obsidian Major Releases prüfen ob Core Plugin Commands sich geändert haben → ggf. Adapter-Dateien updaten und neues Plugin-Release veröffentlichen
- Abgedeckte Plugins: daily-notes, canvas, templates, backlink, search, quick-switcher, note-composer, starred, outline, tag-pane, random-note
- Nicht abgedeckt (NONE): audio-recorder, graph, slides, publish, sync, workspaces, zk-prefixer, markdown-importer (keine oder nur UI-Commands)

---

## ADR-102: VaultDNA Scan über `app.plugins.manifests` statt nur `enabledPlugins`

**Status:** `ACCEPTED`

**Kontext**

Obsidian stellt zwei APIs zur Verfügung: `app.plugins.enabledPlugins` (Set der aktiven Plugin-IDs) und `app.plugins.manifests` (Map aller *installierten* Plugins, aktiv und inaktiv). Der Agent könnte nur aktive Plugins scannen oder alle installierten.

**Entscheidung**

Scan über `app.plugins.manifests` – alle installierten Plugins, enabled und disabled.

**Begründung**

Der CapabilityGapResolver (Stufe 2) kann nur dann auf deaktivierte Plugins hinweisen und sie aktivieren, wenn der Agent sie kennt. Würde der Scan nur aktivierte Plugins erfassen, wäre der Agent blind für den installierten-aber-deaktivierten Fall – ein häufiges Szenario bei Nutzern die Plugins testen oder vorübergehend deaktivieren. Deaktivierte Plugins bekommen ein Skill-File mit `enabled: false` und sind damit im CapabilityGapResolver suchbar, aber nicht in System Prompt oder Tool-Array injiziert.

**Konsequenzen**

- Alle installierten Plugins werden in `vault-dna.json` erfasst
- Skill-Files werden für enabled und disabled Plugins generiert
- SkillRegistry injiziert nur `enabled: true` Skills
- Commands für deaktivierte Plugins sind nicht direkt auslesbar (Commands werden erst bei Plugin-Load registriert) → Skeletons für deaktivierte Plugins haben keine Commands-Liste, nur Plugin-Name und Beschreibung (OQ-02 im Feature-Dokument)

---

## ADR-103: Skill-Generierung Stufe A – kein Netzwerk, kein LLM in PAS-1

**Status:** `ACCEPTED`

**Kontext**

Skill-Dateien können auf zwei Qualitätsstufen generiert werden:
- Stufe A (Skeleton): Sofort, aus Manifest + Commands, kein Netzwerk. Minimaler Inhalt.
- Stufe B (Enriched): Async, README von GitHub + LLM-Anreicherung. Hohe Qualität.

PAS-1 ist ein Local-Only Feature ohne Netzwerkzugriff.

**Entscheidung**

PAS-1 implementiert ausschließlich Stufe A. Stufe B wird in PAS-3 ergänzt.

**Begründung**

Stufe B erfordert GitHub-Zugriff (README-Fetch) – auch wenn die eigentliche LLM-Anreicherung local wäre, würde der GitHub-Fetch das Local-Only-Versprechen brechen. Die Alternative (README-Fetch als explizite Nutzer-Aktion) schiebt die Komplexität nach PAS-3 wo sie zusammen mit dem Connected Mode natürlich hingehört. Stufe A-Skills sind funktional: der Agent kann Plugins aufrufen. Die semantische Qualität (wann einsetzen, Beispiele, Grenzen) fehlt noch, aber das ist ein bewusster Trade-off für PAS-1.

**Konsequenzen**

- Alle Community Plugin Skills in PAS-1 haben `enriched: false`
- Skill-Instruktionssektion ist minimal: Plugin-Name + Commands-Liste
- Agent kann Skills aufrufen, hat aber wenig Kontext wann er es tun sollte
- Felder `enriched` und `generated-at` im Frontmatter ermöglichen späteren Upgrade auf Stufe B ohne Neugeneration

---

## ADR-104: SkillRegistry mit Lazy Loading der Skill-Definitionen

**Status:** `ACCEPTED`

**Kontext**

Wenn der Agent viele aktive Skills hat, könnte das Injizieren aller Skill-Beschreibungen in den System Prompt den Context aufblähen und Token-Kosten erhöhen. Zwei Ansätze:

- (A) Alle Skill-Beschreibungen immer im System Prompt
- (B) Nur kompakte Skill-Liste im System Prompt, volle Beschreibung on demand

**Entscheidung**

Option B: Lazy Loading. Der System Prompt enthält eine einzeilige Liste aller aktiven Skills (Name + kompakte Capability). Die volle `.skill.md` Beschreibung wird erst in den Context geladen wenn der Skill tatsächlich genutzt wird.

**Begründung**

Bei 20+ aktiven Skills würde Option A den System Prompt um mehrere Tausend Token vergrößern – für jeden Request, auch wenn die meisten Skills nicht genutzt werden. Option B hält den permanenten Context schlank. In PAS-1 ist der Effekt noch moderat (Skeletons sind kurz), wird aber in PAS-3 mit LLM-angereicherten Beschreibungen wichtig.

**Konsequenzen**

- System Prompt Sektion "Verfügbare Skills" enthält nur: `daily-notes · canvas · dataview · [+N]`
- Wenn Agent einen Skill nutzen will: `.skill.md` wird via Tool-Call oder direktem File-Read nachgeladen
- Erster Aufruf eines Skills pro Session hat minimalen Overhead (~1 extra Tool-Call)
- Folgeaufrufe desselben Skills in derselben Session: Beschreibung ist bereits im Context

---

## ADR-105: `vault-dna.json` als persistenter Vault-Status

**Status:** `ACCEPTED`

**Kontext**

Der CapabilityGapResolver muss über deaktivierte und früher installierte Plugins Bescheid wissen – auch wenn diese beim Scan nicht aktiv waren. Diese Information muss persistent sein: nach einem Neustart soll der Agent noch wissen dass Kanban früher installiert war.

**Entscheidung**

`vault/.agent/vault-dna.json` persistiert den vollständigen Status aller jemals gesehenen Vault-Plugins: `enabled`, `disabled`, und `archived` (deinstalliert). Die Datei wird beim Init-Scan geschrieben und bei jedem Plugin-Event (install/uninstall/enable/disable) inkrementell aktualisiert.

**Begründung**

Ohne Persistenz verliert der Agent nach einem Neustart das Wissen über deaktivierte und früher installierte Plugins. Der CapabilityGapResolver kann dann in Stufe 2 und 3 keine Hinweise mehr geben. `vault-dna.json` ist das Langzeitgedächtnis des Agents über den Vault-Plugin-Status.

**Konsequenzen**

- Datei wird bei jedem Plugin-Event geschrieben → I/O ist minimal (kleine JSON-Datei)
- Bei Vault-Sync über mehrere Geräte: `vault-dna.json` wird synchronisiert; auf dem Zielgerät muss das Plugin installiert sein, sonst `status: unavailable`
- Datei ist human-readable und kann vom Nutzer eingesehen werden
- `archived`-Einträge wachsen über Zeit; keine automatische Bereinigung in PAS-1

---

## ADR-106: CapabilityGapResolver als eigenständige Komponente, nicht als Agent-Prompt-Instruction

**Status:** `ACCEPTED`

**Kontext**

Die Gap-Resolution (was tun wenn kein passender Skill vorhanden) könnte als Instruction im System Prompt implementiert werden ("Wenn du keine Fähigkeit hast, prüfe ob deaktivierte Plugins helfen könnten") oder als explizite TypeScript-Komponente die der Agent per Tool-Call aufruft.

**Entscheidung**

Eigenständige TypeScript-Komponente. Der Agent ruft `resolve_capability_gap(capability, context)` auf und bekommt ein strukturiertes Ergebnis zurück.

**Begründung**

Als Prompt-Instruction ist das Verhalten nicht deterministisch und schwer testbar. Der Agent könnte die Instruction vergessen, falsch interpretieren oder inkonsistent anwenden. Als TypeScript-Komponente ist der 3-Stufen-Flow exakt definiert, unit-testbar und gibt immer ein typisiertes Ergebnis zurück. Das Ergebnis enthält den vorbereiteten Chat-Text den der Agent dem Nutzer zeigen soll – der Agent muss die Logik nicht selbst formulieren.

**Konsequenzen**

- `resolve_capability_gap` ist ein Tool in der Anthropic Tool-Definition
- Agent ruft es explizit auf wenn er keine passende Fähigkeit findet
- Ergebnis-Typen: `active-skill` (Agent nutzt direkt), `disabled-plugin` (Agent zeigt Approval-Nachricht), `archived` (Agent nennt früheres Plugin als Hinweis), `false` (Agent erklärt Lücke)
- Klare Verantwortungstrennung: Logik in TypeScript, Kommunikation beim Agent

---

## ADR-107: Klassifizierungs-Heuristik über Commands

**Status:** `ACCEPTED`

**Kontext**

Der Agent soll nur Plugins als Skills registrieren die er sinnvoll nutzen kann. Ein Plugin mit ausschließlich UI-Commands (Settings öffnen, Panel anzeigen) ist nicht agentifizierbar. Optionen für die Klassifizierung:

- (A) Alle installierten Plugins als Skills (keine Filterung)
- (B) Manuelle Whitelist/Blacklist
- (C) Heuristik: Commands analysieren, UI-only filtern, nach Anzahl meaningful Commands klassifizieren

**Entscheidung**

Option C: Command-basierte Heuristik.

```
0 Commands           → NONE
Alle Commands UI-only → NONE
1-2 meaningful        → PARTIAL
3+ meaningful         → FULL
```

UI-only Pattern: Commands die mit "toggle", "open", "show", "settings", "focus", "panel", "sidebar", "pane" beginnen oder enden.

**Begründung**

Option A würde den System Prompt mit nutzlosen Skills aufblähen. Option B erfordert manuellen Aufwand und skaliert nicht. Option C automatisiert die Filterung mit einer einfachen Heuristik die für die große Mehrheit der Plugins korrekt ist. False Positives (als FULL klassifiziert obwohl schlecht agentifizierbar) sind besser als False Negatives (nützliche Plugins ignoriert). Der Nutzer kann einzelne Skills über den Settings Tab manuell deaktivieren.

**Konsequenzen**

- NONE-Plugins werden in `vault-dna.json` mit `reason` eingetragen aber kein Skill-File generiert
- Heuristik kann für manche Plugins suboptimal sein → Nutzer-Override via Settings Tab
- In PAS-3 kann LLM-Anreicherung die Klassifizierung verfeinern (als zweiter Pass)

---

## ADR-108: Plugin API Bridge statt offener Shell-Zugriff

**Status:** `ACCEPTED`

**Kontext**

Der Agent kann Obsidian-Commands per `execute_command` feuern, aber: kein Parameter-Passing, kein Return-Value. Viele wertvolle Plugins (Dataview, Omnisearch, MetaEdit) bieten JavaScript-APIs die strukturierte Daten liefern. In VS Code loest Kilo Code das ueber eine offene Shell (`execa({ shell: true })`). Obsidian-Nutzer sind aber haeufig nicht technikaffin – eine offene Shell waere ein erhebliches Sicherheitsrisiko.

Optionen:
- (A) Offene Shell (`execute_shell`) mit Allowlist
- (B) Plugin API Bridge: direkter Aufruf von Plugin-JS-APIs ohne Shell
- (C) Beides (API Bridge + eingeschraenkte Shell fuer externe Tools)
- (D) Kein neues Tool – nur bestehende `execute_command` nutzen

**Entscheidung**

Option C, aufgeteilt in zwei spezialisierte Tools: `call_plugin_api` (API Bridge, ADR-108) und `execute_recipe` (eingeschraenkte Shell, ADR-109). Die offene Shell (Option A) wird explizit abgelehnt.

**Begruendung**

Option A (`shell: true`) erlaubt Shell-Expansion, Pipe-Chains und Metazeichen-Interpretation – fuer nicht-technische User inakzeptabel. Option D ist zu eingeschraenkt: `executeCommandById()` nimmt keine Parameter und liefert keinen Output. Option B allein deckt externe Tools (Pandoc, LaTeX) nicht ab. Option C kombiniert die Staerken: Plugin-APIs laufen in Obsidians JS-Sandbox (sicher), externe Tools laufen ueber `spawn` mit `shell: false` und validierte Rezepte (kontrolliert).

**Sicherheitsarchitektur (7 Schichten)**

```
Schicht 1: Master-Toggle (recipes.enabled: false, pluginApi.enabled: true)
Schicht 2: Statische Allowlist (compile-time, nicht vom Agent aenderbar)
Schicht 3: Parameter-Validierung (Typ, Laenge, Zeichensatz, Pfad-Confinement)
Schicht 4: Keine Shell-Expansion (spawn mit args-Array, NICHT shell: true)
Schicht 5: Pipeline-Approval (isWriteOperation = true, fail-closed)
Schicht 6: Prozess-Confinement (cwd=vault, Timeout, Output-Limit, SIGKILL)
Schicht 7: Audit-Trail (OperationLogger, Parameter-Sanitization)
```

**Konsequenzen**

- Plugin-API-Calls laufen in Obsidians JS-Runtime (kein Prozess-Spawn)
- Zweistufige Allowlist: Built-in (compile-time, kuratiert) + dynamische Discovery (VaultDNA Scanner)
- Dynamisch entdeckte Methoden sind IMMER `isWrite = true` bis User explizit als safe markiert
- Methoden-Blocklist: `execute`, `executeJs`, `render`, `register`, `unregister` immer geblockt
- NexusIQ/SonarQube-konform: kein Command Injection, kein Path Traversal, kein Arbitrary Code Exec

---

## ADR-109: Recipe Shell statt offener Shell fuer externe Tools

**Status:** `ACCEPTED`

**Kontext**

Manche Aufgaben erfordern externe Binaries (Pandoc fuer PDF/DOCX-Export, LaTeX). Diese koennen nicht ueber Plugin-APIs aufgerufen werden. Eine offene Shell (`shell: true`) wie in Kilo Code ist fuer die Obsidian-Zielgruppe zu riskant.

Optionen:
- (A) `execa({ shell: true })` mit Allowlist (Kilo Code Ansatz)
- (B) `child_process.spawn(binary, argsArray, { shell: false })` mit vordefinierten Rezepten
- (C) Kein externer Tool-Zugriff

**Entscheidung**

Option B: Recipe Shell mit `spawn` ohne Shell-Expansion.

**Begruendung**

Option A interpretiert Shell-Metazeichen (`$()`, Backticks, `|`, `;`) in Parametern – selbst mit Allowlist ist Command Injection moeglich wenn Parameter nicht korrekt escaped werden. Option B eliminiert dieses Risiko komplett: `spawn` mit `shell: false` uebergibt Parameter als isolierte Array-Elemente. Die Shell interpretiert nichts. Kilo Codes `containsDangerousSubstitution()` ist ein schmaler Regex der bekannte Patterns prueft – neue Injection-Vektoren koennten durchkommen. Unsere Loesung ist by-design sicher: keine Shell, keine Interpretation.

```typescript
// KILO CODE (unsicher fuer non-tech Users):
execa({ shell: true })`pandoc "${input}" -o "${output}"`

// UNSER ANSATZ:
spawn(binaryPath, [input, '-o', output], { shell: false })
```

**Rezept-System**

Jedes Rezept definiert:
- `binary`: Name des externen Programms (resolved via `which`/`where` zu absolutem Pfad)
- `argsTemplate`: Array von Argument-Templates mit `{{param}}`-Platzhaltern
- `parameters`: Typisierte Parameter mit Validierung (`vault-file`, `vault-output`, `enum`, `safe-string`, `number`)
- `timeout`: Maximale Ausfuehrungszeit mit SIGKILL-Fallback
- `maxOutputSize`: Output-Truncation

Built-in Rezepte: `pandoc-pdf`, `pandoc-docx`, `pandoc-convert`, `check-dependency`.

**Parameter-Validierung**

- Shell-Metazeichen (`;&|`$(){}[]<>\!#~*?\n\r\0`) in ALLEN Parametern verboten
- `vault-file`/`vault-output`: kein `..`, keine absoluten Pfade, `startsWith(vaultRoot)` Check
- `safe-string`: Pattern-Match, max 200 Zeichen
- `enum`: Exact-Match gegen erlaubte Werte
- `number`: Range-Check

**Konsequenzen**

- `recipes.enabled` ist default `false` (Opt-in)
- Jedes Rezept muss einzeln aktiviert werden (`recipeToggles`)
- User kann eigene Rezepte hinzufuegen (validiert beim Laden)
- Kein PATH-Hijacking: Binary-Pfad wird via `which`/`where` zu absolutem Pfad resolved
- Minimale Env-Vars: nur `PATH`, `HOME`, `LANG` (kein `LD_PRELOAD`, `DYLD_*`)
- Output-Streams gecapped, stdin geschlossen
- NexusIQ/SonarQube S-01 bis S-13 abgedeckt (siehe Security-Checkliste im Plan)

## ADR-110: Workflow-Optimierung — Anti-Delegation + Depth-Limit

**Datum:** 2026-02-23
**Status:** ACCEPTED

**Kontext**

Beim Test "Erstelle eine PDF von dieser Note" spawnte der Agent 5 Ebenen rekursiver Sub-Agents statt `execute_recipe` direkt aufzurufen. Root-Causes: (1) System-Prompt ermutigt Delegation ohne klare Grenzen, (2) kein Code-Depth-Limit, (3) keine "einfache Task"-Heuristik, (4) neue PAS-1.5 Tools nicht vor Delegation priorisiert.

**Entscheidung**

Dreistufiger Fix basierend auf Anthropic "Building Effective Agents" und Claude Code Subagent-Patterns:

1. **Prompt-Fixes (P0):** Anti-Delegations-Regel in toolDecisionGuidelines ("If you can do it in 1-4 tool calls, do it yourself"), Agent-Mode Role Definition umstrukturiert (Direktausfuehrung oben, Delegation unten), NewTaskTool Description verschaerft.

2. **Code-Guardrails (P1):** `maxSubtaskDepth` Parameter in AgentTask (default: 2), Depth-Guard in spawnSubtask-Closure (Kind bekommt `spawnSubtask = undefined` bei Tiefenlimit), explizite Fehlermeldung in NewTaskTool.

3. **Token-Optimierung (P2):** Sub-Agent-Tokens an Parent-UI forwarden, Lean Sub-Agent System-Prompt (omits Response-Format, Skills, Custom Instructions, Memory).

**Abgelehnte Alternativen**

- "Race to Success" (Voting): Nx Token-Kosten ohne Qualitaetsgewinn bei deterministischen Tasks
- Separater Orchestrator-Mode: 2-Mode-System (Ask+Agent) ist einfacher
- Parallele Sub-Agents: Rate-Limit-Risiko, keine Result-Aggregation

**Konsequenzen**

- Einfache Tasks (PDF, Plugin-API) werden direkt ausgefuehrt, keine Sub-Agents
- Sub-Agent-Nesting auf maximal 2 Ebenen begrenzt (konfigurierbar)
- Sub-Agent System-Prompts ~20-30% kleiner (Token-Einsparung)
- Sub-Agent Kosten im Parent-Cost-Counter sichtbar
