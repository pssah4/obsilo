# Feature: PAS-1 – Local Skills

## Status
`DRAFT` · Zielversion: 0.1.0

## Einordnung

Dies ist Schritt 1 von 3 des Plugin-as-Skill-Features (PAS):

| Schritt | Feature | Status |
|---|---|---|
| **PAS-1** | **Local Skills** (dieses Dokument) | In Arbeit |
| PAS-2 | MCP Registry Server (GitHub + Cloudflare) | Folgt |
| PAS-3 | Connected Mode | Folgt |

PAS-1 ist vollständig standalone lauffähig und hat keine externen Abhängigkeiten.
PAS-2 und PAS-3 bauen auf PAS-1 auf, ändern aber nichts an dessen Verhalten.

---

## Übersicht

Der Agent erkennt beim ersten Start alle im Vault vorhandenen Plugins – Core Plugins (Obsidian Built-ins) und Community Plugins, aktiv oder inaktiv – und registriert sie als Skills. Aktive Skills stehen dem Agent sofort zur Verfügung. Inaktive (installierte aber deaktivierte) Plugins kennt der Agent und kann sie auf Nutzer-Anfrage aktivieren. Plugins die nicht im Vault installiert sind, sind dem Agent nicht bekannt.

Keine Netzwerkverbindung. Keine externe Registry. Alles lokal.

---

## Was der Agent kann (und was nicht)

**Kann:**
- Aktivierte Core Plugins als Skills nutzen (sofort beim Start, kein Scan)
- Aktivierte Community Plugins als Skills nutzen (nach VaultDNA Scan)
- Deaktivierte aber installierte Plugins erkennen und auf Anfrage aktivieren
- Dem Nutzer mitteilen welche Skills er hat und welche deaktiviert verfügbar wären
- Neue manuell installierte Plugins automatisch erkennen und als Skill registrieren

**Kann nicht:**
- Plugins suchen oder kennen die nicht im Vault installiert sind
- Plugins aus dem Internet laden oder installieren
- Skill-Beschreibungen LLM-anreichern (kein Netzwerkzugriff in PAS-1)

---

## User Stories

**US-01 · Core Skills beim Start**
Als Nutzer möchte ich, dass der Agent unmittelbar nach dem Obsidian-Start alle aktivierten Core Plugins als Skills nutzen kann – ohne Wartezeit und ohne Netzwerk.

*Akzeptanzkriterien:*
- Core Skills sind < 200ms nach Plugin-Load verfügbar
- Kein GitHub-Fetch, kein LLM-Call, kein Netzwerk
- Abgedeckte Core Plugins: daily-notes, canvas, templates, backlink, search, quick-switcher, note-composer, starred, outline, tag-pane, random-note (11 Plugins, FULL oder PARTIAL)

**US-02 · VaultDNA Scan**
Als Nutzer möchte ich, dass der Agent alle meine installierten Community Plugins automatisch erkennt und als Skills registriert – aktive sofort nutzbar, inaktive bekannt aber nicht injiziert.

*Akzeptanzkriterien:*
- Scan läuft beim ersten Plugin-Load automatisch
- Erfasst `app.plugins.manifests` (alle installierten, enabled UND disabled)
- Skeleton-Skill (Stufe A) für jeden agentifizierbaren Plugin generiert
- Aktive Plugins in SkillRegistry → System Prompt + Tool-Array
- Inaktive Plugins: Skill-File vorhanden, aber `enabled: false` → nicht injiziert
- Ergebnis in `vault-dna.json` persistiert
- Nutzer-Notification im Chat nach Abschluss

**US-03 · Agent aktiviert deaktiviertes Plugin**
Als Nutzer möchte ich, dass der Agent mir sagt wenn ein installiertes aber deaktiviertes Plugin eine Aufgabe lösen könnte – und es nach meiner Bestätigung aktiviert.

*Akzeptanzkriterien:*
- Agent erkennt Capability-Gap und prüft deaktivierte Plugins
- Chat-Nachricht mit Plugin-Name und konkretem Nutzen für die aktuelle Aufgabe
- Aktivierung nur nach expliziter Nutzer-Bestätigung ("Ja" / Klick)
- Nach Aktivierung: Skill sofort in SkillRegistry injiziert und nutzbar
- Ablehnung: Agent kommuniziert Lücke klar ohne erneut zu fragen

**US-04 · Transparente Lücken-Kommunikation**
Als Nutzer möchte ich, dass der Agent klar kommuniziert wenn er eine Fähigkeit nicht hat – mit konkretem Hinweis was ich tun könnte.

*Akzeptanzkriterien:*
- Agent nennt die fehlende Fähigkeit in eigenen Worten
- Falls bekanntes Plugin existiert (aus vault-dna.json archived): Plugin namentlich nennen
- Hinweis auf manuelle Installation und (falls noch nicht aktiviert) Connected Mode
- Kein generisches "Ich kann das nicht" ohne Handlungsoptionen

**US-05 · Kontinuierliche Sync**
Als Nutzer möchte ich, dass Plugins die ich nach dem initialen Scan manuell installiere oder deinstalliere automatisch in der Skill Registry reflektiert werden.

*Akzeptanzkriterien:*
- Event-Listener auf `app.plugins` für install/uninstall/enable/disable
- Neues Plugin: Skeleton-Skill generieren, in SkillRegistry registrieren wenn aktiv
- Plugin deinstalliert: Skill-File bleibt (archived in vault-dna.json), aus SkillRegistry entfernt
- Plugin deaktiviert: `enabled: false` in Skill-File setzen, aus SkillRegistry entfernen
- Plugin aktiviert: `enabled: true` setzen, in SkillRegistry registrieren

**US-06 · Settings Tab – Skills-Übersicht**
Als Nutzer möchte ich im Settings-Tab sehen welche Core Skills und Community Skills verfügbar sind, und deaktivierte Skills direkt von dort aktivieren können.

*Akzeptanzkriterien:*
- Skills Tab in Obsidian Plugin-Settings vorhanden
- Modus-Indikator: "Local Only" sichtbar
- Sektion Core Skills: alle agentifizierbaren Core Plugins mit Status
- Sektion Community Skills: aktive + inaktive getrennt aufgelistet
- Toggle pro Skill: Agent-seitig aktivieren/deaktivieren (unabhängig vom Obsidian-Plugin-Status)
- [Vault DNA Rescan]-Button
- [Skill ansehen]-Link öffnet das .skill.md File

---

## Architektur

### Systemübersicht

```
┌──────────────────────────────────────────────────────┐
│                    OBSIDIAN                           │
│                                                       │
│  app.internalPlugins    app.plugins.manifests         │
│  (Core Plugins)         (Community Plugins,           │
│                          enabled + disabled)          │
└──────────────┬──────────────────┬────────────────────┘
               │                  │
               ▼                  ▼
┌──────────────────────────────────────────────────────┐
│               OBSIDIAN AGENT PLUGIN                   │
│                                                       │
│  CorePluginSkillLibrary   VaultDNAScanner             │
│  (gebündelt, statisch)    (init + watch)              │
│          │                      │                     │
│          └──────────┬───────────┘                     │
│                     ▼                                 │
│              SkillGenerator                           │
│              (Stufe A: Skeleton)                      │
│                     │                                 │
│                     ▼                                 │
│              SkillRegistry                            │
│         (enabled Skills → Agent)                      │
│                     │                                 │
│                     ▼                                 │
│         CapabilityGapResolver                         │
│         (3-Stufen Local Flow)                         │
│                                                       │
│  vault/.agent/                                        │
│    skills/*.skill.md                                  │
│    skills/*.adapter.json                              │
│    vault-dna.json                                     │
└──────────────────────────────────────────────────────┘
               │
               ▼
         ANTHROPIC API
    (System Prompt + Tool-Array
     aus aktiven Skills)
```

### Komponenten im Detail

**`CorePluginSkillLibrary`**

Statisches Asset, gebündelt im Plugin. Enthält für jeden der 11 agentifizierbaren Core Plugins eine fertige `.skill.md` und `.adapter.json`. Wird nicht generiert – ist manuell gepflegt und versioniert.

```
plugin-bundle/
  core-skills/
    daily-notes.skill.md
    daily-notes.adapter.json
    canvas.skill.md
    canvas.adapter.json
    templates.skill.md
    templates.adapter.json
    backlink.skill.md
    backlink.adapter.json
    search.skill.md
    search.adapter.json
    quick-switcher.skill.md
    quick-switcher.adapter.json
    note-composer.skill.md
    note-composer.adapter.json
    starred.skill.md
    starred.adapter.json
    outline.skill.md
    outline.adapter.json
    tag-pane.skill.md
    tag-pane.adapter.json
    random-note.skill.md
    random-note.adapter.json
```

Beim Init: für jeden aktivierten Core Plugin → Dateien nach `vault/.agent/skills/` kopieren, `enabled: true` setzen. Für deaktivierte Core Plugins → ebenfalls kopieren, `enabled: false`.

---

**`VaultDNAScanner`**

Verantwortlich für den initialen Scan und kontinuierliche Sync.

```typescript
class VaultDNAScanner {
  // Einmaliger Scan beim ersten Plugin-Load
  async init(): Promise<VaultDNAScanResult>

  // Event-Listener auf Plugin-Änderungen
  watch(): void

  // Einzelnen Plugin klassifizieren
  classify(manifest: PluginManifest): AgentClass  // FULL | PARTIAL | NONE
}
```

`init()` Ablauf:
1. `app.plugins.manifests` iterieren (alle installierten Community Plugins)
2. Für jeden: `classify()` aufrufen
3. NONE → `vault-dna.json` Eintrag als NONE, kein Skill-File
4. FULL/PARTIAL → `SkillGenerator.generateSkeleton()` aufrufen
5. `vault-dna.json` schreiben

`watch()` lauscht auf:
- `this.app.workspace.on('plugin-installed')` → Skeleton generieren
- `this.app.workspace.on('plugin-uninstalled')` → vault-dna.json updaten, Skill deregistrieren
- `this.app.workspace.on('plugin-enabled')` → `enabled: true` in Skill-File, SkillRegistry.register()
- `this.app.workspace.on('plugin-disabled')` → `enabled: false` in Skill-File, SkillRegistry.unregister()

**Klassifizierungs-Heuristik:**

```typescript
function classify(manifest: PluginManifest): AgentClass {
  const commands = getCommandsFromManifest(manifest)

  if (commands.length === 0) return 'NONE'

  const meaningful = commands.filter(cmd =>
    !isUIOnlyCommand(cmd)  // filtert: toggle, settings, open panel, focus
  )

  if (meaningful.length === 0) return 'NONE'
  if (meaningful.length >= 3) return 'FULL'
  return 'PARTIAL'
}
```

---

**`SkillGenerator`**

Generiert Skill-Dateien für Community Plugins. In PAS-1 nur Stufe A (Skeleton).

```typescript
class SkillGenerator {
  // Stufe A: Sofort aus Manifest + Commands, kein Netzwerk
  async generateSkeleton(
    manifest: PluginManifest,
    status: 'enabled' | 'disabled'
  ): Promise<void>

  // Stufe B: LLM-Anreicherung – NOT IN PAS-1
  // async enrich(pluginId: string): Promise<void>
}
```

`generateSkeleton()` erstellt:
- `vault/.agent/skills/{id}.skill.md` mit Frontmatter aus Manifest
- `vault/.agent/skills/{id}.adapter.json` mit Tool-Schema aus Commands

Skeleton-Inhalt für die `.skill.md` Instruktionssektion (keine LLM-Anreicherung in PAS-1):

```markdown
Plugin {name} ist installiert und verfügt über folgende Commands:
{commandListe}

Nutze diesen Skill wenn der Nutzer Aufgaben beschreibt die
mit {name} erledigt werden können.
```

Minimal aber funktional – der Agent kann den Skill aufrufen. LLM-Anreicherung (semantisches "Wann einsetzen", Beispiele, Grenzen) kommt in PAS-3.

---

**`SkillRegistry`**

Verwaltet welche Skills dem Agent aktiv zur Verfügung stehen.

```typescript
class SkillRegistry {
  // Beim Start: alle enabled Skills laden
  async load(): Promise<void>

  // Skill zum aktiven Set hinzufügen
  register(skillId: string): void

  // Skill aus aktivem Set entfernen (Plugin deaktiviert)
  unregister(skillId: string): void

  // Für System Prompt: kompakte Skill-Liste
  getSystemPromptSection(): string

  // Für Anthropic API: Tool-Array aller aktiven Skills
  getToolDefinitions(): AnthropicTool[]
}
```

System Prompt Injection (kompakt, nicht volle Beschreibung):

```
# Verfügbare Skills
daily-notes · canvas · templates · dataview · templater · tasks · [+N weitere]

Für Details zu einem Skill: Skill-File lesen oder direkt verwenden.
```

Volle Skill-Beschreibung wird nur in den Context geladen wenn der Skill tatsächlich genutzt wird (lazy loading – spart Token).

---

**`CapabilityGapResolver`**

Wird vom Agent aufgerufen wenn er keine passende Fähigkeit für eine Aufgabe findet.

```typescript
class CapabilityGapResolver {
  async resolve(capability: string, context?: string): Promise<GapResult>
}

type GapResult =
  | { found: 'active-skill'; skillId: string }
  | { found: 'disabled-plugin'; pluginId: string; pluginName: string; message: string }
  | { found: 'archived'; pluginId: string; pluginName: string; message: string }
  | { found: false; message: string }
```

3-Stufen-Flow:

```
Stufe 1 – Aktive Skills durchsuchen
  Keyword-Match gegen: skill name, commands, plugin description
  → Treffer: { found: 'active-skill', skillId }
  → Agent nutzt Skill direkt

Stufe 2 – Deaktivierte Plugins (vault-dna.json, status: disabled)
  Gleiche Keyword-Suche gegen deaktivierte Einträge
  → Treffer: { found: 'disabled-plugin', message: "Du hast X installiert
    aber deaktiviert. Soll ich es für diese Aufgabe aktivieren?" }
  → Agent zeigt Nachricht, wartet auf Nutzer-Bestätigung
  → Bei OK: app.plugins.enablePlugin(id) → SkillRegistry.register()

Stufe 3 – Lücke kommunizieren
  Prüft archived-Einträge in vault-dna.json (früher installiert)
  → { found: false, message: "Ich habe keine Fähigkeit für X.
      [Optional: Du hattest früher Y installiert.]
      Du kannst Y manuell über Obsidian Settings installieren." }
```

---

## Dateiformat

### `.skill.md` Frontmatter

```yaml
---
id: obsidian-dataview
name: Dataview
source: vault-native          # core | vault-native | manual
plugin-type: community        # core | community
plugin-version: 0.5.66
plugin-status: enabled        # enabled | disabled
skill-version: 1.0.0
generated-at: 2026-02-21T10:00:00Z
enriched: false               # false in PAS-1, true nach LLM-Anreicherung in PAS-3
enabled: true                 # steuert ob Skill in SkillRegistry aktiv ist
class: FULL                   # FULL | PARTIAL
commands:
  - id: dataview:refresh-views
    name: Dataview: Refresh Views
  - id: dataview:dataview-force-refresh-views
    name: Dataview: Force Refresh All Views
adapter: obsidian-dataview.adapter.json
---

# Dataview

Plugin Dataview ist installiert und verfügt über folgende Commands:
- Dataview: Refresh Views
- Dataview: Force Refresh All Views

Nutze diesen Skill wenn der Nutzer Aufgaben beschreibt die
mit Dataview erledigt werden können.
```

### `.adapter.json`

```json
{
  "plugin-id": "obsidian-dataview",
  "schema-version": "1.0",
  "tools": [
    {
      "name": "dataview_refresh_views",
      "description": "Dataview: Refresh Views",
      "input_schema": {
        "type": "object",
        "properties": {}
      }
    },
    {
      "name": "dataview_force_refresh",
      "description": "Dataview: Force Refresh All Views",
      "input_schema": {
        "type": "object",
        "properties": {}
      }
    }
  ]
}
```

*Hinweis: In PAS-1 sind alle Tools parameterlos (Command-Wrapping). Parametrisierte API-Wrapper kommen in PAS-3.*

### `vault-dna.json`

```json
{
  "scanned-at": "2026-02-21T10:00:00Z",
  "agent-version": "0.1.0",
  "mode": "local",
  "plugins": [
    {
      "id": "daily-notes",
      "name": "Daily Notes",
      "type": "core",
      "class": "FULL",
      "status": "enabled",
      "skill-file": "daily-notes.skill.md",
      "source": "core"
    },
    {
      "id": "obsidian-dataview",
      "name": "Dataview",
      "type": "community",
      "class": "FULL",
      "status": "enabled",
      "version": "0.5.66",
      "skill-file": "obsidian-dataview.skill.md",
      "source": "vault-native"
    },
    {
      "id": "obsidian-kanban",
      "name": "Kanban",
      "type": "community",
      "class": "FULL",
      "status": "disabled",
      "version": "1.5.3",
      "skill-file": "obsidian-kanban.skill.md",
      "source": "vault-native"
    },
    {
      "id": "obsidian-style-settings",
      "name": "Style Settings",
      "type": "community",
      "class": "NONE",
      "status": "enabled",
      "reason": "Keine agentifizierbaren Commands"
    }
  ],
  "archived": []
}
```

---

## Vault-Struktur

```
vault/
  .agent/
    skills/
      # Core Plugins (aus CorePluginSkillLibrary, gebündelt)
      daily-notes.skill.md          # enabled: true
      daily-notes.adapter.json
      canvas.skill.md               # enabled: true
      canvas.adapter.json
      templates.skill.md            # enabled: false (Core deaktiviert)
      templates.adapter.json        # trotzdem vorhanden (für schnelle Aktivierung)

      # Community Plugins (generiert durch VaultDNAScanner)
      obsidian-dataview.skill.md    # enabled: true
      obsidian-dataview.adapter.json
      obsidian-kanban.skill.md      # enabled: false (installiert, deaktiviert)
      obsidian-kanban.adapter.json

    vault-dna.json                  # Status aller Vault-Plugins

# Im Plugin gebündelt (nicht im Vault):
.obsidian/plugins/obsidian-agent/
  main.js
  manifest.json
  core-skills/                      # CorePluginSkillLibrary
    daily-notes.skill.md
    daily-notes.adapter.json
    canvas.skill.md
    canvas.adapter.json
    ...
```

---

## Settings Tab: "Skills"

```
┌─────────────────────────────────────────────────────────┐
│  Skills                                                  │
│                                                          │
│  Modus: ● Local Only                                     │
│  Aktive Skills: 18  ·  Inaktiv: 5  ·  Gesamt: 23        │
│                                                          │
│  ──────────────────────────────────────────────────────  │
│  Core Skills                                             │
│                                                          │
│  Daily Notes      aktiv    ● [Skill ansehen]             │
│  Canvas           aktiv    ● [Skill ansehen]             │
│  Templates        inaktiv  ○ [Skill ansehen]             │
│  Backlinks        aktiv    ● [Skill ansehen]             │
│  Search           aktiv    ● [Skill ansehen]             │
│  ...                                                     │
│                                                          │
│  ──────────────────────────────────────────────────────  │
│  Community Skills                                        │
│                                                          │
│  Aktiv (18)                                              │
│  Dataview         aktiv    ● [Skill ansehen]             │
│  Templater        aktiv    ● [Skill ansehen]             │
│  Tasks            aktiv    ● [Skill ansehen]             │
│  ...                                                     │
│                                                          │
│  Installiert, deaktiviert (5)                            │
│  Kanban           inaktiv  ○ [Aktivieren] [Skill ansehen]│
│  Excalidraw       inaktiv  ○ [Aktivieren] [Skill ansehen]│
│  ...                                                     │
│                                                          │
│  ──────────────────────────────────────────────────────  │
│  [Vault DNA Rescan]                                      │
└─────────────────────────────────────────────────────────┘
```

Der Toggle (●/○) steuert ob der Skill dem Agent zur Verfügung steht – unabhängig vom Obsidian Plugin-Status. Ein aktives Plugin kann so vom Agent ausgeschlossen werden ohne es in Obsidian zu deaktivieren.

---

## Initialisierungsablauf

```
Obsidian startet → Agent Plugin lädt
        │
        ▼
Phase 0 · CorePluginSkillLibrary laden (< 50ms)
  Statische Dateien aus Plugin-Bundle in Memory laden
        │
        ▼
Phase 1 · Core Skills schreiben (< 100ms)
  app.internalPlugins iterieren
  Für jeden aktivierten Core Plugin:
    → .skill.md + .adapter.json aus Library nach vault/.agent/skills/ kopieren
    → enabled: true
    → SkillRegistry.register()
  Für jeden deaktivierten Core Plugin:
    → .skill.md + .adapter.json kopieren
    → enabled: false
    → NICHT in SkillRegistry
        │
        ▼
Phase 2 · Community Plugin Scan (synchron, < 2s für typische Vaults)
  app.plugins.manifests iterieren
  Für jeden Plugin:
    → classify() → NONE: vault-dna.json Eintrag, kein Skill-File
    → FULL/PARTIAL:
        SkillGenerator.generateSkeleton()
        enabled: true wenn Plugin aktiv, false wenn inaktiv
        Wenn aktiv: SkillRegistry.register()
        │
        ▼
Phase 3 · Persistenz + Sync starten
  vault-dna.json schreiben
  VaultDNAScanner.watch() starten
  Agent ist einsatzbereit
        │
        ▼
Nutzer-Notification (im Chat):
  "Skills geladen: 12 Core · 18 Community aktiv · 5 installiert/inaktiv
   [Skills ansehen]"
```

---

## Abgrenzung zu PAS-2 und PAS-3

| Thema | PAS-1 | PAS-2 | PAS-3 |
|---|---|---|---|
| Core Skills (gebündelt) | ✓ | — | — |
| Community Skill Skeleton | ✓ | — | — |
| LLM-Anreicherung (Stufe B) | ✗ | — | ✓ |
| vault-dna.json | ✓ | — | — |
| Kontinuierliche Sync | ✓ | — | — |
| Settings Tab (Local) | ✓ | — | — |
| Gap-Resolver (3 Stufen) | ✓ | — | — |
| GitHub Registry + Cron | ✗ | ✓ | — |
| Cloudflare Worker MCP | ✗ | ✓ | — |
| Gap-Resolver (5 Stufen) | ✗ | — | ✓ |
| Plugin-Installation | ✗ | — | ✓ |
| Settings Tab (Connected) | ✗ | — | ✓ |

PAS-2 und PAS-3 fügen **ausschließlich** neue Komponenten hinzu. An PAS-1-Komponenten werden nur additive Erweiterungen vorgenommen (keine Breaking Changes).

---

## Offene Fragen

**US-07 · Plugin API Queries**
Als Nutzer moechte ich, dass der Agent Plugin-APIs direkt aufrufen kann (z.B. Dataview-Queries, Omnisearch-Suche, MetaEdit-Updates) und strukturierte Ergebnisse zurueckbekommt – ohne Umweg ueber Commands.

*Akzeptanzkriterien:*
- Neues Tool `call_plugin_api(plugin_id, method, args)` verfuegbar
- Built-in Allowlist fuer bekannte Plugins: Dataview (query, tryQueryMarkdown, pages, page), Omnisearch (search), MetaEdit (getPropertyValue, getFilesWithProperty, update)
- Dynamische Discovery: VaultDNA Scanner erkennt Plugins mit `.api`-Property und listet Methoden per Reflection
- Dynamisch entdeckte Methoden erfordern IMMER User-Approval (isWrite = true) bis User explizit als safe markiert
- Methoden-Blocklist: execute, executeJs, render, register, unregister immer geblockt
- 10s Timeout pro Call, Return-Value truncated auf maxReturnSize
- Settings Toggle: `pluginApi.enabled` (default: true)
- Auto-Approval getrennt fuer Read und Write: `autoApproval.pluginApiRead` (default: true), `autoApproval.pluginApiWrite` (default: false)
- Fehlermeldung wenn Plugin nicht geladen oder Methode nicht in Allowlist/Discovery

**US-08 · Recipe-basierte externe Tool-Ausfuehrung**
Als Nutzer moechte ich, dass der Agent vordefinierte Rezepte fuer externe Tools ausfuehren kann (z.B. Pandoc PDF-Export) – ohne Zugriff auf eine offene Shell.

*Akzeptanzkriterien:*
- Neues Tool `execute_recipe(recipe_id, params)` verfuegbar
- Built-in Rezepte: pandoc-pdf, pandoc-docx, pandoc-convert, check-dependency
- Kein `shell: true` – alle Rezepte laufen via `child_process.spawn` mit args-Array
- Parameter-Validierung: Shell-Metazeichen verboten, Pfad-Confinement auf Vault-Root, Typ-Pruefung
- Binary-Pfad via `which`/`where` zu absolutem Pfad resolved (kein PATH-Hijacking)
- Timeout + SIGKILL-Fallback, Output-Limit, stdin geschlossen
- Minimale Env-Vars: nur PATH, HOME, LANG
- Master-Toggle: `recipes.enabled` (default: false, Opt-in)
- Jedes Rezept einzeln aktivierbar via `recipeToggles`
- User kann eigene Rezepte hinzufuegen (validiert beim Laden)
- Auto-Approval: `autoApproval.recipes` (default: false)
- Settings Tab "Shell" mit Rezept-Uebersicht und Toggles
- Klare Fehlermeldung wenn Binary nicht installiert

**US-09 · Workflow-Optimierung (Anti-Delegation, Depth-Limit, Lean Prompts)**
Als Nutzer erwarte ich, dass der Agent einfache Tasks direkt ausfuehrt statt Sub-Agents zu spawnen — und dass Sub-Agent-Nesting begrenzt ist.

*Akzeptanzkriterien:*
- Anti-Delegations-Regel im System-Prompt: new_task nur bei 5+ Schritten oder Context-Isolation-Bedarf
- Agent-Mode Role Definition priorisiert Direktausfuehrung ueber Delegation
- NewTaskTool Description warnt vor unnoetigem Spawning
- Code-Depth-Limit: `maxSubtaskDepth` (default: 2) verhindert rekursive Sub-Agent-Spirale
- Explizite Fehlermeldung bei Tiefenlimit ("Maximum sub-agent nesting depth reached")
- Sub-Agent Token-Accumulation: Kinder-Tokens an Parent-UI weitergereicht
- Lean Sub-Agent System-Prompt: omits Response-Format, Skills, Custom Instructions, Memory (~20-30% Token-Einsparung)
- Objective-Section erweitert: Verification-before-completion, Error-Recovery-Regel
- Setting in Loop Tab: "Max sub-agent depth" Slider (1-3)

---

## Offene Fragen

**OQ-01 · Obsidian Plugin Events**
Obsidian dokumentiert `plugin-enabled` / `plugin-disabled` Events nicht offiziell. Fallback-Strategie: kurzes Polling (alle 5s) auf `app.plugins.enabledPlugins` als Diff gegen letzten bekannten Stand. Muss im Prototyp getestet werden.

**OQ-02 · Commands aus Manifest**
Plugin Commands sind im `manifest.json` nicht enthalten – sie werden erst beim Plugin-Load in `app.commands` registriert. Für deaktivierte Plugins sind Commands daher nicht direkt auslesbar. Strategie: Commands aus aktivierten Plugins cachen; für deaktivierte Plugins als Skeleton ohne Commands-Liste generieren (nur Plugin-Name und Beschreibung).

**OQ-03 · Skeleton-Qualität**
Ohne LLM-Anreicherung und ohne Commands-Liste für deaktivierte Plugins ist der Skeleton minimal. Der Agent kann deaktivierte Plugins nur am Namen erkennen, nicht an ihren Fähigkeiten. Akzeptabel für PAS-1 – volle Qualität kommt mit PAS-3.

**OQ-04 · Core Plugin Events**
`app.internalPlugins` Events für enable/disable sind nicht dokumentiert. Selbe Polling-Strategie wie OQ-01 als Fallback.
