# Epic: Governance & Safety
Scope: MVP
Owner: Product Lead

## Hypothesis
Enforcing strict "approval-by-default" and mandatory local checkpoints transforms AI interaction from "risky magic" into a "safe, controllable power tool," encouraging use on critical knowledge bases.

## Leading indicators
- Zero reported data loss during beta.
- High acceptance rate of "Suggest" actions (trust).

## In scope
- Approval System (UI for proposed actions)
- Operation Logging (History of all tool calls)
- Checkpoint System (Diff, Commit, Restore)
- Ignore System (`.obsidian-agentignore`)

## Out of scope
- Advanced Git conflict resolution UI (CLI fallback expected)
- Remote sync of checkpoints

## Feature list
| Feature | Priority | Notes |
|---|---|---|
| Approval Workflow | P0 | Before-write confirmation |
| Local Checkpoints | P0 | Isomorphic-git based |
| Operation Log | P1 | Audit trail |
