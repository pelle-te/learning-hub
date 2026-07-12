import { useEffect, useRef } from 'react';
import { NAV_SHORTCUTS, GLOBAL_SHORTCUTS, tabByKey, paletteCommands } from '@/shell';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import styles from './ShortcutsHelp.module.css';

// C-12: 팔레트 액션 카탈로그 — ⌘K를 열어 검색해야만 발견되던 강력 액션들을 치트시트에 노출.
// 카테고리(hint) 순으로 묶어 스캔성 확보. 단일 원천(palette.ts) 재사용이라 표류 없음.
const CAT_ORDER = ['오늘', '기록', '내보내기', '데이터', '백업', '테마', '설정', '도움말', '위험'];

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
    <div className="modal-ov in" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panelRef}
        className={`modal ${styles.sheet}`}
        role="dialog"
        aria-modal="true"
        aria-label="키보드 단축키"
      >
        <div className="modal-t">⌨ 키보드 단축키</div>
        <div className={styles.grid}>
          <section>
            <h3 className={styles.h}>
              이동 — <kbd className={styles.kbd}>G</kbd> 누른 뒤
            </h3>
            <ul className={styles.list}>
              {NAV_SHORTCUTS.map((sc) => (
                <li key={sc.seq}>
                  <kbd className={styles.kbd}>{sc.seq.toUpperCase()}</kbd>
                  <span>{tabByKey(sc.tab)?.label ?? sc.tab}</span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3 className={styles.h}>전역</h3>
            <ul className={styles.list}>
              {GLOBAL_SHORTCUTS.map((sc) => (
                <li key={sc.label}>
                  <kbd className={styles.kbd}>{sc.keys}</kbd>
                  <span>{sc.label}</span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3 className={styles.h}>⌘K 명령 팔레트</h3>
            <ul className={styles.list}>
              {acts.map((c) => (
                <li key={c.id}>
                  <kbd className={styles.kbd}>{c.hint}</kbd>
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
