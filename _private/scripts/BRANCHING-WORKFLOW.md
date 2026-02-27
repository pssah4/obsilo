# Branching & Release Workflow

## Repos im Überblick

| Repo | Sichtbarkeit | Zweck |
|------|-------------|-------|
| `github.com/pssah4/obsilo` | Privat | Entwicklung — alle Branches |
| `github.com/pssah4/obsilo` | Öffentlich | Releases — nur `main` |

---

## Branch-Struktur (obsilo, privat)

```
dev     →  test     →  main     →  obsilo/main
(Entwicklung)  (Staging)  (Release)   (öffentlich, ohne CLAUDE.md)
```

### `dev`
- Aktiver Entwicklungs-Branch
- Enthält `CLAUDE.md` (Projekt-Manifest für Claude Code)
- `devprocess/` ist gitignored — interne Docs existieren nur lokal
- Wird **nicht** automatisch syncronisiert

### `test`
- Staging-Branch — stabiler Stand von `dev`
- Enthält ebenfalls `CLAUDE.md` (wird für die Entwicklung benötigt)
- Merge: `dev → test` (manuell via PR in obsilo)
- Wird **nicht** automatisch synchronisiert

### `main` (obsilo, privat)
- Release-Branch — getesteter Stand aus `test`
- Merge: `test → main` (manuell via PR in obsilo)
- **Trigger:** Push auf `main` startet automatisch den GitHub Actions Workflow

### `main` (obsilo, öffentlich)
- Gespiegelt von `obsilo/main`, gefiltert:
  - `CLAUDE.md` wird entfernt
- Wird **automatisch** via GitHub Actions aktualisiert (kein manueller Schritt)

---

## Kompletter Ablauf

```
1. Feature entwickeln
   git checkout dev
   git commit ...
   git push origin dev

2. Für Staging bereit
   → PR auf GitHub: dev → test (in obsilo)
   → Merge

3. Für Release bereit
   → PR auf GitHub: test → main (in obsilo)
   → Merge
         │
         ▼ (automatisch)
   GitHub Actions: sync-public.yml
         │
         ├── Checkout obsilo/main
         ├── CLAUDE.md entfernen
         ├── Commit (gefiltert)
         └── Force-Push → obsilo/main
```

---

## Was ist wo vorhanden

| Datei / Ordner | dev | test | main (obsilo) | main (obsilo) |
|----------------|-----|------|---------------|----------------------|
| `src/` | ✓ | ✓ | ✓ | ✓ |
| `docs/` | ✓ | ✓ | ✓ | ✓ |
| `CLAUDE.md` | ✓ | ✓ | ✓ | ✗ (entfernt) |
| `devprocess/` | gitignored | gitignored | gitignored | gitignored |
| `.claude/` | gitignored | gitignored | gitignored | gitignored |
| `forked-kilocode/` | gitignored | gitignored | gitignored | gitignored |
| `.env` | gitignored | gitignored | gitignored | gitignored |

---

## GitHub Actions Workflow

Datei: `.github/workflows/sync-public.yml`
Trigger: Push auf `obsilo/main`

Einmaliges Setup:
1. PAT erstellen (github.com → Settings → Developer settings → Tokens (classic), Scope: `repo`)
2. Secret `OBSILO_PUBLIC_TOKEN` in obsilo Repo Settings → Secrets and variables → Actions hinterlegen

Details: `devprocess/docs/TWO-REMOTE-SETUP.md`

---

## Lokale Remotes

```bash
git remote -v
# origin         https://github.com/pssah4/obsilo.git (fetch/push)
# obsilo  https://github.com/pssah4/obsilo.git (fetch/push)
```

Das `obsilo` Remote wird lokal nur noch als Fallback für den manuellen
Publish-Script benötigt. Der reguläre Sync läuft über GitHub Actions.
