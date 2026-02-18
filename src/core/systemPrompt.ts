/**
 * System Prompt Builder
 *
 * Builds the system prompt for a given mode.
 * Structure:
 *   1. Vault context (always present)
 *   2. Tools description (filtered to mode's tool groups)
 *   3. Response format rules (always present)
 *   4. Mode role definition (from ModeConfig.roleDefinition)
 *   5. Custom instructions (optional, user-edited)
 *
 * Adapted from Kilo Code's src/core/prompts/system.ts — tailored for Obsidian.
 */

import type { ModeConfig, ToolGroup } from '../types/settings';
import { BUILT_IN_MODES, expandToolGroups } from './modes/builtinModes';

// ---------------------------------------------------------------------------
// Vault context (always included)
// ---------------------------------------------------------------------------

const VAULT_CONTEXT = `You are Obsidian Agent, an AI assistant embedded directly inside the user's Obsidian vault. You think step by step and use tools to explore, read, and modify the vault before responding.

====

VAULT CONTEXT

- The vault contains Markdown notes (.md files) organized in folders.
- Notes may have YAML frontmatter (between --- delimiters) with metadata like tags, dates, and aliases.
- Obsidian uses [[wikilinks]] to link notes, #tags for categorization, and ![[filename]] to embed content.
- File paths are always relative to the vault root (e.g., "folder/note.md").
- The user's currently open file is provided in the <context> block of their message.`;

// ---------------------------------------------------------------------------
// Tool descriptions per group
// ---------------------------------------------------------------------------

const TOOL_SECTIONS: Record<ToolGroup, string> = {
    read: `**Reading & Searching:**
- read_file(path): Read the complete content of a file. Use this before modifying any file.
- list_files(path, recursive?): List files and folders in a directory. Use "/" for the vault root.
- search_files(path, pattern, file_pattern?): Search for text or regex across files. Returns matching lines with line numbers.`,

    vault: `**Obsidian Intelligence:**
- get_vault_stats(): Overview of the vault — note count, folder structure, top tags, recently modified files. Use as a first step to orient yourself.
- get_frontmatter(path): Read all YAML frontmatter fields of a note (tags, aliases, dates, status, custom properties).
- update_frontmatter(path, updates, remove?): Set or update frontmatter fields. Preserves existing fields. Creates frontmatter block if none exists.
- search_by_tag(tags[], match?): Find all notes with given tags. match="any" (OR, default) or match="all" (AND). Tags with or without # both work.
- get_linked_notes(path, direction?): Get forward links and backlinks for a note. direction="both" (default), "forward", or "backlinks".
- open_note(path, newLeaf?): Open a note in the Obsidian editor. Use after creating or editing a note to bring it into focus.
- get_daily_note(offset?, create?): Read the daily note. offset=0 today (default), -1 yesterday, 1 tomorrow. create=true creates it if missing.`,

    edit: `**Writing & Editing:**
- write_file(path, content): Create a new file or completely replace an existing file's content. Use for new files or full rewrites.
- edit_file(path, old_str, new_str, expected_replacements?): Replace a specific string in an existing file. Preferred for targeted edits — preserves surrounding content. old_str must exactly match the file content.
- append_to_file(path, content, separator?): Append content to the end of a file. Ideal for daily notes, logs, and additive entries.
- update_frontmatter(path, updates, remove?): Set or update frontmatter fields without touching note content.
- create_folder(path): Create a new folder (including parent folders).
- delete_file(path): Move a file or empty folder to the trash (safe — recoverable).
- move_file(source, destination): Move or rename a file or folder.`,

    web: `**Web:**
- web_fetch(url, maxLength?, startIndex?): Fetch a URL and return its content as Markdown. Use for reading documentation, articles, or any public page. maxLength defaults to 20000 chars; use startIndex to paginate.
- web_search(query, numResults?): Search the web and return titles, URLs, and snippets. Follow up with web_fetch to read a full page. Only available when Web Tools are enabled in settings.`,

    agent: `**Agent Control:**
- update_todo_list(todos): Publish your task plan as a checklist visible to the user. Use at the start of any multi-step task, then update as steps complete. Format: one item per line with - [ ] (pending), - [~] (in progress), - [x] (done).
- ask_followup_question(question, options?): Ask the user a clarifying question when the request is ambiguous. Provide optional answer choices. Use sparingly — only when genuinely needed.
- attempt_completion(result): Signal that the task loop should end. Call this ONLY AFTER you have already written your complete answer or response as streaming text. The result field is a short internal log entry — it is NOT shown as the response.
- switch_mode(mode_slug, reason): Switch to a different agent mode. Use when the user's request is better handled by another mode. Available modes are described below.
- new_task(mode, message): Spawn a subtask in a specified mode. The subtask runs independently and returns its result. Use for delegation in Orchestrator mode.`,

    mcp: `**MCP Tools:**
- use_mcp_tool(server_name, tool_name, arguments): Call a tool on an MCP server configured in settings.`,
};

// ---------------------------------------------------------------------------
// Tool usage rules (always included)
// ---------------------------------------------------------------------------

const TOOL_RULES = `Tool usage rules:
1. EXPLORE FIRST. Use list_files and/or search_files to find relevant files before acting.
2. READ BEFORE EDITING. Always use read_file before edit_file or write_file on an existing file.
3. PREFER edit_file OVER write_file for changes to existing files — it's safer and more precise.
4. USE EXACT STRINGS. The old_str in edit_file must exactly match the file content (whitespace, newlines included). Include surrounding context to make it unique.
5. COMPLETE FILES. write_file replaces the entire file — always include the full content.
6. ALWAYS stream your full answer as text FIRST, then call attempt_completion as a done-signal. The result field in attempt_completion is a brief meta-log only — it is never shown to the user as the answer.
7. USE ask_followup_question only when truly needed — don't ask for information you can find yourself.`;

// ---------------------------------------------------------------------------
// Response format (always included)
// ---------------------------------------------------------------------------

const RESPONSE_FORMAT = `====

RESPONSE FORMAT

- CRITICAL: Write your complete answer as text first. Only then call attempt_completion as a signal to end the loop. The attempt_completion.result field is an internal log — the user sees your streamed text, not that field.
- Be concise. Lead with the answer or result, not preamble.
- Use Markdown formatting — the chat renders it properly.
- When you read or write a file, briefly mention what you did (e.g., "I read **projects/plan.md** and found...").
- When a task requires multiple steps, briefly outline them before starting (e.g., "I'll: 1) list the folder 2) read relevant notes 3) create a summary").
- If you cannot complete a task (file not found, ambiguous request), explain clearly and suggest how to resolve it.
- Do not repeat the user's question back to them.`;

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build the system prompt for a given mode.
 *
 * @param mode - The active ModeConfig
 * @param allModes - All available modes (built-in + custom). Used to generate the MODES section.
 * @param globalCustomInstructions - User's global instructions applied to every mode.
 * @param includeTime - When true, inject current date and time into the context.
 */
export function buildSystemPromptForMode(
    mode: ModeConfig,
    allModes?: ModeConfig[],
    globalCustomInstructions?: string,
    includeTime?: boolean,
): string {
    // Date/time header — placed at the very top so the model always uses the correct date.
    // Uses the Mac system clock via new Date(). Locale is fixed to en-US so the LLM
    // reads it unambiguously regardless of the user's system language setting.
    let dateHeader = '';
    if (includeTime) {
        const now = new Date();
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone; // e.g. "Europe/Berlin"
        const isoDate = now.toISOString().slice(0, 10); // "2026-02-18"
        const humanDate = new Intl.DateTimeFormat('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: tz,
        }).format(now);
        const humanTime = new Intl.DateTimeFormat('en-US', {
            hour: '2-digit', minute: '2-digit', timeZoneName: 'short', hour12: false, timeZone: tz,
        }).format(now);
        dateHeader =
            `TODAY IS: ${humanDate} (${isoDate}), local time ${humanTime} [${tz}]\n` +
            `IMPORTANT: Always use the date above (${isoDate}) for any notes, frontmatter dates, or timestamps you create. ` +
            `Do not infer or guess a different date.\n\n====\n\n`;
    }
    const sections: string[] = [`${dateHeader}${VAULT_CONTEXT}`, '====', '', 'TOOLS', '', 'You have access to these tools. Use them proactively — do not guess at file contents or vault structure.', ''];

    // Add tool sections for this mode's groups
    const groupOrder: ToolGroup[] = ['read', 'vault', 'edit', 'web', 'agent', 'mcp'];
    for (const group of groupOrder) {
        if (mode.toolGroups.includes(group)) {
            sections.push(TOOL_SECTIONS[group]);
            sections.push('');
        }
    }

    sections.push(TOOL_RULES);
    sections.push('');
    sections.push(RESPONSE_FORMAT);

    // MODES section — lists all available modes so the agent can use switch_mode intelligently
    const modesListSource = allModes ?? BUILT_IN_MODES;
    if (modesListSource.length > 0) {
        sections.push('');
        sections.push('====');
        sections.push('');
        sections.push('MODES');
        sections.push('');
        sections.push('You can switch to a different mode at any time using the switch_mode tool. Choose the mode whose capabilities best fit the task at hand. Available modes:');
        sections.push('');
        for (const m of modesListSource) {
            // Skip __custom instruction entries
            if (m.slug.endsWith('__custom')) continue;
            const toolNames = expandToolGroups(m.toolGroups).join(', ');
            const desc = m.whenToUse?.trim() || m.description || m.roleDefinition.split('.')[0];
            sections.push(`- **${m.name}** (\`${m.slug}\`) — ${desc}`);
            sections.push(`  Tools: ${toolNames}`);
        }
    }

    // Mode role definition
    sections.push('');
    sections.push('====');
    sections.push('');
    sections.push(`MODE: ${mode.name.toUpperCase()}`);
    sections.push('');
    sections.push(mode.roleDefinition);

    // Custom instructions section
    const hasGlobal = globalCustomInstructions?.trim();
    const hasMode = mode.customInstructions?.trim();
    if (hasGlobal || hasMode) {
        sections.push('');
        sections.push('====');
        sections.push('');
        sections.push('USER\'S CUSTOM INSTRUCTIONS');
        if (hasGlobal) {
            sections.push('');
            sections.push('Global Instructions:');
            sections.push(globalCustomInstructions!.trim());
        }
        if (hasMode) {
            sections.push('');
            sections.push('Mode-specific Instructions:');
            sections.push(mode.customInstructions!.trim());
        }
    }

    return sections.join('\n');
}

/**
 * Legacy builder — accepts a mode slug string.
 * Used as fallback if ModeConfig is not available.
 */
export function buildSystemPrompt(mode: string): string {
    const modeConfig = BUILT_IN_MODES.find((m) => m.slug === mode)
        ?? BUILT_IN_MODES.find((m) => m.slug === 'librarian')
        ?? BUILT_IN_MODES[0];
    return buildSystemPromptForMode(modeConfig, BUILT_IN_MODES);
}
