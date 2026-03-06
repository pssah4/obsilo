# Obsilo Agent v2.1 -- Release Notes

## Highlights

This release adds **document intelligence**, **chat-linking** for bidirectional traceability between conversations and notes, and **Office document creation** directly from the agent.

---

## New Features

### Document Parser Pipeline
Obsilo can now **read and understand** Office documents, PDFs, and data files -- both as chat attachments (drag & drop) and via the `read_document` tool.

- **Supported formats:** PPTX, XLSX, DOCX, PDF, CSV, JSON, XML
- **Drag & drop** any supported file into the chat to include its content as context
- **Semantic index** now indexes Office documents and PDFs alongside Markdown notes (when enabled)
- Pure-JS parsers (JSZip + OOXML) -- no native dependencies, works on all platforms

### Chat-Linking
Bidirectional links between your vault notes and agent conversations.

- **Manual linking:** Click the link icon on any chat in the history panel to stamp the active note's frontmatter with a deep link
- **Auto-linking on finalize:** When a conversation ends, notes that were edited during the session are automatically linked
- **Deep links:** `obsidian://obsilo-chat?id=...` opens the conversation directly in the sidebar
- **Duplicate detection:** Same conversation is never linked twice
- **Semantic titling:** Conversations get auto-generated titles via a configurable LLM model

### Office Document Creation
Three new tools let the agent create binary Office documents directly in the vault:

| Tool | Format | Library | Capabilities |
|------|--------|---------|-------------|
| `create_pptx` | PowerPoint | pptxgenjs | Slides, text, images, tables, charts, shapes, speaker notes |
| `create_docx` | Word | docx | Headings, paragraphs, tables, lists, images, page breaks |
| `create_xlsx` | Excel | ExcelJS | Sheets, cells, formulas, styles, column widths, freeze panes |

### Task Extraction
The agent can now extract actionable tasks from its own responses and create structured task notes:

- Scans for `- [ ]` checkboxes in agent responses
- Parses `@assignee` and `due: YYYY-MM-DD` annotations
- Creates notes with 10-property frontmatter (Kategorie, Status, Dringend, Wichtig, etc.)
- Smart title generation with natural phrase boundaries
- Configurable output folder

---

## Improvements

### Semantic Index Auto-Trigger
The semantic index now stays current automatically:

- **Vault events** (create, modify, delete, rename) trigger incremental re-indexing
- **Per-file debounce** (2s) prevents thrashing while typing
- **Queue-based processing** (concurrency 1) avoids API exhaustion

### Context Condensing
- Emergency condensing on 400 context overflow errors (auto-recovery)
- Improved handling of `code_execution_result` messages during condensing

### Security & Stability
- Permissive mode warning in settings when both web access and write operations are auto-approved
- Fixed `consecutiveMistakes` counter reset on mode switch (FIX-06)
- All 6 bugs from backlog resolved (FIX-01 through FIX-06)
- All security findings from AUDIT-003 addressed

### i18n
- All 6 languages (en, de, es, ja, zh-CN, hi) fully synchronized
- App: 1048 keys per language
- Homepage: 630 keys per language (Hindi was 274, now complete)

---

## Tool Count

46+ tools across 7 groups:

| Group | Count | Examples |
|-------|-------|---------|
| read | 4 | read_file, list_files, search_files, read_document |
| vault | 8 | semantic_search, query_base, create_base, update_base |
| edit | 14 | write_file, edit_file, create_pptx, create_docx, create_xlsx |
| web | 2 | web_fetch, web_search |
| agent | 12 | new_task, switch_mode, update_todo_list |
| skill | 5 | load_skill, list_skills |
| mcp | 1 | call_mcp_tool |

---

## Breaking Changes

None.

## Upgrade

Install via BRAT or replace `main.js`, `styles.css`, and `manifest.json` in your plugin folder.
