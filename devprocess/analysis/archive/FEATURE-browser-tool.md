# Feature: Browser Tool (Web Session + URL Fetch)
Priority: P1
Related Epic: `requirements/epics/EPIC-core-engine.md`

## Description
Obsidian Agent provides a built-in **Browser Tool** capability that allows the agent to:
- open a controlled web session (view-only or interaction-limited), and
- fetch/summarize the contents of a URL into context.

This is included to match “Kilo Code” style tool sets (e.g., browser action + URL content fetch) while preserving safety and user consent.

## Benefits Hypothesis
- Enables research and referencing sources without leaving Obsidian.
- Reduces copy/paste and improves citation accuracy.

## User Stories
- As a user, I want the agent to fetch a URL’s readable text and cite the source.
- As a user, I want to approve before the agent navigates to external websites.
- As a user, I want to see the browser steps/outcomes in the chat timeline.

## Acceptance Criteria
- [ ] **URL Fetch Tool:** Agent can request “fetch URL content” and receive normalized text (strip boilerplate where possible).
- [ ] **Browser Session:** Agent can request a browser session for interactive browsing when enabled.
- [ ] **Approval:** Any external navigation or content fetch is governed by Approval Safety.
- [ ] **Visibility:** Browser actions appear as tool cards in the chat transcript (URL, action, result/summary).
- [ ] **Privacy Guardrails:** Obsidian Agent warns when sending page content to a cloud provider.
- [ ] **Mode Gating:** Browser tool can be enabled only for specific modes (e.g., Researcher).

## Success Criteria
- SC-01: URL fetch succeeds for $>90\%$ of common pages (docs, blogs) under normal network conditions.
- SC-02: Users can trace which URLs were accessed in the operation log.

## NFRs (quantified)
- **Timeouts:** URL fetch has a configurable timeout (default 30s).
- **Content Size:** Large pages are truncated with a visible warning.

## Dependencies
- Network access from Obsidian environment.
- HTML -> text extraction library (implementation choice deferred).
