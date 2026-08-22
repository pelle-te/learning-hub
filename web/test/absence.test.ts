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

describe('T-11 밖에서 일어난 일 — 부호가 반대인 사실', () => {
  const snap = { lastDs: '2026-07-28', thenReview: 32 };
  const TODAY = '2026-08-01';
  const QUIET: AbsenceNow = { review: 0, missed: 0, deadline: null };

  it('⭐ 앱 안이 평온해도 밖에서 한 일이 있으면 그린다 — 그게 이 항목의 요지다', () => {
    const b = returnBriefing(snap, QUIET, TODAY, { notes: 5, subjects: ['회로이론'], ankiCards: 120, unreadable: 0 })!;
    expect(b.line).toBe('4일 비었어요 (밖에서 노트 5 · 카드 120)');
  });

  it('⚠ 밀린 것 목록에 섞지 않는다 — 부호가 반대인 사실이 같은 픽셀로 읽히면 안 된다', () => {
    const b = returnBriefing(snap, NOW, TODAY, { notes: 5, subjects: [], ankiCards: null, unreadable: 0 })!;
    // 무너진 것은 ` — ` 뒤 목록, 한 일은 괄호 안. 둘이 한 목록에 들어가면 이 단언이 깨진다.
    expect(b.line).toBe('4일 비었어요 — 복습 32→71 · 미완 6 · 전자기 D-6 (밖에서 노트 5)');
  });

  it('⚠⚠ 모르는 것(null)은 0 으로 접지 않는다 — Anki 가 꺼져 있는 것과 "안 했다"는 다른 사실', () => {
    const b = returnBriefing(snap, QUIET, TODAY, { notes: null, subjects: [], ankiCards: null, unreadable: 0 });
    expect(b).toBeNull(); // 할 말이 하나도 없다 = 안 그린다(0 을 지어내지 않았다는 뜻)
  });

  it('밖에서만 일이 있으면 처방은 진도 반영 — 마감·복습·미완을 이기지는 않는다', () => {
    const outside = { notes: 5, subjects: ['회로이론'], ankiCards: null, unreadable: 0 };
    expect(returnBriefing(snap, QUIET, TODAY, outside)!.advice).toContain('진도에 반영');
    // 마감이 있으면 여전히 마감이 이긴다(이미 한 일이 아직 안 온 마감보다 급할 수 없다)
    const urgent: AbsenceNow = { review: 0, missed: 0, deadline: { name: '전자기', dday: 2 } };
    expect(returnBriefing(snap, urgent, TODAY, outside)!.advice).toContain('마감');
  });

  it('과목 이름은 칩이 아니라 풀어 쓴 문장에만 — 13px 안에 이름을 더 넣지 않는다', () => {
    const b = returnBriefing(snap, QUIET, TODAY, {
      notes: 5,
      subjects: ['회로이론', '전자기학'],
      ankiCards: 0,
      unreadable: 0,
    })!;
    expect(b.line).not.toContain('회로이론');
    expect(b.aria).toContain('회로이론·전자기학 쪽으로');
  });
});

/* ⭐ **부분 실패는 「없다」가 아니다** (O021 · 2026-08-22 운영 축)

   `vault_touched` 의 순회는 못 읽은 하위 트리를 조용히 건너뛴다 — 과목 폴더 하나가 OneDrive
   재동기화 중이면 그 트리가 통째로 빠지는데 화면은 「밖에서 바뀐 노트 없음」이었다. 즉
   **200개 중 3개 실패**와 **정말 아무것도 안 바뀜**이 글자 하나 다르지 않았다.
   Rust 쪽이 이제 `unreadable` 을 세고, 여기서는 그 사실이 **문장에 도달하는지**를 잰다. */
describe('O021 — 일부를 못 읽었으면 수를 단정하지 않는다', () => {
  const snap = { lastDs: '2026-07-28', thenReview: 32 };
  const TODAY = '2026-08-01';
  const QUIET: AbsenceNow = { review: 0, missed: 0, deadline: null };

  it('못 읽은 폴더가 있으면 `+` 가 붙는다 — 「이게 전부다」라는 주장을 하지 않는다', () => {
    const b = returnBriefing(snap, QUIET, TODAY, { notes: 5, subjects: [], ankiCards: null, unreadable: 3 })!;
    expect(b.line).toContain('노트 5+');
  });

  it('전량을 읽었으면 `+` 가 없다 — 이 표식이 상시 켜져 있으면 곧 무시된다', () => {
    const b = returnBriefing(snap, QUIET, TODAY, { notes: 5, subjects: [], ankiCards: null, unreadable: 0 })!;
    expect(b.line).toContain('노트 5)');
    expect(b.line).not.toContain('노트 5+');
  });
});
