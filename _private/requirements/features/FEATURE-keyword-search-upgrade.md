# FEATURE: Keyword Search Upgrade — Stemming + TF-IDF + Word Boundaries

**Status:** In Progress
**Source:** `src/core/semantic/SemanticIndexService.ts`
**Depends on:** FEATURE-semantic-index

## Summary

Upgrade the keyword search arm of the hybrid search from simple substring counting to proper TF-IDF scoring with stemming and word-boundary tokenization. This fixes the core issue where morphological variants (e.g., "meetings" vs. "Meeting-Notiz") fail to match, even though frontmatter data is already present in the indexed chunks.

## Problem

The current `keywordSearch()` in `SemanticIndexService` uses `String.indexOf()` for substring matching:
- "meetings" does NOT match "Meeting-Notiz" (extra "s")
- No stemming: plural/singular, -ing/-ed forms don't match
- No IDF: common words like "this", "the" have equal weight to rare terms like "meeting"
- No word boundaries: "cat" matches "category" (false positives)
- No compound-word splitting: "Meeting-Notiz" stays as one token

## Solution

### 1. Lightweight Suffix Stemmer (`stemWord`)
Handles common English and German suffixes without external dependencies:
- English: -ies, -ings, -ing, -tion, -ness, -ment, -able, -ful, -ed, -es, -s
- German: -ung, -keit, -heit, -lich, -isch

### 2. Word-Boundary Tokenizer (`tokenize`)
- Split on whitespace, hyphens, underscores, and punctuation
- Filter tokens < 3 characters
- Apply stemming to each token
- Result: "Meeting-Notiz" → ["meeting", "notiz"]

### 3. TF-IDF Scoring (replaces `keywordSearch`)
- **TF** (Term Frequency): Count of stemmed term occurrences per chunk
- **IDF** (Inverse Document Frequency): `log((N+1) / (df+1))` — rare terms weighted higher
- **Score**: `sum(TF * IDF)` per query term
- **No stop-word list needed**: IDF handles this language-agnostically — frequent words in any language automatically get low IDF scores
- Keep best-scoring chunk per file, normalize 0-1, return top-K

## Key Design Decisions

1. **No external dependencies**: Stemmer is inline (~25 lines), no npm package needed
2. **Language-agnostic stop-word handling**: IDF naturally downweights common words regardless of language
3. **Compound-word splitting via hyphens**: Critical for German compound words common in frontmatter values
4. **Backward-compatible API**: Same `keywordSearch(query, topK)` signature, same return type

## Key Files
- `src/core/semantic/SemanticIndexService.ts` — keyword search + new helper functions

## Configuration
No new settings. Inherits existing `enableSemanticIndex` toggle.

## Known Limitations
- Stemmer is suffix-based, not a full Porter/Snowball stemmer. Edge cases with irregular forms.
- Languages with no suffix-based morphology (e.g., Chinese, Japanese) won't benefit from stemming but still benefit from IDF and word-boundary improvements.
- TF-IDF computation scans all chunks per query (same as current implementation). For very large indices (>50k chunks), may need optimization.
