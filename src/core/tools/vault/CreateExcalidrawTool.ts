/**
 * CreateExcalidrawTool
 *
 * Creates an Excalidraw drawing (.excalidraw.md) with labeled boxes.
 * Format knowledge lives in TypeScript code — the LLM only provides
 * high-level input (labels, colors, layout).
 *
 * Follows the same pattern as GenerateCanvasTool and CreateBaseTool:
 * the tool handles the complex file format programmatically so the
 * LLM never has to generate raw Excalidraw JSON.
 *
 * Supported elements: rectangles + text (no arrows — they require
 * complex point arrays with Bezier data).
 */

import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';

/* ------------------------------------------------------------------ */
/*  Excalidraw element interfaces (subset needed for box + text)      */
/* ------------------------------------------------------------------ */

interface ExcalidrawBaseElement {
    id: string;
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
    angle: number;
    strokeColor: string;
    backgroundColor: string;
    fillStyle: string;
    strokeWidth: number;
    strokeStyle: string;
    roughness: number;
    opacity: number;
    seed: number;
    version: number;
    versionNonce: number;
    isDeleted: boolean;
    groupIds: string[];
    frameId: null;
    roundness: { type: number } | null;
    boundElements: null;
    updated: number;
    link: null;
    locked: boolean;
}

interface ExcalidrawRectangle extends ExcalidrawBaseElement {
    type: 'rectangle';
}

interface ExcalidrawText extends ExcalidrawBaseElement {
    type: 'text';
    fontSize: number;
    fontFamily: number;
    text: string;
    textAlign: string;
    verticalAlign: string;
    containerId: null;
    originalText: string;
    autoResize: boolean;
    lineHeight: number;
}

type ExcalidrawElement = ExcalidrawRectangle | ExcalidrawText;

interface ExcalidrawScene {
    type: 'excalidraw';
    version: number;
    elements: ExcalidrawElement[];
    appState: {
        viewBackgroundColor: string;
    };
}

/* ------------------------------------------------------------------ */
/*  Color palette: named colors → Excalidraw hex values               */
/* ------------------------------------------------------------------ */

const COLOR_PALETTE: Record<string, string> = {
    blue: '#a5d8ff',
    green: '#b2f2bb',
    yellow: '#ffec99',
    red: '#ffc9c9',
    purple: '#d0bfff',
    orange: '#ffd8a8',
    gray: '#dee2e6',
    grey: '#dee2e6',
    white: '#ffffff',
    cyan: '#99e9f2',
    pink: '#fcc2d7',
};

const DEFAULT_COLOR = '#a5d8ff'; // blue

function resolveColor(input?: string): string {
    if (!input) return DEFAULT_COLOR;
    const lower = input.toLowerCase().trim();
    if (COLOR_PALETTE[lower]) return COLOR_PALETTE[lower];
    if (/^#[0-9a-f]{6}$/i.test(lower)) return lower;
    return DEFAULT_COLOR;
}

/* ------------------------------------------------------------------ */
/*  Layout constants                                                  */
/* ------------------------------------------------------------------ */

const BOX_W = 240;
const BOX_H = 90;
const BOX_H_WITH_DESC = 120;
const GAP_X = 60;
const GAP_Y = 50;
const TITLE_FONT_SIZE = 24;
const LABEL_FONT_SIZE = 20;
const DESC_FONT_SIZE = 14;
const TITLE_MARGIN_BOTTOM = 40;

/* ------------------------------------------------------------------ */
/*  Element builders                                                  */
/* ------------------------------------------------------------------ */

let seedCounter = 1000;

function nextSeed(): number {
    return ++seedCounter;
}

function buildBaseProps(
    id: string,
    x: number,
    y: number,
    w: number,
    h: number,
    bgColor: string,
): Omit<ExcalidrawBaseElement, 'type'> {
    return {
        id,
        x,
        y,
        width: w,
        height: h,
        angle: 0,
        strokeColor: '#1e1e1e',
        backgroundColor: bgColor,
        fillStyle: 'solid',
        strokeWidth: 2,
        strokeStyle: 'solid',
        roughness: 0,
        opacity: 100,
        seed: nextSeed(),
        version: 1,
        versionNonce: nextSeed(),
        isDeleted: false,
        groupIds: [],
        frameId: null,
        roundness: { type: 3 },
        boundElements: null,
        updated: 1,
        link: null,
        locked: false,
    };
}

function buildRectangle(
    id: string,
    x: number,
    y: number,
    w: number,
    h: number,
    bgColor: string,
): ExcalidrawRectangle {
    return {
        ...buildBaseProps(id, x, y, w, h, bgColor),
        type: 'rectangle',
    };
}

function buildText(
    id: string,
    x: number,
    y: number,
    w: number,
    h: number,
    text: string,
    fontSize: number,
): ExcalidrawText {
    return {
        ...buildBaseProps(id, x, y, w, h, 'transparent'),
        type: 'text',
        strokeColor: '#1e1e1e',
        fontSize,
        fontFamily: 1,
        text,
        textAlign: 'center',
        verticalAlign: 'middle',
        containerId: null,
        originalText: text,
        autoResize: true,
        lineHeight: 1.25,
    };
}

/* ------------------------------------------------------------------ */
/*  Tool class                                                        */
/* ------------------------------------------------------------------ */

export class CreateExcalidrawTool extends BaseTool<'create_excalidraw'> {
    readonly name = 'create_excalidraw' as const;
    readonly isWriteOperation = true;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'create_excalidraw',
            description:
                'Create an Excalidraw drawing (.excalidraw.md) with labeled boxes. ' +
                'The file format is handled automatically — never use write_file for .excalidraw.md files. ' +
                'Supports colored boxes with labels and optional descriptions.',
            input_schema: {
                type: 'object',
                properties: {
                    output_path: {
                        type: 'string',
                        description:
                            'Path for the drawing file (must end with .excalidraw.md, e.g. "Drawings/overview.excalidraw.md")',
                    },
                    elements: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                label: {
                                    type: 'string',
                                    description: 'Text displayed in the box',
                                },
                                color: {
                                    type: 'string',
                                    description:
                                        'Background color: blue, green, yellow, red, purple, orange, gray, cyan, pink, white, or hex (#a5d8ff). Default: blue.',
                                },
                                description: {
                                    type: 'string',
                                    description: 'Optional subtext below the label',
                                },
                            },
                            required: ['label'],
                        },
                        description: 'Array of boxes to draw (max 12)',
                    },
                    title: {
                        type: 'string',
                        description: 'Optional title text displayed above the boxes',
                    },
                    layout: {
                        type: 'string',
                        enum: ['grid', 'row'],
                        description: '"grid" (2 columns, default) or "row" (single horizontal row)',
                    },
                },
                required: ['output_path', 'elements'],
            },
        };
    }

    async execute(input: Record<string, any>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const outputPath = ((input.output_path as string) ?? '').trim();
        const rawElements = Array.isArray(input.elements) ? input.elements : [];
        const title = ((input.title as string) ?? '').trim();
        const layout: 'grid' | 'row' = input.layout === 'row' ? 'row' : 'grid';

        // Validation
        if (!outputPath) {
            callbacks.pushToolResult(this.formatError(new Error('output_path is required')));
            return;
        }
        if (!outputPath.endsWith('.excalidraw.md')) {
            callbacks.pushToolResult(
                this.formatError(new Error('output_path must end with .excalidraw.md')),
            );
            return;
        }
        if (rawElements.length === 0) {
            callbacks.pushToolResult(
                this.formatError(new Error('At least one element is required')),
            );
            return;
        }

        const elements = rawElements.slice(0, 12); // Cap at 12 boxes
        seedCounter = 1000; // Reset for deterministic output

        try {
            const sceneElements: ExcalidrawElement[] = [];
            let startY = 0;

            // Optional title
            if (title) {
                const titleW = Math.max(BOX_W * 2 + GAP_X, 400);
                sceneElements.push(
                    buildText('title', 0, 0, titleW, 40, title, TITLE_FONT_SIZE),
                );
                startY = TITLE_MARGIN_BOTTOM + 40;
            }

            // Layout boxes
            const cols = layout === 'row' ? elements.length : 2;

            for (let i = 0; i < elements.length; i++) {
                const elem = elements[i];
                const label: string = elem.label ?? `Box ${i + 1}`;
                const color = resolveColor(elem.color);
                const desc: string = (elem.description ?? '').trim();
                const hasDesc = desc.length > 0;

                const col = i % cols;
                const row = Math.floor(i / cols);
                const boxH = hasDesc ? BOX_H_WITH_DESC : BOX_H;
                const x = col * (BOX_W + GAP_X);
                const y = startY + row * (BOX_H_WITH_DESC + GAP_Y);

                const rectId = `rect-${i}`;
                const labelId = `label-${i}`;

                // Rectangle
                sceneElements.push(buildRectangle(rectId, x, y, BOX_W, boxH, color));

                if (hasDesc) {
                    // Label at top of box
                    sceneElements.push(
                        buildText(labelId, x, y + 8, BOX_W, 36, label, LABEL_FONT_SIZE),
                    );
                    // Description below
                    sceneElements.push(
                        buildText(`desc-${i}`, x, y + 44, BOX_W, 60, desc, DESC_FONT_SIZE),
                    );
                } else {
                    // Centered label
                    sceneElements.push(
                        buildText(labelId, x, y, BOX_W, boxH, label, LABEL_FONT_SIZE),
                    );
                }
            }

            // Build scene
            const scene: ExcalidrawScene = {
                type: 'excalidraw',
                version: 2,
                elements: sceneElements,
                appState: {
                    viewBackgroundColor: '#ffffff',
                },
            };

            const json = JSON.stringify(scene, null, 2);

            // Build .excalidraw.md wrapper (Obsidian Excalidraw plugin format)
            const textElements = sceneElements
                .filter((el): el is ExcalidrawText => el.type === 'text')
                .map((el) => `${el.text} ^${el.id}`)
                .join('\n\n');

            const fileContent = [
                '---',
                '',
                'excalidraw-plugin: parsed',
                'tags: [excalidraw]',
                '',
                '---',
                '==⚠  Switch to MOBILE VIEW to edit this on mobile ⚠==',
                '',
                '# Excalidraw Data',
                '',
                '## Text Elements',
                textElements,
                '',
                '## Drawing',
                '```json',
                json,
                '```',
                '',
                '%%',
            ].join('\n');

            // Write file
            const existing = this.app.vault.getFileByPath(outputPath);
            if (existing) {
                await this.app.vault.modify(existing, fileContent);
            } else {
                const dir = outputPath.includes('/')
                    ? outputPath.split('/').slice(0, -1).join('/')
                    : null;
                if (dir) {
                    await this.app.vault.createFolder(dir).catch(() => { /* already exists */ });
                }
                await this.app.vault.create(outputPath, fileContent);
            }

            callbacks.pushToolResult(
                `Excalidraw drawing created: **${outputPath}**\n` +
                `- ${elements.length} boxes\n` +
                (title ? `- Title: "${title}"\n` : '') +
                `- Layout: ${layout}\n\n` +
                `Open the file in Obsidian to view the drawing.`,
            );
            callbacks.log(
                `Created Excalidraw drawing: ${outputPath} (${elements.length} boxes)`,
            );
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('create_excalidraw', error);
        }
    }
}
