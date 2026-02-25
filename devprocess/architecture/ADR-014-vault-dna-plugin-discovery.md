# ADR-014: VaultDNA — Automatische Plugin-Erkennung als Skills

**Status:** Akzeptiert
**Datum:** 2026-02-24
**Entscheider:** Sebastian Hanke

---

## Kontext

Der Agent soll nicht nur eingebaute Tools nutzen, sondern auch die Faehigkeiten aller im Vault installierten Obsidian-Plugins (Core + Community). Die Frage ist, wie der Agent ueber installierte Plugins informiert wird und wie er deren Befehle und APIs nutzen kann.

Optionen:
1. Manuelle Konfiguration (Nutzer listet Plugins + Befehle auf)
2. Statische Registry (vordefinierte Plugin-Beschreibungen fuer bekannte Plugins)
3. Runtime-Scan mit automatischer Skill-Generierung (VaultDNA)
4. MCP-Server pro Plugin

## Entscheidung

**Option 3 — Runtime VaultDNA-Scan** mit automatischer Skill-File-Generierung.

Beim Plugin-Start scannt `VaultDNAScanner`:
1. **Core Plugins**: Sofort verfuegbar (Obsidian Built-ins)
2. **Community Plugins**: Vollstaendiger Scan mit API-Reflection

Fuer jedes Plugin wird ein Skill-File generiert:
```
.obsidian-agent/plugin-skills/{plugin-id}.skill.md
```

Das Skill-File enthaelt:
- Plugin-Name, Beschreibung, Version
- Verfuegbare Commands (IDs + Names)
- API-Methoden (per Reflection auf das Plugin-Objekt)
- Klassifikation: FULL (Command + API), PARTIAL (nur Commands), NONE

## Begruendung

- **Zero Config**: Nutzer muss nichts manuell konfigurieren. Plugins werden automatisch erkannt.
- **Reflection statt Registry**: Funktioniert fuer JEDES Plugin, nicht nur bekannte. Neue Plugins werden sofort erkannt.
- **Skill-File-Format**: Plaintext-Dateien sind inspizierbar und editierbar. Nutzer kann Skill-Files anpassen.
- **Continuous Sync**: 5-Sekunden-Polling erkennt Plugin-Aenderungen (enable/disable/install/remove).
- **Security**: Sensible Plugin-Settings werden beim Scan redaktiert (API Keys, Tokens, Passwerte).

## Konsequenzen

**Positiv:**
- Sofortige Nutzung aller installierten Plugins ohne Konfiguration
- Agent kann deaktivierte Plugins erkennen und auf Anfrage aktivieren
- Erweiterbar: Nutzer kann eigene Skill-Files erstellen

**Negativ:**
- Reflection-basierter Scan kann bei Plugins mit unerwarteter API-Struktur fehlschlagen
- 5s-Polling ist nicht instant (Verzoegerung bei Plugin-Aenderungen)
- Generierte Skill-Beschreibungen sind generisch — fuer komplexe Plugins suboptimal

## Implementierung

- VaultDNA Scanner in `src/core/` (oder `src/core/context/`)
- `src/core/tools/agent/CallPluginApiTool.ts` — Plugin API Bridge
- `src/core/tools/agent/ExecuteRecipeTool.ts` — Recipe System
- Skills-Verzeichnis: `.obsidian-agent/plugin-skills/`
