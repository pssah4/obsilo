/**
 * OpenAI-shape cache markers (AP3, `passthrough` cache style).
 *
 * ADR-111 decided that the Kilo-Gateway passthrough lives directly in the
 * provider code, and named OpenRouter in its own gap list. This module is that
 * missing producer: it puts Anthropic's `cache_control` markers on content
 * parts of OpenAI-format messages, which is how a gateway that speaks the
 * OpenAI wire format forwards a cache instruction to an Anthropic model.
 *
 * Why it is worth its own file: `anthropicBlocks.ts` owns the Anthropic-native
 * layout and must not be touched (the user's daily runs go through it). The
 * placement rules are the same, the message SHAPE is not, and a shared function
 * over both shapes would be a conditional in the hottest wire-format code in
 * the codebase.
 *
 * The layout, and the one deviation from the Anthropic-native version:
 *
 *  1. System. Split at CACHE_BREAKPOINT_MARKER; only the stable prefix gets a
 *     marker. Everything after the sentinel changes per turn (date, memory,
 *     active skills, vault context) and a marker there would invalidate the
 *     prefix on every request.
 *  2. History, two rolling markers. One on the last message of the history
 *     (advances each turn, so it WRITES the new tail into the cache) and one
 *     STABLE_BACKOFF messages further back (stays put across several turns, so
 *     it is READ). Dropping the second one makes the whole history a
 *     cacheCreate every turn -- IMP-01-04-03, Lever B.
 *
 *     DEVIATION: the search accepts `role: 'tool'` as well as `role: 'user'`.
 *     In Anthropic shape a tool result sits inside a `user` message; in OpenAI
 *     shape `openaiShapeUserBlocks.ts` emits it as its own `role: 'tool'`
 *     message. In an agent loop the last history message is therefore almost
 *     always a tool message, and a user-only search would mark several messages
 *     too early. Kilo Code carries a corrected copy of its own transform for
 *     exactly this reason.
 *
 *  3. Tools get NO marker of their own, and that is a limit of this wire, not
 *     an omission. The OpenAI `tools` array has no `cache_control` slot for a
 *     gateway to translate, so the `attempt_completion` pin from
 *     anthropicBlocks.ts (FIX-PERF-21) cannot be reproduced here. Anthropic
 *     orders the cacheable prefix as tools, then system, then messages, so the
 *     marker on the stable system part already covers the tool list. The
 *     consequence, stated plainly: a tool-list change mid-run invalidates the
 *     prefix on this wire. It happens in practice (57 -> 62 tools in a logged
 *     31-turn run, when find_tool surfaces a deferred tool).
 *
 * Budget: 1 system + 2 history = 3 of Anthropic's 4 allowed breakpoints.
 *
 * Wayfinder: src/ARCHITECTURE.map row "openai-cache-markers".
 */

import { splitSystemPromptAtCacheBreakpoint } from '../../core/systemPrompt';
import type { OpenAIContentPart, OpenAIMessage } from './openaiChat';

/** Anthropic's ephemeral marker, the only cache_control value in use. */
const EPHEMERAL = { type: 'ephemeral' } as const;

/**
 * How far back the stable marker sits, in messages. Same constant and same
 * reasoning as `anthropicBlocks.markRollingHistoryBreakpoints`: far enough that
 * it does not advance with every turn, close enough that it still covers the
 * bulk of the history.
 */
export const STABLE_BACKOFF = 6;

/** Roles that can carry a cache marker: everything the model treats as input. */
const MARKABLE_ROLES = new Set<OpenAIMessage['role']>(['user', 'tool']);

/**
 * Attach a marker to the last text part of a message, lifting string content to
 * a part array first. Returns false when the message offers nothing to mark.
 *
 * Mirrors `anthropicBlocks.markLastBlock`: mark the LAST text part, because the
 * cached prefix has to end after everything the message contributes. A message
 * whose only parts are images gets a tiny zero-width text part appended, the
 * same trick the Anthropic path uses for non-markable trailing blocks.
 */
function markLastTextPart(msg: OpenAIMessage): boolean {
    if (typeof msg.content === 'string') {
        msg.content = [{ type: 'text', text: msg.content, cache_control: EPHEMERAL }];
        return true;
    }
    if (!Array.isArray(msg.content) || msg.content.length === 0) return false;
    const parts: OpenAIContentPart[] = msg.content;
    for (let i = parts.length - 1; i >= 0; i--) {
        const part = parts[i];
        if (part.type === 'text') {
            part.cache_control = EPHEMERAL;
            return true;
        }
    }
    // Image-only message: give the marker something legal to sit on.
    parts.push({ type: 'text', text: '​', cache_control: EPHEMERAL });
    return true;
}

/**
 * Place the passthrough cache markers on an already-converted OpenAI message
 * array, in place.
 *
 * `systemPrompt` is the ORIGINAL rendered prompt, still containing the
 * sentinel. The system message built by `convertToOpenAiChatMessages` has the
 * sentinel stripped (D1) and is replaced wholesale here, so the split point is
 * only ever read from the original.
 */
export function markOpenAiShapeCacheBreakpoints(
    messages: OpenAIMessage[],
    systemPrompt: string,
): void {
    markSystemPrompt(messages, systemPrompt);
    markRollingHistory(messages);
}

function markSystemPrompt(messages: OpenAIMessage[], systemPrompt: string): void {
    const system = messages[0];
    if (!system || system.role !== 'system') return;
    const { stable, volatile } = splitSystemPromptAtCacheBreakpoint(systemPrompt);
    system.content = volatile.trim().length > 0
        ? [
            { type: 'text', text: stable, cache_control: EPHEMERAL },
            { type: 'text', text: volatile },
          ]
        : [{ type: 'text', text: stable, cache_control: EPHEMERAL }];
}

/**
 * Whether a message can carry a marker at all: a markable role plus something
 * to attach to. Empty or null content offers nothing, so the search skips it and
 * keeps looking further back rather than losing the breakpoint.
 */
function isMarkable(msg: OpenAIMessage): boolean {
    if (!MARKABLE_ROLES.has(msg.role)) return false;
    if (typeof msg.content === 'string') return true;
    return Array.isArray(msg.content) && msg.content.length > 0;
}

/**
 * WHICH history messages get a marker: the rolling one plus the stable one
 * STABLE_BACKOFF further back. Index 0 is excluded, that is the system message.
 *
 * Pure and exported because two styles need the same answer and write it
 * differently: `passthrough` puts `cache_control` on a content part,
 * `copilot-cache-control` puts `copilot_cache_control` on the message. Keeping
 * the DECISION in one function is what stops the two from drifting -- a
 * duplicated rule would mean one style silently caching less than the other,
 * and nothing would fail.
 */
export function selectRollingHistoryIndices(messages: OpenAIMessage[]): number[] {
    const selected: number[] = [];
    let last = -1;
    for (let i = messages.length - 1; i >= 1; i--) {
        if (isMarkable(messages[i])) { last = i; break; }
    }
    if (last < 0) return selected;
    selected.push(last);
    for (let i = last - STABLE_BACKOFF; i >= 1; i--) {
        if (isMarkable(messages[i])) { selected.push(i); break; }
    }
    return selected;
}

function markRollingHistory(messages: OpenAIMessage[]): void {
    for (const i of selectRollingHistoryIndices(messages)) markLastTextPart(messages[i]);
}

/**
 * Copilot's own marker form for /chat/completions (AP: IMP-18-01-04).
 *
 * Same selection as {@link markOpenAiShapeCacheBreakpoints}, different field and
 * a different level: `copilot_cache_control` sits on the MESSAGE, not on a
 * content part. Verified against the bundled VS Code Copilot extension, which
 * turns a cache-breakpoint content part into exactly this message-level field.
 *
 * Consequence of the marker being message-level: the volatile tail of the system
 * prompt cannot be an unmarked sibling PART, because the marker would cover the
 * whole message anyway. It gets its own unmarked system MESSAGE instead, right
 * after the marked one, which preserves the ADR-62 order (stable, then volatile,
 * then history) while keeping the tail out of the cached prefix.
 */
export function markCopilotChatCacheBreakpoints(
    messages: OpenAIMessage[],
    systemPrompt: string,
): void {
    // Split first: this can INSERT a message, and the history selection below
    // must run on the final array or its backoff would count the wrong slots.
    const system = messages[0];
    if (system && system.role === 'system') {
        const { stable, volatile } = splitSystemPromptAtCacheBreakpoint(systemPrompt);
        system.content = stable;
        markMessage(system);
        if (volatile.trim().length > 0) {
            messages.splice(1, 0, { role: 'system', content: volatile });
        }
    }
    for (const i of selectRollingHistoryIndices(messages)) markMessage(messages[i]);
}

function markMessage(msg: OpenAIMessage): void {
    msg.copilot_cache_control = EPHEMERAL;
}
