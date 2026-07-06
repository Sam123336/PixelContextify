/**
 * Intermediate Representation (IR) for the software knowledge graph.
 *
 * This is the stable contract between the three layers of the pipeline:
 *
 *   Providers → IR → Normalizer → Algorithms → AI
 *
 * Rules:
 *  1. Providers never know about each other — they only emit IR.
 *  2. Algorithms (queries, diffs, traces) consume only IR, never source code.
 *  3. AI never discovers architecture; it explains architecture discovered by
 *     the compiler and cites the supporting edges and source locations.
 *
 * Schema changes bump ProjectGraph.version. Old versions are derived data and
 * are simply re-indexed, never migrated.
 */

export type NodeType =
  // frontend
  | 'file'
  | 'component'
  | 'route'
  | 'api'
  | 'hook'
  | 'context'
  // backend
  | 'controller'
  | 'service'
  | 'module'
  | 'entity'
  // native bridge (Flutter platform channels)
  | 'channel' // a named platform channel, spanning the Dart↔native boundary
  | 'native'; // a native source file (Kotlin/Java/Swift/Obj-C) that handles a channel

/**
 * Framework-agnostic role assigned by the normalizer. Algorithms that want to
 * reason about meaning ("entry points", "state") read this; algorithms that
 * need syntax precision read `type`. Both always coexist — the role never
 * replaces the concrete type.
 */
export type SemanticRole =
  | 'entry-point'
  | 'http-boundary'
  | 'business-logic'
  | 'composition-root'
  | 'data-model'
  | 'state';

export type EdgeKind =
  | 'imports' // file → file, module → module
  | 'defines' // file → component | hook | context | controller | service | module | entity | api
  | 'renders' // component → component
  | 'routes_to' // route → component, api → controller (a thing resolves to its handler)
  | 'navigates_to' // component | file → route
  | 'uses' // component | hook | file | service → hook | context | entity
  | 'calls' // component | file → api
  | 'injects' // controller | service | module → service (constructor DI)
  | 'contains' // module → controller | service
  | 'invokes' // component | file → channel (Dart side calls a platform channel)
  | 'handles'; // native → channel (native code implements a platform channel)

/** Where an edge was discovered. Mandatory for all AST-derived edges. */
export interface EdgeSource {
  /** Relative path of the file the relationship was observed in. */
  file: string;
  /** 1-based line number. */
  line: number;
}

export interface GraphNode {
  /** Stable id: file = relPath, symbol = relPath#Name, route = route:/path, api = api:METHOD /path */
  id: string;
  type: NodeType;
  /** Display name (component/class name, route path, endpoint, or file basename). */
  name: string;
  /** Relative file path this node was extracted from (absent for api/route aggregates). */
  file?: string;
  /** Semantic role assigned by the normalizer — never set by providers directly. */
  role?: SemanticRole;
  /** Source framework, when the node came from a framework-specific provider. */
  framework?: string;
  /** Component only: true when it is the file's default export. */
  isDefaultExport?: boolean;
  /**
   * Component only: normalized JSX-shape fingerprint (12-hex sha1 prefix).
   * Two components with equal shape render structurally identical markup —
   * merge candidates even under different names. Set only when the component
   * has enough JSX for the shape to be meaningful.
   */
  shape?: string;
  /** Declaration size in lines, when known. */
  loc?: number;
  /** API only: true for endpoints declared in this codebase (route handlers), false/absent for called endpoints. */
  declared?: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  /** Provenance: where this relationship was observed. */
  source?: EdgeSource;
  /**
   * Confidence in (0, 1]. Omitted means 1.0 (deterministic AST fact).
   * Set below 1.0 only for heuristic matches, always together with `reason`.
   */
  confidence?: number;
  /** Human-readable justification for a heuristic edge (confidence < 1). */
  reason?: string;
}

/** Serialized per-file symbol table — enables incremental re-indexing. */
export interface StoredFileSymbols {
  components: Record<string, string>;
  hooks: Record<string, string>;
  contexts: Record<string, string>;
  loc: Record<string, number>;
  /** node id → 1-based declaration line (provenance for defines edges). */
  line: Record<string, number>;
  defaultId?: string;
}

export interface ProjectGraph {
  version: 2;
  /** Absolute project root the graph was built from. */
  root: string;
  indexedAt: string;
  /** Git HEAD commit at index time, when the project is a git repo. */
  commit?: string;
  /** Names of the providers that contributed to this graph. */
  providers?: string[];
  /** sha1 content hash per indexed file, for staleness detection. */
  files: Record<string, { hash: string }>;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Per-file symbol tables (frontend provider only) — cache that powers incremental indexing. */
  symbols?: Record<string, StoredFileSymbols>;
}

export interface IndexStats {
  files: number;
  components: number;
  routes: number;
  apis: number;
  hooks: number;
  contexts: number;
  controllers: number;
  services: number;
  modules: number;
  entities: number;
  channels: number;
  natives: number;
  edges: number;
  durationMs: number;
  /** Context memory: 'incremental' means only changed files (+ their importers) were re-parsed. */
  mode: 'full' | 'incremental';
  /** Number of TS files re-parsed this run. */
  reparsed: number;
  /** Number of TS files whose nodes/edges were reused from the previous graph. */
  reused: number;
}
