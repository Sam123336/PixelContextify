import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v3';
import {
  deriveFeatures,
  loadFeatureConfig,
  renderFeature,
  renderFeatureList,
} from './features';
import { saveGraphHtml } from './html';
import { indexProject } from './indexer';
import {
  analyzeProject,
  extractUiCandidates,
  GraphIndex,
  matchUiElement,
  renderGraphDiff,
  renderProjectMap,
  renderTimeline,
  searchNodes,
} from './queries';
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
    'Build (or rebuild) the local Software Knowledge Graph for a TypeScript/React/Next.js ' +
      'or Flutter/Dart project (Dart support is beta). Parses components/widgets, ' +
      'routes, navigation, state, and API calls statically and ' +
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
        const modeNote =
          stats.mode === 'incremental'
            ? ` (incremental: re-parsed ${stats.reparsed}, reused ${stats.reused})`
            : '';
        const lines = [
          `Indexed **${stats.files} files** in ${stats.durationMs}ms${modeNote} → \`${file}\``,
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

          // APIs and contexts inside the blast radius (used by anything affected).
          const affectedIds = new Set([node.id, ...deps.map((d) => d.id)]);
          const blastApis = new Set<string>();
          const blastContexts = new Set<string>();
          for (const id of affectedIds) {
            for (const e of index.outEdges(id, ['calls'])) {
              blastApis.add(index.byId.get(e.to)?.name ?? e.to);
            }
            for (const e of index.outEdges(id, ['uses'])) {
              const t = index.byId.get(e.to);
              if (t?.type === 'context') blastContexts.add(t.name);
            }
          }

          const risk =
            routes.length >= 3 || deps.length >= 20
              ? 'High'
              : routes.length >= 1 || deps.length >= 6
                ? 'Medium'
                : 'Low';

          lines.push(
            `## ${node.type}: \`${node.id}\``,
            '',
            `**Affected:** ${byType('component').length} components · ` +
              `${byType('file').length} files · ${routes.length} routes · ` +
              `${byType('hook').length} hooks · ${blastContexts.size} contexts`,
            blastApis.size > 0
              ? `**APIs in blast radius:** ${[...blastApis].map((a) => `\`${a}\``).join(', ')}`
              : '',
            `**Regression risk:** ${risk}`,
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
    'match_screenshot',
    'Semantic screenshot ↔ code matching: map UI elements from a Contextify ' +
      'screenshot analysis to the components that implement them, including which ' +
      'routes/screens each match appears on. Pass either a single element ' +
      'description ("Orange Checkout Button") or the full markdown from ' +
      'analyze_screenshot to match every detected element at once. For the reverse ' +
      'direction ("where does GET /products appear visually?") use get_impact on the endpoint.',
    {
      projectDir: projectDirParam,
      element: z
        .string()
        .optional()
        .describe('One UI element description, e.g. "Orange Checkout Button".'),
      markdown: z
        .string()
        .optional()
        .describe('Full markdown output of analyze_screenshot — matches all detected elements.'),
    },
    async ({ projectDir, element, markdown }) => {
      try {
        if (!element && !markdown) {
          throw new Error('Provide either `element` or `markdown`.');
        }
        const { index, staleNote } = loadIndex(projectDir);
        const queries = element ? [element] : extractUiCandidates(markdown!);
        const lines = [staleNote + '# Screenshot → code matches', ''];
        let any = false;
        for (const q of queries) {
          const matches = matchUiElement(index, q);
          if (matches.length === 0) continue;
          any = true;
          lines.push(`### "${q}"`);
          for (const m of matches) {
            const routes =
              m.routes.length > 0
                ? ` — appears on: ${m.routes.map((r) => `\`${r}\``).join(', ')}`
                : '';
            lines.push(`- **${m.node.name}** (${m.node.type}) \`${m.node.id}\`${routes}`);
          }
          lines.push('');
        }
        if (!any) {
          lines.push(
            '_No graph nodes matched. The UI may be built from generic/library ' +
              'components — try search_graph with text from the element, or start ' +
              'from the route the screen belongs to._',
          );
        }
        return text(lines.join('\n'));
      } catch (err) {
        return errorText(err);
      }
    },
  );

  server.tool(
    'get_feature',
    'Feature Graph: reason about the project in features, not files. Without a ' +
      'feature name, lists all features (from contextify.features.json if present, ' +
      'otherwise auto-derived from route groups) with member counts and cross-feature ' +
      'shared nodes. With a name, returns the full dossier: routes, components, ' +
      'state, APIs, and entry points from outside the feature. Answers ' +
      '"explain Authentication" instead of "explain auth.ts".',
    {
      projectDir: projectDirParam,
      feature: z
        .string()
        .optional()
        .describe('Feature name from the list, e.g. "Checkout". Omit to list all features.'),
    },
    async ({ projectDir, feature }) => {
      try {
        const { index, staleNote } = loadIndex(projectDir);
        const loaded = loadFeatureConfig(projectDir);
        const config = loaded?.config ?? deriveFeatures(index);
        const source = loaded?.source ?? 'auto-derived from routes';
        if (!feature) {
          return text(staleNote + renderFeatureList(index, config, source));
        }
        const key = Object.keys(config).find((k) => k.toLowerCase() === feature.toLowerCase());
        if (!key) {
          return text(
            `${staleNote}No feature named \`${feature}\`. Available: ${Object.keys(config)
              .map((k) => `\`${k}\``)
              .join(', ')}`,
          );
        }
        return text(staleNote + renderFeature(index, key, config[key]));
      } catch (err) {
        return errorText(err);
      }
    },
  );

  server.tool(
    'graph_timeline',
    'Architecture timeline: chronological evolution of the project across all ' +
      'stored graph snapshots — which routes/components/APIs/state were added or ' +
      'removed at each step, tagged with dates and git commits. Answers ' +
      '"how did this architecture evolve over time?"',
    { projectDir: projectDirParam },
    async ({ projectDir }) => {
      try {
        const current = loadGraph(projectDir);
        if (!current) {
          throw new Error(`No graph found at ${graphDir(projectDir)}. Run index_project first.`);
        }
        const history = listSnapshots(projectDir)
          .reverse() // oldest first
          .map((name) => loadSnapshot(projectDir, name))
          .filter((g): g is ProjectGraph => !!g);
        return text(renderTimeline([...history, current]));
      } catch (err) {
        return errorText(err);
      }
    },
  );

  server.tool(
    'search_graph',
    'Search the Software Knowledge Graph by name — components, routes, files, or API ' +
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
    'analyze_project',
    'Smart analysis of an indexed project: architecture score (0-100) with a ' +
      'breakdown of circular imports, possibly-dead components/hooks, API routes ' +
      'never called from the UI, oversized components, and duplicate component ' +
      'names. Pure static graph analysis — fast, deterministic, no LLM involved.',
    { projectDir: projectDirParam },
    async ({ projectDir }) => {
      try {
        const { index, staleNote } = loadIndex(projectDir);
        return text(staleNote + analyzeProject(index).markdown);
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
  let graph = loadGraph(projectDir);
  if (!graph) {
    throw new Error(
      `No graph found at ${graphDir(projectDir)}. Run the index_project tool first.`,
    );
  }
  // Live context: if indexed files changed on disk, transparently re-index so
  // every answer reflects the current code — no manual refresh step.
  const stale = staleFileCount(graph as ProjectGraph);
  let staleNote = '';
  if (stale > 0) {
    const { graph: fresh } = indexProject(projectDir);
    saveGraph(fresh);
    saveGraphHtml(fresh);
    graph = fresh;
    staleNote = `> ♻️ ${stale} file(s) had changed — graph auto-refreshed before answering.\n\n`;
  }
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
