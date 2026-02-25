/**
 * SupportPrompts - Quick-Action prompt templates (Sprint 2.3)
 *
 * Provides predefined prompt templates for common Obsidian tasks.
 * Triggered by the ✨ button in the chat toolbar.
 *
 * Adapted from Kilo Code's src/shared/support-prompt.ts (simplified + Obsidian-specific).
 */

export type SupportPromptType = 'ENHANCE' | 'SUMMARIZE' | 'EXPLAIN' | 'FIX';

const TEMPLATES: Record<SupportPromptType, string> = {
    ENHANCE: `Improve and enhance the following prompt. Reply with only the improved prompt — no explanations, lead-in, or surrounding quotes:

\${userInput}`,

    SUMMARIZE: `Summarize the currently active note in a concise, well-structured format.\${activeFileHint}

Please include:
1. A one-sentence TL;DR at the top
2. Key points or sections
3. Any action items or open questions`,

    EXPLAIN: `Explain the currently active note.\${activeFileHint}

Please provide:
1. The overall purpose and context of this note
2. Key concepts and ideas covered
3. How this note connects to related topics`,

    FIX: `Review the currently active note and fix any issues you find.\${activeFileHint}

Please:
1. Correct any factual errors, broken links, or formatting problems
2. Improve clarity where needed
3. Note what was changed and why`,
};

export interface SupportPromptParams {
    userInput?: string;
    activeFile?: string;
}

/**
 * Generate a support prompt from a template type and parameters.
 */
export function createSupportPrompt(type: SupportPromptType, params: SupportPromptParams): string {
    let template = TEMPLATES[type];
    const activeFileHint = params.activeFile
        ? ` (active file: ${params.activeFile})`
        : '';
    template = template
        .replace(/\${userInput}/g, params.userInput ?? '')
        .replace(/\${activeFileHint}/g, activeFileHint);
    return template.trim();
}

export const SUPPORT_PROMPT_LABELS: Record<SupportPromptType, string> = {
    ENHANCE:   'Improve prompt',
    SUMMARIZE: 'Summarize note',
    EXPLAIN:   'Explain note',
    FIX:       'Fix issues',
};

// ---------------------------------------------------------------------------
// Unified prompt entry for autocomplete + settings display
// ---------------------------------------------------------------------------

export interface PromptEntry {
    id: string;
    name: string;
    /** Slash-command trigger without the leading slash, e.g. "enhance" */
    slug: string;
    /** Raw template text — variables not yet substituted */
    content: string;
    isBuiltIn: boolean;
}

/** Returns the four built-in templates as PromptEntry objects. */
export function getBuiltInPromptEntries(): PromptEntry[] {
    return (Object.keys(SUPPORT_PROMPT_LABELS) as SupportPromptType[]).map((type) => ({
        id: `builtin-${type.toLowerCase()}`,
        name: SUPPORT_PROMPT_LABELS[type],
        slug: type.toLowerCase(),
        content: TEMPLATES[type],
        isBuiltIn: true,
    }));
}

/**
 * Resolve template variables in a prompt template.
 * Handles both built-in syntax (${userInput}, ${activeFileHint})
 * and user-friendly syntax ({{userInput}}, {{activeFile}}).
 */
export function resolvePromptContent(content: string, params: SupportPromptParams): string {
    const activeFileHint = params.activeFile ? ` (active file: ${params.activeFile})` : '';
    return content
        .replace(/\{\{userInput\}\}/g, params.userInput ?? '')
        .replace(/\{\{activeFile\}\}/g, params.activeFile ?? '')
        .replace(/\{activeFile\}/g, params.activeFile ?? '')
        .replace(/\$\{userInput\}/g, params.userInput ?? '')
        .replace(/\$\{activeFileHint\}/g, activeFileHint)
        .trim();
}
