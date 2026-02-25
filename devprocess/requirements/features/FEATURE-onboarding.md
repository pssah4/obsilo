# FEATURE: Conversational Onboarding & Settings-Skill

**Status:** In Progress
**Branch:** `feature/onboarding-setup`

---

## Motivation

Beim ersten Start nach Installation soll der Agent den Nutzer im Chat durch einen gefuehrten Setup-Dialog begleiten (inspiriert von OpenClaw). Ziel: Nutzer ist nach dem Dialog startklar — Modell konfiguriert, Permissions gesetzt, Agent kennt den Nutzer (Memory). Zusaetzlich kann der Nutzer jederzeit per Skill Settings aendern lassen.

## Architektur-Entscheidungen

- **Kein eigener Mode** — Setup laeuft als erweiterter Onboarding-Prompt im bestehenden Agent/Ask Mode
- **Settings-Tool**: Presets (`permissive`/`balanced`/`restrictive`) + granulares `update_settings` Tool
- **Persistenz**: Setup-Fortschritt in `settings.onboarding` gespeichert (ueberlebt Neustart)
- **API-Key**: Unmaskiert im Chat (einfach, Nutzer entscheidet selbst)
- **Presets**: Nur Permissions — Checkpoints, Memory, Semantic Index immer an (Kernfunktionen)
- **Google Gemini Free Tier**: Empfehlung fuer Nutzer ohne API-Keys

## Setup-Flow (5 Schritte)

1. **Backup** — Backup-Import anbieten (Settings -> Advanced -> Backup)
2. **Profil** — Natuerliches Gespraech: Name, Sprache, Tonfall, Interessen, Vault-Zweck -> Memory
3. **Modell** — API-Key Setup oder Google Gemini Free Tier Anleitung
4. **Permissions** — Preset waehlen (Freie Hand / Ausgewogen / Vorsichtig)
5. **Abschluss** — Zusammenfassung, Hinweis auf Settings-Skill

## Neue Tools

### `update_settings`
- Actions: `set` (granular) | `apply_preset` (kategorisch)
- Whitelist erlaubter Pfade (kein Zugriff auf API-Keys)
- Presets aendern nur autoApproval-Flags

### `configure_model`
- Actions: `add` | `select` | `test`
- Einziger Weg API-Keys programmatisch zu setzen
- Test-Action prueft Verbindung mit kurzem API-Call

## Settings-Skill

Datei: `.obsidian-agent/skills/settings-assistant/SKILL.md`
Keywords: settings, einstellungen, konfiguration, setup, permissions, modell, api key
Erlaubt Re-Entry jederzeit per natuerlicher Sprache.

## UI

- Onboarding startet automatisch wenn `!settings.onboarding.completed`
- Fortschrittsanzeige im Header: `Setup 2/5 — Profil`
- Re-Run Button in Settings (Memory Tab)

## Neue Settings

```typescript
interface OnboardingSettings {
    completed: boolean;
    currentStep: 'backup' | 'profile' | 'model' | 'permissions' | 'done';
    skippedSteps: string[];
    startedAt: string;
}
```

## Google Gemini Modelle

- `gemini-2.5-flash` (Free) via OpenAI-kompatiblem Endpoint
- `gemini-2.5-flash-lite` (Free) via OpenAI-kompatiblem Endpoint
- Base URL: `https://generativelanguage.googleapis.com/v1beta/openai`
