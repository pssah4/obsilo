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
        'Before responding, evaluate the user\'s request against these available skills.',
        'If a skill applies, follow its <instructions> precisely. If no skill applies, proceed with your normal tools and capabilities.',
        '',
        '<available_skills>',
        skillsSection.trim(),
        '</available_skills>',
    ].join('\n');
}
