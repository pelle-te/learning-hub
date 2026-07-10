/* ============================================================
   useCollectTool — 수집형 탭(읽을거리·증시) 공용 수집 흐름.
   runTool(수집 스크립트) → refetch → 토스트 규약을 한 곳에 —
   탭마다 복붙되며 드리프트하던 collect()를 수렴한다(세 번째 수집형 탭 대비).
   수집은 서버 캡(180s)까지 걸릴 수 있어 취소 가능해야 한다 → AbortController를 물려
   collect()에 signal을 넘기고 cancel()을 노출한다(X-5). 반환 모양은 하위호환(필드 추가만).
============================================================ */
import { useCallback, useRef, useState } from 'react';
import { runTool } from '@/lib/api';
import { ui } from '@/shell';

export function useCollectTool(
  tool: string,
  refetch: () => Promise<unknown>,
  doneMsg: string,
): { collecting: boolean; collect: (silent?: boolean) => Promise<boolean>; cancel: () => void } {
  const [collecting, setCollecting] = useState(false);
  const ctrlRef = useRef<AbortController | null>(null);

  /** 진행 중인 수집을 취소 — 물린 연결/느린 서버를 스피너에 갇히지 않고 끊는다. */
  const cancel = useCallback(() => {
    ctrlRef.current?.abort();
  }, []);

  const collect = useCallback(
    async (silent = false) => {
      if (collecting) return false;
      setCollecting(true);
      const ctrl = new AbortController();
      ctrlRef.current = ctrl;
      let ok = false;
      try {
        const res = await runTool(tool, {}, { signal: ctrl.signal });
        if (res.ok) {
          await refetch();
          ok = true;
          if (!silent) ui.toast(doneMsg, 'ok');
        } else if (!silent) {
          ui.toast('수집 실패 — serve.js 출력 확인', 'bad');
        }
      } catch (e) {
        // 사용자 취소/타임아웃(AbortError)은 실패 토스트로 겁주지 않는다.
        if (ctrl.signal.aborted) {
          if (!silent) ui.toast('수집을 취소했어요', 'ok');
        } else if (!silent) {
          ui.toast('수집 요청 실패: ' + ((e as Error).message || e), 'bad');
        }
      }
      ctrlRef.current = null;
      setCollecting(false);
      return ok;
    },
    [collecting, tool, refetch, doneMsg],
  );
  return { collecting, collect, cancel };
}
