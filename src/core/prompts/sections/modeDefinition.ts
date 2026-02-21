/**
 * Mode Definition Section
 *
 * Injects the active mode's name and role definition.
 */

import type { ModeConfig } from '../../../types/settings';

export function getModeDefinitionSection(mode: ModeConfig): string {
    return [
        '',
        '====',
        '',
        `MODE: ${mode.name.toUpperCase()}`,
        '',
        mode.roleDefinition,
    ].join('\n');
}
