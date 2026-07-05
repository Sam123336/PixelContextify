import { GraphIndex } from './queries';
import type { GraphNode } from './types';

/**
 * "Explain Visually": multi-diagram dossier for any graph node, generated
 * from the Software Knowledge Graph itself — navigation-in, composition,
 * data flow, and a state-placement decision tree with the branch this
 * project actually needs highlighted. Diagrams are Mermaid (renders inline
 * in Claude Code / GitHub); every box is a real node from this codebase.
 */

const MAX_DIAGRAM_NODES = 22;
const DEPTH = 3;

export function renderExplainVisually(index: GraphIndex, target: string): string {
  const resolved = index.resolve(target);
  if (resolved.length === 0) {
    return `No graph node matches \`${target}\` — try search_graph first.`;
  }
  const node = resolved[0];
  const lines: string[] = [`# ${node.name} — visual explanation`, ''];
  lines.push(`_${node.type}${node.file ? ` · ${node.file}` : ''}_`, '');

  const sections: (string | null)[] =
    node.type === 'api'
      ? [apiFlow(index, node), recommendations(index, node)]
      : [
          navigationIn(index, node),
          composition(index, node),
          dataFlow(index, node),
          statePlacement(index, node),
          recommendations(index, node),
        ];
  for (const s of sections) if (s) lines.push(s, '');
  return lines.join('\n');
}

// --- 🗺️ how users reach it -------------------------------------------------

function navigationIn(index: GraphIndex, node: GraphNode): string | null {
  const routes =
    node.type === 'route'
      ? [node]
      : index
          .routes()
          .filter((r) => r.file && index.routeSubtree(r.id).some((n) => n.id === node.id))
          .slice(0, 3);
  if (routes.length === 0) return null;

  const m = new MermaidBuilder('flowchart LR');
  for (const route of routes) {
    for (const e of index.inEdges(route.id, ['navigates_to']).slice(0, 5)) {
      const from = index.byId.get(e.from);
      if (from) m.edge(from, route, 'navigates');
    }
    if (node.type !== 'route') m.edge(route, node, 'renders');
  }
  if (m.empty()) return null;
  return `## 🗺️ How users reach it\n\n${m.render()}`;
}

// --- 📦 what it is composed of ---------------------------------------------

function composition(index: GraphIndex, node: GraphNode): string | null {
  const start =
    node.type === 'route'
      ? index.outEdges(node.id, ['routes_to']).map((e) => e.to)
      : [node.id];
  const m = new MermaidBuilder('flowchart TD');
  const seen = new Set(start);
  let frontier = start;
  for (let d = 0; d < DEPTH && frontier.length > 0 && m.size() < MAX_DIAGRAM_NODES; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      const parent = index.byId.get(id);
      if (!parent) continue;
      for (const e of index.outEdges(id, ['renders'])) {
        const child = index.byId.get(e.to);
        if (!child || m.size() >= MAX_DIAGRAM_NODES) continue;
        m.edge(parent, child);
        if (!seen.has(e.to)) {
          seen.add(e.to);
          next.push(e.to);
        }
      }
    }
    frontier = next;
  }
  if (m.empty()) return null;
  return `## 📦 What it's composed of\n\n${m.render()}`;
}

// --- 🔄 where data comes from and goes -------------------------------------

function dataFlow(index: GraphIndex, node: GraphNode): string | null {
  // Subtree of interest: the node plus what it renders.
  const ids = new Set<string>([node.id]);
  if (node.type === 'route') {
    for (const n of index.routeSubtree(node.id)) ids.add(n.id);
  } else {
    let frontier = [node.id];
    for (let d = 0; d < DEPTH; d++) {
      const next: string[] = [];
      for (const id of frontier)
        for (const e of index.outEdges(id, ['renders']))
          if (!ids.has(e.to)) {
            ids.add(e.to);
            next.push(e.to);
          }
      frontier = next;
    }
  }

  // Data direction: API → hook → context/component → child (props flow down).
  const m = new MermaidBuilder('flowchart LR');
  for (const id of ids) {
    const n = index.byId.get(id);
    if (!n) continue;
    for (const e of index.outEdges(id, ['uses'])) {
      const source = index.byId.get(e.to);
      if (!source) continue;
      m.edge(source, n, source.type === 'context' ? 'state' : 'hook');
      // Where does the hook get its data? (hook → api / context)
      for (const he of index.outEdges(e.to, ['calls'])) {
        const api = index.byId.get(he.to);
        if (api) m.edge(api, source, 'data');
      }
      for (const he of index.outEdges(e.to, ['uses'])) {
        const ctx = index.byId.get(he.to);
        if (ctx) m.edge(ctx, source);
      }
    }
    for (const e of index.outEdges(id, ['calls'])) {
      const api = index.byId.get(e.to);
      if (api) m.edge(api, n, 'data');
    }
  }
  if (m.empty()) return null;
  return `## 🔄 Where data comes from\n\n${m.render()}`;
}

// --- 🌐 api reverse flow ----------------------------------------------------

function apiFlow(index: GraphIndex, api: GraphNode): string {
  const m = new MermaidBuilder('flowchart LR');
  for (const e of index.inEdges(api.id, ['calls']).slice(0, 8)) {
    const caller = index.byId.get(e.from);
    if (!caller) continue;
    m.edge(api, caller, 'data');
    for (const route of index.dependents(caller.id).filter((d) => d.type === 'route').slice(0, 3)) {
      m.edge(caller, route, 'shown on');
    }
  }
  return `## 🌐 Where this API's data appears\n\n${m.render()}`;
}

// --- 🧠 state placement decision --------------------------------------------

function statePlacement(index: GraphIndex, node: GraphNode): string | null {
  // Analyze the node itself if it IS state, else the state it consumes.
  const stateNodes =
    node.type === 'context' || node.type === 'hook'
      ? [node]
      : index
          .outEdges(node.id, ['uses'])
          .map((e) => index.byId.get(e.to))
          .filter((n): n is GraphNode => !!n && n.type === 'context')
          .slice(0, 2);
  if (stateNodes.length === 0) return null;

  const parts: string[] = ['## 🧠 State placement — is it in the right place?'];
  let treeRendered = false;
  for (const state of stateNodes) {
    // Speak the project's language: Flutter widgets get Flutter advice.
    const dart = (state.file ?? node.file ?? '').endsWith('.dart');
    const terms = dart
      ? {
          unit: 'widget',
          local: 'setState() inside the widget',
          lift: 'Lift state up — pass via constructor',
          global: 'Provider / Riverpod / Bloc',
        }
      : {
          unit: 'component',
          local: 'useState() in the component',
          lift: 'Lift state to common parent',
          global: 'Context / store',
        };

    const consumers = index
      .inEdges(state.id, ['uses'])
      .map((e) => index.byId.get(e.from))
      .filter((n): n is GraphNode => !!n);
    const routes = new Set(
      index.dependents(state.id).filter((d) => d.type === 'route').map((d) => d.name),
    );
    const branch =
      consumers.length <= 1 ? 'local' : routes.size <= 1 ? 'lift' : 'context';
    const verdictText =
      branch === 'local'
        ? `only ${consumers.length} consumer — plain \`${dart ? 'setState()' : 'useState()'}\` in that ${terms.unit} is enough`
        : branch === 'lift'
          ? `${consumers.length} consumers but all within one ${dart ? 'screen' : 'route'} — lift state to their common parent ${terms.unit}`
          : `${consumers.length} consumers across ${routes.size} ${dart ? 'screens' : 'routes'} — ${terms.global} is justified`;

    const hl = (b: string) => (b === branch ? ':::chosen' : '');
    if (!treeRendered) {
      treeRendered = true;
      parts.push(
        '',
        '```mermaid',
        'flowchart TD',
        `  Q1{"Used by more than one ${terms.unit}?"}`,
        `  L["${terms.local}"]${hl('local')}`,
        `  Q2{"Consumers span multiple ${dart ? 'screens' : 'routes'}?"}`,
        `  P["${terms.lift}"]${hl('lift')}`,
        `  C["${terms.global}"]${hl('context')}`,
        '  Q1 -->|no| L',
        '  Q1 -->|yes| Q2',
        '  Q2 -->|no| P',
        '  Q2 -->|yes| C',
        '  classDef chosen fill:#2ea04326,stroke:#2ea043,stroke-width:2px',
        '```',
      );
    }
    parts.push(
      '',
      `**\`${state.name}\` today:** consumed by ${consumers
        .slice(0, 6)
        .map((c) => `\`${c.name}\``)
        .join(', ')}${consumers.length > 6 ? ` +${consumers.length - 6} more` : ''}` +
        (routes.size > 0 ? ` across ${[...routes].map((r) => `\`${r}\``).join(', ')}` : ''),
      `**Verdict:** ${verdictText}.`,
    );
  }
  return parts.join('\n');
}

// --- 💡 recommendations -----------------------------------------------------

function recommendations(index: GraphIndex, node: GraphNode): string | null {
  const recs: string[] = [];
  if ((node.loc ?? 0) >= 150) {
    recs.push(`Split it — ${node.loc} lines is past the healthy threshold (run \`what_if split ${node.name}\`).`);
  }
  const renderers = index.inEdges(node.id, ['renders', 'routes_to']).length;
  if (renderers >= 5) {
    recs.push(`High blast radius — rendered from ${renderers} places; changes here need the full affected-routes list (\`get_impact\`).`);
  }
  if (node.type === 'component' && renderers === 0 && index.inEdges(node.id).length <= 1) {
    recs.push('Nothing renders this component — possibly dead code (verify barrel re-exports before deleting).');
  }
  const apiCount = index.outEdges(node.id, ['calls']).length;
  if (apiCount >= 3) {
    const home = (node.file ?? '').endsWith('.dart') ? 'a repository/service class' : 'a hook or service';
    recs.push(`Calls ${apiCount} APIs directly — consider consolidating fetches into ${home} so loading and error states live in one place.`);
  }
  if (recs.length === 0) return null;
  return `## 💡 Recommendations for this project\n\n${recs.map((r) => `- ${r}`).join('\n')}`;
}

// --- mermaid builder ---------------------------------------------------------

const TYPE_SHAPE: Record<string, [string, string]> = {
  route: ['([', '])'],
  api: ['[(', ')]'],
  context: ['{{', '}}'],
  hook: ['{{', '}}'],
  component: ['[', ']'],
  file: ['[', ']'],
};

class MermaidBuilder {
  private readonly declared = new Set<string>();
  private readonly edges = new Set<string>();
  private readonly lines: string[] = [];

  constructor(private readonly header: string) {}

  edge(from: GraphNode, to: GraphNode, label?: string): void {
    this.declare(from);
    this.declare(to);
    const key = `${from.id}|${to.id}|${label ?? ''}`;
    if (this.edges.has(key)) return;
    this.edges.add(key);
    const arrow = label ? `-->|${label}|` : '-->';
    this.lines.push(`  ${mid(from.id)} ${arrow} ${mid(to.id)}`);
  }

  private declare(n: GraphNode): void {
    if (this.declared.has(n.id)) return;
    this.declared.add(n.id);
    const [open, close] = TYPE_SHAPE[n.type] ?? ['[', ']'];
    this.lines.unshift(`  ${mid(n.id)}${open}"${n.name.replace(/"/g, "'")}"${close}`);
  }

  size(): number {
    return this.declared.size;
  }
  empty(): boolean {
    return this.edges.size === 0;
  }
  render(): string {
    return ['```mermaid', this.header, ...this.lines, '```'].join('\n');
  }
}

function mid(id: string): string {
  return 'n' + id.replace(/[^A-Za-z0-9]/g, '_');
}
