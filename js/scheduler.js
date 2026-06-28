/* ============================================================
   scheduler.js — 통합 스케줄 엔진 (모델 v3)

   핵심 아이디어
   - 하루 가용시간(일과 '공부' 블록 또는 날짜별 덮어쓰기)을 모듈(기본 2h)로 쪼갬.
   - 각 과목은 '주당 목표 시간'을 가짐 → 매주 그만큼의 모듈을 그 주 안에 자동 분배(인터리빙·마감 우선).
   - 과목의 '챕터(순서+예상시간)'를 따라 학습이 진행 → 그날 배운 챕터를 기록.
   - 복습은 그날 배운 챕터를 근거로 +1·+3·+7·+16일에 생성(내용 명시).
   - 'daily' 항목(Anki 등)은 매일 고정 분으로 먼저 확보.
============================================================ */

function blocksForWeekday(wd){
  return state.routine.filter(b=>b.days.includes(wd)).slice().sort((a,b)=>toMin(a.start)-toMin(b.start));
}
/* 깨어있는 시간 [wake0,wake1] — 수면 블록으로 결정(없으면 00:00~24:00) */
function awakeBounds(blocks){
  const sleep=blocks.filter(b=>b.type==='수면');let wake0=0,wake1=1440;
  if(sleep.length){const m=sleep[0];if(toMin(m.start)===0)wake0=toMin(m.end);if(toMin(m.end)>=1380)wake1=toMin(m.start);}
  return [wake0,wake1];
}
/* 요일의 '공부 가능' 빈 구간 = 깨어있는 시간 − (수면 제외) 모든 고정 블록.
   → 블록을 지우면 그 시간이 자동으로 빈 시간(공부 가능)이 된다. */
function freeWindowsForWeekday(wd){
  const blocks=blocksForWeekday(wd);
  const [wake0,wake1]=awakeBounds(blocks);
  const occ=blocks.filter(b=>b.type!=='수면')
    .map(b=>[Math.max(wake0,toMin(b.start)),Math.min(wake1,toMin(b.end))])
    .filter(([s,e])=>e>s).sort((a,b)=>a[0]-b[0]);
  const merged=[];occ.forEach(([s,e])=>{const last=merged[merged.length-1];if(last&&s<=last[1])last[1]=Math.max(last[1],e);else merged.push([s,e]);});
  const windows=[];let p=wake0;merged.forEach(([s,e])=>{if(s>p)windows.push({s:p,e:s});p=Math.max(p,e);});if(p<wake1)windows.push({s:p,e:wake1});
  const freeMin=windows.reduce((t,w)=>t+(w.e-w.s),0);
  return {wake0,wake1,windows,freeMin};
}
/* 요일별 공부 가능 시간(분) — 빈 구간의 합 */
function studyMinByWeekday(){
  const arr=[0,0,0,0,0,0,0];
  for(let wd=0;wd<7;wd++)arr[wd]=freeWindowsForWeekday(wd).freeMin;
  return arr;
}
/* 특정 날짜의 가용 공부 분 (덮어쓰기 우선) */
function dayStudyMin(ds,wd,capWd){
  const ov=state.dayOverrides&&state.dayOverrides[ds];
  if(ov!==undefined&&ov!==null&&ov!=='')return Math.round((+ov)*60);
  return capWd[wd];
}
function itemTotalHours(it){return (it.chapters||[]).reduce((t,c)=>t+(+c.hours||0),0)}

/* ── 적응형 용량(방법론 1·10절: "계획은 가설") ──────────────────
   최근 N일의 '실제 완료 분 / 가용 분'으로 *미래* 계획 용량을 보정한다.
   꾸준히 70%만 완료하면 다음 계획도 ~70%로 줄여 "실패할 계획"을 "굴러가는 계획"으로.
   - today 이전(과거)만 측정. 이력 부족(<ADAPT_MIN_DAYS) 또는 state.adaptiveCapacity===false면 1.0.
   - [0.5,1.0] 클램프: 과대축소·죽음의 나선 방지 + 상한 1.0(가용 이상으론 안 늘림 → 용량 불변식 유지). */
const ADAPT_WINDOW=14, ADAPT_MIN_DAYS=3;
function adherenceFactor(start, horizon, capWd, today){
  if(state.adaptiveCapacity===false) return 1;
  const c=state.completions||{};
  let doneMin=0, capMin=0, activeDays=0;
  for(let i=0;i<=horizon;i++){
    const date=addDays(parseISO(start),i), ds=iso(date);
    if(ds>=today) break;                            // 과거만(날짜 오름차순)
    if(dayDiff(ds,today)>ADAPT_WINDOW) continue;    // 최근 N일만
    capMin+=dayStudyMin(ds,date.getDay(),capWd);
    const m=c[ds]; let dm=0; if(m)for(const k in m)dm+=(+m[k].min||0);
    doneMin+=dm; if(dm>0)activeDays++;
  }
  if(activeDays<ADAPT_MIN_DAYS||capMin<=0) return 1;
  return clamp(doneMin/capMin, 0.5, 1.0);
}

function schedule(){
  const start=state.startDate;
  const items=state.items.filter(s=>s.name);
  const warnings=[];
  const capWd=studyMinByWeekday();
  const ML=state.moduleLen||120;
  const revFrac=(state.reviewRatio||0)/100;
  const weekly=items.filter(s=>s.mode!=='daily'&&+s.weeklyHours>0);
  const daily=items.filter(s=>s.mode==='daily'&&+s.dailyMin>0);
  if(!items.length) return {days:[],itemStat:[],weekHours:{},chapterLog:[],warnings,capUsed:0,capTotal:0,ML};

  /* 1) 기간(horizon): 마감 최댓값 vs 주당 페이스로 모든 챕터 끝낼 때까지 (최대 26주) */
  let lastDL=items.reduce((m,s)=>s.deadline&&s.deadline>m?s.deadline:m,'');
  let weeksNeed=8;
  weekly.forEach(s=>{const th=itemTotalHours(s);if(th>0)weeksNeed=Math.max(weeksNeed,Math.ceil(th/Math.max(0.1,+s.weeklyHours)));});
  weeksNeed=Math.min(weeksNeed,26);
  let endByPace=iso(addDays(mondayOf(parseISO(start)),weeksNeed*7+6));
  let endDate=lastDL&&lastDL>endByPace?lastDL:endByPace;
  const horizon=Math.max(6,dayDiff(start,endDate));

  /* 2) 일자 생성 + (적응형) 가용 용량 */
  const today=todayISO();
  const adapt=adherenceFactor(start,horizon,capWd,today);   // 0.5~1.0 (이력 부족·끄면 1.0)
  const days=[];
  for(let i=0;i<=horizon;i++){
    const date=addDays(parseISO(start),i), ds=iso(date), wd=date.getDay();
    let sMin=dayStudyMin(ds,wd,capWd);
    if(adapt<1 && ds>=today) sMin=Math.round(sMin*adapt);   // 오늘/미래만 실측 완료율로 축소(과거는 원본 유지)
    days.push({ds,date,wd,studyMin:sMin,used:0,modLeft:0,revLeft:0,items:[]});
  }
  const adaptApplied=adapt<1;

  /* 3) daily(Anki) 먼저 — 매일 고정 분 확보 */
  daily.forEach(s=>{
    const dlIdx=clamp(s.deadline?dayDiff(start,s.deadline):horizon,0,days.length-1);
    for(let j=0;j<=dlIdx;j++){const d=days[j];if(d.studyMin-d.used<=0)continue;
      const m=Math.min(+s.dailyMin,d.studyMin-d.used);if(m<=0)continue;
      d.items.push({type:'anki',sid:s.id,name:s.name,min:Math.round(m),color:s.color});d.used+=m;}
  });
  /* 남은 시간 → 학습 모듈 + 복습예산 */
  days.forEach(d=>{
    const rem=Math.max(0,d.studyMin-d.used);
    const learn=Math.round(rem*(1-revFrac));
    d.modLeft=Math.floor(learn/ML);                // 그날 가능한 학습 모듈 수
    d.revLeft=rem-d.modLeft*ML;                     // 나머지 = 복습예산
  });

  /* 4) 과목 진행 상태 초기화 (챕터 포인터)
        — '완료(done)' 표시된 챕터는 이미 학습한 것으로 보고 계획에서 제외한다. */
  weekly.forEach(s=>{
    const all=(s.chapters||[]);
    s._allTotal=all.length;                         // 전체 챕터 수
    s._done0=all.filter(c=>c.done).length;          // 이미 완료한 챕터 수
    s._hadChapters=all.length>0;
    s._chs=all.filter(c=>!c.done).map(c=>({name:c.name,hours:Math.max(0.1,+c.hours||1)})); // 남은 챕터만 배분
    s._cum=0; s._idx=0;                             // 누적 학습시간, 현재(남은 중) 챕터 인덱스
    s._totalH=s._chs.reduce((t,c)=>t+c.hours,0);
    s._dlIdx=s.deadline?clamp(dayDiff(start,s.deadline),0,days.length-1):horizon;
    s._schedMin=0; s._sessions=[]; s._carry=0;      // _carry: 분수 모듈 캐리오버
  });
  function advance(s,addMin){                       // 모듈 학습 → 어떤 챕터를 덮는지
    if(!s._chs.length)return [];
    const addH=addMin/60, from=s._cum, to=Math.min(s._totalH,s._cum+addH);
    const covered=[]; let acc=0;
    for(let k=0;k<s._chs.length;k++){
      const cs=acc, ce=acc+s._chs[k].hours;
      if(ce>from+1e-6 && cs<to-1e-6){covered.push(s._chs[k].name); if(to>=ce-1e-6)s._idx=Math.max(s._idx,k+1);}
      acc=ce;
    }
    s._cum=to; return covered;
  }
  function chaptersLeft(s){
    if(!s._hadChapters) return true;        // 챕터 없는 과목: 계속 진행(무기한)
    if(!s._chs.length) return false;        // 모든 챕터가 이미 완료됨
    return s._cum < s._totalH-1e-6;
  }

  /* 5) 주(週) 단위 학습 모듈 배분 */
  const reviewTasks=[];
  /* 복습 슬롯 ↔ Anki due 이중 계상 방지(설계도 §3-③·방법론 7·8절):
     매일 Anki(daily) 항목이 이미 시간을 예약하고 실제 due는 FSRS가 소유하므로,
     reviewViaAnki=true면 합성 간격복습(rev) 슬롯 생성을 끈다(시간 예산 중복 제거). */
  const reviewViaAnki = state.reviewViaAnki===true && daily.length>0;
  const firstMon=mondayOf(parseISO(start));
  for(let w=0; w*7<=horizon+6; w++){
    const wStart=addDays(firstMon,w*7);
    // 이번 주에 속한 day 인덱스
    const widx=[];
    for(let k=0;k<7;k++){const di=dayDiff(start,iso(addDays(wStart,k)));if(di>=0&&di<days.length)widx.push(di);}
    if(!widx.length)continue;
    // 과목별 이번 주 목표 모듈 — 분수 모듈을 캐리오버해 과/미배정 방지
    // (예: 주 1h·모듈 2h → 매주 0.5모듈씩 누적해 2주에 1모듈)
    weekly.forEach(s=>{
      if(!chaptersLeft(s)){s._weekTgt=0;s._weekDone=0;return;}
      const perWeek=(+s.weeklyHours)*60/ML;     // 이번 주 분수 모듈량
      const avail=s._carry+perWeek;
      let tgt=Math.floor(avail+1e-9);
      s._carry=avail-tgt;                        // 남은 분수는 다음 주로 이월
      s._weekTgt=tgt; s._weekDone=0;
    });
    // 슬롯 채우기: 날짜순 → 각 모듈 슬롯마다 마감 임박 & 가장 덜 채운(주간 진척) 과목
    let lastSid=null;
    widx.forEach(di=>{
      const day=days[di];
      let cap=day.modLeft;
      while(cap>0){
        let cand=weekly.filter(s=>s._weekDone<s._weekTgt && chaptersLeft(s) && di<=s._dlIdx);
        if(!cand.length)break;
        cand.sort((a,b)=>{
          const ua=a._dlIdx-di, ub=b._dlIdx-di;                 // 마감 임박 우선
          if(ua!==ub)return ua-ub;
          return (a._weekDone/a._weekTgt)-(b._weekDone/b._weekTgt); // 덜 채운 과목 우선
        });
        let pick=cand.find(s=>s.id!==lastSid)||cand[0];           // 같은 과목 연속 회피(인터리빙)
        const covered=advance(pick,ML);
        day.items.push({type:'new',sid:pick.id,name:pick.name,color:pick.color,min:ML,
          chapters:covered.slice(),mod:true});
        pick._weekDone++; pick._schedMin+=ML; pick._sessions.push({di,ds:day.ds,chapters:covered});
        lastSid=pick.id; cap--; day.used+=ML;
        // 복습 예약(그날 배운 챕터 근거) — reviewViaAnki면 Anki/FSRS가 복습을 소유하므로 생략
        if(!reviewViaAnki)
        REVIEW_OFFSETS.forEach(off=>{const ti=di+off;
          if(ti<days.length && ti<=pick._dlIdx)
            reviewTasks.push({idx:ti,sid:pick.id,name:pick.name,color:pick.color,
              chapters:covered.slice(), min:Math.max(15,Math.round(ML*0.25))});});
      }
    });
  }

  /* 6) 복습 배치 — 복습예산 우선, 없으면 모듈 잔여, 그래도 없으면 여유 큰 날.
        용량이 모자라 *못 끼우거나 억지로 넘겨 끼운* 복습은 침묵하지 말고 경고로 노출(설계 원칙 "no silent caps"·감사 F-02). */
  reviewTasks.sort((a,b)=>a.idx-b.idx);
  let revMissed=0, revOver=0;
  reviewTasks.forEach(t=>{
    const end=Math.min(days.length-1,t.idx+6);
    let tg=-1;
    for(let j=t.idx;j<=end;j++)if(days[j].revLeft>=t.min){tg=j;break;}
    if(tg<0)for(let j=t.idx;j<=end;j++)if(days[j].studyMin-days[j].used>=t.min){tg=j;break;}
    if(tg<0){let br=-1;for(let j=t.idx;j<=end;j++){const rm=days[j].studyMin-days[j].used;if(rm>br){br=rm;tg=j;}}}
    if(tg<0){revMissed++;return;}                                  // 창 안 모든 날이 초과 → 미배치(누락)
    if(days[tg].studyMin-days[tg].used<t.min)revOver++;            // 여유 없는 날에 넘겨 끼움(과적재)
    const d=days[tg];
    let ex=d.items.find(it=>it.type==='rev'&&it.sid===t.sid);
    if(ex){ex.min+=t.min; t.chapters.forEach(c=>{if(!ex.chapters.includes(c))ex.chapters.push(c);});}
    else d.items.push({type:'rev',sid:t.sid,name:t.name,color:t.color,min:t.min,chapters:t.chapters.slice()});
    d.used+=t.min; d.revLeft=Math.max(0,d.revLeft-t.min);
  });
  if(revMissed>0)warnings.push(`⚠ 복습 ${revMissed}개가 용량 부족으로 미배치됐어요 — 주당 시간↑·복습비중↑ 또는 가용시간 확보를 검토하세요.`);
  if(revOver>0)warnings.push(`⚠ 복습 ${revOver}개가 여유 없는 날에 끼워졌어요(그날 계획이 가용시간을 초과) — 일부 복습을 줄이거나 날을 비우세요.`);

  /* 6.5) 백지 복습(방법론 9절) — *단원(챕터) 단위*로 통째 재구성(감사 F-03: 과목×주 → 단원 단위 정밀화).
     각 단원을 '마지막으로 학습한 날' 직후의 여유 있는 날에 1개씩 배치(용량 초과 금지). */
  if(state.blankReviewWeekly===true){
    const blankMin=Math.max(30,Math.round(ML*0.4));
    const blankTasks=[];
    weekly.forEach(s=>{
      // 챕터(단원)별 '마지막 학습 day 인덱스' — 단원을 다 떼고 나서 백지로 점검
      const lastDiOf={};
      (s._sessions||[]).forEach(se=>{
        (se.chapters||[]).forEach(c=>{ lastDiOf[c]=Math.max(lastDiOf[c]==null?-1:lastDiOf[c], se.di); });
      });
      Object.keys(lastDiOf).forEach(ch=>{
        blankTasks.push({afterIdx:lastDiOf[ch],sid:s.id,name:s.name,color:s.color,chapters:[ch],min:blankMin});
      });
    });
    blankTasks.sort((a,b)=>a.afterIdx-b.afterIdx);
    blankTasks.forEach(t=>{
      const end=Math.min(days.length-1,t.afterIdx+6);
      let tg=-1;                                   // 학습 직후 며칠 내 여유 큰 날 — 뒤에서부터
      for(let j=end;j>=t.afterIdx;j--){if(days[j].studyMin-days[j].used>=t.min){tg=j;break;}}
      if(tg<0)return;                              // 용량 없으면 건너뜀(과적재 방지 — 의도된 캡)
      days[tg].items.push({type:'blank',sid:t.sid,name:t.name,color:t.color,min:t.min,chapters:t.chapters.slice()});
      days[tg].used+=t.min;
    });
  }

  /* 6.6) 모의시험(방법론 12절) — N주마다 1회, 그 주말의 여유 날에 1모듈(타이머·누적). */
  const mockN=+state.mockEveryWeeks||0;
  if(mockN>0){
    for(let w=0; w*7<=horizon+6; w++){
      if((w+1)%mockN!==0)continue;
      const wStart=addDays(firstMon,w*7);
      let tg=-1;
      for(let k=6;k>=0;k--){const di=dayDiff(start,iso(addDays(wStart,k)));
        if(di<0||di>=days.length)continue;
        if(days[di].studyMin-days[di].used>=ML){tg=di;break;}}
      if(tg<0)continue;
      const learnedBefore=days.slice(0,tg+1).some(d=>d.items.some(it=>it.type==='new'));
      if(!learnedBefore)continue;                  // 배운 게 있어야 모의시험 의미
      days[tg].items.push({type:'mock',sid:'mock',name:'모의시험',color:'#b794f6',min:ML,chapters:[]});
      days[tg].used+=ML;
    }
  }

  /* 7) 통계 */
  const itemStat=weekly.map(s=>{
    // 전체 챕터 기준 진행 = 이미 완료(_done0) + 이번 계획으로 끝내는 남은 챕터(_idx)
    const total=s._allTotal, doneCh=Math.min(s._done0+s._idx,total);
    let lastIdx=-1;for(let j=days.length-1;j>=0;j--)if(days[j].items.some(it=>it.sid===s.id&&it.type==='new')){lastIdx=j;break;}
    const finishDate=lastIdx>=0?days[lastIdx].ds:null;
    const finished=!chaptersLeft(s);
    const late=(finished&&finishDate&&s.deadline)?Math.max(0,dayDiff(s.deadline,finishDate)):0;
    if(s.deadline&&!finished)warnings.push(`⚠ "${s.name}": 마감(${s.deadline})까지 주 ${s.weeklyHours}h로는 챕터를 다 못 끝내요. 주당 시간↑.`);
    else if(late>0)warnings.push(`⚠ "${s.name}": 학습 종료(${finishDate})가 마감(${s.deadline}) 초과.`);
    return {id:s.id,name:s.name,color:s.color,weeklyHours:+s.weeklyHours,totalCh:total,doneCh,
      totalH:Math.round(s._totalH*10)/10,schedH:Math.round(s._schedMin/60*10)/10,
      deadline:s.deadline,finishDate,finished,late};
  });
  daily.forEach(s=>{const planned=days.filter(d=>d.items.some(it=>it.sid===s.id)).length;
    itemStat.push({id:s.id,name:s.name,color:s.color,daily:true,dailyMin:+s.dailyMin,days:planned,
      schedH:Math.round(planned*s.dailyMin/60*10)/10});});

  /* 주별 과목 시간(통계용) + 챕터 학습 로그 */
  const weekHours={}; const chapterLog=[];
  days.forEach(d=>{
    const wk=iso(mondayOf(d.date));
    d.items.forEach(it=>{
      if(it.type==='anki'||it.type==='new'){
        weekHours[wk]=weekHours[wk]||{}; weekHours[wk][it.sid]=(weekHours[wk][it.sid]||0)+it.min/60;}
      if(it.type==='new'&&it.chapters&&it.chapters.length)
        chapterLog.push({ds:d.ds,date:d.date,name:it.name,color:it.color,chapters:it.chapters});
    });
  });

  let capTotal=0,capUsed=0;
  days.forEach(d=>{capTotal+=d.studyMin;capUsed+=d.used;});
  return {days,itemStat,weekHours,chapterLog,warnings:[...new Set(warnings)],capUsed,capTotal,ML,
    adapt,adaptApplied,reviewViaAnki};
}

/* 피크 시간대(방법론 1절: "가장 어려운 새 학습을 가장 맑을 때") — [시작분,끝분] 또는 null */
function peakRange(){
  const a=state.peakStart, b=state.peakEnd;
  if(!a||!b) return null;
  const s=toMin(a), e=toMin(b);
  return (e>s)?[s,e]:null;
}
/* 빈 구간 배열에서 여러 [a,b]를 빼서 새 배열을 만든다(중간을 빼면 둘로 쪼갬). */
function subtractIntervals(segs,intervals){
  let res=segs.map(x=>x.slice());
  intervals.forEach(([a,b])=>{const out=[];res.forEach(([s,e])=>{
    if(b<=s||a>=e){out.push([s,e]);return;} if(a>s)out.push([s,a]); if(b<e)out.push([b,e]);
  });res=out.filter(([s,e])=>e>s);});
  return res;
}

/* 하루 타임라인: 모듈/복습/Anki에 실제 시각 배정 + 빈 시간 계산.
   피크 시간대가 설정돼 있으면 고인지부하(new·mock)를 피크 구간에 먼저 배치(방법론 1절).
   피크 미설정 시엔 입력 순서대로 이른 시각부터 채우는 기존 동작과 동일. */
function layoutDay(day){
  const blocks=blocksForWeekday(day.wd);
  const {wake0,wake1,windows}=freeWindowsForWeekday(day.wd);   // 공부는 빈 구간에 배치
  const peak=peakRange();
  let segs=windows.map(w=>[w.s,w.e]);                          // 가변 빈 구간
  const sessions=[];
  const HIGH=it=>it.type==='new'||it.type==='mock';           // 고인지부하 → 피크 우선
  function take(need,prefer){                                  // 이른 시각부터 need분 할당(여러 구간 쪼갬 허용)
    const placed=[], cand=[];
    segs.forEach(seg=>{let[s,e]=seg; if(prefer){s=Math.max(s,prefer[0]);e=Math.min(e,prefer[1]);} if(e>s)cand.push([s,e]);});
    cand.sort((a,b)=>a[0]-b[0]);
    for(const [s,e] of cand){ if(need<=0)break; const use=Math.min(e-s,need); placed.push([s,s+use]); need-=use; }
    if(placed.length)segs=subtractIntervals(segs,placed);
    return {placed,need};
  }
  function placeItem(it,prefer){
    let need=it.min;
    if(prefer){const r=take(need,prefer); r.placed.forEach(([s,e])=>sessions.push({...it,start:s,end:e})); need=r.need;}
    if(need>0){const r=take(need,null); r.placed.forEach(([s,e])=>sessions.push({...it,start:s,end:e})); need=r.need;}
    if(need>0)sessions.push({...it,start:null,end:null,over:need});
  }
  // 피크가 있으면 고인지부하부터 처리(피크 선점), 없으면 원래 순서 그대로
  const order = peak ? [...day.items.filter(HIGH), ...day.items.filter(it=>!HIGH(it))] : day.items.slice();
  order.forEach(it=> placeItem(it, peak&&HIGH(it)?peak:null));
  const tl=[];
  blocks.filter(b=>b.type!=='수면').forEach(b=>tl.push({kind:'block',name:b.name,btype:b.type,start:toMin(b.start),end:toMin(b.end),color:BLOCK_TYPES[b.type]}));
  sessions.forEach(s=>{if(s.start!=null)tl.push({kind:'study',...s});});
  tl.sort((a,b)=>a.start-b.start);
  const occ=tl.filter(x=>x.start!=null).map(x=>[x.start,x.end]).sort((a,b)=>a[0]-b[0]);
  const free=[];let p=wake0;occ.forEach(([s,e])=>{if(s>p)free.push([p,s]);p=Math.max(p,e);});if(p<wake1)free.push([p,wake1]);
  const freeMin=free.reduce((t,[s,e])=>t+(e-s),0);
  return {tl,free,freeMin,sessions};
}

/* ============================================================
   .ics(iCalendar) 내보내기 — 학습/복습/Anki 세션을 실제 시각으로 변환.
   구글/애플/아웃룩 캘린더에 그대로 가져올 수 있다.
============================================================ */
function icsEsc(s){return(s||'').toString().replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\n/g,'\\n');}
function icsDt(ds,min){               // 로컬 시각 → YYYYMMDDTHHMMSS (플로팅 로컬타임)
  const d=parseISO(ds); const h=Math.floor(min/60), m=min%60;
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}T${String(h).padStart(2,'0')}${String(m).padStart(2,'0')}00`;
}
function buildICS(){
  const r=schedule();
  const stamp=icsDt(iso(new Date()),new Date().getHours()*60+new Date().getMinutes());
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//러닝허브//KR','CALSCALE:GREGORIAN','METHOD:PUBLISH'];
  (r.days||[]).forEach(day=>{
    if(!day.items.length)return;
    const L=layoutDay(day);
    L.tl.filter(x=>x.kind==='study'&&x.start!=null).forEach((x,i)=>{
      const label=x.type==='new'?'📘 학습':x.type==='rev'?'🔁 복습':x.type==='blank'?'📝 백지복습':x.type==='mock'?'🧪 모의시험':'🃏 Anki';
      const ch=(x.chapters&&x.chapters.length)?' — '+x.chapters.join(', '):'';
      lines.push('BEGIN:VEVENT',
        `UID:${day.ds}-${x.sid}-${x.type}-${i}-${rid()}@studyplanner`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${icsDt(day.ds,x.start)}`,
        `DTEND:${icsDt(day.ds,x.end)}`,
        `SUMMARY:${icsEsc(label+' '+x.name)}`,
        `DESCRIPTION:${icsEsc(x.name+ch+' ('+hLabel(x.end-x.start)+')')}`,
        'END:VEVENT');
    });
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
function exportICS(){
  const ics=buildICS();
  const blob=new Blob([ics],{type:'text/calendar;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download='러닝허브_'+state.startDate+'.ics';a.click();
}

/* ESM-AUTO-EXPOSE */
/* ESM: 이 모듈의 공개 심볼을 전역에 노출 — 인라인 onclick·타 모듈 호출용
   (모듈 내부 헬퍼는 위에 두면 비공개. 여긴 파일의 공개 표면) */
Object.assign(globalThis, { blocksForWeekday, awakeBounds, freeWindowsForWeekday, studyMinByWeekday, dayStudyMin, itemTotalHours, ADAPT_WINDOW, adherenceFactor, schedule, peakRange, subtractIntervals, layoutDay, icsEsc, icsDt, buildICS, exportICS });
