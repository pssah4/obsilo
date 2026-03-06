# Project Scaffold -- Konsolidiertes Konzept

> Einziges Referenzdokument fuer das wiederverwendbare Projekt-Setup.
> Konsolidiert aus: scaffold-concept.md, scaffold-anleitung.md, scaffold-agents-konzept.md

---

## 1. Motivation

Dieses Projekt (obsidian-agent/obsilo) hat ueber mehrere Monate Strukturen und Workflows
entwickelt, die nicht projektspezifisch sind: Git-Strategie, Dokumentationsstruktur,
Agent-Workflow, Memory-System, CI/CD. Ziel ist ein GitHub Template Repository
(`pssah4/project-scaffold`), das ein neues Projekt mit einem einzigen Befehl auf
denselben Stand bringt.

---

## 2. Umsetzungsform: Warum GitHub Template Repo?

### Evaluierte Optionen

**Option A: Generator-Script (wie `create-react-app`)**
Ein einzelnes Script das alles von Grund auf generiert.
- (+) Alles in einer Datei, kein Repo noetig
- (-) Hunderte Zeilen Bash mit heredocs fuer jede Template-Datei. Schwer wartbar

**Option B: GitHub Template Repo (GEWAEHLT)**
Ein Repo auf GitHub als "Template" markiert. `Use this template` erzeugt ein neues Repo.
- (+) Dateien liegen als echte Dateien vor (editierbar, diffbar)
- (+) Flavors als Branches. GitHub-nativ. Versioniert und teilbar
- (+) init-Script ist klein (~100 Zeilen): nur Platzhalter ersetzen + Memory bootstrap
- (-) Ein extra Repo zu pflegen

**Option C: Lokales Template-Verzeichnis**
Ein Ordner lokal, kopiert per Script.
- (+) Kein GitHub noetig, funktioniert offline
- (-) Kein Versioning, kein Sync zwischen Rechnern

### Warum Option B?

1. **Dateien als echte Dateien** -- in VS Code editierbar, diffbar. Kein heredoc-Wahnsinn.
2. **Flavors als Branches** -- `main` = minimal, `obsidian-plugin` = erweitert.
3. **Das init-Script ist klein** -- Platzhalter ersetzen (`sed`), Memory bootstrappen (`cp`),
   Branches anlegen (`git`), sich selbst loeschen. ~100 Zeilen Bash.
4. **Versioniert** -- Aenderungen am Template committen. Neue Projekte bekommen aktuelle
   Version, bestehende bleiben unberuehrt.

---

## 3. Kurzversion (TL;DR)

```bash
# 1. Repo aus Template erstellen (Flavor = Branch)
gh repo create my-new-app \
  --template pssah4/project-scaffold \
  --private --clone
cd my-new-app

# 2. Optional: Flavor waehlen (Default = minimal)
git checkout obsidian-plugin  # oder: node-lib, web-app

# 3. Init ausfuehren (fragt 3-4 Fragen, richtet alles ein)
./scripts/init-scaffold.sh

# 4. GitHub Secret anlegen (einmalig, nur wenn Public Mirror gewuenscht)
#    -> Repo Settings -> Secrets -> Actions -> New secret
#    -> Name: PUBLIC_REPO_TOKEN, Value: PAT mit 'repo' scope

# 5. Los gehts
claude
```

Ab Schritt 5 kennt Claude dich und deine Arbeitsweise. Kein Erklaeren noetig.

---

## 4. Anleitung: Template-Repo erstellen (einmalig)

### Schritt 1: Repo erstellen und als Template markieren

```bash
gh repo create pssah4/project-scaffold --private --clone
cd project-scaffold
# -> GitHub Settings -> "Template repository" Checkbox aktivieren
```

### Schritt 2: Generische Assets aus obsidian-agent extrahieren

Alle Dateien die ins Template gehoeren (siehe Abschnitt 9 fuer vollstaendige Struktur):

```bash
# Verzeichnisse anlegen
mkdir -p .github/{agents,instructions,templates,workflows,codeql}
mkdir -p _devprocess/{architecture,analysis,analysis/security,context,implementation,prompts}
mkdir -p _devprocess/requirements/{epics,features,handoff}
mkdir -p scripts _global _memory .claude

# Agents, Instructions, Templates aus obsidian-agent kopieren
cp <obsidian-agent>/.github/agents/*.agent.md .github/agents/
cp <obsidian-agent>/.github/instructions/*.instructions.md .github/instructions/
cp <obsidian-agent>/.github/templates/*.md .github/templates/

# Workflows kopieren und Platzhalter einsetzen
# (Repo-spezifische Werte durch __PLACEHOLDER__ ersetzen)

# _devprocess/ Skeletons erstellen (leere Templates mit Ueberschriften)
# _global/CLAUDE.md aus ~/.claude/CLAUDE.md kopieren
# _memory/ Templates erstellen
```

### Schritt 3: Platzhalter einsetzen

In allen kopierten Dateien projekt-spezifische Werte durch Platzhalter ersetzen:
- Repo-Namen -> `__PROJECT_NAME__`, `__PUBLIC_REPO__`
- Jahreszahlen -> `__YEAR__`
- Owner -> `__OWNER__`
- Deploy-Pfade -> `__DEPLOY_DIR__`

### Schritt 4: init-scaffold.sh schreiben

Das Script das bei jedem neuen Projekt ausgefuehrt wird (siehe Abschnitt 7).

### Schritt 5: Flavor-Branches erstellen

```bash
# Basis committen
git add -A && git commit -m "chore: initial scaffold template"

# Flavor-Branches vom main ableiten
git checkout -b obsidian-plugin
# -> Obsidian-spezifische Dateien hinzufuegen (package.json, esbuild, manifest.json, src/main.ts)
git add -A && git commit -m "chore: add obsidian-plugin flavor"

git checkout main
git checkout -b node-lib
# -> Node-Library-Dateien (tsup, dual CJS/ESM)
git add -A && git commit -m "chore: add node-lib flavor"

# Weitere Flavors analog
git push origin --all
```

### Schritt 6: Dry-Run

```bash
# Neues Projekt aus Template erstellen und verifizieren
gh repo create test-scaffold --template pssah4/project-scaffold --private --clone
cd test-scaffold
./scripts/init-scaffold.sh
claude  # Pruefen: Kennt Claude die Arbeitsweise? Memory vorhanden?
```

---

## 5. Anleitung: Neues Projekt aufsetzen (bei jedem neuen Projekt)

### Schritt 1: Repo aus Template

```bash
gh repo create my-new-app --template pssah4/project-scaffold --private --clone
cd my-new-app
```

### Schritt 2: Flavor waehlen (optional)

```bash
git checkout obsidian-plugin  # oder: node-lib, web-app, main (= minimal)
```

### Schritt 3: Init ausfuehren

```bash
./scripts/init-scaffold.sh
```

Fragt 3-4 Fragen:
```
=== Project Setup ===

Project name [my-new-app]:
Public mirror repo (leer = keins): pssah4/my-new-app-public
Local deploy path (leer = keins): /path/to/deploy/
Doc language (de/en) [de]:
```

Ergebnis:
```
=== Setup complete ===

Project:     my-new-app
Branches:    dev (active), test, main
Remotes:     origin (private), public (pssah4/my-new-app-public)
Deploy:      /path/to/deploy/
Memory:      ~/.claude/projects/-Users-seb-projects-my-new-app/memory/

TODO: Create GitHub Secret 'PUBLIC_REPO_TOKEN' in your repo settings
```

### Schritt 4: Secret anlegen (nur bei Public Mirror)

GitHub Repo Settings -> Secrets -> Actions -> `PUBLIC_REPO_TOKEN` mit PAT (`repo` scope).

### Schritt 5: Loslegen

```bash
claude
```

Claude kennt ab sofort:
- **Aus `~/.claude/CLAUDE.md`:** Deutsch, keine Emojis, Plan-Format, Feature-Lifecycle, Git-Workflow
- **Aus `memory/MEMORY.md`:** Projektname (leer, wird in erster Session befuellt)

**Erste Session:** Projekt in 1-2 Saetzen beschreiben. Claude traegt es in MEMORY.md ein.
Ab der zweiten Session weiss Claude alles aus der ersten.

---

## 6. Bestandteile des Scaffolds

### 6.1 Git-Strategie: Dual-Remote mit Branch-Hygiene

- Zwei Remotes: `origin` (privat, alle Branches) + `public` (oeffentlich, nur `main`)
- Branch-Flow: `feature/*` -> `dev` -> `main` -> `public/main`
- `_devprocess/` wird in dev getrackt, automatisch von CI gestrippt
- Device-lokale Inhalte (`.claude/`, `.env`) sind in `.gitignore`

```
origin (privat)                    public (oeffentlich)
  dev ----+
  test ---+---- main ------------> public/main
                  |                   |
                  | sync-public.yml   |
                  | (strippt _devprocess/)
```

**Parametrisierung:**

| Parameter | Default | Beschreibung |
|-----------|---------|--------------|
| `PUBLIC_REPO` | (optional) | GitHub-Pfad des Public Repo |
| `PAT_SECRET_NAME` | `PUBLIC_REPO_TOKEN` | Name des GitHub Secrets |
| `INTERNAL_PATHS` | `_devprocess, .claude, .github, scripts` | Pfade die beim Promote gestrippt werden |

**Scripts:**
- `scripts/promote-to-test.sh` -- Dev -> Main promoten (strippt Dev-Artefakte)
- `scripts/pre-push-check.sh` -- Qualitaets-Checks vor Push (grep-basiert)

### 6.2 CI/CD Workflows

| Workflow | Trigger | Funktion |
|----------|---------|----------|
| `sync-public.yml` | Push auf main | Auto-Sync zu Public Repo, strippt `_devprocess/` |
| `release.yml` | workflow_dispatch | Manueller Release mit Build + GitHub Release Assets |
| `codeql.yml` | Push dev/main + weekly | Security-Scanning |
| `dependabot.yml` | Woechentlich | Dependency-Updates |

### 6.3 Dokumentationsstruktur (_devprocess/)

```
_devprocess/
  architecture/
    arc42-skeleton.md             12 Abschnitte (leer, mit Erklaerung)
    ADR-000-template.md           MADR-Format Template
  analysis/
    security/                     Security-Scan-Reports
  context/
    01_product-vision.md          Produktkontext-Dokumente
    ...                           (alle mit Ueberschriften-Skeleton)
    10_backlog.md                 Lebendes Backlog
  implementation/                 Technische Referenz-Docs (TECH-*, IMPL-*)
  prompts/
    security-scan.md              Security-Scanner-Prompt fuer Claude Code
  requirements/
    REQUIREMENTS-overview.md
    epics/                        Epics vom RE Agent (SAFe-Format)
    features/
      FEATURE-000-template.md     Feature-Template
    handoff/
      architect-handoff.md        RE -> Architect Uebergabe
      plan-context.md             Architect -> Claude Code (Tech-Summary)
```

### 6.4 Memory-System (Zwei Ebenen)

```
Ebene 1: ~/.claude/CLAUDE.md (global)     = WIE wir arbeiten
Ebene 2: memory/MEMORY.md (projekt)       = WORAN wir arbeiten

Global: Einmal einrichten, waechst ueber alle Projekte
Projekt: Pro Projekt, startet mit Template, waechst mit
```

**Zuordnung:**

```
~/.claude/CLAUDE.md (global)              memory/MEMORY.md (projekt)
-------------------------------           ----------------------------
A. Kommunikation & Sprache                Projekt-Beschreibung
B. Planungs-Konventionen                  Aktueller State / Phasen
C. Feature-Lebenszyklus                   Key Architecture
D. Implementierungs-Workflow              Framework-spezifische Regeln
E. Debugging-Konventionen                 Tech Stack
F. Dokumentations-Standards               Deploy-Pfad
G. Git & Release-Workflow                 Tool-/Modul-Uebersicht
H. Kontinuierliches Lernen (Regeln)       Gelernte Patterns (Inhalte)
```

**Projekt-zu-Projekt Evolution:**

```
Projekt 1:  ~/.claude/CLAUDE.md  <- kopiert aus _global/CLAUDE.md
            memory/MEMORY.md     <- kopiert aus _memory/MEMORY.md, befuellt

Projekt 2:  ~/.claude/CLAUDE.md  <- NICHT ueberschrieben! Patterns bleiben
            memory/MEMORY.md     <- frische Kopie, wird fuer Projekt 2 befuellt

Projekt N:  ~/.claude/CLAUDE.md  <- waechst weiter, Best Practices aller Projekte
            memory/MEMORY.md     <- immer frisch pro Projekt
```

Details zum Memory-System: `_memory/SCAFFOLD-GUIDE.md`

### 6.5 Build & Deploy

- `deploy-local.sh` (generisch: liest `DEPLOY_DIR` aus `.env`)
- `.env.example` mit dokumentierten Variablen
- ESLint-Basis-Config (security + no-unsanitized Plugins)
- `tsconfig.json` Template (strict, ES2022, Path-Aliases)

### 6.6 Security & Qualitaet

- CodeQL-Config (generisch, Sprache parametrisierbar)
- ESLint-Security-Preset
- `scripts/pre-push-check.sh` Template (anpassbare grep-Patterns)
- `memory/quality-rules.md` Template fuer framework-spezifische Regeln

---

## 7. init-scaffold.sh im Detail

### 7.1 Interaktive Abfrage (3-4 Fragen)

```
=== Project Setup ===

Project name [my-new-app]:
Public mirror repo (leer = keins): pssah4/my-new-app-public
Local deploy path (leer = keins): /path/to/deploy/
Doc language (de/en) [de]:
```

### 7.2 Automatische Schritte

1. **Globale CLAUDE.md pruefen/anlegen** (einmalig, beim allerersten Projekt):
   - Existiert `~/.claude/CLAUDE.md`? Nein -> kopiert aus `_global/CLAUDE.md`
   - Ja -> ueberspringt (ist schon da)

2. **Platzhalter ersetzen** in allen Dateien:
   - `__PROJECT_NAME__`, `__PUBLIC_REPO__`, `__YEAR__`, `__OWNER__`

3. **Public Remote** (wenn angegeben):
   - `gh repo create` (falls noetig), `git remote add public`
   - Ohne Public Mirror: `sync-public.yml` wird geloescht

4. **.env erzeugen** (lokal, gitignored)

5. **Claude Code Memory bootstrappen**:
   - `~/.claude/projects/-<encoded-path>/memory/` erstellen
   - `_memory/*` dorthin kopieren (Platzhalter bereits ersetzt)
   - `.claude/settings.json` im Projektroot anlegen
   - `_memory/` und `_global/` aus dem Repo loeschen

6. **Branches anlegen**: main, dev, test -- dev wird aktiv

7. **Aufraeumen + Initial Commit**:
   - Init-Script loescht sich selbst
   - Commit: "chore: initialize project from scaffold"
   - Push: `origin --all`

---

## 8. Agent-Integration: Hybrid-Ansatz

### 8.1 Plattform-Bewertung

| Kriterium | GitHub Copilot | Claude Code |
|-----------|----------------|-------------|
| **Agent-Format** | .agent.md, .instructions.md | Memory + CLAUDE.md |
| **Handoff** | Frontmatter `handoffs:` | Nicht nativ (manuell) |
| **Interviews** | Chat-UI, ideal fuer Q&A | CLI-basiert |
| **Shell-Zugriff** | Begrenzt | Voll (Bash, volle Kontrolle) |
| **Memory** | Keins | 2-Ebenen (MEMORY.md + CLAUDE.md) |
| **Plan-Mode** | Nicht vorhanden | Vollstaendig |
| **Web-Recherche** | fetch, web_search, MCP | WebSearch, WebFetch |
| **IDE-Integration** | Nativ in VS Code | Terminal + VS Code Extension |

**Entscheidung:** Zwei Tools, klare Rollenverteilung.

| Agent | Beste Plattform | Begruendung |
|-------|-----------------|-------------|
| Business Analyst | **Copilot** | Interaktives Interview, Dokument-Erstellung |
| Requirements Engineer | **Copilot** | Epics/Features, Auto-Validierung |
| Architect | **Copilot** | ADRs, arc42, Mermaid, Web-Recherche |
| Developer + Debugger | **Claude Code** | Shell, Build, Tests, Memory, Plans |
| Security Scanner | **Claude Code** | Braucht CodeQL CLI, npm audit, Shell |

**Developer/Debugger nicht als Copilot-Agents:**
Claude Code IST der Developer + Debugger. Quality Standards fliessen
in die globale CLAUDE.md (Abschnitt D + E) und Projekt-Memory ein.

### 8.2 Rollenverteilung

```
Copilot-Agents (VORSCHLAEGE):              Claude Code (ENTSCHEIDUNGEN):
  BA:  Problem & Stakeholder                 Finale Architektur
  RE:  Features & NFRs                       Issue-Zerlegung & Reihenfolge
  Architect: ADR-Vorschlaege & arc42         Implementierungsplan
                                             Code, Tests, Deployment
                                             ADRs akzeptieren/aendern
```

### 8.3 Agent-Anpassungen (gegenueber speckit-template)

1. **SpecKit-Referenzen entfernt** -- direkte Workflows statt `/speckit.*`
2. **Output-Pfade auf _devprocess/**
3. **Architect erstellt KEINE Issues** -- Claude Code plant selbst
4. **Handoff Architect -> Claude Code** via `plan-context.md`

**Folder-Mapping (Original -> Scaffold):**

| Agent-Output (Original) | Scaffold-Pfad |
|--------------------------|---------------|
| `docs/business-analysis.md` | `_devprocess/analysis/BA-[PROJECT].md` |
| `requirements/epics/EPIC-*.md` | `_devprocess/requirements/epics/EPIC-*.md` |
| `requirements/features/FEATURE-*.md` | `_devprocess/requirements/features/FEATURE-*.md` |
| `requirements/handoff/architect-handoff.md` | `_devprocess/requirements/handoff/architect-handoff.md` |
| `architecture/adr/ADR-*.md` | `_devprocess/architecture/ADR-*.md` |
| `docs/ARC42-DOCUMENTATION.md` | `_devprocess/architecture/arc42.md` |
| `requirements/handoff/plan-context.md` | `_devprocess/requirements/handoff/plan-context.md` |

### 8.4 Orchestrierung

Bewusst einfach -- kein automatischer Orchestrator:

1. **Agent-Handoffs:** Jeder Agent sagt dem User, wen er als naechstes aufrufen soll
2. **Datei-basierter Kontext:** Jeder Agent liest Artefakte des Vorgaengers aus `_devprocess/`
3. **Manueller Wechsel:** `@agent-name` in Copilot oder `claude` im Terminal
4. **Quality Gates:** User prueft nach jeder Phase

---

## 9. Workflow: Von der Idee zum Code

### 9.1 Vollstaendiger Ablauf (MVP/PoC)

```
Phase 0: Discovery (Copilot)
  @business-analyst -> _devprocess/analysis/BA-[PROJECT].md
  -> Handoff: "Wechsle zu @Requirements Engineer"

Phase 1: Requirements (Copilot)
  @requirements-engineer
  -> _devprocess/requirements/epics/EPIC-*.md
     _devprocess/requirements/features/FEATURE-*.md
     _devprocess/requirements/handoff/architect-handoff.md
  -> QG1: NFRs quantifiziert? ASRs markiert? Success Criteria tech-agnostisch?
  -> Handoff: "Wechsle zu @Architect"

Phase 2: Architektur-VORSCHLAG (Copilot)
  @architect
  -> _devprocess/architecture/ADR-*.md (VORSCHLAEGE!)
     _devprocess/architecture/arc42.md (Entwurf)
     _devprocess/requirements/handoff/plan-context.md
  -> QG2: ADRs in MADR-Format? arc42 scope-passend?
  -> KEIN Issue-Output!
  -> Handoff: "Wechsle zu Claude Code"

--- Wechsel zu Claude Code (der Boss) ---

Phase 3: Finale Architektur + Plan (Claude Code)
  -> Liest: plan-context.md + ADRs + arc42 + Features
  -> Trifft FINALE Architektur-Entscheidungen
  -> Erstellt Implementierungsplan (Plan-Mode)
  -> Definiert Issue-Zerlegung und Reihenfolge

Phase 4: Implementation (Claude Code)
  -> Feature-Lifecycle: Backlog -> Spec -> Plan -> Code -> Update
  -> Build+Deploy nach jedem Schritt
  -> QG3: Tests bestanden? Build erfolgreich?

Phase 5: Security (Claude Code, periodisch)
  -> _devprocess/prompts/security-scan.md
  -> _devprocess/analysis/security/SCAN-*.md
```

### 9.2 Vereinfachter Ablauf (Simple Test)

```
@architect [Beschreib direkt was du bauen willst]
-> 1-2 ADRs + kurzer plan-context.md

claude
-> Liest plan-context.md, erstellt Plan, implementiert direkt
```

### 9.3 Wann welchen Agent?

| Ich habe... | Starte mit... |
|-------------|---------------|
| Eine vage Idee | @business-analyst |
| Klare Anforderungen, brauche Struktur | @requirements-engineer |
| Fertige Requirements, brauche Architektur | @architect |
| Architektur-Vorschlaege, will coden | Claude Code |
| Klares Feature, brauche keine Agents | Claude Code direkt |

---

## 10. Template-Repo Verzeichnisstruktur

### 10.1 Branch `main` (= Flavor `minimal`)

```
project-scaffold/
  .github/
    agents/
      business-analyst.agent.md          Strukturierte BA-Interviews
      requirements-engineer.agent.md     Epics, Features, ASRs
      architect.agent.md                 ADR-Vorschlaege + arc42 (KEINE Issues)
    instructions/
      business-analyst.instructions.md   BA-Dokument-Qualitaet
      requirements-engineer.instructions.md  NFR/ASR/Success-Criteria
      architect.instructions.md          ADR/arc42-Validierung
    templates/
      EPIC-TEMPLATE.md                   Epic-Template (SAFe)
      FEATURE-TEMPLATE.md               Feature mit Benefits Hypothesis
    workflows/
      sync-public.yml                    Platzhalter: __PUBLIC_REPO__
      release.yml                        Platzhalter: __PROJECT_NAME__
      codeql.yml
    dependabot.yml
    codeql/
      codeql-config.yml
  _devprocess/
    architecture/
      arc42-skeleton.md
      ADR-000-template.md
    analysis/
      .gitkeep
      security/
        .gitkeep
    context/
      01_product-vision.md ... 10_backlog.md
    implementation/
      .gitkeep
    prompts/
      security-scan.md
    requirements/
      REQUIREMENTS-overview.md
      epics/
        .gitkeep
      features/
        FEATURE-000-template.md
      handoff/
        .gitkeep
  scripts/
    init-scaffold.sh                     Loescht sich nach Ausfuehrung
    promote-to-test.sh
    pre-push-check.sh
  _global/
    CLAUDE.md                            Vorlage fuer ~/.claude/CLAUDE.md
  _memory/
    MEMORY.md                            Platzhalter: __PROJECT_NAME__
    SCAFFOLD-GUIDE.md                    Erklaert Memory-System
    quality-rules.md                     Leeres Template
  .claude/
    settings.json                        Basis-Permissions
  deploy-local.sh
  .gitignore
  .env.example
  README.md                              Platzhalter: __PROJECT_NAME__
  LICENSE
  NOTICE                                 Platzhalter: __PROJECT_NAME__, __YEAR__
```

### 10.2 Flavor-Branches (erweitern `main`)

| Flavor | Branch | Zusaetzliche Dateien |
|--------|--------|----------------------|
| `obsidian-plugin` | obsidian-plugin | package.json, esbuild.config.mjs, manifest.json, tsconfig.json, eslint.config.mjs, styles.css, src/main.ts |
| `node-lib` | node-lib | package.json, tsconfig.json, tsup.config.ts, src/index.ts |
| `web-app` | web-app | package.json, tsconfig.json, vite.config.ts, src/main.ts |
| `python-app` | python-app | pyproject.toml, src/__init__.py |

---

## 11. Platzhalter-Referenz

| Platzhalter | Quelle | Beispiel |
|-------------|--------|----------|
| `__PROJECT_NAME__` | Interaktiv oder Verzeichnisname | `my-new-app` |
| `__PUBLIC_REPO__` | Interaktiv (optional) | `pssah4/my-new-app-public` |
| `__PUBLIC_REMOTE__` | Abgeleitet | `public` |
| `__YEAR__` | Automatisch | `2026` |
| `__OWNER__` | `git config user.name` | `Sebastian Hanke` |
| `__DEPLOY_DIR__` | Interaktiv (optional) | `/path/to/.obsidian/plugins/my-app/` |
| `__LANG__` | Interaktiv, Default `de` | `de` |

Feste Defaults (nicht abgefragt):
- Secret-Name: immer `PUBLIC_REPO_TOKEN`
- Private Remote: immer `origin` (durch `gh repo create` gesetzt)

---

## 12. Taeglicher Workflow (Referenz)

### Feature entwickeln

```
1. Feature im Backlog eintragen     -> _devprocess/context/10_backlog.md
2. Feature-Spec schreiben            -> _devprocess/requirements/features/FEATURE-NNN-name.md
3. Claude: Plan erstellen            -> Plan-Mode
4. Claude: Implementieren            -> Build+Deploy nach jedem Schritt
5. Claude: Spec aktualisieren        -> Status: Implemented
6. Claude: Backlog aktualisieren     -> Sofort, nicht erst am Sprint-Ende
7. Claude: Memory aktualisieren      -> Wenn Architektur-Eckdaten sich aendern
```

### Bug fixen

```
1. Bug dokumentieren                 -> Problem, Root Cause, kausale Kette
2. Bug im Backlog eintragen          -> FIX-NN mit Prioritaet (P0/P1/P2)
3. Claude: Plan oder direkt fixen
4. Claude: Build+Deploy + Verifizieren
5. Claude: Backlog aktualisieren
```

### Release erstellen

```
1. Version bumpen
2. Auf dev committen + pushen
3. dev -> main mergen
4. CI: sync-public.yml (automatisch, strippt _devprocess/)
5. CI: release.yml (manuell ausloesen)
```

---

## 13. Schnell-Referenz: Wo liegt was?

| Ich suche... | Datei / Ort |
|--------------|-------------|
| **Agents** | |
| Copilot Agents (BA, RE, Architect) | `.github/agents/*.agent.md` |
| Agent-Qualitaetsregeln | `.github/instructions/*.instructions.md` |
| Dokument-Templates (Epic, Feature) | `.github/templates/*.md` |
| **Dokumentation** | |
| Globale Arbeits-Patterns | `~/.claude/CLAUDE.md` |
| Projekt-Memory | `~/.claude/projects/-<path>/memory/MEMORY.md` |
| Architektur-Doku | `_devprocess/architecture/arc42-skeleton.md` |
| ADRs | `_devprocess/architecture/ADR-*.md` |
| Feature-Specs | `_devprocess/requirements/features/FEATURE-*.md` |
| Backlog | `_devprocess/context/10_backlog.md` |
| Security-Scan-Reports | `_devprocess/analysis/security/SCAN-*.md` |
| **Agent-Artefakte** | |
| Business Analysis | `_devprocess/analysis/BA-*.md` |
| Epics | `_devprocess/requirements/epics/EPIC-*.md` |
| RE -> Architect Uebergabe | `_devprocess/requirements/handoff/architect-handoff.md` |
| Architect -> Claude Code | `_devprocess/requirements/handoff/plan-context.md` |
| Security-Scanner-Prompt | `_devprocess/prompts/security-scan.md` |
| **Infrastruktur** | |
| CI/CD Workflows | `.github/workflows/` |
| Deploy-Pfad Konfiguration | `.env` (lokal) |
| Lokaler Deploy | `./deploy-local.sh` |
| Quality Checks | `./scripts/pre-push-check.sh` |
| Staging (dev -> main) | `./scripts/promote-to-test.sh` |

---

## 14. Entscheidungen & Trade-offs

### E1: Warum Copilot fuer Discovery, Claude Code fuer Implementation?

BA- und RE-Agents sind interview-basiert (15-50 Fragen). Das funktioniert in
Copilots Chat-UI besser als im Terminal. Copilot hat native Handoff-Unterstuetzung
und Auto-Validierung via .instructions.md.

Claude Code dagegen hat vollen Shell-Zugriff, kann Code ausfuehren, bauen und
testen. Memory ueber Sessions hinweg. Plan-Mode fuer systematische Evaluation.

### E2: Warum ist Claude Code der Boss?

Die Copilot-Agents koennen die Codebase nicht ausfuehren. Sie machen VORSCHLAEGE,
aber koennen nicht verifizieren ob eine Architektur-Entscheidung funktioniert.
Claude Code kennt die realen Abhaengigkeiten und Einschraenkungen der Codebase
und trifft daher die FINALEN Entscheidungen.

### E3: Warum erstellt der Architect keine Issues?

Atomare Issues erfordern Wissen ueber betroffene Dateien, Abhaengigkeiten,
Reihenfolge und Aufwand. Claude Code hat dieses Wissen (Memory + Code-Analyse)
und erstellt realistischere Implementierungsplaene als der Architect.

### E4: Warum Kilo Code rauslassen?

Drei Tools erhoehen Komplexitaet ohne proportionalen Nutzen. Copilot + Claude Code
decken alle Phasen ab. Was von Kilo Code uebernommen wird: Orchestrierungs-Reihenfolge
(-> Copilot-Handoffs), Memory Bank (-> Claude Memory), Coding Brief (-> plan-context.md).

### E5: Warum kein automatischer Orchestrator?

Nur 3 Agents + Claude Code. Sequentieller Ablauf. Klare Artefakte pro Phase.
Der User behaelt die Kontrolle. Keine Tooling-Abhaengigkeit.

---

## 15. Was NICHT ins Scaffold gehoert

- Projektspezifische Source-Code-Struktur (Aufgabe der ersten Session)
- node_modules / Dependencies (per `npm init` oder Flavor)
- Accumulated Permissions (settings.local.json -- wachsen organisch)
- Session-Logs und Plans (entstehen automatisch)
- Inhaltliche Dokumentation (nur Skeletons/Templates)

---

## 16. Zusammenspiel

```
GitHub Template Repo          init-scaffold.sh              Manuell (einmalig)
---------------------         ------------------            ------------------
Dateistruktur                 Platzhalter ersetzen          GitHub Secret anlegen
Workflows (mit Platzhaltern)  .env erzeugen                 (PUBLIC_REPO_TOKEN)
Docs-Skeletons                Public Remote einrichten
Scripts                       Claude Memory bootstrappen
Config-Dateien                Branch-Struktur (dev/test)
Agents + Instructions         Init-Script loescht sich
                              Initial Commit + Push
```

---

## 17. Naechste Schritte

1. **Template-Repo erstellen** (`pssah4/project-scaffold`, als GitHub Template markieren)
2. **`main`-Branch**: Minimal-Flavor mit Docs, Scripts, Workflows, Agents
3. **Agent-Dateien generalisieren** -- SpecKit entfernen, _devprocess/-Pfade
4. **Instructions generalisieren** -- applyTo-Globs fuer _devprocess/
5. **`init-scaffold.sh` implementieren** -- Interaktives Setup + Memory-Bootstrap
6. **Security-Scanner-Prompt erstellen** -- Angepasste Version fuer Claude Code
7. **Flavor-Branches**: obsidian-plugin, node-lib, web-app
8. **Dry-Run**: Neues Projekt aus Template erstellen, init ausfuehren, verifizieren
