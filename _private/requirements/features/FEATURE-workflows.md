# FEATURE: Workflows & Slash Commands

**Status:** Implemented (replaces old requirements spec)
**Source:** `src/core/context/WorkflowLoader.ts`

## Summary
Reusable workflow templates invoked with a `/slug` prefix in the chat. When a message starts with `/slug`, the matching workflow's content is prepended to the message as explicit mandatory instructions. Workflows can also be forced for a mode (applied to every message).

## How It Works

### Storage
- Directory: `{vault}/.obsidian-agent/workflows/`
- File types: `.md` and `.txt`
- Filename becomes the slug: `daily-standup.md` → `/daily-standup`

### Slug Generation
From filename: lowercase, spaces/underscores replaced with hyphens, extension stripped.
Example: `My Standup Template.md` → `/my-standup-template`

### Invocation
Message starts with `/slug`:
- `WorkflowLoader.matchWorkflow("/daily-standup Write this meeting...")` → finds matching workflow
- Message is split: workflow content prepended as `<explicit_instructions>`, remainder is the actual user request

### System Prompt Injection
Workflow content is wrapped and prepended to the USER message (not the system prompt):
```
<explicit_instructions type="daily-standup">
[workflow content]
</explicit_instructions>
Write this meeting...
```

The system prompt contains a note:
```
If the user's message contains <explicit_instructions type="...">, treat the content inside as mandatory workflow steps. Execute them in order before addressing any other part of the message.
```

### Toggle System
Same toggle pattern as Rules:
```typescript
workflowToggles: Record<string, boolean>
// key = vault-relative path
// false = disabled (hidden from autocomplete, not matched)
```

### Forced Workflow (Per-Mode)
`settings.forcedWorkflow[modeSlug]` — workflow slug applied to every message in that mode (unless the message already starts with `/`). Applied by `main.ts` before passing message to `AgentTask.run()`.

### Autocomplete
`WorkflowLoader.getEnabledWorkflows()` returns list for autocomplete in the chat input. When user types `/`, autocomplete shows available workflows.

### Discovery & CRUD
- `discoverWorkflows()` — scans workflows dir, returns sorted list of paths
- `getWorkflowSlug(path)` — derives slug from filename
- `createWorkflow(name, content)` → creates `{name}.md`
- `deleteWorkflow(path)` → removes file
- `loadWorkflowContent(path)` → reads raw content (shown in settings editor)

## Key Files
- `src/core/context/WorkflowLoader.ts`
- `src/ui/settings/WorkflowsTab.ts` — settings UI
- `src/ui/sidebar/AutocompleteHandler.ts` — `/` autocomplete in chat input
- `src/main.ts` — applies forced workflow and slash-command dispatch before AgentTask.run()

## Dependencies
- `AgentSidebarView` → `main.ts` — processes message before passing to AgentTask
- `WorkflowLoader.matchWorkflow()` — called on each message send
- `ObsidianAgentPlugin.settings.workflowToggles`
- `ObsidianAgentPlugin.settings.forcedWorkflow`

## Configuration
| Key | Default | Description |
|-----|---------|-------------|
| `workflowToggles` | `{}` | Per-file enabled/disabled |
| `forcedWorkflow` | `{}` | `Record<modeSlug, workflowSlug>` |

## Example Workflow Templates
- `/daily-standup` — "Extract yesterday's notes, list blockers, format as standup"
- `/research` — "Search web for topic, find relevant vault notes, synthesize summary"
- `/meeting-notes` — "Create a meeting note with attendees, agenda, action items"
- `/weekly-review` — "Review last 7 days' notes, identify themes and incomplete items"

## Known Limitations / Edge Cases
- Slash command must be at the very start of the message (no leading space).
- Workflow filenames must be unique across the workflows directory — no subdirectories supported.
- Forced workflow + slash command: if a mode has `forcedWorkflow = 'daily'` and user types `/research`, the user's explicit `/research` takes precedence (the `unless message starts with /` logic).
- Workflow content has no char cap (unlike rules 50k or skills 4k). Very long workflows increase prompt size.
- No variable substitution in workflow content. Custom Prompts have `{{vars}}` instead.
