/**
 * OnboardingService
 *
 * Step-based conversational onboarding that guides new users through setup.
 * Steps: backup -> profile -> model -> permissions -> done
 *
 * The service generates step-specific prompts injected into the system prompt
 * so the agent naturally leads the user through configuration.
 */

import type { MemoryService } from './MemoryService';
import type ObsidianAgentPlugin from '../../main';
import type { OnboardingStep } from '../../types/settings';

// ---------------------------------------------------------------------------
// Step order and metadata
// ---------------------------------------------------------------------------

const STEP_ORDER: OnboardingStep[] = ['backup', 'profile', 'model', 'permissions', 'done'];

const STEP_LABELS: Record<OnboardingStep, string> = {
    backup: 'Backup',
    profile: 'Profil',
    model: 'Modell',
    permissions: 'Berechtigungen',
    done: 'Fertig',
};

// ---------------------------------------------------------------------------
// Step-specific prompt fragments
// ---------------------------------------------------------------------------

const STEP_PROMPTS: Record<OnboardingStep, string> = {
    backup: `SETUP STEP 1/4 — WILLKOMMEN & BACKUP

PERSOENLICHKEIT: Du bist Obsilo — freundlich, nahbar, leicht informell. Du sprichst den Nutzer
wie ein hilfsbereiter Begleiter an, nicht wie eine Maschine. Halte den Ton warm und einladend,
aber nicht uebertrieben. Keine Emojis.

AKTION: Schreibe ZUERST eine kurze, persoenliche Willkommensnachricht (2-3 Saetze).
Beispiel-Ton (nicht woertlich kopieren, sei natuerlich):
"Hey, schoen dass du da bist! Ich bin Obsilo — dein persoenlicher Assistent fuer deinen Vault.
Lass uns kurz zusammen alles einrichten, damit ich optimal fuer dich arbeiten kann."

Dann SOFORT ask_followup_question:
  question: "Wie moechtest du starten?"
  options: ["Los geht's — frische Installation", "Ich habe ein Backup zum Importieren"]

NACH ANTWORT:
- "Backup importieren":
  1. SOFORT update_settings action="open_tab", tab="advanced", sub_tab="backup"
     (oeffnet direkt das Backup-Tab fuer den Nutzer)
  2. Schreibe kurz: "Ich habe die Backup-Einstellungen fuer dich geoeffnet. Waehle dort 'Import' und lade deine Backup-Datei."
  3. Dann SOFORT ask_followup_question:
     question: "Hat der Import geklappt?"
     options: ["Ja, hat geklappt", "Nein, weiter ohne Backup"]
- "Los geht's" oder Import fertig:
  1. update_settings action="set", path="onboarding.currentStep", value="profile"
  2. SOFORT WEITER: ask_followup_question:
       question: "Wie soll ich dich ansprechen? Und welche Sprache bevorzugst du?"
       options: ["Deutsch, du", "Deutsch, Sie", "English, casual", "English, formal"]`,

    profile: `SETUP STEP 2/4 — PROFIL

Du lernst den Nutzer kennen. Fuehre 2-3 kurze Fragen nacheinander.
Jede Frage als ask_followup_question mit klickbaren Optionen.

FRAGE-REIHENFOLGE (eine pro Antwort):
1. Falls noch nicht gefragt: ask_followup_question:
   question: "Wie soll ich dich ansprechen? Und welche Sprache bevorzugst du?"
   options: ["Deutsch, du", "Deutsch, Sie", "English, casual", "English, formal"]

2. ask_followup_question (mit allow_multiple: true):
   question: "Wofuer nutzt du deinen Vault? (Mehrfachauswahl moeglich)"
   options: ["Studium", "Arbeit/Beruf", "Persoenliches Wissensmanagement", "Journaling/Tagebuch", "Zettelkasten"]
   allow_multiple: true

3. ask_followup_question:
   question: "Welcher Tonfall passt fuer dich am besten?"
   options: ["Locker und freundlich", "Sachlich und professionell", "Technisch und praezise"]

Nach der letzten Frage:
  1. update_settings action="set", path="onboarding.currentStep", value="model"
  2. SOFORT WEITER: ask_followup_question:
       question: "Hast du bereits einen API-Key fuer ein KI-Modell (Anthropic, OpenAI, Google, etc.)?"
       options: ["Ja, ich habe einen Key", "Nein, ich brauche einen kostenlosen Zugang"]

Die Memory-Extraktion speichert Profil-Infos automatisch. KEIN Tool aufrufen um Profile zu schreiben.`,

    model: `SETUP STEP 3/4 — MODELL

AKTION: Falls noch nicht gefragt, sofort ask_followup_question:
  question: "Hast du bereits einen API-Key fuer ein KI-Modell (Anthropic, OpenAI, Google, etc.)?"
  options: ["Ja, ich habe einen Key", "Nein, ich brauche einen kostenlosen Zugang"]

BEI "Ja, ich habe einen Key":
  1. ask_followup_question:
     question: "Welchen Provider nutzt du?"
     options: ["Anthropic (Claude)", "OpenAI (GPT)", "Google (Gemini)", "Anderer Provider"]
  2. Nach Provider-Wahl: Schreibe "Bitte fuege deinen API-Key hier ein:" (Nutzer tippt ihn in den Chat)
  3. Wenn Key kommt: configure_model action="add" (mit passenden Parametern)
  4. configure_model action="test"
  5. Bei Erfolg: Kurz bestaetigen, dann SOFORT WEITER (siehe unten)

BEI "Nein" / kostenloser Zugang:
  1. Schreibe die folgende Anleitung als sauberes Markdown (genau so formatieren):

     "**Kostenloser API-Key ueber Google Gemini**

     Google bietet mit Gemini einen kostenlosen Zugang zu einem sehr guten KI-Modell.
     So bekommst du deinen Key:

     1. Oeffne die [Google AI Studio API-Key Seite](https://aistudio.google.com/app/apikey)
     2. Melde dich mit deinem Google-Konto an (oder erstelle eins)
     3. Klicke auf **Create API Key**
     4. Kopiere den Key und fuege ihn hier im Chat ein

     > **Hinweis:** Dein Key wird lokal in Obsidian gespeichert. Falls du Cloud-Sync nutzt
     > (iCloud, Obsidian Sync), koennte der Key mit synchronisiert werden."

  2. Dann ask_followup_question:
     question: "Hast du den Key kopiert? Fuege ihn einfach hier im Chat ein."
     options: ["Schritt ueberspringen"]
  3. Wenn Key kommt: configure_model action="add" provider="custom", model_name="gemini-2.5-flash"
  4. configure_model action="test"

NACH ERFOLGREICHEM TEST ODER SKIP:
  1. update_settings action="set", path="onboarding.currentStep", value="permissions"
  2. Kurzer Hinweis: "Modelle kannst du spaeter in den Provider-Einstellungen verwalten."
  3. SOFORT WEITER: ask_followup_question:
     question: "Wie viel Kontrolle moechtest du dem Agent geben?"
     options: ["Freie Hand — Alles automatisch", "Ausgewogen — Lesen erlaubt, Schreiben fragt nach", "Vorsichtig — Alles bestaetigen"]`,

    permissions: `SETUP STEP 4/4 — BERECHTIGUNGEN

AKTION: Falls noch nicht gefragt, sofort ask_followup_question:
  question: "Wie viel Kontrolle moechtest du dem Agent geben?"
  options: ["Freie Hand — Alles automatisch", "Ausgewogen — Lesen erlaubt, Schreiben fragt nach", "Vorsichtig — Alles bestaetigen"]

NACH ANTWORT:
- "Freie Hand": update_settings action="apply_preset", preset="permissive"
- "Ausgewogen": update_settings action="apply_preset", preset="balanced"
- "Vorsichtig": update_settings action="apply_preset", preset="restrictive"

Dann:
  1. update_settings action="set", path="onboarding.currentStep", value="done"
  2. Kurzer Hinweis: "Berechtigungen kannst du spaeter in den Agent-Einstellungen anpassen."
  3. SOFORT WEITER zum Abschluss (siehe done-Step)`,

    done: `SETUP ABGESCHLOSSEN

Fasse kurz zusammen was konfiguriert wurde (Modell, Berechtigungen, Profil-Infos).
Sage dem Nutzer:
- Er kann Einstellungen jederzeit aendern ("Aendere meine Einstellungen")
- Setup kann ueber die Interface-Einstellungen -> "Restart setup" neu gestartet werden
- Er ist jetzt startklar!

Markiere als abgeschlossen:
  update_settings action="set", path="onboarding.completed", value=true`,
};

// ---------------------------------------------------------------------------
// OnboardingService
// ---------------------------------------------------------------------------

export class OnboardingService {
    constructor(
        private memoryService: MemoryService,
        private plugin: ObsidianAgentPlugin,
    ) {}

    /**
     * Check if onboarding is needed.
     * Returns true when setup has not been completed.
     */
    needsOnboarding(): boolean {
        return !this.plugin.settings.onboarding.completed;
    }

    /**
     * Get the current setup step.
     */
    getSetupStep(): OnboardingStep {
        return this.plugin.settings.onboarding.currentStep ?? 'backup';
    }

    /**
     * Get the step index (1-based) for progress display.
     */
    getStepIndex(): number {
        const step = this.getSetupStep();
        const idx = STEP_ORDER.indexOf(step);
        return idx >= 0 ? idx + 1 : 1;
    }

    /**
     * Get total number of steps (excluding 'done').
     */
    getTotalSteps(): number {
        return STEP_ORDER.length - 1; // exclude 'done'
    }

    /**
     * Get human-readable label for the current step.
     */
    getStepLabel(): string {
        return STEP_LABELS[this.getSetupStep()] ?? 'Setup';
    }

    /**
     * Advance to the next step and persist.
     */
    async advanceStep(): Promise<void> {
        const current = this.getSetupStep();
        const idx = STEP_ORDER.indexOf(current);
        if (idx >= 0 && idx < STEP_ORDER.length - 1) {
            this.plugin.settings.onboarding.currentStep = STEP_ORDER[idx + 1];
            await this.plugin.saveSettings();
        }
    }

    /**
     * Mark onboarding as complete.
     */
    async markCompleted(): Promise<void> {
        this.plugin.settings.onboarding.completed = true;
        this.plugin.settings.onboarding.currentStep = 'done';
        await this.plugin.saveSettings();
    }

    /**
     * Reset onboarding to start over.
     */
    async reset(): Promise<void> {
        this.plugin.settings.onboarding.completed = false;
        this.plugin.settings.onboarding.currentStep = 'backup';
        this.plugin.settings.onboarding.skippedSteps = [];
        this.plugin.settings.onboarding.startedAt = '';
        await this.plugin.saveSettings();
    }

    /**
     * Get the onboarding instructions to inject into the system prompt.
     * Returns step-specific instructions, or empty string if onboarding is complete.
     */
    getOnboardingPrompt(): string {
        if (this.plugin.settings.onboarding.completed) {
            return '';
        }

        // Ensure startedAt is set
        if (!this.plugin.settings.onboarding.startedAt) {
            this.plugin.settings.onboarding.startedAt = new Date().toISOString();
            this.plugin.saveSettings();
        }

        const step = this.getSetupStep();
        const stepPrompt = STEP_PROMPTS[step] ?? '';

        if (!stepPrompt) return '';

        return `====== ONBOARDING MODE ======
Du bist im Setup-Modus. Der Nutzer durchlaeuft die Ersteinrichtung.

${stepPrompt}

KRITISCHE REGELN:
1. JEDE deiner Antworten MUSS mit einem ask_followup_question enden (ausser im letzten done-Step).
   Der Nutzer darf NIE ohne klickbare Optionen allein gelassen werden.
2. PARALLELISIERUNG: Rufe update_settings UND ask_followup_question IM SELBEN Turn auf.
   NIEMALS zuerst update_settings allein und dann in einem neuen Turn ask_followup_question.
   Beispiel: Du rufst update_settings auf UND im gleichen Response auch ask_followup_question.
   Das vermeidet unnoetige Wartezeiten fuer den Nutzer.
3. Halte deine Text-Antworten KURZ (1-2 Saetze). Kein Smalltalk, keine Wiederholungen.
   Der Nutzer will schnell durch das Setup kommen.
4. ERLAUBTE Tools: ask_followup_question, update_settings, configure_model, attempt_completion.
5. VERBOTENE Tools: read_file, list_files, search_files, write_file, edit_file, web_search, web_fetch, semantic_search, und alle anderen Vault/Web-Tools.
6. Wenn der Nutzer einen Schritt ueberspringen will: OK, wechsle sofort zum naechsten und stelle dort die erste Frage.
7. Bei themenfremden Fragen: Kurz antworten, dann die aktuelle Setup-Frage nochmals stellen.
8. Antworte in der Sprache des Nutzers (Standard: Deutsch).
====== END ONBOARDING ======`;
    }
}
