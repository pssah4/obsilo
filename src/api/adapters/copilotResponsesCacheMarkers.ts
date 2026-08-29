/**
 * Copilot cache markers for the Responses route (IMP-18-01-04).
 *
 * Sister module to `openaiShapeCacheMarkers.ts`: same intent, different wire.
 * Kept separate because the Responses body is not a message array with content
 * parts but a mix of `message`, `function_call` and `function_call_output` items,
 * and folding both shapes into one function would put a discriminator in the
 * middle of every placement rule.
 *
 * WHAT THIS ROUTE ACTUALLY DOES TODAY, measured rather than assumed. In one
 * 32-turn gpt-5.6-terra task the reported cacheRead sat at exactly 33,277 tokens
 * for nineteen consecutive turns while fresh input grew from 182 to 88,268, then
 * dropped to 28,555, then to 0. 33,277 is turn 0's total, i.e. the static head.
 *
 * So Copilot caches the static head and NEVER extends it. The documented
 * "automatic breakpoint on the latest message" does not reach our request shape.
 * The growing history is paid at full price every turn, which is where the 51 to
 * 58 percent average comes from -- not from a rolling-only marker as first
 * assumed.
 *
 * WHAT THIS TRANSFORM CAN AND CANNOT FIX, stated plainly:
 *
 *   CAN: stop the head from being invalidated. The volatile tail sits inside
 *   `instructions` today, at the very front, so any change to it kills the whole
 *   cached head. That is the 33,277 -> 28,555 -> 0 collapse above, and the
 *   telemetry shows the tail changing once per task. Moving the tail behind the
 *   breakpoint removes that failure mode.
 *
 *   CANNOT: make the growing history cacheable. A rolling marker needs a
 *   markable item near the end of `input`, and in a tool-driven loop there is
 *   none. AgentLoopEngine pushes tool results as a user message of pure
 *   tool_result blocks, `convertToResponsesInput` turns each into a
 *   `function_call_output`, and that item has an `output` string with no content
 *   parts. A breakpoint can only sit on `input_text` / `input_image` /
 *   `input_file`. The stable-history marker below therefore only lands in
 *   conversations with real user turns, and that is a limit of the wire plus our
 *   history shape, not an omission here.
 *
 * The obvious next lever would be a synthetic markable anchor item. That inserts
 * a visible message into the conversation, so it wants its own measurement
 * before it is worth the risk; it is deliberately not done here.
 *
 * Two structural facts shape the transform:
 *
 *  1. `instructions` is a plain string, and the marker has to sit on a content
 *     block. So the system prompt moves into `input[0]` as a `system`-role
 *     message with parts. This is not an invention: the vendor's own client does
 *     the same (`case ChatRole.System: push({type:"message", role:"system",
 *     content: <parts with breakpoints>})`) and never puts the system prompt in
 *     `instructions` at all.
 *  2. The volatile tail has to land AFTER the breakpoint. Today it sits inside
 *     `instructions`, which precedes everything, so it would be part of the
 *     cached prefix and would invalidate it whenever it changes. The telemetry
 *     shows it changing once per Copilot task.
 *
 * `prompt_cache_options` is deliberately NOT set. The documented default is
 * `implicit`, which keeps Copilot's automatic breakpoint and additionally honours
 * ours. `explicit` would switch the automatic one off, so a bad placement could
 * drop us below the measured 51 percent. There must be no state in which this
 * change makes caching worse.
 *
 * Budget: our two markers plus Copilot's automatic one is three of the four
 * checkpoints the GPT-5.6 models allow.
 *
 * Wayfinder: src/ARCHITECTURE.map row "copilot-cache-markers".
 */

import { splitSystemPromptAtCacheBreakpoint } from '../../core/systemPrompt';
import { STABLE_BACKOFF } from './openaiShapeCacheMarkers';
import type { ResponsesInputItem } from './openaiResponses';

/** The explicit-breakpoint marker, the only value the field takes. */
const BREAKPOINT = { mode: 'explicit' } as const;

/** The subset of the request body this transform rewrites. */
export interface CopilotResponsesBodyParts {
    instructions?: string;
    input: ResponsesInputItem[];
}

/**
 * Move the system prompt into `input` with a breakpoint after its stable prefix,
 * and add one stable breakpoint back in the history. Mutates `body` in place.
 *
 * `systemPrompt` is the ORIGINAL rendered prompt including the sentinel; the
 * split point can only be read from the unstripped string.
 */
export function markCopilotResponsesCacheBreakpoints(
    body: CopilotResponsesBodyParts,
    systemPrompt: string,
): void {
    prependSystemMessage(body, systemPrompt);
    markStableHistoryItem(body.input);
}

function prependSystemMessage(body: CopilotResponsesBodyParts, systemPrompt: string): void {
    const { stable, volatile } = splitSystemPromptAtCacheBreakpoint(systemPrompt);
    const content: Extract<ResponsesInputItem, { type: 'message' }>['content'] = [
        { type: 'input_text', text: stable, prompt_cache_breakpoint: BREAKPOINT },
    ];
    if (volatile.trim().length > 0) {
        content.push({ type: 'input_text', text: volatile });
    }
    body.input.unshift({ type: 'message', role: 'system', content });
    // The prompt now lives in `input`. Leaving `instructions` set would send it
    // twice and pay for it twice.
    delete body.instructions;
}

/**
 * Put the stable marker on a user message STABLE_BACKOFF items back from the end.
 *
 * Only `message` items with an `input_text` part can carry it. In a tool-driven
 * loop that means: nothing after the opening turn (see the file header), so this
 * is a no-op there and the system breakpoint is the whole effect. In a
 * conversation with real user turns it lands and gives the history a stable read
 * point.
 */
function markStableHistoryItem(input: ResponsesInputItem[]): void {
    // Index 0 is the system message just prepended; the search starts after it.
    let last = -1;
    for (let i = input.length - 1; i >= 1; i--) {
        if (isMarkableUserMessage(input[i])) { last = i; break; }
    }
    if (last < 0) return;
    for (let i = last - STABLE_BACKOFF; i >= 1; i--) {
        const item = input[i];
        if (!isMarkableUserMessage(item)) continue;
        for (let p = item.content.length - 1; p >= 0; p--) {
            const part = item.content[p];
            if (part.type === 'input_text') {
                part.prompt_cache_breakpoint = BREAKPOINT;
                return;
            }
        }
    }
}

function isMarkableUserMessage(
    item: ResponsesInputItem,
): item is Extract<ResponsesInputItem, { type: 'message' }> & { role: 'user' } {
    return item.type === 'message'
        && item.role === 'user'
        && item.content.some((p) => p.type === 'input_text');
}
