# Feature: Attachments, Clipboard, and Images
Priority: P1
Related Epic: `requirements/epics/EPIC-core-engine.md`

## Description
Obsidian Agent supports richer user inputs beyond plain text, including:
- pasted text (multi-line, large text)
- clipboard integration (where available)
- image attachments (e.g., pasted screenshots)

This aligns with the upstream codebase’s explicit handling for clipboard and image mentions.

## Benefits Hypothesis
- Enables “show, don’t tell” workflows (screenshots of errors, UI, diagrams).
- Reduces friction for capturing context into the chat.

## User Stories
- As a user, I want to paste an image (screenshot) into the chat and have the agent interpret it.
- As a user, I want Obsidian Agent to detect and warn if images will be sent to a cloud provider.
- As a user, I want to paste large blocks of text without breaking the UI.

## Acceptance Criteria
- [ ] **Paste Support:** Chat input supports multi-line paste and preserves formatting.
- [ ] **Image Attachments:** Users can attach/paste images into a message.
- [ ] **Provider Compatibility:** If the selected provider/model cannot accept images, Obsidian Agent blocks or offers to switch models.
- [ ] **Sanitization:** Images are processed (size/type limits) before use.
- [ ] **Visibility:** Attached images appear in the chat transcript and can be opened/viewed.
- [ ] **Governance:** Sending attachments to an LLM respects Safety and privacy settings.

## Success Criteria
- SC-01: Image messages are reliably represented to the model for supported providers.
- SC-02: Large pastes do not freeze the UI.

## NFRs (quantified)
- **Limits:** Configurable max image size (e.g., 5–10 MB per image for MVP).
- **Latency:** Pre-processing adds < 200ms for typical screenshots.

## Dependencies
- Obsidian/Electron clipboard APIs.
- Image processing helper (implementation choice deferred).
