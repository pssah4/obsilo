/**
 * CorePluginLibrary — Static skill definitions for Obsidian Core Plugins (PAS-1)
 *
 * Hand-maintained definitions for 12 agentifiable core plugins.
 * These are bundled with the plugin (no network, no LLM).
 *
 * ADR-101: Core plugins have no public GitHub repo and no community registry
 * entry. Static definitions are the most reliable approach.
 */

export interface CorePluginDef {
    id: string;
    name: string;
    classification: 'FULL' | 'PARTIAL';
    commands: { id: string; name: string }[];
    description: string;
    instructions: string;
}

export const CORE_PLUGIN_DEFS: CorePluginDef[] = [
    // ── FULL (3+ meaningful commands) ──────────────────────────────────

    {
        id: 'daily-notes',
        name: 'Daily Notes',
        classification: 'FULL',
        commands: [
            { id: 'daily-notes:open', name: 'Open today\'s daily note' },
            { id: 'daily-notes:goto-next', name: 'Open next daily note' },
            { id: 'daily-notes:goto-prev', name: 'Open previous daily note' },
        ],
        description: 'Create and navigate daily journal notes',
        instructions: `Plugin "Daily Notes" provides date-based note creation and navigation.

Available commands:
- daily-notes:open -- Open or create today's daily note
- daily-notes:goto-next -- Navigate to the next daily note
- daily-notes:goto-prev -- Navigate to the previous daily note

Use this skill when the user asks about daily notes, journals, today's note, or date-based note navigation. The daily note format and folder are configured in Obsidian settings.`,
    },

    {
        id: 'canvas',
        name: 'Canvas',
        classification: 'FULL',
        commands: [
            { id: 'canvas:new-file', name: 'Create new canvas' },
            { id: 'canvas:export-as-image', name: 'Export canvas as image' },
            { id: 'canvas:convert-to-file', name: 'Convert to file' },
        ],
        description: 'Visual canvas with cards, links, and spatial notes',
        instructions: `Plugin "Canvas" provides visual thinking boards with cards and connections.

Available commands:
- canvas:new-file -- Create a new empty canvas file (.canvas)
- canvas:export-as-image -- Export the current canvas as an image
- canvas:convert-to-file -- Convert a canvas card to a standalone note file

Use this skill when the user wants to create visual boards, mind maps, or spatial note arrangements. Note: For programmatic canvas creation with nodes and edges, prefer the generate_canvas tool instead.`,
    },

    {
        id: 'backlink',
        name: 'Backlinks',
        classification: 'FULL',
        commands: [
            { id: 'backlink:open', name: 'Open backlinks pane' },
            { id: 'backlink:open-backlinks', name: 'Open backlinks for current note' },
            { id: 'backlink:toggle-backlinks-in-document', name: 'Toggle backlinks in document' },
        ],
        description: 'View and navigate backlinks between notes',
        instructions: `Plugin "Backlinks" shows which notes link to the current note.

Available commands:
- backlink:open -- Open the backlinks pane in the sidebar
- backlink:open-backlinks -- Open backlinks for the current note
- backlink:toggle-backlinks-in-document -- Toggle inline backlinks at the bottom of the note

Use this skill when the user asks about connections between notes, what links to a specific note, or wants to see the backlink panel. For programmatic backlink analysis, prefer the get_linked_notes tool.`,
    },

    {
        id: 'note-composer',
        name: 'Note Composer',
        classification: 'FULL',
        commands: [
            { id: 'note-composer:merge-file', name: 'Merge current file with another file' },
            { id: 'note-composer:split-file', name: 'Extract selection to new note' },
            { id: 'note-composer:extract-heading', name: 'Extract heading to new note' },
        ],
        description: 'Split, merge, and extract content between notes',
        instructions: `Plugin "Note Composer" restructures content across notes.

Available commands:
- note-composer:merge-file -- Merge the current note with another note
- note-composer:split-file -- Extract the selected text into a new note
- note-composer:extract-heading -- Extract a heading and its content into a new note

Use this skill when the user wants to reorganize notes: splitting long notes, merging related notes, or extracting sections. These commands operate on the currently open note in the editor.`,
    },

    // ── PARTIAL (1-2 meaningful commands) ──────────────────────────────

    {
        id: 'file',
        name: 'File Export',
        classification: 'PARTIAL',
        commands: [
            { id: 'file:export-to-pdf', name: 'Export current note to PDF' },
        ],
        description: 'Native PDF export using Obsidian built-in renderer',
        instructions: `Plugin "File Export" provides native Obsidian file export.

Available commands:
- file:export-to-pdf -- Export the currently open note to PDF using Obsidian's built-in renderer

This is a native Obsidian command -- zero external dependencies, always available.
The export renders the note exactly as Obsidian displays it (theme, CSS, plugins applied).
Note: Opens a system print/save dialog. The user must confirm the save location.

Use this for quick PDF exports. For advanced conversion (custom LaTeX templates, bibliography, DOCX): use execute_recipe with Pandoc instead.`,
    },

    {
        id: 'templates',
        name: 'Templates',
        classification: 'PARTIAL',
        commands: [
            { id: 'templates:insert-template', name: 'Insert template' },
        ],
        description: 'Insert predefined note templates',
        instructions: `Plugin "Templates" inserts template content into the current note.

Available commands:
- templates:insert-template -- Opens a picker to insert a template from the configured templates folder

Use this skill when the user asks to apply a template to a note. The template folder is configured in Obsidian settings. Note: If Templater is installed, prefer that for dynamic templates.`,
    },

    {
        id: 'global-search',
        name: 'Search',
        classification: 'PARTIAL',
        commands: [
            { id: 'global-search:open', name: 'Open search' },
        ],
        description: 'Full-text search across the vault',
        instructions: `Plugin "Search" provides full-text search across all vault notes.

Available commands:
- global-search:open -- Open the search pane

Use this skill only when the user explicitly wants to open the search UI. For programmatic searching, prefer the search_files or semantic_search tools.`,
    },

    {
        id: 'switcher',
        name: 'Quick Switcher',
        classification: 'PARTIAL',
        commands: [
            { id: 'switcher:open', name: 'Open quick switcher' },
        ],
        description: 'Quickly navigate to any note by name',
        instructions: `Plugin "Quick Switcher" opens a fuzzy-search dialog to jump to any note.

Available commands:
- switcher:open -- Open the quick switcher dialog

Use this skill when the user wants to navigate to a specific note by name. For programmatic navigation, prefer the open_note tool.`,
    },

    {
        id: 'bookmarks',
        name: 'Bookmarks',
        classification: 'PARTIAL',
        commands: [
            { id: 'bookmarks:bookmark-current-view', name: 'Bookmark current view' },
            { id: 'bookmarks:unbookmark-current-view', name: 'Remove current bookmark' },
        ],
        description: 'Bookmark and organize favorite notes',
        instructions: `Plugin "Bookmarks" (formerly Starred) manages favorite notes.

Available commands:
- bookmarks:bookmark-current-view -- Add the current note or view to bookmarks
- bookmarks:unbookmark-current-view -- Remove the current note from bookmarks

Use this skill when the user wants to bookmark or unbookmark notes.`,
    },

    {
        id: 'outline',
        name: 'Outline',
        classification: 'PARTIAL',
        commands: [
            { id: 'outline:open', name: 'Open outline pane' },
            { id: 'outline:open-for-current', name: 'Open outline for current file' },
        ],
        description: 'View heading structure of the current note',
        instructions: `Plugin "Outline" shows the heading hierarchy of the current note.

Available commands:
- outline:open -- Open the outline pane in the sidebar
- outline:open-for-current -- Open outline for the currently active file

Use this skill when the user wants to see the document structure or navigate by headings.`,
    },

    {
        id: 'tag-pane',
        name: 'Tags',
        classification: 'PARTIAL',
        commands: [
            { id: 'tag-pane:open', name: 'Open tags pane' },
        ],
        description: 'Browse all tags used in the vault',
        instructions: `Plugin "Tags" shows a browsable list of all tags used across vault notes.

Available commands:
- tag-pane:open -- Open the tags pane in the sidebar

Use this skill when the user wants to browse or explore tags. For programmatic tag searching, prefer the search_by_tag tool.`,
    },

    {
        id: 'random-note',
        name: 'Random Note',
        classification: 'PARTIAL',
        commands: [
            { id: 'random-note:open', name: 'Open random note' },
        ],
        description: 'Open a random note from the vault',
        instructions: `Plugin "Random Note" opens a randomly selected note.

Available commands:
- random-note:open -- Open a random note from the vault

Use this skill when the user wants to explore their vault randomly or asks for a surprise note.`,
    },
];

/** Lookup a core plugin definition by ID */
export function getCorePluginDef(id: string): CorePluginDef | undefined {
    return CORE_PLUGIN_DEFS.find((d) => d.id === id);
}

/** Set of all core plugin IDs that have skill definitions */
export const CORE_PLUGIN_IDS = new Set(CORE_PLUGIN_DEFS.map((d) => d.id));
