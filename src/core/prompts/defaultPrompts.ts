/**
 * Default Prompt Package — shipped with the plugin on first install.
 *
 * These prompts are seeded into settings.customPrompts with isBuiltIn=true.
 * Users can disable them but not delete them.
 */

import type { CustomPrompt } from '../../types/settings';

// ---------------------------------------------------------------------------
// 1. Meeting Summary
// ---------------------------------------------------------------------------

const MEETING_SUMMARY: CustomPrompt = {
    id: 'builtin-meeting-summary',
    name: 'Meeting Summary',
    slug: 'meeting-summary',
    enabled: true,
    isBuiltIn: true,
    content: `## Goal

A compact, well-structured summary of {{activeFile}} that can be grasped in no more than 1 minute. Strictly adhere to the transcribed content: **No interpretations, no additions**!

## Focus

- What were the topics, theses, discussion points? -> One section per topic
- What happened / was discussed? -> Assign to topics
- Were there different positions and perspectives? If so, what arguments were put forward? -> Assign to topics
- What is the **result or key takeaway**? -> Assign to topics
- Why is it relevant? -> Very briefly assign to individual discussion points
- Tasks and todos? -> Use - [ ] formatting with responsible persons assigned

## Style and Structure

- Clear, professional tone -- the goal is to **quickly recall the meeting content** and have the **key statements at hand**.
- Not purely bullet-point format -- use short sentences for explanations where appropriate.
- Start with the goal, core statement, and/or key outcome (graspable in 15 seconds), then present the most important points in logical order, organized in thematic blocks.
- Use active verbs and short main clauses.
- No filler words, no repetitions.
- Summary content should be graspable in approximately 1 minute.
- **Bold** important statements.
- Use headings ## and ### for structure.
- Always create a blank line between heading and body text.
- Attribute statements to speakers where this is unambiguously possible.
- Create a todo list at the end with tasks from the meeting, if these were clearly discussed.
- Write in a **neutral, informative style**.

## Actions

- Provide the summary as a Markdown text in the chat response (without code block).
- Do not create new notes and do not insert anything into the note.

**MANDATORY**: Execute all steps of these instructions completely without further questions and stop only when finished. Keep existing content unchanged.
**FORBIDDEN**: Never delete existing content. Do not repeat the transcript in the summary.`,
};

// ---------------------------------------------------------------------------
// 2. Metadata Summary & Tags
// ---------------------------------------------------------------------------

const METADATA_SUMMARY: CustomPrompt = {
    id: 'builtin-metadata-summary',
    name: 'Metadata Summary & Tags',
    slug: 'metadata-tags',
    enabled: true,
    isBuiltIn: true,
    content: `**Instructions:**

Create **a single summary in exactly one sentence** for {{activeFile}}.

The output must contain **no more than 25 words**.

Output **only the sentence** -- no explanations, no additional text.
If the summary would be longer, **shorten it radically**.

Insert the summary as content into the "summary" property in the YAML frontmatter of the active note. Do NOT change the structure of the existing YAML frontmatter -- use replaceInFile for precise changes without deleting existing properties. If the property does not yet exist, create it.

Generate 5-10 keywords for the active note that help recall the note later (associations, memory aids, meta-topics, semantics) and improve discoverability in semantic search. Use hyphenated format "Word1-Word2", maximum 2 connected words. If technical terms are more commonly used in English, use the English variant (e.g., "AI-Agent").

Create 2-3 suggestions for "Topics" and 2-3 suggestions for "Concepts" matching the note content as taxonomy. First search the vault for matching existing topics and concepts. Only create a new topic or concept if no suitable one exists.

**Important:** Always use replaceInFile with exact SEARCH/REPLACE blocks to avoid damaging existing YAML structures. Check existing frontmatter content first. If a property with the same name already exists (e.g., "tags"), do not create a new additional property with the same name -- instead, supplement the existing property. There must always be only one property with the same name.

**Forbidden:** NEVER delete or change existing content in the YAML frontmatter or body. If something already exists in the YAML frontmatter or body, supplement it.

**Format:**
\`\`\`
"summary": <sentence with 20-25 words>
"tags":
- Keyword 1
- Keyword 2
- Keyword n
\`\`\``,
};

// ---------------------------------------------------------------------------
// 3. Insights & Relevance
// ---------------------------------------------------------------------------

const INSIGHTS_RELEVANCE: CustomPrompt = {
    id: 'builtin-insights-relevance',
    name: 'Insights & Relevance',
    slug: 'insights-relevance',
    enabled: true,
    isBuiltIn: true,
    content: `## Requirements

**Source fidelity:**
- Use exclusively content from the transcript
- No invented or researched facts
- No interpretations or speculation

**Personalization:**
- Read the user's current profile from Memory
- Connect transcript content with the user's goals, projects, and activities
- Show concrete follow-up opportunities

**Quality:**
- Precise, understandable language
- Expert-level but accessible
- Well-structured and readable
- Concrete, actionable insights

---

## Personalization through Memory

Read the Memory and extract:

1. **Current goals and priorities**
   - Which projects have the highest priority?
   - What goals are being pursued?

2. **Ongoing projects, activities, interests**
   - What concrete projects are being worked on?
   - Which topics are of interest?
   - Which activities or ideas are currently being pursued?

3. **Work style and quality criteria**
   - Which perspective is preferred (practical/theoretical)?
   - Which quality standards are important?

4. **Technologies and frameworks**
   - Which tools/frameworks are relevant?
   - Which technologies are in use?

5. **Learning and deepening topics**
   - What should be deepened?
   - What knowledge gaps exist?

Use this information to connect the transcript content.

---

## Output Structure

Create the summary in this format:

# Summary

## Core Message

[One coherent paragraph, 3-5 sentences]

Describe:
- The central message of the content
- Why it is relevant to the user's work and goals
- The main context and objective

Use **bold** for key terms.

---

## Key Insights from the Transcript

[2-4 bullet points, each 2-3 sentences]

- **Insight 1**: [Description of the insight with context]
- **Insight 2**: [Description of the insight with context]
- **Insight 3**: [Description of the insight with context]
- **Insight 4**: [Optional, if relevant]

Focus on:
- Central facts and statements from the transcript
- New, surprising information
- Concrete numbers, names, frameworks
- No speculation or additions

---

## Connection to My Work and Goals

[Multiple bullet points, each 2-4 sentences]

- **Relation to [Project/Topic]**: [How does the transcript connect with current projects? What concrete use cases exist?] Optional: reference to existing notes [[Note]].
- **Deepening field: [Topic]**: [What learning or deepening area emerges? How can work continue there?]
- **Technology/Framework: [Name]**: [Which tools/technologies from the transcript are relevant to the user's work? How can they be used?]
- **Further connection points**: [Additional connections to goals and activities]

Focus on:
- Clear relation to current projects from the user's profile
- References to existing notes with [[Wikilinks]]
- Concrete description of how to continue working
- 2-4 meaningful deepening areas

---

## Practical Next Steps

[ONLY include if meaningful steps can be derived from the transcript]

- [ ] **[Action]**: [Brief description of why this fits the user's goals]
- [ ] **[Action]**: [Optional, if further steps make sense]
- [ ] **[Action]**: [Optional, if further steps make sense]

If no concrete steps can be derived: omit this section.

---

## Quality Standards

**Lengths:**
- Core message: 3-5 sentences (approx. 300-500 characters)
- Key insights: 2-4 points of 2-3 sentences each
- Connections: 2-4 points of 2-4 sentences each
- Next steps: 1-3 todos (if meaningful)

**Formatting:**
- **Bold** for important terms (min. 3-5 per section)
- Highlight numbers, names, frameworks, technologies
- Blank line after headings
- Separator line --- between main sections
- Clear, short sentences (max. 20 words)
- Only generate and output the summary, no hints like "For insertion:" or similar

**Tone:**
- Professional and technically precise
- Factual, no colloquial language
- Understandable despite technical terminology
- Concrete and action-oriented

**Wikilinks:**
- Set [[Wikilinks]] to relevant projects
- Link to technologies/frameworks
- Use information from the user's profile

---

## Step-by-Step Execution

1. **Read user profile** - Read from Memory information about the user. Identify projects, goals, technologies. Note work style and quality criteria.
2. **Analyze transcript** - Find transcript in {{activeFile}}. If no transcript found: stop and inform. Analyze content completely.
3. **Establish connections** - Which transcript content fits the user's projects? Which technologies/frameworks are relevant? Which learning/deepening areas emerge?
4. **Write summary** - Create all sections according to the structure. Check quality standards. Set Wikilinks.
5. **Output in chat** - Output the complete summary in the chat. Format as copyable Markdown text.

---

## Forbidden

- Changing or deleting YAML frontmatter
- Overwriting or deleting existing notes
- Changing, deleting, or shortening the transcript
- Inventing content or supplementing from web search
- Speculation or interpretations without basis in the transcript

## Allowed

- Outputting the summary in the chat
- Using Markdown formatting
- Setting Wikilinks to existing notes
- Using bold for important terms
- Rephrasing for better clarity
- Connecting with the user's profile`,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** All default prompts shipped with the plugin. */
export const DEFAULT_PROMPTS: CustomPrompt[] = [
    MEETING_SUMMARY,
    METADATA_SUMMARY,
    INSIGHTS_RELEVANCE,
];

/**
 * Seed default prompts into existing custom prompts.
 * Only adds prompts whose id is not yet present — never overwrites user edits.
 * Returns the merged array.
 */
export function mergeDefaultPrompts(existing: CustomPrompt[]): CustomPrompt[] {
    const existingIds = new Set(existing.map((p) => p.id));
    const missing = DEFAULT_PROMPTS.filter((dp) => !existingIds.has(dp.id));
    if (missing.length === 0) return existing;
    return [...existing, ...missing.map((p) => ({ ...p }))];
}
