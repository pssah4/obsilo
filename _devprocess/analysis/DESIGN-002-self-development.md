# Analyse: Agent Self-Development (Meta-Agent)

> Herleitung und Reasoning fuer die Self-Development-Architektur von Obsilo Agent

**Datum**: 2026-03-01
**Revision**: 3 (CDN-Strategie: esm.sh primaer, rekursive Dependency-Aufloesung)
**Status**: Analyse abgeschlossen, Implementierung ausstehend

---

## 1. Ausgangslage

### 1.1 Vision

Der Agent ist das **einzige Interface**. Der User promptet, der Agent konfiguriert und erweitert sich selbst. Eine Basisversion wird als Community Plugin ausgeliefert — alles darueber hinaus entsteht durch Interaktion mit dem Agent.

**Konkrete Szenarien:**
- User: "Ich brauche eine Moeglichkeit im Browser was zu machen" → Agent recherchiert, findet Playwright, konfiguriert Remote-Browser-MCP, speichert als Skill
- User: "Analysiere diese Daten nach Kriterium X" → Agent schreibt Analyse-Tool in TypeScript, liefert Ergebnisse/Grafiken
- User: "Erstelle eine PowerPoint aus dieser Note" → Agent schreibt PPTX-Generator, nutzt pptxgenjs, liefert Datei

### 1.2 Ausgangsvorschlag: Sandboxed Code Execution (Sonnet 4.6)

Die initiale Idee (erarbeitet mit Sonnet 4.6) sah vor:
- `isolated-vm` als Sandbox fuer Code-Ausfuehrung
- Strikte Trennung von Agent-Code und User-Code
- Vorinstallierte Utility-Libraries in der Sandbox

### 1.3 Warum isolated-vm nicht funktioniert

**`isolated-vm` erfordert native C++ Kompilierung (node-gyp)**. Das bricht fundamental mit dem Obsidian Community Plugin-Modell:

1. Community Plugins werden als **einzelne `main.js`** ausgeliefert (kein node_modules, keine native Dependencies)
2. `node-gyp` benoetigt Python + C++ Compiler auf dem Host — nicht voraussetzbar bei Endusern
3. Obsidian's Review-Bot wuerde native Dependencies ablehnen
4. Cross-Platform-Builds (Windows/Mac/Linux) waeren extrem fragil

**Erkenntnis**: Jede Loesung muss mit reinem JavaScript/TypeScript funktionieren, das in einer einzigen `main.js` gebundelt wird.

### 1.4 Warum vm.createContext() nicht ausreicht (Revision 2)

Der erste Entwurf sah `vm.createContext()` als Sandbox vor. **Das ist fundamental unsicher:**

**Node.js sagt selbst:** *"The vm module is not a security mechanism. Do not use it to run untrusted code."*

Bekannte Breakout-Techniken:
```javascript
({}).constructor.constructor('return process')()           // Prototype Chain
try { null.x } catch(e) { e.constructor.constructor('return process')() }  // Error Object
Promise.resolve().then.constructor('return process')()     // Promise
```

**AST/Regex-Validation ist umgehbar:**
```javascript
\u0065\u0076\u0061\u006c('...')        // Unicode → eval
const e='ev', a='al'; this[e+a]('...')  // String Concatenation
```

**Die Angriffskette:**
```
Prompt Injection (MCP-Response, Vault-Inhalt)
  → Agent schreibt "nuetzliches" Dynamic Module (mit verstecktem Breakout)
  → AstValidator erkennt obfuskierten Code NICHT
  → vm.createContext() Breakout → Voller Node.js-Zugriff
  → require('child_process') → Rechner kompromittiert
```

**Kritisch**: Obsidian Plugins laufen mit `nodeIntegration: true`. Code der aus der vm-Sandbox ausbricht hat vollen Zugriff auf Dateisystem, Netzwerk, Prozesse, und Umgebungsvariablen (API Keys).

---

## 2. Herleitungskette

### 2.1 Constraint-Analyse

Fuenf harte Constraints (einer mehr als im ersten Entwurf):

| Constraint | Implikation |
|-----------|------------|
| **Electron-only** | Kein Shell-Zugriff, keine Host-Installationen, keine child_process-Aufrufe |
| **Community-Plugin-tauglich** | Einzelne main.js, keine native Dependencies, kein node-gyp |
| **Review-Bot compliant** | Kein fetch(), kein console.log(), kein innerHTML, keine hardcodierten Pfade |
| **Kein Tier-2** | Alle Faehigkeiten muessen in Tier 1 (innerhalb Electron) verfuegbar sein |
| **Echte Isolation** | Dynamischer Code darf UNTER KEINEN UMSTAENDEN auf Host-Ressourcen zugreifen koennen |

### 2.2 Inspiration: OpenClaw und Craft Agents

**OpenClaw** (140k+ Stars) brachte folgende Einsichten:
- **Skills als Markdown**: Kein Code noetig fuer 80% der Automatisierungen
- **Progressive Disclosure**: Metadata immer im Context, Body nur bei Trigger, References on-demand
- **Self-Improving Agent**: Agent schlaegt Skill-Erstellung vor, wenn er Muster erkennt
- **Pre-Compaction Flush**: Vor Context-Condensing werden Erkenntnisse persistiert

**Craft Agents** ergaenzte:
- **SKILL.md mit Frontmatter**: Strukturiertes Format fuer Agent-erstellte Skills
- **Validation Tools**: Agent kann eigene Artefakte validieren
- **Agent-gesteuerte Config**: Agent konfiguriert sich selbst ueber Tools

### 2.3 Kern-Erkenntnis: Drei Stufen des Self-Development

Self-Development ist kein einzelnes Feature, sondern ein **Stufenmodell**:

```
Stufe 1: Skills (Markdown)
  → Workflow-Instruktionen, kein Code
  → ~80% aller Faelle
  → Risiko: Niedrig

Stufe 2: Dynamic Modules (TypeScript → JS)
  → Neue Capabilities via kompilierten Code
  → ~15% der Faelle
  → Risiko: Mittel (Chromium Sandbox)

Stufe 3: Core Self-Modification
  → Plugin baut sich selbst neu
  → ~5% der Faelle (nur echte Core-Bugs)
  → Risiko: Hoch (Backup + Rollback)
```

### 2.4 Loesung des Build-Problems: esbuild-wasm

**Problem**: TypeScript muss in JavaScript kompiliert werden, aber wir haben keinen Zugriff auf den Host.

**Loesung**: `esbuild-wasm` — eine reine WebAssembly-Version von esbuild:
- Laeuft in-process innerhalb von Electron
- Keine native Dependencies
- ~11MB, on-demand via `requestUrl` (Obsidian API) heruntergeladen
- `transform()` fuer einzelne Module (~100ms), `build()` mit virtuellem Dateisystem fuer Module mit Libraries
- Full-Rebuild des Plugins in ~20-30s

**Wichtig**: Nicht nur `transform` sondern auch `build()` mit Plugins — noetig damit Module npm-Libraries bundlen koennen (pptxgenjs, d3, etc.).

### 2.5 Loesung des Sandbox-Problems: Chromium iframe Sandbox (Revision 2)

**Problem**: Dynamisch kompilierter Code muss sicher ausgefuehrt werden. vm.createContext() ist keine Security-Grenze.

**Loesung**: `<iframe sandbox="allow-scripts">` — Chromium's eigene Sandbox:

```
Plugin (main.js) — hat Node.js-Zugriff, kontrolliert alles
    |
    |====== postMessage Bridge (einziger Kanal) ======|
    |
    v
iframe (Chromium Sandbox)
    |-- Kein Node.js, kein require, kein fs, kein Netzwerk
    |-- Nur Standard-Browser-APIs (kein DOM des Parents)
    |-- Kommunikation NUR ueber postMessage
    |-- Kann NICHT ausbrechen (Chromium Sandbox Guarantee)
```

**Warum das funktioniert:**
- Chromium's Sandbox ist seit 15+ Jahren kampferprobt
- Google zahlt Millionen Dollar Bounties fuer Sandbox-Escapes
- `sandbox="allow-scripts"` OHNE `allow-same-origin` verhindert jeden Zugriff auf den Parent
- Kein Node.js, kein require, kein process — nichts davon existiert im iframe
- Selbst wenn Code boesartig ist: Er kann NICHTS tun ausser ueber die Bridge kommunizieren

**Die Bridge kontrolliert alles:**
- Plugin-Seite entscheidet welche Vault-Pfade gelesen werden duerfen
- Plugin-Seite entscheidet welche URLs aufgerufen werden duerfen (Allowlist)
- Plugin-Seite entscheidet ob Writes erlaubt sind (User-Approval)
- Rate Limiting auf allen Bridge-Operationen

### 2.6 Loesung des Library-Problems: In-Process Package Manager (CDN-Strategie)

**Problem** (im ersten Entwurf ungeloest): Der Agent braucht Libraries (pptxgenjs, d3, csv-parse) — aber es gibt kein npm innerhalb von Electron.

**Loesung**: Agent laedt Pakete als vorkompilierte Browser ES Modules von CDN:
1. Agent erkennt Library-Bedarf (z.B. "brauche pptxgenjs fuer PPTX-Generierung")
2. **esm.sh** (primaer): `https://esm.sh/{name}?bundle` — CDN bundlet transitive Dependencies
3. **jsdelivr** (Fallback): `https://cdn.jsdelivr.net/npm/{name}/+esm`
4. **Rekursive Dependency-Aufloesung**: CDN-Bundles enthalten absolute-path Imports auf Node-Polyfills (`/node/buffer.mjs`, `/node/process.mjs`) und Sub-Pakete. `resolveInternalImports()` erkennt diese per Regex und laedt sie rekursiv herunter (max Tiefe: 5). Regex: `\s*` statt `\s+` wegen minifiziertem CDN-Code (`from"/path"` ohne Leerzeichen).
5. **Parallele Downloads**: Dependencies werden mit `Promise.all()` parallel geladen
6. In-Memory-Cache (packageCache Map) fuer heruntergeladene Pakete
7. esbuild-wasm `build()` mit virtual-packages Plugin das Imports gegen Cache aufloest
8. Gebundeltes JS wird in der iframe-Sandbox ausgefuehrt

**Polyfill-Chain Beispiel (pptxgenjs):**
```
pptxgenjs → buffer.mjs (28KB), process.mjs (7.8KB)
process.mjs → events.mjs (12KB), tty.mjs (685B)
events.mjs → async_hooks.mjs (2.9KB)
```

**URL-Allowlist**: esm.sh, cdn.jsdelivr.net, unpkg.com, registry.npmjs.org

### 2.7 Loesung des Codebase-Knowledge-Problems: Embedded Source

**Problem**: Der Agent kennt seine eigene Codebase nicht.

**Loesung**: Zwei Ebenen:

1. **ARCHITECTURE.md** (eingebettet): Fuer Dynamic Modules (Agent kennt nur DynamicToolDefinition)
2. **EMBEDDED_SOURCE** (fuer Core Self-Modification): TypeScript-Source komprimiert in main.js (~200-500KB)

### 2.8 Integration mit bestehendem Memory-System

**Bestehendes System** (voll funktionsfaehig): soul.md, user-profile.md, patterns.md, learnings.md, projects.md, sessions/, episodes/

**Erweiterung**:
- `errors.md` — Wiederkehrende Fehler + Loesungen
- `custom-tools.md` — Register erstellter Dynamic Tools + Skills
- LongTermExtractor erkennt Self-Improvement-Facts
- Pre-Compaction Memory Flush vor Context-Condensing

---

## 3. Security-Architektur: Defense in Depth

### 3.1 Fuenf Sicherheitsschichten

```
Schicht 1: User Review
  Agent zeigt generierten Code. User kann ablehnen.
  → Schuetzt gegen: Offensichtlich boesartigen Code

Schicht 2: AST/Pattern Validation
  Blockiert eval, require, process, __proto__, etc.
  → Schuetzt gegen: Einfache Angriffe, versehentlich unsicheren Code
  → NICHT ausreichend allein (umgehbar)

Schicht 3: Chromium Sandbox (iframe)        ← PRIMAERE SICHERHEITSGRENZE
  Echte OS-Level-Isolation. Kein Node.js, kein Dateisystem, kein Netzwerk.
  → Schuetzt gegen: ALLE Code-Breakout-Techniken
  → 15+ Jahre kampferprobt, Google Bounty Program

Schicht 4: Controlled Bridge
  Plugin-Seite kontrolliert alle APIs:
  - vault.read: Nur Dateien innerhalb des Vault
  - vault.writeBinary: Nur mit User-Approval
  - requestUrl: Nur URLs auf der Allowlist (npm CDN)
  → Schuetzt gegen: Privilege Escalation

Schicht 5: Rate Limiting + Monitoring
  - Max 10 vault.write pro Minute
  - Max 5 requestUrl pro Minute
  - Alle Operationen im ConsoleRingBuffer geloggt
  → Schuetzt gegen: Exfiltration, DoS
```

### 3.2 Prompt Injection Mitigationen

| Vektor | Mitigation |
|--------|-----------|
| MCP-Response mit Instruktionen | Tool-Ergebnisse als Daten markiert, nicht als System-Prompt |
| Vault-Inhalt mit versteckten Befehlen | Vault-Inhalte in `<document>` Tags, niedrigste Prioritaet |
| Supply-Chain (backdoored npm-Paket) | URL-Allowlist (nur bekannte CDNs), Groessen-Check, User-Review |
| User wird getaeuscht | Nicht technisch loesbar — User ist Trust-Boundary |

### 3.3 Was sich gegenueber Entwurf 1 geaendert hat

| Entwurf 1 (unsicher) | Entwurf 2 (sicher) |
|----------------------|-------------------|
| `vm.createContext()` als Sandbox | `<iframe sandbox="allow-scripts">` |
| Direkte API-Injection in vm-Context | postMessage Bridge mit kontrollierten Endpunkten |
| AST-Validation als primaere Sicherheit | AST-Validation als ergaenzende Schicht |
| Keine URL-Allowlist | URL-Allowlist fuer requestUrl-Bridge |
| Keine Rate Limits | Rate Limiting auf Bridge-Operationen |
| "Electron = Sandbox" Annahme | Chromium Sandbox = echte Sicherheitsgrenze |
| Nur text-basiertes vault.write | vault.writeBinary fuer ArrayBuffer (PPTX, Bilder) |
| Nur `transform()` | Auch `build()` mit virtuellem Dateisystem fuer Library-Bundling |
| 100KB Source-Limit | 2MB Output-Limit (gebundelte Libraries) |

---

## 4. Architektur-Entscheidungen

### 4.1 Dynamic Modules sind NICHT Teil von main.js

**Entscheidung**: Dynamic Modules werden separat kompiliert, in der iframe-Sandbox ausgefuehrt. main.js aendert sich nur bei Core Self-Modification (Stufe 3).

### 4.2 Patch-Module vor Full Rebuild

**Entscheidung**: Bevor der Agent einen Full Rebuild macht, versucht er einen Patch als Dynamic Module.

**Trade-off**: Patch-Module brauchen Zugriff auf Plugin-Internals und laufen AUSSERHALB der iframe-Sandbox (im privilegierten Plugin-Kontext). Erfordert explizite User-Approval + Code-Review-Modal.

### 4.3 Nur SSE + streamable-http fuer MCP Self-Configuration

**Entscheidung**: Kein stdio (spawnt Host-Prozesse). Fuer Browser-Automation: Agent konfiguriert Remote-Browser-Service (Browserbase/Browserless) als HTTP-MCP.

### 4.4 `custom_` Prefix fuer Dynamic Tools

**Entscheidung**: Kollisionsschutz mit 30+ eingebauten Tools.

### 4.5 Progressive Disclosure fuer Skills

| Ebene | Wann geladen | Budget |
|-------|-------------|--------|
| Metadata | Immer im System Prompt | ~100 Woerter/Skill |
| Body | Wenn Skill getriggert | ~2000 Woerter |
| References | On-demand | Unbegrenzt |

### 4.6 esbuild-wasm on-demand mit build() Support

**Entscheidung**: esbuild-wasm (~11MB) wird on-demand heruntergeladen. Nutzt sowohl `transform()` (einzelne Module) als auch `build()` mit virtuellem Dateisystem (Module mit Library-Dependencies).

### 4.7 iframe-Sandbox statt vm.createContext()

**Entscheidung**: Chromium iframe als primaere Sicherheitsgrenze. vm.createContext() wird NICHT fuer Security genutzt.

**Begruendung**: vm.createContext() ist explizit keine Sicherheitsgrenze (Node.js Dokumentation). Die Chromium Sandbox ist seit 15+ Jahren kampferprobt und bietet echte OS-Level-Isolation.

### 4.8 Binary I/O ueber Bridge

**Entscheidung**: vault.writeBinary() als Bridge-Endpunkt fuer ArrayBuffer-Output (PPTX, PNG, etc.).

**Begruendung**: Obsidian's `Vault.createBinary()` / `Vault.modifyBinary()` existiert bereits. Binaer-Dateien sind noetig fuer PowerPoint, Bilder, Excel, etc.

---

## 5. Risiko-Bewertung

| Stufe | Risiko | Mitigation |
|-------|--------|-----------|
| Skills (Markdown) | **Niedrig** | Kein Code, nur Instruktionen, Hot-Reload |
| Dynamic Modules | **Niedrig-Mittel** | Chromium Sandbox + Controlled Bridge + AST-Validation + User-Review |
| Patch-Module | **Mittel** | AUSSERHALB Sandbox, aber mit explizitem User-Approval + Code-Review-Modal |
| Core Self-Modification | **Hoch** | Backup + Rollback + DiffReview + User-Approval |
| npm-Paket Download | **Niedrig-Mittel** | URL-Allowlist (esm.sh, jsdelivr, unpkg), Groessen-Check, User-Review |
| MCP Self-Configuration | **Mittel** | Nur SSE/HTTP, Timeout, Validation |
| Prompt Injection | **Mittel** | Instruktionshierarchie, Tool-Call Validation, Approval-Gate |

**Verbleibende Risiken:**
- Chromium-Sandbox-Escape (0-day): Extrem unwahrscheinlich, Google patcht sofort
- User approved boesartigen Code ohne zu lesen: Nicht technisch loesbar
- Backdoored npm-Paket: Mitigiert durch Allowlist + Review, nicht eliminiert

---

## 6. Performance- und UX-Ueberlegungen

### 6.1 Wartezeiten minimieren

| Operation | Erwartete Dauer | UX-Strategie |
|-----------|----------------|-------------|
| Skill erstellen (Markdown) | <100ms | Sofort, kein Warten |
| iframe-Sandbox starten | ~50-100ms | Einmalig beim Plugin-Start, danach wiederverwendet |
| esbuild-wasm Erstdownload | ~5-15s | Progress-Bar, einmalig |
| Modul kompilieren (transform) | ~100ms | Kaum spuerbar |
| Modul kompilieren (build + Libraries) | ~500ms-2s | Spinner im Chat |
| Modul ausfuehren in Sandbox | <100ms (sync), variable (async) | Streaming-Output via Bridge |
| npm-Paket Download | ~1-5s pro Paket | Progress-Bar, gecacht |
| Full Rebuild (Core Self-Mod) | ~20-30s | Progress-Bar, selten |

### 6.2 Sandbox-Pool fuer schnelle Ausfuehrung

Die iframe-Sandbox wird beim Plugin-Start erstellt und bleibt aktiv. Kein Overhead pro Tool-Ausfuehrung. Fuer parallele Ausfuehrungen: Pool von 2-3 iframes.

### 6.3 Paket-Cache

Einmal heruntergeladene npm-Pakete bleiben lokal. Kein erneuter Download bei wiederholter Nutzung. Agent merkt sich in custom-tools.md welche Pakete verfuegbar sind.

---

## 7. Zusammenfassung

### Herleitungskette (Revision 2)

```
isolated-vm (Sonnet-Vorschlag)
    |
    ✗ Erfordert native C++ (node-gyp) → bricht Community Plugin
    |
    v
vm.createContext() + esbuild-wasm (Entwurf 1)
    |
    ✗ vm.createContext() ist KEINE Sicherheitsgrenze
    ✗ Bekannte Breakout-Techniken, AST-Validation umgehbar
    ✗ DynamicToolContext zu restriktiv (kein Binary I/O, keine Libraries)
    |
    v
Chromium iframe Sandbox + esbuild-wasm build() + postMessage Bridge (Entwurf 2)
    |
    + Echte OS-Level-Isolation (Chromium, 15+ Jahre kampferprobt)
    + Library-Bundling via esbuild build() + virtuellem Dateisystem
    + Binary I/O via vault.writeBinary Bridge-Endpunkt
    + URL-Allowlist + Rate Limiting auf Bridge
    + In-Process Package Manager (esm.sh ?bundle → jsdelivr fallback → rekursive Imports → In-Memory-Cache)
    |
    + OpenClaw: Skills als Markdown, Progressive Disclosure, Pre-Compaction Flush
    + Craft Agents: SKILL.md Format, Validation Tools, Agent-gesteuerte Config
    |
    v
Drei-Stufen-Modell mit echtem Security-Modell:
    1. Skills (Markdown) — 80%, kein Code, kein Build
    2. Dynamic Modules (TS→JS→iframe Sandbox) — 15%, echte Isolation
    3. Core Self-Modification — 5%, Embedded Source, Full Rebuild
```

### Kern-Aussagen

1. **Self-Development ist ein Stufenmodell** (Skills → Dynamic Modules → Core Modification)
2. **80% brauchen keinen Code** — Markdown-Skills reichen
3. **vm.createContext() ist KEINE Security-Grenze** — Chromium iframe ist die echte Sandbox
4. **postMessage Bridge kontrolliert alle Zugriffe** — Vault, Netzwerk, Binaer-I/O
5. **esbuild-wasm build() + In-Process Package Manager (esm.sh/jsdelivr CDN)** — Libraries als Browser ES Modules ohne npm/Shell, rekursive Dependency-Aufloesung
6. **Memory ist das Rueckgrat** — Agent weiss was er kann, was er gelernt hat
7. **Progressive Disclosure** haelt den Context schlank
8. **Patch-Module vor Full Rebuild** — 95% der Core-Bugs ohne Rebuild behebbar
9. **UX-First**: iframe-Pool, Paket-Cache, Streaming-Output — Wartezeiten minimal
