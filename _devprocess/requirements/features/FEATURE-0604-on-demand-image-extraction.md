# Feature: On-Demand Bild-Extraktion

> **Feature ID**: FEATURE-203
> **Epic**: EPIC-002 - Files-to-Chat
> **Priority**: P1-High
> **Effort Estimate**: M

## Feature Description

Extraktion eingebetteter Bilder aus PPTX-Dateien und deren Bereitstellung als On-Demand-Kontext für den Agent. Der Agent erhält zunächst nur den extrahierten Text mit Bild-Metadaten (Platzhalter wie "[Bild 1: Diagramm auf Folie 3]"). Wenn der Text allein nicht ausreicht, kann der Agent die Bilder über ein Tool nachladen und als visuellen Kontext an die API senden.

Dies ist ein zentrales Feature, weil in Unternehmens-Präsentationen Grafiken häufig eigenständige Information tragen, die nicht im Folientext redundant beschrieben ist.

## Benefits Hypothesis

**Wir glauben dass** On-Demand Bild-Extraktion
**folgende messbare Outcomes liefert:**
- Agent kann auch grafik-lastige Präsentationen vollständig verstehen
- Token-Verbrauch wird minimiert (Bilder nur wenn nötig)

**Wir wissen dass wir erfolgreich sind wenn:**
- Agent kann basierend auf Text + Bildern 95%+ der Kernaussagen einer PPTX korrekt erfassen
- Bild-Nachlade nur in ca. 30% der Fälle nötig ist (Text-first funktioniert meistens)
- Nutzer muss nicht manuell entscheiden, ob Bilder mitgeschickt werden

## User Stories

### Story 1: Agent entscheidet über Bild-Bedarf
**Als** Knowledge Worker
**möchte ich** dass der Agent selbst entscheidet, ob er Bilder aus einer Präsentation braucht
**um** nicht manuell steuern zu müssen, welche Bilder relevant sind

**Akzeptanzkriterien:**
- Agent erhält im Text Hinweise auf vorhandene Bilder (z.B. "[Bild auf Folie 3: Diagramm]")
- Agent kann über ein Tool die Bilder nachladen
- Nachgeladene Bilder werden als visueller Kontext an die API gesendet
- Agent benennt im Output, welche Bilder er ausgewertet hat

### Story 2: Bild-Extraktion bei Vision-fähigem Modell
**Als** Knowledge Worker
**möchte ich** dass eingebettete Bilder nur verarbeitet werden, wenn mein Modell Vision unterstützt
**um** keine unnötigen Ressourcen zu verbrauchen

**Akzeptanzkriterien:**
- Bild-Nachlade steht nur bei Vision-fähigen Modellen zur Verfügung
- Bei Modellen ohne Vision wird der Agent informiert, dass Bilder nicht auswertbar sind
- Bild-Metadaten im Text bleiben trotzdem erhalten (Agent weiß, dass Bilder existieren)

---

## Success Criteria (Tech-Agnostic)

| ID | Criterion | Target | Measurement |
|----|-----------|--------|-------------|
| SC-01 | Agent versteht grafik-lastige Präsentationen vollständig | >= 95% Kernaussagen | Test: PPTX mit Diagrammen, Agent fasst zusammen |
| SC-02 | Bilder werden nur bei tatsächlichem Bedarf nachgeladen | In < 50% der Fälle | Monitoring: Wie oft Agent Bild-Tool aufruft |
| SC-03 | Nutzer muss Bildverarbeitung nicht manuell steuern | Agent entscheidet autonom | Test: Verschiedene PPTX-Typen, kein Nutzer-Eingriff nötig |
| SC-04 | Fehlende Vision-Fähigkeit wird kommuniziert | Klarer Hinweis an Nutzer | Test: Nicht-Vision-Modell + PPTX mit Bildern |

---

## Technical NFRs (für Architekt) - MIT TECHNOLOGIE OK

### Performance
- **Bild-Extraktion (einzeln)**: < 500ms pro Bild
- **Bild-Extraktion (alle Bilder einer PPTX)**: < 5.000ms für 30-Folien PPTX mit 15 Bildern
- **Bild-Encoding**: base64 als image-ContentBlock (bestehendes Format)

### Image Processing
- **Formate**: PNG, JPEG, GIF, WebP aus PPTX extrahieren (OOXML verpackt als `/ppt/media/`)
- **Skalierung**: Bilder über 2048px Kantenlänge herunterskalieren (API-Limits)
- **Maximale Bilder pro Request**: Konfigurierbar (Standard: 10)

### Tool-Integration
- **Tool-Name**: Vorschlag `get_document_images` oder `extract_presentation_images`
- **Tool-Input**: Dateiname + optionale Foliennummern
- **Tool-Output**: base64-encoded Bilder als image-ContentBlocks

---

## Architecture Considerations

### Architecturally Significant Requirements (ASRs)

**CRITICAL ASR #1: Text-first mit Bild-Nachlade**
- **Warum ASR**: Zweistufige Verarbeitung (erst Text, dann Bilder on-demand) bestimmt die gesamte Interaktion zwischen Parser, Agent und API
- **Impact**: Parser muss Bild-Metadaten erfassen aber Bilder nicht sofort extrahieren; ein neues Tool ist nötig; System Prompt muss Agent-Verhalten definieren
- **Quality Attribute**: Performance, Token-Effizienz

**MODERATE ASR #2: Vision-Capability-Check**
- **Warum ASR**: Nicht alle Modelle unterstützen Vision; Bild-Nachlade muss graceful degraden
- **Impact**: Überschneidung mit FEATURE-204 (Modell-Kompatibilitäts-Check); Tool muss Provider-Capabilities prüfen
- **Quality Attribute**: Reliability, User Experience

### Constraints
- **API-Limits**: max. image-ContentBlocks pro Request variiert je Provider
- **Bildgröße**: base64-encodierte Bilder verbrauchen erhebliche Token
- **Modell-Support**: Nur Claude (Anthropic) und GPT-4V (OpenAI) unterstützen Vision zuverlässig

### Open Questions für Architekt
- Soll das Bild-Nachlade-Tool ein eigenständiges Tool in der Tool-Registry sein oder eine Extension des bestehenden Attachment-Systems?
- Wo wird der Bild-Cache zwischen Parsing und Nachlade gespeichert? (In-Memory oder temporäre Datei?)
- Wie wird im System Prompt definiert, wann der Agent Bilder nachladen soll?
- Soll der Agent auch aus DOCX eingebettete Bilder nachladen können, oder nur aus PPTX?

---

## Definition of Done

### Functional
- [ ] PPTX-Bilder werden als Metadaten im extrahierten Text erfasst
- [ ] Neues Tool zum Nachlade von Bildern implementiert
- [ ] Agent entscheidet autonom über Bild-Nachlade
- [ ] Vision-Check: Tool nur bei Vision-fähigem Modell verfügbar
- [ ] Bilder als base64 image-ContentBlock an API

### Quality
- [ ] Test: PPTX mit 15 Bildern, Extraktion < 5s
- [ ] Test: Agent-Zusammenfassung grafik-lastiger PPTX
- [ ] Test: Graceful Degradation bei Nicht-Vision-Modell
- [ ] Review-Bot Compliance geprüft

### Documentation
- [ ] Feature-Spec aktualisiert (Status: Implemented)
- [ ] Tool-Dokumentation für Agent System Prompt

---

## Dependencies

- **FEATURE-200**: PPTX-Parser muss Bild-Metadaten und Bild-Referenzen erfassen
- **FEATURE-204**: Vision-Capability-Check muss verfügbar sein
- **Tool Registry**: Neues Tool muss in der bestehenden Tool-Registry registriert werden

## Assumptions

- PPTX-Bilder liegen als `/ppt/media/imageN.{png,jpg,gif}` im ZIP-Archiv
- base64-Encoded Bilder werden von Claude und GPT-4V als image-ContentBlock akzeptiert
- Agent kann über System Prompt angewiesen werden, Bilder nur bei Bedarf nachzuladen

## Out of Scope

- Bild-Extraktion aus DOCX oder PDF (kann später ergänzt werden)
- OCR für Text in Bildern (separates Feature)
- Bild-Bearbeitung/-Transformation (Crop, Annotate)
