/* Semantic Compiler L2 — Source + React IR → Runtime IR (separate artifact).
   Never mutates the React IR. Emits the EXECUTION model: state, props, effects,
   variants (enumerated from the Cond tree), + a runtime dependency graph and an
   auto-derived environment (fixtures). Deterministic; no execution, no AI.       */
const fs = require('fs'), path = require('path');
const ts = require('./config.cjs').ts;
const DIR = __dirname;
const ir = JSON.parse(fs.readFileSync(path.join(DIR, 'extracted', 'general-settings-card.ir.json'), 'utf8'));
const src = ts.createSourceFile(ir.source, fs.readFileSync(ir.source, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

const inferType = (n) => !n ? 'unknown' : n.kind === ts.SyntaxKind.TrueKeyword || n.kind === ts.SyntaxKind.FalseKeyword ? 'boolean'
  : ts.isStringLiteral(n) ? 'string' : ts.isNumericLiteral(n) ? 'number' : n.kind === ts.SyntaxKind.NullKeyword ? 'null'
  : ts.isObjectLiteralExpression(n) ? 'object' : ts.isArrayLiteralExpression(n) ? 'array' : 'unknown';

// ── L2a: state / hooks / effects / props / consts, straight from the AST ──────
const state = [], hooks = [], effects = []; let props = [], togglesConst = [];
(function walk(n) {
  if (ts.isVariableDeclaration(n) && n.initializer && ts.isCallExpression(n.initializer)) {
    const callee = n.initializer.expression.getText();
    if (callee === 'useState' && ts.isArrayBindingPattern(n.name)) {
      const nm = n.name.elements[0] && n.name.elements[0].name && n.name.elements[0].name.getText();
      const type = n.initializer.typeArguments ? n.initializer.typeArguments[0].getText() : inferType(n.initializer.arguments[0]);
      if (nm) state.push({ name: nm, type, init: n.initializer.arguments[0] ? n.initializer.arguments[0].getText() : 'undefined' });
    } else if (/^use[A-Z]/.test(callee) && ts.isIdentifier(n.name)) {
      hooks.push({ name: n.name.getText(), from: callee, arg: n.initializer.arguments[0] && n.initializer.arguments[0].getText().replace(/['"]/g, '') });
    }
  }
  if (ts.isCallExpression(n) && n.expression.getText() === 'useEffect') {
    const deps = n.arguments[1] && ts.isArrayLiteralExpression(n.arguments[1]) ? n.arguments[1].elements.map(e => e.getText()) : null;
    const body = n.arguments[0] ? n.arguments[0].getText() : '';
    effects.push({ trigger: deps === null ? 'every-render' : deps.length === 0 ? 'mount' : deps, action: /fetch\(/.test(body) ? 'fetch' : (body.match(/(\w+)\(/) || [, 'effect'])[1], dataSource: /fetch\(/.test(body) });
  }
  if (ts.isFunctionDeclaration(n) && n.parameters[0] && ts.isObjectBindingPattern(n.parameters[0].name) && n.parameters[0].type && ts.isTypeLiteralNode(n.parameters[0].type))
    props = n.parameters[0].type.members.map(m => ({ name: m.name.getText(), type: m.type ? m.type.getText() : 'unknown' }));
  if (ts.isVariableDeclaration(n) && n.name.getText() === 'TOGGLES' && n.initializer && ts.isArrayLiteralExpression(n.initializer))
    togglesConst = n.initializer.elements.map(el => { const o = {}; if (ts.isObjectLiteralExpression(el)) el.properties.forEach(p => { if (ts.isPropertyAssignment(p) && ts.isStringLiteral(p.initializer)) o[p.name.getText()] = p.initializer.text; }); return o; });
  n.forEachChild(walk);
})(src);

// ── L2b: variants — enumerate paths through the React IR Cond tree ────────────
function firstCond(node) { let f = null; (function w(n) { if (f || !n || !n.kind) return; if (n.kind === 'Cond') { f = n; return; } (n.children || []).forEach(w); if (n.template) w(n.template); })(node); return f; }
function chain(cond, acc) {
  const out = [];
  for (const c of cond.cases) { const p = [...acc, c.when.expr]; (c.node && c.node.kind === 'Cond') ? out.push(...chain(c.node, p)) : out.push({ pred: p, node: c.node }); }
  const ep = [...acc, ...cond.cases.map(c => `!(${c.when.expr})`)];
  (cond.else && cond.else.kind === 'Cond') ? out.push(...chain(cond.else, ep)) : out.push({ pred: ep, node: cond.else });
  return out;
}
function nestedDiscriminants(node, known) { const set = new Set(); (function w(n) { if (!n || !n.kind) return; if (n.kind === 'Cond') n.cases.forEach(c => (c.when.deps || []).forEach(d => { if (!known.has(d)) set.add(d); })); (n.children || []).forEach(w); if (n.template) w(n.template); if (n.else) w(n.else); n.cases && n.cases.forEach(c => w(c.node)); })(node); return [...set]; }
let leaves = chain(firstCond(ir.root), []);
// split any branch gated by a not-yet-fixed discriminant (e.g. canEdit in the form)
leaves = leaves.flatMap(lf => {
  const known = new Set(lf.pred.flatMap(p => p.replace(/[!()]/g, '').split(/\s*&&\s*/)));
  const disc = nestedDiscriminants(lf.node, known)[0];
  return disc ? [{ pred: [...lf.pred, disc] }, { pred: [...lf.pred, `!${disc}`] }] : [lf];
});
const variants = leaves.map((lf, i) => ({ id: 'K' + (i + 1), predicate: lf.pred.join(' && ') }));

// ── L2c: runtime dependency graph — state var → dependent (node, prop) ────────
const graphAll = {};
(function w(n, id) {
  if (!n || !n.kind) return;
  const nid = n.key || id;
  const collect = (deps, tag) => (deps || []).forEach(d => { (graphAll[d] = graphAll[d] || []).push(`${nid}.${tag}`); });
  if (n.props) for (const k in n.props) if (n.props[k].deps) collect(n.props[k].deps, k);
  if (n.value && n.value.deps) collect(n.value.deps, 'text');
  (n.children || []).forEach(c => w(c, nid)); if (n.template) w(n.template, nid);
  if (n.cases) n.cases.forEach(c => w(c.node, nid)); if (n.else) w(n.else, nid);
})(ir.root, ir.name);
const tracked = new Set([...state.map(s => s.name), ...props.map(p => p.name), ...hooks.map(h => h.name)]);
const graph = {}; for (const k in graphAll) if (tracked.has(k)) graph[k] = graphAll[k];

// ── L2d: fixture compiler + auto-environment (solve each variant predicate) ────
const toggleKeys = togglesConst.map(t => t.key);
const qr = 'https://cdn.belivmart.example/qr/city_123.png';
const extraDetails = { payment: { qrCode: qr } }; toggleKeys.forEach((k, i) => extraDetails[k] = i % 2 === 0);
const solve = (pred) => {
  const env = { saving: false, canEdit: true, extraDetails: null, toggles: {}, qrCode: '' };
  for (const term of pred.split(' && ')) {
    const stripped = term.replace(/[()\s]/g, '');
    const neg = ((stripped.match(/^!+/) || [''])[0].length) % 2 === 1; // parity: !(!x) is positive
    const v = stripped.replace(/!/g, '');
    if (v === 'loading') env.loading = !neg;
    else if (v === 'extraDetails') env.extraDetails = neg ? null : extraDetails;
    else if (v === 'canEdit') env.canEdit = !neg;
  }
  if (env.extraDetails) { env.toggles = Object.fromEntries(toggleKeys.map(k => [k, !!extraDetails[k]])); env.qrCode = qr; }
  return env;
};
const envs = {}; variants.forEach(v => envs[v.id] = solve(v.predicate));
const consts = { TOGGLES: togglesConst };

// ── emit artifacts (separate from React IR) ───────────────────────────────────
const runtimeIR = { component: ir.name, props, state, hooks, effects, variants };
fs.writeFileSync(path.join(DIR, 'extracted', 'general-settings-card.runtime.ir.json'), JSON.stringify(runtimeIR, null, 2));
fs.writeFileSync(path.join(DIR, 'extracted', 'general-settings-card.runtime.graph.json'), JSON.stringify(graph, null, 2));
fs.writeFileSync(path.join(DIR, 'env.auto.json'), JSON.stringify({ consts, keyframes: variants.map(v => ({ id: v.id, label: v.predicate })), envs }, null, 2));

console.log('── Runtime IR (semantic compiler L2, auto-derived from source) ──');
console.log(' props   :', props.map(p => `${p.name}:${p.type}`).join(', '));
console.log(' state   :', state.map(s => `${s.name}:${s.type}=${s.init}`).join('  '));
console.log(' hooks   :', hooks.map(h => `${h.name}=${h.from}(${h.arg || ''})`).join(', '));
console.log(' effects :', effects.map(e => `[${Array.isArray(e.trigger) ? e.trigger.join(',') : e.trigger}]→${e.action}${e.dataSource ? '(dataSource)' : ''}`).join(', '));
console.log(' variants (from Cond tree):'); variants.forEach(v => console.log(`    ${v.id}  ${v.predicate}`));
console.log('\n── Runtime dependency graph (state → dependents) ──');
for (const k of Object.keys(graph)) console.log(`    ${k.padEnd(13)} → ${graph[k].length} nodes  ${graph[k].slice(0, 3).join(', ')}${graph[k].length > 3 ? ' …' : ''}`);
console.log(`\n  fixture: extraDetails from ${toggleKeys.length} toggle keys + payment.qrCode`);
console.log('  emitted: runtime.ir.json, runtime.graph.json, env.auto.json');
