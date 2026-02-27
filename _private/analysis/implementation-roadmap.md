# Obsidian Agent - Implementation Roadmap

**Version:** 1.0
**Date:** 2026-02-17
**Estimated Timeline:** 12 weeks to MVP

---

## Overview

This roadmap defines an 8-phase approach to building Obsidian Agent from foundation to production-ready MVP. Each phase builds on the previous, with clear success criteria.

---

## Phase 1: Foundation (Weeks 1-2)

### Goal
Basic plugin structure + tool execution pipeline

### Tasks
- [x] Plugin scaffolding (manifest, main.ts, settings)
- [ ] `ToolRegistry` and `BaseTool` architecture
- [ ] `ToolExecutionPipeline` (without approval/checkpoints yet)
- [ ] Basic vault operation tools:
  - `read_file`
  - `write_file`
  - `list_files`
  - `search_files`
- [ ] Simple sidebar view (testing tool execution)
- [ ] Settings UI (basic)

### Success Criteria
- ✅ Plugin loads successfully in Obsidian
- ✅ Can execute read/write tools through the pipeline
- ✅ Sidebar view renders and accepts input

### Deliverables
- Working plugin that can read and write files
- Tool execution framework in place
- Basic UI shell

---

## Phase 2: Approval System (Week 3)

### Goal
Implement safety layer - approval before write operations

### Tasks
- [ ] `ApprovalHandler` implementation
- [ ] Approval UI cards in sidebar
- [ ] `.obsidian-agentignore` file support
- [ ] `.obsidian-agentprotected` file support
- [ ] `IgnoreController` and `ProtectedController`
- [ ] Auto-approval rules (read-only tools)
- [ ] `AutoApprovalHandler` with limits:
  - Request count limits
  - Cost tracking (optional for MVP)

### Success Criteria
- ✅ 100% of write operations trigger approval UI
- ✅ User can approve/deny operations
- ✅ Ignored files cannot be accessed
- ✅ Protected files require explicit approval

### Deliverables
- Full approval system operational
- Ignore/protect file support
- Auto-approval for read operations

---

## Phase 3: Checkpoints (Week 4)

### Goal
Implement undo capability via isomorphic-git

### Tasks
- [ ] `ShadowCheckpointService` core implementation
- [ ] isomorphic-git integration:
  - Initialize shadow repo
  - Create commits
  - Checkout commits
- [ ] Vault ↔ Shadow sync logic
- [ ] Checkpoint creation before write operations
- [ ] Restore UI and flow
- [ ] Diff preview functionality
- [ ] Integration with `ToolExecutionPipeline`

### Success Criteria
- ✅ Checkpoint created before every write operation
- ✅ Can restore vault to previous checkpoint
- ✅ Diff preview shows what changed
- ✅ No data loss during restore

### Deliverables
- Working checkpoint system
- Restore capability
- Diff visualization

### Risk Mitigation
- Test with large vaults (1000+ files) to validate performance
- Implement async operations to avoid UI blocking

---

## Phase 4: Agent Core (Weeks 5-6)

### Goal
LLM integration + conversational chat interface

### Tasks
- [ ] `Task` class (main orchestrator)
- [ ] API handler for LLM providers:
  - Anthropic (Claude)
  - OpenAI (GPT)
  - Ollama (local models)
- [ ] System prompt construction
- [ ] Tool call parsing:
  - Native tool use format
  - XML-based tool format (fallback)
- [ ] Streaming response handling
- [ ] Chat UI improvements:
  - Message rendering (markdown)
  - Tool execution cards
  - Error handling UI
- [ ] Context management:
  - Active file awareness
  - @mention processing

### Success Criteria
- ✅ End-to-end conversation with LLM
- ✅ LLM can call tools and receive results
- ✅ Chat interface displays conversation properly
- ✅ Active file context automatically included

### Deliverables
- Working agent that can:
  - Answer questions about vault
  - Execute vault operations via tools
  - Handle multi-turn conversations
- Full chat UI

---

## Phase 5: Mode System (Week 7)

### Goal
Implement specialized agent personas

### Tasks
- [ ] `ModeManager` implementation
- [ ] Default mode definitions:
  - Ask (read-only)
  - Writer (content editing)
  - Architect (structure operations)
- [ ] Mode-specific tool filtering
- [ ] Mode-specific system prompts
- [ ] Mode selector UI
- [ ] Mode persistence in settings

### Success Criteria
- ✅ Can switch between modes
- ✅ Tool availability changes based on mode
- ✅ System prompt changes based on mode
- ✅ Mode selection persists across sessions

### Deliverables
- 3 working modes with distinct behaviors
- Mode switcher in UI
- Clear visual indication of current mode

---

## Phase 6: MCP Integration (Week 8)

### Goal
External tool extensibility via Model Context Protocol

### Tasks
- [ ] `McpHub` implementation:
  - stdio transport support
  - Server connection management
  - Tool registration from MCP servers
- [ ] `McpToolWrapper` for governance integration
- [ ] MCP server configuration UI
- [ ] Per-mode MCP server enablement
- [ ] Approval flow for MCP tools
- [ ] Error handling for MCP failures

### Success Criteria
- ✅ Can connect to MCP server via stdio
- ✅ MCP tools appear in tool registry
- ✅ MCP tools execute through governance layer
- ✅ MCP tool calls require approval
- ✅ Failed MCP connections don't crash plugin

### Deliverables
- Working MCP client
- Settings UI for MCP configuration
- Example MCP server integration (e.g., fetch)

### Risk Mitigation
- Test MCP stdio transport in Obsidian's Electron environment early
- Implement connection timeout and retry logic

---

## Phase 7: Semantic Index (Weeks 9-10)

### Goal
Enable vault-wide knowledge retrieval

### Tasks
- [ ] `SemanticIndexService` implementation
- [ ] Orama database integration
- [ ] Local embedding generation:
  - @xenova/transformers setup
  - all-MiniLM-L6-v2 model
- [ ] Background indexing:
  - Queue management
  - UI feedback (progress indicator)
  - Chunking strategy
- [ ] `semantic_search` tool
- [ ] Index persistence to disk
- [ ] Incremental re-indexing on file changes

### Success Criteria
- ✅ Can index 1000+ markdown files without UI freeze
- ✅ Semantic search returns relevant results
- ✅ Index persists across sessions
- ✅ New/changed files are automatically indexed

### Deliverables
- Working semantic search
- Background indexing with progress UI
- Persisted index

### Performance Targets
- Indexing CPU usage < 20%
- Search response time < 1 second
- Index storage reasonable (< 100MB for 1000 files)

---

## Phase 8: Polish & Optimization (Weeks 11-12)

### Goal
Production readiness and MVP completion

### Tasks
- [ ] Performance optimization:
  - Checkpoint creation speed
  - Semantic indexing efficiency
  - UI responsiveness
- [ ] Error handling improvements:
  - Graceful degradation
  - User-friendly error messages
  - Recovery mechanisms
- [ ] Settings UI polish:
  - Better organization
  - Help text
  - Validation
- [ ] Documentation:
  - User guide
  - Setup instructions
  - Troubleshooting
- [ ] Canvas generation tools:
  - `create_canvas`
  - `add_canvas_node`
- [ ] Operation logging:
  - Persistent log
  - Log viewer UI
- [ ] Testing:
  - Integration tests
  - Performance tests
  - Large vault testing

### Success Criteria
- ✅ Plugin loads in < 1 second
- ✅ UI remains responsive during all operations
- ✅ No crashes during normal operation
- ✅ Clear error messages for all failure modes
- ✅ Documentation complete

### Deliverables
- Production-ready MVP
- Complete documentation
- Test suite
- Performance benchmarks

---

## Critical Path Analysis

### Must Complete in Order:
1. **Phase 1** (Foundation) → Everything depends on this
2. **Phase 2** (Approval) → Required for safety
3. **Phase 3** (Checkpoints) → Required for undo
4. **Phase 4** (Agent Core) → Required for functionality
5. **Phase 5** (Modes) → Required for UX

### Can Develop in Parallel:
- **Phase 6** (MCP) can start after Phase 4
- **Phase 7** (Semantic Index) can start after Phase 4
- **Phase 8** (Polish) activities can start during Phases 6-7

### Suggested Parallel Work:
- While building Phase 4 (Agent Core), plan Phase 6 (MCP)
- While building Phase 5 (Modes), start Phase 7 (Semantic Index)
- Continuous polish and testing throughout

---

## Risk Management

### High-Risk Items

**Risk**: Isomorphic-git performance on large vaults
- **Mitigation**: Test early in Phase 3 with 5000+ files
- **Fallback**: Implement selective checkpointing (only changed files)

**Risk**: MCP stdio not working in Obsidian's Electron
- **Mitigation**: Create proof-of-concept in Phase 1
- **Fallback**: Defer MCP to post-MVP

**Risk**: Semantic indexing too slow
- **Mitigation**: Implement incremental indexing from start
- **Fallback**: Make indexing optional, manual trigger

**Risk**: LLM API rate limits/costs during development
- **Mitigation**: Use local Ollama for testing
- **Fallback**: Mock LLM responses for automated tests

### Medium-Risk Items

**Risk**: Tool execution error handling complexity
- **Mitigation**: Comprehensive error types and recovery flows
- **Fallback**: Clear error messages, graceful degradation

**Risk**: UI complexity in sidebar
- **Mitigation**: Iterative UI development with user feedback
- **Fallback**: Simplify initial UI, add features later

---

## Post-MVP Roadmap

### V1.1 (Future)
- Mobile support (requires alternative to isomorphic-git)
- Advanced canvas auto-creation
- Template automation
- Parallel agent execution (orchestrator subtasks)

### V1.2 (Future)
- Custom tool development API
- Plugin integration with other Obsidian plugins
- Alternative vector DB backends
- Custom embedding model support

---

## Weekly Checkpoints

### Week 2 Checkpoint
- ✅ Can execute basic read/write tools
- ✅ Tool registry functioning
- ✅ Basic sidebar renders

### Week 3 Checkpoint
- ✅ Approval system operational
- ✅ Write operations require approval

### Week 4 Checkpoint
- ✅ Checkpoints working
- ✅ Can restore vault state

### Week 6 Checkpoint
- ✅ End-to-end agent conversation
- ✅ Tools execute and return results

### Week 7 Checkpoint
- ✅ Modes working
- ✅ Tool filtering by mode

### Week 8 Checkpoint
- ✅ MCP integration functional
- ✅ External tools work

### Week 10 Checkpoint
- ✅ Semantic search operational
- ✅ Index persists

### Week 12 Checkpoint
- ✅ MVP feature complete
- ✅ Documentation done
- ✅ Ready for alpha testing

---

## Success Metrics

### Phase Completion Metrics
- All success criteria met
- No critical bugs
- Performance targets achieved

### MVP Completion Metrics
- All P0 features implemented and tested
- Documentation complete
- Alpha testers can use successfully
- No data loss in testing
- Performance acceptable on 1000+ file vaults

---

## Next Steps After Roadmap Complete

1. **Alpha Testing**: Internal testing with small group
2. **Beta Release**: Broader testing with community
3. **Community Feedback**: Gather requirements for V1.1
4. **Documentation**: User guides, tutorials, examples
5. **Marketing**: Announce on Obsidian forums, Reddit, Twitter
6. **V1.0 Release**: Public release on Obsidian Community Plugins

---

## Related Documents

- [System Overview](system-overview.md)
- [Component Designs](component-designs.md)
- [ADRs](adrs.md)
