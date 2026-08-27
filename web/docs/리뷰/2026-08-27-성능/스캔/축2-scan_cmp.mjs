
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
function graph(dir,entry,then){
  const m=JSON.parse(fs.readFileSync(path.join(dir,'.vite/manifest.json'),'utf8'));
  const seen=new Set(),js=new Set(),css=new Set();
  const walk=k=>{const c=m[k];if(!c||seen.has(k))return;seen.add(k);if(c.file)js.add(c.file);for(const f of c.css||[])css.add(f);for(const d of c.imports||[])walk(d);};
  walk(entry); if(then)walk(then);
  const sz=s=>[...s].reduce((a,f)=>a+zlib.gzipSync(fs.readFileSync(path.join(dir,f)),{level:9}).length,0);
  return {js:sz(js)/1024, css:sz(css)/1024, files:[...js]};
}
function total(dir){
  const a=path.join(dir,'assets');
  let raw=0,gz=0;
  for(const f of fs.readdirSync(a)){const b=fs.readFileSync(path.join(a,f));raw+=b.length;gz+=zlib.gzipSync(b,{level:9}).length;}
  return {raw:raw/1024,gz:gz/1024};
}
const rows=[];
for(const [label,dir] of [['현행(React Compiler ON)','dist'],['컴파일러 OFF','dist-nobabel']]){
  const d=graph(dir,'index.html');
  const w=graph(dir,'index.html','src/app/App.tsx');
  const p=graph(dir,'phone.html');
  const t=total(dir);
  rows.push([label,d.js,d.css,w.js,p.js,p.css,t.gz,t.raw]);
}
console.log('| 측정 | 데스크톱 초기 js(gz KB) | 데스크톱 css | 부팅 웨이브 js | 폰 초기 js | 폰 css | dist/assets 총 gz | 총 raw |');
console.log('|---|---|---|---|---|---|---|---|');
for(const r of rows)console.log('| '+r[0]+' | '+r.slice(1).map(x=>x.toFixed(1)).join(' | ')+' |');
const d=rows[0],n=rows[1];
console.log('| **차이(컴파일러가 더함)** | '+[1,2,3,4,5,6,7].map(i=>'+'+(d[i]-n[i]).toFixed(1)).join(' | ')+' |');
