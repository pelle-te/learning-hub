/* ============================================================
   shell/palette.ts — ⌘K 명령 팔레트 항목(레거시 paletteCommands 이식 + 고도화).
   탭 이동(React Router) + 핵심 데이터/내보내기/백업 액션. tab 항목은 CommandPalette가 navigate,
   act는 run() 호출. 최근 실행한 명령(recent.ts)을 위로 끌어올려 재실행이 빠르다.
============================================================ */
import { orderedTabs } from './tabs';
import { NAV_SHORTCUTS } from './shortcuts';
import { recentIds } from './recent';
import * as A from './actions';
import { useFocus } from '@/store/useFocus';
import { usePrefill } from '@/store/prefill';
import { useOverlay } from '@/store/useOverlay';

// C-5: 탭 → g-시퀀스 매핑(치트시트가 이미 정의). 팔레트 hint에 노출해 사용 중 키보드 내비를 학습시킨다.
const SEQ_BY_TAB = new Map(NAV_SHORTCUTS.map((s) => [s.tab, s.seq]));

export type PaletteCommand =
  | { id: string; kind: 'tab'; key: string; label: string; hint: string }
  /** act — run() 실행 후 to가 있으면 해당 탭으로 이동(팔레트가 navigate). */
  | { id: string; kind: 'act'; label: string; hint: string; run: () => void; to?: string };

function baseCommands(): PaletteCommand[] {
  const tabs: PaletteCommand[] = orderedTabs().map((t) => {
    const seq = SEQ_BY_TAB.get(t.key);
    return {
      id: 'tab:' + t.key,
      kind: 'tab',
      key: t.key,
      label: '이동 · ' + t.label,
      hint: seq ? 'G ' + seq.toUpperCase() : '탭',
    };
  });
  const acts: PaletteCommand[] = [
    // 오늘 — 가장 잦은 동사를 맨 위로.
    {
      id: 'act:focus-start',
      kind: 'act',
      label: '▶ 집중 시작 — 지금 블록',
      hint: '오늘',
      run: () => void useFocus.getState().startOnCurrent(),
      to: '/today',
    },
    // I-9: 복습 세션 러너 진입(오늘 인출할 것을 한 흐름으로).
    {
      id: 'act:review-run',
      kind: 'act',
      label: '↻ 복습 세션 — 밀린 챕터·회상·착각 재확인',
      hint: '복습',
      run: () => {},
      to: '/review-run',
    },
    // 기록 빠른 입력 — 프리필 요청 후 기록 탭으로(오늘 탭 블록 버튼과 같은 경로).
    {
      id: 'act:add-sum',
      kind: 'act',
      label: '기록 · 3문장 요약 남기기',
      hint: '기록',
      run: () => usePrefill.getState().request('sum', ''),
      to: '/journal',
    },
    {
      id: 'act:add-cbms',
      kind: 'act',
      label: '기록 · 오답(CBMS) 기록',
      hint: '기록',
      run: () => usePrefill.getState().request('cbms', ''),
      to: '/journal',
    },
    {
      id: 'act:add-bl',
      kind: 'act',
      label: '기록 · 보충 필요 추가',
      hint: '기록',
      run: () => usePrefill.getState().request('bl', ''),
      to: '/journal',
    },
    // 도움말
    {
      id: 'act:shortcuts',
      kind: 'act',
      label: '키보드 단축키 보기',
      hint: '도움말',
      // 예전엔 `window.dispatchEvent(new CustomEvent('lh:open-shortcuts'))` 로 App 에 신호를 보냈다 —
      // 도움말 열림이 App 의 useState 라 여기서 닿을 방법이 그것뿐이었다. 이제 스토어가 소유한다.
      run: () => useOverlay.getState().setHelp(true),
    },
    // 테마
    { id: 'act:theme', kind: 'act', label: '테마 전환(다크↔라이트)', hint: '설정', run: A.toggleTheme },
    { id: 'act:theme-dark', kind: 'act', label: '다크 모드', hint: '테마', run: () => A.setThemeTo('dark') },
    { id: 'act:theme-light', kind: 'act', label: '라이트 모드', hint: '테마', run: () => A.setThemeTo('light') },
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
      id: 'act:anki-week',
      kind: 'act',
      label: 'Anki 카드 초안 — 이번 주',
      hint: '내보내기',
      run: () => A.exportAnkiCards('week'),
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
      id: 'act:summary-week',
      kind: 'act',
      label: '요약 노트(.md) — 이번 주',
      hint: '내보내기',
      run: () => A.exportSummaryNotes('week'),
    },
    {
      id: 'act:summary-all',
      kind: 'act',
      label: '요약 노트(.md) — 전체',
      hint: '내보내기',
      run: () => A.exportSummaryNotes('all'),
    },
    // I-3: 하루 마감 원커맨드 — 백업+요약+카드+정리 체이닝.
    { id: 'act:closeout', kind: 'act', label: '오늘 마감 — 백업·요약·카드·정리', hint: '오늘', run: A.runCloseout },
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
