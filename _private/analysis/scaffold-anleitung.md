# Project Scaffold -- Anleitung

Dieses Dokument erklaert, wie das Scaffold funktioniert, was es einrichtet,
und wie der taegliche Workflow danach aussieht. Lies das, wenn du ein neues
Projekt starten willst und dich nicht mehr an die Details erinnerst.

Hintergrund-Konzept: [scaffold-concept.md](scaffold-concept.md)

---

## Kurzversion (TL;DR)

```bash
# 1. Neues Repo aus Template erstellen
gh repo create my-new-app \
  --template pssah4/project-scaffold \
  --private --clone
cd my-new-app

# 2. Init ausfuehren (fragt 3-4 Fragen, richtet alles ein)
./scripts/init-scaffold.sh

# 3. GitHub Secret anlegen (einmalig, nur wenn Public Mirror gewuenscht)
#    -> Repo Settings -> Secrets -> Actions -> New secret
#    -> Name: PUBLIC_REPO_TOKEN
#    -> Value: Personal Access Token mit 'repo' scope

# 4. Los gehts
claude
```

Ab Schritt 4 kennt Claude dich und deine Arbeitsweise. Kein Erklaeren noetig.

---

## Was das Scaffold ist

Ein **GitHub Template Repository** (`pssah4/project-scaffold`) das in einem
Schritt ein komplettes Projekt-Setup erzeugt:

- Git-Strategie (privat + public, Branches, Staging)
- CI/CD (Auto-Sync, Releases, Security-Scanning, Dependency-Updates)
- Dokumentationsstruktur (arc42, ADRs, Feature-Specs, Backlog)
- Claude Code Memory (damit Claude dich und deine Arbeitsweise sofort kennt)
- Build/Deploy-Pipeline (lokal + CI)
- Quality Gates (ESLint, CodeQL, Pre-Push-Checks)

Das Scaffold loescht sich nach der Initialisierung selbst. Was uebrig bleibt
ist ein normales Projekt ohne Scaffold-Artefakte.

---

## Verfuegbare Flavors

Flavors sind Branches im Template-Repo. Jeder Branch fuegt stack-spezifische
Dateien zum Basis-Setup hinzu.

| Flavor | Wann waehlen | Was zusaetzlich drin ist |
|--------|-------------|------------------------|
| `main` (= minimal) | Sprach-unabhaengig, nur Struktur | Git, Docs, Memory, CI -- kein Code |
| `obsidian-plugin` | Obsidian Plugin entwickeln | package.json, esbuild, manifest.json, Plugin-Skeleton |
| `node-lib` | npm-Paket/Library | tsup, dual CJS/ESM, package.json |
| `web-app` | Web-Anwendung | Vite oder Next.js Setup |

Flavor beim Erstellen angeben:
```bash
gh repo create my-app --template pssah4/project-scaffold --private --clone
cd my-app
git checkout obsidian-plugin  # Flavor waehlen
./scripts/init-scaffold.sh
```

---

## Was init-scaffold.sh im Detail tut

### Schritt 1: Fragen beantworten

```
=== Project Setup ===

Project name [my-new-app]:
Public mirror repo (leer = keins): pssah4/my-new-app-public
Local deploy path (leer = keins): /path/to/deploy/
Doc language (de/en) [de]:
```

- **Project name**: Default ist der Verzeichnisname. Wird in README, Workflows, etc. eingesetzt.
- **Public mirror**: Wenn du ein oeffentliches Repo willst. Leer lassen = kein Public Mirror,
  dann wird der sync-public Workflow geloescht.
- **Deploy path**: Wohin der Build lokal kopiert wird (z.B. Obsidian Plugin-Verzeichnis).
  Leer lassen = kein lokaler Auto-Deploy.
- **Doc language**: Sprache fuer die Dokumentations-Skeletons.

### Schritt 2: Was automatisch passiert

1. **Globale Claude-Arbeitsweise** (`~/.claude/CLAUDE.md`):
   - Wird beim allerersten Projekt angelegt
   - Enthaelt alle Zusammenarbeits-Patterns (Deutsch, Plan-Format, Feature-Zyklus, etc.)
   - Bei weiteren Projekten: wird uebersprungen (ist schon da)

2. **Platzhalter ersetzen** in allen Projekt-Dateien:
   - `__PROJECT_NAME__`, `__PUBLIC_REPO__`, `__YEAR__`, `__OWNER__`

3. **Public Remote** (wenn angegeben):
   - Erstellt das Public Repo auf GitHub
   - Fuegt `public` als Remote hinzu
   - Ohne Public Mirror: `sync-public.yml` wird geloescht

4. **.env erzeugen** (lokal, nie committed):
   - `DEPLOY_DIR=/path/to/deploy/`

5. **Claude Code Memory einrichten**:
   - Erstellt `~/.claude/projects/-<encoded-path>/memory/`
   - Kopiert MEMORY.md Vorlage (mit Projektname eingesetzt)
   - Kopiert SCAFFOLD-GUIDE.md (erklaert wie Memory funktioniert)
   - Erstellt `.claude/settings.json` im Projektroot

6. **Branches anlegen**: main, dev, test -- dev wird aktiv

7. **Aufraeumen**: Init-Script loescht sich selbst, Initial Commit, Push

### Schritt 3: Ergebnis

```
=== Setup complete ===

Project:     my-new-app
Branches:    dev (active), test, main
Remotes:     origin (private), public (pssah4/my-new-app-public)
Deploy:      /path/to/deploy/
Memory:      ~/.claude/projects/-Users-seb-projects-my-new-app/memory/

TODO: Create GitHub Secret 'PUBLIC_REPO_TOKEN' in your repo settings
```

---

## Nach dem Setup: Die erste Claude Code Session

Wenn du `claude` startest, kennt Claude bereits:

**Aus `~/.claude/CLAUDE.md` (global, alle Projekte):**
- Deutsch als Gespraechssprache
- Keine Emojis
- Plan-Format (Kontext, VORHER/NACHHER, Dateien-Tabelle, Verifikation)
- Feature-Lebenszyklus (Backlog -> Spec -> Plan -> Code -> Update)
- Build+Deploy nach jedem Schritt
- Git-Workflow (dev/test/main, promote, sync)
- Doku-Standards (arc42, ADRs, Feature-Specs)
- Lern-Verhalten (proaktiv Memory pflegen)

**Aus `memory/MEMORY.md` (projekt-spezifisch):**
- Projektname (eingesetzt aus dem Scaffold)
- Leere Abschnitte fuer Architecture, Rules, Tech Stack

**Was du in der ersten Session tun solltest:**
1. Beschreib das Projekt in 1-2 Saetzen -- Claude traegt es in MEMORY.md ein
2. Erstelle die erste Feature-Spec (`_private/requirements/features/FEATURE-001-*.md`)
3. Claude erstellt einen Plan, du genehmigst, Claude implementiert
4. Nach der Implementierung aktualisiert Claude Backlog und Memory

Ab der zweiten Session weiss Claude alles aus der ersten.

---

## Taeglicher Workflow (Referenz)

### Feature entwickeln

```
1. Feature im Backlog eintragen     -> _private/context/10_backlog.md
2. Feature-Spec schreiben            -> _private/requirements/features/FEATURE-NNN-name.md
3. Claude: Plan erstellen            -> Plan-Mode, Kontext/Aenderungen/Verifikation
4. Claude: Implementieren            -> Build+Deploy nach jedem Schritt
5. Claude: Spec aktualisieren        -> Status: Implemented, Key Files, Limitations
6. Claude: Backlog aktualisieren     -> Feature-Status, neue Bugs, Tech Debt
7. Claude: Memory aktualisieren      -> Wenn sich Architektur-Eckdaten geaendert haben
```

### Bug fixen

```
1. Bug dokumentieren                 -> Problem, Root Cause, kausale Kette
2. Bug im Backlog eintragen          -> FIX-NN mit Prioritaet (P0/P1/P2)
3. Claude: Plan oder direkt fixen    -> Je nach Komplexitaet
4. Claude: Build+Deploy              -> Verifizieren
5. Claude: Backlog aktualisieren     -> FIX-NN als erledigt markieren
```

### Release erstellen

```
1. Version in manifest.json bumpen   -> npm run version
2. Auf dev committen + pushen
3. dev -> main mergen                -> PR oder git merge
4. CI: sync-public.yml               -> Automatisch, strippt _private/
5. CI: release.yml                   -> Manuell ausloesen (workflow_dispatch)
   Oder: promote-to-test.sh          -> Fuer manuellen Staging-Prozess
```

### Architektur-Entscheidung treffen

```
1. ADR schreiben                     -> _private/architecture/ADR-NNN-title.md
2. Format: Kontext, Entscheidung, Alternativen (nummeriert), Konsequenzen
3. Referenz zum Code einfuegen       -> ADR verweist auf Datei:Zeile
4. Code-Kommentar einfuegen          -> "// See ADR-NNN"
```

---

## Verzeichnis-Uebersicht nach Setup

```
my-new-app/
  .github/
    workflows/
      sync-public.yml          Automatischer Sync zu Public Repo (bei Push auf main)
      release.yml              Manueller Release (workflow_dispatch)
      codeql.yml               Security-Scanning (auf dev/main + weekly)
    dependabot.yml             Woechentliche Dependency-Updates

  _private/                    Interne Docs (nie im Public Repo)
    architecture/
      arc42-skeleton.md        Architektur-Doku (12 leere Abschnitte)
      ADR-000-template.md      Template fuer neue ADRs
    analysis/                  Analysen, Security-Scans, Research
    context/
      01_product-vision.md     Produktkontext-Dokumente (alle mit Ueberschriften-Skeleton)
      ...
      10_backlog.md            Lebendes Backlog (Features, Bugs, Tech Debt, Prioritaeten)
    implementation/            Technische Referenz-Docs (TECH-*, IMPL-*)
    requirements/
      REQUIREMENTS-overview.md Anforderungs-Uebersicht
      features/
        FEATURE-000-template.md  Template fuer neue Feature-Specs

  scripts/
    promote-to-test.sh         Dev -> Test/Main promoten (strippt Dev-Artefakte)
    pre-push-check.sh          Qualitaets-Checks vor Push (grep-basiert)

  .claude/
    settings.json              Projekt-Permissions fuer Claude Code

  src/                         (bei Flavors mit Code-Skeleton)
    main.ts                    Entry-Point

  .env                         Lokal, nie committed (DEPLOY_DIR=...)
  .env.example                 Dokumentiert die erwarteten Env-Variablen
  .gitignore                   Vollstaendig (deps, IDE, env, build, claude)
  deploy-local.sh              Kopiert Build-Artefakte zum Deploy-Pfad
  README.md                    Public-facing (Englisch)
  LICENSE                      Apache-2.0
  NOTICE                       Copyright-Hinweis
```

---

## Wo liegt was? (Schnell-Referenz)

| Ich suche... | Datei / Ort |
|--------------|-------------|
| Meine globalen Arbeits-Patterns | `~/.claude/CLAUDE.md` |
| Projekt-spezifisches Claude-Wissen | `~/.claude/projects/-<path>/memory/MEMORY.md` |
| Wie Memory funktioniert | `~/.claude/projects/-<path>/memory/SCAFFOLD-GUIDE.md` |
| Architektur-Doku | `_private/architecture/arc42-skeleton.md` |
| Architektur-Entscheidungen | `_private/architecture/ADR-*.md` |
| Feature-Spezifikationen | `_private/requirements/features/FEATURE-*.md` |
| Aktuelles Backlog | `_private/context/10_backlog.md` |
| Produkt-Vision | `_private/context/01_product-vision.md` |
| Analysen / Security-Scans | `_private/analysis/` |
| Technische Referenz-Docs | `_private/implementation/` |
| CI/CD Workflows | `.github/workflows/` |
| Deploy-Pfad Konfiguration | `.env` (lokal) |
| Lokaler Deploy | `./deploy-local.sh` oder `npm run deploy` |
| Pre-Push Quality Checks | `./scripts/pre-push-check.sh` |
| Staging (dev -> main) | `./scripts/promote-to-test.sh` |

---

## Sachen die man wissen sollte

### Secrets

Es gibt genau **ein** Secret das du manuell anlegen musst, und auch nur wenn
du einen Public Mirror willst:

- **Wo:** GitHub Repo Settings -> Secrets and variables -> Actions -> New repository secret
- **Name:** `PUBLIC_REPO_TOKEN`
- **Wert:** Ein Personal Access Token (classic) mit `repo` scope
- **Wofuer:** Damit die GitHub Action vom privaten Repo ins oeffentliche pushen kann

### Dual-Remote Modell

```
origin (privat)                    public (oeffentlich)
  dev ----+
  test ---+---- main ------------> public/main
                  |                   |
                  | sync-public.yml   |
                  | (strippt _private/) |
```

- `origin`: Alles. Alle Branches, alle Dateien inkl. `_private/`.
- `public`: Nur `main`, ohne `_private/`. Automatisch synchronisiert.
- Lokale Dateien (`.claude/`, `.env`, `forked-*/`): Nie committed, nirgends.

### Claude Code Memory -- Zwei Ebenen

```
~/.claude/CLAUDE.md                     Wie wir zusammenarbeiten
  (global, einmal einrichten)           (Deutsch, Plan-Format, Workflow, etc.)
                                        Gilt fuer ALLE Projekte

~/.claude/projects/.../memory/          Was wir in DIESEM Projekt bauen
  MEMORY.md                             (Architektur, Regeln, State, Stack)
  quality-rules.md                      Waechst mit dem Projekt
  SCAFFOLD-GUIDE.md
```

Claude liest **beide** automatisch in jeder Session.

### Feature-Lebenszyklus

Jedes Feature durchlaeuft:
```
Backlog -> Spec -> Plan -> Code -> Spec-Update -> Backlog-Update
```
Das Backlog wird **sofort** nach jeder Implementierung aktualisiert, nicht
erst am Ende eines Sprints. Dadurch gibt es keinen Drift zwischen Code und Doku.

### Claude lernt mit

Claude speichert proaktiv funktionierende Patterns in der Memory:
- Architektur-Entscheidungen die sich bewaehrt haben
- Framework-Regeln die erst beim Debugging entdeckt wurden
- Loesungswege fuer wiederkehrende Probleme
- Neue Konventionen die waehrend der Arbeit entstehen

Das bedeutet: Je laenger ein Projekt laeuft, desto besser kennt Claude
die Codebase und die Eigenheiten des Frameworks.

---

## Scaffold aktualisieren / erweitern

Das Template-Repo (`pssah4/project-scaffold`) kann jederzeit aktualisiert
werden. Aenderungen gelten nur fuer NEUE Projekte -- bestehende Projekte
werden nicht automatisch aktualisiert (das ist ein Feature, kein Bug).

Wenn du einen neuen Flavor brauchst:
1. Neuen Branch vom `main`-Branch erstellen
2. Stack-spezifische Dateien hinzufuegen
3. Flavor in dieser Anleitung dokumentieren

Wenn du eine globale Arbeitsweise aendern willst:
1. `_global/CLAUDE.md` im Template-Repo aktualisieren (fuer neue Projekte)
2. `~/.claude/CLAUDE.md` direkt editieren (fuer alle bestehenden Projekte)
