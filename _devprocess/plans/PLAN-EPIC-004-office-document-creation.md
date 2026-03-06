# Implementierungsplan: EPIC-004 Office Document Creation Tools

> **Status:** Geparkt -- Umsetzung spaeter
> **Erstellt:** 2026-03-06
> **Branch:** feature/create-officedocs

## Kontext

Das Plugin hat 30+ Tools, aber keine Built-in-Faehigkeit fuer binaere Office-Formate (PPTX, DOCX, XLSX). Die Sandbox (Schicht 3) kann keine binaeren Dateien erzeugen (kein Buffer, kein Blob). Deshalb muessen Built-in Tools in Schicht 2 (Plugin-Kontext) implementiert werden. Das CreateExcalidrawTool zeigt das Muster: LLM liefert semantischen Input, Tool uebernimmt Format-Details.

## Kritische Architektur-Entscheidungen (Abweichungen vom Plan-Kontext)

### 1. create_pdf wird GESTRICHEN

**Root Cause:** pdf-lib ist extrem low-level -- kein Text-Wrapping, keine Paragraphen, keine Listen. Jeder Textblock muss manuell positioniert werden. Das ergibt 500-1000 Zeilen Layout-Engine fuer mediokre Ergebnisse. Zusaetzlich: StandardFonts (Helvetica, Times) haben kein WinAnsiEncoding fuer deutsche Umlaute ohne Custom-Font-Embedding.

**Bestehende Alternativen (3x abgedeckt):**
- `execute_command("workspace:export-pdf")` -- Obsidian-native, Zero Dependencies
- `execute_recipe("pandoc-pdf")` -- hohe Qualitaet mit Pandoc
- Sandbox mit pdf-lib -- fuer einfache Faelle bereits moeglich

**Kosten/Nutzen:** ~500 KB Bundle + 500-1000 LOC fuer einen Use Case mit 3 Alternativen vs. PPTX/XLSX mit NULL Alternativen.

### 2. Reihenfolge: PPTX -> XLSX -> DOCX

- **pptxgenjs**: Einfachste API (deklarativ), ideal als Proof-of-Concept
- **exceljs**: Klare API, direkte Schema-Abbildung (sheets -> headers -> rows)
- **docx**: Komplexeste API (Document -> Section -> Paragraph -> TextRun Baum), meiste Mapping-Logik

### 3. Nur 3 Dependencies statt 4

`npm install pptxgenjs docx exceljs` -- geschaetzte Bundle-Erhoehung ~1.9 MB.

---

## Implementierungsplan

### Phase 0: Vorarbeit und Risikominimierung

**Schritt 0.1: esbuild-Kompatibilitaetstest**
- `npm install pptxgenjs docx exceljs`
- `npm run build` -- auf Fehler pruefen
- Kritisch: exceljs nutzt Node.js Streams (`stream.PassThrough`, `Buffer`, `fs`). Diese sind als builtins external markiert und sollten in Electron verfuegbar sein -- muss verifiziert werden.
- Falls exceljs Probleme: Fallback auf SheetJS (`xlsx`)

**Schritt 0.2: writeBinaryToVault.ts erstellen**
- Datei: `src/core/tools/vault/writeBinaryToVault.ts`
- Signatur: `writeBinaryToVault(vault: Vault, path: string, content: ArrayBuffer, expectedExtension: string)`
- Pfad-Validierung: kein `..`, kein absoluter Pfad, Extension-Check
- Ordner-Erstellung: `vault.createFolder(dirname).catch(() => {})`
- Create vs. Modify: `getAbstractFileByPath()` + `instanceof TFile`
- Rueckgabe: `{ created: boolean; path: string; size: number }`

### Phase 1: create_pptx

**Schritt 1.1: CreatePptxTool.ts**
- Datei: `src/core/tools/vault/CreatePptxTool.ts`
- Extends `BaseTool<'create_pptx'>`
- Schema: `output_path` (required), `slides[]` (required), `title?`, `theme?`
- Slide-Felder: `title?`, `subtitle?`, `body?`, `bullets?`, `table?`, `image?`, `notes?`
- pptxgenjs Flow: `new pptxgen()` -> `pres.addSlide()` -> `slide.addText/addTable/addImage` -> `pres.write({outputType:'arraybuffer'})` -> `writeBinaryToVault()`
- Auto-Layout: 10"x7.5", Titel oben, Content darunter
- Theme: `primary_color` fuer Titel-Farbe und Akzent

**Schritt 1.2: Wiring (nur create_pptx)**
- `src/core/tools/types.ts:36` -- `| 'create_pptx'` nach `create_excalidraw`
- `src/core/tools/ToolRegistry.ts` -- Import + `this.register(new CreatePptxTool(this.plugin))`
- `src/core/tools/toolMetadata.ts` -- Metadata-Eintrag in TOOL_METADATA
- `src/core/modes/builtinModes.ts:23` -- `'create_pptx'` in edit-Array

**Schritt 1.3: Build + Deploy + Manueller Test**

### Phase 2: create_xlsx

**Schritt 2.1: CreateXlsxTool.ts**
- Datei: `src/core/tools/vault/CreateXlsxTool.ts`
- Schema: `output_path` (required), `sheets[]` (required)
- Sheet-Felder: `name`, `headers?`, `rows[][]`, `columnWidths?`, `formulas?`
- exceljs Flow: `new Workbook()` -> `addWorksheet(name)` -> Columns/Rows/Formulas -> `workbook.xlsx.writeBuffer()` -> `writeBinaryToVault()`
- Auto-Formatierung: Header-Zeile fett, Auto-Width, Formeln als `{ formula: string }`

**Schritt 2.2: Wiring (create_xlsx)**
**Schritt 2.3: Build + Deploy + Test**

### Phase 3: create_docx

**Schritt 3.1: CreateDocxTool.ts**
- Datei: `src/core/tools/vault/CreateDocxTool.ts`
- Schema: `output_path` (required), `sections[]` (required), `title?`, `theme?`
- Section-Felder: `heading?`, `level?` (1-6), `body?`, `bullets?`, `numberedList?`, `table?`
- docx Flow: `new Document({ sections: [{ children: [...paragraphs] }] })` -> `Packer.toBuffer()` -> `.buffer` -> `writeBinaryToVault()`
- Section-Mapping:
  - `heading` -> `Paragraph` mit `HeadingLevel`
  - `body` -> Split bei `\n\n`, jeder Block ein `Paragraph`
  - `bullets` -> Paragraphs mit `bullet: { level: 0 }`
  - `table` -> `Table` mit `TableRow`/`TableCell`

**Schritt 3.2: Wiring (create_docx)**
**Schritt 3.3: Build + Deploy + Test**

### Phase 4: Prompt-Updates

**Schritt 4.1: toolDecisionGuidelines.ts**
- `src/core/prompts/sections/toolDecisionGuidelines.ts`
- Rule 1c erweitern: `.pptx` -> create_pptx, `.docx` -> create_docx, `.xlsx` -> create_xlsx
- Rule 1d: PDF-Routing explizit auf Tier 1/Tier 2 (workspace:export-pdf / pandoc-pdf)

**Schritt 4.2: SKILL.md aktualisieren**
- `bundled-skills/sandbox-environment/SKILL.md` -- Binary-Section: Verweis auf Built-in Tools

**Schritt 4.3: builtinModes.ts roleDefinition**
- Agent-Mode: Office-Erstellung via create_pptx/create_docx/create_xlsx erwaehnen
- Sandbox-Section (Zeile 175-179): Built-in Tools statt Sandbox fuer PPTX/XLSX/DOCX

**Schritt 4.4: evaluate_expression Metadata**
- `toolMetadata.ts:315-318`: commonMistakes um Verweis auf Built-in Office-Tools ergaenzen

---

## Dateien-Zusammenfassung

| Datei | Aenderung | Risiko |
|-------|-----------|--------|
| `src/core/tools/vault/writeBinaryToVault.ts` | NEU: Shared Utility (~30 LOC) | Niedrig |
| `src/core/tools/vault/CreatePptxTool.ts` | NEU: Tool (~200 LOC) | Mittel |
| `src/core/tools/vault/CreateXlsxTool.ts` | NEU: Tool (~180 LOC) | Mittel-Hoch |
| `src/core/tools/vault/CreateDocxTool.ts` | NEU: Tool (~300 LOC) | Mittel |
| `src/core/tools/types.ts` | 3 neue ToolName Eintraege | Niedrig |
| `src/core/tools/ToolRegistry.ts` | 3 Imports + 3 Registrations | Niedrig |
| `src/core/tools/toolMetadata.ts` | 3 Metadata + 1 Update | Niedrig |
| `src/core/modes/builtinModes.ts` | edit-Array + roleDefinition | Niedrig |
| `src/core/prompts/sections/toolDecisionGuidelines.ts` | Rule 1c/1d | Niedrig |
| `bundled-skills/sandbox-environment/SKILL.md` | Binary-Section | Niedrig |
| `package.json` | 3 neue Dependencies | Mittel |

## Nicht betroffen

- `BaseTool.ts` -- KEINE Aenderung (ADR-031 Option 3 bewusst abgelehnt)
- `SandboxBridge.ts` -- KEINE Aenderung (eigene Sicherheits-Concerns)
- `ReadDocumentTool.ts` -- KEINE Aenderung
- `AgentTask.ts` / Pipeline -- KEINE Aenderung
- Alle bestehenden 30+ Tools -- KEINE Aenderung

## Verifikation

1. **Build:** `npm run build` fehlerfrei nach jedem Schritt
2. **Bundle-Groesse:** Erhoehung ~1.9 MB akzeptabel (gesamt ~19 MB)
3. **Pro Tool:** Minimales Dokument erzeugen, in Office-App oeffnen, pruefen
4. **Pro Tool:** Komplexes Dokument (5+ Slides/Sheets/Sections, Tabellen, gemischter Content)
5. **Regression:** Bestehende Tools, Sandbox, pandoc-Recipes weiterhin funktional

## Risiken

| Risiko | W-keit | Impact | Mitigation |
|--------|--------|--------|------------|
| exceljs Node.js-Compat in esbuild | Mittel | Hoch | Phase 0 Test; Fallback SheetJS |
| LLM generiert invaliden Input | Mittel | Mittel | Robuste Validierung, fail-soft |
| pptxgenjs Image-Handling (Vault-Pfade) | Mittel | Mittel | vault.readBinary -> base64 |
| Bundle-Groesse > 20 MB | Niedrig | Niedrig | Tree-Shaking |

## Referenz-Dokumente

- `_devprocess/requirements/handoff/plan-context-office-creation.md` -- Architect-Handoff
- `_devprocess/architecture/ADR-029-office-tool-input-schema.md` -- Schema-Design
- `_devprocess/architecture/ADR-030-office-library-selection.md` -- Library-Auswahl
- `_devprocess/architecture/ADR-031-binary-write-pattern.md` -- Binary-Write-Pattern
- `src/core/tools/vault/CreateExcalidrawTool.ts` -- Referenz-Implementierung