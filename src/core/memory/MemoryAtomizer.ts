/**
 * MemoryAtomizer -- LLM-driven splitter that turns a Markdown blob into
 * structured fact candidates ready for FactStore.insert().
 *
 * Used by the Phase-2 migration job (PLAN-005 task 4) to convert the
 * legacy memory MD files (`user-profile.md`, `projects.md`, `patterns.md`,
 * `errors.md`, `custom-tools.md`) into the v2 fact schema. ADR-077 atomic-
 * fact rule: each output is a single self-contained statement; compound
 * sentences are split.
 *
 * The atomizer never writes to the DB itself. It returns FactCandidate[]
 * for the caller to dedup, validate, and insert -- this keeps the LLM
 * call decoupled from persistence side-effects so a re-run after a
 * connection error is safe.
 *
 * Design (PLAN-005 ASR-1): the LLM responds via tool-calling, not free
 * Markdown. The tool schema enforces shape; FactCandidates that fail
 * client-side validation (text, importance, kind enum, topics array)
 * are dropped with a warning instead of crashing the migration.
 *
 * Constructor-Injection only -- no obsidian, no plugin globals (ADR-080).
 *
 * FEATURE-0316 / PLAN-005 task 3.
 */

import type { ApiHandler, ApiStream, MessageParam } from '../../api/types';
import type { ToolDefinition, ToolName } from '../tools/types';
import { runMeteredCall } from '../pricing/meteredCall';
import type { FactKind } from './FactStore';

const ALLOWED_KINDS = new Set<FactKind>(['fact', 'preference', 'identity', 'event']);

const ATOMIZER_TOOL_NAME = '_memory_atomize' satisfies ToolName;

export interface FactCandidate {
    text: string;
    topics: string[];
    importance: number;
    kind: FactKind;
    /** LLM rationale for the split, kept for audit (optional). */
    rationale?: string;
}

export interface AtomizeOptions {
    /** Defaults to 'general'. Used to bias topic suggestions when known. */
    sourceLabel?: string;
    /** Default importance when the LLM omits it (rare). Default 0.5. */
    defaultImportance?: number;
    /** Cancellation hook -- forwarded to ApiHandler.createMessage. */
    abortSignal?: AbortSignal;
}

export interface AtomizeResult {
    candidates: FactCandidate[];
    /** Candidates that failed validation, kept for diagnostic UIs. */
    rejected: Array<{ raw: unknown; reason: string }>;
    /** Raw assistant text emitted alongside the tool call (often empty). */
    assistantText: string;
}

const ATOMIZER_TOOL_SCHEMA: ToolDefinition = {
    name: ATOMIZER_TOOL_NAME,
    description:
        'Submit the atomic facts extracted from the input. Each candidate must be a single ' +
        'self-contained statement. Split compound sentences. Use topics as short lowercase ' +
        'tags (e.g. "tools", "preferences", "identity"). importance in [0, 1]. kind is one of ' +
        'fact | preference | identity | event.',
    input_schema: {
        type: 'object',
        properties: {
            candidates: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        text: { type: 'string' },
                        topics: { type: 'array', items: { type: 'string' } },
                        importance: { type: 'number', minimum: 0, maximum: 1 },
                        kind: {
                            type: 'string',
                            enum: ['fact', 'preference', 'identity', 'event'],
                        },
                        rationale: { type: 'string' },
                    },
                    required: ['text', 'topics', 'kind'],
                },
            },
        },
        required: ['candidates'],
    },
};

const ATOMIZER_SYSTEM_PROMPT = `You convert Markdown notes into atomic memory facts.

RULES:
- Each fact is ONE self-contained statement. Split compound sentences.
- Preserve the speaker's voice. Do not rephrase a preference into a third-person fact unless the source already does.
- topics: 1-3 short lowercase tags. Use established categories ("tools", "preferences", "identity", "projects", "patterns", "errors") when applicable.
- importance: 0.9 = identity-level / critical, 0.7 = stable preference, 0.5 = neutral fact, 0.3 = minor detail.
- kind:
    * "identity" -- facts that define who the user is (name, role, location)
    * "preference" -- stable preferences ("prefers X over Y")
    * "event" -- something that happened with a clear time anchor
    * "fact" -- everything else (default)
- Skip headers, separators, empty bullets, and meta-commentary about the file itself.

Always respond by calling the _memory_atomize tool with the candidates array.`;

export class MemoryAtomizer {
    constructor(private readonly api: ApiHandler) {}

    async atomize(markdown: string, opts: AtomizeOptions = {}): Promise<AtomizeResult> {
        const trimmed = markdown.trim();
        if (trimmed.length === 0) {
            return { candidates: [], rejected: [], assistantText: '' };
        }

        const userMessage: MessageParam = {
            role: 'user',
            content:
                `Source label: ${opts.sourceLabel ?? 'general'}\n\n` +
                `--- BEGIN MARKDOWN ---\n${trimmed}\n--- END MARKDOWN ---\n\n` +
                `Extract every atomic fact and call _memory_atomize. ` +
                `Do not include facts not grounded in the source.`,
        };

        // FIX-24-05-09 (D10): the migration job runs this once per legacy
        // memory file with the whole file in the prompt, and reported nothing.
        const stream: ApiStream = runMeteredCall(this.api, 'memory-atomize', {
            systemPrompt: ATOMIZER_SYSTEM_PROMPT,
            messages: [userMessage],
            tools: [ATOMIZER_TOOL_SCHEMA],
            abortSignal: opts.abortSignal,
        });

        let toolInput: Record<string, unknown> | null = null;
        let assistantText = '';
        for await (const chunk of stream) {
            if (chunk.type === 'tool_use' && chunk.name === ATOMIZER_TOOL_NAME) {
                toolInput = chunk.input;
            } else if (chunk.type === 'text') {
                assistantText += chunk.text;
            } else if (chunk.type === 'tool_error') {
                throw new Error(`MemoryAtomizer: provider returned tool_error: ${chunk.error}`);
            }
        }

        if (!toolInput) {
            throw new Error('MemoryAtomizer: provider did not call _memory_atomize');
        }

        return validateAndCoerce(toolInput, opts.defaultImportance ?? 0.5, assistantText);
    }
}

function validateAndCoerce(
    raw: Record<string, unknown>,
    defaultImportance: number,
    assistantText: string,
): AtomizeResult {
    const candidates: FactCandidate[] = [];
    const rejected: AtomizeResult['rejected'] = [];

    const rawList = raw.candidates;
    if (!Array.isArray(rawList)) {
        return { candidates: [], rejected: [{ raw, reason: 'candidates is not an array' }], assistantText };
    }

    for (const item of rawList) {
        if (!isPlainObject(item)) {
            rejected.push({ raw: item, reason: 'not an object' });
            continue;
        }
        const text = typeof item.text === 'string' ? item.text.trim() : '';
        if (text.length === 0) {
            rejected.push({ raw: item, reason: 'text is empty' });
            continue;
        }
        const topicsRaw = item.topics;
        if (!Array.isArray(topicsRaw)) {
            rejected.push({ raw: item, reason: 'topics is not an array' });
            continue;
        }
        const topics = topicsRaw.filter((t): t is string => typeof t === 'string' && t.length > 0);
        const importanceRaw = item.importance;
        let importance = defaultImportance;
        if (typeof importanceRaw === 'number' && importanceRaw >= 0 && importanceRaw <= 1) {
            importance = importanceRaw;
        } else if (importanceRaw !== undefined) {
            rejected.push({ raw: item, reason: 'importance out of [0, 1]' });
            continue;
        }
        const kindRaw = item.kind;
        if (typeof kindRaw !== 'string' || !ALLOWED_KINDS.has(kindRaw as FactKind)) {
            rejected.push({ raw: item, reason: `kind '${String(kindRaw)}' not in enum` });
            continue;
        }
        const rationale = typeof item.rationale === 'string' ? item.rationale : undefined;
        candidates.push({
            text,
            topics,
            importance,
            kind: kindRaw as FactKind,
            rationale,
        });
    }

    return { candidates, rejected, assistantText };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
