/* ============================================================
   promote.test.ts — 진단→학습 승격 매핑(순수) 회귀.
   ⚠ 소비(읽을거리·증시) 승격 케이스가 P10 W4 에서 빠졌다(2026-08-07) — 그 화면들이 `survey/` 로
   갔고, 교양 재료가 학습에 닿는 길은 이제 survey 의 발견 큐 → 승격 하나다(불변식 I-5).
============================================================ */
import { describe, expect, it } from 'vitest';
import { backlogFromWeakSpot, backlogFromRootCause, PROMOTE_TOAST } from '@/lib/promote';

describe('promote — 진단 씨앗', () => {
  it('반복 약점 → 과목·챕터와 막힌 횟수를 담는다', () => {
    const seed = backlogFromWeakSpot({ subject: '전자기학', chapter: '맥스웰 방정식', count: 3 });
    expect(seed.name).toBe('반복 약점');
    expect(seed.topic).toBe('전자기학 — 맥스웰 방정식');
    expect(seed.note).toContain('3번');
  });

  it('근본원인 → 뿌리 개념과 상류 개수를 담는다', () => {
    const seed = backlogFromRootCause({ cause: '선적분', count: 4 });
    expect(seed.name).toBe('근본원인');
    expect(seed.topic).toBe('선적분');
    expect(seed.note).toContain('4개');
  });

  /* 문안이 SSOT 인 이유(SR-10): 여러 호출부가 각자 하드코딩하던 것을 한 곳으로 모았다.
     ⚠ 그 호출부 둘이 P10 W4 에서 사라졌지만 나머지(진단 승격·⌘K 동사)가 여전히 쓴다. */
  it('승격 토스트 문안은 한 곳이 소유한다', () => {
    expect(PROMOTE_TOAST).toContain('보충 백로그');
  });
});
