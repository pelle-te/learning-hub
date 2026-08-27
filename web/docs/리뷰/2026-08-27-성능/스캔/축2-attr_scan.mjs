
import fs from 'node:fs';
import path from 'node:path';
const B64='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const CH=new Map([...B64].map((c,i)=>[c,i]));
function decodeVLQ(str){
  const out=[];let shift=0,value=0;
  for(const c of str){let d=CH.get(c);if(d===undefined)continue;
    const cont=d&32;d&=31;value+=d<<shift;
    if(cont){shift+=5;}else{const neg=value&1;let v=value>>1;if(neg)v=-v;out.push(v);shift=0;value=0;}}
  return out;
}
const NM='node_modules/';
function norm(s){
  let t=s.split(String.fromCharCode(92)).join('/');
  const i=t.lastIndexOf(NM);
  if(i>=0)t=NM+t.slice(i+NM.length);
  return t;
}
const dir=process.argv[2]||'dist-scan/assets';
const files=fs.readdirSync(dir).filter(f=>f.endsWith('.js.map'));
const global=new Map();
const perChunk={};
const chunkTot={};
for(const mf of files){
  const map=JSON.parse(fs.readFileSync(path.join(dir,mf),'utf8'));
  const jsFile=mf.replace(/\.map$/,'');
  const code=fs.readFileSync(path.join(dir,jsFile),'utf8');
  const lines=code.split('\n');
  const sources=(map.sources||[]).map(norm);
  const attr=new Map();
  let srcIdx=0;
  const groups=(map.mappings||'').split(';');
  for(let ln=0;ln<groups.length;ln++){
    const segs=groups[ln].split(',').filter(Boolean);
    let genCol=0;
    const lineLen=(lines[ln]||'').length+1;
    const parsed=[];
    for(const s of segs){
      const f=decodeVLQ(s);
      genCol+=f[0];
      if(f.length>=4){srcIdx+=f[1];}
      parsed.push({col:genCol,src:f.length>=4?srcIdx:null});
    }
    for(let i=0;i<parsed.length;i++){
      const start=parsed[i].col;
      const end=i+1<parsed.length?parsed[i+1].col:lineLen;
      const n=Math.max(0,end-start);
      const s=parsed[i].src;
      if(s==null)continue;
      const key=sources[s]||'?';
      attr.set(key,(attr.get(key)||0)+n);
    }
  }
  perChunk[jsFile]=attr;
  chunkTot[jsFile]=code.length;
  for(const[k,v]of attr)global.set(k,(global.get(k)||0)+v);
}
function report(m,label,top=40){
  const rows=[...m].sort((a,b)=>b[1]-a[1]);
  const tot=rows.reduce((a,b)=>a+b[1],0);
  console.log('\n### '+label+'  총 '+tot+' bytes(매핑분)');
  rows.slice(0,top).forEach(([k,v])=>console.log(String(v).padStart(8),(v/tot*100).toFixed(1).padStart(5)+'%',k));
}
const pkg=new Map();
for(const[k,v]of global){
  let name;
  if(k.indexOf(NM)>=0){const p=k.slice(k.indexOf(NM)+NM.length).split('/');name='pkg:'+(p[0].startsWith('@')?p[0]+'/'+p[1]:p[0]);}
  else name='src';
  pkg.set(name,(pkg.get(name)||0)+v);
}
report(pkg,'패키지별 (전 dist · raw bytes)',45);
report(global,'모듈별 (전 dist · raw bytes)',35);
for(const t of ['perf-','App-','main-Co','Today-','Schedule-','PhoneApp-','selectors-','main-a']){
  const key=Object.keys(perChunk).find(f=>f.startsWith(t));
  if(key)report(perChunk[key],'청크 '+key+' (파일 '+chunkTot[key]+'B)',20);
}
