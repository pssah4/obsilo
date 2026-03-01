# Scaffold-Konzept: Wiederverwendbares Projekt-Setup

## Motivation

Dieses Projekt (obsidian-agent/obsilo) hat uber mehrere Monate Strukturen und Workflows
entwickelt, die nicht projektspezifisch sind, sondern ein allgemeines Muster fuer
professionelle Softwareentwicklung mit Claude Code darstellen. Ziel ist ein Scaffold-Tool,
das ein neues Projekt mit einem einzigen Befehl auf denselben Stand bringt.

---

## Bestandteile des Scaffolds

### 1. Git-Strategie: Dual-Remote mit Branch-Hygiene

**Was wir haben:**
- Zwei Remotes: `origin` (privat, alle Branches) + `public` (oeffentlich, nur `main`)
- Branch-Flow: `dev` -> `test` -> `main` -> `public/main`
- `_private/` wird in dev getrackt, aber automatisch von CI gestrippt
- Device-lokale Inhalte (`.claude/`, `.env`) sind in `.gitignore` und werden nie getrackt

**Was ins Scaffold gehoert:**
- `.gitignore`-Template mit allen Kategorien (deps, IDE, env, build, claude, private)
- `scripts/promote-to-test.sh` (parametrisiert: INTERNAL_PATHS, Remote-Name)
- `.github/workflows/sync-public.yml` (parametrisiert: Quell-/Ziel-Repo, Secret-Name)
- Dokumentation des Branch-Modells als ADR

**Parametrisierung:**
| Parameter | Beispiel | Beschreibung |
|-----------|----------|--------------|
| `PRIVATE_REMOTE` | `origin` | Name des privaten Remote |
| `PUBLIC_REMOTE` | `obsilo` | Name des oeffentlichen Remote |
| `PUBLIC_REPO` | `pssah4/obsilo` | GitHub-Pfad des Public Repo |
| `PAT_SECRET_NAME` | `PUBLIC_REPO_TOKEN` | Name des GitHub Secrets fuer Push |
| `INTERNAL_PATHS` | `_private, .claude, scripts, docs` | Pfade die beim Promote gestrippt werden |

---

### 2. CI/CD Workflows

**Was wir haben:**
- `sync-public.yml` -- Auto-Sync main -> public/main (strippt `_private/`)
- `release.yml` -- Manueller Release mit Build + GitHub Release Assets
- `codeql.yml` -- Security-Scanning auf dev/main + weekly
- `dependabot.yml` -- Woechentliche Dependency-Updates

**Was ins Scaffold gehoert:**
- Alle vier Workflows als Templates mit Platzhaltern
- `release.yml` ist technologie-agnostisch gestaltbar (Build-Step parametrisierbar)
- `codeql.yml` anpassbar auf Sprache (JS/TS, Python, Go, etc.)

---

### 3. Dokumentationsstruktur

**Was wir haben:**
```
_private/
  architecture/
    arc42.md              # Vollstaendige Architekturdokumentation
    ADR-001.md ... ADR-N  # Architecture Decision Records
  analysis/
    *.md                  # Analysen, Security, Research
  context/
    01_product-vision.md  # Produktkontext (nummeriert)
    ...
    10_backlog.md
  implementation/
    TECH-*.md, IMPL-*.md  # Technische Implementierungsdocs
  requirements/
    REQUIREMENTS-overview.md
    features/
      FEATURE-*.md        # Feature-Spezifikationen
docs/                     # Public-facing Dokumentation (GitHub Pages)
```

**Was ins Scaffold gehoert:**
- Verzeichnisstruktur mit leeren Template-Dateien
- `arc42.md` als Skeleton mit allen 12 Abschnitten (leer, mit Erklaerung)
- ADR-Template (`ADR-000-template.md`)
- Feature-Spec-Template (`FEATURE-000-template.md`)
- Produktkontext-Templates (01-10) mit Abschnitts-Ueberschriften
- Optional: `docs/` Setup fuer GitHub Pages (Jekyll-minimal)

---

### 4. Zusammenarbeits-Patterns & Claude Code Memory

Unsere etablierten Patterns existieren auf **zwei Ebenen**, die beide ins
Scaffold muessen:

#### Ebene 1: Persoenliche Arbeitsweise (projektuebergreifend)

Diese Patterns gelten fuer JEDES Projekt und werden einmalig in einer
**globalen `~/.claude/CLAUDE.md`** hinterlegt. Claude Code laedt diese
Datei automatisch in jeder Session, egal welches Projekt geoeffnet ist.

**Vollstaendige Inventur unserer etablierten Patterns:**

#### A. Kommunikation & Sprache

- Konversation auf Deutsch
- Commit-Messages auf Englisch mit konventionellen Prefixes (feat/fix/chore/docs/refactor)
- Private Dokumentation (_private/) auf Deutsch
- Public Dokumentation (README, docs/, ARCHITECTURE.md) auf Englisch
- Keine Emojis -- nicht in Code, nicht in UI, nicht in Kommunikation
- Technische Begriffe und Identifier bleiben immer Englisch, auch in deutschen Texten
- Co-Authored-By Claude in jedem Commit

#### B. Planungs-Konventionen

- Plan-Mode fuer jede nicht-triviale Aufgabe
- Feste Plan-Struktur mit diesen Abschnitten:
  1. **Kontext** -- Diagnostisch, nicht deskriptiv. Erklaert das "Warum" mit
     Root-Cause-Analyse und kausaler Kette (Problem -> Ursache -> Auswirkung)
  2. **Aenderungen** -- Pro Datei ein Unterabschnitt, mit VORHER/NACHHER Code-Bloecken
  3. **Dateien-Zusammenfassung** -- Tabelle aller betroffener Dateien (Datei | Aenderung | Risiko)
  4. **Nicht betroffen** -- Explizite Liste der Dateien die NICHT geaendert werden
     (dokumentiert den Blast-Radius)
  5. **Verifikation** -- Konkrete Akzeptanzkriterien, Build immer als Schritt 1,
     dann Regressionschecks ("keine Regression fuer X")
- Grosse Features in unabhaengig deploybare Phasen aufteilen
  (jede Phase hat eigenes Ziel und endet mit Build+Deploy)
- Datei-Referenzen immer als `src/path/file.ts:LineNN`

#### C. Feature-Lebenszyklus (vom Backlog bis zur Doku)

Jedes Feature durchlaeuft einen festen Zyklus. Das ist kein einmaliges
Artefakt, sondern ein **kontinuierlicher Prozess**:

```
1. BACKLOG          Feature als Eintrag in 10_backlog.md (Status: Geplant)
                    Prioritaet und Zeithorizont zuweisen
        |
2. FEATURE-SPEC     _private/requirements/features/FEATURE-NNN-name.md
                    Schreiben VOR der Implementierung:
                    - Summary, Anforderungen, Abgrenzung, Akzeptanzkriterien
                    Backlog-Eintrag verlinkt auf die Spec
        |
3. PLAN             Plan-Mode: Implementierungsplan erstellen
                    Referenziert die Feature-Spec und ggf. ADRs
                    Phasen definieren wenn gross
        |
4. IMPLEMENTIERUNG  Code schreiben, Build+Deploy nach jedem Schritt
                    Bei Architektur-Entscheidungen: ADR schreiben
        |
5. SPEC UPDATE      FEATURE-Spec wird zur Referenz-Doku aktualisiert:
                    - "Status: Implemented"
                    - How It Works, Key Files, Dependencies
                    - Known Limitations / Edge Cases
        |
6. BACKLOG UPDATE   Nach JEDER Implementierung:
                    - Feature-Status aktualisieren (Geplant -> Implementiert)
                    - Key Files in der Status-Tabelle eintragen
                    - Neue Bugs/Findings in offene Punkte eintragen
                    - Technische Schulden dokumentieren falls entstanden
                    - Naechste Prioritaeten ggf. anpassen
```

**Wichtig:** Schritt 6 passiert nicht "irgendwann am Ende", sondern
**unmittelbar nach jeder abgeschlossenen Implementierung**. Das Backlog
ist immer aktuell -- es gibt keinen Drift zwischen Code und Doku.

#### D. Implementierungs-Workflow

- Vor jeder Implementierung: Referenz-Implementierung pruefen (z.B. forked-kilocode/)
- Vor jeder Code-Aenderung: bestehenden Code lesen und verstehen
- Inkrementell arbeiten: kleine Schritte, jeder verifiziert
- Build + Deploy nach JEDEM Implementierungsschritt (nicht erst am Ende)
- Watch-Mode (npm run dev) fuer Echtzeit-Deploy bei Datei-Aenderungen
- Neue Module immer dem gleichen Wiring-Pattern folgen:
  1. Datei erstellen im passenden Unterverzeichnis
  2. In Registry/Index registrieren
  3. In Gruppen/Modes einhaengen
  4. Metadata-Eintrag hinzufuegen
- Memory (MEMORY.md) aktualisieren wenn sich Architektur-Eckdaten aendern

#### E. Debugging & Fehleranalyse

- Bugs als kausale Ketten dokumentieren, nicht als Symptome:
  ```
  Problem: [beobachtbares Verhalten]
  Root Cause: [warum es passiert]
  Kette: Schritt 1 -> Schritt 2 -> ... -> Fehler
  ```
- Bug-IDs mit Prioritaet: FIX-NN (P0 = sofort, P1 = kurzfristig, P2 = mittelfristig)
- Security-Findings: H-N / M-N / L-N (High/Medium/Low)
- Analyse-Dokumente nutzen dasselbe Format wie Plans (dienen als Vorstufe)
- Gefundene Bugs sofort ins Backlog (10_backlog.md, Abschnitt "Offene Punkte")

#### F. Dokumentations-Standards

- arc42 fuer Architektur (alle 12 Abschnitte)
- ADRs fuer jede Architekturentscheidung:
  - MADR-Format (Kontext, Entscheidung, Alternativen, Konsequenzen)
  - Alternativen immer nummeriert, auch wenn Entscheidung offensichtlich
  - Bidirektionale Traceability: ADR verweist auf Code-Stelle, Code-Kommentar
    verweist auf ADR-Nummer
- Feature-Specs als FEATURE-*.md:
  - VOR Implementierung: Anforderungen, Abgrenzung, Akzeptanzkriterien
  - NACH Implementierung: Referenzdoku mit How It Works, Key Files, Dependencies
  - Immer mit "Known Limitations / Edge Cases" Abschnitt
- Backlog (10_backlog.md) als lebendes Dokument mit:
  - Implementierungshistorie nach Phasen
  - Feature-Status-Tabelle (Feature | Spec | Key Files)
  - Offene Punkte (FIX-NN), Security Findings, Technische Schulden
  - Naechste Prioritaeten nach Zeithorizont (Sofort/Kurzfristig/Mittel/Lang)
  - **Wird nach jeder Implementierung aktualisiert, nicht am Ende eines Sprints**
- Dokumentation als expliziter Deliverable in jedem Plan
  (nicht Nachgedanke, sondern eigene Zeile in der Datei-Tabelle)
- Traceability-Kette: Backlog -> FEATURE-Spec -> ADR -> Plan -> Commit -> Backlog-Update

#### F. Git & Release-Workflow

- Dual-Remote: privat (origin, alle Branches) + public (nur main)
- Branch-Flow: feature/* -> dev -> main -> public/main
- Zwei-Stufen-Stripping:
  1. promote-to-test: Dev-Tooling entfernen (.claude, scripts, forked-code)
  2. sync-public CI: Interne Docs entfernen (_private/)
- _private/ als AI-lesbares Wissensarchiv (fuer Claude als Arbeitskontext geschrieben)
- Pre-Push Quality-Checks (grep-basiert, framework-spezifisch)
- Kein aktiver git hook -- Quality Gates ueber npm scripts und manuelle Checks

#### G. Code-Qualitaet

- TypeScript strict (noImplicitAny, strictNullChecks)
- Keine `any`-Types, keine floating Promises, keine unsafe Casts
- ESLint mit Security-Plugins (detect-child-process, detect-eval, no-unsanitized)
- CodeQL fuer periodische Security-Audits
- Framework-spezifische Compliance-Regeln als Referenzdatei in Memory

#### H. Kontinuierliches Lernen (Claude Memory-Pflege)

Claude lernt aktiv mit und speichert funktionierende Patterns. Das passiert
nicht nur auf explizite Anweisung ("merk dir das"), sondern proaktiv:

**Wann Memory aktualisieren:**
- Neues Architektur-Pattern hat sich bewaehrt (z.B. "Registry-Pattern fuer Tools")
- Eine Loesung fuer ein wiederkehrendes Problem wurde gefunden
- Eine Konvention wurde etabliert oder geaendert
- Projekt-State hat sich signifikant veraendert (Phase abgeschlossen, neuer Stack)
- Framework-spezifische Regel entdeckt (z.B. "requestUrl statt fetch in Obsidian")
- Build/Deploy-Konfiguration hat sich geaendert

**Wann NICHT speichern:**
- Einmalige, session-spezifische Details (temporaere Workarounds, Debug-Zustaende)
- Unbestaetigte Vermutungen (erst verifizieren, dann speichern)
- Informationen die schon in CLAUDE.md oder _private/ Docs stehen (keine Duplikate)

**Wie gespeichert wird:**
- MEMORY.md: Nur Eckdaten, Kurzreferenzen (<200 Zeilen)
- Neues Thema zu detailliert fuer MEMORY.md? -> Eigene Referenz-Datei anlegen
  und aus MEMORY.md verlinken
- Bestehenden Eintrag aktualisieren statt neuen anlegen (kein Akkumulieren)
- Veraltete Eintraege aktiv loeschen (Memory soll aktuell sein, nicht historisch)

**Was typischerweise gespeichert wird:**
- Constructor-Signaturen und Interface-Shapes (Key Architecture)
- Wiring-Reihenfolge fuer neue Module
- Framework-Regeln die der Linter nicht abfaengt
- Pfade zu wichtigen Dateien die oft referenziert werden
- Loesungen die nach laengerem Debugging gefunden wurden
- User-Praeferenzen die waehrend der Arbeit geaeussert werden

**Was ins Scaffold gehoert:**
- `_global/CLAUDE.md` -- Vorlage fuer `~/.claude/CLAUDE.md`
- `init-scaffold.sh` prueft ob `~/.claude/CLAUDE.md` existiert:
  - Nein -> kopiert Vorlage, Hinweis "Globale Prefs angelegt"
  - Ja -> ueberspringt, Hinweis "Globale Prefs bereits vorhanden"
- Damit muss man die persoenlichen Patterns nur EINMAL einrichten,
  danach gelten sie automatisch in jedem neuen Projekt

#### Ebene 2: Projekt-Memory (projektspezifisch)

Das 3-Schichten-Modell fuer projektspezifisches Wissen:

| Schicht | Datei | Funktion |
|---------|-------|----------|
| Auto-injected | `memory/MEMORY.md` | Wird in jeden Session-Kontext injiziert. Enthaelt Projekt-State, Architektur-Eckdaten, Regeln |
| On-demand | `memory/*.md` | Detaillierte Referenz-Dateien, verlinkt aus MEMORY.md |
| Session-scoped | `~/.claude/plans/*.md` | Strukturierte Implementierungsplaene pro Session |

**Was ins Scaffold gehoert:**
- `_memory/MEMORY.md` -- Projekt-Memory-Vorlage:
  ```markdown
  # __PROJECT_NAME__ - Memory

  ## Project
  [Einzeiler Projektbeschreibung. Erste Session befuellen.]

  ## Current State
  - Phase 1: [Beschreibung] -- pending

  ## Key Architecture
  [Wird ab erster Implementierung befuellt.]

  ## Coding Rules
  [Framework-spezifische Regeln hier eintragen. Siehe quality-rules.md]

  ## Tech Stack
  [Sprache, Framework, Build-Tool, Test-Framework]
  ```
- `_memory/SCAFFOLD-GUIDE.md` -- Erklaert das Memory-System:
  - Wann MEMORY.md aktualisieren (nach Architektur-Entscheidungen, neuen Regeln)
  - Wann neue Referenz-Dateien anlegen (wenn ein Thema zu detailliert fuer MEMORY.md)
  - Max. 200 Zeilen in MEMORY.md (danach wird truncated)
  - Verlinkung auf Referenz-Dateien mit `[name](file.md)`
- `_memory/quality-rules.md` -- Leeres Template fuer framework-spezifische Regeln
- `.claude/settings.json` -- Basis-Permissions:
  ```json
  {
    "permissions": {
      "allow": [
        "Read(~/.claude/**)"
      ]
    }
  }
  ```

#### Zuordnung: Was gehoert wohin?

```
~/.claude/CLAUDE.md (global)              memory/MEMORY.md (projekt)
────────────────────────────              ──────────────────────────
A. Kommunikation & Sprache                Projekt-Beschreibung
B. Planungs-Konventionen                  Aktueller State / Phasen
C. Feature-Lebenszyklus                   Key Architecture
D. Implementierungs-Workflow              Framework-spezifische Regeln
E. Debugging-Konventionen                 Tech Stack
F. Dokumentations-Standards               Deploy-Pfad
G. Git & Release-Workflow                 Tool-/Modul-Uebersicht
H. Kontinuierliches Lernen (Regeln)       Gelernte Patterns (Inhalte)

= WIE wir arbeiten                       = WORAN wir arbeiten
= Einmal einrichten, gilt ueberall        = Pro Projekt, waechst mit
= ~80 Zeilen, stabil                      = <200 Zeilen, lebendig
```

**Punkt H ist besonders:** Die globale CLAUDE.md definiert die REGELN
fuer das Lernen (wann merken, was merken, wie strukturieren). Die
tatsaechlich gelernten Inhalte landen dann in der projekt-Memory.
Das ist wie: "Lerne kontinuierlich" steht in der Arbeitsanweisung,
aber "requestUrl statt fetch" steht im Projekt-Notizbuch.

**Entscheidende Eigenschaft:** Die globale CLAUDE.md enthaelt nur
Arbeitsweise-Patterns, KEINE projektspezifischen Details. Dadurch
funktioniert sie fuer ein Obsidian-Plugin genauso wie fuer eine
Web-App oder ein Python-CLI. Die projekt-spezifischen Regeln
(z.B. "kein console.log, nutze console.debug") kommen erst in die
projekt-Memory, weil sie nur fuer dieses Framework gelten.

---

### 5. Projekt-Konfiguration & Build

**Was wir haben:**
- `package.json` mit standardisierten Scripts (dev, build, deploy, lint, format)
- `esbuild.config.mjs` mit Plugin-System (deploy-on-build via .env)
- `deploy-local.sh` + `.env`-Pattern fuer lokalen Deploy
- ESLint + Prettier + TypeScript strict
- `tsconfig.json` mit Path-Aliases

**Was ins Scaffold gehoert:**
- `package.json` Template (Scripts-Sektion, nicht die Dependencies)
- `deploy-local.sh` (generisch: liest PLUGIN_DIR oder DEPLOY_DIR aus .env)
- `.env.example` mit dokumentierten Variablen
- ESLint-Basis-Config (security + no-unsanitized Plugins)
- `tsconfig.json` Template (strict, ES2022, Path-Aliases)

---

### 6. Security & Qualitaet

**Was wir haben:**
- CodeQL-Integration (CI + lokal)
- ESLint-Security-Plugins
- Pre-Push-Checkliste (grep-basiert)
- Review-Bot-Compliance-Regeln (Obsidian-spezifisch)

**Was ins Scaffold gehoert:**
- CodeQL-Config (generisch, Sprache parametrisierbar)
- ESLint-Security-Preset
- `scripts/pre-push-check.sh` Template (anpassbare grep-Patterns)
- `memory/quality-rules.md` Template fuer framework-spezifische Regeln

---

## Ausfuehrungsform: GitHub Template Repo + Init-Script

### Prinzip

Das Scaffold ist ein **GitHub Template Repository** (`pssah4/project-scaffold`).
Verschiedene Flavors liegen als Branches vor. Beim Erstellen eines neuen Repos
waehlt man den passenden Branch als Template-Quelle.

Die Dateien im Template sind **direkt nutzbar** -- keine `.template`-Endungen.
Stattdessen enthalten sie Platzhalter (`__PROJECT_NAME__`, `__PUBLIC_REPO__`),
die `init-scaffold.sh` per sed ersetzt.

### Was das Script NICHT abfragt

- **Secrets** -- werden nie eingegeben. Die Workflows referenzieren einen festen
  Secret-Namen (`PUBLIC_REPO_TOKEN`). Den Secret legt man einmalig im GitHub UI an.
- **Remote URLs** -- `origin` ist bereits gesetzt (durch `gh repo create`).
  Das Public Remote wird optional per Projektname abgeleitet.

### Ablauf

```bash
# 1. Repo aus Template erstellen (Flavor = Branch)
gh repo create my-new-app \
  --template pssah4/project-scaffold \
  --private --clone \
  -- --branch obsidian-plugin       # oder: node-lib, web-app, minimal
cd my-new-app

# 2. Init-Script ausfuehren (einziger manueller Schritt)
./scripts/init-scaffold.sh

# 3. Fertig -- Claude Code starten
claude
```

### Was `init-scaffold.sh` tut

**Interaktive Abfrage (nur 3-4 Fragen):**

```
=== Project Setup ===

Project name [my-new-app]:
Public mirror repo (leer = keins): pssah4/my-new-app-public
Local deploy path (leer = keins): /Users/seb/Obsidian/Vault/.obsidian/plugins/my-new-app/
Doc language (de/en) [de]:
```

**Automatische Schritte:**

1. **Globale CLAUDE.md pruefen/anlegen** (einmalig, beim allerersten Projekt):
   - Prueft ob `~/.claude/CLAUDE.md` existiert
   - Nein -> kopiert `_global/CLAUDE.md` nach `~/.claude/CLAUDE.md`
     ```
     Globale Arbeits-Prefs angelegt: ~/.claude/CLAUDE.md
     Diese gelten ab jetzt fuer ALLE Projekte.
     Passe sie bei Bedarf an.
     ```
   - Ja -> ueberspringt
     ```
     Globale Prefs bereits vorhanden, uebersprungen.
     ```

2. **Platzhalter ersetzen** in allen Dateien:
   - `__PROJECT_NAME__` -> `my-new-app`
   - `__PUBLIC_REPO__` -> `pssah4/my-new-app-public`
   - `__YEAR__` -> `2026`
   - `__OWNER__` -> (aus git config user.name)

3. **Public Remote einrichten** (wenn angegeben):
   - `gh repo create pssah4/my-new-app-public --public` (falls noch nicht vorhanden)
   - `git remote add public https://github.com/pssah4/my-new-app-public.git`
   - Ohne Public Mirror: `sync-public.yml` wird geloescht

4. **.env erzeugen** (lokal, gitignored):
   ```
   DEPLOY_DIR=/Users/seb/Obsidian/Vault/.obsidian/plugins/my-new-app/
   ```

5. **Projekt-Memory bootstrappen**:
   - Projektpfad -> Claude Memory-Pfad (`/` -> `-`)
   - `~/.claude/projects/-<path>/memory/` erstellen
   - `_memory/*` dorthin kopieren (mit Platzhaltern bereits ersetzt)
   - `.claude/settings.json` im Projektroot anlegen
   - `_memory/` und `_global/` aus dem Repo loeschen (nur Vorlagen, nicht mehr noetig)

6. **Branch-Struktur anlegen**:
   ```
   main (default) -> dev + test Branches erstellen
   dev als aktiven Branch setzen
   ```

7. **Aufraeumen + Initial Commit**:
   - `scripts/init-scaffold.sh` loescht sich selbst
   - `_global/` und `_memory/` bereits in Schritt 5 entfernt
   - Commit: "chore: initialize project from scaffold"
   - Push: `origin --all`

7. **Hinweis ausgeben:**
   ```
   === Setup complete ===

   Project:     my-new-app
   Branches:    dev (active), test, main
   Remotes:     origin (private), public (pssah4/my-new-app-public)
   Deploy:      /Users/seb/Obsidian/Vault/.obsidian/plugins/my-new-app/
   Memory:      ~/.claude/projects/-Users-seb-projects-my-new-app/memory/

   TODO: Create GitHub Secret 'PUBLIC_REPO_TOKEN' in your repo settings
         (Settings -> Secrets -> Actions -> New secret)
         Value: a PAT with 'repo' scope for the public mirror

   Start coding: claude
   ```

### Ergebnis nach init-scaffold.sh

Kein Scaffold-Artefakt bleibt uebrig. Das Repo sieht aus wie ein normales
Projekt. Die Workflows funktionieren sofort (sobald das Secret angelegt ist).
Claude Code startet mit vorhandener Memory und kennt das Projekt.

---

## Template-Flavors (Varianten)

| Flavor | Stack | Besonderheiten |
|--------|-------|----------------|
| `obsidian-plugin` | TypeScript, esbuild, Obsidian API | manifest.json, Plugin-Lifecycle, vault deploy |
| `node-lib` | TypeScript, esbuild/tsup | npm publish, CommonJS + ESM dual build |
| `web-app` | TypeScript, Vite/Next.js | Vercel/Netlify deploy, Preview-Envs |
| `python-app` | Python, uv/poetry | pytest, ruff, pyproject.toml |
| `minimal` | Sprachunabhaengig | Nur Git-Strategie, Docs, Memory |

---

## Verzeichnisstruktur des Scaffold-Repos

Jeder **Branch** im Template-Repo ist ein Flavor. Der `main`-Branch enthaelt
den `minimal`-Flavor (nur Git-Strategie, Docs, Memory). Flavor-Branches
erweitern das um stack-spezifische Dateien.

### Branch `main` (= Flavor `minimal`)

```
project-scaffold/
  .github/
    workflows/
      sync-public.yml         # Platzhalter: __PUBLIC_REPO__
      release.yml              # Platzhalter: __PROJECT_NAME__, Build-Step leer
      codeql.yml
    dependabot.yml
    codeql/
      codeql-config.yml
  _private/
    architecture/
      arc42-skeleton.md
      ADR-000-template.md
    analysis/
      .gitkeep
    context/
      01_product-vision.md
      02_stakeholders.md
      03_constraints.md
      04_solution-strategy.md
      05_building-blocks.md
      06_runtime-view.md
      07_deployment-view.md
      08_crosscutting.md
      09_decisions.md
      10_backlog.md
    implementation/
      .gitkeep
    requirements/
      REQUIREMENTS-overview.md
      features/
        FEATURE-000-template.md
  scripts/
    init-scaffold.sh          # Loescht sich nach Ausfuehrung selbst
    promote-to-test.sh        # Platzhalter: __PUBLIC_REMOTE__
    pre-push-check.sh
  _global/                    # Vorlage fuer ~/.claude/CLAUDE.md (einmalig, global)
    CLAUDE.md                 # Persoenliche Arbeitsweise, projektuebergreifend
  _memory/                    # Vorlage fuer projekt-spezifische Claude Memory
    MEMORY.md                 # Platzhalter: __PROJECT_NAME__
    SCAFFOLD-GUIDE.md         # Erklaert Memory-Pflege, wird mitkopiert
    quality-rules.md          # Leeres Template fuer Framework-Regeln
  deploy-local.sh
  .gitignore
  .env.example
  README.md                   # Platzhalter: __PROJECT_NAME__, __PUBLIC_REPO__
  LICENSE
  NOTICE                      # Platzhalter: __PROJECT_NAME__, __YEAR__, __OWNER__
```

### Branch `obsidian-plugin` (erweitert `main`)

Zusaetzliche Dateien:
```
  package.json               # Obsidian-deps, esbuild scripts
  tsconfig.json              # Obsidian externals, strict
  esbuild.config.mjs         # Mit vault-deploy plugin
  eslint.config.mjs          # Security plugins
  manifest.json              # Platzhalter: __PROJECT_NAME__
  styles.css
  src/
    main.ts                  # Plugin-Skeleton mit onload/onunload
```

### Branch `node-lib` (erweitert `main`)

```
  package.json               # tsup build, dual CJS/ESM
  tsconfig.json
  src/
    index.ts
```

### Branch `web-app` (erweitert `main`)

```
  package.json               # Vite/Next.js
  tsconfig.json
  vite.config.ts / next.config.js
  src/
    main.ts / app/page.tsx
```

---

## Was NICHT ins Scaffold gehoert

- Projektspezifische Source-Code-Struktur (das ist Aufgabe der ersten Session)
- Abhaengigkeiten / node_modules (werden per `npm init` oder Flavor erstellt)
- Accumulated Permissions (`settings.local.json` -- wachsen organisch)
- Session-Logs und Plans (entstehen automatisch)
- Inhaltliche Dokumentation (nur Skeletons/Templates)

---

## Platzhalter-Referenz

| Platzhalter | Quelle | Beispiel |
|-------------|--------|----------|
| `__PROJECT_NAME__` | Interaktiv oder Verzeichnisname | `my-new-app` |
| `__PUBLIC_REPO__` | Interaktiv (optional) | `pssah4/my-new-app-public` |
| `__PUBLIC_REMOTE__` | Abgeleitet (wenn Public Repo) | `public` |
| `__YEAR__` | Automatisch | `2026` |
| `__OWNER__` | Aus `git config user.name` | `Sebastian Hanke` |
| `__DEPLOY_DIR__` | Interaktiv (optional) | `/Users/seb/.obsidian/plugins/my-app/` |
| `__LANG__` | Interaktiv, Default `de` | `de` |

Fester Default (nicht abgefragt):
- Secret-Name fuer Public Push: immer `PUBLIC_REPO_TOKEN`
- Private Remote: immer `origin` (schon durch gh repo create gesetzt)

---

## Zusammenspiel: Was kommt woher?

```
GitHub Template Repo          init-scaffold.sh              Manuell (einmalig)
─────────────────────         ──────────────────            ──────────────────
Dateistruktur                 Platzhalter ersetzen          GitHub Secret anlegen
Workflows (mit Platzhaltern)  .env erzeugen                 (PUBLIC_REPO_TOKEN)
Docs-Skeletons                Public Remote einrichten
Scripts                       Claude Memory bootstrappen
Config-Dateien                Branch-Struktur (dev/test)
                              Init-Script loescht sich
                              Initial Commit + Push
```

---

## Naechste Schritte

1. **Review dieses Konzepts** -- Feedback, fehlende Aspekte?
2. **Template-Repo erstellen** (`pssah4/project-scaffold`, als GitHub Template markieren)
3. **`main`-Branch**: Minimal-Flavor mit allen Docs, Scripts, Workflows
4. **`obsidian-plugin`-Branch**: Erweitert main um Obsidian-spezifische Dateien
5. **`init-scaffold.sh` implementieren** -- Interaktives Setup + Memory-Bootstrap
6. **Dry-Run**: Neues Projekt aus Template erstellen, init ausfuehren, verifizieren
