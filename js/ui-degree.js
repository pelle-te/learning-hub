/* ============================================================
   ui-degree.js — 탭5: 졸업 계획 (학기별 수강 · 학점/요건 추적)
============================================================ */
const CATS=['전공필수','전공선택','교양','기타'];
let openSems=new Set();   // 펼쳐진 학기 id들 (접이식)
function toggleSem(id){if(openSems.has(id))openSems.delete(id);else openSems.add(id);renderDegree(pageEl());}
function collapseAllSems(){openSems.clear();renderDegree(pageEl());}
function expandAllSems(){state.degree.semesters.forEach(s=>openSems.add(s.id));renderDegree(pageEl());}

function renderDegree(p){
  const d=state.degree;
  let earned=0,inprog=0,planned=0;const byCat={};CATS.forEach(c=>byCat[c]=0);
  d.semesters.forEach(s=>s.courses.forEach(c=>{const cr=+c.credits||0;
    if(c.status==='완료'){earned+=cr;byCat[c.category]=(byCat[c.category]||0)+cr;}
    else if(c.status==='수강중')inprog+=cr;else planned+=cr;}));
  const remain=Math.max(0,d.targetTotal-earned);
  const pct=Math.round(earned/d.targetTotal*100);
  p.innerHTML=`
  <div class="card">
    <h2>졸업 요건</h2>
    <div class="row">
      <div><label for="deg-total">졸업 총 학점</label><input id="deg-total" type="number" value="${d.targetTotal}" onchange="setDeg('targetTotal',+this.value)"></div>
      <div><label for="deg-req">전공필수</label><input id="deg-req" type="number" value="${d.reqMajorReq}" onchange="setDeg('reqMajorReq',+this.value)"></div>
      <div><label for="deg-sel">전공선택</label><input id="deg-sel" type="number" value="${d.reqMajorSel}" onchange="setDeg('reqMajorSel',+this.value)"></div>
      <div><label for="deg-lib">교양</label><input id="deg-lib" type="number" value="${d.reqLiberal}" onchange="setDeg('reqLiberal',+this.value)"></div>
    </div>
    <div class="bar" style="margin:12px 0 4px"><i style="width:${Math.min(100,pct)}%;background:var(--good)"></i></div>
    <div class="tiny muted">이수 ${earned} / 목표 ${d.targetTotal} 학점 (${pct}%) · 수강중 ${inprog} · 예정 ${planned} · 남은 ${remain}</div>
  </div>
  <div class="kpis">
    ${CATS.map(c=>{const req=c==='전공필수'?d.reqMajorReq:c==='전공선택'?d.reqMajorSel:c==='교양'?d.reqLiberal:0;
      return `<div class="kpi"><div class="v">${byCat[c]||0}${req?`<span class="muted tiny"> / ${req}</span>`:''}</div><div class="l">${c}</div></div>`;}).join('')}
  </div>
  <div class="card">
    <div class="row" style="align-items:center"><h2 style="flex:1;margin:0">학기별 수강 <span class="muted tiny" style="font-weight:400">${d.semesters.length?`(${d.semesters.length})`:''}</span></h2>
      ${d.semesters.length>1?`<button class="sm ghost" onclick="expandAllSems()">모두 펼치기</button>
             <button class="sm ghost" onclick="collapseAllSems()">모두 접기</button>`:''}
      <button class="sm primary" onclick="addSemester()">+ 학기 추가</button></div>
  </div>
  ${d.semesters.map(s=>semCard(s)).join('')}`;
}
function semCard(s){
  const open=openSems.has(s.id);
  const cr=s.courses.reduce((t,c)=>t+(+c.credits||0),0);
  const doneCr=s.courses.filter(c=>c.status==='완료').reduce((t,c)=>t+(+c.credits||0),0);
  const inprog=s.courses.filter(c=>c.status==='수강중').length;

  const meta=`<span class="pill tiny">${cr}학점 · ${s.courses.length}과목</span>`
    +(doneCr>0?`<span class="pill tiny good">완료 ${doneCr}</span>`:'')
    +(inprog>0?`<span class="pill tiny">수강중 ${inprog}</span>`:'');
  const header=`<div class="itemhead" role="button" tabindex="0" aria-expanded="${open}"
      onclick="toggleSem('${s.id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleSem('${s.id}')}">
    <span class="chev">${open?'▾':'▸'}</span>
    <span class="itemname">${esc(s.name)||'<span class="muted">(이름 없음)</span>'}</span>
    <span class="itemmeta">${meta}</span>
  </div>`;
  if(!open) return `<div class="card itemrow">${header}</div>`;

  const body=`<div class="itembody">
    <div class="fieldgrid" style="margin-bottom:10px">
      <div class="fld wide"><label for="sem-name-${s.id}">학기 이름</label>
        <input id="sem-name-${s.id}" type="text" value="${esc(s.name)}" onchange="updSem('${s.id}','name',this.value)" style="font-weight:600" placeholder="예: 2026-1학기"></div>
    </div>
    <div class="chaptbl"><table><thead><tr><th style="width:34%">과목</th><th>학점</th><th>구분</th><th>상태</th><th>성적</th><th></th></tr></thead><tbody>
    ${s.courses.map(c=>`<tr>
      <td><input type="text" value="${esc(c.name)}" oninput="updCourse('${s.id}','${c.id}','name',this.value)" aria-label="과목 이름"></td>
      <td><input type="number" min="0" value="${c.credits}" oninput="updCourse('${s.id}','${c.id}','credits',+this.value)" style="width:60px" aria-label="학점"></td>
      <td><select onchange="updCourse('${s.id}','${c.id}','category',this.value)" aria-label="구분">${CATS.map(x=>`<option ${c.category===x?'selected':''}>${x}</option>`).join('')}</select></td>
      <td><select onchange="updCourse('${s.id}','${c.id}','status',this.value)" aria-label="상태">${['예정','수강중','완료'].map(x=>`<option ${c.status===x?'selected':''}>${x}</option>`).join('')}</select></td>
      <td><input type="text" value="${esc(c.grade||'')}" placeholder="A+" oninput="updCourse('${s.id}','${c.id}','grade',this.value)" style="width:60px" aria-label="성적"></td>
      <td style="white-space:nowrap">${c.status==='수강중'?`<button class="sm ghost" title="학습 항목으로" onclick="courseToItem('${jsq(c.name)}')">📥</button>`:''}<button class="sm danger ghost" onclick="delCourse('${s.id}','${c.id}')" aria-label="과목 삭제">✕</button></td>
    </tr>`).join('')||`<tr><td colspan="6" class="empty tiny" style="padding:12px">과목이 없어요. 아래에서 추가하세요.</td></tr>`}</tbody></table></div>
    <div class="row" style="margin-top:8px"><button class="sm primary" onclick="addCourse('${s.id}')">+ 과목 추가</button></div>
    <div class="itemfoot">
      <span class="tiny muted">${cr}학점 · ${s.courses.length}과목${doneCr>0?` · 완료 ${doneCr}학점`:''}</span>
      <button class="sm danger ghost" onclick="delSem('${s.id}')">학기 삭제</button>
    </div>
  </div>`;
  return `<div class="card itemrow open">${header}${body}</div>`;
}
function setDeg(k,v){state.degree[k]=v;persist();renderDegree(pageEl());}
function addSemester(){const id=rid();state.degree.semesters.push({id,name:'새 학기',courses:[]});openSems.add(id);persist();renderDegree(pageEl());}
async function delSem(id){if(!await confirmModal('이 학기를 삭제할까요? (소속 과목도 함께 삭제됩니다)',{title:'학기 삭제',okLabel:'삭제',danger:true}))return;state.degree.semesters=state.degree.semesters.filter(s=>s.id!==id);openSems.delete(id);persist();renderDegree(pageEl());toast('학기 삭제됨','info');}
function updSem(id,k,v){const s=state.degree.semesters.find(x=>x.id===id);if(s){s[k]=v;persist();renderDegree(pageEl());}}
function addCourse(sid){const s=state.degree.semesters.find(x=>x.id===sid);if(!s)return;s.courses.push({id:rid(),name:'새 과목',credits:3,category:'전공선택',status:'예정',grade:''});persist();renderDegree(pageEl());}
function delCourse(sid,cid){const s=state.degree.semesters.find(x=>x.id===sid);if(!s)return;s.courses=s.courses.filter(c=>c.id!==cid);persist();renderDegree(pageEl());}
function updCourse(sid,cid,k,v){const s=state.degree.semesters.find(x=>x.id===sid);if(!s)return;const c=s.courses.find(x=>x.id===cid);if(c){c[k]=v;persist();if(k==='credits'||k==='status'||k==='category')renderDegree(pageEl());}}
function courseToItem(name){if(state.items.some(s=>s.name===name)){toast('이미 학습 항목에 있어요.','warn');return;}addItem(name,{source:'수강',mode:'weekly',weeklyHours:3,chapters:[]});toast(`"${name}" 학습 항목에 추가됨 — 학습 항목 탭에서 주당 시간·챕터를 설정하세요.`,'ok',4200);}

/* degree는 학사(졸업) 영역 — group을 달리해 네비에서 구분선 뒤로(원래 IA 유지) */
registerTab({ key:'degree', label:'🎓 졸업 계획', group:'degree', order:90, render:renderDegree });
