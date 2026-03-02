# Globale Arbeitsweise -- Claude Code

> Diese Datei definiert WIE wir zusammenarbeiten.
> Sie wird beim ersten Projekt-Setup nach `~/.claude/CLAUDE.md` kopiert
> und waechst dann ueber alle Projekte hinweg weiter.
>
> Projektspezifische Details gehoeren NICHT hierhin, sondern in `memory/MEMORY.md`.

---

## A. Kommunikation & Sprache

- Konversation auf Deutsch
- Commit-Messages auf Englisch mit konventionellen Prefixes (feat/fix/chore/docs/refactor)
- Private Dokumentation (_devprocess/) auf Deutsch
- Public Dokumentation (README, docs/, ARCHITECTURE.md) auf Englisch
- Keine Emojis -- nicht in Code, nicht in UI, nicht in Kommunikation
- Technische Begriffe und Identifier bleiben immer Englisch, auch in deutschen Texten
- Co-Authored-By Claude in jedem Commit

---

## B. Planungs-Konventionen

- Plan-Mode fuer jede nicht-triviale Aufgabe
- Feste Plan-Struktur:
  1. **Kontext** -- Diagnostisch, nicht deskriptiv. Erklaert das "Warum" mit Root-Cause-Analyse
  2. **Aenderungen** -- Pro Datei ein Unterabschnitt, mit VORHER/NACHHER Code-Bloecken
  3. **Dateien-Zusammenfassung** -- Tabelle (Datei | Aenderung | Risiko)
  4. **Nicht betroffen** -- Explizite Liste der NICHT geaenderten Dateien (Blast-Radius)
  5. **Verifikation** -- Akzeptanzkriterien, Build immer Schritt 1, dann Regressionschecks
- Grosse Features in unabhaengig deploybare Phasen aufteilen
- Datei-Referenzen immer als `src/path/file.ts:LineNN`

---

## C. Feature-Lebenszyklus

Jedes Feature durchlaeuft diesen Zyklus:

```
1. BACKLOG          Eintrag in Backlog (Status: Geplant)
2. FEATURE-SPEC     Spec schreiben VOR der Implementierung
3. PLAN             Plan-Mode: Implementierungsplan erstellen
4. IMPLEMENTIERUNG  Code, Build+Deploy nach jedem Schritt
5. SPEC UPDATE      Feature-Spec wird zur Referenz-Doku
6. BACKLOG UPDATE   Unmittelbar nach jeder Implementierung
```

Schritt 6 passiert unmittelbar -- das Backlog ist immer aktuell.

---

## D. Implementierungs-Workflow

- Vor jeder Implementierung: Referenz-Implementierung pruefen (falls vorhanden)
- Vor jeder Code-Aenderung: bestehenden Code lesen und verstehen
- Inkrementell arbeiten: kleine Schritte, jeder verifiziert
- Build + Deploy nach JEDEM Implementierungsschritt (nicht erst am Ende)
- Neue Module folgen dem gleichen Wiring-Pattern:
  1. Datei erstellen im passenden Unterverzeichnis
  2. In Registry/Index registrieren
  3. In Gruppen/Modes einhaengen
  4. Metadata-Eintrag hinzufuegen
- Memory aktualisieren wenn sich Architektur-Eckdaten aendern

---

## E. Debugging & Fehleranalyse

- Bugs als kausale Ketten dokumentieren, nicht als Symptome:
  ```
  Problem: [beobachtbares Verhalten]
  Root Cause: [warum es passiert]
  Kette: Schritt 1 -> Schritt 2 -> ... -> Fehler
  ```
- Bug-IDs mit Prioritaet: FIX-NN (P0 = sofort, P1 = kurzfristig, P2 = mittelfristig)
- Security-Findings: H-N / M-N / L-N (High/Medium/Low)
- Gefundene Bugs sofort ins Backlog

---

## F. Dokumentations-Standards

- arc42 fuer Architektur (alle 12 Abschnitte)
- ADRs im MADR-Format (Kontext, Entscheidung, Alternativen, Konsequenzen)
- Feature-Specs als FEATURE-*.md:
  - VOR Implementierung: Anforderungen, Abgrenzung, Akzeptanzkriterien
  - NACH Implementierung: Referenzdoku mit How It Works, Key Files, Dependencies
- Backlog als lebendes Dokument -- wird nach jeder Implementierung aktualisiert
- Dokumentation als expliziter Deliverable in jedem Plan
- Traceability: Backlog -> FEATURE-Spec -> ADR -> Plan -> Commit -> Backlog-Update

---

## G. Git & Release-Workflow

- Dual-Remote: privat (origin, alle Branches) + public (nur main)
- Branch-Flow: feature/* -> dev -> main -> public/main
- **Safe-Merge:** Merges nach dev immer ueber `scripts/merge-to-dev.sh <branch>`
  - Automatisch: dev -> dev-backup (Snapshot), dann feature -> dev (no-ff)
  - Rollback: `git checkout dev && git reset --hard dev-backup`
- Zwei-Stufen-Stripping:
  1. promote-to-test: Dev-Tooling entfernen (.claude, scripts, forked-code)
  2. sync-public CI: Interne Docs entfernen (_devprocess/)
- _devprocess/ als AI-lesbares Wissensarchiv
- Kein aktiver git hook -- Quality Gates ueber Scripts und manuelle Checks

---

## H. Kontinuierliches Lernen

Claude lernt aktiv mit und speichert funktionierende Patterns -- proaktiv, nicht nur auf Anweisung.

**Wann Memory aktualisieren:**
- Neues Architektur-Pattern hat sich bewaehrt
- Loesung fuer wiederkehrendes Problem gefunden
- Konvention etabliert oder geaendert
- Projekt-State signifikant veraendert
- Framework-spezifische Regel entdeckt

**Wann NICHT speichern:**
- Einmalige, session-spezifische Details
- Unbestaetigte Vermutungen (erst verifizieren)
- Informationen die schon in CLAUDE.md oder _devprocess/ stehen

**Wie gespeichert wird:**
- MEMORY.md: Nur Eckdaten, Kurzreferenzen (<200 Zeilen)
- Zu detailliert? -> Eigene Referenz-Datei, aus MEMORY.md verlinkt
- Bestehende Eintraege aktualisieren statt neue anlegen
- Veraltete Eintraege aktiv loeschen
