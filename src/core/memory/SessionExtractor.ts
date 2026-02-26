/**
 * SessionExtractor
 *
 * LLM-based session summary extraction.
 * Takes a conversation transcript and produces a structured Markdown summary
 * saved to memory/sessions/{conversationId}.md.
 *
 * Called by ExtractionQueue when processing a 'session' type item.
 */

import type { CustomModel } from '../../types/settings';
import { buildApiHandlerForModel } from '../../api/index';
import type { MemoryService } from './MemoryService';
import type { ExtractionQueue, PendingExtraction } from './ExtractionQueue';
import type { SemanticIndexService } from '../semantic/SemanticIndexService';

// ---------------------------------------------------------------------------
// Extraction Prompt
// ---------------------------------------------------------------------------

const SESSION_EXTRACTION_PROMPT = `You are a memory extraction assistant. Analyze the following conversation transcript and produce a structured summary in Markdown format.

Extract:
1. **Summary**: What was accomplished in 2-3 sentences
2. **Decisions**: Key decisions made (bullet points)
3. **User Preferences Observed**: Communication style, workflow habits, tool preferences (bullet points)
4. **Task Outcome**: How the task went — was the result satisfactory? Did the user need corrections? (bullet points)
5. **Tool Effectiveness**: Which tools helped, which caused problems, which were unnecessary (bullet points, format: "tool_name: helpful/unhelpful — reason")
6. **Learnings**: What worked well and what should be done differently next time (bullet points)
7. **Open Questions**: Unresolved items or follow-ups (bullet points)

Rules:
- Be concise — the summary should be under 400 words
- Focus on durable facts, not transient details
- For Task Outcome: Look for signals like user corrections, repeated attempts, explicit feedback
- For Tool Effectiveness: Only include tools that were actually used in the conversation
- For Learnings: Focus on actionable insights the agent can apply to future tasks
- If a section has no relevant content, omit it entirely
- If the conversation is purely casual with no actionable content, still provide a brief summary
- Output ONLY the Markdown content (no code fences, no preamble)

Format:
---
conversation: {CONVERSATION_ID}
title: {TITLE}
date: {DATE}
---

## Summary
...

## Decisions
- ...

## User Preferences Observed
- ...

## Task Outcome
- ...

## Tool Effectiveness
- ...

## Learnings
- ...

## Open Questions
- ...`;

// ---------------------------------------------------------------------------
// SessionExtractor
// ---------------------------------------------------------------------------

export class SessionExtractor {
    constructor(
        private memoryService: MemoryService,
        private getMemoryModel: () => CustomModel | null,
        private getAutoUpdateLongTerm: () => boolean,
        private extractionQueue: ExtractionQueue | null,
        private getSemanticIndex: () => SemanticIndexService | null = () => null,
    ) {}

    /**
     * Process a session extraction item from the queue.
     * Makes a single LLM call and saves the result.
     */
    async process(item: PendingExtraction): Promise<void> {
        const model = this.getMemoryModel();
        if (!model) {
            console.warn('[SessionExtractor] No memory model configured, skipping extraction');
            return;
        }

        // Build the prompt with the transcript
        const date = item.queuedAt.slice(0, 10);
        const systemPrompt = SESSION_EXTRACTION_PROMPT
            .replace('{CONVERSATION_ID}', item.conversationId)
            .replace('{TITLE}', item.title)
            .replace('{DATE}', date);

        // Make the LLM call (consume full stream to get text)
        const api = buildApiHandlerForModel(model);
        const stream = api.createMessage(
            systemPrompt,
            [{ role: 'user', content: item.transcript }],
            [], // no tools
        );

        let text = '';
        for await (const chunk of stream) {
            if (chunk.type === 'text') {
                text += chunk.text;
            }
        }

        if (!text.trim()) {
            console.warn('[SessionExtractor] Empty response from LLM, skipping');
            return;
        }

        // Save the session summary
        const summary = text.trim();
        await this.memoryService.writeSessionSummary(item.conversationId, summary);
        console.log(`[SessionExtractor] Saved session summary for ${item.conversationId}`);

        // Index in semantic search (if available) for cross-session retrieval
        const semanticIndex = this.getSemanticIndex();
        if (semanticIndex?.isIndexed) {
            await semanticIndex.indexSessionSummary(item.conversationId, summary).catch((e) =>
                console.warn('[SessionExtractor] Semantic indexing failed (non-fatal):', e)
            );
        }

        // Chain long-term extraction if enabled
        if (this.getAutoUpdateLongTerm() && this.extractionQueue) {
            await this.extractionQueue.enqueue({
                conversationId: item.conversationId,
                transcript: summary, // pass the session summary as transcript for long-term
                title: item.title,
                queuedAt: new Date().toISOString(),
                type: 'long-term',
            });
        }
    }
}
