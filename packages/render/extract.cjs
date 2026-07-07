/* RenderContextify front-end v0 — Source → HIR → passes → React IR.
   Staged like a compiler, not a parser: parse (TS API) → lowerToHIR →
   passes (fragment-elim, class-resolve, list-mark) → emitIR.
   Reports EXTRACTION COVERAGE (full/partial/failed + reasons) per the plan.   */
const fs = require('fs'), path = require('path');
const ts = require('./config.cjs').ts;

// ── class → facets (same vocabulary the oracle scores against) ────────────────
const TSZ = { 'text-xs': 'xs', 'text-sm': 'sm', 'text-base': 'base', 'text-lg': 'lg', 'text-xl': 'xl', 'text-2xl': '2xl', 'text-3xl': '3xl' };
function facetsFromClasses(list) {
  const layout = {}, style = {}, text = {};
  for (const c of list) {
    let m;
    if (c === 'flex') layout.direction = layout.direction || 'row';
    if (c === 'flex-col') layout.direction = 'col';
    if (c === 'flex-row') layout.direction = 'row';
    if (m = c.match(/^gap-(\d+(?:\.\d+)?)$/)) layout.gap = Math.round(parseFloat(m[1]) * 4);
    if (m = c.match(/^space-y-(\d+(?:\.\d+)?)$/)) { layout.direction = 'col'; layout.gap = Math.round(parseFloat(m[1]) * 4); }
    if (m = c.match(/^space-x-(\d+(?:\.\d+)?)$/)) layout.gap = Math.round(parseFloat(m[1]) * 4);
    if (m = c.match(/^p-(\d+)$/)) style.padding = +m[1] * 4;
    if (m = c.match(/^py-(\d+)$/)) style.padding = style.padding ?? +m[1] * 4;
    if (m = c.match(/^px-(\d+)$/)) style.padding = style.padding ?? +m[1] * 4;
    if (c === 'justify-between') layout.justify = 'space-between';
    if (c === 'justify-end') layout.justify = 'end';
    if (c === 'justify-center') layout.justify = 'center';
    if (c === 'items-center') layout.align = 'center';
    if (TSZ[c]) text.size = TSZ[c];
    if (c === 'font-medium') text.weight = 500;
    if (c === 'font-semibold') text.weight = 600;
    if (c === 'text-muted-foreground') text.color = 'muted-foreground';
    if (c === 'text-destructive') text.color = 'destructive';
    if (c === 'rounded-lg') style.radius = 8;
    if (c === 'rounded-md') style.radius = 6;
    if (c === 'rounded') style.radius = 4;
    if (c === 'border') style.border = 1;
  }
  return { layout, style, text };
}
const idents = (node) => { const s = new Set(); (function w(n) { if (ts.isIdentifier(n)) s.add(n.text); n.forEachChild(w); })(node); return [...s]; };
const staticStrings = (node) => { const out = []; (function w(n) { if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text); n.forEachChild(w); })(node); return out; };

// ── parse a component file → { root JSX, imports, consts, fn } ────────────────
function parse(file) {
  const src = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const importKind = {}; // localName -> 'icon' | 'ui' | 'other'
  const constArrays = {}; // name -> array literal length (module consts)
  const jsxReturns = [];
  (function w(n) {
    if (ts.isImportDeclaration(n) && n.importClause && ts.isStringLiteral(n.moduleSpecifier)) {
      const mod = n.moduleSpecifier.text;
      const kind = mod === 'lucide-react' ? 'icon' : /components\/ui\//.test(mod) ? 'ui' : 'other';
      const nb = n.importClause.namedBindings;
      if (nb && ts.isNamedImports(nb)) nb.elements.forEach(e => importKind[e.name.text] = kind);
      if (n.importClause.name) importKind[n.importClause.name.text] = kind;
    }
    if (ts.isVariableDeclaration(n) && n.name && ts.isIdentifier(n.name) && n.initializer && ts.isArrayLiteralExpression(n.initializer))
      constArrays[n.name.text] = n.initializer.elements.length;
    if (ts.isReturnStatement(n) && n.expression) {
      let e = n.expression; while (ts.isParenthesizedExpression(e)) e = e.expression;
      if (ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e) || ts.isJsxFragment(e)) {
        let count = 0; (function c(x) { count++; x.forEachChild(c); })(e);
        jsxReturns.push({ jsx: e, count });
      }
    }
    n.forEachChild(w);
  })(src);
  jsxReturns.sort((a, b) => b.count - a.count);
  return { src, importKind, constArrays, root: jsxReturns[0] && jsxReturns[0].jsx };
}

// ── lower JSX → HIR (best-effort; records unsupported) ────────────────────────
function makeLowerer(ctx) {
  let key = 0;
  const K = (p) => `${p}.${key++}`;
  function classesOf(attrs) {
    for (const a of attrs) if (ts.isJsxAttribute(a) && a.name.getText() === 'className' && a.initializer) {
      if (ts.isStringLiteral(a.initializer)) return a.initializer.text.split(/\s+/).filter(Boolean);
      if (ts.isJsxExpression(a.initializer) && a.initializer.expression) return staticStrings(a.initializer.expression).join(' ').split(/\s+/).filter(Boolean);
    }
    return [];
  }
  function propsOf(attrs) {
    const props = {};
    for (const a of attrs) if (ts.isJsxAttribute(a) && a.name.getText() !== 'className' && a.name.getText() !== 'key' && a.initializer) {
      const nm = a.name.getText();
      if (ts.isStringLiteral(a.initializer)) props[nm] = { lit: a.initializer.text };
      else if (ts.isJsxExpression(a.initializer) && a.initializer.expression) { const ex = a.initializer.expression; props[nm] = ts.isStringLiteral(ex) ? { lit: ex.text } : { expr: ex.getText().replace(/\s+/g, ' '), deps: idents(ex) }; }
    }
    return props;
  }
  function lowerChildren(children) {
    const out = [];
    for (const c of children) { const r = lower(c); if (r) Array.isArray(r) ? out.push(...r) : out.push(r); }
    return out;
  }
  function lower(node) {
    while (node && ts.isParenthesizedExpression(node)) node = node.expression;
    if (!node) return null;
    if (ts.isJsxText(node)) { const t = node.text.trim(); return t ? { kind: 'Text', key: K('t'), value: { lit: t } } : null; }
    if (ts.isJsxExpression(node)) return node.expression ? lower(node.expression) : null;
    if (ts.isJsxFragment(node)) return { kind: 'Fragment', key: K('frag'), children: lowerChildren(node.children) };
    if (ts.isConditionalExpression(node)) return { kind: 'Cond', key: K('cond'), cases: [{ when: { expr: node.condition.getText(), deps: idents(node.condition) }, node: lower(node.whenTrue) }], else: lower(node.whenFalse) };
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return { kind: 'Cond', key: K('cond'), cases: [{ when: { expr: node.left.getText(), deps: idents(node.left) }, node: lower(node.right) }], else: null };
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'map') return lowerMap(node);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return { kind: 'Text', key: K('t'), value: { lit: node.text } };
    const isEl = ts.isJsxElement(node), isSelf = ts.isJsxSelfClosingElement(node);
    if (!isEl && !isSelf) { ctx.partial.add('expr-node'); return { kind: 'Text', key: K('t'), value: { expr: node.getText().replace(/\s+/g, ' '), deps: idents(node) } }; }
    const opening = isEl ? node.openingElement : node;
    const tag = opening.tagName.getText();
    const attrs = opening.attributes.properties;
    if (attrs.some(a => ts.isJsxSpreadAttribute(a))) ctx.partial.add('spread-props');
    const kids = ts.isJsxElement(node) ? lowerChildren(node.children) : [];
    const cls = classesOf(attrs), f = facetsFromClasses(cls);
    const impKind = ctx.importKind[tag];
    if (impKind === 'icon') return { kind: 'Icon', key: K('icon'), name: tag, anim: cls.includes('animate-spin') ? 'spin' : undefined };
    if (/^[A-Z]/.test(tag)) return { kind: 'Prim', key: K(tag.toLowerCase()), ref: tag, props: propsOf(attrs), layout: nz(f.layout), style: nz(f.style), children: kids.length ? kids : undefined };
    if (['h1','h2','h3','h4','h5','h6','p','label','span'].includes(tag) && kids.length && kids.every(k => k.kind === 'Text')) return { kind: 'Text', key: K('t'), el: tag, value: kids[0].value, text: nz(f.text) };
    return { kind: 'Box', key: K('box'), layout: nz(f.layout), style: nz(f.style), text: nz(f.text), children: kids };
  }
  function lowerMap(call) {
    const obj = call.expression.expression; // x in x.map
    const fn = call.arguments[0];
    const body = fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) ? (ts.isBlock(fn.body) ? findReturnJsx(fn.body) : fn.body) : null;
    if (!body) { ctx.partial.add('map-callback'); return { kind: 'List', key: K('list'), items: { kind: 'data', cardinality: 'unknown' }, template: null }; }
    const tmpl = lower(unwrap(body));
    const arrName = ts.isIdentifier(obj) ? obj.text : null;
    const card = arrName && ctx.constArrays[arrName] != null ? ctx.constArrays[arrName] : 'unknown';
    let itemKey = 'id';
    if (tmpl) { const kp = keyProp(fn); if (kp) itemKey = kp; }
    return { kind: 'List', key: K('list'), items: card === 'unknown' ? { kind: 'data', ref: arrName, cardinality: 'unknown' } : { kind: 'static', source: 'const:' + arrName, cardinality: card }, itemKey, template: tmpl };
  }
  function keyProp(fn) {
    let k = null; (function w(n) { if (ts.isJsxAttribute(n) && n.name.getText() === 'key' && n.initializer && ts.isJsxExpression(n.initializer) && n.initializer.expression) { const t = n.initializer.expression.getText(); const m = t.match(/(\w+)$/); if (m && !k) k = m[1]; } n.forEachChild(w); })(fn); return k;
  }
  return lower;
}
const nz = (o) => o && Object.keys(o).length ? o : undefined;
const wrapExpr = (e) => e; const unwrap = (e) => { while (ts.isParenthesizedExpression(e)) e = e.expression; return e; };
function findReturnJsx(block) { let j = null; (function w(n) { if (ts.isReturnStatement(n) && n.expression) { let e = n.expression; while (ts.isParenthesizedExpression(e)) e = e.expression; if (ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e) || ts.isJsxFragment(e)) j = e; } n.forEachChild(w); })(block); return j; }

// ── extract one component ─────────────────────────────────────────────────────
function extract(file) {
  const name = path.basename(file).replace(/\.(tsx|jsx)$/, '');
  try {
    const p = parse(file);
    if (!p.root) return { name, file, status: 'failed', reason: 'no-jsx-return' };
    const ctx = { importKind: p.importKind, constArrays: p.constArrays, unsupported: new Set(), partial: new Set() };
    const root = makeLowerer(ctx)(p.root);
    if (!root) return { name, file, status: 'failed', reason: 'lower-null' };
    const ir = { irVersion: 'react-private-0.1-extracted', kind: 'Component', name, source: file, root };
    let count = 0; (function c(n) { if (n && n.kind) { count++; (n.children || []).forEach(c); if (n.cases) n.cases.forEach(x => c(x.node)); if (n.else) c(n.else); if (n.template) c(n.template); } })(root);
    const status = ctx.unsupported.size ? 'failed' : ctx.partial.size ? 'partial' : 'full';
    return { name, file, status, nodes: count, reason: [...ctx.unsupported, ...ctx.partial].join(',') || null, ir };
  } catch (e) { return { name, file, status: 'failed', reason: 'exception:' + (e.message || e).slice(0, 40) }; }
}

// ── CLI ───────────────────────────────────────────────────────────────────────
const arg = process.argv[2];
if (arg && arg !== '--batch') {
  const r = extract(arg);
  console.log(JSON.stringify({ name: r.name, status: r.status, nodes: r.nodes, reason: r.reason }, null, 2));
  if (r.ir) { const outdir = path.join(__dirname, 'extracted'); fs.mkdirSync(outdir, { recursive: true }); fs.writeFileSync(path.join(outdir, r.name + '.ir.json'), JSON.stringify(r.ir, null, 2)); console.log('IR →', path.join('extracted', r.name + '.ir.json')); }
} else {
  const dir = process.argv[3] || '/Users/sambit/Belivmart/belivmart-admin/app';
  const files = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (['node_modules', '.next', '.rcx-oracle'].includes(e.name)) continue; const fp = path.join(d, e.name); if (e.isDirectory()) walk(fp); else if (/\.tsx$/.test(e.name) && !/\.(test|spec)\./.test(e.name)) files.push(fp); } })(dir);
  const results = files.map(extract);
  const by = (s) => results.filter(r => r.status === s).length;
  const reasons = {}; results.filter(r => r.status !== 'full').forEach(r => { const k = r.reason || 'unknown'; reasons[k] = (reasons[k] || 0) + 1; });
  console.log(`\n EXTRACTION COVERAGE — ${files.length} components under ${path.relative('/Users/sambit/Belivmart', dir)}\n`);
  console.log(`   full     ${by('full')}   (${(100 * by('full') / files.length).toFixed(1)}%)`);
  console.log(`   partial  ${by('partial')}   (${(100 * by('partial') / files.length).toFixed(1)}%)`);
  console.log(`   failed   ${by('failed')}   (${(100 * by('failed') / files.length).toFixed(1)}%)`);
  console.log(`   coverage ${(100 * (by('full') + by('partial')) / files.length).toFixed(1)}%  (full+partial produce an IR)`);
  console.log('\n   top reasons (partial/failed) — the evidence-generated backlog:');
  Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, v]) => console.log(`     ${String(v).padStart(3)}  ${k}`));
  fs.writeFileSync(path.join(__dirname, 'coverage.json'), JSON.stringify(results.map(({ ir, ...r }) => r), null, 2));
}
