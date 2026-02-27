# FEATURE: Providers & Models

**Status:** Implemented
**Source:** `src/api/`, `src/types/settings.ts`

## Summary
Unified model management supporting 7 provider types (Anthropic, OpenAI, Ollama, LM Studio, OpenRouter, Azure OpenAI, Custom). Each model is configured as a `CustomModel` entry with its own API key, base URL, temperature, and max tokens. The API layer is provider-agnostic via the `ApiHandler` interface.

## How It Works

### CustomModel (unified model entry)
```typescript
{
  name: string,          // API model ID, e.g. "claude-sonnet-4-5-20250929"
  provider: ProviderType,
  displayName?: string,  // shown in UI
  apiKey?: string,
  baseUrl?: string,      // required for ollama/custom/azure
  enabled: boolean,      // appears in chat model selector
  isBuiltIn?: boolean,   // pre-configured, user adds API key
  maxTokens?: number,
  temperature?: number,
  apiVersion?: string,   // required for Azure OpenAI
}
```

**Model key:** `${name}|${provider}` — used to store per-mode overrides (`modeModelKeys`).

### Provider Types
| Type | Base URL | Notes |
|------|----------|-------|
| `anthropic` | Default | Uses Anthropic Messages API with streaming |
| `openai` | Default | OpenAI chat completions |
| `ollama` | `http://localhost:11434` | Local, OpenAI-compatible |
| `lmstudio` | `http://localhost:1234/v1` | Local, OpenAI-compatible |
| `openrouter` | `https://openrouter.ai/api/v1` | Gateway, OpenAI-compatible |
| `azure` | Set by user | Azure OpenAI, requires `apiVersion` |
| `custom` | Set by user | Any OpenAI-compatible endpoint |

### Built-in Models
Pre-configured entries (user adds API key and enables):
- Anthropic: Claude Sonnet 4.5, Opus 4.6, Haiku 4.5
- OpenAI: GPT-4o, GPT-4o mini, GPT-4.1
- Ollama: Llama 3.2, Qwen 2.5 7B
- OpenRouter: Claude 3.5 Sonnet, GPT-4o, Llama 3.2 3B (free)

### ApiHandler Interface
```typescript
interface ApiHandler {
  createMessage(
    systemPrompt: string,
    messages: MessageParam[],
    tools: ToolDefinition[],
    abortSignal?: AbortSignal,
  ): ApiStream;  // AsyncIterable<ApiStreamChunk>
  getModel(): { id: string; info: ModelInfo };
}
```

**Stream chunks:** `text | thinking | tool_use | usage`

### Internal Message Format (Anthropic-native)
All providers translate to/from Anthropic's content block format internally:
- `text`, `image`, `tool_use`, `tool_result` blocks
- OpenAI provider converts these to/from OpenAI's format on the fly

### buildApiHandler (factory)
`buildApiHandlerForModel(model: CustomModel)` → `buildApiHandler(llmProvider)`:
- `anthropic` → `AnthropicProvider`
- everything else → `OpenAiProvider` (handles all OpenAI-compatible APIs)

### Embedding Models
Separate from chat models, used for semantic search:
```typescript
embeddingModels: CustomModel[]   // separate list
activeEmbeddingModelKey: string  // active embedding model
```
Types:
- Xenova/transformers local models (downloaded ~23-90MB, run in ONNX via browser/Electron)
- API embedding models (OpenAI text-embedding-3-*)

## Key Files
- `src/api/index.ts` — `buildApiHandler`, `buildApiHandlerForModel`
- `src/api/types.ts` — `ApiHandler`, `ApiStream`, `MessageParam`, `ContentBlock`, `ModelInfo`
- `src/api/providers/anthropic.ts` — Anthropic Messages API streaming
- `src/api/providers/openai.ts` — OpenAI-compatible streaming (handles ollama, LM Studio, Azure, OpenRouter)
- `src/types/settings.ts` — `CustomModel`, `LLMProvider`, `BUILT_IN_MODELS`

## Dependencies
- `AgentTask` — receives `ApiHandler` instance from main.ts on task start
- `main.ts` — creates `ApiHandler` via `buildApiHandlerForModel(activeModel)` on each task
- `SemanticIndexService` — uses embedding model (separate `ApiHandler` for embeddings)
- `ModeService` — provides per-mode model override to main.ts for model selection

## Configuration
| Key | Default | Description |
|-----|---------|-------------|
| `activeModels` | `[]` | All configured models |
| `activeModelKey` | `''` | Default model key |
| `modeModelKeys` | `{}` | Per-mode model override |
| `globalCustomInstructions` | `''` | Appended to all modes |
| `embeddingModels` | `[]` | Embedding model list |
| `activeEmbeddingModelKey` | `''` | Active embedding model |

## Known Limitations / Edge Cases
- `LLMProvider` type is kept for backwards compat but the new path is `CustomModel` → `modelToLLMProvider()` → `buildApiHandler()`
- `apiKey` is stored per-model in Obsidian's `saveData()` (encrypted by Obsidian). Not in plaintext on disk.
- `AnthropicProvider` uses `requestUrl` (Obsidian's fetch wrapper) to avoid CORS issues in the desktop app. `OpenAiProvider` may need the same check.
- Extended thinking (`thinking` stream chunks) is only emitted by Anthropic models that support it; `onThinking` callback is optional.
- Context window sizes are approximate (checked against model ID string): claude → 200k, gpt-4/gpt-5 → 128k, fallback → 128k. Should use `ModelInfo.contextWindow` when available.
