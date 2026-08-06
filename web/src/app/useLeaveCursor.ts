/* ============================================================
   useLeaveCursor — **Q-27 "떠날 때" 이어하기 커서**(2026-08-02).

   ## 왜 네 번째 트리거인가
   `lib/resume` 의 쓰기 트리거는 셋이었다(집중 시작/종료 · 복습 진행 · 저널 초안) — 전부
   **진행 중인 작업**이다. 그래서 아무 작업도 시작하지 않고 화면만 보다가 앱을 닫으면 커서가
   **아예 안 생겼고**, 다른 기기에서 여는 사람은 "직전에 뭘 보고 있었는지"를 알 방법이 없었다.

   ⚠⚠ 원 주석의 우려를 그대로 인용한다: _"탭 이동마다 쓰면 매 내비게이션이
   `syncedSliceChanged` 를 때려 아웃박스가 잡음으로 찬다."_ **그 우려는 옳고, 이 훅은 그것을
   안 한다** — 쓰기는 **떠날 때 1회**다(`visibilitychange` → hidden). 탭을 스무 번 옮겨도
   쓰기는 0이고, 앱을 덮을 때 한 번 쓴다.

   ⚠ `pagehide` 가 아니라 `visibilitychange` 인 이유: 데스크톱 셸은 창을 닫아도 `pagehide` 가
   보장되지 않고(WebView2), 반대로 최소화·다른 앱으로 전환은 `visibilitychange` 가 정확히
   잡는다 — 그게 실제로 "떠난" 순간이다.
   ⚠⚠ **`hooks/` 가 아니라 `app/` 에 산다** — 레이어 계약이 `hooks → lib` 단방향이라 훅은
   `store` 를 볼 수 없다(린트가 error 로 막는다). 이건 규칙의 불편이 아니라 정확한 판정이다:
   이 훅은 재사용 프리미티브가 아니라 **셸이 앱 전체에 거는 한 줄**이고, 그 자리는 `app/` 이다.

   ⚠ 진행 중 작업이 있으면 **덮어쓰지 않는다.** 복습 7/12 를 "직전 화면: 오늘"로 바꾸면 그건
   커서를 지우는 것과 같다(이 모듈의 존재 이유가 바로 그 중복 학습 방지다).
============================================================ */
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useApp } from '@/store/useApp';
import { ownResume, resumeDevice } from '@/lib/resume';
import { writeResume } from '@/store/resumeCursor';
import { onHidden } from '@/lib/visibility';

/** 커서를 남길 가치가 없는 화면 — 여기서 나가는 건 "돌아갈 곳"이 아니다. */
const SKIP = new Set(['/', '/today']);

export function useLeaveCursor(label: string): void {
  const { pathname } = useLocation();
  useEffect(() => {
    const onHide = (): void => {
      const id = resumeDevice();
      if (!id || SKIP.has(pathname)) return;
      const st = useApp.getState().state;
      // 진행 중 작업 커서가 살아 있으면 그쪽이 이긴다(위 ⚠).
      const cur = ownResume(st, id, Date.now());
      if (cur && cur.kind !== 'screen') return;
      /* ⚠ 쓰기는 `store/resumeCursor` 하나가 소유한다(M-3) — 여기 손으로 `putResume` 을 부르던
         것이 세 사본 중 하나였고, `at` 규약이 갈린 지점이기도 했다. 판정(위 두 줄)만 이 훅의 몫. */
      writeResume({ kind: 'screen', label, route: pathname });
    };
    return onHidden(onHide);
  }, [pathname, label]);
}
