/* ============================================================
   useAiStream — 온디맨드 AI 스트리밍(코치 채점·증시 브리핑) 공용 스캐폴딩.
   busy·preview(토큰 미리보기)·AbortController 수명·onDelta 배선만 소유하고,
   결과 처리(성공 상태·도메인 오류문구·포커스 이동)는 호출부에 남긴다 — 얇게 유지해 누수 방지(SR-15).
   reads(coach)·markets(brief)·review(coach)의 복붙 보일러플레이트를 수렴한다.
============================================================ */
import { useCallback, useEffect, useRef, useState } from 'react';
import { previewFromJsonStream } from '@/lib/api';

/** run() 결과 — 성공(value)이거나 실패(aborted=사용자 취소면 조용히, 아니면 error 문구). */
export type AiRunResult<T> = { ok: true; value: T } | { ok: false; aborted: boolean; error: string };

export interface AiStream {
  busy: boolean;
  preview: string;
  /** fn에 { signal, onDelta }를 물려 실행 — busy 토글·preview 리셋·abort 수명을 훅이 소유한다. */
  run: <T>(fn: (o: { signal: AbortSignal; onDelta: (t: string) => void }) => Promise<T>) => Promise<AiRunResult<T>>;
  /** 진행 중 스트림 취소(드로어 닫기 등) — 서버가 업스트림을 끊어 생성 자체가 멈춘다. */
  cancel: () => void;
}

export function useAiStream(): AiStream {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  /* ⚠⚠ **언마운트가 곧 취소다**(H18 · 2026-08-01).

     종전엔 취소를 **호출부가** 붙였고, 실제로 붙인 곳은 `Markets` 의 *드로어 닫기* 하나였다.
     그래서 브리핑이 도는 중에 **탭을 떠나면** `ollama_cancel` 이 안 나가고 Rust 가 최대 120초
     동안 생성을 계속 돌았다 — 화면은 이미 없는데 로컬 GPU/CPU 는 계속 탄다(그리고 사용자는
     이유를 볼 방법이 없다). 같은 훅을 쓰는 `ArticlePractice` 는 아예 아무 데도 안 붙여 뒀다.

     처방을 훅에 두는 이유는 `useCommitOnChange`(E15)와 같다: **입구가 여럿인 수명은 값 쪽에
     붙이면 한 번에 전부 덮인다.** 호출부의 명시적 `cancel()`(드로어 닫기)은 그대로 유효하다 —
     그건 "화면은 남았는데 이 작업만 그만"이고, 여기는 "화면 자체가 사라졌다"다. */
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const run = useCallback(async function run<T>(
    fn: (o: { signal: AbortSignal; onDelta: (t: string) => void }) => Promise<T>,
  ): Promise<AiRunResult<T>> {
    /* ⚠ 진행 중이던 스트림을 **먼저 끊는다**. 안 그러면 겹쳐 부를 때 옛 `abortRef` 가 덮여
       `cancel()` 이 옛 스트림을 못 끊고, 그것이 계속 `setPreview` 를 밀며 먼저 끝난 쪽이
       나중 스트림의 `busy` 를 조기 해제한다. */
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setPreview('');
    let result: AiRunResult<T>;
    try {
      const value = await fn({
        signal: ac.signal,
        // 이 실행이 아직 현재 것일 때만 미리보기를 민다 — 취소된 옛 스트림의 지연 델타가 덮지 않게.
        onDelta: (t) => {
          if (abortRef.current === ac) setPreview(previewFromJsonStream(t));
        },
      });
      result = { ok: true, value };
    } catch (e) {
      const err = e as Error;
      result = { ok: false, aborted: err.name === 'AbortError', error: err.message || String(e) };
    }
    /* 이 실행이 아직 현재 것일 때만 정리한다 — 겹쳐 실행되면 **나중 실행**이 abortRef·busy 를
       소유한다. 아니면 취소된 옛 실행의 뒷정리가 새 실행의 상태를 지운다. */
    if (abortRef.current === ac) {
      abortRef.current = null;
      setBusy(false);
    }
    return result;
  }, []);

  return { busy, preview, run, cancel };
}
