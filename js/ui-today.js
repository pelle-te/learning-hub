/* ============================================================
   ui-today.js — 탭: 🎯 오늘 학습 (학습방법론 실행 레이어)
   - 오늘 배치된 블록 + 블록 내부 4단계 흐름 가이드(방법론 2절)
   - 3문장 요약(3절) · CBMS 오답(6절) · '보충 필요' 백로그(5절) 기록
   계획(스케줄 탭)이 '언제/무엇'이라면, 이 탭은 '블록 안에서 어떻게'를 굴린다.
============================================================ */

/* 블록 4단계 흐름(방법론 2절) — [이름, 시작%, 끝%, 핵심행동] */
const BLOCK_STAGES=[
  ['① 개념 정찰', 0, 15, '정독 아닌 정찰 — 핵심 정의·"왜 이걸 해석하나"로 큰 그림만'],
  ['② 예제·풀이', 15, 78, '블록의 본체. 스스로 먼저 → 막히면 70% 룰(단계적 힌트). 막힌 좌표 메모'],
  ['③ 핵심 스케치', 78, 85, '선택 — 까다로운 1~2개만 책 덮고 이중부호화 스케치'],
  ['④ 3문장 요약', 85, 100, '보지 않고 내 언어로 3줄(What&Why / How / Result&Meaning)'],
];

/* itemById는 utils.js로 이동(여러 탭 공용). 과목 선택 <option> 목록 (selSid 선택 유지) */
function subjectOptions(selSid){
  const opts=['<option value="">(과목 선택)</option>'];
  (state.items||[]).filter(i=>i.name).forEach(i=>{
    opts.push(`<option value="${i.id}"${i.id===selSid?' selected':''}>${esc(i.name)}</option>`);
  });
  return opts.join('');
}

function renderToday(p){
  persist(); RES=schedule();
  const ds=iso(new Date());
  const day=(RES.days||[]).find(d=>d.ds===ds);
  const todayD=new Date();

  p.innerHTML=`
  ${setupGuideCard()}
  ${ritualCard(ds,day)}
  ${principlesCard()}
  ${todayBlocksCard(ds,day)}
  ${flowGuideCard()}
  ${summaryCard(ds)}
  ${cbmsCard(ds)}
  ${backlogCard()}`;
}

/* ── 첫 실행 셋업 가이드(온보딩) ──
   콜드 스타트에서 빈 화면만 보이지 않도록, 동작에 필요한 3스텝을 라이브 체크로 안내.
   과목+목표가 갖춰지면 카드는 자동으로 사라진다. */
function setupGuideCard(){
  const items=state.items||[];
  const hasSubjects=items.some(i=>i.name);
  const hasTargets=items.some(i=>i.name&&((i.mode==='daily'&&i.dailyMin>0)||(i.weeklyHours>0)||(i.chapters&&i.chapters.length)));
  const hasRoutine=(state.routine||[]).length>0;
  if(hasSubjects&&hasTargets) return '';   // 셋업 완료 → 숨김

  const steps=[
    [hasSubjects,'공부할 과목 추가','볼트(전공 폴더)에서 통째로 불러오거나 직접 입력하세요.',
      `<button class="sm primary" onclick="go('items')">학습 항목 열기</button> <button class="sm" onclick="go('vault')">볼트에서 불러오기</button>`],
    [hasTargets,'주당 목표 시간·챕터 설정','과목마다 주당 몇 시간 공부할지와 챕터(순서)를 정하면 블록이 배분됩니다.',
      `<button class="sm${hasSubjects?' primary':''}" onclick="go('items')">학습 항목에서 설정</button>`],
    [hasRoutine,'일과·가용 시간 확인','수면·식사·수업을 빼고 남는 빈 시간이 자동으로 공부시간이 됩니다(기본값 제공 — 필요 시 조정).',
      `<button class="sm" onclick="go('routine')">일과 열기</button>`],
  ];
  const done=steps.filter(s=>s[0]).length;
  const rows=steps.map(([ok,title,desc,actions])=>`
    <div class="setup-step ${ok?'ok':''}">
      <span class="setup-ck ${ok?'on':''}" aria-hidden="true">${ok?'✓':''}</span>
      <div class="setup-body">
        <div class="setup-title">${ok?'<s>'+esc(title)+'</s>':esc(title)}</div>
        <div class="muted tiny">${esc(desc)}</div>
        ${ok?'':`<div class="setup-act">${actions}</div>`}
      </div>
    </div>`).join('');
  return `<div class="card setup-card">
    <h2>👋 시작하기 <span class="muted tiny">— 3단계만 채우면 오늘의 블록이 자동으로 잡혀요</span></h2>
    <div class="row" style="align-items:center;margin-bottom:6px">
      <span class="pill ${done===3?'good':'warn'}">${done}/3 완료</span>
      <span class="setup-prog"><i style="width:${Math.round(done/3*100)}%"></i></span>
    </div>
    ${rows}
  </div>`;
}

/* ── 오늘 한눈에 + 일일 의식(아침 계획·저녁 셧다운 · Sunsama 델타) ──
   '홈 대시보드'(크로스탭 KPI)와 '의식'(계획→셧다운 리듬)을 한 카드로. */
function ritualCard(ds,day){
  const r=getRitual(ds);
  const items=day?day.items:[];
  const total=items.length, done=items.filter(it=>isDone(ds,it.sid,it.type)).length;
  const streak=studyStreak();
  const openBl=openBacklog().length;
  const v=state._ankiLive;
  const due=(v&&v.decks)?v.decks.reduce((t,d)=>t+(+d.new||0)+(+d.learn||0)+(+d.review||0),0):null;
  const gl=(val,lab)=>`<div class="gl"><div class="gl-v">${val}</div><div class="gl-l">${lab}</div></div>`;
  return `<div class="card ritual-card">
    <h2>☀️ 오늘 한눈에 <span class="muted tiny">— 아침 계획 → 저녁 셧다운(작은 의식이 일관성을 만든다)</span></h2>
    <div class="glance">
      ${gl((total?done+'/'+total:'—'),'오늘 블록')}
      ${gl('🔥 '+streak,'연속 학습일')}
      ${gl((due==null?'—':due),'Anki due')}
      ${gl(openBl,'열린 보충')}
    </div>
    <div class="ritual-row">
      <label class="ritual-ck"><input type="checkbox" ${r.plan?'checked':''} onchange="toggleRitual('${ds}','plan',this.checked)"> 🌅 <b>아침 계획</b> <span class="muted tiny">블록 훑고 오늘 가장 중요한 1개 정하기</span></label>
      <label class="ritual-ck"><input type="checkbox" ${r.shutdown?'checked':''} onchange="toggleRitual('${ds}','shutdown',this.checked)"> 🌙 <b>저녁 셧다운</b> <span class="muted tiny">완료 체크 · 내일 한 줄 · 끝내기</span></label>
    </div>
  </div>`;
}
function toggleRitual(ds,key,on){setRitual(ds,key,on);renderToday(pageEl());toast(on?'기록됨 👍':'해제됨','info',1400);}

/* ── 0절 5원리 + 오늘 한 줄 ── */
function principlesCard(){
  const pr=[
    ['능동 인출','덮고 떠올린다'],
    ['분산','시간을 벌려 다시 만난다'],
    ['인터리빙','유형을 섞어 푼다'],
    ['이중부호화','그림+수식 동시에'],
    ['메타인지','어디서 왜 막히는지 안다'],
  ];
  return `<div class="card">
    <h2>🎯 오늘 학습 <span class="muted tiny">— "이해했다"는 착각을 "꺼낼 수 있다"는 증거로</span></h2>
    <div class="princ">${pr.map(([a,b])=>`<span class="princ-chip"><b>${a}</b> ${b}</span>`).join('')}</div>
    <div class="foot">바쁜 날엔 <b>풀이 1~2문제 + 3문장 요약 + Anki 점검</b>만 — <i>작은 일관성 &gt; 완벽한 중단</i>(부록 C).</div>
  </div>`;
}

/* ── 오늘의 블록 ── */
function todayBlocksCard(ds,day){
  const items=day?day.items:[];
  if(!items.length){
    return `<div class="card"><h2>오늘의 블록</h2>
      <div class="empty">오늘 배치된 블록이 없어요. <b>학습 항목</b>·<b>일과</b> 탭에서 과목/가용시간을 설정하면 여기에 블록이 나타납니다.</div></div>`;
  }
  // 시각 배정(빈 시간 기준)
  const L=layoutDay({wd:new Date(ds+'T00:00:00').getDay(),items});
  const timeBy={}; L.sessions.forEach(s=>{if(s.start!=null&&timeBy[s.sid+'|'+s.type]==null)timeBy[s.sid+'|'+s.type]=toHM(s.start)+'–'+toHM(s.end);});

  const rows=items.map(it=>{
    const tm=timeBy[it.sid+'|'+it.type]||'';
    const done=isDone(ds,it.sid,it.type);
    const cb=doneCheckbox(ds,it.sid,it.type,it.min,it.name);   // 공용 완료 체크박스(F-08)
    const ch=(it.chapters&&it.chapters.length)?`<span class="muted tiny"> · ${it.chapters.map(esc).join(', ')}</span>`:'';
    const head=`<div class="blkhead ${done?'rowdone':''}">${cb}<span class="swatch" style="background:${it.color||'#6ea8fe'}"></span>
      <b>${esc(it.name)}</b>${ch}<span class="mn muted tiny">${tm?tm+' · ':''}${hLabel(it.min)}</span></div>`;

    if(it.type==='new'){
      return `<div class="blk">${head}
        ${stageBar(state.moduleLen||120)}
        <div class="blk-actions">
          <button class="sm" onclick="prefillSummary('${it.sid}')">✍ 3문장 요약</button>
          <button class="sm" onclick="prefillCbms('${it.sid}')">✗ 오답 기록</button>
          <button class="sm ghost" onclick="prefillBacklog('${it.sid}')">🏷 보충 필요</button>
        </div></div>`;
    }
    if(it.type==='blank'){
      // 백지 복습: 단원 통째 재구성 후 통과/막힘을 *명시 기록*(근사 아닌 실측 · 막힘→CBMS) — 감사 F-04
      const note='📝 백지 복습 — 아무것도 안 보고 통째로 재구성: 뼈대 마인드맵 → 도식+결론식 → 막힌 구간 체크.';
      const res=blankResultFor(ds,it.sid);
      const chArg=jsq((it.chapters||[]).join(', '));
      let resHtml;
      if(res){
        resHtml=res.passed
          ? `<span class="pill good">✅ 통과 기록됨</span>`
          : `<span class="pill warn">⚠ 막힘 기록됨${res.note?' · '+esc(res.note):''} <span class="muted tiny">→ CBMS(C) 연결</span></span>`;
        resHtml+=` <button class="sm ghost" onclick="clearBlankResultUI('${ds}','${it.sid}')" title="기록 지우기">기록 지우기</button>`;
      }else{
        resHtml=`<button class="sm" onclick="blankPass('${ds}','${it.sid}','${jsq(it.name)}')">✅ 통과</button>
          <button class="sm" onclick="blankBlocked('${ds}','${it.sid}','${jsq(it.name)}','${chArg}')">⚠ 막힘(→CBMS)</button>`;
      }
      return `<div class="blk">${head}<div class="blk-note tiny muted">${note}</div>
        <div class="blk-actions" style="margin-top:6px">${resHtml}</div></div>`;
    }
    let note='';
    if(it.type==='rev')   note='🔁 간격 복습 — Anki 카드 인출. 막히면 그 구간을 CBMS로 분류.';
    else if(it.type==='anki') note='🃏 자동 생성 카드 <b>30초 큐레이션</b> — 쓰레기 버리고 ≤5장, 한두 장은 "왜?/응용"형으로.';
    else if(it.type==='mock') note='🧪 모의시험 — 타이머 ON · 노트 닫기 · 혼합/누적 · 끝까지 깔끔히. 끝나면 CBMS(+시간부족 T)로 분류.';
    return `<div class="blk">${head}<div class="blk-note tiny muted">${note}</div></div>`;
  }).join('');

  return `<div class="card"><h2>오늘의 블록 <span class="muted tiny">${fmt(new Date(ds+'T00:00:00'))}</span></h2>${rows}</div>`;
}
/* 완료 토글은 공용 toggleDoneAt(ui-kit)로 일원화 — 별도 toggleDoneToday 제거(F-08) */
/* 백지 복습 통과/막힘 기록(방법론 9절·E4) — 막힘은 CBMS(C 개념)로 자동 연결 */
function blankPass(ds,sid,name){setBlankResult(ds,sid,name,true,'','');renderToday(pageEl());}
async function blankBlocked(ds,sid,name,chapters){
  const note=await promptModal('어느 구간에서 막혔나요? (이 메모는 CBMS 개념(C) 오답으로 자동 연결됩니다)',{title:'백지 복습 — 막힘 기록',placeholder:'예) 파동방정식 유도에서 막힘'});
  if(note===null)return;                         // 취소
  setBlankResult(ds,sid,name,false,(note||'').trim(),chapters||'');
  renderToday(pageEl());
  toast('막힘 기록됨 — CBMS(C 개념)로 연결했어요.','ok');
}
function clearBlankResultUI(ds,sid){clearBlankResult(ds,sid);renderToday(pageEl());}

/* 블록 4단계 비중 막대(분 추정 포함) */
function stageBar(ML){
  const seg=BLOCK_STAGES.map(([nm,s,e,act])=>{
    const w=e-s, mins=Math.round(ML*w/100);
    return `<div class="stg" style="flex:${w}" title="${esc(nm)} (~${mins}분) — ${esc(act)}">
      <span class="stg-nm">${esc(nm)}</span><span class="stg-mn">~${mins}m</span></div>`;
  }).join('');
  return `<div class="stagebar">${seg}</div>
    <div class="blk-note tiny muted">막히면 <b>70% 룰</b>: 씨름 10–15분 → 힌트 한 조각(보고 다시 덮기) → 블록 70%서 멈춰 <i>가정·결과식·의미만</i> + <b>보충 필요</b> 라벨 + 요약은 한다.</div>`;
}

/* ── 블록 흐름 가이드(참고) ── */
function flowGuideCard(){
  const rows=BLOCK_STAGES.map(([nm,s,e,act])=>`<tr><td><b>${esc(nm)}</b></td><td class="muted tiny">${s}–${e}%</td><td>${esc(act)}</td></tr>`).join('');
  return `<div class="card"><details>
    <summary>📖 블록 흐름·체크리스트 (방법론 2·5·부록 B)</summary>
    <table style="margin-top:10px"><thead><tr><th>단계</th><th>비중</th><th>핵심 행동</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="foot" style="margin-top:10px"><b>주의력:</b> 45~50분마다 5분 휴식(화면·문제에서 눈 떼기). 2h ≈ [50분+5분]×2.</div>
    <div class="foot"><b>블록 종료 체크:</b> ☐ 3문장 요약(보지 않고) ☐ 까다로운 개념만 시각/언어 스케치 ☐ 막힌 곳 CBMS 분류 ☐ Anki ≤5장 점검 ☐ '보충 필요' 회수 시점 정함</div>
  </details></div>`;
}

/* ── 3문장 요약(3절) ── */
function summaryCard(ds){
  const list=summariesFor(ds);
  const listHtml=list.length?list.map(x=>`
    <div class="rec">
      <div class="rec-head"><span class="swatch" style="background:${(itemById(x.sid)||{}).color||'#6ea8fe'}"></span>
        <b>${esc(x.name||'(과목 없음)')}</b>
        <button class="sm danger ghost" style="margin-left:auto" onclick="delSummaryUI('${ds}','${x.id}')" title="삭제">✕</button></div>
      <ol class="rec-3">
        <li><span class="muted tiny">현상·왜</span> ${esc(x.s1)}</li>
        <li><span class="muted tiny">도구·어떻게</span> ${esc(x.s2)}</li>
        <li><span class="muted tiny">결과·의미</span> ${esc(x.s3)}</li>
      </ol>
    </div>`).join(''):`<div class="empty tiny">오늘 작성한 요약이 없어요. 블록 끝마다 한 개씩.</div>`;
  return `<div class="card"><h2>✍ 3문장 요약 <span class="muted tiny">— 압축이 안 되면 이해한 게 아니다(파인만)</span></h2>
    <div class="fieldgrid">
      <div class="fld"><label>과목</label><select id="sum-sid">${subjectOptions('')}</select></div>
    </div>
    <label>1 — What &amp; Why <span class="muted tiny">해석하려는 핵심 현상·문제</span></label>
    <textarea id="sum-s1" rows="2" placeholder="예) 시변 환경에서 자기장과 전기장이 어떻게 퍼져 나가는지 해석하려고…"></textarea>
    <label>2 — How <span class="muted tiny">도입한 핵심 수식·가정·전개</span></label>
    <textarea id="sum-s2" rows="2" placeholder="예) 변위전류가 든 앙페르 법칙과 패러데이 법칙을 연립해 파동방정식을 세웠고…"></textarea>
    <label>3 — Result &amp; Meaning <span class="muted tiny">결과와 물리적 직관</span></label>
    <textarea id="sum-s3" rows="2" placeholder="예) 전자기파가 빛의 속도로 전파됨을 증명 — 무선통신의 근거."></textarea>
    <div style="margin-top:10px"><button class="primary" onclick="submitSummary('${ds}')">요약 저장</button>
      <button class="sm ghost" style="margin-left:8px" onclick="exportAnkiCards('today')" title="오늘 요약·오답을 Anki import용 .txt 카드 초안으로">🃏 오늘 → Anki 카드(.txt)</button>
      <button class="sm ghost" style="margin-left:6px" onclick="exportSummaryNotes('today')" title="오늘 요약을 옵시디언용 마크다운 노트(.md)로 — 카드(인출)에 이은 연결용">📓 오늘 → 노트(.md)</button></div>
    <div class="foot tiny">카드는 <b>초안</b>입니다 — Anki로 가져온 뒤 ≤5장으로 추리고 "왜?/응용"형으로 손질(큐레이션이 학습 이득). 복습 시점(due)은 FSRS가 소유.</div>
    <hr>${listHtml}
  </div>`;
}
function submitSummary(ds){
  const sid=document.getElementById('sum-sid').value;
  const s1=document.getElementById('sum-s1').value.trim();
  const s2=document.getElementById('sum-s2').value.trim();
  const s3=document.getElementById('sum-s3').value.trim();
  if(!s1&&!s2&&!s3){toast('세 문장 중 최소 하나는 적어주세요.','warn');return;}
  addSummary(ds,sid,(itemById(sid)||{}).name||'',s1,s2,s3);
  renderToday(pageEl());
  toast('요약 저장됨','ok');
}
function delSummaryUI(ds,id){delSummary(ds,id);renderToday(pageEl());toast('요약 삭제됨','info');}
function prefillSummary(sid){
  const el=document.getElementById('sum-sid'); if(el){el.value=sid; el.scrollIntoView({behavior:'smooth',block:'center'});
    const t=document.getElementById('sum-s1'); if(t)setTimeout(()=>t.focus(),300);}
}

/* ── CBMS 오답 분류(6절) ── */
function cbmsCard(ds){
  const today=cbmsBetween(ds,ds);
  const codeOpts=Object.keys(CBMS_INFO).map(c=>`<option value="${c}">${c} — ${CBMS_INFO[c].label}</option>`).join('');
  const listHtml=today.length?today.map(e=>{
    const inf=CBMS_INFO[e.code]||{label:'?',tip:''};
    return `<div class="rec">
      <div class="rec-head"><span class="cbms-chip" style="--c:${inf.color}">${e.code} ${inf.label}</span>
        ${e.conf?`<span class="cbms-chip" style="--c:#888" title="확신 없이 맞힘 — 다시 점검 대상">🎯 확신없음</span>`:''}
        <b>${esc(e.name||'')}</b>${e.chapter?`<span class="muted tiny"> · ${esc(e.chapter)}</span>`:''}
        <button class="sm danger ghost" style="margin-left:auto" onclick="delCbmsUI('${e.id}')" title="삭제">✕</button></div>
      ${e.note?`<div class="tiny">${esc(e.note)}</div>`:''}
      <div class="tiny muted">처방: ${esc(inf.tip)}</div>
    </div>`;
  }).join(''):`<div class="empty tiny">오늘 기록한 오답이 없어요. '찍어서 맞은' 문제도 오답으로(확신 없으면 기록).</div>`;
  return `<div class="card"><h2>✗ 오답 분류 CBMS <span class="muted tiny">— 틀린 이유별로 처방이 다르다</span></h2>
    <div class="fieldgrid">
      <div class="fld"><label>과목</label><select id="cb-sid">${subjectOptions('')}</select></div>
      <div class="fld"><label>챕터/문제</label><input type="text" id="cb-ch" placeholder="예) 3장 변위전류"></div>
      <div class="fld"><label>유형</label><select id="cb-code">${codeOpts}</select></div>
      <div class="fld wide"><label>메모 <span class="muted tiny">(어디서 왜 막혔나)</span></label><input type="text" id="cb-note" placeholder="예) 경계조건에서 법선성분 연속을 빠뜨림"></div>
    </div>
    <label class="tiny" style="display:inline-flex;align-items:center;gap:6px;margin-top:8px"><input type="checkbox" id="cb-conf"> 🎯 <b>찍어서 맞음/확신 없었음</b> <span class="muted">— 맞아도 다시 점검 대상(확신도 보정)</span></label>
    <div style="margin-top:10px"><button class="primary" onclick="submitCbms('${ds}')">오답 추가</button>
      <span class="muted tiny" style="margin-left:8px">C 개념 · B 경계 · M 수학 · S 실수 · T 시간부족(모의시험)</span></div>
    <hr>${listHtml}
  </div>`;
}
function submitCbms(ds){
  const sid=document.getElementById('cb-sid').value;
  const ch=document.getElementById('cb-ch').value.trim();
  const code=document.getElementById('cb-code').value;
  const note=document.getElementById('cb-note').value.trim();
  const confEl=document.getElementById('cb-conf'); const conf=!!(confEl&&confEl.checked);
  if(!sid&&!ch&&!note){toast('과목·챕터·메모 중 최소 하나는 입력하세요.','warn');return;}
  addCbms(ds,sid,(itemById(sid)||{}).name||'',ch,code,note,conf);
  renderToday(pageEl());
  toast('오답 추가됨','ok');
}
function delCbmsUI(id){delCbms(id);renderToday(pageEl());toast('오답 삭제됨','info');}
function prefillCbms(sid){
  const el=document.getElementById('cb-sid'); if(el){el.value=sid; el.scrollIntoView({behavior:'smooth',block:'center'});
    const t=document.getElementById('cb-ch'); if(t)setTimeout(()=>t.focus(),300);}
}

/* ── '보충 필요' 백로그(5절) ── */
function backlogCard(){
  const open=openBacklog();
  const closed=(state.backlog||[]).filter(b=>b.done).length;
  const listHtml=open.length?open.map(b=>`
    <div class="rec bl-open">
      <div class="rec-head">
        <input type="checkbox" aria-label="회수 완료" onchange="toggleBacklogUI('${b.id}')">
        <span class="swatch" style="background:${(itemById(b.sid)||{}).color||'#888'}"></span>
        <b>${esc(b.topic||'(주제 없음)')}</b>
        ${b.name?`<span class="muted tiny"> · ${esc(b.name)}</span>`:''}
        <span class="muted tiny" style="margin-left:6px">${esc(b.ds)}</span>
        <button class="sm danger ghost" style="margin-left:auto" onclick="delBacklogUI('${b.id}')" title="삭제">✕</button>
      </div>${b.note?`<div class="tiny">${esc(b.note)}</div>`:''}
    </div>`).join(''):`<div class="empty tiny">열린 '보충 필요' 항목이 없어요. 👍 백로그를 닫아 두는 게 메타인지.</div>`;
  return `<div class="card"><h2>🏷 보충 필요 백로그 <span class="muted tiny">— 회수되지 않는 라벨은 "공부했다는 착각"의 온상</span></h2>
    <div class="row" style="margin-bottom:6px">
      <span class="pill ${open.length?'warn':'good'}">열림 ${open.length}</span>
      <span class="pill good">회수 ${closed}</span>
      <span style="flex:1"></span>
    </div>
    <div class="fieldgrid">
      <div class="fld"><label>과목</label><select id="bl-sid">${subjectOptions('')}</select></div>
      <div class="fld wide"><label>막힌 주제</label><input type="text" id="bl-topic" placeholder="예) 3장 변위전류 유도 막힘"></div>
      <div class="fld wide"><label>메모 <span class="muted tiny">(가정·결과식·물리적 의미만)</span></label><input type="text" id="bl-note" placeholder="예) ∇×H=J+∂D/∂t 까지는 갔는데 파동방정식 유도에서 막힘"></div>
    </div>
    <div style="margin-top:10px"><button class="primary" onclick="submitBacklog()">백로그 추가</button>
      <span class="muted tiny" style="margin-left:8px">회수처: 컨디션 좋은 오전 블록 / 백지 복습 / 질문 목록</span></div>
    <hr>${listHtml}
  </div>`;
}
function submitBacklog(){
  const sid=document.getElementById('bl-sid').value;
  const topic=document.getElementById('bl-topic').value.trim();
  const note=document.getElementById('bl-note').value.trim();
  if(!topic){toast('막힌 주제를 적어주세요.','warn');return;}
  addBacklog(sid,(itemById(sid)||{}).name||'',topic,note);
  renderToday(pageEl());
  toast('백로그 추가됨','ok');
}
function toggleBacklogUI(id){toggleBacklog(id);renderToday(pageEl());}
/* 작은 기록(요약·오답·백로그)의 삭제는 모두 즉시+토스트로 통일(확인창 없음).
   구조적 삭제(과목·학기)만 모달 확인을 둔다 — 위험도에 맞춘 일관 규칙. */
function delBacklogUI(id){delBacklog(id);renderToday(pageEl());toast('백로그 삭제됨','info');}
function prefillBacklog(sid){
  const el=document.getElementById('bl-sid'); if(el){el.value=sid; el.scrollIntoView({behavior:'smooth',block:'center'});
    const t=document.getElementById('bl-topic'); if(t)setTimeout(()=>t.focus(),300);}
}

/* 탭 등록 — tabs.js 레지스트리에 자신을 올린다(추가/삭제 시 app.js 안 건드림) */
registerTab({ key:'today', label:'🎯 오늘 학습', group:'main', order:10, render:renderToday });

/* ESM-AUTO-EXPOSE */
/* ESM: 이 모듈의 공개 심볼을 전역에 노출 — 인라인 onclick·타 모듈 호출용
   (모듈 내부 헬퍼는 위에 두면 비공개. 여긴 파일의 공개 표면) */
Object.assign(globalThis, { BLOCK_STAGES, subjectOptions, renderToday, setupGuideCard, ritualCard, toggleRitual, principlesCard, todayBlocksCard, blankPass, blankBlocked, clearBlankResultUI, stageBar, flowGuideCard, summaryCard, submitSummary, delSummaryUI, prefillSummary, cbmsCard, submitCbms, delCbmsUI, prefillCbms, backlogCard, submitBacklog, toggleBacklogUI, delBacklogUI, prefillBacklog });
