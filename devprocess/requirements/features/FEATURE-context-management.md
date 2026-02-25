# Feature: Context Management (Active Files & Tabs)
Priority: P0
Related Epic: `requirements/epics/EPIC-core-engine.md`

## Description
Mechanisms to give the agent awareness of the user's IDE state: currently open tabs, the active file, and explicitly "pinned" context. This mirrors the "Open Editors" concept in VS Code.

## Benefits Hypothesis
- **Relevance:** The agent "sees" what the user is looking at, reducing the need to copy-paste.
- **Multitasking:** The agent can understand relationships between 2-3 open files (e.g., "compare the note on the left with the note on the right").

## User Stories
- As a user, I want the agent to automatically know the content of the file I am currently editing.
- As a user, I want to "Pin" a file to the context so the agent remembers it even if I switch tabs.
- As a user, I want to see a list of "Active Context" files in the chat interface.
- As a user, I want to specifically exclude the current file from context (privacy).

## Acceptance Criteria
- [ ] **Active File Context:** Agent prompt automatically includes the active markdown file's content (unless disabled).
- [ ] **Open Tabs Context:** Agent has access to the *list* of open files (paths) in the workspace.
- [ ] **Context UI:** Visual indicator of what files are currently in the context window.
- [ ] **Token Management:** Smart truncation/warning if open files exceed context window.
- [ ] **Context Condensing:** Obsidian Agent can summarize/condense prior context into a shorter form when approaching model limits, while preserving key constraints and user decisions.
- [ ] **Truncation Transparency:** When content is truncated/condensed, Obsidian Agent shows what was removed and why (at least: “truncated due to token budget”).
- [ ] **Source Types:** Context sources include (where available):
  - active editor content
  - pinned notes/files
  - explicit @-mentions
  - URL content fetched via Browser Tool (when enabled)

## Success Criteria
- SC-01: Agent answers questions about the active file without explicit `@` mention 95% of the time.
- SC-02: Context updates within < 500ms of switching tabs.

## Non-functional requirements (quantified)
- **Efficiency:** Does not re-read file from disk on every keystroke (uses cached editor state).

## Dependencies
- Obsidian Workspace API (`app.workspace.getActiveFile()`).
