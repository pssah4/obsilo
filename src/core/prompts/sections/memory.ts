/**
 * User Memory Section
 *
 * Injected after vault context, before tools. Contains user profile,
 * active projects, and behavioral patterns from the memory system.
 * Only included when memory context is available.
 */

export function getMemorySection(memoryContext?: string): string {
    if (!memoryContext?.trim()) return '';

    return [
        '',
        '====',
        '',
        'USER MEMORY',
        '',
        memoryContext.trim(),
    ].join('\n');
}
