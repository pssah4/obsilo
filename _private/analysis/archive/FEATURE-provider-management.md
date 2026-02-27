# Feature: Provider & Token Management
Priority: P1
Related Epic: `requirements/epics/EPIC-core-engine.md`

## Description
A centralized system for managing LLM providers (OpenAI, Anthropic, Gemini, OpenRouter, Local/Ollama), API keys, and model parameters. Includes tracking of token usage and estimated costs.

## Benefits Hypothesis
- **Flexibility:** Users can mix and match models (e.g., use Haiku for fast chat, Opus for complex architecture, local Llama 3 for private drafting).
- **Transparency:** Users can see exactly how much their interactions cost.
- **Privacy:** Clear distinction between "Local" and "Cloud" configurations.

## User Stories
- As a user, I want to add multiple provider configurations (e.g., "Personal OpenAI", "Work Anthropic", "Local Ollama").
- As a user, I want to assign specific models to specific Agent Modes (e.g., "Architect" uses GPT-4o).
- As a user, I want to see a running tally of tokens and cost for the current session.
- As a user, I want to set a "Budget Limit" (optional) to warn me if I burn too many credits.

## Acceptance Criteria
- [ ] **Provider Settings:** UI to add/edit providers (Base URL, API Key, Model Alias).
- [ ] **Model Selection:** Dropdown to choose active model for default chat and specific modes.
- [ ] **Token Counting:** accurately estimates input/output tokens for major providers.
- [ ] **Cost Estimation:** Calculates cost based on known pricing tables (configurable).
- [ ] **Usage View:** A UI component exists (e.g., in status bar or panel) showing current usage.
- [ ] **Budget Limits:** Users can configure warning thresholds and hard stops (optional) for:
  - per task
  - per session
  - per day (optional)
- [ ] **Rate Limit Handling:** If a provider returns rate limit or quota errors, Obsidian Agent:
  - shows a clear error message
  - optionally retries with backoff
  - can suggest switching provider/model
- [ ] **Fallback Model (optional):** If the current model is unavailable/out-of-quota, Obsidian Agent can route to a configured fallback model (user-approved).

## Success Criteria
- SC-01: Switching providers takes effect immediately without reload.
- SC-02: Token counts are within 10% accuracy of actual API usage (where verifiable).
- SC-03: Keys are stored securely (using Obsidian's `localStorage` is acceptable for MVP, system keychain preferred if possible via adapter).

## Non-functional requirements (quantified)
- **Security:** API keys are never logged or exported in debug bundles.
- **UX:** Cost updates displayed < 1s after response completion.

## ASRs
None specific beyond standard secure storage practices.

## Dependencies
- pricing-data (static or fetchable JSON for model costs).
