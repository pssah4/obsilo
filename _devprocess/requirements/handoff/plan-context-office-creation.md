
> **Purpose:** Technische Zusammenfassung fuer Claude Code
> **Created by:** Architect Agent
> **Date:** 2026-03-06

---

## Technical Stack

**Runtime:** Obsidian Plugin (Electron, Node.js in Renderer mit nodeIntegration:true)
**Sprache:** TypeScript (strict)
**Build:** esbuild (`esbuild.config.mjs`)
**Libraries (neu, als dependencies):**

| Library | Format | Bundle-Groesse (est.) | Output-Methode |
|---------|--------|----------------------|----------------|
| pptxgenjs | PPTX | ~500 KB | `write({outputType:'arraybuffer'})` |
| docx | DOCX | ~400 KB | `Packer.toBuffer()` |
| exceljs | XLSX | ~1 MB | `writeBuffer()` |
| pdf-lib | PDF | ~500 KB | `save()` → Uint8Array |
| **Gesamt** | | **~2.4 MB** | |

## Architecture Style

- Pattern: Obsidian Plugin (Schicht 2 -- Plugin-Kontext)
- Ausfuehrung im Plugin-Kontext, NICHT in der Sandbox (Schicht 3)
- Begruendung: Sandbox hat kein Buffer, kein Blob, kein require -- binaere Formate unmoeglich
- Referenz: GLOSSAR-begriffe.md ("Fuer Faehigkeiten die Node.js APIs benoetigen, muessen Built-in Tools in Schicht 2 implementiert werden")

## Key Architecture Decisions (ADR Summary)

| ADR | Title | Vorgeschlagene Entscheidung | Impact |
|-----|-------|-----------------------------|--------|
| ADR-029 | Input-Schema-Design | Flaches, content-zentriertes Schema (2-3 Nesting-Levels) | High |
| ADR-030 | Library Selection | pptxgenjs / docx / exceljs / pdf-lib | High |
| ADR-031 | Binary Write Pattern | Shared Utility `writeBinaryToVault()` | Medium |

### Detail pro ADR:

1. **ADR-029 Input-Schema-Design:** Flaches, content-zentriertes Schema. LLM liefert strukturierten Inhalt (slides[], sections[], sheets[], pages[]), Tool uebernimmt Layout/Formatting programmatisch. Auto-Layout, optionales Theme. Max 2-3 Nesting-Levels.
   - Rationale: LLM muss keine Format-Interna kennen. Gleicher Ansatz wie CreateExcalidrawTool.

2. **ADR-030 Library Selection:** pptxgenjs (PPTX), docx (DOCX), exceljs (XLSX), pdf-lib (PDF).
   - Rationale: Alle pure JS, MIT/Apache-Lizenz, ArrayBuffer-Output, aktiv maintained, bewaehrt in SKILL.md.

3. **ADR-031 Binary Write Pattern:** Shared Utility-Funktion `writeBinaryToVault()` in `src/core/tools/vault/writeBinaryToVault.ts`.
   - Rationale: 4 Tools teilen exakt das gleiche Muster (folder create -> getAbstractFileByPath -> createBinary/modifyBinary). DRY ohne BaseTool-Aenderung.

## Wiring Pattern (bestehendes Pattern, verifiziert)

Jedes neue Tool muss an 4 Stellen registriert werden:

### 1. ToolName Union Type (`src/core/tools/types.ts`)

4 neue Eintraege im `ToolName` Type:
```typescript
// Vault: office document creation
| 'create_pptx'
| 'create_docx'
| 'create_xlsx'
| 'create_pdf'
```

Einfuegen nach dem Block `// Vault: structured` (nach `create_excalidraw`).

### 2. ToolRegistry (`src/core/tools/ToolRegistry.ts`)

**Imports hinzufuegen** (nach CreateExcalidrawTool-Import):
```typescript
// Import tools — vault: office document creation
import { CreatePptxTool } from './vault/CreatePptxTool';
import { CreateDocxTool } from './vault/CreateDocxTool';
import { CreateXlsxTool } from './vault/CreateXlsxTool';
import { CreatePdfTool } from './vault/CreatePdfTool';
```

**Registration in `registerInternalTools()`** (nach `CreateExcalidrawTool`):
```typescript
// Vault: office document creation
this.register(new CreatePptxTool(this.plugin));
this.register(new CreateDocxTool(this.plugin));
this.register(new CreateXlsxTool(this.plugin));
this.register(new CreatePdfTool(this.plugin));
```

### 3. Tool Metadata (`src/core/tools/toolMetadata.ts`)

4 neue Eintraege im `TOOL_METADATA` Record (nach `create_excalidraw`):
```typescript
create_pptx: {
    group: 'edit', label: 'Create PPTX', icon: 'presentation',
    signature: 'create_pptx(output_path, slides, title?, theme?)',
    description: 'Create a PowerPoint presentation (.pptx) with slides, text, and images.',
    example: 'create_pptx("Presentations/quarterly.pptx", [{"title":"Q1 Results","bullets":["Revenue +15%","Users +20k"]}])',
    commonMistakes: 'Using write_file for .pptx — always use create_pptx instead.',
},
create_docx: {
    group: 'edit', label: 'Create DOCX', icon: 'file-text',
    signature: 'create_docx(output_path, sections, title?, theme?)',
    description: 'Create a Word document (.docx) with structured sections, headings, and tables.',
    example: 'create_docx("Documents/report.docx", [{"heading":"Introduction","content":"This report..."}])',
    commonMistakes: 'Using write_file for .docx — always use create_docx instead.',
},
create_xlsx: {
    group: 'edit', label: 'Create XLSX', icon: 'table',
    signature: 'create_xlsx(output_path, sheets)',
    description: 'Create an Excel spreadsheet (.xlsx) with sheets, data rows, and optional formulas.',
    example: 'create_xlsx("Data/budget.xlsx", [{"name":"Sheet1","headers":["Item","Cost"],"rows":[["Server","500"],["Domain","12"]]}])',
    commonMistakes: 'Using write_file for .xlsx — always use create_xlsx instead.',
},
create_pdf: {
    group: 'edit', label: 'Create PDF', icon: 'file-type',
    signature: 'create_pdf(output_path, pages, title?, theme?)',
    description: 'Create a PDF document with text, headings, and basic formatting.',
    example: 'create_pdf("Exports/summary.pdf", [{"content":"Executive Summary\\n\\nKey findings..."}])',
    commonMistakes: 'Using write_file for .pdf — always use create_pdf instead. For converting existing Markdown to PDF, use execute_command with workspace:export-pdf.',
},
```

### 4. Mode Tool Groups (`src/core/modes/builtinModes.ts`)

4 neue Eintraege in `TOOL_GROUP_MAP.edit`:
```typescript
edit: ['write_file', 'edit_file', ..., 'create_excalidraw', 'create_base', 'update_base',
       'create_pptx', 'create_docx', 'create_xlsx', 'create_pdf'],
```

## Prompt Updates (FEATURE-404)

### 5. Tool Decision Guidelines (`src/core/prompts/sections/toolDecisionGuidelines.ts`)

**Rule 1c erweitern:**
```
1c. PLUGIN FILE FORMATS — Use dedicated tools for complex plugin formats:
   For .excalidraw.md files: ALWAYS use create_excalidraw (never write_file).
   For .canvas files: ALWAYS use generate_canvas (never write_file).
   For .base files: ALWAYS use create_base (never write_file).
   For .pptx files: ALWAYS use create_pptx (never write_file or evaluate_expression).
   For .docx files: ALWAYS use create_docx (never write_file or evaluate_expression).
   For .xlsx files: ALWAYS use create_xlsx (never write_file or evaluate_expression).
   For .pdf files: ALWAYS use create_pdf (never write_file or evaluate_expression).
   These tools handle the complex format automatically — the LLM should never generate raw plugin JSON/YAML.
```

### 6. Sandbox SKILL.md (`bundled-skills/sandbox-environment/SKILL.md`)

Section "Binary File Generation" aktualisieren:
```
Binary File Generation: Use built-in tools (create_pptx, create_docx, create_xlsx, create_pdf).
The sandbox cannot generate binary files — these tools run in the plugin context with full Node.js access.
```

## Tool-Klassen (Implementierung)

### Speicherpfad
```
src/core/tools/vault/CreatePptxTool.ts
src/core/tools/vault/CreateDocxTool.ts
src/core/tools/vault/CreateXlsxTool.ts
src/core/tools/vault/CreatePdfTool.ts
src/core/tools/vault/writeBinaryToVault.ts  (shared utility)
```

### Referenz-Pattern: CreateExcalidrawTool

Jedes Tool folgt dem CreateExcalidrawTool-Muster:
1. Extends `BaseTool<'create_xxx'>`
2. `readonly name = 'create_xxx' as const`
3. `readonly isWriteOperation = true`
4. `getDefinition()` → gibt ToolDefinition mit input_schema zurueck
5. `execute(input, context)` → Validierung → Library-Call → ArrayBuffer → writeBinaryToVault → pushToolResult

### Schema-Skizzen (aus ADR-029)

**create_pptx:**
```json
{
  "output_path": "Presentations/demo.pptx",
  "slides": [
    { "title": "Welcome", "subtitle": "Q1 2026" },
    { "title": "Revenue", "bullets": ["Item 1", "Item 2"] },
    { "title": "Data", "table": { "headers": ["A","B"], "rows": [["1","2"]] } }
  ],
  "title": "Quarterly Report",
  "theme": { "primary_color": "#1a73e8" }
}
```

**create_docx:**
```json
{
  "output_path": "Documents/report.docx",
  "sections": [
    { "heading": "Introduction", "level": 1, "content": "Main text..." },
    { "heading": "Data", "level": 2, "table": { "headers": ["..."], "rows": ["..."] } }
  ],
  "title": "Annual Report"
}
```

**create_xlsx:**
```json
{
  "output_path": "Data/budget.xlsx",
  "sheets": [
    {
      "name": "Budget",
      "headers": ["Item", "Cost", "Total"],
      "rows": [["Server", 500, null], ["Domain", 12, null]],
      "formulas": { "C2": "SUM(B2:B3)" }
    }
  ]
}
```

**create_pdf:**
```json
{
  "output_path": "Exports/summary.pdf",
  "pages": [
    { "content": "Executive Summary\n\nKey findings..." }
  ],
  "title": "Monthly Report",
  "theme": { "font_size": 12 }
}
```

## Implementierungs-Reihenfolge (Vorschlag)

1. **npm install:** `pptxgenjs docx exceljs pdf-lib` + esbuild-Kompatibilitaet pruefen
2. **writeBinaryToVault.ts:** Shared Utility (klein, fokussiert)
3. **CreatePptxTool.ts:** Erstes Tool (pptxgenjs hat einfachste API)
4. **Wiring Schritt 1:** types.ts + ToolRegistry + toolMetadata + builtinModes (fuer create_pptx)
5. **Build + Test:** `npm run build` -- esbuild-Kompatibilitaet verifizieren
6. **CreateDocxTool.ts** + Wiring
7. **CreateXlsxTool.ts** + Wiring
8. **CreatePdfTool.ts** + Wiring
9. **Prompt Updates:** toolDecisionGuidelines.ts, SKILL.md
10. **Build + Deploy:** `npm run build && npm run deploy`

## Performance & Security

**Performance:**
- Generierungszeit: <10s fuer Standard-Dokumente (30 Slides, 10-Seiten-Dokument)
- Bundle-Groesse: +2.4 MB (gesamt ~5 MB Plugin akzeptabel)

**Security:**
- Pfad-Validierung: Kein `..`, kein absoluter Pfad, Extension-Pruefung
- Kein require() -- nur ES import (Obsidian Review-Bot Compliance)
- Keine innerHTML -- DOM-Interaktion nur ueber Obsidian API
- Libraries: Pure JS, keine Native Addons, keine fetch()-Aufrufe

---

## Kontext-Dokumente fuer Claude Code

Claude Code sollte folgende Dokumente als Kontext lesen:

1. `_devprocess/architecture/ADR-029-office-tool-input-schema.md`
2. `_devprocess/architecture/ADR-030-office-library-selection.md`
3. `_devprocess/architecture/ADR-031-binary-write-pattern.md`
4. `_devprocess/requirements/features/FEATURE-400-create-pptx.md`
5. `_devprocess/requirements/features/FEATURE-401-create-docx.md`
6. `_devprocess/requirements/features/FEATURE-402-create-xlsx.md`
7. `_devprocess/requirements/features/FEATURE-403-create-pdf.md`
8. `_devprocess/requirements/features/FEATURE-404-agent-prompt-update.md`
9. `_devprocess/requirements/epics/EPIC-004-office-document-creation.md`

**Referenz-Implementierungen (im Repo):**
- `src/core/tools/vault/CreateExcalidrawTool.ts` -- Muster fuer Format-Tools
- `src/core/sandbox/SandboxBridge.ts:89-104` -- Binary Write Pattern
- `src/core/tools/BaseTool.ts` -- Abstrakte Basisklasse
- `src/core/tools/ToolRegistry.ts` -- Tool-Registrierung
