# Glossar: Tools, Skills und Sandbox

**Status:** Gueltig ab 2026-03-06

---

## Begriffsabgrenzung

### Tools
Alles was der Agent als Funktion aufrufen kann. Tools haben ein Input-Schema, fuehren eine Aktion aus, und geben ein Ergebnis zurueck.

| Typ | Beschreibung | Laufzeitumgebung | Beispiele |
|-----|--------------|-------------------|-----------|
| **Built-in Tools** | Von uns geschrieben und reviewed | Plugin-Kontext (Node.js) | read_file, write_file, semantic_search |
| **Custom Tools** | Vom Agent erstellt via manage_skill | Sandbox (isoliert) | custom_* |
| **Plugin Tools** | Obsidian-Plugin-Integration | Plugin-Kontext | execute_command, call_plugin_api |
| **MCP Tools** | Von externen MCP-Servern | Externer Prozess | use_mcp_tool |

### Skills
Anleitungen in Markdown, die den Agent bei bestimmten Aufgabentypen steuern. Skills fuehren keinen Code aus -- sie werden per Keyword-Matching ins System Prompt injiziert. Skills koennen auch ueber das `/`-Autocomplete im Chat aufgerufen werden.

| Typ | Quelle | Speicherort |
|-----|--------|-------------|
| **User Skills** | Manuell vom Benutzer erstellt | ~/.obsidian-agent/skills/{name}/SKILL.md |
| **Plugin Skills** | Auto-generiert durch VaultDNA Scanner | ~/.obsidian-agent/plugin-skills/{id}.skill.md |

### Sandbox
Isolierte Laufzeitumgebung fuer Agent-generierten Code. Zwei Implementierungen:
- **IframeSandboxExecutor** -- Browser-iframe mit sandbox="allow-scripts" (Mobile)
- **ProcessSandboxExecutor** -- child_process mit vm.createContext() (Desktop)

**Sandbox kann:**
- Text/JSON verarbeiten (String-Manipulation, Regex, Parsing)
- Vault-Dateien lesen/schreiben (ueber Bridge: vault.read, vault.write, vault.list)
- HTTP-Requests ausfuehren (ueber Bridge: requestUrl, URL-Allowlist)
- npm-Pakete als ESM-Bundles vom CDN laden (nur browser-kompatible)

**Sandbox kann NICHT:**
- Binaere Dateiformate erzeugen (DOCX, PPTX, XLSX, PDF) -- benoetigt Buffer, stream, JSZip
- Node.js APIs nutzen (require, fs, child_process, crypto, Buffer, stream)
- DOM-APIs nutzen (document, window, Blob)
- Aus der Isolation ausbrechen -- die Bridge ist der einzige Kommunikationskanal

### Workflows
Feste Schritt-fuer-Schritt-Anleitungen als Markdown-Dateien. Werden per `/`-Autocomplete im Chat ausgeloest. Keine Code-Ausfuehrung.

---

## Abgrenzung: Was ist was?

| Frage | Antwort |
|-------|---------|
| Der Agent soll eine Datei lesen | **Tool** (read_file) |
| Der Agent soll wissen, wie man Meeting-Notizen erstellt | **Skill** (meeting-notes SKILL.md) |
| Der Agent soll ein DOCX erzeugen | **Built-in Tool** (muss von uns implementiert werden) |
| Der Agent soll 200 Dateien umbenennen | **Sandbox** (evaluate_expression mit vault.read/write) |
| Der Agent soll einen Obsidian-Befehl ausfuehren | **Plugin Tool** (execute_command) |
| Der Agent soll eine bestimmte Methodik immer anwenden | **Skill** oder **Rule** |

---

## Sicherheitsmodell

```
Schicht 1: Betriebssystem (voller Zugriff)
Schicht 2: Plugin-Kontext (Built-in Tools, Bridge) -- reviewed Code
Schicht 3: Sandbox (Custom Tools, evaluate_expression) -- untrusted Code, isoliert
```

Agent-generierter Code laeuft **immer** in Schicht 3 (Sandbox). Er kann nicht in Schicht 2 (Plugin-Kontext) "befoerdert" werden. Fuer Faehigkeiten die Node.js APIs benoetigen (binaere Dateiformate), muessen Built-in Tools in Schicht 2 implementiert werden.

---

## Referenzen

- ADR-021: Sandbox OS-Level Process Isolation
- FEATURE-0502-sandbox-os-isolation.md
- src/core/sandbox/ (IframeSandboxExecutor, ProcessSandboxExecutor, SandboxBridge)
- src/core/tools/toolMetadata.ts (Single Source of Truth fuer Tool-Metadaten)
- src/core/skills/ (SelfAuthoredSkillLoader, VaultDNAScanner)
