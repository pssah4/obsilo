# FEATURE: Obsilo Gateway

**Status:** Planned — nicht implementiert
**Priorität:** Nach Agent-Stabilisierung (Monetarisierung)
**Goal:** Managed LLM relay service that allows Obsilo users to access AI models without their own API keys, monetized via credit packs.

---

## 1. Overview

Obsilo Gateway is a hosted relay service between the Obsilo Obsidian plugin and upstream LLM providers (via OpenRouter). Users purchase credit packs and authenticate with an Obsilo license key instead of managing their own API keys.

```
[Obsilo Plugin] → HTTPS → [Obsilo Gateway API] → [OpenRouter] → [Anthropic / OpenAI / ...]
```

**User value:** Zero API key setup, one account for all models, predictable costs.
**Business value:** Margin on token usage (target: 30–50% markup over OpenRouter wholesale rates).

---

## 2. Architecture

### 2.1 Components

| Component | Technology | Hosting |
|---|---|---|
| Gateway API | Cloudflare Workers (Edge) | Cloudflare — global, low latency |
| Auth & Account DB | Supabase (Postgres + Auth) | Supabase Cloud |
| Credit Ledger | Supabase (Postgres) | Same instance |
| Payment | Stripe | Stripe-hosted |
| Upstream LLM | OpenRouter | openrouter.ai |
| Dashboard (optional v2) | Next.js | Vercel |

**Why Cloudflare Workers:** Streaming support, global edge, free tier for 100k req/day, sub-millisecond cold start. Critical for SSE streaming of LLM responses.

### 2.2 Request Flow

```
1. Plugin sends POST /v1/chat/completions
   Headers: Authorization: Bearer <obsilo-key>
   Body: standard OpenAI chat completions payload

2. Gateway validates key → looks up account in Supabase
3. Gateway checks credit balance > 0
4. Gateway rewrites Authorization header to OpenRouter key
5. Gateway streams response back to plugin
6. On stream end: parse usage.total_tokens → deduct credits from ledger
7. If balance hits 0 mid-stream: allow current request to finish, block next
```

### 2.3 API Surface

Base URL: `https://gateway.obsilo.app`

| Endpoint | Method | Description |
|---|---|---|
| `/v1/chat/completions` | POST | OpenAI-compatible chat endpoint (streaming + non-streaming) |
| `/v1/models` | GET | List available models (proxied from OpenRouter, filtered) |
| `/account/balance` | GET | Current credit balance for authenticated key |
| `/account/usage` | GET | Token usage history (last 30 days, per model) |
| `/account/activate` | POST | Exchange purchase token from Stripe for active license key |

All endpoints require `Authorization: Bearer <obsilo-license-key>` except `/account/activate`.

---

## 3. Authentication & Keys

### 3.1 License Key Format

```
obs_gw_<random-32-chars>
```

Example: `obs_gw_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6`

Keys are generated server-side on purchase completion (Stripe webhook → Supabase insert).

### 3.2 Key States

| State | Description |
|---|---|
| `active` | Valid, has credits |
| `depleted` | Valid key, 0 credits — requests blocked with 402 |
| `suspended` | Manually suspended (abuse) |
| `expired` | Time-limited key past expiry (v2 feature) |

### 3.3 Key Storage in Plugin

Keys stored in Obsidian plugin settings (encrypted via Obsidian's `saveData` — same as existing API keys). User enters key in Settings → Providers → Obsilo Gateway.

---

## 4. Credit System

### 4.1 Credit Unit

1 credit = 1,000 tokens (input + output combined, weighted).

Weighting: input tokens count as 1×, output tokens count as 3× (reflects actual cost ratio for most models).

```
effective_tokens = input_tokens + (output_tokens * 3)
credits_charged = ceil(effective_tokens / 1000)
```

### 4.2 Credit Packs (Pricing)

| Pack | Credits | Price | Effective Rate |
|---|---|---|---|
| Starter | 500 | $5 | $0.010 / 1k tokens |
| Standard | 1,500 | $12 | $0.008 / 1k tokens |
| Pro | 5,000 | $35 | $0.007 / 1k tokens |
| Power | 15,000 | $90 | $0.006 / 1k tokens |

**Margin calculation (example — Claude Sonnet 3.5 via OpenRouter):**
- OpenRouter cost: ~$3 input / $15 output per 1M tokens → weighted avg ~$7.50 / 1M
- Our Standard rate: $8.00 / 1M effective tokens → ~6.5% margin
- Our Pro rate: $7.00 / 1M → still slightly above cost

Actual margins depend on model mix. Optimize by restricting cheaper models in lower tiers or by raising output weight.

### 4.3 Credit Deduction

Credits are deducted **after** each request completes (on stream end). Deduction is atomic via Supabase RPC:

```sql
-- Supabase function (called from Worker)
CREATE OR REPLACE FUNCTION deduct_credits(
  p_key TEXT,
  p_credits INTEGER
) RETURNS INTEGER AS $$
DECLARE
  new_balance INTEGER;
BEGIN
  UPDATE accounts
  SET credits = credits - p_credits
  WHERE license_key = p_key AND credits >= p_credits
  RETURNING credits INTO new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'insufficient_credits';
  END IF;

  INSERT INTO usage_log (license_key, credits_charged, charged_at)
  VALUES (p_key, p_credits, now());

  RETURN new_balance;
END;
$$ LANGUAGE plpgsql;
```

### 4.4 Low Balance Warnings

When balance drops below 100 credits, Gateway includes a response header:

```
X-Obsilo-Credits-Remaining: 87
X-Obsilo-Credits-Warning: low
```

Plugin reads these headers and shows a notice in the chat sidebar: "Obsilo Gateway: 87 credits remaining. [Top up →]"

---

## 5. Model Availability

### 5.1 Supported Models (v1)

Only expose models that are stable on OpenRouter and cost-predictable. Map OpenRouter model IDs to friendly display names:

| Display Name | OpenRouter ID | Credits / 1k eff. tokens |
|---|---|---|
| Claude Sonnet 4.5 | anthropic/claude-sonnet-4-5 | 1.2 |
| Claude Haiku 4.5 | anthropic/claude-haiku-4-5 | 0.3 |
| GPT-4o | openai/gpt-4o | 1.0 |
| GPT-4o mini | openai/gpt-4o-mini | 0.15 |
| Gemini 2.0 Flash | google/gemini-2.0-flash-001 | 0.2 |
| Llama 3.3 70B | meta-llama/llama-3.3-70b-instruct | 0.4 |

### 5.2 Model Filtering

The `/v1/models` endpoint returns only the above whitelist, not the full OpenRouter catalog. This prevents users from routing to expensive models at the fixed credit rate.

---

## 6. Plugin Integration

### 6.1 New Provider Type

Add `obsilo-gateway` as a provider type in the plugin alongside existing providers:

```typescript
// In providers config / settings
{
  id: 'obsilo-gateway',
  name: 'Obsilo Gateway',
  type: 'obsilo-gateway',
  baseUrl: 'https://gateway.obsilo.app',
  apiKey: '', // holds the obs_gw_... license key
  models: [], // populated dynamically from /v1/models
}
```

### 6.2 Settings UI

In Settings → Providers → Models, the Obsilo Gateway section shows:

- **License Key** text field (masked, with show/hide toggle)
- **Verify Key** button → calls `/account/balance`, shows "Active — 1,250 credits" or error
- **Buy Credits** link → opens obsilo.app/gateway in browser
- **Current Balance**: live display after verification
- **Usage this month**: token count from `/account/usage`

### 6.3 Balance Header Handling

In `ApiService` or equivalent, after each streaming response, read response headers and emit a balance update event:

```typescript
const remaining = response.headers.get('X-Obsilo-Credits-Remaining');
const warning = response.headers.get('X-Obsilo-Credits-Warning');

if (remaining !== null) {
  this.emit('gateway:balance', parseInt(remaining));
}
if (warning === 'low') {
  this.emit('gateway:low-balance', parseInt(remaining));
}
```

Chat sidebar listens for `gateway:low-balance` and shows a dismissible banner.

---

## 7. Purchase Flow

### 7.1 Flow

```
1. User clicks "Buy Credits" in plugin settings
2. Browser opens: https://obsilo.app/gateway?pack=standard
3. Stripe Checkout page (hosted by Stripe)
4. Payment succeeds → Stripe sends webhook to gateway
5. Webhook handler creates/tops-up account in Supabase
6. User is redirected to: obsilo.app/gateway/success?token=<purchase-token>
7. Page shows: "Your purchase token: obs_pt_..."
8. User copies token, pastes into plugin → Settings → "Activate Purchase"
9. Plugin calls POST /account/activate { token: "obs_pt_..." }
10. Gateway converts purchase token to license key, returns key
11. Plugin saves key to settings automatically
```

**Why purchase token?** Stripe success URL is not secure for key delivery (URL can be shared). Purchase token is single-use and expires after 10 minutes.

### 7.2 Existing User Top-Up

If a user has an existing license key and buys more credits, the webhook looks up their email in Supabase and adds credits to the existing account. No new key issued.

### 7.3 Stripe Products

Create one Stripe product per credit pack with `metadata.credits` set to the credit amount. Webhook reads `metadata.credits` to know how much to add.

---

## 8. Rate Limiting & Abuse Prevention

### 8.1 Per-Key Rate Limits

Enforced in Cloudflare Worker using Cloudflare's built-in rate limiting:

- Max 10 requests/minute per license key
- Max 100 requests/hour per license key
- Max 5 concurrent requests per license key

Returns HTTP 429 on breach. Plugin shows "Rate limit reached, please wait."

### 8.2 Model Restrictions

- Block requests to models not on the whitelist (return 400)
- Block `max_tokens` > 8192 (prevent runaway costs)
- Strip `stream: false` option if not supported (force streaming for better UX)

### 8.3 Abuse Detection (v2)

- Flag accounts spending >10x their historical average in 1 hour
- Auto-suspend if more than 3 failed key attempts from same IP
- Anomaly alerting via Supabase Edge Functions to email

---

## 9. Infrastructure Setup

### 9.1 Cloudflare Worker

```
wrangler.toml:
  name = "obsilo-gateway"
  compatibility_date = "2025-01-01"

  [vars]
  SUPABASE_URL = "..."
  OPENROUTER_BASE = "https://openrouter.ai/api/v1"

  [[secrets]]  # set via wrangler secret put
  SUPABASE_SERVICE_KEY
  OPENROUTER_KEY
  STRIPE_WEBHOOK_SECRET
```

Deploy with `wrangler deploy`. Custom domain `gateway.obsilo.app` via Cloudflare DNS.

### 9.2 Supabase Schema

```sql
-- Accounts table
CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_key TEXT UNIQUE NOT NULL,
  email TEXT,
  credits INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'active', -- active | depleted | suspended
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Usage log
CREATE TABLE usage_log (
  id BIGSERIAL PRIMARY KEY,
  license_key TEXT NOT NULL,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  credits_charged INTEGER,
  charged_at TIMESTAMPTZ DEFAULT now()
);

-- Purchase tokens (single-use, 10min TTL)
CREATE TABLE purchase_tokens (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  credits_to_add INTEGER NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL
);

-- Index for performance
CREATE INDEX idx_usage_log_key ON usage_log(license_key, charged_at DESC);
```

### 9.3 Estimated Monthly Infrastructure Cost

| Service | Cost |
|---|---|
| Cloudflare Workers | $0 (free tier: 100k req/day) |
| Supabase | $0 (free tier: 500MB DB) |
| Stripe | 2.9% + $0.30 per transaction |
| Domain (obsilo.app) | ~$1/month |
| **Total fixed** | **~$1/month** |

---

## 10. Obsilo.app Website (Minimal)

Required pages for launch:

| Page | Content |
|---|---|
| `/gateway` | Credit pack selection + Stripe Checkout links |
| `/gateway/success` | Purchase token display + instructions |
| `/gateway/manage` | Balance lookup by license key, usage history |

Static HTML + minimal JS (no framework needed for v1). Can be hosted on Cloudflare Pages for free.

---

## 11. Launch Checklist

### Pre-launch
- [ ] OpenRouter account + API key (commercial use)
- [ ] Stripe account (business) + products created
- [ ] Supabase project + schema deployed
- [ ] Cloudflare Worker deployed + tested
- [ ] obsilo.app domain registered + DNS configured
- [ ] Gateway pages deployed to Cloudflare Pages
- [ ] Stripe webhook endpoint configured + secret set

### Plugin changes
- [ ] Add `obsilo-gateway` provider type
- [ ] Settings UI: key field, verify button, buy link, balance display
- [ ] Balance header parsing + low-balance banner
- [ ] `/account/balance` polling on sidebar open (cached 60s)
- [ ] Activate-purchase flow (POST /account/activate)

### Testing
- [ ] End-to-end: purchase → activate → send message → credits deducted
- [ ] Low balance warning triggers correctly
- [ ] Rate limiting returns 429 with correct message
- [ ] Depleted account blocked with 402
- [ ] Streaming works without buffering

---

## 12. Open Questions (Decide Before Implementation)

1. **Free trial?** Give new accounts 50 free credits on signup? Requires email verification to prevent abuse.
2. **Subscription tier?** Monthly $X for Y credits/month auto-replenished. More predictable revenue but more Stripe complexity.
3. **Refund policy?** Unused credits refundable within 30 days? Non-refundable? Needs ToS.
4. **EU VAT?** If selling to EU customers, need VAT handling (Stripe Tax handles this automatically).
5. **Obsidian Plugin Store?** Community plugin submission only possible if app is free. Gateway plugin could be a separate "Obsilo Pro" plugin or a premium unlockable within the free plugin.
