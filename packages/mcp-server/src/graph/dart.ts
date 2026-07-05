import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import type { GraphEdge, GraphNode, ProjectGraph } from './types';

/**
 * Lightweight Dart/Flutter extractor (beta).
 *
 * Dart has no in-process TypeScript-compatible parser we can ship in a single
 * bundle, so this is a structured scanner, not a full AST: comments are
 * stripped string-aware, declarations are located by regex, and references are
 * attributed to the nearest enclosing class. That covers the structural bulk
 * of idiomatic Flutter code; exotic layouts may produce gaps.
 */

const WIDGET_BASES = new Set([
  'StatelessWidget',
  'StatefulWidget',
  'ConsumerWidget',
  'ConsumerStatefulWidget',
  'HookWidget',
  'HookConsumerWidget',
]);
const STATE_CONTAINER_BASES = ['ChangeNotifier', 'Cubit', 'Bloc', 'ValueNotifier', 'GetxController'];
const SKIP_DIRS = new Set([
  '.dart_tool', 'build', 'ios', 'android', 'macos', 'linux', 'windows', 'web', '.git', 'node_modules',
]);
const MAX_DART_FILES = 3_000;

export interface DartExtraction {
  files: ProjectGraph['files'];
  nodes: GraphNode[];
  edges: GraphEdge[];
  warnings: string[];
}

interface DartClass {
  name: string;
  /** node id this class's references are attributed to (State<X> → X's id). */
  attributeTo: string;
  offset: number;
}

interface DartFile {
  rel: string;
  /** comment-stripped source */
  text: string;
  classes: DartClass[];
  /** local declarations: name → node id */
  widgets: Map<string, string>;
  containers: Map<string, string>;
  providers: Map<string, string>;
  imports: string[];
}

export function extractDart(rootDir: string): DartExtraction | null {
  const root = path.resolve(rootDir);
  const warnings: string[] = [];
  const packageName = readPackageName(root);
  const dartPaths = findDartFiles(root);
  if (dartPaths.length === 0) return null;
  if (dartPaths.length > MAX_DART_FILES) {
    warnings.push(`Found ${dartPaths.length} Dart files; indexing only the first ${MAX_DART_FILES}.`);
    dartPaths.length = MAX_DART_FILES;
  }

  const files: ProjectGraph['files'] = {};
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const edgeSeen = new Set<string>();
  const addNode = (n: GraphNode) => {
    if (!nodes.has(n.id)) nodes.set(n.id, n);
  };
  const addEdge = (e: GraphEdge) => {
    const key = `${e.from}|${e.kind}|${e.to}`;
    if (!edgeSeen.has(key)) {
      edgeSeen.add(key);
      edges.push(e);
    }
  };

  // ---- pass 1: declarations ------------------------------------------------
  const parsed: DartFile[] = [];
  const widgetsByName = new Map<string, string>(); // global widget name → id
  const containersByName = new Map<string, string>();
  const providersByName = new Map<string, string>();

  for (const abs of dartPaths) {
    const rel = path.relative(root, abs).split(path.sep).join('/');
    const raw = readFileSync(abs, 'utf8');
    files[rel] = { hash: createHash('sha1').update(raw).digest('hex') };
    addNode({ id: rel, type: 'file', name: path.basename(rel), file: rel });

    const text = stripComments(raw);
    const df: DartFile = {
      rel, text, classes: [],
      widgets: new Map(), containers: new Map(), providers: new Map(),
      imports: [],
    };

    for (const m of text.matchAll(/import\s+'([^']+)'/g)) {
      const resolved = resolveDartImport(m[1], rel, packageName);
      if (resolved) df.imports.push(resolved);
    }

    for (const m of text.matchAll(/(?:abstract\s+)?class\s+(\w+)\s+extends\s+([\w<>, ]+)/g)) {
      const [, name, baseRaw] = m;
      const base = baseRaw.trim().split(/[<\s]/)[0];
      const id = `${rel}#${name}`;
      if (WIDGET_BASES.has(base)) {
        df.widgets.set(name, id);
        widgetsByName.set(name, id);
        df.classes.push({ name, attributeTo: id, offset: m.index! });
      } else if (base === 'State') {
        // class _XState extends State<X> → attribute to widget X
        const target = baseRaw.match(/State<\s*(\w+)/)?.[1];
        const targetId = target ? `${rel}#${target}` : id;
        df.classes.push({ name, attributeTo: targetId, offset: m.index! });
      } else if (STATE_CONTAINER_BASES.includes(base)) {
        df.containers.set(name, id);
        containersByName.set(name, id);
        df.classes.push({ name, attributeTo: id, offset: m.index! });
      } else {
        df.classes.push({ name, attributeTo: rel, offset: m.index! });
      }
    }

    // Riverpod-style providers: final cartProvider = StateNotifierProvider<...>(...)
    // (negative lookahead: `Provider.of<X>(ctx)` is usage, not a declaration)
    for (const m of text.matchAll(/final\s+(\w+)\s*=\s*(?:\w+\.)?\w*Provider\b(?!\.of\b)/g)) {
      const id = `${rel}#${m[1]}`;
      df.providers.set(m[1], id);
      providersByName.set(m[1], id);
    }

    df.classes.sort((a, b) => a.offset - b.offset);
    parsed.push(df);
  }

  for (const df of parsed) {
    for (const [name, id] of df.widgets) {
      const cls = df.classes.find((c) => c.attributeTo === id && c.name === name);
      addNode({ id, type: 'component', name, file: df.rel, ...(cls ? { loc: locOf(df, cls) } : {}) });
      addEdge({ from: df.rel, to: id, kind: 'defines' });
    }
    for (const [name, id] of df.containers) {
      addNode({ id, type: 'context', name, file: df.rel });
      addEdge({ from: df.rel, to: id, kind: 'defines' });
    }
    for (const [name, id] of df.providers) {
      addNode({ id, type: 'context', name, file: df.rel });
      addEdge({ from: df.rel, to: id, kind: 'defines' });
    }
  }

  // ---- pass 2: routes, references ------------------------------------------
  const declaredRoutes: string[] = [];
  const routeDecls: { path: string; widget?: string; file: string }[] = [];
  for (const df of parsed) {
    // GoRoute(path: '/x', ... SomeWidget(
    for (const m of df.text.matchAll(/GoRoute\s*\(\s*path:\s*'([^']+)'([\s\S]{0,500}?)(?=GoRoute\s*\(|$)/g)) {
      const widget = m[2].match(/(?:builder|pageBuilder)\s*:[\s\S]*?\b([A-Z]\w*)\s*\(/)?.[1];
      routeDecls.push({ path: m[1], widget, file: df.rel });
    }
    // routes: { '/x': (context) => XScreen(...) }
    for (const m of df.text.matchAll(/'(\/[^']*)'\s*:\s*\(\s*\w+\s*\)\s*=>\s*(?:const\s+)?([A-Z]\w*)\s*\(/g)) {
      routeDecls.push({ path: m[1], widget: m[2], file: df.rel });
    }
  }
  for (const r of routeDecls) {
    const routePath = r.path.startsWith('/') ? r.path : '/' + r.path;
    declaredRoutes.push(routePath);
    const routeId = `route:${routePath}`;
    addNode({ id: routeId, type: 'route', name: routePath, file: r.file });
    const widgetId = r.widget ? widgetsByName.get(r.widget) : undefined;
    if (widgetId) addEdge({ from: routeId, to: widgetId, kind: 'routes_to' });
  }
  const canonical = (nav: string): string => {
    if (declaredRoutes.includes(nav)) return nav;
    const segs = nav.split('/').filter(Boolean);
    const hits = declaredRoutes.filter((d) => {
      const ds = d.split('/').filter(Boolean);
      return ds.length === segs.length &&
        ds.every((s, i) => s === segs[i] || s.startsWith(':') || segs[i].startsWith(':'));
    });
    return hits.length === 1 ? hits[0] : nav;
  };

  for (const df of parsed) {
    for (const target of new Set(df.imports)) {
      if (nodes.has(target)) addEdge({ from: df.rel, to: target, kind: 'imports' });
    }

    const owner = (offset: number): string => {
      let current = df.rel;
      for (const c of df.classes) {
        if (c.offset <= offset) current = c.attributeTo;
        else break;
      }
      return nodes.has(current) ? current : df.rel;
    };

    // Widget usage → renders (only names declared as widgets in this project).
    for (const m of df.text.matchAll(/\b([A-Z]\w*)\s*(?:\.\w+)?\(/g)) {
      const targetId = widgetsByName.get(m[1]);
      if (!targetId) continue;
      const from = owner(m.index!);
      if (from !== targetId) addEdge({ from, to: targetId, kind: 'renders' });
    }

    // Navigation: Navigator.pushNamed(ctx, '/x'), context.go('/x'), Get.toNamed('/x')
    for (const m of df.text.matchAll(
      /(?:pushNamed(?:AndRemoveUntil)?\s*\(\s*[^,)]*,|context\.(?:go|push|pushReplacement|replace)\s*\(|Get\.(?:toNamed|offNamed)\s*\()\s*'([^']+)'/g,
    )) {
      if (!m[1].startsWith('/')) continue;
      const routePath = canonical(m[1].split(/[?#]/)[0]);
      addNode({ id: `route:${routePath}`, type: 'route', name: routePath });
      addEdge({ from: owner(m.index!), to: `route:${routePath}`, kind: 'navigates_to' });
    }

    // API calls: http.get(Uri.parse('...')), dio.post('...'), client.get('...')
    for (const m of df.text.matchAll(
      /\b(?:http|dio|client|api|_dio|_client|_api)\.(get|post|put|patch|delete)\w*\s*\(\s*(?:Uri\.parse\s*\(\s*)?'([^']+)'/gi,
    )) {
      const url = toPathname(m[2]);
      if (!url) continue;
      const method = m[1].toUpperCase();
      const apiId = `api:${method} ${url}`;
      addNode({ id: apiId, type: 'api', name: `${method} ${url}` });
      addEdge({ from: owner(m.index!), to: apiId, kind: 'calls' });
    }

    // State usage: ref.watch(xProvider), Provider.of<X>(ctx), context.watch<X>()
    for (const m of df.text.matchAll(/\bref\.(?:watch|read|listen)\s*\(\s*(\w+)/g)) {
      const id = providersByName.get(m[1]);
      if (id) addEdge({ from: owner(m.index!), to: id, kind: 'uses' });
    }
    for (const m of df.text.matchAll(/(?:Provider\.of|context\.watch|context\.read|BlocProvider\.of)\s*<\s*(\w+)/g)) {
      const id = containersByName.get(m[1]);
      if (id) addEdge({ from: owner(m.index!), to: id, kind: 'uses' });
    }
  }

  return { files, nodes: [...nodes.values()], edges, warnings };
}

function locOf(df: DartFile, cls: DartClass): number {
  const next = df.classes.find((c) => c.offset > cls.offset);
  const chunk = df.text.slice(cls.offset, next ? next.offset : undefined);
  return chunk.split('\n').length;
}

function readPackageName(root: string): string | null {
  const pubspec = path.join(root, 'pubspec.yaml');
  if (!existsSync(pubspec)) return null;
  return readFileSync(pubspec, 'utf8').match(/^name:\s*(\S+)/m)?.[1] ?? null;
}

/** package:app/x.dart → lib/x.dart; relative imports resolve against the file's dir. */
function resolveDartImport(spec: string, fromRel: string, packageName: string | null): string | null {
  if (packageName && spec.startsWith(`package:${packageName}/`)) {
    return 'lib/' + spec.slice(`package:${packageName}/`.length);
  }
  if (spec.startsWith('package:') || spec.startsWith('dart:')) return null;
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
}

function findDartFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith('.') || SKIP_DIRS.has(entry)) continue;
      const abs = path.join(dir, entry);
      const st = statSync(abs);
      if (st.isDirectory()) walk(abs);
      else if (entry.endsWith('.dart') && !entry.endsWith('.g.dart') && !entry.endsWith('.freezed.dart')) {
        out.push(abs);
      }
    }
  };
  walk(root);
  return out.sort();
}

/** Remove // and /* *\/ comments without touching string contents. */
export function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let mode: 'code' | 'line' | 'block' | 'sq' | 'dq' = 'code';
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && next === '/') { mode = 'line'; i += 2; continue; }
      if (c === '/' && next === '*') { mode = 'block'; i += 2; continue; }
      if (c === "'") mode = 'sq';
      else if (c === '"') mode = 'dq';
      out += c;
    } else if (mode === 'line') {
      if (c === '\n') { mode = 'code'; out += c; }
    } else if (mode === 'block') {
      if (c === '*' && next === '/') { mode = 'code'; i += 2; continue; }
      if (c === '\n') out += c; // keep line numbers stable
    } else {
      // inside a string: copy verbatim, honoring escapes
      if (c === '\\') { out += c + (next ?? ''); i += 2; continue; }
      if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"')) mode = 'code';
      out += c;
    }
    i++;
  }
  return out;
}

function toPathname(raw: string): string | undefined {
  if (raw.startsWith('/')) return raw.split(/[?#]/)[0];
  try {
    return new URL(raw).pathname;
  } catch {
    return undefined;
  }
}
