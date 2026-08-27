
import { transformAsync } from '@babel/core';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
const BS = String.fromCharCode(92);
function srcs(dir){const out=[];for(const e of readdirSync(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())out.push(...srcs(p));else if(/\.tsx?$/.test(e.name)&&!e.name.endsWith('.d.ts'))out.push(p);}return out;}
const files=srcs('src');
const res={tsx:{opt:0,tot:0},ts:{opt:0,tot:0}};
const tsOpt=[];
for(const f of files){
  const isx=f.endsWith('.tsx');
  const k=isx?'tsx':'ts'; res[k].tot++;
  const names=[];
  try{
    await transformAsync(readFileSync(f,'utf8'),{filename:f,babelrc:false,configFile:false,sourceMaps:false,
      parserOpts:{plugins:['typescript','jsx']},
      plugins:[['babel-plugin-react-compiler',{logger:{logEvent(_fn,e){if(e.kind==='CompileSuccess')names.push(e.fnName||'?');}}}]]});
  }catch{continue;}
  if(names.length){res[k].opt++; if(!isx)tsOpt.push(relative('.',f).split(BS).join('/')+'  ['+names.join(',')+']');}
}
console.log('React Compiler 가 실제로 최적화(CompileSuccess)한 파일');
console.log('  .tsx :', res.tsx.opt,'/',res.tsx.tot);
console.log('  .ts  :', res.ts.opt,'/',res.ts.tot);
console.log('--- 최적화된 .ts 목록 ---');
tsOpt.forEach(x=>console.log('  '+x));
