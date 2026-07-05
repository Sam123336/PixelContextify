import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v3';
import { saveGraphHtml } from './html';
import { indexProject } from './indexer';
import { GraphIndex, renderGraphDiff, renderProjectMap, searchNodes } from './queries';
import {
  graphDir,
  listSnapshots,
  loadGraph,
  loadSnapshot,
  saveGraph,
  staleFileCount,
} from './store';
import type { ProjectGraph } from './types';

const projectDirParam = z
  .string()
  .min(1)
  .describe('Absolute path to the project root (the directory containing package.json).');

export function registerGraphTools(server: McpServer): void {
  server.tool(
    'index_project',
    'Build (or rebuild) the local code knowledge graph for a TypeScript/React/Next.js ' +
      'project. Parses components, routes, navigation, and API calls with ts-morph and ' +
      'stores the graph in <project>/.pixelcontextify/graph.json, along with an ' +
      'interactive HTML visualization at .pixelcontextify/graph.html the user can ' +
      'open in a browser. Everything runs locally — no code leaves the machine. Run ' +
      'this once before using the other graph tools, and re-run after code changes.',
    { projectDir: projectDirParam },
    async ({ projectDir }) => {
      try {
        const { graph, stats, warnings } = indexProject(projectDir);
        const file = saveGraph(graph);
        const html = saveGraphHtml(graph);
        const lines = [
          `Indexed **${stats.files} files** in ${stats.durationMs}ms → \`${file}\``,
          '',
          `🕸 Interactive visualization: \`${html}\` — open it in a browser.`,
          '',
          `- components: ${stats.components}`,
          `- routes: ${stats.routes}`,
          `- hooks: ${stats.hooks}`,
          `- contexts: ${stats.contexts}`,
          `- API endpoints: ${stats.apis}`,
          `- edges: ${stats.edges}`,
        ];
        if (warnings.length > 0) {
          lines.push('', ...warnings.map((w) => `⚠️ ${w}`));
        }
        return text(lines.join('\n'));
      } catch (err) {
        return errorText(err);
      }
    },
  );

  server.tool(
    'get_project_map',
    'Return a markdown map of an indexed project: every route with its component tree ' +
      'and API calls, plus a Mermaid diagram of route-to-route navigation. ' +
      'Requires index_project to have been run first.',
    { projectDir: projectDirParam },
    async ({ projectDir }) => {
      try {
        const { index, staleNote } = loadIndex(projectDir);
        return text(staleNote + renderProjectMap(index));
      } catch (err) {
        return errorText(err);
      }
    },
  );

  server.tool(
    'get_impact',
    'Impact analysis: given a component name, file path, or route, list everything that ' +
      'transitively depends on it — affected components, files, routes, and API call ' +
      'sites. Use before modifying or deleting code to understand regression risk.',
    {
      projectDir: projectDirParam,
      target: z
        .string()
        .min(1)
        .describe(
          'What you plan to change: a component name ("CheckoutForm"), relative file ' +
            'path ("src/components/CheckoutForm.tsx"), or route ("/checkout").',
        ),
    },
    async ({ projectDir, target }) => {
      try {
        const { index, staleNote } = loadIndex(projectDir);
        const resolved = index.resolve(target);
        if (resolved.length === 0) {
          return text(
            `${staleNote}No graph node matches \`${target}\`. Try search_graph to find the right name.`,
          );
        }
        const lines: string[] = [staleNote + `# Impact of changing \`${target}\``, ''];
        for (const node of resolved.slice(0, 3)) {
          const deps = index.dependents(node.id);
          const byType = (t: string) => deps.filter((d) => d.type === t);
          const routes = byType('route');
          lines.push(
            `## ${node.type}: \`${node.id}\``,
            '',
            `**${deps.length} dependents** — ` +
              `${byType('component').length} components, ${byType('file').length} files, ${routes.length} routes`,
            '',
          );
          if (routes.length > 0) {
            lines.push('**Affected routes (regression risk):**');
            lines.push(...routes.map((r) => `- \`${r.name}\``), '');
          }
          const others = deps.filter((d) => d.type !== 'route').slice(0, 40);
          if (others.length > 0) {
            lines.push('**Dependents:**');
            lines.push(...others.map((d) => `- ${d.type}: \`${d.id}\``));
            if (deps.length > others.length + routes.length) {
              lines.push(`- …and ${deps.length - others.length - routes.length} more`);
            }
            lines.push('');
          }
        }
        if (resolved.length > 3) {
          lines.push(`_${resolved.length - 3} more matches omitted — pass a more specific target._`);
        }
        return text(lines.join('\n'));
      } catch (err) {
        return errorText(err);
      }
    },
  );

  server.tool(
    'search_graph',
    'Search the project knowledge graph by name — components, routes, files, or API ' +
      'endpoints — and see how each match connects to the rest of the codebase. ' +
      'Useful for mapping UI elements from a screenshot analysis to the code that ' +
      'renders them (e.g. search for the component or button name Contextify identified).',
    {
      projectDir: projectDirParam,
      query: z.string().min(1).describe('Name or fragment, e.g. "checkout", "ProductCard".'),
    },
    async ({ projectDir, query }) => {
      try {
        const { index, staleNote } = loadIndex(projectDir);
        const hits = searchNodes(index, query);
        if (hits.length === 0) {
          return text(`${staleNote}No nodes match \`${query}\`.`);
        }
        const lines = [staleNote + `# Matches for \`${query}\``, ''];
        for (const hit of hits) {
          lines.push(`- **${hit.node.name}** (${hit.node.type}) — \`${hit.node.id}\``);
          for (const relation of hit.relations) {
            lines.push(`    - ${relation}`);
          }
        }
        return text(lines.join('\n'));
      } catch (err) {
        return errorText(err);
      }
    },
  );

  server.tool(
    'graph_diff',
    'Temporal graph: compare the current knowledge graph against an earlier snapshot ' +
      '(snapshots are archived automatically each time index_project detects changes). ' +
      'Shows added/removed routes, components, hooks, contexts and APIs, plus which ' +
      'components became more or less coupled. Answers "what changed architecturally?"',
    {
      projectDir: projectDirParam,
      snapshot: z
        .string()
        .optional()
        .describe(
          'Snapshot filename from .pixelcontextify/history/ to compare against. ' +
            'Omit to compare against the most recent snapshot.',
        ),
    },
    async ({ projectDir, snapshot }) => {
      try {
        const current = loadGraph(projectDir);
        if (!current) {
          throw new Error(`No graph found at ${graphDir(projectDir)}. Run index_project first.`);
        }
        const names = listSnapshots(projectDir);
        if (names.length === 0) {
          return text(
            'No history snapshots yet. Snapshots are created automatically when ' +
              'index_project is re-run after the code has changed — index now, make ' +
              'changes, index again, then diff.',
          );
        }
        const name = snapshot ?? names[0];
        const before = loadSnapshot(projectDir, name);
        if (!before) {
          return text(
            `Snapshot \`${name}\` not found. Available snapshots (newest first):\n` +
              names.map((n) => `- \`${n}\``).join('\n'),
          );
        }
        return text(renderGraphDiff(before, current));
      } catch (err) {
        return errorText(err);
      }
    },
  );
}

function loadIndex(projectDir: string): { index: GraphIndex; staleNote: string } {
  const graph = loadGraph(projectDir);
  if (!graph) {
    throw new Error(
      `No graph found at ${graphDir(projectDir)}. Run the index_project tool first.`,
    );
  }
  const stale = staleFileCount(graph as ProjectGraph);
  const staleNote =
    stale > 0
      ? `> ⚠️ ${stale} indexed file(s) changed since the last index_project run — results may be outdated.\n\n`
      : '';
  return { index: new GraphIndex(graph), staleNote };
}

function text(body: string) {
  return { content: [{ type: 'text' as const, text: body }] };
}

function errorText(err: unknown) {
  return {
    isError: true,
    content: [
      { type: 'text' as const, text: err instanceof Error ? err.message : String(err) },
    ],
  };
}
