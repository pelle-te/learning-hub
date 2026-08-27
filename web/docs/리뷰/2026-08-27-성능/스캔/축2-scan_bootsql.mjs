
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
const MIG='../src-tauri/migrations';
const files=fs.readdirSync(MIG).filter(f=>f.endsWith('.sql')).sort();
function fresh(){
  const db=new DatabaseSync(':memory:');
  for(const f of files){ db.exec(fs.readFileSync(path.join(MIG,f),'utf8')); }
  return db;
}
const QUERIES=[
 ['meta','SELECT key, value FROM meta'],
 ['settings','SELECT key, value FROM settings'],
 ['runtime_cache','SELECT key, value FROM runtime_cache'],
 ['completions','SELECT ds, k, value FROM completions'],
 ['ds_map','SELECT slice, ds, value FROM ds_map'],
 ['records','SELECT slice, id, ord, value FROM records ORDER BY slice, ord'],
 ['summaries','SELECT sid, id, ord, value FROM summaries ORDER BY sid, ord'],
 ['week_alloc','SELECT wk, sid, value FROM week_alloc'],
];
const MAXSTAMP=`SELECT MAX(m) AS m FROM (
  SELECT MAX(updated_at) AS m FROM settings
  UNION ALL SELECT MAX(updated_at) FROM completions
  UNION ALL SELECT MAX(updated_at) FROM ds_map
  UNION ALL SELECT MAX(updated_at) FROM records
  UNION ALL SELECT MAX(updated_at) FROM summaries
  UNION ALL SELECT MAX(updated_at) FROM week_alloc
  UNION ALL SELECT MAX(updated_at) FROM docs
  UNION ALL SELECT MAX(deleted_at) FROM tombstones)`;
const val=(n)=>JSON.stringify({id:'x'+n,t:'제목 '+n,note:'가나다라마바사 '.repeat(6),n,d:[1,2,3,4,5]});
function seed(db,N){
  db.exec('BEGIN');
  const rec=db.prepare('INSERT INTO records(slice,id,ord,value,updated_at) VALUES(?,?,?,?,?)');
  const slices=['events','tasks','questions','retrievals','backlog','cbms','retentionLog','blankResults','jolAsks'];
  for(let i=0;i<N;i++) rec.run(slices[i%slices.length], 'id'+i, i, val(i), 1000+i);
  const comp=db.prepare('INSERT INTO completions(ds,k,value,updated_at) VALUES(?,?,?,?)');
  for(let i=0;i<Math.round(N/4);i++) comp.run('2026-0'+(1+i%9)+'-01','k'+i,val(i),1000+i);
  const dsm=db.prepare('INSERT INTO ds_map(slice,ds,value,updated_at) VALUES(?,?,?,?)');
  const dsl=['dayOverrides','dayPlans','rituals','resume'];
  for(let i=0;i<Math.round(N/8);i++) dsm.run(dsl[i%4],'2026-01-'+String(1+i%28).padStart(2,'0')+'-'+i,val(i),1000+i);
  const sm=db.prepare('INSERT INTO summaries(sid,id,ord,value,updated_at) VALUES(?,?,?,?,?)');
  for(let i=0;i<Math.round(N/8);i++) sm.run('s'+(i%40),'sid'+i,i,val(i),1000+i);
  const wa=db.prepare('INSERT INTO week_alloc(wk,sid,value,updated_at) VALUES(?,?,?,?)');
  for(let i=0;i<Math.round(N/20);i++) wa.run('2026-W'+String(1+i%52).padStart(2,'0')+'-'+i,'s'+(i%40),val(i),1000+i);
  const st=db.prepare('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?)');
  for(let i=0;i<40;i++) st.run('key'+i,val(i),1000+i);
  db.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run('present','["a","b"]');
  db.exec('COMMIT');
}
function count(db){let t=0;for(const[n]of QUERIES){try{t+=db.prepare('SELECT COUNT(*) c FROM '+n).get().c;}catch{}}return t;}
console.log('| 총 행 | readRows SQL 합(ms) | 최대 단일 질의 | readMaxStamp(ms) | 결과 행 수 |');
console.log('|---|---|---|---|---|');
for(const N of [500,2000,5000,10000,25000,50000]){
  const db=fresh(); seed(db,N);
  const total=count(db);
  // warm
  for(const[,q]of QUERIES) db.prepare(q).all();
  let sum=0,worst=['',0],rows=0;
  const per={};
  for(const[n,q]of QUERIES){
    const st=db.prepare(q);
    let best=Infinity;
    for(let k=0;k<5;k++){const t0=performance.now();const r=st.all();const dt=performance.now()-t0;if(dt<best){best=dt;rows=r.length;}}
    per[n]=best; sum+=best; if(best>worst[1])worst=[n,best];
  }
  let ms=Infinity;
  for(let k=0;k<5;k++){const t0=performance.now();db.prepare(MAXSTAMP).get();const dt=performance.now()-t0;if(dt<ms)ms=dt;}
  console.log('| '+total+' | '+sum.toFixed(2)+' | '+worst[0]+' '+worst[1].toFixed(2)+' | '+ms.toFixed(2)+' | '+JSON.stringify(per,(k,v)=>typeof v==='number'?+v.toFixed(2):v)+' |');
  db.close();
}
