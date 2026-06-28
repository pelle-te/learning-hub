/* ============================================================
   ui-integrations.js — 탭: 🔗 연동 현황 (옵시디언 볼트 + Anki)
   ── 왜 이 파일이 있나 ──────────────────────────────────────
   '볼트 현황'과 'Anki 현황'은 둘 다 외부 자료를 읽어오는 작은 읽기전용
   연동 화면이라, 탭 2개로 두면 탭바만 길어졌다. 한 탭에 두 패널로 합친다.
   - 실제 렌더·핸들러는 ui-vault.js / ui-anki.js가 그대로 소유(중복 X).
     여기선 두 render를 각자의 패널 div에 끼워 넣기만 한다.
   - 패널 내부 동작(스캔·실시간 due)이 render()로 재렌더하면 tabs 디스패치가
     현재 탭(integrations)을 다시 그려 두 패널이 함께 갱신된다(ui-vault/anki는
     renderVault/renderAnki(pageEl()) 대신 render()를 호출하도록 바꿈).
============================================================ */
function renderIntegrations(p){
  p.innerHTML=`<div id="vaultPane"></div><div id="ankiPane" style="margin-top:6px"></div>`;
  renderVault(document.getElementById('vaultPane'));
  renderAnki(document.getElementById('ankiPane'));
}

/* 자료(src) 그룹에 등록 — 학습 항목 다음 */
registerTab({ key:'integrations', label:'연동 현황', group:'src', order:50, render:renderIntegrations });

/* ESM-AUTO-EXPOSE */
Object.assign(globalThis, { renderIntegrations });
