# Feature: Core Agent Interaction & Modes
Priority: P0
Related Epic: `requirements/epics/EPIC-core-engine.md`

## Description
The primary interface for Obsidian Agent is a sidebar Chat View where users interact with "Modes" (Agent Personas). Each Mode has access to a specific set of tools and a specific system prompt context, enabling specialized behaviors (e.g., "Architect" for structure, "Writer" for content).

## Benefits Hypothesis
- Modes reduce prompt engineering overhead for users (specialized agents > generic agents).
- Sidebar interaction keeps the user close to their content without blocking the main editor.

## User Stories
- As a user, I want to open a chat sidebar to instruct the agent without leaving my note.
- As a user, I want to switch between "Writer" and "Architect" modes so the agent uses the right tools (content vs. structure).
- As a user, I want to reference my current note context automatically or mention other notes (`@Note`) to give the agent context.
- As a developer, I want to define modes via configuration (prompts + allowed tools).

## Acceptance Criteria
- [ ] **Sidebar UI:** A dedicated view exists in the sidebar that persists across note navigation.
- [ ] **Mode Selector:** Users can select from at least 3 default modes (e.g., Ask, Writer, Architect).
- [ ] **Context Injection:** When a file is active, the agent is aware of its content (or path) if requested.
- [ ] **Mentions:** Typing `@` triggers a file search; selecting a file adds its content/path to the context window.
- [ ] **Chat History:** Conversation history persists within the session (or per note, depending on UX decision - assume session for MVP).
- [ ] **Follow-up Suggestions:** After the agent responds, Obsidian Agent can present 2–4 suggested next prompts.
- [ ] **Task Resume:** Users can resume the last task/session from persisted state.
- [ ] **Tool Call Timeline:** Tool executions are displayed as structured cards in the transcript (tool name + inputs + result summary).

## Success Criteria
- SC-01: User can switch modes in < 2 clicks.
- SC-02: Agent successfully receives context from `@` mentioned files 100% of the time.
- SC-03: Chat interface does not block typing in the main editor.

## NFRs (quantified)
- **Response Latency:** UI acknowledges input immediately (< 100ms); model stream starts within provider limits.
- **Context Limit:** UI warns if selected context exceeds model token limits.

## ASRs
None directly; relies on general tool-use architecture.

## Dependencies
- Obsidian Plugin API (Workspace Leafs).
- Model Provider Integration (BYO-Model).
