/* ============================================================
   ui-degree-req.js — 탭: 졸업요건 정리 (읽기 전용 참조)
   ── 왜 이 파일이 있나 ──────────────────────────────────────
   졸업요건_정리.md(전자공학과 2020 요람·ABEEK 인증과정)를 손으로 다시
   보지 않아도 되게, 홈페이지 안에서 한눈에 보는 *정적 참조 화면*으로 옮겼다.
   상태(state)를 건드리지 않는 순수 렌더 — 데이터는 이 파일 상단 상수에 둔다.
   인터랙티브 '졸업 계획'(ui-degree.js)과 짝을 이뤄 같은 졸업 그룹에 등록.
   출처: 졸업요건_정리.md. 수치가 바뀌면 이 상수만 고치면 된다.
============================================================ */

/* 졸업요건 총괄 — [항목, 요건, 내 현황, 상태] (상태: ok/warn/bad/'') */
const DR_OVERVIEW = [
  ['총 졸업학점', '128학점', '94학점 (34학점 남음)', 'warn'],
  ['평점', '2.0 이상', '2.71', 'ok'],
  ['영어 공인성적', 'TOEIC 730 / TEPS 329 / iBT 72 / OPIc IL 등', '제출 필요', 'warn'],
  ['설계학점', '9학점 이상', '약 4.5학점 (보충 필요)', 'warn'],
  ['대학필수', '2학점 (아주희망1+아주인성1)', '2학점', 'ok'],
  ['전문교양', '18학점 (영어6·글쓰기3·영역별9)', '15~18 (영역별 보충 가능)', 'warn'],
  ['학과필수(기초)', '31학점 (수학12·과학15·전산4)', '31학점', 'ok'],
  ['전공', '68학점 (인증필수41+인증선택27)', '42학점 (26학점 남음)', 'warn'],
  ['자유선택', '9학점', '심리학개론 3 사용 → 6학점 자유', ''],
];

/* 핵심 숫자(KPI) */
const DR_KPI = [
  ['34', '남은 졸업학점', 'warn'],
  ['26', '남은 전공학점', 'warn'],
  ['8', '비전공(교양·자유)', ''],
  ['1', '재수강 필수(F)', 'bad'],
];

/* 전공 인증필수 41 — [과목, 학점, 개설학기, 성적/표시, 완료여부('done'|'redo'|'todo')] */
const DR_REQUIRED = [
  ['어드벤처디자인', 3, '2학기', 'B+', 'done'],
  ['회로이론', 3, '양학기', 'B0', 'done'],
  ['전자기학', 3, '양학기', 'C+', 'done'],
  ['기초전기실험', 2, '양학기', 'C+', 'done'],
  ['논리회로', 3, '양학기', 'C+', 'done'],
  ['전자회로1', 3, '양학기', 'C+', 'done'],
  ['전자장론', 3, '양학기', 'C+', 'done'],
  ['신호 및 시스템', 3, '양학기', 'C+', 'done'],
  ['자료구조및알고리즘이해', 3, '양학기', 'C+', 'done'],
  ['논리회로실험', 2, '양학기', 'B+', 'done'],
  ['전자회로실험', 2, '양학기', 'B+', 'done'],
  ['4차 산업혁명 Connecting Minds', 1, '2학기', '미수강', 'todo'],
  ['전자회로2', 3, '양학기', '미수강', 'todo'],
  ['반도체공학1', 3, '양학기', 'F → 재수강', 'redo'],
  ['융합전자연구1 / 융합캡스톤디자인1', 2, '권장 3-2', '미수강', 'todo'],
  ['융합전자연구2 / 융합캡스톤디자인2', 2, '권장 4-1', '미수강', 'todo'],
];

/* 재수강 대상(C+ 이하) — 그룹별 [과목, 성적, 학점, 개설학기, 비고] */
const DR_RETAKE = [
  { title: '전공필수', sub: '8과목 · 23학점', rows: [
    ['반도체공학1', 'F', 3, '양학기', '재수강 필수(졸업)'],
    ['전자기학', 'C+', 3, '양학기', ''],
    ['신호 및 시스템', 'C+', 3, '양학기', ''],
    ['전자회로1', 'C+', 3, '양학기', ''],
    ['전자장론', 'C+', 3, '양학기', ''],
    ['논리회로', 'C+', 3, '양학기', ''],
    ['기초전기실험', 'C+', 2, '양학기', ''],
    ['자료구조및알고리즘이해', 'C+', 3, '양학기', '실제 전공필수'],
  ]},
  { title: '전공선택', sub: '5과목 · 15학점', rows: [
    ['디지털신호처리', 'F', 3, '2학기', ''],
    ['확률 및 랜덤변수', 'D+', 3, '양학기', ''],
    ['통신의기초', 'C0', 3, '확인 필요', '요람에 없음'],
    ['디지털통신', 'C+', 3, '2학기', ''],
    ['인터넷프로토콜', 'C+', 3, '2학기', ''],
  ]},
  { title: '교양·학과기초', sub: '4과목 · 12학점', rows: [
    ['공업수학G', 'C+', 3, '1학기', '학과필수(수학)'],
    ['서양사상과 지성사', 'D0', 3, '양학기', '전문교양 영역별'],
    ['과학기술과 법', 'C+', 3, '2학기', '전문교양 영역별'],
    ['심리학개론', 'C+', 3, '확인', '교양(전공 아님)'],
  ]},
];

/* 앞으로 더 들어야 할 전공 26 — [분류, 과목, 학점, 개설학기] */
const DR_REMAINING = [
  ['인증필수', '반도체공학1 (재수강)', 3, '양학기'],
  ['인증필수', '전자회로2', 3, '양학기'],
  ['인증필수', '4차 산업혁명 Connecting Minds', 1, '2학기'],
  ['인증필수', '캡스톤 1 + 2 (한 세트)', 4, '권장 3-2→4-1'],
  ['인증선택', '2그룹 실험 택1', 3, '2학기'],
  ['인증선택', '추가 인증선택 (약 4과목)', 12, '1·2학기'],
];

/* 추가 확인 필요 체크리스트 */
const DR_CHECKLIST = [
  '영역별교양: {창의적사고·과학과철학·현대사회의윤리} 중 1과목 더 필요할 수 있음(심리학개론 인정 여부에 따라).',
  '설계 9학점: 현재 약 4.5 → 캡스톤 2과목(+4)으로 8.5. 캡스톤2 이수 전에 0.5↑ 보충(이후 설계 불인정).',
  '기초과학 택1: 생명과학(3)으로 충족 — 생명과학실험 동반 여부 학과 확인.',
  '아주인성: "아주인을 위한 마중물" 대체 인정 여부 확인.',
  '영어 공인성적 제출(TOEIC 730 / TEPS 329 / iBT 72 / OPIc IL 등).',
  '학수구분 표기 차이(자료구조 등)·통신의기초 코드 매핑은 학과 졸업사정에서 최종 확인.',
];

/* ── 작은 렌더 헬퍼 ── */
function drPill(text, kind) {
  return `<span class="pill tiny${kind ? ' ' + kind : ''}">${esc(text)}</span>`;
}
function drDoneCell(grade, done) {
  if (done === 'done') return `<span class="pill tiny good">✓ ${esc(grade)}</span>`;
  if (done === 'redo') return `<span class="pill tiny bad">↻ ${esc(grade)}</span>`;
  return `<span class="pill tiny warn">★ ${esc(grade)}</span>`;
}

function renderDegreeReq(p) {
  const earned = 94, total = 128, remain = total - earned;
  const pct = Math.round(earned / total * 100);

  const overviewRows = DR_OVERVIEW.map(([item, req, cur, st]) => `<tr>
      <td style="font-weight:600">${esc(item)}</td>
      <td class="tiny muted">${esc(req)}</td>
      <td>${st ? drPill(cur, st) : `<span class="tiny">${esc(cur)}</span>`}</td>
    </tr>`).join('');

  const requiredRows = DR_REQUIRED.map(([name, cr, term, grade, done]) => `<tr>
      <td>${esc(name)}</td>
      <td class="tiny">${cr}</td>
      <td class="tiny muted">${esc(term)}</td>
      <td>${drDoneCell(grade, done)}</td>
    </tr>`).join('');

  const retakeCards = DR_RETAKE.map(g => `<div class="card">
      <div class="row" style="align-items:baseline"><h3 style="flex:1;margin:0">${esc(g.title)}</h3>
        <span class="tiny muted">${esc(g.sub)}</span></div>
      <div class="chaptbl" style="margin-top:8px"><table>
        <thead><tr><th>과목</th><th>성적</th><th>학점</th><th>개설학기</th><th>비고</th></tr></thead>
        <tbody>${g.rows.map(([n, gr, cr, term, note]) => `<tr>
          <td>${esc(n)}</td>
          <td>${gr === 'F' ? drPill(gr, 'bad') : `<span class="tiny">${esc(gr)}</span>`}</td>
          <td class="tiny">${cr}</td>
          <td class="tiny muted">${esc(term)}</td>
          <td class="tiny">${note ? (note.indexOf('필수') >= 0 ? drPill(note, 'bad') : `<span class="muted">${esc(note)}</span>`) : ''}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>`).join('');

  const remainingRows = DR_REMAINING.map(([cat, name, cr, term]) => `<tr>
      <td>${drPill(cat, cat === '인증필수' ? 'bad' : 'warn')}</td>
      <td>${esc(name)}</td>
      <td class="tiny">${cr}</td>
      <td class="tiny muted">${esc(term)}</td>
    </tr>`).join('');

  p.innerHTML = `
  <div class="card">
    <h2>전자공학과 졸업요건 정리</h2>
    <div class="tiny muted" style="line-height:1.6">
      2020학년도 요람 · 공학인증(ABEEK) <b>인증과정</b> 기준.
      졸업에 꼭 재수강할 과목은 <b>반도체공학1(F)</b> 하나뿐 — 나머지 C+ 이하는 평점용 선택 재수강.
    </div>
    <div class="bar" style="margin:14px 0 4px"><i style="width:${pct}%;background:var(--good)"></i></div>
    <div class="tiny muted">이수 ${earned} / 졸업 ${total}학점 (${pct}%) · 남은 ${remain}학점</div>
  </div>

  <div class="kpis">
    ${DR_KPI.map(([v, l, st]) => `<div class="kpi">
      <div class="v"${st === 'bad' ? ' style="color:var(--bad)"' : st === 'warn' ? ' style="color:var(--warn)"' : ''}>${v}</div>
      <div class="l">${esc(l)}</div></div>`).join('')}
  </div>

  <div class="card">
    <h2>1 · 졸업요건 총괄</h2>
    <div class="chaptbl"><table>
      <thead><tr><th style="width:24%">항목</th><th>요건</th><th>내 현황</th></tr></thead>
      <tbody>${overviewRows}</tbody>
    </table></div>
  </div>

  <div class="card">
    <h2>2 · 남은 졸업학점 = 34학점</h2>
    <div class="row">
      <div class="card" style="margin:0;background:var(--panel2)">
        <div class="kpi" style="border:0;background:transparent;padding:0">
          <div class="v">26</div><div class="l">전공 (인증필수 11 + 인증선택 15)</div></div>
      </div>
      <div class="card" style="margin:0;background:var(--panel2)">
        <div class="kpi" style="border:0;background:transparent;padding:0">
          <div class="v">8</div><div class="l">비전공 (영역별교양 보충 + 자유선택)</div></div>
      </div>
    </div>
    <div class="tiny muted" style="margin-top:10px;line-height:1.6">
      자유선택 9학점 중 심리학개론 3 사용 → 앞으로 약 6학점 자유.
      영역별교양 1과목을 더 들어야 하면 그만큼 빠져 <b>실제 자유 채움은 5~6학점 수준</b>.
    </div>
  </div>

  <div class="card">
    <h2>3 · 전공 인증필수 41학점</h2>
    <div class="tiny muted" style="margin-bottom:8px">✓ 이수 · ↻ 재수강 · ★ 미수강 &nbsp;|&nbsp; 캡스톤은 융합전자연구 또는 융합캡스톤디자인 한 세트만(1→2 순서).</div>
    <div class="chaptbl"><table>
      <thead><tr><th style="width:42%">과목</th><th>학점</th><th>개설학기</th><th>이수현황</th></tr></thead>
      <tbody>${requiredRows}</tbody>
    </table></div>
  </div>

  <div class="card">
    <h2>4 · 인증선택 27학점</h2>
    <div class="tiny" style="line-height:1.8">
      <div><b>1그룹</b> (택1 이상) — 확률및랜덤변수로 ${drPill('충족', 'good')} <span class="muted">/ 통신시스템·자동제어·디지털시스템설계·컴퓨터네트워크·전파공학(1학기), 반도체공학2(2학기)</span></div>
      <div style="margin-top:6px"><b>2그룹 실험</b> (택1 필수, 전부 2학기) <span class="muted">— 자동제어·전파·통신·임베디드·반도체실험</span></div>
      <div style="margin-top:6px"><b>그 외</b> <span class="muted">1·2학기 다수 개설 (컴퓨터구조·임베디드·VLSI·아날로그IC·RF회로·로봇공학 등). 졸업요건_정리.md 4절 목록 참고.</span></div>
    </div>
  </div>

  <div class="card">
    <h2>5 · 앞으로 더 들어야 할 전공 26학점</h2>
    <div class="chaptbl"><table>
      <thead><tr><th style="width:18%">분류</th><th>과목</th><th>학점</th><th>개설학기</th></tr></thead>
      <tbody>${remainingRows}</tbody>
    </table></div>
  </div>

  <div class="card"><h2>6 · 재수강 대상 (C+ 이하) — 17과목 · 50학점</h2>
    <div class="tiny muted">졸업엔 반도체공학1(F)만 필수. 나머지는 학점 인정됨 → 평점 향상 목적 선택 재수강.</div>
  </div>
  ${retakeCards}

  <div class="card">
    <h2>7 · 추가 확인 필요</h2>
    <ul style="margin:0;padding-left:18px;line-height:1.75" class="tiny">
      ${DR_CHECKLIST.map(t => `<li>${esc(t)}</li>`).join('')}
    </ul>
  </div>`;
}

/* degree 그룹에 등록 — '졸업 계획'(order 90) 앞 정리 화면(order 80) */
registerTab({ key: 'degreeReq', label: '졸업요건 정리', group: 'degree', order: 90, render: renderDegreeReq });

/* ESM-AUTO-EXPOSE */
Object.assign(globalThis, {
  DR_OVERVIEW, DR_KPI, DR_REQUIRED, DR_RETAKE, DR_REMAINING, DR_CHECKLIST,
  drPill, drDoneCell, renderDegreeReq,
});
