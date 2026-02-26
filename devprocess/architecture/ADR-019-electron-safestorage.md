# ADR-019: Electron safeStorage fuer API-Key-Verschluesselung

**Status:** Akzeptiert
**Datum:** 2026-02-26
**Entscheider:** Sebastian Hanke

---

## Kontext

API-Keys fuer Chat-Modelle, Embedding-Modelle und Web-Search-Provider werden als Klartext in `data.json` gespeichert (CWE-312). Risikovektoren:
- Vault-Sync (iCloud, Git, Obsidian Sync) exponiert Keys an Cloud-Speicher
- Backup-Dienste erfassen `.obsidian/`-Verzeichnis
- Lokaler Dateizugriff auf geteilten oder kompromittierten Geraeten

Betroffene Felder: `CustomModel.apiKey` (Chat + Embedding), `WebToolsSettings.braveApiKey`, `WebToolsSettings.tavilyApiKey`.

## Optionen

### Option 1: Electron safeStorage (Centralized Intercept)
- Nutzt `require('electron').safeStorage` (OS Keychain)
- Verschluesselung/Entschluesselung an der loadSettings/saveSettings-Grenze
- Verschluesselte Werte als `enc:v1:<base64>` in data.json
- In-Memory immer Klartext — keine Aenderungen an Providern, Tools, UI

### Option 2: keytar / node-keychain
- Separate npm-Dependency fuer OS Keychain-Zugriff
- Nicht in Obsidian's Electron-Runtime vorinstalliert
- Native Bindings benoetigen Rebuild fuer jede Obsidian-Version
- Hoher Wartungsaufwand

### Option 3: Eigene Kryptographie (AES-256-GCM)
- Nutzt Web Crypto API oder Node.js crypto
- Erfordert Master-Passwort oder statischen Schluessel
- Statischer Schluessel: Security through Obscurity (kein echter Schutz)
- Master-Passwort: UX-Overhead bei jedem Plugin-Start

### Option 4: Status quo (Klartext)
- Kein Implementierungsaufwand
- Sicherheitsrisiko bleibt bestehen
- Nicht akzeptabel fuer ein Plugin das API-Keys verwaltet

## Entscheidung

**Option 1 — Electron safeStorage mit Centralized Intercept Pattern**

### Begruendung
- **Kein UX-Overhead**: Verschluesselung ist fuer den Nutzer transparent
- **Keine zusaetzliche Dependency**: `safeStorage` ist Teil von Electron, das in Obsidian bereits enthalten ist
- **OS-Keychain-Sicherheit**: macOS Keychain, Windows DPAPI, Linux libsecret bieten betriebssystemgestuetzte Verschluesselung
- **Minimale Codeaenderungen**: Centralized Intercept erfordert Aenderungen nur in `main.ts` + neuer Service
- **Graceful Degradation**: Auf Plattformen ohne Keychain faellt das System auf Klartext zurueck (aktuelles Verhalten)

### Implementierung

**Neuer Service:** `src/core/security/SafeStorageService.ts`
- `isAvailable()`: Prueft `safeStorage.isEncryptionAvailable()`
- `encrypt(plainText)`: Gibt `enc:v1:<base64>` zurueck
- `decrypt(value)`: Erkennt Praefix, entschluesselt, gibt Klartext zurueck

**Integration in `src/main.ts`:**
- `onload()`: SafeStorageService instanziieren VOR `loadSettings()`
- `loadSettings()`: Nach `loadData()` sofort `decryptSettings()` aufrufen; One-Time-Migration am Ende
- `saveSettings()`: `encryptSettingsForSave()` erstellt Deep-Copy mit verschluesselten Keys

**Invariante:** `this.settings` enthaelt immer Klartext. Nur die an `saveData()` uebergebene Kopie ist verschluesselt.

## Konsequenzen

**Positiv:**
- API-Keys in data.json nicht mehr als Klartext lesbar
- Kein UX-Overhead (kein Passwort, kein zusaetzlicher Schritt)
- Zero Aenderungen an Providern, Tools und Settings-UI
- Automatische Migration bestehender Klartext-Keys

**Negativ:**
- Cross-Device-Sync: Verschluesselte Keys von Geraet A koennen auf Geraet B nicht entschluesselt werden (unterschiedlicher OS-Keychain)
- Plugin-Downgrade: Aeltere Versionen ohne safeStorage-Support sehen `enc:v1:...` statt funktionierender Keys
- Linux ohne Secret Service: Fallback auf Klartext (kein Schutz)
- Nicht 100% sicher: Ein Angreifer mit Zugriff auf den laufenden Obsidian-Prozess kann Keys im Memory lesen

## Referenzen
- [Electron safeStorage API](https://www.electronjs.org/docs/latest/api/safe-storage)
- CWE-312: Cleartext Storage of Sensitive Information
- `devprocess/analysis/04-security-scan.md` (S-05)
