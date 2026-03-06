# Security Audit Report

| Field | Value |
|-------|-------|
| **Project** | Obsilo Agent (Obsidian Plugin) |
| **Date** | 2026-03-04 |
| **Auditor** | Security Auditor Agent |
| **Scan Scope** | Full -- All 6 phases |
| **Risk Rating** | Medium |
| **Languages** | TypeScript (strict) |
| **Runtime** | Electron (Obsidian) |
| **Code** | 189 Dateien, ~45.600 LOC |
| **Dependencies** | 228 prod, 297 dev (539 total) |
| **Previous Audit** | 2026-03-01 (AUDIT-obsilo-2026-03-01.md) |

---

## Executive Summary

| Analysis Domain | Critical | High | Medium | Low | Info |
|-----------------|----------|------|--------|-----|------|
| SAST (CodeQL-equiv.) | 0 | 0 | 2 | 1 | 1 |
| OWASP Top 10 | 0 | 0 | 1 | 1 | 0 |
| OWASP LLM Top 10 | 0 | 1 | 2 | 0 | 0 |
| Zero Trust | 0 | 0 | 0 | 1 | 0 |
| Code Quality | 0 | 0 | 1 | 2 | 1 |
| SCA (Dependencies) | 0 | 0 | 0 | 0 | 0 |
| License Compliance | 0 | 0 | 0 | 0 | 0 |
| **Total** | **0** | **1** | **6** | **5** | **2** |

Signifikante Verbesserung gegenueber dem vorherigen Audit (03/01: 0C/3H/11M/8L/2I -> 03/04: 0C/1H/6M/5L/2I). Die wichtigsten Aenderungen seit dem letzten Audit:
- **ProcessSandboxExecutor** implementiert: OS-Level Prozessisolation via child_process.fork() + vm.createContext(). Behebt das vorherige H-1 (Chromium-Sandbox-Limitierung) auf Desktop.
- **npm audit clean**: Alle Dependency-Vulnerabilities behoben. pdf-parse durch pdfjs-dist ersetzt.
- **Review-Bot-Compliance verbessert**: vault.delete() und vault.trash() ueberall durch fileManager.trashFile() ersetzt.
- **safeRegex() verbreitet**: ManageSkillTool nutzt jetzt safeRegex() fuer Skill-Trigger-Patterns.
- **BackupTab sanitizeSettings()**: Schema-Validierung bei Settings-Import implementiert.

Verbleibendes High-Finding: Prompt Injection bei aktivierter Voll-Auto-Approval (by design, Dokumentation noetig).

### Delta zum vorherigen Audit (2026-03-01)

| Finding (vorher) | Status vorher | Status jetzt | Aenderung |
|-------------------|---------------|--------------|-----------|
| H-1: Chromium-Sandbox-Limitierung | Confirmed | **Mitigated** | ProcessSandboxExecutor liefert OS-Level Isolation auf Desktop |
| H-2: npm audit (tar/minimatch) | Confirmed | **Resolved** | npm audit clean, pdf-parse durch pdfjs-dist ersetzt |
| H-3: Prompt Injection permissive | Confirmed | Confirmed | Unchanged -- Dokumentation weiterhin empfohlen |
| M-1: Skill trigger ReDoS | Confirmed | **Resolved** | safeRegex() in ManageSkillTool.ts:352 |
| M-2: DNS-Rebinding WebFetch | Confirmed | **Improved** | Phase-2 DNS-Resolution + IP-Check implementiert |
| M-3: DeleteFileTool vault.trash | Confirmed | **Resolved** | fileManager.trashFile() in DeleteFileTool.ts:64 |
| M-4: vault.delete() intern | Confirmed | **Resolved** | Alle 7+ Stellen auf fileManager.trashFile() migriert |
| M-5: Package ohne Integrity | Confirmed | **Improved** | SHA-256 Integrity fuer esbuild-wasm; npm-Packages weiterhin offen |
| M-6: PII an Cloud-LLMs | Confirmed | Confirmed | Unchanged -- by design |
| M-7: manage_source Excessive Agency | Confirmed | Confirmed | Unchanged -- by design, Approval required |
| M-8: BackupTab Import Validierung | Confirmed | **Resolved** | sanitizeSettings() implementiert |
| M-9: JSON.parse ohne Validierung | Confirmed | Confirmed | Unchanged -- try/catch vorhanden, aber keine Schema-Validierung |
| L-1: SelfAuthoredSkillLoader regex | Confirmed | Confirmed | Unchanged -- kontrollierte Pattern-Struktur |
| L-2: MCP ohne mTLS | Confirmed | Confirmed | Unchanged |
| L-3: Custom Recipes | Confirmed | Confirmed | Unchanged |
| L-4: IgnoreService !-Negation | Confirmed | Confirmed | Unchanged |
| L-6: pdf-parse unmaintained | Confirmed | **Resolved** | Ersetzt durch pdfjs-dist |

**Neue Findings in diesem Audit:**

| ID | Severity | Titel |
|----|----------|-------|
| M-10 | Medium | ProcessSandboxExecutor uebergibt volles process.env an Worker |
| M-11 | Medium | npm-Packages in Sandbox ohne Integritaetspruefung (Package-Level) |
| L-5 | Low | ContextDisplay.ts nutzt element.style (Review-Bot) |
| L-6 | Low | PostMessage targetOrigin '*' in IframeSandboxExecutor |

---

## Findings (nach Prioritaet)

### P1: Must Fix (Critical + High)

---

### H-1: Prompt Injection bei aktivierter Voll-Auto-Approval (CWE-77)

| Field | Value |
|-------|-------|
| **Severity** | High |
| **CWE** | CWE-77 |
| **Location** | `src/core/tool-execution/ToolExecutionPipeline.ts`, `src/core/prompts/systemPrompt.ts` |
| **Status** | Confirmed -- by design, Dokumentation noetig |
| **Previous** | H-3 im Audit 2026-03-01 -- Unchanged |

**Finding:**
Wenn Auto-Approval auf "permissive" steht (alle Writes auto-approved), koennte ein prompt-injizierter Inhalt (z.B. aus einer via web_fetch geladenen Webseite oder aus einer Vault-Notiz) unkontrolliert Vault-Aenderungen ausloesen.

**Vorhandene Mitigations:**
- Mode-Tool-Filter schraenken verfuegbare Tools ein
- System-Prompt-Boundary separiert User-Input von Instructions
- IgnoreService/ProtectedService blockieren sensitive Pfade
- Checkpoint-System ermoeglicht Rollback
- Consecutive-Mistake-Limit stoppt Endlosschleifen

**Risk:**
Unkontrollierte Vault-Modifikation durch LLM-Prompt-Injection bei auto-approval: permissive.

**Remediation:**
- "permissive" als High-Risk kennzeichnen in UI
- Enterprise-Preset: auto-approval fuer Writes IMMER deaktiviert
- Optional: Heuristic-basierte Warnung nach web_fetch -> write_file Sequenz

---

### P2: Should Fix (Medium)

---

### M-1: ProcessSandboxExecutor uebergibt volles process.env an Worker (CWE-200)

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **CWE** | CWE-200 (Information Exposure) |
| **Location** | `src/core/sandbox/ProcessSandboxExecutor.ts:129` |
| **Status** | Confirmed |
| **Previous** | NEU |

**Finding:**
Der ProcessSandboxExecutor spawnt den Worker-Prozess mit `env: { ...process.env }`, was ALLE Umgebungsvariablen an den Sandbox-Worker weitergibt. Obwohl der Worker via vm.createContext() isoliert ist (kein `process`-Zugriff im Sandbox-Code), erhaelt der Worker-Prozess selbst Zugriff auf alle Env-Vars. Ein Breakout aus dem vm-Context (theoretisch moeglich bei V8-Bugs) wuerde sofort alle Secrets in Umgebungsvariablen exponieren.

Im Kontrast dazu: ExecuteRecipeTool (Z.220-224) uebergibt korrekt nur PATH, HOME und LANG.

**Risk:**
Env-Var-Leakage bei vm-Context-Breakout (API-Keys, Tokens, SSH-Keys in PATH etc.).

**Remediation:**
Ersetze `env: { ...process.env }` durch minimale Env:
```
env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'en_US.UTF-8', NODE_PATH: process.env.NODE_PATH }
```

---

### M-2: npm-Packages in Sandbox ohne Integritaetspruefung (CWE-494)

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **CWE** | CWE-494 (Download of Code Without Integrity Check) |
| **Location** | `src/core/sandbox/EsbuildWasmManager.ts:330-400` |
| **Status** | Confirmed |
| **Previous** | M-5 im Audit 2026-03-01 -- Teilweise verbessert |

**Finding:**
esbuild-wasm-Downloads haben jetzt SHA-256-Integrity-Checks (gut!). Aber `ensurePackage()` laedt npm-Pakete von esm.sh/cdn.jsdelivr.net weiterhin ohne Integritaetspruefung. Die `resolveInternalImports()`-Methode laedt sogar rekursiv Sub-Dependencies (bis Tiefe 5). Diese Pakete laufen im Sandbox-Code.

**Risk:**
CDN-Compromise oder Man-in-the-Middle koennte boeswilligen Code in Sandbox-Ausfuehrungen einschleusen. Sandbox-Bridge mitigiert die Auswirkungen (URL-Allowlist, Rate-Limiting, Path-Validation), aber das Risiko ist nicht eliminiert.

**Remediation:**
- Kurzfristig: User-Warnung beim ersten Package-Download eines unbekannten Pakets
- Mittelfristig: Known-good-Hashes fuer populaere Pakete mitliefern
- Langfristig: npm Registry API fuer SRI-Hashes abfragen und verifizieren

---

### M-3: Vault-Inhalte (potentiell PII) an Cloud-LLMs (CWE-200)

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **CWE** | CWE-200 |
| **Location** | By Design (API Provider Layer) |
| **Status** | Confirmed -- Mitigations vorhanden |
| **Previous** | M-6 im Audit 2026-03-01 -- Unchanged |

**Mitigations vorhanden:** Ollama/LM Studio (lokale Provider) unterstuetzt, .obsidian-agentignore kann sensitive Ordner ausschliessen.

**Remediation:** Enterprise-Setting: Provider auf local-only einschraenken. Data-Classification-Tag im Settings-UI.

---

### M-4: manage_source Excessive Agency (CWE-269)

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **CWE** | CWE-269 |
| **Location** | `src/core/tools/agent/ManageSourceTool.ts` |
| **Status** | Confirmed -- mitigiert durch Approval |
| **Previous** | M-7 im Audit 2026-03-01 -- Unchanged |

**Finding:**
Agent kann eigenen Source-Code lesen, editieren, builden und hot-reloaden. Als self-modify klassifiziert, IMMER manuell genehmigt.

**Remediation:** Enterprise-Mode ohne manage_source im Tool-Set.

---

### M-5: Unvalidierte JSON.parse-Aufrufe auf LLM-Responses (CWE-502)

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **CWE** | CWE-502 |
| **Locations** | `src/core/mastery/RecipePromotionService.ts:124`, `src/core/memory/LongTermExtractor.ts:202`, `src/core/skills/SelfAuthoredSkillLoader.ts:554` |
| **Status** | Confirmed |
| **Previous** | M-9 im Audit 2026-03-01 -- Unchanged |

**Finding:**
LLM-Ausgaben werden via JSON.parse() verarbeitet. try/catch ist vorhanden, aber geparste Objekte werden als typisierte Objekte behandelt ohne Schema-Validierung.

**Remediation:** Zod oder manuelles Schema-Validieren fuer LLM-Responses.

---

### M-6: DNS-Rebinding-Restrisiko in WebFetchTool SSRF-Schutz (CWE-918)

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **CWE** | CWE-918 |
| **Location** | `src/core/tools/web/WebFetchTool.ts:102-142` |
| **Status** | Improved -- dokumentiert, Phase-2-DNS-Check implementiert |
| **Previous** | M-2 im Audit 2026-03-01 -- Verbessert |

**Finding:**
Die SSRF-Pruefung hat jetzt eine zweiphasige Validierung (Hostname-Check + DNS-Resolution + IP-Check). TOCTOU-Risiko bleibt: requestUrl() macht eigene DNS-Resolution. Kommentar im Code dokumentiert dies korrekt.

**Remediation:** Fuer Enterprise: DNS-Pinning oder IP-basierter Connect.

---

### P3: Consider (Low + Info)

---

### L-1: ContextDisplay.ts nutzt element.style (Review-Bot)

| Field | Value |
|-------|-------|
| **Severity** | Low |
| **CWE** | N/A (Review-Bot Compliance) |
| **Location** | `src/ui/sidebar/ContextDisplay.ts:52,55,58,86,89,92,135,139` |
| **Status** | Confirmed |
| **Previous** | NEU |

**Finding:**
ContextDisplay.ts setzt direkt `element.style.display` und `element.style.width` an 8 Stellen.

**Remediation:** CSS-Klassen (agent-u-hidden) fuer display. style.setProperty('width', ...) fuer dynamische Werte.

---

### L-2: PostMessage targetOrigin '*' in IframeSandboxExecutor (CWE-345)

| Field | Value |
|-------|-------|
| **Severity** | Low |
| **CWE** | CWE-345 |
| **Location** | `src/core/sandbox/IframeSandboxExecutor.ts:94,206,214` |
| **Status** | Confirmed -- mitigiert durch event.source-Pruefung |
| **Previous** | NEU |

**Finding:**
PostMessage mit '*' -- technisch notwendig fuer srcdoc-iframes (kein eigener Origin). event.source-Pruefung verhindert Spoofing in Empfangsrichtung.

**Remediation:** Dokumentation als Known Limitation. Keine Code-Aenderung noetig.

---

### L-3: SelfAuthoredSkillLoader.ts new RegExp() (CWE-1333)

| Field | Value |
|-------|-------|
| **Severity** | Low |
| **Location** | `src/core/skills/SelfAuthoredSkillLoader.ts:579,585,591,729` |
| **Status** | Confirmed -- kontrollierte Pattern-Struktur |

---

### L-4: MCP-Verbindungen ohne Mutual TLS (CWE-295)

| Field | Value |
|-------|-------|
| **Severity** | Low |
| **Location** | `src/core/mcp/McpClient.ts` |
| **Status** | Confirmed |

---

### L-5: IgnoreService -- !-Negation nicht unterstuetzt

| Field | Value |
|-------|-------|
| **Severity** | Low |
| **Location** | `src/core/governance/IgnoreService.ts:133` |
| **Status** | Confirmed |

---

### I-1: dangerouslyAllowBrowser auf SDK Clients

| Field | Value |
|-------|-------|
| **Severity** | Info |
| **Status** | False Positive -- erforderlich fuer Electron |

---

### I-2: Kein console.log/console.info in Codebase

| Field | Value |
|-------|-------|
| **Severity** | Info |
| **Status** | Positive Finding -- Review-Bot compliant |

---

## SCA (Dependencies)

### npm audit

```
npm audit: 0 vulnerabilities found
Total dependencies: 539 (228 prod, 297 dev, 38 optional)
```

**Status:** CLEAN.

### License Compliance

```
MIT: 189 | BSD-2-Clause: 14 | ISC: 12 | Apache-2.0: 7
BSD-3-Clause: 4 | MIT+Zlib: 1 | MIT+BSD-3-Clause: 1 | MIT/CC0-1.0: 1
```

**Status:** Alle Lizenzen kompatibel mit Apache-2.0.

---

## Positive Findings

| Massnahme | Bewertung |
|-----------|-----------|
| **OS-Level Sandbox (NEU)**: ProcessSandboxExecutor child_process + vm.createContext + 128MB + 30s | **Exzellent** |
| API-Key-Verschluesselung: SafeStorageService via OS Keychain | Exzellent |
| Path-Traversal-Schutz: SandboxBridge, GlobalFileService, recipeValidator | Exzellent |
| Fail-Closed Default: IgnoreService deny-all, Pipeline deny ohne Callback | Exzellent |
| Self-Modify Approval: manage_source/manage_skill IMMER manuell | Exzellent |
| Shell-Execution (7 Schichten): Toggle, Validation, shell:false, Approval, Confinement, Audit | Exzellent |
| SSRF-Schutz: Two-Phase DNS-Check + Private-IP-Blocklist | Gut+ |
| Sandbox URL-Allowlist: HTTPS-only, whitelisted Domains, no IPs | Exzellent |
| ReDoS-Schutz: safeRegex() verbreitet | Exzellent |
| SHA-256 Integrity (NEU): EsbuildWasmManager CDN-Verification | Exzellent |
| BackupTab Sanitization (NEU): Key-Allowlist, Blocked-Keys, Type-Validation | Gut |
| Checkpoint-System: isomorphic-git Snapshots | Exzellent |
| Prototype Pollution Guard: SandboxBridge.hasPollutionKeys() | Gut |
| Rate Limiting + Circuit Breaker: 10 W/min, 5 R/min, 20-Error Breaker | Gut |
| IPC Message Validation (NEU): isValidWorkerMessage() Type-Guard | Gut |
| Kein innerHTML, kein Vault.delete(), kein console.log | Exzellent |
| npm audit clean: 0 Vulnerabilities | Exzellent |

---

## Remediation Plan

| Priority | Finding | Remediation | Effort | Delta |
|----------|---------|-------------|--------|-------|
| P1 | H-1: Prompt Injection permissive | High-Risk UI-Label, Enterprise-Preset | S | Unchanged |
| P2 | M-1: process.env an Worker | Minimale Env (PATH/HOME/LANG) | S | **NEU** |
| P2 | M-2: Package ohne Integrity | Warnung, Known-Good-Hashes | M | Unchanged |
| P2 | M-3: PII an Cloud-LLMs | Enterprise local-only Setting | M | Unchanged |
| P2 | M-4: manage_source Agency | Enterprise-Mode ohne manage_source | S | Unchanged |
| P2 | M-5: JSON.parse ohne Schema | Zod/Guards fuer LLM-Responses | M | Unchanged |
| P2 | M-6: DNS-Rebinding Restrisiko | Dokumentation (TOCTOU akzeptiert) | S | Verbessert |
| P3 | L-1: ContextDisplay style | CSS-Klassen / style.setProperty() | S | **NEU** |
| P3 | L-2: postMessage '*' | Known Limitation dokumentieren | S | **NEU** |
| P3 | L-3-L-5: Diverse Low | safeRegex, Doku, Warnung | S | Unchanged |
