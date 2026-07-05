/** Node and edge model for the local project knowledge graph. */

export type NodeType = 'file' | 'component' | 'route' | 'api' | 'hook' | 'context';

export type EdgeKind =
  | 'imports' // file → file
  | 'defines' // file → component | hook | context
  | 'renders' // component → component
  | 'routes_to' // route → component (the page's default export)
  | 'navigates_to' // component | file → route
  | 'uses' // component | hook | file → hook | context
  | 'calls'; // component | file → api

export interface GraphNode {
  /** Stable id: file = relPath, component = relPath#Name, route = route:/path, api = api:METHOD /path */
  id: string;
  type: NodeType;
  /** Display name (component name, route path, endpoint, or file basename). */
  name: string;
  /** Relative file path this node was extracted from (absent for api/route aggregates). */
  file?: string;
  /** Component only: true when it is the file's default export. */
  isDefaultExport?: boolean;
  /** Component/hook only: size of the declaration in lines. */
  loc?: number;
  /** API only: true for endpoints declared in this codebase (route handlers), false/absent for called endpoints. */
  declared?: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
}

/** Serialized per-file symbol table — enables incremental re-indexing. */
export interface StoredFileSymbols {
  components: Record<string, string>;
  hooks: Record<string, string>;
  contexts: Record<string, string>;
  loc: Record<string, number>;
  defaultId?: string;
}

export interface ProjectGraph {
  version: 1;
  /** Absolute project root the graph was built from. */
  root: string;
  indexedAt: string;
  /** Git HEAD commit at index time, when the project is a git repo. */
  commit?: string;
  /** sha1 content hash per indexed file, for staleness detection. */
  files: Record<string, { hash: string }>;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Per-file symbol tables (TS files only) — cache that powers incremental indexing. */
  symbols?: Record<string, StoredFileSymbols>;
}

export interface IndexStats {
  files: number;
  components: number;
  routes: number;
  apis: number;
  hooks: number;
  contexts: number;
  edges: number;
  durationMs: number;
  /** Context memory: 'incremental' means only changed files (+ their importers) were re-parsed. */
  mode: 'full' | 'incremental';
  /** Number of TS files re-parsed this run. */
  reparsed: number;
  /** Number of TS files whose nodes/edges were reused from the previous graph. */
  reused: number;
}
