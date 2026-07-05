import type { EdgeKind, GraphEdge, GraphNode, ProjectGraph } from './types';

const RENDER_DEPTH = 10;

export class GraphIndex {
  readonly byId = new Map<string, GraphNode>();
  private readonly out = new Map<string, GraphEdge[]>();
  private readonly into = new Map<string, GraphEdge[]>();

  constructor(readonly graph: ProjectGraph) {
    for (const node of graph.nodes) this.byId.set(node.id, node);
    for (const edge of graph.edges) {
      push(this.out, edge.from, edge);
      push(this.into, edge.to, edge);
    }
  }

  outEdges(id: string, kinds?: EdgeKind[]): GraphEdge[] {
    return filterKinds(this.out.get(id) ?? [], kinds);
  }

  inEdges(id: string, kinds?: EdgeKind[]): GraphEdge[] {
    return filterKinds(this.into.get(id) ?? [], kinds);
  }

  routes(): GraphNode[] {
    return this.graph.nodes
      .filter((n) => n.type === 'route')
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Resolve a user-supplied target (node id, component name, file path, or
   * route path) to matching nodes.
   */
  resolve(target: string): GraphNode[] {
    const exact = this.byId.get(target) ?? this.byId.get(`route:${target}`);
    if (exact) return [exact];
    const t = target.toLowerCase();
    const matches = this.graph.nodes.filter(
      (n) =>
        n.name.toLowerCase() === t ||
        n.id.toLowerCase() === t ||
        n.id.toLowerCase().endsWith(`/${t}`) ||
        n.id.toLowerCase().endsWith(`#${t}`),
    );
    if (matches.length > 0) return matches;
    return this.graph.nodes.filter((n) => n.id.toLowerCase().includes(t));
  }

  /** All nodes reachable from a route's page component via renders edges. */
  routeSubtree(routeId: string): GraphNode[] {
    const start = this.outEdges(routeId, ['routes_to']).map((e) => e.to);
    const seen = new Set<string>(start);
    let frontier = start;
    for (let depth = 0; depth < RENDER_DEPTH && frontier.length > 0; depth++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const e of this.outEdges(id, ['renders', 'defines'])) {
          if (!seen.has(e.to)) {
            seen.add(e.to);
            next.push(e.to);
          }
        }
      }
      frontier = next;
    }
    return [...seen].map((id) => this.byId.get(id)).filter((n): n is GraphNode => !!n);
  }

  /**
   * Transitive dependents: everything that could break if `nodeId` changes.
   * Walks all edge kinds in reverse (dependent → dependency).
   */
  dependents(nodeId: string): GraphNode[] {
    const seen = new Set<string>([nodeId]);
    const result: GraphNode[] = [];
    let frontier = [nodeId];
    while (frontier.length > 0) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const e of this.inEdges(id)) {
          if (seen.has(e.from)) continue;
          seen.add(e.from);
          const node = this.byId.get(e.from);
          if (node) {
            result.push(node);
            next.push(e.from);
          }
        }
      }
      frontier = next;
    }
    return result;
  }
}

function push(map: Map<string, GraphEdge[]>, key: string, edge: GraphEdge) {
  const list = map.get(key);
  if (list) list.push(edge);
  else map.set(key, [edge]);
}

function filterKinds(edges: GraphEdge[], kinds?: EdgeKind[]): GraphEdge[] {
  return kinds ? edges.filter((e) => kinds.includes(e.kind)) : edges;
}

/** Markdown project map: route list with component trees and API calls, plus a Mermaid nav diagram. */
export function renderProjectMap(index: GraphIndex): string {
  const routes = index.routes();
  const lines: string[] = ['# Project map', ''];

  if (routes.length === 0) {
    lines.push('_No routes detected (not a Next.js app-router/pages-router project?)._', '');
  }

  for (const route of routes) {
    lines.push(`## \`${route.name}\`${route.file ? `  — ${route.file}` : ''}`);
    const subtree = index.routeSubtree(route.id);
    const components = subtree.filter((n) => n.type === 'component');
    const apis = new Set<string>();
    for (const n of subtree) {
      for (const e of index.outEdges(n.id, ['calls'])) apis.add(e.to.replace(/^api:/, ''));
    }
    if (components.length > 0) {
      lines.push('', renderComponentTree(index, route.id));
    }
    if (apis.size > 0) {
      lines.push('', '**API calls:** ' + [...apis].map((a) => `\`${a}\``).join(', '));
    }
    lines.push('');
  }

  const mermaid = routeNavMermaid(index);
  if (mermaid) {
    lines.push('## Navigation flow', '', '```mermaid', mermaid, '```', '');
  }
  return lines.join('\n');
}

function renderComponentTree(index: GraphIndex, routeId: string): string {
  const lines: string[] = [];
  const visit = (id: string, depth: number, seen: Set<string>) => {
    if (depth > 4 || seen.has(id)) return;
    seen.add(id);
    const node = index.byId.get(id);
    if (!node) return;
    if (node.type === 'component') {
      lines.push(`${'  '.repeat(depth)}- ${node.name}${depth === 0 ? ` (${node.file})` : ''}`);
    }
    for (const e of index.outEdges(id, ['renders'])) visit(e.to, depth + 1, seen);
  };
  for (const e of index.outEdges(routeId, ['routes_to'])) visit(e.to, 0, new Set());
  return lines.join('\n');
}

/** Mermaid flowchart of route → route navigation. */
export function routeNavMermaid(index: GraphIndex): string | null {
  const routes = index.routes();
  if (routes.length === 0) return null;

  // Map every node in each route's subtree back to that route.
  const owner = new Map<string, Set<string>>();
  for (const route of routes) {
    for (const n of index.routeSubtree(route.id)) {
      let set = owner.get(n.id);
      if (!set) owner.set(n.id, (set = new Set()));
      set.add(route.id);
    }
    // The page file itself also belongs to the route.
    if (route.file) {
      let set = owner.get(route.file);
      if (!set) owner.set(route.file, (set = new Set()));
      set.add(route.id);
    }
  }

  const links = new Set<string>();
  for (const edge of index.graph.edges) {
    if (edge.kind !== 'navigates_to') continue;
    const fromRoutes = owner.get(edge.from) ?? new Set<string>();
    for (const fromRoute of fromRoutes) {
      if (fromRoute !== edge.to) links.add(`${fromRoute}-->${edge.to}`);
    }
  }

  const lines = ['flowchart TD'];
  const declared = new Set<string>();
  const declare = (id: string) => {
    if (declared.has(id)) return;
    declared.add(id);
    const label = index.byId.get(id)?.name ?? id.replace(/^route:/, '');
    lines.push(`  ${mermaidId(id)}["${label}"]`);
  };
  for (const route of routes) declare(route.id);
  for (const link of links) {
    const [from, to] = link.split('-->');
    declare(from);
    declare(to);
    lines.push(`  ${mermaidId(from)} --> ${mermaidId(to)}`);
  }
  return lines.length > 1 ? lines.join('\n') : null;
}

function mermaidId(id: string): string {
  return 'n_' + id.replace(/[^A-Za-z0-9]/g, '_');
}

export interface SearchHit {
  node: GraphNode;
  score: number;
  relations: string[];
}

/** Case-insensitive search over node names and ids, best matches first. */
export function searchNodes(index: GraphIndex, query: string, limit = 20): SearchHit[] {
  const q = query.trim().toLowerCase();
  const hits: SearchHit[] = [];
  for (const node of index.graph.nodes) {
    const name = node.name.toLowerCase();
    const id = node.id.toLowerCase();
    let score = 0;
    if (name === q || id === q) score = 100;
    else if (name.startsWith(q)) score = 80;
    else if (name.includes(q)) score = 60;
    else if (id.includes(q)) score = 40;
    if (score === 0) continue;
    hits.push({ node, score, relations: describeRelations(index, node.id) });
  }
  return hits.sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id)).slice(0, limit);
}

/** Markdown structural diff between two graph versions (temporal graph, v1). */
export function renderGraphDiff(before: ProjectGraph, after: ProjectGraph): string {
  const lines: string[] = ['# Architecture diff', ''];
  const label = (g: ProjectGraph) =>
    `${g.indexedAt}${g.commit ? ` (commit ${g.commit.slice(0, 7)})` : ''}`;
  lines.push(`**From:** ${label(before)}  \n**To:** ${label(after)}`, '');

  const beforeIds = new Map(before.nodes.map((n) => [n.id, n]));
  const afterIds = new Map(after.nodes.map((n) => [n.id, n]));
  const added = after.nodes.filter((n) => !beforeIds.has(n.id));
  const removed = before.nodes.filter((n) => !afterIds.has(n.id));

  for (const [title, list] of [
    ['Added', added],
    ['Removed', removed],
  ] as const) {
    if (list.length === 0) continue;
    lines.push(`## ${title}`);
    for (const type of ['route', 'component', 'hook', 'context', 'api', 'file'] as const) {
      const ofType = list.filter((n) => n.type === type);
      if (ofType.length === 0) continue;
      lines.push(`- **${type}s:** ${ofType.map((n) => `\`${n.name}\``).join(', ')}`);
    }
    lines.push('');
  }
  if (added.length === 0 && removed.length === 0) {
    lines.push('_No nodes added or removed._', '');
  }

  // Coupling movement: nodes whose degree changed the most between versions.
  const degree = (g: ProjectGraph) => {
    const d = new Map<string, number>();
    for (const e of g.edges) {
      d.set(e.from, (d.get(e.from) ?? 0) + 1);
      d.set(e.to, (d.get(e.to) ?? 0) + 1);
    }
    return d;
  };
  const dBefore = degree(before);
  const dAfter = degree(after);
  const movers = [...afterIds.values()]
    .filter((n) => n.type === 'component' && beforeIds.has(n.id))
    .map((n) => ({ n, delta: (dAfter.get(n.id) ?? 0) - (dBefore.get(n.id) ?? 0) }))
    .filter((m) => m.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 8);
  if (movers.length > 0) {
    lines.push('## Coupling changes');
    for (const { n, delta } of movers) {
      lines.push(
        `- \`${n.name}\` ${delta > 0 ? 'gained' : 'lost'} ${Math.abs(delta)} connection(s)`,
      );
    }
    lines.push('');
  }

  const edgeDelta = after.edges.length - before.edges.length;
  lines.push(
    `**Totals:** ${after.nodes.length} nodes (${signed(after.nodes.length - before.nodes.length)}), ` +
      `${after.edges.length} edges (${signed(edgeDelta)})`,
  );
  return lines.join('\n');
}

function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

function describeRelations(index: GraphIndex, id: string, cap = 6): string[] {
  const parts: string[] = [];
  for (const e of index.outEdges(id)) {
    parts.push(`${e.kind} → ${index.byId.get(e.to)?.name ?? e.to}`);
  }
  for (const e of index.inEdges(id)) {
    parts.push(`← ${e.kind} by ${index.byId.get(e.from)?.name ?? e.from}`);
  }
  return parts.slice(0, cap);
}
