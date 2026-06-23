/* ============================================================
   app.js — 진입점 (마지막 로드): 런타임 전역 + 2단 네비 + 부팅
   상위 섹션(플래너 / 대학생활) → 하위 탭 구조
============================================================ */
let SECTION = 'planner';  // 현재 상위 섹션
let TAB = 'schedule';     // 현재 하위 탭
let RES = null;           // 마지막 스케줄 결과 (ui-schedule가 갱신/참조)
let vaultHandle = null;   // 옵시디언 폴더 핸들 (세션 동안만 유지)

/* 하위 탭 정의: key → 라벨 */
const TAB_LABEL = {
  schedule: '📅 주간 스케줄',
  items:    '📝 학습 항목',
  routine:  '⏰ 일과 & 가용시간',
  vault:    '📚 볼트 현황',
  anki:     '🃏 Anki 현황',
  stats:    '📊 통계',
  degree:   '🎓 졸업 계획',
};

/* 상위 섹션 정의: [key, 라벨, 소속 하위 탭 목록] */
const SECTIONS = [
  ['planner', '🗓 플래너',   ['schedule', 'items', 'routine', 'vault', 'anki', 'stats']],
  ['college', '🎓 대학생활', ['degree']],
];

/* 헬퍼: 섹션 객체 조회 */
function sectionOf(key) {
  return SECTIONS.find(function (s) { return s[0] === key; });
}

function renderNav() {
  // 상위 섹션 탭
  var sec = document.getElementById('sections');
  if (sec) {
    sec.setAttribute('role', 'tablist');
    sec.setAttribute('aria-label', '섹션');
    sec.innerHTML = SECTIONS.map(function (s) {
      var k = s[0], l = s[1];
      return '<button role="tab" id="sec-' + k + '" aria-selected="' + (SECTION === k) +
             '" class="' + (SECTION === k ? 'active' : '') +
             '" onclick="goSection(\'' + k + '\')">' + l + '</button>';
    }).join('');
  }

  // 하위 탭 (현재 섹션의 탭들)
  var nav = document.getElementById('nav');
  nav.setAttribute('role', 'tablist');
  nav.setAttribute('aria-label', '하위 메뉴');
  var tabs = sectionOf(SECTION)[2];
  nav.innerHTML = tabs.map(function (k) {
    return '<button role="tab" id="tab-' + k + '" aria-selected="' + (TAB === k) +
           '" class="' + (TAB === k ? 'active' : '') +
           '" onclick="go(\'' + k + '\')">' + TAB_LABEL[k] + '</button>';
  }).join('');
}

/* 상위 섹션 전환: 해당 섹션의 첫 탭으로 진입 */
function goSection(s) {
  if (SECTION === s) return;
  SECTION = s;
  TAB = sectionOf(s)[2][0];
  render();
}

/* 하위 탭 전환 */
function go(t) { TAB = t; render(); }

function render() {
  renderNav();
  var p = pageEl();
  if (TAB === 'schedule')      renderSchedule(p);
  else if (TAB === 'items')    renderItems(p);
  else if (TAB === 'routine')  renderRoutine(p);
  else if (TAB === 'stats')    renderStats(p);
  else if (TAB === 'vault')    renderVault(p);
  else if (TAB === 'anki')     renderAnki(p);
  else if (TAB === 'degree')   renderDegree(p);
}

/* 부팅 */
applyTheme();
render();
