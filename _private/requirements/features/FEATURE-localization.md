# FEATURE: Localization (i18n)

**Status:** Planned
**Branch:** `lokalisierung`

---

## Motivation

Alle user-facing Strings im Plugin sind aktuell hardcoded (englisch). Das Plugin soll in denselben Sprachen lokalisiert werden, die auch auf der Website (docs/) unterstuetzt werden. Das erhoecht die Zugaenglichkeit und Konsistenz fuer nicht-englischsprachige Nutzer.

## Zielsprachen

| Code | Sprache | Website-Status |
|------|---------|----------------|
| `en` | English | Vollstaendig (573 Keys) |
| `de` | Deutsch | Vollstaendig (573 Keys) |
| `es` | Espanol | Vollstaendig (573 Keys) |
| `ja` | Japanisch | Vollstaendig (573 Keys) |
| `zh-CN` | Vereinfachtes Chinesisch | Vollstaendig (573 Keys) |
| `hi` | Hindi | Teilweise (97 Keys) |

English ist Fallback-Sprache. Fehlende Keys in anderen Sprachen fallen automatisch auf Englisch zurueck.

## Scope

### In Scope

1. **Alle Settings-Tabs** — Namen, Beschreibungen, Platzhalter, Buttons, Validierungsmeldungen
   - 17 Tabs: Models, Embeddings, Web Search, MCP, Modes, Permissions, Loop, Memory, Rules, Workflows, Skills, Prompts, Interface, Shell, Log, Debug, Backup
   - Tab-Gruppen-Labels: Providers, Agent Behaviour, Vault, Advanced
   - Constants: Tool-Labels, Tool-Beschreibungen, Tool-Gruppen, Provider-Labels

2. **Onboarding/Einstiegsdialog** — Setup-Fortschrittsanzeige, Willkommensnachricht, Setup-Schritte

3. **Hardcoded Meldungen & Nachrichten**
   - Notice-Meldungen (Obsidian.Notice): "Copied to clipboard", "No active file", "Index refreshed" etc.
   - Modal-Dialoge: NewModeModal, CodeImportModal, SystemPromptPreviewModal, ChatHistoryModal
   - Sidebar-UI: ToolPickerPopover, VaultFilePicker, HistoryPanel
   - Validierungsfehler: "Name is required", "Role definition is required"
   - Approval-Cards: Allow / Deny / Enable Always

4. **Sprachauswahl-UI** — Eigener Settings-Tab "Language" mit Dropdown

### Out of Scope

- System-Prompt-Sections (bleiben Englisch — LLM-Instructions)
- Tool-Parameter-Beschreibungen in JSON-Schema (bleiben Englisch — API-facing)
- Log-Eintraege (bleiben Englisch — technisches Format)
- Model-Display-Namen (z.B. "Claude Sonnet 4.5" — Produktnamen)

## Architektur

### Referenz: Kilo Code i18n

Kilo Code nutzt **i18next** mit Namespace-basierten JSON-Files:
```
src/i18n/
  setup.ts          — i18next Init
  index.ts          — Exports: initializeI18n(), changeLanguage(), t()
  locales/
    en/common.json
    en/settings.json
    de/common.json
    de/settings.json
    ...
```

### Adaption fuer Obsidian Agent

Kein i18next (unnoetige Dependency). Stattdessen schlanke eigene Implementierung:

```
src/i18n/
  index.ts          — t(), initI18n(), setLanguage(), getCurrentLanguage()
  types.ts          — TranslationKeys Type, Language Union
  locales/
    en.ts           — Flaches Key-Value Objekt (tree-shakeable)
    de.ts
    es.ts
    ja.ts
    zh-CN.ts
    hi.ts
```

#### Warum kein i18next?
- Plugin-Kontext: Bundle-Groesse ist relevant (Obsidian-Plugin)
- Kein Pluralisierungs-Bedarf (UI-Strings sind Fixtext, keine dynamischen Mengenangaben)
- Kein Namespace-Bedarf (flaches Key-Objekt reicht)
- Interpolation: Einfaches `{{var}}`-Replace reicht

#### Translation-Format

```typescript
// src/i18n/locales/en.ts
export const en: Translations = {
  // Settings - General
  "settings.tab.providers": "Providers",
  "settings.tab.agentBehaviour": "Agent Behaviour",
  "settings.tab.vault": "Vault",
  "settings.tab.advanced": "Advanced",

  // Settings - Models
  "settings.models.apiKey": "API Key",
  "settings.models.apiKeyDesc": "Your API key for authentication.",
  "settings.models.provider": "Provider",

  // Notices
  "notice.copiedToClipboard": "Copied to clipboard",
  "notice.noActiveFile": "No active file",
  "notice.indexRefreshed": "Index refreshed for current file",

  // Onboarding
  "onboarding.welcome": "Welcome to Obsilo Agent!",
  "onboarding.step": "Setup {{current}}/{{total}} — {{name}}",

  // Approval
  "approval.allow": "Allow",
  "approval.deny": "Deny",
  "approval.enableAlways": "Enable Always",

  // ... (vollstaendige Schluessel)
};
```

#### t() Funktion

```typescript
// src/i18n/index.ts
import { en } from './locales/en';
import type { Translations, Language } from './types';

const locales: Record<Language, () => Promise<Translations>> = {
  en: () => Promise.resolve(en),
  de: () => import('./locales/de').then(m => m.de),
  es: () => import('./locales/es').then(m => m.es),
  ja: () => import('./locales/ja').then(m => m.ja),
  'zh-CN': () => import('./locales/zh-CN').then(m => m.zhCN),
  hi: () => import('./locales/hi').then(m => m.hi),
};

let current: Translations = en; // Fallback immer geladen
let currentLang: Language = 'en';

export function t(key: string, vars?: Record<string, string | number>): string {
  let text = current[key] ?? en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(`{{${k}}}`, String(v));
    }
  }
  return text;
}

export async function setLanguage(lang: Language): Promise<void> {
  const loader = locales[lang];
  if (loader) {
    current = await loader();
    currentLang = lang;
  }
}

export function getCurrentLanguage(): Language {
  return currentLang;
}

export async function initI18n(lang: Language): Promise<void> {
  await setLanguage(lang);
}
```

### Language-Setting

```typescript
// In settings.ts
interface ObsiloSettings {
  // ... bestehende Settings
  language: Language; // Default: 'en'
}
```

Gespeichert via `plugin.saveData()` (wie alle anderen Settings).

### Language-Tab

Eigener Tab in Settings, Position: letzter Tab in der "Advanced"-Gruppe (nach Backup).

- **Dropdown**: Alle 6 Sprachen mit nativem Namen
  - English, Deutsch, Espanol, Japanese, Simplified Chinese, Hindi
- **Hinweis**: "Restart may be required for all changes to take effect."
- **Kein Auto-Detect**: Bewusste Entscheidung — Obsidian hat kein zuverlaessiges Locale-API. Nutzer waehlt explizit.

## UI-Sprach-Dropdown-Werte

```typescript
export const LANGUAGES: Record<Language, string> = {
  en: 'English',
  de: 'Deutsch',
  es: 'Espanol',
  ja: 'Japanese',
  'zh-CN': 'Simplified Chinese',
  hi: 'Hindi',
};
```

## Betroffene Dateien (nach Kategorie)

### Settings-Tabs (17 Dateien)
- `src/ui/settings/ModelsTab.ts`
- `src/ui/settings/EmbeddingsTab.ts`
- `src/ui/settings/WebSearchTab.ts`
- `src/ui/settings/McpTab.ts`
- `src/ui/settings/ModesTab.ts`
- `src/ui/settings/PermissionsTab.ts`
- `src/ui/settings/LoopTab.ts`
- `src/ui/settings/MemoryTab.ts`
- `src/ui/settings/RulesTab.ts`
- `src/ui/settings/WorkflowsTab.ts`
- `src/ui/settings/SkillsTab.ts`
- `src/ui/settings/PromptsTab.ts`
- `src/ui/settings/InterfaceTab.ts`
- `src/ui/settings/ShellTab.ts`
- `src/ui/settings/LogTab.ts`
- `src/ui/settings/DebugTab.ts`
- `src/ui/settings/BackupTab.ts`

### Settings-Infrastruktur
- `src/ui/AgentSettingsTab.ts` — Tab-Gruppen-Labels
- `src/ui/settings/constants.ts` — Tool-Labels, Provider-Labels, Tool-Group-Labels

### Chat-UI
- `src/ui/AgentSidebarView.ts` — Approval-Cards, Undo-Bar, Token-Footer, Notices
- `src/ui/sidebar/ToolPickerPopover.ts` — Filter, Labels
- `src/ui/sidebar/VaultFilePicker.ts` — Platzhalter, Buttons
- `src/ui/sidebar/HistoryPanel.ts` — Suche, Gruppierung
- `src/ui/sidebar/AttachmentHandler.ts` — Attachment-Labels

### Modals
- `src/ui/settings/NewModeModal.ts`
- `src/ui/settings/ModelConfigModal.ts`
- `src/ui/settings/CodeImportModal.ts`
- `src/ui/settings/SystemPromptPreviewModal.ts`
- `src/ui/ChatHistoryModal.ts`
- `src/ui/ApproveEditModal.ts`

### Neue Dateien
- `src/i18n/index.ts` — t(), setLanguage(), initI18n()
- `src/i18n/types.ts` — Language, Translations
- `src/i18n/locales/en.ts`
- `src/i18n/locales/de.ts`
- `src/i18n/locales/es.ts`
- `src/i18n/locales/ja.ts`
- `src/i18n/locales/zh-CN.ts`
- `src/i18n/locales/hi.ts`
- `src/ui/settings/LanguageTab.ts`

## Implementierungshinweise

### Phase 1: Infrastruktur
1. `src/i18n/types.ts` erstellen — `Language` Union Type, `Translations` Record-Type
2. `src/i18n/locales/en.ts` erstellen — Alle englischen Strings extrahieren, flacher Key-Value-Baum
3. `src/i18n/index.ts` erstellen — `t()`, `setLanguage()`, `initI18n()`, lazy-load fuer Nicht-EN
4. `Language`-Setting in `settings.ts` hinzufuegen (Default: `'en'`)
5. `initI18n(settings.language)` in `main.ts` beim Plugin-Load aufrufen

### Phase 2: Settings-Tabs migrieren
1. Systematisch jeden Settings-Tab durchgehen
2. Alle `.setName('...')`, `.setDesc('...')`, `.setPlaceholder('...')` durch `t('key')` ersetzen
3. `constants.ts` — Tool-Labels, Provider-Labels, Tool-Group-Labels mit `t()` wrappen
4. `AgentSettingsTab.ts` — Tab-Gruppen-Labels migrieren
5. Neuen `LanguageTab.ts` erstellen und in Settings-Tab-Reihenfolge einfuegen

### Phase 3: Chat-UI & Modals migrieren
1. `AgentSidebarView.ts` — Alle hardcoded Strings durch `t()` ersetzen
2. Sidebar-Komponenten: ToolPickerPopover, VaultFilePicker, HistoryPanel
3. Alle Modal-Dialoge migrieren
4. Obsidian.Notice-Aufrufe durchgehen

### Phase 4: Uebersetzungen erstellen
1. Vollstaendige `en.ts` validieren (alle Keys vorhanden)
2. `de.ts` manuell oder LLM-gestuetzt uebersetzen
3. `es.ts`, `ja.ts`, `zh-CN.ts`, `hi.ts` uebersetzen
4. Fehlende Keys in `hi.ts` bewusst lueckenhaft lassen (Fallback auf EN)

### Phase 5: Integration & Test
1. Sprachauswahl testen: Wechsel DE -> EN -> JA
2. Alle Settings-Tabs auf vollstaendige Lokalisierung pruefen
3. Alle Notices/Modals pruefen
4. Bundle-Groesse messen (Lazy-Load validieren)

### Wichtige Patterns

**String-Extraktion:**
```typescript
// Vorher:
setting.setName('Enable semantic index');
setting.setDesc('Lets the agent find relevant notes by meaning.');

// Nachher:
setting.setName(t('settings.embeddings.enableIndex'));
setting.setDesc(t('settings.embeddings.enableIndexDesc'));
```

**Dynamische Strings:**
```typescript
// Vorher:
new Notice(`Index refreshed: ${count} files`);

// Nachher:
new Notice(t('notice.indexRefreshed', { count }));
```

**Key-Konvention:**
```
settings.{tab}.{element}          — Settings
settings.{tab}.{element}Desc      — Setting-Beschreibung
notice.{action}                    — Obsidian.Notice
modal.{modal}.{element}           — Modal-Dialoge
approval.{action}                  — Approval-Cards
onboarding.{step}                  — Onboarding
ui.{component}.{element}          — Sonstige UI
```

### Risiken & Mitigationen

| Risiko | Mitigation |
|--------|-----------|
| Bundle-Groesse durch 6 Locale-Dateien | Lazy-Load fuer Nicht-EN; EN immer eingebettet |
| Fehlende Uebersetzungen | Automatischer Fallback auf EN via `en[key] ?? key` |
| Obsidian-Setting-Rendering (setName/setDesc sind synchron) | `initI18n()` ist async, muss vor Settings-Tab-Render fertig sein — in `onload()` awaiten |
| String-Laengen variieren (DE laenger als EN) | CSS-Review der Settings-Tabs nach Migration |
