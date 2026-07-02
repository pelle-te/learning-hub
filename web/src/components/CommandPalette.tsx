import { useMemo } from 'react';
import { Command } from 'cmdk';
import { useNavigate } from 'react-router-dom';
import { paletteCommands, recordRecent } from '@/shell';
import styles from './CommandPalette.module.css';

/* CommandPalette — cmdk 기반 ⌘K 팔레트(손코딩 ui-command.js 대체, 설계도 §3).
   명령 목록은 네이티브 shell/palette(탭+액션)에서. 이동은 React Router, 액션은 shell/actions를 호출.
   open/onOpenChange는 부모(App)가 소유 — 전역 단축키도 거기서. */
export default function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  // 열릴 때만 계산(최근 명령 LRU가 외부에서 바뀌므로 재오픈 시 최신 순서 반영). 닫히면 빈 목록.
  const cmds = useMemo(() => (open ? paletteCommands() : []), [open]);

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="명령 팔레트"
      className={styles.dialog}
      overlayClassName={styles.overlay}
      contentClassName={styles.content}
    >
      <Command.Input className={styles.input} placeholder="명령·탭 검색 (예: 통계, 내보내기)" autoFocus />
      <Command.List className={styles.list}>
        <Command.Empty className={styles.empty}>일치하는 명령이 없어요</Command.Empty>
        {cmds.map((c) => (
          <Command.Item
            key={c.id}
            value={c.label + ' ' + c.hint}
            className={styles.item}
            onSelect={() => {
              onOpenChange(false);
              recordRecent(c.id); // 최근 명령 LRU — 다음 ⌘K에서 위로.
              try {
                if (c.kind === 'tab') navigate('/' + c.key, { viewTransition: true });
                else {
                  c.run();
                  // 액션이 특정 탭에서 이어지는 경우(집중 시작·기록 프리필) 실행 후 이동.
                  if (c.to) navigate(c.to, { viewTransition: true });
                }
              } catch (e) {
                console.error(e);
              }
            }}
          >
            <span className={styles.label}>{c.label}</span>
            <span className={styles.hint}>{c.hint}</span>
          </Command.Item>
        ))}
      </Command.List>
      <div className={styles.foot}>
        <span>
          <b>↑↓</b> 이동 · <b>Enter</b> 실행 · <b>Esc</b> 닫기
        </span>
        <span className={styles.brand}>⌘K</span>
      </div>
    </Command.Dialog>
  );
}
