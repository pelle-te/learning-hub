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
      <div style="flex:2"></div>
    </div>
    <div class="foot">카드 스캔: 정본 _meta/감사/_index.json의 덱 목록(검사.sh --index 생성)을 읽음. 없으면 anki/*.txt 폴더 폴백. 실시간: Anki 실행 + AnkiConnect 애드온 필요(localhost:8765).</div>
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
    state._ankiLive={at:new Date().toLocaleString('ko'),decks};persist();
    renderAnki(pageEl());
  }catch(e){
    st.innerHTML=`<div class="warnbox">AnkiConnect 연결 실패. Anki가 실행 중이고 AnkiConnect 애드온이 설치됐는지, 설정 webCorsOriginList에 "*" 또는 "null"이 있는지 확인하세요.<br><span class="tiny">${esc(e.message||e)}</span></div>`;
  }
}
function renderAnkiLive(v){
  document.getElementById('ankiStat').innerHTML+=`<div class="muted tiny" style="margin-top:6px">실시간: ${v.at}</div>`;
  document.getElementById('ankiList').innerHTML+=`<div class="card"><h3>실시간 due (AnkiConnect)</h3><table><thead><tr><th>덱</th><th>신규</th><th>학습</th><th>복습</th><th>오늘 합</th><th></th></tr></thead><tbody>
  ${v.decks.map(d=>{const due=d.new+d.learn+d.review;return `<tr><td>${esc(d.name)}</td><td>${d.new}</td><td>${d.learn}</td><td>${d.review}</td>
    <td><b>${due}</b></td><td><button class="sm ghost" onclick="addAnki('${jsq(d.name)} (due)',${Math.max(10,Math.round(due*0.5))})">+스케줄</button></td></tr>`;}).join('')}
  </tbody></table></div>`;
}
function addAnki(name,mins){
  const nm='Anki: '+name;
  if(state.items.some(s=>s.name===nm)){alert('이미 추가됨');return;}
  addItem(nm,{source:'Anki',mode:'daily',dailyMin:mins});
  render(); alert(`"${nm}" 매일 ${mins}분 복습으로 추가됨`);
}
