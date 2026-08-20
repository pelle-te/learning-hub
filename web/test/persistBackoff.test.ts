/* ============================================================
   persistBackoff.test.ts — **쓰기 실패 재시도 수열**(M-11 · 2026-08-20).

   이 축은 리뷰 시점에 **테스트가 0건**이었다. `saveFailure.test.ts` 는 브라우저 가지만 보고
   `dbUnavailable.test.ts` 는 배너·임시사본만 단언한 뒤 실시계 600ms 를 자고 끝난다 — 그 사이
   몇 번 썼는지는 아무도 안 센다. 그런데 정책 자신은 위험을 알고 있었다:
   *"400ms 고정 재시도는 시간당 9,000회 전량 쓰기가 된다."*

   즉 누가 승수를 되돌리거나 성공 경로의 리셋을 잘못 옮기면 앱이 조용히 초당 재시도로 떨어지고,
   게이트는 녹색이다. 정책이 순수 함수로 나오면서 그 수열을 **한 줄로** 잠글 수 있게 됐다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { nextRetryMs, PERSIST_MS, PERSIST_RETRY_MAX_MS } from '@/lib/db/write';

describe('쓰기 실패 백오프', () => {
  it('첫 실패는 디바운스와 같은 칸에서 시작한다', () => {
    expect(nextRetryMs(0)).toBe(PERSIST_MS);
  });

  it('배로 늘고 상한에서 멈춘다 — 상한이 없으면 영구 실패가 초당 전량 쓰기가 된다', () => {
    const seq: number[] = [];
    let cur = 0;
    for (let i = 0; i < 10; i++) {
      cur = nextRetryMs(cur);
      seq.push(cur);
    }
    expect(seq).toEqual([400, 800, 1600, 3200, 6400, 12800, 25600, 30000, 30000, 30000]);
    expect(seq[seq.length - 1]).toBe(PERSIST_RETRY_MAX_MS);
  });

  it('상한에 닿은 뒤에도 **재시도를 멈추지 않는다** — 원인이 배포로 고쳐지면 저장이 살아나야 한다', () => {
    expect(nextRetryMs(PERSIST_RETRY_MAX_MS)).toBe(PERSIST_RETRY_MAX_MS);
    expect(nextRetryMs(PERSIST_RETRY_MAX_MS)).toBeGreaterThan(0);
  });

  it('성공 리셋(0)은 다시 첫 칸으로 — 리셋을 빠뜨리면 한 번 실패한 세션이 영원히 30초 간격이 된다', () => {
    let cur = 0;
    for (let i = 0; i < 5; i++) cur = nextRetryMs(cur);
    expect(cur).toBeGreaterThan(PERSIST_MS);
    cur = 0; // flush 성공 경로가 하는 일
    expect(nextRetryMs(cur)).toBe(PERSIST_MS);
  });
});
