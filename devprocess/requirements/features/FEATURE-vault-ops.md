# Feature: Vault Operations (Full CRUD)
Priority: P0
Related Epic: `requirements/epics/EPIC-vault-ops.md`

## Description
A comprehensive set of tools (`read_file`, `write_file`, `list_files`, `search_files`) that allows the agent to navigate and modify the vault structure just like a user operating a file explorer or terminal.

## Benefits Hypothesis
- Enables complex refactoring tasks (move, rename, split notes) that are tedious by hand.
- Allows the agent to be "proactive" in organizing information.

## User Stories
- As a user, I want the agent to list files in a folder to understand what exists.
- As a user, I want the agent to read multiple files to synthesize a summary.
- As a user, I want the agent to create a new folder structure for a project.

## Acceptance Criteria
- [ ] **Read File:** Returns full text content of a markdown file.
- [ ] **Write File:** Overwrites (or creates) a file with new content.
- [ ] **Create Folder:** Creates nested directories if needed.
- [ ] **List Files:** Returns file paths (optionally recursive).
- [ ] **Search Files:** Returns file paths matching a text query (using Obsidian cache or separate index).
- [ ] **Safety:** All operations respect `.obsidian-agentignore`.

## Success Criteria
- SC-01: Agent can read/write any Markdown file in the vault.
- SC-02: Operations fail gracefully if permissions are denied or paths are invalid.

## NFRs (quantified)
- **Tool Execution Time:** File read/write < 50ms for typical note sizes (< 100kb).
- **Search Latency:** Basic text search returns results in < 200ms.

## ASRs
None specific, but must use Obsidian's `Vault` API where possible for best compatibility (e.g., triggering update events for other plugins).

## Dependencies
- Obsidian `Vault` API.
- Node `fs` (for deeper access if needed, e.g., hidden folders).
