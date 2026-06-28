/* ============================================================
   tabs.js — 탭 레지스트리 + 네비 + 렌더 디스패치 (ui-kit 다음, state 이전 로드)
   ── 왜 이 파일이 있나 ──────────────────────────────────────
   예전엔 탭 1개를 추가하려면 app.js의 TAB_LABEL·TAB_ORDER·render() 분기와
   index.html 로드 라인까지 *여러 곳*을 동시에 고쳐야 했다(설계도 §13.5 함정).
   이제 각 ui-*.js가 파일 끝에서 registerTab({...})으로 자기 자신을 등록하고,
   여기 nav/dispatch는 *레지스트리만 순회*한다 → 탭 추가 = 파일 추가 + 등록 한 줄.
   registerTab은 ui-* 로드 전에 정의돼 있어야 하므로 이 파일을 일찍 싣는다.
============================================================ */

/* ── 탭 런타임 전역(여러 모듈이 공유) ── */
let TAB = 'today';        // 현재 탭 (실행 중심 — '오늘 학습'으로 시작)
let RES = null;           // 마지막 schedule() 결과 (여러 탭이 갱신·참조)
let vaultHandle = null;   // 옵시디언 폴더 핸들 (세션 동안만 유지)

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

/* 네비 렌더 — 그룹이 바뀌는 경계에만 구분선(navsep)을 넣어 N개 그룹으로 확장 가능 */
function renderNav() {
  var nav = document.getElementById('nav');
  if (!nav) return;
  var prevGroup = null, html = '';
  orderedTabs().forEach(function (t) {
    if (prevGroup !== null && t.group !== prevGroup)
      html += '<span class="navsep" aria-hidden="true"></span>';
    prevGroup = t.group;
    html += '<button role="tab" id="tab-' + t.key + '" aria-selected="' + (TAB === t.key) +
      '" tabindex="' + (TAB === t.key ? '0' : '-1') + '" class="' + (TAB === t.key ? 'active' : '') +
      '" onclick="go(\'' + t.key + '\')">' + t.label + '</button>';
  });
  nav.innerHTML = html;
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
