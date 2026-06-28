/* ============================================================
   tabs.js — 탭 레지스트리 + 네비 + 렌더 디스패치 (ui-kit 다음, state 이전 로드)
   ── 왜 이 파일이 있나 ──────────────────────────────────────
   예전엔 탭 1개를 추가하려면 app.js의 TAB_LABEL·TAB_ORDER·render() 분기와
   index.html 로드 라인까지 *여러 곳*을 동시에 고쳐야 했다(설계도 §13.5 함정).
   이제 각 ui-*.js가 파일 끝에서 registerTab({...})으로 자기 자신을 등록하고,
   여기 nav/dispatch는 *레지스트리만 순회*한다 → 탭 추가 = 파일 추가 + 등록 한 줄.
   registerTab은 ui-* 로드 전에 정의돼 있어야 하므로 이 파일을 일찍 싣는다.
============================================================ */

/* ── 탭 런타임 전역(여러 모듈이 갱신·참조하는 가변 공유 상태) ──
   ESM(strict)에서도 여러 모듈이 같은 슬롯을 읽고 쓰도록 globalThis에 직접 둔다.
   (import 바인딩은 읽기전용이라 ui-*가 RES=… 재할당을 못 하므로 전역으로 공유) */
globalThis.TAB = 'today';        // 현재 탭 (실행 중심 — '오늘 학습'으로 시작)
globalThis.RES = null;           // 마지막 schedule() 결과 (여러 탭이 갱신·참조)
globalThis.vaultHandle = null;   // 옵시디언 폴더 핸들 (세션 동안만 유지)

/* ── 레지스트리 ──
   def = { key, label, group, order, render }
   - key   : 탭 식별자(TAB 값·DOM id에 쓰임)
   - label : 네비 버튼 텍스트(이모지 포함)
   - group : 네비 구분선 묶음. 그룹이 바뀌는 경계에 navsep을 넣는다.
   - order : 표시 순서(작을수록 앞)
   - render: render<Tab>(pageEl) 진입점
*/
const TAB_REGISTRY = [];
function registerTab(def) {
  if (!def || !def.key) return;
  // 같은 key 재등록(테스트 재로드 등)이면 덮어쓴다 — 중복 누적 방지
  const i = TAB_REGISTRY.findIndex(function (t) { return t.key === def.key; });
  if (i >= 0) TAB_REGISTRY[i] = def; else TAB_REGISTRY.push(def);
}
function orderedTabs() {
  return TAB_REGISTRY.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
}
function tabDef(key) { return TAB_REGISTRY.find(function (t) { return t.key === key; }) || null; }

/* 그룹(상위 탭)의 표시 이름 — group 키 → 라벨(텍스트만; 아이콘은 renderNav가 붙인다).
   라벨에 이모지/마크업을 넣지 않는 이유: 명령 팔레트가 라벨을 esc()로 출력하므로
   SVG를 넣으면 코드가 그대로 보인다 → 아이콘은 표시 계층(renderNav)에서만 합성한다. */
var GROUP_LABELS = { do: '계획', src: '자료', log: '기록·분석', degree: '졸업', settings: '설정' };

/* ── 라인 아이콘 세트(Lucide 스타일·단색·currentColor) ──
   OS 이모지 혼용(픽셀·색감 제각각)을 걷어내고 네비를 하나의 시각 언어로 통일.
   감정 전달이 핵심인 곳(🔥 스트릭 등)만 이모지를 남긴다. */
var ICON_PATHS = {
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  chart: '<path d="M3 3v18h18"/><rect x="7" y="11" width="3" height="6"/><rect x="12" y="7" width="3" height="10"/><rect x="17" y="13" width="3" height="4"/>',
  cap: '<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1 2.5 3 6 3s6-2 6-3v-5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M15 13H9M15 17H9M10 9H9"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.07 0l2.5-2.5a5 5 0 0 0-7.07-7.07l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.07 0L4.43 13.5a5 5 0 0 0 7.07 7.07l1.5-1.5"/>',
  notebook: '<path d="M2 6h3M2 10h3M2 14h3M2 18h3"/><rect x="5" y="3" width="17" height="18" rx="2"/><path d="M10 3v18"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h6"/>'
};
function svgIcon(name){
  var p = ICON_PATHS[name]; if (!p) return '';
  return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">' + p + '</svg>';
}
var GROUP_ICONS = { do:'calendar', src:'book', log:'chart', degree:'cap', settings:'gear' };
var TAB_ICONS = { today:'target', schedule:'calendar', routine:'clock', items:'file',
  integrations:'link', journal:'notebook', review:'refresh', stats:'chart',
  degree:'cap', degreeReq:'clipboard', settings:'gear' };

/* 네비 렌더 — 2단 계층: 위(상위 탭=그룹) / 아래(하위 탭=그 그룹의 탭들).
   상위 탭을 누르면 그 그룹의 첫 탭으로 이동(goGroup). 현재 탭이 속한 그룹이 활성. */
function renderNav() {
  var nav = document.getElementById('nav');
  if (!nav) return;
  var visible = orderedTabs().filter(function (t) { return !t.hidden; });

  // 상위 탭(그룹) 목록 — 등장 순서대로 중복 제거
  var groups = [];
  visible.forEach(function (t) { if (groups.indexOf(t.group) < 0) groups.push(t.group); });

  // 현재 탭이 속한 그룹(숨김 탭이면 그 그룹을 그대로 활성 — 예: 설정)
  var cur = tabDef(TAB);
  var curGroup = cur ? cur.group : (groups[0] || null);

  var top = groups.map(function (g) {
    var active = g === curGroup;
    return '<button role="tab" class="navparent' + (active ? ' active' : '') + '"' +
      ' aria-selected="' + active + '" onclick="goGroup(\'' + g + '\')">' +
      svgIcon(GROUP_ICONS[g]) + '<span>' + (GROUP_LABELS[g] || g) + '</span></button>';
  }).join('');

  // 하위 탭 — 현재 그룹에 속한 탭들(숨김 탭이 현재 그룹이면 그것도 표시해 길잃음 방지)
  var subs = orderedTabs().filter(function (t) { return t.group === curGroup && (!t.hidden || TAB === t.key); })
    .map(function (t) {
      var active = TAB === t.key;
      return '<button role="tab" id="tab-' + t.key + '" aria-selected="' + active + '"' +
        ' tabindex="' + (active ? '0' : '-1') + '" class="navchild' + (active ? ' active' : '') +
        '" onclick="go(\'' + t.key + '\')">' + svgIcon(TAB_ICONS[t.key]) + '<span>' + t.label + '</span></button>';
    }).join('');

  nav.innerHTML = '<div class="navtop" role="tablist" aria-label="구역">' + top + '</div>' +
    '<div class="navsub" role="tablist" aria-label="' + (GROUP_LABELS[curGroup] || '') + ' 메뉴">' + subs + '</div>';
}

/* 상위 탭 클릭 → 그 그룹의 (보이는) 첫 탭으로 이동 */
function goGroup(g) {
  var first = orderedTabs().filter(function (t) { return t.group === g && !t.hidden; })[0];
  if (first) go(first.key);
}

/* 탭 전환 */
function go(t) { TAB = t; render(); }

/* role=tablist 키보드 이동(←/→/Home/End) — ARIA 탭 패턴 충족 */
function navKey(e) {
  var keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
  if (keys.indexOf(e.key) < 0) return;
  var btns = [].slice.call(e.currentTarget.querySelectorAll('button[role=tab]'));
  if (!btns.length) return;
  var i = btns.indexOf(document.activeElement); if (i < 0) i = 0;
  var n = i;
  if (e.key === 'ArrowRight') n = (i + 1) % btns.length;
  else if (e.key === 'ArrowLeft') n = (i - 1 + btns.length) % btns.length;
  else if (e.key === 'Home') n = 0;
  else if (e.key === 'End') n = btns.length - 1;
  e.preventDefault();
  btns[n].focus();
}

/* 렌더 — 레지스트리에서 현재 탭을 찾아 그 render()만 호출(없으면 첫 탭으로 폴백) */
function render() {
  renderNav();
  var t = tabDef(TAB) || orderedTabs()[0];
  if (t && t.render) { TAB = t.key; t.render(pageEl()); }
}

/* ESM-AUTO-EXPOSE */
/* ESM: 이 모듈의 공개 심볼을 전역에 노출 — 인라인 onclick·타 모듈 호출용
   (모듈 내부 헬퍼는 위에 두면 비공개. 여긴 파일의 공개 표면) */
Object.assign(globalThis, { TAB_REGISTRY, GROUP_LABELS, ICON_PATHS, svgIcon, GROUP_ICONS, TAB_ICONS, registerTab, orderedTabs, tabDef, renderNav, goGroup, go, navKey, render });
