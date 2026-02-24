# ADR-011: Multi-Provider API Architecture (Adapter Pattern)

**Status:** Akzeptiert
**Datum:** 2026-02-24
**Entscheider:** Sebastian Hanke

---

## Kontext

Der Agent muss verschiedene LLM-Provider unterstuetzen: Anthropic (nativ), OpenAI, Ollama, LM Studio, OpenRouter, Azure OpenAI und beliebige Custom-Endpoints. Die Frage ist, wie die Provider-Vielfalt abstrahiert wird, ohne fuer jeden Provider eine separate Integration zu pflegen.

Optionen:
1. Einheitliches SDK (z.B. LiteLLM-artiger Wrapper)
2. Adapter Pattern mit gemeinsamer `ApiHandler`-Schnittstelle
3. Direkte Provider-spezifische Integration in AgentTask

## Entscheidung

**Option 2 — Adapter Pattern** mit zwei konkreten Providern:
- `AnthropicProvider` fuer Anthropic (nativ, inkl. Extended Thinking)
- `OpenAiProvider` fuer alle OpenAI-kompatiblen APIs (OpenAI, Ollama, LM Studio, OpenRouter, Azure, Custom)

Gemeinsames Interface `ApiHandler`:
```typescript
interface ApiHandler {
  createMessage(systemPrompt, messages, tools, abortSignal?): ApiStream;
  getModel(): { id: string; info: ModelInfo };
}
```

Internes Message-Format ist Anthropic-nativ (ContentBlocks). `OpenAiProvider` konvertiert bidirektional.

## Begruendung

- **Minimale Codebasis**: Nur 2 Provider-Implementierungen statt 7. OpenAI-kompatible APIs nutzen alle dasselbe Protokoll.
- **Anthropic-natives Format**: Da Kilo Code auf Anthropic basiert, vermeidet die Anthropic-native Repraesentierung Konvertierungsverluste fuer den primaeren Use Case.
- **Einfache Erweiterbarkeit**: Neue OpenAI-kompatible Provider benoetigen nur einen Eintrag in `ProviderType` und ggf. URL-Defaults.
- **Stream-basiert**: `ApiStream` (AsyncIterable) ermoeglicht Echtzeit-Rendering im Chat.

## Konsequenzen

**Positiv:**
- Einheitliche Stream-Verarbeitung in AgentTask
- Neue Provider in Minuten hinzufuegbar (nur Config)
- Provider-Wechsel ohne Code-Aenderung

**Negativ:**
- OpenAI-Provider muss Anthropic-Format konvertieren (Message-Mapping-Overhead)
- Provider-spezifische Features (Extended Thinking) nur fuer Anthropic verfuegbar
- Azure-URL-Konstruktion hat Sonderpfad im OpenAI-Provider

## Implementierung

- `src/api/index.ts` — Factory `buildApiHandler()`
- `src/api/types.ts` — `ApiHandler`, `ApiStream`, `MessageParam`, `ContentBlock`
- `src/api/providers/anthropic.ts` — Anthropic Messages API
- `src/api/providers/openai.ts` — OpenAI-kompatibel (alle 6 Varianten)
