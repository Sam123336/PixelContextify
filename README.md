# Contextify

Turn UI screenshots into structured developer markdown for Claude Code — typically **~90% fewer vision tokens** with equal or better coding output.

```
Screenshot ──► Vision LLM ──► Structured Markdown ──► Claude Code
```

## Quick start

Install the plugin (a hosted backend is included — no setup, no API keys):

```bash
claude plugin marketplace add Sam123336/PixelContextify
claude plugin install contextify@contextify
```

> Using the Claude Code CLI? You can also run these as `/plugin marketplace add …` and `/plugin install …` inside a session. Don't have the `claude` CLI: `npm install -g @anthropic-ai/claude-code`.

Then start a new Claude Code session and ask:

> analyze this screenshot with contextify: /path/to/screenshot.png

Approve the tool prompt. The first call after a quiet period can take up to a minute while the free-tier server wakes; subsequent calls are fast. Supported formats: PNG, JPEG, WebP.

## What you get

For each screenshot, Claude receives compact markdown instead of the raw image:

- **Screen type** — what kind of UI it is
- **Components** — headers, sections, cards, CTAs
- **Layout** — grid structure, hierarchy, spacing
- **Design style** — colors, typography, elevation
- **Problems & suggestions** — contrast, density, hierarchy issues

## Code knowledge graph (v0.3)

Contextify can also build a **local knowledge graph** of a TypeScript/React/Next.js codebase — no LLM in the pipeline and no code ever leaves your machine. It parses the AST with the TypeScript compiler (via ts-morph), extracts typed nodes (files, components, routes, hooks, contexts, API endpoints) and typed edges (imports, renders, navigates, uses, calls), and stores the graph in `<project>/.pixelcontextify/graph.json` (auto-gitignored).

Ask Claude Code things like:

> index this project with contextify
> show me the project map
> what breaks if I change ProductCard?
> what changed architecturally since the last index?

| Tool              | What it does                                                                 |
| ----------------- | ---------------------------------------------------------------------------- |
| `index_project`   | Parse the project and build/refresh the graph (runs 100% locally). Also writes an **interactive visualization** to `.pixelcontextify/graph.html` — open it in any browser: force-directed layout, color-coded node types, search, type filters, and a click-through details panel showing every relationship. Fully self-contained (no CDN, works offline). |
| `get_project_map` | Routes with component trees + API calls, plus a Mermaid navigation diagram   |
| `get_impact`      | Everything that transitively depends on a component/file/route — regression risk before you change it |
| `search_graph`    | Find components/routes/APIs by name and see their relationships — e.g. map a screenshot's "Checkout" button to the component that renders it |
| `graph_diff`      | Temporal graph: compare against an earlier snapshot — added/removed routes, components, APIs, and coupling changes |

Each re-index that detects changes archives the previous graph to `.pixelcontextify/history/` (last 20 kept), which is what `graph_diff` compares against. Route detection currently covers Next.js app-router and pages-router projects; component/hook/API extraction works for any React TypeScript/JavaScript codebase.

## Configuration

The plugin works with zero configuration. To customize, set these environment variables where Claude Code runs (all optional):

| Env var                   | Description                                                        |
| ------------------------- | ------------------------------------------------------------------ |
| `CONTEXTIFY_BACKEND_URL`  | Use your own backend (default: the hosted instance)                |
| `CONTEXTIFY_LLM_PROVIDER` | Bring your own LLM: `gemini`, `openai`, `anthropic`, `openai-compatible` |
| `CONTEXTIFY_LLM_API_KEY`  | Your key for that provider — sent per request, never stored server-side |
| `CONTEXTIFY_LLM_MODEL`    | Model id (required for `openai-compatible`)                        |
| `CONTEXTIFY_LLM_BASE_URL` | Endpoint URL (required for `openai-compatible`)                    |

### Supported LLM providers

| Provider          | `provider` value    | Default model              | Needs base URL? |
| ----------------- | ------------------- | -------------------------- | --------------- |
| Google Gemini     | `gemini`            | `gemini-2.5-flash-lite`    | no              |
| OpenAI            | `openai`            | `gpt-4o`                   | no              |
| Anthropic Claude  | `anthropic`         | `claude-3-5-sonnet-latest` | no              |
| OpenAI-compatible | `openai-compatible` | _(must specify)_           | **yes**         |

`openai-compatible` works with any endpoint that speaks the OpenAI Chat Completions API and exposes a vision-capable model — Groq, OpenRouter, Together, Fireworks, vLLM, Ollama, etc.

## API

The backend is a plain HTTP API you can use without the plugin:

| Method | Path               | Description                                     |
| ------ | ------------------ | ----------------------------------------------- |
| POST   | `/screenshots`     | Multipart upload (`file`); enqueues analysis    |
| GET    | `/screenshots/:id` | Status + markdown + token savings               |
| GET    | `/health`          | Liveness check                                  |

Per-request LLM override headers on `POST /screenshots` (the key lives only on the in-flight job and is dropped when it settles):

| Header           | Description                                            |
| ---------------- | ------------------------------------------------------ |
| `x-llm-provider` | One of the provider values above                       |
| `x-llm-api-key`  | Your API key (required to trigger the override)        |
| `x-llm-model`    | Model id (optional; required for `openai-compatible`)  |
| `x-llm-base-url` | Endpoint base URL (required for `openai-compatible`)   |

```bash
curl -X POST https://<backend-url>/screenshots \
  -H "x-llm-provider: openai" \
  -H "x-llm-api-key: sk-..." \
  -F "file=@./screenshot.png"
```

## Self-hosting

### Run locally

Prerequisites: Node.js 20+, pnpm 9+, Docker.

```bash
pnpm install
docker compose up -d postgres redis
cp .env.example packages/backend/.env   # set LLM_API_KEY
pnpm dev                                # API on http://localhost:3000
```

Point the plugin at it with `CONTEXTIFY_BACKEND_URL=http://localhost:3000`.

Server-default LLM config (`packages/backend/.env`):

```bash
LLM_PROVIDER=gemini   # gemini | openai | anthropic | openai-compatible
LLM_API_KEY=          # key for the chosen provider
LLM_MODEL=            # blank → provider default; required for openai-compatible
LLM_BASE_URL=         # only for openai-compatible
```

### Deploy on Render (free tier)

[`render.yaml`](render.yaml) is a ready-made blueprint. Create a free Postgres database ([Neon](https://neon.tech)) and Redis ([Upstash](https://upstash.com)), then on [Render](https://render.com): **New → Blueprint** → pick your fork → fill in `DATABASE_URL`, `REDIS_URL`, and `LLM_API_KEY`. Free-plan note: the service sleeps after ~15 idle minutes and takes ~30–60s to wake.

### Deploy on Azure

[`deploy/azure.sh`](deploy/azure.sh) provisions Container Apps + managed Postgres + Redis and prints the public URL:

```bash
az login
PG_PASSWORD='<strong-pw>' LLM_API_KEY='<your-key>' ./deploy/azure.sh
```

Redeploys are a button press via the [manual GitHub Actions workflow](.github/workflows/deploy-azure.yml) once the repo secrets/variables documented in that file are set.

Notes for any host:
- Schema is created automatically on boot (Sequelize `synchronize`).
- Single replica by default: uploads are written to local disk and read by the in-process worker. To scale out, mount shared storage at `UPLOAD_DIR`.

## Repository layout

`pnpm` workspace monorepo:

| Package                     | Purpose                                                  |
| --------------------------- | -------------------------------------------------------- |
| `packages/backend`          | NestJS API + BullMQ worker + multi-provider LLM pipeline |
| `packages/mcp-server`       | MCP server exposing tools to Claude Code                 |
| `packages/shared`           | Shared TypeScript types                                  |
| `packages/vscode-extension` | VS Code clipboard / drag-drop integration                |

To rebuild the plugin's bundled MCP server after changing `packages/mcp-server`:

```bash
pnpm --filter @contextify/mcp-server run bundle:plugin   # → bundle/index.cjs
```

## VS Code extension

Drop or paste a screenshot into any editor, or run **"Contextify: Analyze Image File…"** from the Command Palette; the markdown is inserted at the cursor. Configure via the `contextify.*` settings (backend URL, provider, key). Package with:

```bash
cd packages/vscode-extension
pnpm run package   # → contextify-<version>.vsix
```

## License

MIT
