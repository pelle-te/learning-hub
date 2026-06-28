/* ============================================================
   ui-command.js — 명령 팔레트(⌘K / Ctrl+K) + 전역 단축키
   ── 왜 이 파일이 있나 ──────────────────────────────────────
   탭 이동·핵심 액션을 키보드 한 번으로(Linear/Things식 — 감사 축 K 델타).
   - paletteCommands(): 순수 함수 — 등록된 탭 + 핵심 액션을 {id,label,hint,run} 배열로.
     DOM 없이 테스트 가능. run은 기존 전역 핸들러(go/toggleTheme/export…)를 호출만 한다.
   - filterCmds(q): 가벼운 퍼지(토큰 부분일치) 필터 — 역시 순수.
   - openPalette()/closePalette(): 모달과 같은 토큰의 오버레이 UI.
   로드 시 DOM을 만들지 않는다(함수 정의 + 전역 keydown 리스너만) → file://·테스트 안전.
   탭이 아니므로 registerTab은 하지 않는다(네비에 안 뜸). app 보다 먼저 import.
============================================================ */
(function () {
  /* 명령 목록 — 등록된 탭(이동) + 핵심 액션. run은 호출 시점에 전역에 있는 핸들러를 부른다. */
  function paletteCommands() {
    var tabs = (typeof orderedTabs === 'function') ? orderedTabs() : [];
    var cmds = tabs.map(function (t) {
      return { id: 'tab:' + t.key, label: '이동 · ' + t.label, hint: '탭', run: function () { go(t.key); } };
    });
    function add(label, hint, run) { cmds.push({ id: 'act:' + label, label: label, hint: hint, run: run }); }
    add('테마 전환(라이트/다크)', '설정', function () { toggleTheme(); });
    add('캘린더(.ics) 내보내기', '데이터', function () { exportICS(); });
    add('데이터 내보내기(백업)', '데이터', function () { exportJSON(); });
    add('데이터 가져오기', '데이터', function () { var i = document.getElementById('imp'); if (i) i.click(); });
    add('되돌리기 · 직전 상태로', '데이터', function () { undoLast(); });
    add('전체 초기화…', '위험', function () { resetAll(); });
    return cmds;
  }

  /* 토큰 부분일치(순서 무시) — 'ㅌ 통' 같은 다중 토큰도 AND로 좁힌다. */
  function filterCmds(q) {
    var all = paletteCommands();
    q = (q || '').trim().toLowerCase();
    if (!q) return all;
    var toks = q.split(/\s+/);
    return all.filter(function (c) {
      var s = (c.label + ' ' + (c.hint || '')).toLowerCase();
      return toks.every(function (t) { return s.indexOf(t) >= 0; });
    });
  }

  var _ov = null, _sel = 0, _list = [];
  function raf(f) { return (typeof requestAnimationFrame === 'function') ? requestAnimationFrame(f) : f(); }

  function paint() {
    var listEl = _ov && _ov.querySelector('.cmd-list'); if (!listEl) return;
    if (_sel < 0) _sel = 0; if (_sel >= _list.length) _sel = _list.length - 1;
    listEl.innerHTML = _list.length ? _list.map(function (c, i) {
      return '<div class="cmd-row' + (i === _sel ? ' sel' : '') + '" data-i="' + i + '" role="option" aria-selected="' + (i === _sel) + '">'
        + '<span class="cmd-label">' + esc(c.label) + '</span>'
        + '<span class="cmd-hint">' + esc(c.hint || '') + '</span></div>';
    }).join('') : '<div class="cmd-empty">일치하는 명령이 없어요</div>';
  }

  function runSel() {
    var c = _list[_sel];
    closePalette();
    if (c && c.run) { try { c.run(); } catch (e) { if (typeof toast === 'function') toast('실행 실패: ' + (e && e.message || e), 'bad'); } }
  }

  function onKeyNav(e) {
    if (!_ov) return;
    if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); _sel++; paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); _sel--; paint(); }
    else if (e.key === 'Enter') { e.preventDefault(); runSel(); }
  }

  function closePalette() {
    if (!_ov) return;
    var ov = _ov; _ov = null;
    ov.classList.remove('in'); ov.classList.add('out');
    document.removeEventListener('keydown', onKeyNav, true);
    setTimeout(function () { try { ov.remove(); } catch (e) {} }, 160);
  }

  function openPalette() {
    if (_ov) { closePalette(); return; }   // 토글
    var ov = document.createElement('div');
    ov.className = 'cmd-ov';
    ov.innerHTML =
      '<div class="cmd-box" role="dialog" aria-modal="true" aria-label="명령 팔레트">'
      + '<input class="cmd-in" type="text" placeholder="명령·탭 검색 (예: 통계, 내보내기)" aria-label="명령 검색" autocomplete="off" spellcheck="false">'
      + '<div class="cmd-list" role="listbox"></div>'
      + '<div class="cmd-foot"><span><b>↑↓</b> 이동 · <b>Enter</b> 실행 · <b>Esc</b> 닫기</span><span class="cmd-brand">⌘K</span></div>'
      + '</div>';
    document.body.appendChild(ov);
    _ov = ov; _sel = 0; _list = filterCmds('');
    var input = ov.querySelector('.cmd-in');
    paint();
    raf(function () { ov.classList.add('in'); });
    input.addEventListener('input', function () { _list = filterCmds(input.value); _sel = 0; paint(); });
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) closePalette(); });
    ov.querySelector('.cmd-list').addEventListener('click', function (e) {
      var row = e.target.closest && e.target.closest('.cmd-row'); if (!row) return;
      _sel = (+row.getAttribute('data-i')) || 0; runSel();
    });
    ov.querySelector('.cmd-list').addEventListener('mousemove', function (e) {
      var row = e.target.closest && e.target.closest('.cmd-row'); if (!row) return;
      var i = (+row.getAttribute('data-i')) || 0; if (i !== _sel) { _sel = i; paint(); }
    });
    document.addEventListener('keydown', onKeyNav, true);
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 30);
  }

  /* 전역 단축키: Cmd/Ctrl+K 로 토글(입력 필드 포커스 중에도 — 별도 오버레이라 안전) */
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openPalette(); }
    }, true);
  }

  window.paletteCommands = paletteCommands;
  window.filterCmds = filterCmds;
  window.openPalette = openPalette;
  window.closePalette = closePalette;
})();
