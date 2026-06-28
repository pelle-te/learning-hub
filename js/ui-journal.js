/* ============================================================
   ui-journal.js — 탭: 📒 학습 기록 (학습 후 산출물 기록)
   ── 왜 이 파일이 있나 ──────────────────────────────────────
   예전엔 '오늘 학습'(ui-today) 한 탭에 *실행*(오늘 뭘·어떻게)과
   *산출물*(공부 뒤 남기는 3문장요약·오답분류·보충필요)이 섞여 있었다.
   경계가 흐려 '오늘 학습'이 길어지므로, 기록 영역을 이 탭으로 분리했다.
   - 오늘 날짜 기준으로 그 날의 요약·오답·백로그를 적고 본다(누적 분석은 통계·주간리뷰).
   - 오늘 학습 블록의 [✍요약/✗오답/🏷보충] 버튼은 이 탭으로 이동해 과목을 미리 채운다.
   의존: data-methodology(요약·CBMS·백로그 데이터) · utils(itemById·iso·esc)
============================================================ */

/* 과목 선택 <option> 목록 (selSid 선택 유지) — 요약/오답/백로그 폼 공용 */
function subjectOptions(selSid){
  const opts=['<option value="">(과목 선택)</option>'];
  (state.items||[]).filter(i=>i.name).forEach(i=>{
    opts.push(`<option value="${i.id}"${i.id===selSid?' selected':''}>${esc(i.name)}</option>`);
  });
  return opts.join('');
}

function renderJournal(p){
  const ds=iso(new Date());
  p.innerHTML=`
  <div class="card">
    <h2>학습 기록 <span class="muted tiny">— 공부 뒤 남기는 산출물(오늘 ${fmt(new Date(ds+'T00:00:00'))})</span></h2>
    <div class="tiny muted">블록을 끝낼 때마다 한 개씩. 누적 추세·약점 분포는 <b>통계</b>·<b>주간 리뷰</b>에서 봅니다.</div>
  </div>
  ${summaryCard(ds)}
  ${cbmsCard(ds)}
  ${backlogCard()}`;
}

/* ── 3문장 요약(방법론 3절) ── */
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
  return `<div class="card"><h2>3문장 요약 <span class="muted tiny">— 압축이 안 되면 이해한 게 아니다(파인만)</span></h2>
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
  renderJournal(pageEl());
  toast('요약 저장됨','ok');
}
function delSummaryUI(ds,id){delSummary(ds,id);renderJournal(pageEl());toast('요약 삭제됨','info');}
function prefillSummary(sid){
  go('journal');
  const el=document.getElementById('sum-sid'); if(el){el.value=sid; el.scrollIntoView({behavior:'smooth',block:'center'});
    const t=document.getElementById('sum-s1'); if(t)setTimeout(()=>t.focus(),300);}
}

/* ── CBMS 오답 분류(방법론 6절) ── */
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
  return `<div class="card"><h2>오답 분류 CBMS <span class="muted tiny">— 틀린 이유별로 처방이 다르다</span></h2>
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
  renderJournal(pageEl());
  toast('오답 추가됨','ok');
}
function delCbmsUI(id){delCbms(id);renderJournal(pageEl());toast('오답 삭제됨','info');}
function prefillCbms(sid){
  go('journal');
  const el=document.getElementById('cb-sid'); if(el){el.value=sid; el.scrollIntoView({behavior:'smooth',block:'center'});
    const t=document.getElementById('cb-ch'); if(t)setTimeout(()=>t.focus(),300);}
}

/* ── '보충 필요' 백로그(방법론 5절) ── */
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
  return `<div class="card"><h2>보충 필요 백로그 <span class="muted tiny">— 회수되지 않는 라벨은 "공부했다는 착각"의 온상</span></h2>
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
  renderJournal(pageEl());
  toast('백로그 추가됨','ok');
}
function toggleBacklogUI(id){toggleBacklog(id);renderJournal(pageEl());}
/* 작은 기록(요약·오답·백로그)의 삭제는 모두 즉시+토스트로 통일(확인창 없음). */
function delBacklogUI(id){delBacklog(id);renderJournal(pageEl());toast('백로그 삭제됨','info');}
function prefillBacklog(sid){
  go('journal');
  const el=document.getElementById('bl-sid'); if(el){el.value=sid; el.scrollIntoView({behavior:'smooth',block:'center'});
    const t=document.getElementById('bl-topic'); if(t)setTimeout(()=>t.focus(),300);}
}

/* 기록·분석 그룹(log)에 등록 */
registerTab({ key:'journal', label:'학습 기록', group:'log', order:60, render:renderJournal });

/* ESM-AUTO-EXPOSE */
Object.assign(globalThis, {
  subjectOptions, renderJournal,
  summaryCard, submitSummary, delSummaryUI, prefillSummary,
  cbmsCard, submitCbms, delCbmsUI, prefillCbms,
  backlogCard, submitBacklog, toggleBacklogUI, delBacklogUI, prefillBacklog,
});
