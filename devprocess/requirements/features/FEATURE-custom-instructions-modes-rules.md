# Feature: Custom Instructions, Custom Modes, and Rules
Priority: P0
Related Epic: `requirements/epics/EPIC-core-engine.md`

## Description
Obsidian Agent must support user-configurable prompting and governance layers that shape how the agent behaves across all interactions.

This includes:
- **Custom Instructions (global):** persistent, user-authored instructions applied to every task.
- **Custom Instructions (per-mode):** overrides/extensions for a selected Mode.
- **Custom Modes:** user-defined modes with their own names, prompts, and tool allow-lists.
- **Custom Rules:** workspace/vault rules that constrain behavior (e.g., “never modify /Journal”, “always ask before deleting”).

This feature exists to achieve parity with “Kilo Code”-style control surfaces and to ensure predictable agent behavior in a local-first vault.

## Benefits Hypothesis
- Users can steer the agent reliably without repeating prompts.
- Organizations / power users can standardize safe behaviors.
- Governance rules reduce accidental destructive edits.

## User Stories
- As a user, I want to define global custom instructions that are always applied.
- As a user, I want to add mode-specific instructions (e.g., Writer vs Architect).
- As a user, I want to create a new Mode (name + prompt + allowed tools) without editing plugin source.
- As a user, I want to export/import my Modes and Instructions.
- As a user, I want vault-specific rules to be detected from a file in the vault (so the agent follows the project’s conventions).

## Acceptance Criteria
- [ ] **Global Custom Instructions:** User can set persistent global instructions in Settings.
- [ ] **Mode Custom Instructions:** User can set additional instructions per Mode.
- [ ] **Instruction Precedence:** Prompt composition is deterministic and documented:
  - System safety/governance > vault rules > global instructions > mode instructions > user message.
- [ ] **Custom Modes CRUD:** User can create, edit, duplicate, and delete custom modes.
- [ ] **Tool Allow-List per Mode:** Each mode defines which tools can be called.
- [ ] **Import/Export:** Users can export/import Modes + instructions (JSON is sufficient for MVP).
- [ ] **Workspace/Vault Rules Discovery:** If a well-known rules path exists (e.g., `.kilocode/rules/**` or a configurable vault folder), Obsidian Agent loads these rules and surfaces them in the “Active Context / System” panel.
- [ ] **Safety:** Rules that restrict writes MUST be enforced by the tool interception layer (cannot be bypassed by prompt).

## Success Criteria
- SC-01: Users can reproduce a consistent “agent personality” across sessions.
- SC-02: Users can share a mode/instruction bundle and get the same behavior on a different machine.

## NFRs (quantified)
- **Prompt Build Time:** Prompt assembly adds < 50ms overhead per request.
- **Stability:** Malformed rules/config files do not crash the plugin; Obsidian Agent falls back to defaults.

## ASRs
- 🟡 **ASR-CUST-01: Deterministic Prompt Composition**
  - Prompt assembly order must be stable and testable.

## Dependencies
- Settings persistence (Obsidian plugin settings).
- Safe file read access to vault rules/config files.
