/* ============================================================
   useAiStream — 온디맨드 AI 스트리밍(코치 채점·증시 브리핑) 공용 스캐폴딩.
   busy·preview(토큰 미리보기)·AbortController 수명·onDelta 배선만 소유하고,
   결과 처리(성공 상태·도메인 오류문구·포커스 이동)는 호출부에 남긴다 — 얇게 유지해 누수 방지(SR-15).
   reads(coach)·markets(brief)·review(coach)의 복붙 보일러플레이트를 수렴한다.
============================================================ */
import { useCallback, useRef, useState } from 'react';
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

  const run = useCallback(async function run<T>(
    fn: (o: { signal: AbortSignal; onDelta: (t: string) => void }) => Promise<T>,
  ): Promise<AiRunResult<T>> {
    setBusy(true);
    setPreview('');
    const ac = new AbortController();
    abortRef.current = ac;
    let result: AiRunResult<T>;
    try {
      const value = await fn({ signal: ac.signal, onDelta: (t) => setPreview(previewFromJsonStream(t)) });
      result = { ok: true, value };
    } catch (e) {
      const err = e as Error;
      result = { ok: false, aborted: err.name === 'AbortError', error: err.message || String(e) };
    }
    abortRef.current = null;
    setBusy(false);
    return result;
  }, []);

  return { busy, preview, run, cancel };
}
