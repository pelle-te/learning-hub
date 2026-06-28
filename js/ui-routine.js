/* ============================================================
   ui-routine.js — 탭2: 일과 & 가용시간 (시간블록 → 빈 시간)
============================================================ */
let classDow=1;   // 수업 편집기에서 보고 있는 요일 (일=0 .. 토=6)
function renderRoutine(p){
  const cap=studyMinByWeekday();
  p.innerHTML=`
  <div class="card">
    <h2>기본 설정</h2>
    <div class="row">
      <div><label for="set-start">시작일</label><input id="set-start" type="date" value="${state.startDate}" onchange="setSetting('startDate',this.value)"></div>
      <div><label for="set-modlen">모듈 길이 (시간)</label><input id="set-modlen" type="number" step="0.5" min="0.5" value="${(state.moduleLen/60)}" onchange="setSetting('moduleLen',Math.round(+this.value*60))"></div>
      <div><label for="set-revratio">복습 시간 비중 (%)</label><input id="set-revratio" type="number" step="5" min="0" max="60" value="${state.reviewRatio}" onchange="setSetting('reviewRatio',+this.value)"></div>
    </div>
    <div class="foot">모듈 = 한 번에 집중하는 공부 슬롯(기본 2시간). 하루 공부 가능 시간이 이 단위로 과목에 배분됩니다.</div>
    <hr>
    <div class="row">
      <div class="fld"><label for="set-blank" style="display:inline">백지 복습 자동 배치 <span class="muted tiny">(방법론 9절 — 주 1회 단원 재구성)</span></label>
        <div style="margin-top:6px"><label class="chk-row" style="margin:0"><input type="checkbox" id="set-blank" ${state.blankReviewWeekly?'checked':''} onchange="setSetting('blankReviewWeekly',this.checked)"> <span>그 주 배운 과목마다 주말에 백지 복습 한 칸</span></label></div></div>
      <div><label for="set-mock">모의시험 주기 (주) <span class="muted tiny">0=끔 (방법론 12절)</span></label><input id="set-mock" type="number" step="1" min="0" max="12" value="${state.mockEveryWeeks||0}" onchange="setSetting('mockEveryWeeks',Math.max(0,Math.round(+this.value)))"></div>
    </div>
    <div class="foot">백지 복습·모의시험은 여유 있는 날에만 배치되며 가용시간을 넘기지 않아요. <b>오늘 학습</b> 탭에서 절차 가이드를 봅니다.</div>
    <hr>
    <div class="row">
      <div class="fld"><label style="display:inline">적응형 용량 <span class="muted tiny">(방법론 1·10절 — "계획은 가설")</span></label>
        <div style="margin-top:6px"><label class="chk-row" style="margin:0"><input type="checkbox" ${state.adaptiveCapacity!==false?'checked':''} onchange="setSetting('adaptiveCapacity',this.checked)"> <span>최근 14일 완료율로 다음 계획 용량을 자동 보정(꾸준히 70%만 끝내면 계획도 70%로)</span></label></div></div>
      <div class="fld"><label style="display:inline">복습은 Anki에 위임 <span class="muted tiny">(시간 이중계상 방지)</span></label>
        <div style="margin-top:6px"><label class="chk-row" style="margin:0"><input type="checkbox" ${state.reviewViaAnki?'checked':''} onchange="setSetting('reviewViaAnki',this.checked)"> <span>매일 Anki 항목이 있으면 합성 간격복습(1·3·7·16) 슬롯을 만들지 않음 — due는 FSRS가 소유</span></label></div></div>
    </div>
    <div class="row">
      <div><label for="set-peak0">각성도 최고 시간대 시작 <span class="muted tiny">(방법론 1절 — 어려운 새 학습을 맑을 때)</span></label><input id="set-peak0" type="time" value="${esc(state.peakStart||'')}" onchange="setSetting('peakStart',this.value)"></div>
      <div><label for="set-peak1">끝</label><input id="set-peak1" type="time" value="${esc(state.peakEnd||'')}" onchange="setSetting('peakEnd',this.value)"></div>
      <div style="flex:1"></div>
    </div>
    <div class="foot">피크 시간대를 정하면 <b>새 학습(new)·모의시험</b>을 그 구간에 우선 배치하고, 복습·Anki는 나머지 시간에. 비워두면 끔(이른 시각부터 순서대로).</div>
  </div>
  ${maintenanceCard()}
  <div class="card">
    <h2>요일별 공부 가능 시간 <span class="muted tiny">— 깨어있는 시간에서 고정 블록(수면·식사·취미·수업)을 뺀 빈 시간 · 특정 날짜는 스케줄 탭에서 조정</span></h2>
    <div class="wkbars">${DOW.map((d,i)=>`<div class="wb"><div class="h">${(cap[i]/60).toFixed(1)}<span class="tiny">h</span></div><div class="d">${d}</div></div>`).join('')}</div>
  </div>
  <div class="card">
    <h2>수업 (요일별) <span class="muted tiny">— 요일을 고르고 그 날 수업의 시작~끝을 직접 추가</span></h2>
    <div class="seg" id="classSeg">${DOW.map((d,i)=>`<button class="${i===classDow?'on':''}" onclick="setClassDow(${i})">${d}</button>`).join('')}</div>
    <div id="classList" style="margin-top:10px"></div>
    <button class="sm" style="margin-top:8px" onclick="addClass(classDow)">+ 수업 추가</button>
    <div class="foot">요일마다 수업 시간이 달라도 각각 지정할 수 있어요. 수업 시간은 공부 가능 시간에서 자동으로 빠집니다.</div>
  </div>
  <div class="card">
    <h2>그 밖의 일과 블록 <span class="muted tiny">— 수면·식사·취미 등. 비운 시간은 자동으로 공부 가능 시간이 됩니다</span></h2>
    <div class="blkrow" style="color:var(--mut);font-size:11px"><div>이름</div><div>유형</div><div>시작</div><div>끝</div><div class="days">요일</div><div></div></div>
    <div id="blkList"></div>
    <button class="sm" style="margin-top:8px" onclick="addBlock()">+ 블록 추가</button>
    <div class="foot">수면 블록으로 깨어있는 시간을 정하면 빈 시간이 정확해져요. 블록을 지워도 그 시간은 그냥 빈 시간(공부 가능)이 될 뿐, 학습 항목은 사라지지 않습니다.</div>
  </div>`;
  renderBlocks(); renderClassList();
}

/* ── 데이터 백업·정리(데이터 손실/비대 대비) ── */
function maintenanceCard(){
  const days=lastBackupDays();
  const stale=days==null||days>=7;
  const sizeKB=dataSizeKB(), recs=recordCount();
  const backupLine=days==null?'볼트 백업 기록 없음'
    :(days===0?'볼트 백업: 오늘':'볼트 백업: '+days+'일 전');
  return `<div class="card">
    <h2>🛟 데이터 백업·정리 <span class="muted tiny">— localStorage 한 곳에만 있으면 캐시 삭제 시 전소</span></h2>
    <div class="row" style="margin-bottom:6px">
      <span class="pill ${stale?'warn':'good'}">${esc(backupLine)}</span>
      <span class="pill">저장 크기 ${sizeKB}KB · 기록 ${recs}건</span>
    </div>
    <div class="row">
      <button class="sm" onclick="backupToVault()">📁 볼트 폴더에 백업</button>
      <button class="sm ghost" onclick="exportJSON()">💾 파일로 내보내기</button>
      <button class="sm danger ghost" onclick="archiveOldConfirm()">🗄 오래된 기록 정리(6개월 이전)</button>
    </div>
    ${stale?`<div class="warnbox" style="margin-top:8px">백업이 ${days==null?'아직 없어요':days+'일 지났어요'}. 브라우저 캐시를 지우면 데이터가 사라질 수 있으니 백업하세요.</div>`:''}
    <div class="foot">볼트 백업은 볼트 폴더에 <code>러닝허브_백업.json</code>을 씁니다(Chrome/Edge). 정리는 6개월 이전 기록을 보관 파일로 내려받고 앱에서 비워 쿼터·성능을 지킵니다.</div>
  </div>`;
}
async function archiveOldConfirm(){
  if(await confirmModal('6개월 이전의 완료기록·요약·오답·회수된 백로그를 보관 파일(.json)로 내려받고 앱에서 비울까요? (통계가 가벼워지고 저장공간을 회수합니다. 보관 파일은 따로 두면 나중에 열람 가능)',{title:'오래된 기록 정리',okLabel:'정리'})){
    archiveOldData(6);
  }
}

/* ── 수업: 요일별 개별 시간(시작~끝) 편집 ─────────────────
   내부적으로는 routine 블록(type:'수업', days:[해당요일])으로 저장 →
   스케줄러/타임라인이 그대로 '깨어있는 시간 − 블록'에서 빼준다. */
function renderClassList(){
  const a=document.getElementById('classList'); if(!a)return;
  const cls=state.routine.filter(b=>b.type==='수업'&&b.days.includes(classDow)).sort((x,y)=>toMin(x.start)-toMin(y.start));
  a.innerHTML=cls.length?cls.map(b=>`
    <div class="classrow">
      <input type="text" value="${esc(b.name)}" aria-label="수업 이름" placeholder="수업 이름" oninput="updClassSilent('${b.id}','name',this.value)" onchange="renderRoutine(pageEl())">
      <select onchange="updClass('${b.id}','start',this.value)" aria-label="시작 시각">${timeOpts(b.start)}</select>
      <span class="csep">~</span>
      <select onchange="updClass('${b.id}','end',this.value)" aria-label="끝 시각">${timeOpts(b.end)}</select>
      <button class="sm danger ghost" onclick="delClass('${b.id}')" aria-label="삭제" title="삭제">✕</button>
    </div>`).join('')
    :`<div class="empty tiny" style="padding:14px 6px">${DOW[classDow]}요일 수업이 없어요. 아래 <b>+ 수업 추가</b>로 넣으세요.</div>`;
}
function setClassDow(i){classDow=i;
  document.querySelectorAll('#classSeg button').forEach((b,k)=>b.classList.toggle('on',k===i));
  renderClassList();
}
function addClass(dow){
  state.routine.push({id:rid(),name:'수업',type:'수업',start:'09:00',end:'10:00',days:[dow]});
  persist(); renderRoutine(pageEl());
}
function updClass(id,k,v){const b=state.routine.find(x=>x.id===id);if(!b)return;b[k]=v;persist();renderRoutine(pageEl());}
function updClassSilent(id,k,v){const b=state.routine.find(x=>x.id===id);if(!b)return;b[k]=v;persist();}
function delClass(id){state.routine=state.routine.filter(b=>b.id!==id);persist();renderRoutine(pageEl());}
function setSetting(k,v){state[k]=v;persist();renderRoutine(pageEl());}
/* 15분 단위 시간 드롭다운 옵션 (00:00 ~ 24:00) */
function timeOpts(sel){let o='';for(let m=0;m<=1440;m+=15){const v=toHM(m);o+=`<option value="${v}"${v===sel?' selected':''}>${v}</option>`;}return o;}
function renderBlocks(){
  const a=document.getElementById('blkList');
  a.innerHTML=state.routine.filter(b=>b.type!=='수업').slice().sort((x,y)=>toMin(x.start)-toMin(y.start)).map(b=>`
    <div class="blkrow">
      <input type="text" value="${esc(b.name)}" aria-label="블록 이름" oninput="updBlockSilent('${b.id}','name',this.value)" onchange="renderRoutine(pageEl())">
      <select aria-label="블록 유형" onchange="updBlock('${b.id}','type',this.value)">${Object.keys(BLOCK_TYPES).filter(t=>t!=='수업').map(t=>`<option ${b.type===t?'selected':''}>${t}</option>`).join('')}</select>
      <select aria-label="시작 시각" onchange="updBlock('${b.id}','start',this.value)">${timeOpts(b.start)}</select>
      <select aria-label="끝 시각" onchange="updBlock('${b.id}','end',this.value)">${timeOpts(b.end)}</select>
      <div class="days">
        ${DOW.map((d,i)=>`<button type="button" class="daychip ${b.days.includes(i)?'on':''}" onclick="toggleDay('${b.id}',${i})">${d}</button>`).join('')}
        <span class="daysep"></span>
        <button type="button" class="daychip preset" onclick="setDays('${b.id}','wd')">평일</button>
        <button type="button" class="daychip preset" onclick="setDays('${b.id}','we')">주말</button>
        <button type="button" class="daychip preset" onclick="setDays('${b.id}','all')">매일</button>
      </div>
      <button class="sm danger ghost" onclick="delBlock('${b.id}')">✕</button>
    </div>`).join('');
}
function addBlock(){state.routine.push({id:rid(),name:'새 블록',type:'기타',start:'15:00',end:'16:00',days:[1,2,3,4,5]});persist();renderRoutine(pageEl());}
function delBlock(id){state.routine=state.routine.filter(b=>b.id!==id);persist();renderRoutine(pageEl());}
function updBlock(id,k,v){const b=state.routine.find(x=>x.id===id);if(!b)return;b[k]=v;persist();renderRoutine(pageEl());}
/* 텍스트 입력 중에는 전체 재렌더하지 않음(포커스 유지). 값만 저장하고 blur 때 동기화 */
function updBlockSilent(id,k,v){const b=state.routine.find(x=>x.id===id);if(!b)return;b[k]=v;persist();}
function toggleDay(id,d){const b=state.routine.find(x=>x.id===id);if(!b)return;
  b.days=b.days.includes(d)?b.days.filter(x=>x!==d):[...b.days,d].sort((a,c)=>a-c);persist();renderRoutine(pageEl());}
function setDays(id,mode){const b=state.routine.find(x=>x.id===id);if(!b)return;
  b.days=mode==='wd'?[1,2,3,4,5]:mode==='we'?[0,6]:[0,1,2,3,4,5,6];persist();renderRoutine(pageEl());}
/* 요일별 하루 미리보기는 제거됨 (요청) */

registerTab({ key:'routine', label:'⏰ 일과 & 가용시간', group:'main', order:40, render:renderRoutine });
