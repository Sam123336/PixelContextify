import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import {
  Node,
  Project,
  SyntaxKind,
  type CallExpression,
  type JsxOpeningElement,
  type JsxSelfClosingElement,
  type SourceFile,
} from 'ts-morph';
import { extractDart } from './dart';
import { loadGraph } from './store';
import type {
  GraphEdge,
  GraphNode,
  IndexStats,
  ProjectGraph,
  StoredFileSymbols,
} from './types';

const TS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage']);
const MAX_FILES = 5_000;
/** Above this fraction of dirty files a full rebuild is cheaper than incremental. */
const INCREMENTAL_MAX_RATIO = 0.4;

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head'] as const;

interface FileSymbols {
  /** component name → node id */
  components: Map<string, string>;
  /** hook name (useX) → node id */
  hooks: Map<string, string>;
  /** context variable name → node id */
  contexts: Map<string, string>;
  /** node id → declaration size in lines */
  loc: Map<string, number>;
  defaultId?: string;
}

interface DiscoveredFile {
  rel: string;
  abs: string;
  hash: string;
}

export interface IndexResult {
  graph: ProjectGraph;
  stats: IndexStats;
  warnings: string[];
}

export interface IndexOptions {
  /** Force a full rebuild even when an incremental update would be possible. */
  force?: boolean;
}

export function indexProject(rootDir: string, opts: IndexOptions = {}): IndexResult {
  const started = Date.now();
  const root = path.resolve(rootDir);
  const warnings: string[] = [];

  let discovered = discoverTsFiles(root);
  if (discovered.length > MAX_FILES) {
    warnings.push(
      `Project has ${discovered.length} source files; indexing only the first ${MAX_FILES}.`,
    );
    discovered = discovered.slice(0, MAX_FILES);
  }
  const currentRels = new Set(discovered.map((f) => f.rel));

  // ---- context memory: decide what actually needs re-parsing -------------
  const prev = opts.force ? null : safeLoadPrevious(root);
  let mode: IndexStats['mode'] = 'full';
  let parseSet = currentRels;
  if (prev?.symbols) {
    const dirty = new Set<string>();
    const invalidTargets = new Set<string>();
    for (const f of discovered) {
      const before = prev.files[f.rel];
      if (!before) {
        dirty.add(f.rel); // new file
      } else if (before.hash !== f.hash) {
        dirty.add(f.rel);
        invalidTargets.add(f.rel);
      }
    }
    for (const rel of Object.keys(prev.files)) {
      if (!rel.endsWith('.dart') && !currentRels.has(rel)) invalidTargets.add(rel); // deleted
    }
    // A changed/deleted file invalidates every file that imports it: their
    // renders/uses resolution depends on the target's symbol table.
    for (const e of prev.edges) {
      if (e.kind === 'imports' && invalidTargets.has(e.to) && currentRels.has(e.from)) {
        dirty.add(e.from);
      }
    }
    if (dirty.size <= discovered.length * INCREMENTAL_MAX_RATIO) {
      mode = 'incremental';
      parseSet = dirty;
    }
  }
  const keep = new Set([...currentRels].filter((r) => !parseSet.has(r)));

  // ---- sinks ---------------------------------------------------------------
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const edgeSeen = new Set<string>();
  const files: ProjectGraph['files'] = {};
  const symbolsOut: Record<string, StoredFileSymbols> = {};

  const addNode = (node: GraphNode) => {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  };
  const addEdge = (edge: GraphEdge) => {
    const key = `${edge.from}|${edge.kind}|${edge.to}`;
    if (edgeSeen.has(key)) return;
    edgeSeen.add(key);
    edges.push(edge);
  };

  for (const f of discovered) files[f.rel] = { hash: f.hash };

  // ---- carry over everything owned by clean files --------------------------
  if (mode === 'incremental' && prev) {
    const prevById = new Map(prev.nodes.map((n) => [n.id, n]));
    for (const n of prev.nodes) {
      const owner = nodeOwnerFile(n);
      if (owner && keep.has(owner)) addNode(n);
    }
    for (const e of prev.edges) {
      const owner = edgeOwnerFile(e, prevById);
      if (owner && keep.has(owner)) addEdge(e);
    }
    for (const rel of keep) {
      if (prev.symbols![rel]) symbolsOut[rel] = prev.symbols![rel];
    }
  }

  // ---- parse the dirty set --------------------------------------------------
  const freshSymbols = new Map<string, FileSymbols>();
  const parsed: { sf: SourceFile; rel: string }[] = [];
  if (parseSet.size > 0) {
    const tsConfigPath = path.join(root, 'tsconfig.json');
    const project = new Project({
      ...(existsSync(tsConfigPath) ? { tsConfigFilePath: tsConfigPath } : {}),
      skipAddingFilesFromTsConfig: true,
      compilerOptions: { allowJs: true },
    });
    for (const f of discovered) {
      if (parseSet.has(f.rel)) {
        parsed.push({ sf: project.addSourceFileAtPath(f.abs), rel: f.rel });
      }
    }
  }

  const lookupSymbols = (rel: string): FileSymbols | undefined => {
    const fresh = freshSymbols.get(rel);
    if (fresh) return fresh;
    const stored = symbolsOut[rel];
    return stored ? thawSymbols(stored) : undefined;
  };

  // Phase 1: symbol declarations, routes, API route handlers.
  for (const { sf, rel } of parsed) {
    addNode({ id: rel, type: 'file', name: path.basename(rel), file: rel });

    const symbols = collectSymbols(sf, rel);
    freshSymbols.set(rel, symbols);
    symbolsOut[rel] = freezeSymbols(symbols);

    for (const [name, id] of symbols.components) {
      addNode({
        id,
        type: 'component',
        name,
        file: rel,
        ...(symbols.defaultId === id ? { isDefaultExport: true } : {}),
        ...(symbols.loc.has(id) ? { loc: symbols.loc.get(id) } : {}),
      });
      addEdge({ from: rel, to: id, kind: 'defines' });
    }
    for (const [name, id] of symbols.hooks) {
      addNode({
        id,
        type: 'hook',
        name,
        file: rel,
        ...(symbols.loc.has(id) ? { loc: symbols.loc.get(id) } : {}),
      });
      addEdge({ from: rel, to: id, kind: 'defines' });
    }
    for (const [name, id] of symbols.contexts) {
      addNode({ id, type: 'context', name, file: rel });
      addEdge({ from: rel, to: id, kind: 'defines' });
    }

    const route = routeForFile(rel);
    if (route) {
      const routeId = `route:${route}`;
      addNode({ id: routeId, type: 'route', name: route, file: rel });
      addEdge({ from: routeId, to: symbols.defaultId ?? rel, kind: 'routes_to' });
    }

    const apiRoute = apiRouteForFile(rel);
    if (apiRoute) {
      const apiId = `api:ROUTE ${apiRoute}`;
      addNode({ id: apiId, type: 'api', name: apiRoute, file: rel, declared: true });
      addEdge({ from: rel, to: apiId, kind: 'defines' });
    }
  }

  // Declared routes (kept + fresh) drive nav-target canonicalization.
  const declaredRoutes = [...nodes.values()]
    .filter((n) => n.type === 'route' && n.file)
    .map((n) => n.name);
  const canonicalRoute = (nav: string): string => {
    if (declaredRoutes.includes(nav)) return nav;
    const navSegs = nav.split('/').filter(Boolean);
    const candidates = declaredRoutes.filter((declared) => {
      const segs = declared.split('/').filter(Boolean);
      return (
        segs.length === navSegs.length &&
        segs.every((s, i) => s === navSegs[i] || s.startsWith(':') || navSegs[i].startsWith(':'))
      );
    });
    return candidates.length === 1 ? candidates[0] : nav;
  };

  // Phase 2: imports, renders, navigation, hook/context usage, API calls.
  for (const { sf, rel } of parsed) {
    const importMap = buildImportMap(sf, root);

    for (const target of new Set(importMap.fileTargets)) {
      if (currentRels.has(target)) addEdge({ from: rel, to: target, kind: 'imports' });
    }

    const own = freshSymbols.get(rel)!;
    const resolveTag = (tag: string): string | undefined => {
      const head = tag.split('.')[0];
      if (!/^[A-Z]/.test(head)) return undefined;
      const imported = importMap.locals.get(head);
      if (imported) {
        const target = lookupSymbols(imported.fromFile);
        if (!target) return undefined;
        return imported.name === 'default'
          ? target.defaultId
          : target.components.get(imported.name);
      }
      return own.components.get(head);
    };

    const resolveSymbol = (name: string, table: 'hooks' | 'contexts'): string | undefined => {
      const imported = importMap.locals.get(name);
      if (imported && imported.name !== 'default') {
        return lookupSymbols(imported.fromFile)?.[table].get(imported.name);
      }
      return own[table].get(name);
    };

    // Attribute every reference to the enclosing component or hook, else the file.
    const declRanges: { id: string; start: number; end: number }[] = [];
    for (const [name, id] of [...own.components, ...own.hooks]) {
      const decl = sf.getFunction(name) ?? sf.getVariableDeclaration(name);
      if (decl) declRanges.push({ id, start: decl.getPos(), end: decl.getEnd() });
    }
    const enclosingId = (node: Node): string => {
      const pos = node.getPos();
      const hit = declRanges.find((r) => pos >= r.start && pos < r.end);
      return hit?.id ?? rel;
    };

    for (const jsx of [
      ...sf.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
      ...sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
    ] as (JsxOpeningElement | JsxSelfClosingElement)[]) {
      const tag = jsx.getTagNameNode().getText();
      const from = enclosingId(jsx);

      const targetId = resolveTag(tag);
      if (targetId && targetId !== from) {
        addEdge({ from, to: targetId, kind: 'renders' });
      }

      if (tag.split('.')[0] === 'Link') {
        const href = literalAttr(jsx, 'href');
        if (href?.startsWith('/')) {
          const routePath = canonicalRoute(normalizeRoutePath(href));
          addNode({ id: `route:${routePath}`, type: 'route', name: routePath });
          addEdge({ from, to: `route:${routePath}`, kind: 'navigates_to' });
        }
      }
    }

    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = call.getExpression();
      if (Node.isIdentifier(callee) && /^use[A-Z]/.test(callee.getText())) {
        const from = enclosingId(call);
        if (callee.getText() === 'useContext') {
          const arg = call.getArguments()[0];
          const ctxId =
            arg && Node.isIdentifier(arg) ? resolveSymbol(arg.getText(), 'contexts') : undefined;
          if (ctxId) addEdge({ from, to: ctxId, kind: 'uses' });
          continue;
        }
        const hookId = resolveSymbol(callee.getText(), 'hooks');
        if (hookId && hookId !== from) {
          addEdge({ from, to: hookId, kind: 'uses' });
          continue;
        }
      }

      const nav = navigationTarget(call);
      if (nav?.startsWith('/')) {
        const routePath = canonicalRoute(normalizeRoutePath(nav));
        addNode({ id: `route:${routePath}`, type: 'route', name: routePath });
        addEdge({ from: enclosingId(call), to: `route:${routePath}`, kind: 'navigates_to' });
        continue;
      }
      const api = apiCall(call);
      if (api) {
        const apiId = `api:${api.method} ${api.url}`;
        addNode({ id: apiId, type: 'api', name: `${api.method} ${api.url}` });
        addEdge({ from: enclosingId(call), to: apiId, kind: 'calls' });
      }
    }
  }

  // Dart/Flutter pass (beta) — fast structural scan, always run in full.
  const dart = extractDart(root);
  if (dart) {
    Object.assign(files, dart.files);
    for (const n of dart.nodes) addNode(n);
    for (const e of dart.edges) addEdge(e);
    warnings.push(...dart.warnings);
  }

  // Repair pass: kept edges may reference synthesized route/api nodes that
  // carried no owning file — recreate them deterministically from their ids.
  for (const e of edges) {
    for (const id of [e.from, e.to]) {
      if (nodes.has(id)) continue;
      if (id.startsWith('route:')) {
        addNode({ id, type: 'route', name: id.slice('route:'.length) });
      } else if (id.startsWith('api:')) {
        addNode({ id, type: 'api', name: id.slice('api:'.length) });
      }
    }
  }

  const commit = gitHead(root);
  const graph: ProjectGraph = {
    version: 1,
    root,
    indexedAt: new Date().toISOString(),
    ...(commit ? { commit } : {}),
    files,
    nodes: sortNodes([...nodes.values()]),
    edges: sortEdges(edges),
    symbols: symbolsOut,
  };
  const count = (t: string) => graph.nodes.filter((n) => n.type === t).length;
  const stats: IndexStats = {
    files: Object.keys(files).length,
    components: count('component'),
    routes: count('route'),
    apis: count('api'),
    hooks: count('hook'),
    contexts: count('context'),
    edges: edges.length,
    durationMs: Date.now() - started,
    mode,
    reparsed: parseSet.size,
    reused: keep.size,
  };
  return { graph, stats, warnings };
}

// Deterministic ordering so incremental and full rebuilds produce identical output.
function sortNodes(list: GraphNode[]): GraphNode[] {
  return list.sort((a, b) => a.id.localeCompare(b.id));
}
function sortEdges(list: GraphEdge[]): GraphEdge[] {
  return list.sort(
    (a, b) =>
      a.from.localeCompare(b.from) || a.kind.localeCompare(b.kind) || a.to.localeCompare(b.to),
  );
}

/** The file whose re-parse would regenerate this node (undefined = synthesized). */
function nodeOwnerFile(n: GraphNode): string | undefined {
  return n.type === 'file' ? n.id : n.file;
}

/** The file whose re-parse would regenerate this edge. */
function edgeOwnerFile(e: GraphEdge, byId: Map<string, GraphNode>): string | undefined {
  const from = e.from;
  if (from.includes('#')) return from.split('#')[0];
  if (from.startsWith('route:')) return byId.get(from)?.file;
  if (from.startsWith('api:')) return undefined;
  return from; // plain file id
}

function safeLoadPrevious(root: string): ProjectGraph | null {
  try {
    const prev = loadGraph(root);
    return prev && prev.root === root ? prev : null;
  } catch {
    return null;
  }
}

function freezeSymbols(s: FileSymbols): StoredFileSymbols {
  return {
    components: Object.fromEntries(s.components),
    hooks: Object.fromEntries(s.hooks),
    contexts: Object.fromEntries(s.contexts),
    loc: Object.fromEntries(s.loc),
    ...(s.defaultId ? { defaultId: s.defaultId } : {}),
  };
}

function thawSymbols(s: StoredFileSymbols): FileSymbols {
  return {
    components: new Map(Object.entries(s.components)),
    hooks: new Map(Object.entries(s.hooks)),
    contexts: new Map(Object.entries(s.contexts)),
    loc: new Map(Object.entries(s.loc)),
    defaultId: s.defaultId,
  };
}

/** Walk the project for TS/JS source files, hashing as we go (parse-free). */
function discoverTsFiles(root: string): DiscoveredFile[] {
  const out: DiscoveredFile[] = [];
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
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(abs);
        continue;
      }
      const ext = path.extname(entry);
      if (!TS_EXTENSIONS.has(ext)) continue;
      if (entry.endsWith('.d.ts') || /\.(test|spec)\./.test(entry)) continue;
      const rel = path.relative(root, abs).split(path.sep).join('/');
      out.push({ rel, abs, hash: sha1(readFileSync(abs, 'utf8')) });
    }
  };
  walk(root);
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

function sha1(text: string): string {
  return createHash('sha1').update(text).digest('hex');
}

/**
 * Top-level symbols of a file:
 * - components: uppercase-named functions/consts containing JSX
 * - hooks: functions/consts named use[A-Z]…
 * - contexts: consts initialized with createContext(...)
 */
function collectSymbols(sf: SourceFile, relPath: string): FileSymbols {
  const components = new Map<string, string>();
  const hooks = new Map<string, string>();
  const contexts = new Map<string, string>();
  const loc = new Map<string, number>();
  let defaultId: string | undefined;

  const register = (name: string, node: Node, isDefault: boolean, initText?: string) => {
    if (!name) return;
    const id = `${relPath}#${name}`;
    if (/^use[A-Z]/.test(name)) {
      hooks.set(name, id);
      loc.set(id, node.getEndLineNumber() - node.getStartLineNumber() + 1);
    } else if (initText?.includes('createContext')) {
      contexts.set(name, id);
    } else if (/^[A-Z]/.test(name) && containsJsx(node)) {
      components.set(name, id);
      loc.set(id, node.getEndLineNumber() - node.getStartLineNumber() + 1);
      if (isDefault) defaultId = id;
    }
  };

  for (const fn of sf.getFunctions()) {
    const name = fn.getName() ?? defaultFunctionName(relPath, fn.isDefaultExport());
    register(name, fn, fn.isDefaultExport());
  }
  for (const v of sf.getVariableDeclarations()) {
    const init = v.getInitializer();
    if (!init) continue;
    if (
      Node.isArrowFunction(init) ||
      Node.isFunctionExpression(init) ||
      Node.isCallExpression(init) // memo(...), forwardRef(...), createContext(...)
    ) {
      register(v.getName(), init, false, init.getText().slice(0, 80));
    }
  }
  // `export default Foo;`
  for (const ea of sf.getExportAssignments()) {
    const expr = ea.getExpression();
    if (Node.isIdentifier(expr)) {
      const id = components.get(expr.getText());
      if (id) defaultId = id;
    }
  }
  return { components, hooks, contexts, loc, defaultId };
}

function defaultFunctionName(relPath: string, isDefault: boolean): string {
  if (!isDefault) return '';
  const base = path.basename(relPath).replace(/\.[^.]+$/, '');
  return base.charAt(0).toUpperCase() + base.slice(1).replace(/[^A-Za-z0-9]/g, '');
}

function containsJsx(node: Node): boolean {
  return (
    node.getDescendantsOfKind(SyntaxKind.JsxOpeningElement).length > 0 ||
    node.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement).length > 0 ||
    node.getDescendantsOfKind(SyntaxKind.JsxFragment).length > 0
  );
}

interface ImportMap {
  /** local identifier → source of the import */
  locals: Map<string, { fromFile: string; name: string }>;
  fileTargets: string[];
}

function buildImportMap(sf: SourceFile, root: string): ImportMap {
  const locals = new Map<string, { fromFile: string; name: string }>();
  const fileTargets: string[] = [];
  for (const imp of sf.getImportDeclarations()) {
    const target = imp.getModuleSpecifierSourceFile();
    if (!target || target.getFilePath().includes('/node_modules/')) continue;
    const fromFile = path
      .relative(root, target.getFilePath())
      .split(path.sep)
      .join('/');
    fileTargets.push(fromFile);
    const def = imp.getDefaultImport();
    if (def) locals.set(def.getText(), { fromFile, name: 'default' });
    for (const named of imp.getNamedImports()) {
      locals.set(named.getAliasNode()?.getText() ?? named.getName(), {
        fromFile,
        name: named.getName(),
      });
    }
  }
  return { locals, fileTargets };
}

/** Next.js route derivation for app-router pages and pages-router files. */
export function routeForFile(relPath: string): string | undefined {
  const appMatch = relPath.match(/(?:^|\/)app\/(.*?)page\.(?:tsx|jsx|ts|js)$/);
  if (appMatch) {
    const segments = appMatch[1]
      .split('/')
      .filter(Boolean)
      .filter((s) => !s.startsWith('(') && !s.startsWith('@'))
      .map(segmentToRoute);
    return '/' + segments.join('/').replace(/\/+$/, '');
  }
  const pagesMatch = relPath.match(/(?:^|\/)pages\/(.*)\.(?:tsx|jsx|ts|js)$/);
  if (pagesMatch) {
    const p = pagesMatch[1];
    if (p.startsWith('api/') || p.startsWith('_')) return undefined;
    const withoutIndex = p.replace(/(^|\/)index$/, '');
    return '/' + withoutIndex.split('/').filter(Boolean).map(segmentToRoute).join('/');
  }
  return undefined;
}

/** API route handlers: app router route.ts files and pages/api files → endpoint path. */
export function apiRouteForFile(relPath: string): string | undefined {
  const appMatch = relPath.match(/(?:^|\/)app\/(.*?)route\.(?:ts|js|tsx|jsx)$/);
  if (appMatch) {
    const segments = appMatch[1]
      .split('/')
      .filter(Boolean)
      .filter((s) => !s.startsWith('(') && !s.startsWith('@'))
      .map(segmentToRoute);
    return '/' + segments.join('/').replace(/\/+$/, '');
  }
  const pagesMatch = relPath.match(/(?:^|\/)pages\/(api\/.*)\.(?:ts|js)$/);
  if (pagesMatch) {
    const withoutIndex = pagesMatch[1].replace(/(^|\/)index$/, '');
    return '/' + withoutIndex.split('/').filter(Boolean).map(segmentToRoute).join('/');
  }
  return undefined;
}

function segmentToRoute(segment: string): string {
  return segment
    .replace(/^\[\.\.\.(.+)\]$/, ':$1*')
    .replace(/^\[\[\.\.\.(.+)\]\]$/, ':$1*')
    .replace(/^\[(.+)\]$/, ':$1');
}

function normalizeRoutePath(href: string): string {
  const cleaned = href.split(/[?#]/)[0].replace(/\/+$/, '');
  return cleaned === '' ? '/' : cleaned;
}

function literalAttr(
  jsx: JsxOpeningElement | JsxSelfClosingElement,
  name: string,
): string | undefined {
  for (const attr of jsx.getAttributes()) {
    if (!Node.isJsxAttribute(attr) || attr.getNameNode().getText() !== name) continue;
    const init = attr.getInitializer();
    if (Node.isStringLiteral(init)) return init.getLiteralValue();
    if (Node.isJsxExpression(init)) {
      const expr = init.getExpression();
      if (Node.isStringLiteral(expr)) return expr.getLiteralValue();
      if (expr && Node.isTemplateExpression(expr)) return templateToPattern(expr);
      if (expr && Node.isNoSubstitutionTemplateLiteral(expr)) return expr.getLiteralValue();
    }
  }
  return undefined;
}

/** `/product/${id}` → `/product/:param` */
function templateToPattern(node: Node): string | undefined {
  if (!Node.isTemplateExpression(node)) return undefined;
  let text = node.getHead().getLiteralText();
  for (const span of node.getTemplateSpans()) {
    text += ':param' + span.getLiteral().getLiteralText();
  }
  return text;
}

function firstArgString(call: CallExpression): string | undefined {
  const arg = call.getArguments()[0];
  if (!arg) return undefined;
  if (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg)) {
    return arg.getLiteralValue();
  }
  if (Node.isTemplateExpression(arg)) return templateToPattern(arg);
  return undefined;
}

/** router.push/replace('/x'), redirect('/x'), navigate('/x') */
function navigationTarget(call: CallExpression): string | undefined {
  const expr = call.getExpression().getText();
  const isNav =
    /(^|\.)(push|replace)$/.test(expr) || expr === 'redirect' || expr === 'navigate';
  if (!isNav) return undefined;
  return firstArgString(call);
}

/** fetch('/api/x', {method}), axios.get('/api/x'), axios('/api/x') */
function apiCall(call: CallExpression): { method: string; url: string } | undefined {
  const expr = call.getExpression();
  const exprText = expr.getText();
  let method: string | undefined;

  if (exprText === 'fetch') {
    method = fetchMethod(call) ?? 'GET';
  } else if (exprText === 'axios') {
    method = 'GET';
  } else if (Node.isPropertyAccessExpression(expr)) {
    const prop = expr.getName().toLowerCase();
    const objText = expr.getExpression().getText();
    if (
      (HTTP_METHODS as readonly string[]).includes(prop) &&
      /(axios|api|client|http)/i.test(objText)
    ) {
      method = prop.toUpperCase();
    }
  }
  if (!method) return undefined;

  const raw = firstArgString(call);
  if (!raw) return undefined;
  const url = toPathname(raw);
  if (!url) return undefined;
  return { method, url };
}

function fetchMethod(call: CallExpression): string | undefined {
  const opts = call.getArguments()[1];
  if (!opts || !Node.isObjectLiteralExpression(opts)) return undefined;
  const prop = opts.getProperty('method');
  if (prop && Node.isPropertyAssignment(prop)) {
    const init = prop.getInitializer();
    if (init && Node.isStringLiteral(init)) return init.getLiteralValue().toUpperCase();
  }
  return undefined;
}

function toPathname(raw: string): string | undefined {
  if (raw.startsWith('/')) return raw.split(/[?#]/)[0];
  try {
    return new URL(raw).pathname;
  } catch {
    return undefined;
  }
}

function gitHead(root: string): string | undefined {
  try {
    return execSync('git rev-parse HEAD', {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}
