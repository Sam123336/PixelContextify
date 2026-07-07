/* Automated diff engine: our Scene Frame vs the REAL component's DOM.
   Reports the five split metrics (Tree/Node/Binding/Layout/Style) so a
   regression names the subsystem that broke — no eyeballing, no "≈1:1".   */
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const DIR = __dirname, OUT = path.join(DIR, 'out');
const ORA = require('./config.cjs').ORACLE_MODELS;

const SIZE = { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, '2xl': 24, '3xl': 30 };
const sp = (s) => Math.round(parseFloat(s) * 4); // tailwind spacing unit = 4px

function twFacets(cls) {
  const t = (cls || '').split(/\s+/).filter(Boolean), f = {};
  if (t.includes('flex')) f.dir = t.includes('flex-col') ? 'col' : 'row';
  for (const x of t) {
    let m;
    if (m = x.match(/^gap-(\d+(?:\.\d+)?)$/)) f.gap = sp(m[1]);
    if (m = x.match(/^space-y-(\d+(?:\.\d+)?)$/)) { f.dir = 'col'; f.gap = sp(m[1]); }
    if (m = x.match(/^space-x-(\d+(?:\.\d+)?)$/)) f.gap = sp(m[1]);
    if (m = x.match(/^p-(\d+)$/)) f.pad = sp(m[1]);
    if (m = x.match(/^px-(\d+)$/)) f.pad = sp(m[1]);
    if (m = x.match(/^pt-(\d+)$/)) f.padTop = sp(m[1]);
    if (x === 'justify-between') f.justify = 'space-between';
    if (x === 'justify-end') f.justify = 'end';
    if (x === 'justify-center') f.justify = 'center';
    if (x === 'items-center') f.align = 'center';
    if (m = x.match(/^text-(xs|sm|base|lg|xl|2xl|3xl)$/)) f.size = SIZE[m[1]];
    if (x === 'font-medium') f.weight = 500;
    if (x === 'font-semibold') f.weight = 600;
    if (x === 'font-normal') f.weight = 400;
    if (x === 'text-muted-foreground') f.color = 'muted-foreground';
    if (x === 'text-destructive') f.color = 'destructive';
    if (x === 'rounded-lg') f.radius = 8;
    if (x === 'rounded-md') f.radius = 6;
    if (x === 'rounded') f.radius = 4;
    if (x === 'border') f.border = 1;
  }
  return f;
}
function ourFacets(n) {
  const f = {};
  for (const k of ['dir', 'gap', 'pad', 'padTop', 'justify', 'align', 'weight', 'color', 'border']) if (n[k] != null) f[k] = n[k];
  if (n.radius != null) f.radius = n.radius;
  if (n.size) f.size = SIZE[n.size] ?? null;
  return f;
}
function ourRole(kind) { return ['Switch','Input','Button','Icon'].includes(kind) ? kind.toLowerCase() : kind === 'text' ? 'text' : 'box'; }
function bindOf(role, n, real) {
  if (role === 'switch') return { checked: real ? (n.dataState === 'checked' || n.ariaChecked === 'true') : !!n.checked, disabled: real ? !!n.disabled : n.enabled === false };
  if (role === 'input') return { value: real ? (n.value || '') : (n.text || ''), disabled: real ? !!n.disabled : n.enabled === false };
  if (role === 'button') return { label: (real ? n.text : n.text || '').trim(), disabled: real ? !!n.disabled : n.enabled === false };
  if (role === 'text') return { label: ((real ? n.text : n.text) || '').trim() };
  return {};
}
function ourTree(frame) {
  const by = {}; frame.forEach(n => by[n.id] = { ...n, role: ourRole(n.kind), children: [] });
  let root = null;
  frame.forEach(n => { const nd = by[n.id]; if (n.parent && by[n.parent]) by[n.parent].children.push(nd); else root = nd; });
  return root;
}
function dfs(node, depth, out, real) {
  out.push({ depth, role: node.role, facets: real ? twFacets(node.cls) : ourFacets(node), bind: bindOf(node.role, node, real) });
  for (const c of (node.children || [])) dfs(c, depth + 1, out, real);
  return out;
}
function lcs(a, b, sig) {
  const n = a.length, m = b.length, dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = sig(a[i]) === sig(b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs = []; let i = 0, j = 0;
  while (i < n && j < m) { if (sig(a[i]) === sig(b[j])) { pairs.push([i, j]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++; }
  return pairs;
}
function facetScore(pairs, A, B, keys) {
  let eq = 0, cmp = 0;
  for (const [i, j] of pairs) for (const k of keys) if (A[i].facets[k] != null || B[j].facets[k] != null) { cmp++; if (A[i].facets[k] === B[j].facets[k]) eq++; }
  return cmp ? eq / cmp : 1;
}
function bindScore(pairs, A, B) {
  let eq = 0, cmp = 0;
  for (const [i, j] of pairs) { const ba = A[i].bind, bb = B[j].bind; for (const k of new Set([...Object.keys(ba), ...Object.keys(bb)])) { cmp++; if (String(ba[k]) === String(bb[k])) eq++; } }
  return cmp ? eq / cmp : 1;
}
const pct = (x) => (100 * x).toFixed(1) + '%';
const LAYOUT = ['dir', 'gap', 'pad', 'padTop', 'justify', 'align'], STYLE = ['size', 'weight', 'color', 'radius', 'border'];

console.log('\n RenderContextify — automated fidelity (Scene Frame vs REAL React render)\n');
console.log(' KF | ourN realN | Tree   Node   Bind   Layout Style  | Overall');
console.log(' ---+------------+---------------------------------------+--------');
const results = [];
for (const kf of ['K1', 'K2', 'K3', 'K4']) {
  const rf = path.join(ORA, `real.${kf}.json`);
  if (!fs.existsSync(rf)) { console.log(` ${kf} | (no real render captured)`); continue; }
  const A = dfs(ourTree(JSON.parse(fs.readFileSync(path.join(OUT, `${kf}.scene.json`)))), 0, [], false);
  const B = dfs(JSON.parse(fs.readFileSync(rf)), 0, [], true);
  const tp = lcs(A, B, x => `${x.depth}:${x.role}`), np = lcs(A, B, x => x.role);
  const tree = 2 * tp.length / (A.length + B.length), node = 2 * np.length / (A.length + B.length);
  const layout = facetScore(tp, A, B, LAYOUT), style = facetScore(tp, A, B, STYLE);
  const bind = bindScore(tp.filter(([i]) => ['switch','input','button','text'].includes(A[i].role)), A, B);
  const overall = (tree + node + layout + style + bind) / 5;
  results.push({ kf, tree: +tree.toFixed(4), node: +node.toFixed(4), bind: +bind.toFixed(4), layout: +layout.toFixed(4), style: +style.toFixed(4), overall: +overall.toFixed(4) });
  console.log(` ${kf} |  ${String(A.length).padStart(3)} ${String(B.length).padStart(4)} | ${pct(tree).padStart(5)} ${pct(node).padStart(5)} ${pct(bind).padStart(5)} ${pct(layout).padStart(6)} ${pct(style).padStart(5)} | ${pct(overall)}`);
}
console.log('\n Extra metrics:');
for (const kf of ['K3', 'K4']) {
  const raw = fs.readFileSync(path.join(OUT, `${kf}.scene.json`)), gz = zlib.gzipSync(raw);
  console.log(`  ${kf} Scene Frame  ${(raw.length / 1024).toFixed(1)}KB → gzip ${(gz.length / 1024).toFixed(1)}KB (${(100 * gz.length / raw.length).toFixed(0)}%)`);
}
const impf = path.join(OUT, 'impact.saving.json');
if (fs.existsSync(impf)) { const j = JSON.parse(fs.readFileSync(impf)); console.log(`  Incremental (saving false→true)  ${j.changed}/${j.total} nodes recomputed = ${(100 * j.ratio).toFixed(1)}%`); }

// ── history (accuracy-over-time) + golden baseline (freeze, no hard gate yet) ──
const label = process.argv[3] || 'run';
fs.appendFileSync(path.join(DIR, 'metrics-history.jsonl'), JSON.stringify({ label, results }) + '\n');
const GOLD = path.join(DIR, 'golden');
if (process.argv[2] === 'bless') {
  fs.mkdirSync(GOLD, { recursive: true });
  for (const kf of ['K1', 'K2', 'K3', 'K4']) fs.copyFileSync(path.join(OUT, `${kf}.scene.json`), path.join(GOLD, `${kf}.scene.json`));
  fs.copyFileSync(path.join(DIR, 'general-settings-card.ir.json'), path.join(GOLD, 'general-settings-card.ir.json'));
  fs.writeFileSync(path.join(GOLD, 'metrics.baseline.json'), JSON.stringify(results, null, 2));
  console.log(`\n  ✓ blessed golden baseline "${label}" (frames + IR + metrics) → golden/`);
} else if (fs.existsSync(path.join(GOLD, 'metrics.baseline.json'))) {
  const bm = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(GOLD, 'metrics.baseline.json'))).map(r => [r.kf, r.overall]));
  let drift = 0;
  for (const kf of ['K1', 'K2', 'K3', 'K4']) { const g = path.join(GOLD, `${kf}.scene.json`); if (fs.existsSync(g) && String(fs.readFileSync(g)) !== String(fs.readFileSync(path.join(OUT, `${kf}.scene.json`)))) drift++; }
  console.log('\n  vs golden baseline (report-only, no gate):');
  for (const r of results) { const d = r.overall - (bm[r.kf] ?? r.overall); console.log(`   ${r.kf} ${pct(r.overall)}  ${d >= 0 ? '▲' : '▼'}${(100 * Math.abs(d)).toFixed(2)}`); }
  console.log(`   golden scene frames: ${drift ? drift + ' drifted — review, then re-bless' : 'all match'}`);
}
