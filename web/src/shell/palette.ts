/* ============================================================
   shell/palette.ts — ⌘K 명령 팔레트 항목(레거시 paletteCommands 이식 + 고도화).
   탭 이동(React Router) + 핵심 데이터/내보내기/백업 액션. tab 항목은 CommandPalette가 navigate,
   act는 run() 호출. 최근 실행한 명령(recent.ts)을 위로 끌어올려 재실행이 빠르다.
============================================================ */
import { orderedTabs } from './tabs';
import { recentIds } from './recent';
import * as A from './actions';

export type PaletteCommand =
  | { id: string; kind: 'tab'; key: string; label: string; hint: string }
  | { id: string; kind: 'act'; label: string; hint: string; run: () => void };

function baseCommands(): PaletteCommand[] {
  const tabs: PaletteCommand[] = orderedTabs().map((t) => ({
    id: 'tab:' + t.key,
    kind: 'tab',
    key: t.key,
    label: '이동 · ' + t.label,
    hint: '탭',
  }));
  const acts: PaletteCommand[] = [
    // 도움말
    {
      id: 'act:shortcuts',
      kind: 'act',
      label: '키보드 단축키 보기',
      hint: '도움말',
      run: () => window.dispatchEvent(new CustomEvent('lh:open-shortcuts')),
    },
    // 테마
    { id: 'act:theme', kind: 'act', label: '테마 전환(순환)', hint: '설정', run: A.toggleTheme },
    { id: 'act:theme-dark', kind: 'act', label: '다크 모드', hint: '테마', run: () => A.setThemeTo('dark') },
    { id: 'act:theme-light', kind: 'act', label: '라이트 모드', hint: '테마', run: () => A.setThemeTo('light') },
    { id: 'act:theme-sepia', kind: 'act', label: '세피아 모드', hint: '테마', run: () => A.setThemeTo('sepia') },
    // 내보내기
    { id: 'act:ics', kind: 'act', label: '캘린더(.ics) 내보내기', hint: '내보내기', run: A.exportICS },
    {
      id: 'act:anki-today',
      kind: 'act',
      label: 'Anki 카드 초안 — 오늘',
      hint: '내보내기',
      run: () => A.exportAnkiCards('today'),
    },
    {
      id: 'act:anki-all',
      kind: 'act',
      label: 'Anki 카드 초안 — 전체',
      hint: '내보내기',
      run: () => A.exportAnkiCards('all'),
    },
    {
      id: 'act:summary-today',
      kind: 'act',
      label: '요약 노트(.md) — 오늘',
      hint: '내보내기',
      run: () => A.exportSummaryNotes('today'),
    },
    {
      id: 'act:summary-all',
      kind: 'act',
      label: '요약 노트(.md) — 전체',
      hint: '내보내기',
      run: () => A.exportSummaryNotes('all'),
    },
    // 데이터·백업
    { id: 'act:export', kind: 'act', label: '데이터 내보내기(백업)', hint: '데이터', run: A.exportJSON },
    {
      id: 'act:import',
      kind: 'act',
      label: '데이터 가져오기',
      hint: '데이터',
      run: () => document.getElementById('imp')?.click(),
    },
    { id: 'act:vault-backup', kind: 'act', label: '볼트 폴더에 백업', hint: '백업', run: A.backupToVault },
    { id: 'act:idb-restore', kind: 'act', label: 'IndexedDB에서 복구', hint: '백업', run: A.restoreFromIDB },
    { id: 'act:archive', kind: 'act', label: '오래된 기록 보관·정리', hint: '데이터', run: () => A.archiveOld() },
    { id: 'act:undo', kind: 'act', label: '되돌리기 · 직전 상태로', hint: '데이터', run: A.undoLast },
    { id: 'act:reset', kind: 'act', label: '전체 초기화…', hint: '위험', run: A.resetAll },
  ];
  return [...tabs, ...acts];
}

/** 팔레트 명령 — 최근 실행한 것을 최신순으로 위에 올리고 나머지는 기본 순서 유지(안정 정렬). */
export function paletteCommands(): PaletteCommand[] {
  const all = baseCommands();
  const recent = recentIds();
  const rank = (id: string) => {
    const i = recent.indexOf(id);
    return i < 0 ? Number.POSITIVE_INFINITY : i;
  };
  return all.slice().sort((a, b) => rank(a.id) - rank(b.id));
}
