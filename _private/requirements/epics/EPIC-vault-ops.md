# Epic: Vault Operations & Content Synthesis
Scope: Production (alle Phasen komplett)
Owner: Product Lead
Status: IMPLEMENTIERT

## Hypothesis
Providing semantic understanding of the vault (via local embeddings) and structured output capabilities (Canvas, Bases, Files) enables knowledge synthesis workflows that manual retrieval cannot match.

## Leading indicators
- Frequency of "Synthesis" feature usage.
- User creation of complex Canvases via prompts.
- Bases-Nutzung fuer strukturierte Daten.

## Implementiert
- Vault CRUD (read_file, write_file, edit_file, append_to_file, create_folder, delete_file, move_file)
- Vault Intelligence (get_frontmatter, update_frontmatter, search_by_tag, get_vault_stats, get_linked_notes, get_daily_note, open_note)
- Canvas (generate_canvas, create_excalidraw)
- Bases (create_base, update_base, query_base)
- Semantic Search (vectra HNSW + Hybrid Search mit RRF + HyDE + Graph Augmentation)
- Web Tools (web_fetch, web_search via Brave/Tavily)

## Out of scope
- Internal Obsidian Graph manipulation
- Real-time collaborative editing
- Full Bases UI automation (nur CRUD via JSON/YAML)

## Feature list
| Feature | Priority | Status | Notes |
|---|---|---|---|
| Vault CRUD Operations | P0 | Done | 7 File-Tools |
| Vault Intelligence | P0 | Done | 7 Query-Tools |
| Canvas Projection | P0 | Done | generate_canvas + create_excalidraw |
| Bases Tools | P1 | Done | create_base, update_base, query_base |
| Semantic Index | P1 | Done | Hybrid Search (Semantic + BM25 + RRF) |
| Web Tools | P1 | Done | web_fetch, web_search |
