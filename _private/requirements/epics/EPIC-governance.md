# Epic: Governance & Safety
Scope: Production (alle Phasen komplett)
Owner: Product Lead
Status: IMPLEMENTIERT

## Hypothesis
Enforcing strict "approval-by-default" and mandatory local checkpoints transforms AI interaction from "risky magic" into a "safe, controllable power tool," encouraging use on critical knowledge bases.

## Leading indicators
- Zero reported data loss during beta.
- High acceptance rate of "Suggest" actions (trust).

## Implementiert
- Approval System (Fail-Closed, per-category Auto-Approve, DiffReviewModal)
- Operation Logging (JSONL Audit Trail mit PII-Scrubbing)
- Checkpoint System (isomorphic-git Shadow-Repo, Diff, Restore, Undo-Bar)
- Ignore System (.obsidian-agentignore + .obsidian-agentprotected)
- Tool Repetition Detection (Sliding Window, fuzzy dedup, ledger)
- SafeStorage (Electron safeStorage, OS Keychain fuer API-Keys)
- Plugin API Allowlist (CallPluginApiTool)
- ReadFile Content Truncation (20K chars)

## Out of scope
- Advanced Git conflict resolution UI (CLI fallback expected)
- Remote sync of checkpoints

## Feature list
| Feature | Priority | Status | Notes |
|---|---|---|---|
| Approval Workflow | P0 | Done | Fail-closed, DiffReviewModal, Auto-Approve |
| Local Checkpoints | P0 | Done | isomorphic-git shadow repo |
| Operation Log | P1 | Done | JSONL audit trail, Log-Viewer in Settings |
| Ignore/Protected | P0 | Done | Path-level access control |
| Tool Repetition Detection | P1 | Done | Sliding window, fuzzy dedup |
| SafeStorage | P1 | Done | OS Keychain encryption (ADR-019) |
