/* ============================================================
   ui-kit.js — 공용 UI 프리미티브 (utils 다음, state 이전 로드)
   네이티브 alert/confirm/prompt를 테마 일관·비차단·접근성 있는
   토스트/모달로 대체한다. 전역: toast() · confirmModal() · promptModal()
   - 로드 시점엔 DOM을 만들지 않는다(함수 정의만) → file:// 및 테스트 안전.
============================================================ */
(function () {
  /* ── 토스트(비차단 알림) ── */
  function toastHost() {
    var h = document.getElementById('toastHost');
    if (!h) {
      h = document.createElement('div');
      h.id = 'toastHost'; h.className = 'toast-host';
      h.setAttribute('aria-live', 'polite');
      document.body.appendChild(h);
    }
    return h;
  }
  /* toast(메시지, 종류['ok'|'bad'|'warn'|'info'], 지속ms) */
  window.toast = function (msg, type, ms) {
    type = type || 'ok'; ms = ms || 2600;
    var host = toastHost();
    var el = document.createElement('div');
    el.className = 'toast ' + type; el.setAttribute('role', 'status');
    var icon = ({ ok: '✓', bad: '⚠', warn: '⚠', info: 'ℹ' })[type] || '✓';
    var i = document.createElement('span'); i.className = 'toast-i'; i.textContent = icon;
    var m = document.createElement('span'); m.className = 'toast-m'; m.textContent = msg; // 텍스트만 → XSS 안전
    el.appendChild(i); el.appendChild(m);
    host.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('in'); });
    var kill = function () { el.classList.remove('in'); el.classList.add('out'); setTimeout(function () { el.remove(); }, 220); };
    var t = setTimeout(kill, ms);
    el.addEventListener('click', function () { clearTimeout(t); kill(); });
    return el;
  };

  /* ── 모달(confirm/prompt 공통) → Promise ── */
  function openModal(opts) {
    return new Promise(function (resolve) {
      var isPrompt = opts.kind === 'prompt';
      var ov = document.createElement('div');
      ov.className = 'modal-ov';
      ov.innerHTML =
        '<div class="modal" role="dialog" aria-modal="true">'
        + '<div class="modal-t"></div>'
        + '<div class="modal-b"></div>'
        + (isPrompt ? '<textarea class="modal-in" rows="3"></textarea>' : '')
        + '<div class="modal-a">'
        + '<button type="button" class="ghost modal-cancel"></button>'
        + '<button type="button" class="primary modal-ok' + (opts.danger ? ' modal-danger' : '') + '"></button>'
        + '</div></div>';
      var titleEl = ov.querySelector('.modal-t');
      var bodyEl = ov.querySelector('.modal-b');
      var okBtn = ov.querySelector('.modal-ok');
      var cancelBtn = ov.querySelector('.modal-cancel');
      var input = ov.querySelector('.modal-in');
      if (opts.title) { titleEl.textContent = opts.title; } else { titleEl.style.display = 'none'; }
      bodyEl.textContent = opts.message || '';        // 텍스트만(개행은 CSS white-space로 보존)
      okBtn.textContent = opts.okLabel || '확인';
      cancelBtn.textContent = opts.cancelLabel || '취소';
      if (input) { input.value = opts.value || ''; input.placeholder = opts.placeholder || ''; }

      var prev = document.activeElement;
      document.body.appendChild(ov);
      requestAnimationFrame(function () { ov.classList.add('in'); });

      function close(val) {
        ov.classList.remove('in'); ov.classList.add('out');
        document.removeEventListener('keydown', onKey, true);
        setTimeout(function () { ov.remove(); if (prev && prev.focus) { try { prev.focus(); } catch (e) {} } }, 170);
        resolve(val);
      }
      var cancelVal = isPrompt ? null : false;
      var okVal = function () { return isPrompt ? (input ? input.value.trim() : '') : true; };
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); close(cancelVal); return; }
        if (e.key === 'Enter') {
          // prompt 본문(textarea)에서 일반 Enter는 줄바꿈 허용, Ctrl/Cmd+Enter로 확정
          if (isPrompt && document.activeElement === input && !(e.ctrlKey || e.metaKey)) return;
          e.preventDefault(); close(okVal());
        }
        if (e.key === 'Tab') {  // 간단한 포커스 트랩
          var f = ov.querySelectorAll('button,textarea,input');
          if (!f.length) return;
          var first = f[0], last = f[f.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
      document.addEventListener('keydown', onKey, true);
      okBtn.onclick = function () { close(okVal()); };
      cancelBtn.onclick = function () { close(cancelVal); };
      ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(cancelVal); });
      setTimeout(function () { (input || okBtn).focus(); }, 50);
    });
  }
  /* confirmModal(메시지, {title, okLabel, cancelLabel, danger}) → Promise<boolean> */
  window.confirmModal = function (message, opts) {
    opts = opts || {};
    return openModal({ kind: 'confirm', message: message, title: opts.title, okLabel: opts.okLabel, cancelLabel: opts.cancelLabel, danger: opts.danger });
  };
  /* promptModal(메시지, {title, value, placeholder, okLabel}) → Promise<string|null> */
  window.promptModal = function (message, opts) {
    opts = opts || {};
    return openModal({ kind: 'prompt', message: message, title: opts.title, value: opts.value, placeholder: opts.placeholder, okLabel: opts.okLabel || '확인' });
  };

  /* ── 완료 체크박스(공용) — 오늘·스케줄 두 탭이 *같은 렌더·핸들러 경로*를 쓰게(감사 F-08).
     데이터는 원래도 같은 completions(setDone/isDone)였고, 이제 마크업·토글도 한 곳으로 모은다.
     esc/isDone/setDone/render는 호출 시점엔 전역에 존재(로드 순서상 ui-kit이 먼저라도 런타임 OK). */
  window.doneCheckbox = function (ds, sid, type, min, name) {
    var done = (typeof isDone === 'function') && isDone(ds, sid, type);
    return '<input type="checkbox" class="donechk"' + (done ? ' checked' : '')
      + ' title="완료 표시" aria-label="' + esc(name || '') + ' 완료"'
      + ' onchange="toggleDoneAt(\'' + ds + '\',\'' + sid + '\',\'' + type + '\',' + Math.round(min || 0) + ',this.checked)">';
  };
  /* 완료 토글 — 공유 데이터(setDone) 갱신 후 *현재 탭*만 재렌더(tabs 레지스트리 경유).
     예전엔 탭마다 toggleDoneToday→renderToday / toggleDone→renderSchedule로 갈렸다(렌더 이중화). */
  window.toggleDoneAt = function (ds, sid, type, min, on) {
    setDone(ds, sid, type, min, on);
    if (typeof render === 'function') render();
  };
})();
