/* ============================================================
   ui-vault.js — 탭3: 옵시디언 볼트 현황 (File System Access API)
============================================================ */
function renderVault(p){
  const v=state._vaultScan;
  p.innerHTML=`
  <div class="card">
    <h2>옵시디언 볼트 현황</h2>
    <div class="row">
      <button class="sm primary" onclick="scanVault()">📁 볼트 폴더 ${vaultHandle?'다시 ':''}스캔</button>
      <div style="flex:3"></div>
    </div>
    <div class="foot">전공 폴더를 고르면 과목→챕터→노트 수와 검증/Anki 상태(YAML)를 읽습니다. 항목 옆 '+스케줄'로 바로 학습 항목에 넣어요. (Chrome/Edge)</div>
    <div id="scanStat"></div>
  </div>
  <div id="vaultTree"></div>`;
  if(v)renderVaultTree(v);
}
async function scanVault(){
  const st=document.getElementById('scanStat');
  if(!window.showDirectoryPicker){st.innerHTML='<div class="warnbox">이 브라우저는 폴더 연결 미지원. Chrome/Edge에서 열어주세요.</div>';return;}
  try{vaultHandle=await window.showDirectoryPicker();}catch(e){return;}
  st.innerHTML='<div style="margin-top:8px"><span class="spin"></span> 스캔 중...</div>';
  const subjects=[];
  for await(const [name,h] of vaultHandle.entries()){
    if(h.kind!=='directory'||name.startsWith('_')||SKIP.has(name))continue;
    const subj={name,chapters:[],notes:0,verified:0,exported:0};
    for await(const [cn,ch] of h.entries()){
      if(ch.kind==='directory'){
        if(cn.startsWith('_')||SKIP.has(cn))continue;
        const chap={name:cn,notes:0,verified:0,exported:0};
        for await(const [fn,fh] of ch.entries()){
          if(fh.kind!=='file'||!fn.endsWith('.md')||fn.includes('MOC'))continue;
          chap.notes++; const fm=await readFM(fh);
          if((fm.status||'').includes('verified'))chap.verified++;
          if(fm.anki_exported)chap.exported++;
        }
        if(chap.notes){subj.chapters.push(chap);subj.notes+=chap.notes;subj.verified+=chap.verified;subj.exported+=chap.exported;}
      } else if(ch.kind==='file'&&cn.endsWith('.md')&&!cn.includes('MOC')){
        subj.notes++; const fm=await readFM(ch);
        if((fm.status||'').includes('verified'))subj.verified++;
        if(fm.anki_exported)subj.exported++;
      }
    }
    if(subj.notes)subjects.push(subj);
  }
  state._vaultScan={at:new Date().toLocaleString('ko'),subjects};persist();
  renderVault(pageEl());
}
async function readFM(fh){
  try{const f=await fh.getFile();const t=await f.slice(0,1600).text();
    const m=t.match(/^---\s*\n([\s\S]*?)\n---/);if(!m)return {};
    const o={};m[1].split('\n').forEach(l=>{const i=l.indexOf(':');if(i>0)o[l.slice(0,i).trim()]=l.slice(i+1).trim();});return o;
  }catch(e){return {}}
}
function renderVaultTree(v){
  const a=document.getElementById('vaultTree');
  document.getElementById('scanStat').innerHTML=`<div class="muted tiny" style="margin-top:6px">스캔: ${v.at} · 과목 ${v.subjects.length}개</div>`;
  a.innerHTML=`<div class="card tree">${v.subjects.map((s,si)=>{
    const vp=Math.round(s.verified/s.notes*100), ep=Math.round(s.exported/s.notes*100);
    return `<div class="sub">
      <div class="sh" onclick="document.getElementById('chs${si}').style.display=document.getElementById('chs${si}').style.display==='none'?'block':'none'">
        <b style="flex:1">${esc(s.name)}</b>
        <span class="tiny muted">노트 ${s.notes} · 검증 ${s.verified}(${vp}%) · Anki ${s.exported}(${ep}%)</span>
        <button class="sm" onclick="event.stopPropagation();addSubjFromVault(${si})">+학습항목(챕터 포함)</button>
      </div>
      <div class="bar" style="margin:0 12px 6px"><i style="width:${vp}%;background:var(--good)"></i></div>
      <div class="chs" id="chs${si}" style="display:none">
        ${s.chapters.map((c,ci)=>`<div class="ch"><span class="nm">${esc(c.name)}</span>
          <span class="tiny muted">${c.notes}노트 · 검증 ${c.verified} · Anki ${c.exported}</span>
          <button class="sm ghost" onclick="addChapFromVault(${si},${ci})">+단일</button></div>`).join('')||'<div class="muted tiny">하위 챕터 없음</div>'}
      </div></div>`;
  }).join('')}</div>`;
}
/* 노트 수 → 예상시간(h) */
function estH(notes){return Math.max(1,Math.round(notes*0.5))}
/* 과목 전체를 학습항목으로 (각 챕터가 챕터 목록이 됨) */
function addSubjFromVault(si){
  const s=state._vaultScan.subjects[si];
  if(state.items.some(x=>x.name===s.name)){alert('이미 추가된 항목입니다.');return;}
  const chapters=s.chapters.map(c=>({id:rid(),name:c.name,hours:estH(c.notes),done:false}));
  addItem(s.name,{source:'볼트',mode:'weekly',weeklyHours:3,chapters});
  render(); alert(`"${s.name}" 추가됨 — 챕터 ${chapters.length}개. 학습 항목 탭에서 주당 시간·마감 조정하세요.`);
}
/* 단일 챕터만 (그 안의 노트를 챕터로) — 간단히 1개 챕터 항목 */
function addChapFromVault(si,ci){
  const s=state._vaultScan.subjects[si], c=s.chapters[ci];
  const name=`${s.name} · ${c.name}`;
  if(state.items.some(x=>x.name===name)){alert('이미 추가됨');return;}
  addItem(name,{source:'볼트',mode:'weekly',weeklyHours:2,chapters:[{id:rid(),name:c.name,hours:estH(c.notes),done:false}]});
  render(); alert(`"${name}" 추가됨`);
}
