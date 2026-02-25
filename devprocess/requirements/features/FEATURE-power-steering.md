# FEATURE: Power Steering

**Status:** Implemented
**Source:** `src/core/AgentTask.ts`

## Summary
Periodically injects a synthetic user message containing the active mode's role definition into the conversation history. This "reminder" helps the model stay on task during long agentic loops by re-reading its role instructions at regular intervals.

## How It Works

### Trigger
At the start of each agentic iteration (before the API call), when all conditions are met:

```typescript
if (
    this.powerSteeringFrequency > 0
    && iteration > 0
    && iteration % this.powerSteeringFrequency === 0
)
```

- `powerSteeringFrequency` must be > 0 (0 = disabled)
- Never fires on iteration 0 (first user message)
- Fires every Nth iteration (e.g., frequency=3 fires on iterations 3, 6, 9, ...)

### Injection
Pushes a synthetic `user` message into the conversation history:

```typescript
history.push({
    role: 'user',
    content: `[Power Steering Reminder]\n\nYou are operating in **${activeMode.name}** mode.\n\n${activeMode.roleDefinition}\n\nContinue the task.`,
});
```

The message contains:
1. A `[Power Steering Reminder]` tag identifying it as synthetic
2. The active mode's display name
3. The full `roleDefinition` from the mode configuration
4. A "Continue the task." instruction to maintain flow

### Effect
The model "re-reads" its role instructions as if the user had sent them. This helps with:
- **Role drift** — long tasks where the model gradually ignores formatting or behavioral requirements
- **Formatting compliance** — modes with specific output formats that degrade after many iterations
- **Task creep prevention** — orchestrator patterns where the model starts doing work it should delegate

### Mode-Aware
The reminder uses `activeMode`, which tracks mode switches. If `switch_mode` changed the mode mid-task, the power steering reminder reflects the new mode's role definition.

### Subtask Behavior
Child tasks spawned via `new_task` always have `powerSteeringFrequency = 0`:
```typescript
new AgentTask(api, registry, callbacks, modeService,
    consecutiveMistakeLimit, rateLimitMs,
    false, 80, 0,  // condensingEnabled=false, threshold=80, powerSteering=0
    maxIterations, childDepth, maxSubtaskDepth
)
```
This keeps child loops lean and avoids stacking reminders in nested contexts.

## Key Files
- `src/core/AgentTask.ts` — power steering injection in the iteration loop
- `src/ui/settings/LoopTab.ts` — settings UI for frequency configuration
- `src/core/modes/builtinModes.ts` — mode definitions with `roleDefinition`

## Dependencies
- `ModeConfig.roleDefinition` — content of the steering reminder
- `ModeConfig.name` — display name in the reminder header
- `AgentTask.powerSteeringFrequency` — controls injection frequency
- `ModeService.switchMode()` — mode switches update `activeMode` before next steering

## Configuration
| Key | Default | Description |
|-----|---------|-------------|
| `advancedApi.powerSteeringFrequency` | 0 | Inject reminder every N iterations (0 = disabled) |

## Known Limitations / Edge Cases
- Steering messages are real `user` messages in the conversation history — they accumulate and are never removed. Over very long tasks, they inflate the token count.
- If condensing fires, steering messages in the middle section are summarized away — only messages in the tail-4 survive. This can reduce steering effectiveness after condensing.
- The reminder content is the raw `roleDefinition` string — very long role definitions (custom modes) increase token cost per steering injection.
- No adaptive frequency — the interval is fixed. A model that is already on-task receives the same reminders as one that has drifted.
- The `[Power Steering Reminder]` tag is visible to the model — some models may comment on receiving "reminders" in their responses.
- Power steering does not account for tool-heavy iterations where the model has no text output — the reminder still fires based on iteration count, not behavioral signals.
