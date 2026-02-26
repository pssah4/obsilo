/**
 * LongTermExtractor
 *
 * Promotes durable facts from session summaries into long-term memory files.
 * Takes a session summary (passed as transcript in a 'long-term' PendingExtraction)
 * and merges new information into user-profile.md, projects.md, patterns.md,
 * soul.md (agent personality), and learnings.md (task outcomes & strategies).
 *
 * Called by ExtractionQueue when processing a 'long-term' type item.
 */

import type { CustomModel } from '../../types/settings';
import { buildApiHandlerForModel } from '../../api/index';
import type { MemoryService } from './MemoryService';
import type { PendingExtraction } from './ExtractionQueue';

// ---------------------------------------------------------------------------
// Extraction Prompt
// ---------------------------------------------------------------------------

const LONG_TERM_EXTRACTION_PROMPT = `You are a memory management assistant. You will receive the user's current long-term memory files and a recent session summary.

Your task: Identify NEW information from the session summary that should be stored in the long-term memory files. Only add genuinely new, durable facts — do not duplicate what already exists.

Current memory files:

<user_profile>
{USER_PROFILE}
</user_profile>

<projects>
{PROJECTS}
</projects>

<patterns>
{PATTERNS}
</patterns>

<soul>
{SOUL}
</soul>

<learnings>
{LEARNINGS}
</learnings>

Target files:
- user-profile.md: User identity, preferences, communication style
- projects.md: Active projects, goals, context
- patterns.md: Behavioral patterns, workflow preferences
- soul.md: Agent personality — name, communication style, values, anti-patterns.
  Update soul.md when the session reveals:
  - The user prefers a different tone or response length
  - The user corrects the agent's behavior
  - The user renames the agent
  - New expertise areas or areas to avoid
  Keep soul.md concise and actionable (behaviors, not abstract traits).
- learnings.md: Task learnings — successful strategies, common mistakes, tool effectiveness.
  Update learnings.md when the session reveals:
  - A strategy that worked well (or poorly) for a specific type of task
  - Tools that helped or hindered — with context on when/why
  - User corrections that indicate a recurring mistake pattern
  - Workflow optimizations discovered during the session
  Keep entries actionable: "When doing X, use Y because Z."
  Remove outdated learnings that are contradicted by newer experience.

Rules:
- Only output updates for files that actually need changes
- Never remove existing information unless it is explicitly contradicted
- Keep entries concise — one bullet point per fact
- If the session summary contains no new durable information, output an empty updates array
- Output ONLY valid JSON (no code fences, no preamble)

Output format:
{
  "updates": [
    {
      "file": "user-profile.md" | "projects.md" | "patterns.md" | "soul.md" | "learnings.md",
      "action": "append" | "replace",
      "section": "section heading (e.g. '## Identity', '## Communication')",
      "content": "the new content to add or replace under that section"
    }
  ]
}`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MemoryUpdate {
    file: string;
    action: 'append' | 'replace';
    section: string;
    content: string;
}

interface ExtractionResult {
    updates: MemoryUpdate[];
}

// ---------------------------------------------------------------------------
// LongTermExtractor
// ---------------------------------------------------------------------------

export class LongTermExtractor {
    constructor(
        private memoryService: MemoryService,
        private getMemoryModel: () => CustomModel | null,
    ) {}

    /**
     * Process a long-term extraction item from the queue.
     * Reads current memory files, calls LLM to identify new facts,
     * and applies updates to the appropriate files.
     */
    async process(item: PendingExtraction): Promise<void> {
        const model = this.getMemoryModel();
        if (!model) {
            console.warn('[LongTermExtractor] No memory model configured, skipping');
            return;
        }

        // Load current memory files
        const files = await this.memoryService.loadMemoryFiles();

        // Build the prompt with current state
        const systemPrompt = LONG_TERM_EXTRACTION_PROMPT
            .replace('{USER_PROFILE}', files.userProfile.trim() || '(empty)')
            .replace('{PROJECTS}', files.projects.trim() || '(empty)')
            .replace('{PATTERNS}', files.patterns.trim() || '(empty)')
            .replace('{SOUL}', files.soul.trim() || '(empty)')
            .replace('{LEARNINGS}', files.learnings.trim() || '(empty)');

        // The transcript for long-term items is the session summary
        const userMessage = `Session summary to analyze:\n\n${item.transcript}`;

        // Make the LLM call
        const api = buildApiHandlerForModel(model);
        const stream = api.createMessage(
            systemPrompt,
            [{ role: 'user', content: userMessage }],
            [], // no tools
        );

        let text = '';
        for await (const chunk of stream) {
            if (chunk.type === 'text') {
                text += chunk.text;
            }
        }

        if (!text.trim()) {
            console.warn('[LongTermExtractor] Empty response from LLM, skipping');
            return;
        }

        // Parse the JSON response
        const result = this.parseResponse(text.trim());
        if (!result || result.updates.length === 0) {
            console.log('[LongTermExtractor] No updates needed for', item.conversationId);
            return;
        }

        // Apply updates
        await this.applyUpdates(result.updates);
        console.log(`[LongTermExtractor] Applied ${result.updates.length} updates from ${item.conversationId}`);
    }

    /**
     * Parse the LLM JSON response, tolerant of common formatting issues.
     */
    private parseResponse(text: string): ExtractionResult | null {
        try {
            // Strip markdown code fences if present
            let cleaned = text;
            if (cleaned.startsWith('```')) {
                cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
            }
            const parsed = JSON.parse(cleaned);
            if (!parsed.updates || !Array.isArray(parsed.updates)) {
                console.warn('[LongTermExtractor] Invalid response structure');
                return null;
            }
            // Validate each update
            const valid = parsed.updates.filter((u: MemoryUpdate) =>
                typeof u.file === 'string' &&
                typeof u.content === 'string' &&
                ['user-profile.md', 'projects.md', 'patterns.md', 'soul.md', 'learnings.md'].includes(u.file) &&
                ['append', 'replace'].includes(u.action)
            );
            return { updates: valid };
        } catch (e) {
            console.warn('[LongTermExtractor] Failed to parse LLM response:', e);
            return null;
        }
    }

    /**
     * Apply memory updates to the appropriate files.
     */
    private async applyUpdates(updates: MemoryUpdate[]): Promise<void> {
        for (const update of updates) {
            try {
                const current = await this.memoryService.readFile(update.file);

                if (update.action === 'append') {
                    // Append under the specified section, or at end if section not found
                    const updated = this.appendToSection(current, update.section, update.content);
                    await this.memoryService.writeFile(update.file, updated);
                } else if (update.action === 'replace') {
                    // Replace the content under the specified section
                    const updated = this.replaceSection(current, update.section, update.content);
                    await this.memoryService.writeFile(update.file, updated);
                }
            } catch (e) {
                console.warn(`[LongTermExtractor] Failed to update ${update.file}:`, e);
            }
        }
    }

    /**
     * Append content under a section heading. If the section doesn't exist, append at the end.
     */
    private appendToSection(fileContent: string, section: string, newContent: string): string {
        const sectionIndex = fileContent.indexOf(section);
        if (sectionIndex === -1) {
            // Section not found — append at end with section heading
            return fileContent.trimEnd() + '\n\n' + section + '\n' + newContent + '\n';
        }

        // Find the end of this section (next heading of same or higher level, or EOF)
        const sectionLevel = (section.match(/^#+/) || ['##'])[0].length;
        const afterSection = fileContent.slice(sectionIndex + section.length);
        const nextHeadingMatch = afterSection.match(new RegExp(`\n#{1,${sectionLevel}} `, 'm'));

        if (nextHeadingMatch && nextHeadingMatch.index !== undefined) {
            // Insert before the next heading
            const insertAt = sectionIndex + section.length + nextHeadingMatch.index;
            return (
                fileContent.slice(0, insertAt).trimEnd() +
                '\n' + newContent + '\n' +
                fileContent.slice(insertAt)
            );
        }

        // No next heading — append at end
        return fileContent.trimEnd() + '\n' + newContent + '\n';
    }

    /**
     * Replace the content under a section heading. If the section doesn't exist, append at the end.
     */
    private replaceSection(fileContent: string, section: string, newContent: string): string {
        const sectionIndex = fileContent.indexOf(section);
        if (sectionIndex === -1) {
            return fileContent.trimEnd() + '\n\n' + section + '\n' + newContent + '\n';
        }

        const sectionLevel = (section.match(/^#+/) || ['##'])[0].length;
        const afterSection = fileContent.slice(sectionIndex + section.length);
        const nextHeadingMatch = afterSection.match(new RegExp(`\n#{1,${sectionLevel}} `, 'm'));

        if (nextHeadingMatch && nextHeadingMatch.index !== undefined) {
            const endAt = sectionIndex + section.length + nextHeadingMatch.index;
            return (
                fileContent.slice(0, sectionIndex) +
                section + '\n' + newContent + '\n' +
                fileContent.slice(endAt)
            );
        }

        // No next heading — replace to end
        return fileContent.slice(0, sectionIndex) + section + '\n' + newContent + '\n';
    }
}
