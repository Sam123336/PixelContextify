# Contextify

**A persistent context engine for AI coding assistants.**

Every AI assistant today re-discovers your project in every conversation: it searches dozens of files, re-reads the same code, re-analyzes the same screenshots, and guesses at dependencies. You pay for that three ways — **time, tokens, and wrong answers**.

Contextify gives your project a permanent understanding layer that the AI queries instead:

```
Without Contextify                      With Contextify

Developer asks a question               Developer asks a question
  → Claude searches 40+ files             → Claude queries the Contextify graph
  → reads 15–20 of them                   → answers
  → traces imports & routes by hand
  → guesses the rest
  → answers

~45 seconds · tens of thousands         ~2 seconds · a few hundred tokens
of exploration tokens · guessed         · verified edges, not guesses
dependencies                            (typical architecture question)
```

Two engines feed one knowledge graph, and the AI is always the *last* step, never the parser:

```
UI screenshots ──► Screenshot Engine ─┐
                                      ├──► Knowledge Graph ──► Claude / any MCP client
Source code ─────► Codegraph ─────────┘      (lives in your project folder —
                                              code never leaves your machine)
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

## Software Knowledge Graph (v0.3)

Contextify can also build a **local Software Knowledge Graph** of a TypeScript/React/Next.js or Flutter codebase — no LLM in the pipeline and no code ever leaves your machine. It parses the AST with the TypeScript compiler (via ts-morph), extracts typed nodes (files, components, routes, hooks, contexts, API endpoints) and typed edges (imports, renders, navigates, uses, calls), and stores the graph in `<project>/.pixelcontextify/graph.json` (auto-gitignored).

**Flutter support (beta):** `.dart` files are indexed by a dedicated structural scanner — Stateless/Stateful/Consumer/Hook widgets (State classes are attributed to their widget), GoRouter routes and `routes:` maps, `Navigator.pushNamed` / `context.go` / `Get.toNamed` navigation, `http`/`dio` API calls, and Riverpod providers / `ChangeNotifier` / Bloc state containers. Mixed React + Flutter monorepos merge into a single graph.

Ask Claude Code things like:

> index this project with contextify
> show me the project map
> what breaks if I change ProductCard?
> what's my architecture score?
> what changed architecturally since the last index?

| Tool              | What it does                                                                 |
| ----------------- | ---------------------------------------------------------------------------- |
| `index_project`   | Parse the project and build/refresh the graph (runs 100% locally). Also writes an **interactive visualization** to `.pixelcontextify/graph.html` — open it in any browser: force-directed layout, color-coded node types, search, type filters, and a click-through details panel showing every relationship. Fully self-contained (no CDN, works offline). |
| `get_project_map` | Routes with component trees + API calls, plus a Mermaid navigation diagram   |
| `get_impact`      | Everything that transitively depends on a component/file/route — affected components/files/routes/contexts, APIs in the blast radius, and a Low/Medium/High regression-risk rating |
| `analyze_project` | Architecture score (0–100) with a breakdown: circular imports, possibly-dead components/hooks, API routes never called from the UI, oversized components, duplicate names |
| `search_graph`    | Find components/routes/APIs by name and see their relationships — e.g. map a screenshot's "Checkout" button to the component that renders it |
| `graph_diff`      | Temporal graph: compare against an earlier snapshot — added/removed routes, components, APIs, and coupling changes |
| `match_screenshot`| Semantic screenshot ↔ code matching: "Orange Checkout Button" → the component that implements it and the routes it appears on; feed it a whole `analyze_screenshot` output to map every detected element at once |
| `graph_timeline`  | Architecture timeline: chronological evolution across all snapshots — what was added/removed at each step, tagged with dates and git commits |
| `get_feature`     | Feature Graph: reason in features, not files — "explain Authentication" lists that feature's routes, components, state, APIs, and entry points. Features come from a committable `contextify.features.json` (name → route/glob/symbol patterns) or are auto-derived from route groups, with cross-feature shared nodes flagged |

**Context memory (incremental indexing):** re-indexing only re-parses changed files plus the files that import them — everything else is reused from the cached per-file symbol tables, compiler-style. A no-op re-index of an indexed project takes milliseconds; results are verified byte-identical to a full rebuild.

**Reverse queries** work through `get_impact`: ask it about an endpoint (`get_impact . "GET /products"`) and it returns every screen where that API appears visually, via the components that call it.

### The graph is an open IR — not locked to Claude

The knowledge graph is a documented intermediate representation ([docs/GRAPH-SPEC.md](docs/GRAPH-SPEC.md)) with three consumption paths:

1. **Claude Code plugin** — the MCP tools above.
2. **Any MCP client** (Cursor, ChatGPT/Gemini MCP hosts, custom agents) — run `contextify-mcp` over stdio.
3. **Anything else** — the same binary is a CLI, and `graph.json` is plain JSON:

```bash
contextify-mcp index .              # build graph + graph.html
contextify-mcp map .                # routes, component trees, Mermaid nav flow
contextify-mcp analyze .            # architecture score + debt report
contextify-mcp impact . ProductCard # blast radius + regression risk
contextify-mcp search . checkout    # find nodes + relationships
contextify-mcp diff .               # what changed since the last snapshot
```

### Bundled skills (the AI layer)

The plugin also ships two skills that teach Claude how to chain the graph tools — no extra setup, they activate on matching requests:

- **codegraph-refactor** — "suggest refactorings", "what should I split?": produces a prioritized plan (split/merge/extract/dead-code/lazy-load candidates) where every suggestion is scoped with `get_impact` and grounded in real file paths before it's proposed.
- **codegraph-copilot** — "explain this project", "generate onboarding docs", "find the payment flow", "visualize state management", "estimate this feature", "break it into tickets": answers from graph queries first, source reading second, with Mermaid diagrams where they help.

**Live context:** every graph tool checks content hashes before answering — if indexed files changed on disk, the graph (and `graph.html`) auto-refreshes transparently first. No manual re-index step. (Brand-new files are picked up on the next refresh or `index_project` run.)

Each re-index that detects changes archives the previous graph to `.pixelcontextify/history/` (last 20 kept), which is what `graph_diff` compares against. Route detection currently covers Next.js app-router/pages-router and Flutter (GoRouter + named routes); component/hook/API extraction works for any React TypeScript/JavaScript codebase and idiomatic Flutter/Dart.

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
