# FEATURE: Tool Metadata Registry

**Status:** Implemented
**Source:** `src/core/tools/toolMetadata.ts`

## Summary

Central registry that defines display metadata (label, description, icon, signature, group) for all 26+ tools in a single file. This metadata is consumed by two previously independent subsystems:
- **System prompt builder** (`tools.ts` section) — generates the TOOLS section for the LLM
- **ToolPickerPopover** (UI) — renders labels, descriptions, and icons in the tool selection popup

Before this feature, both subsystems maintained their own hardcoded copies of tool names, labels, descriptions, and icons. Changes to one required manual synchronization with the other.

## Motivation

### Problem
Tool descriptions existed in 3 independent locations:
1. **`systemPrompt.ts`** — inline `TOOL_SECTIONS` constant with tool signatures and descriptions for the LLM
2. **`ToolPickerPopover.ts`** — 5 separate lookup tables (`GROUP_TOOLS`, `GROUP_LABELS`, `GROUP_ICONS`, `TOOL_LABELS`, `TOOL_DESCS`, `TOOL_ICONS`)
3. **Each `*Tool.ts` class** — `getDefinition()` with the API-level `input_schema` and detailed description for function calling

Sources 1 and 2 frequently diverged (e.g., a new tool added to the prompt but not to the UI, or description wording drifting between the two). Source 3 serves a different purpose (API function calling schema) and is intentionally kept separate.

### Solution
Create `toolMetadata.ts` as the single source of truth for display-level metadata (sources 1 and 2). Both the prompt builder and the UI derive their data from this file. The API-level schema (source 3) stays in each tool's `getDefinition()` method.

## Data Model

### ToolMeta
```typescript
interface ToolMeta {
    group: ToolGroup;      // 'read' | 'vault' | 'edit' | 'web' | 'agent' | 'mcp'
    label: string;         // UI display name (e.g., "Read File")
    description: string;   // Short description (shared between prompt and UI)
    icon: string;          // Lucide icon name
    signature: string;     // Prompt signature (e.g., "read_file(path)")
}
```

### GROUP_META
```typescript
Record<string, { label: string; icon: string }>
// e.g., read: { label: 'Read Files', icon: 'file-text' }
```
Labels and icons for group headers in both the prompt and the UI.

### Exports
| Export | Purpose |
|--------|---------|
| `TOOL_METADATA` | Full registry: `Record<string, ToolMeta>` (26 entries) |
| `GROUP_META` | Group display metadata (6 groups) |
| `GROUP_PROMPT_HEADERS` | Section titles for the system prompt (e.g., `**Reading & Searching:**`) |
| `GROUP_ORDER` | Consistent rendering order: read, vault, edit, web, agent, mcp |
| `getToolsForGroup(group)` | Filter tools by group |
| `buildToolPromptSection(groups)` | Generate prompt text from metadata for given groups |

## Integration

### System Prompt (tools.ts section)
```typescript
// Before: 50+ lines of hardcoded TOOL_SECTIONS constant
// After:
import { buildToolPromptSection } from '../../tools/toolMetadata';
parts.push(buildToolPromptSection(nonMcpGroups));
```

### ToolPickerPopover
```typescript
// Before: 5 hardcoded lookup tables (~70 lines)
// After: derived from TOOL_METADATA and GROUP_META
const GROUP_TOOLS: Record<string, string[]> = {};
for (const [group] of Object.entries(GROUP_META)) {
    GROUP_TOOLS[group] = getToolsForGroup(group).map(([name]) => name);
}
// Similarly for GROUP_LABELS, GROUP_ICONS, TOOL_LABELS, TOOL_ICONS, TOOL_DESCS
```

### Tool Classes (unchanged)
Each tool's `getDefinition()` method retains the full API-level schema with `input_schema` and detailed parameter descriptions. This serves function calling, not display. The metadata registry does not replace it.

## Registered Tools (26)

| Group | Tools |
|-------|-------|
| read (3) | read_file, list_files, search_files |
| vault (8) | get_vault_stats, get_frontmatter, search_by_tag, get_linked_notes, get_daily_note, open_note, semantic_search, query_base |
| edit (10) | write_file, edit_file, append_to_file, update_frontmatter, create_folder, delete_file, move_file, generate_canvas, create_base, update_base |
| web (2) | web_fetch, web_search |
| agent (4) | ask_followup_question, attempt_completion, update_todo_list, new_task |
| mcp (1) | use_mcp_tool |

Note: `update_frontmatter` appears in vault group (read context) and edit group (write context) at the tool-group level, but only once in the metadata registry (under `edit` group).

## Key Files
- `src/core/tools/toolMetadata.ts` — central metadata registry
- `src/core/prompts/sections/tools.ts` — prompt builder (consumer)
- `src/ui/sidebar/ToolPickerPopover.ts` — UI popover (consumer)

## Dependencies
- `ToolGroup` type from `src/types/settings.ts`
- `ToolName` type from `src/core/tools/types.ts`

## Adding a New Tool
When adding a new tool, update in this order:
1. Create `src/core/tools/{category}/{ToolName}Tool.ts` with `getDefinition()`
2. Register in `ToolRegistry.registerInternalTools()`
3. Add entry to `TOOL_METADATA` in `toolMetadata.ts` — prompt and UI update automatically
4. Add to the appropriate `toolGroups` array in mode definitions if not already included

## Known Limitations
- The metadata registry is a static import — adding a tool requires a code change and rebuild. Dynamic tool registration (e.g., from MCP servers) is handled separately by the MCP tools section in the prompt builder.
- `description` is shared between prompt and UI. If a tool needs a different description for the LLM vs. the user, this would require splitting the field. Not needed currently.
