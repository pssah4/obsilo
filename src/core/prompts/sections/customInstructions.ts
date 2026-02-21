/**
 * Custom Instructions Section
 *
 * Combines global instructions (applied to all modes) with
 * mode-specific instructions from the user's settings.
 */

export function getCustomInstructionsSection(
    globalCustomInstructions?: string,
    modeCustomInstructions?: string,
): string {
    const hasGlobal = globalCustomInstructions?.trim();
    const hasMode = modeCustomInstructions?.trim();
    if (!hasGlobal && !hasMode) return '';

    const parts: string[] = ['', '====', '', "USER'S CUSTOM INSTRUCTIONS"];
    if (hasGlobal) {
        parts.push('', 'Global Instructions:', globalCustomInstructions!.trim());
    }
    if (hasMode) {
        parts.push('', 'Mode-specific Instructions:', modeCustomInstructions!.trim());
    }
    return parts.join('\n');
}
