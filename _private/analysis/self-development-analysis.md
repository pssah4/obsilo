# Analyse: Agent Self-Development (Meta-Agent)

> Herleitung und Reasoning fuer die Self-Development-Architektur von Obsilo Agent

**Datum**: 2026-02-28
**Status**: Analyse abgeschlossen, Implementierung ausstehend

---

## 1. Ausgangslage

### 1.1 Vision

Der Agent ist das **einzige Interface**. Der User promptet, der Agent konfiguriert und erweitert sich selbst. Eine Basisversion wird als Community Plugin ausgeliefert — alles darueber hinaus entsteht durch Interaktion mit dem Agent.

### 1.2 Ausgangsvorschlag: Sandboxed Code Execution (Sonnet 4.6)

Die initiale Idee (erarbeitet mit Sonnet 4.6) sah vor:
- `isolated-vm` als Sandbox fuer Code-Ausfuehrung
- Strikte Trennung von Agent-Code und User-Code
- Vorinstallierte Utility-Libraries in der Sandbox

### 1.3 Warum dieser Ansatz nicht funktioniert

**`isolated-vm` erfordert native C++ Kompilierung (node-gyp)**. Das bricht fundamental mit dem Obsidian Community Plugin-Modell:

1. Community Plugins werden als **einzelne `main.js`** ausgeliefert (kein node_modules, keine native Dependencies)
2. `node-gyp` benoetigt Python + C++ Compiler auf dem Host — nicht voraussetzbar bei Endusern
3. Obsidian's Review-Bot wuerde native Dependencies ablehnen
4. Cross-Platform-Builds (Windows/Mac/Linux) waeren extrem fragil

**Erkenntnis**: Jede Loesung muss mit reinem JavaScript/TypeScript funktionieren, das in einer einzigen `main.js` gebundelt wird.

---

## 2. Herleitungskette

### 2.1 Constraint-Analyse

Aus der Diskussion kristallisierten sich vier harte Constraints heraus:

| Constraint | Implikation |
|-----------|------------|
| **Electron-only** | Kein Shell-Zugriff, keine Host-Installationen, keine child_process-Aufrufe |
| **Community-Plugin-tauglich** | Einzelne main.js, keine native Dependencies, kein node-gyp |
| **Review-Bot compliant** | Kein fetch(), kein console.log(), kein innerHTML, keine hardcodierten Pfade |
| **Kein Tier-2** | Alle Faehigkeiten muessen in Tier 1 (innerhalb Electron) verfuegbar sein |

### 2.2 Inspiration: OpenClaw und Craft Agents

**OpenClaw** (140k+ Stars) brachte folgende Einsichten:
- **Skills als Markdown**: Kein Code noetig fuer 80% der Automatisierungen
- **Progressive Disclosure**: Metadata immer im Context, Body nur bei Trigger, References on-demand
- **Self-Improving Agent**: Agent schlaegt Skill-Erstellung vor, wenn er Muster erkennt
- **Pre-Compaction Flush**: Vor Context-Condensing werden Erkenntnisse persistiert

**Craft Agents** ergaenzte:
- **SKILL.md mit Frontmatter**: Strukturiertes Format fuer Agent-erstellte Skills
- **Validation Tools**: Agent kann eigene Artefakte validieren
- **Agent-gesteuerte Config**: Agent konfiguriert sich selbst ueber Tools

### 2.3 Kern-Erkenntnis: Drei Stufen des Self-Development

Self-Development ist kein einzelnes Feature, sondern ein **Stufenmodell**:

```
Stufe 1: Skills (Markdown)
  → Workflow-Instruktionen, kein Code
  → ~80% aller Faelle
  → Risiko: Niedrig

Stufe 2: Dynamic Modules (TypeScript → JS)
  → Neue Capabilities via kompilierten Code
  → ~15% der Faelle
  → Risiko: Mittel (Sandbox)

Stufe 3: Core Self-Modification
  → Plugin baut sich selbst neu
  → ~5% der Faelle (nur echte Core-Bugs)
  → Risiko: Hoch (Backup + Rollback)
```

**Warum drei Stufen?**
- **Stufe 1** deckt die haeufigsten Faelle ab (neue Workflows, Vorlagen, Routinen)
- **Stufe 2** wird erst noetig, wenn tatsaechlicher Code benoetigt wird (Datentransformationen, Berechnungen)
- **Stufe 3** ist der letzte Ausweg, wenn ein Bug im kompilierten Core-Code liegt

Der Agent waehlt automatisch die niedrigste ausreichende Stufe.

### 2.4 Loesung des Build-Problems: esbuild-wasm

**Problem**: TypeScript muss in JavaScript kompiliert werden, aber wir haben keinen Zugriff auf den Host (kein npx, kein tsc).

**Loesung**: `esbuild-wasm` — eine reine WebAssembly-Version von esbuild:
- Laeuft in-process innerhalb von Electron
- Keine native Dependencies
- ~11MB, kann on-demand via `requestUrl` (Obsidian API) heruntergeladen werden
- Kompiliert einzelne Module in ~100ms, Full-Rebuild in ~20-30s

**On-Demand Bootstrapping**: esbuild-wasm wird NICHT mit dem Plugin ausgeliefert (zu gross fuer Community Plugin). Stattdessen:
1. Beim ersten Bedarf fragt der Agent: "Ich brauche meine Entwicklungsumgebung (~11MB). Fortfahren?"
2. Download via `requestUrl` (npm CDN)
3. Lokale Speicherung im Plugin-Daten-Verzeichnis
4. Danach sofort verfuegbar fuer alle zukuenftigen Kompilierungen

### 2.5 Loesung des Sandbox-Problems: vm.createContext()

**Problem**: Dynamisch kompilierter Code muss sicher ausgefuehrt werden, ohne Zugriff auf Host-Ressourcen.

**Loesung**: Node.js `vm` Modul (in Electron verfuegbar):
- `vm.createContext()` erstellt eine isolierte Ausfuehrungsumgebung
- Nur explizit injizierte APIs sind verfuegbar (Vault-Zugriff, JSON, Math, Date, RegExp)
- NICHT verfuegbar: process, require, import, fs, child_process, net, http, electron, fetch, window, document

**Zusaetzliche Sicherheit**: AST-Validation vor Kompilierung blockiert:
- `eval`, `Function`, `require`, `import`
- `process`, `__proto__`, `this.constructor`
- `arguments.callee`, `Proxy`, `Reflect`
- Alle Node.js built-in Module

### 2.6 Loesung des Codebase-Knowledge-Problems: Embedded Source

**Problem**: Der Agent kennt seine eigene Codebase nicht. Community-User haben nur `main.js`, keine `.ts`-Dateien.

**Loesung**: Zwei Ebenen von Self-Knowledge:

1. **ARCHITECTURE.md** (eingebettet im Plugin):
   - Beschreibt Key Files, Interfaces, Import-Graph, Patterns
   - Reicht fuer Dynamic Modules (Agent muss nur DynamicToolDefinition kennen)
   - Aktualisiert bei jedem Release

2. **EMBEDDED_SOURCE** (fuer Core Self-Modification):
   - TypeScript-Source komprimiert in main.js eingebettet (~200-500KB)
   - Generiert durch esbuild-Plugin waehrend des Builds
   - Agent extrahiert Source bei Bedarf, modifiziert im Speicher, baut neu

### 2.7 Integration mit bestehendem Memory-System

**Problem**: Wie weiss der Agent, was er gelernt hat, welche Tools er erstellt hat, und welche Fehler er kennt?

**Bestehendes System** (voll funktionsfaehig):
- `soul.md` — Persoenlichkeit
- `user-profile.md` — User-Kontext
- `patterns.md` — 9 Verhaltensmuster
- `learnings.md` — 10+ Learnings
- `projects.md` — Aktive Projekte
- `sessions/` — 10+ Session-Summaries
- `episodes/` — 31 aufgezeichnete Episodes

**Erweiterung fuer Self-Development**:
- `errors.md` — Wiederkehrende Fehler + Loesungen (NEUE Memory-Datei)
- `custom-tools.md` — Register aller erstellten Dynamic Tools + Skills (NEUE Memory-Datei)
- LongTermExtractor erkennt Self-Improvement-Facts:
  - Skill erstellt → learnings.md Update
  - Error gefixt → errors.md Update
  - Pattern erkannt → patterns.md Update
  - Tool erstellt → custom-tools.md Update

**Pre-Compaction Memory Flush** (von OpenClaw):
Vor Context-Condensing in AgentTask: automatischer Prompt an den Agent um wichtige Erkenntnisse in Memory zu persistieren. Verhindert Wissensverlust bei langen Sessions.

---

## 3. Architektur-Entscheidungen

### 3.1 Dynamic Modules sind NICHT Teil von main.js

**Entscheidung**: Dynamic Modules werden separat kompiliert und separat geladen. main.js aendert sich nur bei Core Self-Modification (Stufe 3).

**Begruendung**:
- Unabhaengige Lebenszyklen (Module koennen hinzugefuegt/entfernt werden ohne Rebuild)
- Sandbox-Isolation (vm.createContext fuer jedes Modul)
- Geringeres Risiko (fehlerhaftes Modul bricht nicht das Plugin)

### 3.2 Patch-Module vor Full Rebuild

**Entscheidung**: Bevor der Agent einen Full Rebuild macht, versucht er einen Patch als Dynamic Module.

**Begruendung**:
- Patch-Module: Kein Rebuild, kein Risiko, sofort wirksam, main.js bleibt unberuehrt
- Full Rebuild: ~20-30s, kann Plugin brechen, benoetigt Backup + Rollback
- In 95% der Faelle reicht ein Patch

**Trade-off**: Patch-Module brauchen Zugriff auf Plugin-Internals und laufen daher AUSSERHALB der vm-Sandbox. Erfordert explizite User-Approval.

### 3.3 Nur SSE + streamable-http fuer MCP Self-Configuration

**Entscheidung**: Agent kann nur SSE und streamable-http MCP-Server konfigurieren, kein stdio.

**Begruendung**: stdio spawnt Host-Prozesse via child_process — das bricht den Electron-only-Constraint. SSE/HTTP sind reine Netzwerk-Verbindungen innerhalb von Electron.

### 3.4 `custom_` Prefix fuer Dynamic Tools

**Entscheidung**: Alle dynamisch erstellten Tools tragen den Prefix `custom_`.

**Begruendung**: Kollisionsschutz mit den 30+ eingebauten Tools. Der Agent und die UI koennen sofort erkennen, welche Tools dynamisch erstellt wurden.

### 3.5 Progressive Disclosure fuer Skills

**Entscheidung**: Drei Ladeebenen fuer Skills.

| Ebene | Wann geladen | Budget |
|-------|-------------|--------|
| Metadata (Name+Desc+Trigger) | Immer im System Prompt | ~100 Woerter/Skill |
| Body (Instruktionen) | Wenn Skill getriggert | ~2000 Woerter |
| References (Zusatz-Docs) | On-demand durch Agent | Unbegrenzt |

**Begruendung**: 50 Skills mit je 2000 Woertern im System Prompt wuerden ~100k Tokens verbrauchen — unbezahlbar. Progressive Disclosure haelt den Base-Context schlank.

### 3.6 esbuild-wasm on-demand statt gebundelt

**Entscheidung**: esbuild-wasm (~11MB) wird beim ersten Bedarf heruntergeladen, nicht mit dem Plugin ausgeliefert.

**Begruendung**:
- Community Plugin Review begrenzt Bundle-Groesse
- Nicht jeder User braucht Dynamic Modules
- requestUrl (Obsidian API) ist Review-Bot-compliant
- Einmalig herunterladen, lokal cachen

---

## 4. Risiko-Bewertung

| Stufe | Risiko | Mitigation |
|-------|--------|-----------|
| Skills (Markdown) | **Niedrig** | Kein Code, nur Instruktionen, Hot-Reload |
| Dynamic Modules | **Mittel** | AST-Validation + vm-Sandbox + injizierte APIs + custom_ Prefix |
| Core Self-Modification | **Hoch** | Backup (main.js.bak) + Rollback + DiffReviewModal + User-Approval + Checkpoint |
| esbuild-wasm Download | **Niedrig** | requestUrl (Obsidian API), User-Bestaetigung, lokaler Cache |
| MCP Self-Configuration | **Mittel** | Nur SSE/HTTP (kein stdio), Timeout, Validation |
| Memory-Erweiterung | **Niedrig** | Additive Aenderung an bestehendem System |

---

## 5. Abgrenzung: Was ist NICHT Self-Development

- **Bestehende Features erweitern** (z.B. neue Tool-Parameter) → Normales Plugin-Update
- **User-Daten transformieren** → Bestehende Tools (read_file, write_file)
- **Vault-Struktur aendern** → Bestehende Vault-Tools
- **API-Keys verwalten** → Bestehendes ConfigureModelTool

Self-Development bezieht sich ausschliesslich auf die **Erweiterung der Agent-Faehigkeiten selbst**: neue Workflows (Skills), neue Capabilities (Dynamic Modules), Fehlerkorrektur (Core Modification), und proaktive Verbesserung (Memory + Suggestions).

---

## 6. Zusammenfassung

### Herleitungskette

```
isolated-vm (Sonnet-Vorschlag)
    |
    ✗ Erfordert native C++ (node-gyp) → bricht Community Plugin
    |
    v
vm.createContext() + esbuild-wasm
    |
    + OpenClaw: Skills als Markdown, Progressive Disclosure, Pre-Compaction Flush
    + Craft Agents: SKILL.md Format, Validation Tools, Agent-gesteuerte Config
    |
    v
Drei-Stufen-Modell:
    1. Skills (Markdown) — 80%, kein Code, kein Build
    2. Dynamic Modules (TS→JS) — 15%, vm-Sandbox, separater Build
    3. Core Self-Modification — 5%, Embedded Source, Full Rebuild
    |
    + Electron-only Constraint → kein stdio MCP, kein Host-Shell
    + Kein Tier-2 → alles in Tier 1, esbuild-wasm on-demand
    + Memory-Integration → errors.md, custom-tools.md, LongTermExtractor
    |
    v
Agent ist das einzige Interface.
Basisversion ausgeliefert, alles darueber hinaus durch Prompting.
```

### Kern-Aussagen

1. **Self-Development ist kein einzelnes Feature**, sondern ein Stufenmodell (Skills → Dynamic Modules → Core Modification)
2. **80% der Self-Development-Faelle brauchen keinen Code** — Markdown-Skills reichen
3. **esbuild-wasm + vm.createContext()** ersetzen isolated-vm vollstaendig, ohne native Dependencies
4. **Dynamic Modules sind NICHT Teil von main.js** — separater Lebenszyklus, separate Sandbox
5. **Memory ist das Rueckgrat** — der Agent weiss was er kann, was er gelernt hat, und welche Fehler er kennt
6. **Progressive Disclosure** haelt den Context schlank trotz wachsender Skill-Bibliothek
7. **Patch-Module vor Full Rebuild** — 95% der Core-Bugs lassen sich ohne Rebuild beheben
