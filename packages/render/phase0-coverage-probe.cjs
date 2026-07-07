/* Phase-0 coverage probe: of all layout-bearing styling in a React app,
   what fraction is Tailwind-utility (tractable) vs arbitrary vs custom/unknown
   vs opaque (CSS-in-JS / component-lib / inline / CSS-modules)?            */
const fs = require('fs');
const path = require('path');

const ROOTS_GEOM = ['w','h','min-w','max-w','min-h','max-h','size',
  'p','px','py','pt','pr','pb','pl','ps','pe','m','mx','my','mt','mr','mb','ml','ms','me',
  'space-x','space-y','gap','gap-x','gap-y','inset','inset-x','inset-y','top','right','bottom','left','start','end','z','order',
  'grid-cols','grid-rows','col','row','col-span','row-span','col-start','col-end','row-start','row-end','auto-cols','auto-rows',
  'justify','justify-items','justify-self','items','content','self','place-items','place-content','place-self',
  'basis','grow','shrink','flex','object','overflow','overscroll','float','clear','aspect','columns','box'];
const STAND_GEOM = ['flex','grid','block','inline','inline-block','inline-flex','inline-grid','table','flow-root','contents','hidden','list-item',
  'relative','absolute','fixed','sticky','static','isolate','container','grow','shrink'];
const ROOTS_VIS = ['text','font','leading','tracking','list','align','whitespace','break','line-clamp','indent','decoration','placeholder',
  'bg','from','via','to','border','divide','outline','ring','ring-offset','shadow','opacity','rounded','blur','backdrop','brightness','contrast','saturate','grayscale','invert','sepia','drop-shadow','filter',
  'fill','stroke','cursor','pointer-events','select','resize','scroll','snap','touch','will-change','accent','caret','appearance',
  'transition','duration','ease','delay','animate','transform','translate','rotate','scale','skew','origin','mix-blend'];
const STAND_VIS = ['border','rounded','shadow','ring','outline','truncate','italic','not-italic','underline','overline','line-through','no-underline',
  'uppercase','lowercase','capitalize','normal-case','antialiased','transform','transition','group','peer','sr-only','not-sr-only',
  'cursor-pointer','pointer-events-none','select-none','appearance-none'];

function stripVar(t){ const p = t.split(':'); return p[p.length-1]; }
function classify(raw){
  let tok = raw.trim(); if(!tok || /[<>{}()]/.test(tok)) return null;
  let base = stripVar(tok);
  const arbitrary = base.includes('[');
  if(base.startsWith('-')) base = base.slice(1);
  if(base.startsWith('!')) base = base.slice(1);
  if(base==='group'||base==='peer'||base.startsWith('group/')||base.startsWith('peer/')) return {recognized:true,geom:false,arbitrary,base};
  const hit = (list)=> list.some(r=> base===r || base.startsWith(r+'-') || base.startsWith(r+'/'));
  const geom = hit(ROOTS_GEOM) || STAND_GEOM.includes(base);
  const vis  = hit(ROOTS_VIS)  || STAND_VIS.includes(base);
  return { recognized: geom||vis, geom, arbitrary, base };
}
function classStrings(src){
  const out=[]; const re=/(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g; let m;
  while((m=re.exec(src))){
    let s=m[2]; if(m[1]==='`') s=s.replace(/\$\{[^}]*\}/g,' ');
    if(!s||s.length<2||!/[a-z]/.test(s)) continue;
    const toks=s.split(/\s+/).filter(Boolean); if(!toks.length) continue;
    let recog=0, classy=0;
    for(const t of toks){ if(/^[a-z0-9:_/\[\].,#%!+-]+$/i.test(t)){ const c=classify(t); if(c){classy++; if(c.recognized)recog++;} } }
    if(classy && recog/toks.length>=0.5) out.push(toks);
  }
  return out;
}
function imports(src){
  const o={cssInJs:false,compLib:[],radix:false,shadcn:false,cssMod:false,framer:false};
  const re=/from\s*['"]([^'"]+)['"]/g; let m;
  while((m=re.exec(src))){ const p=m[1];
    if(/styled-components|@emotion|@stitches|goober|linaria/.test(p)) o.cssInJs=true;
    if(/@mui\/|@material-ui\/|antd|@chakra-ui\/|@mantine\/|react-bootstrap|@nextui-org\/|@fluentui\/|semantic-ui-react|@blueprintjs\/|primereact|rsuite|grommet/.test(p)) o.compLib.push(p.split('/').slice(0,2).join('/'));
    if(/@radix-ui\//.test(p)) o.radix=true;
    if(/components\/ui(\/|$)/.test(p)) o.shadcn=true;
    if(/\.module\.(css|scss|sass|less)$/.test(p)) o.cssMod=true;
    if(/framer-motion/.test(p)) o.framer=true;
  }
  o.inline=(src.match(/style=\{\{/g)||[]).length;
  o.cn=(src.match(/className\s*=/g)||[]).length;
  return o;
}
function walk(dir,acc){ let es; try{es=fs.readdirSync(dir,{withFileTypes:true});}catch{return;}
  for(const e of es){ if(['node_modules','.next','.git','dist','build','public','coverage','.turbo'].includes(e.name)) continue;
    const fp=path.join(dir,e.name);
    if(e.isDirectory()) walk(fp,acc);
    else if(/\.(tsx|jsx)$/.test(e.name)&&!/\.(test|spec|stories)\.(tsx|jsx)$/.test(e.name)) acc.push(fp); } }

for(const root of process.argv.slice(2)){
  const files=[]; walk(root,files);
  let tT=0,tR=0,tA=0,tU=0, gT=0,gR=0,gA=0, cS=0,cn=0,inl=0, cij=0,rdx=0,shad=0,csm=0,fmr=0;
  const libs={}, unk={};
  for(const f of files){ let src; try{src=fs.readFileSync(f,'utf8');}catch{continue;}
    const im=imports(src); cn+=im.cn; inl+=im.inline;
    if(im.cssInJs)cij++; if(im.radix)rdx++; if(im.shadcn)shad++; if(im.cssMod)csm++; if(im.framer)fmr++;
    for(const l of im.compLib) libs[l]=(libs[l]||0)+1;
    for(const toks of classStrings(src)){ cS++;
      for(const t of toks){ const c=classify(t); if(!c) continue; tT++;
        if(c.arbitrary){tA++; if(c.geom){gT++;gA++;}}
        else if(c.recognized){tR++; if(c.geom){gT++;gR++;}}
        else {tU++; unk[c.base]=(unk[c.base]||0)+1;} } }
  }
  const pct=(a,b)=> b? (100*a/b).toFixed(1)+'%':'-';
  const topUnk=Object.entries(unk).sort((a,b)=>b[1]-a[1]).slice(0,22).map(([k,v])=>`${k}(${v})`).join(' ');
  console.log('\n============================================================');
  console.log('APP:', path.basename(root));
  console.log('  files(tsx/jsx):', files.length, ' className= sites:', cn, ' class-strings parsed:', cS);
  console.log('  styling tokens:', tT);
  console.log('    Tailwind recognized :', tR, pct(tR,tT));
  console.log('    arbitrary  [..]     :', tA, pct(tA,tT));
  console.log('    unknown / custom    :', tU, pct(tU,tT));
  console.log('  geometry-bearing tokens:', gT, ' (recognized', pct(gR,gT), '+ arbitrary', pct(gA,gT),')');
  console.log('  --- opaque / leak signals ---');
  console.log('    inline style={{}}   :', inl, 'sites');
  console.log('    CSS-in-JS files     :', cij);
  console.log('    CSS-module files    :', csm);
  console.log('    component-lib imports:', Object.keys(libs).length? JSON.stringify(libs):'NONE');
  console.log('    Radix (headless) files:', rdx, ' shadcn ui files:', shad, ' framer-motion files:', fmr);
  console.log('  top unknown/custom tokens:', topUnk||'(none)');
}
console.log('\n[note] "Tailwind recognized" incl. all utility roots; "arbitrary" = w-[..] etc (parseable); "unknown" = custom classes the compiler cannot read from class names alone.');
