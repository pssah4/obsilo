# Discord / Social Media Post -- Obsilo Agent v2.1

> Fuer den Obsidian Discord (#plugin-showcase / #updates) und andere Kanaele.
> Ton: sachlich, community-nah, kein Marketing-Speak, keine Emojis-Flut.
> Discord Obsidian Community Konventionen: kurz, scanbar, Link zum Repo.

---

## Post (Discord-Format, max ~2000 Zeichen)

```
**Obsilo Agent v2.1** -- AI agent for your vault

Update for those tracking Obsilo: v2.1 adds document intelligence, chat-linking, and Office document creation.

**What's new:**

**Document Parsing** -- Drag & drop PPTX, XLSX, DOCX, PDF, or CSV files into the chat. The agent reads and understands them. The semantic index now also indexes these formats alongside your Markdown notes.

**Chat-Linking** -- Conversations are now linked to your notes. When the agent edits a note, a deep link (`obsidian://obsilo-chat?id=...`) is added to the frontmatter. Click it to jump back to the conversation. Works both ways: link a chat to the note you're viewing, or let the agent auto-link on conversation end.

**Office Document Creation** -- Three new tools: `create_pptx`, `create_docx`, `create_xlsx`. The agent generates PowerPoint, Word, and Excel files directly in your vault. Slides with charts, formatted documents with tables, spreadsheets with formulas -- all from a single prompt.

**Task Extraction** -- The agent scans its own responses for `- [ ]` items and creates structured task notes with frontmatter (status, assignee, due date, source link).

**Other improvements:**
- Semantic index auto-updates on file changes (no manual rebuild needed)
- All 6 bugs from the last audit fixed
- Full i18n: 6 languages, 1048 app keys + 630 homepage keys each
- 46+ tools across 7 groups

**What Obsilo is:**
An open-source AI agent plugin for Obsidian. It runs in the sidebar, reads/writes/searches your vault using 46+ governed tools, supports semantic search (hybrid vector + BM25), has a 3-tier memory system, multi-agent workflows, and full approval controls. Works with Anthropic, OpenAI, Ollama, and 5+ other providers. Local-first, no telemetry.

GitHub: https://github.com/pssah4/obsilo
Docs: https://pssah4.github.io/obsilo/
Install: via BRAT -- add `https://github.com/pssah4/obsilo`

Feedback welcome. Apache 2.0.
```

---

## Kurzversion (fuer Twitter/X, Mastodon, max 280 Zeichen)

```
Obsilo Agent v2.1 -- AI agent for Obsidian. New: drag & drop Office docs into chat, chat-linking to notes, create PPTX/DOCX/XLSX from prompts, task extraction. 46+ tools, semantic search, multi-agent. Open source.
github.com/pssah4/obsilo
```

---

## Feature-Uebersicht (Vollstaendig, fuer Pinned Posts / README / Showcase)

```
**Obsilo Agent -- Full Feature Overview**

An autonomous AI operating layer for Obsidian. Runs in the sidebar, learns your vault.

**Core**
- 46+ tools in 7 groups (read, vault, edit, web, agent, skill, mcp)
- 6-step governed tool execution pipeline (validate > ignore check > approval > checkpoint > execute > log)
- Fail-closed approval: write operations denied by default unless approved
- Shadow git checkpoints: automatic snapshots before every write, one-click restore
- Streaming responses with real-time tool activity display

**AI & Search**
- Multi-provider: Anthropic, OpenAI, Google Gemini, Ollama, Azure, OpenRouter, LM Studio, custom
- Hybrid semantic search: Vectra HNSW vectors + BM25/TF-IDF, fused via Reciprocal Rank Fusion (k=60)
- HyDE (Hypothetical Document Expansion) for conceptual queries
- Heading-aware chunking with 10% overlap
- Auto-trigger: semantic index updates on every file change (debounced)

**Memory & Context**
- 3-tier memory: chat history > session extraction > long-term promotion
- Context condensing with emergency recovery on overflow
- Power steering: periodic system prompt reinforcement
- Active file context: auto-include the note you're viewing

**Document Intelligence**
- Parse PPTX, XLSX, DOCX, PDF, CSV, JSON, XML (drag & drop or via tool)
- Semantic index covers Office docs and PDFs alongside Markdown
- Create PPTX, DOCX, XLSX directly from agent prompts

**Agent Capabilities**
- Multi-agent: spawn sub-agents for parallel subtasks
- Mode system: Ask (read-only), Agent (full), custom modes with tool group filtering
- Task extraction: regex-based checkbox scanner > structured task notes with frontmatter
- Chat-linking: bidirectional deep links between notes and conversations
- Semantic chat titling via configurable LLM

**Extensibility**
- Rules (.rules.md): permanent instructions loaded into every prompt
- Skills (.skill.md): procedural recipes with keyword matching
- Workflows: slash-command templates (/daily-review, /research, custom)
- VaultDNA: auto-discovers installed plugins, generates skill files
- MCP servers: stdio, SSE, streamable-http transports
- Plugin API bridge: call any Obsidian plugin command from the agent
- Sandbox: evaluate_expression for custom JS/TS with CDN imports

**Safety**
- .obsidian-agentignore (gitignore syntax)
- Per-tool, per-mode approval rules
- Operation log (JSONL audit trail)
- Diff preview before every write
- API key encryption via OS keychain (Electron safeStorage)
- Sliding-window repetition detection (10-call window)
- Rate limiting per task

**UI**
- Sidebar with mode/model selector, chat history, file attachments
- Autocomplete: / for workflows, @ for vault files
- Tool picker for session overrides
- Token usage display
- Todo checklist cards
- 6 languages: English, German, Spanish, Japanese, Chinese, Hindi

Open source. Apache 2.0. No telemetry. Local-first.
```
