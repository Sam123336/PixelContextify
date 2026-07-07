/* RenderContextify VM v0 — evaluate the private React IR against a keyframe env,
   resolve a flexbox-subset layout, emit a Scene Frame (the renderer contract),
   then render SVG. Written against the STRUCTURAL CORE only (Box/Text/Leaf/
   Cond/List/Binding); Prim refs are opaque leaves rendered by name. No VSIR.   */
const fs = require('fs');
const path = require('path');
const DIR = __dirname;
const IR_PATH = process.argv[2] ? path.resolve(process.argv[2]) : path.join(DIR, 'extracted', 'general-settings-card.ir.json');
const ir = JSON.parse(fs.readFileSync(IR_PATH, 'utf8'));
const OUT = path.join(DIR, 'out'); fs.mkdirSync(OUT, { recursive: true });

// ── the const the compiler would have lifted from source ──────────────────────
const TOGGLES = [
  { key: 'isOnlinePaymentEnabled', label: 'Online payment', help: 'Allow customers to pay online (UPI / card) in this city.' },
  { key: 'isWhatsappNotificationEnabled', label: 'WhatsApp notifications', help: 'Send order updates to customers over WhatsApp.' },
  { key: 'isCancelableEnabled', label: 'Order cancellable', help: 'Allow customers to cancel orders in this city.' },
  { key: 'blockOrderCreationWhenNoPartnerAvailable', label: 'Block orders when no partner available', help: 'Stop new orders when no delivery partner is available.' },
  { key: 'blockOnlinePaymentWhenNoPartnerAvailable', label: 'Block online payment when no partner available', help: 'Disable online payment when no delivery partner is available.' },
];
const _AUTO = fs.existsSync(path.join(DIR, 'env.auto.json')) ? JSON.parse(fs.readFileSync(path.join(DIR, 'env.auto.json'), 'utf8')) : null;
const CONSTS = _AUTO ? _AUTO.consts : { TOGGLES };

// ── fixtures from the ExtraDetails type + TOGGLES keys (no backend) ────────────
const fixtureED = {
  isOnlinePaymentEnabled: true, isWhatsappNotificationEnabled: false, isCancelableEnabled: true,
  blockOrderCreationWhenNoPartnerAvailable: false, blockOnlinePaymentWhenNoPartnerAvailable: false,
  payment: { qrCode: 'https://cdn.belivmart.example/qr/city_123.png' },
};
const togglesFrom = (ed) => Object.fromEntries(TOGGLES.map((t) => [t.key, Boolean(ed[t.key])]));
const base = { props: { id: 'city_123' }, saving: false, canEdit: true, toggles: {}, qrCode: '', extraDetails: null };
const ENVS = _AUTO ? _AUTO.envs : {
  K1: { ...base, loading: true },
  K2: { ...base, loading: false, extraDetails: null },
  K3: { ...base, loading: false, extraDetails: fixtureED, canEdit: false, toggles: togglesFrom(fixtureED), qrCode: fixtureED.payment.qrCode },
  K4: { ...base, loading: false, extraDetails: fixtureED, canEdit: true,  toggles: togglesFrom(fixtureED), qrCode: fixtureED.payment.qrCode },
};

// ── expression evaluator over {state, props, item} ────────────────────────────
function evalExpr(expr, env, scope) {
  const vars = { ...env, ...env.props, ...(scope && scope.item && typeof scope.item === 'object' ? scope.item : {}), item: scope && scope.item, Boolean };
  try { return Function(...Object.keys(vars), `return (${expr});`)(...Object.values(vars)); }
  catch (e) { return undefined; }
}
function resolveRef(ref) { // "#/variants/Loading"
  return ref.replace(/^#\//, '').split('/').reduce((o, k) => o[k], ir);
}
function val(v, env, scope) { return v == null ? '' : ('lit' in v ? v.lit : evalExpr(v.expr, env, scope)); }

// ── text sizing + shadcn leaf defaults (approx; the oracle will quantify) ─────
const CW = { xs: 5.4, sm: 6.4, base: 7.6, '2xl': 11.5 }, LH = { xs: 16, sm: 20, base: 26, '2xl': 30 };

// ── EVALUATE: IR + env → concrete scene tree (Cond/List/refs resolved) ────────
const J = (p, k) => (p ? p + '/' + k : k); // structural id path — deterministic, stable across evaluations
function evalNode(node, env, scope, prefix) {
  prefix = prefix || '';
  if (!node) return null;
  if (node.$ref) return evalNode(resolveRef(node.$ref), env, scope, prefix);
  switch (node.kind) {
    case 'Cond': {
      for (const c of node.cases) if (evalExpr(c.when.expr, env, scope)) return evalNode(c.node, env, scope, prefix);
      return node.else ? evalNode(node.else, env, scope, prefix) : null;
    }
    case 'List': {
      const items = node.items.kind === 'static' ? CONSTS[node.items.source.replace('const:', '')] : [];
      const kids = items.map((it) => evalNode(node.template, env, { ...scope, item: it }, J(prefix, String(it[node.itemKey])))).filter(Boolean);
      return { transparent: true, children: kids }; // .map() emits no DOM wrapper — splice into parent
    }
    case 'Fragment':
      return { transparent: true, children: evalKids(node.children, env, scope, prefix) }; // <>…</> emits no DOM node
    case 'Box':
      return { role: 'container', id: J(prefix, node.key), ...facets(node), children: evalKids(node.children, env, scope, prefix) };
    case 'Text':
      return { role: 'text', id: J(prefix, node.key), text: String(val(node.value, env, scope)), size: (node.text && node.text.size) || 'sm', color: node.text && node.text.color };
    case 'Icon':
      return { role: 'leaf', ref: 'Icon', id: J(prefix, node.key), anim: node.anim, w: 16, h: 16 };
    case 'Prim': return evalPrim(node, env, scope, prefix);
    default: return null;
  }
}
function evalKids(arr, env, scope, prefix) {
  const out = [];
  for (const n of arr || []) { const r = evalNode(n, env, scope, prefix); if (!r) continue; if (r.transparent) out.push(...(r.children || [])); else out.push(r); }
  return out;
}
function facets(node) {
  const L = node.layout || {}, S = node.style || {};
  return { dir: L.direction || 'col', gap: L.gap || 0, justify: L.justify, align: L.align,
           pad: S.padding || 0, border: S.border || 0, radius: S.radius || 0 };
}
function childText(node, env, scope) { // resolve visible text of children (handles Cond, e.g. saving ? 'Saving…' : 'Save')
  const parts = [];
  (function collect(kids) {
    for (const c of kids || []) {
      if (!c) continue;
      if (c.kind === 'Text') parts.push(String(val(c.value, env, scope)));
      else if (c.kind === 'Cond') { let ch = null; for (const cs of c.cases) if (evalExpr(cs.when.expr, env, scope)) { ch = cs.node; break; } ch = ch || c.else; if (ch) collect([ch]); }
      else if (c.children) collect(c.children);
    }
  })(node.children);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}
function evalPrim(node, env, scope, prefix) {
  const ref = node.ref, p = node.props || {}, id = J(prefix, node.key);
  const resolved = {}; for (const k in p) resolved[k] = val(p[k], env, scope);
  if (ref === 'CardTitle')       return { role: 'text', id, text: childText(node, env, scope), size: '2xl', weight: 600 };
  if (ref === 'CardDescription') return { role: 'text', id, text: childText(node, env, scope), size: 'sm', color: 'muted-foreground' };
  if (ref === 'Label')           return { role: 'text', id, text: childText(node, env, scope), size: 'sm', weight: 500 };
  if (ref === 'Switch')          return { role: 'leaf', ref, id, w: 40, h: 24, checked: !!resolved.checked, enabled: !resolved.disabled };
  if (ref === 'Input')           return { role: 'leaf', ref, id, h: 38, text: resolved.value || resolved.placeholder || '', enabled: !resolved.disabled };
  if (ref === 'Button')          return { role: 'leaf', ref, id, text: childText(node, env, scope), enabled: !resolved.disabled };
  // Card / CardHeader / CardContent → containers with shadcn default box model
  const defaults = {
    Card:        { dir: 'col', pad: 0,  gap: 0,  border: 1, radius: 8 },
    CardHeader:  { dir: 'col', pad: 24, gap: 6 },
    CardContent: { dir: 'col', pad: 24, padTop: 0, gap: (node.layout && node.layout.gap) || 16 },
  }[ref] || { dir: 'col', pad: 0, gap: 0 };
  return { role: 'container', id, ref, ...defaults, children: evalKids(node.children, env, scope, prefix) };
}

// ── LAYOUT: flexbox subset (measure ↑ then place ↓) ───────────────────────────
function measure(n, availW) {
  if (n.role === 'text') {
    const cw = CW[n.size] || 6.4, lh = LH[n.size] || 20;
    const full = (n.text || '').length * cw;
    n._w = Math.min(full, availW); n._h = Math.max(1, Math.ceil(full / Math.max(availW, 1))) * lh;
    return { w: n._w, h: n._h };
  }
  if (n.role === 'leaf') {
    if (n.ref === 'Input') { n._w = availW; n._h = 38; }
    else if (n.ref === 'Button') { n._w = Math.min((n.text || '').length * 7 + 32, availW); n._h = 36; }
    else { n._w = n.w != null ? n.w : 16; n._h = n.h != null ? n.h : 20; }
    return { w: n._w, h: n._h };
  }
  const pad = n.pad || 0, gap = n.gap || 0, innerW = Math.max(0, availW - 2 * pad);
  if (n.dir === 'row') {
    let maxH = 0, sumW = 0;
    for (const c of n.children) { const m = measure(c, innerW); maxH = Math.max(maxH, m.h); sumW += m.w; }
    n._h = maxH + 2 * pad; n._w = availW; return { w: n._w, h: n._h };
  }
  let sumH = 0; const ch = n.children || [];
  for (const c of ch) sumH += measure(c, innerW).h;
  sumH += gap * Math.max(0, ch.length - 1);
  n._h = sumH + pad + (n.padTop != null ? n.padTop : pad); n._w = availW; return { w: n._w, h: n._h };
}
function place(n, x, y, w) {
  n.rect = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(n._h) };
  const ch = n.children || []; if (!ch.length) return;
  const pad = n.pad || 0, gap = n.gap || 0, innerW = Math.max(0, w - 2 * pad), rowH = n._h - 2 * pad, cy0 = y + pad;
  if (n.dir === 'row') {
    if (n.justify === 'space-between' && ch.length >= 2) {
      const f = ch[0], l = ch[ch.length - 1];
      place(f, x + pad, cy0 + (rowH - f._h) / 2, f._w);
      place(l, x + w - pad - l._w, cy0 + (rowH - l._h) / 2, l._w);
    } else if (n.justify === 'end') {
      let cx = x + w - pad; for (let i = ch.length - 1; i >= 0; i--) { const c = ch[i]; cx -= c._w; place(c, cx, cy0 + (rowH - c._h) / 2, c._w); cx -= gap; }
    } else {
      let cx = x + pad; for (const c of ch) { place(c, cx, cy0 + (rowH - c._h) / 2, c._w); cx += c._w + gap; }
    }
  } else {
    let cy = y + (n.padTop != null ? n.padTop : pad); for (const c of ch) { place(c, x + pad, cy, innerW); cy += c._h + gap; }
  }
}

// ── FLATTEN → Scene Frame (the contract) ──────────────────────────────────────
function flatten(n, parent, out) {
  const rec = { id: n.id, kind: n.ref || n.role, x: n.rect.x, y: n.rect.y, w: n.rect.w, h: n.rect.h, visible: true, parent };
  if (n.text != null) rec.text = n.text;
  if (n.enabled != null) rec.enabled = n.enabled;
  if (n.checked != null) rec.checked = n.checked;
  if (n.anim) rec.anim = n.anim;
  if (n.border) { rec.border = n.border; rec.radius = n.radius || 8; }
  if (n.size) rec.size = n.size;
  if (n.weight) rec.weight = n.weight;
  if (n.color) rec.color = n.color;
  if (n.dir) rec.dir = n.dir;
  if (n.gap != null) rec.gap = n.gap;
  if (n.pad != null) rec.pad = n.pad;
  if (n.padTop != null) rec.padTop = n.padTop;
  if (n.justify) rec.justify = n.justify;
  if (n.align) rec.align = n.align;
  out.push(rec);
  for (const c of (n.children || [])) flatten(c, n.id, out);
  return out;
}

// ── SVG (one consumer of the Scene Frame) ─────────────────────────────────────
function svg(frame, W, H) {
  const esc = (s) => String(s).replace(/[<&>]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;' }[c]));
  const clip = (s, w) => { const max = Math.floor(w / 6) + 1; return s.length > max ? s.slice(0, max - 1) + '…' : s; };
  let b = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="ui-sans-serif,system-ui" font-size="13">`;
  b += `<rect width="${W}" height="${H}" fill="#f8fafc"/>`;
  for (const n of frame) {
    const { x, y, w, h } = n;
    if (n.kind === 'Card' || n.kind === 'Box' || n.kind === 'container') {
      if (n.border) b += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${n.radius || 8}" fill="#fff" stroke="#e2e8f0"/>`;
    } else if (n.kind === 'Switch') {
      b += `<rect x="${x}" y="${y}" width="40" height="24" rx="12" fill="${n.checked ? '#0f172a' : '#cbd5e1'}" opacity="${n.enabled ? 1 : .45}"/>`;
      b += `<circle cx="${x + (n.checked ? 28 : 12)}" cy="${y + 12}" r="9" fill="#fff"/>`;
    } else if (n.kind === 'Input') {
      b += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="#fff" stroke="#e2e8f0" opacity="${n.enabled ? 1 : .55}"/>`;
      b += `<text x="${x + 10}" y="${y + 24}" fill="#94a3b8">${esc(clip(n.text || '', w - 20))}</text>`;
    } else if (n.kind === 'Button') {
      b += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="#0f172a" opacity="${n.enabled ? 1 : .45}"/>`;
      b += `<text x="${x + w / 2}" y="${y + 23}" fill="#fff" text-anchor="middle">${esc(n.text || '')}</text>`;
    } else if (n.kind === 'Icon') {
      b += `<circle cx="${x + 8}" cy="${y + 8}" r="7" fill="none" stroke="#64748b" stroke-width="2" stroke-dasharray="30 10"/>`;
    } else if (n.kind === 'text') {
      const fs = n.size === '2xl' ? 24 : n.size === 'base' ? 18 : n.size === 'xs' ? 11 : 13;
      const fill = n.color === 'destructive' ? '#dc2626' : n.color === 'muted-foreground' ? '#64748b' : '#0f172a';
      b += `<text x="${x}" y="${y + fs}" fill="${fill}" font-size="${fs}" font-weight="${n.weight || 400}">${esc(clip(n.text || '', w + 8))}</text>`;
    }
  }
  return b + '</svg>';
}

// ── run all four keyframes ────────────────────────────────────────────────────
const W = 520, PAGE = 16, cardW = W - 2 * PAGE;
const summary = [];
const KEYFRAMES = ir.structuralKeyframes || (_AUTO ? _AUTO.keyframes : [{ id: 'K1', label: 'Loading' }, { id: 'K2', label: 'Error' }, { id: 'K3', label: 'Form read-only' }, { id: 'K4', label: 'Form editable' }]);
for (const kf of KEYFRAMES) {
  const env = ENVS[kf.id];
  const t0 = performance.now();
  const tree = evalNode(ir.root, env, {});
  const t1 = performance.now();
  measure(tree, cardW); place(tree, PAGE, PAGE, cardW);
  const t2 = performance.now();
  const H = tree.rect.y + tree.rect.h + PAGE;
  const frame = flatten(tree, null, []);
  const t3 = performance.now();
  const svgStr = svg(frame, W, H);
  const t4 = performance.now();
  fs.writeFileSync(path.join(OUT, `${kf.id}.scene.json`), JSON.stringify(frame, null, 2));
  fs.writeFileSync(path.join(OUT, `${kf.id}.svg`), svgStr);
  summary.push({ id: kf.id, nodes: frame.length,
    evalMs: +(t1 - t0).toFixed(3), layoutMs: +(t2 - t1).toFixed(3), svgMs: +(t4 - t3).toFixed(3),
    frameKB: +(Buffer.byteLength(JSON.stringify(frame)) / 1024).toFixed(1),
    svgKB: +(Buffer.byteLength(svgStr) / 1024).toFixed(1) });
}
console.log('Keyframe | nodes | eval | layout | svg | frame | svg-size  (cost benchmark)');
for (const s of summary) console.log(`  ${s.id}  |  ${String(s.nodes).padStart(2)}  | ${String(s.evalMs).padStart(6)}ms | ${String(s.layoutMs).padStart(5)}ms | ${String(s.svgMs).padStart(5)}ms | ${s.frameKB}KB | ${s.svgKB}KB`);
console.log('\n── K4 (Form editable) Scene Frame — leaf/interactive nodes ──');
const k4 = JSON.parse(fs.readFileSync(path.join(OUT, 'K4.scene.json'), 'utf8'));
for (const n of k4) if (['Switch', 'Input', 'Button', 'Icon'].includes(n.kind) || (n.kind === 'text' && n.text))
  console.log(`  ${n.kind.padEnd(9)} [${String(n.x).padStart(3)},${String(n.y).padStart(3)} ${String(n.w).padStart(3)}x${String(n.h).padStart(2)}] ${n.enabled != null ? (n.enabled ? 'on ' : 'off') : '   '} ${n.checked != null ? (n.checked ? '☑' : '☐') : ' '} ${JSON.stringify(n.text || '').slice(0, 42)}`);

// ── visual impact analysis: flip saving false→true, diff Scene Frames by id ───
function frameOf(env) { const t = evalNode(ir.root, env, {}); measure(t, cardW); place(t, PAGE, PAGE, cardW); return flatten(t, null, []); }
const A = frameOf(ENVS.K4), B = frameOf({ ...ENVS.K4, saving: true });
const byId = (f) => Object.fromEntries(f.map((n) => [n.id, n]));
const a = byId(A), b = byId(B), changed = [];
for (const id in b) {
  const x = a[id], y = b[id], d = [];
  if (!x) { changed.push([id, 'added']); continue; }
  if (x.text !== y.text) d.push(`text ${JSON.stringify(x.text)}→${JSON.stringify(y.text)}`);
  if (x.enabled !== y.enabled) d.push(`enabled ${x.enabled}→${y.enabled}`);
  if (d.length) changed.push([id, d.join(', ')]);
}
console.log('\n── Visual impact of  saving:false→true  (Scene Frame diff, zero re-render) ──');
for (const c of changed) console.log('  ✱', c[0], '—', c[1]);
console.log(`  → ${changed.length} nodes changed, ${A.length - changed.length} unchanged (stable id ⇒ free tween correspondence).`);
fs.writeFileSync(path.join(OUT, 'impact.saving.json'), JSON.stringify({ total: A.length, changed: changed.length, ratio: +(changed.length / A.length).toFixed(3) }, null, 2));
