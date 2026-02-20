/**
 * OnboardingService
 *
 * First-contact detection and profile bootstrapping.
 * Detects when user-profile.md is empty/template-only and injects
 * onboarding instructions into the system prompt so the agent
 * naturally gathers user information during the first conversation.
 */

import type { MemoryService } from './MemoryService';

// ---------------------------------------------------------------------------
// Onboarding prompt fragment
// ---------------------------------------------------------------------------

const ONBOARDING_INSTRUCTIONS = `ONBOARDING — FIRST CONVERSATION

This is the user's first conversation with you. Their profile is empty.
During this conversation, naturally learn about the user:

1. Their name (how they want to be addressed)
2. Their primary language for conversations
3. How they use their Obsidian vault (personal notes, work, research, journaling, etc.)
4. Their preferred communication style (concise vs. detailed, formal vs. casual)

Do NOT ask all questions at once. Weave them into the conversation naturally.
Do NOT explicitly mention that you are "onboarding" or "building a profile".
Simply be helpful and attentive — the memory system will extract the information automatically after the conversation ends.`;

// ---------------------------------------------------------------------------
// OnboardingService
// ---------------------------------------------------------------------------

export class OnboardingService {
    constructor(private memoryService: MemoryService) {}

    /**
     * Check if onboarding is needed (user-profile.md is empty/template).
     */
    async needsOnboarding(): Promise<boolean> {
        return !(await this.memoryService.hasUserProfile());
    }

    /**
     * Get the onboarding instructions to inject into the system prompt.
     * Returns empty string if onboarding is not needed.
     */
    async getOnboardingPrompt(): Promise<string> {
        if (await this.memoryService.hasUserProfile()) {
            return '';
        }
        return ONBOARDING_INSTRUCTIONS;
    }
}
