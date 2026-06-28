/* ============================================================
   ui-mastery.js — 탭: 🧠 숙달도 지도 (Knowledge State)
   ── 무엇 ──────────────────────────────────────────────────
   지식엔진.py가 _vault.db(선수 그래프)+관측(Anki·CBMS·백지)으로 추정한
   개념별 숙달확률을 소비해 보여준다. 세 가지 — 설계 평가 A·B·E의 화면:
     A 숙달도 히트맵   : 과목×개념을 유효숙달로 색칠(빨강 약점→초록 숙달, 회색 미관측)
     B 프런티어·갭     : '지금 배울 준비된 개념'(ZPD·레버리지순) + 약점 근본원인 진단
     E 캘리브레이션    : 확신했는데 틀린 과신율 + 백지 통과율(투입 아닌 출력 지표)
   데이터 원본은 _meta/감사/_지식상태.json (loadKnowledgeState). 런타임 캐시(state._knowState)라
   내보내기엔 안 나간다(RUNTIME_CACHE_KEYS).
============================================================ */
let _msAutoTried=false;
function renderMastery(p){
  const k=state._knowState;
  // serve.js로 띄웠으면 진입 시 1회 자동 로드(폴더 선택 없이 바로 보이게)
  if(!k && !_msAutoTried && typeof loadKnowledgeFromAPI==='function'){
    _msAutoTried=true;
    loadKnowledgeFromAPI().then(()=>{ if(TAB==='mastery') render(); }).catch(()=>{});
  }
  const stat = k
    ? `<div class="muted tiny" style="margin-top:6px">생성 ${esc(k.generated||'')} · 노트 ${k.n_notes}개 · 전체 유효숙달 <b>${pct(k.overall)}</b></div>`
    : '';
  p.innerHTML=`
  <div class="card">
    <div class="row" style="align-items:center">
      <h2 style="flex:1;margin:0">🧠 숙달도 지도</h2>
      <button class="sm primary" onclick="loadMastery()">📁 볼트에서 ${k?'새로고침':'지식상태 불러오기'}</button>
    </div>
    <div class="foot">개념별 <b>유효숙달</b>(선수 약하면 하락)·<b>프런티어</b>(지금 배울 준비된 것)·<b>약점 근본원인</b>·<b>과신율</b>.
      데이터는 <code>python 시스템/_도구/지식엔진.py build</code>가 만드는 <code>_지식상태.json</code>에서 옵니다.</div>
    <div id="msStat">${stat}</div>
  </div>
  ${k ? renderMasteryBody(k) : masterySetup()}`;
}

function masterySetup(){
  return `<div class="card">
    <h3>아직 지식상태가 없어요</h3>
    <ol class="foot" style="line-height:1.9">
      <li>볼트 인덱스 최신화: <code>python 시스템/_도구/벌트DB.py build</code></li>
      <li>(선택) 러닝허브 데이터 먹이기: 설정 탭에서 <b>볼트 백업</b>(<code>러닝허브_백업.json</code>) → 엔진이 CBMS·백지를 인제스트</li>
      <li>지식상태 빌드: <code>python 시스템/_도구/지식엔진.py build --export 러닝허브_백업.json</code></li>
      <li>위 <b>📁 볼트에서 불러오기</b> 클릭 → 전공 폴더 선택</li>
    </ol>
    <div class="foot muted">엔진은 선수개념 그래프로 "지금 배울 준비된 것(ZPD)"과 "약점의 근본원인"을 진단합니다.
      인출 관측(Anki/CBMS)이 쌓일수록 추정이 날카로워집니다.</div>
  </div>`;
}

async function loadMastery(){
  const st=document.getElementById('msStat');
  // serve.js로 띄웠으면 API에서 바로(폴더 선택 불필요 · 녹아들게)
  if(typeof loadKnowledgeFromAPI==='function'){
    try{ if(await loadKnowledgeFromAPI()){ render(); return; } }catch(e){}
  }
  if(!window.showDirectoryPicker){st.innerHTML='<div class="warnbox">이 브라우저는 폴더 연결 미지원(Chrome/Edge). 또는 <code>node serve.js</code>로 띄우면 자동 로드됩니다.</div>';return;}
  if(!vaultHandle){try{vaultHandle=await window.showDirectoryPicker();}catch(e){return;}}
  st.innerHTML='<div style="margin-top:8px"><span class="spin"></span> 지식상태 로드 중...</div>';
  let k=await loadKnowledgeState(vaultHandle);
  if(!k){ // 핸들이 다른 폴더였을 수 있음 — 한 번 더 폴더 선택 기회
    try{vaultHandle=await window.showDirectoryPicker();k=await loadKnowledgeState(vaultHandle);}catch(e){}
  }
  if(!k){st.innerHTML='<div class="warnbox">_지식상태.json을 못 찾았어요. 전공 폴더를 골랐는지, <code>지식엔진.py build</code>를 돌렸는지 확인하세요.</div>';return;}
  state._knowState=k; persist(); render();
}

/* ── 본문: 종합 → 과목 히트맵 → 프런티어 → 갭 → 캘리브레이션 (HTML 문자열 반환) ── */
function renderMasteryBody(k){
  return msOverviewCard(k) + msSubjectsCard(k) + msFrontierCard(k) + msGapsCard(k) + msCalibrationCard(k);
}
function pct(x){return Math.round((x||0)*100)+'%';}

/* 종합: 상태 분포 막대(숙달/학습중/약점/미관측) */
function msOverviewCard(k){
  const s=k.states||{}; const tot=k.n_notes||1;
  const seg=(n,c,lab)=>{const w=Math.round((n||0)/tot*100); return w?`<div title="${lab} ${n||0}" style="width:${w}%;background:${c}"></div>`:''; };
  return `<div class="card">
    <h3>지식 상태 분포</h3>
    <div class="msbar">
      ${seg(s.mastered,'var(--good,#4caf50)','숙달')}
      ${seg(s.learning,'#d6a72b','학습중')}
      ${seg(s.weak,'var(--bad,#e3564a)','약점')}
      ${seg(s.unknown,'var(--line,#444)','미관측')}
    </div>
    <div class="row foot" style="gap:14px;margin-top:8px;flex-wrap:wrap">
      <span><i class="dot" style="background:var(--good,#4caf50)"></i>숙달 ${s.mastered||0}</span>
      <span><i class="dot" style="background:#d6a72b"></i>학습중 ${s.learning||0}</span>
      <span><i class="dot" style="background:var(--bad,#e3564a)"></i>약점 ${s.weak||0}</span>
      <span><i class="dot" style="background:var(--line,#444)"></i>미관측 ${s.unknown||0}</span>
    </div>
    ${(s.unknown||0)>tot*0.5?`<div class="foot muted" style="margin-top:6px">⚠ 미관측이 과반입니다 — 인출 데이터(Anki due·CBMS·백지)가 쌓이면 회색이 색을 찾습니다.
      그래프 기반 <b>프런티어</b>는 관측 없이도 작동하니 아래에서 다음 배울 개념을 보세요.</div>`:''}
  </div>`;
}

/* 과목별 숙달 + 개념 히트맵 스트립(셀=개념, p_eff로 색) */
function msSubjectsCard(k){
  const subs=(k.subjects||[]).slice().sort((a,b)=>a.mastery-b.mastery);
  return `<div class="card">
    <h3>과목별 숙달 히트맵 <span class="muted tiny">— 셀 하나가 개념. 빨강=약점·초록=숙달·회색=미관측 (마우스 올리면 제목)</span></h3>
    ${subs.map(s=>{
      const cells=(s.concepts||[]).map(c=>{
        const col=masteryColor(c.p_eff,c.state);
        const t=`${esc(c.title||c.basename)}  ·  유효숙달 ${pct(c.p_eff)} (${c.state})${c.weak&&c.root_cause&&c.root_cause!=='self'?' ← 선수약점: '+esc(c.root_cause):''}`;
        return `<i class="mscell${c.frontier?' fr':''}" style="background:${col}" title="${t}"></i>`;
      }).join('');
      return `<div class="mssub">
        <div class="row" style="align-items:center;gap:8px">
          <b style="flex:1">${esc(s.subject)}</b>
          <span class="tiny muted">${s.n}개 · 숙달 ${pct(s.mastery)}${s.weak?` · 약점 ${s.weak}`:''}${s.unknown?` · 미관측 ${s.unknown}`:''}</span>
        </div>
        <div class="msheat">${cells}</div>
      </div>`;
    }).join('')||'<div class="muted tiny">과목 없음</div>'}
    <div class="foot muted tiny" style="margin-top:6px">테두리 친 셀 ⬡ = 프런티어(지금 배울 준비됨).</div>
  </div>`;
}

/* B: 프런티어(ZPD) — 선수는 익었고 본인은 아직, 레버리지(의존수)순 */
function msFrontierCard(k){
  const fr=(k.frontier||[]).slice(0,18);
  if(!fr.length)return `<div class="card"><h3>🎯 다음 배울 개념</h3><div class="muted tiny">프런티어 없음(선수 미충족 또는 충분 숙달).</div></div>`;
  return `<div class="card">
    <h3>🎯 다음 배울 개념 <span class="muted tiny">(ZPD · 선수 충족·고레버리지순 — 이걸 배우면 가장 많은 게 풀린다)</span></h3>
    <div class="mslist">${fr.map(f=>`<div class="msrow">
      <span class="msdot" style="background:hsl(200 60% 50%)">⬡</span>
      <span class="nm" style="flex:1">${esc(f.title||f.basename)}</span>
      <span class="tiny muted">${esc(f.subject||'')}</span>
      <span class="chip" title="이 개념을 선수로 삼는 개념 수">의존 ${f.prereq_in}</span>
    </div>`).join('')}</div>
  </div>`;
}

/* B: 갭 — 약점 + 근본원인(상류 선수개념) */
function msGapsCard(k){
  const g=(k.gaps||[]).slice(0,18);
  if(!g.length)return `<div class="card"><h3>🩹 약점 진단</h3><div class="foot muted">증거상 약점 없음 — 인출 관측이 쌓이면 약점이 드러납니다.</div></div>`;
  return `<div class="card">
    <h3>🩹 약점 진단 <span class="muted tiny">(약한 순 · 근본원인을 먼저 메우면 상류가 같이 풀린다)</span></h3>
    <div class="mslist">${g.map(x=>{
      const cause = x.root_cause==='self'?'<span class="tiny" style="color:var(--bad)">본인 개념</span>'
        : x.root_cause?`<span class="tiny" style="color:var(--bad)">← 선수약점: ${esc(x.root_cause)}</span>`:'';
      return `<div class="msrow">
        <span class="msdot" style="background:var(--bad,#e3564a)">✗</span>
        <span class="nm" style="flex:1">${esc(x.title||x.basename)}</span>
        <span class="tiny muted">${esc(x.subject||'')}</span>
        <span class="chip">${pct(x.p_eff)}</span> ${cause}
      </div>`;
    }).join('')}</div>
  </div>`;
}

/* E: 캘리브레이션 — 확신도 vs 정확도 */
function msCalibrationCard(k){
  const c=k.calibration||{};
  if(!c.n_errors&&!c.blank_total)
    return `<div class="card"><h3>🎚 메타인지 캘리브레이션</h3>
      <div class="foot muted">CBMS 오답·백지 기록이 없습니다 — 러닝허브에서 기록 후 <b>볼트 백업</b>→<code>지식엔진.py build --export</code>로 인제스트하면
      '확신했는데 틀린' 과신율이 잡힙니다(투입 아닌 출력 지표 · 설계 E).</div></div>`;
  const over=c.overconfidence_rate||0;
  const overCol=over>0.5?'var(--bad)':over>0.3?'#d6a72b':'var(--good)';
  return `<div class="card">
    <h3>🎚 메타인지 캘리브레이션 <span class="muted tiny">(확신도 vs 정확도 — 낮을수록 자기 앎을 정확히 안다)</span></h3>
    <div class="row" style="gap:24px;flex-wrap:wrap">
      <div>
        <div class="kpi" style="color:${overCol}">${pct(over)}</div>
        <div class="foot">과신율 — 확신했는데 틀림 ${c.confident_wrong||0} / 전체 오답 ${c.n_errors||0}</div>
      </div>
      ${c.blank_total?`<div>
        <div class="kpi">${pct(c.blank_pass_rate)}</div>
        <div class="foot">백지복습 통과율 ${c.blank_pass||0}/${c.blank_total||0}</div>
      </div>`:''}
    </div>
    <div class="msbar" style="margin-top:10px">
      <div title="확신했는데 틀림(과신)" style="width:${Math.round(over*100)}%;background:var(--bad,#e3564a)"></div>
      <div title="확신없음+틀림(적정)" style="width:${Math.round((1-over)*100)}%;background:#d6a72b"></div>
    </div>
    <div class="foot muted tiny" style="margin-top:6px">과신 오답 = 다음 복습에서 우선 표적. 백지 통과율 = '꺼낼 수 있는가'의 직접 증거.</div>
  </div>`;
}

/* 분석(log) 그룹에 등록 — 통계 다음 */
registerTab({ key:'mastery', label:'숙달도 지도', group:'log', order:85, render:renderMastery });

/* ESM-AUTO-EXPOSE */
Object.assign(globalThis, { renderMastery, masterySetup, loadMastery, renderMasteryBody,
  msOverviewCard, msSubjectsCard, msFrontierCard, msGapsCard, msCalibrationCard });
