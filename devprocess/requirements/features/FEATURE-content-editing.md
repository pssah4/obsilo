# Feature: Controlled Content Editing
Priority: P0
Related Epic: `requirements/epics/EPIC-vault-ops.md`

## Description
Tools specifically designed for granular text manipulation (`edit_file` with search/replace) rather than full-file overwrites. This is critical for modifying long notes without rewriting the entire content (saving tokens and reducing risk).

## Benefits Hypothesis
- Reducing full-file rewrites lowers token costs significantly.
- Minimizes the chance of the LLM "hallucinating" changes in unrelated parts of a long document.

## User Stories
- As a user, I want the agent to only change the specific paragraph I asked about, not reformat my whole document.
- As a user, I want the agent to append a task to my "To Do" list at the bottom of the file.

## Acceptance Criteria
- [ ] **Search & Replace:** A tool exists that takes `original_text` and `replacement_text`. It fails if `original_text` is not unique or not found.
- [ ] **Insertion:** Tools for `append_to_file` or `prepend_to_file`.
- [ ] **Validation:** The system verifies the change was applied correctly (e.g., by reading back the modified section).

## Success Criteria
- SC-01: Edit operations on 5000-line files complete in < 2 seconds.
- SC-02: Accidental modification of surrounding text occurs in < 1% of cases (LLM performance dependent, but tooling should be robust).

## NFRs (quantified)
- **Precision:** The search logic should handle minor whitespace differences if possible (or be strict if safest).

## ASRs
None.

## Dependencies
None.
