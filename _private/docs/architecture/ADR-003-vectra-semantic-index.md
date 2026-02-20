# ADR-003: vectra + Xenova Transformers für lokalen Semantic Index

**Status:** Akzeptiert
**Datum:** 2026-02-18
**Entscheider:** Sebastian Hanke

---

## Kontext

Der Agent soll semantische Suche über den gesamten Vault ermöglichen. Benötigt wird: Embedding-Generierung + Vektor-Speicher. Privacy-Anforderung: keine Cloud-Abhängigkeit.

Optionen für Vektor-Store:
- A: `orama` (in-memory, embedded)
- B: `vectra` (HNSW, Pure TypeScript, Datei-persistiert)
- C: `hnswlib-node` (native Bindings)

Optionen für Embeddings:
- X: OpenAI Embedding API (cloud)
- Y: `@xenova/transformers` (ONNX, lokal)
- Z: Ollama-kompatible lokale API

## Entscheidung

**vectra** (B) als Vektor-Store + **Xenova Transformers** (Y) als primäres Embedding-Backend, mit optionalem OpenAI-kompatiblem API-Endpoint.

Standard-Modell: `Xenova/all-MiniLM-L6-v2` (384 Dimensionen, ~23 MB).

## Begründung

**vectra gewählt weil:**
- Pure TypeScript HNSW — keine Native Bindings, läuft im Electron-Renderer
- Datei-persistiert (JSON) — Index überlebt Plugin-Neustarts
- Einfache API: `upsert`, `queryItems`, `deleteItem`

**Xenova gewählt weil:**
- ONNX Runtime läuft in Electron ohne Node.js-Native-Modul-Probleme
- Einmalig herunterladen, dann vollständig offline
- Akzeptable Qualität für englische Notizen

**Orama abgelehnt**: Keine Datei-Persistenz, Index verloren bei Plugin-Neustart.
**hnswlib-node abgelehnt**: Native Bindings — Electron-Kompatibilität problematisch.

## Konsequenzen

**Positiv:**
- Vollständig offline — keine API-Keys nötig für lokales Embedding
- Index überlebt Neustarts durch Datei-Persistenz
- Nutzer kann alternativ OpenAI-kompatible Embedding-API konfigurieren

**Negativ:**
- vectra lädt gesamten Index in RAM — problematisch bei >10k Notizen
- Erster Start: Xenova lädt Model (~23-90MB) herunter
- Keyword-Suche (BM25) ist Live-Scan — langsam bei großen Vaults

## Implementierung

`src/core/semantic/SemanticIndexService.ts`
Index-Speicherort: `.obsidian/plugins/obsidian-agent/semantic-index/`
Checkpoint-Datei: `index-meta.json` (mtime pro Datei, für resumable builds)
