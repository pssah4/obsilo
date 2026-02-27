# Epic: Agentic Core & Interaction Layer
Scope: Production (alle Phasen komplett)
Owner: Product Lead
Status: IMPLEMENTIERT

## Hypothesis
For Obsidian users, a conversational agent with persistent context, modes, and direct tool access will significantly reduce the friction of complex knowledge tasks (e.g., refactoring, synthesis) compared to plugin-switching or manual editing.

## Leading indicators
- Number of multi-step tasks successfully completed via chat.
- User engagement with different modes (Ask, Agent + Custom Modes).

## Implementiert
- Sidebar Chat Interface (History, Input, Autocomplete, Attachments)
- Mode System (Ask + Agent built-in, Custom Modes mit per-Mode Model + MCP Whitelist)
- Tool Execution Framework (37 Tools, 7 Gruppen, ToolExecutionPipeline)
- Context Management (@File Mentions, /Workflow Slash-Commands, VaultFilePicker)
- Multi-Agent Orchestration (new_task, depth guard, mode restriction)
- Context Condensing & Power Steering
- Tool Repetition Detection (sliding window, fuzzy dedup)
- 3-Tier Memory Architecture (Chat History, Session Summaries, Long-Term Memory)
- Agent Skill Mastery (Recipes, Episodic Memory, Auto-Promotion)
- i18n (6 Sprachen)
- Multi-Provider API (Anthropic, OpenAI, Ollama, Azure, OpenRouter, LM Studio, Gemini, Custom)
- MCP Client (stdio, SSE, streamable-HTTP)
- VaultDNA Plugin Discovery + Plugin API Bridge
- Global Storage Architecture (cross-vault Settings)
- SafeStorage (OS Keychain fuer API-Keys)
- Onboarding-Wizard (5-Schritt Setup)

## Out of scope
- Voice interaction
- Multi-modal input (images) in ReadFileTool
- ApplyDiffTool / MultiApplyDiffTool
- Mobile support

## Feature list
| Feature | Priority | Status | Notes |
|---|---|---|---|
| Sidebar Chat & History | P0 | Done | Chat UI, History Panel, Autocomplete |
| Mode System | P0 | Done | Built-in + Custom, per-mode Model |
| Context Injection | P0 | Done | Rules, Skills, Workflows, SupportPrompts |
| Multi-Provider API | P0 | Done | 8 Provider-Typen |
| Multi-Agent | P1 | Done | new_task, sub-agent depth guard |
| Memory System | P1 | Done | 3-Tier, async extraction |
| Skill Mastery | P1 | Done | Recipes, Episodic, Auto-Promotion |
| i18n | P1 | Done | 6 Sprachen, 937 Keys |
| Global Storage | P1 | Done | ~/.obsidian-agent/, Sync Bridge |
