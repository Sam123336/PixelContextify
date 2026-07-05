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

// --- smart analysis (architecture score) ----------------------------------

/** Next.js entry-point files whose components are invoked by the framework, not by imports. */
const FRAMEWORK_ENTRY = new Set([
  'page', 'layout', 'template', 'error', 'loading', 'not-found',
  'global-error', 'default', 'middleware', '_app', '_document',
]);

function baseName(file: string | undefined): string {
  if (!file) return '';
  const b = file.split('/').pop() ?? '';
  return b.replace(/\.[^.]+$/, '');
}

export interface AnalysisReport {
  score: number;
  markdown: string;
}

export function analyzeProject(index: GraphIndex): AnalysisReport {
  const nodes = index.graph.nodes;

  // 1. Circular imports — SCCs of size > 1 in the file-import graph.
  const cycles = importCycles(index);

  // 2. Dead code — components nobody renders/routes to, hooks nobody uses.
  //    Framework entry files are excluded (Next.js calls them, not imports).
  const deadComponents = nodes.filter(
    (n) =>
      n.type === 'component' &&
      !FRAMEWORK_ENTRY.has(baseName(n.file)) &&
      index.inEdges(n.id, ['renders', 'routes_to']).length === 0,
  );
  const deadHooks = nodes.filter(
    (n) => n.type === 'hook' && index.inEdges(n.id, ['uses']).length === 0,
  );

  // 3. Declared API routes that no frontend code calls.
  const called = nodes.filter((n) => n.type === 'api' && !n.declared);
  const calledPaths = called.map((n) => n.name.split(' ').pop() ?? '');
  const unusedApis = nodes.filter(
    (n) =>
      n.type === 'api' &&
      n.declared &&
      !calledPaths.some((p) => samePathShape(p, n.name)),
  );

  // 4. Oversized components/hooks.
  const large = nodes
    .filter((n) => (n.loc ?? 0) >= 150)
    .sort((a, b) => (b.loc ?? 0) - (a.loc ?? 0));

  // 5. Same component name declared in multiple files.
  const byName = new Map<string, GraphNode[]>();
  for (const n of nodes) {
    if (n.type !== 'component' || FRAMEWORK_ENTRY.has(baseName(n.file))) continue;
    const list = byName.get(n.name);
    if (list) list.push(n);
    else byName.set(n.name, [n]);
  }
  const duplicates = [...byName.entries()].filter(([, list]) => list.length > 1);

  const penalty =
    Math.min(24, cycles.length * 8) +
    Math.min(16, (deadComponents.length + deadHooks.length) * 2) +
    Math.min(15, large.length * 3) +
    Math.min(10, unusedApis.length * 2) +
    Math.min(10, duplicates.length * 2);
  const score = Math.max(0, 100 - penalty);
  const grade =
    score >= 90 ? 'excellent' : score >= 75 ? 'good' : score >= 60 ? 'fair' : 'needs attention';

  const check = (bad: number, okMsg: string, badMsg: string) =>
    bad === 0 ? `- ✓ ${okMsg}` : `- ⚠ ${badMsg}`;

  const lines: string[] = [
    `# Architecture score: ${score}/100 (${grade})`,
    '',
    check(cycles.length, 'No circular imports', `${cycles.length} circular import chain(s)`),
    check(
      deadComponents.length + deadHooks.length,
      'No dead components or hooks',
      `${deadComponents.length + deadHooks.length} unreferenced component(s)/hook(s)`,
    ),
    check(large.length, 'All components reasonably sized', `${large.length} component(s) over 150 lines`),
    check(unusedApis.length, 'All declared API routes are used', `${unusedApis.length} API route(s) never called from the UI`),
    check(duplicates.length, 'No duplicate component names', `${duplicates.length} component name(s) defined in multiple files`),
    '',
  ];

  if (cycles.length > 0) {
    lines.push('## Circular imports');
    for (const cycle of cycles.slice(0, 8)) {
      lines.push(`- ${cycle.map((f) => `\`${f}\``).join(' → ')} → back to start`);
    }
    lines.push('');
  }
  if (deadComponents.length + deadHooks.length > 0) {
    lines.push('## Possibly dead code');
    for (const n of [...deadComponents, ...deadHooks].slice(0, 20)) {
      lines.push(`- ${n.type}: \`${n.id}\``);
    }
    lines.push(
      '',
      '_Static analysis only — verify before deleting. Barrel re-exports (`export * from`), ' +
        'dynamic imports, and usage from files outside this project are not tracked._',
      '',
    );
  }
  if (unusedApis.length > 0) {
    lines.push('## API routes never called from the UI');
    for (const n of unusedApis.slice(0, 20)) lines.push(`- \`${n.name}\` — ${n.file}`);
    lines.push('', '_May be called by external clients, webhooks, or server code._', '');
  }
  if (large.length > 0) {
    lines.push('## Large components (>150 lines — consider splitting)');
    for (const n of large.slice(0, 10)) lines.push(`- \`${n.id}\` — ${n.loc} lines`);
    lines.push('');
  }
  if (duplicates.length > 0) {
    lines.push('## Duplicate component names (merge or rename?)');
    for (const [name, list] of duplicates.slice(0, 10)) {
      lines.push(`- \`${name}\`: ${list.map((n) => `\`${n.file}\``).join(', ')}`);
    }
    lines.push('');
  }

  lines.push(
    '---',
    '_Score = 100 − penalties (cycles −8 each, dead code −2, large components −3, ' +
      'unused APIs −2, duplicate names −2; each category capped). Structural metrics ' +
      'only — it cannot judge naming, correctness, or design quality._',
  );
  return { score, markdown: lines.join('\n') };
}

/** Two endpoint paths match if segments align, treating :params as wildcards. */
function samePathShape(a: string, b: string): boolean {
  const as = a.split('/').filter(Boolean);
  const bs = b.split('/').filter(Boolean);
  return (
    as.length === bs.length &&
    as.every((s, i) => s === bs[i] || s.startsWith(':') || bs[i].startsWith(':'))
  );
}

/** Tarjan SCC over file→file import edges; returns cycles (SCCs of size > 1). */
function importCycles(index: GraphIndex): string[][] {
  const files = index.graph.nodes.filter((n) => n.type === 'file').map((n) => n.id);
  let counter = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];

  const strongConnect = (v: string) => {
    idx.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const e of index.outEdges(v, ['imports'])) {
      const w = e.to;
      if (!idx.has(w)) {
        strongConnect(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, idx.get(w)!));
      }
    }
    if (low.get(v) === idx.get(v)) {
      const scc: string[] = [];
      for (;;) {
        const w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
        if (w === v) break;
      }
      if (scc.length > 1) cycles.push(scc.reverse());
    }
  };

  for (const f of files) if (!idx.has(f)) strongConnect(f);
  return cycles;
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
