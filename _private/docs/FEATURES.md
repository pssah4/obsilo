# Obsilo Agent — Complete Feature List

Obsilo Agent is an agentic AI layer built directly into Obsidian. Inspired by Kilo Code, it turns your vault into an AI-driven knowledge operating system — reading, writing, searching, and connecting notes autonomously, with safety guardrails at every step.

---

## Agent Modes

### Built-in Modes
| Mode | Description | Tool Access |
|------|-------------|-------------|
| **Ask** | Conversational knowledge assistant — read-only vault Q&A, semantic search, synthesis | read, vault, agent |
| **Agent** | Fully capable autonomous agent — reads, writes, browses, spawns sub-agents | read, vault, edit, web, agent, mcp |

### Custom Modes
- Create **vault-scoped** modes (stored in plugin settings for this vault only)
- Create **global modes** (stored at `~/.obsidian-agent/modes.json`, available in all vaults)
- Each mode defines: role definition, custom instructions, icon, tool groups, optional model override
- Per-mode **model override** — different AI model per mode
- Per-mode **tool overrides** — restrict available tools to a subset
- Per-mode **MCP server whitelist** — limit which MCP servers a mode can use
- Per-mode **forced skills** — always inject specific skills regardless of keyword matching
- Per-mode **forced workflow** — apply a default workflow to every message

---

## AI Provider Support

### Cloud Providers
| Provider | Models |
|----------|--------|
| **Anthropic** | Claude Opus 4.6, Claude Sonnet 4.5, Claude Haiku 4.5 |
| **OpenAI** | GPT-4o, GPT-4o mini, GPT-4.1 |
| **OpenRouter** | All models via unified API (incl. free tier) |
| **Azure OpenAI** | Enterprise deployment with API versioning |

### Local Providers
| Provider | Models |
|----------|--------|
| **Ollama** | Llama 3.2, Qwen 2.5, any Ollama-compatible model |
| **LM Studio** | Any local model via LM Studio |
| **Custom** | Any OpenAI-compatible endpoint |

### Model Management
- Per-model API keys (no need to configure per-provider)
- Per-model temperature and max tokens override
- Enable/disable models in the model selector
- Connection test from settings
- Built-in model catalog with pre-configured endpoints

---

## Tools (30+)

### Read Tools
| Tool | Description |
|------|-------------|
| `read_file` | Read the complete content of any vault file |
| `list_files` | List files and folders in a directory (recursive optional) |
| `search_files` | Full-text and regex search across files with line numbers |

### Vault Intelligence Tools
| Tool | Description |
|------|-------------|
| `get_vault_stats` | Overview of vault: note count, folder structure, top tags, recent files |
| `get_frontmatter` | Read all YAML frontmatter fields of a note |
| `update_frontmatter` | Set or update frontmatter fields without touching note body |
| `search_by_tag` | Find all notes with given tags (AND/OR matching) |
| `get_linked_notes` | Get forward links and backlinks for a note |
| `get_daily_note` | Read today's/yesterday's/tomorrow's daily note; create if missing |
| `open_note` | Open a note in the Obsidian editor |
| `semantic_search` | Find notes by meaning using hybrid semantic + keyword search |
| `query_base` | Query an Obsidian Bases database view and return matching notes |

### Writing & Editing Tools
| Tool | Description |
|------|-------------|
| `write_file` | Create a new file or completely replace an existing file |
| `edit_file` | Replace a specific string in an existing file (safe targeted edit) |
| `append_to_file` | Append content to the end of a file (ideal for logs, daily notes) |
| `create_folder` | Create a folder including all parent folders |
| `delete_file` | Move a file or empty folder to the trash (recoverable) |
| `move_file` | Move or rename a file or folder |

### Advanced Vault Tools
| Tool | Description |
|------|-------------|
| `generate_canvas` | Create an Obsidian Canvas (.canvas) file visualizing note connections |
| `create_base` | Create an Obsidian Bases (.base) database view file |
| `update_base` | Add or replace a view in an existing Bases file |

### Web Tools
| Tool | Description |
|------|-------------|
| `web_fetch` | Fetch a URL and return its content as Markdown |
| `web_search` | Search the web and return titles, URLs, snippets |

### Agent Control Tools
| Tool | Description |
|------|-------------|
| `ask_followup_question` | Ask the user a clarifying question with optional answer choices |
| `attempt_completion` | Signal that the task is complete |
| `update_todo_list` | Publish a task plan as a visible checklist |
| `switch_mode` | Switch the active agent mode mid-conversation |
| `new_task` | Spawn a sub-agent in a fresh context (multi-agent workflows) |

### MCP Tool
| Tool | Description |
|------|-------------|
| `use_mcp_tool` | Call any tool on a connected MCP server |

---

## Semantic Search (Hybrid RAG)

- **Local vector index** powered by Vectra (HNSW) — no cloud service required
- **Embedding models**: Xenova/transformers (runs ONNX locally in Electron), or API-based models
- **Hybrid search**: semantic similarity + Orama full-text keyword search, fused with Reciprocal Rank Fusion (RRF)
- **Graph augmentation**: 1-hop wikilink neighbor surfacing — notes connected to results are shown as linked context
- **HyDE** (Hypothetical Document Embeddings): generate a hypothetical note excerpt before embedding the query for richer matches
- **PDF indexing** via pdfjs-dist — extracts and indexes PDF text content
- **Metadata filters**: restrict results by folder prefix, frontmatter tags, or modification date
- **Incremental indexing**: resumes from where it left off; only re-indexes changed files
- **Auto-indexing**: optionally rebuild on startup, mode-switch, or on file change
- **Configurable chunk size** (default 2000 chars) with heading-aware splitting
- **Excluded folders**: skip specific vault folders from indexing
- **Storage location**: Obsidian sync folder or local-only

---

## Context Injection System

### Rules
- Markdown/text files at `.obsidian-agent/rules/`
- Enabled rules are injected into the system prompt as a permanent `RULES` section
- Toggle individual rule files on/off in Settings → Rules
- No size limit per file (capped at 50,000 chars for safety)
- New rules are enabled by default

### Skills
- Stored at `.obsidian-agent/skills/{name}/SKILL.md`
- Automatically injected when the user's message contains matching keywords
- Keyword matching: description words in SKILL.md frontmatter vs. words in user message
- Full skill content inlined into system prompt (no agent read_file round-trip needed)
- Per-mode **forced skills**: always inject specific skills in a mode regardless of keywords
- Managed in Settings → Skills

### Workflows (Slash Commands)
- Markdown/text files at `.obsidian-agent/workflows/`
- Invoked by typing `/workflow-name` at the start of a message
- Workflow content is prepended to the message as explicit instructions
- Rest of the message after `/workflow-name text` is appended after the instructions
- Toggle workflows on/off in Settings → Workflows
- Per-mode **forced workflow**: apply a workflow to all messages in a mode

### Custom Prompts
- User-defined slash-command templates in Settings → Prompts
- Invoked with `/prompt-slug` (supports `/slug additional text`)
- Template variables: `{{userInput}}`, `{{activeFile}}`
- Optional mode restriction (prompt only shows in specific modes)
- Shown in autocomplete when typing `/`

---

## Permissions & Safety

### Auto-Approval System
Fine-grained control over which operations require manual user approval:

| Category | Controls |
|----------|----------|
| **Read** | read_file, list_files, search_files |
| **Note Edits** | write_file, edit_file, append_to_file, update_frontmatter |
| **Vault Changes** | create_folder, delete_file, move_file |
| **Web** | web_fetch, web_search |
| **MCP** | use_mcp_tool |
| **Mode Switching** | switch_mode |
| **Subtasks** | new_task (spawn sub-agents) |
| **Questions** | ask_followup_question (skip approval card) |
| **Todos** | update_todo_list |
| **Skills** | Skill injection |

- **Master toggle**: disable auto-approval to require manual approval for everything
- **Quick-toggle bar** in chat view for instant permission switching during a session
- **Approval modal** with diff preview for write operations
- **Fail-closed**: defaults to rejection if no approval callback is available

### Vault Access Governance
- `.obsidian-agentignore` — gitignore-style patterns, completely blocks read and write access
- `.obsidian-agentprotected` — patterns that can be read but never written or deleted
- **Always blocked**: `.git/`, `.obsidian/workspace`, `.obsidian/cache`
- **Always protected**: the ignore and protected files themselves

---

## Checkpoints (Automatic Undo)

- **Shadow git repository** at `.obsidian/plugins/obsidian-agent/checkpoints/` using isomorphic-git (pure JS — no git binary required)
- **Automatic snapshot** taken before a task's first write operation
- Tracks which files were changed in each snapshot
- **Restore UI** in Settings → Backup with file-level diff preview
- Configurable checkpoint timeout
- Optional auto-cleanup of old checkpoints

---

## Multi-Agent Workflows (new_task)

The `new_task` tool enables complex agentic patterns:

| Pattern | Description |
|---------|-------------|
| **Prompt Chaining** | Sequential agents, each building on the previous result |
| **Orchestrator-Worker** | Main agent plans, worker agents execute focused subtasks in parallel |
| **Evaluator-Optimizer** | Generate → evaluate → refine loop until quality threshold is met |
| **Routing** | Delegate to the right sub-agent based on subtask type (Ask vs. Agent) |

- Sub-agents run with **fresh conversation context** (no context bleeding)
- All necessary context must be passed in the task message
- Sub-agents can be Ask (read-only) or Agent (full capabilities)

---

## Advanced Loop Controls

| Setting | Description |
|---------|-------------|
| **Consecutive Mistake Limit** | Stop the agent after N consecutive tool errors (default: 3) |
| **Rate Limit** | Minimum milliseconds between API iterations (prevent rate-limit errors) |
| **Context Condensing** | Auto-summarize conversation when estimated tokens exceed a configurable % of the context window |
| **Power Steering** | Inject a mode-reminder every N iterations to keep the agent on task during long runs |
| **Tool Repetition Detection** | Detect and abort infinite tool loops |
| **Max Iterations** | Hard cap on agentic loop iterations (default: 10 per turn) |

---

## MCP Server Integration

- **Transports**: stdio, SSE, streamable-http
- **Tool discovery**: automatic — available MCP tools shown in system prompt
- **Per-mode whitelisting**: limit which MCP servers a mode can access
- **Always-allow list**: specific tools on a server that never require user approval
- **Connection management**: connect/disconnect per server, status monitoring
- **Environment variables**: inject secrets as env vars for stdio servers

---

## Chat Interface

- **Sidebar view** (left or right panel, configurable)
- **Streaming responses** with real-time text rendering
- **Markdown rendering** of agent responses
- **Activity block**: expandable real-time tool call log with input/output
- **Todo checklist**: visible progress tracker for multi-step tasks
- **Token usage badge**: input + output tokens displayed per response
- **Diff-stats badge**: `+N / -N` lines badge on write operations
- **Mode selector** in chat header
- **Model selector** in chat header
- **New Chat** button (resets conversation)
- **Regenerate** last response
- **Stop** in-flight request
- **Context attachment**: auto-includes currently open file
- **File picker** (`@filename` to attach vault files)
- **Autocomplete**: `/` for workflows/prompts, `@` for vault files
- **Tool picker popover**: session overrides for tools, skills, workflows
- **Chat history**: save conversations to vault folder; browse/restore via modal
- **Enter to send** or **Ctrl+Enter** (configurable)

---

## Logging & Audit Trail

- **JSONL operation log** at `.obsidian/plugins/obsidian-agent/logs/YYYY-MM-DD.jsonl`
- **Retention**: 30 days (auto-cleanup)
- **Log fields**: timestamp, taskId, mode, tool, params (sanitized), success, durationMs, error
- **Parameter sanitization**: redacts passwords, strips URL credentials, truncates long values
- **Log viewer** in Settings → Logs with date picker

---

## Security Features

| Feature | Description |
|---------|-------------|
| **Prompt Injection Guard** | Security boundary in system prompt warns agent not to follow instructions from file/web content |
| **Path Validation** | IgnoreService blocks access to sensitive vault paths before tool execution |
| **Command Injection Prevention** | Validation of stdio MCP server commands |
| **ReDoS Protection** | Safe regex patterns in search tools |
| **Fail-Closed Defaults** | Rejects write operations when approval callback unavailable |
| **Tool Repetition Detection** | Prevents runaway infinite tool loops |
| **Rate Limiting** | Configurable minimum delay between API iterations |

---

## Developer / Build

- **TypeScript** (strict mode, full type coverage)
- **esbuild** bundler — fast dev rebuilds with `npm run dev`
- **Auto-deploy** to local vault on build (configurable vault path in `esbuild.config.mjs`)
- **ESLint** + **Prettier** for code quality
- **Apache-2.0** license
