# ADR-015: Hybrid Search mit Semantic + BM25 + RRF Fusion

**Status:** Akzeptiert
**Datum:** 2026-02-24
**Entscheider:** Sebastian Hanke

---

## Kontext

Die semantische Suche allein hat Schwaechen bei exakten Keyword-Matches und spezifischen Fachbegriffen. Reine Keyword-Suche wiederum versteht keine Bedeutungs-Aehnlichkeiten. Die Frage ist, wie beide Ansaetze kombiniert werden, um optimale Suchergebnisse im Vault zu liefern.

Optionen:
1. Nur semantische Suche (Vectra)
2. Nur Keyword-Suche (BM25/TF-IDF)
3. Hybrid mit festem Gewicht (z.B. 70% semantisch + 30% keyword)
4. Hybrid mit Reciprocal Rank Fusion (RRF)

## Entscheidung

**Option 4 — Hybrid Search mit RRF (k=60).**

Parallele Ausfuehrung:
1. **Semantische Suche**: Vectra HNSW mit Cosine Similarity (top_k * 3 Ergebnisse)
2. **BM25 Keyword-Suche**: TF-IDF-Scoring mit Stemming ueber alle Vault-Dateien

Ergebnis-Fusion via Reciprocal Rank Fusion:
```
score(doc) = SUM( 1 / (k + rank_i) ) fuer alle Ranklisten
k = 60 (Standard RRF-Konstante)
```

Bei Duplikaten (gleiches Dokument in beiden Listen) werden die Scores addiert — dadurch profitieren Dokumente, die in beiden Suchen relevant sind.

### BM25-Scoring mit Stemming

Token-Verarbeitung:
1. Lowercase + Split on non-alphanumeric
2. Suffix-Stemmer mit 17 Regeln (Englisch + Deutsch)
   - Englisch: -ing, -tion, -sion, -ment, -ness, -able, -ible, -ful, -less, -ous, -ive, -ly, -ed, -er, -est, -es, -s
   - Deutsch: -ung, -heit, -keit, -isch, -lich, -bar, -sam, -en, -er, -es, -te, -ten
3. TF-IDF-Scoring pro Dokument:
   - TF = Anzahl Matches / Gesamt-Tokens
   - IDF = log(N / df) wobei N = Vault-Groesse, df = Dokumente mit Term
   - Score = SUM(TF * IDF) fuer alle Query-Terme

### Graph Augmentation

Nach der RRF-Fusion: 1-Hop Wikilink-Expansion. Fuer jeden Top-Treffer werden verlinkte Notizen (max 5) hinzugefuegt, falls sie nicht bereits in den Ergebnissen sind.

## Begruendung

- **RRF statt fester Gewichtung**: RRF ist robust und benoetigt kein Tuning der Gewichte. Der k-Parameter (60) ist der empirisch bewaehrte Standard.
- **Stemming**: Verbessert Recall bei Flexionsformen (z.B. "analyse" findet "analysiert", "Analysen").
- **Parallele Ausfuehrung**: Semantic und Keyword laufen gleichzeitig — kein Latenz-Overhead.
- **Graph Augmentation**: Obsidian-Vaults sind stark verlinkt. 1-Hop-Expansion nutzt diese Struktur.

## Konsequenzen

**Positiv:**
- Beste Ergebnisse bei gemischten Queries (Konzept + Keyword)
- Stemming verbessert Recall deutlich
- Kein manuelles Weight-Tuning noetig

**Negativ:**
- BM25-Keyword-Scan ist ein Live-Scan ueber alle Vault-Dateien (kein vorkompilierter Index)
- Latenz steigt mit Vault-Groesse (linear)
- Stemmer ist vereinfacht (kein Snowball/Porter) — Edge Cases moeglich

## Implementierung

- `src/core/semantic/SemanticIndexService.ts` — Hybrid Search, BM25, Stemmer, RRF Fusion
- `src/core/tools/vault/SemanticSearchTool.ts` — Tool-Interface
- Settings: `hydeEnabled` (boolean), `semanticChunkSize` (number)
- Referenz: ADR-003 (Vectra + Semantic Index)
