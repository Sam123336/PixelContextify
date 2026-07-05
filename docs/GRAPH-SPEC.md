# Software Knowledge Graph — IR Specification (v1)

Contextify works like a compiler: parser front-ends (TypeScript/React via ts-morph,
Dart/Flutter via a structural scanner, more to come) transform a project into a
common **intermediate representation** — the Software Knowledge Graph. Any AI
assistant or tool can consume it; the AI is always the last step, never the parser.

This document is the stable contract for that IR.

## Location

| File | Purpose |
| ---- | ------- |
| `<project>/.pixelcontextify/graph.json` | Current graph (this spec) |
| `<project>/.pixelcontextify/graph.html` | Self-contained interactive visualization |
| `<project>/.pixelcontextify/history/*.json` | Prior graph snapshots (same schema), newest-last-archived, max 20 |

The directory is derived data: it self-gitignores and can always be rebuilt from source.

## Top-level structure

```jsonc
{
  "version": 1,                    // schema version — see Versioning
  "root": "/abs/path/to/project",  // project root the graph was built from
  "indexedAt": "2026-07-05T06:11:45.123Z",
  "commit": "80782dd…",            // git HEAD at index time (absent outside git)
  "files": {                       // staleness map
    "src/App.tsx": { "hash": "<sha1 of file content>" }
  },
  "nodes": [ /* GraphNode */ ],
  "edges": [ /* GraphEdge */ ],
  "symbols": {                     // optional: per-file symbol tables (TS files only) —
    "src/App.tsx": {               // the cache that powers incremental re-indexing.
      "components": { "App": "src/App.tsx#App" },  // consumers may ignore it.
      "hooks": {}, "contexts": {}, "loc": { "src/App.tsx#App": 12 },
      "defaultId": "src/App.tsx#App"
    }
  }
}
```

Nodes and edges are sorted (by id, then by from/kind/to), so identical projects
produce identical files regardless of indexing mode — incremental updates are
verified byte-identical to full rebuilds.

## Nodes

```ts
interface GraphNode {
  id: string;        // stable, unique — see ID conventions
  type: NodeType;
  name: string;      // display name (component name, route path, "METHOD /path", basename)
  file?: string;     // project-relative source file (absent for synthesized route/api nodes)
  isDefaultExport?: boolean; // components only
  loc?: number;      // components/hooks only: declaration size in lines
  declared?: boolean;// api only: true = endpoint defined in this codebase (route handler);
                     // absent/false = endpoint observed being called
}

type NodeType = 'file' | 'component' | 'route' | 'api' | 'hook' | 'context';
```

`context` covers all state containers: React Context, Riverpod providers,
ChangeNotifier/Bloc/Cubit classes.

### ID conventions

| Type | Format | Example |
| ---- | ------ | ------- |
| file | project-relative path, `/`-separated | `src/components/Card.tsx` |
| component / hook / context | `<file>#<Name>` | `src/Card.tsx#Card`, `lib/cart.tsx#useCart` |
| route | `route:<path>`, params as `:name`, catch-all `:name*` | `route:/product/:id` |
| api (called) | `api:<METHOD> <path>` | `api:GET /api/products` |
| api (declared handler) | `api:ROUTE <path>` | `api:ROUTE /api/orders` |

## Edges

```ts
interface GraphEdge { from: string; to: string; kind: EdgeKind; }
```

| kind | from → to | Meaning |
| ---- | --------- | ------- |
| `imports` | file → file | Module import (internal files only; resolved through tsconfig aliases / `package:` URIs) |
| `defines` | file → component \| hook \| context \| api(declared) | Declaration site |
| `renders` | component \| file → component | JSX / widget-constructor usage |
| `routes_to` | route → component \| file | The screen a route mounts |
| `navigates_to` | component \| hook \| file → route | `<Link>`, `router.push`, `Navigator.pushNamed`, `context.go`, … Navigation targets are canonicalized onto declared routes when the path shape matches unambiguously |
| `uses` | component \| hook \| file → hook \| context | Hook call, `useContext`, `ref.watch`, `Provider.of<T>` |
| `calls` | component \| hook \| file → api | `fetch`, `axios.*`, `http.*`, `dio.*` with literal/template URLs (template exprs become `:param`) |

Edges are deduplicated on `(from, kind, to)`. Dangling references never occur in
`renders`/`uses`/`imports`/`defines`; `navigates_to` and `calls` may point at
synthesized route/api nodes that have no `file`.

## Staleness

`files[path].hash` is the SHA-1 of the file content at index time. A consumer can
detect a stale graph by re-hashing; Contextify's own tools warn when hashes differ.
A missing file counts as stale.

## History & temporal queries

When a re-index produces structurally different content (compared ignoring
`indexedAt`), the previous `graph.json` is archived to `history/<indexedAt>.json`
first. Diffing two snapshots (same schema) yields added/removed nodes by type,
edge deltas, and per-node degree changes — this is what the `graph_diff` tool and
`contextify-mcp diff` render.

## Versioning

`version` is a single integer. Consumers MUST reject versions they don't know.
Additive optional fields may appear within a version; field removals or meaning
changes bump the version.

## Consumption paths

1. **Claude Code plugin** — MCP tools: `index_project`, `get_project_map`,
   `get_impact`, `analyze_project`, `search_graph`, `graph_diff`.
2. **Any MCP client** (Cursor, ChatGPT/Gemini MCP hosts, custom agents) — run
   `contextify-mcp` over stdio; same tools.
3. **Anything else** — the CLI (`contextify-mcp index|map|analyze|impact|search|diff <dir>`)
   prints the same markdown to stdout, or read `graph.json` directly against this spec.
