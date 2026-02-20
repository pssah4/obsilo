# Obsidian Agent - Component Designs

**Version:** 1.0
**Date:** 2026-02-17

This document provides detailed designs for each major component of Obsidian Agent.

---

## 1. Plugin Entry Point

**File**: `src/main.ts`

### Responsibilities
- Plugin lifecycle management (load/unload)
- Service initialization and coordination
- Settings persistence
- Command and view registration

### Key Methods

```typescript
class ObsidianAgentPlugin extends Plugin {
    async onload(): void
    async onunload(): void
    async loadSettings(): Promise<void>
    async saveSettings(): Promise<void>
    activateView(): Promise<void>
}
```

### Initialization Sequence
1. Load settings from disk
2. Initialize core services (provider, mcpHub, checkpointService, semanticIndex)
3. Register views (sidebar)
4. Register commands
5. Initialize MCP connections
6. Start semantic indexing (background)

---

## 2. Tool Execution Pipeline

**File**: `src/core/tool-execution/ToolExecutionPipeline.ts`

### Critical Component (ASR-02)
This is the **single entry point** for all tool executions (internal + MCP).

### Responsibilities
- Validate operations against ignore/protect lists
- Check auto-approval rules
- Request user approval when needed
- Create checkpoints before write operations
- Execute tools
- Log all operations
- Handle errors

### Execution Flow

```typescript
async executeTool(toolCall: ToolUse, callbacks: ToolCallbacks): Promise<ToolResult> {
    // 1. Validate operation
    const validation = await this.validateOperation(toolCall);
    if (!validation.allowed) {
        return this.createDeniedResult(validation.reason);
    }

    // 2. Check auto-approval
    const approvalResult = await this.checkAutoApproval(toolCall);

    // 3. Request user approval if needed
    if (approvalResult.decision === 'ask') {
        const userDecision = await this.approvalHandler.requestApproval(toolCall);
        if (userDecision === 'deny') {
            return this.createDeniedResult('User rejected');
        }
    }

    // 4. Create checkpoint (write operations)
    let checkpointHash: string | undefined;
    if (tool.isWriteOperation) {
        checkpointHash = await this.checkpointService.createCheckpoint(
            `Before ${toolCall.name}`
        );
    }

    // 5. Execute tool
    const result = await tool.execute(toolCall, this.task, callbacks);

    // 6. Log operation
    await this.logOperation(toolCall, result, checkpointHash);

    return result;
}
```

### Integration Points
- **Input**: Tool calls from LLM response
- **Output**: Tool results back to LLM
- **Dependencies**: ApprovalHandler, CheckpointService, ToolRegistry, IgnoreController

---

## 3. Shadow Checkpoint Service

**File**: `src/services/checkpoints/ShadowCheckpointService.ts`

### Critical Component (ASR-01)
Provides version control for vault operations using isomorphic-git.

### Responsibilities
- Initialize shadow git repository
- Create checkpoints (commits) before write operations
- Restore vault to previous checkpoint
- Generate diffs between checkpoints
- Sync vault ↔ shadow repository

### Key Methods

```typescript
class ShadowCheckpointService {
    async initShadowRepo(): Promise<void>
    async createCheckpoint(message: string): Promise<string>
    async restoreCheckpoint(commitHash: string): Promise<void>
    async getDiff(options: { from: string; to?: string }): Promise<CheckpointDiff[]>
    private async syncVaultToShadow(): Promise<void>
    private async syncShadowToVault(): Promise<void>
}
```

### Shadow Repository Structure

```
.obsidian-agent/
└── checkpoints/
    └── {task-id}/
        ├── .git/
        │   ├── objects/
        │   ├── refs/
        │   └── HEAD
        └── {vault files mirrored}
```

### Checkpoint Flow

**Create Checkpoint:**
1. Copy vault files to shadow repo (respecting .obsidian-agentignore)
2. Stage all changes (`git add`)
3. Create commit with message and metadata
4. Emit 'checkpoint' event with commit hash

**Restore Checkpoint:**
1. Checkout specified commit (`git checkout`)
2. Copy files from shadow repo back to vault
3. Use Obsidian Vault API to write changes
4. Rewind task messages to checkpoint point

### Performance Considerations
- Async operations to avoid blocking UI
- Selective sync (only changed files)
- Debounced checkpoint creation
- Background cleanup of old checkpoints

---

## 4. MCP Integration

**File**: `src/services/mcp/McpHub.ts`

### Critical Component (ASR-mcp-01)
Manages connections to external MCP servers and bridges their tools to the governance layer.

### Responsibilities
- Connect to configured MCP servers
- List and register tools from MCP servers
- Execute MCP tool calls
- Handle connection errors and retries
- Manage server lifecycle

### Key Methods

```typescript
class McpHub {
    async initialize(): Promise<void>
    private async connectToServer(name: string, config: McpServerConfig): Promise<void>
    async executeMcpTool(serverName: string, toolName: string, args: any): Promise<any>
    async dispose(): Promise<void>
}
```

### MCP Tool Wrapper

**File**: `src/core/tools/mcp/McpToolWrapper.ts`

Wraps MCP tools to integrate with ToolExecutionPipeline:

```typescript
class McpToolWrapper extends BaseTool {
    readonly name = 'use_mcp_tool';
    readonly isWriteOperation: boolean;  // Inferred from tool description

    async execute(params: UseMcpToolParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
        const result = await task.provider.plugin.mcpHub.executeMcpTool(
            params.server,
            params.tool,
            params.arguments
        );
        callbacks.pushToolResult(JSON.stringify(result));
    }
}
```

### Connection States
- `connected`: Server is active and tools are available
- `disconnected`: Server failed to connect or was manually disabled
- `connecting`: Connection in progress
- `error`: Connection error with retry logic

---

## 5. Tool Registry

**File**: `src/core/tools/ToolRegistry.ts`

### Responsibilities
- Register internal vault operation tools
- Register MCP tools from external servers
- Provide tool lookup by name
- Generate tool schemas for LLM context

### Tool Categories

**Vault Operations:**
- `read_file`, `write_file`, `list_files`, `search_files`, `delete_file`
- `create_folder`, `rename_file`

**Content Operations:**
- `apply_diff`, `search_replace`

**Canvas Operations:**
- `create_canvas`, `add_canvas_node`

**Semantic Operations:**
- `semantic_search`

**System Operations:**
- `attempt_completion`, `update_todo_list`

**MCP Tools:**
- Dynamically registered from MCP servers
- Wrapped with `McpToolWrapper`

### Tool Interface

```typescript
abstract class BaseTool<TName extends ToolName = ToolName> {
    abstract readonly name: TName;
    abstract readonly isWriteOperation: boolean;

    abstract parseLegacy(params: Record<string, string>): ToolParams;
    abstract execute(params: ToolParams, task: Task, callbacks: ToolCallbacks): Promise<void>;

    getDefinition(): ToolDefinition;
}
```

---

## 6. Approval System

**File**: `src/core/approval/ApprovalHandler.ts`

### Responsibilities
- Request user approval for tool operations
- Check auto-approval rules
- Manage approval UI state
- Track approval history

### Approval Flow

```typescript
async requestApproval(toolCall: ToolUse, prompt: ApprovalPrompt): Promise<'approve' | 'deny' | 'always'> {
    // Show approval UI in sidebar
    const response = await this.task.ask('tool', JSON.stringify({
        tool: toolCall.name,
        params: toolCall.params,
        isProtected: prompt.isProtected,
        targetPath: prompt.targetPath,
    }));

    if (response.response === 'yesButtonClicked') {
        return 'approve';
    }

    if (response.response === 'alwaysAllow') {
        await this.addToWhitelist(toolCall);
        return 'always';
    }

    return 'deny';
}
```

### Auto-Approval Rules

**File**: `src/core/approval/AutoApprovalHandler.ts`

Checks:
- Is tool in whitelist?
- Is tool read-only?
- Has approval limit been reached?
- Is cost limit exceeded?

### Approval UI

Displays in sidebar:
- Tool name and operation type
- Target file/path
- Diff preview (if applicable)
- Buttons: [Approve] [Deny] [Always Allow]

---

## 7. Mode System

**File**: `src/core/modes/ModeManager.ts`

### Responsibilities
- Load default and custom modes
- Switch between modes
- Filter tools based on current mode
- Provide mode-specific system prompts

### Default Modes

**Ask Mode** (Read-Only):
- Tools: `read_file`, `list_files`, `search_files`, `semantic_search`
- Purpose: Answer questions about vault

**Writer Mode**:
- Tools: Read tools + `write_file`, `apply_diff`, `search_replace`
- Purpose: Edit and create content

**Architect Mode**:
- Tools: All vault ops + `create_canvas`, `add_canvas_node`
- Purpose: Organize and structure vault

### Mode Definition

```typescript
interface Mode {
    id: string;
    name: string;
    description: string;
    systemPrompt: string;
    allowedTools: ToolName[];
    mcpServers: string[];
    customInstructions?: string;
}
```

---

## 8. Semantic Index Service

**File**: `src/services/semantic-index/SemanticIndexService.ts`

### Critical Component (ASR-03)
Provides local vector search for vault-wide knowledge retrieval.

### Responsibilities
- Initialize Orama vector database
- Index markdown files in background
- Generate embeddings locally
- Provide semantic search
- Persist index to disk

### Technology Stack
- **Orama**: Embedded vector database
- **@xenova/transformers**: ONNX-based embedding generation
- **Model**: all-MiniLM-L6-v2 (384 dimensions)

### Indexing Flow

```typescript
async startIndexing(): Promise<void> {
    const files = this.plugin.app.vault.getMarkdownFiles();
    this.indexingQueue = [...files];

    // Process in batches to avoid UI freeze
    while (this.indexingQueue.length > 0) {
        const batch = this.indexingQueue.splice(0, 10);

        for (const file of batch) {
            await this.indexFile(file);
        }

        // Yield to prevent UI freezing
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}
```

### Search

```typescript
async searchSemantic(query: string, limit = 10): Promise<SearchResult[]> {
    const queryEmbedding = await this.generateEmbedding(query);

    const results = await search(this.db, {
        mode: 'vector',
        vector: {
            value: queryEmbedding,
            property: 'embedding',
        },
        limit,
    });

    return results.hits;
}
```

---

## 9. Context Manager

**File**: `src/core/context/ContextManager.ts`

### Responsibilities
- Track active file
- Manage pinned files
- Process @mentions
- Build context for LLM calls
- Estimate token counts

### Context Sources

```typescript
interface ContextSource {
    type: 'active-file' | 'pinned-file' | 'mention' | 'url';
    path?: string;
    content: string;
    tokens: number;
}
```

### Mention Processing

```typescript
async processUserMention(mention: string): Promise<string> {
    // Handle @[[Note Name]] mentions
    const file = this.plugin.app.metadataCache.getFirstLinkpathDest(mention, '');

    if (file) {
        const content = await this.plugin.app.vault.read(file);
        return content;
    }

    return '';
}
```

---

## 10. Task Orchestrator

**File**: `src/core/task/Task.ts`

### Responsibilities
- Orchestrate LLM conversations
- Build system prompts
- Parse LLM responses
- Execute tool calls via ToolExecutionPipeline
- Manage conversation history
- Handle errors and retries

### Key Flow

```typescript
async startTask(userMessage: string): Promise<void> {
    // 1. Build context
    const context = await this.contextManager.buildContext();

    // 2. Build messages
    const messages = [
        { role: 'user', content: userMessage },
    ];

    // 3. Call LLM
    const stream = await this.apiHandler.createMessage({
        system: this.buildSystemPrompt(),
        messages,
        tools: this.getToolsForMode(),
    });

    // 4. Process stream
    for await (const chunk of stream) {
        if (chunk.type === 'text') {
            await this.handleTextChunk(chunk);
        } else if (chunk.type === 'tool_use') {
            await this.handleToolCall(chunk);
        }
    }
}
```

---

## 11. UI Components

### AgentSidebarView

**File**: `src/ui/AgentSidebarView.ts`

Main sidebar interface with:
- Mode selector bar
- Chat message container
- Context indicator
- Input area with @mention support

### Approval Card

Renders approval requests:
- Tool name and icon
- Target file/path
- Operation preview (diff)
- Action buttons

### Message Renderer

Handles different message types:
- User messages
- Assistant responses (markdown rendered)
- Tool execution cards
- Checkpoint indicators
- Error messages

---

## Related Documents

- [System Overview](system-overview.md)
- [Data Flows](data-flows.md)
- [Interfaces](interfaces.md)
- [Implementation Roadmap](implementation-roadmap.md)
