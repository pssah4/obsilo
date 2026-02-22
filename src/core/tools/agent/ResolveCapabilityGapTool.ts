/**
 * ResolveCapabilityGapTool — Check if a disabled or archived plugin could help (PAS-1)
 *
 * Wraps the CapabilityGapResolver for use as a tool the agent can call
 * when no active skill matches the user's request.
 */

import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';

export class ResolveCapabilityGapTool extends BaseTool<'resolve_capability_gap'> {
    readonly name = 'resolve_capability_gap' as const;
    readonly isWriteOperation = false; // Read-only: just checks vault-dna.json

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'resolve_capability_gap',
            description:
                'Check if a disabled or previously installed Obsidian plugin could handle a capability the user needs. ' +
                'Use this when no active skill matches the request. Returns whether a matching plugin exists and its status.',
            input_schema: {
                type: 'object',
                properties: {
                    capability: {
                        type: 'string',
                        description:
                            'A short description of the needed capability (e.g., "kanban board", "dataview query", "calendar view").',
                    },
                    context: {
                        type: 'string',
                        description: 'Optional additional context about what the user is trying to do.',
                    },
                },
                required: ['capability'],
            },
        };
    }

    async execute(input: Record<string, any>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const capability = (input.capability as string ?? '').trim();

        if (!capability) {
            callbacks.pushToolResult(this.formatError(new Error('capability parameter is required')));
            return;
        }

        try {
            const resolver = (this.plugin as any).capabilityGapResolver;
            if (!resolver) {
                callbacks.pushToolResult(
                    this.formatSuccess(
                        'Plugin capability gap resolution is not available. ' +
                        'The user may need to install a community plugin via Obsidian Settings > Community Plugins.',
                    ),
                );
                return;
            }

            const result = resolver.resolve(capability, input.context);
            callbacks.pushToolResult(this.formatSuccess(result.message));
            callbacks.log(`Capability gap resolved: ${result.found || 'not found'} for "${capability}"`);
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('resolve_capability_gap', error);
        }
    }
}
