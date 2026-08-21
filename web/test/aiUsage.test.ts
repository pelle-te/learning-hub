/* ============================================================
   aiUsage.test.ts — **로컬 LLM 축 계기**의 계약(I023 · 2026-08-22 발상 축).

   이 계기의 결론은 *"Rust 473줄 + 임베딩 캐시 + 스트리밍 계약을 지운다"* 이다. 되돌리기
   비용이 가장 큰 판정이라, 여기서 잠그는 것은 **수를 세는 법**이 아니라 **0 을 언제 믿어도
   되는가**다.

   ⚠ 셋: ① 안 쟀으면 `since` 가 `null`(0 과 **다른 상태**) ② 1주를 채우기 전엔 `ready` 가 거짓
   ③ 보존 창 밖은 잊는다(옛 시험 사용이 이번 주 판정을 오염시키지 않는다).
============================================================ */
import { describe, expect, it, beforeEach } from 'vitest';
import { recordAiCall, aiUsage, aiUsageReady, AI_USAGE_KEY, AI_SAMPLE_MIN_DAYS } from '@/lib/aiUsage';
import { storage } from '@/lib/kv';

beforeEach(() => storage.removeItem(AI_USAGE_KEY));

describe('aiUsage — 0 의 두 가지 뜻', () => {
  it('⚠⚠ 한 번도 안 쟀으면 since 가 null 이다 — 「안 쓴다」와 구분되지 않으면 판정이 순환한다', () => {
    const u = aiUsage(14, '2026-08-22');
    expect(u.since).toBeNull();
    expect(u.total).toBe(0);
    expect(aiUsageReady(u)).toBe(false);
  });

  it('첫 호출이 관측 시작일을 못박는다', () => {
    recordAiCall('2026-08-22');
    const u = aiUsage(14, '2026-08-22');
    expect(u.since).toBe('2026-08-22');
    expect(u.total).toBe(1);
    expect(u.observedDays).toBe(1);
  });

  it(`⚠ 관측 ${AI_SAMPLE_MIN_DAYS}일 미만이면 판정 불가 — 「이번 주에 안 썼다」는 한 주를 봐야 안다`, () => {
    recordAiCall('2026-08-22');
    expect(aiUsageReady(aiUsage(14, '2026-08-24'))).toBe(false);
    expect(aiUsageReady(aiUsage(14, '2026-08-28'))).toBe(true);
  });

  it('쓴 날 수를 따로 센다 — 「하루 몰아 썼다」와 「매일 쓴다」는 다른 결론이다', () => {
    recordAiCall('2026-08-20');
    recordAiCall('2026-08-20');
    recordAiCall('2026-08-22');
    const u = aiUsage(14, '2026-08-22');
    expect(u.total).toBe(3);
    expect(u.activeDays).toBe(2);
  });

  it('⚠ 보존 창 밖은 잊는다 — 옛 시험 사용이 이번 주 판정을 떠받치면 안 된다', () => {
    recordAiCall('2026-07-01');
    recordAiCall('2026-08-22');
    expect(aiUsage(14, '2026-08-22').total).toBe(1);
  });

  it('저장이 손상돼도 던지지 않는다 — 계기가 기능을 죽이면 안 된다', () => {
    storage.setItem(AI_USAGE_KEY, '{not json');
    expect(() => recordAiCall('2026-08-22')).not.toThrow();
    expect(aiUsage(14, '2026-08-22').total).toBe(1);
  });
});
