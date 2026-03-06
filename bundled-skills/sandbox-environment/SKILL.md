---
name: sandbox-environment
description: Sandbox API reference, proven patterns, and library recommendations for evaluate_expression
trigger: sandbox|evaluate|pptx|xlsx|pdf|binary|generate|erstelle.*datei|code.*modul
source: bundled
requiredTools: [evaluate_expression]
---

# Sandbox Environment Reference

## Available APIs

### ctx.vault
- `ctx.vault.read(path: string): Promise<string>` -- Read text file
- `ctx.vault.readBinary(path: string): Promise<ArrayBuffer>` -- Read binary file
- `ctx.vault.write(path: string, content: string): Promise<void>` -- Write text (max 10MB, no writes to .obsidian/)
- `ctx.vault.writeBinary(path: string, content: ArrayBuffer): Promise<void>` -- Write binary (max 10MB)
- `ctx.vault.list(path: string): Promise<string[]>` -- List folder contents

### ctx.requestUrl
- `ctx.requestUrl(url: string, options?: {method?: string, body?: string}): Promise<{status: number, text: string}>`
- HTTPS only. Allowed domains: esm.sh, cdn.jsdelivr.net, unpkg.com, registry.npmjs.org
- Rate limit: 5 requests/minute

### Standard Globals
Promise, JSON, Math, Date, Object (full), Array, Map, Set, RegExp, Number, String, Boolean, Symbol, setTimeout, clearTimeout, TextEncoder, TextDecoder, parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, Error, TypeError, RangeError

### TypedArrays (for binary data)
Uint8Array, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array, ArrayBuffer, DataView

## NOT Available (will cause errors)
Blob, File, Buffer (Node.js), require(), dynamic import(), fetch(), XMLHttpRequest, window, document, DOM APIs, process, fs, path, __dirname, __filename, global, globalThis (returns vm context), URL, URLSearchParams, ReadableStream, WritableStream, crypto, WebSocket, Worker, SharedArrayBuffer, Atomics, Reflect

## Proven Patterns

### Binary File Generation (PPTX, XLSX, DOCX, PDF)
IMPORTANT: Use the dedicated built-in tools instead of the sandbox for Office documents:
- **PPTX**: Use `create_pptx` tool (not evaluate_expression)
- **XLSX**: Use `create_xlsx` tool (not evaluate_expression)
- **DOCX**: Use `create_docx` tool (not evaluate_expression)
- **PDF**: Use `workspace:export-pdf` (Tier 1) or `pandoc-pdf` recipe (Tier 2)

These built-in tools run in the plugin context with full Node.js access and produce professional output.
The sandbox should NOT be used for binary file generation -- it lacks Buffer/Blob support.

If you need simple PDF generation from scratch (not conversion), pdf-lib remains available in the sandbox:
```typescript
import { PDFDocument, StandardFonts } from 'pdf-lib';
const doc = await PDFDocument.create();
const page = doc.addPage([595, 842]); // A4
const font = await doc.embedFont(StandardFonts.Helvetica);
page.drawText('Hello World', { x: 50, y: 750, size: 24, font });
const buf = await doc.save();
await ctx.vault.writeBinary('output.pdf', buf);
return 'Created output.pdf';
```

### Data Transformation
```typescript
const content = await ctx.vault.read('data.csv');
const rows = content.split('\n').map(r => r.split(','));
const markdown = '| ' + rows[0].join(' | ') + ' |\n| ' + rows[0].map(() => '---').join(' | ') + ' |\n' + rows.slice(1).map(r => '| ' + r.join(' | ') + ' |').join('\n');
await ctx.vault.write('data.md', markdown);
return 'Converted CSV to Markdown table';
```

### HTTP Request (CDN only)
```typescript
const resp = await ctx.requestUrl('https://esm.sh/lodash@4.17.21/package.json');
const pkg = JSON.parse(resp.text);
return pkg.version;
```

## Anti-Patterns (DO NOT USE)

- `new Blob([data])` -- Blob not available. Use `new Uint8Array(data)` or ArrayBuffer
- `Buffer.from(str)` -- Buffer not available. Use `new TextEncoder().encode(str)`
- `require('fs')` -- require not available. Use ctx.vault
- `fetch(url)` -- fetch not available. Use ctx.requestUrl
- `import('module')` -- dynamic import not available. Use static import + dependencies param
- `outputType: 'blob'` -- Blob not available. Use `outputType: 'arraybuffer'`
- `document.createElement()` -- DOM not available
- `window.crypto.getRandomValues()` -- crypto not available. Use Math.random()

## Library Recommendations

| Task | Recommended | Avoid | Reason |
|------|-------------|-------|--------|
| Excel | exceljs | sheetjs/xlsx | ExcelJS writeBuffer() returns ArrayBuffer natively |
| PDF | pdf-lib | jspdf | pdf-lib pure JS, no DOM dependency |
| PPTX | pptxgenjs (with caution) | officegen | pptxgenjs supports arraybuffer output |
| Images | sharp (if available) | canvas | canvas requires DOM |
| JSON/CSV | built-in | papaparse | papaparse works but unnecessary overhead |
| Dates | built-in Date | moment | moment too heavy for sandbox |

## Resource Limits
- Heap: 128 MB (desktop) / browser limit (mobile)
- Execution timeout: 30 seconds
- Write size: max 10 MB per operation
- Write rate: max 10 writes/minute
- Request rate: max 5 HTTP requests/minute
- Writes to .obsidian/ blocked (security)
