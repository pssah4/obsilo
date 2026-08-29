/**
 * SummaryGenerator (FEAT-19-09 wiring helper) -- konkrete LLM-basierte
 * Summary-Generierung als SummaryGeneratorFn-Implementation fuer
 * FrontmatterIndexer.
 *
 * Nutzt den vom Plugin konfigurierten Memory-Model-Key.
 * Trunkiert Note-Content auf max. 8k Zeichen um Token-Kosten zu deckeln.
 */

import type { ApiHandler, MessageParam } from '../../api/types';
import { runMeteredCall } from '../pricing/meteredCall';

const MAX_INPUT_CHARS = 8_000;

export interface BuildSummaryGeneratorOpts {
    /** Multi-Line-Prompt aus Settings (Default = des Nutzers Wortlaut). */
    promptTemplate: string;
    /** Factory: gibt einen ApiHandler oder null wenn Modell fehlt. */
    apiHandlerFactory: () => ApiHandler | null;
    /** Optional: Hard-Cap fuer Tokens pro Generierung (Default 1500). */
    maxTokens?: number;
}

export interface SummaryGenerationResult {
    summary: string;
    modelUsed: string;
}

/** SummaryGeneratorFn-Builder. Returns null wenn keine Modell-Konfig. */
export function buildSummaryGenerator(opts: BuildSummaryGeneratorOpts) {
    return async (input: { notePath: string; content: string }): Promise<SummaryGenerationResult | null> => {
        const handler = opts.apiHandlerFactory();
        if (!handler) {
            console.debug('[SummaryGenerator] no API handler configured, skipping');
            return null;
        }

        const truncated = input.content.length > MAX_INPUT_CHARS
            ? input.content.slice(0, MAX_INPUT_CHARS) + '\n\n[...truncated...]'
            : input.content;

        const userMessage = `Note path: ${input.notePath}\n\nNote content:\n${truncated}\n\nReturn ONLY the summary as a single sentence (max 25 words) written in the same language as the note content. No explanations, no preamble, no quotes.`;
        const messages: MessageParam[] = [{ role: 'user', content: userMessage }];

        try {
            // FIX-24-05-09 (D10): one call per ingested note, and none of them
            // was ever reported. A vault-wide ingest is the single largest
            // unattributed spend the plugin had.
            const stream = runMeteredCall(handler, 'ingest-summary', {
                systemPrompt: opts.promptTemplate,
                messages,
            });
            let collected = '';
            for await (const event of stream) {
                if (event.type === 'text') collected += event.text;
            }
            const summary = collected.trim().split('\n')[0].trim();
            if (!summary) return null;

            const modelUsed = handler.getModel?.()?.id ?? 'unknown';
            return { summary, modelUsed };
        } catch (err) {
            console.warn(`[SummaryGenerator] failed for ${input.notePath}:`, err);
            return null;
        }
    };
}
