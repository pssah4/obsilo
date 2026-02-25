# ADR-007: Event Separation — Completion Signals vs. Text Output

**Status:** Accepted
**Date:** 2026-02-20
**Context:** Memory & Chat History Feature (FEATURE-memory-personalization.md)

---

## Context

After implementing the Memory, Chat History & Personalization feature, a regression was identified across multiple LLM providers. The `attempt_completion` tool result was always rendered as user-visible text via `onText()`, causing:

- **GPT-5-mini**: Only showed meta-log text ("Greeted user — available to help") instead of actual answers
- **Sonnet 4.5 / Gemini 3 Pro**: Appended internal log entries to otherwise correct responses
- **GPT-5.2**: Unaffected (happened to stream text before calling attempt_completion)

Additionally, the system prompt contained contradictory rules:
- Rule 1: "Respond directly for Q&A, no tools needed"
- Rule 6: "You MUST ALWAYS call attempt_completion when done"

Models followed Rule 6 literally, calling attempt_completion even for simple greetings, which then polluted the output.

## Decision

Adopt the **Event Separation** pattern: treat completion signals (`attempt_completion`) as internal lifecycle events, separate from user-facing text output.

### Implementation

1. **`hasStreamedText` flag** in `AgentTask.ts`: Tracks whether the model produced any text across all iterations. The completion result is only rendered via `onText()` as a fallback when NO text was streamed (edge case: model that only calls tools and attempt_completion without streaming any text).

2. **System prompt clarification**: Rule 1 strengthened (no tools for Q&A, loop ends automatically). Rule 6 changed to "attempt_completion is ONLY for multi-step tasks that used tools." Response Format section: "Your streamed text IS the response."

3. **AttemptCompletionTool description**: Explicitly states it's only for tool workflows and that the result is a brief internal log entry, never shown to the user.

## Alternatives Considered

### A) Kilo Code Pattern (tool-owned UI)
In Kilo Code, `attempt_completion` owns the completion interaction via `task.say("completion_result")` / `task.ask("completion_result")`. The result NEVER goes through generic `onText()`. This requires a fundamentally different UI architecture with typed message events. Rejected as too invasive for the current codebase.

### B) OpenClaw Pattern (no attempt_completion)
OpenClaw uses discrete lifecycle events (`message_*`, `tool_execution_*`, `agent_end`) and has no attempt_completion tool at all. Text and completion are naturally separate. Rejected because removing attempt_completion would break existing mode configurations and skills that reference it.

### C) Result rendering filter
Always discard the attempt_completion result text. Simple but loses the fallback for models that don't stream text at all (they would produce no output).

## Consequences

- **Positive**: All tested models (GPT-5-mini, GPT-5.2, Sonnet 4.5, Gemini 3 Pro) produce clean output
- **Positive**: Natural loop end works for Q&A (no tools → break), no unnecessary tool calls
- **Positive**: attempt_completion remains available for multi-step workflows where the agent needs to signal completion after tool calls
- **Negative**: Models that ONLY call attempt_completion without streaming any text will show the internal log as output (acceptable edge case)
- **Neutral**: The `hasStreamedText` flag adds minimal state tracking to AgentTask

## References

- Kilo Code: `src/core/assistant-message/presentAssistantMessage.ts` — tool-owned completion UI
- OpenClaw: Event-driven architecture with `message_*` / `tool_execution_*` / `agent_end` events
- Feature Spec: `devprocess/requirements/features/FEATURE-memory-personalization.md`
