/**
 * Explicit Instructions Section
 *
 * Tells the model how to handle <explicit_instructions> tags
 * injected by skills and workflows.
 */

export function getExplicitInstructionsSection(): string {
    return `If the user's message contains <explicit_instructions type="...">...</explicit_instructions>, treat the content inside as mandatory workflow steps. Execute them in order before addressing any other part of the message.`;
}
