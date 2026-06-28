/* ============================================================
   ui-schedule.js — 탭: 주간 스케줄 (한 주씩 넘겨보기)
============================================================ */
let weekOffset=0;   // 0 = 시작일이 포함된 주
let schedView=(()=>{try{return localStorage.getItem('sched_view')||'overview'}catch(e){return 'overview'}})(); // 'overview' | 'cards'
let schedSelDow=null;   // 개요 뷰에서 펼쳐 볼 요일(월=0..일=6). null이면 오늘 자동 선택
function setSchedView(v){schedView=v;try{localStorage.setItem('sched_view',v)}catch(e){};renderSchedule(pageEl());}
function schedSelect(k){schedSelDow=k;renderSchedule(pageEl());}

function renderSchedule(p){
  persist(); RES=schedule();
  const r=RES;
  const baseMon=mondayOf(parseISO(state.startDate));
  const curMon=addDays(baseMon,weekOffset*7);
  const warn=r.warnings.length?`<div class="warnbox ${r.warnings.some(w=>w.includes('못')||w.includes('초과'))?'bad':''}">${r.warnings.map(w=>`<div>${w}</div>`).join('')}</div>`:'';
  p.innerHTML=`
  ${warn}
  ${deadlineCard()}
  <div class="card">
    <div class="row" style="align-items:center">
      <button class="sm" onclick="weekNav(-1)">◀ 이전 주</button>
      <div style="flex:1;text-align:center;min-width:120px"><b style="font-size:15px">${weekLabel(curMon)}</b>
        <span class="muted tiny"> ${weekOffset===0?'· 이번 주':(weekOffset>0?'· +'+weekOffset+'주':'· '+weekOffset+'주')}</span></div>
      <button class="sm" onclick="weekNav(1)">다음 주 ▶</button>
      <button class="sm ghost" onclick="weekToday()">오늘</button>
      <div class="seg" role="tablist" aria-label="주간 보기 방식" style="margin-left:6px">
        <button role="tab" aria-selected="${schedView==='overview'}" class="${schedView==='overview'?'on':''}" onclick="setSchedView('overview')">개요</button>
        <button role="tab" aria-selected="${schedView==='cards'}" class="${schedView==='cards'?'on':''}" onclick="setSchedView('cards')">카드</button>
      </div>
    </div>
    <div class="foot">${schedView==='overview'?'위 막대에서 요일을 누르면 그날 일정이 아래에 펼쳐져요. ':''}각 날짜의 <b>가용 시간</b>은 그 칸에서 바로 바꿀 수 있어요(그날만 적용). 모듈 ${(r.ML/60)}시간 단위.</div>
  </div>
  <div id="weekBody"></div>`;
  renderWeekBody(curMon);
}
function weekNav(d){weekOffset+=d;renderSchedule(pageEl());}
function weekToday(){
  const base=iso(mondayOf(parseISO(state.startDate)));
  weekOffset=Math.round(dayDiff(base,iso(mondayOf(new Date())))/7);
  schedSelDow=null;          // 개요 뷰: 오늘로 자동 점프
  renderSchedule(pageEl());
}

/* 하루치 렌더 조각(머리글/막대/타임라인 행/꼬리) 계산 — 카드뷰·개요뷰 공용 */
function dayParts(curMon,k){
  const r=RES;
  const byDs={}; (r.days||[]).forEach(d=>byDs[d.ds]=d);
  const capWd=studyMinByWeekday();
  const todayIso=iso(new Date());
  const nowD=new Date(); const nowMin=nowD.getHours()*60+nowD.getMinutes();
  const date=addDays(curMon,k), ds=iso(date), wd=date.getDay();
  const isToday=ds===todayIso;
  const defMin=capWd[wd];                                   // 일과 기본 공부시간
  const studyMin=dayStudyMin(ds,wd,capWd);                  // 덮어쓰기 반영
  const ovVal=(state.dayOverrides&&state.dayOverrides[ds]!=null)?state.dayOverrides[ds]:'';
  const planDay=byDs[ds];
  const items=planDay?planDay.items:[];
  const L=layoutDay({wd,items});                            // 일과 블록 + 학습 세션 + 빈시간
  const used=planDay?Math.round(planDay.used):0;
  const over=used>studyMin+1;
  const ratio=studyMin?Math.min(100,Math.round(used/studyMin*100)):0;

  // (sid|type)별 계획시간 — 완료 체크 시 기록할 실제 분 추정
  const plannedByKey={};
  items.forEach(it=>{const key=it.sid+'|'+it.type;plannedByKey[key]=(plannedByKey[key]||0)+it.min;});
  // 완료 진척
  const planMin=items.reduce((t,it)=>t+it.min,0);
  let doneMinTot=0; Object.keys(plannedByKey).forEach(key=>{const[sid,type]=key.split('|');if(isDone(ds,sid,type))doneMinTot+=plannedByKey[key];});

  const head=`<div class="dh">
    <span class="dt">${DOW_MON[k]} <span class="muted" style="font-weight:400">${fmtShort(date)}</span>${isToday?' <span class="todaychip">오늘</span>':''}</span>
    <span class="cap">가용 <input type="number" step="0.5" min="0" value="${ovVal}" placeholder="${(defMin/60)}" aria-label="${fmtShort(date)} 가용시간(시간)"
      onchange="setDayOverride('${ds}',this.value)" style="width:54px;display:inline-block;padding:3px 6px;text-align:center">h
      <span class="muted tiny">· 배정 ${(used/60).toFixed(1)}h</span></span>
  </div>`;

  // 일과 블록 + 학습 + 빈 시간(+ 오늘이면 현재시각 라인)을 시각순으로 합쳐서 렌더
  const extra=[...L.free.map(([s,e])=>({kind:'free',start:s,end:e}))];
  if(isToday)extra.push({kind:'now',start:nowMin});
  const merged=[...L.tl, ...extra].sort((a,b)=>a.start-b.start);
  let rows=merged.map(x=>{
    if(x.kind==='now'){
      return `<div class="tl nowline"><span class="tm">${toHM(nowMin)}</span><span class="nm">⏱ 지금</span><span class="mn"></span></div>`;
    }
    if(x.kind==='free'){
      if(x.end-x.start<5)return '';
      return `<div class="tl free"><span class="tm">${toHM(x.start)}–${toHM(x.end)}</span><span class="nm muted">🟢 빈 시간</span><span class="mn">${hLabel(x.end-x.start)}</span></div>`;
    }
    if(x.kind==='block'){
      return `<div class="tl block"><span class="tm">${toHM(x.start)}–${toHM(x.end)}</span><span class="swatch" style="background:${x.color}"></span><span class="nm muted">${esc(x.name)}</span><span class="mn">${x.btype}</span></div>`;
    }
    return studyRow(ds,x,toHM(x.start)+'–'+toHM(x.end),hLabel(x.end-x.start),plannedByKey[x.sid+'|'+x.type]||x.min);
  }).join('');
  // 공부창에 시각 못 잡은 항목(여유 없음) 보강
  const shown=new Set(L.tl.filter(x=>x.kind==='study').map(x=>x.sid+'|'+x.type));
  items.forEach(it=>{if(!shown.has(it.sid+'|'+it.type)){
    rows+=studyRow(ds,it,'<span class="muted">미배치</span>',hLabel(it.min),plannedByKey[it.sid+'|'+it.type]||it.min);
  }});

  const studies=items.filter(it=>it.type==='new').length;
  const revs=items.filter(it=>it.type==='rev').length;
  const ankis=items.filter(it=>it.type==='anki').length;
  const blanks=items.filter(it=>it.type==='blank').length;
  const mocks=items.filter(it=>it.type==='mock').length;
  const freeTag=L.freeMin>0?`<span class="pill tiny">빈 ${(L.freeMin/60).toFixed(1)}h</span>`:'';
  const doneTag=planMin>0?`<span class="pill tiny ${doneMinTot>=planMin?'good':''}">완료 ${(doneMinTot/60).toFixed(1)}/${(planMin/60).toFixed(1)}h</span>`:'';
  const extraCount=(blanks?` · 백지 ${blanks}`:'')+(mocks?` · 모의 ${mocks}`:'');
  const foot=`<div class="tl" style="border:none"><span class="nm tiny muted">학습 ${studies}모듈 · 복습 ${revs} · Anki ${ankis}${extraCount}</span>${doneTag}${freeTag}</div>`;
  const bar=studyMin?`<div class="bar"><i style="width:${ratio}%;background:${over?'var(--bad)':ratio>90?'var(--warn)':'var(--acc)'}"></i></div>`:'';

  return {date,ds,wd,isToday,head,bar,rows,foot,used,studyMin,doneMinTot,planMin};
}

/* 카드뷰 / 개요뷰 분기 렌더 */
function renderWeekBody(curMon){
  const host=document.getElementById('weekBody');
  if(schedView==='cards'){
    host.className='weekgrid';
    let html='';
    for(let k=0;k<7;k++){const d=dayParts(curMon,k);
      html+=`<div class="day${d.isToday?' today':''}">${d.head}${d.bar}<div class="body">${d.rows||'<div class="tl free"><span class="nm muted">일과 블록 없음</span></div>'}${d.foot}</div></div>`;}
    host.innerHTML=html; return;
  }
  // ── 개요 뷰: 7일 막대 스트립 + 선택일 아젠다 ──
  host.className='';
  const parts=[]; for(let k=0;k<7;k++)parts.push(dayParts(curMon,k));
  let sel=schedSelDow;
  if(sel==null||sel<0||sel>6){const ti=parts.findIndex(p=>p.isToday);sel=ti>=0?ti:0;}
  const maxRef=Math.max(1,...parts.map(p=>Math.max(p.studyMin,p.used)));
  const strip=`<div class="wkstrip" role="tablist" aria-label="요일 선택">${parts.map((p,k)=>{
    const doneFrac=Math.round(p.doneMinTot/maxRef*100);
    const usedFrac=Math.round(p.used/maxRef*100);
    const remFrac=Math.max(0,usedFrac-doneFrac);
    const remColor=p.used>p.studyMin+1?'var(--bad)':'var(--acc)';
    return `<button class="wkcol${k===sel?' sel':''}${p.isToday?' today':''}" role="tab" aria-selected="${k===sel}"
       onclick="schedSelect(${k})" title="${DOW_MON[k]} ${fmtShort(p.date)} · 배정 ${(p.used/60).toFixed(1)}h">
      <span class="wd">${DOW_MON[k]}${p.isToday?'<span class="wkdot"></span>':''}</span>
      <span class="dd">${p.date.getDate()}</span>
      <span class="col-bar"><i style="height:${doneFrac}%;background:var(--good)"></i><i style="height:${remFrac}%;background:${remColor}"></i></span>
      <span class="col-h">${(p.used/60).toFixed(1)}<span class="col-sub">h</span></span>
    </button>`;
  }).join('')}</div>`;
  const d=parts[sel];
  const agenda=`<div class="day agenda${d.isToday?' today':''}">${d.head}${d.bar}<div class="body">${d.rows||'<div class="tl free"><span class="nm muted">일과 블록 없음</span></div>'}${d.foot}</div></div>`;
  host.innerHTML=strip+agenda;
}
/* 학습/복습/Anki 한 줄 — 완료 체크박스 포함 */
function studyRow(ds,x,timeHtml,durHtml,plannedMin){
  const tag=x.type==='new'?'<span class="tag new">학습</span>':x.type==='rev'?'<span class="tag rev">복습</span>'
    :x.type==='blank'?'<span class="tag blank">백지</span>':x.type==='mock'?'<span class="tag mock">모의</span>':'<span class="tag anki">Anki</span>';
  const ch=(x.chapters&&x.chapters.length)?` <span class="muted tiny">· ${x.chapters.map(esc).join(', ')}</span>`:'';
  const done=isDone(ds,x.sid,x.type);
  const cb=`<input type="checkbox" class="donechk" ${done?'checked':''} title="완료 표시"
     aria-label="${esc(x.name)} 완료" onchange="toggleDone('${ds}','${x.sid}','${x.type}',${Math.round(plannedMin)},this.checked)">`;
  return `<div class="tl${done?' rowdone':''}">${cb}<span class="tm">${timeHtml}</span><span class="swatch" style="background:${x.color}"></span>${tag}<span class="nm">${esc(x.name)}${ch}</span><span class="mn">${durHtml}</span></div>`;
}
function toggleDone(ds,sid,type,plannedMin,on){setDone(ds,sid,type,plannedMin,on);renderSchedule(pageEl());}

/* 마감 임박 D-day 카드 */
function deadlineCard(){
  const today=iso(new Date());
  const dl=(state.items||[]).filter(s=>s.deadline).map(s=>({name:s.name,color:s.color,deadline:s.deadline,dday:dayDiff(today,s.deadline)}))
    .sort((a,b)=>a.dday-b.dday);
  if(!dl.length)return '';
  const chip=d=>{
    const lab=d.dday===0?'D-DAY':d.dday>0?'D-'+d.dday:'D+'+(-d.dday);
    const cls=d.dday<0?'bad':d.dday<=7?'warn':'';
    return `<span class="ddaychip ${cls}"><span class="swatch" style="background:${d.color}"></span>${esc(d.name)} <b>${lab}</b> <span class="muted tiny">${d.deadline}</span></span>`;
  };
  return `<div class="card"><h2 style="margin-bottom:8px">⏳ 마감 카운트다운</h2><div class="ddrow">${dl.map(chip).join('')}</div></div>`;
}
function setDayOverride(ds,v){
  state.dayOverrides=state.dayOverrides||{};
  if(v===''||v==null)delete state.dayOverrides[ds]; else state.dayOverrides[ds]=+v;
  persist(); renderSchedule(pageEl());
}
