/**
 * Rules Section
 *
 * Injects user-defined rule files. Wrapped in boundary tags so the
 * model can distinguish user rules from core system instructions.
 */

export function getRulesSection(rulesContent?: string): string {
    if (!rulesContent?.trim()) return '';

    return [
        '',
        '====',
        '',
        'RULES',
        '',
        'The following rules were defined by the user and must always be followed:',
        '',
        '<user_defined_rules>',
        rulesContent.trim(),
        '</user_defined_rules>',
    ].join('\n');
}
