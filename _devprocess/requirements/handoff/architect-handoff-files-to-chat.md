# Architect Handoff: Files-to-Chat (Office-Format-Support)

> **Epic**: EPIC-006 - Files-to-Chat
> **Erstellt**: 2026-03-05
> **Status**: Ready for Architect
> **BA-Referenz**: _devprocess/analysis/BA-002-files-to-chat.md

---

## 1. Zusammenfassung für den Architekten

Obsilo benötigt eine lokale Parsing-Pipeline für Office- und Datenformate (PPTX, XLSX, DOCX, PDF, JSON, XML, CSV). Die Dateien werden über den erweiterten File Picker angehängt, lokal geparst, und der extrahierte Text + Struktur wird als Kontext an die API gesendet. Bilder aus PPTX werden on-demand über ein Tool nachgeladen.

**Dein Hauptfokus:**
1. Library-Evaluation für Sandbox-kompatibles Parsing
2. Parser-Architektur (Plugin-System für neue Formate)
3. Bild-Nachlade-Mechanismus (Tool-Design)
4. Integration in bestehende Agent-Pipeline

---

## 2. Architecturally Significant Requirements (ASRs)

### CRITICAL

| ID | ASR | Feature | Quality Attribute | Impact |
|----|-----|---------|-------------------|--------|
| ASR-1 | **Sandbox-Kompatibilität**: Alle Parsing-Libraries müssen ohne native Binaries, ohne `require()`, ohne `fetch()` in der Electron-Sandbox laufen | FEATURE-0601 | Compatibility | Schränkt Library-Wahl massiv ein; ggf. eigenes Parsing auf ZIP+XML-Basis |
| ASR-2 | **Parser-Erweiterbarkeit**: Neue Formate ohne Architekturänderung hinzufügbar | FEATURE-0601 | Extensibility | Plugin-artiges Parser-Interface mit Registry nötig |
| ASR-3 | **Text-first mit Bild-Nachlade**: Zweistufige Verarbeitung (Text sofort, Bilder on-demand via Tool) | FEATURE-0604 | Performance | Neues Tool nötig; System Prompt muss Agent-Verhalten definieren; Bild-Cache-Strategie |

### MODERATE

| ID | ASR | Feature | Quality Attribute | Impact |
|----|-----|---------|-------------------|--------|
| ASR-4 | **Performance bei großen Dateien**: 100-Seiten PDF / 10k-Zeilen XLSX dürfen UI nicht blockieren | FEATURE-0601 | Responsiveness | Ggf. Web Worker oder chunked Processing |
| ASR-5 | **Provider-Capability-Registry**: Vision-Support pro Modell ohne hardcoded Listen | FEATURE-0605 | Extensibility | Neues Feld in ModelInfo oder separate Registry |
| ASR-6 | **Vault File Picker Performance**: Alle Dateitypen anzeigen, performant bei 10k+ Dateien | FEATURE-0602 | Performance | getMarkdownFiles() -> getFiles() mit effizientem Filtern |

---

## 3. Aggregierte Non-Functional Requirements

### Performance

| Metrik | Target | Feature |
|--------|--------|---------|
| PPTX-Parsing (30 Folien) | < 5.000ms (Ziel < 1.000ms) | FEATURE-0601 |
| XLSX-Parsing (10 Sheets, je 1000 Zeilen) | < 3.000ms | FEATURE-0601 |
| DOCX-Parsing (100 Seiten) | < 2.000ms | FEATURE-0601 |
| PDF-Parsing (100 Seiten, text-basiert) | < 5.000ms | FEATURE-0601 |
| Bild-Extraktion (einzeln) | < 500ms | FEATURE-0604 |
| Bild-Extraktion (alle, 30-Folien PPTX) | < 5.000ms | FEATURE-0604 |
| Token-Schätzung | < 100ms | FEATURE-0603 |
| Modell-Capability-Check | < 10ms | FEATURE-0605 |
| Vault Picker Filterung | < 200ms bei 10k+ Dateien | FEATURE-0602 |
| Memory Peak während Parsing | < 200 MB zusätzlich | FEATURE-0601 |

### Security

| Anforderung | Detail | Feature |
|-------------|--------|---------|
| Lokale Verarbeitung | Keine Rohdateien an externe Services | FEATURE-0601 |
| ZIP-Bomb-Protection | Max. Decompressed Size prüfen für OOXML | FEATURE-0601 |
| Path Traversal | Schutz gegen bösartige Pfade in ZIP-Archiven | FEATURE-0601 |
| Input Validation | Dateityp-Prüfung vor Parsing | FEATURE-0601 |

### Compliance

| Anforderung | Detail | Alle Features |
|-------------|--------|---------------|
| Obsidian Review-Bot | Kein `fetch()`, kein `innerHTML`, kein `console.log`, kein `require()`, keine `any`-Types | Alle |
| Sandbox | Keine nativen Binaries, keine Systemtools | FEATURE-0601 |
| Bundlegröße | Zusätzliche Dependencies < 5 MB (komprimiert) | FEATURE-0601 |
| DOM API | Obsidian `createEl`/`createDiv`, CSS-Klassen statt `element.style` | FEATURE-0602 |

---

## 4. Constraints

| Constraint | Quelle | Impact |
|------------|--------|--------|
| Electron/Obsidian Sandbox | Platform | Kein Node.js `fs`-Zugriff für Libraries, kein native Code |
| Obsidian Review-Bot Regeln | Plugin Store | Bibliotheken dürfen keine verbotenen Patterns verwenden |
| Bundlegröße < 5 MB | Performance / Plugin Store | Schränkt Wahl großer Libraries wie pdf.js (Worker) ein |
| Kein `require()` | Review-Bot | Libraries müssen als ES Module oder Bundled importierbar sein |
| Kein `fetch()` | Review-Bot | Keine externen API-Calls für Parsing/Konvertierung |

---

## 5. Open Questions (priorisiert)

### Hoch (blockieren Architektur-Entscheidung)

1. **Library-Wahl OOXML**: Welche Library bietet das beste Verhältnis aus Funktionalität, Bundlegröße und Sandbox-Kompatibilität für PPTX/XLSX/DOCX Parsing?
   - Kandidaten: JSZip + eigenes XML-Parsing, xlsx (SheetJS), mammoth.js (DOCX), oder alles über pptxgenjs/docx4js
   - Evaluationskriterien: Bundle-Size, Sandbox-kompatibel, Review-Bot-konform, Parsing-Qualität

2. **Library-Wahl PDF**: Welche JS-Library für PDF-Text-Extraktion funktioniert in der Electron-Sandbox?
   - Kandidaten: pdf.js (Mozilla), pdf-parse, pdf2json
   - Problem: pdf.js benötigt Worker -- ist das in Obsidian möglich?

3. **Web Worker vs. Main Thread**: Soll Parsing in einem Web Worker laufen?
   - Pro: UI bleibt responsive bei großen Dateien
   - Contra: Komplexität, Daten-Serialisierung, Sandbox-Worker bereits vorhanden (`sandbox-worker.js`)

### Mittel (beeinflussen Design)

4. **Content-Darstellung**: Ein großer Textblock pro Datei oder mehrere ContentBlocks (pro Folie/Sheet)?
   - Impact auf Token-Truncation und On-Demand-Nachlade

5. **Bild-Cache**: Wo werden extrahierte Bilder zwischen Parsing und Agent-Tool-Aufruf gespeichert?
   - In-Memory (einfach, aber Memory) vs. temporäre Datei (persistent, aber Cleanup)

6. **Vault Binary Files**: Wie liest das Plugin binäre Dateien aus dem Vault?
   - `vault.readBinary()` verfügbar? Oder `vault.adapter.readBinary()`?

### Niedrig (Detailentscheidungen)

7. **Parser-Interface**: Wie sieht das Plugin-Interface für neue Parser aus?
8. **Capability-Map**: Eigenschaft in `ModelInfo` oder separate Registry?
9. **Vault Picker Filter**: Eigene Dateiendungs-Gruppen (z.B. "Nur Office-Dateien")?

---

## 6. Bestehende Code-Referenzen

| Datei | Relevanz für Architektur |
|-------|--------------------------|
| `src/ui/sidebar/AttachmentHandler.ts` | **Hauptintegrationspunkt**: File Picker Filter (Z.34), processFile() (Z.45-83), hier werden neue Formate eingeklinkt |
| `src/ui/sidebar/VaultFilePicker.ts` | Vault-Picker, `getMarkdownFiles()` (Z.176) -> muss erweitert werden |
| `src/api/types.ts` | `ContentBlock` (Z.36-40), `ImageMediaType` (Z.34) -- Bilder als base64, Text als `text`-Block |
| `src/core/AgentTask.ts` | Agent-Loop, Tool-Execution -- hier wird das neue Bild-Nachlade-Tool integriert |
| `sandbox-worker.js` | Bestehende Sandbox-Worker-Infrastruktur -- Wiederverwendung prüfen |
| `src/core/tools/types.ts` | Tool-Interface für Tool-Registry |

---

## 7. Feature-Übersicht

| ID | Feature | Priority | Effort | Architektur-Relevanz |
|----|---------|----------|--------|---------------------|
| FEATURE-0601 | Document Parsing Pipeline | P0 | L | HOCH -- Library-Wahl, Parser-Interface, Sandbox-Kompatibilität |
| FEATURE-0602 | File Picker Erweiterung | P0 | S | NIEDRIG -- primär UI-Änderungen |
| FEATURE-0603 | Token-Budget-Management | P1 | M | MITTEL -- Integration in Send-Pipeline |
| FEATURE-0604 | On-Demand Bild-Extraktion | P1 | M | HOCH -- Neues Tool, Cache-Strategie, System Prompt |
| FEATURE-0605 | Modell-Kompatibilitäts-Check | P1 | S | MITTEL -- Provider-Capability-Registry |

---

## 8. Empfohlene ADRs

1. **ADR: Parsing-Library-Wahl** -- Welche Libraries für OOXML und PDF, mit welchen Tradeoffs
2. **ADR: Parser-Architektur** -- Interface, Registry, Erweiterbarkeit
3. **ADR: Bild-Nachlade-Strategie** -- Tool-Design, Cache, Agent-Steuerung
4. **ADR: Threading-Modell** -- Main Thread vs. Web Worker für Parsing

---

## Nächste Schritte

Die Requirements sind bereit!

1. **Architektur:** Wechsle nun zum **Architect Agent**, um ADR-Vorschläge
   und arc42-Dokumentation zu erstellen.
   -> Tippe: `@Architect`
