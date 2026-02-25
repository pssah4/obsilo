# Obsidian Agent – Product Vision

## 1. Vision

Obsidian Agent ist eine agentische Betriebsschicht für Obsidian.

Es überträgt die Architektur- und Interaktionsprinzipien von Kilo Code
(Tool-Use, Orchestrator, Approval-System, Modes, Checkpoints)
auf den Kontext von Wissensarbeit in Markdown-Vaults.

Obsidian Agent ist nicht nur ein Schreibassistent,
sondern ein kontrollierter Vault-Operator.

---

## 2. Problem Statement

Wissensarbeit in Obsidian leidet unter:

- Manuellem Kontext-Zusammenstellen
- Fehlender Orchestrierung wiederkehrender Workflows
- Risiko bei AI-Edits (kein Diff, kein Restore)
- Keine semantische Vault-Synthese
- Keine automatisierte Canvas/Struktur-Erstellung

---

## 3. Zielbild

Obsidian Agent ermöglicht:

- Agentische Bearbeitung von Notes
- Sichere Vault-Operationen mit Approval
- Canvas-Generierung aus Wissenszusammenhängen
- Semantische Vault-Analyse (lokal)
- Workflow-Automatisierung
- Snapshot-Checkpoints (lokal via isomorphic-git)

---

## 4. Nicht-Ziele

- Kein Cloud-Backend
- Keine Server-Komponente
- Kein Git-Zwang für den User
- Keine Core-Plugin-Hacks
- Kein direkter Zugriff auf Obsidian Memory Graph intern

---

## 5. MVP Positionierung

Desktop-first.
Local-only.
BYO-Model.
Approval-by-default.
