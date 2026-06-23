/* ============================================================
   ui-items.js — 탭: 학습 항목 (주당 시간 · 챕터 편집)
   ── 접이식 목록(아코디언): 과목을 한 줄로 접어두고, 누르면 그 과목만 펼쳐 편집.
      과목이 많아도 페이지가 짧게 유지된다.
============================================================ */
let openItems=new Set();   // 현재 펼쳐진 과목 id들 (세션 동안만)
function toggleItem(id){if(openItems.has(id))openItems.delete(id);else openItems.add(id);renderItemCards();}
function collapseAllItems(){openItems.clear();renderItemCards();}
function expandAllItems(){state.items.forEach(s=>openItems.add(s.id));renderItemCards();}

function renderItems(p){
  persist();
  const n=state.items.length;
  p.innerHTML=`
  <div class="card">
    <div class="row" style="align-items:center">
      <h2 style="flex:1;margin:0">학습 항목 <span class="muted tiny" style="font-weight:400">${n?`(${n})`:''}</span></h2>
      ${n>1?`<button class="sm ghost" onclick="expandAllItems()" title="모두 펼치기">모두 펼치기</button>
             <button class="sm ghost" onclick="collapseAllItems()" title="모두 접기">모두 접기</button>`:''}
      <button class="sm primary" onclick="addItemUI()">+ 과목 추가</button>
    </div>
    <div class="foot">과목 줄을 누르면 펼쳐서 편집할 수 있어요. <b>주당 목표 시간</b>과 <b>챕터(순서·예상시간)</b>를 넣으면 그날 배운 챕터·복습이 자동으로 잡힙니다. 챕터는 볼트 현황 탭에서 가져올 수도 있어요.</div>
  </div>
  <div id="itemCards"></div>`;
  renderItemCards();
}
function renderItemCards(){
  const a=document.getElementById('itemCards');
  if(!state.items.length){a.innerHTML=`<div class="card"><div class="empty">학습 항목이 없습니다. + 과목 추가 또는 볼트/Anki 탭에서 넣으세요.</div></div>`;return;}
  a.innerHTML=state.items.map(s=>itemCard(s)).join('');
}
function itemCard(s){
  const open=openItems.has(s.id);
  const daily=s.mode==='daily';
  const chs=s.chapters||[];
  const totalH=chs.reduce((t,c)=>t+(+c.hours||0),0);
  const doneCh=chs.filter(c=>c.done).length;
  const prog=chs.length?Math.round(doneCh/chs.length*100):0;

  /* ── 접힌 상태에서도 한눈에 보이는 요약 칩 ── */
  const modeChip=daily?`<span class="pill tiny">매일 ${s.dailyMin||30}분</span>`
                      :`<span class="pill tiny">주 ${s.weeklyHours||0}h</span>`;
  const chChip=daily?'':`<span class="muted tiny">${chs.length}챕터·~${totalH}h</span>`;
  let ddChip='';
  if(s.deadline){const dd=dayDiff(iso(new Date()),s.deadline);
    const lab=dd===0?'D-DAY':dd>0?'D-'+dd:'D+'+(-dd);const cls=dd<0?'bad':dd<=7?'warn':'';
    ddChip=`<span class="pill tiny ${cls}">${lab}</span>`;}
  const progBar=(!daily&&chs.length)?`<span class="minibar" title="완료 챕터 ${doneCh}/${chs.length}"><i style="width:${prog}%;background:${s.color}"></i></span>`:'';

  const header=`<div class="itemhead" role="button" tabindex="0" aria-expanded="${open}"
      onclick="toggleItem('${s.id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleItem('${s.id}')}">
    <span class="chev">${open?'▾':'▸'}</span>
    <span class="swatch" style="background:${s.color};width:13px;height:13px"></span>
    <span class="itemname">${esc(s.name)||'<span class="muted">(이름 없음)</span>'}</span>
    <span class="itemmeta">${modeChip}${chChip}${progBar}${ddChip}</span>
  </div>`;

  if(!open) return `<div class="card itemrow">${header}</div>`;

  /* ── 펼친 상태: 정돈된 라벨 그리드 + 챕터 + 하단 푸터 ── */
  const body=`<div class="itembody">
    <div class="fieldgrid">
      <div class="fld wide"><label>과목 이름</label>
        <input type="text" value="${esc(s.name)}" oninput="updItem('${s.id}','name',this.value)" style="font-weight:600" aria-label="과목 이름" placeholder="과목 이름"></div>
      <div class="fld"><label>유형</label>
        <select onchange="updItem('${s.id}','mode',this.value)" aria-label="유형">
          <option value="weekly"${!daily?' selected':''}>주당 시간</option>
          <option value="daily"${daily?' selected':''}>매일(Anki)</option>
        </select></div>
      <div class="fld"><label>${daily?'매일 학습 (분)':'주당 목표 시간'}</label>
        ${daily?stepper(s.id,'dailyMin',s.dailyMin||30,5,'분'):stepper(s.id,'weeklyHours',s.weeklyHours||3,0.5,'h')}</div>
      <div class="fld"><label>마감일 (선택)</label>
        <input type="date" value="${s.deadline||''}" onchange="updItem('${s.id}','deadline',this.value)"></div>
    </div>
    ${daily?'':chapterEditor(s)}
    <div class="itemfoot">
      <span class="tiny muted">출처 ${esc(s.source||'직접')}${!daily&&chs.length?` · ${chs.length}챕터 · 약 ${totalH}h`:''}</span>
      <button class="sm danger ghost" onclick="delItem('${s.id}')">과목 삭제</button>
    </div>
  </div>`;
  return `<div class="card itemrow open">${header}${body}</div>`;
}
/* +/- 스텝퍼 (분/시간 직관 입력) */
function stepper(id,key,val,step,unit){
  return `<div class="row" style="gap:4px;align-items:center;max-width:170px">
    <button class="sm" onclick="bump('${id}','${key}',${-step})">–</button>
    <input type="number" step="${step}" min="0" value="${val}" oninput="updItem('${id}','${key}',+this.value)" style="text-align:center">
    <button class="sm" onclick="bump('${id}','${key}',${step})">+</button>
    <span class="muted tiny">${unit}</span></div>`;
}
function bump(id,key,delta){const s=state.items.find(x=>x.id===id);if(!s)return;
  s[key]=Math.max(0,Math.round(((+s[key]||0)+delta)*10)/10);persist();renderItemCards();}
function chapterEditor(s){
  const chs=s.chapters||[];
  const totalH=chs.reduce((t,c)=>t+(+c.hours||0),0);
  const rows=chs.length?`<div class="chaptbl"><table>
    <thead><tr><th style="width:48px">#</th><th>챕터</th><th style="width:96px">시간(h)</th><th style="width:52px">완료</th><th style="width:36px"></th></tr></thead>
    <tbody>
    ${chs.map((c,i)=>`<tr draggable="true"
        ondragstart="chDragStart('${s.id}',${i})" ondragover="event.preventDefault()" ondrop="chDrop('${s.id}',${i})">
      <td class="muted tiny" style="white-space:nowrap"><span class="draghandle" title="드래그로 순서 변경">⠿</span> ${i+1}</td>
      <td><input type="text" value="${esc(c.name)}" oninput="updCh('${s.id}',${i},'name',this.value)" aria-label="챕터 이름"></td>
      <td><input type="number" step="0.5" min="0.5" value="${c.hours}" oninput="updCh('${s.id}',${i},'hours',+this.value)" aria-label="예상시간(시간)"></td>
      <td style="text-align:center"><input type="checkbox" ${c.done?'checked':''} onchange="updCh('${s.id}',${i},'done',this.checked)" aria-label="완료"></td>
      <td style="text-align:center"><button class="sm danger ghost" onclick="delCh('${s.id}',${i})" aria-label="삭제" title="삭제">✕</button></td>
    </tr>`).join('')}
    </tbody></table></div>`
    :`<div class="empty tiny" style="padding:14px 6px">아직 챕터가 없어요. 아래에서 추가하거나 붙여넣기 하세요.</div>`;
  return `<details ${chs.length?'':'open'} class="chapwrap">
    <summary>📖 챕터 ${chs.length?`<span class="muted" style="font-weight:400">${chs.length}개 · 약 ${totalH}h</span>`:'<span class="muted" style="font-weight:400">추가</span>'}</summary>
    <div class="chapbody">
      ${rows}
      <div class="row" style="margin-top:8px;gap:6px">
        <button class="sm primary" onclick="addCh('${s.id}')">+ 챕터 추가</button>
        <span style="flex:1"></span>
        <span class="tiny muted">↕ 드래그로 순서 변경</span>
      </div>
      <details class="bulkwrap" style="margin-top:10px">
        <summary class="tiny">⊕ 여러 챕터 한 번에 붙여넣기</summary>
        <label style="margin-top:6px">한 줄에 하나씩 · "이름 | 시간" 형식도 가능</label>
        <textarea id="bulk-${s.id}" rows="3" placeholder="2장 미분방정식 | 3&#10;3장 라플라스 변환 | 2"></textarea>
        <button class="sm" style="margin-top:6px" onclick="bulkCh('${s.id}')">붙여넣기 적용</button>
      </details>
    </div>
  </details>`;
}

/* CRUD */
function addItemUI(){
  const id=rid();
  state.items.push({id,source:'직접',name:'새 과목',color:PALETTE[state.items.length%PALETTE.length],
    mode:'weekly',weeklyHours:3,dailyMin:30,deadline:'',chapters:[]});
  openItems.add(id);                 // 새 과목은 바로 펼쳐서 편집
  persist();renderItems(pageEl());   // 상단 개수도 갱신
}
function addItem(name,opt={}){   // 다른 탭(볼트/Anki/졸업)에서 호출
  state.items.push({id:rid(),source:opt.source||'직접',name,color:PALETTE[state.items.length%PALETTE.length],
    mode:opt.mode||'weekly',weeklyHours:opt.weeklyHours||3,dailyMin:opt.dailyMin||30,
    deadline:opt.deadline||'',chapters:opt.chapters||[]});
  persist();
}
function delItem(id){if(!confirm('이 과목을 삭제할까요?'))return;state.items=state.items.filter(s=>s.id!==id);openItems.delete(id);persist();renderItems(pageEl());}
function updItem(id,k,v){const s=state.items.find(x=>x.id===id);if(!s)return;s[k]=v;persist();
  if(k==='mode')renderItemCards();}
function addCh(id){const s=state.items.find(x=>x.id===id);if(!s)return;(s.chapters=s.chapters||[]).push({id:rid(),name:'새 챕터',hours:2,done:false});persist();renderItemCards();}
function delCh(id,i){const s=state.items.find(x=>x.id===id);if(!s)return;s.chapters.splice(i,1);persist();renderItemCards();}
function updCh(id,i,k,v){const s=state.items.find(x=>x.id===id);if(!s)return;s.chapters[i][k]=v;persist();}
function moveCh(id,i,dir){const s=state.items.find(x=>x.id===id);if(!s)return;const j=i+dir;if(j<0||j>=s.chapters.length)return;
  [s.chapters[i],s.chapters[j]]=[s.chapters[j],s.chapters[i]];persist();renderItemCards();}
/* 드래그 앤 드롭 정렬 */
let _chDrag=null;
function chDragStart(id,i){_chDrag={id,i};}
function chDrop(id,i){
  if(!_chDrag||_chDrag.id!==id){_chDrag=null;return;}
  const s=state.items.find(x=>x.id===id); const from=_chDrag.i; _chDrag=null;
  if(!s||from===i)return;
  const[m]=s.chapters.splice(from,1); s.chapters.splice(i,0,m);
  persist();renderItemCards();
}
function bulkCh(id){const s=state.items.find(x=>x.id===id);if(!s)return;
  const t=document.getElementById('bulk-'+id).value.split('\n').map(l=>l.trim()).filter(Boolean);
  if(!t.length)return; s.chapters=s.chapters||[];
  t.forEach(line=>{const[nm,h]=line.split('|').map(x=>x.trim());s.chapters.push({id:rid(),name:nm,hours:h?+h:2,done:false});});
  persist();renderItemCards();
}
