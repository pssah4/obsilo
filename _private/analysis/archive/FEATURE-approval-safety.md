# Feature: Approval System & Safety
Priority: P0
Related Epic: `requirements/epics/EPIC-governance.md`

## Description
A centralized system that intercepts every tool action intended to modify the vault (write, delete, create files). It presents the proposed change to the user for explicit confirmation (Allow/Deny) before execution.

## Benefits Hypothesis
- Eliminates the fear of "AI deleting my files," increasing trust and adoption.
- Provides a necessary "brake" for potentially destructive recursive agent loops.

## User Stories
- As a user, I must approve any file modification proposed by the agent so I don't lose data.
- As a user, I want to see exactly what file and what operation is proposed (e.g., "Overwriting `Project.md`") before I click "Approve".
- As a user, I want to reject a proposal if it looks wrong, stopping the agent.

## Acceptance Criteria
- [ ] **Interception:** ALL write operations (file write, delete, move, create dir) MUST pause for approval, UNLESS explicitly auto-approved by user configuration.
- [ ] **Auto-Approval Config:** Users can define categories of actions (e.g., "Safe Reads", "Create in /Inbox") that bypass manual approval.
- [ ] **Auto-Approval Limits:** Obsidian Agent enforces configurable safety limits, e.g.:
  - max auto-approved actions per task/session
  - max consecutive tool calls without user confirmation
  When exceeded, Obsidian Agent must request explicit user approval.
- [ ] **Proposal UI:** The chat interface displays a "Tool Use Request" card showing: Tool Name, Target File, Operation Type.
- [ ] **Action Buttons:** Clear "Approve", "Reject", and "Always Allow this Tool" buttons.
- [ ] **Reject Handling:** The agent receives a "User Rejected" error/signal and can attempt recovery or stop.
- [ ] **Logging:** Every approval/rejection decision is logged to the internal operation log.

## Success Criteria
- SC-01: 100% of write operations in default configuration require user interaction.
- SC-02: Zero unauthorized file modifications occur during standard usage.

## NFRs (quantified)
- **Safety Latency:** The approval prompt appears < 500ms after the model generates the tool call.
- **Clarity:** The target filename is always visible without scrolling in the prompt card.

## ASRs
🔴 **ASR-02: Tool-Use Interception Layer**
- The architecture must guarantee that no tool execution bypasses this check.

## Dependencies
- Tool Execution Framework.
