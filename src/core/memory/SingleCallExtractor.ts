/**
 * SingleCallExtractor -- one Tool-Call replaces Session + LongTerm + Conflict.
 *
 * Phase 4 (FEATURE-0318) consolidates the 2-3 LLM calls per
 * memory-eligible conversation into a single structured Tool-Calling
 * round. The output drives the entire write side: SessionsTable
 * (session_summary), Episodes (episode_outcome), FactStore (facts[]
 * with `relation` + `kind`), provisional-edge confirmation
 * (mentions[] from prose plus the synchronous parser pass), and the
 * topic-drift bus (topic_drift_detected).
 *
 * Delta-window mode: when the caller passes `conversationSoFar` and a
 * non-zero startMessageIndex, the prompt switches to "incremental
 * extraction" semantics -- only new facts, refine-hints to existing,
 * and a refreshed conversation summary. Token cost stays linear in
 * the delta, not the conversation length (FEATURE-0318 ASR-3).
 *
 * Constructor-Injection over ApiHandler. No obsidian, no plugin
 * globals.
 *
 * FEATURE-0318 / PLAN-007 task B.1.
 */

import type { ApiHandler, ApiStream, MessageParam } from '../../api/types';
import type { ToolDefinition, ToolName } from '../tools/types';
import { runMeteredCall } from '../pricing/meteredCall';
import type { FactKind } from './FactStore';

export type FactRelation = 'new' | 'update' | 'extend' | 'derive';

const TOOL_NAME = '_memory_single_call' satisfies ToolName;

export interface SingleCallMessage {
    role: 'user' | 'assistant';
    text: string;
    /** Position in the conversation -- delta extraction uses this. */
    index: number;
}

export interface SingleCallInput {
    messages: readonly SingleCallMessage[];
    /** Optional conversation-so-far summary from a previous run (~200 tokens). */
    conversationSoFar?: string;
    /**
     * Currently locked topic from ContextComposer, if any. Helps the
     * LLM detect drift mid-conversation.
     */
    priorTopicLock?: string;
    /** Index of the last message processed in a previous run -- delta-window driver. */
    startMessageIndex?: number;
    /** Cancellation hook -- forwarded to ApiHandler.createMessage. */
    abortSignal?: AbortSignal;
}

export interface FactCandidate {
    text: string;
    topics: string[];
    importance: number;
    kind: FactKind;
    relation: FactRelation;
    rationale?: string;
}

export interface MentionCandidate {
    uri: string;
    label?: string;
    /** Optional kind hint from the LLM ("note", "attachment", "url", ...). */
    kind?: string;
}

export interface ExtractionResult {
    sessionSummary: string;
    episodeOutcome: { success: boolean; resultSummary: string };
    facts: FactCandidate[];
    mentions: MentionCandidate[];
    /**
     * Updated "conversation so far" summary the next delta run will pass
     * back in -- caller persists this on conversation_threads.delta_summary.
     */
    conversationSoFar: string;
    topicDriftDetected: boolean;
    /** Candidates that failed validation, kept for diagnostic UIs. */
    rejected: Array<{ raw: unknown; reason: string }>;
    /** Last message index processed in this run; caller persists for next delta. */
    lastMessageIndex: number;
    /**
     * Token usage if the provider surfaces it; null otherwise.
     *
     * FIX-24-05-09 (D10): `modelId` names the model that served the call. The
     * Memory-v2 budget and MemoryV2Telemetry are a second ledger, and without
     * the id neither of them could price what they were counting -- an
     * extraction on the flagship model and one on a local model read the same.
     */
    usage: { inputTokens: number; outputTokens: number; modelId: string } | null;
}

const ALLOWED_KINDS: ReadonlySet<FactKind> = new Set(['fact', 'preference', 'identity', 'event']);
const ALLOWED_RELATIONS: ReadonlySet<FactRelation> = new Set(['new', 'update', 'extend', 'derive']);

const TOOL_SCHEMA: ToolDefinition = {
    name: TOOL_NAME,
    description:
        'Submit the structured extraction of this conversation. Produce a session summary, ' +
        'an episode outcome, an array of atomic fact candidates with relation + kind, an array of ' +
        'URI mentions, an updated conversation-so-far summary, and a topic-drift signal. ' +
        'Skip facts for smalltalk, hypothetical questions, or filler -- if a statement is not a ' +
        'clear knowledge claim, do not extract it.',
    input_schema: {
        type: 'object',
        properties: {
            session_summary: {
                type: 'string',
                description: 'One-paragraph summary of the conversation as a whole.',
            },
            episode_outcome: {
                type: 'object',
                properties: {
                    success: { type: 'boolean' },
                    result_summary: { type: 'string' },
                },
                required: ['success', 'result_summary'],
            },
            facts: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        text: { type: 'string' },
                        topics: { type: 'array', items: { type: 'string' } },
                        importance: { type: 'number', minimum: 0, maximum: 1 },
                        kind: { type: 'string', enum: ['fact', 'preference', 'identity', 'event'] },
                        relation: { type: 'string', enum: ['new', 'update', 'extend', 'derive'] },
                        rationale: { type: 'string' },
                    },
                    required: ['text', 'topics', 'kind', 'relation'],
                },
            },
            mentions: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        uri: { type: 'string' },
                        label: { type: 'string' },
                        kind: { type: 'string' },
                    },
                    required: ['uri'],
                },
            },
            conversation_so_far: {
                type: 'string',
                description:
                    'Updated ~200 token summary of the conversation. The next delta run gets ' +
                    'this string back as context so we never reprocess the full transcript.',
            },
            topic_drift_detected: {
                type: 'boolean',
                description:
                    'True when the user pivoted to a new topic that differs materially from ' +
                    'the prior topic-lock.',
            },
        },
        required: [
            'session_summary', 'episode_outcome', 'facts', 'mentions',
            'conversation_so_far', 'topic_drift_detected',
        ],
    },
};

const SYSTEM_PROMPT = `You are the memory engine for Vault Operator, an Obsidian-side AI agent.

Given a conversation (or a delta of new messages plus a prior summary), produce ONE
structured tool call that captures everything memory-relevant.

ATOMIC FACT RULE
Each fact is a single self-contained claim. Compound sentences must be split. Preserve
the user's voice -- "Alex prefers Plan-Mode" stays first-person flavoured if the
source is "I prefer Plan-Mode".

KIND
- identity:   defines who the user is (name, role, affiliation, location)
- preference: stable preferences over multiple turns ("prefers X over Y")
- event:      something with a clear time anchor that fades quickly ("watching game tonight")
- fact:       everything else (default)

RELATION (semantic class for the FactIntegrator)
- new:    the claim is fresh, no overlap with anything in memory
- update: corrects or replaces a prior claim ("actually it's Java 11, not 8")
- extend: refines a prior claim without invalidating it ("uses Java 11 with Kotlin too")
- derive: an inferred conclusion drawn from explicit statements (rare; only when warranted)

NOISE FILTER
Do not extract facts from smalltalk ("how are you?"), hypothetical questions
("what if X?"), filler, brainstorming, jokes, or anything that is not a clear
knowledge claim. importance < 0.3 is acceptable for borderline cases; anything
below 0.2 should be omitted entirely.

MENTIONS
Every URI the user mentions in prose belongs in the mentions array, even when the
synchronous parser already picked it up: vault://Notes/X.md, file:///abs/path,
https://example.com, entity://Foo, custom://anything. Add label/kind hints when
context makes them obvious.

CONVERSATION SO FAR
Output a fresh ~200 token narrative summary of the conversation that captures
intent, decisions, and open questions. The next delta run gets this back as context.

TOPIC DRIFT
Set topic_drift_detected=true when the user pivots to a topic that doesn't fit the
prior topic-lock. The read side will refresh its topical-memory block.

ALWAYS respond by calling _memory_single_call with the structured payload. Do not
emit free-form prose alongside the tool call.`;

export class SingleCallExtractor {
    constructor(private readonly api: ApiHandler) {}

    async extract(input: SingleCallInput): Promise<ExtractionResult> {
        const startIdx = input.startMessageIndex ?? 0;
        const slice = input.messages.filter(m => m.index >= startIdx);
        if (slice.length === 0) {
            return emptyResult(startIdx);
        }

        const userMessage: MessageParam = {
            role: 'user',
            content: this.renderUserMessage(input, slice),
        };

        // FIX-24-05-09 (D10): the extraction was already counted, but only into
        // the Memory-v2 budget. Routing it through the shared helper puts it in
        // the same ledger as every other non-loop call, and the helper is where
        // the model id comes from.
        const stream: ApiStream = runMeteredCall(this.api, 'memory-extract', {
            systemPrompt: SYSTEM_PROMPT,
            messages: [userMessage],
            tools: [TOOL_SCHEMA],
            abortSignal: input.abortSignal,
        });

        let toolInput: Record<string, unknown> | null = null;
        let usage: ExtractionResult['usage'] = null;
        for await (const chunk of stream) {
            if (chunk.type === 'tool_use' && chunk.name === TOOL_NAME) {
                toolInput = chunk.input;
            } else if (chunk.type === 'tool_error') {
                throw new Error(`SingleCallExtractor: provider tool_error: ${chunk.error}`);
            } else if (chunk.type === 'usage') {
                usage = {
                    inputTokens: chunk.inputTokens,
                    outputTokens: chunk.outputTokens,
                    // Same precedence the rest of the codebase uses since
                    // FIX-24-05-08: the producer's stamp wins, the handler is
                    // the fallback for a handler built outside the factory.
                    modelId: chunk.modelId ?? this.api.getModel().id,
                };
            }
        }
        if (!toolInput) {
            throw new Error('SingleCallExtractor: provider did not call _memory_single_call');
        }

        const lastMessageIndex = slice.length > 0
            ? Math.max(...slice.map(m => m.index))
            : startIdx;
        return validate(toolInput, usage, lastMessageIndex);
    }

    private renderUserMessage(input: SingleCallInput, slice: readonly SingleCallMessage[]): string {
        const lines: string[] = [];
        if (input.priorTopicLock) {
            lines.push(`Prior topic lock: ${input.priorTopicLock}`);
        }
        if (input.conversationSoFar) {
            lines.push('Conversation so far (summary from previous run):');
            lines.push(input.conversationSoFar);
            lines.push('');
            lines.push('--- New messages since last extraction ---');
        } else {
            lines.push('--- Conversation transcript ---');
        }
        for (const m of slice) {
            lines.push(`[${m.index}] ${m.role}: ${m.text}`);
        }
        lines.push('');
        lines.push('Call _memory_single_call with the structured extraction.');
        return lines.join('\n');
    }
}

function emptyResult(idx: number): ExtractionResult {
    return {
        sessionSummary: '',
        episodeOutcome: { success: true, resultSummary: '' },
        facts: [], mentions: [],
        conversationSoFar: '',
        topicDriftDetected: false,
        rejected: [],
        lastMessageIndex: idx,
        usage: null,
    };
}

function validate(
    raw: Record<string, unknown>,
    usage: ExtractionResult['usage'],
    lastMessageIndex: number,
): ExtractionResult {
    const rejected: ExtractionResult['rejected'] = [];

    const sessionSummary = typeof raw.session_summary === 'string' ? raw.session_summary : '';
    const conversationSoFar = typeof raw.conversation_so_far === 'string' ? raw.conversation_so_far : '';
    const topicDriftDetected = raw.topic_drift_detected === true;

    const eo = isPlainObject(raw.episode_outcome) ? raw.episode_outcome : {};
    const episodeOutcome = {
        success: eo.success === true,
        resultSummary: typeof eo.result_summary === 'string' ? eo.result_summary : '',
    };

    const facts: FactCandidate[] = [];
    const factsRaw = Array.isArray(raw.facts) ? raw.facts : [];
    for (const item of factsRaw) {
        if (!isPlainObject(item)) {
            rejected.push({ raw: item, reason: 'not an object' });
            continue;
        }
        const text = typeof item.text === 'string' ? item.text.trim() : '';
        if (!text) {
            rejected.push({ raw: item, reason: 'text empty' });
            continue;
        }
        const topicsRaw = item.topics;
        if (!Array.isArray(topicsRaw)) {
            rejected.push({ raw: item, reason: 'topics not array' });
            continue;
        }
        const topics = topicsRaw.filter((t): t is string => typeof t === 'string' && t.length > 0);

        const kind = item.kind;
        if (typeof kind !== 'string' || !ALLOWED_KINDS.has(kind as FactKind)) {
            rejected.push({ raw: item, reason: `kind '${String(kind)}' not in enum` });
            continue;
        }
        const relation = item.relation;
        if (typeof relation !== 'string' || !ALLOWED_RELATIONS.has(relation as FactRelation)) {
            rejected.push({ raw: item, reason: `relation '${String(relation)}' not in enum` });
            continue;
        }
        const importanceRaw = item.importance;
        let importance = 0.5;
        if (typeof importanceRaw === 'number' && importanceRaw >= 0 && importanceRaw <= 1) {
            importance = importanceRaw;
        } else if (importanceRaw !== undefined) {
            rejected.push({ raw: item, reason: 'importance out of [0, 1]' });
            continue;
        }
        // Pre-insert noise filter (FEATURE-0318 E3)
        if (importance < 0.2) {
            rejected.push({ raw: item, reason: `importance ${importance} < 0.2 noise floor` });
            continue;
        }
        facts.push({
            text, topics, importance,
            kind: kind as FactKind,
            relation: relation as FactRelation,
            rationale: typeof item.rationale === 'string' ? item.rationale : undefined,
        });
    }

    const mentions: MentionCandidate[] = [];
    const mentionsRaw = Array.isArray(raw.mentions) ? raw.mentions : [];
    for (const item of mentionsRaw) {
        if (!isPlainObject(item)) {
            rejected.push({ raw: item, reason: 'mention not an object' });
            continue;
        }
        const uri = typeof item.uri === 'string' ? item.uri.trim() : '';
        if (!uri) {
            rejected.push({ raw: item, reason: 'mention uri empty' });
            continue;
        }
        mentions.push({
            uri,
            label: typeof item.label === 'string' ? item.label : undefined,
            kind: typeof item.kind === 'string' ? item.kind : undefined,
        });
    }

    return {
        sessionSummary,
        episodeOutcome,
        facts,
        mentions,
        conversationSoFar,
        topicDriftDetected,
        rejected,
        lastMessageIndex,
        usage,
    };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
