/**
 * CreateXlsxTool
 *
 * Creates an Excel spreadsheet (.xlsx) with sheets, headers, data rows,
 * and optional formulas. Uses exceljs for generation.
 */

import ExcelJS from 'exceljs';
import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';
import { writeBinaryToVault } from './writeBinaryToVault';

/* ------------------------------------------------------------------ */
/*  Input interfaces                                                  */
/* ------------------------------------------------------------------ */

interface SheetInput {
    name?: string;
    headers?: string[];
    rows?: (string | number | boolean | null)[][];
    columnWidths?: number[];
    formulas?: Record<string, string>;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const DEFAULT_COL_WIDTH = 15;
const HEADER_FILL = '4472C4';
const HEADER_FONT_COLOR = 'FFFFFF';

/* ------------------------------------------------------------------ */
/*  Tool class                                                        */
/* ------------------------------------------------------------------ */

export class CreateXlsxTool extends BaseTool<'create_xlsx'> {
    readonly name = 'create_xlsx' as const;
    readonly isWriteOperation = true;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'create_xlsx',
            description:
                'Create an Excel spreadsheet (.xlsx) with sheets, headers, data rows, and optional formulas. ' +
                'The file format is handled automatically -- never use write_file or evaluate_expression for .xlsx files.',
            input_schema: {
                type: 'object',
                properties: {
                    output_path: {
                        type: 'string',
                        description:
                            'Path for the spreadsheet file (must end with .xlsx, e.g. "Data/budget.xlsx")',
                    },
                    sheets: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                name: {
                                    type: 'string',
                                    description: 'Sheet name (default: "Sheet1", "Sheet2", ...)',
                                },
                                headers: {
                                    type: 'array',
                                    items: { type: 'string' },
                                    description: 'Column header labels',
                                },
                                rows: {
                                    type: 'array',
                                    items: {
                                        type: 'array',
                                        items: {},
                                    },
                                    description: 'Data rows (2D array of values)',
                                },
                                columnWidths: {
                                    type: 'array',
                                    items: { type: 'number' },
                                    description: 'Optional column widths in characters',
                                },
                                formulas: {
                                    type: 'object',
                                    description: 'Cell formulas as {"A2": "SUM(B2:B10)", "C1": "AVERAGE(C2:C5)"}',
                                },
                            },
                        },
                        description: 'Array of sheets to create (max 20)',
                    },
                },
                required: ['output_path', 'sheets'],
            },
        };
    }

    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const outputPath = ((input.output_path as string) ?? '').trim();
        const rawSheets = Array.isArray(input.sheets) ? (input.sheets as SheetInput[]) : [];

        // Validation
        if (!outputPath) {
            callbacks.pushToolResult(this.formatError(new Error('output_path is required')));
            return;
        }
        if (!outputPath.endsWith('.xlsx')) {
            callbacks.pushToolResult(this.formatError(new Error('output_path must end with .xlsx')));
            return;
        }
        if (rawSheets.length === 0) {
            callbacks.pushToolResult(this.formatError(new Error('At least one sheet is required')));
            return;
        }

        const sheets = rawSheets.slice(0, 20);

        try {
            const workbook = new ExcelJS.Workbook();
            workbook.creator = 'Obsilo Agent';
            let totalRows = 0;

            for (let i = 0; i < sheets.length; i++) {
                const sheetInput = sheets[i];
                const sheetName = sheetInput.name?.trim() || `Sheet${i + 1}`;
                const worksheet = workbook.addWorksheet(sheetName);

                const colCount = Math.max(
                    sheetInput.headers?.length ?? 0,
                    sheetInput.rows?.[0]?.length ?? 0,
                    1,
                );

                // Column widths
                const widths = sheetInput.columnWidths ?? [];
                worksheet.columns = Array.from({ length: colCount }, (_, ci) => ({
                    width: widths[ci] ?? DEFAULT_COL_WIDTH,
                }));

                // Header row
                if (sheetInput.headers && sheetInput.headers.length > 0) {
                    const headerRow = worksheet.addRow(sheetInput.headers);
                    headerRow.eachCell((cell) => {
                        cell.font = { bold: true, color: { argb: HEADER_FONT_COLOR } };
                        cell.fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: HEADER_FILL },
                        };
                        cell.alignment = { horizontal: 'center', vertical: 'middle' };
                    });
                    totalRows++;
                }

                // Data rows
                if (sheetInput.rows) {
                    for (const row of sheetInput.rows) {
                        const values = (row as (string | number | boolean | null)[]).map(v =>
                            v === null || v === undefined ? '' : v,
                        );
                        worksheet.addRow(values);
                        totalRows++;
                    }
                }

                // Formulas
                if (sheetInput.formulas) {
                    for (const [cellRef, formula] of Object.entries(sheetInput.formulas)) {
                        const cell = worksheet.getCell(cellRef);
                        cell.value = { formula: formula } as ExcelJS.CellFormulaValue;
                    }
                }

                // Auto-filter on header row if headers exist
                if (sheetInput.headers && sheetInput.headers.length > 0) {
                    worksheet.autoFilter = {
                        from: { row: 1, column: 1 },
                        to: { row: 1, column: colCount },
                    };
                }
            }

            // Generate buffer
            const buffer = await workbook.xlsx.writeBuffer();
            const arrayBuffer = (buffer as ArrayBuffer).byteLength !== undefined
                ? buffer as ArrayBuffer
                : (buffer as Buffer).buffer.slice(
                    (buffer as Buffer).byteOffset,
                    (buffer as Buffer).byteOffset + (buffer as Buffer).byteLength,
                );

            // Write to vault
            const result = await writeBinaryToVault(
                this.app.vault,
                outputPath,
                arrayBuffer,
                '.xlsx',
            );

            const action = result.created ? 'Created' : 'Updated';
            const sizeKB = Math.round(result.size / 1024);
            callbacks.pushToolResult(
                `${action} Excel spreadsheet: **${outputPath}**\n` +
                `- ${sheets.length} sheet${sheets.length !== 1 ? 's' : ''}\n` +
                `- ${totalRows} total rows\n` +
                `- Size: ${sizeKB} KB\n\n` +
                `Download or open the file to view the spreadsheet.`,
            );
            callbacks.log(`${action} XLSX: ${outputPath} (${sheets.length} sheets, ${totalRows} rows, ${sizeKB} KB)`);
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('create_xlsx', error);
        }
    }
}
