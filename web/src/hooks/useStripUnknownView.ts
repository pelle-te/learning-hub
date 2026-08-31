/* ============================================================
   useStripUnknownView — **은퇴한 `?view=` 주소가 주소창에 거짓으로 남지 않게 한다**(U048 · 2026-08-31).

   ## 무엇이 문제였나

   `?view=` 로 갈라지는 호스트는 모르는 값이 오면 자기 **기본 뷰**로 접는다(그 자체는 옳다 —
   404 를 띄우는 것보다 낫다). 그런데 주소는 그대로 남아서, `/degree?view=path` 로 간 사람이
   **졸업 계획**을 보면서 주소창에는 「path」를 읽는다. 세그먼트 바까지 「졸업 계획」을 눌린
   상태로 그리니 **화면·주소·컨트롤 셋이 서로 다른 말을 한다.**
   `shell/tabs.ts` 가 이 형태에 이미 이름을 붙여 뒀다: *"은퇴 탭이 호스트의 기본 뷰에 착지한다
   (**조용한 도달성 손실** — 화면은 떴는데 찾던 것이 없다)."*

   ⚠ 「이 뷰로 오는 경로 자체가 없다」는 **거짓**이다(`Degree.tsx` 주석이 그렇게 적고 있었다).
   북마크 · 브라우저 이력 · e2e 로스터 · ⌘K 최근 목록이 그 주소를 들고 있다.

   ## 왜 주소에서 걷는가

   걷어 내면 **북마크가 스스로 낫는다** — 다음에 그 사람이 같은 즐겨찾기를 눌러도 이번엔
   정직한 주소가 남는다. `replace: true` 인 것은 이 정정이 «되돌아갈 이력»이 아니기 때문이다
   (뒤로 가기가 방금 고친 거짓 주소로 되돌아가면 정정이 무효가 된다).
============================================================ */
import { useEffect } from 'react';
import type { useSearchParams } from 'react-router-dom';

type SetParams = ReturnType<typeof useSearchParams>[1];

/**
 * `?view=` 가 `known` 밖이면 주소에서 지운다(호스트 기본 뷰로 착지한 사실과 주소를 맞춘다).
 *
 * @param params 현재 쿼리
 * @param setParams 그 세터
 * @param known 이 호스트가 아는 뷰 값들(기본 뷰는 `view` 없음이므로 넣지 않는다)
 */
export function useStripUnknownView(params: URLSearchParams, setParams: SetParams, known: readonly string[]): void {
  const raw = params.get('view');
  const 모름 = raw != null && !known.includes(raw);
  useEffect(() => {
    if (!모름) return;
    /* ⚠ **함수형 세터를 쓴다.** `params` 는 매 렌더 새 객체라 의존성에 넣으면 루프가 되는데,
       빼면 `exhaustive-deps` 를 억제해야 하고 **그 억제가 곧 React Compiler 바일아웃이다**
       (`compiler-ratchet` 이 실제로 잡았다). 함수형 형태는 직전 값을 인자로 받으므로 의존성이
       판정값과 세터뿐이고, 억제가 필요 없다. */
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('view');
        return next;
      },
      { replace: true },
    );
  }, [모름, setParams]);
}
