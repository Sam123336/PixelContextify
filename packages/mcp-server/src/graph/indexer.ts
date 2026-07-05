import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
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
import type { GraphEdge, GraphNode, IndexStats, ProjectGraph } from './types';

const SOURCE_GLOBS = ['**/*.{ts,tsx,js,jsx}'];
const IGNORE_GLOBS = [
  '!**/node_modules/**',
  '!**/.next/**',
  '!**/.pixelcontextify/**',
  '!**/dist/**',
  '!**/build/**',
  '!**/out/**',
  '!**/coverage/**',
  '!**/*.d.ts',
  '!**/*.test.*',
  '!**/*.spec.*',
];
const MAX_FILES = 5_000;

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head'] as const;

interface FileSymbols {
  /** component name → node id */
  components: Map<string, string>;
  /** hook name (useX) → node id */
  hooks: Map<string, string>;
  /** context variable name → node id */
  contexts: Map<string, string>;
  defaultId?: string;
}

export interface IndexResult {
  graph: ProjectGraph;
  stats: IndexStats;
  warnings: string[];
}

export function indexProject(rootDir: string): IndexResult {
  const started = Date.now();
  const root = path.resolve(rootDir);
  const warnings: string[] = [];

  const tsConfigPath = path.join(root, 'tsconfig.json');
  const project = new Project({
    ...(existsSync(tsConfigPath) ? { tsConfigFilePath: tsConfigPath } : {}),
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: true },
  });
  project.addSourceFilesAtPaths([
    ...SOURCE_GLOBS.map((g) => path.join(root, g)),
    ...IGNORE_GLOBS.map((g) => '!' + path.join(root, g.slice(1))),
  ]);

  let sourceFiles = project
    .getSourceFiles()
    .filter((sf) => !sf.getFilePath().includes('/node_modules/'));
  if (sourceFiles.length > MAX_FILES) {
    warnings.push(
      `Project has ${sourceFiles.length} source files; indexing only the first ${MAX_FILES}.`,
    );
    sourceFiles = sourceFiles.slice(0, MAX_FILES);
  }

  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const edgeSeen = new Set<string>();
  const files: ProjectGraph['files'] = {};
  const symbolsByFile = new Map<string, FileSymbols>();
  const declaredRoutes: string[] = [];

  const addNode = (node: GraphNode) => {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  };
  const addEdge = (edge: GraphEdge) => {
    const key = `${edge.from}|${edge.kind}|${edge.to}`;
    if (edgeSeen.has(key)) return;
    edgeSeen.add(key);
    edges.push(edge);
  };
  const rel = (sf: SourceFile) =>
    path.relative(root, sf.getFilePath()).split(path.sep).join('/');

  // Phase 1: file nodes, hashes, symbol declarations (components/hooks/contexts), routes.
  for (const sf of sourceFiles) {
    const relPath = rel(sf);
    files[relPath] = { hash: sha1(sf.getFullText()) };
    addNode({ id: relPath, type: 'file', name: path.basename(relPath), file: relPath });

    const symbols = collectSymbols(sf, relPath);
    symbolsByFile.set(relPath, symbols);
    for (const [name, id] of symbols.components) {
      addNode({
        id,
        type: 'component',
        name,
        file: relPath,
        ...(symbols.defaultId === id ? { isDefaultExport: true } : {}),
      });
      addEdge({ from: relPath, to: id, kind: 'defines' });
    }
    for (const [name, id] of symbols.hooks) {
      addNode({ id, type: 'hook', name, file: relPath });
      addEdge({ from: relPath, to: id, kind: 'defines' });
    }
    for (const [name, id] of symbols.contexts) {
      addNode({ id, type: 'context', name, file: relPath });
      addEdge({ from: relPath, to: id, kind: 'defines' });
    }

    const route = routeForFile(relPath);
    if (route) {
      declaredRoutes.push(route);
      const routeId = `route:${route}`;
      addNode({ id: routeId, type: 'route', name: route, file: relPath });
      const target = symbols.defaultId ?? relPath;
      addEdge({ from: routeId, to: target, kind: 'routes_to' });
    }
  }

  // A nav target like "/product/:param" should collapse onto the declared
  // route "/product/:id" when exactly one declared route matches its shape.
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
  for (const sf of sourceFiles) {
    const relPath = rel(sf);
    const importMap = buildImportMap(sf, root, rel);

    for (const target of new Set(importMap.fileTargets)) {
      if (nodes.has(target)) addEdge({ from: relPath, to: target, kind: 'imports' });
    }

    const own = symbolsByFile.get(relPath)!;
    const resolveTag = (tag: string): string | undefined => {
      const head = tag.split('.')[0];
      if (!/^[A-Z]/.test(head)) return undefined;
      const imported = importMap.locals.get(head);
      if (imported) {
        const target = symbolsByFile.get(imported.fromFile);
        if (!target) return undefined;
        return imported.name === 'default'
          ? target.defaultId
          : target.components.get(imported.name);
      }
      return own.components.get(head);
    };

    /** Resolve an identifier to a symbol id in the given table (hooks or contexts). */
    const resolveSymbol = (
      name: string,
      table: 'hooks' | 'contexts',
    ): string | undefined => {
      const imported = importMap.locals.get(name);
      if (imported && imported.name !== 'default') {
        return symbolsByFile.get(imported.fromFile)?.[table].get(imported.name);
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
      return hit?.id ?? relPath;
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

      // <Link href="/checkout"> → navigation edge.
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
      // Hook / context usage: useCart(), useContext(CartContext).
      const callee = call.getExpression();
      if (Node.isIdentifier(callee) && /^use[A-Z]/.test(callee.getText())) {
        const from = enclosingId(call);
        if (callee.getText() === 'useContext') {
          const arg = call.getArguments()[0];
          const ctxId =
            arg && Node.isIdentifier(arg)
              ? resolveSymbol(arg.getText(), 'contexts')
              : undefined;
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

  const commit = gitHead(root);
  const graph: ProjectGraph = {
    version: 1,
    root,
    indexedAt: new Date().toISOString(),
    ...(commit ? { commit } : {}),
    files,
    nodes: [...nodes.values()],
    edges,
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
  };
  return { graph, stats, warnings };
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
  let defaultId: string | undefined;

  const register = (name: string, node: Node, isDefault: boolean, initText?: string) => {
    if (!name) return;
    const id = `${relPath}#${name}`;
    if (/^use[A-Z]/.test(name)) {
      hooks.set(name, id);
    } else if (initText?.includes('createContext')) {
      contexts.set(name, id);
    } else if (/^[A-Z]/.test(name) && containsJsx(node)) {
      components.set(name, id);
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
  return { components, hooks, contexts, defaultId };
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

function buildImportMap(
  sf: SourceFile,
  root: string,
  rel: (sf: SourceFile) => string,
): ImportMap {
  const locals = new Map<string, { fromFile: string; name: string }>();
  const fileTargets: string[] = [];
  for (const imp of sf.getImportDeclarations()) {
    const target = imp.getModuleSpecifierSourceFile();
    if (!target || target.getFilePath().includes('/node_modules/')) continue;
    const fromFile = rel(target);
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
