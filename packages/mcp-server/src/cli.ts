import * as path from 'node:path';
import { saveGraphHtml } from './graph/html';
import { indexProject } from './graph/indexer';
import {
  analyzeProject,
  GraphIndex,
  renderGraphDiff,
  renderProjectMap,
  searchNodes,
} from './graph/queries';
import {
  graphDir,
  listSnapshots,
  loadGraph,
  loadSnapshot,
  saveGraph,
  staleFileCount,
} from './graph/store';

const USAGE = `Contextify — software knowledge graph CLI

Usage: contextify-mcp <command> [args]        (no command → MCP stdio server)

  index   <dir>            Build/refresh the graph (+ graph.html) for a project
  map     <dir>            Route/component/API map with Mermaid navigation flow
  analyze <dir>            Architecture score + debt report
  impact  <dir> <target>   What depends on a component/file/route
  search  <dir> <query>    Find nodes by name and show their relationships
  diff    <dir> [snapshot] Compare current graph against a history snapshot
  help                     Show this help

The graph is stored in <dir>/.pixelcontextify/ — see docs/GRAPH-SPEC.md for the format.
`;

const COMMANDS = new Set(['index', 'map', 'analyze', 'impact', 'search', 'diff', 'help', '--help', '-h']);

/** Handle CLI invocation. Returns false when argv is not a CLI command (→ run MCP server). */
export function runCli(argv: string[]): boolean {
  const [cmd, ...rest] = argv;
  if (!cmd || !COMMANDS.has(cmd)) return false;

  try {
    dispatch(cmd, rest);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
  return true;
}

function dispatch(cmd: string, rest: string[]): void {
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(USAGE);
    return;
  }

  const dir = rest[0];
  if (!dir) throw new Error(`Missing <dir> argument.\n\n${USAGE}`);
  const root = path.resolve(dir);

  if (cmd === 'index') {
    const { graph, stats, warnings } = indexProject(root);
    const file = saveGraph(graph);
    const html = saveGraphHtml(graph);
    console.log(
      `Indexed ${stats.files} files in ${stats.durationMs}ms\n` +
        `  graph: ${file}\n  visualization: ${html}\n` +
        `  components=${stats.components} routes=${stats.routes} hooks=${stats.hooks} ` +
        `contexts=${stats.contexts} apis=${stats.apis} edges=${stats.edges}`,
    );
    for (const w of warnings) console.error(`warning: ${w}`);
    return;
  }

  const index = loadIndexOrThrow(root);

  switch (cmd) {
    case 'map':
      console.log(renderProjectMap(index));
      return;
    case 'analyze':
      console.log(analyzeProject(index).markdown);
      return;
    case 'impact': {
      const target = rest[1];
      if (!target) throw new Error('Usage: contextify-mcp impact <dir> <target>');
      console.log(renderImpact(index, target));
      return;
    }
    case 'search': {
      const query = rest[1];
      if (!query) throw new Error('Usage: contextify-mcp search <dir> <query>');
      const hits = searchNodes(index, query);
      if (hits.length === 0) {
        console.log(`No nodes match "${query}".`);
        return;
      }
      for (const hit of hits) {
        console.log(`${hit.node.type.padEnd(9)} ${hit.node.id}`);
        for (const r of hit.relations) console.log(`          ${r}`);
      }
      return;
    }
    case 'diff': {
      const names = listSnapshots(root);
      if (names.length === 0) {
        console.log('No history snapshots yet — re-index after code changes to create one.');
        return;
      }
      const name = rest[1] ?? names[0];
      const before = loadSnapshot(root, name);
      if (!before) {
        throw new Error(`Snapshot "${name}" not found. Available:\n${names.join('\n')}`);
      }
      console.log(renderGraphDiff(before, index.graph));
      return;
    }
  }
}

function loadIndexOrThrow(root: string): GraphIndex {
  const graph = loadGraph(root);
  if (!graph) {
    throw new Error(`No graph at ${graphDir(root)} — run: contextify-mcp index ${root}`);
  }
  const stale = staleFileCount(graph);
  if (stale > 0) {
    console.error(`warning: ${stale} indexed file(s) changed since last index — re-run index for fresh results.`);
  }
  return new GraphIndex(graph);
}

function renderImpact(index: GraphIndex, target: string): string {
  const resolved = index.resolve(target);
  if (resolved.length === 0) {
    return `No graph node matches "${target}" — try: contextify-mcp search <dir> ${target}`;
  }
  const lines: string[] = [];
  for (const node of resolved.slice(0, 3)) {
    const deps = index.dependents(node.id);
    const routes = deps.filter((d) => d.type === 'route');
    const risk =
      routes.length >= 3 || deps.length >= 20
        ? 'High'
        : routes.length >= 1 || deps.length >= 6
          ? 'Medium'
          : 'Low';
    lines.push(
      `# Impact of ${node.type} ${node.id}`,
      `Affected: ${deps.filter((d) => d.type === 'component').length} components · ` +
        `${deps.filter((d) => d.type === 'file').length} files · ${routes.length} routes`,
      `Regression risk: ${risk}`,
      '',
    );
    for (const d of deps) lines.push(`- ${d.type}: ${d.id}`);
    lines.push('');
  }
  if (resolved.length > 3) {
    lines.push(`(${resolved.length - 3} more matches omitted — pass a more specific target)`);
  }
  return lines.join('\n');
}
