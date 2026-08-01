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
import { MOD_LABEL } from '@/lib/platform';

// C-5: 탭 → g-시퀀스 매핑(치트시트가 이미 정의). 팔레트 hint에 노출해 사용 중 키보드 내비를 학습시킨다.
const SEQ_BY_TAB = new Map(NAV_SHORTCUTS.map((s) => [s.tab, s.seq]));

export type PaletteCommand =
  | { id: string; kind: 'tab'; key: string; label: string; hint: string }
  /** act — run() 실행 후 to가 있으면 해당 탭으로 이동(팔레트가 navigate).
   *  ⚠ `run` 이 **선택**인 것은 P3 의 산물이다: 탭이 아닌 **화면**(`/items?view=structure`)으로
   *  가는 항목은 부수효과가 없고 이동이 전부다. 빈 `() => {}` 를 놓는 것보다 타입이 사실이다. */
  | { id: string; kind: 'act'; label: string; hint: string; run?: () => void; to?: string };

function baseCommands(): PaletteCommand[] {
  const tabs: PaletteCommand[] = orderedTabs().map((t) => {
    const seq = SEQ_BY_TAB.get(t.key);
    /* Q-22 — 은퇴한 탭은 **`to` 로 간다**(`key` 가 경로가 아니다). 종전엔 은퇴하면 `TABS` 에서
       통째로 빼서 ⌘K 에서도 사라졌고, 그 구멍을 `act:graph` 한 줄로 손으로 메우고 있었다. */
    if (t.role === 'retired') {
      return { id: 'tab:' + t.key, kind: 'act', label: '이동 · ' + t.label, hint: '은퇴', to: t.to };
    }
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
      label: '집중 시작 — 지금 블록',
      hint: '오늘',
      run: () => void useFocus.getState().startOnCurrent(),
      to: '/today',
    },
    /* ID-3: 즉석 집중 — 예약 블록 없이 임의 길이 타이머(볼트 정리·정독 등 비예약 학습).
       프리셋 3종을 노출하되 store.startFree(min)은 임의 min 을 받는다(유령 완료 없이).

       ⚠ **로드맵 N-1 은 이 셋의 은퇴도 적었지만 남긴다.** N-1 은 *객체의 동사*를 만드는
       항목인데 즉석 집중에는 객체가 없다 — 무엇 위에서도 부를 수 없으므로 동사 경로가
       대체가 되지 못한다. 대체 없이 지우는 것은 정리가 아니라 기능 축소다(ID-3 이 이
       셋을 의도적으로 출하했다 · 절대규칙 #4). */
    {
      id: 'act:focus-free-25',
      kind: 'act',
      label: '즉석 집중 25분 — 예약 없이',
      hint: '오늘',
      run: () => useFocus.getState().startFree(25),
    },
    {
      id: 'act:focus-free-15',
      kind: 'act',
      label: '즉석 집중 15분 — 예약 없이',
      hint: '오늘',
      run: () => useFocus.getState().startFree(15),
    },
    {
      id: 'act:focus-free-50',
      kind: 'act',
      label: '즉석 집중 50분 — 예약 없이',
      hint: '오늘',
      run: () => useFocus.getState().startFree(50),
    },
    // I-9: 복습 세션 러너 진입(오늘 인출할 것을 한 흐름으로).
    {
      id: 'act:review-run',
      kind: 'act',
      label: '복습 세션 — 밀린 챕터·회상·착각 재확인',
      hint: '복습',
      run: () => {},
      to: '/review-run',
    },
    /* 기록 빠른 입력 — 프리필 요청 후 기록 탭으로(오늘 탭 블록 버튼과 같은 경로).

       ⚠ **로드맵 N-1 은 이 둘의 은퇴를 적었지만 남긴다.** 은퇴 근거는 "`request(form,'')` 로
       과목을 빈 채 넘긴다"였고 그건 맞다 — 그래서 N-1 의 동사 경로가 **과목을 채워** 같은
       폼을 연다. 하지만 동사 경로는 *객체 히트가 있어야* 도달한다: 과목을 아직 안 만든
       사용자, 또는 특정 과목 없이 그냥 요약을 남기려는 경우엔 입구가 통째로 사라진다.
       D-2 가 `act:add-bl` 을 지울 수 있었던 것은 ⌘Enter 라는 **항상 도달 가능한** 대체가
       있었기 때문인데, 여기엔 그런 대체가 없다(그 논증은 이 둘로 전이되지 않는다).
       재평가 조건: 과목 없는 요약이 실제로 안 쓰인다는 관측(N-11 방문 원장). */
    {
      id: 'act:add-sum',
      kind: 'act',
      label: '기록 · 3문장 요약 남기기',
      hint: '기록',
      run: () => usePrefill.getState().request('sum', ''),
      to: '/journal',
    },
    /* ⚠ `act:add-cbms`(기록 · 오답(CBMS) 기록)은 **P-2 에서 은퇴**했다(2026-08-01).
       하는 일이 "과목·챕터·유형·메모를 빈 채로 오답 폼을 여는 것"이었고, 그게 러너 밖에서
       오답을 남기는 유일한 길이었다 — 그리고 `cbms` 는 **0행**이었다. 이제 복습 러너에서
       `1`(못 떠올림) 직후 그 자리에 유형 다섯이 뜨고 **1키로 커밋**된다(문맥이 sid·과목명·
       챕터를 이미 알아 필드가 4→1). D-2 가 `act:add-bl` 을 지운 논증이 여기서 그대로 성립한다:
       *항상 도달 가능하고 엄격히 나은 대체*가 생겼다. 재추가 금지 — 근거는 로드맵 P-2.
       ⚠ 오답을 **고치는** 경로는 그대로다(기록 탭의 오답 폼·아카이브 편집·삭제). 은퇴한 것은
         "빈 폼을 여는 팔레트 명령" 하나다. */
    /* ⚠ `act:add-bl`(기록 · 보충 필요 추가)은 **D-2 에서 은퇴**했다. 하는 일이 "과목·내용을
       빈 채로 보충 폼을 여는 것"이었는데, 이제 팔레트에서 문장을 치고 ⌘Enter 를 누르면 그
       문장이 **그대로 보충에 담긴다**. 빈 폼을 여는 명령은 그보다 엄격히 못한 경로다
       (친 글자를 버리고 다시 치게 만든다). 재추가 금지 — 근거는 로드맵 D-2. */
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
    /* ⚠ **옛 `act:undo`(= `BACKUP_KEY` 스냅샷 복원)를 이 자리에서 뺐다**(근본① · 2026-08-01).
       라벨이 _"직전 상태로"_ 였는데 그건 거짓이었다 — 스냅샷은 *마지막으로 `backupNow()` 를 부른
       시점*이라 며칠 전일 수 있었다. 그 복원은 이제 성질에 맞는 자리(⋯ 메뉴 · 시각을 함께
       보여주는 곳)에만 있고, 여기에는 **진짜 직전 편집**을 되돌리는 전역 ⌘Z 를 둔다.
       ⚠ 동적 import 인 이유: 되돌리기는 병합 기계(`applyPull`)를 끌고 오므로 팔레트를 여는 것만으로
       그 사슬이 초기 청크에 들어오면 안 된다(H7 과 같은 규율). */
    {
      id: 'act:undo',
      kind: 'act',
      label: `되돌리기 · 직전 편집 (${MOD_LABEL}+Z)`,
      hint: '데이터',
      run: () => void import('@/store/undoController').then((m) => m.undoLastEdit()),
    },
    {
      id: 'act:redo',
      kind: 'act',
      label: `다시 실행 · 되돌린 편집 (${MOD_LABEL}+⇧+Z)`,
      hint: '데이터',
      run: () => void import('@/store/undoController').then((m) => m.redoLastEdit()),
    },
    /* ✅ **손으로 놓던 `act:graph` 한 줄이 사라졌다**(Q-22 · 2026-08-02). 종전 주석이 스스로
       _"TABS 에서 화면을 내릴 때마다 여기"_ 라며 **재발을 예약**해 뒀는데, 은퇴에 어휘를 주니
       (`role:'retired'`) 배열에 남아 있게 되어 위 `tabs` 매핑이 자동으로 줍는다. 불변식 ②의
       "은퇴한 탭도 ⌘K 로 도달한다"가 그것을 집행한다. */
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
