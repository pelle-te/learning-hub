/* ============================================================
   absence.test.ts — 부재 델타(P-1).

   잠그는 것 셋:
   ① **관측이 없으면 델타를 지어내지 않는다** — `thenReview` 가 null 이면 화살표가 안 나온다.
   ② **부재 기간의 경계는 양쪽 다 열려 있다** — 마지막 방문일 당일과 오늘은 '미완'이 아니다.
   ③ **말할 것이 없으면 안 그린다** — `N일 비었어요` 만 남기면 그건 정보가 아니라 지적이다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { ABSENCE_MIN_DAYS, missedSince, returnBriefing, type AbsenceNow, RETURN_REVIEW_CAP } from '@/lib/absence';

const NOW: AbsenceNow = { review: 71, missed: 6, deadline: { name: '전자기', dday: 6 } };

describe('부재 기간의 미완 블록 — 경계가 양쪽 다 열려 있다', () => {
  const blocks = [
    { ds: '2026-07-27', done: false }, // 마지막 방문일 당일 — 봤고 안 한 것은 그날의 선택
    { ds: '2026-07-28', done: false },
    { ds: '2026-07-29', done: true }, // 폰에서 했다
    { ds: '2026-07-30', done: false },
    { ds: '2026-08-01', done: false }, // 오늘 — 아직 미완이 아니라 할 일이다
  ];

  it('마지막 방문일 당일과 오늘은 세지 않는다', () => {
    expect(missedSince(blocks, '2026-07-27', '2026-08-01')).toBe(2);
  });

  it('완료된 것은 세지 않는다', () => {
    expect(missedSince([{ ds: '2026-07-29', done: true }], '2026-07-27', '2026-08-01')).toBe(0);
  });

  it('부재가 없으면(어제 방문) 셀 구간 자체가 비어 있다', () => {
    expect(missedSince(blocks, '2026-07-31', '2026-08-01')).toBe(0);
  });
});

describe('브리핑 한 줄', () => {
  it('관측된 과거값이 있으면 화살표로 델타를 말한다', () => {
    const b = returnBriefing({ lastDs: '2026-07-28', thenReview: 32 }, NOW, '2026-08-01');
    expect(b?.days).toBe(4);
    expect(b?.line).toBe('4일 비었어요 — 복습 32→71 · 미완 6 · 전자기 D-6');
  });

  it('⚠ 관측이 없으면 과거를 지어내지 않는다 — 화살표 없이 현재값만', () => {
    const b = returnBriefing({ lastDs: '2026-07-28', thenReview: null }, NOW, '2026-08-01');
    expect(b?.line).toContain('복습 71');
    expect(b?.line).not.toContain('→');
  });

  it('복습이 줄었거나 그대로면 델타로 말하지 않는다(부재의 결과가 아니다)', () => {
    const b = returnBriefing({ lastDs: '2026-07-28', thenReview: 80 }, NOW, '2026-08-01');
    expect(b?.line).not.toContain('80');
    expect(b?.line).toContain('복습 71');
  });

  it(`부재가 ${ABSENCE_MIN_DAYS}일 미만이면 그리지 않는다`, () => {
    expect(returnBriefing({ lastDs: '2026-07-31', thenReview: 32 }, NOW, '2026-08-01')).toBeNull();
  });

  it('마지막 방문일 관측 자체가 없으면 그리지 않는다(브라우저·첫 실행)', () => {
    expect(returnBriefing({ lastDs: null, thenReview: null }, NOW, '2026-08-01')).toBeNull();
  });

  it('⚠ 말할 것이 없으면 부재 길이만 남기지 않는다 — 그건 지적이다', () => {
    const quiet: AbsenceNow = { review: 0, missed: 0, deadline: null };
    expect(returnBriefing({ lastDs: '2026-07-20', thenReview: 0 }, quiet, '2026-08-01')).toBeNull();
  });

  it('SR 문장은 같은 사실을 풀어 쓴다(화면 문구의 축약을 SR 에 떠넘기지 않는다)', () => {
    const b = returnBriefing({ lastDs: '2026-07-28', thenReview: 32 }, NOW, '2026-08-01');
    expect(b?.aria).toContain('4일 만의 복귀');
    expect(b?.aria).toContain('32개에서 71개로');
  });
});

describe('Q-29 복귀 브리핑 처방 — 숫자 뒤에 하라는 말', () => {
  const snap = { lastDs: '2026-07-25', thenReview: 2 };
  const TODAY = '2026-08-02';

  it('마감이 있으면 마감이 이긴다 — 날짜는 협상 대상이 아니다', () => {
    const b = returnBriefing(snap, { review: 9, missed: 4, deadline: { name: '전자기학', dday: 3 } }, TODAY)!;
    expect(b.advice).toContain('전자기학');
    expect(b.advice).toContain('마감');
  });

  it('⭐ 마감이 없으면 밀린 복습을 **상한만큼만** — "전부"라고 말하지 않는다', () => {
    const b = returnBriefing(snap, { review: 40, missed: 0, deadline: null }, TODAY)!;
    expect(b.advice).toContain(String(RETURN_REVIEW_CAP));
    expect(b.advice).not.toContain('40');
  });

  it('밀린 복습이 상한보다 적으면 그 수만큼만 말한다', () => {
    const b = returnBriefing(snap, { review: 2, missed: 0, deadline: null }, TODAY)!;
    expect(b.advice).toContain('2개');
  });

  it('복습도 마감도 없으면 "오늘 것부터" — 따라잡으라고 하지 않는다', () => {
    const b = returnBriefing(snap, { review: 0, missed: 5, deadline: null }, TODAY)!;
    expect(b.advice).toContain('오늘 블록부터');
    expect(b.advice).not.toMatch(/따라잡|전부|모두/);
  });

  it('처방은 aria 에도 실린다 — 화면과 SR 이 다른 말을 하지 않게', () => {
    const b = returnBriefing(snap, { review: 9, missed: 0, deadline: null }, TODAY)!;
    expect(b.aria).toContain(b.advice);
  });

  it('말할 것이 없으면 여전히 null — 처방을 만들려고 브리핑을 억지로 그리지 않는다', () => {
    expect(returnBriefing(snap, { review: 0, missed: 0, deadline: null }, TODAY)).toBeNull();
  });
});
