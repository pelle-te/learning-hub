/* ============================================================
   app.js — 진입점 (마지막 로드): 헤더 오버플로 메뉴 + 부팅
   탭 정의/네비/렌더 디스패치는 tabs.js로, 각 탭은 자기 ui-*.js 끝에서
   registerTab()으로 자신을 등록한다(여기엔 탭별 분기 없음 — 추가/삭제에 무영향).
============================================================ */

/* ── 헤더 오버플로 메뉴(데이터·백업·초기화) ── */
function toggleMore() {
  var m = document.getElementById('moreMenu');
  if (!m) return;
  if (m.hasAttribute('hidden')) openMore(); else closeMore();
}
function openMore() {
  var m = document.getElementById('moreMenu'), b = document.getElementById('moreBtn');
  if (!m) return;
  m.removeAttribute('hidden');
  if (b) b.setAttribute('aria-expanded', 'true');
  setTimeout(function () {
    document.addEventListener('mousedown', moreOutside, true);
    document.addEventListener('keydown', moreEsc, true);
  }, 0);
}
function closeMore() {
  var m = document.getElementById('moreMenu'), b = document.getElementById('moreBtn');
  if (!m) return;
  m.setAttribute('hidden', '');
  if (b) b.setAttribute('aria-expanded', 'false');
  document.removeEventListener('mousedown', moreOutside, true);
  document.removeEventListener('keydown', moreEsc, true);
}
function moreOutside(e) { var w = document.getElementById('moreWrap'); if (w && !w.contains(e.target)) closeMore(); }
function moreEsc(e) { if (e.key === 'Escape') { closeMore(); var b = document.getElementById('moreBtn'); if (b) b.focus(); } }

/* 부팅 */
applyTheme();
(function () {
  var nav = document.getElementById('nav');
  if (nav && nav.addEventListener) nav.addEventListener('keydown', navKey);
})();
render();

/* ESM-AUTO-EXPOSE */
/* ESM: 이 모듈의 공개 심볼을 전역에 노출 — 인라인 onclick·타 모듈 호출용
   (모듈 내부 헬퍼는 위에 두면 비공개. 여긴 파일의 공개 표면) */
Object.assign(globalThis, { toggleMore, openMore, closeMore, moreOutside, moreEsc });
