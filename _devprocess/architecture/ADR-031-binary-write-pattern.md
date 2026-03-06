# ADR-031: Binary-Write-Pattern fuer Office-Format-Dateien

**Status:** Proposed
**Date:** 2026-03-06
**Deciders:** Sebastian Hanke

## Context

Die vier neuen Office-Tools (create_pptx, create_docx, create_xlsx, create_pdf) erzeugen binaere Formate. Diese muessen zuverlaessig in den Obsidian Vault geschrieben werden. Die Obsidian Vault API bietet dafuer:

- `vault.createBinary(path: string, content: ArrayBuffer)` -- neue Datei erstellen
- `vault.modifyBinary(file: TFile, content: ArrayBuffer)` -- bestehende Datei ueberschreiben

Dieses Pattern ist bereits in `SandboxBridge.ts:89-104` implementiert und bewaehrt. Die Frage ist, wie dieses Pattern in den neuen Built-in Tools konsistent angewendet wird.

**Triggering ASR:**
- Binary Write (MODERATE aus FEATURE-400, 401, 402, 403)
- Quality Attribute: Zuverlaessigkeit, Datensicherheit

## Decision Drivers

- **Konsistenz:** Gleiches Pattern fuer alle 4 Tools
- **Sicherheit:** Kein Datenverlust, atomare Schreiboperationen
- **Pfad-Handling:** Korrekte Ordner-Erstellung, Pfad-Validierung
- **Wiederverwendbarkeit:** DRY-Prinzip, gemeinsame Utility

## Considered Options

### Option 1: Shared Utility Function

Extraktion des Binary-Write-Logic aus SandboxBridge in eine wiederverwendbare Utility-Funktion:

```typescript
// src/core/tools/vault/writeBinaryToVault.ts
export async function writeBinaryToVault(
    vault: Vault,
    path: string,
    content: ArrayBuffer
): Promise<{ created: boolean; path: string; size: number }> {
    // 1. Ordner erstellen falls noetig
    await ensureFolder(vault, path);
    // 2. Pruefen ob Datei existiert
    const file = vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
        await vault.modifyBinary(file, content);
        return { created: false, path, size: content.byteLength };
    }
    await vault.createBinary(path, content);
    return { created: true, path, size: content.byteLength };
}
```

- Pro: DRY, konsistent, testbar
- Pro: Ordner-Erstellung einmal implementiert
- Con: Zusaetzliche Datei/Abstraktion

### Option 2: Inline in jedem Tool (wie CreateExcalidrawTool)

Jedes Tool implementiert das Write-Pattern direkt in `execute()`:

```typescript
const file = this.plugin.app.vault.getAbstractFileByPath(path);
if (file instanceof TFile) {
    await this.plugin.app.vault.modifyBinary(file, content);
} else {
    await this.plugin.app.vault.createBinary(path, content);
}
```

- Pro: Einfach, keine Abstraktion
- Con: Code-Duplizierung in 4 Tools
- Con: Ordner-Erstellung muss jeweils separat gehandhabt werden

### Option 3: BaseTool-Erweiterung

Binary-Write als geschuetzte Methode in BaseTool:

```typescript
abstract class BaseTool {
    protected async writeBinary(path: string, content: ArrayBuffer): Promise<...> { ... }
}
```

- Pro: Alle Tools erben die Methode
- Con: Aendert BaseTool fuer ein spezifisches Feature
- Con: Nicht alle Tools brauchen Binary-Write

## Decision

**Vorgeschlagene Option:** Option 1 -- Shared Utility Function

Eine kleine Utility-Funktion `writeBinaryToVault()` in `src/core/tools/vault/writeBinaryToVault.ts` die:

1. **Ordner-Erstellung:** Prueft ob der Zielordner existiert, erstellt ihn rekursiv falls noetig (analog zum bestehenden `ensureFolderExists()` Pattern)
2. **Create vs. Modify:** Prueft `getAbstractFileByPath()`, nutzt `modifyBinary()` fuer bestehende Dateien, `createBinary()` fuer neue
3. **Rueckgabe:** Objektmit `{ created: boolean; path: string; size: number }` fuer Tool-Feedback
4. **Keine Groessenbegrenzung:** Anders als SandboxBridge gibt es im Plugin-Kontext kein Size-Limit (die Libraries regulieren sich selbst)

**Begruendung:**
- 4 Tools teilen exakt das gleiche Write-Pattern -- Duplizierung waere ein Code Smell
- Die Utility ist klein (~20 Zeilen), fokussiert, und hat keine Nebeneffekte ueber den Vault-Write hinaus
- BaseTool zu aendern waere Overengineering (nur 4 von 30+ Tools brauchen Binary-Write)

**Hinweis:** Dies ist ein VORSCHLAG. Claude Code entscheidet final
basierend auf dem realen Zustand der Codebase.

## Consequences

### Positive
- Konsistentes Verhalten fuer alle Binary-Write-Operationen
- Ordner-Erstellung in einer Stelle implementiert
- Leicht testbar (eine Funktion, klare Inputs/Outputs)
- Kein Impact auf bestehende Tools oder BaseTool

### Negative
- Eine zusaetzliche Datei im Projekt
- SandboxBridge nutzt eigenes Pattern (hat zusaetzlich Size-Limit, Rate-Limiting) -- kein vollstaendiges DRY

### Risks
- **Concurrent Writes:** Wenn zwei Tools gleichzeitig dieselbe Datei schreiben, kann es zu Race Conditions kommen. Mitigation: In der Praxis schreibt nur ein Tool gleichzeitig (sequentielle Ausfuehrung im Agent-Loop).
- **Pfad-Injection:** Pfad muss validiert werden (keine `..`, kein absoluter Pfad). Mitigation: Vault API validiert Pfade intern, zusaetzlich Pruefung in der Utility.

## Implementation Notes

- Pfad-Validierung: `path` darf nicht mit `/` beginnen und nicht `..` enthalten
- Ordner-Erstellung: `vault.createFolder(dirname)` -- Obsidian erstellt rekursiv
- Dateiendung-Pruefung: Jedes Tool validiert seine eigene Extension (.pptx, .docx, .xlsx, .pdf)
- ArrayBuffer: Alle Libraries (pptxgenjs, docx, exceljs, pdf-lib) koennen ArrayBuffer/Uint8Array/Buffer erzeugen

## Related Decisions

- ADR-029: Input-Schema-Design (bestimmt die Tool-Eingabe)
- ADR-030: Library Selection (bestimmt die Library-APIs fuer Buffer-Erzeugung)
- SandboxBridge.ts:89-104 (bestehendes bewaehertes Pattern)
