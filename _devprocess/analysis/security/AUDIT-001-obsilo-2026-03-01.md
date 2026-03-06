# Security Audit Report

| Field | Value |
|-------|-------|
| **Project** | Obsilo Agent (Obsidian Plugin) |
| **Date** | 2026-03-01 |
| **Auditor** | Security Auditor Agent |
| **Scan Scope** | Full -- All 6 phases |
| **Risk Rating** | Medium |
| **Languages** | TypeScript (strict) |
| **Runtime** | Electron (Obsidian) |
| **Previous Audit** | 2026-03-01 (SECURITY-scan-report-2026-03-01.md) |

---

## Executive Summary

| Analysis Domain | Critical | High | Medium | Low | Info |
|-----------------|----------|------|--------|-----|------|
| SAST (CodeQL-equiv.) | 0 | 1 | 2 | 1 | 1 |
| OWASP Top 10 | 0 | 0 | 2 | 1 | 0 |
| OWASP LLM Top 10 | 0 | 1 | 2 | 1 | 0 |
| Zero Trust | 0 | 0 | 1 | 1 | 0 |
| Code Quality | 0 | 0 | 3 | 3 | 1 |
| SCA (Dependencies) | 0 | 1 | 1 | 1 | 0 |
| License Compliance | 0 | 0 | 0 | 0 | 0 |
| **Total** | **0** | **3** | **11** | **8** | **2** |

Die Codebase zeigt eine starke Security-Engineering-Kultur mit mehreren Defense-in-Depth-Schichten. Kein kritisches Finding. Seit dem vorherigen Audit (gleicher Tag, frueheres Scan-Ergebnis) wurden mehrere P1-Findings behoben (event.source-Pruefung, GlobalFileService-Pfad-Traversal, testToolExecution-Gate, CSP-Header). Die verbleibenden High-Findings betreffen die Electron-spezifische Sandbox-Limitierung (architekturbedingt, keine Code-Aenderung moeglich), eine npm-audit-Vulnerability in transitiven Dependencies, und das Risiko von Prompt Injection bei aktivierter Auto-Approval.

### Delta zum vorherigen Audit

| Finding (vorher) | Status vorher | Status jetzt | Aenderung |
|-------------------|---------------|--------------|-----------|
| H-2/M-10: postMessage event.source | Open | **Resolved** | event.source === this.iframe?.contentWindow in SandboxExecutor.ts:157 |
| H-4: Sandbox-Doku (OS-level claim) | Open | **Resolved** | Korrekte Dokumentation: V8 origin isolation (logical boundary, not OS-level in Electron) |
| H-5: GlobalFileService path traversal | Open | **Resolved** | Path-Traversal-Check in GlobalFileService.ts:33-36 |
| M-1: ReDoS SearchFilesTool | Open | **Resolved** | safeRegex() utility implementiert und verwendet |
| M-4: testToolExecution ungegated | Open | **Resolved** | Gated hinter debugMode in main.ts:938-941 |
| M-9/I-2: CSP auf Sandbox iframe | Open | **Resolved** | CSP meta tag vorhanden in sandboxHtml.ts:17 |
| M-11: CDN-Loading Doku | Open | **Resolved** | SHA-256-Integritaetspruefung + korrekte Dokumentation |
| Lock-File fehlend | Open | **Resolved** | package-lock.json vorhanden |
| M-3: Skill trigger regex ReDoS | Open | **Unchanged** | ManageSkillTool.ts:351 -- new RegExp() ohne Komplexitaetspruefung |
| M-5: DNS-Rebinding WebFetch | Open | **Unchanged** | Weiterhin Hostname-basierte Pruefung vor DNS-Resolution |
| L-5: Package-Downloads ohne Integrity | Open | **Unchanged** | ensurePackage() laed CDN-Pakete ohne Hash-Pruefung |

---

## Findings (nach Prioritaet)

### P1: Must Fix (High)

---

### H-1: Chromium-Sandbox-Limitierung in Electron (CWE-693 -- Protection Mechanism Failure)

| Field | Value |
|-------|-------|
| **Severity** | High |
| **CWE** | CWE-693 |
| **Location** | `src/core/sandbox/SandboxExecutor.ts`, `src/core/sandbox/sandboxHtml.ts` |
| **Status** | Confirmed -- architekturbedingt, nicht durch Code-Aenderung behebbar |

**Finding:**
Obsidians Electron-Renderer hat nodeIntegration: true und contextIsolation: false. Die iframe-Sandbox (sandbox="allow-scripts") bietet V8-Origin-Isolation, aber keine OS-Level-Prozess-Isolation. Ein V8-Exploit im Sandbox-iframe wuerde vollen Node.js-Zugriff ermoeglichen (Filesystem, child_process, Network).

**Risk:**
Bei Exploitation eines V8-Bugs im sandboxed Code (z.B. via boeswilliger npm-Dependency in evaluate_expression) wuerde die gesamte Plugin-Sicherheit umgangen.

**Remediation:**
- SandboxBridge als primaere Sicherheitsgrenze beibehalten (ist bereits korrekt implementiert)
- Enterprise-Dokumentation: Sandbox ist Convenience-Layer, nicht Security-Boundary
- Fuer Enterprise: evaluate_expression und manage_skill (mit Code-Modulen) per Mode-Config deaktivieren
- Langfristig: Electron BrowserWindow mit sandbox: true + IPC evaluieren (Breaking Change)

---

### H-2: npm-audit: 3 High-Severity Vulnerabilities in transitiven Dependencies

| Field | Value |
|-------|-------|
| **Severity** | High |
| **CWE** | CWE-1035 |
| **Location** | package.json (transitive Dependencies) |
| **Status** | Confirmed |

**Finding:**
npm audit zeigt 3 High-Severity Findings:
1. minimatch (CWE-407/CWE-1333): ReDoS via nested extglobs -- betrifft eslint-Dependencies (devDep, nicht shipped)
2. tar (CWE-22/CWE-176): Path Traversal + Race Condition via Unicode Ligature -- betrifft @mapbox/node-pre-gyp (transitive Dep von pdf-parse)
3. @mapbox/node-pre-gyp (via tar): Vulnerable tar-Version

**Risk:**
- minimatch: Nur DevDep (eslint). Nicht im shipped Plugin enthalten. Geringes Risiko.
- tar/@mapbox/node-pre-gyp: Transitive Dep ueber pdf-parse@1.1.1. pdf-parse ist ein Runtime-Dep. Die vulnerable tar kommt ueber node-pre-gyp rein, wird aber nur zur Build-Zeit fuer native Module benoetigt, nicht im gepackten Plugin.

**Remediation:**
- Kurzfristig: npm audit fix
- Mittelfristig: pdf-parse durch pdfjs-dist allein ersetzen (pdf-parse@1.1.1 ist seit 2020 unmaintained)

---

### H-3: Prompt Injection bei aktivierter Voll-Auto-Approval (CWE-77)

| Field | Value |
|-------|-------|
| **Severity** | High |
| **CWE** | CWE-77 |
| **Location** | `src/core/tool-execution/ToolExecutionPipeline.ts`, `src/core/prompts/systemPrompt.ts` |
| **Status** | Confirmed -- by design, aber Risiko muss dokumentiert werden |

**Finding:**
Wenn Auto-Approval auf "permissive" steht (alle Writes auto-approved), koennte ein prompt-injizierter Inhalt (z.B. aus einer via web_fetch geladenen Webseite oder aus einer Vault-Notiz) unkontrolliert Vault-Aenderungen ausloesen. Die bestehenden Mitigations (Mode-Tool-Filter, System-Prompt-Boundary, IgnoreService) sind gut, aber nicht absolut.

**Risk:**
Unkontrollierte Vault-Modifikation durch LLM-Prompt-Injection bei auto-approval: permissive.

**Remediation:**
- Dokumentation: "permissive" Preset als High-Risk kennzeichnen
- Enterprise-Preset hinzufuegen das auto-approval fuer Writes IMMER deaktiviert
- Optional: Content-basierte Heuristik fuer verdaechtige Tool-Sequenzen nach web_fetch

---

### P2: Should Fix (Medium)

---

### M-1: Skill-Trigger-Regex ohne Komplexitaetspruefung (CWE-1333 -- ReDoS)

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **CWE** | CWE-1333 |
| **Location** | `src/core/tools/agent/ManageSkillTool.ts:351` |
| **Status** | Confirmed |

**Finding:**
Agent-erstellte Skills definieren ein Trigger-Regex (triggerSource), das mit `new RegExp(skill.triggerSource)` kompiliert wird. Keine Komplexitaetspruefung via safeRegex().

**Remediation:**
Ersetze `new RegExp()` durch `safeRegex()` aus `src/core/utils/safeRegex.ts`.

---

### M-2: DNS-Rebinding-Luecke in WebFetchTool SSRF-Schutz (CWE-918)

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **CWE** | CWE-918 |
| **Location** | `src/core/tools/web/WebFetchTool.ts:80-92` |
| **Status** | Confirmed -- dokumentiert aber nicht mitigiert |

**Finding:**
Die SSRF-Pruefung validiert den Hostname vor DNS-Resolution. Ein Angreifer mit DNS-Kontrolle koennte DNS-Rebinding nutzen: evil.com -> public IP (waehrend Check) -> 127.0.0.1 (waehrend Request).

**Remediation:**
- Inline-Kommentar mit Limitation ist vorhanden (gut)
- Fuer Enterprise: DNS-Resolution VOR dem Request und IP-Validierung des Ergebnisses

---

### M-3: DeleteFileTool nutzt vault.trash() statt fileManager.trashFile() (Review-Bot-Regel)

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **CWE** | N/A (Obsidian Review-Bot Compliance) |
| **Location** | `src/core/tools/vault/DeleteFileTool.ts:67` |
| **Status** | Confirmed |

**Finding:**
Die Obsidian Community Plugin Review-Bot Regeln verbieten `Vault.delete()` und `Vault.trash()`. Die korrekte API ist `FileManager.trashFile()`. DeleteFileTool nutzt `this.app.vault.trash(item, true)`.

**Remediation:**
Ersetze `vault.trash(item, true)` durch `this.app.fileManager.trashFile(item)`.

---

### M-4: vault.delete() in internem Code (Review-Bot-Regel)

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **CWE** | N/A (Obsidian Review-Bot Compliance) |
| **Locations** | `src/core/skills/SelfAuthoredSkillLoader.ts:409,413`, `src/core/checkpoints/GitCheckpointService.ts:230`, `src/core/tools/dynamic/DynamicToolLoader.ts:197` |
| **Status** | Confirmed |

**Finding:**
Mehrere interne Stellen nutzen `vault.delete()` statt `fileManager.trashFile()`. Dies kann zu Plugin-Ablehnung durch den Review-Bot fuehren.

**Remediation:**
Alle `vault.delete()` Aufrufe durch `fileManager.trashFile()` ersetzen, oder -- wenn es sich um Plugin-interne Dateien handelt (compiled code, cache) -- die Nutzung mit einem Kommentar begruenden.

---

### M-5: NPM-Pakete werden ohne Integritaetspruefung geladen (CWE-494)

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **CWE** | CWE-494 |
| **Location** | `src/core/sandbox/EsbuildWasmManager.ts:330-360` |
| **Status** | Confirmed |

**Finding:**
`ensurePackage()` laedt npm-Pakete von esm.sh und cdn.jsdelivr.net ohne SHA-256-Integritaetspruefung. Zwar laufen diese Pakete im sandboxed iframe, aber ein CDN-Compromise koennte boeswilligen Code einschleusen. Die `resolveInternalImports()`-Methode laedt sogar rekursiv Sub-Dependencies (Tiefe 5).

**Remediation:**
- Kurzfristig: Dokumentation der Limitation + Warnung an den User beim ersten Download
- Mittelfristig: known-good Package-Hashes fuer gaengige Pakete mitliefern
- Langfristig: SRI-Hashes aus npm Registry abfragen und verifizieren

---

### M-6: Vault-Inhalte (potentiell PII) an Cloud-LLMs (CWE-200)

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **CWE** | CWE-200 |
| **Location** | By Design (API Provider Layer) |
| **Status** | Confirmed -- Mitigations vorhanden |

**Finding:**
Vault-Notizen werden als Kontext an Cloud-LLM-Provider gesendet. Fuer Enterprise mit sensiblen Daten ein Data-Leakage-Vektor.

**Mitigations vorhanden:** Ollama/LM Studio (lokale Provider) unterstuetzt, .obsidian-agentignore kann sensitive Ordner ausschliessen.

**Remediation:** Enterprise-Setting: Provider auf local-only einschraenken.

---

### M-7: Excessive Agency via manage_source (CWE-269)

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **CWE** | CWE-269 |
| **Location** | `src/core/tools/agent/ManageSourceTool.ts` |
| **Status** | Confirmed -- mitigiert durch Approval |

**Finding:**
Der Agent kann seinen eigenen Source-Code lesen, editieren, builden und hot-reloaden. Obwohl als self-modify klassifiziert und IMMER manuell genehmigt werden muss, erlaubt dies theoretisch die Entfernung eigener Safety-Checks.

**Remediation:** Enterprise-Mode ohne manage_source im Tool-Set.

---

### M-8: BackupTab: Settings-Import ohne Schema-Validierung (CWE-502)

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **CWE** | CWE-502 |
| **Location** | `src/ui/settings/BackupTab.ts:450` |
| **Status** | Confirmed |

**Finding:**
`doImport()` parsed JSON aus einer vom User ausgewaehlten Datei und setzt es direkt als Plugin-Settings ein: `this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS, parsed)`. Keine Schema-Validierung. Ein manipuliertes Backup koennte beliebige Setting-Keys setzen, z.B. Auto-Approval aktivieren oder MCP-Server-Configs injizieren.

**Remediation:** Schema-Validation vor Settings-Uebernahme implementieren.

---

### M-9: Unvalidierte JSON.parse-Aufrufe auf LLM-Responses (CWE-502)

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **CWE** | CWE-502 |
| **Locations** | `src/core/mastery/RecipePromotionService.ts:124`, `src/core/memory/LongTermExtractor.ts:202`, `src/core/skills/SelfAuthoredSkillLoader.ts:538` |
| **Status** | Confirmed |

**Finding:**
LLM-Ausgaben werden via `JSON.parse()` verarbeitet. Fehlerhafte oder manipulierte LLM-Responses koennten zu unerwartetem Verhalten fuehren. Die meisten Stellen haben try/catch, aber die geparsten Objekte werden oft ohne Validierung als typisierte Objekte behandelt.

**Remediation:** Zod oder manuelles Schema-Validieren fuer LLM-Responses.

---

### P3: Consider (Low + Info)

---

### L-1: SelfAuthoredSkillLoader nutzt new RegExp() mit LLM-generierten Field-Patterns (CWE-1333)

| Field | Value |
|-------|-------|
| **Severity** | Low |
| **CWE** | CWE-1333 |
| **Location** | `src/core/skills/SelfAuthoredSkillLoader.ts:557,563,569,707` |
| **Status** | Confirmed |

`new RegExp()` wird mit LLM-generierten Feldern gebaut. Da die Pattern-Struktur fix ist und der field-Wert kontrolliert, ist das Risiko gering. Fuer Konsistenz safeRegex() verwenden.

---

### L-2: MCP-Verbindungen ohne Mutual TLS (CWE-295)

| Field | Value |
|-------|-------|
| **Severity** | Low |
| **CWE** | CWE-295 |
| **Location** | `src/core/mcp/McpClient.ts` |
| **Status** | Confirmed |

SSE/HTTP MCP-Verbindungen nutzen Standard-HTTPS, aber kein Mutual TLS. Auth-Headers sind optional.

---

### L-3: Custom Recipes erhoehen Angriffsflaeche (CWE-78)

| Field | Value |
|-------|-------|
| **Severity** | Low |
| **CWE** | CWE-78 |
| **Location** | `src/core/tools/agent/recipeRegistry.ts` (custom recipes via Settings) |
| **Status** | Confirmed |

Custom Recipes in `settings.recipes.customRecipes` erlauben benutzerdefinierte Binary-Aufrufe. Validiert, aber erweiterter Angriffsvektor.

---

### L-4: IgnoreService -- !-Negation nicht unterstuetzt

| Field | Value |
|-------|-------|
| **Severity** | Low |
| **Location** | `src/core/governance/IgnoreService.ts:133` |
| **Status** | Confirmed |

Negation-Patterns (!important.md) in .obsidian-agentignore werden still uebersprungen. Koennte User-Erwartungen brechen.

---

### L-5: dangerouslyAllowBrowser: true auf SDK Clients

| Field | Value |
|-------|-------|
| **Severity** | Info |
| **Location** | `src/api/providers/anthropic.ts:25`, `src/api/providers/openai.ts:122` |
| **Status** | False Positive |

Erforderlich und korrekt fuer Obsidians Electron Renderer. Kein Sicherheitsrisiko.

---

### L-6: pdf-parse@1.1.1 -- Unmaintained Dependency

| Field | Value |
|-------|-------|
| **Severity** | Low |
| **Location** | package.json |
| **Status** | Confirmed |

Letzte Veroeffentlichung ca. 2020. Ein einzelner Maintainer. Bringt @mapbox/node-pre-gyp und tar als transitive Dependencies mit, die die npm-audit High-Findings verursachen.

---

### I-1: OperationLogger Sanitization

| Field | Value |
|-------|-------|
| **Severity** | Info |
| **Status** | Positive Finding |

OperationLogger.sanitizeParams() redaktiert sensitive Keys, truncated Content, und stripped URL-Credentials. Vorbildliche Implementierung.

---

### I-2: Circuit Breaker im SandboxBridge

| Field | Value |
|-------|-------|
| **Severity** | Info |
| **Status** | Positive Finding |

SandboxBridge implementiert Circuit Breaker (20 konsekutive Fehler -> Bridge deaktiviert). Verhindert Endlos-Schleifen bei fehlerhaftem Sandbox-Code.

---

## Positive Findings

Bereits gut umgesetzt -- diese Massnahmen sind vorbildlich:

| Massnahme | Implementierung | Bewertung |
|-----------|----------------|-----------|
| API-Key-Verschluesselung | SafeStorageService via macOS Keychain (Electron safeStorage) | Exzellent |
| Path-Traversal-Schutz | SandboxBridge.validateVaultPath(), GlobalFileService.resolvePath() | Gut (behoben) |
| Fail-Closed Default | ToolExecutionPipeline verweigert Writes ohne Approval-Callback | Exzellent |
| Self-Modify Approval | manage_source/manage_skill IMMER manuell (keine Auto-Approval Bypass) | Exzellent |
| Shell-Execution (7 Schichten) | Recipe-System: Master-Toggle, Per-Recipe-Toggle, Param-Validierung, shell:false, Approval, Process-Confinement, Audit | Exzellent |
| SSRF-Schutz | Private-IP-Blocklist, IPv6-Blocklist, Link-Local-Blocklist | Gut |
| Sandbox URL-Allowlist | SandboxBridge: Nur HTTPS, nur whitelisted Domains, keine IPs, keine non-standard Ports | Exzellent |
| ReDoS-Schutz | safeRegex() Utility, IgnoreService-Laengen-Guards | Gut |
| AstValidator | Supplementary Code-Validierung (nicht primaer, aber nuetzlich) | Gut |
| SHA-256 Integrity | EsbuildWasmManager verifiziert CDN-Downloads | Exzellent |
| Operation Logging | JSONL Audit Trail ueber OperationLogger | Gut |
| Checkpoint-System | isomorphic-git Snapshots vor jedem Write | Exzellent |
| event.source-Pruefung | SandboxExecutor validiert Message-Herkunft | Gut (behoben) |
| CSP auf Sandbox | default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' | Gut |
| Prototype Pollution Guard | SandboxBridge.hasPollutionKeys() prueft __proto__/constructor/prototype | Gut |
| Rate Limiting | SandboxBridge: 10 Writes/min, 5 Requests/min | Gut |
| Plugin API Blocklist | BLOCKED_METHODS: execute, executeJs, render, register, etc. | Gut |
| ESLint Security Plugins | eslint-plugin-security, eslint-plugin-no-unsanitized | Gut |
| Kein console.log | Nur console.debug/warn/error (Review-Bot compliant) | Exzellent |
| Kein innerHTML | Nur Obsidian DOM API (createEl, createDiv, appendText) | Exzellent |
| package-lock.json | Vorhanden -- Dependencies gelockt | Gut (behoben) |

---

## Remediation Plan

| Priority | Finding | Remediation | Effort |
|----------|---------|-------------|--------|
| P1 | H-1: Sandbox-Limitation | Enterprise-Doku, Mode-Config fuer Enterprise | M |
| P1 | H-2: npm audit (tar/minimatch) | npm audit fix, pdf-parse ersetzen | S/M |
| P1 | H-3: Prompt Injection bei permissive | permissive als High-Risk dokumentieren, Enterprise-Preset | S |
| P2 | M-1: Skill trigger ReDoS | safeRegex() in ManageSkillTool.ts | S |
| P2 | M-2: DNS-Rebinding | Dokumentation + IP-Pruefung nach Resolution | M |
| P2 | M-3: DeleteFileTool vault.trash | fileManager.trashFile() | S |
| P2 | M-4: vault.delete() intern | fileManager.trashFile() an 4 Stellen | S |
| P2 | M-5: Package ohne Integrity | Bekannte Hashes mitliefern oder warnen | M |
| P2 | M-6: PII an Cloud-LLMs | Enterprise local-only Setting | M |
| P2 | M-7: manage_source Excessive Agency | Enterprise-Mode ohne manage_source | S |
| P2 | M-8: BackupTab Import Validierung | Schema-Validation vor Settings-Uebernahme | M |
| P2 | M-9: JSON.parse ohne Validierung | Zod/Guards fuer LLM-Responses | M |
| P3 | L-1: SelfAuthoredSkillLoader regex | safeRegex() verwenden | S |
| P3 | L-2: MCP ohne mTLS | Dokumentation | S |
| P3 | L-3: Custom Recipes | Enterprise-Profil-Option | S |
| P3 | L-4: IgnoreService !-Negation | Skip-Warnung loggen | S |
| P3 | L-6: pdf-parse unmaintained | Durch pdfjs-dist ersetzen | M |

---

## Naechste Schritte

Der Security Audit ist abgeschlossen!

1. **Review:** Pruefe den Report auf Vollstaendigkeit
2. **P1 Fixes:** Die High Findings sollten zeitnah behoben werden:
   - npm audit fix fuer die transitiven Dependency-Vulnerabilities
   - Enterprise-Dokumentation fuer Sandbox-Limitation und Prompt-Injection-Risiko
3. **P2 Fixes:** Ins Backlog eintragen
4. **Implementierung:** Wechsle zu normalem Mode fuer die Fixes