# Contextify

> AI Context Compression Infrastructure for Claude Code.

Upload a UI screenshot. A cheap vision model converts it into structured
developer markdown. Claude Code consumes the markdown instead of the raw image
— typically **~95% fewer vision tokens** with equal or better coding output.

```
Screenshot ──► Vision LLM ──► Structured Markdown ──► Claude Code
```

The vision model defaults to **Gemini 2.0 Flash**, but is fully pluggable:
choose **Gemini, OpenAI, Anthropic, or any OpenAI-compatible endpoint**, and
optionally **bring your own API key** per request. See
[Choosing an LLM provider](#choosing-an-llm-provider) below.

## Repo Layout

This is a `pnpm` workspace monorepo.

| Package                       | Status   | Purpose                                       |
| ----------------------------- | -------- | --------------------------------------------- |
| `packages/shared`             | Phase 1  | Shared TypeScript types                        |
| `packages/backend`            | Phase 1  | NestJS API + BullMQ worker + multi-provider LLM pipeline |
| `packages/mcp-server`         | Phase 2  | MCP server exposing tools to Claude Code      |
| `packages/vscode-extension`   | Phase 3  | VS Code clipboard / drag-drop integration     |

## Quickstart

### Prerequisites

- Node.js 20+
- pnpm 9+
- Docker (for Postgres + Redis)
- An LLM API key for your chosen provider (optional — the worker will mark
  jobs `failed` without one, but the rest of the stack still runs). Gemini is
  the default; see [Choosing an LLM provider](#choosing-an-llm-provider).

### 1. Install

```bash
pnpm install
```

### 2. Bring up Postgres + Redis

```bash
docker compose up -d postgres redis
```

### 3. Configure env

```bash
cp .env.example packages/backend/.env
# edit packages/backend/.env and set LLM_API_KEY (Gemini by default)
```

### 4. Run the backend

```bash
pnpm dev
```

The API listens on `http://localhost:3000`.

### 5. Smoke test

```bash
curl -F "file=@./sample.png" http://localhost:3000/screenshots
# → { "id": "...", "status": "queued" }

curl http://localhost:3000/screenshots/<id>
# poll until status == "done"
```

## API (Phase 1)

| Method | Path                  | Description                                  |
| ------ | --------------------- | -------------------------------------------- |
| POST   | `/screenshots`        | Multipart upload (`file`); enqueues analysis. Accepts optional [LLM override headers](#per-request-bring-your-own-key). |
| GET    | `/screenshots/:id`    | Fetch status + markdown + token savings      |
| GET    | `/health`             | Liveness check                               |

## Choosing an LLM provider

Contextify is provider-agnostic. By default it uses the server's configured
key, but callers can override the provider, key, and model **per request** so
each user brings their own credentials.

### Supported providers

| Provider            | `provider` value    | Default model                 | Needs base URL? |
| ------------------- | ------------------- | ----------------------------- | --------------- |
| Google Gemini       | `gemini`            | `gemini-2.0-flash`            | no              |
| OpenAI              | `openai`            | `gpt-4o`                      | no              |
| Anthropic Claude    | `anthropic`         | `claude-3-5-sonnet-latest`    | no              |
| OpenAI-compatible   | `openai-compatible` | _(none — must specify)_       | **yes**         |

`openai-compatible` works with any endpoint that speaks the OpenAI Chat
Completions API and exposes a **vision-capable** model — OpenRouter, Together,
Groq, Fireworks, vLLM, LM Studio, Ollama (`http://localhost:11434/v1`), etc.

### Server default (env)

Set the fallback used when a request brings no key of its own
(`packages/backend/.env`):

```bash
LLM_PROVIDER=gemini          # gemini | openai | anthropic | openai-compatible
LLM_API_KEY=                 # key for the chosen provider
LLM_MODEL=                   # blank → provider default; required for openai-compatible
LLM_BASE_URL=                # only for openai-compatible, e.g. https://openrouter.ai/api/v1
```

> The legacy `GEMINI_API_KEY` / `GEMINI_MODEL` vars are still honoured as
> fallbacks when the `LLM_*` vars are unset.

### Per-request (bring your own key)

Send these headers on `POST /screenshots` to override the server default for
that upload. The key is **never persisted** — it lives only on the in-flight
queue job and is dropped as soon as the job settles.

| Header             | Description                                          |
| ------------------ | ---------------------------------------------------- |
| `x-llm-provider`   | One of the `provider` values above                   |
| `x-llm-api-key`    | Your API key (required to trigger the override)      |
| `x-llm-model`      | Model id (optional; required for `openai-compatible`)|
| `x-llm-base-url`   | Endpoint base URL (required for `openai-compatible`) |

```bash
curl -F "file=@./sample.png" \
  -H "x-llm-provider: openai" \
  -H "x-llm-api-key: sk-..." \
  -H "x-llm-model: gpt-4o" \
  http://localhost:3000/screenshots
```

> The header carries the raw key over whatever transport the backend URL uses.
> Fine for `localhost`; use HTTPS for any remote backend.

## VS Code extension

Drop or paste a screenshot into any editor, or run **“Contextify: Analyze
Image File…”** from the Command Palette. The result markdown is inserted at the
cursor.

### Settings

| Setting                    | Purpose                                                    |
| -------------------------- | ---------------------------------------------------------- |
| `contextify.backendUrl`    | Base URL of the Contextify backend                         |
| `contextify.timeoutMs`     | Max time to wait for an analysis                           |
| `contextify.llm.provider`  | `default` (use backend key) or a specific provider         |
| `contextify.llm.apiKey`    | Your own key, sent per upload (never stored server-side)   |
| `contextify.llm.model`     | Model id (required for `openai-compatible`)                |
| `contextify.llm.baseUrl`   | Endpoint base URL for `openai-compatible`                  |

A **status-bar item** (bottom-right, `Contextify: <provider>`) shows the active
provider — click it to switch in one step, or run **“Contextify: Select LLM
Provider…”**. When `provider` is `default` or the key is blank, no key is sent
and the backend's own provider is used.

### Packaging

```bash
cd packages/vscode-extension
pnpm run package        # bundles with esbuild → contextify-<version>.vsix
code --install-extension contextify-0.2.0.vsix
```

## Roadmap

See [`/home/sambit/.claude/plans/effervescent-purring-leaf.md`](/home/sambit/.claude/plans/effervescent-purring-leaf.md)
for the Phase 1 plan, and the master plan for Phases 2–9 (MCP server, VS Code
extension, Claude Code plugin, framework awareness, security, monetization).

## License

MIT
