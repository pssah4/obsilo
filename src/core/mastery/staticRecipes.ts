/**
 * Static Recipes — Bundled procedural recipes for common Obsidian tasks.
 *
 * These are type-safe, versioned, and shipped with the plugin.
 * They represent proven step-by-step sequences the agent should follow
 * instead of re-discovering the tool combination each time.
 *
 * Naming: each recipe has a pipe-separated trigger field for fast
 * keyword matching (trigger recall, no API call).
 */

import type { ProceduralRecipe } from './types';

export const SCHEMA_VERSION = 1;

export const STATIC_RECIPES: ProceduralRecipe[] = [
    {
        id: 'create-excalidraw-visualization',
        name: 'Create Excalidraw Visualization',
        description: 'Create an Excalidraw drawing from note content. Uses create_excalidraw for reliable format output.',
        trigger: 'excalidraw|visualization|visualisierung|visualisiere|zeichnung|diagram|diagramm|drawing|skizze|zeichne',
        steps: [
            { tool: 'read_file', note: 'Read the source note to understand what to visualize' },
            { tool: 'create_excalidraw', note: 'Create the drawing with labeled topic boxes. Extract 3-6 key topics from the source note. Place in same folder as source.' },
            { tool: 'open_note', note: 'Open the drawing in Obsidian so the user sees it immediately' },
        ],
        source: 'static',
        schemaVersion: SCHEMA_VERSION,
        successCount: 0,
        lastUsed: null,
        modes: ['agent'],
    },
    {
        id: 'daily-note-summary',
        name: 'Daily Note Summary',
        description: 'Read the daily note and linked notes, then create a summary.',
        trigger: 'daily|tagebuch|tagesbericht|journal|zusammenfassung|summary|today|heute',
        steps: [
            { tool: 'get_daily_note', note: 'Get today\'s daily note content', params: { offset: '0' } },
            { tool: 'get_linked_notes', note: 'Find notes linked from the daily note', params: { direction: 'forward' } },
            { tool: 'read_file', note: 'Read the most relevant linked notes for context', conditional: true },
            { tool: 'write_file', note: 'Create the summary note', params: { path: '{output_path}', content: '{summary}' } },
            { tool: 'open_note', note: 'Open the summary for review', params: { path: '{output_path}' } },
        ],
        source: 'static',
        schemaVersion: SCHEMA_VERSION,
        successCount: 0,
        lastUsed: null,
        modes: ['agent'],
    },
    {
        id: 'reorganize-notes-by-tag',
        name: 'Reorganize Notes by Tag',
        description: 'Find notes with a specific tag and move them into a dedicated folder.',
        trigger: 'reorganize|reorganisieren|sortieren|organize|tag|move|verschieben|aufraumen',
        steps: [
            { tool: 'search_by_tag', note: 'Find all notes with the target tag', params: { tags: '{tags}' } },
            { tool: 'create_folder', note: 'Create the target folder if it does not exist', params: { path: '{target_folder}' } },
            { tool: 'move_file', note: 'Move each matching note to the target folder' },
        ],
        source: 'static',
        schemaVersion: SCHEMA_VERSION,
        successCount: 0,
        lastUsed: null,
        modes: ['agent'],
    },
    {
        id: 'create-canvas-from-notes',
        name: 'Create Canvas from Notes',
        description: 'Generate an Obsidian Canvas visualizing relationships between notes.',
        trigger: 'canvas|mindmap|map|karte|beziehungen|relationships|graph|netzwerk',
        steps: [
            { tool: 'generate_canvas', note: 'Create the canvas file with note cards and edges', params: { output_path: '{output_path}', mode: '{mode}', source: '{source}' } },
            { tool: 'open_note', note: 'Open the canvas in Obsidian', params: { path: '{output_path}' } },
        ],
        source: 'static',
        schemaVersion: SCHEMA_VERSION,
        successCount: 0,
        lastUsed: null,
        modes: ['agent'],
    },
    {
        id: 'export-note-pdf',
        name: 'Export Note as PDF',
        description: 'Export a note to PDF using the best available method.',
        trigger: 'export|pdf|drucken|print|exportieren',
        steps: [
            { tool: 'read_file', note: 'Read the note to verify it exists and check content' },
            { tool: 'execute_command', note: 'Try native Obsidian PDF export first (Tier 1)', params: { command_id: 'workspace:export-pdf' }, conditional: true },
            { tool: 'execute_recipe', note: 'Fallback to Pandoc PDF export if native unavailable (Tier 2)', params: { recipe_id: 'pandoc-pdf' }, conditional: true },
        ],
        source: 'static',
        schemaVersion: SCHEMA_VERSION,
        successCount: 0,
        lastUsed: null,
        modes: ['agent'],
    },
    {
        id: 'create-base-from-tag',
        name: 'Create Database from Tag',
        description: 'Create an Obsidian Bases database view filtering notes by a specific tag or frontmatter property.',
        trigger: 'base|datenbank|database|tabelle|table|uebersicht|overview',
        steps: [
            { tool: 'search_by_tag', note: 'Verify matching notes exist for the target criteria', conditional: true },
            { tool: 'create_base', note: 'Create the .base file with filter and columns', params: { path: '{output_path}', view_name: '{view_name}', filter_property: '{property}', filter_values: '{values}' } },
            { tool: 'open_note', note: 'Open the database view', params: { path: '{output_path}' } },
        ],
        source: 'static',
        schemaVersion: SCHEMA_VERSION,
        successCount: 0,
        lastUsed: null,
        modes: ['agent'],
    },
    {
        id: 'link-related-notes',
        name: 'Link Related Notes',
        description: 'Find semantically related notes and add wikilinks or frontmatter references.',
        trigger: 'link|verlinken|related|verwandt|verbinden|connect|backlink',
        steps: [
            { tool: 'read_file', note: 'Read the source note to understand its content' },
            { tool: 'semantic_search', note: 'Find semantically similar notes in the vault', params: { query: '{source_content_summary}', top_k: '5' } },
            { tool: 'update_frontmatter', note: 'Add related note links to frontmatter', params: { path: '{source_file}', updates: '{"related": ["{related_notes}"]}' }, conditional: true },
            { tool: 'edit_file', note: 'Optionally add a "Related Notes" section in the note body', conditional: true },
        ],
        source: 'static',
        schemaVersion: SCHEMA_VERSION,
        successCount: 0,
        lastUsed: null,
        modes: ['agent'],
    },
    {
        id: 'process-voice-note',
        name: 'Process Voice Note',
        description: 'Clean up and structure a transcribed voice note with proper formatting and metadata.',
        trigger: 'voice|sprachnotiz|transkript|transcript|audio|diktat|dictation|aufnahme',
        steps: [
            { tool: 'read_file', note: 'Read the raw transcription', params: { path: '{source_file}' } },
            { tool: 'update_frontmatter', note: 'Add metadata (date, type, tags) to the note', params: { path: '{source_file}', updates: '{"type": "voice-note", "processed": true}' } },
            { tool: 'edit_file', note: 'Clean up and restructure the transcription content', params: { path: '{source_file}' } },
            { tool: 'open_note', note: 'Open the processed note', params: { path: '{source_file}' } },
        ],
        source: 'static',
        schemaVersion: SCHEMA_VERSION,
        successCount: 0,
        lastUsed: null,
        modes: ['agent'],
    },
];
