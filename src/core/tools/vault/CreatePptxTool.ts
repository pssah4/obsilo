/**
 * CreatePptxTool
 *
 * Creates a PowerPoint presentation (.pptx) with slides, text, tables, and images.
 * Format knowledge lives in TypeScript code -- the LLM only provides
 * high-level input (slide content, theme). The tool handles layout and
 * formatting programmatically using pptxgenjs.
 */

import PptxGenJS from 'pptxgenjs';
import { TFile } from 'obsidian';
import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';
import { writeBinaryToVault } from './writeBinaryToVault';

/* ------------------------------------------------------------------ */
/*  Layout constants                                                  */
/* ------------------------------------------------------------------ */

const SLIDE_W = 10;     // inches
const SLIDE_H = 7.5;    // inches (4:3)
const MARGIN = 0.5;     // inches
const TITLE_Y = 0.4;
const TITLE_H = 1.0;
const CONTENT_Y = 1.6;
const CONTENT_H = SLIDE_H - CONTENT_Y - MARGIN;
const CONTENT_W = SLIDE_W - MARGIN * 2;

const DEFAULT_FONT = 'Calibri';
const DEFAULT_PRIMARY = '#1a73e8';

/* ------------------------------------------------------------------ */
/*  Input interfaces                                                  */
/* ------------------------------------------------------------------ */

interface SlideInput {
    title?: string;
    subtitle?: string;
    body?: string;
    bullets?: string[];
    table?: {
        headers?: string[];
        rows?: (string | number | null)[][];
    };
    image?: string;
    notes?: string;
}

interface ThemeInput {
    primary_color?: string;
    font_family?: string;
}

/* ------------------------------------------------------------------ */
/*  Helper: resolve color with fallback                               */
/* ------------------------------------------------------------------ */

function resolveColor(color?: string, fallback = DEFAULT_PRIMARY): string {
    if (!color) return fallback;
    const trimmed = color.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed;
    return fallback;
}

/* ------------------------------------------------------------------ */
/*  Tool class                                                        */
/* ------------------------------------------------------------------ */

export class CreatePptxTool extends BaseTool<'create_pptx'> {
    readonly name = 'create_pptx' as const;
    readonly isWriteOperation = true;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'create_pptx',
            description:
                'Create a PowerPoint presentation (.pptx) with slides containing text, bullets, tables, and images. ' +
                'The file format is handled automatically -- never use write_file or evaluate_expression for .pptx files. ' +
                'Supports themed presentations with auto-layout.',
            input_schema: {
                type: 'object',
                properties: {
                    output_path: {
                        type: 'string',
                        description:
                            'Path for the presentation file (must end with .pptx, e.g. "Presentations/quarterly.pptx")',
                    },
                    slides: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                title: {
                                    type: 'string',
                                    description: 'Slide title (displayed at top)',
                                },
                                subtitle: {
                                    type: 'string',
                                    description: 'Subtitle text (only for title slides)',
                                },
                                body: {
                                    type: 'string',
                                    description: 'Body paragraph text',
                                },
                                bullets: {
                                    type: 'array',
                                    items: { type: 'string' },
                                    description: 'Bullet point list',
                                },
                                table: {
                                    type: 'object',
                                    properties: {
                                        headers: {
                                            type: 'array',
                                            items: { type: 'string' },
                                            description: 'Table column headers',
                                        },
                                        rows: {
                                            type: 'array',
                                            items: {
                                                type: 'array',
                                                items: {},
                                            },
                                            description: 'Table data rows (2D array)',
                                        },
                                    },
                                },
                                image: {
                                    type: 'string',
                                    description: 'Vault path to an image file to embed on the slide',
                                },
                                notes: {
                                    type: 'string',
                                    description: 'Speaker notes for this slide',
                                },
                            },
                        },
                        description: 'Array of slides (max 50)',
                    },
                    title: {
                        type: 'string',
                        description: 'Presentation title (used as metadata and optional title slide)',
                    },
                    theme: {
                        type: 'object',
                        properties: {
                            primary_color: {
                                type: 'string',
                                description: 'Primary accent color as hex (e.g. "#1a73e8"). Default: blue.',
                            },
                            font_family: {
                                type: 'string',
                                description: 'Font family name (e.g. "Calibri", "Arial"). Default: Calibri.',
                            },
                        },
                        description: 'Optional theme settings',
                    },
                },
                required: ['output_path', 'slides'],
            },
        };
    }

    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const outputPath = ((input.output_path as string) ?? '').trim();
        const rawSlides = Array.isArray(input.slides) ? (input.slides as SlideInput[]) : [];
        const presTitle = ((input.title as string) ?? '').trim();
        const theme = (input.theme as ThemeInput) ?? {};

        // Validation
        if (!outputPath) {
            callbacks.pushToolResult(this.formatError(new Error('output_path is required')));
            return;
        }
        if (!outputPath.endsWith('.pptx')) {
            callbacks.pushToolResult(this.formatError(new Error('output_path must end with .pptx')));
            return;
        }
        if (rawSlides.length === 0) {
            callbacks.pushToolResult(this.formatError(new Error('At least one slide is required')));
            return;
        }

        const slides = rawSlides.slice(0, 50);
        const primaryColor = resolveColor(theme.primary_color);
        const fontFamily = theme.font_family?.trim() || DEFAULT_FONT;

        try {
            const pres = new PptxGenJS();
            pres.layout = 'LAYOUT_4x3';
            if (presTitle) pres.title = presTitle;
            pres.author = 'Obsilo Agent';

            for (const slideInput of slides) {
                const slide = pres.addSlide();

                // Speaker notes
                if (slideInput.notes) {
                    slide.addNotes(slideInput.notes);
                }

                const isTitleSlide = slideInput.subtitle !== undefined
                    && !slideInput.body && !slideInput.bullets && !slideInput.table && !slideInput.image;

                if (isTitleSlide) {
                    // Title slide layout: centered title + subtitle
                    this.addTitleSlide(slide, slideInput, primaryColor, fontFamily);
                } else {
                    // Content slide layout
                    await this.addContentSlide(slide, slideInput, primaryColor, fontFamily);
                }
            }

            // Generate binary
            const arrayBuffer = await pres.write({ outputType: 'arraybuffer' }) as ArrayBuffer;

            // Write to vault
            const result = await writeBinaryToVault(
                this.app.vault,
                outputPath,
                arrayBuffer,
                '.pptx',
            );

            const action = result.created ? 'Created' : 'Updated';
            const sizeKB = Math.round(result.size / 1024);
            callbacks.pushToolResult(
                `${action} PowerPoint presentation: **${outputPath}**\n` +
                `- ${slides.length} slide${slides.length !== 1 ? 's' : ''}\n` +
                (presTitle ? `- Title: "${presTitle}"\n` : '') +
                `- Size: ${sizeKB} KB\n\n` +
                `Download or open the file to view the presentation.`,
            );
            callbacks.log(`${action} PPTX: ${outputPath} (${slides.length} slides, ${sizeKB} KB)`);
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('create_pptx', error);
        }
    }

    /* -------------------------------------------------------------- */
    /*  Slide builders                                                 */
    /* -------------------------------------------------------------- */

    private addTitleSlide(
        slide: PptxGenJS.Slide,
        input: SlideInput,
        primaryColor: string,
        fontFamily: string,
    ): void {
        // Title centered
        if (input.title) {
            slide.addText(input.title, {
                x: MARGIN,
                y: 2.0,
                w: CONTENT_W,
                h: 1.5,
                fontSize: 36,
                fontFace: fontFamily,
                color: primaryColor.replace('#', ''),
                bold: true,
                align: 'center',
                valign: 'bottom',
            });
        }

        // Subtitle below
        if (input.subtitle) {
            slide.addText(input.subtitle, {
                x: MARGIN,
                y: 3.8,
                w: CONTENT_W,
                h: 1.0,
                fontSize: 20,
                fontFace: fontFamily,
                color: '666666',
                align: 'center',
                valign: 'top',
            });
        }
    }

    private async addContentSlide(
        slide: PptxGenJS.Slide,
        input: SlideInput,
        primaryColor: string,
        fontFamily: string,
    ): Promise<void> {
        let contentY = CONTENT_Y;

        // Title at top
        if (input.title) {
            slide.addText(input.title, {
                x: MARGIN,
                y: TITLE_Y,
                w: CONTENT_W,
                h: TITLE_H,
                fontSize: 28,
                fontFace: fontFamily,
                color: primaryColor.replace('#', ''),
                bold: true,
                valign: 'middle',
            });
        }

        // Body text
        if (input.body) {
            const bodyH = this.estimateTextHeight(input.body, 18);
            slide.addText(input.body, {
                x: MARGIN,
                y: contentY,
                w: CONTENT_W,
                h: bodyH,
                fontSize: 18,
                fontFace: fontFamily,
                color: '333333',
                valign: 'top',
                wrap: true,
            });
            contentY += bodyH + 0.2;
        }

        // Bullet points
        if (input.bullets && input.bullets.length > 0) {
            const bulletText = input.bullets.map(b => ({
                text: b,
                options: {
                    fontSize: 18,
                    fontFace: fontFamily,
                    color: '333333',
                    bullet: { type: 'bullet' as const },
                    paraSpaceAfter: 6,
                },
            }));
            const bulletH = Math.min(input.bullets.length * 0.5 + 0.3, CONTENT_H - (contentY - CONTENT_Y));
            slide.addText(bulletText, {
                x: MARGIN,
                y: contentY,
                w: CONTENT_W,
                h: bulletH,
                valign: 'top',
            });
            contentY += bulletH + 0.2;
        }

        // Table
        if (input.table) {
            this.addTable(slide, input.table, contentY, primaryColor, fontFamily);
        }

        // Image from vault
        if (input.image) {
            await this.addImage(slide, input.image, contentY);
        }
    }

    private addTable(
        slide: PptxGenJS.Slide,
        table: NonNullable<SlideInput['table']>,
        startY: number,
        primaryColor: string,
        fontFamily: string,
    ): void {
        const tableRows: PptxGenJS.TableRow[] = [];

        // Header row
        if (table.headers && table.headers.length > 0) {
            tableRows.push(
                table.headers.map(h => ({
                    text: String(h),
                    options: {
                        bold: true,
                        color: 'FFFFFF',
                        fill: { color: primaryColor.replace('#', '') },
                        fontSize: 14,
                        fontFace: fontFamily,
                    },
                })),
            );
        }

        // Data rows
        if (table.rows) {
            for (const row of table.rows) {
                tableRows.push(
                    (row as (string | number | null)[]).map(cell => ({
                        text: cell !== null && cell !== undefined ? String(cell) : '',
                        options: {
                            fontSize: 13,
                            fontFace: fontFamily,
                            color: '333333',
                        },
                    })),
                );
            }
        }

        if (tableRows.length > 0) {
            const remainingH = SLIDE_H - startY - MARGIN;
            slide.addTable(tableRows, {
                x: MARGIN,
                y: startY,
                w: CONTENT_W,
                h: Math.min(tableRows.length * 0.4 + 0.2, remainingH),
                border: { type: 'solid', pt: 0.5, color: 'CCCCCC' },
                colW: Array(tableRows[0].length).fill(CONTENT_W / tableRows[0].length),
                autoPage: true,
            });
        }
    }

    private async addImage(
        slide: PptxGenJS.Slide,
        imagePath: string,
        startY: number,
    ): Promise<void> {
        try {
            const file = this.app.vault.getAbstractFileByPath(imagePath);
            if (!(file instanceof TFile)) {
                // Image not found -- add placeholder text instead
                slide.addText(`[Image not found: ${imagePath}]`, {
                    x: MARGIN,
                    y: startY,
                    w: CONTENT_W,
                    h: 1,
                    fontSize: 14,
                    color: '999999',
                    italic: true,
                });
                return;
            }

            const buffer = await this.app.vault.readBinary(file);
            const ext = file.extension.toLowerCase();
            const mimeMap: Record<string, string> = {
                png: 'image/png',
                jpg: 'image/jpeg',
                jpeg: 'image/jpeg',
                gif: 'image/gif',
                svg: 'image/svg+xml',
            };
            const mime = mimeMap[ext] ?? 'image/png';

            // Convert to base64 data URI
            const uint8 = new Uint8Array(buffer);
            let binary = '';
            for (let i = 0; i < uint8.length; i++) {
                binary += String.fromCharCode(uint8[i]);
            }
            const base64 = btoa(binary);
            const dataUri = `data:${mime};base64,${base64}`;

            const remainingH = SLIDE_H - startY - MARGIN;
            slide.addImage({
                data: dataUri,
                x: MARGIN + 1.0,
                y: startY,
                w: CONTENT_W - 2.0,
                h: Math.min(remainingH, 4.0),
                sizing: { type: 'contain', w: CONTENT_W - 2.0, h: Math.min(remainingH, 4.0) },
            });
        } catch {
            slide.addText(`[Error loading image: ${imagePath}]`, {
                x: MARGIN,
                y: startY,
                w: CONTENT_W,
                h: 1,
                fontSize: 14,
                color: 'CC0000',
                italic: true,
            });
        }
    }

    /* -------------------------------------------------------------- */
    /*  Utility                                                        */
    /* -------------------------------------------------------------- */

    private estimateTextHeight(text: string, fontSize: number): number {
        const charsPerLine = Math.floor((CONTENT_W * 72) / fontSize);
        const lines = text.split('\n').reduce((count, line) => {
            return count + Math.max(1, Math.ceil(line.length / charsPerLine));
        }, 0);
        return Math.min(Math.max(lines * (fontSize / 72) * 1.4, 0.8), CONTENT_H);
    }
}
