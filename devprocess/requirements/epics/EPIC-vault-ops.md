# Epic: Vault Operations & Content Synthesis
Scope: MVP
Owner: Product Lead

## Hypothesis
Providing semantic understanding of the vault (via local embeddings) and structured output capabilities (Canvas, Files) enables knowledge synthesis workflows that manual retrieval cannot match.

## Leading indicators
- Frequency of "Synthesis" feature usage.
- User creation of complex Canvases via prompts.

## In scope
- File System Operations (Read/Write/Create/Delete)
- Folder Operations (List/Create)
- Canvas File Generation (`.canvas` JSON)
- Semantic Search (Local Vector Index)
- Content Analysis (Summarization, Extraction)

## Out of scope
- Internal Obsidian Graph manipulation
- Real-time collaborative editing
- "Bases" (Database) automation in V1

## Feature list
| Feature | Priority | Notes |
|---|---|---|
| Vault CRUD Operations | P0 | Fundamental file access |
| Canvas Projection | P0 | JSON-based graph generation |
| Semantic Index | P1 | Local vector search |
| Content Analysis Tools | P1 | Summarize, Extract, Rewrite |
