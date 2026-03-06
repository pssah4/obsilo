# Website-Lokalisierung (docs/)

## Uebersicht

Die Obsilo Docs-Website (`docs/`) unterstuetzt 6 Sprachen via Client-side i18n (erster Release).
Kein Build-Tool noetig — alles basiert auf `data-i18n` HTML-Attributen + JSON-Dateien + Vanilla JS.

**Aktive Sprachen (Release 1):** de, en (Default), es, hi, ja, zh-CN

**Archivierte Sprachen** (in `docs/assets/locales/_archive/`, fuer spaetere Erweiterung):
ar, ca, cs, fr, id, it, ko, nl, pl, pt-BR, ru, sk, th, tr, uk, vi, zh-TW

---

## Architektur

### Dateien

| Datei | Zweck |
|-------|-------|
| `docs/assets/locales/{lang}.json` | 23 Sprach-Dateien (flat dot-notation Keys) |
| `docs/assets/locales/en.json` | Source of Truth — 561 Keys |
| `docs/assets/i18n.js` | Translation-Engine (~120 Zeilen) |
| `docs/assets/style.css` | CSS fuer Language-Switcher Dropdown |
| `docs/assets/search.js` | Nutzt `window.i18nT()` fuer Suchfeld-Texte |

### HTML-Attribute

```html
<!-- Einfacher Text -->
<h1 data-i18n="pages.gettingStarted.title">Getting Started</h1>

<!-- HTML-Inhalt (Paragraphen, Listen, Tabellen) -->
<ul data-i18n-html="pages.modes.builtIn.list">
  <li><strong>Code</strong> mode — full autonomy...</li>
</ul>

<!-- Placeholder-Attribute -->
<input data-i18n-placeholder="search.placeholder" placeholder="Search docs...">
```

- `data-i18n` → ersetzt `textContent`
- `data-i18n-html` → ersetzt `innerHTML` (fuer HTML mit Tags)
- `data-i18n-placeholder` → ersetzt `placeholder`-Attribut

### Key-Namenskonvention

```
{bereich}.{seite/element}.{sektion}.{typ}

Beispiele:
  header.docs                          → UI Chrome
  sidebar.gettingStarted               → Sidebar Navigation
  breadcrumb.chatInterface             → Breadcrumbs
  footer.disclaimer                    → Footer
  nav.previous / nav.next              → Seitennavigation
  search.placeholder                   → Suchfeld
  index.hero                           → Startseite
  pages.gettingStarted.title           → Seitentitel
  pages.gettingStarted.subtitle        → Seitenuntertitel
  pages.modes.builtIn.list             → Body-Content (HTML)
  pages.settingsRef.advanced.table     → Tabellen-HTML
```

### Fallback-Kette

```
localStorage('lang') → Navigator.language → 'en'
```

i18n.js laedt immer `en.json` als Fallback. Fehlende Keys in einer Sprache zeigen automatisch den englischen Text.

### RTL-Support

Arabisch (ar) setzt `dir="rtl"` auf `<html>`. Die CSS-Styles passen sich via logische Properties an.

---

## Aktueller Stand (24.02.2026)

### Aktive Sprachen (Release 1)

| Locale | Status |
|--------|--------|
| en | Source of Truth — 561 Keys |
| de | 561 Keys — komplett |
| es | 561 Keys — komplett |
| hi | 86 Keys — UI Chrome, Body-Content via EN-Fallback |
| ja | 561 Keys — komplett |
| zh-CN | 561 Keys — komplett |

### Archivierte Sprachen (in `_archive/`)

Alle uebrigen 17 Sprachen wurden nach `docs/assets/locales/_archive/` verschoben.
Batch-Dateien, Merge-Scripts und Hilfstools ebenfalls dort archiviert.
Bei Bedarf koennen Sprachen spaeter reaktiviert werden.

---

## Prozess: Neue Locale fertigstellen

### Schritt 1: Fehlende Batches uebersetzen

Fuer jede Sprache existieren 4 Batch-Dateien (`_batch_A_en.json` bis `_batch_D_en.json`) als Quellen.
Ein Agent uebersetzt einen Batch und schreibt ihn als `_batch_{X}_{lang}.json`.

**Batch-Aufteilung (513 Body-Content-Keys):**

| Batch | Seiten | Keys | ~Chars |
|-------|--------|------|--------|
| A | gettingStarted, chatInterface, memory | 121 | 22K |
| B | modes, permissions, rulesSkillsWorkflows | 131 | 24K |
| C | semanticSearch, tools, providers | 132 | 25K |
| D | settingsRef, mcpServers, checkpoints, about, imprint | 129 | 27K |

### Schritt 2: Batches mergen

```bash
cd docs/assets/locales
python3 _merge_batches.py {lang}
# Beispiel: python3 _merge_batches.py ca
```

Das Script:
1. Liest die bestehende `{lang}.json` (86 UI Chrome Keys)
2. Mergt alle `_batch_{A-D}_{lang}.json` Dateien hinein
3. Sortiert alphabetisch und schreibt zurueck

### Schritt 3: Breadcrumb-Keys ergaenzen

Die 8 Breadcrumb-Keys werden automatisch aus den sidebar-Keys abgeleitet:

```python
breadcrumb_to_sidebar = {
    "breadcrumb.chatInterface": "sidebar.chatInterface",
    "breadcrumb.memoryHistory": "sidebar.memoryHistory",
    "breadcrumb.modes": "sidebar.modes",
    "breadcrumb.permissionsSafety": "sidebar.permissionsSafety",
    "breadcrumb.providersModels": "sidebar.providersModels",
    "breadcrumb.rulesSkillsWorkflows": "sidebar.rulesSkillsWorkflows",
    "breadcrumb.semanticSearch": "sidebar.semanticSearch",
    "breadcrumb.toolsRef": "sidebar.toolsRef",
}
```

Bei den bereits fertigen 12 Sprachen sind diese schon enthalten.

---

## Prozess: Neue Inhalte hinzufuegen (Delta-Update)

Wenn eine Doc-Seite neuen Content bekommt:

### 1. HTML mit data-i18n Attributen versehen

```html
<!-- Neuer Abschnitt in z.B. modes.html -->
<h3 id="newFeature" data-i18n="pages.modes.newFeature">New Feature</h3>
<p data-i18n-html="pages.modes.newFeature.text">
  Description of the new feature with <strong>formatting</strong>.
</p>
```

### 2. en.json aktualisieren

Neuen Key + englischen Wert hinzufuegen:

```json
{
  "pages.modes.newFeature": "New Feature",
  "pages.modes.newFeature.text": "Description of the new feature with <strong>formatting</strong>."
}
```

**Tipp:** Ein Python-Extraktionsskript kann alle data-i18n Keys aus den HTML-Dateien parsen:

```python
# Vereinfachte Version — vollstaendiges Script in der Git-History
from html.parser import HTMLParser
import json, glob

class I18nExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.keys = {}
        self._current_key = None
        self._current_html_key = None
        self._buffer = []

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        if 'data-i18n' in attrs_dict:
            self._current_key = attrs_dict['data-i18n']
            self._buffer = []
        if 'data-i18n-html' in attrs_dict:
            self._current_html_key = attrs_dict['data-i18n-html']
            self._buffer = []
    # ... (sammelt Text/HTML und speichert als Key-Value)
```

### 3. Fehlende Keys in andere Sprachen uebertragen

**Option A: Manuell** — Keys in jede `{lang}.json` mit uebersetztem Wert einfuegen.

**Option B: Batch-basiert** — Fehlende Keys als JSON extrahieren, uebersetzen lassen, mergen:

```bash
# Fehlende Keys finden
python3 -c "
import json
en = json.load(open('en.json'))
lang = json.load(open('{lang}.json'))
missing = {k: v for k, v in en.items() if k not in lang and not k.startswith('_')}
json.dump(missing, open('_delta_{lang}.json', 'w'), ensure_ascii=False, indent=2)
print(f'{len(missing)} missing keys')
"

# Nach Uebersetzung: Mergen
python3 -c "
import json
lang = json.load(open('{lang}.json'))
delta = json.load(open('_delta_{lang}_translated.json'))
lang.update(delta)
json.dump(dict(sorted(lang.items())), open('{lang}.json', 'w'), ensure_ascii=False, indent=2)
"
```

**Option C: Nichts tun** — i18n.js zeigt automatisch den englischen Fallback-Text fuer fehlende Keys. Die Seite funktioniert trotzdem.

---

## Prozess: Neue Seite hinzufuegen

1. HTML erstellen mit allen i18n-Attributen (Vorlage: `getting-started.html`)
2. Header/Footer/Sidebar aus bestehender Seite kopieren (identisch auf allen Seiten)
3. Body-Content mit `data-i18n` und `data-i18n-html` versehen
4. Keys in `en.json` eintragen
5. Optional: In andere Sprachen uebersetzen

---

## Wichtige Hinweise

### HTML in Uebersetzungen

Werte mit `data-i18n-html` enthalten komplettes innerHTML:
- Alle HTML-Tags muessen exakt erhalten bleiben
- Links (`<a href="...">`) duerfen nicht veraendert werden
- Code-Beispiele (`<code>`, `<pre>`) bleiben auf Englisch
- Technische Begriffe (Obsilo, vault, API, MCP, plugin, etc.) bleiben Englisch

### JSON-Validitaet

Haeufige Fehlerquellen bei Uebersetzungen:
- **Chinesisch/Japanisch:** Fullwidth-Anfuehrungszeichen (`"..."`) statt ASCII-Quotes verwenden
- **Arabisch/Hindi:** Bidirektionale Unicode-Zeichen koennen JSON brechen
- **Alle Sprachen:** Backslash-Escapes (`\"`) in HTML-Attributwerten pruefen

Validierung:
```bash
python3 -c "import json; json.load(open('{lang}.json'))"
```

### Language-Switcher

Der Switcher im Header zeigt die 6 aktiven Sprachen als Dropdown.
Sprache wird in `localStorage('lang')` gespeichert und bleibt ueber Seiten und Reloads erhalten.

---

## Erweiterung (spaeter)

Archivierte Sprachen reaktivieren:

1. `{lang}.json` aus `_archive/` zurueck nach `locales/` verschieben
2. Sprache in `LANGS` Map in `i18n.js` hinzufuegen
3. Falls Batch-Dateien vorhanden: `_merge_batches.py` aus `_archive/` nutzen
4. `npm run build` ausfuehren
