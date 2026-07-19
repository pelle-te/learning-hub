/* ============================================================
   useCollectTool — 수집형 탭(읽을거리·증시) 공용 수집 흐름.
   runTool(수집 스크립트) → refetch → 토스트 규약을 한 곳에 —
   탭마다 복붙되며 드리프트하던 collect()를 수렴한다(세 번째 수집형 탭 대비).
   수집은 서버 캡(180s)까지 걸릴 수 있어 취소 가능해야 한다 → AbortController를 물려
   collect()에 signal을 넘기고 cancel()을 노출한다(X-5). 반환 모양은 하위호환(필드 추가만).
============================================================ */
import { useCallback, useEffect, useRef, useState } from 'react';
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
          ui.toast('수집 실패 — 아래 실행 로그를 확인하세요', 'bad');
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

/** 크로스데이 자동수집 — 온라인·비로딩·비수집이고 데이터가 '오늘 신선'하지 않으면 마운트당 1회 조용히 수집.
 *  reads·markets가 복붙하던 didAuto 이펙트를 수렴(SR-13). fresh=오늘자 데이터가 이미 있나(탭이 판정해 전달).
 *  실패해도 didAuto로 재발화 안 함(!online이면 대기, 온라인 전환 후 판정). */
export function useAutoCollect(
  collect: (silent?: boolean) => Promise<unknown>, // 반환값은 쓰지 않음(성공여부 무관 1회 발화)
  opts: { online: boolean; isLoading: boolean; collecting: boolean; fresh: boolean },
): void {
  const { online, isLoading, collecting, fresh } = opts;
  const didAuto = useRef(false);
  useEffect(() => {
    if (didAuto.current || !online || isLoading || collecting) return;
    if (fresh) return; // 이미 오늘 데이터 → 수집 불필요(신선도 바뀌면 다음 렌더서 재판정)
    didAuto.current = true;
    void collect(true); // async라 setState가 이펙트 밖(마이크로태스크)에서 발생 → set-state-in-effect 미발화
  }, [online, isLoading, collecting, fresh, collect]);
}
