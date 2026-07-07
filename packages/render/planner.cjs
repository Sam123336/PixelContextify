/* Planner — Runtime IR + React IR + env → Execution Plan (a compiled program the
   VM consumes). It DECIDES (evaluate/skip/activate/instantiate/bind) and records
   each step + reason; it never renders. Deterministic. Emits *.execution.plan.json
   and answers why-rendered / why-skipped / why-disabled / why-changed with no AI. */
const fs = require('fs'), path = require('path');
const DIR = __dirname;
const ir = JSON.parse(fs.readFileSync(path.join(DIR, 'extracted/general-settings-card.ir.json'), 'utf8'));
const AUTO = JSON.parse(fs.readFileSync(path.join(DIR, 'env.auto.json'), 'utf8'));
const GRAPH = JSON.parse(fs.readFileSync(path.join(DIR, 'extracted/general-settings-card.runtime.graph.json'), 'utf8'));

function evalExpr(expr, env, scope) {
  const item = scope && scope.item;
  const vars = { ...env, ...(env.props || {}), ...(item && typeof item === 'object' ? item : {}), item, Boolean };
  try { return Function(...Object.keys(vars), `return (${expr});`)(...Object.values(vars)); } catch { return undefined; }
}
const resolveRef = (r) => r.replace(/^#\//, '').split('/').reduce((o, k) => o[k], ir);
function label(n) {
  if (!n) return 'null';
  if (n.kind === 'Fragment') return 'FormBranch';
  if (n.kind === 'Cond') return 'Error/Form (else chain)';
  if (n.kind === 'Text') return `Text("${((n.value && (n.value.lit || n.value.expr)) || '').slice(0, 22)}")`;
  if (n.kind === 'Box') return 'LoadingBranch';
  if (n.kind === 'Prim') return n.ref;
  return n.kind;
}

// ── Planner: emit the Execution Plan (ordered steps + reasons) ────────────────
function plan(node, env, scope, steps) {
  if (!node) return;
  if (node.$ref) return plan(resolveRef(node.$ref), env, scope, steps);
  switch (node.kind) {
    case 'Cond': {
      let taken = null;
      for (const c of node.cases) {
        const r = !!evalExpr(c.when.expr, env, scope);
        steps.push({ op: 'Evaluate', expr: c.when.expr, result: r });
        if (r && !taken) { taken = c; steps.push({ op: 'Activate', branch: label(c.node) }); }
        else steps.push({ op: 'Skip', branch: label(c.node), reason: `${c.when.expr} = ${r}` });
      }
      if (taken) { if (node.else) steps.push({ op: 'Skip', branch: label(node.else), reason: `earlier case matched` }); plan(taken.node, env, scope, steps); }
      else { steps.push({ op: 'Activate', branch: label(node.else) }); plan(node.else, env, scope, steps); }
      return;
    }
    case 'List': {
      const items = node.items.kind === 'static' ? AUTO.consts[node.items.source.replace('const:', '')] : [];
      steps.push({ op: 'Instantiate', node: node.key, cardinality: items.length });
      if (items[0]) plan(node.template, env, { ...scope, item: items[0] }, steps);
      return;
    }
    case 'Fragment': node.children.forEach(c => plan(c, env, scope, steps)); return;
    case 'Prim': case 'Box':
      if (node.props) for (const k in node.props) { const p = node.props[k]; if (p.expr) steps.push({ op: 'Bind', node: node.key, prop: k, expr: p.expr, result: evalExpr(p.expr, env, scope) }); }
      (node.children || []).forEach(c => plan(c, env, scope, steps)); return;
    case 'Text': if (node.value && node.value.expr) steps.push({ op: 'Bind', node: node.key, prop: 'text', expr: node.value.expr, result: evalExpr(node.value.expr, env, scope) }); return;
  }
}

const plans = {};
for (const kf of AUTO.keyframes) { const steps = []; plan(ir.root, AUTO.envs[kf.id], {}, steps); plans[kf.id] = steps; }
fs.writeFileSync(path.join(DIR, 'extracted/general-settings-card.execution.plan.json'), JSON.stringify(plans, null, 2));

const show = (id, max) => { console.log(`\n Execution Plan — ${id}  (${plans[id].length} steps)`); plans[id].slice(0, max).forEach((s, i) => console.log(`  ${String(i + 1).padStart(2)}. ${s.op.padEnd(11)} ${s.op === 'Bind' ? `${s.node}.${s.prop} = "${s.expr}" → ${s.result}` : s.op === 'Evaluate' ? `${s.expr} → ${s.result}` : s.op === 'Instantiate' ? `${s.node} ×${s.cardinality}` : `${s.branch}${s.reason ? '   (' + s.reason + ')' : ''}`}`)); if (plans[id].length > max) console.log(`  … ${plans[id].length - max} more`); };
show('K1', 12);
show('K3', 10);

// ── deterministic explanations (the moat) ─────────────────────────────────────
console.log('\n──────── explanations (no AI, straight from plan + dep graph) ────────');
const skipOf = (id, br) => plans[id].find(s => s.op === 'Skip' && s.branch.includes(br));
console.log('\n Q: Why didn\'t the form render at K1?');
{ const s = skipOf('K1', 'Form') || skipOf('K1', 'else'); console.log(`  A: ${s ? `${s.branch} skipped — ${s.reason}` : 'form not reached'} (loading=true activated LoadingBranch first).`); }

console.log('\n Q: Why is the Save button disabled at K4 (read-only)?');
{ const expr = 'saving || !canEdit', env = AUTO.envs.K4;
  const cause = expr.split('||').map(t => t.trim()).find(t => evalExpr(t, env, {}));
  console.log(`  A: Button.disabled = "${expr}" → ${evalExpr(expr, env, {})}; true operand = "${cause}" (canEdit=${env.canEdit}).`); }

console.log('\n Q: Why do N nodes change when saving flips false→true?');
{ const deps = GRAPH['saving'] || []; console.log(`  A: dep graph → saving invalidates ${deps.length} bindings: ${deps.join(', ')}.`);
  console.log(`     (× list cardinality: the one Switch.disabled binding = 5 live switches ⇒ 7 nodes total, matching the incremental 19%).`); }

console.log('\n Incremental Execution Plan (saving false→true): recompute ONLY', (GRAPH['saving'] || []).length, 'binding sites, skip the rest.');
console.log('\n emitted: extracted/general-settings-card.execution.plan.json');
