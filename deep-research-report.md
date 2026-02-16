# Analyse von Kilo Code für die Übertragung in ein Obsidian-Plugin

## Repository- und Plattformüberblick

Kilo Code ist als „agentic engineering platform“ positioniert und wird als Open-Source‑Coding‑Agent über mehrere Oberflächen bereitgestellt (u. a. VS‑Code‑Extension, JetBrains‑Plugin, CLI). Das GitHub‑Repository beschreibt Kilo als „all‑in‑one agentic engineering platform“ und verweist explizit auf Kernfähigkeiten wie Terminal‑Kommandos, Browser‑Automation, mehrere Modes/Personas sowie Erweiterbarkeit über MCP‑Server. citeturn1view0turn4view1

Der Code ist als Monorepo organisiert und verwendet **pnpm workspaces** sowie **Turborepo**. In der Workspace‑Konfiguration werden u. a. folgende Pakete geführt: `src` (Extension‑Core), `webview-ui` (UI), `cli`, `apps/*`, `packages/*` sowie JetBrains‑Host/Plugin. citeturn5view1turn4view0turn5view3

Das Root‑`package.json` zeigt typische Monorepo‑Build‑/Release‑Flows (Lint, Typprüfung, Tests, `.vsix`‑Build), sowie den Fokus auf VS‑Code‑Extension‑Packaging und weitere Plattform‑Targets (JetBrains‑Build/Run, CLI). citeturn5view0turn4view0

Für die zeitliche Einordnung: Das GitHub‑Repository führt Releases (z. B. „v5.7.0“ als „Latest“ am **11. Feb. 2026**). Das ist wichtig, weil sowohl Features als auch interne Architekturen (z. B. Agent Manager/CLI‑Integration) aktiv weiterentwickelt werden. citeturn1view0

## Extension-Kernarchitektur: Controller, Webview, Task-Laufzeit

### Zentrale Controller-Klasse und UI-Einbettung

Im Extension‑Core ist eine zentrale Controller‑Klasse als Webview‑Provider implementiert: `ClineProvider` (Name/Heritage siehe unten). Sie implementiert `vscode.WebviewViewProvider` und definiert feste IDs für Sidebar‑ und Tab‑Panel‑Kontext (z. B. `...SidebarProvider`). Das ist eine klassische Pattern‑Entscheidung: Die UI läuft in einer Webview, während die Extension‑Host‑Seite orchestriert, Tool‑Calls ausführt und State persistiert. citeturn16view0turn4view0

Der Provider initialisiert mehrere „Manager“-Komponenten (Konfiguration/Provider‑Profiles, Custom‑Modes, MCP‑Hub, Marketplace‑Manager, Code‑Index‑Manager, Checkpoints). Diese Bündelung ist für die Portierung nach Obsidian relevant: Für „KiloNote“ willst du denselben Ansatz – ein zentraler Plugin‑Controller, der UI ↔ Agent ↔ Tools ↔ Persistenz koordiniert. citeturn16view0turn18view0turn25view0

### Herkunft und Evolution (Cline → Kilo)

Die offizielle Kilo‑Dokumentation enthält eine „Cline to Kilo“ Contributor‑Migration‑Seite, die explizit „Cline“ als Vorgänger‑Kontext behandelt und „What’s New in Kilo“ beschreibt (u. a. mehrere Interfaces, spezialisierte Modes, Sessions/Parallel Agents). Das erklärt, warum zentrale Klassen weiterhin „Cline“-Namen tragen. citeturn36view2turn16view0

### Task-Objekt als Laufzeitcontainer

Die eigentliche Agent‑Laufzeit wird im `Task`‑Objekt gebündelt: Es enthält (u. a.) Task‑IDs/Instanz‑IDs, Modus‑Persistenz, Provider‑Konfiguration, Conversation‑History, Tool‑Usage, Checkpoint‑Service, Browser‑Session, Terminal‑Integration sowie Mechaniken für Context‑Management (Kondensierung/Trunkierung) und Tool‑Parsing (XML vs Native Tool Calling). citeturn26view0turn34view1turn31view2

Wesentlich für deine Anforderungen („Agent Logic“, „Orchestrator“, „CRUD auf Notes“, „Einstellungen pro Agent/Mode“): Kilo trennt **Provider‑Profile** und **Mode‑Konfiguration** – und „Tasks“ binden diese Entscheidungen an eine konkrete Sitzung, inkl. festem Tool‑Protokoll (damit das Resuming nicht kaputtgeht, wenn man später Einstellungen umstellt). citeturn26view0turn34view1turn15view0

## Modes, Tools und Orchestrierung

### Modes als „Personas“ mit Tool-Gruppen und Prompt-Bausteinen

Modes sind in Kilo als Mode‑Configs modelliert (built‑in + Custom Modes), mit Feldern wie `roleDefinition`, `whenToUse`, `customInstructions`, Gruppen/Tool‑Zugriff etc. Custom Modes können Built‑ins überschreiben, und Prompt‑Overrides werden in Extension‑State gespeichert (globalState). citeturn15view0turn1view3

Die Doku betont außerdem „Sticky Models“: pro Mode wird das zuletzt verwendete Modell gemerkt, um je nach Aufgabe (z. B. Planen vs Implementieren) automatisch andere Modelle zu nutzen. Für dein „Agent Behavior pro Agent/Mode“ ist das ein tragendes UX‑Prinzip. citeturn1view3turn1view2

### Tool-System: XML vs Native, Tool-Gruppen, Aliases

Kilo definiert ein Tool‑Schema mit zwei Protokollen: `xml` und `native`. Es existiert eine zentrale Tool‑Registry (Tool‑Namen, Parameternamen, Native‑Argument‑Typing, Tool‑Aliases, „always available tools“, Tool‑Gruppen wie `read`, `edit`, `browser`, `command`, `mcp`, `modes`). citeturn17view1turn33view0turn13view1

Wichtige Tools, die direkt in deine Obsidian‑Übertragung abbildbar sind:

- **Read/Explore**: `read_file`, `list_files`, `search_files`, `codebase_search` citeturn17view1turn31view4  
- **Write/CRUD**: `write_to_file`, `edit_file` (search/replace‑basiert), `apply_diff`, `apply_patch`, `delete_file` citeturn17view1turn25view0  
- **Orchestrierung**: `switch_mode`, `new_task`, `update_todo_list` citeturn17view1turn31view3turn30search10  
- **Browser/MCP**: `browser_action`, `use_mcp_tool`, `access_mcp_resource` citeturn17view1turn24view4turn23search12

Für „KiloNote“ bedeutet das: Du musst kein komplett neues Tool‑Paradigma erfinden. Du brauchst eine Tool‑Schicht, die „Vault‑Operationen“ sauber kapselt, plus dieselben Safety‑Mechaniken (Approval + optional Auto‑Approve). citeturn24view5turn24view0turn17view1

### Orchestrator Mode und Subtasks: Konzept und Umsetzung

Die Doku beschreibt Orchestrator Mode als Mechanik, komplexe Arbeiten in Subtasks zu zerlegen; Subtasks laufen isoliert (eigene Conversation‑History), und Information wird explizit „down“ über Initial‑Instruktionen und „up“ über eine Final‑Summary transferiert. Standardmäßig braucht es Approval für Subtask‑Creation/Completion (Auto‑Approve optional). citeturn35search2turn24view3turn24view0

Das `new_task` Tool ist in der Tools‑Doku konkretisiert: Es erzeugt eine neue Task‑Instanz, pausiert den Parent, verwaltet eine Task‑Hierarchie/Navigation und überträgt Ergebnisse beim Abschluss zurück. citeturn31view3

In der Extension‑Implementierung wird diese Task‑Hierarchie als Stack modelliert: `ClineProvider` hält `clineStack: Task[]` und bietet Methoden wie „add to stack“, „remove“, „finishSubTask (resume parent)“. Das ist das technische Herzstück, das du für deinen Obsidian‑Orchestrator nahezu unverändert übernehmen kannst (abgesehen von IDE‑spezifischen Integrationen). citeturn16view0turn26view0

### Multi-Agent und Parallelisierung

Kilo hat zusätzlich zum Orchestrator‑Konzept einen **Agent Manager** als „Control Panel“ (Webview), der Agents als **interaktive CLI‑Prozesse** starten/überwachen kann, Sessions resuming unterstützt und einen „Parallel Mode“ anbietet. Parallel Mode wird dabei über **Git worktrees** isoliert (Worktrees in `.kilocode/worktrees/`, lokale excludes über `.git/info/exclude`). citeturn36view1turn36view0

Für Obsidian ist die Worktree‑Isolation als Pattern nur teilweise übertragbar (Notes statt Codebase, evtl. kein Git‑Repo). Aber das Kernprinzip („Parallel laufende Agents mit Isolation/Conflict‑Management“) ist direkt relevant für deine Parallel‑Jobs‑Anforderung. citeturn36view1turn24view0

image_group{"layout":"carousel","aspect_ratio":"16:9","query":["Kilo Code VS Code sidebar chat interface","Kilo Code Orchestrator Mode task hierarchy UI","Kilo Code auto approve toolbar screenshot","Kilo Code checkpoints timeline UI"],"num_per_query":1}

## Kontext, Mentions, Regeln, Workflows und Skills

### Context Mentions als UX- und Kontext-Engineering-Primitiv

Kilo nutzt ein `@`‑Mention‑System, um strukturierte Kontextobjekte in Requests einzubetten: Dateien, Ordner, Problems‑Liste, Terminal‑Output, Git‑Commits/Working Changes und URLs. Die Doku beschreibt Formate und Output‑Semantik (z. B. Ordner als Tree, Dateien mit Zeilennummern; URL‑Content via Browser‑Fetch → Markdown). citeturn22view0turn24view4

Code‑seitig wird das durch `parseMentions` umgesetzt:  
- Mentions werden im Text erkannt, durch Platzhalter ersetzt („see below…“) und der tatsächliche Content anschließend an den Prompt angehängt. citeturn27view1turn28view0  
- File/Folder‑Mentions lesen Content über Text‑Extraktion, skippen Binärdateien und respektieren Ignore‑Regeln. citeturn28view0turn29view0  
- URL‑Mentions verwenden einen `UrlContentFetcher`, der eine Browser‑Session öffnen/close‑n kann und Content zu Markdown konvertiert (mit UI‑Error‑Handling). citeturn27view1turn24view4

Für deine Obsidian‑Vision („auf ganze Ordner oder einzelne Dateien referenzieren“, „Attachments“, „Browser‑Tool“): Das Mention‑System ist eine der wertvollsten Blaupausen, weil es „manuelles Copy‑Paste“ eliminiert und die Agentenarbeit in Wissensarbeit/Notizen genauso gut funktioniert wie in Code. citeturn22view0turn27view1

### Ignore-Regeln als Sicherheits- und Privacy-Layer

`.kilocodeignore` ist als root‑Level‑Datei dokumentiert, nutzt `.gitignore`‑Patternsyntax und steuert, auf welche Dateien/Ordner Kilo überhaupt zugreifen darf (z. B. bei `read_file`, `write_to_file`, `execute_command`). Ignorierte Files sind standardmäßig auch in Listen verborgen (optional „lock icon“). citeturn29view0turn28view0

Das ist für Obsidian sogar noch wichtiger, weil Vaults häufig private Inhalte enthalten. Ein analoges Konzept (z. B. `.kilonoteignore`) ist praktisch zwingend, wenn du „CRUD‑Tools“ auf Notes/Attachments anbietest. citeturn29view0turn24view0

### Custom Rules, Custom Instructions und Workflows

Kilo unterstützt „Custom Rules“ als textbasierte Guardrails (Project‑Rules + Global‑Rules), primär über Dateien in `.kilocode/rules/`, optional mode‑spezifisch über File‑System‑Strukturen; UI‑Support ist (laut Doku) nicht für alle Rule‑Varianten gleich. citeturn31view1turn15view0

„Workflows“ sind als Markdown‑Dateien in `.kilocode/workflows/` angelegt und können per Slash‑Command (z. B. `/submit-pr.md`) ausgelöst werden; Workflows beschreiben Schrittfolgen, die Tools wie `search_files`, `execute_command`, `ask_followup_question` orchestrieren. citeturn31view0turn17view1

Für Obsidian kannst du das nahezu 1:1 übernehmen, nur mit wissensarbeits‑spezifischen Workflow‑Templates (z. B. „Literatur‑Import“, „Meeting‑Notiz in Tasks umwandeln“, „Konzept → Outline → Draft“) und mit Vault‑Tools statt Git/CI‑Befehlen. citeturn31view0turn22view0

### Skills als portable „Pakete“

Kilo implementiert „Agent Skills“ als Ordner‑Pakete mit `SKILL.md` (Metadaten + Instructions), generisch oder mode‑spezifisch; Skills werden bei Bedarf in den Kontext geladen (on demand) und sind als interoperables Format gedacht. citeturn1view4turn13view2turn13view1

Das ist für „KiloNote“ besonders attraktiv: Skills können z. B. „Zettelkasten‑Regeln“, „Atomic Notes“, „ADR‑Schreiben“, „Prompt‑Review“, „Executive Summary“ kapseln – ohne dass du dein Core‑Prompt‑System aufblähst. citeturn1view4turn31view2

## Indexing und Suche: Von Codebase Indexing zu Vault Indexing

### Architektur von Codebase Indexing in Kilo

Die Dokumentation beschreibt Codebase Indexing als Pipeline: (1) Code‑Parsing via **Tree‑sitter** in semantische Blöcke, (2) Embedding‑Erzeugung, (3) Speicherung in einer **Qdrant**‑Vektor‑DB, (4) Bereitstellung des `codebase_search` Tools. citeturn31view4

Im Code ist das als `CodeIndexManager` umgesetzt (Singleton pro Workspace), der Konfiguration lädt, Caches verwaltet, Services erzeugt, Indexing orchestriert und Search anbietet (`searchIndex`). Er verwendet außerdem `.gitignore`‑Patterns als Teil des Index‑Filters. citeturn18view0turn19view0

Die Service‑Factory zeigt, wie flexibel das System designt ist: „Embedder Provider“ umfassen u. a. OpenAI/Ollama/OpenAI‑compatible/Gemini/Mistral/Vercel AI Gateway/Bedrock/OpenRouter/Voyage. Vektor‑Stores können Qdrant (remote) oder LanceDB (lokal) sein. citeturn19view0turn18view3

Qdrant‑seitig wird ein Workspace‑spezifischer Collection‑Name aus dem Workspace‑Pfad gehasht, Payload‑Indizes werden angelegt, und Suchen können über `pathSegments` gefiltert werden (Directory‑Prefix‑Suche). citeturn20view0turn19view1

LanceDB ist als lokale Alternative implementiert, inkl. dynamischem Nachinstallieren der nativen LanceDB‑Dependencies (plattform-/arch‑spezifische Node‑Binaries) über einen Manager. Das ist ein wichtiges Signal: Kilo adressiert explizit „lokale“ Index‑Optionen, die du für Obsidian‑Vaults (Privacy‑First) sehr wahrscheinlich bevorzugen willst. citeturn21view0turn21view1turn19view0

### Übertragungslogik auf Obsidian: Was bleibt, was ändert sich?

Für Wissensmanagement ersetzt du „Code‑Blöcke“ durch „Note‑Blöcke“:

- Markdown‑Struktur: Headings/Abschnitte/Embeds/Callouts/Dataview‑Blöcke als Chunk‑Grenzen (statt Tree‑sitter‑Nodes). (Konzeptuelle Ableitung basierend auf Kilo‑Chunking‑Prinzipien; Kilo selbst beschreibt semantische Blöcke und Tool `codebase_search` als Ergebnis.) citeturn31view4turn18view0  
- Attachments: PDFs/DOCX können – analog zu Kilo File Mentions – über Text‑Extraktion in Chunks überführt werden (Kilo erwähnt ausdrücklich PDF/DOCX‑Support bei Mentions). citeturn22view0turn28view0  
- Storage: Qdrant‑Remote (optional) oder lokale DB. Wenn du Kilos Ansatz übernehmen willst, ist „lokal“ (LanceDB‑ähnlich) sinnvoll, aber du musst die Obsidian‑Distribution berücksichtigen (Desktop vs Mobile). Kilo zeigt beide Wege (Qdrant/LanceDB) als austauschbare Backends. citeturn19view0turn20view0turn21view0

## Checkpoints, Persistenz und Safety Controls

### Checkpoints als Shadow-Git („Time Machine“)

Kilo dokumentiert Checkpoints als Snapshots in einem „shadow Git repository“, getrennt vom Haupt‑VCS. Snapshots werden automatisch bei Task‑Start, File‑Changes oder Command‑Runs erstellt und können auch Binäränderungen erfassen. citeturn24view1

Im Code ist das als `ShadowCheckpointService` implementiert:  
- Es wird ein eigenes Git‑Repo im Checkpoints‑Verzeichnis initialisiert und per `core.worktree` auf das Workspace‑Verzeichnis gesetzt. citeturn25view0  
- Git‑Environment‑Variablen werden „sanitized“, um Devcontainer/Umgebungs‑Artefakte (wie `GIT_DIR`) nicht in Checkpoint‑Operationen einfließen zu lassen. citeturn25view0  
- Es gibt Schutzlogiken (Warnung/Block) für „protected paths“ und Nested‑Git‑Repos (Erkennung über ripgrep‑Suche nach `.git/HEAD`). citeturn25view0turn4view0

Wichtig für deine Obsidian‑Portierung: Das Shadow‑Git‑Pattern ist eine sehr starke, bereits bewährte Antwort auf „Undo/Restore“ für Agent‑CRUD‑Aktionen. Die Frage ist weniger „ob“, sondern „wie“ du es für Vaults sicher aktivierst (z. B. nur Desktop, opt‑in, klare UI). citeturn24view1turn25view0turn24view0

### Approval und Auto-Approve als Sicherheitsrahmen

Die Doku zu Auto‑Approving Actions ist sehr klar: Auto‑Approve umgeht Bestätigungen und erhöht Risiken (insb. bei Command‑Access). In der UI gibt es eine Toolbar, Permission‑Kategorien (Read/Edit/Commands/Browser/MCP/Mode Switch) und eine Master‑Toggle‑Logik. citeturn24view0

Zusätzlich beschreibt „How Tools Work“, dass Tool‑Ausführungen grundsätzlich als Proposed Action erscheinen und über „Save/Reject“ bestätigt werden (mit optionalem Auto‑approve). citeturn24view5

Für Obsidian ist das exakt der richtige Sicherheitsrahmen: CRUD auf Notes ist zwar weniger gefährlich als Shell‑Kommandos, aber potenziell hochriskant für Datenintegrität (Wissensbasis). Auto‑Approve sollte in „KiloNote“ deshalb granular und konservativ defaulten. (Ableitung konsequent aus Kilos Risiko‑Statement.) citeturn24view0turn24view5

### Sessions, Cleanup, Parallel Mode

Der Agent Manager ist dokumentiert als UI, die CLI‑Agents managt, Sessions resumed und Parallel Mode via Git‑Worktrees sicher isoliert. Das Dokument betont, dass dies „actual implementation in the extension“ reflektiert. citeturn36view1turn36view0

Für dich ist das vor allem eine Architektur‑Inspiration: „parallel arbeitende Agents“ sind in Kilo nicht nur ein Prompt‑Konzept, sondern werden als **Prozess‑ und Workspace‑Isolation** behandelt. citeturn36view1turn31view3

## Übertragung auf Obsidian: Strukturvorschlag für ein „KiloNote“-Plugin

### Obsidian als Zielplattform: technische Leitplanken

Für die Vault‑Ebene stellt Obsidian eine eigene API bereit: Ein Vault ist ein Ordner; Plugins können zwar grundsätzlich wie Node.js auf das Dateisystem zugreifen, aber die Vault‑API abstrahiert Lesen/Schreiben/Löschen von Dateien und empfiehlt bei „read → transform → write“ ausdrücklich `Vault.process()`, um Stale‑Writes und Datenverlust zu vermeiden. citeturn38view1

Zusätzlich (für UI/Plugin‑Grundstruktur) ist das offizielle Type‑Definitions‑Repository von Obsidian relevant: Es beschreibt Plugin‑Struktur (`manifest.json`, Entry‑Point, Bundling), weist darauf hin, dass Plugins Node/Electron APIs nutzen können, und nennt zentrale „App‑Module“ (App/Vault/Workspace/MetadataCache) sowie Plugin‑Methoden (z. B. Settings Tabs, Commands, registerView, loadData/saveData). citeturn42view0

Dass Plugins Tabs/Views in der Sidebar sichtbar machen können, ist auch in Obsidian‑User‑Dokumentation verankert („Many plugins automatically create sidebar tabs“). citeturn37search5

### Zielbild: Welche Kilo-Funktionalitäten sind für Notes/Attachments sinnvoll übertragbar?

Kilo‑Features, die in Obsidian nahezu direkt Sinn ergeben (inhaltlich „Notes/Attachments“ statt „Codebase“):

- **Modes + Agent Behavior** (Rolle, Kurzbeschreibung, When‑to‑use, Tools, Modellzuordnung pro Mode/Agent, Sticky Models). citeturn1view3turn15view0turn32view0  
- **Mentions (@)** als kontextuelle Referenzen: Notes, Folder‑Trees, Tags, „Backlinks“, Attachments, URLs. (Kilo hat bereits File/Folder/URL‑Mentions + Text‑Extraktion; das Muster ist übertragbar.) citeturn22view0turn27view1turn28view0  
- **Tool‑basiertes CRUD** mit Approval/Auto‑Approve, statt „direkt schreiben“. citeturn24view5turn24view0turn17view1  
- **Workflows** als Markdown‑Prozeduren (statt „PR submission“ eher „Meeting‑Minute → Aufgaben“, „Paper‑Synopsis“, „Concept Draft“). citeturn31view0  
- **Skills** als portable Wissens‑/Prozess‑Pakete (z. B. „Zettelkasten“, „Executive Brief“, „Research Template“). citeturn1view4turn13view2  
- **Indexing + Semantic Search** (Vault‑Index statt Code‑Index) mit lokal/remote Vektor‑Store‑Optionen. citeturn31view4turn19view0turn20view0  
- **Checkpoints/Snapshots** als Wiederherstellungsanker für Agent‑CRUD. citeturn24view1turn25view0  
- **Orchestrator** für komplexe Wissensarbeit als Subtasks (z. B. „Recherche“, „Struktur“, „Draft“, „Kritik“, „Finalisierung“) mit isolierten Kontexten. citeturn35search2turn31view3turn16view0

### Architektur-Blueprint für „KiloNote“

#### UI-Schicht und Look & Feel

Um das Kilo‑Look&Feel (Sidebar‑Chat, Mode‑Selector, Timeline/Checkpoints, Auto‑Approve Toolbar) nachzubilden, ist der naheliegende Obsidian‑Weg:

- Eine eigene View/Sidebar‑Tab über `registerView` (Obsidian‑Plugin‑API) und Persistenz über `loadData/saveData`. citeturn42view0  
- Eine Web‑UI‑Schicht (React/Svelte) im Plugin‑Bundle, analog zum Kilo‑Webview‑Ansatz, aber in Obsidian‑Rendering statt VS‑Code‑Webview (die Trennung Controller ↔ UI bleibt architektonisch identisch). citeturn16view0turn42view0  
- Einheitliche UI‑Elemente: Mode‑Dropdown/Slash‑Commands, „Proposed Tool Action“ Cards mit Approve/Reject, Checkpoint‑Liste (Restore/Diff), Task‑Hierarchy (Parent/Child). citeturn24view5turn24view1turn35search2turn31view3

#### Agent Runtime und Orchestrator

Technisch ist Kilos „Task“‑Konzept als „Session‑Container + Tools + History + Checkpoints“ bereits genau das, was du brauchst. Für Obsidian:

- `Task`‑Analogon: `NoteTask` mit Feldern: `taskId`, `modeSlug`, `providerProfileId`, `toolProtocol`, `conversationHistory`, `toolUsage`, `checkpointRefs`, „active note context“. (Kilo zeigt diese Bündelung im `Task`‑Objekt inkl. Fixierung von Mode/ToolProtocol für Resuming.) citeturn26view0turn34view1  
- Orchestrator: Stack‑basiertes Task‑Management, bei dem Subtasks isoliert laufen und nur Summary zurückgeben (exakt wie Kilo beschreibt und implementiert). citeturn16view0turn35search2turn31view3  
- Parallelisierung (optional in V1 oder als V2): Kilo zeigt dafür eine „Agent Manager“‑Schicht mit mehreren Agents/Sessions. In Obsidian könntest du das (ohne CLI‑Prozesse) als „Parallel‑Sessions“ im Plugin modellieren; Isolation wäre dann nicht Git‑Worktree, sondern:  
  - separate „Arbeitskopien“ von Ziel‑Notes (temporäre Draft‑Files) oder  
  - separate „Patch‑Queues“, die erst nach Review auf die echten Notes angewandt werden.  
  Das ist konzeptionell konsistent mit Kilos Isolation‑Ziel (Worktrees). citeturn36view1turn24view5

#### Tool-Schicht: CRUD auf Notes und Attachments

Du willst „Terminal“ im Sinne von „schreibende Aktionen im Vault“. Das entspricht Kilos Tool‑Layer (read/edit/write/delete) sehr direkt. citeturn17view1turn24view5

In Obsidian sollte die Implementierung konsequent die Vault‑API nutzen:

- Lesen: `vault.read()` / `vault.cachedRead()` (je nach Use‑Case). citeturn38view1  
- Sicheres „read‑transform‑write“: `vault.process()` (empfohlen zur Vermeidung von Datenverlust). citeturn38view1  
- Löschen: `vault.trash()` oder `vault.delete()` je nach gewünschter Undo‑Semantik. citeturn38view1  

Mapping der wichtigsten Kilo‑Tools auf Obsidian‑Äquivalente (inhaltlich, nicht naming‑fixiert):

- `read_file` → `read_note` / `read_attachment_text` (mit Zeilennummern/Chunk‑IDs) citeturn22view0turn28view0  
- `list_files`/`search_files` → `list_vault_paths` / `search_vault_regex` citeturn17view1turn29view0  
- `write_to_file`/`edit_file`/`apply_diff` → `write_note`, `apply_patch_to_note` (diff‑Vorschau + Approval) citeturn17view1turn24view5  
- `codebase_search` → `vault_semantic_search` (basierend auf Vault‑Index) citeturn31view4turn18view0  
- `browser_action` → `browser_fetch`/`url_to_markdown` (Kilo‑Pattern) citeturn24view4turn27view1  

#### Provider- und Modell-Architektur

Kilo kapselt Provider über `buildApiHandler(configuration)` und implementiert viele Provider‑Handler (u. a. OpenRouter, Bedrock). Die `ApiHandlerCreateMessageMetadata` trägt Task‑ID/Mode, Tool‑Protocol‑Flags und die Möglichkeit parallel tool calls zu erlauben (wenn native tool calling genutzt wird). citeturn34view1turn33view3

Für „KiloNote“ kannst du denselben Schnittstellenansatz übernehmen – nur mit deinen Ziel‑Providern:

- entity["company","OpenAI","ai company"] API (Chat + Embeddings) als Primary. citeturn34view1turn19view0  
- entity["company","OpenRouter","llm routing platform"] als Multi‑Model Router. citeturn34view1turn19view0  
- entity["company","Amazon Web Services","cloud provider"] Bedrock (für Enterprise‑Setups/Compliance). citeturn33view3turn19view0  
- „OpenAI‑compatible“ Endpoints (für euren Model Garden) – Kilo nutzt explizit einen „openai‑compatible“ Embedder‑Pfad; und Provider‑Abstraktionen sind auf genau solche Varianten ausgelegt. citeturn19view0turn33view0  

Wichtig: Kilo speichert Provider‑Profiles und migriert/validiert sie (inkl. Default‑Profile, pro‑Mode‑Mapping). Das ist die Vorlage für „Modellwahl pro Agent“, „Rollendefinition“, „Tool‑Scopes pro Mode“, „Sprachwahl“, etc. citeturn32view0turn15view0turn1view3

#### Kontextfenster und Condensing

Kilo dokumentiert Context Condensing als Summarisierungs‑Pipeline, die bei Bedarf automatisch oder manuell (`/condense`) getriggert wird und die History durch eine verdichtete Summary ersetzt; möglich ist auch eine separate API‑Konfiguration speziell fürs Condensing. citeturn31view2turn26view0

Für Obsidian ist das doppelt relevant:  
- Notes sind oft lang (mehr Kontext)  
- Agenten sollen „konzeptionell“ arbeiten (mehr Gesprächshistorie)  
Damit wird Condensing (und die Wahl eines günstigeren Modells fürs Condensing) ein zentraler Kosten‑/UX‑Hebel. citeturn31view2turn23search16

#### Checkpoints für Vault-Änderungen

Kilos Shadow‑Git‑Checkpoints sind eine ausgereifte Antwort auf „Rollback bei Agent‑Edits“. Für Obsidian gibt es zwei plausible Portierungswege:

- Shadow‑Git exakt übernehmen (Vault als Worktree). Vorteil: Diffs/Restore‑Semantik ist robust. Nachteil: Git‑Verfügbarkeit, Plattform‑Edgecases, Nested‑Repo‑Checks. (Kilo implementiert genau diese Checks und Workarounds.) citeturn25view0turn24view1  
- Alternative Snapshot‑Store: Kopien/Delta‑Patches pro Change im Plugin‑Data‑Dir, Restore über Patch‑Reapply. Das folgt denselben Safety‑Zielen wie Tools+Approval, nur ohne Git. (Konzeptionell abgeleitet aus Kilos Checkpoint‑Intent.) citeturn24view1turn24view5

### Spezifische Anpassungen für Wissensmanagement

Kilo ist primär auf „Engineering Workflows“ ausgerichtet (Terminal, Probleme, Git). Für Obsidian solltest du die Domäne „Konzeptarbeit“ first‑class machen – ohne Kilos Kernarchitektur zu brechen:

- **Neue Mentions**: `@note:...`, `@tag:...`, `@backlinks`, `@outline`, `@daily-note`, `@search:"..."` – analog zur Kilo‑Mention‑Mechanik, aber auf Vault/MetadataCache. (Kilo zeigt, wie Mentions als Parser‑Schicht funktionieren und Content „below“ injizieren.) citeturn27view1turn22view0  
- **Modes für Wissensarbeit**: z. B. „Research“, „Synthesis“, „Writer“, „Critic“, „Planner“, plus „Orchestrator“. Kilo zeigt für Modes exakt die Felder, die du genannt hast (Role Definition, When to Use, Tools). citeturn1view3turn15view0turn35search2  
- **Workflows/Skills** als Wissensprozesse: statt PR‑Workflows eher „Literaturreview“, „Meeting‑Follow‑ups“, „Konzept → Draft“, „Notizen normalisieren“. Kilo zeigt Workflows/Skills als Markdown‑Artefakte in Projektordnern. citeturn31view0turn1view4turn29view0  
- **Indexing/Recherche**: „Vault Semantic Search“ + optional klassische Regex‑Search als Fallback. Kilo kombiniert semantische Suche (`codebase_search`) mit klassischen Dateitools (`search_files`). citeturn31view4turn17view1turn18view0

### Sprachwahl (DE/EN) und Settings

Kilo hat eine lokalisierte UI/Fehlermeldungen (z. B. `t(...)` in Core‑Services) und eine sehr breite Settings‑Oberfläche (Auto‑Approve, Context/Indexing, Modes). Ein „KiloNote“ sollte das gleiche Pattern übernehmen: zentrale Settings‑Tab + per‑Mode/Provider‑Profile + Spracheinstellungen (mind. de/en). citeturn24view0turn18view0turn16view0

Obsidian‑seitig sind Settings, Commands, Views und Persistenz als Plugin‑Grundfähigkeiten vorgesehen (Plugin‑API / Type‑Definitions‑Repo). citeturn42view0turn38view1