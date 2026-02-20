# FEATURE: Skills

**Status:** Implemented
**Source:** `src/core/context/SkillsManager.ts`

## Summary
Context-aware knowledge injection. Skills are folder-based Markdown files that are automatically matched to the user's message and injected into the system prompt. Each skill provides specialized instructions for a particular task type. Forced skills can be pinned to specific modes.

## How It Works

### Storage Structure
```
{vault}/.obsidian-agent/skills/
  {skill-name}/
    SKILL.md       ← frontmatter: name, description
```

Frontmatter format:
```yaml
---
name: Meeting Notes
description: Taking structured meeting notes with action items, attendees, and decisions
---
# Instructions for Meeting Notes
...
```

### Discovery
`SkillsManager.discoverSkills()` scans `{vault}/.obsidian-agent/skills/*/SKILL.md`.
Returns a list of `DiscoveredSkill`:
```typescript
{
  name: string,        // from frontmatter
  description: string, // used for keyword matching
  path: string,        // vault-relative path to SKILL.md
  body: string,        // content below frontmatter
}
```

### Keyword Matching
`getRelevantSkills(userMessage, forcedSkillNames)`:
1. Check `forcedSkillNames` (from `settings.forcedSkills[modeSlug]`) — always included
2. For remaining skills: keyword match of `skill.description` words against `userMessage`
   - Simple token overlap: split description into words, check if any appear in the user message
   - Match threshold: at least 1 word overlap (low-threshold, broad matching)

### System Prompt Injection
Relevant skills are formatted as an XML block:
```xml
<available_skills>
<skill name="Meeting Notes">
<description>Taking structured meeting notes...</description>
<instructions>
[skill body content, max 4000 chars]
</instructions>
</skill>
</available_skills>
```

Placed in system prompt under `AVAILABLE SKILLS` section:
```
====

AVAILABLE SKILLS

The skills below match the current task. Follow the <instructions> of each relevant skill before proceeding.

<available_skills>
...
</available_skills>
```

### Per-Skill Body Cap
4,000 characters per skill body (truncated if exceeded). Prevents individual skills from dominating the context window.

### Forced Skills (Per-Mode)
`settings.forcedSkills[modeSlug]` — array of skill names always injected for that mode, regardless of keyword matching. Set in Settings → Modes → (edit mode) → Forced Skills.

### CRUD Operations
- `createSkill(name, description, content)` — creates `{slug}/SKILL.md`
- `updateSkillDescription(path, newDescription)` — rewrites frontmatter description
- `deleteSkill(path)` — removes the skill folder

## Key Files
- `src/core/context/SkillsManager.ts`
- `src/ui/settings/SkillsTab.ts` — settings UI
- `src/core/systemPrompt.ts` — injects `skillsSection` parameter

## Dependencies
- `AgentSidebarView` → `main.ts` → `SkillsManager.getRelevantSkills()` called before each task
- `ObsidianAgentPlugin.settings.forcedSkills` — per-mode forced skill config
- `systemPrompt.ts` — receives `skillsSection` as parameter

## Configuration
| Key | Default | Description |
|-----|---------|-------------|
| `forcedSkills` | `{}` | `Record<modeSlug, skillNames[]>` |

No per-skill toggle — skills are either in the vault or not. Matching is automatic.

## Example Skill Use Cases
- **Meeting Notes** — triggered by messages containing "meeting", "notes", etc.
- **Bug Report** — triggered by "bug", "error", "fix", etc.
- **Research** — triggered by "research", "find", "investigate", etc.
- **Daily Review** — forced for a "Daily" custom mode

## Known Limitations / Edge Cases
- Keyword matching is very simple (word overlap) — no semantic similarity, no TF-IDF, no embeddings. Can produce false positives for common words.
- Skill `name` must be unique (used as identifier in forced skill config). No deduplication enforcement.
- Skills directory structure (one folder per skill) means many small folders in `.obsidian-agent/`. Could become cluttered with many skills.
- Skills content is user-defined and treated as trusted input (unlike vault files which are marked as untrusted data). However, they're wrapped in `<available_skills>` tags for clear boundary marking.
- No "disable" toggle per skill — only per-mode forced injection. To disable a skill, must delete it.
