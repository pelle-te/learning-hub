/* ============================================================
   ui-control.js — 탭: 🛠 시스템 제어판 (serve.js 백엔드 연동)
   ── 무엇 ──────────────────────────────────────────────────
   러닝허브는 브라우저 정적 앱이라 Python 도구를 직접 못 돈다. 대신 serve.js가
   /api/* 로 화이트리스트 도구를 실행해 준다(옛 홈/app.py·탐구_제어판.py를 흡수).
   이 탭이 그 프론트엔드 — 버튼 하나로:
     · 지식상태 재빌드(지식엔진) → 숙달도 탭 즉시 갱신
     · 볼트 건강검진/통계(벌트DB)   · 지시문 품질 회귀검사(지시문평가)
     · Anki 학습신호 갱신(학습신호)   · 탐구(웹리서치) 수집 실행
   serve.js로 안 띄우면(file://·정적호스팅) API가 없으므로 *안내만* 표시(우아한 폴백).
   ── API 계약 ──────────────────────────────────────────────
   GET  /api/ping                  → {ok,tools:[...]}
   GET  /api/artifact/:name        → {ok,data}            (knowledge|anki)
   POST /api/run/:tool   body{}    → {ok,out,code,stats?}  (도구 텍스트→수치 파싱)
   POST /api/run/research {topic,scope} → {ok,out}
============================================================ */
let _ctlApi = null;        // null=미확인, false=없음(file://), {tools} = 있음
let _ctlBusy = '';         // 실행 중인 도구 키
let _ctlLog = {};          // tool → 마지막 결과 {ok,out,stats}

async function ctlPing(){
  try{
    const r=await fetch('/api/ping',{cache:'no-store'});
    _ctlApi = r.ok ? await r.json() : false;
  }catch(e){ _ctlApi=false; }
  if(TAB==='control') render();
}

function renderControl(p){
  if(_ctlApi===null){ ctlPing(); }   // 첫 진입 → 비동기 핑 후 재렌더
  p.innerHTML = `
  <div class="card">
    <div class="row" style="align-items:center">
      <h2 style="flex:1;margin:0">🛠 시스템 제어판</h2>
      ${_ctlApi&&_ctlApi.ok?'<span class="chip" style="color:var(--good)">● serve.js 연결됨</span>'
        : _ctlApi===false?'<span class="chip" style="color:var(--bad)">○ API 없음</span>':'<span class="spin"></span>'}
    </div>
    <div class="foot">시스템(전공 볼트·메타 도구)을 러닝허브에서 바로 돌리고 결과를 봅니다. CMD로 명령어 칠 필요 없이 버튼 하나로.</div>
  </div>
  ${_ctlApi===false?ctlOfflineCard():_ctlApi?ctlPanels():'<div class="card"><span class="spin"></span> 제어판 백엔드 확인 중...</div>'}`;
}

function ctlOfflineCard(){
  return `<div class="card">
    <h3>제어판을 켜려면 serve.js로 띄우세요</h3>
    <ol class="foot" style="line-height:1.9">
      <li>러닝허브 폴더에서 <code>node serve.js</code> 실행</li>
      <li>브라우저로 <code>http://localhost:8000/</code> 열기(지금은 정적/파일 모드라 API가 없음)</li>
    </ol>
    <div class="foot muted">그러면 아래 도구들을 버튼으로 실행할 수 있습니다: 지식상태 재빌드 · 볼트 건강검진 · 지시문 품질검사 · Anki 학습신호 · 탐구 수집.
      파일 모드에서도 숙달도 지도 탭은 폴더 선택으로 동작합니다.</div>
  </div>`;
}

function ctlPanels(){
  return ctlToolCard('knowledge-build','🧠 지식상태 재빌드','지식엔진 — 선수그래프+관측으로 개념별 숙달도 재계산. 끝나면 숙달도 지도가 갱신됨.',true)
    + ctlToolCard('vault-health','🩺 볼트 건강검진','벌트DB — 노트/검증/플래그/고립/데드링크/Anki GUID 한눈에.')
    + ctlToolCard('eval','📐 지시문 품질 회귀검사','지시문평가 — 검증노트를 루브릭으로 채점, 베이스라인 대비 회귀 게이트.')
    + ctlToolCard('anki-signal','🃏 Anki 학습신호 갱신','학습신호 — AnkiConnect에서 due/lapse를 읽어 _anki신호.json 갱신(엔진 인출관측 소스).')
    + ctlToolCard('vault-stats','📊 볼트 통계','벌트DB — 과목×status×type 분포 표.')
    + ctlResearchCard();
}

function ctlToolCard(key,title,desc,feedsMastery){
  const busy=_ctlBusy===key, r=_ctlLog[key];
  return `<div class="card">
    <div class="row" style="align-items:center;gap:10px">
      <b style="flex:1">${title}</b>
      <button class="sm primary" ${busy?'disabled':''} onclick="runCtl('${key}',${feedsMastery?'true':'false'})">${busy?'<span class="spin"></span> 실행 중':'실행'}</button>
    </div>
    <div class="foot">${desc}</div>
    ${r?ctlResultBlock(key,r):''}
  </div>`;
}

function ctlResultBlock(key,r){
  let stats='';
  if(r.stats){
    const s=r.stats;
    if(key==='knowledge-build') stats=`<div class="ctlstats">노트 ${s.notes??'?'} · 전체숙달 <b>${s.overall!=null?Math.round(s.overall*100)+'%':'?'}</b> · 숙달 ${s.mastered??0}·학습중 ${s.learning??0}·약점 ${s.weak??0}·미관측 ${s.unknown??0} · 프런티어 ${s.frontier??0}</div>`;
    else if(key==='vault-health') stats=`<div class="ctlstats">노트 ${s.notes??'?'} · 검증 ${s.verified??'?'} · 플래그 ${s.flags??'?'} · 데드링크 ${s.deadlinks??'?'} ${s.healthy?'· ✅양호':''}</div>`;
    else if(key==='eval') stats=`<div class="ctlstats">노트 ${s.notes??'?'} · 코퍼스 평균 <b>${s.corpus_mean??'?'}/5</b> ${s.regressed?'· <span style="color:var(--bad)">⚠ 회귀</span>':'· ✅ 회귀없음'}</div>`;
  }
  return `${stats}<details class="ctldetails"${r.ok?'':' open'}><summary class="tiny muted">${r.ok?'출력 보기':'⚠ 실패 — 출력'}</summary><pre class="ctlpre">${esc(r.out||'(출력 없음)')}</pre></details>`;
}

function ctlResearchCard(){
  const busy=_ctlBusy==='research', r=_ctlLog['research'];
  return `<div class="card">
    <div class="row" style="align-items:center;gap:10px"><b style="flex:1">🔭 탐구(웹 리서치) 수집</b></div>
    <div class="foot">교재가 아니라 웹에서 새로 알아보는 학습(지시문11). 주제를 넣으면 <code>탐구_수집.py</code>가 수집해 <code>전공/_탐구/</code>에 원자 노트 초안을 만듭니다.</div>
    <div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap">
      <input id="ctlTopic" placeholder="주제 (예: 반도체 공급망 동향)" style="flex:2;min-width:180px" ${busy?'disabled':''}>
      <input id="ctlScope" placeholder="범위(선택)" style="flex:1;min-width:120px" ${busy?'disabled':''}>
      <button class="sm primary" ${busy?'disabled':''} onclick="runResearch()">${busy?'<span class="spin"></span> 수집 중(최대 30분)':'수집 시작'}</button>
    </div>
    ${busy?'<div class="foot muted" style="margin-top:6px">웹 수집·정리는 몇 분~수십 분 걸립니다. 탭을 떠나도 서버에서 계속 돌아요.</div>':''}
    ${r?ctlResultBlock('research',r):''}
  </div>`;
}

/* ── 실행 핸들러 ── */
async function runCtl(key,feedsMastery){
  if(_ctlBusy)return;
  _ctlBusy=key; render();
  let res;
  try{
    const r=await fetch('/api/run/'+key,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    res=await r.json();
  }catch(e){ res={ok:false,out:'요청 실패: '+(e.message||e)}; }
  _ctlLog[key]=res; _ctlBusy='';
  // 지식상태 재빌드면 숙달도 탭 데이터 자동 갱신
  if(feedsMastery && res.ok){ try{ await loadKnowledgeFromAPI(); }catch(e){} }
  render();
  if(res.ok) toast((TOOLS_LABEL[key]||key)+' 완료','ok',2200);
  else toast((TOOLS_LABEL[key]||key)+' 실패 — 출력 확인','bad',3500);
}
const TOOLS_LABEL={'knowledge-build':'지식상태 재빌드','vault-health':'건강검진','eval':'품질검사','anki-signal':'학습신호','vault-stats':'통계'};

async function runResearch(){
  if(_ctlBusy)return;
  const topic=(document.getElementById('ctlTopic')||{}).value||'';
  const scope=(document.getElementById('ctlScope')||{}).value||'';
  if(!topic.trim()){ toast('주제를 입력하세요.','warn'); return; }
  _ctlBusy='research'; render();
  let res;
  try{
    const r=await fetch('/api/run/research',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({topic:topic.trim(),scope:scope.trim()})});
    res=await r.json();
  }catch(e){ res={ok:false,out:'요청 실패: '+(e.message||e)}; }
  _ctlLog['research']=res; _ctlBusy=''; render();
  toast(res.ok?'탐구 수집 완료 — 전공/_탐구/ 확인':'탐구 수집 실패',res.ok?'ok':'bad',3500);
}

/* 숙달도 탭과 공유 — API에서 지식상태 받아 state._knowState에 넣음 */
async function loadKnowledgeFromAPI(){
  const r=await fetch('/api/artifact/knowledge',{cache:'no-store'});
  if(!r.ok) throw new Error('no artifact');
  const j=await r.json();
  if(j&&j.ok&&j.data){ state._knowState=j.data; persist(); return true; }
  throw new Error('bad artifact');
}

/* 자료(src) 그룹 — 연동 현황 다음 */
registerTab({ key:'control', label:'시스템 제어판', group:'src', order:55, render:renderControl });

/* ESM-AUTO-EXPOSE */
Object.assign(globalThis, { renderControl, ctlPing, runCtl, runResearch, loadKnowledgeFromAPI, ctlPanels, ctlOfflineCard });
