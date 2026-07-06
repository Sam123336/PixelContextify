# Software Knowledge Graph — IR Specification (v2)

Contextifly works like a compiler: **providers** (TypeScript/React via ts-morph,
NestJS via ts-morph decorators, Dart/Flutter via a structural scanner, more to
come) transform a project into a common **intermediate representation** — the
Software Knowledge Graph. A **normalizer** assigns framework-agnostic semantic
roles on top. Algorithms consume only the IR. The AI is always the last step,
never the parser.

This document is the stable contract for that IR.

## Location

| File | Purpose |
| ---- | ------- |
| `<project>/.pixelcontextifly/graph.json` | Current graph (this spec) |
| `<project>/.pixelcontextifly/graph.html` | Self-contained interactive visualization |
| `<project>/.pixelcontextifly/history/*.json` | Prior graph snapshots (same schema), newest-last-archived, max 20 |

The directory is derived data: it self-gitignores and can always be rebuilt from source.

## Top-level structure

```jsonc
{
  "version": 2,                    // schema version — see Versioning
  "root": "/abs/path/to/project",  // project root the graph was built from
  "indexedAt": "2026-07-05T06:11:45.123Z",
  "commit": "80782dd…",            // git HEAD at index time (absent outside git)
  "providers": ["frontend", "nestjs"], // providers that contributed to this graph
  "files": {                       // staleness map
    "src/App.tsx": { "hash": "<sha1 of file content>" }
  },
  "nodes": [ /* GraphNode */ ],
  "edges": [ /* GraphEdge */ ],
  "symbols": {                     // optional: per-file symbol tables (frontend provider only) —
    "src/App.tsx": {               // the cache that powers incremental re-indexing.
      "components": { "App": "src/App.tsx#App" },  // consumers may ignore it.
      "hooks": {}, "contexts": {}, "loc": { "src/App.tsx#App": 12 },
      "line": { "src/App.tsx#App": 5 },
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
  name: string;      // display name (component/class name, route path, "METHOD /path", basename)
  file?: string;     // project-relative source file (absent for synthesized route/api nodes)
  role?: SemanticRole;  // framework-agnostic meaning, assigned by the normalizer
  framework?: string;   // 'nestjs' | 'flutter' | … when framework-specific
  isDefaultExport?: boolean; // components only
  shape?: string;    // components only: normalized JSX-shape fingerprint (12-hex
                     // sha1 of the element sequence with component tags collapsed
                     // and attribute names sorted, values dropped). Equal shape =
                     // structural duplicate candidate. Set only for components
                     // with ≥4 JSX elements.
  loc?: number;      // declaration size in lines, when known
  declared?: boolean;// api only: true = endpoint defined in this codebase (route handler);
                     // absent/false = endpoint observed being called
}

type NodeType =
  | 'file' | 'component' | 'route' | 'api' | 'hook' | 'context'   // frontend
  | 'controller' | 'service' | 'module' | 'entity';               // backend

type SemanticRole =
  | 'entry-point'       // route, controller
  | 'http-boundary'     // api
  | 'business-logic'    // service
  | 'composition-root'  // module
  | 'data-model'        // entity
  | 'state';            // context
```

`context` covers all state containers: React Context, Riverpod providers,
ChangeNotifier/Bloc/Cubit classes. `role` never replaces `type` — algorithms
that reason about meaning read `role`; algorithms that need syntax precision
read `type`. Roles are rule-derived and deterministic; when a role cannot be
assigned with certainty it is omitted, never guessed.

### ID conventions

| Type | Format | Example |
| ---- | ------ | ------- |
| file | project-relative path, `/`-separated | `src/components/Card.tsx` |
| component / hook / context / controller / service / module / entity | `<file>#<Name>` | `src/Card.tsx#Card`, `src/orders.controller.ts#OrdersController` |
| route | `route:<path>`, params as `:name`, catch-all `:name*` | `route:/product/:id` |
| api (with method) | `api:<METHOD> <path>` | `api:GET /api/products` |
| api (Next.js handler, method unknown) | `api:ROUTE <path>` | `api:ROUTE /api/orders` |

**The cross-provider seam:** a frontend `fetch('/orders', {method: 'POST'})` and
a backend `@Post()` handler both emit `api:POST /orders`. The orchestrator
merges same-id nodes keeping the richer facts (a declaration always wins over a
synthesized reference), which is what links frontend and backend into one
end-to-end graph without the providers knowing about each other.

## Edges

```ts
interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  source?: { file: string; line: number }; // provenance: where this was observed
  confidence?: number; // (0,1]; omitted = 1.0 (deterministic AST fact)
  reason?: string;     // justification, present whenever confidence < 1
}
```

Every AST-derived edge carries `source`. `confidence` below 1.0 marks heuristic
resolution — currently: navigation targets matched onto a dynamic route pattern
(0.8, `"matched dynamic route pattern"`) and URLs normalized from template
literals (0.7, `"normalized template literal"`). Consumers rendering answers
should cite `source` and surface sub-1.0 confidence.

| kind | from → to | Meaning |
| ---- | --------- | ------- |
| `imports` | file → file, module → module | Module import (internal files only; resolved through tsconfig aliases / `package:` URIs); NestJS `@Module({imports})` |
| `defines` | file → component \| hook \| context \| controller \| service \| module \| entity \| api(declared) | Declaration site |
| `renders` | component \| file → component | JSX / widget-constructor usage |
| `routes_to` | route → component \| file, api → controller | The screen a route mounts; the handler an endpoint resolves to |
| `navigates_to` | component \| hook \| file → route | `<Link>`, `router.push`, `Navigator.pushNamed`, `context.go`, … Navigation targets are canonicalized onto declared routes when the path shape matches unambiguously |
| `uses` | component \| hook \| file \| service → hook \| context \| entity | Hook call, `useContext`, `ref.watch`, `Provider.of<T>`, `@InjectModel`/`@InjectRepository` |
| `calls` | component \| hook \| file → api | `fetch`, `axios.*`, `http.*`, `dio.*` with literal/template URLs (template exprs become `:param`) |
| `injects` | controller \| service \| module → service | Constructor dependency injection |
| `contains` | module → controller \| service | `@Module({controllers, providers})` membership |

Edges are deduplicated on `(from, kind, to)`. Dangling references never occur in
`renders`/`uses`/`imports`/`defines`/`injects`/`contains`; `navigates_to` and
`calls` may point at synthesized route/api nodes that have no `file`.

## Staleness

`files[path].hash` is the SHA-1 of the file content at index time. A consumer can
detect a stale graph by re-hashing; Contextifly's own tools warn when hashes differ.
A missing file counts as stale.

## History & temporal queries

When a re-index produces structurally different content (compared ignoring
`indexedAt`), the previous `graph.json` is archived to `history/<indexedAt>.json`
first. Diffing two snapshots (same schema) yields added/removed nodes by type,
edge deltas, and per-node degree changes — this is what the `graph_diff` tool and
`contextifly diff` render.

## Versioning

`version` is a single integer. Consumers MUST reject versions they don't know.
Additive optional fields may appear within a version; field removals or meaning
changes bump the version. Old graphs are never migrated — they are derived data
and are simply re-indexed (v1 graphs are rejected on load, triggering a full
rebuild).

## Consumption paths

1. **Claude Code plugin** — MCP tools: `index_project`, `get_project_map`,
   `get_impact`, `analyze_project`, `search_graph`, `graph_diff`.
2. **Any MCP client** (Cursor, ChatGPT/Gemini MCP hosts, custom agents) — run
   `contextifly` over stdio; same tools.
3. **Anything else** — the CLI (`contextifly index|map|analyze|impact|search|diff <dir>`)
   prints the same markdown to stdout, or read `graph.json` directly against this spec.
