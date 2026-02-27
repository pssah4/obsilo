# ADR-008: Modular Prompt Sections & Central Tool Metadata

**Status:** Accepted
**Date:** 2026-02-21
**Context:** System Prompt Refactoring (FEATURE-modular-system-prompt.md, FEATURE-tool-metadata-registry.md)

---

## Context

The system prompt is the single most important configuration artifact in Obsilo — it shapes every LLM response. By Phase D completion, the prompt had grown to ~300 lines of inline constants in `systemPrompt.ts`, with tool descriptions duplicated between the prompt builder and the ToolPickerPopover UI.

Three specific problems motivated this decision:

1. **Monolithic prompt file**: Adding or modifying a section (e.g., adding capabilities) required navigating a 300-line file with interleaved static content, dynamic generation, and conditional logic. Review and testing of individual sections was impractical.

2. **Tool description drift**: Tool names, signatures, and descriptions were maintained independently in `systemPrompt.ts` (for the LLM) and `ToolPickerPopover.ts` (for the UI). These diverged silently — a renamed tool or updated description in one location was easily missed in the other.

3. **Missing prompt engineering sections**: Kilo Code's prompt architecture includes Objective (task decomposition strategy) and Capabilities (agent self-model) sections. Obsilo's original prompt lacked both, resulting in less structured multi-step behavior.

## Decision

### Part 1: Modular Section Architecture

Decompose the system prompt into 15 independent section modules in `src/core/prompts/sections/`. Each section is a pure function (`get{Name}Section(params?) → string`) with no side effects and no dependency on the plugin or app context. The orchestrator (`buildSystemPromptForMode` in `systemPrompt.ts`) imports all sections and assembles them in a defined order.

### Part 2: Central Tool Metadata Registry

Create `src/core/tools/toolMetadata.ts` as the single source of truth for display-level tool metadata (label, description, icon, signature, group). Both the prompt builder's tools section and the ToolPickerPopover derive their data from this file. The API-level tool schema (`input_schema`) remains in each tool's `getDefinition()` method, serving a different purpose (function calling).

## Alternatives Considered

### A) Dynamic section registry
A `SectionRegistry` class where sections register themselves at runtime, similar to `ToolRegistry`. Would allow plugins or extensions to add prompt sections dynamically. Rejected because: the prompt section order is critical for LLM behavior and must be explicitly controlled. A dynamic registry would make the final prompt composition non-obvious and harder to reason about.

### B) Template-based prompt (Handlebars / Mustache)
Store the prompt skeleton as a template file with `{{section}}` placeholders. Rejected because: templates add a layer of indirection without real benefit — the current pure-function approach is equally readable, provides TypeScript type safety, and supports conditional logic without template syntax.

### C) Keep duplication, add linting
Keep tool descriptions separate in prompt and UI, but add a CI check that validates they match. Rejected because: this treats the symptom (drift detection) rather than the cause (duplication). A single source of truth eliminates the problem structurally.

### D) Merge all metadata into tool classes
Move display metadata (label, icon, description) into each `*Tool.ts` class alongside `getDefinition()`. The prompt builder and UI would read from tool instances. Rejected because: it would couple display concerns to tool execution classes, and would require instantiating all tools just to build the prompt or render the UI. The metadata registry is intentionally separate and static.

## Consequences

### Positive
- **Single-section changes**: Modifying one prompt section (e.g., updating objective rules) is a change to one small file, not a 300-line monolith
- **Deterministic composition**: The orchestrator makes the full section order visible in one place (~30 lines)
- **No drift**: Tool descriptions are maintained once in `toolMetadata.ts` and consumed by both prompt and UI
- **Easy to add sections**: Adding a new section = create function file + add one line to orchestrator + one line to index.ts
- **Testable**: Each section is a pure function that can be unit-tested in isolation
- **Kilo Code parity**: Objective and Capabilities sections bring prompt engineering quality in line with reference

### Negative
- **More files**: 15 section files + index + metadata = 17 new files. Increases cognitive load for first-time readers navigating the prompt
- **Indirection**: To understand the full prompt, you must read the orchestrator + individual section files. Previously everything was in one file
- **Static imports**: Adding a tool requires editing `toolMetadata.ts` and rebuilding. No dynamic registration (acceptable for internal tools; MCP tools are handled dynamically)

### Neutral
- **No runtime cost**: Section functions are called once per task start. The assembly overhead is negligible
- **API schemas unchanged**: Each tool's `getDefinition()` (used for function calling) is not affected by this change

## References

- Kilo Code: `forked-kilocode/src/core/prompts/` — modular sections architecture (adopted pattern)
- FEATURE-modular-system-prompt.md — full feature spec
- FEATURE-tool-metadata-registry.md — tool metadata spec
- ADR-004-mode-based-tool-filtering.md — related: tool groups filter which tools appear in the prompt
