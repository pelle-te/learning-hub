/* ============================================================
   ui-stats.js — 탭: 학습 통계 (무엇을 얼마나 학습했나)
============================================================ */
function renderStats(p){
  persist(); RES=schedule();
  const r=RES;
  if(!r.itemStat.length){p.innerHTML=`<div class="card"><div class="empty">학습 항목을 추가하면 통계가 나타납니다.</div></div>`;return;}
  const totalSchedH=r.itemStat.reduce((t,s)=>t+(s.schedH||0),0);
  const totalCh=r.itemStat.reduce((t,s)=>t+(s.totalCh||0),0);
  const doneCh=r.itemStat.reduce((t,s)=>t+(s.doneCh||0),0);
  const revCount=r.days.reduce((t,d)=>t+d.items.filter(i=>i.type==='rev').length,0);
  const doneH=totalDoneHours();
  const streak=studyStreak();
  const compRate=totalSchedH>0?Math.min(100,Math.round(doneH/totalSchedH*100)):0;

  p.innerHTML=`
  <div class="kpis">
    <div class="kpi"><div class="v">${doneH.toFixed(1)}h<span class="muted tiny"> / ${Math.round(totalSchedH)}h</span></div><div class="l">실제 완료 / 계획 (${compRate}%)</div></div>
    <div class="kpi"><div class="v">🔥 ${streak}<span class="muted tiny">일</span></div><div class="l">연속 학습일</div></div>
    <div class="kpi"><div class="v">${doneCh}<span class="muted tiny"> / ${totalCh}</span></div><div class="l">완료 챕터</div></div>
    <div class="kpi"><div class="v">${revCount}</div><div class="l">복습 세션(계획)</div></div>
  </div>

  ${retrievalCard(r)}

  <div class="card">
    <h2>과목별 진행</h2>
    <table><thead><tr><th>과목</th><th>주당</th><th>챕터</th><th>계획시간</th><th>학습 종료(예상)</th><th>마감</th><th>상태</th></tr></thead><tbody>
    ${r.itemStat.map(s=>{
      if(s.daily)return `<tr><td><span class="swatch" style="background:${s.color}"></span>${esc(s.name)}</td>
        <td class="muted tiny">매일 ${s.dailyMin}분</td><td class="muted">-</td><td>${s.schedH}h</td>
        <td class="muted">${s.days}일</td><td>-</td><td><span class="pill">반복</span></td></tr>`;
      const prog=s.totalCh?Math.round(s.doneCh/s.totalCh*100):0;
      const pill=!s.deadline?'<span class="pill">진행</span>'
        :!s.finished?'<span class="pill bad">시간부족</span>'
        :s.late>0?'<span class="pill warn">마감초과</span>':'<span class="pill good">정상</span>';
      return `<tr><td><span class="swatch" style="background:${s.color}"></span>${esc(s.name)}</td>
        <td>${s.weeklyHours}h</td>
        <td style="min-width:130px">${s.doneCh}/${s.totalCh}<div class="bar" style="margin:4px 0 0"><i style="width:${prog}%;background:${s.color}"></i></div></td>
        <td>${s.schedH}h<span class="muted tiny"> / ${s.totalH}h</span></td>
        <td>${s.finishDate?fmtShort(parseISO(s.finishDate)):'-'}</td>
        <td>${s.deadline||'-'}</td><td>${pill}</td></tr>`;
    }).join('')}
    </tbody></table>
  </div>

  <div class="card">
    <h2>주별 학습시간</h2>
    ${weeklyBars(r)}
  </div>

  <div class="card">
    <h2>학습한 내용 (챕터 타임라인)</h2>
    ${chapterTimeline(r)}
  </div>`;
}

/* 인출 증거(북극성 지표) — 시간(투입)이 아니라 '꺼낼 수 있게 됐다'는 출력 지표.
   방법론 14절: 진척의 증거(CBMS 분포 축소·인출 활동)가 가장 강한 내적 동기. */
function retrievalCard(r){
  const tr=cbmsTrend();
  const trDelta=tr.lastW-tr.thisW;                  // +면 오답 감소(좋음)
  const trIcon=tr.lastW===0&&tr.thisW===0?'—':trDelta>0?'▼ 감소':trDelta<0?'▲ 증가':'＝ 유지';
  const trGood=trDelta>0||(tr.lastW===0&&tr.thisW===0);
  // 백지 복습: 계획된 blank 중 완료 비율(능동 인출의 가장 깊은 루프)
  let blankPlan=0,blankDone=0;
  (r.days||[]).forEach(d=>d.items.forEach(it=>{if(it.type==='blank'){blankPlan++;if(isDone(d.ds,it.sid,it.type))blankDone++;}}));
  const blankRate=blankPlan?Math.round(blankDone/blankPlan*100):0;
  // 능동 인출 활동: 3문장 요약 + 완료한 백지·모의(전부 '꺼내기')
  let mockDone=0;(r.days||[]).forEach(d=>d.items.forEach(it=>{if(it.type==='mock'&&isDone(d.ds,it.sid,it.type))mockDone++;}));
  const recallActs=summaryCount()+blankDone+mockDone;
  return `<div class="card">
    <h2>🎯 인출 증거 <span class="muted tiny">— "이해했다"가 아니라 "꺼낼 수 있다"의 증거(투입 아닌 출력 지표)</span></h2>
    <div class="kpis" style="grid-template-columns:repeat(3,1fr)">
      <div class="kpi"><div class="v" style="color:${trGood?'var(--ok,#7ee0c0)':'var(--bad,#ff8fa3)'}">${trIcon}</div>
        <div class="l">오답 추세 <span class="muted tiny">(지난주 ${tr.lastW} → 이번주 ${tr.thisW})</span></div></div>
      <div class="kpi"><div class="v">${blankPlan?blankRate+'%':'—'}</div>
        <div class="l">백지 복습 완료 <span class="muted tiny">${blankPlan?'('+blankDone+'/'+blankPlan+')':'(계획 없음)'}</span></div></div>
      <div class="kpi"><div class="v">${recallActs}</div><div class="l">능동 인출 활동 <span class="muted tiny">요약+백지+모의</span></div></div>
    </div>
    <div class="foot">${trGood?'오답이 줄고 있어요 — 약점이 닫히는 방향. 👍':'오답이 늘었어요 — 가장 많은 코드의 처방에 다음 주 시간을 더 주세요(주간 리뷰 탭).'} 백지 복습은 가장 깊은 인출 — 계획되면 꼭 닫기.</div>
  </div>`;
}

function weeklyBars(r){
  const weeks=Object.keys(r.weekHours).sort();
  if(!weeks.length)return `<div class="empty">데이터 없음</div>`;
  const byId={}; r.itemStat.forEach(s=>byId[s.id]=s);
  const maxH=Math.max(1,...weeks.map(w=>Object.values(r.weekHours[w]).reduce((t,v)=>t+v,0)));
  return `<div style="display:flex;gap:8px;align-items:flex-end;overflow-x:auto;padding:6px 0;min-height:140px">
    ${weeks.map(w=>{
      const segs=r.weekHours[w]; const tot=Object.values(segs).reduce((t,v)=>t+v,0);
      const stack=Object.entries(segs).map(([sid,h])=>`<div title="${esc((byId[sid]||{}).name||'')}: ${Math.round(h*10)/10}h" style="height:${h/maxH*110}px;background:${(byId[sid]||{}).color||'#6ea8fe'};border-radius:3px 3px 0 0"></div>`).join('');
      return `<div style="display:flex;flex-direction:column;align-items:center;min-width:46px">
        <div class="tiny muted">${Math.round(tot)}h</div>
        <div style="display:flex;flex-direction:column-reverse;width:30px;gap:1px">${stack}</div>
        <div class="tiny muted" style="margin-top:4px">${fmtShort(parseISO(w))}</div></div>`;
    }).join('')}
  </div>
  <div class="tiny muted" style="margin-top:6px">${r.itemStat.filter(s=>!s.daily||true).map(s=>`<span class="swatch" style="background:${s.color}"></span>${esc(s.name)}`).join('&nbsp;&nbsp;')}</div>`;
}

function chapterTimeline(r){
  if(!r.chapterLog.length)return `<div class="empty">챕터가 있는 과목을 추가하면 여기에 '며칠에 무엇을 배우는지'가 쌓입니다.</div>`;
  // 날짜별 묶기
  const byDs={}; r.chapterLog.forEach(e=>{(byDs[e.ds]=byDs[e.ds]||[]).push(e);});
  const dss=Object.keys(byDs).sort();
  return `<div style="max-height:360px;overflow:auto">${dss.map(ds=>{
    const d=parseISO(ds);
    return `<div class="tl"><span class="tm">${fmtShort(d)} (${DOW[d.getDay()]})</span>
      <span class="nm">${byDs[ds].map(e=>`<span class="swatch" style="background:${e.color}"></span>${esc(e.name)} <span class="muted tiny">${e.chapters.map(esc).join(', ')}</span>`).join(' &nbsp;/&nbsp; ')}</span></div>`;
  }).join('')}</div>`;
}
