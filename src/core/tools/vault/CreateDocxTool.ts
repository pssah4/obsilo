/**
 * CreateDocxTool
 *
 * Creates a Word document (.docx) with structured sections, headings,
 * paragraphs, bullet lists, numbered lists, and tables.
 * Uses the 'docx' library for generation.
 */

import {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    Table,
    TableRow,
    TableCell,
    WidthType,
    BorderStyle,
    AlignmentType,
    ShadingType,
    LevelFormat,
} from 'docx';
import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';
import { writeBinaryToVault } from './writeBinaryToVault';

/* ------------------------------------------------------------------ */
/*  Input interfaces                                                  */
/* ------------------------------------------------------------------ */

interface SectionInput {
    heading?: string;
    level?: number;
    body?: string;
    bullets?: string[];
    numberedList?: string[];
    table?: {
        headers?: string[];
        rows?: (string | number | null)[][];
    };
}

interface ThemeInput {
    primary_color?: string;
    font_family?: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const DEFAULT_FONT = 'Calibri';
const DEFAULT_PRIMARY = '2B579A';
const HEADING_LEVEL_MAP: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
    1: HeadingLevel.HEADING_1,
    2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3,
    4: HeadingLevel.HEADING_4,
    5: HeadingLevel.HEADING_5,
    6: HeadingLevel.HEADING_6,
};

/* ------------------------------------------------------------------ */
/*  Helper: resolve color                                             */
/* ------------------------------------------------------------------ */

function resolveHexColor(color?: string, fallback = DEFAULT_PRIMARY): string {
    if (!color) return fallback;
    const trimmed = color.trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed;
    return fallback;
}

/* ------------------------------------------------------------------ */
/*  Tool class                                                        */
/* ------------------------------------------------------------------ */

export class CreateDocxTool extends BaseTool<'create_docx'> {
    readonly name = 'create_docx' as const;
    readonly isWriteOperation = true;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'create_docx',
            description:
                'Create a Word document (.docx) with structured sections containing headings, paragraphs, ' +
                'bullet lists, numbered lists, and tables. ' +
                'The file format is handled automatically -- never use write_file or evaluate_expression for .docx files.',
            input_schema: {
                type: 'object',
                properties: {
                    output_path: {
                        type: 'string',
                        description:
                            'Path for the document file (must end with .docx, e.g. "Documents/report.docx")',
                    },
                    sections: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                heading: {
                                    type: 'string',
                                    description: 'Section heading text',
                                },
                                level: {
                                    type: 'number',
                                    description: 'Heading level 1-6 (default: 1)',
                                },
                                body: {
                                    type: 'string',
                                    description: 'Body text (paragraphs separated by blank lines)',
                                },
                                bullets: {
                                    type: 'array',
                                    items: { type: 'string' },
                                    description: 'Bullet point list',
                                },
                                numberedList: {
                                    type: 'array',
                                    items: { type: 'string' },
                                    description: 'Numbered list items',
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
                            },
                        },
                        description: 'Array of content sections (max 100)',
                    },
                    title: {
                        type: 'string',
                        description: 'Document title (displayed as cover heading and in metadata)',
                    },
                    theme: {
                        type: 'object',
                        properties: {
                            primary_color: {
                                type: 'string',
                                description: 'Primary color as hex (e.g. "#2B579A"). Default: Word blue.',
                            },
                            font_family: {
                                type: 'string',
                                description: 'Font family (e.g. "Calibri", "Arial"). Default: Calibri.',
                            },
                        },
                        description: 'Optional theme settings',
                    },
                },
                required: ['output_path', 'sections'],
            },
        };
    }

    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const outputPath = ((input.output_path as string) ?? '').trim();
        const rawSections = Array.isArray(input.sections) ? (input.sections as SectionInput[]) : [];
        const docTitle = ((input.title as string) ?? '').trim();
        const theme = (input.theme as ThemeInput) ?? {};

        // Validation
        if (!outputPath) {
            callbacks.pushToolResult(this.formatError(new Error('output_path is required')));
            return;
        }
        if (!outputPath.endsWith('.docx')) {
            callbacks.pushToolResult(this.formatError(new Error('output_path must end with .docx')));
            return;
        }
        if (rawSections.length === 0) {
            callbacks.pushToolResult(this.formatError(new Error('At least one section is required')));
            return;
        }

        const sections = rawSections.slice(0, 100);
        const primaryColor = resolveHexColor(theme.primary_color);
        const fontFamily = theme.font_family?.trim() || DEFAULT_FONT;

        try {
            const children: (Paragraph | Table)[] = [];

            // Title page
            if (docTitle) {
                children.push(
                    new Paragraph({
                        children: [
                            new TextRun({
                                text: docTitle,
                                bold: true,
                                size: 56,
                                font: fontFamily,
                                color: primaryColor,
                            }),
                        ],
                        spacing: { after: 400 },
                        alignment: AlignmentType.CENTER,
                    }),
                    new Paragraph({ spacing: { after: 200 } }),
                );
            }

            // Build content sections
            for (const section of sections) {
                // Heading
                if (section.heading) {
                    const level = Math.min(Math.max(section.level ?? 1, 1), 6);
                    children.push(
                        new Paragraph({
                            text: section.heading,
                            heading: HEADING_LEVEL_MAP[level] ?? HeadingLevel.HEADING_1,
                            spacing: { before: 240, after: 120 },
                        }),
                    );
                }

                // Body text
                if (section.body) {
                    const paragraphs = section.body.split(/\n\n+/);
                    for (const para of paragraphs) {
                        if (para.trim().length === 0) continue;
                        children.push(
                            new Paragraph({
                                children: [
                                    new TextRun({
                                        text: para.trim(),
                                        font: fontFamily,
                                        size: 24,
                                    }),
                                ],
                                spacing: { after: 160 },
                            }),
                        );
                    }
                }

                // Bullet list
                if (section.bullets && section.bullets.length > 0) {
                    for (const bullet of section.bullets) {
                        children.push(
                            new Paragraph({
                                children: [
                                    new TextRun({
                                        text: bullet,
                                        font: fontFamily,
                                        size: 24,
                                    }),
                                ],
                                bullet: { level: 0 },
                                spacing: { after: 60 },
                            }),
                        );
                    }
                    children.push(new Paragraph({ spacing: { after: 120 } }));
                }

                // Numbered list
                if (section.numberedList && section.numberedList.length > 0) {
                    for (const item of section.numberedList) {
                        children.push(
                            new Paragraph({
                                children: [
                                    new TextRun({
                                        text: item,
                                        font: fontFamily,
                                        size: 24,
                                    }),
                                ],
                                numbering: {
                                    reference: 'default-numbering',
                                    level: 0,
                                },
                                spacing: { after: 60 },
                            }),
                        );
                    }
                    children.push(new Paragraph({ spacing: { after: 120 } }));
                }

                // Table
                if (section.table) {
                    const table = this.buildTable(section.table, primaryColor, fontFamily);
                    if (table) {
                        children.push(table);
                        children.push(new Paragraph({ spacing: { after: 200 } }));
                    }
                }
            }

            // Build document
            const doc = new Document({
                creator: 'Obsilo Agent',
                title: docTitle || undefined,
                numbering: {
                    config: [
                        {
                            reference: 'default-numbering',
                            levels: [
                                {
                                    level: 0,
                                    format: LevelFormat.DECIMAL,
                                    text: '%1.',
                                    alignment: AlignmentType.START,
                                },
                            ],
                        },
                    ],
                },
                sections: [
                    {
                        children,
                    },
                ],
            });

            // Generate binary
            const buffer = await Packer.toBuffer(doc);
            const arrayBuffer = buffer.buffer.slice(
                buffer.byteOffset,
                buffer.byteOffset + buffer.byteLength,
            );

            // Write to vault
            const result = await writeBinaryToVault(
                this.app.vault,
                outputPath,
                arrayBuffer,
                '.docx',
            );

            const action = result.created ? 'Created' : 'Updated';
            const sizeKB = Math.round(result.size / 1024);
            callbacks.pushToolResult(
                `${action} Word document: **${outputPath}**\n` +
                `- ${sections.length} section${sections.length !== 1 ? 's' : ''}\n` +
                (docTitle ? `- Title: "${docTitle}"\n` : '') +
                `- Size: ${sizeKB} KB\n\n` +
                `Download or open the file to view the document.`,
            );
            callbacks.log(`${action} DOCX: ${outputPath} (${sections.length} sections, ${sizeKB} KB)`);
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('create_docx', error);
        }
    }

    /* -------------------------------------------------------------- */
    /*  Table builder                                                  */
    /* -------------------------------------------------------------- */

    private buildTable(
        tableInput: NonNullable<SectionInput['table']>,
        primaryColor: string,
        fontFamily: string,
    ): Table | null {
        const allRows: TableRow[] = [];
        const colCount = Math.max(
            tableInput.headers?.length ?? 0,
            tableInput.rows?.[0]?.length ?? 0,
            1,
        );

        // Header row
        if (tableInput.headers && tableInput.headers.length > 0) {
            allRows.push(
                new TableRow({
                    tableHeader: true,
                    children: tableInput.headers.map(h =>
                        new TableCell({
                            children: [
                                new Paragraph({
                                    children: [
                                        new TextRun({
                                            text: String(h),
                                            bold: true,
                                            font: fontFamily,
                                            size: 22,
                                            color: 'FFFFFF',
                                        }),
                                    ],
                                    alignment: AlignmentType.CENTER,
                                }),
                            ],
                            shading: {
                                type: ShadingType.SOLID,
                                color: primaryColor,
                                fill: primaryColor,
                            },
                            width: {
                                size: Math.floor(100 / colCount),
                                type: WidthType.PERCENTAGE,
                            },
                        }),
                    ),
                }),
            );
        }

        // Data rows
        if (tableInput.rows) {
            for (const row of tableInput.rows) {
                const cells = (row as (string | number | null)[]).map(cell =>
                    new TableCell({
                        children: [
                            new Paragraph({
                                children: [
                                    new TextRun({
                                        text: cell !== null && cell !== undefined ? String(cell) : '',
                                        font: fontFamily,
                                        size: 22,
                                    }),
                                ],
                            }),
                        ],
                        width: {
                            size: Math.floor(100 / colCount),
                            type: WidthType.PERCENTAGE,
                        },
                    }),
                );

                // Pad if fewer cells than columns
                while (cells.length < colCount) {
                    cells.push(
                        new TableCell({
                            children: [new Paragraph({})],
                            width: { size: Math.floor(100 / colCount), type: WidthType.PERCENTAGE },
                        }),
                    );
                }

                allRows.push(new TableRow({ children: cells }));
            }
        }

        if (allRows.length === 0) return null;

        return new Table({
            rows: allRows,
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: {
                top: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
                bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
                left: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
                right: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
                insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
                insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
            },
        });
    }
}
