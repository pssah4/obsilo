# Obsidian Agent

> Agentic operating layer for Obsidian - Kilo Code for knowledge work

**Status:** 🚧 In Development (MVP Phase)

Obsidian Agent is an Obsidian plugin that provides a safe, controlled, agentic interface for vault operations. It brings the tool-use, approval, and checkpoint patterns from Kilo Code to Obsidian's knowledge management context.

---

## ✨ Features

### Core Capabilities
- 🤖 **Agent Modes**: Specialized personas (Ask, Writer, Architect) with scoped tool access
- ✅ **Approval System**: All write operations require explicit user approval
- 💾 **Local Checkpoints**: Automatic version control with restore capability (isomorphic-git)
- 🔌 **MCP Support**: Extend functionality with Model Context Protocol servers
- 🔍 **Semantic Search**: Local vector search for vault-wide knowledge retrieval
- 📝 **Context Awareness**: Automatically includes active file and @mentions

### Safety & Privacy
- 🔒 **Local-Only**: No cloud dependencies (except user-configured LLM providers)
- 🛡️ **Approval-by-Default**: Explicit consent for all write operations
- ⏮️ **Undo Capability**: Restore vault to any previous checkpoint
- 📋 **Operation Logging**: Complete audit trail of all actions
- 🚫 **Ignore System**: `.obsidianagentignore` file support

---

## 🏗️ Architecture

Obsidian Agent adapts the proven Kilo Code architecture:

```
┌─────────────────────────────────────────┐
│        Tool Execution Pipeline          │
│     (Central Governance Layer)          │
└─────────────┬───────────────────────────┘
              │
    ┌─────────┼─────────┐
    ▼         ▼         ▼
┌────────┐ ┌──────┐ ┌──────────┐
│ Vault  │ │ MCP  │ │ Semantic │
│ Tools  │ │Tools │ │  Search  │
└────────┘ └──────┘ └──────────┘
```

### Key Components
- **Tool Execution Pipeline**: Single entry point for all operations (ASR-02)
- **Shadow Checkpoint System**: isomorphic-git based restore points (ASR-01)
- **MCP Integration**: External tools through governance layer (ASR-mcp-01)
- **Semantic Index**: Local vector DB with Orama + @xenova/transformers (ASR-03)

---

## 📋 Requirements

- **Obsidian**: v1.4.0 or higher
- **Platform**: Desktop only (Electron/Node.js environment)
- **API Keys**: Bring your own (Anthropic, OpenAI, or use local Ollama)

---

## 🚀 Installation

### Development Installation

1. Clone this repository:
```bash
git clone https://github.com/yourusername/obsidian-agent.git
cd obsidian-agent
```

2. Install dependencies:
```bash
npm install
```

3. Build the plugin:
```bash
npm run build
```

4. Link to your Obsidian vault:
```bash
# Create symbolic link in your vault's plugins directory
ln -s /path/to/obsidian-agent /path/to/your-vault/.obsidian/plugins/obsidian-agent
```

5. Enable the plugin in Obsidian:
   - Open Settings → Community Plugins
   - Enable "Obsidian Agent"

### Development Mode

For active development with auto-rebuild:
```bash
npm run dev
```

---

## 🎯 Usage

### Opening the Agent Sidebar

- **Command Palette**: `Ctrl/Cmd+P` → "Open Agent Sidebar"
- **Sidebar Icon**: Click the robot icon in the left/right sidebar

### Agent Modes

**Ask Mode** (Read-Only)
- Purpose: Answer questions about your vault
- Tools: Read, search, semantic search

**Writer Mode**
- Purpose: Edit and create content
- Tools: Read + write operations, diffs

**Architect Mode**
- Purpose: Organize and structure vault
- Tools: All vault ops + canvas generation

### Using @Mentions

Reference notes in your prompts:
```
Summarize the key points from @[[Meeting Notes]] and @[[Project Plan]]
```

### Approval Workflow

When the agent proposes a write operation:
1. Review the proposed change (diff preview)
2. Click **Approve** to execute or **Deny** to reject
3. Option to **Always Allow** for trusted operations

### Checkpoints & Restore

- Checkpoints are created automatically before write operations
- View checkpoint history in the sidebar
- Restore to any previous state with one click
- Diff preview shows what changed

---

## ⚙️ Configuration

### LLM Provider Setup

Settings → Obsidian Agent → Providers

**Anthropic (Claude):**
```json
{
  "type": "anthropic",
  "apiKey": "sk-ant-...",
  "model": "claude-sonnet-4-5-20250929"
}
```

**OpenAI:**
```json
{
  "type": "openai",
  "apiKey": "sk-...",
  "model": "gpt-4-turbo-preview"
}
```

**Ollama (Local):**
```json
{
  "type": "ollama",
  "baseUrl": "http://localhost:11434",
  "model": "llama2"
}
```

### MCP Server Setup

Add external tools via MCP servers:

```json
{
  "fetch": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-fetch"]
  }
}
```

---

## 🗺️ Roadmap

### Phase 1: Foundation ✅
- [x] Plugin structure
- [x] Basic UI
- [ ] Tool execution pipeline

### Phase 2-3: Safety (In Progress)
- [ ] Approval system
- [ ] Checkpoint system

### Phase 4: Agent Core
- [ ] LLM integration
- [ ] Conversational interface

### Phase 5: Modes
- [ ] Mode system
- [ ] Specialized personas

### Phase 6: MCP
- [ ] MCP client
- [ ] External tools

### Phase 7: Semantic Index
- [ ] Vector search
- [ ] Background indexing

### Phase 8: Polish
- [ ] Performance optimization
- [ ] Documentation
- [ ] Testing

**Target:** MVP complete in 12 weeks

---

## 📚 Documentation

- [System Architecture](docs/architecture/system-overview.md)
- [Component Designs](docs/architecture/component-designs.md)
- [Implementation Roadmap](docs/architecture/implementation-roadmap.md)
- [Requirements](requirements/overview.md)

---

## 🤝 Contributing

Contributions welcome! This project is in active development.

### Development Setup
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

### Code Style
- TypeScript with strict mode
- Follow existing patterns
- Add comments for complex logic
- Update documentation

---

## 📄 License

Apache-2.0 License - see [LICENSE](LICENSE) file for details

---

## 🙏 Acknowledgments

- **Kilo Code**: Reference architecture and patterns
- **Obsidian Team**: Amazing plugin API
- **MCP Project**: Extensibility protocol

---

## ⚠️ Status

**Current Phase:** Foundation (Phase 1)
**Last Updated:** 2026-02-17

This plugin is under active development. Features are being implemented according to the 8-phase roadmap. See [Implementation Roadmap](docs/architecture/implementation-roadmap.md) for details.

---

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/yourusername/obsidian-agent/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/obsidian-agent/discussions)

---

Built with ❤️ for the Obsidian community
