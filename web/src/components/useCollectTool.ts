/* ============================================================
   useCollectTool — 수집형 탭(읽을거리·증시) 공용 수집 흐름.
   runTool(수집 스크립트) → refetch → 토스트 규약을 한 곳에 —
   탭마다 복붙되며 드리프트하던 collect()를 수렴한다(세 번째 수집형 탭 대비).
============================================================ */
import { useCallback, useState } from 'react';
import { runTool } from '@/lib/api';
import { ui } from '@/shell';

export function useCollectTool(
  tool: string,
  refetch: () => Promise<unknown>,
  doneMsg: string,
): { collecting: boolean; collect: (silent?: boolean) => Promise<boolean> } {
  const [collecting, setCollecting] = useState(false);
  const collect = useCallback(
    async (silent = false) => {
      if (collecting) return false;
      setCollecting(true);
      let ok = false;
      try {
        const res = await runTool(tool, {});
        if (res.ok) {
          await refetch();
          ok = true;
          if (!silent) ui.toast(doneMsg, 'ok');
        } else if (!silent) {
          ui.toast('수집 실패 — serve.js 출력 확인', 'bad');
        }
      } catch (e) {
        if (!silent) ui.toast('수집 요청 실패: ' + ((e as Error).message || e), 'bad');
      }
      setCollecting(false);
      return ok;
    },
    [collecting, tool, refetch, doneMsg],
  );
  return { collecting, collect };
}
