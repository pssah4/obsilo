# Feature: Canvas Graph Projection
Priority: P0
Related Epic: `requirements/epics/EPIC-vault-ops.md`

## Description
Since direct access to the internal Obsidian Graph is blocked, Obsidian Agent generates "Graph Projections" by creating `.canvas` files. The agent can arrange notes, draw connections, and group items visually on a 2D plane based on semantic or explicit relationships.

## Benefits Hypothesis
- Visualizing complex topics (e.g., "Research on X") helps users spot gaps and connections.
- Automating the layout saves hours of manual dragging and dropping.

## User Stories
- As a user, I want to ask: "Create a map of all notes related to Project X" and get a Canvas file.
- As a user, I want the agent to group related concepts in the Canvas automatically.
- As a user, I want to open the resulting canvas immediately to explore the relationships.

## Acceptance Criteria
- [ ] **Canvas Generation:** A tool `create_canvas` accepts a list of nodes (files, text, groups) and edges (connections).
- [ ] **Valid JSON:** The output file must be a valid `.canvas` JSON file readable by Obsidian.
- [ ] **Layout Algorithm:** The tool (or agent) must provide reasonable X/Y coordinates so nodes don't all stack on top of each other (basic grid or force-directed layout).
- [ ] **Content Support:** Can include Markdown files, text cards, and groups/labels.

## Success Criteria
- SC-01: Generated Canvas files open in Obsidian without errors 100% of the time.
- SC-02: User perceives the layout as "organized" (nodes are not overlapping).

## NFRs (quantified)
- **Generation Time:** A canvas with 50 nodes is generated in < 3 seconds.
- **Node Limit:** System handles up to 200 nodes without performance degradation in the generation step.

## ASRs
None.

## Dependencies
- Obsidian Canvas Core Plugin (must be enabled by user).
- `.canvas` JSON spec stability.
