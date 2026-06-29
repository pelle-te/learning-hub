import { useEffect } from 'react';
import { NAV_SHORTCUTS, GLOBAL_SHORTCUTS } from '@/shell';
import styles from './ShortcutsHelp.module.css';

/* ShortcutsHelp — '?' 키로 여는 단축키 치트시트(읽기 전용 오버레이).
   목록은 shell/shortcuts.ts 단일 원천. 표시/숨김은 부모(App)가 소유. Esc/클릭으로 닫힘. */
export default function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
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

  return (
    <div className="modal-ov in" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${styles.sheet}`} role="dialog" aria-modal="true" aria-label="키보드 단축키">
        <div className="modal-t">⌨ 키보드 단축키</div>
        <div className={styles.grid}>
          <section>
            <h3 className={styles.h}>
              이동 — <kbd className={styles.kbd}>G</kbd> 누른 뒤
            </h3>
            <ul className={styles.list}>
              {NAV_SHORTCUTS.map((s) => (
                <li key={s.seq}>
                  <kbd className={styles.kbd}>{s.seq.toUpperCase()}</kbd>
                  <span>{s.label}</span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3 className={styles.h}>전역</h3>
            <ul className={styles.list}>
              {GLOBAL_SHORTCUTS.map((s) => (
                <li key={s.label}>
                  <kbd className={styles.kbd}>{s.keys}</kbd>
                  <span>{s.label}</span>
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
