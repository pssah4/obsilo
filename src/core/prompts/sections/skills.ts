/**
 * Skills Section
 *
 * Injects relevant skills for the current message. Skills are wrapped
 * in boundary tags to separate trusted system metadata from user-defined
 * skill content.
 */

export function getSkillsSection(skillsSection?: string): string {
    if (!skillsSection?.trim()) return '';

    return [
        '',
        '====',
        '',
        'AVAILABLE SKILLS',
        '',
        'The skills below match the current task. Follow the <instructions> of each relevant skill before proceeding.',
        '',
        '<available_skills>',
        skillsSection.trim(),
        '</available_skills>',
    ].join('\n');
}
