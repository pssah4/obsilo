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
        id: 'workspace',
        name: 'Workspace',
        classification: 'FULL',
        commands: [
            { id: 'workspace:export-pdf', name: 'Export current note to PDF' },
            { id: 'workspace:close', name: 'Close current tab' },
            { id: 'workspace:split-horizontal', name: 'Split horizontally' },
            { id: 'workspace:split-vertical', name: 'Split vertically' },
            { id: 'workspace:new-tab', name: 'New tab' },
            { id: 'workspace:copy-path', name: 'Copy file path' },
            { id: 'workspace:copy-url', name: 'Copy Obsidian URL' },
            { id: 'workspace:edit-file-title', name: 'Rename file' },
            { id: 'workspace:toggle-pin', name: 'Toggle pin' },
        ],
        description: 'Native workspace operations: PDF export, tab/pane management, file paths',
        instructions: `Plugin "Workspace" provides core Obsidian workspace operations.

Available commands:
- workspace:export-pdf -- Export the currently open note to PDF using Obsidian's built-in renderer
- workspace:close -- Close the currently active tab
- workspace:split-horizontal -- Split the current pane horizontally
- workspace:split-vertical -- Split the current pane vertically
- workspace:new-tab -- Open a new empty tab
- workspace:copy-path -- Copy the active file's vault-relative path to clipboard
- workspace:copy-url -- Copy an obsidian:// URL for the active file
- workspace:edit-file-title -- Rename the active file inline
- workspace:toggle-pin -- Pin or unpin the active tab (pinned tabs stay open)

workspace:export-pdf is a native Obsidian command -- zero external dependencies, always available.
It renders the note exactly as Obsidian displays it (theme, CSS, plugins applied).
Note: Opens an export dialog. The user must confirm settings and save location.

Use workspace:export-pdf for quick PDF exports. For advanced conversion (custom LaTeX templates, bibliography, DOCX): use execute_recipe with Pandoc instead.`,
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
    // ── Additional core commands (app-level, editor, navigation) ─────

    {
        id: 'app',
        name: 'App',
        classification: 'FULL',
        commands: [
            { id: 'app:delete-file', name: 'Delete current file' },
            { id: 'app:go-back', name: 'Navigate back' },
            { id: 'app:go-forward', name: 'Navigate forward' },
            { id: 'app:reload', name: 'Reload app' },
            { id: 'app:open-vault', name: 'Open another vault' },
            { id: 'app:open-settings', name: 'Open settings' },
            { id: 'app:toggle-left-sidebar', name: 'Toggle left sidebar' },
            { id: 'app:toggle-right-sidebar', name: 'Toggle right sidebar' },
        ],
        description: 'Core app operations: navigation, delete, reload, sidebars',
        instructions: `Plugin "App" provides global Obsidian app commands.

Available commands:
- app:delete-file -- Delete the currently active file (moves to trash)
- app:go-back -- Navigate to the previous file in history
- app:go-forward -- Navigate to the next file in history
- app:reload -- Reload the Obsidian app
- app:open-vault -- Open a different vault
- app:open-settings -- Open the Obsidian settings dialog
- app:toggle-left-sidebar -- Show or hide the left sidebar
- app:toggle-right-sidebar -- Show or hide the right sidebar

Note: For programmatic file deletion, prefer the delete_file tool. Use app:delete-file only when the user explicitly wants the native Obsidian delete behavior (trash + UI confirmation).`,
    },

    {
        id: 'editor',
        name: 'Editor',
        classification: 'FULL',
        commands: [
            { id: 'editor:save-file', name: 'Save current file' },
            { id: 'editor:attach-file', name: 'Attach file' },
            { id: 'editor:insert-link', name: 'Insert link' },
            { id: 'editor:insert-callout', name: 'Insert callout' },
            { id: 'editor:insert-tag', name: 'Insert tag' },
            { id: 'editor:set-heading-0', name: 'Set as paragraph (remove heading)' },
            { id: 'editor:set-heading-1', name: 'Set as heading 1' },
            { id: 'editor:set-heading-2', name: 'Set as heading 2' },
            { id: 'editor:set-heading-3', name: 'Set as heading 3' },
            { id: 'editor:set-heading-4', name: 'Set as heading 4' },
            { id: 'editor:set-heading-5', name: 'Set as heading 5' },
            { id: 'editor:set-heading-6', name: 'Set as heading 6' },
            { id: 'editor:rename-heading', name: 'Rename heading' },
            { id: 'editor:toggle-bold', name: 'Toggle bold' },
            { id: 'editor:toggle-italic', name: 'Toggle italic' },
            { id: 'editor:toggle-code', name: 'Toggle inline code' },
            { id: 'editor:toggle-highlight', name: 'Toggle highlight' },
            { id: 'editor:toggle-strikethrough', name: 'Toggle strikethrough' },
            { id: 'editor:fold-all', name: 'Fold all headings and lists' },
            { id: 'editor:unfold-all', name: 'Unfold all headings and lists' },
            { id: 'editor:toggle-source', name: 'Toggle reading/source view' },
        ],
        description: 'Editor operations: formatting, headings, inserts, folding, view mode',
        instructions: `Plugin "Editor" provides text editing commands for the active note.

Available commands:
- editor:save-file -- Force-save the current file
- editor:attach-file -- Open the attachment picker to embed a file
- editor:insert-link -- Insert a wikilink or markdown link
- editor:insert-callout -- Insert a callout block (> [!type])
- editor:insert-tag -- Insert a tag (#tag)
- editor:set-heading-0..6 -- Set the current line to paragraph (0) or heading level 1-6
- editor:rename-heading -- Rename a heading and update all links pointing to it
- editor:toggle-bold/italic/code/highlight/strikethrough -- Toggle formatting on selection
- editor:fold-all -- Collapse all foldable sections
- editor:unfold-all -- Expand all foldable sections
- editor:toggle-source -- Switch between source/live-preview and reading view

Note: These commands operate on the currently active editor. For programmatic content changes, prefer edit_file or append_to_file tools. Use editor commands when the user wants interactive editing behavior (e.g., "make this bold", "add a callout").`,
    },

    {
        id: 'file-explorer',
        name: 'File Explorer',
        classification: 'FULL',
        commands: [
            { id: 'file-explorer:new-file', name: 'Create new note' },
            { id: 'file-explorer:move-file', name: 'Move file to another folder' },
            { id: 'file-explorer:reveal-active-file', name: 'Reveal active file in navigation' },
        ],
        description: 'File explorer: create, move, and reveal files',
        instructions: `Plugin "File Explorer" provides file management commands.

Available commands:
- file-explorer:new-file -- Create a new note (opens an untitled note in the editor)
- file-explorer:move-file -- Move the active file to a different folder (opens folder picker)
- file-explorer:reveal-active-file -- Scroll the file explorer to reveal and highlight the active file

Note: For programmatic file creation, prefer write_file. For moving files, prefer the move_file tool. Use file-explorer commands when the user wants the native UI interaction.`,
    },

    {
        id: 'markdown',
        name: 'Markdown',
        classification: 'PARTIAL',
        commands: [
            { id: 'markdown:toggle-preview', name: 'Toggle reading view' },
        ],
        description: 'Toggle between editing and reading view',
        instructions: `Plugin "Markdown" controls the note view mode.

Available commands:
- markdown:toggle-preview -- Toggle between editing mode and reading (preview) mode

Use this when the user wants to switch view modes. Also available as editor:toggle-source.`,
    },

    {
        id: 'graph',
        name: 'Graph View',
        classification: 'PARTIAL',
        commands: [
            { id: 'graph:open', name: 'Open graph view' },
            { id: 'graph:open-local', name: 'Open local graph' },
        ],
        description: 'Visualize note connections as a graph',
        instructions: `Plugin "Graph View" visualizes connections between notes.

Available commands:
- graph:open -- Open the full vault graph view
- graph:open-local -- Open a local graph showing connections of the active note

Use this when the user wants to visualize note relationships or explore the knowledge graph.`,
    },

    {
        id: 'slides',
        name: 'Slides',
        classification: 'PARTIAL',
        commands: [
            { id: 'slides:start', name: 'Start presentation' },
        ],
        description: 'Present notes as slideshows using --- separators',
        instructions: `Plugin "Slides" turns notes into presentations.

Available commands:
- slides:start -- Start a slideshow presentation of the current note

Notes are split into slides by horizontal rules (---). Use this when the user wants to present a note as a slideshow.`,
    },

    {
        id: 'open-with-default-app',
        name: 'Open with Default App',
        classification: 'PARTIAL',
        commands: [
            { id: 'open-with-default-app:open', name: 'Open in default app' },
            { id: 'open-with-default-app:show', name: 'Show in system explorer' },
        ],
        description: 'Open files in the system default app or file manager',
        instructions: `Plugin "Open with Default App" opens files outside Obsidian.

Available commands:
- open-with-default-app:open -- Open the active file with the system's default app (e.g., Preview for PDF, browser for HTML)
- open-with-default-app:show -- Reveal the active file in Finder/Explorer

Use this when the user wants to view a file in an external application or locate it in the file system.`,
    },

    {
        id: 'theme',
        name: 'Theme',
        classification: 'FULL',
        commands: [
            { id: 'theme:switch', name: 'Switch theme' },
            { id: 'theme:use-dark', name: 'Use dark mode' },
            { id: 'theme:use-light', name: 'Use light mode' },
        ],
        description: 'Switch between light and dark mode or change themes',
        instructions: `Plugin "Theme" controls the visual appearance.

Available commands:
- theme:switch -- Open the theme picker to change the active theme
- theme:use-dark -- Switch to dark color scheme
- theme:use-light -- Switch to light color scheme

Use this when the user asks to change the theme or switch between dark and light mode.`,
    },

    {
        id: 'window',
        name: 'Window',
        classification: 'FULL',
        commands: [
            { id: 'window:zoom-in', name: 'Zoom in' },
            { id: 'window:zoom-out', name: 'Zoom out' },
            { id: 'window:reset-zoom', name: 'Reset zoom' },
            { id: 'window:toggle-always-on-top', name: 'Toggle always on top' },
        ],
        description: 'Window controls: zoom and always-on-top',
        instructions: `Plugin "Window" controls the Obsidian window.

Available commands:
- window:zoom-in -- Increase the UI zoom level
- window:zoom-out -- Decrease the UI zoom level
- window:reset-zoom -- Reset zoom to default (100%)
- window:toggle-always-on-top -- Keep the Obsidian window above all other windows

Use this when the user asks to change zoom level or keep the window on top.`,
    },
];

/** Lookup a core plugin definition by ID */
export function getCorePluginDef(id: string): CorePluginDef | undefined {
    return CORE_PLUGIN_DEFS.find((d) => d.id === id);
}

/** Set of all core plugin IDs that have skill definitions */
export const CORE_PLUGIN_IDS = new Set(CORE_PLUGIN_DEFS.map((d) => d.id));
