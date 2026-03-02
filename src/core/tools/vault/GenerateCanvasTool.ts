/**
 * GenerateCanvasTool
 *
 * Creates an Obsidian Canvas file (.canvas) from vault notes.
 * Modes:
 *   - 'folder': all notes in a given folder
 *   - 'tag': all notes with a given tag
 *   - 'backlinks': notes linked to/from a specific note
 *   - 'files': an explicit list of note paths
 *
 * The canvas uses a simple grid layout. Each node is a file card.
 * Edges are drawn for [[wikilinks]] found in the notes.
 *
 * Canvas JSON spec: https://obsidian.md/canvas
 */

import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';
import type { TFile } from 'obsidian';

interface CanvasNode {
    id: string;
    type: 'file';
    file: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

interface CanvasEdge {
    id: string;
    fromNode: string;
    toNode: string;
    fromSide: 'right' | 'left' | 'top' | 'bottom';
    toSide: 'right' | 'left' | 'top' | 'bottom';
}

interface CanvasData {
    nodes: CanvasNode[];
    edges: CanvasEdge[];
}

export class GenerateCanvasTool extends BaseTool<'generate_canvas'> {
    readonly name = 'generate_canvas' as const;
    readonly isWriteOperation = true;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'generate_canvas',
            description:
                'Create an Obsidian Canvas file (.canvas) visualizing notes and their connections. ' +
                'Use to build knowledge graphs, project maps, or link diagrams.',
            input_schema: {
                type: 'object',
                properties: {
                    output_path: {
                        type: 'string',
                        description: 'Path for the canvas file (must end with .canvas, e.g. "maps/projects.canvas")',
                    },
                    mode: {
                        type: 'string',
                        enum: ['folder', 'tag', 'backlinks', 'files'],
                        description:
                            '"folder": all notes in a folder; ' +
                            '"tag": all notes with a tag; ' +
                            '"backlinks": notes linked to/from a specific note; ' +
                            '"files": explicit list of note paths',
                    },
                    source: {
                        type: 'string',
                        description: 'Folder path, tag name (without #), or note path — depending on mode. Not needed for "files" mode.',
                    },
                    files: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Explicit list of note paths (required for "files" mode).',
                    },
                    max_notes: {
                        type: 'number',
                        description: 'Maximum number of notes to include (default: 50).',
                    },
                    draw_edges: {
                        type: 'boolean',
                        description: 'Draw edges between notes that link to each other (default: true).',
                    },
                },
                required: ['output_path', 'mode'],
            },
        };
    }

    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const outputPath = ((input.output_path as string) ?? '').trim();
        const mode = (input.mode as string) ?? 'folder';
        const source = ((input.source as string) ?? '').trim();
        const explicitFiles: string[] = Array.isArray(input.files) ? input.files as string[] : [];
        const maxNotes: number = Math.min(Number(input.max_notes) || 50, 200);
        const drawEdges: boolean = input.draw_edges !== false;

        if (!outputPath) {
            callbacks.pushToolResult(this.formatError(new Error('output_path is required')));
            return;
        }
        if (!outputPath.endsWith('.canvas')) {
            callbacks.pushToolResult(this.formatError(new Error('output_path must end with .canvas')));
            return;
        }

        try {
            // Collect the target files
            let targetFiles: TFile[] = [];

            if (mode === 'files') {
                for (const fp of explicitFiles) {
                    const f = this.app.vault.getFileByPath(fp);
                    if (f) targetFiles.push(f);
                }
            } else if (mode === 'folder') {
                if (!source) {
                    callbacks.pushToolResult(this.formatError(new Error('"source" (folder path) is required for folder mode')));
                    return;
                }
                targetFiles = this.app.vault.getMarkdownFiles().filter(
                    (f) => f.path.startsWith(source === '/' ? '' : source)
                );
            } else if (mode === 'tag') {
                if (!source) {
                    callbacks.pushToolResult(this.formatError(new Error('"source" (tag name) is required for tag mode')));
                    return;
                }
                const tag = source.startsWith('#') ? source : `#${source}`;
                const tagNoHash = source.startsWith('#') ? source.slice(1) : source;
                targetFiles = this.app.vault.getMarkdownFiles().filter((f) => {
                    const cache = this.app.metadataCache.getFileCache(f);
                    if (!cache) return false;
                    const fileTags: string[] = [];
                    if (cache.tags) fileTags.push(...cache.tags.map((t) => t.tag));
                    if (cache.frontmatter?.tags) {
                        const ft = cache.frontmatter.tags;
                        const arr: string[] = Array.isArray(ft) ? ft : [ft];
                        fileTags.push(...arr.map((t: string) => t.startsWith('#') ? t : `#${t}`));
                    }
                    return fileTags.some((t) => t === tag || t === `#${tagNoHash}`);
                });
            } else if (mode === 'backlinks') {
                if (!source) {
                    callbacks.pushToolResult(this.formatError(new Error('"source" (note path) is required for backlinks mode')));
                    return;
                }
                const centerFile = this.app.vault.getFileByPath(source);
                if (!centerFile) {
                    callbacks.pushToolResult(this.formatError(new Error(`Note not found: ${source}`)));
                    return;
                }
                const linked = new Set<TFile>([centerFile]);

                // Forward links from the source note
                const cache = this.app.metadataCache.getFileCache(centerFile);
                if (cache?.links) {
                    for (const link of cache.links) {
                        const resolved = this.app.metadataCache.getFirstLinkpathDest(link.link, source);
                        if (resolved) linked.add(resolved);
                    }
                }
                // Backlinks to the source note
                const backlinks = this.app.metadataCache.getBacklinksForFile?.(centerFile);
                if (backlinks?.data) {
                    for (const [path] of Object.entries(backlinks.data)) {
                        const f = this.app.vault.getFileByPath(path);
                        if (f) linked.add(f);
                    }
                }
                targetFiles = Array.from(linked);
            }

            // Cap to maxNotes
            if (targetFiles.length > maxNotes) {
                targetFiles = targetFiles.slice(0, maxNotes);
            }

            if (targetFiles.length === 0) {
                callbacks.pushToolResult(`No notes found for the given ${mode} filter.`);
                return;
            }

            // Build node map (path → id)
            const nodeMap = new Map<string, string>();
            targetFiles.forEach((f, i) => nodeMap.set(f.path, `node-${i}`));

            // Grid layout: ~4 columns, each card 250×60 px
            const COLS = 4;
            const W = 250;
            const H = 80;
            const GAP_X = 60;
            const GAP_Y = 40;

            const nodes: CanvasNode[] = targetFiles.map((f, i) => ({
                id: `node-${i}`,
                type: 'file',
                file: f.path,
                x: (i % COLS) * (W + GAP_X),
                y: Math.floor(i / COLS) * (H + GAP_Y),
                width: W,
                height: H,
            }));

            const edges: CanvasEdge[] = [];
            if (drawEdges) {
                const seen = new Set<string>();
                for (const f of targetFiles) {
                    const fc = this.app.metadataCache.getFileCache(f);
                    if (!fc?.links) continue;
                    for (const link of fc.links) {
                        const resolved = this.app.metadataCache.getFirstLinkpathDest(link.link, f.path);
                        if (!resolved || !nodeMap.has(resolved.path)) continue;
                        const fromId = nodeMap.get(f.path)!;
                        const toId = nodeMap.get(resolved.path)!;
                        const edgeKey = `${fromId}→${toId}`;
                        if (seen.has(edgeKey) || fromId === toId) continue;
                        seen.add(edgeKey);
                        edges.push({
                            id: `edge-${seen.size}`,
                            fromNode: fromId,
                            toNode: toId,
                            fromSide: 'right',
                            toSide: 'left',
                        });
                    }
                }
            }

            const canvasData: CanvasData = { nodes, edges };
            const json = JSON.stringify(canvasData, null, 2);

            // Write the .canvas file
            const existing = this.app.vault.getFileByPath(outputPath);
            if (existing) {
                await this.app.vault.modify(existing, json);
            } else {
                // Ensure parent folder exists
                const dir = outputPath.includes('/') ? outputPath.split('/').slice(0, -1).join('/') : null;
                if (dir) {
                    await this.app.vault.createFolder(dir).catch(() => { /* already exists */ });
                }
                await this.app.vault.create(outputPath, json);
            }

            callbacks.pushToolResult(
                `Canvas created: **${outputPath}**\n` +
                `- ${nodes.length} notes\n` +
                `- ${edges.length} connections\n\n` +
                `Open the file in Obsidian to view the canvas.`
            );
            callbacks.log(`Generated canvas: ${outputPath} (${nodes.length} nodes, ${edges.length} edges)`);
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('generate_canvas', error);
        }
    }
}
