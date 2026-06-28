/* ============================================================
   ui-review.js — 탭: 🔄 주간 리뷰 (메타인지 점검 · 방법론 10절)
   공부 자체가 아니라 '공부 방식'을 주 1회 점검한다:
   백로그 회수 · CBMS 분포 · 계획 대비 실제 · Anki 적체.
============================================================ */
let reviewWeekOffset=0;   // 0 = 이번 주(오늘 포함)

/* 주간 리뷰 체크리스트 항목(10절) */
const WEEKLY_CHECKS=[
  ['backlog','보충 필요 백로그 — 이번 주 몇 개 회수했나? 남은 건 언제 닫을지 정했다.'],
  ['cbms','오답 CBMS 분포 — 가장 많은 코드의 처방에 다음 주 시간을 더 줬다.'],
  ['plan','계획 vs 실제 — 버퍼(15~20%)가 부족했으면 다음 주 목표시간을 낮춘다.'],
  ['anki','Anki 적체 — due가 밀렸으면 큐레이션을 더 빡세게(≤5장/블록).'],
];

function renderReview(p){
  persist(); RES=schedule();
  const mon=addDays(mondayOf(new Date()),reviewWeekOffset*7);
  const ds0=iso(mon), ds6=iso(addDays(mon,6));
  const wk=iso(mon);
  const isThis=reviewWeekOffset===0;

  p.innerHTML=`
  <div class="card">
    <div class="row" style="align-items:center">
      <button class="sm" onclick="reviewNav(-1)">◀ 이전 주</button>
      <div style="flex:1;text-align:center;min-width:120px"><b style="font-size:15px">${weekLabel(mon)}</b>
        <span class="muted tiny"> ${isThis?'· 이번 주':(reviewWeekOffset>0?'· +'+reviewWeekOffset+'주':'· '+reviewWeekOffset+'주')}</span></div>
      <button class="sm" onclick="reviewNav(1)">다음 주 ▶</button>
      <button class="sm ghost" onclick="reviewToday()">이번 주</button>
    </div>
    <div class="foot">주 1회 15~20분, <b>공부 방식</b>을 점검하는 자리. 시간(투입)이 아니라 <i>CBMS 분포 축소·진행률</i> 같은 나아진 증거가 가장 강한 동기.</div>
  </div>
  ${planActualCard(mon)}
  ${cbmsDistCard(ds0,ds6)}
  ${backlogReviewCard(ds0,ds6)}
  ${checklistCard(wk)}`;
}
function reviewNav(d){reviewWeekOffset+=d;renderReview(pageEl());}
function reviewToday(){reviewWeekOffset=0;renderReview(pageEl());}

/* ── 계획 대비 실제(통계 탭 데이터 재사용) ── */
function weekPlanActual(mon){
  const byDs={}; (RES.days||[]).forEach(d=>byDs[d.ds]=d);
  let planMin=0,doneMin=0; const byDay=[];
  for(let k=0;k<7;k++){
    const ds=iso(addDays(mon,k)); const d=byDs[ds];
    let pm=0,dm=0;
    if(d){ d.items.forEach(it=>{ pm+=it.min; if(isDone(ds,it.sid,it.type))dm+=it.min; }); }
    planMin+=pm; doneMin+=dm; byDay.push({ds,k,pm,dm});
  }
  return {planMin,doneMin,byDay};
}
function planActualCard(mon){
  const w=weekPlanActual(mon);
  const rate=w.planMin>0?Math.round(w.doneMin/w.planMin*100):0;
  const maxRef=Math.max(1,...w.byDay.map(x=>x.pm));
  const bars=w.byDay.map(x=>{
    const ph=Math.round(x.pm/maxRef*70), dh=Math.round(x.dm/maxRef*70);
    return `<div class="pa-col" title="${DOW_MON[x.k]} ${fmtShort(parseISO(x.ds))} · 계획 ${(x.pm/60).toFixed(1)}h / 완료 ${(x.dm/60).toFixed(1)}h">
      <span class="pa-bar"><i class="plan" style="height:${ph}px"></i><i class="done" style="height:${dh}px"></i></span>
      <span class="tiny muted">${DOW_MON[x.k]}</span></div>`;
  }).join('');
  return `<div class="card"><h2>📊 계획 대비 실제 <span class="muted tiny">— 이번 주</span></h2>
    <div class="kpis" style="grid-template-columns:repeat(3,1fr)">
      <div class="kpi"><div class="v">${(w.doneMin/60).toFixed(1)}h<span class="muted tiny"> / ${(w.planMin/60).toFixed(1)}h</span></div><div class="l">완료 / 계획 (${rate}%)</div></div>
      <div class="kpi"><div class="v">${rate}%</div><div class="l">달성률</div></div>
      <div class="kpi"><div class="v">${rate<80?'⚠️':'👍'}</div><div class="l">${rate<80?'버퍼 부족 — 목표↓ 고려':'페이스 양호'}</div></div>
    </div>
    <div class="pa-chart">${bars}</div>
    <div class="foot"><span class="pa-lg plan"></span> 계획 &nbsp; <span class="pa-lg done"></span> 완료 &nbsp;· 막대는 요일별 시간. 자세한 추세는 <b>통계</b> 탭.</div>
  </div>`;
}

/* ── CBMS 분포(6·10절) ── */
function cbmsDistCard(ds0,ds6){
  const cnt=cbmsCounts(ds0,ds6);
  const total=Object.values(cnt).reduce((a,b)=>a+b,0);
  const maxc=Math.max(1,...Object.values(cnt));
  const bars=Object.keys(CBMS_INFO).map(c=>{
    const inf=CBMS_INFO[c], n=cnt[c];
    return `<div class="cbms-row">
      <span class="cbms-chip" style="--c:${inf.color}">${c} ${inf.label}</span>
      <span class="cbms-track"><i style="width:${n/maxc*100}%;background:${inf.color}"></i></span>
      <span class="tiny" style="min-width:18px;text-align:right">${n}</span></div>`;
  }).join('');
  let hint='이번 주 기록된 오답이 없어요. 막힌 곳을 CBMS로 남기면 약점 분포가 보입니다.';
  if(total){
    const top=Object.keys(cnt).reduce((a,b)=>cnt[b]>cnt[a]?b:a,'C');
    const map={C:'이해 단계가 부족 — 교재 정독·개념 정리에 시간 더.',B:'조건 설정이 약점 — 문제 유형별 체크리스트를 만들자.',
      M:'손 연습량 부족 — 도출 단계 백지 연습을 늘려라.',S:'마무리 루틴 부족 — 검산·단위 체크를 습관화.',T:'속도/효율 문제 — 자주 막히는 계산을 손에 익히고 시간 분배 훈련.'};
    hint=`가장 많은 코드 <b>${top}(${CBMS_INFO[top].label})</b> — ${map[top]}`;
  }
  return `<div class="card"><h2>✗ 오답 CBMS 분포 <span class="muted tiny">— 약점의 분포</span></h2>
    ${bars}
    <div class="foot" style="margin-top:10px">${hint}</div>
  </div>`;
}

/* ── 백로그 회수(5·10절) ── */
function backlogReviewCard(ds0,ds6){
  const open=openBacklog();
  const closedThisWeek=backlogClosedBetween(ds0,ds6);
  const listHtml=open.length?open.map(b=>`
    <div class="rec bl-open">
      <div class="rec-head">
        <input type="checkbox" aria-label="회수 완료" onchange="reviewCloseBacklog('${b.id}')">
        <span class="swatch" style="background:${(itemById(b.sid)||{}).color||'#888'}"></span>
        <b>${esc(b.topic||'(주제 없음)')}</b>${b.name?`<span class="muted tiny"> · ${esc(b.name)}</span>`:''}
        <span class="muted tiny" style="margin-left:6px">열린 지 ${dayDiff(b.ds,iso(new Date()))}일</span>
      </div>${b.note?`<div class="tiny">${esc(b.note)}</div>`:''}
    </div>`).join(''):`<div class="empty tiny">열린 백로그가 없어요 👍</div>`;
  return `<div class="card"><h2>🏷 보충 필요 회수 <span class="muted tiny">— 백로그를 닫는 고리</span></h2>
    <div class="row" style="margin-bottom:8px">
      <span class="pill ${open.length?'warn':'good'}">열림 ${open.length}</span>
      <span class="pill good">이번 주 회수 ${closedThisWeek}</span>
    </div>
    ${listHtml}
    <div class="foot" style="margin-top:8px">오래 열린 항목일수록 위로. 더 안 중요하면 과감히 버린다(재시작 루틴). 추가는 <b>오늘 학습</b> 탭에서.</div>
  </div>`;
}
function reviewCloseBacklog(id){toggleBacklog(id);renderReview(pageEl());}

/* ── 주간 리뷰 체크리스트 + 메모(10절) ── */
function checklistCard(wk){
  const w=getWeekly(wk);
  const checks=w.checks||{};
  return `<div class="card"><h2>✅ 주간 점검 체크리스트</h2>
    ${WEEKLY_CHECKS.map(([k,label])=>`
      <label class="chk-row"><input type="checkbox" ${checks[k]?'checked':''} onchange="onWeeklyCheck('${wk}','${k}',this.checked)">
        <span>${esc(label)}</span></label>`).join('')}
    <label style="margin-top:10px">이번 주 메모 <span class="muted tiny">(무엇을 바꿀까)</span></label>
    <textarea id="wk-note" rows="3" placeholder="예) M 오답이 많았다 → 다음 주 통신 도출 백지연습 +1블록. 보충필요 2개 남음, 토요일 오전에 닫기." onchange="onWeeklyNote('${wk}',this.value)">${esc(w.note||'')}</textarea>
    <div class="foot">체크/메모는 그 주에 저장돼요(주를 넘기면 각각 따로 보관).</div>
  </div>`;
}
function onWeeklyCheck(wk,k,on){setWeeklyCheck(wk,k,on);}
function onWeeklyNote(wk,v){setWeeklyNote(wk,v);}

registerTab({ key:'review', label:'🔄 주간 리뷰', group:'main', order:80, render:renderReview });

/* ESM-AUTO-EXPOSE */
/* ESM: 이 모듈의 공개 심볼을 전역에 노출 — 인라인 onclick·타 모듈 호출용
   (모듈 내부 헬퍼는 위에 두면 비공개. 여긴 파일의 공개 표면) */
Object.assign(globalThis, { reviewWeekOffset, WEEKLY_CHECKS, renderReview, reviewNav, reviewToday, weekPlanActual, planActualCard, cbmsDistCard, backlogReviewCard, reviewCloseBacklog, checklistCard, onWeeklyCheck, onWeeklyNote });
