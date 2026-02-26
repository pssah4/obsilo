# Obsilo Agent

**Your Obsidian vault, with a real AI Agent.**

Learns your vault, your rules, your workflows. 30+ tools, semantic search, persistent memory, and full safety controls. Local-first. Open source. Free.

[www.obsilo.ai](https://www.obsilo.ai)

---

## What It Does

You describe a task in natural language. Obsilo plans, searches your vault, reads relevant notes, creates or edits content, browses the web when needed, and reports back — all while showing you exactly what it's doing in real time.




## Features

### 30+ Vault Tools
- **Read & Search**: `read_file`, `list_files`, `search_files`
- **Vault Intelligence**: `semantic_search`, `get_frontmatter`, `search_by_tag`, `get_linked_notes`, `get_vault_stats`, `get_daily_note`, `query_base`
- **Write & Edit**: `write_file`, `edit_file`, `append_to_file`, `update_frontmatter`, `create_folder`, `delete_file`, `move_file`
- **Advanced**: `generate_canvas`, `create_base`, `update_base`
- **Web**: `web_fetch`, `web_search` (Brave / Tavily)
- **Agent Control**: `update_todo_list`, `ask_followup_question`, `new_task`
- **MCP**: `use_mcp_tool` — connect any MCP server

### Hybrid Semantic Search
Local vector index (Vectra + Xenova transformers) with no cloud required. Combines semantic similarity with full-text keyword search (RRF fusion), 1-hop wikilink graph augmentation, and optional HyDE query enhancement.

### Agent Modes
Two built-in modes — **Ask** (read-only knowledge assistant) and **Agent** (full capabilities). Create custom modes with their own roles, tool sets, and instructions. Per-mode model overrides let you run a fast model for quick questions and a powerful one for complex tasks.

### Multi-Agent Workflows
Spawn sub-agents with `new_task` for complex parallel or sequential workflows — Orchestrator-Worker, Prompt Chaining, Evaluator-Optimizer, and Routing patterns built in.

### Context Injection
- **Rules** (`.obsidian-agent/rules/`): permanent instructions injected into every system prompt
- **Skills** (`.obsidian-agent/skills/`): keyword-matched mini-instructions auto-injected per message
- **Workflows** (`.obsidian-agent/workflows/`): slash-command driven instruction sets
- **Custom Prompts**: `/prompt-slug` templates with `{{userInput}}` and `{{activeFile}}` variables

### Safety
- **Approval-based writes**: every write operation requires explicit approval (or configured auto-approval)
- **Automatic checkpoints**: isomorphic-git shadow repo snapshots before every task's first write
- **Vault governance**: `.obsidian-agentignore` and `.obsidian-agentprotected` access control files
- **Audit log**: JSONL operation trail with parameter sanitization

### Provider Flexibility
Anthropic, OpenAI, Ollama, LM Studio, OpenRouter, Azure OpenAI — or any OpenAI-compatible API. Configure multiple models and switch between them per-mode or per-chat.

### MCP Integration
Connect MCP servers via stdio, SSE, or streamable-HTTP. Tools are dynamically discovered and exposed to the agent. Per-mode whitelisting available.

### Plugin Skills
Obsilo automatically scans your installed Obsidian plugins and generates skill files that teach the agent how to use them. The agent learns each plugin's commands, settings, and file formats — so it can create Excalidraw drawings, build Kanban boards, populate Dataview tables, or use any other plugin on your behalf.

---

## Installation

### BRAT (recommended)

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) from Community Plugins
2. Open BRAT settings and select **Add Beta Plugin**
3. Enter `https://github.com/pssah4/obsilo`
4. Enable "Obsilo Agent" in Settings > Community Plugins

### Manual Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/pssah4/obsilo.git
   cd obsilo
   npm install
   npm run build
   ```
2. Copy `main.js`, `styles.css`, and `manifest.json` to your vault:
   ```
   <vault>/.obsidian/plugins/obsilo-agent/
   ```
3. Enable the plugin in Obsidian: Settings > Community Plugins > Enable "Obsilo Agent"

### Requirements
- Obsidian 1.4.0 or later
- Desktop only (not available on mobile)
- Node.js 18+ for building from source

---

## Quick Start

1. **Add a model**: Settings > Obsilo Agent > Models > Enable a built-in model and enter your API key
2. **Open the sidebar**: Click the Obsilo icon in the ribbon
3. **Ask a question**: Type any question about your vault, e.g. *"What are my most-linked notes?"*
4. **Run a task**: Switch to Agent mode and try *"Create a weekly review template"*

For search to work at its best, build the semantic index: Settings > Obsilo Agent > Semantic Index > Build Index.

---

## Network Usage

This plugin makes network requests depending on your configuration:

- **LLM API calls**: Every message is sent to the configured model provider (Anthropic, OpenAI, OpenRouter, Azure, or a local server like Ollama/LM Studio). No data is sent without a configured provider.
- **Web search** (optional): When using `web_search`, requests go to the configured search API (Brave or Tavily). Disabled by default.
- **MCP servers** (optional): Connected MCP servers may make additional network requests depending on their configuration.
- **No telemetry**: The plugin does not collect analytics, usage data, or crash reports.
- **API key storage**: API keys are stored in Obsidian's plugin settings (`data.json`), which is not encrypted. If you use Obsidian Sync, your keys will be synced.

---

## Configuration

### Settings Overview

| Section | What you configure |
|---------|-------------------|
| **Models** | Add API keys, enable/disable models, set defaults |
| **Embeddings** | Select local or API embedding model for semantic search |
| **Modes** | Create and edit custom agent modes |
| **Permissions** | Configure which operations require manual approval |
| **Loop** | Rate limits, error limits, context condensing, power steering |
| **Rules** | Manage permanent instruction files |
| **Workflows** | Manage slash-command workflow files |
| **Skills** | Manage keyword-matched skill files |
| **Prompts** | Create custom `/slash-command` templates |
| **MCP** | Add MCP server configurations |
| **Semantic Index** | Configure vector search (model, chunks, auto-index) |
| **Checkpoints** | Configure automatic undo snapshots |
| **Web Search** | Configure Brave or Tavily search API |
| **Interface** | Sidebar position, keyboard shortcuts, context injection |
| **Logs** | View the operation audit trail |

### Supported Providers

| Provider | Type | Models |
|----------|------|--------|
| Anthropic | Cloud | Claude Opus 4.6, Sonnet 4.5, Haiku 4.5 |
| OpenAI | Cloud | GPT-4o, GPT-4o mini, GPT-4.1 |
| OpenRouter | Gateway | Any model on OpenRouter |
| Azure OpenAI | Enterprise | Any Azure-deployed model |
| Ollama | Local | Llama 3.2, Qwen 2.5, etc. |
| LM Studio | Local | Any local model |
| Custom | Any | Any OpenAI-compatible endpoint |

---

## Context Injection

### Rules
Create Markdown files at `.obsidian-agent/rules/my-rule.md`. They are automatically injected into every system prompt.

```markdown
Always use ISO dates (YYYY-MM-DD) in frontmatter.
Prefer [[wikilinks]] over markdown links for internal notes.
Tag all new notes with at least one tag.
```

### Skills
Create `.obsidian-agent/skills/meeting-notes/SKILL.md`:

```markdown
---
name: meeting-notes
description: taking meeting notes, capturing action items, agenda
---

When writing meeting notes:
1. Use H2 for sections: ## Attendees, ## Agenda, ## Notes, ## Action Items
2. Format action items as `- [ ] @person: task (due: YYYY-MM-DD)`
3. Link to relevant projects with [[wikilinks]]
```

### Workflows
Create `.obsidian-agent/workflows/daily-review.md` and invoke with `/daily-review`.

---

## Permissions

Obsilo follows a safe-by-default model:

- **Read operations** — auto-approved by default
- **All write operations** — require explicit approval by default
- Configure auto-approval per category in Settings > Permissions

Access control files:

```
# .obsidian-agentignore  — blocks all access
Private/
Archive/**

# .obsidian-agentprotected  — read-only
Templates/
```

---

## Directory Structure

```
<vault>/
└── .obsidian-agent/
    ├── rules/            # Permanent system prompt instructions
    ├── workflows/        # Slash-command workflow files
    └── skills/           # Keyword-matched skill instructions

<vault>/.obsidian/plugins/obsilo-agent/
├── checkpoints/          # Shadow git repo (automatic undo)
├── logs/                 # JSONL operation audit trail
└── semantic-index/       # Local vector index
```

---

## Documentation

Full documentation: **[www.obsilo.ai](https://www.obsilo.ai)**

- [Getting Started](https://www.obsilo.ai/getting-started.html)
- [Chat Interface](https://www.obsilo.ai/chat-interface.html)
- [Modes](https://www.obsilo.ai/modes.html)
- [Tools Reference](https://www.obsilo.ai/tools.html)
- [Semantic Search](https://www.obsilo.ai/semantic-search.html)
- [Rules, Skills & Workflows](https://www.obsilo.ai/rules-skills-workflows.html)
- [Providers & Models](https://www.obsilo.ai/providers.html)
- [MCP Servers](https://www.obsilo.ai/mcp-servers.html)
- [Permissions & Safety](https://www.obsilo.ai/permissions.html)
- [Checkpoints](https://www.obsilo.ai/checkpoints.html)
- [Settings Reference](https://www.obsilo.ai/settings-reference.html)

---

## Development

```bash
npm install       # Install dependencies
npm run dev       # Dev build with watch mode
npm run build     # Production build
```

---

## License

Apache 2.0

---

## Acknowledgements

- [Kilo Code](https://kilocode.ai) — architectural inspiration
- [Obsidian](https://obsidian.md) — the platform
- [Vectra](https://github.com/Stevenic/vectra) — local vector database
- [Xenova Transformers](https://github.com/xenova/transformers.js) — local ONNX embeddings
- [isomorphic-git](https://isomorphic-git.org) — pure JS git for checkpoints
- [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk) — Model Context Protocol
