# TECH: Providers and API Layer

Technical reference for the LLM provider abstraction in Obsidian Agent.

Source files:
- `src/api/types.ts` -- Core types (ApiHandler, stream chunks, message format)
- `src/api/index.ts` -- Provider factory (buildApiHandler, buildApiHandlerForModel)
- `src/api/providers/anthropic.ts` -- AnthropicProvider implementation
- `src/api/providers/openai.ts` -- OpenAiProvider (covers OpenAI, Ollama, LMStudio, Azure, OpenRouter, custom)
- `src/types/settings.ts` -- CustomModel, LLMProvider, ProviderType

---

## 1. ApiHandler Interface

Defined in `src/api/types.ts`. Every provider implements this contract.

```typescript
interface ApiHandler {
    createMessage(
        systemPrompt: string,
        messages: MessageParam[],
        tools: ToolDefinition[],
        abortSignal?: AbortSignal,
    ): ApiStream;

    getModel(): { id: string; info: ModelInfo };
}
```

### createMessage()

- Accepts the system prompt, full conversation history, tool definitions, and an optional AbortSignal for cancellation.
- Returns an `ApiStream` (AsyncIterable of `ApiStreamChunk`).
- The stream is an async generator -- callers iterate with `for await`.

### getModel()

- Returns the model ID string and a `ModelInfo` object containing:
  - `contextWindow: number` -- max context tokens (200k for Anthropic, 128k for OpenAI default)
  - `supportsTools: boolean` -- always true in current implementation
  - `supportsStreaming: boolean` -- always true in current implementation

---

## 2. Stream Chunk Types

All providers normalize their output into the same four chunk types:

```typescript
type ApiStreamChunk =
    | { type: 'text'; text: string }
    | { type: 'thinking'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, any> }
    | { type: 'usage'; inputTokens: number; outputTokens: number };
```

### text
Incremental text content from the model. Yielded as it arrives during streaming.

### thinking
Extended thinking content (Anthropic only). Yielded incrementally as `thinking_delta` events arrive. OpenAI provider does not emit this chunk type.

### tool_use
A complete tool call. Both providers accumulate partial JSON input during streaming and yield the full parsed object only after the content block or turn ends. This is a deliberate design choice that simplifies the agent loop -- it never sees partial tool calls.

### usage
Token counts emitted once at stream end. Anthropic: extracted from `message_start` (input) and `message_delta` (output) events. OpenAI: from the final SSE chunk when `stream_options.include_usage` is enabled.

---

## 3. Message Format (Anthropic-Native)

The internal message format uses Anthropic's content block structure. OpenAI messages are converted to/from this format at the provider boundary.

```typescript
type ContentBlock =
    | { type: 'text'; text: string }
    | { type: 'image'; source: { type: 'base64'; media_type: ImageMediaType; data: string } }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, any> }
    | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

type MessageParam = {
    role: 'user' | 'assistant';
    content: string | ContentBlock[];
};
```

Key design decisions:
- Two roles only (`user`, `assistant`). No `system` role in messages -- system prompt is passed separately.
- Content can be a plain string or an array of typed blocks.
- `tool_use` blocks appear in assistant messages (the model calling a tool).
- `tool_result` blocks appear in user messages (returning results to the model).
- Images use base64 encoding with explicit media type.

---

## 4. Provider Factory

Defined in `src/api/index.ts`. Two entry points:

### buildApiHandlerForModel(model: CustomModel)
- New path. Takes a `CustomModel` from settings.
- Converts to `LLMProvider` via `modelToLLMProvider()`, then delegates to `buildApiHandler()`.

### buildApiHandler(config: LLMProvider)
- Legacy/internal path. Routes by `config.type`:
  - `'anthropic'` --> `new AnthropicProvider(config)`
  - `'openai' | 'ollama' | 'lmstudio' | 'openrouter' | 'azure' | 'custom'` --> `new OpenAiProvider(config)`
- Throws on unknown provider type.

---

## 5. AnthropicProvider

File: `src/api/providers/anthropic.ts`

### Client Setup
- Uses `@anthropic-ai/sdk` with `dangerouslyAllowBrowser: true` (required for Obsidian's Electron environment).
- Configures apiKey, optional baseUrl from LLMProvider config.

### Streaming Implementation
- Calls `client.messages.stream()` with model, max_tokens, temperature, system prompt, converted messages, and tool definitions.
- Temperature is clamped to max 1.0; defaults to 0.2 if not configured.
- `tool_choice: { type: 'auto' }` when tools are provided.

### Tool Accumulation Pattern
- Maintains a `Map<number, { id, name, inputJson }>` keyed by content block index.
- On `content_block_start` with `type: 'tool_use'`: registers the tool's id and name.
- On `content_block_delta` with `type: 'input_json_delta'`: appends partial JSON to the accumulator.
- On `content_block_stop`: parses the accumulated JSON and yields a complete `tool_use` chunk.
- If JSON parsing fails, yields a text chunk with the error message instead.

### Thinking Blocks
- Maintains a separate `Map<number, { text }>` for thinking blocks.
- On `content_block_start` with `type: 'thinking'`: registers the block.
- On `content_block_delta` with `type: 'thinking_delta'`: accumulates text AND yields it incrementally as `thinking` chunks.
- On `content_block_stop`: cleans up the accumulator.

### Usage Tracking
- `inputTokens` extracted from `message_start` event.
- `outputTokens` extracted from `message_delta` event.
- Yielded as a single `usage` chunk after the stream completes.

### Message Conversion
- `convertMessages()` maps internal `MessageParam[]` to Anthropic SDK types.
- Handles text, tool_use, image (base64), and tool_result content blocks.
- Throws on unknown content block types.

---

## 6. OpenAiProvider

File: `src/api/providers/openai.ts`

### Supported Providers
Covers six provider types through a unified OpenAI-compatible API:

| Type | Default Base URL | Notes |
|------|-----------------|-------|
| `openai` | `https://api.openai.com/v1` | Standard OpenAI API |
| `ollama` | `http://localhost:11434/v1` | Auto-appends `/v1` if missing |
| `lmstudio` | `http://localhost:1234/v1` | Local LM Studio |
| `openrouter` | `https://openrouter.ai/api/v1` | Requires HTTP-Referer, X-Title headers |
| `azure` | (user-configured) | Uses `api-key` header, deployment-based URL routing |
| `custom` | `https://api.openai.com/v1` | Any OpenAI-compatible endpoint |

### URL Construction
- Azure: `{baseUrl}/deployments/{model}/chat/completions?api-version={version}`
- Others: `{baseUrl}/chat/completions`
- Azure omits the `model` field from the request body (already in URL path).

### Temperature Handling
Three cases:
1. O-series models (`/^o[1-9]/`): temperature omitted entirely (API enforces 1.0).
2. Explicit temperature in config: always respected.
3. No config: default 0.2, except Azure where it is omitted to avoid conflicts with opaque deployment names.

### Token Limit
- Azure uses `max_completion_tokens` (newer models require it).
- All others use `max_tokens`.

### Authentication
- Azure: `api-key` header.
- OpenRouter: `Authorization: Bearer` plus `HTTP-Referer` and `X-Title` headers.
- Others: `Authorization: Bearer`.

### SSE Stream Parsing
- Uses raw `fetch()` with `ReadableStream` (no SDK dependency).
- Parses `data: ` lines from SSE, ignores `data: [DONE]`.
- Accumulates tool calls in a `Map<number, ToolCallAccumulator>` keyed by tool call index.
- Yields complete `tool_use` chunks when `finish_reason === 'tool_calls'`.
- Usage from `stream_options.include_usage` (OpenAI and OpenRouter only).

### Message Conversion (Anthropic to OpenAI)
- System prompt becomes a `system` role message at the start.
- Assistant `tool_use` blocks become `tool_calls` array with `function` type.
- User `tool_result` blocks become separate `tool` role messages with `tool_call_id`.
- Text blocks are concatenated for assistant messages.

### Tool Conversion
- `ToolDefinition` mapped to OpenAI `function` format: `{ type: 'function', function: { name, description, parameters } }`.

---

## 7. Custom Models Configuration

Defined in `src/types/settings.ts`.

### CustomModel Interface

```typescript
interface CustomModel {
    name: string;           // Model ID for API calls
    provider: ProviderType; // 'anthropic' | 'openai' | 'ollama' | ...
    displayName?: string;   // Human-readable name in UI
    apiKey?: string;        // Per-model API key
    baseUrl?: string;       // Custom endpoint URL
    enabled: boolean;       // Visible in model selector
    isBuiltIn?: boolean;    // Pre-shipped with plugin
    maxTokens?: number;     // Max output tokens
    temperature?: number;   // Temperature override
    apiVersion?: string;    // Azure API version
}
```

### LLMProvider (Backwards Compatibility)

```typescript
interface LLMProvider {
    type: ProviderType;
    apiKey?: string;
    baseUrl?: string;
    model: string;
    maxTokens?: number;
    temperature?: number;
    apiVersion?: string;
}
```

### Conversion
`modelToLLMProvider(model: CustomModel): LLMProvider` bridges from the new CustomModel format to the internal LLMProvider format consumed by the API handler layer.

### Built-in Models
The plugin ships with pre-defined models for all major providers (Anthropic Claude models, OpenAI GPT/o-series, Ollama, LM Studio, OpenRouter, Azure, Gemini via custom endpoint). Built-in models have `isBuiltIn: true` and provide sensible defaults. Users can add unlimited custom models.

---

## 8. Data Flow Summary

```
User Message
    |
    v
AgentTask (agent loop)
    |
    v
buildApiHandlerForModel(activeModel)
    |
    v
AnthropicProvider.createMessage() / OpenAiProvider.createMessage()
    |
    v
AsyncIterable<ApiStreamChunk>
    |
    +-- text chunks --> streamed to UI
    +-- thinking chunks --> displayed in thinking panel
    +-- tool_use chunks --> dispatched to ToolExecutionPipeline
    +-- usage chunk --> accumulated for token tracking
```
