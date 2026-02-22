/**
 * Plugin Skills Section — System prompt block for VaultDNA plugin skills (PAS-1)
 *
 * Injects a compact list of active plugin skills + available commands
 * so the agent knows which execute_command IDs are available.
 *
 * Inserted before the manual skills section in the system prompt.
 */

export function getPluginSkillsSection(section?: string): string {
    if (!section?.trim()) return '';

    return '\n====\n\n' + section.trim();
}
