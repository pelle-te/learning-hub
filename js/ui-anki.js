/* ============================================================
   ui-anki.js — 탭4: Anki 현황 (볼트 _anki 파일 + AnkiConnect)
============================================================ */
function renderAnki(p){
  p.innerHTML=`
  <div class="card">
    <h2>Anki 현황</h2>
    <div class="row">
      <button class="sm" onclick="scanAnkiFiles()">📁 볼트 카드 스캔</button>
      <button class="sm" onclick="ankiLive()">🔌 AnkiConnect 실시간 due</button>
      <button class="sm ghost" onclick="exportAnkiCards('all')" title="전체 3문장 요약·오답을 Anki import용 .txt 카드 초안으로">🃏 요약·오답 → 카드(.txt)</button>
      <div style="flex:2"></div>
    </div>
    <div class="foot">카드 스캔: 정본 _meta/감사/_index.json의 덱 목록(검사.sh --index 생성)을 읽음. 없으면 anki/*.txt 폴더 폴백. 실시간: Anki 실행 + AnkiConnect 애드온 필요(localhost:8765). <b>카드 생성</b>: 그동안 적은 3문장 요약·반복 오답을 import용 초안(.txt)으로 — Anki에서 추리고 손질(큐레이션).</div>
    <div id="ankiStat"></div>
  </div>
  <div id="ankiList"></div>`;
  if(state._ankiFile)renderAnkiFile(state._ankiFile);
  if(state._ankiLive)renderAnkiLive(state._ankiLive);
}
async function scanAnkiFiles(){
  const st=document.getElementById('ankiStat');
  if(!window.showDirectoryPicker){st.innerHTML='<div class="warnbox">폴더 연결 미지원 브라우저.</div>';return;}
  let h=vaultHandle;
  try{
    if(!h){h=await window.showDirectoryPicker();vaultHandle=h;}
    let decks=[], src='';
    const idx=await loadVaultIndex(h);                                  // 정본: _index.json의 덱 매니페스트(file·cards)
    if(idx&&Array.isArray(idx.anki)&&idx.anki.length){
      decks=idx.anki.map(a=>({file:a.file.replace(/\.txt$/,''),subj:a.file.split('_')[0],cards:a.cards}));
      src='_index.json';
    }else{                                                             // 폴백: anki/ 또는 _anki/ 자식 폴더 직접 스캔
      let ank=null;
      for await(const [n,e] of h.entries())if((n==='anki'||n==='_anki')&&e.kind==='directory')ank=e;
      if(!ank){st.innerHTML='<div class="warnbox">정본 _index.json도 anki 폴더도 못 찾았어요. 전공(볼트) 폴더를 선택하세요(카드 목록은 검사.sh --index가 _index.json에 기록).</div>';return;}
      for await(const [fn,fh] of ank.entries()){
        if(fh.kind!=='file'||!fn.endsWith('.txt'))continue;
        const t=await(await fh.getFile()).text();
        const cards=t.split('\n').filter(l=>l.trim()&&!l.startsWith('#')).length;
        decks.push({file:fn.replace('.txt',''),subj:fn.split('_')[0],cards});
      }
      src='anki/ 폴더';
    }
    state._ankiFile={at:new Date().toLocaleString('ko'),src,decks};persist();
    renderAnki(pageEl());
  }catch(e){if(e.name!=='AbortError')st.innerHTML='<div class="warnbox">'+esc(e.message||e)+'</div>';}
}
function renderAnkiFile(v){
  document.getElementById('ankiStat').innerHTML=`<div class="muted tiny" style="margin-top:6px">카드 스캔: ${v.at}${v.src?' · '+esc(v.src):''}</div>`;
  const bySubj={};v.decks.forEach(d=>{(bySubj[d.subj]=bySubj[d.subj]||[]).push(d);});
  document.getElementById('ankiList').innerHTML=`<div class="card"><h3>볼트 카드(파일 기준)</h3><table><thead><tr><th>과목</th><th>덱</th><th>카드</th><th></th></tr></thead><tbody>
  ${Object.entries(bySubj).map(([s,ds])=>ds.map((d,i)=>`<tr>
    ${i===0?`<td rowspan="${ds.length}"><b>${esc(s)}</b><br><span class="tiny muted">${ds.reduce((t,x)=>t+x.cards,0)}장</span></td>`:''}
    <td class="tiny">${esc(d.file)}</td><td>${d.cards}</td>
    <td><button class="sm ghost" onclick="addAnki('${jsq(d.file)}',${Math.max(15,Math.round(d.cards*0.5))})">+스케줄</button></td></tr>`).join('')).join('')}
  </tbody></table>
  <div class="foot">'+스케줄'은 해당 덱을 '매일 복습' 항목으로 추가합니다(예상 분 = 카드수×0.5, 수정 가능).</div></div>`;
}
async function ankiConnect(action,params={}){
  const ac=new AbortController(), to=setTimeout(()=>ac.abort(),3000);  // Anki 미실행/방화벽 시 무한대기 방지
  try{
    const res=await fetch('http://localhost:8765',{method:'POST',body:JSON.stringify({action,version:6,params}),signal:ac.signal});
    const j=await res.json();if(j.error)throw new Error(j.error);return j.result;
  }finally{clearTimeout(to);}
}
async function ankiLive(){
  const st=document.getElementById('ankiStat');
  st.innerHTML='<div style="margin-top:8px"><span class="spin"></span> AnkiConnect 연결 중...</div>';
  try{
    const names=await ankiConnect('deckNames');
    const stats=await ankiConnect('getDeckStats',{decks:names});
    const decks=Object.values(stats).map(d=>({name:d.name,new:d.new_count,learn:d.learn_count,review:d.review_count,total:d.total_in_deck}));
    state._ankiLive={at:new Date().toLocaleString('ko'),decks};
    recordRetentionSnapshot(decks);   // 주별 due 스냅샷(유지율 추세 · F-05) — persist 포함
    persist();
    renderAnki(pageEl());
  }catch(e){
    st.innerHTML=`<div class="warnbox">AnkiConnect 연결 실패. Anki가 실행 중이고 AnkiConnect 애드온이 설치됐는지, 설정 webCorsOriginList에 "*" 또는 "null"이 있는지 확인하세요.<br><span class="tiny">${esc(e.message||e)}</span></div>`;
  }
}
function renderAnkiLive(v){
  const dueTot=v.decks.reduce((t,d)=>t+d.new+d.learn+d.review,0);
  document.getElementById('ankiStat').innerHTML+=`<div class="muted tiny" style="margin-top:6px">실시간: ${v.at}</div>`;
  document.getElementById('ankiList').innerHTML+=`<div class="card"><h3>실시간 due (AnkiConnect)</h3>
  <div class="row" style="margin-bottom:6px;align-items:center">
    <button class="sm" onclick="ankiDueBudget()" title="오늘 풀 due 합계(${dueTot}장)를 '매일 복습' 분 예산으로 — FSRS due를 시간으로 역연동">📥 오늘 due 합계 → 복습 시간예산</button>
    <span class="muted tiny">오늘 풀 due 합 <b>${dueTot}</b>장</span>
  </div>
  <table><thead><tr><th>덱</th><th>신규</th><th>학습</th><th>복습</th><th>오늘 합</th><th></th></tr></thead><tbody>
  ${v.decks.map(d=>{const due=d.new+d.learn+d.review;return `<tr><td>${esc(d.name)}</td><td>${d.new}</td><td>${d.learn}</td><td>${d.review}</td>
    <td><b>${due}</b></td><td><button class="sm ghost" onclick="addAnki('${jsq(d.name)} (due)',${Math.max(10,Math.round(due*0.5))})">+스케줄</button></td></tr>`;}).join('')}
  </tbody></table>
  <div class="foot">'+스케줄'은 덱별로 항목을 추가하고, '복습 시간예산'은 <b>전체 due 합</b>을 하나의 매일 복습 항목으로 잡아요(스케줄 용량에 반영). 시점(due)은 FSRS가 소유.</div></div>`;
}
/* due → 시간예산 역연동(세계수준 델타: Anki/FSRS) — 오늘 풀 due 합을 '매일 복습' 분 예산으로 upsert.
   FSRS가 소유한 '오늘 갚을 빚(due)'을 시간(분)으로 환산해 스케줄러 용량에 반영한다(카드당 ~30초). */
function ankiDueBudget(){
  const v=state._ankiLive;
  if(!v||!v.decks||!v.decks.length){toast('먼저 "🔌 AnkiConnect 실시간 due"로 현황을 불러오세요.','warn',3600);return;}
  const due=v.decks.reduce((t,d)=>t+(+d.new||0)+(+d.learn||0)+(+d.review||0),0);
  if(due<=0){toast('오늘 풀 due가 0이에요 — 잡을 예산이 없어요. 👍','info',3200);return;}
  const mins=clamp(Math.round(due*0.5),10,180);   // 카드당 ~30초, 10~180분 클램프
  const nm='Anki: 오늘 due 복습';
  const ex=state.items.find(s=>s.name===nm);
  if(ex){ex.mode='daily';ex.dailyMin=mins;ex.source='Anki';persist();render();
    toast(`"${nm}" 복습예산을 ${mins}분으로 갱신(due ${due}장).`,'ok',4000);return;}
  addItem(nm,{source:'Anki',mode:'daily',dailyMin:mins});
  render();
  toast(`"${nm}" 매일 ${mins}분 복습예산으로 추가(due ${due}장 → 시간 역연동).`,'ok',4400);
}
function addAnki(name,mins){
  const nm='Anki: '+name;
  if(state.items.some(s=>s.name===nm)){toast('이미 추가됨','warn');return;}
  addItem(nm,{source:'Anki',mode:'daily',dailyMin:mins});
  render(); toast(`"${nm}" 매일 ${mins}분 복습으로 추가됨`,'ok');
}

registerTab({ key:'anki', label:'🃏 Anki 현황', group:'main', order:60, render:renderAnki });

/* ESM-AUTO-EXPOSE */
/* ESM: 이 모듈의 공개 심볼을 전역에 노출 — 인라인 onclick·타 모듈 호출용
   (모듈 내부 헬퍼는 위에 두면 비공개. 여긴 파일의 공개 표면) */
Object.assign(globalThis, { renderAnki, scanAnkiFiles, renderAnkiFile, ankiConnect, ankiLive, renderAnkiLive, ankiDueBudget, addAnki });
