import { useEffect, useRef } from 'react';
import { NAV_SHORTCUTS, GLOBAL_SHORTCUTS, tabByKey, paletteCommands } from '@/shell';
import { useFocusTrap } from '@/hooks/useFocusTrap';

// C-12: 팔레트 액션 카탈로그 — ⌘K를 열어 검색해야만 발견되던 강력 액션들을 치트시트에 노출.
// 카테고리(hint) 순으로 묶어 스캔성 확보. 단일 원천(palette.ts) 재사용이라 표류 없음.
const CAT_ORDER = ['오늘', '기록', '내보내기', '데이터', '백업', '테마', '설정', '도움말', '위험'];

/* ── C-7 컴포넌트 티어 이식(Tailwind) ──────────────────────────────────────────
   ⚠ 전역 앱크롬 클래스(`modal-ov`·`modal`·`modal-t`·`modal-a`·`primary`)는 **그대로 둔다** —
   ds.module + 전역 요소 규칙은 맨 마지막 티어에서 함께 옮긴다(App 의 `skip-link` 와 같은 취급).
   여기서 옮기는 것은 이 컴포넌트가 자기 모듈에 갖고 있던 레이아웃뿐이다.
   ⚠ `.h` 는 `<h3>` 다 — **언레이어드 전역 `h3{}`**(base.css: 13px · margin 0 0 6px · 600)가
   유틸리티를 이기므로 크기·여백에 `!` 가 필수다(§15-8 ①). 없으면 12px 이 조용히 13px 로 렌더된다.
   `.list li` 자손 셀렉터는 규약 4 대로 li 에 직접 클래스를 준다. */
/* ⚠ `!` 가 필수다 — 전역 `.modal`(features.css)이 `width: min(440px, 100%)` 를 **언레이어드**로
   걸고 있어 유틸리티가 진다. 원본 `.sheet` 는 CSS Module 이라 같은 명시도 + 나중 순서로 이겼다.
   빠뜨리면 치트시트가 540 이 아니라 440 폭으로 조용히 렌더된다(계산스타일 덤프가 잡았다). */
const SHEET = 'w-cheatsheet! max-w-cheatsheet!';
const GRID = 'mt-1 mb-3.5 grid grid-cols-2 gap-x-7 gap-y-4.5 max-narrow:grid-cols-1';
const H = 'mb-2.25! text-sm! leading-[1.6] font-semibold! text-mut';
const LIST = 'm-0 flex list-none flex-col gap-2 p-0';
const LI = 'flex items-center gap-2.5 text-md text-txt';
// kbd 칩 — UA 기본(monospace)을 유틸로 덮는다. 하단 립 1px 은 --shadow-kbd.
const KBD =
  'min-w-6 flex-none rounded-sm border border-line bg-panel2 px-1.75 py-1.25 text-center font-mono text-xs leading-none text-txt shadow-kbd';

/* ShortcutsHelp — '?' 키로 여는 단축키 치트시트(읽기 전용 오버레이).
   목록은 shell/shortcuts.ts 단일 원천. 표시/숨김은 부모(App)가 소유. Esc/클릭으로 닫힘.
   aria-modal 선언에 걸맞게 포커스를 패널에 가두고(useFocusTrap) 닫힐 때 트리거로 복원 —
   modal.tsx·DetailDrawer와 동일 계약(키보드 사용자가 배경으로 새지 않게). */
export default function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(open, panelRef);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  // 액션 명령만(탭 이동은 위 '이동' 섹션이 이미 커버) 카테고리 순으로 정렬해 카탈로그로.
  const acts = paletteCommands()
    .filter((c) => c.kind === 'act')
    .slice()
    .sort((a, b) => CAT_ORDER.indexOf(a.hint) - CAT_ORDER.indexOf(b.hint));

  return (
    /* 오버레이 클릭-닫기 = 마우스 편의. 키보드는 ESC(및 `?` 토글, capture 단계 등록) ·
       useFocusTrap · 진짜 닫기 버튼이 담당한다. */
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className="modal-ov in" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panelRef} className={`modal ${SHEET}`} role="dialog" aria-modal="true" aria-label="키보드 단축키">
        <div className="modal-t">⌨ 키보드 단축키</div>
        <div className={GRID}>
          <section>
            <h3 className={H}>
              이동 — <kbd className={KBD}>G</kbd> 누른 뒤
            </h3>
            <ul className={LIST}>
              {NAV_SHORTCUTS.map((sc) => (
                <li key={sc.seq} className={LI}>
                  <kbd className={KBD}>{sc.seq.toUpperCase()}</kbd>
                  <span>{tabByKey(sc.tab)?.label ?? sc.tab}</span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3 className={H}>전역</h3>
            <ul className={LIST}>
              {GLOBAL_SHORTCUTS.map((sc) => (
                <li key={sc.label} className={LI}>
                  <kbd className={KBD}>{sc.keys}</kbd>
                  <span>{sc.label}</span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3 className={H}>⌘K 명령 팔레트</h3>
            <ul className={LIST}>
              {acts.map((c) => (
                <li key={c.id} className={LI}>
                  <kbd className={KBD}>{c.hint}</kbd>
                  <span>{c.label}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
        <div className="modal-a">
          <button type="button" className="primary modal-ok" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
