# Contextify

> AI Context Compression Infrastructure for Claude Code.

Upload a UI screenshot. A cheap vision model (Gemini 2.0 Flash) converts it
into structured developer markdown. Claude Code consumes the markdown instead
of the raw image — typically **~95% fewer vision tokens** with equal or better
coding output.

```
Screenshot ──► Gemini Flash ──► Structured Markdown ──► Claude Code
```

## Repo Layout

This is a `pnpm` workspace monorepo.

| Package                       | Status   | Purpose                                       |
| ----------------------------- | -------- | --------------------------------------------- |
| `packages/shared`             | Phase 1  | Shared TypeScript types                        |
| `packages/backend`            | Phase 1  | NestJS API + BullMQ worker + Gemini pipeline  |
| `packages/mcp-server`         | Phase 2  | MCP server exposing tools to Claude Code      |
| `packages/vscode-extension`   | Phase 3  | VS Code clipboard / drag-drop integration     |

## Quickstart

### Prerequisites

- Node.js 20+
- pnpm 9+
- Docker (for Postgres + Redis)
- A Google Gemini API key (optional — the worker will mark jobs `failed`
  without one, but the rest of the stack still runs).

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
# edit packages/backend/.env and set GEMINI_API_KEY
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
| POST   | `/screenshots`        | Multipart upload (`file`); enqueues analysis |
| GET    | `/screenshots/:id`    | Fetch status + markdown + token savings      |
| GET    | `/health`             | Liveness check                               |

## Roadmap

See [`/home/sambit/.claude/plans/effervescent-purring-leaf.md`](/home/sambit/.claude/plans/effervescent-purring-leaf.md)
for the Phase 1 plan, and the master plan for Phases 2–9 (MCP server, VS Code
extension, Claude Code plugin, framework awareness, security, monetization).

## License

MIT
# PixelContextify
# PixelContextify
