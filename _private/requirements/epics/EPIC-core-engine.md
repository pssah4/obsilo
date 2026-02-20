# Epic: Agentic Core & Interaction Layer
Scope: MVP
Owner: Product Lead

## Hypothesis
For Obsidian users, a conversational agent with persistent context, modes, and direct tool access will significantly reduce the friction of complex knowledge tasks (e.g., refactoring, synthesis) compared to plugin-switching or manual editing.

## Leading indicators
- Number of multi-step tasks successfully completed via chat.
- User engagement with different "Modes" (Architect vs. Code vs. Writer).

## In scope
- Sidebar Chat Interface (History, Input)
- Mode Switching (Agent Personas)
- Tool Execution Framework (Read/Write/System)
- Context Management (Mentions: `@Note`, `@Folder`)

## Out of scope
- Voice interation
- Multi-modal input (images) in V1

## Feature list
| Feature | Priority | Notes |
|---|---|---|
| Sidebar Chat & History | P0 | UI basics |
| Mode System | P0 | Context switching & Toolsets |
| Mention System | P1 | Explicit context injection |
